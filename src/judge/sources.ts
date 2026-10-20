import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Goldset } from "../domain/goldset.js";

/** One source document the judge checks claims against (issue #70). */
export interface SourceDocument {
  /** Path as written in the goldset. */
  name: string;
  content: string;
}

export interface LoadedSources {
  documents: SourceDocument[];
  /** Characters of all documents before cutting, set only when they exceeded the limit. */
  truncatedFrom?: number;
}

/** About 15000 tokens; keeps one judge call affordable with a large model. */
export const DEFAULT_MAX_SOURCE_CHARS = 60_000;

/** Rough rule of four characters per token, good enough for a cost hint before a run. */
const CHARS_PER_TOKEN = 4;

export function sourceChars(documents: readonly SourceDocument[]): number {
  return documents.reduce((sum, document) => sum + document.content.length, 0);
}

export function estimateSourceTokens(documents: readonly SourceDocument[]): number {
  return Math.ceil(sourceChars(documents) / CHARS_PER_TOKEN);
}

/**
 * Reads the source documents of a goldset, relative to the goldset file, in the given order.
 * Beyond `maxChars` the rest is cut off; `truncatedFrom` then says how long they were.
 */
export async function loadGoldsetSources(
  goldset: Goldset,
  goldsetFile: string,
  maxChars = DEFAULT_MAX_SOURCE_CHARS,
): Promise<LoadedSources> {
  const documents: SourceDocument[] = [];
  for (const name of goldset.sources ?? []) {
    const file = path.resolve(path.dirname(goldsetFile), name);
    try {
      documents.push({ name, content: await readFile(file, "utf8") });
    } catch {
      throw new Error(`Quelldokument ${name} von Goldset ${goldset.id} nicht lesbar (${file})`);
    }
  }
  const total = sourceChars(documents);
  if (total <= maxChars) return { documents };
  let remaining = maxChars;
  const kept: SourceDocument[] = [];
  for (const document of documents) {
    if (remaining === 0) break;
    const content = document.content.slice(0, remaining);
    kept.push({ name: document.name, content });
    remaining -= content.length;
  }
  return { documents: kept, truncatedFrom: total };
}

/** The note for run and report when the documents were cut, undefined otherwise. */
export function truncationWarning(
  goldsetId: string,
  loaded: LoadedSources,
  maxChars: number,
): string | undefined {
  if (loaded.truncatedFrom === undefined) return undefined;
  return `Quelldokumente von Goldset ${goldsetId} sind ${String(loaded.truncatedFrom)} Zeichen lang, der Judge bekommt nur die ersten ${String(maxChars)}. Angaben aus dem Rest wertet er als unbelegt.`;
}
