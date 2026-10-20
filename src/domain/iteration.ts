import { z } from "zod";

import { IdSchema, TokensSchema, TurnSchema } from "./common.js";

/** One round of a dialog: the scripted user turn and what the target answered. */
export const RoundSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  request: TurnSchema,
  response: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  tokens: TokensSchema.optional(),
  error: z.string().min(1).optional(),
  /** What the follow-up call added to the request, for example "mode: deep" (#84). */
  followUp: z.string().min(1).optional(),
});
export type Round = z.infer<typeof RoundSchema>;

/**
 * One execution of one case. A single answer case is one call; a dialog case runs its user
 * turns as rounds and `response` is the last answer. `response` is null when a call failed.
 */
export const IterationSchema = z.strictObject({
  runId: IdSchema,
  caseId: IdSchema,
  index: z.number().int().nonnegative(),
  seed: z.number().int().nonnegative(),
  request: z.array(TurnSchema).min(1),
  response: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  tokens: TokensSchema.optional(),
  /** Short error kind such as `timeout` or `http 500`. */
  error: z.string().min(1).optional(),
  /** HTTP status of the final call, when the adapter reports one (issue #79). */
  status: z.number().int().optional(),
  /** The rounds of a dialog, in order. Absent for single answer cases. */
  rounds: z.array(RoundSchema).optional(),
});
export type Iteration = z.infer<typeof IterationSchema>;
