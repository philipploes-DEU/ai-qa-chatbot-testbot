import { readFileSync } from "node:fs";

import { describeKappa } from "../stats/kappa.js";
import {
  answerLabel,
  describeWithoutJudge,
  exchangeLabel,
  EXCHANGES_INTRO,
  formatDateTime,
  formatDuration,
  formatInterval,
  formatNumber,
  formatPercent,
  judgeFailureLabel,
  missingAnswer,
  missingExpected,
  REPORT_GLOSSARY,
  SEVERITY_LABELS,
  shortReason,
} from "./markdown-renderer.js";
import type { CaseReport, ReportModel, TrendPoint } from "./report-model.js";
import type { ReportRenderer } from "./report-renderer.js";
import type { FontFaceSource, HtmlStyle, ReportTheme } from "./themes/default/theme.js";
import { wirkmittelTheme } from "./themes/wirkmittel/theme.js";

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for element content and quoted attributes. Target answers are untrusted. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const fontCache = new Map<string, string>();

function fontDataUrl(source: FontFaceSource): string {
  const key = source.file.href;
  let encoded = fontCache.get(key);
  if (encoded === undefined) {
    encoded = readFileSync(source.file).toString("base64");
    fontCache.set(key, encoded);
  }
  return `data:font/woff2;base64,${encoded}`;
}

/** 10.10.2026 from an ISO timestamp, in UTC like formatDateTime. */
export function formatDate(iso: string): string {
  return formatDateTime(iso).slice(0, 10);
}

/**
 * The few sentences a reader takes away: pass rate with its interval, the weakest category,
 * instability and anything that makes the numbers less reliable.
 */
export function keyStatement(model: ReportModel): string[] {
  const { totals, run } = model;
  const sentences: string[] = [];
  if (totals.passRate === null || totals.interval === null) {
    sentences.push(
      "Kein Urteil vorhanden. Der Lauf enthält keine Iteration mit Check oder Judge-Urteil.",
    );
  } else {
    sentences.push(
      `${String(totals.passedIterations)} von ${String(totals.judgedIterations)} bewerteten Iterationen bestanden (${formatPercent(totals.passRate)}).`,
      `Die wahre Pass-Rate liegt mit 95 Prozent Sicherheit zwischen ${formatPercent(totals.interval.low)} und ${formatPercent(totals.interval.high)}.`,
    );
    const weakest = model.categories[0];
    if (weakest?.failureRate !== null && weakest !== undefined && weakest.failedIterations > 0) {
      sentences.push(
        `Höchste Fehlerquote: ${weakest.category} mit ${formatPercent(weakest.failureRate)} (${String(weakest.failedIterations)} von ${String(weakest.judgedIterations)} Iterationen).`,
      );
    }
  }
  if (totals.notExecuted > 0) {
    sentences.push(
      totals.notExecuted === 1
        ? "1 Iteration nicht ausgeführt: das Zielsystem lehnte sie mit HTTP 429 ab. Sie zählt nicht in die Quote."
        : `${String(totals.notExecuted)} Iterationen nicht ausgeführt: das Zielsystem lehnte sie mit HTTP 429 ab. Sie zählen nicht in die Quote.`,
    );
  }
  const withoutJudge = describeWithoutJudge(totals);
  if (withoutJudge !== null) sentences.push(`Ohne Judge-Urteil: ${withoutJudge}.`);
  if (totals.draftCases > 0) {
    sentences.push(
      totals.draftCases === 1
        ? "Ein Entwurf lief mit und zählt nicht in die Quote."
        : `${String(totals.draftCases)} Entwürfe liefen mit und zählen nicht in die Quote.`,
    );
  }
  if (totals.flakyCases > 0) {
    sentences.push(
      totals.flakyCases === 1
        ? "Ein Fall schwankt zwischen bestanden und nicht bestanden."
        : `${String(totals.flakyCases)} Fälle schwanken zwischen bestanden und nicht bestanden.`,
    );
  }
  if (run.status === "aborted") {
    sentences.push(
      `Der Lauf wurde abgebrochen${run.abortReason === undefined ? "" : ` (${run.abortReason})`}, die Zahlen gelten nur für die ausgeführten Iterationen.`,
    );
  }
  for (const calibration of model.calibrations.filter((entry) => !entry.released)) {
    sentences.push(
      `Der Judge ist für das Goldset ${calibration.goldsetId} nicht freigegeben, seine Urteile sind nicht belastbar.`,
    );
  }
  if (run.judge !== undefined && model.calibrations.length === 0) {
    sentences.push("Der Judge ist für die Goldsets dieses Laufs nicht kalibriert.");
  }
  return sentences;
}

