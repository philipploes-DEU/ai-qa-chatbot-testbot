import { describe, expect, it } from "vitest";

import type { Finding } from "../domain/finding.js";
import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { wilsonInterval } from "../stats/wilson.js";
import { buildHandoverModel, HandoverHtmlRenderer, HandoverMarkdownRenderer } from "./handover.js";
import { formatPercent } from "./markdown-renderer.js";
import { buildReportModel, type ReportModel } from "./report-model.js";
import { defaultTheme } from "./themes/default/theme.js";
import { wirkmittelTheme } from "./themes/wirkmittel/theme.js";

const first: Run = {
  id: "20261019-100000-aaaa",
  planId: "plan-sicherheit",
  target: "ziel",
  startedAt: "2026-10-19T10:00:00.000Z",
  finishedAt: "2026-10-19T10:20:00.000Z",
  status: "completed",
  goldsets: [{ id: "sicherheit", version: "3" }],
  judge: { model: "richter", promptVersion: "v2" },
  outOfScope: ["Indirekte Injection über Dokumente", "Lasttests"],
  usage: {
    calls: 3,
    targetTokens: { input: 0, output: 0 },
    judgeTokens: { input: 900, output: 90 },
  },
};

const second: Run = {
  id: "20261019-110000-bbbb",
  planId: "plan-mandant",
  target: "ziel",
  startedAt: "2026-10-19T11:00:00.000Z",
  finishedAt: "2026-10-19T11:01:00.000Z",
  status: "aborted",
  abortReason: "Budget von 2 Aufrufen erreicht",
  goldsets: [{ id: "mandant", version: "1" }],
  outOfScope: ["Lasttests", "Fremde echte Mandate"],
};

function iteration(run: Run, caseId: string, index: number): Iteration {
  return {
    runId: run.id,
    caseId,
    index,
    seed: index,
    request: [{ role: "user", content: "Frage" }],
    response: "Antwort",
    latencyMs: 5,
  };
}

function verdict(run: Run, caseId: string, index: number, pass: boolean): Verdict {
  return {
    runId: run.id,
    caseId,
    index,
    source: "check",
    pass,
    criteria: [{ name: "mustNotContain", pass, reason: pass ? "ok" : "enthält den Köder" }],
    reasoning: "mustNotContain",
  };
}

function finding(
  run: Run,
  id: string,
  status: Finding["status"],
  severity: Finding["severity"],
  extra: Partial<Finding> = {},
): Finding {
  return {
    id,
    runId: run.id,
    caseIds: ["koeder"],
    category: "LLM01",
    severity,
    hypothesis: `Hypothese ${id}`,
    tags: [],
    evidenceRefs: [],
    suggestedCases: [],
    status,
    ...extra,
  };
}

const cases = new Map([
  ["koeder", TestCaseSchema.parse({ id: "koeder", kind: "probe", input: "x", source: "LLM01" })],
  ["fremd", TestCaseSchema.parse({ id: "fremd", kind: "probe", input: "x", source: "LLM02" })],
]);

const reports: ReportModel[] = [
  buildReportModel({
    run: first,
    iterations: [0, 1, 2, 3].map((index) => iteration(first, "koeder", index)),
    verdicts: [
      verdict(first, "koeder", 0, true),
      verdict(first, "koeder", 1, false),
      verdict(first, "koeder", 2, false),
      verdict(first, "koeder", 3, true),
    ],
    cases,
    findings: [
      finding(first, "befund-1", "confirmed", "high", {
        cause: "Ursache 1",
        suggestion: "Vorschlag 1",
        evidenceRefs: ["koeder#1"],
      }),
      finding(first, "befund-2", "rejected", "medium", {
        note: "Fehlalarm des Werkzeugs",
        evidenceRefs: ["koeder#2"],
      }),
      finding(first, "befund-3", "hypothesis", "low"),
    ],
    judgeFailures: [
      {
        runId: first.id,
        caseId: "koeder",
        index: 3,
        kind: "refusal",
        reason: "leere Antwort",
        judgeModel: "richter",
        promptVersion: "v2",
      },
    ],
  }),
  buildReportModel({
    run: second,
    iterations: [0, 1].map((index) => iteration(second, "fremd", index)),
    verdicts: [verdict(second, "fremd", 0, true), verdict(second, "fremd", 1, false)],
    cases,
    findings: [
      finding(second, "befund-1", "confirmed", "critical", {
        caseIds: ["fremd"],
        category: "LLM02",
      }),
    ],
  }),
];

