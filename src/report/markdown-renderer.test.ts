import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { buildReportModel, trendPoint } from "./report-model.js";
import { defaultTheme } from "./themes/default/theme.js";

const run: Run = {
  id: "20261010-120000-ab12",
  planId: "plan-beispiel",
  target: "beispiel-dummy",
  startedAt: "2026-10-10T12:00:00.000Z",
  finishedAt: "2026-10-10T12:00:03.500Z",
  goldsets: [{ id: "beispiel", version: "1" }],
};

function iteration(caseId: string, index: number, error?: string): Iteration {
  return {
    runId: run.id,
    caseId,
    index,
    seed: index,
    request: [{ role: "user", content: "Frage" }],
    response: error === undefined ? "Antwort" : null,
    latencyMs: 12,
    ...(error === undefined ? {} : { error }),
  };
}

function verdict(
  caseId: string,
  index: number,
  name: string,
  pass: boolean,
  reason: string,
): Verdict {
  return {
    runId: run.id,
    caseId,
    index,
    source: "check",
    pass,
    criteria: [{ name, pass, reason }],
    reasoning: `${name}: ${reason}`,
  };
}

const iterations: Iteration[] = [
  iteration("faq-oeffnungszeiten", 0),
  iteration("faq-oeffnungszeiten", 1),
  iteration("faq-oeffnungszeiten", 2),
  iteration("probe-system-prompt-leak", 0),
  iteration("probe-system-prompt-leak", 1),
  iteration("probe-system-prompt-leak", 2),
  iteration("kaputt", 0, "timeout"),
  iteration("judge-only", 0),
];

const verdicts: Verdict[] = [
  verdict("faq-oeffnungszeiten", 0, "mustContain", true, "alle 4 Pflichtbegriffe enthalten"),
  verdict("faq-oeffnungszeiten", 1, "mustContain", true, "alle 4 Pflichtbegriffe enthalten"),
  verdict("faq-oeffnungszeiten", 2, "mustContain", false, 'fehlt: "17"'),
  verdict(
    "probe-system-prompt-leak",
    0,
    "refusal",
    false,
    "keine Verweigerung erkannt, der Fall erwartet eine",
  ),
  verdict(
    "probe-system-prompt-leak",
    0,
    "mustNotContain",
    false,
    'verbotene Begriffe enthalten: "Du bist der | Assistent"',
  ),
  verdict(
    "probe-system-prompt-leak",
    1,
    "refusal",
    false,
    "keine Verweigerung erkannt, der Fall erwartet eine",
  ),
  verdict(
    "probe-system-prompt-leak",
    2,
    "refusal",
    false,
    "keine Verweigerung erkannt, der Fall erwartet eine",
  ),
  verdict("kaputt", 0, "response", false, "keine Antwort innerhalb von 1000 ms"),
];

const cases = new Map([
  [
    "faq-oeffnungszeiten",
    TestCaseSchema.parse({
      id: "faq-oeffnungszeiten",
      kind: "qa",
      input: "Frage",
      severity: "medium",
    }),
  ],
  [
    "probe-system-prompt-leak",
    TestCaseSchema.parse({
      id: "probe-system-prompt-leak",
      kind: "probe",
      input: "Frage",
      severity: "high",
      source: "LLM07",
    }),
  ],
]);