function stylesheet(style: HtmlStyle): string {
  const { colors, fonts } = style;
  const faces = style.fontFaces
    .map(
      (face) => `@font-face {
  font-family: '${face.family}';
  src: url(${fontDataUrl(face)}) format('woff2');
  font-weight: ${face.weight};
  font-style: normal;
  font-display: swap;
}`,
    )
    .join("\n");
  const subtitle =
    style.subtitleGradient === undefined
      ? `color: ${colors.muted};`
      : `background-image: ${style.subtitleGradient}; background-clip: text; -webkit-background-clip: text; color: transparent;`;
  return `${faces}
:root {
  color-scheme: ${style.colorScheme};
  --bg: ${colors.background};
  --surface: ${colors.surface};
  --line: ${colors.line};
  --text: ${colors.text};
  --muted: ${colors.muted};
  --accent: ${colors.accent};
  --highlight: ${colors.highlight};
  --font-heading: ${fonts.heading};
  --font-body: ${fonts.body};
  --font-mono: ${fonts.mono};
}
* { box-sizing: border-box; border-radius: 0; }
html { background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-body); font-weight: 400; font-size: 1rem; line-height: 1.625; }
main { max-width: 72rem; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
header { padding-bottom: 2.5rem; border-bottom: 1px solid var(--line); }
h1, h2, h3 { font-family: var(--font-heading); font-weight: 700; letter-spacing: -0.025em; hyphens: auto; }
h1 { font-size: 3rem; line-height: 1; margin: 0.75rem 0 1rem; }
h2 { font-size: 1.875rem; line-height: 1.25; margin: 0 0 1.25rem; }
h3 { font-size: 1.125rem; line-height: 1.375; margin: 2rem 0 0.5rem; }
section { padding: 3rem 0; border-bottom: 1px solid var(--line); }
p { margin: 0 0 1rem; }
.subtitle { font-size: 1.5rem; font-weight: 500; line-height: 1.25; margin: 0; ${subtitle} }
.meta, .mono { font-family: var(--font-mono); }
.meta { font-size: 0.875rem; color: var(--muted); margin: 0; }
.muted { color: var(--muted); }
.key { margin-right: 6px; padding: 2rem; background: var(--surface); border-left: 4px solid var(--accent); box-shadow: ${style.shadow}; }
.key-number { font-family: var(--font-heading); font-weight: 700; font-size: 4.5rem; line-height: 1; color: var(--highlight); margin: 0 0 1rem; }
.key p:last-child { margin-bottom: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); border: 1px solid var(--line); }
.tile { padding: 1.25rem 1.5rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: -1px -1px 0 0; }
.tile dt { font-size: 0.875rem; color: var(--muted); }
.tile dd { margin: 0.25rem 0 0; font-family: var(--font-heading); font-weight: 700; font-size: 1.5rem; line-height: 1.25; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
th, td { text-align: left; vertical-align: top; padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 500; background: var(--surface); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar { position: relative; height: 0.75rem; min-width: 8rem; background: var(--surface); }
.bar span { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
.warn { padding: 1rem 1.25rem; border-left: 4px solid var(--highlight); background: var(--surface); }
ul { margin: 0; padding-left: 1.25rem; }
li { margin-bottom: 0.5rem; }
blockquote { margin: 0.5rem 0 1rem; padding: 1rem 1.25rem; background: var(--surface); border-left: 2px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.875rem; }
dl.meta-list { display: grid; grid-template-columns: minmax(10rem, 14rem) 1fr; margin: 0; }
dl.meta-list dt, dl.meta-list dd { margin: 0; padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
dl.meta-list dt { color: var(--muted); }
svg text { font-family: var(--font-mono); font-size: 12px; fill: var(--muted); }
svg .grid { stroke: var(--line); stroke-width: 1; }
svg .band { fill: var(--accent); fill-opacity: 0.18; }
svg .line { fill: none; stroke: var(--accent); stroke-width: 2; }
svg .dot { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
svg .value { fill: var(--text); font-weight: 700; }
details { margin-top: 1rem; }
summary { cursor: pointer; color: var(--accent); }
@media (max-width: 40rem) { h1 { font-size: 2.25rem; } .key-number { font-size: 3rem; } dl.meta-list { grid-template-columns: 1fr; } dl.meta-list dt { border-bottom: 0; padding-bottom: 0; } }`;
}

