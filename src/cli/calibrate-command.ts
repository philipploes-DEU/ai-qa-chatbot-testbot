import path from "node:path";

import type { CalibrationResult } from "../domain/calibration.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { toPosix } from "../io/files.js";
import { calibrateJudge } from "../judge/calibrate.js";
import { createJudge } from "../judge/create-judge.js";
import { describeKappa } from "../stats/kappa.js";
import { FileResultStore } from "../store/file-result-store.js";
import { requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";
import { loadJudgeSources } from "./judge-sources.js";

export interface CalibrateCommandOptions {
  /** Goldset files to calibrate; all goldsets of the workspace with a calibration set otherwise. */
  goldset?: string[];
  config?: string;
}

function formatKappa(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/**
 * `aiqa calibrate`: runs the judge of aiqa.yaml over the calibration set of each goldset,
 * compares with the human labels, stores the result next to the runs and says whether the
 * judge is released for the goldset (issue #11). Every sample is a model call.
 */
export async function executeCalibrate(
  options: CalibrateCommandOptions,
  io: CliIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CalibrationResult[]> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  if (workspace.config.judge === undefined) {
    throw new CliError(
      "Kein Judge konfiguriert. Ergänze in aiqa.yaml einen judge-Block mit baseUrl und model.",
    );
  }
  const judge = createJudge(workspace.config.judge, env);
  const store = new FileResultStore(runsDir(workspace));
  const files =
    options.goldset !== undefined && options.goldset.length > 0
      ? options.goldset.map((file) => path.resolve(io.cwd, file))
      : workspace.config.goldsets.map((ref) => path.resolve(workspace.dir, ref));

  const results: CalibrationResult[] = [];
  for (const file of files) {
    const goldset = await loadGoldset(file);
    const display = toPosix(path.relative(io.cwd, file));
    if (goldset.calibration === undefined) {
      io.writeOut(`${display}: kein Kalibrierungsset, übersprungen.`);
      continue;
    }
    io.writeOut(
      `Kalibriere Judge ${judge.model} (Prompt ${judge.promptVersion}) an ${display}, ${String(goldset.calibration.samples.length)} Stichproben.`,
    );
    const sources = await loadJudgeSources(
      [{ goldset, file }],
      judge,
      workspace.config.judge.maxSourceChars,
    );
    for (const line of sources.lines) io.writeOut(`  ${line}`);
    for (const note of sources.notes) io.writeErr(`  Hinweis: ${note}`);
    const result = await calibrateJudge(judge, goldset, {
      ...(sources.byGoldset.has(goldset.id) ? { sources: sources.byGoldset.get(goldset.id) } : {}),
      onSample: (sample, error) => {
        const mark = sample.human === sample.judge ? "OK    " : "ANDERS";
        io.writeOut(
          `  ${mark} ${sample.caseId}: Mensch ${sample.human ? "pass" : "fail"}, Judge ${sample.judge ? "pass" : "fail"}${error === undefined ? "" : `, Judge-Fehler: ${error}`}`,
        );
      },
    });
    await store.writeCalibration(result);
    results.push(result);
    io.writeOut(
      `  Kappa ${formatKappa(result.kappa)} (${describeKappa(result.kappa)}), Übereinstimmung ${String(Math.round(result.agreement * 100))} %, Schwelle ${formatKappa(result.minKappa)}: ` +
        (result.released
          ? `Judge für ${goldset.id} freigegeben.`
          : `Judge für ${goldset.id} NICHT freigegeben.`),
    );
  }
  if (results.length === 0) {
    throw new CliError(
      "Kein Goldset mit Kalibrierungsset gefunden. Ergänze calibration.samples mit menschlichen Labels.",
    );
  }
  return results;
}
