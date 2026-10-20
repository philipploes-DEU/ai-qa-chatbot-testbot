import { describe, expect, it } from "vitest";

import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import { TestCaseSchema } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import type { Finding } from "../domain/finding.js";
import type { JudgeFailure } from "../domain/judge-failure.js";
import { buildReportModel, trendPoint, UNCATEGORIZED } from "./report-model.js";

const run: Run = {
  id: "20261010-120000-ab12",
  planId: "plan-beispiel",
  target: "beispiel-dummy",
  startedAt: "2026-10-10T12:00:00.000Z",
  finishedAt: "2026-10-10T12:00:03.000Z",
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
    latencyMs: 10 + index,
    ...(error === undefined ? {} : { error }),
  };
}

function verdict(
  caseId: string,
  index: number,
  name: string,
  pass: boolean,
  reason = "x",
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
  iteration("faq", 0),
  iteration("faq", 1),
  iteration("faq", 2),
  iteration("probe", 0),
  iteration("probe", 1),
  iteration("probe", 2),
  iteration("kaputt", 0, "timeout"),
  iteration("judge-only", 0),
];

const verdicts: Verdict[] = [
  verdict("faq", 0, "mustContain", true),
  verdict("faq", 0, "leak", true),
  verdict("faq", 1, "mustContain", true),
  verdict("faq", 1, "leak", true),
  verdict("faq", 2, "mustContain", false, 'fehlt: "17"'),
  verdict("faq", 2, "leak", true),
  verdict("probe", 0, "refusal", false, "keine Verweigerung erkannt, der Fall erwartet eine"),
  verdict("probe", 1, "refusal", false, "keine Verweigerung erkannt, der Fall erwartet eine"),
  verdict("probe", 2, "refusal", false, "keine Verweigerung erkannt, der Fall erwartet eine"),
  verdict("kaputt", 0, "response", false, "keine Antwort innerhalb von 1000 ms"),
];

const cases = new Map([
  ["faq", TestCaseSchema.parse({ id: "faq", kind: "qa", input: "Frage", severity: "medium" })],
  [
    "probe",
    TestCaseSchema.parse({
      id: "probe",
      kind: "probe",
      input: "Frage",
      severity: "critical",
      source: "LLM01",
    }),
  ],
]);

describe("buildReportModel", () => {
  const model = buildReportModel({ run, iterations, verdicts, cases });

  it("keeps the run and lists cases in order of first appearance", () => {
    expect(model.run.id).toBe(run.id);
    expect(model.cases.map((entry) => entry.caseId)).toEqual([
      "faq",
      "probe",
      "kaputt",
      "judge-only",
    ]);
  });

  it("summarises each case with pass rate, interval and flakiness", () => {
    const faq = model.cases[0];
    expect(faq?.iterations).toBe(3);
    expect(faq?.summary?.passes).toBe(2);
    expect(faq?.summary?.passRate).toBeCloseTo(2 / 3, 10);
    expect(faq?.summary?.flaky).toBe(true);
    expect(faq?.summary?.interval.low).toBeGreaterThan(0);
    expect(faq?.kind).toBe("qa");
    expect(faq?.severity).toBe("medium");
  });

  it("carries case metadata from the goldset when available", () => {
    const probe = model.cases[1];
    expect(probe?.severity).toBe("critical");
    expect(probe?.source).toBe("LLM01");
    expect(model.cases[2]?.severity).toBeUndefined();
  });

  it("lists failed iterations with the failing checks and reasons", () => {
    const faq = model.cases[0];
    expect(faq?.failures).toEqual([
      { index: 2, checks: [{ name: "mustContain", reason: 'fehlt: "17"' }] },
    ]);
    expect(model.cases[1]?.failures).toHaveLength(3);
  });

  it("counts errors and average latency per case", () => {
    expect(model.cases[2]?.errors).toBe(1);
    expect(model.cases[0]?.averageLatencyMs).toBeCloseTo(11, 10);
  });

  it("marks cases without verdicts", () => {
    const judgeOnly = model.cases[3];
    expect(judgeOnly?.summary).toBeNull();
    expect(judgeOnly?.iterations).toBe(1);
    expect(model.totals.casesWithoutVerdict).toBe(1);
  });

  it("aggregates totals over all iterations with verdicts", () => {
    expect(model.totals.cases).toBe(4);
    expect(model.totals.iterations).toBe(8);
    expect(model.totals.judgedIterations).toBe(7);
    expect(model.totals.passedIterations).toBe(2);
    expect(model.totals.passRate).toBeCloseTo(2 / 7, 10);
    expect(model.totals.interval?.high).toBeLessThan(1);
    expect(model.totals.flakyCases).toBe(1);
    expect(model.totals.errors).toBe(1);
  });

  it("estimates pass-all-k with k as the smallest iteration count among judged cases", () => {
    expect(model.totals.passAllK).toEqual({ k: 1, value: (2 / 3 + 0 + 0) / 3 });
  });

  it("returns null statistics when no iteration has a verdict", () => {
    const empty = buildReportModel({
      run,
      iterations: [iteration("judge-only", 0)],
      verdicts: [],
      cases,
    });
    expect(empty.totals.passRate).toBeNull();
    expect(empty.totals.interval).toBeNull();
    expect(empty.totals.passAllK).toBeNull();
  });
});

