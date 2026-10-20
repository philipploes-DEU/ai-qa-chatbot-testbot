import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import {
  estimateBudget,
  proposeCases,
  type SourceDocument,
  suggestIterations,
} from "../agents/planning-agent.js";
import { loadProbeCatalog } from "../catalog/load-catalog.js";
import { materializeProbes } from "../catalog/materialize-probes.js";
import { type Goldset, GoldsetSchema } from "../domain/goldset.js";
import { type Plan, PlanSchema } from "../domain/plan.js";
import type { TestCase } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { toPosix } from "../io/files.js";
import { LATEST_JUDGE_PROMPT } from "../judge/prompts/index.js";
import type { ModelProvider } from "../providers/model-provider.js";
import { callsPerIteration, generateRunId } from "../runner/run-plan.js";
import { agentProvider, loadRiskCatalogs } from "./agents.js";
import { type LoadedWorkspace, requireWorkspaceConfig } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface PlanCommandOptions {
  /** Plan file to write, relative to the workspace. */
  out: string;
  iterations?: number;
  /** Add the probe catalog as a goldset of probe cases: true for the shipped catalog, or a path. */
  probes?: string | boolean;
  id?: string;
  config?: string;
  /** Domain documents (files or directories) for the planning agent (issue #16). */
  docs?: readonly string[];
  /** Goldset file the agent writes its drafts into, relative to the workspace. */
  drafts?: string;
  /** Upper bound of draft cases per document. */
  maxCases?: number;
  /** Model for the agent; tests pass a fake, the CLI builds it from aiqa.yaml. */
  provider?: ModelProvider;
}

/** The probe catalog that ships with AI QA. */
export const SHIPPED_PROBE_CATALOG = new URL("../../catalogs/owasp-probes.yaml", import.meta.url);

export const PROBES_GOLDSET_FILE = path.join("goldsets", "owasp-probes.yaml");

export const DRAFTS_GOLDSET_FILE = path.join("goldsets", "entwuerfe.yaml");

const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

async function collectFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (!info.isDirectory()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => collectFiles(path.join(target, entry.name))),
  );
  return nested.flat();
}

/** Reads the text files under the given paths; the source path is relative to the workspace. */
async function loadDocuments(
  paths: readonly string[],
  cwd: string,
  workspaceDir: string,
): Promise<SourceDocument[]> {
  const documents: SourceDocument[] = [];
  for (const entry of paths) {
    const absolute = path.resolve(cwd, entry);
    let files: string[];
    try {
      files = await collectFiles(absolute);
    } catch {
      throw new CliError(`Dokumente ${entry} nicht gefunden.`);
    }
    const texts = files.filter((file) => DOCUMENT_EXTENSIONS.has(path.extname(file).toLowerCase()));
    if (texts.length === 0) {
      throw new CliError(
        `${entry} enthält keine Textdatei (${[...DOCUMENT_EXTENSIONS].join(", ")}).`,
      );
    }
    for (const file of texts) {
      const text = await readFile(file, "utf8");
      if (text.trim().length === 0) continue;
      documents.push({ path: toPosix(path.relative(workspaceDir, file)), text });
    }
  }
  return documents;
}

function nextVersion(version: string): string {
  return /^\d+$/.test(version) ? String(Number(version) + 1) : version;
}

async function readDraftsGoldset(file: string): Promise<Goldset | undefined> {
  try {
    await stat(file);
  } catch {
    return undefined;
  }
  return loadGoldset(file);
}

const DRAFTS_HEADER =
  "# Vorschläge des Planungsagenten (aiqa plan --docs). Jeden Fall gegen sourceQuote prüfen,\n" +
  "# anpassen und erst dann status auf approved setzen. Entwürfe laufen mit, zählen aber nicht in die Quote.\n";

interface GoldsetSource {
  file: string;
  goldset: Goldset;
}

/** The goldsets of aiqa.yaml; `skip` is a file the command writes anew, such as the probes. */
async function loadWorkspaceGoldsets(
  workspace: LoadedWorkspace,
  skip?: string,
): Promise<GoldsetSource[]> {
  const sources: GoldsetSource[] = [];
  for (const ref of workspace.config.goldsets) {
    const file = path.resolve(workspace.dir, ref);
    if (file === skip) continue;
    sources.push({ file, goldset: await loadGoldset(file) });
  }
  return sources;
}

function probesGoldset(cases: readonly TestCase[], catalogId: string, version: string): Goldset {
  return {
    id: "owasp-probes",
    name: "OWASP-Proben aus dem Katalog",
    version,
    owner: `AI QA Katalog ${catalogId}`,
    cases: [...cases],
  };
}

