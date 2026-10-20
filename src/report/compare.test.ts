import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { compareRuns, renderComparisonMarkdown, summarizePairs } from "./compare.js";
import { buildReportModel, type ReportModel } from "./report-model.js";

function run(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    planId: "plan-1",
    target: "bot",
    startedAt: "2026-10-11T08:00:00Z",
    finishedAt: "2026-10-11T08:01:00Z",
    goldsets: [{ id: "g", version: "1" }],
    ...extra,
  };
}

/** Builds a report where each case passes the given outcomes; a failing one gets a verdict named by `failing`. */
function model(
  runId: string,
  cases: Record<string, { outcomes: boolean[]; failing?: string }>,
  extra: Partial<Run> = {},
): ReportModel {
  const iterations: Iteration[] = [];
  const verdicts: Verdict[] = [];
  for (const [caseId, spec] of Object.entries(cases)) {
    spec.outcomes.forEach((pass, index) => {
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
        criteria: [{ name: spec.failing ?? "mustContain", pass, reason: pass ? "ok" : "fehlt" }],
        reasoning: "",
      });
    });
  }
  const metadata = new Map(
    Object.keys(cases).map((caseId) => [
      caseId,
      TestCaseSchema.parse({
        id: caseId,
        kind: "qa",
        input: "?",
        severity: caseId.startsWith("probe") ? "critical" : "medium",
      }),
    ]),
  );
  return buildReportModel({ run: run(runId, extra), iterations, verdicts, cases: metadata });
}

describe("compareRuns with drafts", () => {
  it("leaves draft cases out of the comparison", () => {
    const base = model("base", { "faq-1": { outcomes: [true] }, "faq-2": { outcomes: [true] } });
    const head = model(
      "head",
      { "faq-1": { outcomes: [true] }, "faq-2": { outcomes: [false] } },
      { draftCases: ["faq-2"] },
    );
    const comparison = compareRuns(base, head);
    expect(comparison.cases.map((entry) => entry.caseId)).toEqual(["faq-1"]);
    expect(comparison.totals.baseOnly).toEqual([]);
    expect(comparison.totals.headOnly).toEqual([]);
  });
});

describe("compareRuns", () => {
  const base = model("base", {
    "faq-1": { outcomes: [true, true, true, true, true] },
    "faq-2": { outcomes: [true, false, true, true, true] },
    "probe-1": { outcomes: [false, false, false, false, false], failing: "refusal" },
    "nur-base": { outcomes: [true] },
  });
  const head = model(
    "head",
    {
      "faq-1": { outcomes: [false, false, false, false, false, false, false, false, false, false] },
      "faq-2": { outcomes: [true, true, true, true, true] },
      "probe-1": { outcomes: [true, true, true, true, false], failing: "mustNotContain" },
      "nur-head": { outcomes: [true] },
    },
    { goldsets: [{ id: "g", version: "2" }], judge: { model: "richter", promptVersion: "v1" } },
  );
  const comparison = compareRuns(base, head);

  it("compares only the common cases and lists the others", () => {
    expect(comparison.totals.commonCases).toBe(3);
    expect(comparison.totals.baseOnly).toEqual(["nur-base"]);
    expect(comparison.totals.headOnly).toEqual(["nur-head"]);
    expect(comparison.cases.map((entry) => entry.caseId)).toEqual(["faq-1", "faq-2", "probe-1"]);
  });

  it("computes the pass rate delta, significance and iteration mismatch per case", () => {
    const faq1 = comparison.cases[0];
    expect(faq1?.passRateDelta).toBe(-1);
    expect(faq1?.significant).toBe(true);
    expect(faq1?.sameIterations).toBe(false);
    const faq2 = comparison.cases[1];
    expect(faq2?.passRateDelta).toBeCloseTo(0.2);
    expect(faq2?.significant).toBe(false);
    expect(faq2?.flakinessDelta).toBeCloseTo(-0.2);
    expect(faq2?.sameIterations).toBe(true);
  });

  it("lists new and vanished failures by criterion", () => {
    const probe = comparison.cases[2];
    expect(probe?.newFailures).toEqual(["mustNotContain"]);
    expect(probe?.vanishedFailures).toEqual(["refusal"]);
    expect(comparison.cases[0]?.newFailures).toEqual(["mustContain"]);
    expect(comparison.cases[1]?.vanishedFailures).toEqual(["mustContain"]);
  });

  it("weights the failure rate by severity and counts the changes", () => {
    // base: faq-1 0/5 failed w2, faq-2 1/5 failed w2, probe-1 5/5 failed w5 -> (0+2+25)/(10+10+25)
    expect(comparison.totals.weightedFailureRate.base).toBeCloseTo(27 / 45);
    // head: faq-1 10/10 w2 = 20/20, faq-2 0/5 w2 = 0/10, probe-1 1/5 w5 = 5/25 -> 25/55
    expect(comparison.totals.weightedFailureRate.head).toBeCloseTo(25 / 55);
    expect(comparison.totals.passRate.base).toBeCloseTo(9 / 15);
    expect(comparison.totals.passRate.head).toBeCloseTo(9 / 20);
    expect(comparison.totals.improved).toBe(2);
    expect(comparison.totals.regressed).toBe(1);
    expect(comparison.totals.newFailures).toBe(2);
    expect(comparison.totals.vanishedFailures).toBe(2);
    expect(comparison.totals.differentIterations).toBe(1);
  });

  it("names changed goldset versions and judges", () => {
    expect(comparison.versionChanges).toEqual([
      "Goldset g: Version 1 im Base-Lauf, 2 im Head-Lauf",
      "Judge keiner im Base-Lauf, richter (Prompt v1) im Head-Lauf",
    ]);
    expect(compareRuns(base, base).versionChanges).toEqual([]);
  });
});

