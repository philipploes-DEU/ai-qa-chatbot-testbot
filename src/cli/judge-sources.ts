import type { Goldset } from "../domain/goldset.js";
import type { Judge } from "../judge/judge.js";
import {
  DEFAULT_MAX_SOURCE_CHARS,
  estimateSourceTokens,
  loadGoldsetSources,
  type SourceDocument,
  truncationWarning,
} from "../judge/sources.js";

export interface GoldsetFile {
  goldset: Goldset;
  /** Absolute path of the goldset file; source paths are relative to it. */
  file: string;
}

export interface JudgeSources {
  /** Documents by goldset id, only for goldsets with sources and a prompt that reads them. */
  byGoldset: Map<string, SourceDocument[]>;
  /** Estimated tokens the documents add to one judge call, by goldset id. */
  tokensByGoldset: Map<string, number>;
  /** One line per goldset with sources, for the output before a run. */
  lines: string[];
  /** Caveats for the run record and the report: cut documents, a prompt without sources. */
  notes: string[];
}

/**
 * Loads the source documents of the goldsets for the judge (issue #70), cut at maxSourceChars
 * of the judge block. A prompt version without sources gets none and a note says so.
 */
export async function loadJudgeSources(
  entries: readonly GoldsetFile[],
  judge: Judge,
  maxChars = DEFAULT_MAX_SOURCE_CHARS,
): Promise<JudgeSources> {
  const result: JudgeSources = {
    byGoldset: new Map(),
    tokensByGoldset: new Map(),
    lines: [],
    notes: [],
  };
  for (const { goldset, file } of entries) {
    if (goldset.sources === undefined) continue;
    if (!judge.readsSources) {
      result.notes.push(
        `Goldset ${goldset.id} hat Quelldokumente, der Judge-Prompt ${judge.promptVersion} nutzt sie nicht. Für die Prüfung gegen Quellen promptVersion v2 oder neuer wählen.`,
      );
      continue;
    }
    const loaded = await loadGoldsetSources(goldset, file, maxChars);
    const tokens = estimateSourceTokens(loaded.documents);
    result.byGoldset.set(goldset.id, loaded.documents);
    result.tokensByGoldset.set(goldset.id, tokens);
    const count = loaded.documents.length;
    result.lines.push(
      `Quelldokumente für den Judge: Goldset ${goldset.id}, ${String(count)} ${count === 1 ? "Dokument" : "Dokumente"}, rund ${String(tokens)} Tokens je Judge-Aufruf.`,
    );
    const warning = truncationWarning(goldset.id, loaded, maxChars);
    if (warning !== undefined) result.notes.push(warning);
  }
  return result;
}
