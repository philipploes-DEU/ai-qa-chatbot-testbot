import { z } from "zod";

import { slugify } from "../agents/planning-agent.js";
import { SeveritySchema, type Severity } from "../domain/common.js";
import { type Goldset, GoldsetSchema } from "../domain/goldset.js";
import type { ProbeVariables } from "../domain/probe-catalog.js";
import type {
  PromptfooCaseTemplate,
  PromptfooCaseTemplates,
} from "../domain/promptfoo-case-templates.js";
import type { PromptfooMapping } from "../domain/promptfoo-mapping.js";
import { type TestCase, TestCaseSchema } from "../domain/test-case.js";
import { matchRule, PromptfooImportError } from "./promptfoo.js";

const TestSchema = z.looseObject({
  vars: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

const RedteamFileSchema = z.looseObject({
  redteam: z.looseObject({ injectVar: z.string().min(1).nullish() }).nullish(),
  tests: z.array(TestSchema),
});

export interface PromptfooCasesOptions {
  goldsetId: string;
  name: string;
  mapping: PromptfooMapping;
  templates: PromptfooCaseTemplates;
  /** probes.variables of aiqa.yaml, for placeholders like {{systemPromptMarker}}. */
  variables: ProbeVariables;
}

export interface PromptfooCases {
  goldset: Goldset;
  /** Entries of iterative strategies, copies of a seed prompt already taken over. */
  skippedIterative: number;
  /** Plugin ids without template; their attacks are not taken over. */
  withoutTemplate: string[];
  /** Variables a template needs and aiqa.yaml does not provide; those checks are left out. */
  missingVariables: string[];
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

function matches(pattern: string, id: string): boolean {
  return pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Fills placeholders; null when a variable is missing, which is recorded. */
function fill(value: string, variables: ProbeVariables, missing: Set<string>): string | null {
  const absent = [...value.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .filter((name) => (variables[name] ?? "").length === 0);
  if (absent.length > 0) {
    for (const name of absent) missing.add(name);
    return null;
  }
  return value.replace(PLACEHOLDER, (_match, name: string) => variables[name] ?? "");
}

function fillAll(values: readonly string[], variables: ProbeVariables, missing: Set<string>) {
  return values
    .map((value) => fill(value, variables, missing))
    .filter((value): value is string => value !== null);
}

function expectedFrom(
  template: PromptfooCaseTemplate,
  variables: ProbeVariables,
  missing: Set<string>,
): TestCase["expected"] {
  return {
    mustContain: fillAll(template.expected.mustContain, variables, missing),
    mustNotContain: fillAll(template.expected.mustNotContain, variables, missing),
    mustNotClaim: [],
    mustMatch: [],
    mustNotMatch: [],
    ...(template.expected.refusal === undefined ? {} : { refusal: template.expected.refusal }),
  };
}

/**
 * Turns the attacks promptfoo generated (`promptfoo redteam generate`, redteam.yaml) into
 * draft probe cases with expectation and rubric from a template per plugin (issue #58,
 * ADR 0013). A human reviews the drafts before they count (ADR 0010).
 */
export function importPromptfooCases(
  data: unknown,
  options: PromptfooCasesOptions,
): PromptfooCases {
  const parsed = RedteamFileSchema.safeParse(data);
  if (!parsed.success) {
    throw new PromptfooImportError(
      "Keine promptfoo-Angriffsdatei: es fehlt die Liste tests. Erwartet wird die redteam.yaml von promptfoo redteam generate.",
    );
  }
  const injectVar = parsed.data.redteam?.injectVar ?? "prompt";
  const missing = new Set<string>();
  const withoutTemplate = new Set<string>();
  const seen = new Set<string>();
  const perPlugin = new Map<string, number>();
  const cases: TestCase[] = [];
  let skippedIterative = 0;

  for (const test of parsed.data.tests) {
    const pluginId = text(test.metadata?.pluginId);
    if (pluginId === undefined) continue;
    const strategyId = text(test.metadata?.strategyId);
    if (
      strategyId !== undefined &&
      options.templates.iterativeStrategies.some((pattern) => matches(pattern, strategyId))
    ) {
      skippedIterative += 1;
      continue;
    }
    const template = options.templates.templates.find((entry) => matches(entry.pattern, pluginId));
    if (template === undefined) {
      withoutTemplate.add(pluginId);
      continue;
    }
    const vars = test.vars ?? {};
    const raw = text(vars[injectVar]) ?? Object.values(vars).map(text).find(Boolean);
    if (raw === undefined) continue;
    // Small attacker models put a label before the attack; it is not part of it.
    const input = raw.replace(/^prompt:\s*/i, "");
    const key = `${pluginId}\u0000${strategyId ?? ""}\u0000${input}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ordinal = perPlugin.get(pluginId) ?? 0;
    perPlugin.set(pluginId, ordinal + 1);
    const severity = SeveritySchema.safeParse(test.metadata?.severity);
    const source =
      matchRule(options.mapping.plugins, pluginId) ??
      (strategyId === undefined ? undefined : matchRule(options.mapping.strategies, strategyId));
    cases.push(
      TestCaseSchema.parse({
        id: slugify(`pf-${pluginId}-${String(ordinal)}`),
        kind: "probe",
        input,
        expected: expectedFrom(template, options.variables, missing),
        rubric: template.rubric,
        tags: [pluginId, strategyId].filter((tag) => tag !== undefined),
        severity: severity.success ? severity.data : ("medium" satisfies Severity),
        ...(source === undefined ? {} : { source }),
        status: "draft",
      }),
    );
  }

  if (cases.length === 0) {
    throw new PromptfooImportError(
      `Die Datei enthält keinen Angriff, für den es eine Vorlage gibt.${withoutTemplate.size > 0 ? ` Ohne Vorlage: ${[...withoutTemplate].sort().join(", ")}.` : ""}`,
    );
  }

  return {
    goldset: GoldsetSchema.parse({
      id: options.goldsetId,
      name: options.name,
      version: "1",
      owner: "promptfoo-Import, Prüfung offen",
      cases,
    }),
    skippedIterative,
    withoutTemplate: [...withoutTemplate].sort(),
    missingVariables: [...missing].sort(),
  };
}
