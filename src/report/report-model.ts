import type { RunCalibration } from "../domain/calibration.js";
import type { Turn } from "../domain/common.js";
import type { Finding } from "../domain/finding.js";
import type { BindingFile } from "../domain/fixtures.js";
import type { Iteration } from "../domain/iteration.js";
import type { JudgeFailure } from "../domain/judge-failure.js";
import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { type CaseSummary, outcomesFromVerdicts, summarizeCase } from "../stats/outcomes.js";
import { passAllK } from "../stats/pass-all-k.js";
import { type Interval, wilsonInterval } from "../stats/wilson.js";

export interface FailedCheck {
  name: string;
  reason: string;
}

export interface FailedIteration {
  index: number;
  checks: FailedCheck[];
}

export interface CaseReport {
  caseId: string;
  /** The case source (catalog id such as LLM01), else its first tag, else UNCATEGORIZED. */
  category: string;
  /** The case was a draft when the run started: shown, never counted. */
  draft: boolean;
  kind?: TestCase["kind"];
  severity?: TestCase["severity"];
  source?: string;
  iterations: number;
  /** Iterations whose call failed (timeout, connection error). */
  errors: number;
  /** Iterations the target refused with HTTP 429; they tested nothing (issue #96). */
  notExecuted: number;
  averageLatencyMs: number;
  /** null when no iteration of the case has a verdict. */
  summary: CaseSummary | null;
  failures: FailedIteration[];
}

export interface ReportTotals {
  cases: number;
  iterations: number;
  /** Iterations with at least one verdict. */
  judgedIterations: number;
  passedIterations: number;
  passRate: number | null;
  interval: Interval | null;
  passAllK: { k: number; value: number } | null;
  flakyCases: number;
  casesWithoutVerdict: number;
  errors: number;
  /**
   * Iterations the target refused with HTTP 429, for example at a daily limit. They tested
   * nothing and leave every rate (issue #96).
   */
  notExecuted: number;
  /** Cases not sent because a placeholder had no value (issue #93). */
  unresolvedCases: number;
  /** Draft cases of the run; none of the figures above counts them. */
  draftCases: number;
  /**
   * Passed iterations when failures a human rejected as findings count as passed (issue #86).
   * null without rejected findings.
   */
  correctedPassedIterations: number | null;
  correctedPassRate: number | null;
  /**
   * Iterations the judge should have rated but did not (issue #83), by kind. They leave the
   * pass rate unless a check failed; countedAsFailed says how many of them still count.
   */
  withoutJudgeVerdict: { refused: number; errors: number; countedAsFailed: number };
}

/** An iteration without a judge verdict, for the list in the report (issue #83). */
export interface UnjudgedIteration {
  caseId: string;
  index: number;
  kind: JudgeFailure["kind"];
  reason: string;
  /** A fallback criterion applies, so the iteration counts as failed instead of leaving the rate. */
  countedAsFailed: boolean;
  /** The criterion it fails with, for example a mustNotClaim hit (ADR 0018). */
  fallback?: { name: string; reason: string };
}

/** A failed iteration with the target's answer and the judge's reasoning, for the reader. */
export interface FailureSample {
  caseId: string;
  index: number;
  /** HTTP status of the answer, when known (issue #79). */
  status?: number;
  /** The user turns as sent, in order, shortened (issue #107). */
  question: string[];
  response: string;
  checks: FailedCheck[];
  judgeReasoning?: string;
}

/** The outcome of a case over its iterations, one word for the reader (issue #107). */
export type ExchangeOutcome =
  "passed" | "failed" | "error" | "notExecuted" | "unresolved" | "noVerdict";

/**
 * Question, expected answer and the target's answer of one case (issue #107). Texts are
 * shortened to SAMPLE_RESPONSE_LENGTH. The question is the one sent, so it carries the values
 * of {{fixtures.name}} (ADR 0022).
 */
