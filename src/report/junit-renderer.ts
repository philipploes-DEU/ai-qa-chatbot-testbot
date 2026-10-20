import { formatInterval, formatPercent } from "./markdown-renderer.js";
import type { CaseReport, ReportModel } from "./report-model.js";
import type { ReportRenderer } from "./report-renderer.js";

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text for XML and drops control characters that XML 1.0 does not allow. */
export function escapeXml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
  );
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function attributes(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}="${escapeXml(String(value))}"`)
    .join(" ");
}

type Outcome = "passed" | "failed" | "skipped" | "error";

function outcomeOf(entry: CaseReport): Outcome {
  if (entry.draft) return "skipped";
  if (entry.summary === null) return entry.errors > 0 ? "error" : "skipped";
  return entry.summary.passes < entry.summary.n ? "failed" : "passed";
}

function testcase(entry: CaseReport): string {
  const open = `<testcase ${attributes({
    name: entry.caseId,
    classname: entry.category,
    time: seconds(entry.averageLatencyMs * entry.iterations),
  })}`;
  const outcome = outcomeOf(entry);
  if (outcome === "passed") return `    ${open}/>`;
  if (outcome === "skipped") {
    const message = entry.draft ? "Entwurf, zählt nicht in die Quote" : "ohne Urteil";
    return `    ${open}>\n      <skipped ${attributes({ message })}/>\n    </testcase>`;
  }
  if (outcome === "error") {
    const message = `${String(entry.errors)} von ${String(entry.iterations)} Aufrufen gescheitert`;
    return `    ${open}>\n      <error ${attributes({ message, type: "aiqa" })}/>\n    </testcase>`;
  }
  const summary = entry.summary;
  const message =
    summary === null
      ? "gescheitert"
      : `${String(summary.passes)} von ${String(summary.n)} Iterationen bestanden (${formatPercent(summary.passRate)})`;
  const details = [
    ...(summary === null ? [] : [`Wilson-Intervall (95 %): ${formatInterval(summary.interval)}`]),
    ...entry.failures.flatMap((failure) =>
      failure.checks.map(
        (check) => `Iteration ${String(failure.index)}: ${check.name}: ${check.reason}`,
      ),
    ),
  ];
  return (
    `    ${open}>\n` +
    `      <failure ${attributes({ message, type: "aiqa" })}>${escapeXml(details.join("\n"))}</failure>\n` +
    "    </testcase>"
  );
}

/**
 * Renders a run as JUnit XML for test reporting tools, for example in GitHub Actions (issue
 * #59). One suite per run, one test case per case. A case fails when at least one iteration
 * failed; whether the job fails stays the decision of `aiqa gate`.
 */
export class JUnitRenderer implements ReportRenderer {
  readonly format = "junit";
  readonly fileExtension = "xml";

  render(model: ReportModel): string {
    const { run, totals } = model;
    const outcomes = model.cases.map(outcomeOf);
    const counts = {
      tests: model.cases.length,
      failures: outcomes.filter((outcome) => outcome === "failed").length,
      errors: outcomes.filter((outcome) => outcome === "error").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    };
    const duration =
      run.finishedAt === undefined ? 0 : Date.parse(run.finishedAt) - Date.parse(run.startedAt);
    const properties = [
      ["aiqa.run", run.id],
      ["aiqa.plan", run.planId],
      ["aiqa.passRate", totals.passRate === null ? "" : String(totals.passRate)],
      ["aiqa.interval", totals.interval === null ? "" : formatInterval(totals.interval)],
      ["aiqa.status", run.status ?? "unbekannt"],
      ...(run.judge === undefined
        ? []
        : [["aiqa.judge", `${run.judge.model} (Prompt ${run.judge.promptVersion})`]]),
    ]
      .map(
        ([name, value]) =>
          `      <property ${attributes({ name: name ?? "", value: value ?? "" })}/>`,
      )
      .join("\n");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites ${attributes({ name: "AI QA", ...counts, time: seconds(duration) })}>`,
      `  <testsuite ${attributes({
        name: run.target,
        id: run.id,
        ...counts,
        timestamp: run.startedAt,
        time: seconds(duration),
      })}>`,
      "    <properties>",
      properties,
      "    </properties>",
      ...model.cases.map(testcase),
      "  </testsuite>",
      "</testsuites>",
      "",
    ].join("\n");
  }
}
