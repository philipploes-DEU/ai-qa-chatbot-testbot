import type { Severity } from "../domain/common.js";
import type { PairVerdict, PairWinner } from "../domain/pair-verdict.js";
import type { Interval } from "../stats/wilson.js";
import { formatDateTime, formatNumber, formatPercent } from "./markdown-renderer.js";
import type { CaseReport, ReportModel } from "./report-model.js";

/** Weight of a failure by severity for the weighted failure rate. */
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 5,
};

export interface CaseSide {
  iterations: number;
  passRate: number | null;
  interval: Interval | null;
  flakiness: number | null;
  errors: number;
}

export interface CaseComparison {
  caseId: string;
  severity?: Severity;
  base: CaseSide;
  head: CaseSide;
  /** Pass rate difference in points, head minus base; null when a side has no verdict. */
  passRateDelta: number | null;
  flakinessDelta: number | null;
  /** The confidence intervals do not overlap: the change is unlikely to be noise. */
  significant: boolean;
  /** Criteria that fail in head but not in base. */
  newFailures: string[];
  /** Criteria that fail in base but not in head. */
  vanishedFailures: string[];
  sameIterations: boolean;
}

export interface ComparisonTotals {
  commonCases: number;
  baseOnly: string[];
  headOnly: string[];
  /** Failures weighted by severity over all iterations of the common cases, per side. */
  weightedFailureRate: { base: number | null; head: number | null; delta: number | null };
  passRate: { base: number | null; head: number | null; delta: number | null };
  improved: number;
  regressed: number;
  newFailures: number;
  vanishedFailures: number;
  flakinessUp: number;
  flakinessDown: number;
  differentIterations: number;
}

export interface PairwiseSummary {
  judge: string;
  pairs: number;
  counts: Record<PairWinner, number>;
  /** Per case: how often each run won. */
  cases: { caseId: string; base: number; head: number; tie: number; undecided: number }[];
}

export interface ComparisonModel {
  base: { id: string; startedAt: string; target: string; judge?: string };
  head: { id: string; startedAt: string; target: string; judge?: string };
  totals: ComparisonTotals;
  cases: CaseComparison[];
  /** Goldset or catalog versions that differ between the runs. */
  versionChanges: string[];
  /** Pairwise judge comparison of the answers, when requested (issue #10). */
  pairwise?: PairwiseSummary;
  /**
   * Placeholders {{fixtures.name}} with different values in base and head, without the values
   * (issue #93, ADR 0022).
   */
  bindingChanges?: { placeholder: string; query?: string; queryVersion?: string }[];
}

/** Aggregates pair verdicts into the summary the report shows. */
export function summarizePairs(verdicts: readonly PairVerdict[], judge: string): PairwiseSummary {
  const counts: Record<PairWinner, number> = { base: 0, head: 0, tie: 0, undecided: 0 };
  const byCase = new Map<string, Record<PairWinner, number>>();
  for (const verdict of verdicts) {
    counts[verdict.winner]++;
    const entry = byCase.get(verdict.caseId) ?? { base: 0, head: 0, tie: 0, undecided: 0 };
    entry[verdict.winner]++;
    byCase.set(verdict.caseId, entry);
  }
  return {
    judge,
    pairs: verdicts.length,
    counts,
    cases: [...byCase.entries()].map(([caseId, entry]) => ({ caseId, ...entry })),
  };
}

function side(report: CaseReport): CaseSide {
  return {
    iterations: report.iterations,
    passRate: report.summary?.passRate ?? null,
    interval: report.summary?.interval ?? null,
    flakiness: report.summary?.flakiness ?? null,
    errors: report.errors,
  };
}