describe("categories", () => {
  const model = buildReportModel({ run, iterations, verdicts, cases });

  it("groups judged iterations by the case source, failure rate first", () => {
    expect(model.categories.map((entry) => entry.category)).toEqual(["LLM01", UNCATEGORIZED]);
    const llm01 = model.categories[0];
    expect(llm01?.cases).toBe(1);
    expect(llm01?.judgedIterations).toBe(3);
    expect(llm01?.failedIterations).toBe(3);
    expect(llm01?.failureRate).toBe(1);
    expect(llm01?.interval?.low).toBeGreaterThan(0);
  });

  it("puts cases without source or tag into one bucket and counts cases without verdict", () => {
    const rest = model.categories[1];
    expect(rest?.cases).toBe(3);
    expect(rest?.judgedIterations).toBe(4);
    expect(rest?.failedIterations).toBe(2);
    expect(rest?.failureRate).toBe(0.5);
  });

  it("falls back to the first tag when a case has no source", () => {
    const tagged = new Map([
      ["faq", TestCaseSchema.parse({ id: "faq", kind: "qa", input: "Frage", tags: ["preise"] })],
    ]);
    const withTags = buildReportModel({ run, iterations, verdicts, cases: tagged });
    expect(withTags.categories.map((entry) => entry.category)).toContain("preise");
  });
});

describe("drafts", () => {
  const withDraft = buildReportModel({
    run: { ...run, draftCases: ["probe"] },
    iterations,
    verdicts,
    cases,
  });

  it("marks draft cases and keeps them out of totals, categories and samples", () => {
    expect(withDraft.cases.find((entry) => entry.caseId === "probe")?.draft).toBe(true);
    expect(withDraft.cases.find((entry) => entry.caseId === "faq")?.draft).toBe(false);
    expect(withDraft.totals.draftCases).toBe(1);
    expect(withDraft.totals.judgedIterations).toBe(4);
    expect(withDraft.totals.passedIterations).toBe(2);
    expect(withDraft.categories.map((entry) => entry.category)).not.toContain("LLM01");
    expect(withDraft.samples.map((sample) => sample.caseId)).not.toContain("probe");
  });

  it("keeps drafts out of the trend point", () => {
    const point = trendPoint({ ...run, draftCases: ["probe"] }, verdicts);
    expect(point.judgedIterations).toBe(4);
  });

  it("counts no drafts for a run without draftCases", () => {
    expect(buildReportModel({ run, iterations, verdicts, cases }).totals.draftCases).toBe(0);
  });
});

