import type { LoadedWorkspace } from "../cli/config.js";
import type { Finding } from "../domain/finding.js";
import { escapeHtml, keyStatement, trendChart } from "../report/html-renderer.js";
import {
  formatDateTime,
  formatInterval,
  formatPercent,
  SEVERITY_LABELS,
} from "../report/markdown-renderer.js";
import type { ReportModel } from "../report/report-model.js";
import type { DraftSource, RunOverview } from "./data.js";
import type { RenderedMarkdown } from "./markdown.js";

export const CLAIM = "Der Chatbot-Testbot";

/** Messages after an action, chosen by key so nothing from the address is echoed. */
const NOTICES: Readonly<Record<string, string>> = {
  befund: "Befund gespeichert.",
  report: "Report geschrieben, er liegt im Ordner reports des Arbeitsbereichs.",
  entwurf: "Entwurf gespeichert.",
};

type Page = "runs" | "drafts" | "handbook" | "reference";

function notice(key: string | null): string {
  const text = key === null ? undefined : NOTICES[key];
  return text === undefined ? "" : `<p class="notice" role="status">${escapeHtml(text)}</p>`;
}

function layout(
  workspace: LoadedWorkspace,
  title: string,
  active: Page | null,
  body: string,
): string {
  const link = (page: Page, href: string, label: string): string =>
    `<a href="${href}"${active === page ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | AI QA</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/ui.css">
</head>
<body>
<header class="top">
<a class="brand" href="/"><img src="/assets/icon.svg" width="44" height="44" alt=""><span><span class="brand-name">AI QA</span><span class="brand-claim">${CLAIM}</span></span></a>
<p class="meta">Arbeitsbereich ${escapeHtml(workspace.dir)}<br>Zielsystem ${escapeHtml(workspace.config.target.name)} (${escapeHtml(workspace.config.target.adapter)})</p>
<nav>${link("runs", "/", "Läufe")}${link("drafts", "/drafts", "Entwürfe")}${link("handbook", "/handbuch", "Handbuch")}${link("reference", "/referenz", "Referenz")}</nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

function tokenField(token: string): string {
  return `<input type="hidden" name="token" value="${escapeHtml(token)}">`;
}

function button(
  action: string,
  token: string,
  fields: Readonly<Record<string, string>>,
  label: string,
  secondary = false,
): string {
  const hidden = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  return `<form class="inline" method="post" action="${escapeHtml(action)}">${tokenField(token)}${hidden}<button type="submit"${secondary ? ' class="secondary"' : ""}>${escapeHtml(label)}</button></form>`;
}

function tile(label: string, value: string, highlight = false): string {
  return `<div class="tile"><dt>${escapeHtml(label)}</dt><dd${highlight ? ' class="highlight"' : ""}>${escapeHtml(value)}</dd></div>`;
}

/** Start page: tiles, trend and the list of runs. */
export function overviewPage(
  workspace: LoadedWorkspace,
  overview: RunOverview,
  openDrafts: number,
): string {
  const latest = overview.rows[0];
  const openFindings = overview.rows.reduce((sum, row) => sum + row.openFindings, 0);
  const tiles = `<dl class="tiles">
${tile("Läufe", String(overview.rows.length))}
${tile("Pass-Rate des letzten Laufs", latest?.point.passRate == null ? "kein Urteil" : formatPercent(latest.point.passRate), true)}
${tile("Offene Entwürfe", String(openDrafts))}
${tile("Offene Hypothesen", String(openFindings))}
</dl>`;
  const trend =
    overview.trend.length < 2
      ? '<p class="muted">Der Trend entsteht ab zwei Läufen gegen dasselbe Zielsystem.</p>'
      : `<div class="scroll">${trendChart(overview.trend)}</div>`;
  const rows = overview.rows
    .map((row) => {
      const point = row.point;
      return `<tr><td><a class="mono" href="/runs/${escapeHtml(point.runId)}">${escapeHtml(point.runId)}</a></td><td>${escapeHtml(formatDateTime(point.startedAt))}</td><td>${escapeHtml(row.target)}</td><td>${point.status === "aborted" ? "abgebrochen" : "abgeschlossen"}</td><td class="num">${point.passRate === null ? "kein Urteil" : `${String(point.passedIterations)} von ${String(point.judgedIterations)}`}</td><td class="num">${point.passRate === null ? "" : escapeHtml(formatPercent(point.passRate))}</td><td class="num">${point.interval === null ? "" : escapeHtml(formatInterval(point.interval))}</td><td class="num">${String(row.drafts)}</td><td class="num">${String(row.openFindings)} offen, ${String(row.confirmedFindings)} bestätigt</td></tr>`;
    })
    .join("\n");
  const table =
    overview.rows.length === 0
      ? '<p class="muted">Noch keine Läufe. Starte einen mit <span class="mono">aiqa run --plan &lt;plan&gt;</span>.</p>'
      : `<div class="scroll"><table>
<thead><tr><th>Lauf</th><th>Start</th><th>Zielsystem</th><th>Status</th><th class="num">Bestanden</th><th class="num">Pass-Rate</th><th class="num">Wilson-Intervall (95 %)</th><th class="num">Entwürfe</th><th class="num">Befunde</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
  return layout(
    workspace,
    "Läufe",
    "runs",
    `<h1>Läufe</h1>
${tiles}
<section><h2>Trend</h2>${trend}</section>
<section><h2>Alle Läufe</h2>${table}</section>`,
  );
}

