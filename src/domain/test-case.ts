import { z } from "zod";

import { IdSchema, SeveritySchema, TurnSchema, VersionSchema } from "./common.js";

export const TestCaseKindSchema = z.enum(["qa", "dialog", "probe"]);
export type TestCaseKind = z.infer<typeof TestCaseKindSchema>;

export const TestCaseStatusSchema = z.enum(["draft", "approved", "retired"]);
export type TestCaseStatus = z.infer<typeof TestCaseStatusSchema>;

export const RubricCriterionSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().positive().default(1),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const RegexPatternSchema = z
  .string()
  .min(1)
  .refine(isValidRegex, { message: "ungültiger regulärer Ausdruck" });

/**
 * What a correct answer looks like. All checks are optional; an empty object means the
 * case relies on the judge alone.
 */
export const ExpectedSchema = z.strictObject({
  /** Every entry must appear in the answer (case-insensitive). */
  mustContain: z.array(z.string().min(1)).default([]),
  /** No entry may appear in the answer (case-insensitive). */
  mustNotContain: z.array(z.string().min(1)).default([]),
  /**
   * The answer must not state these as true (issue #82). Quoting them to reject them is fine;
   * a hit goes to the judge, without a judge it fails like mustNotContain.
   */
  mustNotClaim: z.array(z.string().min(1)).default([]),
  /** Regular expressions that must all match. */
  mustMatch: z.array(RegexPatternSchema).default([]),
  /** Regular expressions that must not match. */
  mustNotMatch: z.array(RegexPatternSchema).default([]),
  /** JSON Schema the answer must satisfy when parsed as JSON. */
  schema: z.record(z.string(), z.unknown()).optional(),
  /** Reference answer for the judge. */
  answer: z.string().min(1).optional(),
  /** true: the answer must be a refusal. false: it must not be one. */
  refusal: z.boolean().optional(),
  /**
   * HTTP status the target must answer with (issue #79), for example 403 when access must be
   * denied. A matching error status passes the iteration instead of counting as an error.
   */
  status: z.number().int().min(100).max(599).optional(),
});
export type Expected = z.infer<typeof ExpectedSchema>;

/** A name for a captured value, usable as {{capture.name}}. */
const CaptureNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Namen für capture bestehen aus Buchstaben, Ziffern und _");

/** A whole string "{{capture.name}}" in bodyMerge takes the captured value with its type. */
export const CAPTURE_PLACEHOLDER = /^\{\{\s*capture\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/;

/**
 * A turn of a scripted input. A user turn in a dialog may make a follow-up call (issue #84):
 * `capture` takes values from the JSON answer of its round, `bodyMerge` adds fields to the JSON
 * body of its round, with {{capture.name}} for a value captured in an earlier round.
 */
export const ScriptTurnSchema = TurnSchema.extend({
  /** Name to JSONPath-like pointer into the answer, for example $.offer.ids. */
  capture: z.record(CaptureNameSchema, z.string().min(1)).optional(),
  /** Top level fields merged into the JSON body of this round's request. */
  bodyMerge: z.record(z.string().min(1), z.unknown()).optional(),
});
export type ScriptTurn = z.infer<typeof ScriptTurnSchema>;

/** Names of the captures a bodyMerge value refers to. */
export function captureReferences(value: unknown): string[] {
  if (typeof value === "string") {
    const name = CAPTURE_PLACEHOLDER.exec(value)?.[1];
    return name === undefined ? [] : [name];
  }
  if (Array.isArray(value)) return value.flatMap(captureReferences);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(captureReferences);
  }
  return [];
}

export const TestCaseSchema = z
  .strictObject({
    id: IdSchema,
    kind: TestCaseKindSchema,
    /** A single user message or a list of turns that ends with the user. */
    input: z.union([z.string().min(1), z.array(ScriptTurnSchema).min(1)]),
    expected: ExpectedSchema.prefault({}),
    rubric: z.array(RubricCriterionSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
    severity: SeveritySchema.default("medium"),
    /** Where the case comes from, for example a catalog id like LLM01. */
    source: z.string().min(1).optional(),
    /** The passage of the source the case rests on, so a reviewer can check it. */
    sourceQuote: z.string().min(1).optional(),
    /** Values for {{vars.name}} in the request template, for example a mandate (issue #80). */
    vars: z.record(CaptureNameSchema, z.string()).optional(),
    owner: z.string().min(1).optional(),
    version: VersionSchema.default("1"),
    status: TestCaseStatusSchema.default("draft"),
  })
  .superRefine((testCase, ctx) => {
    if (typeof testCase.input === "string") {
      if (testCase.kind === "dialog") {
        ctx.addIssue({
          code: "custom",
          path: ["input"],
          message: "ein Dialogfall braucht eine Liste von Gesprächszügen (turns)",
        });
      }
      return;
    }
    const turns = testCase.input;
    if (testCase.kind === "dialog" && turns.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["input"],
        message: "ein Dialog braucht mindestens zwei Gesprächszüge",
      });
    }
    if (turns[turns.length - 1]?.role !== "user") {
      ctx.addIssue({
        code: "custom",
        path: ["input"],
        message: "der letzte Gesprächszug muss vom Nutzer (role: user) kommen",
      });
    }
    const captured = new Set<string>();
    turns.forEach((turn, index) => {
      if (turn.capture === undefined && turn.bodyMerge === undefined) return;
      if (testCase.kind !== "dialog") {
        ctx.addIssue({
          code: "custom",
          path: ["input", index],
          message: "capture und bodyMerge gibt es nur in Dialogfällen (kind: dialog)",
        });
        return;
      }
      if (turn.role !== "user") {
        ctx.addIssue({
          code: "custom",
          path: ["input", index],
          message: "capture und bodyMerge gehören an einen Nutzerzug (role: user)",
        });
        return;
      }
      for (const name of captureReferences(turn.bodyMerge)) {
        if (!captured.has(name)) {
          ctx.addIssue({
            code: "custom",
            path: ["input", index, "bodyMerge"],
            message: `{{capture.${name}}} ist in keiner früheren Runde per capture festgelegt`,
          });
        }
      }
      for (const name of Object.keys(turn.capture ?? {})) captured.add(name);
    });
  });
export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestCaseInput = z.input<typeof TestCaseSchema>;