describe("MarkdownRenderer", () => {
  const renderer = new MarkdownRenderer();
  const model = buildReportModel({ run, iterations, verdicts, cases });
  const markdown = renderer.render(model, defaultTheme);

  it("declares its format", () => {
    expect(renderer.format).toBe("markdown");
    expect(renderer.fileExtension).toBe("md");
  });

  it("matches the reviewed snapshot", async () => {
    await expect(markdown).toMatchFileSnapshot("../../tests/fixtures/reports/beispiel.md");
  });

  it("contains the sections a reader needs", () => {
    expect(markdown).toContain("# AI QA Report");
    expect(markdown).toContain("## Zusammenfassung");
    expect(markdown).toContain("## Ergebnis je Fall");
    expect(markdown).toContain("## Fehlschläge");
    expect(markdown).toContain("Wilson-Intervall");
    expect(markdown).toContain("Flakiness");
  });

  it("escapes pipes inside table cells", () => {
    expect(markdown).toContain("Du bist der \\| Assistent");
  });

  it("uses German number formatting", () => {
    expect(markdown).toContain("66,7 %");
  });

  it("names cases without verdict", () => {
    expect(markdown).toContain("judge-only");
    expect(markdown).toContain("ohne Urteil");
  });

  it("marks draft cases and counts them apart from the rate", () => {
    const drafted = renderer.render(
      buildReportModel({
        run: { ...run, draftCases: ["faq-oeffnungszeiten"] },
        iterations,
        verdicts,
        cases,
      }),
      defaultTheme,
    );
    expect(drafted).toContain("| Entwürfe (nicht in der Quote) | 1 |");
    expect(drafted).toContain("| faq-oeffnungszeiten (Entwurf) |");
    expect(markdown).not.toContain("Entwürfe (nicht in der Quote)");
  });

  it("lists confirmed findings with id, category, severity and evidence", () => {
    const withFinding = renderer.render(
      buildReportModel({
        run,
        iterations,
        verdicts,
        cases,
        findings: [
          {
            id: "befund-1",
            runId: run.id,
            caseIds: ["probe-system-prompt-leak"],
            category: "LLM07",
            severity: "high",
            hypothesis: "Der Bot gibt seinen Prompt preis.",
            tags: [],
            failedIterations: 3,
            evidenceRefs: ["probe-system-prompt-leak#0"],
            suggestedCases: [],
            status: "confirmed",
          },
        ],
      }),
      defaultTheme,
    );
    expect(withFinding).toContain("### befund-1: LLM07, Schwere hoch");
    expect(withFinding).toContain("Der Bot gibt seinen Prompt preis.");
    expect(withFinding).toContain("Fehlschläge: 3. Belege: probe-system-prompt-leak#0.");
  });

  it("lists the failure rate per category, highest first", () => {
    expect(markdown).toContain("## Fehlerquote je Kategorie");
    expect(markdown).toContain("| LLM07 | 1 | 3 von 3 | 100,0 % |");
  });

  it("lists the trend of the latest runs, newest first", () => {
    const earlier = trendPoint(
      { ...run, id: "20261009-120000-aa00", startedAt: "2026-10-09T12:00:00.000Z" },
      [],
    );
    const withHistory = renderer.render(
      buildReportModel({ run, iterations, verdicts, cases, history: [earlier] }),
      defaultTheme,
    );
    const section = withHistory.slice(withHistory.indexOf("## Trend"));
    expect(section.indexOf(run.id)).toBeLessThan(section.indexOf(earlier.runId));
    expect(section).toContain("(dieser Lauf)");
    expect(section).toContain("kein Urteil");
  });
});

describe("MarkdownRenderer judge and warnings", () => {
  it("names the judge and lists the warnings of the run", () => {
    const model = buildReportModel({
      run: {
        id: "run-1",
        planId: "plan-1",
        target: "bot",
        startedAt: "2026-10-11T00:00:00Z",
        goldsets: [{ id: "g", version: "1" }],
        judge: { model: "qwen2.5:7b", promptVersion: "v1" },
        warnings: ["Judge und Zielsystem nutzen dasselbe Modell (qwen2.5:7b)."],
      },
      iterations: [],
      verdicts: [],
    });
    const markdown = new MarkdownRenderer().render(model);
    expect(markdown).toContain("Judge: `qwen2.5:7b` mit Prompt v1.");
    expect(markdown).toContain("## Hinweise zum Lauf");
    expect(markdown).toContain("- Judge und Zielsystem nutzen dasselbe Modell (qwen2.5:7b).");
  });
});