/** A titled section of a page; body is HTML. Shared with the handover report (issue #87). */
function section(title: string, body: string): string {
  return `<section>\n<h2>${escapeHtml(title)}</h2>\n${body}\n</section>`;
}

/** A table; cells are HTML, header cells text. numeric are the right aligned columns. */
function table(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  numeric: readonly number[] = [],
): string {
  const th = header
    .map(
      (cell, index) =>
        `<th${numeric.includes(index) ? ' class="num"' : ""}>${escapeHtml(cell)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell, index) => `<td${numeric.includes(index) ? ' class="num"' : ""}>${cell}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<div class="scroll"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
}

function keySection(model: ReportModel): string {
  const number =
    model.totals.passRate === null
      ? ""
      : `<p class="key-number">${escapeHtml(formatPercent(model.totals.passRate))}</p>\n`;
  const sentences = keyStatement(model)
    .map((sentence) => `<p>${escapeHtml(sentence)}</p>`)
    .join("\n");
  return section("Kernaussage", `<div class="key">\n${number}${sentences}\n</div>`);
}

function tilesSection(model: ReportModel): string {
  const { totals } = model;
  const tiles: [string, string][] = [
    ["Fälle", String(totals.cases)],
    ["Iterationen", String(totals.iterations)],
    [
      "Bestanden",
      totals.passRate === null
        ? "kein Urteil"
        : `${String(totals.passedIterations)} von ${String(totals.judgedIterations)}`,
    ],
    ...(totals.correctedPassRate === null || totals.correctedPassedIterations === null
      ? []
      : [
          [
            "Bereinigt um verworfene Befunde",
            `${String(totals.correctedPassedIterations)} von ${String(totals.judgedIterations)}`,
          ] as [string, string],
        ]),
    [
      "Wilson-Intervall (95 %)",
      totals.interval === null ? "kein Urteil" : formatInterval(totals.interval),
    ],
    [
      totals.passAllK === null ? "pass-all-k" : `pass-all-k (k = ${String(totals.passAllK.k)})`,
      totals.passAllK === null ? "kein Urteil" : formatPercent(totals.passAllK.value),
    ],
    ["Fälle mit Schwankung", String(totals.flakyCases)],
    ["Fälle ohne Urteil", String(totals.casesWithoutVerdict)],
    ["Aufrufe mit Fehler", String(totals.errors)],
    ...(totals.notExecuted > 0
      ? [["Nicht ausgeführt (HTTP 429)", String(totals.notExecuted)] as [string, string]]
      : []),
    ...(totals.unresolvedCases > 0
      ? [["Nicht gebunden (unresolved)", String(totals.unresolvedCases)] as [string, string]]
      : []),
    ...(totals.emptyAnswers > 0
      ? [["Leere Antworten", String(totals.emptyAnswers)] as [string, string]]
      : []),
    ...(totals.withoutJudgeVerdict.refused + totals.withoutJudgeVerdict.errors > 0
      ? [
          [
            "Ohne Judge-Urteil",
            String(totals.withoutJudgeVerdict.refused + totals.withoutJudgeVerdict.errors),
          ] as [string, string],
        ]
      : []),
    ...(totals.draftCases > 0
      ? [["Entwürfe (nicht in der Quote)", String(totals.draftCases)] as [string, string]]
      : []),
  ];
  const body = tiles
    .map(
      ([label, value]) =>
        `<div class="tile"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("\n");
  return section("Kennzahlen", `<dl class="tiles">\n${body}\n</dl>`);
}

function warningsSection(model: ReportModel): string {
  const warnings = [...(model.run.warnings ?? [])];
  if (model.run.status === "aborted") {
    warnings.unshift(
      `Unvollständig: der Lauf wurde abgebrochen${model.run.abortReason === undefined ? "." : `: ${model.run.abortReason}.`}`,
    );
  }
  if (warnings.length === 0) return "";
  const items = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("\n");
  return section("Hinweise zum Lauf", `<div class="warn"><ul>\n${items}\n</ul></div>`);
}

function calibrationSection(model: ReportModel): string {
  if (model.run.judge === undefined) return "";
  if (model.calibrations.length === 0) {
    return section(
      "Judge-Kalibrierung",
      `<p class="warn">Für die Goldsets dieses Laufs liegt keine Kalibrierung des Judge vor. Seine Urteile sind ungeprüft, <span class="mono">aiqa calibrate</span> vergleicht sie mit menschlichen Labels.</p>`,
    );
  }
  const items = model.calibrations
    .map((calibration) => {
      const text = `${calibration.goldsetId}: Cohen's Kappa ${formatNumber(calibration.kappa, 2)} (${describeKappa(calibration.kappa)}) über ${String(calibration.samples)} Stichproben, Schwelle ${formatNumber(calibration.minKappa, 2)}, kalibriert am ${formatDate(calibration.calibratedAt)}.`;
      const verdict = calibration.released
        ? "Der Judge ist für dieses Goldset freigegeben."
        : "Der Judge ist für dieses Goldset nicht freigegeben, seine Urteile in diesem Report sind nicht belastbar.";
      return `<li>${escapeHtml(text)} ${calibration.released ? escapeHtml(verdict) : `<strong>${escapeHtml(verdict)}</strong>`}</li>`;
    })
    .join("\n");
  return section("Judge-Kalibrierung", `<ul>\n${items}\n</ul>`);
}