describe("trend", () => {
  it("adds the current run after earlier runs, ordered by start", () => {
    const earlier = trendPoint(
      { ...run, id: "20261009-120000-aa00", startedAt: "2026-10-09T12:00:00.000Z" },
      [verdict("faq", 0, "mustContain", true), verdict("faq", 1, "mustContain", false)],
    );
    const model = buildReportModel({ run, iterations, verdicts, cases, history: [earlier] });
    expect(model.trend.map((point) => point.runId)).toEqual([earlier.runId, run.id]);
    expect(model.trend[0]?.passRate).toBe(0.5);
    expect(model.trend[1]?.passRate).toBeCloseTo(2 / 7, 10);
    expect(model.trend[1]?.current).toBe(true);
    expect(model.trend[0]?.current).toBe(false);
  });

  it("ignores a history entry for the current run", () => {
    const self = trendPoint(run, verdicts);
    const model = buildReportModel({ run, iterations, verdicts, cases, history: [self] });
    expect(model.trend).toHaveLength(1);
  });

  it("has a null pass rate for a run without verdicts", () => {
    expect(trendPoint(run, []).passRate).toBeNull();
    expect(trendPoint(run, []).interval).toBeNull();
  });
});

describe("findings", () => {
  const finding = (id: string, status: Finding["status"]): Finding => ({
    id,
    runId: run.id,
    caseIds: ["probe"],
    category: "LLM01",
    severity: "high",
    hypothesis: "Der Bot folgt eingeschleusten Anweisungen.",
    evidenceRefs: [],
    tags: [],
    suggestedCases: [],
    status,
  });

  it("keeps only findings a human confirmed", () => {
    const model = buildReportModel({
      run,
      iterations,
      verdicts,
      cases,
      findings: [
        finding("f1", "hypothesis"),
        finding("f2", "confirmed"),
        finding("f3", "rejected"),
      ],
    });
    expect(model.findings.map((entry) => entry.id)).toEqual(["f2"]);
  });

  it("is empty without findings", () => {
    expect(buildReportModel({ run, iterations, verdicts }).findings).toEqual([]);
  });
});

