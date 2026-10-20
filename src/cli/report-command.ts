import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { toPosix } from "../io/files.js";
import {
  buildHandoverModel,
  HandoverHtmlRenderer,
  HandoverMarkdownRenderer,
  type HandoverModel,
} from "../report/handover.js";
import { HtmlRenderer } from "../report/html-renderer.js";
import { JUnitRenderer } from "../report/junit-renderer.js";
import {
  describeWithoutJudge,
  formatPercent,
  MarkdownRenderer,
} from "../report/markdown-renderer.js";
import {
  buildReportModel,
  type ReportModel,
  type TrendPoint,
  trendPoint,
} from "../report/report-model.js";
import type { Renderer, ReportRenderer } from "../report/report-renderer.js";
import { defaultTheme, type ReportTheme } from "../report/themes/default/theme.js";
import { reportThemes } from "../report/themes/index.js";
import { wirkmittelTheme } from "../report/themes/wirkmittel/theme.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, reportsDir, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface ReportCommandOptions {
  /** Run id or `latest`; two or more make a handover report (issue #87). */
  run: string | readonly string[];
  config?: string;
  out?: string;
  /** markdown (default) or html. */
  format?: string;
  /** Theme name; markdown uses default, html uses wirkmittel. */
  theme?: string;
}

const RENDERERS: Readonly<Record<string, () => ReportRenderer>> = {
  markdown: () => new MarkdownRenderer(),
  html: () => new HtmlRenderer(),
  junit: () => new JUnitRenderer(),
};

const DEFAULT_THEMES: Readonly<Record<string, ReportTheme>> = {
  markdown: defaultTheme,
  html: wirkmittelTheme,
  junit: defaultTheme,
};

/** Runs in the trend, the reported one included. */
export const TREND_LIMIT = 10;

function chooseRenderer(format: string): ReportRenderer {
  const create = RENDERERS[format];
  if (create === undefined) {
    throw new CliError(
      `Unbekanntes Format "${format}". Möglich sind: ${Object.keys(RENDERERS).join(", ")}.`,
    );
  }
  return create();
}

function chooseTheme(format: string, name: string | undefined): ReportTheme {
  if (name === undefined) return DEFAULT_THEMES[format] ?? defaultTheme;
  const theme = reportThemes[name];
  if (theme === undefined) {
    throw new CliError(
      `Unbekanntes Theme "${name}". Möglich sind: ${Object.keys(reportThemes).join(", ")}.`,
    );
  }
  return theme;
}

