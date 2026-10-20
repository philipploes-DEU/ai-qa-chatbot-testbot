import type { TargetResponse } from "../adapters/target.js";
import type { TestCase } from "../domain/test-case.js";
import type { Check, CheckContext, CheckResult } from "./check.js";
import { createLatencyCheck } from "./latency.js";
import { leakCheck } from "./leak.js";
import { mustContainCheck } from "./must-contain.js";
import { mustNotClaimCheck } from "./must-not-claim.js";
import { mustNotContainCheck } from "./must-not-contain.js";
import { refusalCheck } from "./refusal.js";
import { mustMatchCheck, mustNotMatchCheck } from "./regex.js";
import { schemaCheck } from "./schema.js";
import { statusCheck } from "./status.js";

export interface DefaultCheckOptions {
  /** From target.expectations.maxLatencyMs; without it no latency check runs. */
  maxLatencyMs?: number;
}

/** The checks the runner applies to every response, in this order. */
export function createDefaultChecks(options: DefaultCheckOptions): Check[] {
  const checks: Check[] = [
    mustContainCheck,
    mustNotContainCheck,
    mustNotClaimCheck,
    mustMatchCheck,
    mustNotMatchCheck,
    schemaCheck,
    refusalCheck,
    leakCheck,
    statusCheck,
  ];
  if (options.maxLatencyMs !== undefined) {
    checks.push(createLatencyCheck(options.maxLatencyMs));
  }
  return checks;
}

/** Runs all checks and keeps the results of those that applied. */
export function runChecks(
  checks: readonly Check[],
  testCase: TestCase,
  response: TargetResponse,
  context: CheckContext = {},
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = check.run(testCase, response, context);
    if (result !== null) results.push(result);
  }
  return results;
}
