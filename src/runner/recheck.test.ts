import { describe, expect, it } from "vitest";

import { makeCase } from "../../tests/helpers/cases.js";
import { MemoryResultStore } from "../../tests/helpers/memory-store.js";
import { createDefaultChecks } from "../checks/run-checks.js";
import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import type { TestCase } from "../domain/test-case.js";
import type { Verdict } from "../domain/verdict.js";
import { recheckRun } from "./recheck.js";

const SOURCE = "20261101-100000-aaaa";
const NEW = "20261112-090000-bbbb";
const now = (): Date => new Date("2026-11-12T09:00:00.000Z");

const sourceRun: Run = {
  id: SOURCE,
  planId: "plan-beispiel",
  target: "beispiel",
  startedAt: "2026-11-01T10:00:00.000Z",
  finishedAt: "2026-11-01T10:05:00.000Z",
  goldsets: [{ id: "beispiel", version: "1" }],
  status: "completed",
  usage: {
    calls: 4,
    targetTokens: { input: 40, output: 80 },
    judgeTokens: { input: 0, output: 0 },
  },
};

function iteration(caseId: string, index: number, extra: Partial<Iteration> = {}): Iteration {
  return {
    runId: SOURCE,
    caseId,
    index,
    seed: index,
    request: [{ role: "user", content: "Frage" }],
    response: "Montag bis Freitag von 9 bis 17 Uhr.",
    latencyMs: 20,
    ...extra,
  };
}

function verdict(
  caseId: string,
  index: number,
  name: string,
  pass: boolean,
  extra: Partial<Verdict> = {},
): Verdict {
  return {
    runId: SOURCE,
    caseId,
    index,
    source: "check",
    pass,
    criteria: [{ name, pass, reason: "alt" }],
    reasoning: `${name}: alt`,
    ...extra,
  };
}

function judgeVerdict(caseId: string, index: number, pass: boolean): Verdict {
  return verdict(caseId, index, "Korrektheit", pass, {
    source: "judge",
    judgeModel: "judge-modell",
    promptVersion: "v1",
  });
}

async function seed(
  iterations: readonly Iteration[],
  verdicts: readonly Verdict[],
  run: Run = sourceRun,
): Promise<MemoryResultStore> {
  const store = new MemoryResultStore();
  await store.createRun(run);
  for (const entry of iterations) await store.appendIteration(entry);
  for (const entry of verdicts) await store.appendVerdict(entry);
  return store;
}

function casesOf(...cases: TestCase[]): Map<string, TestCase> {
  return new Map(cases.map((testCase) => [testCase.id, testCase]));
}

const checks = createDefaultChecks({});
const faq = makeCase({ id: "faq", expected: { mustContain: ["Montag", "17"] } });

function names(verdicts: readonly Verdict[], caseId: string, index: number): string[] {
  return verdicts
    .filter((entry) => entry.caseId === caseId && entry.index === index)
    .flatMap((entry) =>
      entry.criteria.map((criterion) => `${criterion.name}:${String(entry.pass)}`),
    );
}

