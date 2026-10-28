import { describeKappa } from "../stats/kappa.js";
import type { Interval } from "../stats/wilson.js";
import {
  type CaseExchange,
  type CaseReport,
  type ReportModel,
  type ReportTotals,
  SAMPLE_RESPONSE_LENGTH,
  type UnjudgedIteration,
} from "./report-model.js";
import type { ReportRenderer } from "./report-renderer.js";
import { defaultTheme, type ReportTheme } from "./themes/default/theme.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 10.10.2026, 12:00:00 UTC. Deterministic, independent of the machine's locale. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return (
    `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${String(date.getUTCFullYear())}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

export function formatDuration(startIso: string, endIso: string): string {
  const seconds = (Date.parse(endIso) - Date.parse(startIso)) / 1000;
  return `${formatNumber(seconds, 1)} s`;
}

export function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

export function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)} %`;
}

export function formatInterval(interval: Interval): string {
  return `${formatPercent(interval.low)} bis ${formatPercent(interval.high)}`;
}

/** German names of the severities, shared by every renderer. */
export const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
  critical: "kritisch",
};

/** Explanations of the figures, shared by every renderer. */
export const REPORT_GLOSSARY: readonly string[] = [
  "Pass-Rate: Anteil der Iterationen eines Falls, in denen alle Urteile bestanden sind.",
  "Wilson-Intervall: Bereich, in dem die wahre Pass-Rate mit 95 Prozent Sicherheit liegt. Je weniger Iterationen, desto breiter.",
  "Flakiness: Anteil der Iterationen, die vom Mehrheitsergebnis abweichen, von 0 (stabil) bis 0,5 (halb und halb).",
  "pass-all-k: geschätzte Wahrscheinlichkeit, dass k zufällig gezogene Iterationen eines Falls alle bestehen, gemittelt über die Fälle.",
  "Fehlerquote je Kategorie: Anteil der bewerteten Iterationen mit mindestens einem nicht bestandenen Urteil. Kategorie ist die Quelle des Falls (etwa LLM01), sonst sein erstes Tag.",
  "Trend: Pass-Rate der letzten Läufe gegen dasselbe Zielsystem, mit Wilson-Intervall.",
  "Fälle ohne Urteil haben keine anwendbaren Checks und keine Rubrik oder keinen Judge in aiqa.yaml.",
  "Nicht gebunden (unresolved): Fälle, deren Platzhalter aus der Datenquelle keinen Wert bekamen. Sie wurden nicht geschickt und zählen in keiner Quote.",
  "Nicht ausgeführt (HTTP 429): Iterationen, die das Zielsystem abgelehnt hat, etwa wegen eines Tageslimits. Sie haben nichts geprüft und zählen in keiner Quote. Der Lauf bricht beim ersten solchen Aufruf ab.",
  "Ohne Judge-Urteil: Iterationen, die der Judge bewerten sollte, aber nicht bewertet hat, weil das Modell ablehnte (Judge lehnt ab) oder scheiterte (Judge-Fehler). Sie zählen nicht in der Pass-Rate, außer ein Treffer in mustNotClaim zählt ohne Urteil als Fehlschlag. aiqa judge --run bewertet sie nach.",
  "Leere Antworten: Iterationen, in denen das Zielsystem nichts oder nur Leerzeichen geantwortet hat. Sie scheitern mit dem Check empty, außer der Fall erlaubt es mit allowEmpty oder erwartet einen HTTP-Status.",
  "Cohen's Kappa: Übereinstimmung des Judge mit menschlichen Labels, um Zufall bereinigt. 1 ist perfekt, 0 Zufall. Unter der Schwelle des Goldsets ist der Judge nicht freigegeben.",
];

/** Longest reason of a judge failure a report shows; model answers can be long. */
const FAILURE_REASON_LENGTH = 300;

/** The reason of a judge failure, shortened for a report. */
export function shortReason(reason: string): string {
  const flat = reason.replace(/\s+/g, " ").trim();
  return flat.length > FAILURE_REASON_LENGTH
    ? `${flat.slice(0, FAILURE_REASON_LENGTH)} [...]`
    : flat;
}

/** "Judge lehnt ab" or "Judge-Fehler", the label of a judge failure in CLI and reports. */
export function judgeFailureLabel(kind: UnjudgedIteration["kind"]): string {
  return kind === "refusal" ? "Judge lehnt ab" : "Judge-Fehler";
}

/**
 * The count of iterations without a judge verdict with its breakdown (issue #83), for
 * example "2 (Judge lehnt ab: 1, Judge-Fehler: 1), 2 nicht in der Quote". null without any.
 */
