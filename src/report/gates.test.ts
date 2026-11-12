import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
import type { JudgeFailure } from "../domain/judge-failure.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { compareRuns } from "./compare.js";
import { evaluateGates, GatesConfigSchema } from "./gates.js";
import { buildReportModel, type ReportModel } from "./report-model.js";

function model(runId: string, cases: Record<string, boolean[]>): ReportModel {
  const iterations: Iteration[] = [];
  const verdicts: Verdict[] = [];
  for (const [caseId, outcomes] of Object.entries(cases)) {
    outcomes.forEach((pass, index) => {
      iterations.push({
        runId,
        caseId,
        index,
        seed: index,
        request: [{ role: "user", content: "?" }],
        response: "x",
        latencyMs: 1,
      });
      verdicts.push({
        runId,
        caseId,
        index,
        source: "check",
        pass,
        criteria: [{ name: "c", pass, reason: "" }],
        reasoning: "",
      });
    });
  }
  const run: Run = {
    id: runId,
    planId: "p",
    target: "t",
    startedAt: "2026-10-11T08:00:00Z",
    goldsets: [{ id: "g", version: "1" }],
  };
  const metadata = new Map(
    Object.keys(cases).map((caseId) => [
      caseId,
      TestCaseSchema.parse({
        id: caseId,
        kind: "qa",
        input: "?",
        severity: caseId.startsWith("probe") ? "critical" : "low",
      }),
    ]),
  );
  return buildReportModel({ run, iterations, verdicts, cases: metadata });
}

describe("GatesConfigSchema", () => {
  it("accepts an empty block and rejects values out of range", () => {
    expect(GatesConfigSchema.parse({})).toEqual({});
    expect(GatesConfigSchema.safeParse({ minPassRate: 1.5 }).success).toBe(false);
    expect(GatesConfigSchema.safeParse({ maxCriticalFails: -1 }).success).toBe(false);
    expect(GatesConfigSchema.safeParse({ maxRegressionPoints: 101 }).success).toBe(false);
  });
});

describe("evaluateGates maxUnjudgedRate (issue #133)", () => {
  /** A run with judged iterations and judge failures of one case, plus a case only checks rate. */
  function judgeModel(options: {
    rated: number;
    refused?: number;
    errors?: number;
    fallbacks?: number;
    draft?: boolean;
  }): ReportModel {
    const runId = "judge-run";
    const run: Run = {
      id: runId,
      planId: "p",
      target: "t",
      startedAt: "2026-10-11T08:00:00Z",
      goldsets: [{ id: "g", version: "1" }],
      judge: { model: "richter", promptVersion: "v2" },
      ...(options.draft === true ? { draftCases: ["rubrik"] } : {}),
    };
    const iterations: Iteration[] = [];
    const verdicts: Verdict[] = [];
    const judgeFailures: JudgeFailure[] = [];
    const add = (caseId: string, index: number): void => {
      iterations.push({
        runId,
        caseId,
        index,
        seed: index,
        request: [{ role: "user", content: "?" }],
        response: "x",
        latencyMs: 1,
      });
      verdicts.push({
        runId,
        caseId,
        index,
        source: "check",
        pass: true,
        criteria: [{ name: "c", pass: true, reason: "" }],
        reasoning: "",
      });
    };
    let index = 0;
    for (let count = 0; count < options.rated; count++, index++) {
      add("rubrik", index);
      verdicts.push({
        runId,
        caseId: "rubrik",
        index,
        source: "judge",
        pass: true,
        criteria: [{ name: "Ton", pass: true, reason: "ok" }],
        reasoning: "Ton: ok",
        judgeModel: "richter",
        promptVersion: "v2",
      });
    }
    const fail = (kind: JudgeFailure["kind"], fallback: boolean): void => {
      add("rubrik", index);
      judgeFailures.push({
        runId,
        caseId: "rubrik",
        index,
        kind,
        reason: kind === "refusal" ? "leere Antwort" : "abgeschnitten",
        judgeModel: "richter",
        promptVersion: "v2",
        ...(fallback ? { fallback: { name: "nicht-behauptet", reason: "Treffer" } } : {}),
      });
      index++;
    };
    for (let count = 0; count < (options.refused ?? 0); count++) fail("refusal", false);
    for (let count = 0; count < (options.errors ?? 0); count++) fail("error", false);
    for (let count = 0; count < (options.fallbacks ?? 0); count++) fail("error", true);
    // Three iterations of a case without rubric: the judge was never asked for them.
    for (let count = 0; count < 3; count++) add("nur-checks", count);
    return buildReportModel({ run, iterations, verdicts, judgeFailures });
  }

  it("accepts a share between 0 and 1", () => {
    expect(GatesConfigSchema.parse({ maxUnjudgedRate: 0 })).toEqual({ maxUnjudgedRate: 0 });
    expect(GatesConfigSchema.safeParse({ maxUnjudgedRate: 1.5 }).success).toBe(false);
    expect(GatesConfigSchema.safeParse({ maxUnjudgedRate: -0.1 }).success).toBe(false);
  });

  it("measures the share among the iterations the judge was asked for", () => {
    const report = judgeModel({ rated: 4, refused: 1 });
    expect(report.totals.judgeRatedIterations).toBe(4);

    const held = evaluateGates({ maxUnjudgedRate: 0.25 }, report);
    expect(held.pass).toBe(true);
    expect(held.results[0]).toMatchObject({
      name: "maxUnjudgedRate",
      limit: "25,0 %",
      actual: "20,0 %",
      pass: true,
    });

    const broken = evaluateGates({ maxUnjudgedRate: 0.1 }, report);
    expect(broken.pass).toBe(false);
    expect(broken.results[0]?.reason).toBe(
      "1 von 5 Iterationen ohne Judge-Urteil (Judge lehnt ab: 1, Judge-Fehler: 0), das sind 20,0 % und mehr als die erlaubten 10,0 %",
    );
  });

  it("breaks when the judge failed everywhere, although the pass rate gate holds", () => {
    const report = judgeModel({ rated: 0, errors: 6 });
    const evaluation = evaluateGates({ minPassRate: 0.9, maxUnjudgedRate: 0.5 }, report);
    expect(evaluation.results.map((r) => `${r.name}:${String(r.pass)}`)).toEqual([
      "minPassRate:true",
      "maxUnjudgedRate:false",
    ]);
    expect(evaluation.pass).toBe(false);
    expect(evaluation.results[1]?.actual).toBe("100,0 %");
  });

  it("counts an iteration that fails through a fallback criterion as without verdict too", () => {
    const report = judgeModel({ rated: 3, fallbacks: 1 });
    const evaluation = evaluateGates({ maxUnjudgedRate: 0 }, report);
    expect(evaluation.pass).toBe(false);
    expect(evaluation.results[0]?.actual).toBe("25,0 %");
  });

  it("holds at zero when every asked iteration got its verdict", () => {
    const evaluation = evaluateGates({ maxUnjudgedRate: 0 }, judgeModel({ rated: 5 }));
    expect(evaluation.pass).toBe(true);
    expect(evaluation.results[0]?.reason).toBe(
      "0 von 5 Iterationen ohne Judge-Urteil, erlaubt sind 0,0 %",
    );
  });

  it("cannot measure when the judge was asked for nothing, and leaves drafts out", () => {
    const none = evaluateGates({ maxUnjudgedRate: 0 }, model("ohne-judge", { "faq-1": [true] }));
    expect(none.pass).toBe(true);
    expect(none.skipped).toEqual(["maxUnjudgedRate"]);
    expect(none.results[0]?.reason).toBe(
      "der Judge wurde für keine Iteration gefragt, Anteil nicht messbar",
    );

    const drafts = evaluateGates(
      { maxUnjudgedRate: 0 },
      judgeModel({ rated: 2, errors: 2, draft: true }),
    );
    expect(drafts.skipped).toEqual(["maxUnjudgedRate"]);
  });
});