function categoriesSection(model: ReportModel): string {
  const rows = model.categories.map((entry) => {
    const rate = entry.failureRate;
    const bar =
      rate === null
        ? ""
        : `<div class="bar" role="img" aria-label="${escapeHtml(formatPercent(rate))}"><span style="width: ${formatWidth(rate)}"></span></div>`;
    return [
      escapeHtml(entry.category),
      String(entry.cases),
      rate === null
        ? "ohne Urteil"
        : `${String(entry.failedIterations)} von ${String(entry.judgedIterations)}`,
      rate === null ? "" : escapeHtml(formatPercent(rate)),
      entry.interval === null ? "" : escapeHtml(formatInterval(entry.interval)),
      bar,
    ];
  });
  return section(
    "Fehlerquote je Kategorie",
    table(
      ["Kategorie", "Fälle", "Fehlgeschlagen", "Fehlerquote", "Wilson-Intervall (95 %)", ""],
      rows,
      [1, 2, 3, 4],
    ),
  );
}

/** CSS width with a dot as decimal separator. */
function formatWidth(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

const CHART = { width: 720, height: 240, left: 48, right: 72, top: 16, bottom: 40 };

/** The trend as inline SVG; styled by the classes grid, band, line, dot and value. */
export function trendChart(points: readonly TrendPoint[]): string {
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index: number): number =>
    CHART.left + (points.length === 1 ? plotWidth / 2 : (index * plotWidth) / (points.length - 1));
  const y = (rate: number): number => CHART.top + (1 - rate) * plotHeight;
  const coord = (value: number): string => value.toFixed(1);

  const grid = [0, 0.5, 1]
    .map(
      (rate) =>
        `<line class="grid" x1="${String(CHART.left)}" x2="${String(CHART.width - CHART.right)}" y1="${coord(y(rate))}" y2="${coord(y(rate))}"></line><text x="${String(CHART.left - 8)}" y="${coord(y(rate) + 4)}" text-anchor="end">${String(rate * 100)} %</text>`,
    )
    .join("\n");

  const judged = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.passRate !== null && point.interval !== null);
  const band =
    judged.length < 2
      ? ""
      : `<polygon class="band" points="${[
          ...judged.map(
            ({ point, index }) => `${coord(x(index))},${coord(y(point.interval?.high ?? 0))}`,
          ),
          ...[...judged]
            .reverse()
            .map(({ point, index }) => `${coord(x(index))},${coord(y(point.interval?.low ?? 0))}`),
        ].join(" ")}"></polygon>`;
  const line =
    judged.length < 2
      ? ""
      : `<polyline class="line" points="${judged.map(({ point, index }) => `${coord(x(index))},${coord(y(point.passRate ?? 0))}`).join(" ")}"></polyline>`;
  const dots = judged
    .map(
      ({ point, index }) =>
        `<circle class="dot" cx="${coord(x(index))}" cy="${coord(y(point.passRate ?? 0))}" r="${point.current ? "6" : "4"}"><title>${escapeHtml(trendLabel(point))}</title></circle>`,
    )
    .join("\n");
  const labels = points
    .map((point, index) =>
      index === 0 || index === points.length - 1 || point.current
        ? `<text x="${coord(x(index))}" y="${String(CHART.height - 12)}" text-anchor="middle">${escapeHtml(formatDate(point.startedAt).slice(0, 10))}</text>`
        : "",
    )
    .join("");
  const current = judged.find(({ point }) => point.current);
  const value =
    current === undefined
      ? ""
      : `<text class="value" x="${coord(x(current.index) + 12)}" y="${coord(y(current.point.passRate ?? 0) + 4)}">${escapeHtml(formatPercent(current.point.passRate ?? 0))}</text>`;

  return `<div class="scroll"><svg viewBox="0 0 ${String(CHART.width)} ${String(CHART.height)}" width="100%" role="img" aria-label="Pass-Rate der letzten ${String(points.length)} Läufe">
${grid}
${band}
${line}
${dots}
${labels}
${value}
</svg></div>`;
}