/**
 * `aiqa plan --out <datei>`: writes a plan over every active case of the workspace goldsets,
 * with the judge of aiqa.yaml. `--probes` materialises the probe catalog with the workspace
 * variables into goldsets/owasp-probes.yaml and includes its cases (issue #7). `--docs` lets
 * the planning agent propose draft cases from domain documents into goldsets/entwuerfe.yaml
 * and sizes the iterations by severity (issue #16). The plan is a proposal: a human reviews
 * it, and drafts count only after a human set them to approved.
 */
export async function executePlan(options: PlanCommandOptions, io: CliIo): Promise<Plan> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const iterations = options.iterations ?? 5;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
    throw new CliError("--iterations muss eine ganze Zahl zwischen 1 und 1000 sein");
  }
  if (
    options.maxCases !== undefined &&
    (!Number.isInteger(options.maxCases) || options.maxCases < 1 || options.maxCases > 100)
  ) {
    throw new CliError("--max-cases muss eine ganze Zahl zwischen 1 und 100 sein");
  }
  const withProbes = options.probes !== undefined && options.probes !== false;
  const sources = await loadWorkspaceGoldsets(
    workspace,
    withProbes ? path.resolve(workspace.dir, PROBES_GOLDSET_FILE) : undefined,
  );

  if (options.probes !== undefined && options.probes !== false) {
    const catalogFile =
      options.probes === true ? SHIPPED_PROBE_CATALOG : path.resolve(io.cwd, options.probes);
    const catalog = await loadProbeCatalog(catalogFile);
    const variables = workspace.config.probes?.variables ?? {};
    const { cases, skipped } = materializeProbes(catalog, variables);
    for (const entry of skipped) {
      io.writeErr(
        `Hinweis: Muster ${entry.id} übersprungen, in aiqa.yaml fehlen probes.variables: ${entry.missing.join(", ")}`,
      );
    }
    if (cases.length === 0) {
      throw new CliError(
        "Kein Muster ließ sich füllen. Trage unter probes.variables in aiqa.yaml die Variablen des Katalogs ein.",
      );
    }
    const file = path.resolve(workspace.dir, PROBES_GOLDSET_FILE);
    const goldset = probesGoldset(cases, catalog.id, catalog.version);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `# Erzeugt von aiqa plan aus ${catalog.id} (Version ${catalog.version}) mit den Variablen aus aiqa.yaml.\n` +
        "# Nicht von Hand pflegen, der nächste Lauf von aiqa plan --probes überschreibt die Datei.\n" +
        stringify(goldset),
      "utf8",
    );
    io.writeOut(
      `Proben-Goldset geschrieben: ${toPosix(path.relative(io.cwd, file))} (${String(cases.length)} Fälle)`,
    );
    sources.push({ file, goldset });
    if (!workspace.config.goldsets.some((ref) => path.resolve(workspace.dir, ref) === file)) {
      io.writeOut(
        `Trage ${toPosix(PROBES_GOLDSET_FILE)} unter goldsets in aiqa.yaml ein, damit Report und validate es kennen.`,
      );
    }
  }

  const usesAgent = options.docs !== undefined && options.docs.length > 0;
  if (usesAgent) {
    await planDrafts(options, workspace, sources, io);
  }

  const outFile = path.resolve(io.cwd, options.out);
  const activeCases = sources.flatMap((source) =>
    source.goldset.cases.filter((testCase) => testCase.status !== "retired"),
  );
  const sized = activeCases.map((testCase) => ({
    testCase,
    iterations: usesAgent ? suggestIterations(testCase, options.iterations) : iterations,
  }));
  const caseRefs = sized.map(({ testCase, iterations: n }) => ({
    caseId: testCase.id,
    iterations: n,
  }));
  // Dialogs need one call per user turn; the budget covers every planned call.
  const plannedCalls = sized.reduce(
    (sum, { testCase, iterations: n }) => sum + n * callsPerIteration(testCase),
    0,
  );
  if (caseRefs.length === 0) {
    throw new CliError("Keine aktiven Fälle in den Goldsets des Arbeitsbereichs.");
  }
  const now = new Date();
  const judge = workspace.config.judge;
  const plan = PlanSchema.parse({
    id: options.id ?? `plan-${generateRunId(now)}`,
    createdAt: now.toISOString(),
    target: workspace.config.target.name,
    goldsets: sources.map((source) => toPosix(path.relative(path.dirname(outFile), source.file))),
    caseRefs,
    ...(judge === undefined
      ? {}
      : {
          judge: {
            provider: judge.provider,
            model: judge.model,
            promptVersion: judge.promptVersion ?? LATEST_JUDGE_PROMPT.version,
          },
        }),
    budget: { maxCalls: plannedCalls },
  });

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    `# Erzeugt von aiqa plan am ${now.toISOString()}. Fälle und Iterationen vor dem Lauf prüfen.\n` +
      stringify(plan),
    "utf8",
  );
  io.writeOut(
    `Plan geschrieben: ${toPosix(path.relative(io.cwd, outFile))} (${String(caseRefs.length)} Fälle, ${String(plannedCalls)} Aufrufe` +
      (judge === undefined ? ")" : `, Judge ${judge.model})`),
  );
  if (usesAgent) {
    const estimate = estimateBudget(sized, judge !== undefined);
    const drafts = sized.filter(({ testCase }) => testCase.status === "draft").length;
    io.writeOut(
      `Budgetschätzung: ${String(estimate.targetCalls)} Aufrufe an das Zielsystem, ` +
        (judge === undefined
          ? "kein Judge konfiguriert."
          : `höchstens ${String(estimate.judgeCalls)} an den Judge.`) +
        ` Iterationen je Fall nach Schwere, ${String(drafts)} Entwürfe laufen mit, zählen aber nicht in die Quote.`,
    );
    io.writeOut(
      "Der Plan ist ein Vorschlag: Fälle und Iterationen prüfen, Entwürfe erst nach Prüfung auf status: approved setzen.",
    );
  }
  io.writeOut(`Ausführen mit: aiqa run --plan ${toPosix(path.relative(io.cwd, outFile))}`);
  return plan;
}

