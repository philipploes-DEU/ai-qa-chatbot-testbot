import type { ProbeCatalog, ProbePattern, ProbeVariables } from "../domain/probe-catalog.js";
import { type TestCase, TestCaseSchema } from "../domain/test-case.js";

export interface SkippedPattern {
  id: string;
  /** Variables the pattern needs and the workspace did not provide. */
  missing: string[];
}

export interface MaterializedProbes {
  cases: TestCase[];
  skipped: SkippedPattern[];
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

/** Variable names a text refers to. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fill(text: string, variables: ProbeVariables, regex = false): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name] ?? "";
    return regex ? escapeRegExp(value) : value;
  });
}

/** Every text of a pattern that may carry placeholders. */
function textsOf(pattern: ProbePattern): string[] {
  return [
    pattern.input,
    ...pattern.expected.mustContain,
    ...pattern.expected.mustNotContain,
    ...pattern.expected.mustMatch,
    ...pattern.expected.mustNotMatch,
    ...(pattern.expected.answer === undefined ? [] : [pattern.expected.answer]),
    ...pattern.rubric.map((criterion) => criterion.description),
  ];
}

/**
 * Turns the patterns of a probe catalog into probe cases with the workspace's variables.
 * Patterns that need a variable the workspace does not provide are skipped and listed, so a
 * missing system prompt marker never produces a case that cannot fail.
 */
export function materializeProbes(
  catalog: ProbeCatalog,
  variables: ProbeVariables,
): MaterializedProbes {
  const cases: TestCase[] = [];
  const skipped: SkippedPattern[] = [];
  for (const pattern of catalog.patterns) {
    const needed = new Set(textsOf(pattern).flatMap(placeholdersIn));
    const missing = [...needed].filter(
      (name) => variables[name] === undefined || variables[name] === "",
    );
    if (missing.length > 0) {
      skipped.push({ id: pattern.id, missing: missing.sort() });
      continue;
    }
    cases.push(
      TestCaseSchema.parse({
        id: pattern.id,
        kind: "probe",
        input: fill(pattern.input, variables),
        expected: {
          mustContain: pattern.expected.mustContain.map((text) => fill(text, variables)),
          mustNotContain: pattern.expected.mustNotContain.map((text) => fill(text, variables)),
          mustMatch: pattern.expected.mustMatch.map((text) => fill(text, variables, true)),
          mustNotMatch: pattern.expected.mustNotMatch.map((text) => fill(text, variables, true)),
          ...(pattern.expected.schema !== undefined ? { schema: pattern.expected.schema } : {}),
          ...(pattern.expected.answer !== undefined
            ? { answer: fill(pattern.expected.answer, variables) }
            : {}),
          ...(pattern.expected.refusal !== undefined ? { refusal: pattern.expected.refusal } : {}),
        },
        rubric: pattern.rubric.map((criterion) => ({
          ...criterion,
          description: fill(criterion.description, variables),
        })),
        tags: pattern.tags,
        severity: pattern.severity,
        source: pattern.references.join(", "),
        version: catalog.version,
        status: "approved",
      }),
    );
  }
  return { cases, skipped };
}
