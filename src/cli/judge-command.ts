import path from "node:path";

import type { Iteration } from "../domain/iteration.js";
import type { TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { createJudge } from "../judge/create-judge.js";
import { judgeFailureOf } from "../judge/judge-failure.js";
import { bindForRun } from "../fixtures/placeholders.js";
import { judgeFailureLabel } from "../report/markdown-renderer.js";
import { judgeIteration } from "../judge/judge-iteration.js";
import type { Judge } from "../judge/judge.js";
import { FileResultStore } from "../store/file-result-store.js";
import { type LoadedWorkspace, requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";
import type { SourceDocument } from "../judge/sources.js";
import { type GoldsetFile, loadJudgeSources } from "./judge-sources.js";

export interface JudgeCommandOptions {
  /** Run id or `latest`. */
  run: string;
  config?: string;
}

export interface JudgeRunSummary {
  judged: number;
  skipped: number;
  errors: number;
  /** Iterations the judge model refused to rate (issue #83). */
  refusals: number;
}

async function loadGoldsets(workspace: LoadedWorkspace): Promise<GoldsetFile[]> {
  const entries: GoldsetFile[] = [];
  for (const ref of workspace.config.goldsets) {
    const file = path.resolve(workspace.dir, ref);
    entries.push({ goldset: await loadGoldset(file), file });
  }
  return entries;
}

/** An iteration gets a judge verdict when it answered, passed every check and has none yet. */
export function needsJudgeVerdict(
  iteration: Iteration,
  verdicts: readonly Verdict[],
  judge: Judge,
  testCase: TestCase | undefined,
): boolean {
  if (iteration.response === null || testCase === undefined) return false;
  if (testCase.kind !== "dialog" && !judge.applies(testCase, iteration.response)) return false;
  const own = verdicts.filter(
    (verdict) => verdict.caseId === iteration.caseId && verdict.index === iteration.index,
  );
  if (own.some((verdict) => verdict.source === "judge")) return false;
  return own.every((verdict) => verdict.pass);
}

/**
 * `aiqa judge --run <id>`: adds judge verdicts to a finished run, for iterations that the
 * deterministic checks did not decide. Useful when the run had no judge configured or a new
 * prompt version should rate the same answers.
 */
export async function executeJudge(
  options: JudgeCommandOptions,
  io: CliIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<JudgeRunSummary> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  if (workspace.config.judge === undefined) {
    throw new CliError(
      "Kein Judge konfiguriert. Ergänze in aiqa.yaml einen judge-Block mit baseUrl und model.",
    );
  }
  const store = new FileResultStore(runsDir(workspace));
  let runId = options.run;
  if (runId === "latest") {
    const latest = (await store.listRuns()).at(-1);
    if (latest === undefined) throw new CliError("Keine Läufe vorhanden.");
    runId = latest;
  }
  let iterations: Iteration[];
  let verdicts: Verdict[];
  try {
    await store.readRun(runId);
    [iterations, verdicts] = await Promise.all([
      store.readIterations(runId),
      store.readVerdicts(runId),
    ]);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }

  const judge = createJudge(workspace.config.judge, env);
  const goldsets = await loadGoldsets(workspace);
  const cases = new Map<string, TestCase>();
  const sourcesByCase = new Map<string, SourceDocument[]>();
  const sources = await loadJudgeSources(goldsets, judge, workspace.config.judge.maxSourceChars);
  for (const note of sources.notes) io.writeErr(`Hinweis: ${note}`);
  for (const { goldset } of goldsets) {
    const documents = sources.byGoldset.get(goldset.id);
    for (const testCase of goldset.cases) {
      cases.set(testCase.id, testCase);
      if (documents !== undefined) sourcesByCase.set(testCase.id, documents);
    }
  }
  // Placeholders take the values the run used, a case without them is skipped (ADR 0022).
  const bound = bindForRun(cases, await store.readRunBinding(runId));
  if (bound.skipped.length > 0) {
    io.writeErr(
      `Hinweis: ${bound.skipped.join(", ")} übersprungen, ihre Platzhalter haben in diesem Lauf keinen Wert.`,
    );
  }
  cases.clear();
  for (const [id, testCase] of bound.cases) cases.set(id, testCase);
  io.writeOut(
    `Judge ${judge.model} (Prompt ${judge.promptVersion}) bewertet Lauf ${runId}, ${String(iterations.length)} Iterationen.`,
  );

  const summary: JudgeRunSummary = { judged: 0, skipped: 0, errors: 0, refusals: 0 };
  for (const iteration of iterations) {
    const testCase = cases.get(iteration.caseId);
    if (!needsJudgeVerdict(iteration, verdicts, judge, testCase) || testCase === undefined) {
      summary.skipped++;
      continue;
    }
    try {
      const rated = await judgeIteration(
        judge,
        testCase,
        { content: iteration.response ?? "", latencyMs: iteration.latencyMs },
        iteration.rounds,
        sourcesByCase.get(iteration.caseId),
      );
      for (const verdict of rated.verdicts) {
        await store.appendVerdict({
          ...verdict,
          runId,
          caseId: iteration.caseId,
          index: iteration.index,
        });
      }
      summary.judged++;
    } catch (error) {
      const failure = judgeFailureOf(error, judge, testCase, iteration.response ?? "", {
        runId,
        index: iteration.index,
      });
      await store.appendJudgeFailure(failure);
      if (failure.kind === "refusal") summary.refusals++;
      else summary.errors++;
      io.writeErr(
        `  ${iteration.caseId}/${String(iteration.index)}: ${judgeFailureLabel(failure.kind)}: ${failure.reason}`,
      );
    }
  }
  io.writeOut(
    `${String(summary.judged)} Urteile ergänzt, ${String(summary.skipped)} Iterationen übersprungen, ${String(summary.errors)} Fehler, ${String(summary.refusals)} Ablehnungen durch den Judge.`,
  );
  io.writeOut(`Report erzeugen mit: aiqa report --run ${runId}`);
  return summary;
}
