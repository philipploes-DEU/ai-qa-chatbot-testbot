import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

/** One step of a path: a field, an index or every member of a list or object. */
export type JsonPathSegment = string | number | { wildcard: true };

const SEGMENT = /^(?:\.?([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[(\*)\]|\[(?:'([^']*)'|"([^"]*)")\])/;

/**
 * Parses `$.eintraege[*].kennung`, `treffer` or `$['mit-strich']` into segments (issue #120,
 * ADR 0025). The syntax of responsePath plus `[*]` for every member; `$` alone is the answer.
 */
export function parseJsonPath(path: string): JsonPathSegment[] {
  const trimmed = path.trim();
  if (trimmed === "") throw new Error("Pfad ist leer");
  let rest = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  const segments: JsonPathSegment[] = [];
  while (rest !== "") {
    const match = SEGMENT.exec(rest);
    if (match === null) throw new Error(`Pfad "${path}" ist bei "${rest}" nicht lesbar`);
    const [consumed, name, index, wildcard, single, double] = match;
    if (index !== undefined) segments.push(Number(index));
    else if (wildcard !== undefined) segments.push({ wildcard: true });
    else segments.push(name ?? single ?? double ?? "");
    rest = rest.slice(consumed.length);
  }
  return segments;
}

/** The values a path points at: at most one without a wildcard, every match with one. */
export interface JsonPathResult {
  /** The path has a wildcard, so `values` is a list of matches and may be empty. */
  many: boolean;
  values: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function step(current: unknown, segment: JsonPathSegment): unknown[] {
  if (typeof segment === "number") {
    return Array.isArray(current) && segment < current.length ? [current[segment]] : [];
  }
  if (typeof segment === "object") {
    if (Array.isArray(current)) return current as unknown[];
    return isRecord(current) ? Object.values(current) : [];
  }
  if (isRecord(current)) return Object.hasOwn(current, segment) ? [current[segment]] : [];
  // length of a list or a text, so a condition can count without a second syntax.
  if (segment === "length" && (Array.isArray(current) || typeof current === "string")) {
    return [current.length];
  }
  return [];
}

/** Reads the values at `path`. A null in the answer is a value, a missing field is none. */
export function readJsonPath(data: unknown, path: string): JsonPathResult {
  const segments = parseJsonPath(path);
  let values: unknown[] = [data];
  for (const segment of segments) {
    values = values.flatMap((value) => step(value, segment));
  }
  return { many: segments.some((segment) => typeof segment === "object"), values };
}

function isReadablePath(path: string): boolean {
  try {
    parseJsonPath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * One condition on the JSON answer of a target (issue #120): a path and at least one
 * comparison. All comparisons of a condition must hold.
 */
export const JsonConditionSchema = z
  .strictObject({
    /** Name of the condition in the report; without it path and comparison name it. */
    name: z.string().min(1).optional(),
    path: z.string().min(1).refine(isReadablePath, {
      message:
        "Pfad nicht lesbar, erlaubt sind Felder, [0], [*] und ['name'], zum Beispiel $.eintraege[*].kennung",
    }),
    /** The value equals this one, compared deeply; with a wildcard the list of matches. */
    equals: z.unknown().optional(),
    /** The value is a number of at least this; with a wildcard every match. */
    min: z.number().optional(),
    /** The value is a number of at most this; with a wildcard every match. */
    max: z.number().optional(),
    /** A list has this member, or a text has this part. */
    contains: z.unknown().optional(),
    /** true: missing, null, "", [] or {}. false: anything else. */
    empty: z.boolean().optional(),
  })
  .superRefine((condition, ctx) => {
    const comparisons = [
      condition.equals,
      condition.min,
      condition.max,
      condition.contains,
      condition.empty,
    ];
    if (comparisons.every((value) => value === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "eine Bedingung braucht equals, min, max, contains oder empty",
      });
    }
  });
export type JsonCondition = z.infer<typeof JsonConditionSchema>;

/** Prefix of the criterion names the json check writes, one criterion per condition. */
export const JSON_CRITERION_PREFIX = "json: ";

/** The condition in a line, for the report: its name, else path and comparisons. */
export function jsonConditionLabel(condition: JsonCondition): string {
  if (condition.name !== undefined) return condition.name;
  const parts: string[] = [];
  if (condition.equals !== undefined) parts.push(`= ${JSON.stringify(condition.equals)}`);
  if (condition.min !== undefined) parts.push(`>= ${String(condition.min)}`);
  if (condition.max !== undefined) parts.push(`<= ${String(condition.max)}`);
  if (condition.contains !== undefined) parts.push(`enthält ${JSON.stringify(condition.contains)}`);
  if (condition.empty !== undefined) parts.push(condition.empty ? "leer" : "nicht leer");
  return `${condition.path} ${parts.join(" und ")}`;
}

const SHOWN_LENGTH = 80;

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)} [...]` : text;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

const MISSING = "Pfad fehlt in der Antwort";

/** Whether the condition holds for the parsed answer, with the value in the reason. */
export function evaluateJsonCondition(
  condition: JsonCondition,
  data: unknown,
): { pass: boolean; reason: string } {
  const { many, values } = readJsonPath(data, condition.path);
  const missing = !many && values.length === 0;
  const value: unknown = many ? values : values[0];
  const failures: string[] = [];

  if (condition.equals !== undefined) {
    if (missing) failures.push(MISSING);
    else if (!isDeepStrictEqual(value, condition.equals)) {
      failures.push(`Wert ist ${show(value)}, erwartet ${show(condition.equals)}`);
    }
  }

  if (condition.min !== undefined || condition.max !== undefined) {
    const numbers = many ? values : values.slice(0, 1);
    const { min, max } = condition;
    if (numbers.length === 0) failures.push(MISSING);
    else if (!numbers.every((entry) => typeof entry === "number")) {
      failures.push(`Wert ist keine Zahl: ${show(value)}`);
    } else {
      if (min !== undefined && numbers.some((entry) => entry < min)) {
        failures.push(`Wert ${show(value)} liegt unter ${String(min)}`);
      }
      if (max !== undefined && numbers.some((entry) => entry > max)) {
        failures.push(`Wert ${show(value)} liegt über ${String(max)}`);
      }
    }
  }

  if (condition.contains !== undefined) {
    const wanted = condition.contains;
    if (missing) failures.push(MISSING);
    else if (Array.isArray(value)) {
      if (!value.some((entry) => isDeepStrictEqual(entry, wanted))) {
        failures.push(`${show(wanted)} fehlt in ${show(value)}`);
      }
    } else if (typeof value === "string" && typeof wanted === "string") {
      if (!value.includes(wanted)) failures.push(`${show(wanted)} fehlt in ${show(value)}`);
    } else {
      failures.push(`Wert ist weder Liste noch Text: ${show(value)}`);
    }
  }

  if (condition.empty !== undefined) {
    const empty = missing || isEmpty(value);
    if (condition.empty && !empty) failures.push(`Wert ist nicht leer: ${show(value)}`);
    if (!condition.empty && empty) failures.push("Wert ist leer oder fehlt");
  }

  if (failures.length > 0) return { pass: false, reason: [...new Set(failures)].join("; ") };
  return { pass: true, reason: missing ? "Pfad fehlt, also leer" : `Wert ist ${show(value)}` };
}