describe("buildHandoverModel", () => {
  // Given out of order on purpose: the handover orders runs by start.
  const model = buildHandoverModel({ reports: [reports[1], reports[0]] as ReportModel[] });

  it("orders the runs by start and sums their numbers", () => {
    expect(model.target).toBe("ziel");
    expect(model.runs.map((run) => run.id)).toEqual([first.id, second.id]);
    expect(model.totals.cases).toBe(2);
    expect(model.totals.iterations).toBe(6);
    // koeder#3 has no judge verdict and leaves the rate (ADR 0019).
    expect(model.totals.judgedIterations).toBe(5);
    expect(model.totals.passedIterations).toBe(2);
    expect(model.totals.passRate).toBeCloseTo(0.4);
    expect(model.totals.interval).toEqual(wilsonInterval(2, 5));
  });

  it("uses the corrected count of a run with rejected findings and the raw one otherwise", () => {
    expect(model.totals.correctedPassedIterations).toBe(3);
    expect(model.totals.correctedPassRate).toBeCloseTo(0.6);
  });

  it("lists confirmed findings of all runs by severity, with their run", () => {
    expect(model.findings.map((entry) => `${entry.runId}:${entry.id}:${entry.severity}`)).toEqual([
      `${second.id}:befund-1:critical`,
      `${first.id}:befund-1:high`,
    ]);
    expect(model.findings[1]?.cause).toBe("Ursache 1");
    expect(model.rejectedFindings.map((entry) => entry.id)).toEqual(["befund-2"]);
  });

  it("sums the categories over the runs", () => {
    expect(
      model.categories.map(
        (entry) =>
          `${entry.category}:${String(entry.failedIterations)}/${String(entry.judgedIterations)}`,
      ),
    ).toEqual(["LLM01:2/3", "LLM02:1/2"]);
  });

  it("names what was deliberately not tested, without repeats", () => {
    expect(model.outOfScope).toEqual([
      "Indirekte Injection über Dokumente",
      "Lasttests",
      "Fremde echte Mandate",
    ]);
  });

  it("sums the recorded effort and counts runs without a record", () => {
    expect(model.totals.usage).toEqual({
      calls: 3,
      targetTokens: { input: 0, output: 0 },
      judgeTokens: { input: 900, output: 90 },
      runsWithout: 1,
    });
  });

  it("states the limits of the check", () => {
    const limits = model.limits.join(" ");
    expect(limits).toContain(
      `Iterationen je Fall: 2 bis 4. Auch 2 von 2 bestanden heißt mit 95 Prozent Sicherheit nur eine Pass-Rate über ${formatPercent(wilsonInterval(2, 2).low)}`,
    );
    expect(limits).toContain("Der Judge richter (Prompt v2) ist für sicherheit nicht kalibriert");
    expect(limits).toContain("Ohne Quelldokumente für den Judge: sicherheit.");
    expect(limits).toContain(
      `Lauf ${second.id} lief ohne Judge, nur mit deterministischen Checks.`,
    );
    expect(limits).toContain(
      `Lauf ${second.id} wurde abgebrochen (Budget von 2 Aufrufen erreicht)`,
    );
    expect(limits).toContain("Ohne Judge-Urteil: 1 (Judge lehnt ab: 1, Judge-Fehler: 0)");
  });

  it("does not claim missing sources for a run that did not record them", () => {
    const old = buildHandoverModel({
      reports: [
        buildReportModel({
          run: { ...first, usage: undefined },
          iterations: [],
          verdicts: [],
        }),
      ],
    });
    const limits = old.limits.join(" ");
    expect(limits).not.toContain("Ohne Quelldokumente");
    expect(limits).toContain(
      `Für Lauf ${first.id} ist nicht festgehalten, ob der Judge Quelldokumente las.`,
    );
  });

  it("says the result in a few sentences", () => {
    const text = model.keyStatement.join(" ");
    expect(text).toContain("2 Läufe gegen ziel vom 19.10.2026, 2 Fälle, 6 Iterationen.");
    expect(text).toContain("Zusammen 2 von 5 bewerteten Iterationen bestanden (40,0 %).");
    expect(text).toContain("Bereinigt um verworfene Befunde: 3 von 5 (60,0 %).");
    expect(text).toContain("2 bestätigte Befunde: 1 kritisch, 1 hoch.");
    expect(text).toContain(
      "1 Befund verworfen, etwa als Fehlalarm des Werkzeugs. Die bereinigte Quote zählt ihn als bestanden.",
    );
    expect(text).toContain("3 Bereiche bewusst nicht geprüft");
  });

  it("refuses runs of different targets and an empty list", () => {
    const other = buildReportModel({
      run: { ...second, id: "20261019-120000-cccc", target: "anderes" },
      iterations: [],
      verdicts: [],
    });
    expect(() => buildHandoverModel({ reports: [...reports.slice(0, 1), other] })).toThrow(
      /verschiedenen Zielsystemen \(ziel, anderes\)/,
    );
    expect(() => buildHandoverModel({ reports: [] })).toThrow(/mindestens einen Lauf/);
  });

  it("counts a run given twice once", () => {
    const twice = buildHandoverModel({ reports: [reports[0], reports[0]] as ReportModel[] });
    expect(twice.runs).toHaveLength(1);
  });

  it("counts the iterations of a case over all runs that ran it", () => {
    const again = buildReportModel({
      run: { ...first, id: "20261019-130000-dddd", startedAt: "2026-10-19T13:00:00.000Z" },
      iterations: [0, 1].map((index) => iteration(first, "koeder", index)),
      verdicts: [verdict(first, "koeder", 0, true), verdict(first, "koeder", 1, true)],
      cases,
    });
    const both = buildHandoverModel({ reports: [...reports, again] });
    expect(both.limits.join(" ")).toContain("Iterationen je Fall: 2 bis 6.");
  });

  it("names iterations the target refused with 429 as a limit", () => {
    const refused = buildReportModel({
      run: { ...second, id: "20261019-140000-eeee", startedAt: "2026-10-19T14:00:00.000Z" },
      iterations: [
        { ...iteration(second, "fremd", 0), response: null, status: 429, error: "http 429" },
      ],
      verdicts: [verdict(second, "fremd", 0, false)],
      cases,
    });
    const both = buildHandoverModel({ reports: [...reports, refused] });
    expect(both.totals.notExecuted).toBe(1);
    // fremd ran twice and once more refused: the refused one is no iteration of the case.
    expect(both.limits.join(" ")).toContain("Iterationen je Fall: 2 bis 4.");
    expect(both.limits.join(" ")).toContain(
      "Nicht ausgeführt: 1 Iteration, das Zielsystem lehnte sie mit HTTP 429 ab, etwa wegen eines Tageslimits.",
    );
  });

  it("leaves a case out of the iteration limits when the target refused all of it", () => {
    const onlyRefused = buildReportModel({
      run: { ...second, id: "20261019-150000-ffff", startedAt: "2026-10-19T15:00:00.000Z" },
      iterations: [
        { ...iteration(second, "neu", 0), response: null, status: 429, error: "http 429" },
      ],
      verdicts: [verdict(second, "neu", 0, false)],
      cases,
    });
    const model = buildHandoverModel({ reports: [...reports, onlyRefused] });
    expect(model.limits.join(" ")).toContain("Iterationen je Fall: 2 bis 4.");
    const alone = buildHandoverModel({ reports: [onlyRefused] });
    expect(alone.limits.join(" ")).not.toContain("Iterationen je Fall");
  });

  it("shows the effort total as not recorded when no run has a record", () => {
    const markdown = new HandoverMarkdownRenderer().render(
      buildHandoverModel({ reports: reports.slice(1) }),
    );
    expect(markdown).toContain("| Gesamt | nicht erfasst |");
    expect(markdown).toContain(
      "1 Lauf ohne erfassten Aufwand, etwa aus einer Version vor AI QA 0.8 oder nicht regulär beendet. Er fehlt in der Summe.",
    );
  });
});