export interface CaseExchange {
  caseId: string;
  kind?: TestCase["kind"];
  draft: boolean;
  outcome: ExchangeOutcome;
  iterations: number;
  /** Iterations with a verdict and how many of them passed. */
  judged: number;
  passes: number;
  /** The user turns in order; a dialog lists every user turn. Empty when nothing is known. */
  question: string[];
  /**
   * The reference answer, else the checks of the case in words, else the rubric criteria.
   * Empty when the case expects nothing, null when the goldset was not loaded.
   */
  expected: string[] | null;
  /** The iteration whose answer is shown: the first failed, else the first. null when none ran. */
  index: number | null;
  /** The target's answer of that iteration; null when the call failed or none ran. */
  answer: string | null;
  /** The error of that iteration when the call failed, for example timeout. */
  error?: string;
  /** Whether the answers differ in wording between the iterations; null below two. */
  varies: boolean | null;
}

/** Failure rate of the judged iterations of all cases that share a category. */
export interface CategoryReport {
  category: string;
  cases: number;
  judgedIterations: number;
  failedIterations: number;
  /** null when no iteration of the category has a verdict. */
  failureRate: number | null;
  /** Wilson interval of the failure rate. */
  interval: Interval | null;
}

/** Pass rate of one run, for the trend over the latest runs. */
export interface TrendPoint {
  runId: string;
  startedAt: string;
  status?: Run["status"];
  judgedIterations: number;
  passedIterations: number;
  passRate: number | null;
  interval: Interval | null;
  /** true for the run the report is about. */
  current: boolean;
}

export interface ReportModel {
  run: Run;
  totals: ReportTotals;
  cases: CaseReport[];
  /** Failure rate per category, highest first, categories without verdicts last. */
  categories: CategoryReport[];
  calibrations: RunCalibration[];
  /** Up to SAMPLE_LIMIT failed iterations, those with a failing judge verdict first. */
  samples: FailureSample[];
  /** Question, expected and actual answer per case, cases not sent last (issue #107). */
  exchanges: CaseExchange[];
  /** Earlier runs and this one, oldest first. */
  trend: TrendPoint[];
  /** Findings a human confirmed. Hypotheses of the analysis agent never reach a report. */
  findings: Finding[];
  /** Findings a human rejected, with the reason, for example false alarms of the tool. */
  rejectedFindings: Finding[];
  /** Iterations the judge refused or failed to rate, in order of the run (issue #83). */
  judgeFailures: UnjudgedIteration[];
  /** Placeholders whose value changed since the run before (issue #93, ADR 0022). */
  bindingChanges: BindingChange[];
  /** Cases not sent because a placeholder had no value, with the reasons (issue #93). */
  unresolvedCases: UnresolvedCase[];
}

/**
 * A placeholder bound to another value than in the run before. The values stay in
 * runs/<lauf>/bindings.json: they may be personal data (ADR 0022).
 */
export interface BindingChange {
  placeholder: string;
  query?: string;
  queryVersion?: string;
}

/** A case not sent, with its placeholders and why they stayed empty. */
export interface UnresolvedCase {
  caseId: string;
  placeholders: string[];
  reasons: string[];
}

function bindingChangesOf(binding: BindingFile | undefined): BindingChange[] {
  return (binding?.entries ?? []).flatMap((entry) =>
    entry.status !== "bound" ||
    entry.value === undefined ||
    entry.previous === undefined ||
    entry.previous === entry.value
      ? []
      : [
          {
            placeholder: entry.placeholder,
            ...(entry.query !== undefined ? { query: entry.query } : {}),
            ...(entry.queryVersion !== undefined ? { queryVersion: entry.queryVersion } : {}),
          },
        ],
  );
}

function unresolvedCasesOf(run: Run, binding: BindingFile | undefined): UnresolvedCase[] {
  const reasons = new Map(
    (binding?.entries ?? []).map((entry) => [entry.placeholder, entry.reason ?? "ohne Wert"]),
  );
  return (run.unresolvedCases ?? []).map((entry) => ({
    caseId: entry.caseId,
    placeholders: entry.placeholders,
    reasons: entry.placeholders.map(
      (name) => `${name}: ${reasons.get(name) ?? "nicht in der Bindung"}`,
    ),
  }));
}

