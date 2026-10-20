import { z } from "zod";

import { IdSchema } from "./common.js";

/** refusal: the judge model declined (issue #83). error: any other failure of the judge. */
export const JudgeFailureKindSchema = z.enum(["refusal", "error"]);
export type JudgeFailureKind = z.infer<typeof JudgeFailureKindSchema>;

/**
 * An iteration the judge should have rated but did not (issue #83). Stored next to the
 * verdicts, so the report keeps such iterations out of the pass rate instead of letting the
 * checks alone pass them. A judge verdict added later, for example by aiqa judge --run,
 * replaces it.
 */
export const JudgeFailureSchema = z.strictObject({
  runId: IdSchema,
  caseId: IdSchema,
  index: z.number().int().nonnegative(),
  kind: JudgeFailureKindSchema,
  reason: z.string().min(1),
  judgeModel: z.string().min(1),
  promptVersion: z.string().min(1),
  /**
   * A criterion that fails the iteration as long as no judge verdict exists, for example a hit
   * of expected.mustNotClaim (ADR 0018). Without it the iteration leaves the pass rate.
   */
  fallback: z.strictObject({ name: z.string().min(1), reason: z.string().min(1) }).optional(),
});
export type JudgeFailure = z.infer<typeof JudgeFailureSchema>;
