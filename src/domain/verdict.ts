import { z } from "zod";

import { IdSchema } from "./common.js";

export const VerdictSourceSchema = z.enum(["check", "judge"]);
export type VerdictSource = z.infer<typeof VerdictSourceSchema>;

export const CriterionVerdictSchema = z.strictObject({
  name: z.string().min(1),
  pass: z.boolean(),
  reason: z.string(),
  score: z.number().min(0).max(1).optional(),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>;

/**
 * One judgement about one iteration. Checks and the judge write separate verdicts;
 * an iteration passes when all of its verdicts pass.
 */
export const VerdictSchema = z
  .strictObject({
    runId: IdSchema,
    caseId: IdSchema,
    index: z.number().int().nonnegative(),
    source: VerdictSourceSchema,
    pass: z.boolean(),
    score: z.number().min(0).max(1).optional(),
    criteria: z.array(CriterionVerdictSchema).min(1),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    judgeModel: z.string().min(1).optional(),
    promptVersion: z.string().min(1).optional(),
    /** 1-based round of a dialog the verdict belongs to; absent for the whole conversation. */
    round: z.number().int().positive().optional(),
  })
  .superRefine((verdict, ctx) => {
    if (verdict.source !== "judge") return;
    if (verdict.judgeModel === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["judgeModel"],
        message: "Judge-Urteile müssen das Judge-Modell nennen",
      });
    }
    if (verdict.promptVersion === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["promptVersion"],
        message: "Judge-Urteile müssen die Prompt-Version nennen",
      });
    }
  });
export type Verdict = z.infer<typeof VerdictSchema>;
