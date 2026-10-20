import { describe, expect, it } from "vitest";

import type { Verdict } from "../domain/verdict.js";
import { outcomesFromVerdicts, summarizeCase } from "./outcomes.js";

function verdict(caseId: string, index: number, pass: boolean, name = "mustContain"): Verdict {
  return {
    runId: "run-1",
    caseId,
    index,
    source: "check",
    pass,
    criteria: [{ name, pass, reason: pass ? "ok" : "missing" }],
    reasoning: `${name}: ${pass ? "ok" : "missing"}`,
  };
}

describe("outcomesFromVerdicts", () => {
  it("passes an iteration only when all of its verdicts pass", () => {
    const outcomes = outcomesFromVerdicts([
      verdict("a", 0, true, "mustContain"),
      verdict("a", 0, false, "leak"),
      verdict("a", 1, true, "mustContain"),
      verdict("a", 1, true, "leak"),
    ]);
    expect(outcomes).toEqual({ a: [false, true] });
  });

  it("orders iterations by index regardless of input order", () => {
    const outcomes = outcomesFromVerdicts([
      verdict("a", 2, true),
      verdict("a", 0, false),
      verdict("a", 1, true),
    ]);
    expect(outcomes).toEqual({ a: [false, true, true] });
  });

  it("groups by case", () => {
    const outcomes = outcomesFromVerdicts([
      verdict("b", 0, true),
      verdict("a", 0, false),
      verdict("b", 1, false),
    ]);
    expect(outcomes).toEqual({ a: [false], b: [true, false] });
  });

  it("returns an empty object for no verdicts", () => {
    expect(outcomesFromVerdicts([])).toEqual({});
  });
});

describe("summarizeCase", () => {
  it("combines count, pass rate, interval and flakiness", () => {
    const summary = summarizeCase([true, true, true, true, false]);
    expect(summary.n).toBe(5);
    expect(summary.passes).toBe(4);
    expect(summary.passRate).toBeCloseTo(0.8, 10);
    expect(summary.interval.low).toBeGreaterThan(0);
    expect(summary.interval.high).toBeLessThanOrEqual(1);
    expect(summary.flakiness).toBeCloseTo(0.2, 10);
    expect(summary.flaky).toBe(true);
  });

  it("marks stable cases as not flaky", () => {
    const summary = summarizeCase([true, true]);
    expect(summary.flaky).toBe(false);
    expect(summary.flakiness).toBe(0);
  });
});
