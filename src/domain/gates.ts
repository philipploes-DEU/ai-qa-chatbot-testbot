import { z } from "zod";

/**
 * Thresholds a run must meet in a scheduled pipeline (issue #14). Every field is optional;
 * a missing field is no gate.
 */
export const GatesConfigSchema = z.strictObject({
  /** Pass rate over all judged iterations, between 0 and 1. */
  minPassRate: z.number().min(0).max(1).optional(),
  /** Failed iterations of cases with severity critical. */
  maxCriticalFails: z.number().int().nonnegative().optional(),
  /** Largest pass rate drop of a case against the base run, in points (0 to 100). */
  maxRegressionPoints: z.number().min(0).max(100).optional(),
});
export type GatesConfig = z.infer<typeof GatesConfigSchema>;

/** Hard limits of the workspace for every run, on top of the plan's budget. */
export const WorkspaceBudgetSchema = z.strictObject({
  /** Calls to the target one run may make at most, whatever the plan says. */
  maxCallsPerRun: z.number().int().positive(),
});
export type WorkspaceBudget = z.infer<typeof WorkspaceBudgetSchema>;
