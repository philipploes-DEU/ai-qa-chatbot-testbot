import { z } from "zod";

import { RunCalibrationSchema } from "./calibration.js";
import { IdSchema, TimestampSchema, TokensSchema, VersionSchema } from "./common.js";

export const RunGoldsetRefSchema = z.strictObject({
  id: IdSchema,
  version: VersionSchema,
  /** Source documents the judge read for this goldset (issue #87); absent means none. */
  sources: z.number().int().positive().optional(),
});

/** What a run cost: calls to the target and the tokens of target and judge apart (issue #87). */
export const RunUsageSchema = z.strictObject({
  calls: z.number().int().nonnegative(),
  targetTokens: TokensSchema,
  judgeTokens: TokensSchema,
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

export const RunStatusSchema = z.enum(["completed", "aborted"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunJudgeSchema = z.strictObject({
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});
export type RunJudge = z.infer<typeof RunJudgeSchema>;

export const RunSchema = z
  .strictObject({
    id: IdSchema,
    planId: IdSchema,
    target: z.string().min(1),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema.optional(),
    targetVersion: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    catalogVersion: z.string().min(1).optional(),
    goldsets: z.array(RunGoldsetRefSchema).min(1),
    /** The judge that rated this run, when one was configured. */
    judge: RunJudgeSchema.optional(),
    /** Calibration of the judge per goldset of the run, when one was recorded. */
    calibrations: z.array(RunCalibrationSchema).optional(),
    /** Cases that were drafts when the run started. They run but never count in a rate. */
    draftCases: z.array(IdSchema).optional(),
    /** Caveats the reader must know, for example an overridden hygiene rule. */
    warnings: z.array(z.string().min(1)).optional(),
    /** Missing while the run is in progress. `aborted` means the budget stopped it. */
    status: RunStatusSchema.optional(),
    /** Why the run was aborted, for example the budget that was exceeded. */
    abortReason: z.string().min(1).optional(),
    /** Areas deliberately not tested, from plan and goldsets (issue #87). */
    outOfScope: z.array(z.string().min(1)).optional(),
    /** Calls and tokens, written when the run finishes; older runs have none (issue #87). */
    usage: RunUsageSchema.optional(),
    /**
     * Cases not sent because a placeholder had no value (issue #93, ADR 0022). They leave every
     * rate and count on their own.
     */
    unresolvedCases: z
      .array(z.strictObject({ caseId: IdSchema, placeholders: z.array(z.string().min(1)).min(1) }))
      .optional(),
  })
  .superRefine((run, ctx) => {
    if (run.finishedAt !== undefined && Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt darf nicht vor startedAt liegen",
      });
    }
  });
export type Run = z.infer<typeof RunSchema>;