describe("renderComparisonMarkdown", () => {
  it("renders summary, cases, failures and notes", () => {
    const base = model("base", { "faq-1": { outcomes: [true, true] } });
    const head = model("head", { "faq-1": { outcomes: [true, false], failing: "refusal" } });
    const markdown = renderComparisonMarkdown(compareRuns(base, head));
    expect(markdown).toContain("# AI QA Vergleich");
    expect(markdown).toContain("Base: Lauf `base`");
    expect(markdown).toContain(
      "| Pass-Rate über gemeinsame Fälle | 100,0 % | 50,0 % | -50,0 Punkte |",
    );
    expect(markdown).toContain("| faq-1 | medium | 2 / 2 | 100,0 % | 50,0 % | -50,0 Punkte |");
    expect(markdown).toContain("- faq-1: neu refusal");
    expect(markdown).not.toContain("## Geänderte Versionen");
    expect(markdown).toContain("## Hinweise");
  });
});

describe("summarizePairs and the pairwise section", () => {
  it("counts winners per case and renders the section with the undecided warning", () => {
    const order = (first: "base" | "head", winner: "base" | "head" | "tie") => ({
      first,
      winner,
      reason: "x",
      confidence: 0.5,
    });
    const verdict = (
      caseId: string,
      index: number,
      winner: "base" | "head" | "tie" | "undecided",
    ) => ({
      baseRunId: "base",
      headRunId: "head",
      caseId,
      index,
      winner,
      orders: [order("base", "head"), order("head", "head")] as [
        ReturnType<typeof order>,
        ReturnType<typeof order>,
      ],
      reasoning: "",
      judgeModel: "richter",
      promptVersion: "v1",
    });
    const summary = summarizePairs(
      [verdict("faq-1", 0, "head"), verdict("faq-1", 1, "undecided"), verdict("faq-2", 0, "tie")],
      "richter (Prompt v1)",
    );
    expect(summary.counts).toEqual({ base: 0, head: 1, tie: 1, undecided: 1 });
    expect(summary.cases).toEqual([
      { caseId: "faq-1", base: 0, head: 1, tie: 0, undecided: 1 },
      { caseId: "faq-2", base: 0, head: 0, tie: 1, undecided: 0 },
    ]);

    const base = model("base", { "faq-1": { outcomes: [true] } });
    const head = model("head", { "faq-1": { outcomes: [true] } });
    const markdown = renderComparisonMarkdown({ ...compareRuns(base, head), pairwise: summary });
    expect(markdown).toContain("## Paarvergleich durch den Judge");
    expect(markdown).toContain("Head besser: 1, Base besser: 0, gleich: 1, unentschieden: 1.");
    expect(markdown).toContain("**1 Paare sind unentschieden:**");
    expect(markdown).toContain("| faq-1 | 1 | 0 | 0 | 1 |");
  });
});

describe("renderComparisonMarkdown with changed bindings (issue #93)", () => {
  it("names the placeholders that changed between the runs, without values", () => {
    const base = model("base", { faq: { outcomes: [true] } });
    const head = model("head", { faq: { outcomes: [true] } });
    const comparison = compareRuns(base, head);
    comparison.bindingChanges = [
      { placeholder: "aussteller_1", query: "halle3", queryVersion: "2" },
    ];
    const markdown = renderComparisonMarkdown(comparison);
    expect(markdown).toContain("## Geänderte Bindungen");
    expect(markdown).toContain("- aussteller_1 (halle3, Version 2)");
  });
});
