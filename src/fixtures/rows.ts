import { readPath } from "../adapters/response-path.js";

function at(payload: unknown, path: string): unknown {
  return path.trim() === "$" || path.trim() === "" ? payload : readPath(payload, path);
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The rows of a query answer (ADR 0022): the list at `path`, or with `[*]` every element of the
 * list before it, projected by the rest of the path, for example $.hits.hits[*]._source.
 */
export function readRows(payload: unknown, path: string): Record<string, unknown>[] {
  const star = path.indexOf("[*]");
  const listPath = star === -1 ? path : path.slice(0, star);
  const rest = star === -1 ? "" : path.slice(star + 3);
  const list = at(payload, listPath);
  if (!Array.isArray(list)) throw new Error(`unter ${listPath} liegt keine Liste`);
  const rows: unknown[] = rest === "" ? list : list.map((item) => at(item, `$${rest}`));
  if (!rows.every(isRow)) throw new Error(`unter ${path} liegen keine Objekte als Zeilen`);
  return rows;
}

/**
 * The value of a field of a row as text: a key or a path such as $.ort.halle. undefined when it
 * is missing. Lists and objects are no value for a placeholder.
 */
export function fieldOf(row: Record<string, unknown>, field: string): string | undefined {
  const value = field.startsWith("$") ? readPath(row, field) : row[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`Feld ${field} ist kein einfacher Wert, sondern eine Liste oder ein Objekt`);
}
