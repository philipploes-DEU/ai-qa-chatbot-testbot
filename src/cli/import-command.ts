import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse, parseDocument, stringify } from "yaml";

import {
  type PromptfooCaseTemplates,
  PromptfooCaseTemplatesSchema,
} from "../domain/promptfoo-case-templates.js";
import { type PromptfooMapping, PromptfooMappingSchema } from "../domain/promptfoo-mapping.js";
import { slugify } from "../agents/planning-agent.js";
import { TargetConfigSchema } from "../domain/target-config.js";
import {
  CurlImportError,
  draftTarget,
  parseCurl,
  parseSampleAnswer,
  type SampleAnswer,
  suggestResponsePaths,
} from "../importers/curl.js";
import { importPromptfooCases } from "../importers/promptfoo-cases.js";
import { importPromptfoo, PromptfooImportError } from "../importers/promptfoo.js";
import { toPosix } from "../io/files.js";
import { loadDocument } from "../io/yaml.js";
import { generateRunId } from "../runner/run-plan.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

/** Plugin and strategy ids of promptfoo mapped to OWASP ids, shipped with AI QA. */
export const SHIPPED_PROMPTFOO_MAPPING = new URL(
  "../../catalogs/promptfoo-mapping.yaml",
  import.meta.url,
);

/** Templates that give generated promptfoo attacks an expectation and a rubric (ADR 0013). */
export const SHIPPED_PROMPTFOO_TEMPLATES = new URL(
  "../../catalogs/promptfoo-case-templates.yaml",
  import.meta.url,
);

export const IMPORT_SOURCES = ["promptfoo", "promptfoo-cases", "curl"] as const;

/** Where `aiqa import curl` writes its draft, next to aiqa.yaml. */
export const TARGET_DRAFT_FILE = "aiqa.target-entwurf.yaml";

export interface ImportCommandOptions {
  /** promptfoo for a result file, promptfoo-cases for the generated attacks (redteam.yaml). */
  source: string;
  /** Result file or redteam.yaml, relative to the working directory. */
  file: string;
  /** Target name recorded in the run; the target of aiqa.yaml when omitted. */
  target?: string;
  /** Own mapping file instead of the shipped one. */
  mapping?: string;
  /** Provider to import when the file compares several. */
  provider?: string;
  /** promptfoo-cases: own template file instead of the shipped one. */
  templates?: string;
  /** promptfoo-cases: id of the goldset that is written. */
  id?: string;
  /** curl: the question as typed in the interface. */
  question?: string;
  /** curl: a saved answer of the target (JSON) for the response path. */
  response?: string;
  /** curl: call the target once with the copied request for the response path. */
  call?: boolean;
  /** curl: replace the target block of aiqa.yaml with the draft. */
  apply?: boolean;
  /** curl: name of the target. */
  name?: string;
  config?: string;
  now?: () => Date;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string, shown: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    throw new CliError(`Datei ${shown} nicht gefunden.`);
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new CliError(`${shown} ist kein gültiges JSON.`);
  }
}

async function loadMapping(file: string | URL): Promise<PromptfooMapping> {
  return loadDocument(
    PromptfooMappingSchema,
    typeof file === "string" ? file : fileURLToPath(file),
  );
}

/**
 * `aiqa import promptfoo --file <datei>`: turns a promptfoo result file into a run of the
 * workspace and a generated goldset of its cases (issue #55, ADR 0008). Returns the run id.
 */
