import path from "node:path";

import type { BindingFile } from "../domain/fixtures.js";
import type { TestCase } from "../domain/test-case.js";
import { placeholdersOf } from "../fixtures/placeholders.js";
import { boundValues, resolveBindings } from "../fixtures/resolve.js";
import { createResolver } from "../fixtures/resolvers.js";
import { loadPlan } from "../runner/load-plan.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface ResolveCommandOptions {
  /** Bind only the placeholders of the cases of this plan. Without it every binding. */
  plan?: string;
  config?: string;
}

/** The placeholders the planned cases use, in order, each once. */
export function plannedPlaceholders(cases: readonly (TestCase | undefined)[]): string[] {
  const names: string[] = [];
  for (const testCase of cases) {
    if (testCase === undefined) continue;
    for (const name of placeholdersOf(testCase)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Binds the placeholders from the data sources of aiqa.yaml, stores the binding below
 * runs/bindings and reports it without values, which may be personal data (ADR 0022).
 */
export async function resolveAndStore(
  workspace: LoadedWorkspace,
  store: FileResultStore,
  needed: readonly string[],
  io: CliIo,
  env: Readonly<Record<string, string | undefined>>,
): Promise<BindingFile> {
  const fixtures = workspace.config.fixtures;
  if (fixtures === undefined) {
    throw new CliError(
      "aiqa.yaml hat keinen fixtures-Block. Quellen, Abfragen und Bindungen beschreibt die README unter Platzhalter aus Datenquellen.",
    );
  }
  const target = workspace.config.target.name;
  const previous = await store.latestBinding(target);
  const binding = await resolveBindings({
    config: fixtures,
    target,
    needed,
    resolverFor: (_name, source) => createResolver(source, { dir: workspace.dir, env }),
    onNote: (note) => {
      io.writeErr(`Hinweis: ${note}`);
    },
  });
  await store.writeBinding(binding);

  const unresolved = binding.entries.filter((entry) => entry.status === "unresolved");
  io.writeOut(
    `Bindung für ${target}: ${String(binding.entries.length - unresolved.length)} Platzhalter gebunden, ${String(unresolved.length)} ohne Wert.`,
  );
  for (const entry of unresolved) {
    io.writeErr(`  ${entry.placeholder}: ${entry.reason ?? "ohne Wert"}`);
  }
  if (previous !== null) {
    const before = boundValues(previous);
    const changed = [...boundValues(binding)]
      .filter(([name, value]) => before.has(name) && before.get(name) !== value)
      .map(([name]) => name);
    if (changed.length > 0) {
      io.writeOut(`Geändert seit der Bindung vom ${previous.createdAt}: ${changed.join(", ")}.`);
    }
  }
  io.writeOut(
    `Gespeichert unter ${path.relative(io.cwd, path.join(runsDir(workspace), "bindings")).replace(/\\/g, "/")}/, der nächste Lauf nutzt sie.`,
  );
  return binding;
}

/** `aiqa resolve [--plan <datei>]`: binds the placeholders before a run (ADR 0022). */
export async function executeResolve(
  options: ResolveCommandOptions,
  io: CliIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BindingFile> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  let needed: string[];
  if (options.plan === undefined) {
    needed = Object.keys(workspace.config.fixtures?.bindings ?? {});
  } else {
    const loaded = await loadPlan(path.resolve(io.cwd, options.plan));
    needed = plannedPlaceholders(loaded.plan.caseRefs.map((ref) => loaded.cases.get(ref.caseId)));
    if (needed.length === 0) {
      io.writeOut("Der Plan nutzt keine Platzhalter {{fixtures.name}}, es gibt nichts zu binden.");
      return {
        createdAt: new Date().toISOString(),
        target: workspace.config.target.name,
        entries: [],
      };
    }
  }
  return resolveAndStore(workspace, store, needed, io, env);
}
