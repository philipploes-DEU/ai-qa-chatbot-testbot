import { z } from "zod";

import { IdSchema, TimestampSchema, VersionSchema } from "./common.js";
import { AuthSchema } from "./target-config.js";

/** Name of a placeholder, usable as {{fixtures.name}} (issue #93, ADR 0022). */
export const FixtureNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Namen für fixtures bestehen aus Buchstaben, Ziffern und _");

const PLACEHOLDER = /\{\{\s*fixtures\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** The placeholders {{fixtures.name}} in a text, in order, with repeats. */
export function fixtureNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** Replaces every {{fixtures.name}} with its value; unknown names stay as they are. */
export function fillFixtures(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => values.get(name) ?? whole);
}

/** What a placeholder stands for, in the words of the domain: the intent of the case. */
export const FixtureDeclarationSchema = z.strictObject({ condition: z.string().min(1) });
export const GoldsetFixturesSchema = z.record(FixtureNameSchema, FixtureDeclarationSchema);

const TimeoutSchema = z.number().int().positive().default(30000);

/** A file with rows, JSON or YAML, relative to aiqa.yaml. */
const FileSourceSchema = z.strictObject({
  type: z.literal("file"),
  path: z.string().min(1),
  /** List of the fields of the source, JSON or YAML, for aiqa validate (ADR 0022). */
  mapping: z.string().min(1).optional(),
});

/** An HTTP API such as Elastic or Solr. Credentials only through auth with ${NAME}. */
const HttpSourceSchema = z.strictObject({
  type: z.literal("http"),
  endpoint: z.string().min(1),
  auth: AuthSchema.optional(),
  headers: z.record(z.string(), z.string()).default({}),
  timeoutMs: TimeoutSchema,
  /** List of the fields of the source, JSON or YAML, for aiqa validate (ADR 0022). */
  mapping: z.string().min(1).optional(),
});

/** A local command, without a shell, that prints JSON; for SQL and everything else. */
const ScriptSourceSchema = z.strictObject({
  type: z.literal("script"),
  command: z.array(z.string().min(1)).min(1),
  timeoutMs: TimeoutSchema,
  /** List of the fields of the source, JSON or YAML, for aiqa validate (ADR 0022). */
  mapping: z.string().min(1).optional(),
});

export const FixtureSourceSchema = z.discriminatedUnion("type", [
  FileSourceSchema,
  HttpSourceSchema,
  ScriptSourceSchema,
]);
export type FixtureSource = z.infer<typeof FixtureSourceSchema>;

/** A stored, versioned query that a human approved. It never comes from a run. */
export const StoredQuerySchema = z.strictObject({
  source: IdSchema,
  version: VersionSchema,
  approvedBy: z.string().min(1).optional(),
  approvedAt: z.string().min(1).optional(),
  /** For http sources: the request; path is appended to the endpoint. */
  request: z
    .strictObject({
      method: z.enum(["GET", "POST"]).default("POST"),
      path: z.string().min(1).optional(),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().optional(),
    })
    .optional(),
  /** For script sources: arguments after the command. */
  args: z.array(z.string()).default([]),
  /** Where the rows are, for example $.hits.hits[*]._source. Its order must be fixed. */
  rows: z.string().min(1).default("$"),
});
export type StoredQuery = z.infer<typeof StoredQuerySchema>;

/** Which value a placeholder takes: field of a row of a query. */
export const FixtureBindingSchema = z.strictObject({
  query: IdSchema,
  row: z.number().int().nonnegative().default(0),
  field: z.string().min(1),
});

/** Block fixtures of aiqa.yaml: sources, stored queries and bindings (ADR 0022). */
export const FixturesConfigSchema = z
  .strictObject({
    sources: z.record(IdSchema, FixtureSourceSchema),
    queries: z.record(IdSchema, StoredQuerySchema).default({}),
    bindings: z.record(FixtureNameSchema, FixtureBindingSchema).default({}),
  })
  .superRefine((config, ctx) => {
    for (const [id, query] of Object.entries(config.queries)) {
      if (!(query.source in config.sources)) {
        ctx.addIssue({
          code: "custom",
          path: ["queries", id, "source"],
          message: `unbekannte Quelle "${query.source}"`,
        });
      }
    }
    for (const [name, binding] of Object.entries(config.bindings)) {
      if (!(binding.query in config.queries)) {
        ctx.addIssue({
          code: "custom",
          path: ["bindings", name, "query"],
          message: `unbekannte Abfrage "${binding.query}"`,
        });
      }
    }
  });
export type FixturesConfig = z.infer<typeof FixturesConfigSchema>;

/** One placeholder in a binding: its value or why it has none. */
export const BindingEntrySchema = z.strictObject({
  placeholder: FixtureNameSchema,
  query: IdSchema.optional(),
  queryVersion: VersionSchema.optional(),
  source: IdSchema.optional(),
  status: z.enum(["bound", "unresolved"]),
  value: z.string().optional(),
  reason: z.string().min(1).optional(),
  /** The value in the run before against the same target, in the record of a run. */
  previous: z.string().optional(),
});
export type BindingEntry = z.infer<typeof BindingEntrySchema>;

/** Written by aiqa resolve and copied into every run that uses it. */
export const BindingFileSchema = z.strictObject({
  createdAt: TimestampSchema,
  target: z.string().min(1),
  entries: z.array(BindingEntrySchema),
});
export type BindingFile = z.infer<typeof BindingFileSchema>;