export async function executeImport(options: ImportCommandOptions, io: CliIo): Promise<string> {
  if (!(IMPORT_SOURCES as readonly string[]).includes(options.source)) {
    throw new CliError(
      `Unbekannte Quelle "${options.source}". Möglich ist: ${IMPORT_SOURCES.join(", ")}.`,
    );
  }
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  if (options.source === "promptfoo-cases") return importCases(options, workspace, io);
  if (options.source === "curl") return importCurl(options, workspace, io);
  const data = await readJson(path.resolve(io.cwd, options.file), options.file);
  const mapping = await loadMapping(
    options.mapping === undefined
      ? SHIPPED_PROMPTFOO_MAPPING
      : path.resolve(io.cwd, options.mapping),
  );
  const now = (options.now ?? ((): Date => new Date()))();
  const runId = generateRunId(now);

  let imported;
  try {
    imported = importPromptfoo(data, {
      runId,
      target: options.target ?? workspace.config.target.name,
      mapping,
      now,
      ...(options.provider === undefined ? {} : { provider: options.provider }),
    });
  } catch (error) {
    if (error instanceof PromptfooImportError) throw new CliError(error.message);
    throw error;
  }

  const goldsetFile = path.join(workspace.dir, "goldsets", `${imported.goldset.id}.yaml`);
  const shownGoldset = toPosix(path.relative(io.cwd, goldsetFile));
  if (await exists(goldsetFile)) {
    throw new CliError(
      `Diese promptfoo-Auswertung ist schon importiert: ${shownGoldset} existiert. Lösche die Datei, um neu zu importieren.`,
    );
  }

  const store = new FileResultStore(runsDir(workspace));
  await store.createRun(imported.run);
  for (const iteration of imported.iterations) await store.appendIteration(iteration);
  for (const verdict of imported.verdicts) await store.appendVerdict(verdict);
  await writeFile(
    goldsetFile,
    `# Erzeugt von aiqa import promptfoo aus ${path.basename(options.file)}. Nicht von Hand pflegen.\n` +
      "# Die Fälle tragen keine Erwartungen: die Urteile stammen aus der promptfoo-Datei.\n" +
      stringify(imported.goldset),
    "utf8",
  );

  const failedByIteration = new Set(
    imported.verdicts
      .filter((verdict) => !verdict.pass)
      .map((verdict) => `${verdict.caseId}#${String(verdict.index)}`),
  );
  const passed = imported.iterations.filter(
    (iteration) => !failedByIteration.has(`${iteration.caseId}#${String(iteration.index)}`),
  ).length;
  io.writeOut(
    `Lauf ${runId} importiert: ${String(imported.iterations.length)} Iterationen in ${String(imported.goldset.cases.length)} Fällen, ${String(passed)} bestanden.`,
  );
  io.writeOut(`Goldset geschrieben: ${shownGoldset}`);
  if (imported.unknownPlugins.length > 0) {
    io.writeErr(
      `Hinweis: ohne OWASP-Zuordnung, Fälle ohne Quelle: ${imported.unknownPlugins.join(", ")}. Ergänze sie in catalogs/promptfoo-mapping.yaml oder einer eigenen Datei mit --mapping.`,
    );
  }
  if (!workspace.config.goldsets.some((ref) => path.resolve(workspace.dir, ref) === goldsetFile)) {
    io.writeOut(
      `Trage ${toPosix(path.relative(workspace.dir, goldsetFile))} unter goldsets in aiqa.yaml ein, damit Report und validate die Fälle kennen.`,
    );
  }
  io.writeOut(`Report erzeugen mit: aiqa report --run ${runId}`);
  return runId;
}

async function loadTemplates(file: string | URL): Promise<PromptfooCaseTemplates> {
  return loadDocument(
    PromptfooCaseTemplatesSchema,
    typeof file === "string" ? file : fileURLToPath(file),
  );
}

/**
 * `aiqa import promptfoo-cases --file redteam.yaml`: takes the attacks promptfoo generated as
 * draft probe cases with expectation and rubric from a template per plugin (issue #58,
 * ADR 0013). Returns the goldset file.
 */
async function importCases(
  options: ImportCommandOptions,
  workspace: LoadedWorkspace,
  io: CliIo,
): Promise<string> {
  let data: unknown;
  try {
    data = parse(await readFile(path.resolve(io.cwd, options.file), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`${options.file} lässt sich nicht lesen: ${message}`);
  }
  const [mapping, templates] = await Promise.all([
    loadMapping(
      options.mapping === undefined
        ? SHIPPED_PROMPTFOO_MAPPING
        : path.resolve(io.cwd, options.mapping),
    ),
    loadTemplates(
      options.templates === undefined
        ? SHIPPED_PROMPTFOO_TEMPLATES
        : path.resolve(io.cwd, options.templates),
    ),
  ]);
  const base = path.basename(options.file).replace(/\.ya?ml$/i, "");
  const goldsetId = options.id ?? slugify(`promptfoo-angriffe-${base}`);
  const goldsetFile = path.join(workspace.dir, "goldsets", `${goldsetId}.yaml`);
  const shown = toPosix(path.relative(io.cwd, goldsetFile));
  if (await exists(goldsetFile)) {
    throw new CliError(`${shown} existiert schon. Wähle mit --id einen anderen Namen.`);
  }

  let imported;
  try {
    imported = importPromptfooCases(data, {
      goldsetId,
      name: `promptfoo-Angriffe aus ${path.basename(options.file)}`,
      mapping,
      templates,
      variables: workspace.config.probes?.variables ?? {},
    });
  } catch (error) {
    if (error instanceof PromptfooImportError) throw new CliError(error.message);
    throw error;
  }

  await mkdir(path.dirname(goldsetFile), { recursive: true });
  await writeFile(
    goldsetFile,
    `# Erzeugt von aiqa import promptfoo-cases aus ${path.basename(options.file)}.\n` +
      "# Alle Fälle sind Entwürfe: prüfen, anpassen, dann status auf approved setzen.\n" +
      stringify(imported.goldset),
    "utf8",
  );

  const count = imported.goldset.cases.length;
  io.writeOut(
    `${String(count)} ${count === 1 ? "Entwurf" : "Entwürfe"} geschrieben: ${shown}. ` +
      `${String(imported.skippedIterative)} übersprungen, weil ihre Strategie den Angriff erst beim Lauf in promptfoo baut.`,
  );
  if (imported.withoutTemplate.length > 0) {
    io.writeErr(
      `Hinweis: ohne Vorlage nicht übernommen: ${imported.withoutTemplate.join(", ")}. Ergänze sie in catalogs/promptfoo-case-templates.yaml oder einer eigenen Datei mit --templates.`,
    );
  }
  if (imported.missingVariables.length > 0) {
    io.writeErr(
      `Hinweis: in aiqa.yaml fehlen probes.variables: ${imported.missingVariables.join(", ")}. Die Checks dazu fehlen, die Rubrik prüft trotzdem.`,
    );
  }
  if (!workspace.config.goldsets.some((ref) => path.resolve(workspace.dir, ref) === goldsetFile)) {
    io.writeOut(
      `Trage ${toPosix(path.relative(workspace.dir, goldsetFile))} unter goldsets in aiqa.yaml ein. Prüfen und freigeben in aiqa ui unter Entwürfe oder direkt in der Datei, danach aiqa plan.`,
    );
  }
  return goldsetFile;
}

/** A saved answer of the target: JSON, NDJSON or Server-Sent Events (issue #106). */
async function readSample(file: string, shown: string): Promise<SampleAnswer> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    throw new CliError(`Datei ${shown} nicht gefunden.`);
  }
  try {
    return parseSampleAnswer(content);
  } catch (error) {
    if (error instanceof CurlImportError) throw new CliError(`${shown}: ${error.message}`);
    throw error;
  }
}

