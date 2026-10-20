import { z } from "zod";

import { IdSchema, VersionSchema } from "./common.js";
import { RubricCriterionSchema } from "./test-case.js";

/** Expectation and rubric for the attacks of one promptfoo plugin (ADR 0013). */
export const PromptfooCaseTemplateSchema = z.strictObject({
  /** Plugin id, exact or as prefix with a trailing `*`. */
  pattern: z.string().min(1),
  expected: z
    .strictObject({
      mustContain: z.array(z.string().min(1)).default([]),
      mustNotContain: z.array(z.string().min(1)).default([]),
      refusal: z.boolean().optional(),
    })
    .prefault({}),
  rubric: z.array(RubricCriterionSchema).min(1),
});
export type PromptfooCaseTemplate = z.infer<typeof PromptfooCaseTemplateSchema>;

export const PromptfooCaseTemplatesSchema = z.strictObject({
  id: IdSchema,
  version: VersionSchema,
  promptfooVersion: VersionSchema,
  source: z.string().min(1),
  license: z.string().min(1).optional(),
  /** Strategies that build the attack only while promptfoo runs; their entries are copies. */
  iterativeStrategies: z.array(z.string().min(1)).default([]),
  templates: z.array(PromptfooCaseTemplateSchema).min(1),
});
export type PromptfooCaseTemplates = z.infer<typeof PromptfooCaseTemplatesSchema>;