function trendLabel(point: TrendPoint): string {
  const rate =
    point.passRate === null
      ? "kein Urteil"
      : `${formatPercent(point.passRate)} (${String(point.passedIterations)} von ${String(point.judgedIterations)})`;
  return `Lauf ${point.runId}, ${formatDate(point.startedAt)}: ${rate}`;
}

function trendSection(model: ReportModel): string {
  const points = model.trend;
  const rows = [...points]
    .reverse()
    .map((point) => [
      `<span class="mono">${escapeHtml(point.runId)}</span>${point.current ? " (dieser Lauf)" : ""}`,
      escapeHtml(formatDate(point.startedAt)),
      point.status === "aborted" ? "abgebrochen" : "",
      point.passRate === null
        ? "kein Urteil"
        : `${String(point.passedIterations)} von ${String(point.judgedIterations)}`,
      point.passRate === null ? "" : escapeHtml(formatPercent(point.passRate)),
      point.interval === null ? "" : escapeHtml(formatInterval(point.interval)),
    ]);
  const valueTable = table(
    ["Lauf", "Datum", "Status", "Bestanden", "Pass-Rate", "Wilson-Intervall (95 %)"],
    rows,
    [3, 4, 5],
  );
  if (points.length < 2) {
    return section(
      "Trend",
      `<p class="muted">Für dieses Zielsystem liegt nur dieser Lauf vor. Der Trend entsteht ab zwei Läufen.</p>\n${valueTable}`,
    );
  }
  return section(
    "Trend",
    `<p>Pass-Rate der letzten ${String(points.length)} Läufe gegen ${escapeHtml(model.run.target)}, die Fläche zeigt das Wilson-Intervall.</p>\n${trendChart(points)}\n<details><summary>Werte als Tabelle</summary>\n${valueTable}\n</details>`,
  );
}

function rejectedSection(model: ReportModel): string {
  if (model.rejectedFindings.length === 0) return "";
  const items = model.rejectedFindings
    .map(
      (finding) =>
        `<li><span class="mono">${escapeHtml(finding.id)}</span> (${escapeHtml(finding.caseIds.join(", "))}): ${escapeHtml(finding.hypothesis)}${finding.note === undefined ? "" : ` Grund: ${escapeHtml(finding.note)}`}</li>`,
    )
    .join("\n");
  return section(
    "Verworfene Befunde",
    `<p>Fehlschläge, die ein Mensch geprüft und verworfen hat, etwa als Fehlalarm des Werkzeugs. Die bereinigte Quote zählt sie als bestanden.</p>\n<ul>\n${items}\n</ul>`,
  );
}