describe("iterations without a judge verdict (issue #83)", () => {
  function judgeVerdict(caseId: string, index: number, pass: boolean): Verdict {
    return {
      runId: run.id,
      caseId,
      index,
      source: "judge",
      pass,
      criteria: [{ name: "Korrektheit", pass, reason: "x" }],
      reasoning: "Korrektheit: x",
      judgeModel: "richter",
      promptVersion: "v2",
    };
  }

  function failure(
    caseId: string,
    index: number,
    kind: JudgeFailure["kind"],
    reason = kind === "refusal" ? "leere Antwort" : "kein JSON",
  ): JudgeFailure {
    return {
      runId: run.id,
      caseId,
      index,
      kind,
      reason,
      judgeModel: "richter",
      promptVersion: "v2",
    };
  }

  const judged: Iteration[] = [0, 1, 2, 3].map((index) => iteration("rated", index));
  judged.push(iteration("claim", 0));
  const judgedVerdicts: Verdict[] = [
    verdict("rated", 0, "leak", true),
    judgeVerdict("rated", 0, true),
    verdict("rated", 1, "leak", true),
    verdict("rated", 2, "leak", true),
    verdict("rated", 3, "leak", true),
    judgeVerdict("rated", 3, true),
    verdict("claim", 0, "mustNotClaim", true, "kommt vor, der Judge entscheidet"),
  ];
  const claimFailure: JudgeFailure = {
    ...failure("claim", 0, "error"),
    fallback: { name: "mustNotClaim", reason: "kommt vor, ohne Judge-Urteil gewertet" },
  };
  const failures: JudgeFailure[] = [
    failure("rated", 1, "refusal"),
    failure("rated", 2, "error"),
    // Judged again later with aiqa judge --run: the verdict replaces the failure.
    failure("rated", 3, "error"),
    claimFailure,
  ];
  const model = buildReportModel({
    run,
    iterations: judged,
    verdicts: judgedVerdicts,
    judgeFailures: failures,
  });

  it("keeps iterations without a judge verdict out of the pass rate", () => {
    expect(model.totals.judgedIterations).toBe(3);
    expect(model.totals.passedIterations).toBe(2);
    expect(model.cases.find((entry) => entry.caseId === "rated")?.summary?.n).toBe(2);
  });

  it("counts refusals apart from judge errors and names what still counts as failed", () => {
    expect(model.totals.withoutJudgeVerdict).toEqual({ refused: 1, errors: 2, countedAsFailed: 1 });
    expect(
      model.judgeFailures.map(
        (entry) =>
          `${entry.caseId}/${String(entry.index)}:${entry.kind}:${String(entry.countedAsFailed)}`,
      ),
    ).toEqual(["rated/1:refusal:false", "rated/2:error:false", "claim/0:error:true"]);
    expect(model.judgeFailures[0]?.reason).toBe("leere Antwort");
  });

  it("fails an iteration with a fallback criterion and shows it as a failure", () => {
    const claim = model.cases.find((entry) => entry.caseId === "claim");
    expect(claim?.summary?.passes).toBe(0);
    expect(claim?.failures).toEqual([
      {
        index: 0,
        checks: [{ name: "mustNotClaim", reason: "kommt vor, ohne Judge-Urteil gewertet" }],
      },
    ]);
  });

  it("lets a later judge verdict replace the failure and its fallback, pass or fail", () => {
    const later = buildReportModel({
      run,
      iterations: judged,
      verdicts: [
        ...judgedVerdicts,
        judgeVerdict("claim", 0, true),
        judgeVerdict("rated", 1, false),
      ],
      judgeFailures: failures,
    });
    expect(later.judgeFailures.map((entry) => `${entry.caseId}/${String(entry.index)}`)).toEqual([
      "rated/2",
    ]);
    expect(later.cases.find((entry) => entry.caseId === "claim")?.summary?.passes).toBe(1);
    expect(later.totals.judgedIterations).toBe(4);
    expect(later.totals.passedIterations).toBe(3);
  });

  it("leaves failures of draft cases out", () => {
    const drafted = buildReportModel({
      run: { ...run, draftCases: ["rated"] },
      iterations: judged,
      verdicts: judgedVerdicts,
      judgeFailures: failures,
    });
    expect(drafted.judgeFailures.map((entry) => entry.caseId)).toEqual(["claim"]);
    expect(drafted.totals.withoutJudgeVerdict).toEqual({
      refused: 0,
      errors: 1,
      countedAsFailed: 1,
    });
  });

  it("keeps the last failure when an iteration failed twice, in order of the run", () => {
    const twice = buildReportModel({
      run,
      iterations: judged,
      verdicts: judgedVerdicts,
      judgeFailures: [
        failure("rated", 1, "error"),
        failure("rated", 2, "error"),
        failure("rated", 1, "refusal"),
      ],
    });
    expect(twice.judgeFailures.map((entry) => `${String(entry.index)}:${entry.kind}`)).toEqual([
      "1:refusal",
      "2:error",
    ]);
  });

  it("has zero counts without failures", () => {
    const plain = buildReportModel({ run, iterations, verdicts });
    expect(plain.totals.withoutJudgeVerdict).toEqual({ refused: 0, errors: 0, countedAsFailed: 0 });
    expect(plain.judgeFailures).toEqual([]);
  });

  it("keeps them out of the trend point as well", () => {
    const point = trendPoint(run, judgedVerdicts, false, { judgeFailures: failures });
    expect(point.judgedIterations).toBe(3);
    expect(point.passedIterations).toBe(2);
  });
});

