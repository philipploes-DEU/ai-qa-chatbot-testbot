import type { Tokens } from "../domain/common.js";
import type { Finding } from "../domain/finding.js";
import type { RunStatus, RunUsage } from "../domain/run.js";
import { type Interval, wilsonInterval } from "../stats/wilson.js";
import {
  escapeHtml,
  formatDate,
  htmlPage,
  htmlSection as section,
  htmlTable,
} from "./html-renderer.js";
import {
  describeWithoutJudge,
  formatDateTime,
  formatInterval,
  formatPercent,
  markdownTable,
  SEVERITY_LABELS,
} from "./markdown-renderer.js";
import type { CategoryReport, ReportModel, ReportTotals } from "./report-model.js";
import type { Renderer } from "./report-renderer.js";
import { defaultTheme, type ReportTheme } from "./themes/default/theme.js";
import { wirkmittelTheme } from "./themes/wirkmittel/theme.js";

/** One run as the handover lists it. */
export interface HandoverRun {
  id: string;
  planId: string;
  startedAt: string;
  status?: RunStatus;
  /** "sicherheit (Version 3)", for every goldset of the run. */
  goldsets: string;
  /** "claude-sonnet-5-5, Prompt v2", absent without a judge. */
  judge?: string;
  judgedIterations: number;
  passedIterations: number;
  correctedPassedIterations: number | null;
  /** describeWithoutJudge of the run, null without such iterations. */
  withoutJudge: string | null;
  usage?: RunUsage;
}

export interface HandoverUsage {
  calls: number;
  targetTokens: Tokens;
  judgeTokens: Tokens;
  /** Runs without a recorded usage; their effort is missing in the sums. */
  runsWithout: number;
}

export interface HandoverTotals extends Pick<ReportTotals, "withoutJudgeVerdict"> {
  /** Distinct cases over all runs, drafts not counted. */
  cases: number;
  iterations: number;
  judgedIterations: number;
  passedIterations: number;
  passRate: number | null;
  interval: Interval | null;
  /** Passed when rejected findings count as passed; null when no run has rejected findings. */
  correctedPassedIterations: number | null;
  correctedPassRate: number | null;
  /** Iterations the target refused with HTTP 429 (issue #96). */
  notExecuted: number;
  usage: HandoverUsage;
}

/**
 * Several runs against one target as one document for a handover (issue #87, ADR 0020). Every
 * number comes from the report models of the runs.
 */
export interface HandoverModel {
  target: string;
  /** Oldest first. */
  runs: HandoverRun[];
  totals: HandoverTotals;
  /** The result in a few sentences. */
  keyStatement: string[];
  /** Confirmed findings of all runs, most severe first. */
  findings: Finding[];
  rejectedFindings: Finding[];
  /** Failure rate per category over all runs, highest first. */
  categories: CategoryReport[];
  /** Areas deliberately not tested, from plans and goldsets, without repeats. */
  outOfScope: string[];
  /** What limits the statements of the check. */
  limits: string[];
}

export interface HandoverInput {
  reports: readonly ReportModel[];
}

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function addTokens(sum: Tokens, tokens: Tokens): Tokens {
  return { input: sum.input + tokens.input, output: sum.output + tokens.output };
}

