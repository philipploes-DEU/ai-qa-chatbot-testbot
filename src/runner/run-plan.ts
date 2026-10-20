import { randomInt } from "node:crypto";

import { Deadline } from "../adapters/deadline.js";
import { FatalTargetError, HttpStatusError, TimeoutError } from "../adapters/errors.js";
import { readPath } from "../adapters/response-path.js";
import type { SendOptions, TargetAdapter, TargetResponse } from "../adapters/target.js";
import type { Check } from "../checks/check.js";
import { runChecks } from "../checks/run-checks.js";
import type { RunCalibration } from "../domain/calibration.js";
import type { Tokens, Turn } from "../domain/common.js";
import type { BindingFile } from "../domain/fixtures.js";
import type { Goldset } from "../domain/goldset.js";
import type { Iteration, Round } from "../domain/iteration.js";
import type { JudgeFailureKind } from "../domain/judge-failure.js";
import type { Plan } from "../domain/plan.js";
import type { Run, RunStatus } from "../domain/run.js";
import type { TargetConfig } from "../domain/target-config.js";
import { CAPTURE_PLACEHOLDER, type ScriptTurn, type TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { judgeFailureOf } from "../judge/judge-failure.js";
import { judgeIteration } from "../judge/judge-iteration.js";
import type { Judge } from "../judge/judge.js";
import type { SourceDocument } from "../judge/sources.js";
import type { ResultStore } from "../store/result-store.js";

export interface RunProgressEvent {
  runId: string;
  caseId: string;
  index: number;
  pass: boolean;
  error?: string;
  /** The judge refused or failed for this iteration; it has no judge verdict (issue #83). */
  judgeFailure?: { kind: JudgeFailureKind; reason: string };
}

export interface RunPlanOptions {
  plan: Plan;
  goldsets: readonly Goldset[];
  target: TargetConfig;
  adapter: TargetAdapter;
  checks: readonly Check[];
  /** Rates answers the checks did not decide. Without a judge only checks produce verdicts. */
  judge?: Judge;
  /** Source documents for the judge by goldset id (issue #70). */
  judgeSources?: ReadonlyMap<string, readonly SourceDocument[]>;
  /** Caveats recorded with the run and shown in the report. */
  warnings?: readonly string[];
  /** Calibration of the judge per goldset, recorded with the run. */
  calibrations?: readonly RunCalibration[];
  /** Hard cap on target calls for this run, from the workspace; the lower of plan and cap wins. */
  maxCallsPerRun?: number;
  store: ResultStore;
  /** Fixed run id, mainly for tests. Generated from the clock otherwise. */
  runId?: string;
  now?: () => Date;
  onProgress?: (event: RunProgressEvent) => void;
  /** Aborted, for example by Ctrl+C: the run ends before the next iteration (issue #96). */
  signal?: AbortSignal;
  /** The binding of {{fixtures.name}} this run uses, stored with the run (issue #93). */
  binding?: BindingFile;
  /** Cases with a placeholder without value, with those placeholders: they are not sent. */
  unresolvedCases?: ReadonlyMap<string, readonly string[]>;
}

export interface RunSummary {
  runId: string;
  iterations: number;
  verdicts: number;
  failedIterations: number;
  /** Iterations the judge rated. */
  judgedIterations: number;
  /** Iterations the judge should have rated but could not, refusals not included. */
  judgeErrors: number;
  /** Iterations the judge model refused to rate (issue #83). */
  judgeRefusals: number;
  /** Cases of the plan not sent because a placeholder had no value (issue #93). */
  unresolvedCases: number;
  /**
   * Iterations without a judge verdict that leave the pass rate: checks passed, the judge
   * refused or failed, no fallback such as a mustNotClaim hit applies (issue #83).
   */
  unjudgedIterations: number;
  /** Calls to the target. The judge's calls are not counted here, their tokens are. */
  calls: number;
  /** Tokens of target and judge together, as far as they reported any. */
  tokens: Tokens;
  status: RunStatus;
  /** Set when the budget stopped the run before every planned iteration. */
  abortReason?: string;
}

function addTokens(sum: Tokens, tokens: Tokens | undefined): Tokens {
  if (tokens === undefined) return sum;
  return { input: sum.input + tokens.input, output: sum.output + tokens.output };
}

/** Sortable id such as 20261010-123456-k3x9: UTC timestamp plus a random suffix. */
export function generateRunId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  const suffix = randomInt(0, 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${stamp}-${suffix}`;
}

/** All cases of all goldsets by id. */
export function indexCases(goldsets: readonly Goldset[]): Map<string, TestCase> {
  const cases = new Map<string, TestCase>();
  for (const goldset of goldsets) {
    for (const testCase of goldset.cases) {
      if (cases.has(testCase.id)) {
        throw new Error(`Fall-ID "${testCase.id}" kommt in mehr als einem Goldset vor`);
      }
      cases.set(testCase.id, testCase);
    }
  }
  return cases;
}

/** The turns as sent and recorded: role and content only, script extras stay out. */
function toTurns(input: TestCase["input"]): Turn[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  return input.map((turn) => ({ role: turn.role, content: turn.content }));
}

/** Cases whose script makes follow-up calls (issue #84). */
function usesFollowUps(testCase: TestCase): boolean {
  return (
    typeof testCase.input !== "string" &&
    testCase.input.some((turn) => turn.capture !== undefined || turn.bodyMerge !== undefined)
  );
}

/** Replaces whole-string {{capture.name}} values by what was captured, with its type. */
function resolveCaptures(value: unknown, captured: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === "string") {
    const name = CAPTURE_PLACEHOLDER.exec(value)?.[1];
    return name !== undefined && captured.has(name) ? captured.get(name) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => resolveCaptures(entry, captured));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveCaptures(entry, captured)]),
    );
  }
  return value;
}

/** A short line for records and the judge: what the follow-up call added. */
function describeFollowUp(
  merge: Readonly<Record<string, unknown>>,
  resolved: Readonly<Record<string, unknown>>,
): string {
  return Object.entries(merge)
    .map(([key, value]) => {
      const name = typeof value === "string" ? CAPTURE_PLACEHOLDER.exec(value)?.[1] : undefined;
      const actual = resolved[key];
      if (name !== undefined) {
        return Array.isArray(actual)
          ? `${key}: ${String(actual.length)} Werte aus ${name}`
          : `${key}: Wert aus ${name}`;
      }
      return `${key}: ${typeof actual === "string" ? actual : JSON.stringify(actual)}`;
    })
    .join(", ");
}

/** Calls to the target one iteration of the case makes: one per user turn of a dialog. */
export function callsPerIteration(testCase: TestCase): number {
  if (testCase.kind !== "dialog" || typeof testCase.input === "string") return 1;
  return Math.max(1, testCase.input.filter((turn) => turn.role === "user").length);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(ms, "dialog"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

type CallOutcome =
  | { ok: true; response: TargetResponse }
  | { ok: false; error: string; reason: string; latencyMs: number; status?: number };

async function callTarget(
  adapter: TargetAdapter,
  turns: readonly Turn[],
  timeoutMs: number,
  session?: string,
  options?: SendOptions,
): Promise<CallOutcome> {
  const started = performance.now();
  try {
    const response = await withTimeout(
      options === undefined ? adapter.send(turns, session) : adapter.send(turns, session, options),
      Math.max(1, timeoutMs),
    );
    return { ok: true, response };
  } catch (error) {
    if (error instanceof FatalTargetError) throw error;
    const latencyMs = performance.now() - started;
    if (error instanceof TimeoutError) {
      return { ok: false, error: "timeout", reason: error.message, latencyMs };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      reason: `Aufruf fehlgeschlagen: ${message}`,
      latencyMs,
      ...(error instanceof HttpStatusError ? { status: error.status } : {}),
    };
  }
}

interface CaseOutcome {
  ok: boolean;
  /** The answer the checks judge: the only one, or the last of a dialog. */
  response?: TargetResponse;
  rounds?: Round[];
  latencyMs: number;
  tokens?: Tokens;
  calls: number;
  error?: string;
  reason?: string;
  /** A capture found nothing; the dialog ended there and fails with a check verdict (#84). */
  captureFailure?: string;
  /** HTTP status of the final call, also of a failed one (issue #79). */
  status?: number;
}

/**
 * Runs a dialog turn by turn (issue #12): every scripted user turn goes to the target with the
 * conversation so far and the session, scripted assistant turns stay out of the request and
 * serve the judge as references. The whole dialog is bounded by timeouts.dialogMs. A failed
 * round ends the dialog; the rounds before it stay recorded. A user turn may take values from
 * its answer (capture) and add fields to its request (bodyMerge); a capture that finds nothing
 * ends the dialog as well (issue #84).
 */
async function runDialog(
  adapter: TargetAdapter,
  script: readonly ScriptTurn[],
  dialogMs: number,
  vars?: Readonly<Record<string, string>>,
): Promise<CaseOutcome> {
  const deadline = new Deadline(dialogMs);
  const session = adapter.startSession ? await adapter.startSession() : undefined;
  const history: Turn[] = [];
  const rounds: Round[] = [];
  let latencyMs = 0;
  let tokens: Tokens | undefined;
  let last: TargetResponse | undefined;
  const captured = new Map<string, unknown>();
  try {
    for (const turn of script) {
      const plain: Turn = { role: turn.role, content: turn.content };
      if (turn.role !== "user") {
        if (turn.role === "system") history.push(plain);
        continue;
      }
      history.push(plain);
      const bodyMerge =
        turn.bodyMerge === undefined
          ? undefined
          : (resolveCaptures(turn.bodyMerge, captured) as Record<string, unknown>);
      const followUp =
        turn.bodyMerge === undefined || bodyMerge === undefined
          ? undefined
          : describeFollowUp(turn.bodyMerge, bodyMerge);
      const options: SendOptions = {
        ...(bodyMerge !== undefined ? { bodyMerge } : {}),
        ...(vars !== undefined ? { vars } : {}),
      };
      const outcome = await callTarget(
        adapter,
        history,
        deadline.remainingMs(),
        session,
        Object.keys(options).length === 0 ? undefined : options,
      );
      const index = rounds.length;
      if (!outcome.ok) {
        rounds.push({
          index,
          request: plain,
          ...(followUp !== undefined ? { followUp } : {}),
          response: null,
          latencyMs: outcome.latencyMs,
          error: outcome.error,
        });
        return {
          ok: false,
          rounds,
          latencyMs: latencyMs + outcome.latencyMs,
          ...(tokens !== undefined ? { tokens } : {}),
          calls: rounds.length,
          error: outcome.error,
          reason: `Runde ${String(index + 1)}: ${outcome.reason}`,
          ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        };
      }
      last = outcome.response;
      latencyMs += outcome.response.latencyMs;
      if (outcome.response.tokens !== undefined) {
        tokens = addTokens(tokens ?? { input: 0, output: 0 }, outcome.response.tokens);
      }
      rounds.push({
        index,
        request: plain,
        response: outcome.response.content,
        latencyMs: outcome.response.latencyMs,
        ...(outcome.response.tokens !== undefined ? { tokens: outcome.response.tokens } : {}),
        ...(followUp !== undefined ? { followUp } : {}),
      });
      history.push({ role: "assistant", content: outcome.response.content });
      for (const [name, pointer] of Object.entries(turn.capture ?? {})) {
        let value: unknown;
        try {
          value = readPath(outcome.response.data, pointer);
        } catch {
          value = undefined;
        }
        if (value === undefined) {
          return {
            ok: true,
            response: { ...outcome.response, latencyMs },
            rounds,
            latencyMs,
            ...(tokens !== undefined ? { tokens } : {}),
            calls: rounds.length,
            captureFailure: `Runde ${String(index + 1)}: ${pointer} fehlt in der Antwort, der Folgeaufruf ist nicht möglich`,
          };
        }
        captured.set(name, value);
      }
    }
  } finally {
    if (session !== undefined && adapter.endSession) await adapter.endSession(session);
  }
  if (last === undefined) {
    return {
      ok: false,
      rounds,
      latencyMs,
      calls: 0,
      error: "kein user-Zug",
      reason: "Dialog ohne Nutzerzug",
    };
  }
  return {
    ok: true,
    response: { ...last, latencyMs },
    rounds,
    latencyMs,
    ...(tokens !== undefined ? { tokens } : {}),
    calls: rounds.length,
    ...(last.status !== undefined ? { status: last.status } : {}),
  };
}

async function runSingle(
  adapter: TargetAdapter,
  request: readonly Turn[],
  dialogMs: number,
  vars?: Readonly<Record<string, string>>,
): Promise<CaseOutcome> {
  const outcome = await callTarget(
    adapter,
    request,
    dialogMs,
    undefined,
    vars === undefined ? undefined : { vars },
  );
  if (!outcome.ok) {
    return {
      ok: false,
      latencyMs: outcome.latencyMs,
      calls: 1,
      error: outcome.error,
      reason: outcome.reason,
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
    };
  }
  return {
    ok: true,
    response: outcome.response,
    latencyMs: outcome.response.latencyMs,
    ...(outcome.response.tokens !== undefined ? { tokens: outcome.response.tokens } : {}),
    calls: 1,
    ...(outcome.response.status !== undefined ? { status: outcome.response.status } : {}),
  };
}

/**
 * Executes a plan: every referenced case for its number of iterations against the adapter.
 * A single answer case is one call; a dialog case runs round by round with a session. One
 * iteration is bounded by timeouts.dialogMs; the network adapters enforce timeouts.requestMs
 * per attempt themselves, including retries and waits (issue #5).
 * Each iteration gets one verdict per applicable check on its final answer. A failed call
 * becomes an iteration with an error plus a failing `response` verdict, so statistics count it.
 * The judge rates an answer only when every check passed and the case has a rubric or a
 * reference answer (ADR 0003); dialogs get a verdict per round and one for the conversation.
 * A judge failure leaves the iteration without judge verdict and is reported, never counted
 * against the target.
 * The plan's budget is a hard stop (issue #8): maxCalls bounds the calls to the target,
 * maxTokens the tokens of target and judge together. When a limit is reached the run ends
 * cleanly, marked aborted with the reason, and what was recorded stays valid. A FatalTargetError
 * of the adapter, such as a failed login for auth token (issue #73), ends the run the same way;
 * the interrupted iteration is not recorded.
 */
export async function runPlan(options: RunPlanOptions): Promise<RunSummary> {
  const { plan, goldsets, target, adapter, checks, judge, store } = options;
  const now = options.now ?? ((): Date => new Date());

  const cases = indexCases(goldsets);
  const resolved = plan.caseRefs.map((ref) => {
    const testCase = cases.get(ref.caseId);
    if (testCase === undefined) {
      throw new Error(`Plan "${plan.id}" verweist auf den unbekannten Fall "${ref.caseId}"`);
    }
    return { ref, testCase };
  });
  const varCases = [
    ...new Set(
      resolved
        .filter(({ testCase }) => testCase.vars !== undefined)
        .map(({ testCase }) => testCase.id),
    ),
  ];
  if (varCases.length > 0 && adapter.supportsVars !== true) {
    throw new Error(
      `Adapter ${adapter.name} kann keine Variablen je Fall (vars), gebraucht von: ${varCases.join(", ")}`,
    );
  }
  const requiredVars = adapter.requiredVars?.() ?? [];
  const missingVars = [
    ...new Set(
      resolved.flatMap(({ testCase }) =>
        requiredVars
          .filter((name) => testCase.vars?.[name] === undefined)
          .map((name) => `${testCase.id} braucht {{vars.${name}}}`),
      ),
    ),
  ];
  if (missingVars.length > 0) {
    throw new Error(
      `Variablen ohne Wert, im Fall unter vars oder im target-Block unter request.vars setzen: ${missingVars.join(", ")}`,
    );
  }
  const followUpCases = resolved
    .filter(({ testCase }) => usesFollowUps(testCase))
    .map(({ testCase }) => testCase.id);
  if (followUpCases.length > 0 && adapter.supportsFollowUps !== true) {
    throw new Error(
      `Adapter ${adapter.name} kann keine Folgeaufrufe (capture, bodyMerge), gebraucht von: ${[...new Set(followUpCases)].join(", ")}`,
    );
  }

  const sourcesByCase = new Map<string, readonly SourceDocument[]>();
  for (const goldset of goldsets) {
    const sources = options.judgeSources?.get(goldset.id);
    if (sources === undefined) continue;
    for (const testCase of goldset.cases) sourcesByCase.set(testCase.id, sources);
  }

  const runId = options.runId ?? generateRunId(now());
  const draftCases = resolved
    .filter(({ testCase }) => testCase.status === "draft")
    .map(({ testCase }) => testCase.id);
  // Cases of the plan whose placeholders have no value; they are not sent (issue #93).
  const unresolvedCases = resolved.flatMap(({ testCase }) => {
    const placeholders = options.unresolvedCases?.get(testCase.id);
    return placeholders === undefined || placeholders.length === 0
      ? []
      : [{ caseId: testCase.id, placeholders: [...placeholders] }];
  });
  // Plan first, then the goldsets, each sentence once (issue #87).
  const outOfScope = [
    ...new Set([...(plan.outOfScope ?? []), ...goldsets.flatMap((g) => g.outOfScope ?? [])]),
  ];
  const run: Run = {
    id: runId,
    planId: plan.id,
    target: target.name,
    startedAt: now().toISOString(),
    goldsets: goldsets.map((goldset) => {
      const read = judge?.readsSources === true ? options.judgeSources?.get(goldset.id) : undefined;
      return {
        id: goldset.id,
        version: goldset.version,
        ...(read !== undefined && read.length > 0 ? { sources: read.length } : {}),
      };
    }),
    ...(judge === undefined
      ? {}
      : { judge: { model: judge.model, promptVersion: judge.promptVersion } }),
    ...(draftCases.length > 0 ? { draftCases } : {}),
    ...(options.warnings !== undefined && options.warnings.length > 0
      ? { warnings: [...options.warnings] }
      : {}),
    ...(options.calibrations !== undefined && options.calibrations.length > 0
      ? { calibrations: [...options.calibrations] }
      : {}),
    ...(outOfScope.length > 0 ? { outOfScope } : {}),
    ...(unresolvedCases.length > 0 ? { unresolvedCases } : {}),
  };
  await store.createRun(run);
  if (options.binding !== undefined) await store.writeRunBinding(runId, options.binding);

  let iterations = 0;
  let verdicts = 0;
  let failedIterations = 0;
  let judgedIterations = 0;
  let judgeErrors = 0;
  let judgeRefusals = 0;
  let unjudgedIterations = 0;
  let calls = 0;
  let tokens: Tokens = { input: 0, output: 0 };
  let judgeTokens: Tokens = { input: 0, output: 0 };
  let abortReason: string | undefined;
  const maxTokens = plan.budget.maxTokens;
  const maxCalls =
    options.maxCallsPerRun === undefined
      ? plan.budget.maxCalls
      : Math.min(plan.budget.maxCalls, options.maxCallsPerRun);

  const overBudget = (needed: number): string | undefined => {
    if (calls + needed > maxCalls) {
      return `Budget von ${String(maxCalls)} Aufrufen erreicht`;
    }
    const used = tokens.input + tokens.output;
    if (maxTokens !== undefined && used > maxTokens) {
      return `Budget von ${String(maxTokens)} Tokens überschritten (${String(used)} verbraucht)`;
    }
    return undefined;
  };

  runLoop: for (const { ref, testCase } of resolved) {
    if (options.unresolvedCases?.has(testCase.id) === true) continue;
    const request = toTurns(testCase.input);
    const script = typeof testCase.input === "string" ? request : testCase.input;
    const isDialog = testCase.kind === "dialog";
    for (let index = 0; index < ref.iterations; index++) {
      if (options.signal?.aborted === true) {
        abortReason = "von Hand abgebrochen";
        break runLoop;
      }
      abortReason = overBudget(callsPerIteration(testCase));
      if (abortReason !== undefined) break runLoop;
      let outcome: CaseOutcome;
      try {
        outcome = isDialog
          ? await runDialog(adapter, script, target.timeouts.dialogMs, testCase.vars)
          : await runSingle(adapter, request, target.timeouts.dialogMs, testCase.vars);
      } catch (error) {
        if (!(error instanceof FatalTargetError)) throw error;
        abortReason = error.message;
        break runLoop;
      }
      calls += outcome.calls;
      // A refusal with the status the case expects is the wanted behaviour, no error (#79).
      const expectedStatus = testCase.expected.status;
      const statusMatched =
        !outcome.ok && expectedStatus !== undefined && outcome.status === expectedStatus;
      // The target refuses further calls, for example at a daily limit (issue #96). The call
      // counts, the iteration is not recorded because it tested nothing, and the run ends.
      if (!outcome.ok && outcome.status === 429 && !statusMatched) {
        const answer = (outcome.error ?? "").replace(/^http 429:?\s*/, "");
        abortReason = `Das Zielsystem lehnt weitere Anfragen ab (HTTP 429)${answer === "" ? "" : `: ${answer}`}`;
        // Earlier rounds of a dialog were answered; their tokens belong to the effort.
        tokens = addTokens(tokens, outcome.tokens);
        break runLoop;
      }

      const iteration: Iteration = {
        runId,
        caseId: testCase.id,
        index,
        seed: index,
        request,
        response: outcome.ok ? (outcome.response?.content ?? null) : null,
        latencyMs: outcome.latencyMs,
        ...(outcome.tokens !== undefined ? { tokens: outcome.tokens } : {}),
        ...(outcome.rounds !== undefined ? { rounds: outcome.rounds } : {}),
        ...(outcome.error !== undefined && !statusMatched ? { error: outcome.error } : {}),
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      };
      await store.appendIteration(iteration);
      iterations++;
      tokens = addTokens(tokens, iteration.tokens);

      let pass: boolean;
      let judgeFailure: RunProgressEvent["judgeFailure"];
      if (statusMatched) {
        await store.appendVerdict({
          runId,
          caseId: testCase.id,
          index,
          source: "check",
          pass: true,
          criteria: [
            {
              name: "status",
              pass: true,
              reason: `erwarteter Status ${String(expectedStatus)} erhalten`,
            },
          ],
          reasoning: `status: erwarteter Status ${String(expectedStatus)} erhalten`,
        });
        verdicts++;
        pass = true;
      } else if (outcome.ok && outcome.response !== undefined) {
        const results = runChecks(checks, testCase, outcome.response, {
          judge: judge !== undefined,
        });
        if (outcome.captureFailure !== undefined) {
          results.push({
            source: "check",
            pass: false,
            criteria: [{ name: "capture", pass: false, reason: outcome.captureFailure }],
            reasoning: `capture: ${outcome.captureFailure}`,
          });
        }
        for (const result of results) {
          await store.appendVerdict({ ...result, runId, caseId: testCase.id, index });
        }
        verdicts += results.length;
        pass = results.every((result) => result.pass);
        const judgeApplies =
          isDialog || judge?.applies(testCase, outcome.response.content) === true;
        if (pass && judge !== undefined && judgeApplies) {
          try {
            const rated = await judgeIteration(
              judge,
              testCase,
              outcome.response,
              outcome.rounds,
              sourcesByCase.get(testCase.id),
            );
            for (const verdict of rated.verdicts) {
              await store.appendVerdict({ ...verdict, runId, caseId: testCase.id, index });
            }
            verdicts += rated.verdicts.length;
            judgedIterations++;
            tokens = addTokens(tokens, rated.tokens);
            judgeTokens = addTokens(judgeTokens, rated.tokens);
            pass = rated.pass;
          } catch (error) {
            const failure = judgeFailureOf(error, judge, testCase, outcome.response.content, {
              runId,
              index,
            });
            await store.appendJudgeFailure(failure);
            if (failure.kind === "refusal") judgeRefusals++;
            else judgeErrors++;
            judgeFailure = { kind: failure.kind, reason: failure.reason };
            // A mustNotClaim hit was left to the judge; without its verdict it counts (#82).
            // The failure carries it as fallback, so a later judge verdict replaces it (#83).
            if (failure.fallback !== undefined) pass = false;
            else unjudgedIterations++;
          }
        }
      } else {
        const reason = outcome.reason ?? "Aufruf fehlgeschlagen";
        const verdict: Verdict = {
          runId,
          caseId: testCase.id,
          index,
          source: "check",
          pass: false,
          criteria: [{ name: "response", pass: false, reason }],
          reasoning: `response: ${reason}`,
        };
        await store.appendVerdict(verdict);
        verdicts++;
        pass = false;
      }
      if (!pass) failedIterations++;

      options.onProgress?.({
        runId,
        caseId: testCase.id,
        index,
        pass,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        ...(judgeFailure !== undefined ? { judgeFailure } : {}),
      });
    }
  }

  const status: RunStatus = abortReason === undefined ? "completed" : "aborted";
  await store.finishRun(runId, now().toISOString(), {
    status,
    ...(abortReason !== undefined ? { abortReason } : {}),
    usage: {
      calls,
      targetTokens: {
        input: tokens.input - judgeTokens.input,
        output: tokens.output - judgeTokens.output,
      },
      judgeTokens,
    },
  });
  return {
    runId,
    iterations,
    verdicts,
    failedIterations,
    judgedIterations,
    judgeErrors,
    judgeRefusals,
    unresolvedCases: unresolvedCases.length,
    unjudgedIterations,
    calls,
    tokens,
    status,
    ...(abortReason !== undefined ? { abortReason } : {}),
  };
}
