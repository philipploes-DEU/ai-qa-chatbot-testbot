import { z } from "zod";

import { IdSchema } from "./common.js";

const SelectorSchema = z.string().min(1);

/** Preparation steps before the first turn: cookie banners, login, topic selection. */
export const SpecStepSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("click"), selector: SelectorSchema }),
  z.strictObject({ action: z.literal("fill"), selector: SelectorSchema, value: z.string() }),
  z.strictObject({
    action: z.literal("waitFor"),
    selector: SelectorSchema,
    state: z.enum(["visible", "hidden", "attached"]).default("visible"),
  }),
  z.strictObject({ action: z.literal("goto"), url: z.url() }),
  z.strictObject({
    action: z.literal("press"),
    key: z.string().min(1),
    selector: SelectorSchema.optional(),
  }),
]);
export type SpecStep = z.infer<typeof SpecStepSchema>;

export const SendActionSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("enter") }),
  z.strictObject({ method: z.literal("click"), selector: SelectorSchema }),
]);
export type SendAction = z.infer<typeof SendActionSchema>;

/** When an answer counts as complete. */
export const WaitConditionSchema = z.discriminatedUnion("type", [
  /** The last answer element did not change for `forMs` milliseconds. */
  z.strictObject({ type: z.literal("stable"), forMs: z.number().int().positive().default(1500) }),
  /** An element signals the end of streaming by becoming visible or hidden. */
  z.strictObject({
    type: z.literal("signal"),
    selector: SelectorSchema,
    state: z.enum(["visible", "hidden"]).default("hidden"),
  }),
]);
export type WaitCondition = z.infer<typeof WaitConditionSchema>;

/** How to start fresh between test cases. */
export const ResetActionSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("reload") }),
  z.strictObject({ method: z.literal("click"), selector: SelectorSchema }),
  z.strictObject({ method: z.literal("none") }),
]);
export type ResetAction = z.infer<typeof ResetActionSchema>;

/** Describes the user interface of one target for the playwright adapter (issue #13). */
export const PlaywrightSpecSchema = z.strictObject({
  name: IdSchema,
  input: z.strictObject({ selector: SelectorSchema }),
  send: SendActionSchema,
  response: z.strictObject({
    selector: SelectorSchema,
    wait: WaitConditionSchema,
  }),
  before: z.array(SpecStepSchema).default([]),
  reset: ResetActionSchema.prefault({ method: "reload" }),
});
export type PlaywrightSpec = z.infer<typeof PlaywrightSpecSchema>;
