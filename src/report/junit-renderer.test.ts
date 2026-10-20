import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { escapeXml, JUnitRenderer } from "./junit-renderer.js";
import { buildReportModel } from "./report-model.js";

const run: Run = {
  id: "20261011-170000-ab12",
  planId: "plan",
  target: "kundenbot",
  startedAt: "2026-10-11T17:00:00.000Z",
  finishedAt: "2026-10-11T17:00:04.000Z",
  goldsets: [{ id: "g", version: "1" }],
  draftCases: ["entwurf"],
};

function iteration(caseId: string, index: number, response: string | null = "x"): Iteration {
  return {
    runId: run.id,
    caseId,
    index,
    seed: index,
    request: [{ role: "user", content: "?" }],
    response,
    latencyMs: 250,
    ...(response === null ? { error: "timeout" } : {}),
  };
}

function verdict(caseId: string, index: number, pass: boolean, reason = "ok"): Verdict {
  return {
    runId: run.id,
    caseId,
    index,
    source: "check",
    pass,
    criteria: [{ name: "mustContain", pass, reason }],
    reasoning: reason,
  };
}

const model = buildReportModel({
  run,
  iterations: [
    iteration("faq", 0),
    iteration("faq", 1),
    iteration("leck", 0),
    iteration("leck", 1),
    iteration("entwurf", 0),
    iteration("ohne", 0),
  ],
  verdicts: [
    verdict("faq", 0, true),
    verdict("faq", 1, true),
    verdict("leck", 0, false, 'fehlt: "<Marker> & \u0007Co"'),
    verdict("leck", 1, true),
    verdict("entwurf", 0, false),
  ],
  cases: new Map([
    ["leck", TestCaseSchema.parse({ id: "leck", kind: "probe", input: "?", source: "LLM07" })],
  ]),
});

describe("escapeXml", () => {
  it("escapes markup and drops characters XML 1.0 does not allow", () => {
    expect(escapeXml("<a b=\"c\">'&'</a>\u0007")).toBe(
      "&lt;a b=&quot;c&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
    );
  });
});

describe("JUnitRenderer", () => {
  const renderer = new JUnitRenderer();
  const xml = renderer.render(model);

  it("declares junit as format with the xml extension", () => {
    expect(renderer.format).toBe("junit");
    expect(renderer.fileExtension).toBe("xml");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("writes one suite per run with counts and the run as properties", () => {
    expect(xml).toContain(
      '<testsuite name="kundenbot" id="20261011-170000-ab12" tests="4" failures="1" errors="0" skipped="2" timestamp="2026-10-11T17:00:00.000Z" time="4.000">',
    );
    expect(xml).toContain('<property name="aiqa.passRate" value="0.75"/>');
    expect(xml).toContain('<testsuites name="AI QA" tests="4" failures="1" errors="0" skipped="2"');
  });

  it("passes a case whose iterations all passed", () => {
    expect(xml).toContain('<testcase name="faq" classname="ohne Kategorie" time="0.500"/>');
  });

  it("fails a case with a failed iteration and gives the reasons escaped", () => {
    expect(xml).toContain('<testcase name="leck" classname="LLM07" time="0.500">');
    expect(xml).toContain('<failure message="1 von 2 Iterationen bestanden (50,0 %)" type="aiqa">');
    expect(xml).toContain("Iteration 0: mustContain: fehlt: &quot;&lt;Marker&gt; &amp; Co&quot;");
  });

  it("skips drafts and cases without verdict", () => {
    expect(xml).toContain('<skipped message="Entwurf, zählt nicht in die Quote"/>');
    expect(xml).toContain('<skipped message="ohne Urteil"/>');
  });

  it("is well formed enough for a parser: every opened element is closed", () => {
    const opened = (
      xml.match(/<(testsuites|testsuite|testcase|failure|properties)\b[^/>]*>/g) ?? []
    ).length;
    const closed = (xml.match(/<\/(testsuites|testsuite|testcase|failure|properties)>/g) ?? [])
      .length;
    expect(opened).toBe(closed);
  });
});
