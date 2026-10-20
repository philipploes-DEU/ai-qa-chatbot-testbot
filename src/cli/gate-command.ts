import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { toPosix } from "../io/files.js";
import { type ComparisonModel, compareRuns } from "../report/compare.js";
import { evaluateGates, type GateEvaluation } from "../report/gates.js";
import { buildReportModel, type ReportModel } from "../report/report-model.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, reportsDir, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface GateCommandOptions {
  /** Run id or latest. */
  run: string;
  /** Base run for the regression gate: id, previous, or omitted. */
  base?: string;
  /** JSON file with the evaluation; default reports/gate-<run>.json. */
  json?: string;
  config?: string;
}

async function loadCases(workspace: LoadedWorkspace): Promise<Map<string, TestCase>> {
  const cases = new Map<string, TestCase>();
  for (const ref of workspace.config.goldsets) {
    try {
      const goldset = await loadGoldset(path.resolve(workspace.dir, ref));
      for (const testCase of goldset.cases) cases.set(testCase.id, testCase);
    } catch {
      // Without metadata the critical gate cannot see severities; the run itself still gates.
    }
  }
  return cases;
}

async function loadModel(
  store: FileResultStore,
  runId: string,
  cases: ReadonlyMap<string, TestCase>,
): Promise<ReportModel> {
  let run: Run;
  try {
    run = await store.readRun(runId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const [iterations, verdicts, judgeFailures] = await Promise.all([
    store.readIterations(runId),
    store.readVerdicts(runId),
    store.readJudgeFailures(runId),
  ]);
  return buildReportModel({ run, iterations, verdicts, cases, judgeFailures });
}

/**
 * `aiqa gate --run <id> [--base <id>]`: checks the gates of aiqa.yaml against a run and ends
 * with exit code 1 when one breaks, so a scheduled job fails (issue #14). The regression gate
 * needs a base run; without one it is skipped and said so.
 */
export async function executeGate(options: GateCommandOptions, io: CliIo): Promise<GateEvaluation> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const gates = workspace.config.gates;
  if (gates === undefined || Object.keys(gates).length === 0) {
    throw new CliError(
      "Keine Gates konfiguriert. Ergänze in aiqa.yaml einen gates-Block, zum Beispiel minPassRate: 0.9.",
    );
  }
  const store = new FileResultStore(runsDir(workspace));
  const runs = await store.listRuns();
  const runId = options.run === "latest" ? runs.at(-1) : options.run;
  if (runId === undefined) throw new CliError("Keine Läufe vorhanden.");

  let baseId: string | undefined;
  if (options.base !== undefined) {
    if (options.base === "previous") {
      const position = runs.indexOf(runId);
      baseId = position > 0 ? runs[position - 1] : runs.filter((id) => id !== runId).at(-1);
      if (baseId === undefined)
        io.writeErr("Hinweis: kein früherer Lauf, Regression nicht messbar.");
    } else {
      baseId = options.base;
    }
  }

  const cases = await loadCases(workspace);
  const head = await loadModel(store, runId, cases);
  let comparison: ComparisonModel | undefined;
  if (baseId !== undefined && baseId !== runId) {
    comparison = compareRuns(await loadModel(store, baseId, cases), head);
  }
  const evaluation = evaluateGates(gates, head, comparison);

  io.writeOut(`Gates für Lauf ${runId}${baseId === undefined ? "" : ` gegen ${baseId}`}:`);
  for (const result of evaluation.results) {
    const mark = result.pass === null ? "OFFEN " : result.pass ? "OK    " : "REISST";
    io.writeOut(
      `  ${mark} ${result.name}: ${result.reason} (Grenze ${result.limit}, Wert ${result.actual})`,
    );
  }
  io.writeOut(
    evaluation.pass
      ? `Alle Gates bestanden${evaluation.skipped.length > 0 ? `, nicht messbar: ${evaluation.skipped.join(", ")}` : ""}.`
      : "Mindestens ein Gate reißt, der Lauf gilt als gescheitert.",
  );

  const jsonFile =
    options.json === undefined
      ? path.join(reportsDir(workspace), `gate-${runId}.json`)
      : path.resolve(io.cwd, options.json);
  await mkdir(path.dirname(jsonFile), { recursive: true });
  await writeFile(
    jsonFile,
    `${JSON.stringify({ run: runId, base: baseId ?? null, ...evaluation }, null, 2)}\n`,
    "utf8",
  );
  io.writeOut(`Ergebnis: ${toPosix(path.relative(io.cwd, jsonFile))}`);
  return evaluation;
}