function judgeLabel(model: ReportModel): string | undefined {
  const judge = model.run.judge;
  return judge === undefined ? undefined : `${judge.model}, Prompt ${judge.promptVersion}`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function sumCategories(reports: readonly ReportModel[]): CategoryReport[] {
  const byCategory = new Map<string, { cases: Set<string>; judged: number; failed: number }>();
  for (const report of reports) {
    for (const entry of report.cases.filter((caseReport) => !caseReport.draft)) {
      const current = byCategory.get(entry.category) ?? {
        cases: new Set<string>(),
        judged: 0,
        failed: 0,
      };
      current.cases.add(entry.caseId);
      if (entry.summary !== null) {
        current.judged += entry.summary.n;
        current.failed += entry.summary.n - entry.summary.passes;
      }
      byCategory.set(entry.category, current);
    }
  }
  return [...byCategory.entries()]
    .map(([category, counts]) => ({
      category,
      cases: counts.cases.size,
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

function buildLimits(reports: readonly ReportModel[], totals: HandoverTotals): string[] {
  const limits: string[] = [];
  // Per case over all runs, as the categories count them.
  const perCase = new Map<string, number>();
  for (const report of reports) {
    for (const entry of report.cases.filter((caseReport) => !caseReport.draft)) {
      const ran = entry.iterations - entry.notExecuted;
      perCase.set(entry.caseId, (perCase.get(entry.caseId) ?? 0) + ran);
    }
  }
  // A case the target refused in every run was never tried and has no interval.
  const counts = [...perCase.values()].filter((count) => count > 0);
  if (counts.length > 0) {
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const floor = (n: number): string => formatPercent(wilsonInterval(n, n).low);
    limits.push(
      min === max
        ? `Iterationen je Fall: ${String(min)}. Auch ${String(min)} von ${String(min)} bestanden heißt mit 95 Prozent Sicherheit nur eine Pass-Rate über ${floor(min)}.`
        : `Iterationen je Fall: ${String(min)} bis ${String(max)}. Auch ${String(min)} von ${String(min)} bestanden heißt mit 95 Prozent Sicherheit nur eine Pass-Rate über ${floor(min)}, bei ${String(max)} von ${String(max)} über ${floor(max)}.`,
    );
  }

  const uncalibrated = new Map<string, Set<string>>();
  const unreleased: string[] = [];
  const withoutSources = new Set<string>();
  const sourcesUnknown: string[] = [];
  for (const report of reports) {
    const { run } = report;
    const judge = judgeLabel(report);
    if (run.judge === undefined || judge === undefined) {
      limits.push(`Lauf ${run.id} lief ohne Judge, nur mit deterministischen Checks.`);
      continue;
    }
    const label = `${run.judge.model} (Prompt ${run.judge.promptVersion})`;
    // Runs before 0.8 did not record the sources; prompt v1 never reads any (ADR 0016).
    const sourcesRecorded = run.usage !== undefined || run.judge.promptVersion === "v1";
    if (!sourcesRecorded) sourcesUnknown.push(run.id);
    for (const goldset of run.goldsets) {
      const calibration = report.calibrations.find((entry) => entry.goldsetId === goldset.id);
      if (calibration === undefined) {
        const set = uncalibrated.get(label) ?? new Set<string>();
        set.add(goldset.id);
        uncalibrated.set(label, set);
      } else if (!calibration.released) {
        unreleased.push(`Der Judge ${label} ist für ${goldset.id} nicht freigegeben.`);
      }
      if (sourcesRecorded && goldset.sources === undefined) withoutSources.add(goldset.id);
    }
  }
  for (const [label, goldsets] of uncalibrated) {
    limits.push(
      `Der Judge ${label} ist für ${[...goldsets].join(", ")} nicht kalibriert, seine Urteile sind ungeprüft.`,
    );
  }
  limits.push(...new Set(unreleased));
  if (withoutSources.size > 0) {
    limits.push(
      `Ohne Quelldokumente für den Judge: ${[...withoutSources].join(", ")}. Angaben über die Referenz hinaus konnte er nicht gegen die Dokumente des Zielsystems prüfen.`,
    );
  }
  if (sourcesUnknown.length > 0) {
    limits.push(
      `Für ${sourcesUnknown.length === 1 ? "Lauf" : "die Läufe"} ${sourcesUnknown.join(", ")} ist nicht festgehalten, ob der Judge Quelldokumente las.`,
    );
  }
  const withoutJudge = describeWithoutJudge(totals);
  if (withoutJudge !== null) limits.push(`Ohne Judge-Urteil: ${withoutJudge}.`);
  const unresolved = reports.reduce((sum, report) => sum + report.totals.unresolvedCases, 0);
  if (unresolved > 0) {
    limits.push(
      `Nicht gebunden: ${plural(unresolved, "Fall", "Fälle")} ohne Wert für einen Platzhalter, nicht geschickt.`,
    );
  }
  if (totals.notExecuted > 0) {
    limits.push(
      `Nicht ausgeführt: ${plural(totals.notExecuted, "Iteration", "Iterationen")}, das Zielsystem lehnte sie mit HTTP 429 ab, etwa wegen eines Tageslimits.`,
    );
  }

  for (const report of reports) {
    const { run } = report;
    if (run.status === "aborted") {
      limits.push(
        `Lauf ${run.id} wurde abgebrochen${run.abortReason === undefined ? "" : ` (${run.abortReason})`}. Seine Zahlen gelten nur für die ausgeführten Iterationen.`,
      );
    }
    if (report.totals.draftCases > 0) {
      limits.push(
        `Lauf ${run.id}: ${plural(report.totals.draftCases, "Entwurf lief mit und zählt", "Entwürfe liefen mit und zählen")} nicht in die Quote.`,
      );
    }
    for (const warning of run.warnings ?? []) limits.push(`Lauf ${run.id}: ${warning}`);
  }
  return limits;
}

function buildKeyStatement(
  model: Omit<HandoverModel, "keyStatement" | "limits">,
  reports: readonly ReportModel[],
): string[] {
  const { totals } = model;
  const firstRun = reports[0]?.run;
  const lastRun = reports.at(-1)?.run;
  const sentences: string[] = [];
  if (firstRun !== undefined && lastRun !== undefined) {
    const from = formatDate(firstRun.startedAt);
    const to = formatDate(lastRun.startedAt);
    sentences.push(
      `${plural(model.runs.length, "Lauf", "Läufe")} gegen ${model.target} vom ${from === to ? from : `${from} bis ${to}`}, ${plural(totals.cases, "Fall", "Fälle")}, ${plural(totals.iterations, "Iteration", "Iterationen")}.`,
    );
  }
  if (totals.passRate === null) {
    sentences.push("Kein Urteil vorhanden.");
  } else {
    sentences.push(
      `Zusammen ${String(totals.passedIterations)} von ${String(totals.judgedIterations)} bewerteten Iterationen bestanden (${formatPercent(totals.passRate)}).`,
    );
    if (totals.correctedPassRate !== null && totals.correctedPassedIterations !== null) {
      sentences.push(
        `Bereinigt um verworfene Befunde: ${String(totals.correctedPassedIterations)} von ${String(totals.judgedIterations)} (${formatPercent(totals.correctedPassRate)}).`,
      );
    }
  }
  if (model.findings.length === 0) {
    sentences.push("Keine bestätigten Befunde.");
  } else {
    const bySeverity = Object.keys(SEVERITY_RANK)
      .map((severity) => ({
        severity,
        count: model.findings.filter((finding) => finding.severity === severity).length,
      }))
      .filter((entry) => entry.count > 0)
      .map(
        (entry) => `${String(entry.count)} ${SEVERITY_LABELS[entry.severity] ?? entry.severity}`,
      );
    sentences.push(
      `${plural(model.findings.length, "bestätigter Befund", "bestätigte Befunde")}: ${bySeverity.join(", ")}.`,
    );
  }
  if (model.rejectedFindings.length > 0) {
    sentences.push(
      `${plural(model.rejectedFindings.length, "Befund", "Befunde")} verworfen, etwa als Fehlalarm des Werkzeugs. Die bereinigte Quote zählt ${model.rejectedFindings.length === 1 ? "ihn" : "sie"} als bestanden.`,
    );
  }
  const weakest = model.categories[0];
  if (weakest?.failureRate !== null && weakest !== undefined && weakest.failedIterations > 0) {
    sentences.push(
      `Höchste Fehlerquote: ${weakest.category} mit ${formatPercent(weakest.failureRate)} (${String(weakest.failedIterations)} von ${String(weakest.judgedIterations)} Iterationen).`,
    );
  }
  if (model.outOfScope.length > 0) {
    sentences.push(
      `${plural(model.outOfScope.length, "Bereich", "Bereiche")} bewusst nicht geprüft, siehe unten.`,
    );
  }
  return sentences;
}

/** Combines the report models of runs against one target (issue #87, ADR 0020). */
export function buildHandoverModel(input: HandoverInput): HandoverModel {
  if (input.reports.length === 0) {
    throw new Error("Ein Übergabe-Report braucht mindestens einen Lauf.");
  }
  const byId = new Map(input.reports.map((report) => [report.run.id, report]));
  const reports = [...byId.values()].sort(
    (a, b) => a.run.startedAt.localeCompare(b.run.startedAt) || a.run.id.localeCompare(b.run.id),
  );
  const targets = [...new Set(reports.map((report) => report.run.target))];
  if (targets.length > 1) {
    throw new Error(
      `Die Läufe gehören zu verschiedenen Zielsystemen (${targets.join(", ")}). Ein Übergabe-Report fasst nur Läufe eines Zielsystems zusammen.`,
    );
  }

  const runs: HandoverRun[] = reports.map((report) => {
    const judge = judgeLabel(report);
    return {
      id: report.run.id,
      planId: report.run.planId,
      startedAt: report.run.startedAt,
      ...(report.run.status !== undefined ? { status: report.run.status } : {}),
      goldsets: report.run.goldsets
        .map((goldset) => `${goldset.id} (Version ${goldset.version})`)
        .join(", "),
      ...(judge !== undefined ? { judge } : {}),
      judgedIterations: report.totals.judgedIterations,
      passedIterations: report.totals.passedIterations,
      correctedPassedIterations: report.totals.correctedPassedIterations,
      withoutJudge: describeWithoutJudge(report.totals),
      ...(report.run.usage !== undefined ? { usage: report.run.usage } : {}),
    };
  });

  const sum = (pick: (totals: ReportTotals) => number): number =>
    reports.reduce((total, report) => total + pick(report.totals), 0);
  const judged = sum((totals) => totals.judgedIterations);
  const passed = sum((totals) => totals.passedIterations);
  const anyCorrected = reports.some((report) => report.totals.correctedPassedIterations !== null);
  const corrected = sum((totals) => totals.correctedPassedIterations ?? totals.passedIterations);
  const usage = reports.reduce<HandoverUsage>(
    (total, report) =>
      report.run.usage === undefined
        ? { ...total, runsWithout: total.runsWithout + 1 }
        : {
            calls: total.calls + report.run.usage.calls,
            targetTokens: addTokens(total.targetTokens, report.run.usage.targetTokens),
            judgeTokens: addTokens(total.judgeTokens, report.run.usage.judgeTokens),
            runsWithout: total.runsWithout,
          },
    {
      calls: 0,
      targetTokens: { input: 0, output: 0 },
      judgeTokens: { input: 0, output: 0 },
      runsWithout: 0,
    },
  );
  const totals: HandoverTotals = {
    cases: new Set(
      reports.flatMap((report) =>
        report.cases.filter((entry) => !entry.draft).map((entry) => entry.caseId),
      ),
    ).size,
    iterations: sum((totals) => totals.iterations),
    judgedIterations: judged,
    passedIterations: passed,
    passRate: judged === 0 ? null : passed / judged,
    interval: judged === 0 ? null : wilsonInterval(passed, judged),
    correctedPassedIterations: anyCorrected ? corrected : null,
    correctedPassRate: anyCorrected && judged > 0 ? corrected / judged : null,
    notExecuted: sum((totals) => totals.notExecuted),
    withoutJudgeVerdict: {
      refused: sum((totals) => totals.withoutJudgeVerdict.refused),
      errors: sum((totals) => totals.withoutJudgeVerdict.errors),
      countedAsFailed: sum((totals) => totals.withoutJudgeVerdict.countedAsFailed),
    },
    usage,
  };

  const findings = reports
    .flatMap((report) => report.findings)
    .map((finding, position) => ({ finding, position }))
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.finding.severity] ?? 9) - (SEVERITY_RANK[b.finding.severity] ?? 9) ||
        a.position - b.position,
    )
    .map(({ finding }) => finding);

  const partial = {
    target: targets[0] ?? "",
    runs,
    totals,
    findings,
    rejectedFindings: reports.flatMap((report) => report.rejectedFindings),
    categories: sumCategories(reports),
    outOfScope: [...new Set(reports.flatMap((report) => report.run.outOfScope ?? []))],
  };
  return {
    ...partial,
    keyStatement: buildKeyStatement(partial, reports),
    limits: buildLimits(reports, totals),
  };
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  completed: "abgeschlossen",
  aborted: "abgebrochen",
};

function passedText(passed: number, judged: number): string {
  return judged === 0
    ? "kein Urteil"
    : `${String(passed)} von ${String(judged)} (${formatPercent(passed / judged)})`;
}

function runRow(run: HandoverRun): string[] {
  return [
    run.id,
    run.planId,
    formatDateTime(run.startedAt),
    run.goldsets,
    run.judge ?? "ohne Judge",
    passedText(run.passedIterations, run.judgedIterations),
    run.correctedPassedIterations === null
      ? ""
      : passedText(run.correctedPassedIterations, run.judgedIterations),
    run.withoutJudge ?? "0",
    run.status === undefined ? "läuft" : (STATUS_LABELS[run.status] ?? run.status),
  ];
}

const RUN_HEADER = [
  "Lauf",
  "Plan",
  "Start",
  "Goldsets",
  "Judge",
  "Bestanden",
  "Bereinigt",
  "Ohne Judge-Urteil",
  "Status",
];

const USAGE_HEADER = [
  "Lauf",
  "Aufrufe",
  "Tokens Zielsystem, Eingabe",
  "Tokens Zielsystem, Ausgabe",
  "Tokens Judge, Eingabe",
  "Tokens Judge, Ausgabe",
];

function usageRows(model: HandoverModel): string[][] {
  const { usage } = model.totals;
  return [
    ...model.runs.map((run) =>
      run.usage === undefined
        ? [run.id, "nicht erfasst", "", "", "", ""]
        : [
            run.id,
            String(run.usage.calls),
            String(run.usage.targetTokens.input),
            String(run.usage.targetTokens.output),
            String(run.usage.judgeTokens.input),
            String(run.usage.judgeTokens.output),
          ],
    ),
    usage.runsWithout === model.runs.length
      ? ["Gesamt", "nicht erfasst", "", "", "", ""]
      : [
          "Gesamt",
          String(usage.calls),
          String(usage.targetTokens.input),
          String(usage.targetTokens.output),
          String(usage.judgeTokens.input),
          String(usage.judgeTokens.output),
        ],
  ];
}

function usageNote(model: HandoverModel): string | null {
  const notes: string[] = [];
  const missing = model.totals.usage.runsWithout;
  if (missing > 0) {
    notes.push(
      `${plural(missing, "Lauf", "Läufe")} ohne erfassten Aufwand, etwa aus einer Version vor AI QA 0.8 oder nicht regulär beendet. ${missing === 1 ? "Er fehlt" : "Sie fehlen"} in der Summe.`,
    );
  }
  const { refused, errors } = model.totals.withoutJudgeVerdict;
  if (refused + errors > 0) {
    notes.push(
      "Tokens abgelehnter oder gescheiterter Judge-Aufrufe sind nicht erfasst, die Judge-Spalte liegt dort zu niedrig.",
    );
  }
  return notes.length === 0 ? null : notes.join(" ");
}

function categoryRow(entry: CategoryReport): string[] {
  return [
    entry.category,
    String(entry.cases),
    entry.failureRate === null
      ? "ohne Urteil"
      : `${String(entry.judgedIterations - entry.failedIterations)} von ${String(entry.judgedIterations)}`,
    entry.failureRate === null ? "" : formatPercent(entry.failureRate),
    entry.interval === null ? "" : formatInterval(entry.interval),
  ];
}

const CATEGORY_HEADER = [
  "Kategorie",
  "Fälle",
  "Bestanden",
  "Fehlerquote",
  "Wilson-Intervall der Fehlerquote (95 %)",
];

const NO_SCOPE_NOTE =
  "Plan und Goldsets nennen keine bewusst ausgelassenen Bereiche. Geprüft ist nur, was die Fälle abdecken.";

const REJECTED_NOTE =
  "Fehlschläge, die ein Mensch geprüft und verworfen hat, etwa als Fehlalarm des Werkzeugs. Die bereinigte Quote zählt sie als bestanden.";

/** Finding ids repeat across runs, so the title names the run as well. */
function findingTitle(finding: Finding): string {
  return `${finding.id} aus Lauf ${finding.runId}: ${finding.category}, Schwere ${SEVERITY_LABELS[finding.severity] ?? finding.severity}`;
}

function findingMeta(finding: Finding): string {
  return (
    `Fälle: ${finding.caseIds.join(", ")}.` +
    (finding.failedIterations === undefined
      ? ""
      : ` Fehlschläge: ${String(finding.failedIterations)}.`) +
    (finding.evidenceRefs.length === 0 ? "" : ` Belege: ${finding.evidenceRefs.join(", ")}.`)
  );
}

function rejectedLine(finding: Finding): string {
  return (
    `${finding.id} (${finding.caseIds.join(", ")}): ${finding.hypothesis}` +
    (finding.note === undefined ? "" : ` Grund: ${finding.note}`)
  );
}

/** The handover as Markdown with German wording. */
export class HandoverMarkdownRenderer implements Renderer<HandoverModel> {
  readonly format = "markdown";
  readonly fileExtension = "md";

  render(model: HandoverModel, theme: ReportTheme = defaultTheme): string {
    const lines: string[] = [];
    lines.push(`# Übergabe: ${model.target}`, "");
    lines.push(
      `${theme.title} über ${plural(model.runs.length, "Lauf", "Läufe")}: ${model.runs.map((run) => `\`${run.id}\``).join(", ")}.`,
      "",
    );

    lines.push("## Ergebnis", "");
    for (const sentence of model.keyStatement) lines.push(sentence, "");

    lines.push("## Befunde", "");
    if (model.findings.length === 0) lines.push("Keine bestätigten Befunde.", "");
    for (const finding of model.findings) {
      lines.push(`### ${findingTitle(finding)}`, "", finding.hypothesis, "");
      if (finding.cause !== undefined) lines.push(`Ursache: ${finding.cause}`, "");
      if (finding.suggestion !== undefined) lines.push(`Vorschlag: ${finding.suggestion}`, "");
      lines.push(findingMeta(finding), "");
    }

    if (model.rejectedFindings.length > 0) {
      lines.push("## Verworfene Befunde", "", REJECTED_NOTE, "");
      for (const finding of model.rejectedFindings) lines.push(`- ${rejectedLine(finding)}`);
      lines.push("");
    }

    lines.push("## Bestanden je Kategorie", "");
    lines.push(...markdownTable(CATEGORY_HEADER, model.categories.map(categoryRow)), "");

    lines.push("## Bewusst nicht geprüft", "");
    if (model.outOfScope.length === 0) lines.push(NO_SCOPE_NOTE, "");
    else lines.push(...model.outOfScope.map((entry) => `- ${entry}`), "");

    lines.push("## Grenzen der Prüfung", "");
    lines.push(...model.limits.map((entry) => `- ${entry}`), "");

    lines.push("## Aufwand", "");
    lines.push(...markdownTable(USAGE_HEADER, usageRows(model)), "");
    const note = usageNote(model);
    if (note !== null) lines.push(note, "");

    lines.push("## Läufe", "");
    lines.push(...markdownTable(RUN_HEADER, model.runs.map(runRow)), "");
    return lines.join("\n");
  }
}