function failingCriteria(report: CaseReport): Set<string> {
  return new Set(report.failures.flatMap((failure) => failure.checks.map((check) => check.name)));
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

function overlap(a: Interval | null, b: Interval | null): boolean {
  if (a === null || b === null) return true;
  return a.low <= b.high && b.low <= a.high;
}

function weightedFailureRate(reports: readonly CaseReport[]): number | null {
  let failed = 0;
  let total = 0;
  for (const report of reports) {
    if (report.summary === null) continue;
    const weight = SEVERITY_WEIGHTS[report.severity ?? "medium"];
    failed += weight * (report.summary.n - report.summary.passes);
    total += weight * report.summary.n;
  }
  return total === 0 ? null : failed / total;
}

function passRateOf(reports: readonly CaseReport[]): number | null {
  let passes = 0;
  let n = 0;
  for (const report of reports) {
    if (report.summary === null) continue;
    passes += report.summary.passes;
    n += report.summary.n;
  }
  return n === 0 ? null : passes / n;
}

function versionChanges(base: ReportModel, head: ReportModel): string[] {
  const changes: string[] = [];
  const baseGoldsets = new Map(base.run.goldsets.map((goldset) => [goldset.id, goldset.version]));
  for (const goldset of head.run.goldsets) {
    const before = baseGoldsets.get(goldset.id);
    if (before === undefined) {
      changes.push(`Goldset ${goldset.id} nur im Head-Lauf (Version ${goldset.version})`);
    } else if (before !== goldset.version) {
      changes.push(
        `Goldset ${goldset.id}: Version ${before} im Base-Lauf, ${goldset.version} im Head-Lauf`,
      );
    }
  }
  const headIds = new Set(head.run.goldsets.map((goldset) => goldset.id));
  for (const goldset of base.run.goldsets) {
    if (!headIds.has(goldset.id)) {
      changes.push(`Goldset ${goldset.id} nur im Base-Lauf (Version ${goldset.version})`);
    }
  }
  if (base.run.catalogVersion !== head.run.catalogVersion) {
    changes.push(
      `Katalogversion ${base.run.catalogVersion ?? "unbekannt"} im Base-Lauf, ${head.run.catalogVersion ?? "unbekannt"} im Head-Lauf`,
    );
  }
  if (
    base.run.judge?.model !== head.run.judge?.model ||
    base.run.judge?.promptVersion !== head.run.judge?.promptVersion
  ) {
    changes.push(
      `Judge ${base.run.judge === undefined ? "keiner" : `${base.run.judge.model} (Prompt ${base.run.judge.promptVersion})`} im Base-Lauf, ${head.run.judge === undefined ? "keiner" : `${head.run.judge.model} (Prompt ${head.run.judge.promptVersion})`} im Head-Lauf`,
    );
  }
  return changes;
}

/**
 * Compares two runs over the cases they share (issue #15). Cases of one side only are listed,
 * not compared. A change counts as significant when the Wilson intervals do not overlap.
 */
export function compareRuns(base: ReportModel, head: ReportModel): ComparisonModel {
  // A case that is a draft on either side is neither compared nor listed as one-sided.
  const drafts = new Set(
    [...base.cases, ...head.cases].filter((report) => report.draft).map((report) => report.caseId),
  );
  const baseCounted = base.cases.filter((report) => !drafts.has(report.caseId));
  const headCounted = head.cases.filter((report) => !drafts.has(report.caseId));
  const headCases = new Map(headCounted.map((report) => [report.caseId, report]));
  const baseCases = new Map(baseCounted.map((report) => [report.caseId, report]));
  const pairs = baseCounted.flatMap((b) => {
    const h = headCases.get(b.caseId);
    return h === undefined ? [] : [{ b, h }];
  });

  const cases: CaseComparison[] = pairs.map(({ b, h }) => {
    const baseFailing = failingCriteria(b);
    const headFailing = failingCriteria(h);
    const bs = side(b);
    const hs = side(h);
    return {
      caseId: b.caseId,
      ...(h.severity !== undefined ? { severity: h.severity } : {}),
      base: bs,
      head: hs,
      passRateDelta: delta(bs.passRate, hs.passRate),
      flakinessDelta: delta(bs.flakiness, hs.flakiness),
      significant: !overlap(bs.interval, hs.interval),
      newFailures: [...headFailing].filter((name) => !baseFailing.has(name)).sort(),
      vanishedFailures: [...baseFailing].filter((name) => !headFailing.has(name)).sort(),
      sameIterations: b.iterations === h.iterations,
    };
  });

  const commonBase = pairs.map((pair) => pair.b);
  const commonHead = pairs.map((pair) => pair.h);
  const weighted = {
    base: weightedFailureRate(commonBase),
    head: weightedFailureRate(commonHead),
  };
  const rates = { base: passRateOf(commonBase), head: passRateOf(commonHead) };

  const describe = (run: ReportModel["run"]): ComparisonModel["base"] => ({
    id: run.id,
    startedAt: run.startedAt,
    target: run.target,
    ...(run.judge !== undefined
      ? { judge: `${run.judge.model} (Prompt ${run.judge.promptVersion})` }
      : {}),
  });

  return {
    base: describe(base.run),
    head: describe(head.run),
    totals: {
      commonCases: cases.length,
      baseOnly: baseCounted.map((r) => r.caseId).filter((id) => !headCases.has(id)),
      headOnly: headCounted.map((r) => r.caseId).filter((id) => !baseCases.has(id)),
      weightedFailureRate: { ...weighted, delta: delta(weighted.base, weighted.head) },
      passRate: { ...rates, delta: delta(rates.base, rates.head) },
      improved: cases.filter((c) => c.passRateDelta !== null && c.passRateDelta > 0).length,
      regressed: cases.filter((c) => c.passRateDelta !== null && c.passRateDelta < 0).length,
      newFailures: cases.reduce((sum, c) => sum + c.newFailures.length, 0),
      vanishedFailures: cases.reduce((sum, c) => sum + c.vanishedFailures.length, 0),
      flakinessUp: cases.filter((c) => c.flakinessDelta !== null && c.flakinessDelta > 0).length,
      flakinessDown: cases.filter((c) => c.flakinessDelta !== null && c.flakinessDelta < 0).length,
      differentIterations: cases.filter((c) => !c.sameIterations).length,
    },
    cases,
    versionChanges: versionChanges(base, head),
  };
}

function points(value: number | null): string {
  if (value === null) return "";
  const text = `${formatNumber(Math.abs(value) * 100, 1)} Punkte`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : "0,0 Punkte";
}

function rate(value: number | null): string {
  return value === null ? "kein Urteil" : formatPercent(value);
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

/** Renders the comparison as Markdown with German wording. */
export function renderComparisonMarkdown(model: ComparisonModel): string {
  const { totals } = model;
  const lines: string[] = [];
  lines.push("# AI QA Vergleich", "");
  lines.push(
    `Base: Lauf \`${model.base.id}\` vom ${formatDateTime(model.base.startedAt)} gegen \`${model.base.target}\`${model.base.judge === undefined ? "" : `, Judge ${model.base.judge}`}.`,
  );
  lines.push(
    `Head: Lauf \`${model.head.id}\` vom ${formatDateTime(model.head.startedAt)} gegen \`${model.head.target}\`${model.head.judge === undefined ? "" : `, Judge ${model.head.judge}`}.`,
    "",
  );
  if (model.versionChanges.length > 0) {
    lines.push("## Geänderte Versionen", "");
    lines.push(
      "Die Läufe beruhen nicht auf denselben Grundlagen, Unterschiede können daher kommen:",
      "",
    );
    for (const change of model.versionChanges) lines.push(`- ${change}`);
    lines.push("");
  }

  if (model.bindingChanges !== undefined && model.bindingChanges.length > 0) {
    lines.push("## Geänderte Bindungen", "");
    lines.push(
      "Diese Platzhalter hatten in Base und Head verschiedene Werte aus der Datenquelle. Fälle damit haben nicht dasselbe gefragt, ein Unterschied kann am Datenstand liegen. Die Werte stehen in `runs/<lauf>/bindings.json`.",
      "",
    );
    for (const change of model.bindingChanges) {
      lines.push(
        `- ${change.placeholder}${change.query === undefined ? "" : ` (${change.query}${change.queryVersion === undefined ? "" : `, Version ${change.queryVersion}`})`}`,
      );
    }
    lines.push("");
  }

  lines.push("## Zusammenfassung", "");
  lines.push(
    row(["Kennzahl", "Base", "Head", "Änderung"]),
    row(["---", "---", "---", "---"]),
    row([
      "Pass-Rate über gemeinsame Fälle",
      rate(totals.passRate.base),
      rate(totals.passRate.head),
      points(totals.passRate.delta),
    ]),
    row([
      "Gewichtete Fehlerquote (nach Schwere)",
      rate(totals.weightedFailureRate.base),
      rate(totals.weightedFailureRate.head),
      points(totals.weightedFailureRate.delta),
    ]),
    row(["Gemeinsame Fälle", String(totals.commonCases), String(totals.commonCases), ""]),
    row([
      "Fälle verbessert / verschlechtert",
      "",
      "",
      `${String(totals.improved)} / ${String(totals.regressed)}`,
    ]),
    row([
      "Neue / verschwundene Fehlschläge",
      "",
      "",
      `${String(totals.newFailures)} / ${String(totals.vanishedFailures)}`,
    ]),
    row([
      "Flakiness gestiegen / gesunken",
      "",
      "",
      `${String(totals.flakinessUp)} / ${String(totals.flakinessDown)}`,
    ]),
    row(["Fälle mit anderer Iterationszahl", "", "", String(totals.differentIterations)]),
    "",
  );
  if (totals.baseOnly.length > 0 || totals.headOnly.length > 0) {
    if (totals.baseOnly.length > 0) lines.push(`Nur im Base-Lauf: ${totals.baseOnly.join(", ")}.`);
    if (totals.headOnly.length > 0) lines.push(`Nur im Head-Lauf: ${totals.headOnly.join(", ")}.`);
    lines.push("");
  }

  lines.push("## Je Fall", "");
  lines.push(
    row([
      "Fall",
      "Schwere",
      "Iterationen Base / Head",
      "Pass-Rate Base",
      "Pass-Rate Head",
      "Änderung",
      "Wilson-Intervall Base",
      "Wilson-Intervall Head",
      "Flakiness Base / Head",
      "Signifikant",
    ]),
    row(Array.from({ length: 10 }, () => "---")),
  );
  for (const entry of model.cases) {
    lines.push(
      row([
        entry.caseId,
        entry.severity ?? "",
        `${String(entry.base.iterations)} / ${String(entry.head.iterations)}${entry.sameIterations ? "" : " (ungleich)"}`,
        rate(entry.base.passRate),
        rate(entry.head.passRate),
        points(entry.passRateDelta),
        entry.base.interval === null
          ? ""
          : `${formatPercent(entry.base.interval.low)} bis ${formatPercent(entry.base.interval.high)}`,
        entry.head.interval === null
          ? ""
          : `${formatPercent(entry.head.interval.low)} bis ${formatPercent(entry.head.interval.high)}`,
        `${entry.base.flakiness === null ? "" : formatNumber(entry.base.flakiness, 2)} / ${entry.head.flakiness === null ? "" : formatNumber(entry.head.flakiness, 2)}`,
        entry.significant ? "ja" : "nein",
      ]),
    );
  }
  lines.push("");

  const withChanges = model.cases.filter(
    (entry) => entry.newFailures.length > 0 || entry.vanishedFailures.length > 0,
  );
  if (withChanges.length > 0) {
    lines.push("## Neue und verschwundene Fehlschläge", "");
    for (const entry of withChanges) {
      if (entry.newFailures.length > 0) {
        lines.push(`- ${entry.caseId}: neu ${entry.newFailures.join(", ")}`);
      }
      if (entry.vanishedFailures.length > 0) {
        lines.push(`- ${entry.caseId}: verschwunden ${entry.vanishedFailures.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (model.pairwise !== undefined) {
    const { pairwise } = model;
    lines.push("## Paarvergleich durch den Judge", "");
    lines.push(
      `${String(pairwise.pairs)} Antwortpaare, bewertet von ${pairwise.judge} in beiden Reihenfolgen. ` +
        `Head besser: ${String(pairwise.counts.head)}, Base besser: ${String(pairwise.counts.base)}, gleich: ${String(pairwise.counts.tie)}, unentschieden: ${String(pairwise.counts.undecided)}.`,
      "",
    );
    if (pairwise.counts.undecided > 0) {
      lines.push(
        `**${String(pairwise.counts.undecided)} Paare sind unentschieden:** der Judge urteilte je nach Reihenfolge anders. Das ist Positionsbias, kein Unterschied der Antworten. Diese Paare zählen nicht.`,
        "",
      );
    }
    lines.push(
      row(["Fall", "Head besser", "Base besser", "Gleich", "Unentschieden"]),
      row(["---", "---", "---", "---", "---"]),
      ...pairwise.cases.map((entry) =>
        row([
          entry.caseId,
          String(entry.head),
          String(entry.base),
          String(entry.tie),
          String(entry.undecided),
        ]),
      ),
      "",
    );
  }

  lines.push("## Hinweise", "");
  lines.push(
    "- Änderung: Pass-Rate im Head-Lauf minus Base-Lauf in Prozentpunkten. Positiv ist besser.",
    "- Signifikant: die Wilson-Intervalle der beiden Läufe überlappen nicht. Bei wenigen Iterationen überlappen sie fast immer, dann ist eine Änderung kein Beleg.",
    "- Gewichtete Fehlerquote: gescheiterte Iterationen gewichtet nach Schwere des Falls (low 1, medium 2, high 3, critical 5), geteilt durch alle gewichteten Iterationen.",
    "- Neue Fehlschläge: Kriterien, die im Head-Lauf scheitern und im Base-Lauf nicht. Verschwundene umgekehrt.",
    "- Verglichen werden nur Fälle, die in beiden Läufen vorkommen. Fälle mit anderer Iterationszahl sind markiert.",
    "- Paarvergleich: der Judge sieht beide Antworten einer Iteration, einmal in jeder Reihenfolge. Nur ein Urteil, das den Tausch übersteht, zählt.",
    "",
  );
  return lines.join("\n");
}