describe("recheckRun (issue #121)", () => {
  it("writes a new run with the answers of the source and leaves the source untouched", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("faq", 1)],
      [verdict("faq", 0, "mustContain", true), verdict("faq", 1, "mustContain", true)],
    );
    const summary = await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(faq),
      goldsetVersions: new Map([["beispiel", "2"]]),
      checks,
      now,
      runId: NEW,
    });

    expect(summary).toMatchObject({ runId: NEW, sourceRunId: SOURCE, iterations: 2, passed: 2 });
    const run = await store.readRun(NEW);
    expect(run).toMatchObject({
      planId: "plan-beispiel",
      target: "beispiel",
      startedAt: "2026-11-12T09:00:00.000Z",
      finishedAt: "2026-11-12T09:00:00.000Z",
      status: "completed",
      goldsets: [{ id: "beispiel", version: "2" }],
      usage: { calls: 0, targetTokens: { input: 0, output: 0 } },
    });
    expect(run.warnings).toEqual([
      `Nachgerechnet aus Lauf ${SOURCE} vom 2026-11-01: Die Antworten stammen aus diesem Lauf, die Checks sind mit den Goldsets von heute neu gerechnet, Judge-Urteile sind unverändert übernommen.`,
    ]);
    const copied = await store.readIterations(NEW);
    expect(copied.map((entry) => [entry.caseId, entry.index, entry.response])).toEqual([
      ["faq", 0, "Montag bis Freitag von 9 bis 17 Uhr."],
      ["faq", 1, "Montag bis Freitag von 9 bis 17 Uhr."],
    ]);
    expect(await store.readRun(SOURCE)).toEqual(sourceRun);
    expect(await store.readVerdicts(SOURCE)).toHaveLength(2);
    expect((await store.readIterations(SOURCE)).every((entry) => entry.runId === SOURCE)).toBe(
      true,
    );
  });

  it("rates the stored answers with the cases of today", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("faq", 1, { response: "Montag bis Samstag bis 17 Uhr." })],
      [verdict("faq", 0, "mustContain", true), verdict("faq", 1, "mustContain", true)],
    );
    const stricter = makeCase({
      id: "faq",
      expected: { mustContain: ["Montag", "17"], mustNotContain: ["Samstag"] },
    });
    const summary = await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(stricter),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    const verdicts = await store.readVerdicts(NEW);
    expect(names(verdicts, "faq", 0)).toEqual([
      "empty:true",
      "mustContain:true",
      "mustNotContain:true",
      "leak:true",
    ]);
    expect(names(verdicts, "faq", 1)).toContain("mustNotContain:false");
    expect(verdicts.every((entry) => entry.runId === NEW)).toBe(true);
    expect(verdicts.some((entry) => entry.criteria[0]?.reason === "alt")).toBe(false);
    expect(summary).toMatchObject({ passed: 1, nowFailing: 1, nowPassing: 0, rechecked: 2 });
  });

  it("keeps judge verdicts, judge failures and the binding of the source", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("faq", 1)],
      [
        verdict("faq", 0, "mustContain", true),
        judgeVerdict("faq", 0, false),
        verdict("faq", 1, "mustContain", true),
      ],
      { ...sourceRun, judge: { model: "judge-modell", promptVersion: "v1" } },
    );
    await store.appendJudgeFailure({
      runId: SOURCE,
      caseId: "faq",
      index: 1,
      kind: "error",
      reason: "Zeitüberschreitung",
      judgeModel: "judge-modell",
      promptVersion: "v1",
    });
    await store.writeRunBinding(SOURCE, {
      target: "beispiel",
      createdAt: "2026-11-01T09:59:00.000Z",
      entries: [],
    });
    const summary = await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(faq),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    const verdicts = await store.readVerdicts(NEW);
    expect(verdicts.filter((entry) => entry.source === "judge")).toEqual([
      { ...judgeVerdict("faq", 0, false), runId: NEW },
    ]);
    expect(await store.readJudgeFailures(NEW)).toMatchObject([
      { runId: NEW, caseId: "faq", index: 1, kind: "error" },
    ]);
    expect(await store.readRunBinding(NEW)).toMatchObject({ target: "beispiel" });
    expect((await store.readRun(NEW)).judge).toEqual({
      model: "judge-modell",
      promptVersion: "v1",
    });
    expect(summary.passed).toBe(1);
  });

  it("counts iterations that pass the checks now and have no judge verdict", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("faq", 1)],
      [
        verdict("faq", 0, "mustContain", false),
        verdict("faq", 1, "mustContain", true),
        judgeVerdict("faq", 1, true),
      ],
      { ...sourceRun, judge: { model: "judge-modell", promptVersion: "v1" } },
    );
    const withReference = makeCase({
      id: "faq",
      expected: { mustContain: ["Montag"], answer: "Montag bis Freitag von 9 bis 17 Uhr." },
    });
    const summary = await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(withReference),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    expect(summary).toMatchObject({ nowPassing: 1, nowFailing: 0, withoutJudge: 1 });
  });

  it("keeps the verdicts about the call itself: failed calls and failed captures", async () => {
    const store = await seed(
      [iteration("faq", 0, { response: null, error: "timeout" }), iteration("faq", 1)],
      [
        verdict("faq", 0, "response", false),
        verdict("faq", 1, "mustContain", true),
        verdict("faq", 1, "capture", false),
      ],
    );
    await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(faq),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    const verdicts = await store.readVerdicts(NEW);
    expect(names(verdicts, "faq", 0)).toEqual(["response:false"]);
    expect(verdicts.find((entry) => entry.index === 0)?.criteria[0]?.reason).toBe("alt");
    expect(names(verdicts, "faq", 1)).toEqual([
      "empty:true",
      "mustContain:true",
      "leak:true",
      "capture:false",
    ]);
  });

  it("applies the expected status of today to calls without an answer", async () => {
    const refused = iteration("gesperrt", 0, { response: null, status: 403 });
    const failed = iteration("offen", 0, { response: null, status: 403, error: "http 403" });
    const store = await seed(
      [refused, failed],
      [verdict("gesperrt", 0, "status", true), verdict("offen", 0, "response", false)],
    );
    await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(
        makeCase({ id: "gesperrt", kind: "probe" }),
        makeCase({ id: "offen", kind: "probe", expected: { status: 403 } }),
      ),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    const verdicts = await store.readVerdicts(NEW);
    expect(names(verdicts, "gesperrt", 0)).toEqual(["response:false"]);
    expect(verdicts.find((entry) => entry.caseId === "gesperrt")?.criteria[0]?.reason).toBe(
      "Aufruf ohne Antwort, HTTP 403",
    );
    expect(names(verdicts, "offen", 0)).toEqual(["status:true"]);
  });

  it("carries the verdicts of cases the goldsets no longer have and names them", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("gestrichen", 0)],
      [verdict("faq", 0, "mustContain", true), verdict("gestrichen", 0, "mustContain", false)],
    );
    const summary = await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(faq),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    expect(summary).toMatchObject({ unknownCases: ["gestrichen"], rechecked: 1, iterations: 2 });
    const carried = (await store.readVerdicts(NEW)).filter(
      (entry) => entry.caseId === "gestrichen",
    );
    expect(carried).toEqual([{ ...verdict("gestrichen", 0, "mustContain", false), runId: NEW }]);
    expect((await store.readRun(NEW)).warnings?.at(-1)).toBe(
      "Ohne Fall im Goldset, Urteile unverändert aus dem Quelllauf: gestrichen",
    );
  });

  it("takes the draft status from the cases of today", async () => {
    const store = await seed(
      [iteration("faq", 0), iteration("neu", 0), iteration("gestrichen", 0)],
      [],
      { ...sourceRun, draftCases: ["faq", "gestrichen"] },
    );
    await recheckRun({
      store,
      sourceRunId: SOURCE,
      cases: casesOf(
        makeCase({ id: "faq", status: "approved", expected: { mustContain: ["Montag"] } }),
        makeCase({ id: "neu", status: "draft" }),
      ),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    expect((await store.readRun(NEW)).draftCases).toEqual(["neu", "gestrichen"]);
  });

  it("keeps an aborted run aborted and refuses a run that has not ended", async () => {
    const aborted = await seed([iteration("faq", 0)], [], {
      ...sourceRun,
      status: "aborted",
      abortReason: "Budget von 1 Aufrufen erreicht",
    });
    await recheckRun({
      store: aborted,
      sourceRunId: SOURCE,
      cases: casesOf(faq),
      goldsetVersions: new Map(),
      checks,
      now,
      runId: NEW,
    });
    expect(await aborted.readRun(NEW)).toMatchObject({
      status: "aborted",
      abortReason: "Budget von 1 Aufrufen erreicht",
    });

    const { finishedAt: _finishedAt, status: _status, usage: _usage, ...running } = sourceRun;
    const unfinished = await seed([iteration("faq", 0)], [], running);
    await expect(
      recheckRun({
        store: unfinished,
        sourceRunId: SOURCE,
        cases: casesOf(faq),
        goldsetVersions: new Map(),
        checks,
        now,
        runId: NEW,
      }),
    ).rejects.toThrow(/nicht beendet/);
    expect(await unfinished.listRuns()).toEqual([SOURCE]);
  });
});