function escapeRow(row: readonly string[]): string[] {
  return row.map((cell) => escapeHtml(cell));
}

/** The handover as one self-contained HTML page in the theme (ADR 0009, ADR 0020). */
export class HandoverHtmlRenderer implements Renderer<HandoverModel> {
  readonly format = "html";
  readonly fileExtension = "html";

  render(model: HandoverModel, theme: ReportTheme = wirkmittelTheme): string {
    const first = model.runs[0];
    const last = model.runs.at(-1);
    const dates =
      first === undefined || last === undefined
        ? ""
        : formatDate(first.startedAt) === formatDate(last.startedAt)
          ? formatDate(first.startedAt)
          : `${formatDate(first.startedAt)} bis ${formatDate(last.startedAt)}`;
    const number =
      model.totals.passRate === null
        ? ""
        : `<p class="key-number">${escapeHtml(formatPercent(model.totals.passRate))}</p>\n`;
    const key = section(
      "Ergebnis",
      `<div class="key">\n${number}${model.keyStatement.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join("\n")}\n</div>`,
    );
    const findings = section(
      "Befunde",
      model.findings.length === 0
        ? `<p class="muted">Keine bestätigten Befunde.</p>`
        : model.findings
            .map(
              (finding) =>
                `<h3>${escapeHtml(findingTitle(finding))}</h3>\n<p>${escapeHtml(finding.hypothesis)}</p>\n` +
                (finding.cause === undefined
                  ? ""
                  : `<p>Ursache: ${escapeHtml(finding.cause)}</p>\n`) +
                (finding.suggestion === undefined
                  ? ""
                  : `<p>Vorschlag: ${escapeHtml(finding.suggestion)}</p>\n`) +
                `<p class="meta">${escapeHtml(findingMeta(finding))}</p>`,
            )
            .join("\n"),
    );
    const rejected =
      model.rejectedFindings.length === 0
        ? ""
        : section(
            "Verworfene Befunde",
            `<p>${escapeHtml(REJECTED_NOTE)}</p>\n<ul>\n${model.rejectedFindings.map((finding) => `<li>${escapeHtml(rejectedLine(finding))}</li>`).join("\n")}\n</ul>`,
          );
    const categories = section(
      "Bestanden je Kategorie",
      htmlTable(CATEGORY_HEADER, model.categories.map(categoryRow).map(escapeRow), [1, 2, 3]),
    );
    const scope = section(
      "Bewusst nicht geprüft",
      model.outOfScope.length === 0
        ? `<p class="muted">${escapeHtml(NO_SCOPE_NOTE)}</p>`
        : `<ul>\n${model.outOfScope.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("\n")}\n</ul>`,
    );
    const limits = section(
      "Grenzen der Prüfung",
      `<div class="warn"><ul>\n${model.limits.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("\n")}\n</ul></div>`,
    );
    const note = usageNote(model);
    const usage = section(
      "Aufwand",
      htmlTable(USAGE_HEADER, usageRows(model).map(escapeRow), [1, 2, 3, 4, 5]) +
        (note === null ? "" : `\n<p class="muted">${escapeHtml(note)}</p>`),
    );
    const runs = section("Läufe", htmlTable(RUN_HEADER, model.runs.map(runRow).map(escapeRow)));
    return htmlPage(
      theme,
      {
        title: `Übergabe, ${model.target}`,
        meta: model.runs.map((run) => run.id).join(", "),
        heading: `Übergabe: ${model.target}`,
        subtitle: `${plural(model.runs.length, "Lauf", "Läufe")}${dates === "" ? "" : ` vom ${dates}`}`,
      },
      [key, findings, rejected, categories, scope, limits, usage, runs],
    );
  }
}