export function describeWithoutJudge(
  totals: Pick<ReportTotals, "withoutJudgeVerdict">,
): string | null {
  const { refused, errors, countedAsFailed } = totals.withoutJudgeVerdict;
  const total = refused + errors;
  if (total === 0) return null;
  const left = total - countedAsFailed;
  return (
    `${String(total)} (Judge lehnt ab: ${String(refused)}, Judge-Fehler: ${String(errors)})` +
    `, ${String(left)} nicht in der Quote` +
    (countedAsFailed === 0 ? "" : `, ${String(countedAsFailed)} als Fehlschlag gezählt`)
  );
}

/** What the section "Fragen und Antworten" shows, shared by every renderer (issue #107). */
export const EXCHANGES_INTRO =
  "Je Fall die gestellte Frage, das Soll aus dem Goldset und die Antwort des Zielsystems aus einer Iteration: der ersten gescheiterten, sonst der ersten. " +
  "Bei Dialogen stehen die Nutzerzüge in Reihenfolge und die letzte Antwort. " +
  "Fragen stehen hier so, wie sie gesendet wurden, mit den Werten der Platzhalter. " +
  `Texte sind auf ${String(SAMPLE_RESPONSE_LENGTH)} Zeichen gekürzt.`;

/** "bestanden, 3 von 3 Iterationen": the outcome of a case for the heading of its exchange. */
export function exchangeLabel(exchange: CaseExchange): string {
  const count = `${String(exchange.iterations)} ${exchange.iterations === 1 ? "Iteration" : "Iterationen"}`;
  switch (exchange.outcome) {
    case "passed":
      return `bestanden, ${String(exchange.passes)} von ${String(exchange.judged)} Iterationen`;
    case "failed":
      return `gescheitert, ${String(exchange.passes)} von ${String(exchange.judged)} Iterationen bestanden`;
    case "error":
      return `Fehler, ${count}`;
    case "notExecuted":
      return "nicht ausgeführt (HTTP 429)";
    case "unresolved":
      return "nicht gebunden";
    case "noVerdict":
      return `ohne Urteil, ${count}`;
  }
}

/** "Ist, Iteration 2, Wortlaut über die Iterationen verschieden": the label of the shown answer. */
export function answerLabel(exchange: CaseExchange): string {
  if (exchange.index === null) return "Ist";
  const wording =
    exchange.varies === null || exchange.answer === null
      ? ""
      : exchange.varies
        ? ", Wortlaut über die Iterationen verschieden"
        : ", Wortlaut in allen Iterationen gleich";
  return `Ist, Iteration ${String(exchange.index)}${wording}`;
}

/** The sentence shown instead of an expected answer, or null when there is one. */
export function missingExpected(exchange: CaseExchange): string | null {
  if (exchange.expected === null) return "Soll: nicht bekannt, das Goldset wurde nicht geladen.";
  if (exchange.expected.length === 0) return "Soll: keine Erwartung hinterlegt.";
  return null;
}

/** The sentence shown instead of an answer, or null when there is one. */
export function missingAnswer(exchange: CaseExchange): string | null {
  if (exchange.index === null) return "Ist: nicht geschickt.";
  if (exchange.answer === null) {
    return `${answerLabel(exchange)}: keine Antwort (${exchange.error ?? "Fehler"}).`;
  }
  return null;
}

function quote(text: string): string[] {
  return text.split(/\r?\n/).map((line) => `> ${line}`);
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

/** A Markdown table, shared with the handover report (issue #87). */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(header), `| ${header.map(() => "---").join(" | ")} |`, ...rows.map(row)];
}

function caseRow(entry: CaseReport): string[] {
  const summary = entry.summary;
  return [
    entry.draft ? `${entry.caseId} (Entwurf)` : entry.caseId,
    entry.kind ?? "",
    entry.severity ?? "",
    entry.source ?? "",
    String(entry.iterations),
    summary === null ? "ohne Urteil" : `${String(summary.passes)} von ${String(summary.n)}`,
    summary === null ? "" : formatPercent(summary.passRate),
    summary === null ? "" : formatInterval(summary.interval),
    summary === null ? "" : formatNumber(summary.flakiness, 2),
    String(entry.errors),
    `${formatNumber(entry.averageLatencyMs, 0)} ms`,
  ];
}

export { table as markdownTable };

/** Renders the report as Markdown with German wording. */
export class MarkdownRenderer implements ReportRenderer {
  readonly format = "markdown";
  readonly fileExtension = "md";

