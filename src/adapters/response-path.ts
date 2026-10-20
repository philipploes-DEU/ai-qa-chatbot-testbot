import { excerpt } from "./errors.js";

export type PathSegment = string | number;

export class ResponsePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponsePathError";
  }
}

const SEGMENT = /^(?:\.?([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[(?:'([^']*)'|"([^"]*)")\])/;

/**
 * Parses `$.data.choices[0].message.content`, `reply` or `$['with-dash']` into segments.
 * A subset of JSONPath: child access by name or index, nothing else.
 */
export function parsePath(path: string): PathSegment[] {
  let rest = path.trim();
  if (rest.startsWith("$")) rest = rest.slice(1);
  if (rest === "") throw new ResponsePathError(`Antwortpfad "${path}" ist leer`);
  const segments: PathSegment[] = [];
  while (rest !== "") {
    const match = SEGMENT.exec(rest);
    if (match === null) {
      throw new ResponsePathError(`Antwortpfad "${path}" ist bei "${rest}" nicht lesbar`);
    }
    const [consumed, name, index, single, double] = match;
    if (index !== undefined) segments.push(Number(index));
    else segments.push(name ?? single ?? double ?? "");
    rest = rest.slice(consumed.length);
  }
  return segments;
}

function describe(segments: readonly PathSegment[]): string {
  return segments
    .map((segment) => (typeof segment === "number" ? `[${String(segment)}]` : `.${segment}`))
    .join("");
}

function step(current: unknown, segment: PathSegment): unknown {
  if (typeof segment === "number") {
    return Array.isArray(current) ? (current as unknown[])[segment] : undefined;
  }
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return (current as Record<string, unknown>)[segment];
  }
  return undefined;
}

/** The raw value at `path`, undefined when a segment is missing. Never echoes the payload. */
export function readPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const segment of parsePath(path)) {
    current = step(current, segment);
    if (current === undefined || current === null) return undefined;
  }
  return current;
}

/**
 * Reads the answer text at `path` from a parsed JSON payload. Strings are returned as they are,
 * numbers and booleans as text, objects and arrays as JSON.
 */
export function extractPath(payload: unknown, path: string): string {
  const segments = parsePath(path);
  let current: unknown = payload;
  for (const [index, segment] of segments.entries()) {
    const next = step(current, segment);
    if (next === undefined || next === null) {
      throw new ResponsePathError(
        `Antwortpfad ${path}: ${describe(segments.slice(0, index + 1))} fehlt in ${excerpt(JSON.stringify(payload))}`,
      );
    }
    current = next;
  }
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "boolean") return String(current);
  return JSON.stringify(current);
}