/**
 * One call with the copied request, secrets only in memory; returns the answer as JSON or as
 * the events of a stream, told apart by the content type (issue #106).
 */
async function callOnce(request: ReturnType<typeof parseCurl>, io: CliIo): Promise<SampleAnswer> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: [
        ...request.headers,
        ...(request.cookies === undefined ? [] : [["cookie", request.cookies] as [string, string]]),
      ],
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new CliError(
      `Testaufruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  io.writeOut(
    `Testaufruf: HTTP ${String(response.status)}${contentType === "" ? "" : `, ${contentType}`}.`,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new CliError(
      `Das Zielsystem antwortet mit HTTP ${String(response.status)}. Ist das kopierte Token abgelaufen? Neu kopieren oder --response nutzen.`,
    );
  }
  try {
    return parseSampleAnswer(text, contentType);
  } catch (error) {
    if (error instanceof CurlImportError) throw new CliError(error.message);
    throw error;
  }
}

/**
 * `aiqa import curl --file <datei>` (issue #81): a draft of the target block from a request
 * copied in the browser. The draft never contains tokens, keys or cookies; with --apply it
 * replaces the target block of aiqa.yaml. Returns the path of the draft.
 */
async function importCurl(
  options: ImportCommandOptions,
  workspace: LoadedWorkspace,
  io: CliIo,
): Promise<string> {
  let command: string;
  try {
    command = await readFile(path.resolve(io.cwd, options.file), "utf8");
  } catch {
    throw new CliError(`Datei ${options.file} nicht gefunden.`);
  }
  let draft;
  try {
    const request = parseCurl(command);
    let sample: SampleAnswer | undefined;
    if (options.response !== undefined) {
      sample = await readSample(path.resolve(io.cwd, options.response), options.response);
    } else if (options.call === true) {
      sample = await callOnce(request, io);
    }
    if (sample?.format === "json") {
      for (const candidate of suggestResponsePaths(sample.payload).slice(0, 3)) {
        io.writeOut(`  Kandidat ${candidate.path}: ${candidate.excerpt}`);
      }
    } else if (sample !== undefined) {
      io.writeOut(
        `  Antwort als ${sample.format === "sse" ? "Server-Sent Events" : "NDJSON"} mit ${String(sample.events.length)} Ereignissen, Format und Ereignisfilter stehen im Entwurf.`,
      );
    }
    draft = draftTarget(request, {
      ...(options.question !== undefined ? { question: options.question } : {}),
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(sample?.format === "json" ? { response: sample.payload } : {}),
      ...(sample !== undefined && sample.format !== "json" ? { stream: sample } : {}),
    });
  } catch (error) {
    if (error instanceof CurlImportError) throw new CliError(error.message);
    throw error;
  }
  const target = TargetConfigSchema.parse(draft.target);
  const draftFile = path.join(workspace.dir, TARGET_DRAFT_FILE);
  await writeFile(
    draftFile,
    "# Entwurf aus einem Beispielaufruf (aiqa import curl). Prüfen, dann mit --apply übernehmen.\n" +
      stringify({ target: draft.target }),
    "utf8",
  );
  const shown = toPosix(path.relative(io.cwd, draftFile));
  io.writeOut(
    `Entwurf geschrieben: ${shown} (Zielsystem ${target.name}, ${target.request?.method ?? "POST"} ${target.endpoint ?? ""}).`,
  );
  for (const note of draft.notes) io.writeOut(`Hinweis: ${note}`);
  io.writeOut(
    `Die Datei ${options.file} enthält Zugangsdaten aus dem Browser. Lösche sie nach dem Import.`,
  );
  if (options.apply === true) {
    const document = parseDocument(await readFile(workspace.file, "utf8"));
    document.set("target", draft.target);
    await writeFile(workspace.file, document.toString(), "utf8");
    io.writeOut(
      `target in ${toPosix(path.relative(io.cwd, workspace.file))} ersetzt. Prüfen mit: aiqa validate`,
    );
  } else {
    io.writeOut(`Übernehmen nach Prüfung mit: aiqa import curl --file ${options.file} --apply`);
  }
  return draftFile;
}
