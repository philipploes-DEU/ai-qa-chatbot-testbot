import { z } from "zod";

import { IdSchema } from "./common.js";

export const PairWinnerSchema = z.enum(["base", "head", "tie", "undecided"]);
export type PairWinner = z.infer<typeof PairWinnerSchema>;

/** What the judge said in one order: which position won and why. */
export const PairOrderResultSchema = z.strictObject({
  /** Which run's answer stood in position A. */
  first: z.enum(["base", "head"]),
  /** The judge's pick in that order, mapped to the runs. */
  winner: z.enum(["base", "head", "tie"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
export type PairOrderResult = z.infer<typeof PairOrderResultSchema>;

/**
 * A pairwise comparison of two answers to the same case and iteration (issue #10). The judge
 * sees both orders; only an agreeing pick counts, a contradiction is `undecided` and points
 * at position bias rather than a difference between the answers.
 */
export const PairVerdictSchema = z.strictObject({
  baseRunId: IdSchema,
  headRunId: IdSchema,
  caseId: IdSchema,
  index: z.number().int().nonnegative(),
  winner: PairWinnerSchema,
  orders: z.tuple([PairOrderResultSchema, PairOrderResultSchema]),
  reasoning: z.string(),
  judgeModel: z.string().min(1),
  promptVersion: z.string().min(1),
});
export type PairVerdict = z.infer<typeof PairVerdictSchema>;
