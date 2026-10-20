import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
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
