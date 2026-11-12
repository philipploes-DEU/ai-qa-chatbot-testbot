import type { Check, CheckResult } from "../checks/check.js";
import { runChecks } from "../checks/run-checks.js";
import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import type { ResultStore } from "../store/result-store.js";
import { generateRunId } from "./run-plan.js";

export interface RecheckOptions {
  store: ResultStore;
  /** The finished run whose answers are rated again. */
  sourceRunId: string;
  /** The cases of today by id, placeholders filled with the binding of the source run. */
  cases: ReadonlyMap<string, TestCase>;
  /** Versions of the goldsets of today by id; a goldset not listed keeps its version. */
  goldsetVersions: ReadonlyMap<string, string>;
  checks: readonly Check[];
  now?: () => Date;
  /** Id of the new run; generated from the time when absent. */
  runId?: string;
}

export interface RecheckSummary {
  runId: string;
  sourceRunId: string;
  iterations: number;
  /** Iterations whose checks were computed again. */
  rechecked: number;
  /** Iterations with a verdict that pass every verdict of the new run. */
  passed: number;
  /** Iterations that passed in the source and fail now, and the other way round. */
  nowFailing: number;
  nowPassing: number;
  /** Iterations that pass the checks now, would get a judge verdict and have none. */
  withoutJudge: number;
  /** Cases with iterations that the goldsets of today do not have; their verdicts are kept. */
  unknownCases: string[];
}

/**
 * Criteria about the call itself, not about the answer: a failed call and a capture that found
 * nothing. The stored iteration does not hold what they need, so they are kept as they are.
 */
const CALL_CRITERIA = new Set(["response", "capture"]);

function isCallVerdict(verdict: Verdict): boolean {
  return (
    verdict.source === "check" &&
    verdict.criteria.every((criterion) => CALL_CRITERIA.has(criterion.name))
  );
}

function single(name: string, pass: boolean, reason: string): CheckResult {
  return {
    source: "check",
    pass,
    criteria: [{ name, pass, reason }],
    reasoning: `${name}: ${reason}`,
  };
}

/** The check verdicts of one stored iteration under the case of today, as the runner writes them. */
function checkResults(
  checks: readonly Check[],
  testCase: TestCase,
  iteration: Iteration,
  kept: readonly Verdict[],
  judge: boolean,
): CheckResult[] {
  const callVerdicts = kept
    .filter(isCallVerdict)
    .map(({ source, pass, criteria, reasoning }): CheckResult => ({
      source,
      pass,
      criteria,
      reasoning,
    }));
  if (iteration.response === null) {
    const expected = testCase.expected.status;
    // A refusal with the status the case expects is the wanted behaviour (issue #79).
    if (expected !== undefined && iteration.status === expected) {
      return [single("status", true, `erwarteter Status ${String(expected)} erhalten`)];
    }
    const failed = callVerdicts.filter((result) => !result.pass);
    if (failed.length > 0) return failed;
    const status = iteration.status === undefined ? "" : `, HTTP ${String(iteration.status)}`;
    return [single("response", false, iteration.error ?? `Aufruf ohne Antwort${status}`)];
  }
  return [
    ...runChecks(
      checks,
      testCase,
      {
        content: iteration.response,
        latencyMs: iteration.latencyMs,
        ...(iteration.status !== undefined ? { status: iteration.status } : {}),
        ...(iteration.tokens !== undefined ? { tokens: iteration.tokens } : {}),
      },
      { judge },
    ),
    ...callVerdicts,
  ];
}

function refOf(entry: { caseId: string; index: number }): string {
  return `${entry.caseId}#${String(entry.index)}`;
}

/**
 * Rates the stored answers of a finished run again with the deterministic checks and the cases
 * of today (issue #121, ADR 0026). The result is a new run: the iterations, judge verdicts,
 * judge failures and the binding of the source are copied, the check verdicts are new, and a
 * warning names the source. The source run stays as it is, no call reaches the target.
 */
