import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FindingSchema } from "../domain/finding.js";
import type { Iteration } from "../domain/iteration.js";
import type { Run } from "../domain/run.js";
import type { Verdict } from "../domain/verdict.js";
import { FileResultStore } from "./file-result-store.js";

const run: Run = {
  id: "20261010-120000-ab12",
  planId: "plan-beispiel",
  target: "beispiel-dummy",
  startedAt: "2026-10-10T12:00:00.000Z",
  goldsets: [{ id: "beispiel", version: "1" }],
};

function iteration(index: number): Iteration {
  return {
    runId: run.id,
    caseId: "faq-001",
    index,
    seed: index,
    request: [{ role: "user", content: "Frage" }],
    response: "Antwort",
    latencyMs: 3,
  };
}

function verdict(index: number, pass: boolean): Verdict {
  return {
    runId: run.id,
    caseId: "faq-001",
    index,
    source: "check",
    pass,
    criteria: [{ name: "mustContain", pass, reason: "x" }],
    reasoning: "mustContain: x",
  };
}

describe("FileResultStore", () => {
  let root: string;
  let store: FileResultStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aiqa-store-"));
    store = new FileResultStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes findings as YAML a human can edit and reads them back", async () => {
    await store.createRun(run);
    expect(await store.readFindings(run.id)).toEqual([]);
    const finding = FindingSchema.parse({
      id: "befund-1",
      runId: run.id,
      caseIds: ["faq-001"],
      category: "LLM09",
      severity: "high",
      hypothesis: "Der Bot nennt veraltete Öffnungszeiten.",
    });
    await store.writeFindings(run.id, [finding]);
    const text = await readFile(path.join(root, run.id, "findings.yaml"), "utf8");
    expect(text).toContain("status: hypothesis");
    await writeFile(
      path.join(root, run.id, "findings.yaml"),
      text.replace("status: hypothesis", "status: confirmed"),
    );
    expect((await store.readFindings(run.id))[0]?.status).toBe("confirmed");
  });

  it("writes run.json and reads it back", async () => {
    await store.createRun(run);
    expect(await store.readRun(run.id)).toEqual(run);
    expect(store.runDir(run.id)).toBe(path.join(root, run.id));
  });

  it("appends iterations as JSONL in order", async () => {
    await store.createRun(run);
    await store.appendIteration(iteration(0));
    await store.appendIteration(iteration(1));
    const iterations = await store.readIterations(run.id);
    expect(iterations.map((entry) => entry.index)).toEqual([0, 1]);
    expect(iterations[0]).toEqual(iteration(0));
  });

  it("appends verdicts as JSONL", async () => {
    await store.createRun(run);
    await store.appendVerdict(verdict(0, true));
    await store.appendVerdict(verdict(1, false));
    const verdicts = await store.readVerdicts(run.id);
    expect(verdicts.map((entry) => entry.pass)).toEqual([true, false]);
  });

  it("returns empty lists for a run without iterations or verdicts", async () => {
    await store.createRun(run);
    expect(await store.readIterations(run.id)).toEqual([]);
    expect(await store.readVerdicts(run.id)).toEqual([]);
    expect(await store.readJudgeFailures(run.id)).toEqual([]);
  });

  it("appends iterations without a judge verdict as JSONL (issue #83)", async () => {
    await store.createRun(run);
    const failure = {
      runId: run.id,
      caseId: "faq-001",
      index: 0,
      kind: "refusal" as const,
      reason: "leere Antwort",
      judgeModel: "richter",
      promptVersion: "v2",
    };
    await store.appendJudgeFailure(failure);
    await store.appendJudgeFailure({ ...failure, index: 1, kind: "error", reason: "kein JSON" });
    const failures = await store.readJudgeFailures(run.id);
    expect(failures.map((entry) => entry.kind)).toEqual(["refusal", "error"]);
    expect(failures[0]).toEqual(failure);
    const text = await readFile(path.join(root, run.id, "judge-failures.jsonl"), "utf8");
    expect(text.trim().split("\n")).toHaveLength(2);
  });

  it("records the finish time", async () => {
    await store.createRun(run);
    await store.finishRun(run.id, "2026-10-10T12:05:00.000Z");
    expect((await store.readRun(run.id)).finishedAt).toBe("2026-10-10T12:05:00.000Z");
  });

  it("lists run ids sorted and ignores stray files", async () => {
    await store.createRun({ ...run, id: "20261010-130000-zz99" });
    await store.createRun(run);
    await writeFile(path.join(root, "notes.txt"), "nicht relevant");
    expect(await store.listRuns()).toEqual(["20261010-120000-ab12", "20261010-130000-zz99"]);
  });

  it("names the run id when it is unknown", async () => {
    await expect(store.readRun("fehlt")).rejects.toThrow("fehlt");
  });

  it("rejects corrupt lines instead of returning half parsed data", async () => {
    await store.createRun(run);
    await writeFile(path.join(root, run.id, "iterations.jsonl"), '{"runId": 1}\n');
    await expect(store.readIterations(run.id)).rejects.toThrow(/iterations\.jsonl/);
  });
});