export const UNCATEGORIZED = "ohne Kategorie";

export const SAMPLE_LIMIT = 5;
export const SAMPLE_RESPONSE_LENGTH = 600;

/** A text shortened for a report, with a marker where it was cut. */
export function shorten(text: string, limit = SAMPLE_RESPONSE_LENGTH): string {
  return text.length > limit ? `${text.slice(0, limit)} [...]` : text;
}

/** The user turns of a request, shortened, as the question a reader sees. */
function userTurns(turns: readonly Turn[]): string[] {
  return turns.filter((turn) => turn.role === "user").map((turn) => shorten(turn.content));
}

/** The question of a case that was not sent, from the goldset, with its placeholders. */
function scriptedQuestion(testCase: TestCase | undefined): string[] {
  if (testCase === undefined) return [];
  return typeof testCase.input === "string" ? [shorten(testCase.input)] : userTurns(testCase.input);
}

function quoted(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

/**
 * The expected answer in words: the reference answer, else the checks of the case, else the
 * rubric criteria (issue #107). null without case data, empty when the case expects nothing.
 */
export function expectedOf(testCase: TestCase | undefined): string[] | null {
  if (testCase === undefined) return null;
  const { expected, rubric } = testCase;
  if (expected.answer !== undefined) return [shorten(expected.answer)];
  const lines: string[] = [];
  if (expected.mustContain.length > 0) {
    lines.push(`muss enthalten: ${quoted(expected.mustContain)}`);
  }
  if (expected.mustNotContain.length > 0) {
    lines.push(`darf nicht enthalten: ${quoted(expected.mustNotContain)}`);
  }
  if (expected.mustNotClaim.length > 0) {
    lines.push(`darf nicht behaupten: ${quoted(expected.mustNotClaim)}`);
  }
  if (expected.mustMatch.length > 0) {
    lines.push(`muss den Mustern entsprechen: ${expected.mustMatch.join(", ")}`);
  }
  if (expected.mustNotMatch.length > 0) {
    lines.push(`darf den Mustern nicht entsprechen: ${expected.mustNotMatch.join(", ")}`);
  }
  if (expected.schema !== undefined) lines.push("muss dem JSON-Schema des Falls entsprechen");
  if (expected.refusal === true) lines.push("Verweigerung erwartet");
  if (expected.refusal === false) lines.push("keine Verweigerung erwartet");
  if (expected.status !== undefined) {
    lines.push(`HTTP-Status ${String(expected.status)} erwartet`);
  }
  if (lines.length > 0) return lines;
  return rubric.map((criterion) => `${criterion.name}: ${criterion.description}`);
}

function sampleFailures(input: ReportInput, verdicts: readonly Verdict[]): FailureSample[] {
  const drafts = new Set(input.run.draftCases ?? []);
  const candidates: (FailureSample & { judged: boolean })[] = [];
  for (const iteration of input.iterations) {
    if (iteration.response === null || drafts.has(iteration.caseId)) continue;
    const own = verdicts.filter(
      (verdict) => verdict.caseId === iteration.caseId && verdict.index === iteration.index,
    );
    const failing = own.filter((verdict) => !verdict.pass);
    if (failing.length === 0) continue;
    const judge = failing.find((verdict) => verdict.source === "judge");
    candidates.push({
      caseId: iteration.caseId,
      index: iteration.index,
      ...(iteration.status !== undefined ? { status: iteration.status } : {}),
      question: userTurns(iteration.request),
      response: shorten(iteration.response),
      checks: failing.flatMap((verdict) =>
        verdict.criteria
          .filter((criterion) => !criterion.pass)
          .map((criterion) => ({ name: criterion.name, reason: criterion.reason })),
      ),
      ...(judge !== undefined ? { judgeReasoning: judge.reasoning } : {}),
      judged: judge !== undefined,
    });
  }
  return candidates
    .sort((a, b) => Number(b.judged) - Number(a.judged))
    .slice(0, SAMPLE_LIMIT)
    .map(({ judged: _judged, ...sample }) => sample);
}

export interface ReportInput {
  run: Run;
  iterations: readonly Iteration[];
  verdicts: readonly Verdict[];
  /** Case metadata from the goldsets, when available. */
  cases?: ReadonlyMap<string, TestCase>;
  /** Trend points of earlier runs; the current run is added by buildReportModel. */
  history?: readonly TrendPoint[];
  /** Findings of the run in any status; only confirmed ones are kept. */
  findings?: readonly Finding[];
  /** Iterations the judge refused or failed to rate (issue #83). */
  judgeFailures?: readonly JudgeFailure[];
  /** The binding of {{fixtures.name}} the run used (issue #93). */
  binding?: BindingFile;
}

function refOf(entry: { caseId: string; index: number }): string {
  return `${entry.caseId}#${String(entry.index)}`;
}

/**
 * The judge failures that still stand, the last one per iteration in order of the run: an
 * iteration that later got a judge verdict is rated. countedAsFailed marks those with a
 * fallback criterion or a failing verdict, which count as failed; the others leave the pass
 * rate (issue #83).
 */
export function unjudgedIterations(
  verdicts: readonly Verdict[],
  failures: readonly JudgeFailure[],
): UnjudgedIteration[] {
  const judged = new Set(
    verdicts.filter((verdict) => verdict.source === "judge").map((verdict) => refOf(verdict)),
  );
  const failed = new Set(
    verdicts.filter((verdict) => !verdict.pass).map((verdict) => refOf(verdict)),
  );
  const latest = new Map<string, JudgeFailure>();
  for (const failure of failures) {
    const ref = refOf(failure);
    if (!judged.has(ref)) latest.set(ref, failure);
  }
  return [...latest.entries()].map(([ref, failure]) => ({
    caseId: failure.caseId,
    index: failure.index,
    kind: failure.kind,
    reason: failure.reason,
    countedAsFailed: failure.fallback !== undefined || failed.has(ref),
    ...(failure.fallback !== undefined ? { fallback: failure.fallback } : {}),
  }));
}

/**
 * An iteration the target refused with HTTP 429 although the case did not expect it: it tested
 * nothing (issue #96). With the expected status the runner records no error.
 */
export function wasNotExecuted(iteration: Iteration): boolean {
  return iteration.status === 429 && iteration.error !== undefined;
}

/**
 * The verdicts that count: those of iterations without a judge verdict or refused with 429
 * leave the rate, a fallback criterion becomes a failed check verdict of its iteration.
 */
function countedVerdicts(
  runId: string,
  verdicts: readonly Verdict[],
  unjudged: readonly UnjudgedIteration[],
  iterations: readonly Iteration[] = [],
): Verdict[] {
  const left = new Set([
    ...unjudged.filter((entry) => !entry.countedAsFailed).map(refOf),
    ...iterations.filter(wasNotExecuted).map(refOf),
  ]);
  const fallbacks: Verdict[] = unjudged.flatMap((entry) =>
    entry.fallback === undefined
      ? []
      : [
          {
            runId,
            caseId: entry.caseId,
            index: entry.index,
            source: "check" as const,
            pass: false,
            criteria: [{ name: entry.fallback.name, pass: false, reason: entry.fallback.reason }],
            reasoning: `${entry.fallback.name}: ${entry.fallback.reason}`,
          },
        ],
  );
  return [...verdicts.filter((verdict) => !left.has(refOf(verdict))), ...fallbacks];
}

function passCounts(verdicts: readonly Verdict[]): { judged: number; passed: number } {
  const judged = Object.values(outcomesFromVerdicts(verdicts)).flat();
  return { judged: judged.length, passed: judged.filter((outcome) => outcome).length };
}

/** What else a trend point needs to count like the report (issues #83 and #96). */
export interface TrendInput {
  judgeFailures?: readonly JudgeFailure[];
  iterations?: readonly Iteration[];
}

/**
 * The pass rate of a run from its verdicts, as one point of the trend. Drafts, iterations
 * without a judge verdict and iterations refused with 429 do not count.
 */
export function trendPoint(
  run: Run,
  verdicts: readonly Verdict[],
  current = false,
  extra: TrendInput = {},
): TrendPoint {
  const drafts = new Set(run.draftCases ?? []);
  const counted = countedVerdicts(
    run.id,
    verdicts,
    unjudgedIterations(verdicts, extra.judgeFailures ?? []),
    extra.iterations,
  );
  const { judged, passed } = passCounts(counted.filter((verdict) => !drafts.has(verdict.caseId)));
  return {
    runId: run.id,
    startedAt: run.startedAt,
    ...(run.status !== undefined ? { status: run.status } : {}),
    judgedIterations: judged,
    passedIterations: passed,
    passRate: judged === 0 ? null : passed / judged,
    interval: judged === 0 ? null : wilsonInterval(passed, judged),
    current,
  };
}

/** The case source (catalog id), else its first tag, else UNCATEGORIZED. */
export function categoryOf(testCase: TestCase | undefined): string {
  return testCase?.source ?? testCase?.tags[0] ?? UNCATEGORIZED;
}

function buildCategories(
  cases: readonly CaseReport[],
  outcomes: Readonly<Record<string, readonly boolean[]>>,
): CategoryReport[] {
  const byCategory = new Map<string, { cases: number; judged: number; failed: number }>();
  for (const entry of cases.filter((report) => !report.draft)) {
    const own = outcomes[entry.caseId] ?? [];
    const current = byCategory.get(entry.category) ?? { cases: 0, judged: 0, failed: 0 };
    byCategory.set(entry.category, {
      cases: current.cases + 1,
      judged: current.judged + own.length,
      failed: current.failed + own.filter((outcome) => !outcome).length,
    });
  }
  return [...byCategory.entries()]
    .map(([category, counts]) => ({
      category,
      cases: counts.cases,
      judgedIterations: counts.judged,
      failedIterations: counts.failed,
      failureRate: counts.judged === 0 ? null : counts.failed / counts.judged,
      interval: counts.judged === 0 ? null : wilsonInterval(counts.failed, counts.judged),
    }))
    .sort(
      (a, b) =>
        (b.failureRate ?? -1) - (a.failureRate ?? -1) || a.category.localeCompare(b.category),
    );
}

function groupByCase(iterations: readonly Iteration[]): Map<string, Iteration[]> {
  const grouped = new Map<string, Iteration[]>();
  for (const iteration of iterations) {
    const list = grouped.get(iteration.caseId);
    if (list === undefined) {
      grouped.set(iteration.caseId, [iteration]);
    } else {
      list.push(iteration);
    }
  }
  return grouped;
}

function failedIterations(verdicts: readonly Verdict[]): FailedIteration[] {
  const byIndex = new Map<number, FailedCheck[]>();
  for (const verdict of verdicts) {
    const failing = verdict.criteria
      .filter((criterion) => !criterion.pass)
      .map((criterion) => ({ name: criterion.name, reason: criterion.reason }));
    if (failing.length === 0) continue;
    const list = byIndex.get(verdict.index);
    if (list === undefined) {
      byIndex.set(verdict.index, failing);
    } else {
      list.push(...failing);
    }
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, checks]) => ({ index, checks }));
}