/**
 * Runs the planning agent over the documents, writes the accepted drafts into the drafts
 * goldset and adds it to the sources of the plan.
 */
async function planDrafts(
  options: PlanCommandOptions,
  workspace: LoadedWorkspace,
  sources: GoldsetSource[],
  io: CliIo,
): Promise<void> {
  const documents = await loadDocuments(options.docs ?? [], io.cwd, workspace.dir);
  const catalogs = await loadRiskCatalogs(workspace);
  const provider = options.provider ?? agentProvider(workspace, io, "Planungsagent");

  const file = path.resolve(workspace.dir, options.drafts ?? DRAFTS_GOLDSET_FILE);
  const known = sources.find((source) => source.file === file);
  const existing = known?.goldset ?? (await readDraftsGoldset(file));
  const existingIds = new Set([
    ...sources.flatMap((source) => source.goldset.cases.map((testCase) => testCase.id)),
    ...(existing?.cases.map((testCase) => testCase.id) ?? []),
  ]);

  const result = await proposeCases(provider, {
    documents,
    catalogs,
    existingCaseIds: existingIds,
    existingInputs: [
      ...sources.flatMap((source) => source.goldset.cases),
      ...(known === undefined ? (existing?.cases ?? []) : []),
    ].flatMap((testCase) => (typeof testCase.input === "string" ? [testCase.input] : [])),
    ...(options.maxCases !== undefined ? { maxCasesPerDocument: options.maxCases } : {}),
  });
  for (const rejected of result.rejected) {
    io.writeErr(
      `Hinweis: Vorschlag verworfen: ${rejected.id} (${rejected.document}): ${rejected.reason}`,
    );
  }
  for (const note of result.notes) io.writeErr(`Hinweis: ${note}`);
  const count = result.cases.length;
  io.writeOut(
    `Planungsagent (${provider.model}): ${String(count)} ${count === 1 ? "Entwurf" : "Entwürfe"} aus ${String(documents.length)} ${documents.length === 1 ? "Dokument" : "Dokumenten"}, ` +
      `${String(result.rejected.length)} verworfen, ${String(result.calls)} Aufrufe, ${String(result.tokens.input + result.tokens.output)} Tokens.`,
  );
  if (count === 0) return;

  const goldset = GoldsetSchema.parse(
    existing === undefined
      ? {
          id: "entwuerfe",
          name: "Entwürfe des Planungsagenten",
          version: "1",
          owner: "Planungsagent, Prüfung offen",
          cases: result.cases,
        }
      : {
          ...existing,
          version: nextVersion(existing.version),
          cases: [...existing.cases, ...result.cases],
        },
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, DRAFTS_HEADER + stringify(goldset), "utf8");
  io.writeOut(
    `Entwürfe geschrieben: ${toPosix(path.relative(io.cwd, file))} (${String(count)} neu, Version ${goldset.version})`,
  );
  if (known !== undefined) {
    known.goldset = goldset;
  } else {
    sources.push({ file, goldset });
  }
  if (!workspace.config.goldsets.some((ref) => path.resolve(workspace.dir, ref) === file)) {
    io.writeOut(
      `Trage ${toPosix(path.relative(workspace.dir, file))} unter goldsets in aiqa.yaml ein, damit Report und validate es kennen.`,
    );
  }
}