describe("FileResultStore run outcome", () => {
  it("marks a finished run as completed by default and records an abort", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-store-outcome-"));
    try {
      const store = new FileResultStore(dir);
      await store.createRun(run);
      await store.finishRun(run.id, "2026-10-10T12:05:00.000Z");
      expect((await store.readRun(run.id)).status).toBe("completed");

      await store.createRun({ ...run, id: "abgebrochen" });
      await store.finishRun("abgebrochen", "2026-10-10T12:05:00.000Z", {
        status: "aborted",
        abortReason: "Budget von 2 Aufrufen erreicht",
      });
      const aborted = await store.readRun("abgebrochen");
      expect(aborted.status).toBe("aborted");
      expect(aborted.abortReason).toBe("Budget von 2 Aufrufen erreicht");

      // Calls and tokens of the run go into run.json (issue #87).
      const usage = {
        calls: 3,
        targetTokens: { input: 10, output: 20 },
        judgeTokens: { input: 300, output: 40 },
      };
      await store.createRun({ ...run, id: "mit-aufwand" });
      await store.finishRun("mit-aufwand", "2026-10-10T12:05:00.000Z", {
        status: "completed",
        usage,
      });
      expect((await store.readRun("mit-aufwand")).usage).toEqual(usage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FileResultStore calibrations", () => {
  it("stores and reads a calibration per goldset, judge model and prompt version", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-store-cal-"));
    try {
      const store = new FileResultStore(dir);
      const result = {
        goldsetId: "beispiel",
        goldsetVersion: "1",
        judgeModel: "qwen2.5:7b",
        promptVersion: "v1",
        calibratedAt: "2026-10-11T08:00:00.000Z",
        samples: 2,
        errors: 0,
        agreement: 1,
        kappa: 1,
        minKappa: 0.6,
        released: true,
        results: [
          { caseId: "c1", human: true, judge: true, reasoning: "ok" },
          { caseId: "c1", human: false, judge: false, reasoning: "nein" },
        ],
      };
      await store.writeCalibration(result);
      expect(await store.readCalibration("beispiel", "qwen2.5:7b", "v1")).toEqual(result);
      expect(await store.readCalibration("beispiel", "anderes", "v1")).toBeNull();
      await store.createRun(run);
      expect(await store.listRuns()).toEqual([run.id]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FileResultStore listRuns order", () => {
  it("orders runs by startedAt even when their ids sort the other way", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-store-order-"));
    try {
      const store = new FileResultStore(dir);
      await store.createRun({
        ...run,
        id: "20261011-080000-zzzz",
        startedAt: "2026-10-11T08:00:00.100Z",
      });
      await store.createRun({
        ...run,
        id: "20261011-080000-aaaa",
        startedAt: "2026-10-11T08:00:00.900Z",
      });
      expect(await store.listRuns()).toEqual(["20261011-080000-zzzz", "20261011-080000-aaaa"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FileResultStore bindings (issue #93)", () => {
  const binding = (target: string, createdAt: string, value: string) => ({
    createdAt,
    target,
    entries: [{ placeholder: "aussteller_1", status: "bound" as const, value }],
  });

  it("keeps bindings per target below runs/bindings and returns the newest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-store-bind-"));
    try {
      const store = new FileResultStore(dir);
      expect(await store.latestBinding("messe")).toBeNull();
      await store.writeBinding(binding("messe", "2026-10-19T08:00:00.000Z", "alt"));
      await store.writeBinding(binding("messe", "2026-10-20T08:00:00.000Z", "neu"));
      await store.writeBinding(binding("andere", "2026-10-21T08:00:00.000Z", "fremd"));
      expect((await store.latestBinding("messe"))?.entries[0]?.value).toBe("neu");
      // "a b" and "a_b" share a file name prefix; the target inside the file decides.
      await store.writeBinding(binding("a b", "2026-10-22T08:00:00.000Z", "leer"));
      expect(await store.latestBinding("a_b")).toBeNull();
      // A broken file of another target with the same prefix does not hide the right one.
      await store.writeBinding(binding("a_b", "2026-10-22T07:00:00.000Z", "richtig"));
      await writeFile(path.join(dir, "bindings", "a_b--2026-10-23T08-00-00-000Z.json"), "{");
      expect((await store.latestBinding("a_b"))?.entries[0]?.value).toBe("richtig");
      await store.createRun(run);
      // The bindings directory has no run.json and is no run.
      expect(await store.listRuns()).toEqual([run.id]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores the binding of a run next to its verdicts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-store-runbind-"));
    try {
      const store = new FileResultStore(dir);
      await store.createRun(run);
      expect(await store.readRunBinding(run.id)).toBeNull();
      await store.writeRunBinding(run.id, binding("messe", "2026-10-20T08:00:00.000Z", "neu"));
      expect((await store.readRunBinding(run.id))?.entries[0]?.value).toBe("neu");
      expect(await readFile(path.join(dir, run.id, "bindings.json"), "utf8")).toContain('"neu"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