function metadata(
  testCase: TestCase | undefined,
): Pick<CaseReport, "kind" | "severity" | "source"> {
  if (testCase === undefined) return {};
  return {
    kind: testCase.kind,
    severity: testCase.severity,
    ...(testCase.source !== undefined ? { source: testCase.source } : {}),
  };
}

/** The outcome of a case in one word, from the figures of its report row. */
function outcomeOf(entry: CaseReport): ExchangeOutcome {
  if (entry.iterations > 0 && entry.notExecuted === entry.iterations) return "notExecuted";
  if (entry.iterations > 0 && entry.errors + entry.notExecuted === entry.iterations) return "error";
  if (entry.summary === null) return "noVerdict";
  return entry.summary.passes === entry.summary.n ? "passed" : "failed";
}

/**
 * Question, expected and actual answer per case (issue #107): the cases that ran in order of
 * the run, with the answer of the first failed iteration, else the first; then the cases not
 * sent because a placeholder had no value, with the question from the goldset.
 */
function buildExchanges(
  input: ReportInput,
  cases: readonly CaseReport[],
  grouped: ReadonlyMap<string, readonly Iteration[]>,
  verdicts: readonly Verdict[],
): CaseExchange[] {
  const failed = new Set(verdicts.filter((verdict) => !verdict.pass).map(refOf));
  const drafts = new Set(input.run.draftCases ?? []);
  const ran = cases.map((entry): CaseExchange => {
    const iterations = [...(grouped.get(entry.caseId) ?? [])].sort((a, b) => a.index - b.index);
    const shown = iterations.find((iteration) => failed.has(refOf(iteration))) ?? iterations[0];
    const testCase = input.cases?.get(entry.caseId);
    return {
      caseId: entry.caseId,
      ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
      draft: entry.draft,
      outcome: outcomeOf(entry),
      iterations: entry.iterations,
      judged: entry.summary?.n ?? 0,
      passes: entry.summary?.passes ?? 0,
      question: shown === undefined ? scriptedQuestion(testCase) : userTurns(shown.request),
      expected: expectedOf(testCase),
      index: shown?.index ?? null,
      answer:
        shown?.response === undefined || shown.response === null ? null : shorten(shown.response),
      ...(shown?.error !== undefined ? { error: shown.error } : {}),
      varies:
        iterations.length < 2
          ? null
          : new Set(iterations.map((iteration) => iteration.response)).size > 1,
    };
  });
  const unresolved = (input.run.unresolvedCases ?? []).map((entry): CaseExchange => {
    const testCase = input.cases?.get(entry.caseId);
    return {
      caseId: entry.caseId,
      ...(testCase !== undefined ? { kind: testCase.kind } : {}),
      draft: drafts.has(entry.caseId),
      outcome: "unresolved",
      iterations: 0,
      judged: 0,
      passes: 0,
      question: scriptedQuestion(testCase),
      expected: expectedOf(testCase),
      index: null,
      answer: null,
      varies: null,
    };
  });
  return [...ran, ...unresolved];
}