function findingsSection(model: ReportModel): string {
  if (model.findings.length === 0) {
    return section(
      "Befunde",
      `<p class="muted">Keine bestätigten Befunde. Hypothesen der Analyse erscheinen hier erst, wenn ein Mensch sie bestätigt hat.</p>`,
    );
  }
  const body = model.findings
    .map(
      (finding) =>
        `<h3>${escapeHtml(finding.id)}: ${escapeHtml(finding.category)}, Schwere ${escapeHtml(SEVERITY_LABELS[finding.severity] ?? finding.severity)}</h3>\n<p>${escapeHtml(finding.hypothesis)}</p>\n${finding.cause === undefined ? "" : `<p>Ursache: ${escapeHtml(finding.cause)}</p>\n`}${finding.suggestion === undefined ? "" : `<p>Vorschlag: ${escapeHtml(finding.suggestion)}</p>\n`}<p class="meta">Fälle: ${escapeHtml(finding.caseIds.join(", "))}${finding.failedIterations === undefined ? "" : `. Fehlschläge: ${String(finding.failedIterations)}`}${finding.evidenceRefs.length > 0 ? `. Belege: ${escapeHtml(finding.evidenceRefs.join(", "))}` : ""}</p>`,
    )
    .join("\n");
  return section("Befunde", body);
}

function bindingSection(model: ReportModel): string {
  const parts: string[] = [];
  if (model.bindingChanges.length > 0) {
    parts.push(
      section(
        "Getauschte Werte seit dem Vorlauf",
        `<p>Platzhalter, die aus der Datenquelle einen anderen Wert bekamen als im Lauf davor. Ein Unterschied zum Vorlauf kann am Datenstand liegen, nicht am Zielsystem. Die Werte stehen in <span class="mono">runs/&lt;lauf&gt;/bindings.json</span>, diese Tabelle nennt nur die Platzhalter. Die gesendeten Fragen unter Fragen und Antworten enthalten die Werte.</p>\n` +
          table(
            ["Platzhalter", "Abfrage"],
            model.bindingChanges.map((change) =>
              [
                change.placeholder,
                change.query === undefined
                  ? ""
                  : `${change.query}${change.queryVersion === undefined ? "" : `, Version ${change.queryVersion}`}`,
              ].map((cell) => escapeHtml(cell)),
            ),
          ),
      ),
    );
  }
  if (model.unresolvedCases.length > 0) {
    parts.push(
      section(
        "Nicht gebundene Fälle",
        `<p>Fälle, die nicht geschickt wurden, weil ein Platzhalter aus der Datenquelle keinen Wert bekam.</p>\n<ul>\n${model.unresolvedCases
          .map(
            (entry) =>
              `<li><span class="mono">${escapeHtml(entry.caseId)}</span>: ${escapeHtml(entry.reasons.join("; "))}</li>`,
          )
          .join("\n")}\n</ul>`,
      ),
    );
  }
  return parts.join("\n");
}

function judgeFailuresSection(model: ReportModel): string {
  if (model.judgeFailures.length === 0) return "";
  return section(
    "Ohne Judge-Urteil",
    `<p>Iterationen, die der Judge bewerten sollte, aber nicht bewertet hat. Sie zählen nicht in der Quote, außer ein Treffer in mustNotClaim zählt ohne Urteil als Fehlschlag. <span class="mono">aiqa judge --run</span> bewertet sie nach.</p>\n` +
      table(
        ["Fall", "Iteration", "Grund", "Wertung"],
        model.judgeFailures.map((entry) => [
          `<span class="mono">${escapeHtml(entry.caseId)}</span>`,
          String(entry.index),
          escapeHtml(`${judgeFailureLabel(entry.kind)}: ${shortReason(entry.reason)}`),
          entry.countedAsFailed ? "als Fehlschlag gezählt" : "nicht in der Quote",
        ]),
        [1],
      ),
  );
}