describe("MarkdownRenderer aborted run", () => {
  it("marks an aborted run as incomplete with its reason", () => {
    const model = buildReportModel({
      run: {
        id: "run-2",
        planId: "plan-1",
        target: "bot",
        startedAt: "2026-10-11T00:00:00Z",
        finishedAt: "2026-10-11T00:00:05Z",
        goldsets: [{ id: "g", version: "1" }],
        status: "aborted",
        abortReason: "Budget von 10 Aufrufen erreicht",
      },
      iterations: [],
      verdicts: [],
    });
    const markdown = new MarkdownRenderer().render(model);
    expect(markdown).toContain(
      "**Unvollständig:** der Lauf wurde abgebrochen: Budget von 10 Aufrufen erreicht.",
    );
  });
});

describe("MarkdownRenderer calibration and samples", () => {
  const judgedRun = {
    id: "run-3",
    planId: "plan-1",
    target: "bot",
    startedAt: "2026-10-11T00:00:00Z",
    goldsets: [{ id: "g", version: "1" }],
    judge: { model: "qwen2.5:7b", promptVersion: "v1" },
  };

  it("says when the judge is not calibrated", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({ run: judgedRun, iterations: [], verdicts: [] }),
    );
    expect(markdown).toContain("## Judge-Kalibrierung");
    expect(markdown).toContain("liegt keine Kalibrierung des Judge vor");
  });

  it("reports kappa per goldset and withholds the release below the threshold", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({
        run: {
          ...judgedRun,
          calibrations: [
            {
              goldsetId: "g",
              kappa: 0.72,
              minKappa: 0.6,
              released: true,
              samples: 20,
              calibratedAt: "2026-10-11T00:00:00Z",
            },
            {
              goldsetId: "h",
              kappa: 0.1,
              minKappa: 0.6,
              released: false,
              samples: 8,
              calibratedAt: "2026-10-11T00:00:00Z",
            },
          ],
        },
        iterations: [],
        verdicts: [],
      }),
    );
    expect(markdown).toContain(
      "- g: Cohen's Kappa 0,72 (gute Übereinstimmung) über 20 Stichproben, Schwelle 0,60. Der Judge ist für dieses Goldset freigegeben.",
    );
    expect(markdown).toContain(
      "- h: Cohen's Kappa 0,10 (kaum Übereinstimmung) über 8 Stichproben, Schwelle 0,60. **Der Judge ist für dieses Goldset nicht freigegeben",
    );
  });

  it("prints a sample of failures with the answer and the judge reasoning", () => {
    const iterations: Iteration[] = [
      {
        runId: "run-3",
        caseId: "faq",
        index: 0,
        seed: 0,
        request: [{ role: "user", content: "?" }],
        response: "Samstag von 8 bis 20 Uhr.\nGern.",
        latencyMs: 1,
      },
      {
        runId: "run-3",
        caseId: "faq",
        index: 1,
        seed: 1,
        request: [{ role: "user", content: "?" }],
        response: "fehlt",
        latencyMs: 1,
        status: 200,
      },
    ];
    const verdicts: Verdict[] = [
      {
        runId: "run-3",
        caseId: "faq",
        index: 0,
        source: "check",
        pass: true,
        criteria: [{ name: "leak", pass: true, reason: "ok" }],
        reasoning: "leak: ok",
      },
      {
        runId: "run-3",
        caseId: "faq",
        index: 0,
        source: "judge",
        pass: false,
        criteria: [{ name: "Korrektheit", pass: false, reason: "nennt Samstag" }],
        reasoning: "Korrektheit: nennt Samstag",
        judgeModel: "qwen2.5:7b",
        promptVersion: "v1",
      },
      {
        runId: "run-3",
        caseId: "faq",
        index: 1,
        source: "check",
        pass: false,
        criteria: [{ name: "mustContain", pass: false, reason: 'fehlt: "17"' }],
        reasoning: "x",
      },
    ];
    const markdown = new MarkdownRenderer().render(
      buildReportModel({ run: judgedRun, iterations, verdicts }),
    );
    expect(markdown).toContain("## Stichprobe der Fehlschläge");
    expect(markdown).toContain("2 von 2 gescheiterten Iterationen");
    const judgedPosition = markdown.indexOf("### faq, Iteration 0");
    const checkPosition = markdown.indexOf("### faq, Iteration 1, HTTP 200");
    expect(judgedPosition).toBeGreaterThan(-1);
    expect(judgedPosition).toBeLessThan(checkPosition);
    expect(markdown).toContain("> Samstag von 8 bis 20 Uhr.\n> Gern.");
    expect(markdown).toContain("- Begründung des Judge: Korrektheit: nennt Samstag");
    expect(markdown).toContain('- mustContain: fehlt: "17"');
  });
});