/** Trend points of the runs against the same target that started before this one. */
async function loadHistory(store: FileResultStore, run: Run, io: CliIo): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];
  for (const id of await store.listRuns()) {
    if (id === run.id) continue;
    try {
      const earlier = await store.readRun(id);
      if (earlier.target !== run.target || earlier.startedAt > run.startedAt) continue;
      const [verdicts, judgeFailures, iterations] = await Promise.all([
        store.readVerdicts(id),
        store.readJudgeFailures(id),
        store.readIterations(id),
      ]);
      points.push(trendPoint(earlier, verdicts, false, { judgeFailures, iterations }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.writeErr(`Hinweis: Lauf ${id} fehlt im Trend: ${message}`);
    }
  }
  return points.slice(-(TREND_LIMIT - 1));
}

/** Resolves `latest` to the id of the run that started last. */
export async function resolveRunId(
  store: FileResultStore,
  requested: string,
  dir: string,
): Promise<string> {
  if (requested !== "latest") return requested;
  const runs = await store.listRuns();
  const latest = runs.at(-1);
  if (latest === undefined) {
    throw new CliError(`Keine Läufe unter ${dir}. Starte zuerst einen Lauf mit "aiqa run".`);
  }
  return latest;
}

/** Case metadata from the workspace goldsets; a goldset that fails to load is reported. */
export async function loadCaseMetadata(
  workspace: LoadedWorkspace,
  io: CliIo,
): Promise<Map<string, TestCase>> {
  const cases = new Map<string, TestCase>();
  for (const ref of workspace.config.goldsets) {
    try {
      const goldset = await loadGoldset(path.resolve(workspace.dir, ref));
      for (const testCase of goldset.cases) cases.set(testCase.id, testCase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.writeErr(
        `Hinweis: Goldset ${ref} konnte nicht geladen werden, Fallangaben fehlen im Report: ${message}`,
      );
    }
  }
  return cases;
}

/**
 * Loads everything a report of one run needs from the store and the goldsets: iterations,
 * verdicts, findings, case metadata and the trend of earlier runs. Shared by CLI and UI.
 */
export async function loadReportModel(
  workspace: LoadedWorkspace,
  store: FileResultStore,
  runId: string,
  io: CliIo,
): Promise<ReportModel> {
  let run: Run;
  try {
    run = await store.readRun(runId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const [iterations, verdicts, findings, judgeFailures, binding] = await Promise.all([
    store.readIterations(runId),
    store.readVerdicts(runId),
    store.readFindings(runId),
    store.readJudgeFailures(runId),
    store.readRunBinding(runId),
  ]);
  const cases = await loadCaseMetadata(workspace, io);
  const history = await loadHistory(store, run, io);
  return buildReportModel({
    run,
    iterations,
    verdicts,
    cases,
    history,
    findings,
    judgeFailures,
    ...(binding !== null ? { binding } : {}),
  });
}

/** Renders the model in one format and writes it; returns the file. Shared by CLI and UI. */
export async function writeReport(
  workspace: LoadedWorkspace,
  model: ReportModel,
  format: string,
  themeName?: string,
  out?: string,
): Promise<string> {
  const renderer = chooseRenderer(format);
  const theme = chooseTheme(format, themeName);
  const outFile =
    out ?? path.join(reportsDir(workspace), `${model.run.id}.${renderer.fileExtension}`);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, renderer.render(model, theme), "utf8");
  return outFile;
}

const HANDOVER_RENDERERS: Readonly<Record<string, () => Renderer<HandoverModel>>> = {
  markdown: () => new HandoverMarkdownRenderer(),
  html: () => new HandoverHtmlRenderer(),
};

/**
 * `aiqa report --run <a> --run <b>`: one handover report over several runs of one target
 * (issue #87, ADR 0020), as Markdown or HTML.
 */
async function executeHandover(
  options: ReportCommandOptions,
  requested: readonly string[],
  format: string,
  io: CliIo,
): Promise<HandoverModel> {
  const create = HANDOVER_RENDERERS[format];
  if (create === undefined) {
    throw new CliError(
      `Ein Übergabe-Report entsteht als markdown oder html. JUnit gibt es nur für einen Lauf.`,
    );
  }
  const renderer = create();
  const theme = chooseTheme(format, options.theme);
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  const runIds = [
    ...new Set(
      await Promise.all(requested.map((id) => resolveRunId(store, id, runsDir(workspace)))),
    ),
  ];
  const reports = [];
  for (const runId of runIds) reports.push(await loadReportModel(workspace, store, runId, io));
  let model: HandoverModel;
  try {
    model = buildHandoverModel({ reports });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const newest = model.runs.at(-1)?.id ?? "lauf";
  const outFile =
    options.out === undefined
      ? path.join(reportsDir(workspace), `uebergabe-${newest}.${renderer.fileExtension}`)
      : path.resolve(io.cwd, options.out);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, renderer.render(model, theme), "utf8");
  io.writeOut(`Übergabe-Report geschrieben: ${toPosix(path.relative(io.cwd, outFile))}`);
  for (const sentence of model.keyStatement.slice(0, 3)) io.writeOut(sentence);
  return model;
}

/**
 * `aiqa report --run <id>`: builds the Markdown, HTML or JUnit report for one run. With more
 * than one run it builds the handover report instead.
 */
export async function executeReport(options: ReportCommandOptions, io: CliIo): Promise<void> {
  const format = options.format ?? "markdown";
  const requested = typeof options.run === "string" ? [options.run] : [...options.run];
  if (requested.length > 1) {
    await executeHandover(options, requested, format, io);
    return;
  }
  chooseRenderer(format);
  chooseTheme(format, options.theme);
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  const runId = await resolveRunId(store, requested[0] ?? "latest", runsDir(workspace));
  const model = await loadReportModel(workspace, store, runId, io);
  const outFile = await writeReport(
    workspace,
    model,
    format,
    options.theme,
    options.out === undefined ? undefined : path.resolve(io.cwd, options.out),
  );

  io.writeOut(`Report geschrieben: ${toPosix(path.relative(io.cwd, outFile))}`);
  const { totals } = model;
  io.writeOut(
    totals.passRate === null
      ? "Kein Urteil vorhanden."
      : `Bestanden: ${String(totals.passedIterations)} von ${String(totals.judgedIterations)} Iterationen (${formatPercent(totals.passRate)}), ${String(totals.flakyCases)} Fälle mit Schwankung.` +
          (totals.correctedPassRate === null || totals.correctedPassedIterations === null
            ? ""
            : ` Bereinigt um verworfene Befunde: ${String(totals.correctedPassedIterations)} von ${String(totals.judgedIterations)} (${formatPercent(totals.correctedPassRate)}).`),
  );
  const withoutJudge = describeWithoutJudge(totals);
  if (withoutJudge !== null) io.writeOut(`Ohne Judge-Urteil: ${withoutJudge}.`);
}
