import type { TargetResponse } from "../adapters/target.js";
import type { TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";

/**
 * A verdict without run coordinates. Checks only know the case and the response;
 * the runner adds runId, caseId and index before the verdict is stored.
 */
export type CheckResult = Pick<Verdict, "source" | "pass" | "criteria" | "reasoning">;

/** What a check may know about the run beyond case and answer. */
export interface CheckContext {
  /** A judge rates the answer after the checks; mustNotClaim leaves hits to it (issue #82). */
  judge?: boolean;
}

/** A deterministic rule applied to every response of a case (ADR 0003). */
export interface Check {
  readonly name: string;
  /** Returns null when the check does not apply to this case. */
  run(testCase: TestCase, response: TargetResponse, context?: CheckContext): CheckResult | null;
}

export function checkResult(name: string, pass: boolean, reason: string): CheckResult {
  return {
    source: "check",
    pass,
    criteria: [{ name, pass, reason }],
    reasoning: `${name}: ${reason}`,
  };
}

export function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}
