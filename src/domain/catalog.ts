import { z } from "zod";

import { IdSchema, VersionSchema } from "./common.js";
import { addDuplicateIssues } from "./refinements.js";

/** Upper case ids like LLM01 or AITG-APP-01. */
export const CatalogEntryIdSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9-]*[A-Z0-9]$/,
    "Katalog-IDs sind Großbuchstaben mit Ziffern und Bindestrich, zum Beispiel LLM01 oder AITG-APP-01",
  );

export const CatalogEntrySchema = z.strictObject({
  id: CatalogEntryIdSchema,
  source: z.string().min(1),
  name: z.string().min(1),
  /** Risk in our own words. */
  summary: z.string().min(1).optional(),
  /** How the risk can be tested against a black box. */
  approach: z.string().min(1).optional(),
  /** Names of checks or judge criteria that detect the risk. */
  detectors: z.array(z.string().min(1)).default([]),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z
  .strictObject({
    id: IdSchema,
    name: z.string().min(1),
    version: VersionSchema,
    source: z.string().min(1),
    url: z.url().optional(),
    license: z.string().min(1).optional(),
    entries: z.array(CatalogEntrySchema).min(1),
  })
  .superRefine((catalog, ctx) => {
    addDuplicateIssues(
      catalog.entries.map((entry) => entry.id),
      ["entries"],
      "id",
      ctx,
      "Katalogeintrag-ID",
    );
  });
export type Catalog = z.infer<typeof CatalogSchema>;
