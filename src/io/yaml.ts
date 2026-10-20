import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import type { z } from "zod";

import { issueLines } from "../domain/issues.js";

/** A document did not match its schema. `issues` holds one line per problem with its path. */
export class ValidationError extends Error {
  constructor(
    readonly source: string,
    readonly issues: readonly string[],
  ) {
    super(`${source}: ${String(issues.length)} Validierungsfehler`);
    this.name = "ValidationError";
  }
}

export async function readYamlFile(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`${file}: Datei nicht gefunden oder nicht lesbar`, { cause: error });
  }
  try {
    return parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: YAML-Fehler: ${message}`, { cause: error });
  }
}

export function parseDocument<T>(schema: z.ZodType<T>, data: unknown, source: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ValidationError(source, issueLines(result.error.issues));
}

export async function loadDocument<T>(schema: z.ZodType<T>, file: string): Promise<T> {
  return parseDocument(schema, await readYamlFile(file), file);
}
