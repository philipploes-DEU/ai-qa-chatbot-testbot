import { claimFallback } from "../checks/must-not-claim.js";
import type { JudgeFailure } from "../domain/judge-failure.js";
import type { TestCase } from "../domain/test-case.js";
import { ModelRefusalError } from "../providers/json.js";
import type { Judge } from "./judge.js";

/**
 * Turns a failed judge call into the record of the run (issue #83): a refusal of the model or
 * another error, with the reason and, for a mustNotClaim hit, the fallback criterion. Shared by
 * aiqa run and aiqa judge --run, so both count alike.
 */
export function judgeFailureOf(
  error: unknown,
  judge: Pick<Judge, "model" | "promptVersion">,
  testCase: TestCase,
  answer: string,
  at: { runId: string; index: number },
): JudgeFailure {
  const fallback = claimFallback(testCase, answer);
  return {
    runId: at.runId,
    caseId: testCase.id,
    index: at.index,
    kind: error instanceof ModelRefusalError ? "refusal" : "error",
    reason: error instanceof Error ? error.message : String(error),
    judgeModel: judge.model,
    promptVersion: judge.promptVersion,
    ...(fallback !== undefined ? { fallback } : {}),
  };
}
