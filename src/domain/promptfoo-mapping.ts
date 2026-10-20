import { z } from "zod";

import { CatalogEntryIdSchema } from "./catalog.js";
import { IdSchema, VersionSchema } from "./common.js";

/** A promptfoo plugin or strategy id, exact or as prefix with a trailing `*`. */
export const PromptfooRuleSchema = z.strictObject({
  pattern: z.string().min(1),
  owasp: CatalogEntryIdSchema,
});
export type PromptfooRule = z.infer<typeof PromptfooRuleSchema>;

/** Which OWASP id an imported promptfoo result belongs to (ADR 0008). Data, not code. */
export const PromptfooMappingSchema = z.strictObject({
  id: IdSchema,
  version: VersionSchema,
  /** promptfoo version whose plugin ids the mapping reflects. */
  promptfooVersion: VersionSchema,
  source: z.string().min(1),
  license: z.string().min(1).optional(),
  plugins: z.array(PromptfooRuleSchema).min(1),
  /** Used for plugins without an own rule, for example jailbreak strategies on LLM01. */
  strategies: z.array(PromptfooRuleSchema).default([]),
});
export type PromptfooMapping = z.infer<typeof PromptfooMappingSchema>;