describe("evaluateGates with drafts", () => {
  it("ignores critical failures of draft cases", () => {
    const head = model("head", { "probe-1": [false, false] });
    const draft = { ...head, ...buildReportModelWithDrafts(head) };
    const result = evaluateGates({ maxCriticalFails: 0 }, draft);
    expect(result.pass).toBe(true);
  });
});

function buildReportModelWithDrafts(report: ReportModel): Pick<ReportModel, "cases"> {
  return { cases: report.cases.map((entry) => ({ ...entry, draft: true })) };
}

describe("evaluateGates", () => {
  const head = model("head", {
    "faq-1": [true, true, true, false],
    "probe-1": [true, false, false, true],
  });
  const base = model("base", {
    "faq-1": [true, true, true, true],
    "probe-1": [true, true, true, true],
  });

  it("passes when every gate holds", () => {
    const evaluation = evaluateGates(
      { minPassRate: 0.6, maxCriticalFails: 2, maxRegressionPoints: 50 },
      head,
      compareRuns(base, head),
    );
    expect(evaluation.pass).toBe(true);
    expect(evaluation.skipped).toEqual([]);
    expect(evaluation.results.map((r) => `${r.name}:${String(r.pass)}`)).toEqual([
      "minPassRate:true",
      "maxCriticalFails:true",
      "maxRegressionPoints:true",
    ]);
    expect(evaluation.results[0]?.actual).toBe("62,5 %");
    expect(evaluation.results[1]?.actual).toBe("2");
    expect(evaluation.results[2]?.actual).toBe("50,0 Punkte");
  });

  it("fails on the gate that breaks and names the reason", () => {
    const evaluation = evaluateGates(
      { minPassRate: 0.9, maxCriticalFails: 1, maxRegressionPoints: 10 },
      head,
      compareRuns(base, head),
    );
    expect(evaluation.pass).toBe(false);
    expect(evaluation.results.map((r) => r.pass)).toEqual([false, false, false]);
    expect(evaluation.results[0]?.reason).toContain("liegt unter der Mindestquote 90,0 %");
    expect(evaluation.results[1]?.reason).toContain("übersteigen die erlaubten 1");
    expect(evaluation.results[2]?.reason).toContain("Rückgang um 50,0 Punkte bei probe-1");
  });

  it("skips gates it cannot evaluate without failing", () => {
    const evaluation = evaluateGates({ maxRegressionPoints: 10, minPassRate: 0.5 }, head);
    expect(evaluation.pass).toBe(true);
    expect(evaluation.skipped).toEqual(["maxRegressionPoints"]);
    expect(evaluation.results[1]?.pass).toBeNull();
    const empty = evaluateGates({ minPassRate: 0.5 }, model("leer", {}));
    expect(empty.skipped).toEqual(["minPassRate"]);
    expect(empty.pass).toBe(true);
  });

  it("evaluates nothing without gates", () => {
    expect(evaluateGates({}, head)).toEqual({ results: [], pass: true, skipped: [] });
  });
});
