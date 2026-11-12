import path from "node:path";

import { createDefaultChecks } from "../checks/run-checks.js";
import type { TestCase } from "../domain/test-case.js";
import { bindForRun } from "../fixtures/placeholders.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { type RecheckSummary, recheckRun } from "../runner/recheck.js";
import { FileResultStore } from "../store/file-result-store.js";
import { requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";
import { executeReport } from "./report-command.js";

export interface CheckCommandOptions {
  /** Run id or `latest`. */
  run: string;
  config?: string;
}

/**
 * `aiqa check --run <id>`: rates the stored answers of a run again with the deterministic
 * checks and the goldsets of today, without a call to the target (issue #121, ADR 0026). The
 * result is a new run with its own report; the run it comes from stays as it is.
 */
export async function executeCheck(
  options: CheckCommandOptions,
  io: CliIo,
): Promise<RecheckSummary> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  let sourceRunId = options.run;
  if (sourceRunId === "latest") {
    const latest = (await store.listRuns()).at(-1);
    if (latest === undefined) throw new CliError("Keine Läufe vorhanden.");
    sourceRunId = latest;
  }

  const cases = new Map<string, TestCase>();
  const goldsetVersions = new Map<string, string>();
  for (const ref of workspace.config.goldsets) {
    const goldset = await loadGoldset(path.resolve(workspace.dir, ref));
    goldsetVersions.set(goldset.id, goldset.version);
    for (const testCase of goldset.cases) cases.set(testCase.id, testCase);
  }

  let summary: RecheckSummary;
  try {
    // Placeholders take the values the run used, a case without them keeps its verdicts.
    const bound = bindForRun(cases, await store.readRunBinding(sourceRunId));
    summary = await recheckRun({
      store,
      sourceRunId,
      cases: bound.cases,
      goldsetVersions,
      checks: createDefaultChecks({
        maxLatencyMs: workspace.config.target.expectations.maxLatencyMs,
      }),
    });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }

  const total = String(summary.iterations);
  io.writeOut(
    `Nachgerechnet als Lauf ${summary.runId}: ${total} Iterationen aus Lauf ${sourceRunId}, kein Aufruf an das Zielsystem.`,
  );
  io.writeOut(
    `${String(summary.passed)} von ${total} Iterationen bestanden, ${String(summary.nowFailing)} bestehen nicht mehr, ${String(summary.nowPassing)} bestehen jetzt.`,
  );
  if (summary.unknownCases.length > 0) {
    io.writeErr(
      `Hinweis: ohne Fall im Goldset oder ohne Wert für einen Platzhalter, Urteile unverändert übernommen: ${summary.unknownCases.join(", ")}`,
    );
  }
  if (summary.withoutJudge > 0) {
    io.writeErr(
      `Hinweis: ${String(summary.withoutJudge)} Iterationen bestehen die Checks und haben kein Judge-Urteil. Ergänzen mit: aiqa judge --run ${summary.runId}`,
    );
  }
  await executeReport(
    { run: [summary.runId], ...(options.config !== undefined ? { config: options.config } : {}) },
    io,
  );
  io.writeOut(
    `Vergleich mit dem Quelllauf: aiqa compare --base ${sourceRunId} --head ${summary.runId}`,
  );
  return summary;
}
