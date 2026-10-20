import { z } from "zod";

import { CalibrationSetSchema } from "./calibration.js";
import { IdSchema, TimestampSchema, VersionSchema } from "./common.js";
import { fixtureNames, GoldsetFixturesSchema } from "./fixtures.js";
import { addDuplicateIssues } from "./refinements.js";
import { type TestCase, TestCaseSchema } from "./test-case.js";

/** Texts of a case where {{fixtures.name}} may stand (ADR 0022), with their path. */
export function fixtureTexts(testCase: TestCase): { path: (string | number)[]; text: string }[] {
  const texts: { path: (string | number)[]; text: string }[] = [];
  if (typeof testCase.input === "string") texts.push({ path: ["input"], text: testCase.input });
  else
    testCase.input.forEach((turn, index) =>
      texts.push({ path: ["input", index, "content"], text: turn.content }),
    );
  const { expected } = testCase;
  if (expected.answer !== undefined)
    texts.push({ path: ["expected", "answer"], text: expected.answer });
  for (const key of ["mustContain", "mustNotContain", "mustNotClaim"] as const) {
    expected[key].forEach((text, index) => texts.push({ path: ["expected", key, index], text }));
  }
  testCase.rubric.forEach((criterion, index) =>
    texts.push({ path: ["rubric", index, "description"], text: criterion.description }),
  );
  for (const [name, text] of Object.entries(testCase.vars ?? {})) {
    texts.push({ path: ["vars", name], text });
  }
  return texts;
}

/** Texts where a value would act as a pattern, so placeholders are not allowed (ADR 0022). */
function patternTexts(testCase: TestCase): { path: (string | number)[]; text: string }[] {
  const { expected } = testCase;
  return [
    ...expected.mustMatch.map((text, index) => ({ path: ["expected", "mustMatch", index], text })),
    ...expected.mustNotMatch.map((text, index) => ({
      path: ["expected", "mustNotMatch", index],
      text,
    })),
    ...(expected.schema === undefined
      ? []
      : [{ path: ["expected", "schema"], text: JSON.stringify(expected.schema) }]),
  ];
}

export const GoldsetSchema = z
  .strictObject({
    id: IdSchema,
    name: z.string().min(1),
    version: VersionSchema.default("1"),
    cases: z.array(TestCaseSchema).min(1),
    owner: z.string().min(1),
    approvedAt: TimestampSchema.optional(),
    /** Human labelled answers the judge is checked against before it rates this goldset. */
    calibration: CalibrationSetSchema.optional(),
    /**
     * Source documents for the judge, paths relative to the goldset file, for example the
     * knowledge base of the target. The judge checks claims beyond the reference against them
     * (issue #70, ADR 0016).
     */
    sources: z.array(z.string().min(1)).min(1).optional(),
    /**
     * Placeholders {{fixtures.name}} of the cases with the condition they stand for, in the
     * words of the domain (issue #93, ADR 0022). Values come from aiqa resolve.
     */
    fixtures: GoldsetFixturesSchema.optional(),
    /**
     * Areas deliberately not tested, one sentence each, for the handover report (issue #87).
     */
    outOfScope: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((goldset, ctx) => {
    addDuplicateIssues(
      goldset.cases.map((testCase) => testCase.id),
      ["cases"],
      "id",
      ctx,
      "Fall-ID",
    );
    const declared = new Set(Object.keys(goldset.fixtures ?? {}));
    goldset.cases.forEach((testCase, caseIndex) => {
      for (const { path, text } of fixtureTexts(testCase)) {
        for (const name of new Set(fixtureNames(text))) {
          if (declared.has(name)) continue;
          ctx.addIssue({
            code: "custom",
            path: ["cases", caseIndex, ...path],
            message: `{{fixtures.${name}}} ist im Goldset unter fixtures nicht deklariert`,
          });
        }
      }
      // Anything that looks like a placeholder but is not a filled one: wrong field or typo.
      const filled = [...fixtureTexts(testCase), ...patternTexts(testCase)].reduce(
        (sum, { text }) => sum + fixtureNames(text).length,
        0,
      );
      // "{{ fixtures }}" without a dot is ordinary text, for example a template question.
      const looks = JSON.stringify(testCase).match(/\{\{\s*fixtures\s*\./g)?.length ?? 0;
      if (looks > filled) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", caseIndex],
          message:
            "ein Platzhalter {{fixtures...}} steht außerhalb der Felder, die AI QA ersetzt, oder ist nicht lesbar. Erlaubt sind input, expected.answer, mustContain, mustNotContain, mustNotClaim, Rubrik und vars, als {{fixtures.name}}",
        });
      }
      for (const { path, text } of patternTexts(testCase)) {
        if (fixtureNames(text).length === 0) continue;
        ctx.addIssue({
          code: "custom",
          path: ["cases", caseIndex, ...path],
          message:
            "Platzhalter sind in mustMatch, mustNotMatch und schema nicht erlaubt, ein Wert würde dort als Muster wirken",
        });
      }
    });
    const ids = new Set(goldset.cases.map((testCase) => testCase.id));
    const withPlaceholders = new Set(
      goldset.cases
        .filter((testCase) =>
          fixtureTexts(testCase).some(({ text }) => fixtureNames(text).length > 0),
        )
        .map((testCase) => testCase.id),
    );
    goldset.calibration?.samples.forEach((sample, index) => {
      if (withPlaceholders.has(sample.caseId)) {
        ctx.addIssue({
          code: "custom",
          path: ["calibration", "samples", index, "caseId"],
          message: `Kalibrierung braucht Fälle mit festen Werten: ${sample.caseId} nutzt Platzhalter {{fixtures.name}}, die gelabelte Antwort gehört zu einem bestimmten Datenstand`,
        });
      }
      if (!ids.has(sample.caseId)) {
        ctx.addIssue({
          code: "custom",
          path: ["calibration", "samples", index, "caseId"],
          message: `Kalibrierungsstichprobe verweist auf den unbekannten Fall "${sample.caseId}"`,
        });
      }
    });
  });
export type Goldset = z.infer<typeof GoldsetSchema>;
export type GoldsetInput = z.input<typeof GoldsetSchema>;
