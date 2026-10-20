import { z } from "zod";

import { IdSchema, TimestampSchema } from "./common.js";
import { addDuplicateIssues } from "./refinements.js";

export const CaseRefSchema = z.strictObject({
  caseId: IdSchema,
  iterations: z.number().int().min(1).max(1000),
});
export type CaseRef = z.infer<typeof CaseRefSchema>;

export const JudgeConfigSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});
export type JudgeConfig = z.infer<typeof JudgeConfigSchema>;

export const BudgetSchema = z.strictObject({
  maxCalls: z.number().int().positive(),
  maxTokens: z.number().int().positive().optional(),
});
export type Budget = z.infer<typeof BudgetSchema>;

function sumIterations(caseRefs: readonly CaseRef[]): number {
  return caseRefs.reduce((sum, ref) => sum + ref.iterations, 0);
}

export const PlanSchema = z
  .strictObject({
    id: IdSchema,
    createdAt: TimestampSchema,
    /** Name of the target the plan was made for. */
    target: z.string().min(1),
    /** Goldset files, relative to the plan file. */
    goldsets: z.array(z.string().min(1)).min(1),
    caseRefs: z.array(CaseRefSchema).min(1),
    judge: JudgeConfigSchema.optional(),
    budget: BudgetSchema,
    approvedBy: z.string().min(1).optional(),
    /**
     * Areas deliberately not tested, one sentence each, for the handover report (issue #87).
     */
    outOfScope: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((plan, ctx) => {
    addDuplicateIssues(
      plan.caseRefs.map((ref) => ref.caseId),
      ["caseRefs"],
      "caseId",
      ctx,
      "Fallreferenz",
    );
    const total = sumIterations(plan.caseRefs);
    if (total > plan.budget.maxCalls) {
      ctx.addIssue({
        code: "custom",
        path: ["budget", "maxCalls"],
        message: `der Plan braucht ${String(total)} Aufrufe, das Budget erlaubt ${String(plan.budget.maxCalls)}`,
      });
    }
  });
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanSchema>;

/** Number of target calls the plan will make: the sum of all iterations. */
export function totalPlannedCalls(plan: Pick<Plan, "caseRefs">): number {
  return sumIterations(plan.caseRefs);
}