function findingItem(runId: string, finding: Finding, token: string): string {
  const action = `/runs/${runId}/findings/${finding.id}`;
  const statusText: Record<Finding["status"], string> = {
    hypothesis: "Hypothese, ungeprüft",
    confirmed: "bestätigt",
    rejected: "verworfen",
  };
  return `<div class="item">
<h3>${escapeHtml(finding.id)}: ${escapeHtml(finding.category)}, Schwere ${escapeHtml(SEVERITY_LABELS[finding.severity] ?? finding.severity)}</h3>
<p class="status">${escapeHtml(statusText[finding.status])}</p>
<p>${escapeHtml(finding.hypothesis)}</p>
<p class="meta">Fälle: ${escapeHtml(finding.caseIds.join(", "))}${finding.failedIterations === undefined ? "" : `. Fehlschläge: ${String(finding.failedIterations)}`}</p>
<div class="actions">${button(action, token, { status: "confirmed" }, "Bestätigen")}${button(action, token, { status: "rejected" }, "Verwerfen", true)}</div>
</div>`;
}

/** One run: key statement, report actions, findings and the embedded HTML report. */
export function runPage(
  workspace: LoadedWorkspace,
  model: ReportModel,
  findings: readonly Finding[],
  token: string,
  noticeKey: string | null,
): string {
  const { run } = model;
  const reports = `<div class="actions">${["markdown", "html", "junit"]
    .map((format) =>
      button(
        `/runs/${run.id}/reports`,
        token,
        { format },
        `Report als ${format === "markdown" ? "Markdown" : format === "html" ? "HTML" : "JUnit-XML"}`,
        format !== "html",
      ),
    )
    .join("")}</div>`;
  const findingList =
    findings.length === 0
      ? '<p class="muted">Keine Befunde. <span class="mono">aiqa analyze --run ' +
        escapeHtml(run.id) +
        "</span> bildet Hypothesen zu den Fehlschlägen.</p>"
      : findings.map((finding) => findingItem(run.id, finding, token)).join("\n");
  return layout(
    workspace,
    `Lauf ${run.id}`,
    "runs",
    `<p class="meta"><a href="/">Alle Läufe</a></p>
<h1>Lauf ${escapeHtml(run.id)}</h1>
<p class="meta">Zielsystem ${escapeHtml(run.target)}, gestartet ${escapeHtml(formatDateTime(run.startedAt))}${run.status === "aborted" ? ", abgebrochen" : ""}</p>
${notice(noticeKey)}
<section><h2>Kernaussage</h2>${keyStatement(model)
      .map((sentence) => `<p>${escapeHtml(sentence)}</p>`)
      .join("\n")}
${reports}</section>
<section><h2>Befunde</h2>
<p class="muted">Nur bestätigte Befunde erscheinen im Report.</p>
${findingList}</section>
<section><h2>Report</h2><iframe class="report" src="/runs/${escapeHtml(run.id)}/report" title="HTML-Report des Laufs"></iframe></section>`,
  );
}

