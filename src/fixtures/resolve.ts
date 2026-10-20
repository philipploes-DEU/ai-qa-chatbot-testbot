import type {
  BindingEntry,
  BindingFile,
  FixtureSource,
  FixturesConfig,
} from "../domain/fixtures.js";
import type { FixtureResolver, NamedQuery } from "./resolvers.js";
import { fieldOf } from "./rows.js";

export interface ResolveInput {
  config: FixturesConfig;
  /** Name of the target the binding is for. */
  target: string;
  /** Placeholders to bind, for example those of the cases of a plan. */
  needed: readonly string[];
  /** The resolver for a source of the config. */
  resolverFor: (name: string, source: FixtureSource) => FixtureResolver;
  now?: () => Date;
  /** Hints for the reader, for example a query without approval. */
  onNote?: (note: string) => void;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * aiqa resolve (ADR 0022): runs every stored query the needed placeholders use once and binds
 * row and field of each. A placeholder without value says why, so a run leaves its cases out.
 */
export async function resolveBindings(input: ResolveInput): Promise<BindingFile> {
  const { config } = input;
  const results = new Map<string, Promise<Record<string, unknown>[]>>();
  const noted = new Set<string>();

  const rowsOf = (id: string): Promise<Record<string, unknown>[]> => {
    const cached = results.get(id);
    if (cached !== undefined) return cached;
    const query = config.queries[id];
    const source = query === undefined ? undefined : config.sources[query.source];
    const pending =
      query === undefined || source === undefined
        ? Promise.reject(new Error(`Abfrage ${id} oder ihre Quelle fehlt`))
        : input.resolverFor(query.source, source).rows({ ...query, id } satisfies NamedQuery);
    results.set(id, pending);
    return pending;
  };

  const entries: BindingEntry[] = [];
  for (const placeholder of input.needed) {
    const binding = config.bindings[placeholder];
    if (binding === undefined) {
      entries.push({
        placeholder,
        status: "unresolved",
        reason: "keine Bindung unter fixtures.bindings in aiqa.yaml",
      });
      continue;
    }
    const query = config.queries[binding.query];
    const where = {
      placeholder,
      query: binding.query,
      ...(query !== undefined ? { queryVersion: query.version, source: query.source } : {}),
    };
    if (query !== undefined && query.approvedBy === undefined && !noted.has(binding.query)) {
      noted.add(binding.query);
      input.onNote?.(
        `Abfrage ${binding.query} (Version ${query.version}) ist nicht abgenommen: approvedBy fehlt.`,
      );
    }
    let rows: Record<string, unknown>[];
    try {
      rows = await rowsOf(binding.query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entries.push({
        ...where,
        status: "unresolved",
        reason: `Abfrage ${binding.query} gescheitert: ${message}`,
      });
      continue;
    }
    const row = rows[binding.row];
    if (row === undefined) {
      entries.push({
        ...where,
        status: "unresolved",
        reason: `die Abfrage ${binding.query} lieferte ${plural(rows.length, "Zeile", "Zeilen")}, gebraucht wird Zeile ${String(binding.row)}`,
      });
      continue;
    }
    try {
      const value = fieldOf(row, binding.field);
      entries.push(
        value === undefined
          ? {
              ...where,
              status: "unresolved",
              reason: `Feld ${binding.field} fehlt in Zeile ${String(binding.row)} der Abfrage ${binding.query}`,
            }
          : { ...where, status: "bound", value },
      );
    } catch (error) {
      entries.push({
        ...where,
        status: "unresolved",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    target: input.target,
    entries,
  };
}

/** The values of a binding by placeholder, only those that are bound. */
export function boundValues(binding: BindingFile): Map<string, string> {
  return new Map(
    binding.entries
      .filter((entry) => entry.status === "bound" && entry.value !== undefined)
      .map((entry) => [entry.placeholder, entry.value ?? ""]),
  );
}

/** The binding of a run with the value each placeholder had in the run before (ADR 0022). */
export function withPrevious(current: BindingFile, before: BindingFile | undefined): BindingFile {
  const earlier = before === undefined ? new Map<string, string>() : boundValues(before);
  return {
    ...current,
    entries: current.entries.map((entry) => {
      const previous = earlier.get(entry.placeholder);
      return previous === undefined ? entry : { ...entry, previous };
    }),
  };
}

/** A placeholder whose value differs between two runs, named without the values. */
export interface PlaceholderChange {
  placeholder: string;
  query?: string;
  queryVersion?: string;
}

/**
 * The placeholders two runs bound to different values, or bound in one run only (ADR 0022). For
 * aiqa compare: cases with such placeholders asked different questions in the two runs.
 */
export function changedBindings(
  base: BindingFile | null,
  head: BindingFile | null,
): PlaceholderChange[] {
  const before = base === null ? new Map<string, string>() : boundValues(base);
  const after = head === null ? new Map<string, string>() : boundValues(head);
  const names = [
    ...new Set(
      [...(base?.entries ?? []), ...(head?.entries ?? [])].map((entry) => entry.placeholder),
    ),
  ];
  return names
    .filter((name) => before.get(name) !== after.get(name))
    .map((name) => {
      // Query and version from head, from base when head has none, for example unresolved.
      const inHead = head?.entries.find((candidate) => candidate.placeholder === name);
      const inBase = base?.entries.find((candidate) => candidate.placeholder === name);
      const entry = inHead?.query !== undefined ? inHead : (inBase ?? inHead);
      return {
        placeholder: name,
        ...(entry?.query !== undefined ? { query: entry.query } : {}),
        ...(entry?.queryVersion !== undefined ? { queryVersion: entry.queryVersion } : {}),
      };
    });
}
