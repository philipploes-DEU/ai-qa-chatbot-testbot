import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import type { FixturesConfig } from "../domain/fixtures.js";

/** Field names of a mapping file: a JSON or YAML list, nested fields as a.b. */
async function readMapping(file: string): Promise<Set<string> | null> {
  try {
    const text = await readFile(file, "utf8");
    const data: unknown = /\.json$/i.test(file) ? JSON.parse(text) : parse(text);
    if (!Array.isArray(data) || !data.every((entry) => typeof entry === "string")) return null;
    return new Set(data);
  } catch {
    return null;
  }
}

/** The field of a binding as a mapping names it: $.ort[0].halle becomes ort.halle. */
function fieldName(field: string): string {
  return field.replace(/^\$\.?/, "").replace(/\[\d+\]/g, "");
}

/**
 * aiqa validate with an index mapping (ADR 0022): every field a binding reads must be a field of
 * the mapping of its source. Sources without mapping are not checked. Paths are relative to
 * aiqa.yaml.
 */
export async function checkMappings(config: FixturesConfig, dir: string): Promise<string[]> {
  const errors: string[] = [];
  const mappings = new Map<string, Set<string>>();
  for (const [name, source] of Object.entries(config.sources)) {
    if (source.mapping === undefined) continue;
    const fields = await readMapping(path.resolve(dir, source.mapping));
    if (fields === null) {
      errors.push(
        `fixtures.sources.${name}.mapping: ${source.mapping} nicht lesbar, erwartet eine Liste von Feldnamen`,
      );
      continue;
    }
    mappings.set(name, fields);
  }
  for (const [placeholder, binding] of Object.entries(config.bindings)) {
    const source = config.queries[binding.query]?.source;
    if (source === undefined) continue;
    const fields = mappings.get(source);
    if (fields === undefined) continue;
    const field = fieldName(binding.field);
    if (!fields.has(field)) {
      errors.push(
        `fixtures.bindings.${placeholder}.field: Feld ${field} steht nicht im Mapping ${config.sources[source]?.mapping ?? ""} der Quelle ${source}`,
      );
    }
  }
  return errors;
}
