import { z } from "zod";

import { slugify } from "../agents/planning-agent.js";
import { SeveritySchema, type Severity } from "../domain/common.js";
import { type Goldset, GoldsetSchema } from "../domain/goldset.js";
import type { Iteration } from "../domain/iteration.js";
import type { PromptfooMapping, PromptfooRule } from "../domain/promptfoo-mapping.js";
import type { Run } from "../domain/run.js";
import { type TestCase, TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";

/** The file is not a promptfoo result or holds nothing to import. */
export class PromptfooImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptfooImportError";
  }
}

// Only the fields the import reads. Everything else, config and shareableUrl included, is
// ignored on purpose: config carries values that are only partly redacted (ADR 0008).
const ComponentSchema = z.looseObject({
  pass: z.boolean(),
  reason: z.string().nullish(),
  assertion: z.looseObject({ type: z.string().min(1) }).nullish(),
});

const RowSchema = z.looseObject({
  testIdx: z.number().int().nonnegative().optional(),
  vars: z.record(z.string(), z.unknown()).nullish(),
  prompt: z.looseObject({ raw: z.string().nullish() }).nullish(),
  provider: z.looseObject({ id: z.string().nullish() }).nullish(),
  response: z
    .looseObject({
      output: z.unknown().optional(),
      error: z.string().nullish(),
      tokenUsage: z
        .looseObject({ prompt: z.number().nullish(), completion: z.number().nullish() })
        .nullish(),
    })
    .nullish(),
  error: z.string().nullish(),
  success: z.boolean(),
  latencyMs: z.number().nonnegative().nullish(),
  gradingResult: z
    .looseObject({
      pass: z.boolean(),
      reason: z.string().nullish(),
      componentResults: z.array(ComponentSchema).nullish(),
    })
    .nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
type Row = z.infer<typeof RowSchema>;

const ResultFileSchema = z.looseObject({
  evalId: z.string().min(1),
  results: z.looseObject({
    timestamp: z.string().nullish(),
    results: z.array(RowSchema),
  }),
});

export interface PromptfooImportOptions {
  runId: string;
  target: string;
  mapping: PromptfooMapping;
  /** Start of the run when the file carries no timestamp. */
  now: Date;
  /** The provider to import when the file compares several; required then. */
  provider?: string;
}

export interface PromptfooImport {
  run: Run;
  iterations: Iteration[];
  verdicts: Verdict[];
  goldset: Goldset;
  /** Plugin ids without an OWASP rule; their cases have no source. */
  unknownPlugins: string[];
}

/** The OWASP id of the first rule that matches: exact name, or prefix before a trailing `*`. */
export function matchRule(rules: readonly PromptfooRule[], id: string): string | undefined {
  return rules.find((rule) =>
    rule.pattern.endsWith("*") ? id.startsWith(rule.pattern.slice(0, -1)) : id === rule.pattern,
  )?.owasp;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requestText(row: Row): string {
  return text(row.prompt?.raw) ?? JSON.stringify(row.vars ?? {});
}

function responseText(row: Row): string | null {
  if (row.response === undefined || row.response === null) return null;
  const output = row.response.output;
  if (output === undefined || output === null) return null;
  return typeof output === "string" ? output : JSON.stringify(output);
}

function errorOf(row: Row): string | undefined {
  const message = text(row.response?.error) ?? text(row.error);
  return message === undefined ? undefined : message.slice(0, 200);
}

function severityOf(row: Row): Severity {
  const parsed = SeveritySchema.safeParse(row.metadata?.severity);
  return parsed.success ? parsed.data : "medium";
}

function timestamp(value: string | null | undefined, fallback: Date): string {
  const parsed = value === undefined || value === null ? Number.NaN : Date.parse(value);
  return new Date(Number.isNaN(parsed) ? fallback.getTime() : parsed).toISOString();
}

function verdictsFor(row: Row, base: Pick<Verdict, "runId" | "caseId" | "index">): Verdict[] {
  const check = (name: string, pass: boolean, reason: string): Verdict => ({
    ...base,
    source: "check",
    pass,
    criteria: [{ name, pass, reason }],
    reasoning: `${name}: ${reason}`,
  });
  const error = errorOf(row);
  if (responseText(row) === null) {
    return [check("response", false, error ?? "keine Antwort in der promptfoo-Datei")];
  }
  const components = row.gradingResult?.componentResults ?? [];
  if (components.length > 0) {
    return components.map((component) =>
      check(
        `promptfoo:${component.assertion?.type ?? "assertion"}`,
        component.pass,
        component.reason ?? "",
      ),
    );
  }
  return [check("promptfoo:result", row.success, row.gradingResult?.reason ?? "")];
}

/**
 * Turns a promptfoo result file (`promptfoo eval --output`) into a run of AI QA: one
 * iteration per row, one check verdict per assertion, one case per plugin and input in a
 * generated goldset (ADR 0008). The verdicts are promptfoo's; AI QA only counts them.
 */
export function importPromptfoo(data: unknown, options: PromptfooImportOptions): PromptfooImport {
  const parsed = ResultFileSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PromptfooImportError(
      `Keine promptfoo-Ergebnisdatei: ${issue === undefined ? "unbekannter Aufbau" : `${issue.path.map(String).join(".") || "(Wurzel)"}: ${issue.message}`}. Erwartet wird die Ausgabe von promptfoo eval --output ergebnis.json.`,
    );
  }
  const file = parsed.data;
  if (file.results.results.length === 0) {
    throw new PromptfooImportError(
      "Die promptfoo-Datei enthält keine Ergebnisse. Schreibt promptfoo ohne Datenbank (--no-write), bleibt die Liste leer.",
    );
  }

  // A run has one target: a file that compares providers is imported one provider at a time.
  const providers = [
    ...new Set(file.results.results.map((row) => text(row.provider?.id) ?? "unbekannt")),
  ];
  if (options.provider !== undefined && !providers.includes(options.provider)) {
    throw new PromptfooImportError(
      `Provider ${options.provider} kommt in der Datei nicht vor. Enthalten: ${providers.join(", ")}.`,
    );
  }
  if (options.provider === undefined && providers.length > 1) {
    throw new PromptfooImportError(
      `Die Datei vergleicht mehrere Zielsysteme: ${providers.join(", ")}. Wähle eines mit --provider.`,
    );
  }
  const rows = file.results.results.filter(
    (row) =>
      options.provider === undefined ||
      (text(row.provider?.id) ?? "unbekannt") === options.provider,
  );

  const goldsetId = slugify(`promptfoo-${file.evalId}`);
  const cases = new Map<string, TestCase>();
  // promptfoo gives every repetition its own testIdx. The same plugin with the same input is
  // one case of AI QA, its repetitions are iterations (measured with promptfoo 0.120.0).
  const caseIds = new Map<string, string>();
  const perPlugin = new Map<string, number>();
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  const iterations: Iteration[] = [];
  const verdicts: Verdict[] = [];

  for (const row of rows) {
    const pluginId = text(row.metadata?.pluginId);
    const strategyId = text(row.metadata?.strategyId);
    const group = pluginId ?? "test";
    const key = `${group}\u0000${strategyId ?? ""}\u0000${requestText(row)}`;
    let caseId = caseIds.get(key);
    if (caseId === undefined) {
      const ordinal = perPlugin.get(group) ?? 0;
      perPlugin.set(group, ordinal + 1);
      caseId = slugify(`pf-${group}-${String(ordinal)}`);
      caseIds.set(key, caseId);
    }
    const index = counts.get(caseId) ?? 0;
    counts.set(caseId, index + 1);

    if (!cases.has(caseId)) {
      const source =
        pluginId === undefined
          ? undefined
          : (matchRule(options.mapping.plugins, pluginId) ??
            (strategyId === undefined
              ? undefined
              : matchRule(options.mapping.strategies, strategyId)));
      if (pluginId !== undefined && source === undefined) unknown.add(pluginId);
      cases.set(
        caseId,
        TestCaseSchema.parse({
          id: caseId,
          kind: pluginId === undefined ? "qa" : "probe",
          input: requestText(row),
          severity: severityOf(row),
          tags: [pluginId, strategyId].filter((tag) => tag !== undefined),
          ...(source === undefined ? {} : { source }),
          status: "approved",
        }),
      );
    }

    const response = responseText(row);
    const error = errorOf(row);
    const usage = row.response?.tokenUsage;
    iterations.push({
      runId: options.runId,
      caseId,
      index,
      seed: index,
      request: [{ role: "user", content: requestText(row) }],
      response,
      latencyMs: row.latencyMs ?? 0,
      ...(usage !== undefined && usage !== null
        ? {
            tokens: {
              input: Math.max(0, Math.round(usage.prompt ?? 0)),
              output: Math.max(0, Math.round(usage.completion ?? 0)),
            },
          }
        : {}),
      ...(response === null ? { error: error ?? "keine Antwort" } : {}),
    });
    verdicts.push(...verdictsFor(row, { runId: options.runId, caseId, index }));
  }

  const startedAt = timestamp(file.results.timestamp, options.now);
  const model = rows.map((row) => text(row.provider?.id)).find(Boolean);
  const goldset = GoldsetSchema.parse({
    id: goldsetId,
    name: `promptfoo ${file.evalId}`,
    version: "1",
    owner: "promptfoo-Import",
    cases: [...cases.values()],
  });

  return {
    run: {
      id: options.runId,
      planId: goldsetId,
      target: options.target,
      startedAt,
      finishedAt: startedAt,
      ...(model === undefined ? {} : { model }),
      goldsets: [{ id: goldset.id, version: goldset.version }],
      warnings: [
        `Importiert aus promptfoo (evalId ${file.evalId}). Die Urteile stammen von promptfoo, nicht von AI QA.`,
      ],
      status: "completed",
    },
    iterations,
    verdicts,
    goldset,
    unknownPlugins: [...unknown].sort(),
  };
}
