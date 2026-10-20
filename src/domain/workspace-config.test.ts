import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { WorkspaceConfigSchema } from "./workspace-config.js";

const validConfig = {
  version: 1,
  target: {
    name: "beispiel-dummy",
    adapter: "dummy",
    dummy: { responses: { Hallo: "Guten Tag" }, fallback: "Dazu kann ich nichts sagen." },
  },
  goldsets: ["goldsets/beispiel/goldset.yaml"],
};

describe("WorkspaceConfigSchema", () => {
  it("accepts a workspace config and fills directory defaults", () => {
    const parsed = WorkspaceConfigSchema.parse(validConfig);
    expect(parsed.runsDir).toBe("runs");
    expect(parsed.reportsDir).toBe("reports");
    expect(parsed.catalogs).toEqual([]);
    expect(parsed.target.rateLimit.requestsPerMinute).toBe(60);
  });

  it("rejects unknown config versions", () => {
    const result = WorkspaceConfigSchema.safeParse({ ...validConfig, version: 2 });
    expect(failurePaths(result)).toContain("version");
  });

  it("rejects a missing target", () => {
    const { target: _target, ...withoutTarget } = validConfig;
    const result = WorkspaceConfigSchema.safeParse(withoutTarget);
    expect(failurePaths(result)).toContain("target");
  });

  it("rejects unknown keys", () => {
    const result = WorkspaceConfigSchema.safeParse({ ...validConfig, judge: {} });
    expect(result.success).toBe(false);
  });
});

describe("WorkspaceConfigSchema agents", () => {
  it("accepts a model for the agents without a prompt version", () => {
    const config = WorkspaceConfigSchema.parse({
      ...validConfig,
      agents: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
    });
    expect(config.agents?.model).toBe("qwen2.5:7b");
    expect(config.agents?.provider).toBe("openai-compatible");
  });

  it("rejects a judge prompt version in the agents block", () => {
    const result = WorkspaceConfigSchema.safeParse({
      ...validConfig,
      agents: { baseUrl: "http://localhost:11434/v1", model: "m", promptVersion: "v1" },
    });
    expect(result.success).toBe(false);
  });
});

describe("WorkspaceConfigSchema gates and budget", () => {
  it("accepts gates and a per run budget", () => {
    const parsed = WorkspaceConfigSchema.parse({
      version: 1,
      target: { name: "d", adapter: "dummy" },
      gates: { minPassRate: 0.9, maxCriticalFails: 0, maxRegressionPoints: 5 },
      budget: { maxCallsPerRun: 200 },
    });
    expect(parsed.gates).toEqual({ minPassRate: 0.9, maxCriticalFails: 0, maxRegressionPoints: 5 });
    expect(parsed.budget?.maxCallsPerRun).toBe(200);
  });

  it("rejects an invalid gate and a budget without limit", () => {
    expect(
      WorkspaceConfigSchema.safeParse({
        version: 1,
        target: { name: "d", adapter: "dummy" },
        gates: { minPassRate: 2 },
      }).success,
    ).toBe(false);
    expect(
      WorkspaceConfigSchema.safeParse({
        version: 1,
        target: { name: "d", adapter: "dummy" },
        budget: {},
      }).success,
    ).toBe(false);
  });
});