function caseRow(entry: CaseReport): string[] {
  const summary = entry.summary;
  return [
    `<span class="mono">${escapeHtml(entry.caseId)}</span>${entry.draft ? " (Entwurf)" : ""}`,
    escapeHtml(entry.category),
    escapeHtml(
      entry.severity === undefined ? "" : (SEVERITY_LABELS[entry.severity] ?? entry.severity),
    ),
    String(entry.iterations),
    summary === null ? "ohne Urteil" : `${String(summary.passes)} von ${String(summary.n)}`,
    summary === null ? "" : escapeHtml(formatPercent(summary.passRate)),
    summary === null ? "" : escapeHtml(formatInterval(summary.interval)),
    summary === null ? "" : escapeHtml(formatNumber(summary.flakiness, 2)),
    String(entry.errors),
    escapeHtml(`${formatNumber(entry.averageLatencyMs, 0)} ms`),
  ];
}

function casesSection(model: ReportModel): string {
  return section(
    "Ergebnis je Fall",
    table(
      [
        "Fall",
        "Kategorie",
        "Schwere",
        "Iterationen",
        "Bestanden",
        "Pass-Rate",
        "Wilson-Intervall (95 %)",
        "Flakiness",
        "Fehler",
        "Latenz (Mittel)",
      ],
      model.cases.map(caseRow),
      [3, 4, 5, 6, 7, 8, 9],
    ),
  );
}

function samplesSection(model: ReportModel): string {
  if (model.samples.length === 0) return "";
  const failed = model.cases.reduce((sum, entry) => sum + entry.failures.length, 0);
  const body = model.samples
    .map((sample) => {
      const checks = sample.checks
        .map((check) => `<li>${escapeHtml(`${check.name}: ${check.reason}`)}</li>`)
        .join("\n");
      const judge =
        sample.judgeReasoning === undefined
          ? ""
          : `<li>Begründung des Judge: ${escapeHtml(sample.judgeReasoning)}</li>`;
      const status = sample.status === undefined ? "" : `, HTTP ${String(sample.status)}`;
      const question =
        sample.question.length === 0
          ? ""
          : `<p class="meta">Frage</p>\n<blockquote>${escapeHtml(sample.question.join("\n\n"))}</blockquote>\n`;
      return `<h3><span class="mono">${escapeHtml(sample.caseId)}</span>, Iteration ${String(sample.index)}${status}</h3>\n${question}<p class="meta">Antwort des Zielsystems</p>\n<blockquote>${escapeHtml(sample.response)}</blockquote>\n<ul>\n${checks}\n${judge}\n</ul>`;
    })
    .join("\n");
  return section(
    "Stichprobe der Fehlschläge",
    `<p>${String(model.samples.length)} von ${String(failed)} gescheiterten Iterationen mit Originalantwort, Fehlschläge mit Judge-Urteil zuerst.</p>\n${body}`,
  );
}

/** Question, expected and actual answer per case (issue #107). */
function exchangesSection(model: ReportModel): string {
  if (model.exchanges.length === 0) return "";
  const quote = (text: string): string => `<blockquote>${escapeHtml(text)}</blockquote>`;
  const note = (text: string): string => `<p class="meta">${escapeHtml(text)}</p>`;
  const body = model.exchanges
    .map((exchange) => {
      const heading = `<h3><span class="mono">${escapeHtml(exchange.caseId)}</span>${exchange.draft ? " (Entwurf)" : ""}: ${escapeHtml(exchangeLabel(exchange))}</h3>`;
      const question =
        exchange.question.length === 0
          ? note("Frage: nicht bekannt.")
          : `${note("Frage")}\n${quote(exchange.question.join("\n\n"))}`;
      const noExpected = missingExpected(exchange);
      const expected =
        noExpected === null
          ? `${note("Soll")}\n${quote((exchange.expected ?? []).join("\n"))}`
          : note(noExpected);
      const noAnswer = missingAnswer(exchange);
      const answer =
        noAnswer === null
          ? `${note(answerLabel(exchange))}\n${quote(exchange.answer ?? "")}`
          : note(noAnswer);
      return `${heading}\n${question}\n${expected}\n${answer}`;
    })
    .join("\n");
  return section("Fragen und Antworten", `<p>${escapeHtml(EXCHANGES_INTRO)}</p>\n${body}`);
}