describe("handover renderers", () => {
  const model = buildHandoverModel({ reports });

  it("writes Markdown with result, findings, categories, scope, limits, effort and runs", () => {
    const markdown = new HandoverMarkdownRenderer().render(model, defaultTheme);
    for (const heading of [
      "# Übergabe: ziel",
      "## Ergebnis",
      "## Befunde",
      "## Verworfene Befunde",
      "## Bestanden je Kategorie",
      "## Bewusst nicht geprüft",
      "## Grenzen der Prüfung",
      "## Aufwand",
      "## Läufe",
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain(`### befund-1 aus Lauf ${second.id}: LLM02, Schwere kritisch`);
    expect(markdown).toContain("Tokens abgelehnter oder gescheiterter Judge-Aufrufe");
    expect(markdown).toContain("Ursache: Ursache 1");
    expect(markdown).toContain("Vorschlag: Vorschlag 1");
    expect(markdown).toContain(
      "- befund-2 (koeder): Hypothese befund-2 Grund: Fehlalarm des Werkzeugs",
    );
    expect(markdown).toContain("| Gesamt | 3 | 0 | 0 | 900 | 90 |");
    expect(markdown).toContain(`| ${second.id} | nicht erfasst |`);
    expect(markdown).toContain(`| ${first.id} | plan-sicherheit |`);
  });

  it("writes self-contained HTML in the theme, escaped", () => {
    const html = new HandoverHtmlRenderer().render(
      buildHandoverModel({
        reports: [
          buildReportModel({
            run: { ...first, outOfScope: ["<script>alert(1)</script>"] },
            iterations: [],
            verdicts: [],
          }),
        ],
      }),
      wirkmittelTheme,
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("#131122");
    expect(html).toContain(">Bewusst nicht geprüft<");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("has formats and file extensions", () => {
    expect(new HandoverMarkdownRenderer().fileExtension).toBe("md");
    expect(new HandoverHtmlRenderer().fileExtension).toBe("html");
  });
});