/** Drafts of all goldsets with their quote, to approve or retire one by one. */
export function draftsPage(
  workspace: LoadedWorkspace,
  sources: readonly DraftSource[],
  token: string,
  noticeKey: string | null,
): string {
  const blocks = sources
    .filter((source) => source.drafts.length > 0 || source.error !== undefined)
    .map((source) => {
      const items = source.drafts
        .map((testCase) => {
          const action = `/drafts/${String(source.index)}/${testCase.id}`;
          const input =
            typeof testCase.input === "string"
              ? testCase.input
              : testCase.input.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
          const facts: [string, string][] = [
            ["Art", testCase.kind],
            ["Schwere", SEVERITY_LABELS[testCase.severity] ?? testCase.severity],
            ...(testCase.source === undefined
              ? []
              : [["Quelle", testCase.source] as [string, string]]),
            ...(testCase.expected.answer === undefined
              ? []
              : [["Referenzantwort", testCase.expected.answer] as [string, string]]),
            ...(testCase.expected.mustContain.length === 0
              ? []
              : [["Muss enthalten", testCase.expected.mustContain.join(", ")] as [string, string]]),
            ...(testCase.rubric.length === 0
              ? []
              : [
                  [
                    "Rubrik",
                    testCase.rubric
                      .map((criterion) => `${criterion.name}: ${criterion.description}`)
                      .join("\n"),
                  ] as [string, string],
                ]),
          ];
          return `<div class="item">
<h3 class="mono">${escapeHtml(testCase.id)}</h3>
<blockquote>${escapeHtml(input)}</blockquote>
<dl class="facts">${facts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
${testCase.sourceQuote === undefined ? "" : `<p class="meta">Beleg aus der Quelle</p><blockquote>${escapeHtml(testCase.sourceQuote)}</blockquote>`}
<div class="actions">${button(action, token, { status: "approved" }, "Freigeben")}${button(action, token, { status: "retired" }, "Verwerfen", true)}</div>
</div>`;
        })
        .join("\n");
      const error =
        source.error === undefined
          ? ""
          : `<p class="notice">Datei nicht lesbar: ${escapeHtml(source.error)}</p>`;
      return `<section><h2 class="mono">${escapeHtml(source.display)}</h2>${error}${items}</section>`;
    })
    .join("\n");
  return layout(
    workspace,
    "Entwürfe",
    "drafts",
    `<h1>Entwürfe</h1>
<p class="muted">Entwürfe laufen mit, zählen aber nicht in die Quote. Prüfe jeden gegen seinen Beleg, dann freigeben oder verwerfen.</p>
${notice(noticeKey)}
${blocks.length === 0 ? '<p class="muted">Keine offenen Entwürfe. <span class="mono">aiqa plan --docs &lt;pfad&gt;</span> schlägt Fälle aus Fachdokumenten vor.</p>' : blocks}`,
  );
}

/** Handbook or README as HTML with a table of contents from the second and third level. */
export function docPage(
  workspace: LoadedWorkspace,
  title: string,
  active: "handbook" | "reference",
  doc: RenderedMarkdown,
): string {
  const entries = doc.headings
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map(
      (heading) =>
        `<li class="toc-${String(heading.level)}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("\n");
  return layout(
    workspace,
    title,
    active,
    `<nav class="toc" aria-label="Inhalt"><p class="meta">Inhalt</p><ul>
${entries}
</ul></nav>
<article class="doc">
${doc.html}
</article>`,
  );
}

/** A plain error page in the same layout. */
export function errorPage(workspace: LoadedWorkspace, title: string, message: string): string {
  return layout(
    workspace,
    title,
    null,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Zu den Läufen</a></p>`,
  );
}
