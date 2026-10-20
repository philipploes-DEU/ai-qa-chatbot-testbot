import type { z } from "zod";

import { excerpt } from "../adapters/errors.js";

/** The model's text was not valid JSON for the schema, after the allowed repairs. */
export class InvalidJsonError extends Error {
  constructor(
    readonly reason: string,
    readonly raw: string,
  ) {
    super(
      `Modellantwort ist kein gültiges JSON für das Schema: ${reason}. Antwort: ${excerpt(raw)}`,
    );
    this.name = "InvalidJsonError";
  }
}

/**
 * The model declined to answer: a refusal text, a stop for safety reasons or an empty answer
 * (issue #83). A repair would cost a call without prospect, so providers raise it at once.
 */
export class ModelRefusalError extends Error {
  constructor(readonly reason: string) {
    super(`Das Modell lehnt die Antwort ab: ${reason}`);
    this.name = "ModelRefusalError";
  }
}

/**
 * Finds the JSON document in a model answer: a fenced block when present, otherwise the text
 * from the first brace or bracket to the last one. Models add prose around JSON even when told
 * not to.
 */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) return text.trim();
  return text.slice(start, end + 1);
}

export type JsonParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Parses and validates a model answer. The reason of a failure is phrased for a repair prompt. */
export function parseJsonWith<T>(schema: z.ZodType<T>, text: string): JsonParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `kein JSON (${message})` };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(Wurzel)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, reason: `Schema verletzt (${issues})` };
}