describe("iterations the target refused with 429 (issue #96)", () => {
  const refused = (caseId: string, index: number): Iteration => ({
    ...iteration(caseId, index, 'http 429: {"error":"Tageslimit erreicht"}'),
    status: 429,
  });
  const limitIterations: Iteration[] = [
    iteration("faq", 0),
    iteration("faq", 1),
    refused("faq", 2),
    refused("probe", 0),
  ];
  const limitVerdicts: Verdict[] = [
    verdict("faq", 0, "leak", true),
    verdict("faq", 1, "leak", false),
    verdict("faq", 2, "response", false, "Aufruf fehlgeschlagen: http 429"),
    verdict("probe", 0, "response", false, "Aufruf fehlgeschlagen: http 429"),
  ];
  const model = buildReportModel({ run, iterations: limitIterations, verdicts: limitVerdicts });

  it("keeps them out of the pass rate and out of the errors, counted on their own", () => {
    expect(model.totals.judgedIterations).toBe(2);
    expect(model.totals.passedIterations).toBe(1);
    expect(model.totals.notExecuted).toBe(2);
    expect(model.totals.errors).toBe(0);
    const probe = model.cases.find((entry) => entry.caseId === "probe");
    expect(probe?.summary).toBeNull();
    expect(probe?.notExecuted).toBe(1);
    expect(probe?.failures).toEqual([]);
    // Refused only, the case was never tried: not a case without applicable checks.
    expect(model.totals.casesWithoutVerdict).toBe(0);
  });

  it("leaves a 429 the case expected in the rate", () => {
    const wanted: Iteration = { ...iteration("probe", 0), response: null, status: 429 };
    const expected = buildReportModel({
      run,
      iterations: [wanted],
      verdicts: [verdict("probe", 0, "status", true)],
    });
    expect(expected.totals.notExecuted).toBe(0);
    expect(expected.totals.judgedIterations).toBe(1);
  });

  it("keeps them out of the trend point when the iterations are given", () => {
    const point = trendPoint(run, limitVerdicts, false, { iterations: limitIterations });
    expect(point.judgedIterations).toBe(2);
    expect(point.passedIterations).toBe(1);
  });
});

describe("placeholders bound from data sources (issue #93)", () => {
  const binding = {
    createdAt: "2026-10-20T08:00:00.000Z",
    target: "beispiel-dummy",
    entries: [
      {
        placeholder: "aussteller_1",
        query: "halle3",
        queryVersion: "2",
        source: "index",
        status: "bound" as const,
        value: "Rasenprofi AG",
        previous: "Gartenhelden GmbH",
      },
      { placeholder: "stand_1", status: "bound" as const, value: "B12", previous: "B12" },
      {
        placeholder: "telefon_1",
        query: "halle3",
        status: "unresolved" as const,
        reason: "Feld telefon fehlt in Zeile 0 der Abfrage halle3",
      },
    ],
  };
  const model = buildReportModel({
    run: { ...run, unresolvedCases: [{ caseId: "anruf", placeholders: ["telefon_1"] }] },
    iterations,
    verdicts,
    binding,
  });

  it("lists the placeholders whose value changed, without the values (ADR 0022)", () => {
    expect(model.bindingChanges).toEqual([
      { placeholder: "aussteller_1", query: "halle3", queryVersion: "2" },
    ]);
    expect(JSON.stringify(model)).not.toContain("Rasenprofi");
  });

  it("counts cases not sent and names why their placeholders stayed empty", () => {
    expect(model.totals.unresolvedCases).toBe(1);
    expect(model.unresolvedCases).toEqual([
      {
        caseId: "anruf",
        placeholders: ["telefon_1"],
        reasons: ["telefon_1: Feld telefon fehlt in Zeile 0 der Abfrage halle3"],
      },
    ]);
  });

  it("has nothing of it without a binding", () => {
    const plain = buildReportModel({ run, iterations, verdicts });
    expect(plain.bindingChanges).toEqual([]);
    expect(plain.unresolvedCases).toEqual([]);
    expect(plain.totals.unresolvedCases).toBe(0);
  });
});
