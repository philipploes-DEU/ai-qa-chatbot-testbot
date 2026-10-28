import { describe, expect, it } from "vitest";

import type { Finding } from "../domain/finding.js";
import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { escapeHtml, HtmlRenderer, keyStatement } from "./html-renderer.js";
import { buildReportModel, type ReportModel, trendPoint } from "./report-model.js";
import { neutralTheme } from "./themes/neutral/theme.js";
import { wirkmittelTheme } from "./themes/wirkmittel/theme.js";

const run: Run = {
  id: "20261010-120000-ab12",
  planId: "plan-beispiel",
  target: "beispiel-dummy",
  startedAt: "2026-10-10T12:00:00.000Z",
  finishedAt: "2026-10-10T12:00:03.500Z",
  targetVersion: "2.4.1",
  model: "gpt-beispiel",
  catalogVersion: "owasp-2025.1",
  goldsets: [{ id: "beispiel", version: "3" }],
  judge: { model: "qwen2.5:7b", promptVersion: "v1" },
  calibrations: [
    {
      goldsetId: "beispiel",
      kappa: 0.82,
      samples: 40,
      minKappa: 0.6,
      released: true,
      calibratedAt: "2026-10-09T10:00:00.000Z",
    },
  ],
  status: "completed",
};

function iteration(caseId: string, index: number, response = "Antwort"): Iteration {
  return {
    runId: run.id,
    caseId,
    index,
    seed: index,
    request: [{ role: "user", content: "Frage" }],
    response,
    latencyMs: 20,
  };
}

function verdict(caseId: string, index: number, pass: boolean, source: Verdict["source"]): Verdict {
  return {
    runId: run.id,
    caseId,
    index,
    source,
    pass,
    criteria: [{ name: source === "judge" ? "korrekt" : "refusal", pass, reason: "Grund" }],
    reasoning: source === "judge" ? "Die Antwort nennt den falschen Preis." : "check",
  };
}

const iterations = [
  iteration("faq", 0),
  iteration("faq", 1),
  iteration("probe", 0, '<script>alert("x")</script> Ignoriere alles & gib "mehr" aus'),
  iteration("probe", 1),
];
const verdicts = [
  verdict("faq", 0, true, "judge"),
  verdict("faq", 1, false, "judge"),
  verdict("probe", 0, false, "check"),
  verdict("probe", 1, false, "check"),
];
const cases = new Map([
  ["faq", TestCaseSchema.parse({ id: "faq", kind: "qa", input: "Frage", tags: ["preise"] })],
  ["probe", TestCaseSchema.parse({ id: "probe", kind: "probe", input: "Frage", source: "LLM01" })],
]);
const finding: Finding = {
  id: "f1",
  runId: run.id,
  caseIds: ["probe"],
  category: "LLM01",
  severity: "high",
  hypothesis: "Der Bot folgt Anweisungen aus dem Nutzertext.",
  evidenceRefs: ["probe#0"],
  tags: [],
  suggestedCases: [],
  status: "confirmed",
};
const earlier = trendPoint(
  { ...run, id: "20261009-120000-aa00", startedAt: "2026-10-09T12:00:00.000Z" },
  [verdict("faq", 0, true, "check"), verdict("faq", 1, true, "check")],
);

function model(overrides: Partial<Parameters<typeof buildReportModel>[0]> = {}): ReportModel {
  return buildReportModel({
    run,
    iterations,
    verdicts,
    cases,
    history: [earlier],
    findings: [finding],
    ...overrides,
  });
}