/** Pure aggregation of a run into the numbers and lists a report shows. */
export function buildReportModel(input: ReportInput): ReportModel {
  const drafts = new Set(input.run.draftCases ?? []);
  const unjudged = unjudgedIterations(input.verdicts, input.judgeFailures ?? []).filter(
    (entry) => !drafts.has(entry.caseId),
  );
  const verdicts = countedVerdicts(input.run.id, input.verdicts, unjudged, input.iterations);
  const outcomes = outcomesFromVerdicts(verdicts);
  const grouped = groupByCase(input.iterations);

  const cases: CaseReport[] = [...grouped.entries()].map(([caseId, iterations]) => {
    const caseOutcomes = outcomes[caseId];
    const latencySum = iterations.reduce((sum, iteration) => sum + iteration.latencyMs, 0);
    const testCase = input.cases?.get(caseId);
    return {
      caseId,
      category: categoryOf(testCase),
      draft: drafts.has(caseId),
      ...metadata(testCase),
      iterations: iterations.length,
      errors: iterations.filter(
        (iteration) => iteration.error !== undefined && !wasNotExecuted(iteration),
      ).length,
      notExecuted: iterations.filter(wasNotExecuted).length,
      averageLatencyMs: iterations.length === 0 ? 0 : latencySum / iterations.length,
      summary:
        caseOutcomes !== undefined && caseOutcomes.length > 0 ? summarizeCase(caseOutcomes) : null,
      failures: failedIterations(verdicts.filter((verdict) => verdict.caseId === caseId)),
    };
  });

  const judged = Object.entries(outcomes)
    .filter(([caseId, list]) => list.length > 0 && !drafts.has(caseId))
    .map(([, list]) => list);
  const judgedIterations = judged.reduce((sum, list) => sum + list.length, 0);
  const passedIterations = judged.reduce(
    (sum, list) => sum + list.filter((outcome) => outcome).length,
    0,
  );
  const smallestK = judged.reduce(
    (min, list) => Math.min(min, list.length),
    Number.POSITIVE_INFINITY,
  );

  const decided = input.findings ?? [];
  const rejectedRefs = new Set(
    decided.filter((finding) => finding.status === "rejected").flatMap((f) => f.evidenceRefs),
  );
  const keptRefs = new Set(
    decided.filter((finding) => finding.status !== "rejected").flatMap((f) => f.evidenceRefs),
  );
  const failedRefs = new Set(
    verdicts
      .filter((verdict) => !verdict.pass && !drafts.has(verdict.caseId))
      .map((verdict) => `${verdict.caseId}#${String(verdict.index)}`),
  );
  const cleared = [...failedRefs].filter((ref) => rejectedRefs.has(ref) && !keptRefs.has(ref));
  const counted = cases.filter((entry) => !entry.draft);
  const countedOutcomes = Object.fromEntries(
    Object.entries(outcomes).filter(([caseId]) => !drafts.has(caseId)),
  );
  const totals: ReportTotals = {
    cases: counted.length,
    iterations: counted.reduce((sum, entry) => sum + entry.iterations, 0),
    judgedIterations,
    passedIterations,
    passRate: judgedIterations === 0 ? null : passedIterations / judgedIterations,
    interval: judgedIterations === 0 ? null : wilsonInterval(passedIterations, judgedIterations),
    passAllK:
      judged.length === 0 ? null : { k: smallestK, value: passAllK(countedOutcomes, smallestK) },
    flakyCases: counted.filter((entry) => entry.summary?.flaky === true).length,
    // A case refused with 429 in every iteration was never tried, it is not without checks.
    casesWithoutVerdict: counted.filter(
      (entry) => entry.summary === null && entry.notExecuted < entry.iterations,
    ).length,
    errors: counted.reduce((sum, entry) => sum + entry.errors, 0),
    notExecuted: counted.reduce((sum, entry) => sum + entry.notExecuted, 0),
    unresolvedCases: input.run.unresolvedCases?.length ?? 0,
    draftCases: cases.length - counted.length,
    correctedPassedIterations: rejectedRefs.size === 0 ? null : passedIterations + cleared.length,
    correctedPassRate:
      rejectedRefs.size === 0 || judgedIterations === 0
        ? null
        : (passedIterations + cleared.length) / judgedIterations,
    withoutJudgeVerdict: {
      refused: unjudged.filter((entry) => entry.kind === "refusal").length,
      errors: unjudged.filter((entry) => entry.kind === "error").length,
      countedAsFailed: unjudged.filter((entry) => entry.countedAsFailed).length,
    },
  };

  return {
    run: input.run,
    totals,
    cases,
    categories: buildCategories(cases, outcomes),
    calibrations: input.run.calibrations ?? [],
    samples: sampleFailures(input, verdicts),
    exchanges: buildExchanges(input, cases, grouped, verdicts),
    trend: [
      ...(input.history ?? []).filter((point) => point.runId !== input.run.id),
      trendPoint(input.run, input.verdicts, true, {
        ...(input.judgeFailures !== undefined ? { judgeFailures: input.judgeFailures } : {}),
        iterations: input.iterations,
      }),
    ].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId)),
    findings: decided.filter((finding) => finding.status === "confirmed"),
    rejectedFindings: decided.filter((finding) => finding.status === "rejected"),
    judgeFailures: unjudged,
    bindingChanges: bindingChangesOf(input.binding),
    unresolvedCases: unresolvedCasesOf(input.run, input.binding),
  };
}
