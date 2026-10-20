import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PairVerdict } from "../domain/pair-verdict.js";
import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { createJudge } from "../judge/create-judge.js";
import { judgePair } from "../judge/pairwise.js";
import { bindForRun, sameBoundValues } from "../fixtures/placeholders.js";
import { changedBindings } from "../fixtures/resolve.js";
import { toPosix } from "../io/files.js";
import {
  type ComparisonModel,
  compareRuns,
  renderComparisonMarkdown,
  summarizePairs,
} from "../report/compare.js";
import { formatNumber, formatPercent } from "../report/markdown-renderer.js";
import { buildReportModel, type ReportModel } from "../report/report-model.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, reportsDir, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface CompareCommandOptions {
  base: string;
  head: string;
  /** Markdown file; default reports/<base>--<head>.md. */
  out?: string;
  /** JSON file for machine readers such as the gates of issue #14. */
  json?: string;
  /** Let the judge compare the answers of both runs pairwise, in both orders (issue #10). */
  pairwise?: boolean;
  config?: string;
}

async function loadCases(workspace: LoadedWorkspace): Promise<Map<string, TestCase>> {
  const cases = new Map<string, TestCase>();
  for (const ref of workspace.config.goldsets) {
    try {
      const goldset = await loadGoldset(path.resolve(workspace.dir, ref));
      for (const testCase of goldset.cases) cases.set(testCase.id, testCase);
    } catch {
      // Case metadata is a nicety for the comparison; a missing goldset is not an error here.
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

async function resolveRunId(store: FileResultStore, requested: string): Promise<string> {
  if (requested !== "latest" && requested !== "previous") return requested;
  const runs = await store.listRuns();
  const picked = requested === "latest" ? runs.at(-1) : runs.at(-2);
  if (picked === undefined) {
    throw new CliError(`Zu wenige Läufe für "${requested}", vorhanden: ${String(runs.length)}.`);
  }
  return picked;
}

function points(value: number | null): string {
  if (value === null) return "kein Urteil";
  const text = `${formatNumber(Math.abs(value) * 100, 1)} Punkte`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : "0,0 Punkte";
}

/**
 * `aiqa compare --base <lauf> --head <lauf>`: compares two runs over their common cases and
 * writes the result as Markdown and, on request, as JSON (issue #15). `latest` and `previous`
 * pick the newest runs.
 */
export async function executeCompare(
  options: CompareCommandOptions,
  io: CliIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ComparisonModel> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  const baseId = await resolveRunId(store, options.base);
  const headId = await resolveRunId(store, options.head);
  if (baseId === headId) throw new CliError("Base und Head sind derselbe Lauf.");
  const cases = await loadCases(workspace);
  const [base, head] = await Promise.all([
    loadModel(store, baseId, cases),
    loadModel(store, headId, cases),
  ]);
  const comparison = compareRuns(base, head);
  const [baseBinding, headBinding] = await Promise.all([
    store.readRunBinding(baseId),
    store.readRunBinding(headId),
  ]);
  const bindingChanges = changedBindings(baseBinding, headBinding);
  if (bindingChanges.length > 0) {
    comparison.bindingChanges = bindingChanges;
    io.writeErr(
      `Hinweis: ${bindingChanges.map((change) => change.placeholder).join(", ")} hatten in Base und Head verschiedene Werte.`,
    );
  }

  if (options.pairwise === true) {
    if (workspace.config.judge === undefined) {
      throw new CliError(
        "Der Paarvergleich braucht einen Judge. Ergänze in aiqa.yaml einen judge-Block.",
      );
    }
    const judge = createJudge(workspace.config.judge, env);
    const [baseIterations, headIterations] = await Promise.all([
      store.readIterations(baseId),
      store.readIterations(headId),
    ]);
    // Answers compare only when both runs asked the same: same values for every placeholder.
    const bound = bindForRun(cases, headBinding);
    const ran = new Set([...baseIterations, ...headIterations].map((entry) => entry.caseId));
    const differing = [...cases.values()]
      .filter((testCase) => ran.has(testCase.id))
      .filter((testCase) => !sameBoundValues(testCase, baseBinding, headBinding))
      .map((testCase) => testCase.id);
    if (differing.length > 0) {
      io.writeErr(
        `Hinweis: ${differing.join(", ")} ohne Paarvergleich, die Platzhalter haben in beiden Läufen nicht dieselben Werte.`,
      );
    }
    const headByKey = new Map(
      headIterations.map((iteration) => [
        `${iteration.caseId}#${String(iteration.index)}`,
        iteration,
      ]),
    );
    const verdicts: PairVerdict[] = [];
    let tokens = 0;
    for (const baseIteration of baseIterations) {
      const headIteration = headByKey.get(`${baseIteration.caseId}#${String(baseIteration.index)}`);
      const testCase = differing.includes(baseIteration.caseId)
        ? undefined
        : bound.cases.get(baseIteration.caseId);
      if (
        headIteration === undefined ||
        testCase === undefined ||
        baseIteration.response === null ||
        headIteration.response === null
      ) {
        continue;
      }
      try {
        const outcome = await judgePair(
          judge,
          testCase,
          baseIteration.response,
          headIteration.response,
        );
        tokens += outcome.tokens.input + outcome.tokens.output;
        verdicts.push({
          ...outcome.verdict,
          baseRunId: baseId,
          headRunId: headId,
          caseId: baseIteration.caseId,
          index: baseIteration.index,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.writeErr(
          `  ${baseIteration.caseId}/${String(baseIteration.index)}: Paarvergleich fehlgeschlagen: ${message}`,
        );
      }
    }
    comparison.pairwise = summarizePairs(
      verdicts,
      `${judge.model} (Prompt ${judge.promptVersion})`,
    );
    const pairsFile = path.join(reportsDir(workspace), `${baseId}--${headId}.pairs.jsonl`);
    await mkdir(path.dirname(pairsFile), { recursive: true });
    await writeFile(
      pairsFile,
      verdicts.map((verdict) => JSON.stringify(verdict)).join("\n") + "\n",
      "utf8",
    );
    io.writeOut(
      `Paarvergleich: ${String(verdicts.length)} Paare, ${String(verdicts.length * 2)} Judge-Aufrufe, ${String(tokens)} Tokens. Head besser ${String(comparison.pairwise.counts.head)}, Base besser ${String(comparison.pairwise.counts.base)}, gleich ${String(comparison.pairwise.counts.tie)}, unentschieden ${String(comparison.pairwise.counts.undecided)}.`,
    );
    io.writeOut(`Paarurteile: ${toPosix(path.relative(io.cwd, pairsFile))}`);
  }

  const outFile =
    options.out === undefined
      ? path.join(reportsDir(workspace), `${baseId}--${headId}.md`)
      : path.resolve(io.cwd, options.out);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, renderComparisonMarkdown(comparison), "utf8");
  io.writeOut(`Vergleich geschrieben: ${toPosix(path.relative(io.cwd, outFile))}`);
  if (options.json !== undefined) {
    const jsonFile = path.resolve(io.cwd, options.json);
    await mkdir(path.dirname(jsonFile), { recursive: true });
    await writeFile(jsonFile, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
    io.writeOut(`JSON geschrieben: ${toPosix(path.relative(io.cwd, jsonFile))}`);
  }

  const { totals } = comparison;
  io.writeOut(
    `${String(totals.commonCases)} gemeinsame Fälle: Pass-Rate ${totals.passRate.base === null ? "kein Urteil" : formatPercent(totals.passRate.base)} zu ${totals.passRate.head === null ? "kein Urteil" : formatPercent(totals.passRate.head)} (${points(totals.passRate.delta)}), ` +
      `${String(totals.improved)} verbessert, ${String(totals.regressed)} verschlechtert, ${String(totals.newFailures)} neue und ${String(totals.vanishedFailures)} verschwundene Fehlschläge.`,
  );
  for (const change of comparison.versionChanges) io.writeErr(`Hinweis: ${change}`);
  if (totals.differentIterations > 0) {
    io.writeErr(
      `Hinweis: ${String(totals.differentIterations)} Fälle haben in den Läufen verschiedene Iterationszahlen.`,
    );
  }
  return comparison;
}
