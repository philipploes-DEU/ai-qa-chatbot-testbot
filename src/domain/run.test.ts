import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { RunSchema } from "./run.js";

const validRun = {
  id: "20261010-120000-ab12",
  planId: "plan-beispiel",
  target: "beispiel-dummy",
  startedAt: "2026-10-10T12:00:00Z",
  goldsets: [{ id: "beispiel", version: "1" }],
};

describe("RunSchema", () => {
  it("accepts a running run without finish time", () => {
    const parsed = RunSchema.parse(validRun);
    expect(parsed.finishedAt).toBeUndefined();
    expect(parsed.judge).toBeUndefined();
    expect(parsed.warnings).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.targetVersion).toBeUndefined();
    expect(parsed.catalogVersion).toBeUndefined();
  });

  it("accepts a finished run with optional versions", () => {
    const parsed = RunSchema.parse({
      ...validRun,
      finishedAt: "2026-10-10T12:05:00Z",
      targetVersion: "staging-42",
      model: "dummy",
      catalogVersion: "2025",
    });
    expect(parsed.finishedAt).toBe("2026-10-10T12:05:00Z");
  });

  it("rejects a finish time before the start", () => {
    const result = RunSchema.safeParse({ ...validRun, finishedAt: "2026-10-10T11:00:00Z" });
    expect(failurePaths(result)).toContain("finishedAt");
  });

  it("rejects a missing plan id", () => {
    const { planId: _planId, ...withoutPlan } = validRun;
    const result = RunSchema.safeParse(withoutPlan);
    expect(failurePaths(result)).toContain("planId");
  });

  it("rejects an empty goldset list", () => {
    const result = RunSchema.safeParse({ ...validRun, goldsets: [] });
    expect(failurePaths(result)).toContain("goldsets");
  });
});

describe("RunSchema judge and warnings", () => {
  it("records the judge and warnings of a run", () => {
    const parsed = RunSchema.parse({
      ...validRun,
      judge: { model: "qwen2.5:7b", promptVersion: "v1" },
      warnings: ["Judge und Zielsystem nutzen dasselbe Modell"],
    });
    expect(parsed.judge).toEqual({ model: "qwen2.5:7b", promptVersion: "v1" });
    expect(parsed.warnings).toHaveLength(1);
  });
});

describe("RunSchema status", () => {
  it("records a completed or aborted run with its reason", () => {
    expect(RunSchema.parse({ ...validRun, status: "completed" }).status).toBe("completed");
    const aborted = RunSchema.parse({
      ...validRun,
      status: "aborted",
      abortReason: "Budget von 10 Aufrufen erreicht",
    });
    expect(aborted.abortReason).toContain("Budget");
    expect(failurePaths(RunSchema.safeParse({ ...validRun, status: "pausiert" }))).toContain(
      "status",
    );
  });
});