  render(model: ReportModel, theme: ReportTheme = defaultTheme): string {
    const { run, totals } = model;
    const lines: string[] = [];

    lines.push(`# ${theme.title}`, "");
    lines.push(
      `Lauf \`${run.id}\` gegen das Zielsystem \`${run.target}\` nach Plan \`${run.planId}\`.`,
    );
    lines.push(
      run.finishedAt === undefined
        ? `Gestartet ${formatDateTime(run.startedAt)}, noch nicht beendet.`
        : `Gestartet ${formatDateTime(run.startedAt)}, beendet ${formatDateTime(run.finishedAt)}, Dauer ${formatDuration(run.startedAt, run.finishedAt)}.`,
    );
    lines.push(
      `Goldsets: ${run.goldsets.map((goldset) => `${goldset.id} (Version ${goldset.version})`).join(", ")}.`,
    );
    if (run.judge !== undefined) {
      lines.push(`Judge: \`${run.judge.model}\` mit Prompt ${run.judge.promptVersion}.`);
    }
    if (run.status === "aborted") {
      lines.push(
        `**Unvollständig:** der Lauf wurde abgebrochen${run.abortReason === undefined ? "." : `: ${run.abortReason}.`} Die Zahlen gelten nur für die ausgeführten Iterationen.`,
      );
    }
    lines.push("");
    const warnings = run.warnings ?? [];
    if (warnings.length > 0) {
      lines.push("## Hinweise zum Lauf", "");
      for (const warning of warnings) lines.push(`- ${warning}`);
      lines.push("");
    }

    if (run.judge !== undefined) {
      lines.push("## Judge-Kalibrierung", "");
      if (model.calibrations.length === 0) {
        lines.push(
          "Für die Goldsets dieses Laufs liegt keine Kalibrierung des Judge vor. Seine Urteile sind ungeprüft, `aiqa calibrate` vergleicht sie mit menschlichen Labels.",
          "",
        );
      } else {
        for (const calibration of model.calibrations) {
          const kappa = formatNumber(calibration.kappa, 2);
          lines.push(
            calibration.released
              ? `- ${calibration.goldsetId}: Cohen's Kappa ${kappa} (${describeKappa(calibration.kappa)}) über ${String(calibration.samples)} Stichproben, Schwelle ${formatNumber(calibration.minKappa, 2)}. Der Judge ist für dieses Goldset freigegeben.`
              : `- ${calibration.goldsetId}: Cohen's Kappa ${kappa} (${describeKappa(calibration.kappa)}) über ${String(calibration.samples)} Stichproben, Schwelle ${formatNumber(calibration.minKappa, 2)}. **Der Judge ist für dieses Goldset nicht freigegeben, seine Urteile in diesem Report sind nicht belastbar.**`,
          );
        }
        lines.push("");
      }
    }

    const withoutJudge = describeWithoutJudge(totals);
    lines.push("## Zusammenfassung", "");
    lines.push(
      ...table(
        ["Kennzahl", "Wert"],
        [
          ["Fälle", String(totals.cases)],
          ["Iterationen", String(totals.iterations)],
          ["Iterationen mit Urteil", String(totals.judgedIterations)],
          [
            "Bestanden",
            totals.passRate === null
              ? "kein Urteil"
              : `${String(totals.passedIterations)} von ${String(totals.judgedIterations)} (${formatPercent(totals.passRate)})`,
          ],
          ...(totals.correctedPassRate === null || totals.correctedPassedIterations === null
            ? []
            : [
                [
                  "Bereinigt um verworfene Befunde",
                  `${String(totals.correctedPassedIterations)} von ${String(totals.judgedIterations)} (${formatPercent(totals.correctedPassRate)})`,
                ],
              ]),
          [
            "Wilson-Intervall (95 %)",
            totals.interval === null ? "" : formatInterval(totals.interval),
          ],
          [
            totals.passAllK === null
              ? "pass-all-k"
              : `pass-all-k (k = ${String(totals.passAllK.k)})`,
            totals.passAllK === null ? "" : formatPercent(totals.passAllK.value),
          ],
          ["Fälle mit Schwankung", String(totals.flakyCases)],
          ["Fälle ohne Urteil", String(totals.casesWithoutVerdict)],
          ["Aufrufe mit Fehler", String(totals.errors)],
          ...(totals.notExecuted > 0
            ? [["Nicht ausgeführt (HTTP 429)", String(totals.notExecuted)]]
            : []),
          ...(totals.unresolvedCases > 0
            ? [["Nicht gebunden (unresolved)", String(totals.unresolvedCases)]]
            : []),
          ...(totals.emptyAnswers > 0 ? [["Leere Antworten", String(totals.emptyAnswers)]] : []),
          ...(withoutJudge === null ? [] : [["Ohne Judge-Urteil", withoutJudge]]),
          ...(totals.draftCases > 0
            ? [["Entwürfe (nicht in der Quote)", String(totals.draftCases)]]
            : []),
        ],
      ),
      "",
    );

    lines.push("## Fehlerquote je Kategorie", "");
    lines.push(
      ...table(
        ["Kategorie", "Fälle", "Fehlgeschlagen", "Fehlerquote", "Wilson-Intervall (95 %)"],
        model.categories.map((entry) => [
          entry.category,
          String(entry.cases),
          entry.failureRate === null
            ? "ohne Urteil"
            : `${String(entry.failedIterations)} von ${String(entry.judgedIterations)}`,
          entry.failureRate === null ? "" : formatPercent(entry.failureRate),
          entry.interval === null ? "" : formatInterval(entry.interval),
        ]),
      ),
      "",
    );

    lines.push("## Trend", "");
    if (model.trend.length < 2) {
      lines.push(
        "Für dieses Zielsystem liegt nur dieser Lauf vor. Der Trend entsteht ab zwei Läufen.",
        "",
      );
    } else {
      lines.push(
        ...table(
          ["Lauf", "Start", "Bestanden", "Pass-Rate", "Wilson-Intervall (95 %)"],
          [...model.trend]
            .reverse()
            .map((point) => [
              point.current ? `${point.runId} (dieser Lauf)` : point.runId,
              formatDateTime(point.startedAt),
              point.passRate === null
                ? "kein Urteil"
                : `${String(point.passedIterations)} von ${String(point.judgedIterations)}`,
              point.passRate === null ? "" : formatPercent(point.passRate),
              point.interval === null ? "" : formatInterval(point.interval),
            ]),
        ),
        "",
      );
    }

    lines.push("## Ergebnis je Fall", "");
    lines.push(
      ...table(
        [
          "Fall",
          "Art",
          "Schwere",
          "Quelle",
          "Iterationen",
          "Bestanden",
          "Pass-Rate",
          "Wilson-Intervall (95 %)",
          "Flakiness",
          "Fehler",
          "Latenz (Mittel)",
        ],
        model.cases.map(caseRow),
      ),
      "",
    );

    lines.push("## Fehlschläge", "");
    const failed = model.cases.filter((entry) => entry.failures.length > 0);
    if (failed.length === 0) {
      lines.push("Keine Fehlschläge.", "");
    }
    for (const entry of failed) {
      lines.push(`### ${entry.caseId}`, "");
      lines.push(
        `${String(entry.failures.length)} von ${String(entry.iterations)} Iterationen fehlgeschlagen.`,
        "",
      );
      lines.push(
        ...table(
          ["Iteration", "Check", "Begründung"],
          entry.failures.flatMap((failure) =>
            failure.checks.map((check) => [String(failure.index), check.name, check.reason]),
          ),
        ),
        "",
      );
    }

    if (model.bindingChanges.length > 0) {
      lines.push("## Getauschte Werte seit dem Vorlauf", "");
      lines.push(
        "Platzhalter, die aus der Datenquelle einen anderen Wert bekamen als im Lauf davor. Ein Unterschied zum Vorlauf kann am Datenstand liegen, nicht am Zielsystem. Die Werte stehen in `runs/<lauf>/bindings.json`, diese Tabelle nennt nur die Platzhalter. Die gesendeten Fragen unter Fragen und Antworten enthalten die Werte.",
        "",
      );
      lines.push(
        ...table(
          ["Platzhalter", "Abfrage"],
          model.bindingChanges.map((change) => [
            change.placeholder,
            change.query === undefined
              ? ""
              : `${change.query}${change.queryVersion === undefined ? "" : `, Version ${change.queryVersion}`}`,
          ]),
        ),
        "",
      );
    }

    if (model.unresolvedCases.length > 0) {
      lines.push("## Nicht gebundene Fälle", "");
      lines.push(
        "Fälle, die nicht geschickt wurden, weil ein Platzhalter aus der Datenquelle keinen Wert bekam.",
        "",
      );
      for (const entry of model.unresolvedCases) {
        lines.push(`- ${entry.caseId}: ${entry.reasons.join("; ")}`);
      }
      lines.push("");
    }

    if (model.judgeFailures.length > 0) {
      lines.push("## Ohne Judge-Urteil", "");
      lines.push(
        "Iterationen, die der Judge bewerten sollte, aber nicht bewertet hat. Sie zählen nicht in der Quote, außer ein Treffer in `mustNotClaim` zählt ohne Urteil als Fehlschlag. `aiqa judge --run` bewertet sie nach.",
        "",
      );
      lines.push(
        ...table(
          ["Fall", "Iteration", "Grund", "Wertung"],
          model.judgeFailures.map((entry) => [
            entry.caseId,
            String(entry.index),
            `${judgeFailureLabel(entry.kind)}: ${shortReason(entry.reason)}`,
            entry.countedAsFailed ? "als Fehlschlag gezählt" : "nicht in der Quote",
          ]),
        ),
        "",
      );
    }

    lines.push("## Befunde", "");
    if (model.findings.length === 0) {
      lines.push(
        "Keine bestätigten Befunde. Hypothesen von `aiqa analyze` erscheinen hier erst, wenn ein Mensch sie bestätigt hat.",
        "",
      );
    }
    for (const finding of model.findings) {
      lines.push(
        `### ${finding.id}: ${finding.category}, Schwere ${SEVERITY_LABELS[finding.severity] ?? finding.severity}`,
        "",
      );
      lines.push(finding.hypothesis, "");
      if (finding.cause !== undefined) lines.push(`Ursache: ${finding.cause}`, "");
      if (finding.suggestion !== undefined) lines.push(`Vorschlag: ${finding.suggestion}`, "");
      lines.push(
        `Fälle: ${finding.caseIds.join(", ")}.` +
          (finding.failedIterations === undefined
            ? ""
            : ` Fehlschläge: ${String(finding.failedIterations)}.`) +
          (finding.evidenceRefs.length === 0 ? "" : ` Belege: ${finding.evidenceRefs.join(", ")}.`),
        "",
      );
    }

    if (model.rejectedFindings.length > 0) {
      lines.push("## Verworfene Befunde", "");
      lines.push(
        "Fehlschläge, die ein Mensch geprüft und verworfen hat, etwa als Fehlalarm des Werkzeugs. Die bereinigte Quote zählt sie als bestanden.",
        "",
      );
      for (const finding of model.rejectedFindings) {
        lines.push(
          `- ${finding.id} (${finding.caseIds.join(", ")}): ${finding.hypothesis}` +
            (finding.note === undefined ? "" : ` Grund: ${finding.note}`),
        );
      }
      lines.push("");
    }

    if (model.samples.length > 0) {
      lines.push("## Stichprobe der Fehlschläge", "");
      lines.push(
        `${String(model.samples.length)} von ${String(model.cases.reduce((sum, entry) => sum + entry.failures.length, 0))} gescheiterten Iterationen mit Originalantwort, Fehlschläge mit Judge-Urteil zuerst.`,
        "",
      );
      for (const sample of model.samples) {
        const status = sample.status === undefined ? "" : `, HTTP ${String(sample.status)}`;
        lines.push(`### ${sample.caseId}, Iteration ${String(sample.index)}${status}`, "");
        if (sample.question.length > 0) {
          lines.push("Frage:", "", ...quote(sample.question.join("\n\n")), "");
        }
        lines.push("Antwort des Zielsystems:", "");
        lines.push(...quote(sample.response), "");
        for (const check of sample.checks) lines.push(`- ${check.name}: ${check.reason}`);
        if (sample.judgeReasoning !== undefined) {
          lines.push(`- Begründung des Judge: ${sample.judgeReasoning}`);
        }
        lines.push("");
      }
    }

    if (model.exchanges.length > 0) {
      lines.push("## Fragen und Antworten", "");
      lines.push(EXCHANGES_INTRO, "");
      for (const exchange of model.exchanges) {
        lines.push(
          `### ${exchange.caseId}${exchange.draft ? " (Entwurf)" : ""}: ${exchangeLabel(exchange)}`,
          "",
        );
        if (exchange.question.length === 0) {
          lines.push("Frage: nicht bekannt.", "");
        } else {
          lines.push("Frage:", "", ...quote(exchange.question.join("\n\n")), "");
        }
        const noExpected = missingExpected(exchange);
        if (noExpected !== null) {
          lines.push(noExpected, "");
        } else {
          lines.push("Soll:", "", ...quote((exchange.expected ?? []).join("\n")), "");
        }
        const noAnswer = missingAnswer(exchange);
        if (noAnswer !== null) {
          lines.push(noAnswer, "");
        } else {
          lines.push(`${answerLabel(exchange)}:`, "", ...quote(exchange.answer ?? ""), "");
        }
      }
    }

    lines.push("## Hinweise", "");
    lines.push(...REPORT_GLOSSARY.map((entry) => `- ${entry}`), "");

    return lines.join("\n");
  }
}