function metadataSection(model: ReportModel): string {
  const { run } = model;
  const entries: [string, string | undefined][] = [
    ["Lauf", run.id],
    ["Plan", run.planId],
    ["Zielsystem", run.target],
    ["Zielversion", run.targetVersion],
    ["Modell", run.model],
    ["Katalogversion", run.catalogVersion],
    [
      "Goldsets",
      run.goldsets.map((goldset) => `${goldset.id} (Version ${goldset.version})`).join(", "),
    ],
    [
      "Judge",
      run.judge === undefined ? undefined : `${run.judge.model}, Prompt ${run.judge.promptVersion}`,
    ],
    ["Start", formatDateTime(run.startedAt)],
    ["Ende", run.finishedAt === undefined ? "noch nicht beendet" : formatDateTime(run.finishedAt)],
    [
      "Dauer",
      run.finishedAt === undefined ? undefined : formatDuration(run.startedAt, run.finishedAt),
    ],
    [
      "Status",
      run.status === "aborted"
        ? "abgebrochen"
        : run.finishedAt === undefined
          ? "läuft"
          : "abgeschlossen",
    ],
  ];
  const body = entries
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd class="mono">${escapeHtml(value ?? "nicht angegeben")}</dd>`,
    )
    .join("\n");
  return section("Lauf-Metadaten", `<dl class="meta-list">\n${body}\n</dl>`);
}

function glossarySection(): string {
  const items = REPORT_GLOSSARY.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("\n");
  return section("Erläuterungen", `<ul>\n${items}\n</ul>`);
}

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

export { section as htmlSection, table as htmlTable };

/** The text of the page head; all of it is escaped. */
export interface HtmlPageHead {
  title: string;
  meta: string;
  heading: string;
  subtitle: string;
}

/**
 * One self-contained HTML page in the theme: no scripts, no requests, fonts embedded. Shared
 * by the run report and the handover report (issue #87). Empty sections are left out.
 */
export function htmlPage(
  theme: ReportTheme,
  head: HtmlPageHead,
  sections: readonly string[],
): string {
  const style = theme.html ?? wirkmittelTheme.html;
  if (style === undefined) throw new Error("Das Wirkmittel-Theme hat keinen HTML-Stil.");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="generator" content="AI QA">
<title>${escapeHtml(head.title)}</title>
<style>
${stylesheet(style)}
</style>
</head>
<body>
<main>
<header>
<p class="meta">${escapeHtml(head.meta)}</p>
<h1>${escapeHtml(head.heading)}</h1>
<p class="subtitle">${escapeHtml(head.subtitle)}</p>
</header>
${sections.filter((part) => part.length > 0).join("\n")}
</main>
</body>
</html>
`;
}

/**
 * Renders the report as one self-contained HTML file: no scripts, no requests, fonts
 * embedded. Every number comes from the report model, which comes from the result store.
 */
export class HtmlRenderer implements ReportRenderer {
  readonly format = "html";
  readonly fileExtension = "html";

  render(model: ReportModel, theme: ReportTheme = wirkmittelTheme): string {
    const { run } = model;
    return htmlPage(
      theme,
      {
        title: `${theme.title}, ${run.target}, Lauf ${run.id}`,
        meta: `Lauf ${run.id}, Plan ${run.planId}`,
        heading: theme.title,
        subtitle: `${run.target}, Lauf vom ${formatDate(run.startedAt)}`,
      },
      [
        keySection(model),
        warningsSection(model),
        tilesSection(model),
        calibrationSection(model),
        categoriesSection(model),
        trendSection(model),
        findingsSection(model),
        rejectedSection(model),
        casesSection(model),
        bindingSection(model),
        judgeFailuresSection(model),
        samplesSection(model),
        exchangesSection(model),
        metadataSection(model),
        glossarySection(),
      ],
    );
  }
}