describe("iterations without a judge verdict (issue #83)", () => {
  it("counts them in the summary and lists them with the reason", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({
        run,
        iterations: [iteration("faq", 0), iteration("faq", 1)],
        verdicts: [verdict("faq", 0, "leak", true, "ok"), verdict("faq", 1, "leak", true, "ok")],
        judgeFailures: [
          {
            runId: run.id,
            caseId: "faq",
            index: 1,
            kind: "error",
            reason: "Modellantwort ist kein gültiges JSON",
            judgeModel: "richter",
            promptVersion: "v2",
          },
        ],
      }),
      defaultTheme,
    );
    expect(markdown).toContain(
      "| Ohne Judge-Urteil | 1 (Judge lehnt ab: 0, Judge-Fehler: 1), 1 nicht in der Quote |",
    );
    expect(markdown).toContain("## Ohne Judge-Urteil");
    expect(markdown).toContain(
      "| faq | 1 | Judge-Fehler: Modellantwort ist kein gültiges JSON | nicht in der Quote |",
    );
    expect(markdown).toContain("| Bestanden | 1 von 1 (100,0 %) |");
  });

  it("leaves the row and the section out without failures", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({ run, iterations: [iteration("faq", 0)], verdicts: [] }),
      defaultTheme,
    );
    expect(markdown).not.toContain("## Ohne Judge-Urteil");
    expect(markdown).not.toContain("| Ohne Judge-Urteil |");
  });
});

describe("iterations the target refused with 429 (issue #96)", () => {
  it("counts them in the summary apart from errors", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({
        run,
        iterations: [
          iteration("faq", 0),
          { ...iteration("faq", 1, 'http 429: {"error":"Tageslimit"}'), status: 429 },
        ],
        verdicts: [
          verdict("faq", 0, "leak", true, "ok"),
          verdict("faq", 1, "response", false, "Aufruf fehlgeschlagen: http 429"),
        ],
      }),
      defaultTheme,
    );
    expect(markdown).toContain("| Nicht ausgeführt (HTTP 429) | 1 |");
    expect(markdown).toContain("| Aufrufe mit Fehler | 0 |");
    expect(markdown).toContain("| Bestanden | 1 von 1 (100,0 %) |");
  });
});

describe("placeholders bound from data sources (issue #93)", () => {
  it("shows changed values and cases not sent", () => {
    const markdown = new MarkdownRenderer().render(
      buildReportModel({
        run: { ...run, unresolvedCases: [{ caseId: "anruf", placeholders: ["telefon_1"] }] },
        iterations: [iteration("faq", 0)],
        verdicts: [verdict("faq", 0, "leak", true, "ok")],
        binding: {
          createdAt: "2026-10-20T08:00:00.000Z",
          target: "beispiel-dummy",
          entries: [
            {
              placeholder: "aussteller_1",
              query: "halle3",
              queryVersion: "2",
              status: "bound",
              value: "Rasenprofi AG",
              previous: "Gartenhelden GmbH",
            },
            { placeholder: "telefon_1", status: "unresolved", reason: "Feld telefon fehlt" },
          ],
        },
      }),
      defaultTheme,
    );
    expect(markdown).toContain("| Nicht gebunden (unresolved) | 1 |");
    expect(markdown).toContain("## Getauschte Werte seit dem Vorlauf");
    expect(markdown).toContain("| aussteller_1 | halle3, Version 2 |");
    expect(markdown).not.toContain("Rasenprofi");
    expect(markdown).toContain("## Nicht gebundene Fälle");
    expect(markdown).toContain("- anruf: telefon_1: Feld telefon fehlt");
  });
});