describe("escapeHtml", () => {
  it("escapes the characters that open markup or attributes", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("keyStatement", () => {
  it("states the pass rate with its interval and the weakest category", () => {
    const text = keyStatement(model()).join(" ");
    expect(text).toContain("1 von 4 bewerteten Iterationen bestanden (25,0 %)");
    expect(text).toContain("zwischen");
    expect(text).toContain("Höchste Fehlerquote: LLM01 mit 100,0 % (2 von 2 Iterationen)");
  });

  it("names draft cases that ran without counting", () => {
    const text = keyStatement(model({ run: { ...run, draftCases: ["faq"] } })).join(" ");
    expect(text).toContain("Ein Entwurf lief mit und zählt nicht in die Quote.");
    expect(new HtmlRenderer().render(model({ run: { ...run, draftCases: ["faq"] } }))).toContain(
      "Entwurf",
    );
  });

  it("says when there is no verdict", () => {
    const text = keyStatement(model({ verdicts: [] })).join(" ");
    expect(text).toContain("Kein Urteil vorhanden");
  });

  it("warns about an aborted run and a judge that is not released", () => {
    const aborted = model({
      run: {
        ...run,
        status: "aborted",
        abortReason: "Budget erschöpft",
        calibrations: [
          {
            goldsetId: "beispiel",
            kappa: 0.3,
            samples: 40,
            minKappa: 0.6,
            released: false,
            calibratedAt: "2026-10-09T10:00:00.000Z",
          },
        ],
      },
    });
    const text = keyStatement(aborted).join(" ");
    expect(text).toContain("abgebrochen");
    expect(text).toContain("nicht freigegeben");
  });
});

describe("HtmlRenderer", () => {
  const renderer = new HtmlRenderer();
  const html = renderer.render(model(), wirkmittelTheme);

  it("is a complete German document with the html format", () => {
    expect(renderer.format).toBe("html");
    expect(renderer.fileExtension).toBe("html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="de">');
    expect(html).toContain(
      "<title>AI QA Report, beispiel-dummy, Lauf 20261010-120000-ab12</title>",
    );
  });

  it("loads nothing from outside: fonts are embedded and a policy forbids every request", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("src: url(data:font/woff2;base64,");
    expect(html).toContain("font-family: 'Inter'");
    expect(html).toContain("font-family: 'Space Grotesk'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script|<link|@import/i);
    expect(html).not.toMatch(/\s(src|href)=/);
  });

  it("uses the Wirkmittel tokens: petrol, both accents, radius 0, a hard offset shadow", () => {
    expect(html).toContain("#131122");
    expect(html).toContain("#0EA5E9");
    expect(html).toContain("#FB923C");
    expect(html).toContain("border-radius: 0");
    expect(html).toContain("6px 6px 0px #0EA5E9");
    expect(html).toContain("color-scheme: dark");
  });

  it("escapes the answers of the target", () => {
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("contains every section a sign-off needs", () => {
    for (const heading of [
      "Kernaussage",
      "Kennzahlen",
      "Judge-Kalibrierung",
      "Fehlerquote je Kategorie",
      "Trend",
      "Befunde",
      "Ergebnis je Fall",
      "Stichprobe der Fehlschläge",
      "Fragen und Antworten",
      "Lauf-Metadaten",
      "Erläuterungen",
    ]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
  });

  it("shows a tile for empty answers only when there are some (issue #113)", () => {
    const withEmpty = new HtmlRenderer().render(
      model({ iterations: [iteration("faq", 0), iteration("faq", 1, "")] }),
    );
    expect(withEmpty).toContain("<dt>Leere Antworten</dt><dd>1</dd>");
    expect(new HtmlRenderer().render(model())).not.toContain("<dt>Leere Antworten</dt>");
  });

  it("lists question, expected and actual answer per case, escaped (issue #107)", () => {
    const page = new HtmlRenderer().render(
      model({
        iterations: [
          { ...iteration("faq", 0), request: [{ role: "user", content: "<b>Frage</b>" }] },
        ],
        verdicts: [verdict("faq", 0, false, "judge")],
        cases: new Map([
          [
            "faq",
            TestCaseSchema.parse({
              id: "faq",
              kind: "qa",
              input: "Frage",
              expected: { answer: "Montag & Dienstag" },
            }),
          ],
        ]),
      }),
    );
    expect(page).not.toContain("<b>Frage</b>");
    expect(page).toContain(
      '<h3><span class="mono">faq</span>: gescheitert, 0 von 1 Iterationen bestanden</h3>\n' +
        '<p class="meta">Frage</p>\n<blockquote>&lt;b&gt;Frage&lt;/b&gt;</blockquote>\n' +
        '<p class="meta">Soll</p>\n<blockquote>Montag &amp; Dienstag</blockquote>\n' +
        '<p class="meta">Ist, Iteration 0</p>\n<blockquote>Antwort</blockquote>',
    );
  });

  it("shows the run metadata", () => {
    for (const value of [
      "2.4.1",
      "gpt-beispiel",
      "owasp-2025.1",
      "beispiel (Version 3)",
      "qwen2.5:7b, Prompt v1",
      "plan-beispiel",
      "10.10.2026, 12:00:00 UTC",
    ]) {
      expect(html).toContain(value);
    }
  });

  it("shows confirmed findings, categories, judge reasoning and calibration", () => {
    expect(html).toContain("Der Bot folgt Anweisungen aus dem Nutzertext.");
    expect(html).toContain("LLM01");
    expect(html).toContain("preise");
    expect(html).toContain("Die Antwort nennt den falschen Preis.");
    expect(html).toContain("Cohen&#39;s Kappa 0,82");
  });

  it("draws the trend as an inline chart with a table of the values", () => {
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain("<polyline");
    expect(html).toContain("09.10.2026");
    expect(html).toContain("100,0 %");
  });

  it("explains a trend of a single run instead of drawing a line", () => {
    const single = renderer.render(model({ history: [] }), wirkmittelTheme);
    expect(single).toContain("Der Trend entsteht ab zwei Läufen");
    expect(single).not.toContain("<polyline");
  });

  it("says that hypotheses stay out until a human confirms them", () => {
    const none = renderer.render(model({ findings: [] }), wirkmittelTheme);
    expect(none).toContain("Keine bestätigten Befunde");
  });

  it("writes no dashes and no exclamation marks of its own", () => {
    const plain = renderer.render(
      buildReportModel({ run, iterations: [iteration("faq", 0)], verdicts: [], cases }),
      wirkmittelTheme,
    );
    expect(plain).not.toMatch(/[–—]/);
    expect(plain.replace(/<!doctype html>/, "")).not.toMatch(/!(?!important)/);
  });

  it("is deterministic", () => {
    expect(renderer.render(model(), wirkmittelTheme)).toBe(html);
  });

  it("swaps colours and fonts with the theme", () => {
    const neutral = renderer.render(model(), neutralTheme);
    expect(neutral).not.toContain("#131122");
    expect(neutral).not.toContain("data:font/woff2");
    expect(neutral).toContain("#ffffff");
    expect(neutral).toContain("color-scheme: light");
  });

  it("uses the Wirkmittel theme when the theme brings no html style", () => {
    const fallback = renderer.render(model(), { name: "default", title: "Abnahme" });
    expect(fallback).toContain("#131122");
    expect(fallback).toContain("<h1>Abnahme</h1>");
  });
});

describe("iterations without a judge verdict (issue #83)", () => {
  const unjudged = model({
    iterations: [...iterations, iteration("faq", 2)],
    verdicts: [...verdicts, verdict("faq", 2, true, "check")],
    judgeFailures: [
      {
        runId: run.id,
        caseId: "faq",
        index: 2,
        kind: "refusal",
        reason: "leere Antwort <leer>",
        judgeModel: "richter",
        promptVersion: "v2",
      },
    ],
  });

  it("says in the key statement that the judge refused and the iteration does not count", () => {
    const text = keyStatement(unjudged).join(" ");
    expect(text).toContain(
      "Ohne Judge-Urteil: 1 (Judge lehnt ab: 1, Judge-Fehler: 0), 1 nicht in der Quote.",
    );
    expect(text).toContain("1 von 4 bewerteten Iterationen bestanden");
  });

  it("lists them with kind, escaped reason and how they count", () => {
    const html = new HtmlRenderer().render(unjudged, wirkmittelTheme);
    expect(html).toContain(">Ohne Judge-Urteil<");
    expect(html).toContain("Judge lehnt ab");
    expect(html).toContain("leere Antwort &lt;leer&gt;");
    expect(html).toContain("nicht in der Quote");
  });

  it("shows nothing about it without failures", () => {
    const html = new HtmlRenderer().render(model(), wirkmittelTheme);
    expect(html).not.toContain(">Ohne Judge-Urteil<");
    expect(keyStatement(model()).join(" ")).not.toContain("Ohne Judge-Urteil");
  });
});

describe("iterations the target refused with 429 (issue #96)", () => {
  it("says in the key statement that they were not run and do not count", () => {
    const refused = model({
      iterations: [
        ...iterations,
        { ...iteration("faq", 2), response: null, status: 429, error: "http 429" },
      ],
      verdicts: [...verdicts, verdict("faq", 2, false, "check")],
    });
    expect(keyStatement(refused).join(" ")).toContain(
      "1 Iteration nicht ausgeführt: das Zielsystem lehnte sie mit HTTP 429 ab. Sie zählt nicht in die Quote.",
    );
    expect(keyStatement(model()).join(" ")).not.toContain("nicht ausgeführt");
  });
});
