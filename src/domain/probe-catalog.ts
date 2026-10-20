import { z } from "zod";

import { CatalogEntryIdSchema } from "./catalog.js";
import { IdSchema, SeveritySchema, VersionSchema } from "./common.js";
import { addDuplicateIssues } from "./refinements.js";
import { ExpectedSchema, RubricCriterionSchema } from "./test-case.js";

/**
 * A test pattern from a probe catalog: an input template plus the detectors that decide the
 * outcome. Materialised into probe cases with the variables of a workspace (issue #7).
 */
export const ProbePatternSchema = z.strictObject({
  /** Pattern id, for example LLM01-P01. */
  id: CatalogEntryIdSchema,
  /** Catalog entries the pattern tests, for example LLM01 and AITG-APP-01. */
  references: z.array(CatalogEntryIdSchema).min(1),
  name: z.string().min(1),
  /** What the pattern tries, in our own words. */
  description: z.string().min(1),
  /** Input with {{variable}} placeholders filled from the workspace. */
  input: z.string().min(1),
  /** Deterministic detectors, same fields as a case; placeholders allowed in the strings. */
  expected: ExpectedSchema.prefault({}),
  /** Judge criteria for what the detectors cannot decide. */
  rubric: z.array(RubricCriterionSchema).default([]),
  severity: SeveritySchema.default("high"),
  tags: z.array(z.string().min(1)).default([]),
});
export type ProbePattern = z.infer<typeof ProbePatternSchema>;

export const ProbeCatalogSchema = z
  .strictObject({
    id: IdSchema,
    name: z.string().min(1),
    version: VersionSchema,
    source: z.string().min(1),
    url: z.url().optional(),
    license: z.string().min(1).optional(),
    /** Variables the patterns use, with an explanation each. */
    variables: z.record(z.string().min(1), z.string().min(1)).default({}),
    patterns: z.array(ProbePatternSchema).min(1),
  })
  .superRefine((catalog, ctx) => {
    addDuplicateIssues(
      catalog.patterns.map((pattern) => pattern.id),
      ["patterns"],
      "id",
      ctx,
      "Muster-ID",
    );
  });
export type ProbeCatalog = z.infer<typeof ProbeCatalogSchema>;

/** Workspace values for the placeholders. A system prompt marker is a phrase, never the prompt. */
export const ProbeVariablesSchema = z.record(z.string().min(1), z.string());
export type ProbeVariables = z.infer<typeof ProbeVariablesSchema>;