export async function recheckRun(options: RecheckOptions): Promise<RecheckSummary> {
  const { store, sourceRunId, cases } = options;
  const now = options.now ?? ((): Date => new Date());
  const source = await store.readRun(sourceRunId);
  if (source.finishedAt === undefined) {
    throw new Error(`Lauf ${sourceRunId} ist nicht beendet, nachrechnen geht erst danach`);
  }
  const [iterations, verdicts, judgeFailures, binding] = await Promise.all([
    store.readIterations(sourceRunId),
    store.readVerdicts(sourceRunId),
    store.readJudgeFailures(sourceRunId),
    store.readRunBinding(sourceRunId),
  ]);

  const runId = options.runId ?? generateRunId(now());
  const ran = [...new Set(iterations.map((iteration) => iteration.caseId))];
  const unknownCases = ran.filter((caseId) => !cases.has(caseId));
  const oldDrafts = new Set(source.draftCases ?? []);
  const draftCases = ran.filter((caseId) => {
    const testCase = cases.get(caseId);
    return testCase === undefined ? oldDrafts.has(caseId) : testCase.status === "draft";
  });
  const warnings = [
    ...(source.warnings ?? []),
    `Nachgerechnet aus Lauf ${sourceRunId} vom ${source.startedAt.slice(0, 10)}: Die Antworten stammen aus diesem Lauf, die Checks sind mit den Goldsets von heute neu gerechnet, Judge-Urteile sind unverändert übernommen.`,
    ...(unknownCases.length > 0
      ? [`Ohne Fall im Goldset, Urteile unverändert aus dem Quelllauf: ${unknownCases.join(", ")}`]
      : []),
  ];
  const {
    finishedAt: _finishedAt,
    status: _status,
    abortReason: _abortReason,
    usage: _usage,
    draftCases: _draftCases,
    ...kept
  } = source;
  const startedAt = now().toISOString();
  const run: Run = {
    ...kept,
    id: runId,
    startedAt,
    goldsets: source.goldsets.map((goldset) => ({
      ...goldset,
      version: options.goldsetVersions.get(goldset.id) ?? goldset.version,
    })),
    ...(draftCases.length > 0 ? { draftCases } : {}),
    warnings,
  };
  await store.createRun(run);
  if (binding !== null) await store.writeRunBinding(runId, binding);

  const verdictsOf = new Map<string, Verdict[]>();
  for (const verdict of verdicts) {
    const list = verdictsOf.get(refOf(verdict));
    if (list === undefined) verdictsOf.set(refOf(verdict), [verdict]);
    else list.push(verdict);
  }

  const summary: RecheckSummary = {
    runId,
    sourceRunId,
    iterations: iterations.length,
    rechecked: 0,
    passed: 0,
    nowFailing: 0,
    nowPassing: 0,
    withoutJudge: 0,
    unknownCases,
  };
  for (const iteration of iterations) {
    await store.appendIteration({ ...iteration, runId });
    const old = verdictsOf.get(refOf(iteration)) ?? [];
    const testCase = cases.get(iteration.caseId);
    const judged = old.filter((verdict) => verdict.source === "judge");
    let fresh: Verdict[];
    if (testCase === undefined) {
      fresh = old.map((verdict) => ({ ...verdict, runId }));
    } else {
      const results = checkResults(
        options.checks,
        testCase,
        iteration,
        old,
        source.judge !== undefined,
      );
      fresh = [
        ...results.map((result) => ({
          ...result,
          runId,
          caseId: iteration.caseId,
          index: iteration.index,
        })),
        ...judged.map((verdict) => ({ ...verdict, runId })),
      ];
      summary.rechecked++;
      const checksPass = results.every((result) => result.pass);
      const wantsJudge = testCase.rubric.length > 0 || testCase.expected.answer !== undefined;
      if (
        checksPass &&
        iteration.response !== null &&
        source.judge !== undefined &&
        wantsJudge &&
        judged.length === 0
      ) {
        summary.withoutJudge++;
      }
    }
    for (const verdict of fresh) await store.appendVerdict(verdict);

    const before = old.length > 0 && old.every((verdict) => verdict.pass);
    const after = fresh.length > 0 && fresh.every((verdict) => verdict.pass);
    if (after) summary.passed++;
    if (old.length > 0 && fresh.length > 0 && before !== after) {
      if (after) summary.nowPassing++;
      else summary.nowFailing++;
    }
  }
  for (const failure of judgeFailures) await store.appendJudgeFailure({ ...failure, runId });

  await store.finishRun(runId, startedAt, {
    status: source.status ?? "completed",
    ...(source.abortReason !== undefined ? { abortReason: source.abortReason } : {}),
    usage: {
      calls: 0,
      targetTokens: { input: 0, output: 0 },
      judgeTokens: { input: 0, output: 0 },
      unreportedCalls: { target: 0, judge: 0 },
    },
  });
  return summary;
}
