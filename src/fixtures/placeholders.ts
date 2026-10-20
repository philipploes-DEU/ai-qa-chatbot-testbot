import { type BindingFile, fillFixtures, fixtureNames } from "../domain/fixtures.js";
import { fixtureTexts } from "../domain/goldset.js";
import type { TestCase } from "../domain/test-case.js";
import { boundValues } from "./resolve.js";

/** The placeholders {{fixtures.name}} a case uses, in order, each once (ADR 0022). */
export function placeholdersOf(testCase: TestCase): string[] {
  const names: string[] = [];
  for (const { text } of fixtureTexts(testCase)) {
    for (const name of fixtureNames(text)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

function fill(testCase: TestCase, values: ReadonlyMap<string, string>): TestCase {
  const text = (value: string): string => fillFixtures(value, values);
  const { expected } = testCase;
  return {
    ...testCase,
    input:
      typeof testCase.input === "string"
        ? text(testCase.input)
        : testCase.input.map((turn) => ({ ...turn, content: text(turn.content) })),
    expected: {
      ...expected,
      mustContain: expected.mustContain.map(text),
      mustNotContain: expected.mustNotContain.map(text),
      mustNotClaim: expected.mustNotClaim.map(text),
      ...(expected.answer !== undefined ? { answer: text(expected.answer) } : {}),
    },
    rubric: testCase.rubric.map((criterion) => ({
      ...criterion,
      description: text(criterion.description),
    })),
    ...(testCase.vars !== undefined
      ? {
          vars: Object.fromEntries(
            Object.entries(testCase.vars).map(([name, value]) => [name, text(value)]),
          ),
        }
      : {}),
  };
}

export interface BoundCases {
  /** Every case that can be sent, with its placeholders filled. */
  cases: Map<string, TestCase>;
  /** Cases with a placeholder without value, by id, with those placeholders. */
  unresolved: Map<string, string[]>;
}

/**
 * The substitution layer of ADR 0022: fills the bound values into the cases before run, checks
 * and judge see them. A case with a placeholder without value is not sent.
 */
export function bindCases(
  cases: readonly TestCase[],
  values: ReadonlyMap<string, string>,
): BoundCases {
  const bound = new Map<string, TestCase>();
  const unresolved = new Map<string, string[]>();
  for (const testCase of cases) {
    const names = placeholdersOf(testCase);
    if (names.length === 0) {
      bound.set(testCase.id, testCase);
      continue;
    }
    const missing = names.filter((name) => !values.has(name));
    if (missing.length > 0) unresolved.set(testCase.id, missing);
    else bound.set(testCase.id, fill(testCase, values));
  }
  return { cases: bound, unresolved };
}

/**
 * The cases of a stored run with the binding that run used, for aiqa judge --run and the like
 * (ADR 0022). Cases with a placeholder without value, or every case with placeholders when the
 * run has no binding, are skipped: a judge must never see {{fixtures.name}} instead of a value.
 */
export function bindForRun(
  cases: ReadonlyMap<string, TestCase>,
  binding: BindingFile | null,
): { cases: Map<string, TestCase>; skipped: string[] } {
  const values = binding === null ? new Map<string, string>() : boundValues(binding);
  const bound = bindCases([...cases.values()], values);
  return { cases: bound.cases, skipped: [...bound.unresolved.keys()] };
}

/** Two runs bound every placeholder of the case to the same value, so their answers compare. */
export function sameBoundValues(
  testCase: TestCase,
  a: BindingFile | null,
  b: BindingFile | null,
): boolean {
  const names = placeholdersOf(testCase);
  if (names.length === 0) return true;
  if (a === null || b === null) return false;
  const first = boundValues(a);
  const second = boundValues(b);
  return names.every((name) => first.has(name) && first.get(name) === second.get(name));
}
