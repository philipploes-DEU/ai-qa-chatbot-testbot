import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { loadWorkspaceConfig } from "./config.js";
import { initWorkspace } from "./init.js";
import { validatePaths } from "./validate.js";

describe("initWorkspace", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aiqa-init-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a workspace that validates", async () => {
    const dir = path.join(root, "mein-bot");
    const created = await initWorkspace(dir);

    expect(created.map((file) => path.relative(dir, file).replace(/\\/g, "/"))).toEqual([
      "aiqa.yaml",
      "goldsets/beispiel/goldset.yaml",
      "goldsets/beispiel/plan.yaml",
      ".gitignore",
      "README.md",
    ]);
    for (const file of created) {
      expect((await stat(file)).isFile()).toBe(true);
    }

    const result = await validatePaths([dir], dir);
    expect(result.files.filter((file) => file.errors.length > 0)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("writes a config with the dummy target and the example goldset", async () => {
    const dir = path.join(root, "mein-bot");
    await initWorkspace(dir);
    const { config } = await loadWorkspaceConfig(path.join(dir, "aiqa.yaml"));
    expect(config.target.adapter).toBe("dummy");
    expect(config.goldsets).toEqual(["goldsets/beispiel/goldset.yaml"]);
    expect(Object.keys(config.target.dummy?.responses ?? {})).toHaveLength(3);
  });

  it("explains every field in the config", async () => {
    const dir = path.join(root, "mein-bot");
    await initWorkspace(dir);
    const text = await readFile(path.join(dir, "aiqa.yaml"), "utf8");
    for (const field of [
      "adapter",
      "endpoint",
      "auth",
      "rateLimit",
      "timeouts",
      "expectations",
      "runsDir",
    ]) {
      expect(text).toContain(field);
    }
    expect(text.split("\n").filter((line) => line.trim().startsWith("#")).length).toBeGreaterThan(
      10,
    );
  });

  it("ignores runs and reports in the workspace", async () => {
    const dir = path.join(root, "mein-bot");
    await initWorkspace(dir);
    const text = await readFile(path.join(dir, ".gitignore"), "utf8");
    expect(text).toContain("runs/");
    expect(text).toContain("reports/");
    expect(text).toContain(".env");
  });

  it("refuses a directory that is not empty", async () => {
    const dir = path.join(root, "belegt");
    await initWorkspace(dir);
    await expect(initWorkspace(dir)).rejects.toThrow(/nicht leer/);
  });

  it("refuses a path that is a file", async () => {
    const file = path.join(root, "datei.txt");
    await writeFile(file, "x");
    await expect(initWorkspace(file)).rejects.toThrow(/kein Verzeichnis/);
  });
});

describe("initWorkspace with schedule", () => {
  it("writes a GitHub Actions workflow with schedule, dispatch and gates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aiqa-init-schedule-"));
    try {
      const dir = path.join(root, "nachtlauf");
      const created = await initWorkspace(dir, () => new Date("2026-10-11T08:00:00Z"), {
        withSchedule: true,
      });
      const workflow = created.find((file) => file.endsWith("aiqa.yml"));
      expect(workflow).toBeDefined();
      const text = await readFile(workflow ?? "", "utf8");
      expect(text).toContain("schedule:");
      expect(text).toContain("workflow_dispatch:");
      expect(text).toContain("repository_dispatch:");
      expect(text).toContain("types: [aiqa-run]");
      expect(text).toContain("secrets.AIQA_TARGET_TOKEN");
      expect(text).toContain("secrets.AIQA_JUDGE_API_KEY");
      expect(text).toContain("run --plan $AIQA_PLAN");
      expect(text).toContain("gate --run latest --base previous");
      expect(text).toContain("GITHUB_STEP_SUMMARY");
      expect(text).toContain("actions/upload-artifact@v4");
      expect(text).toContain("report --run latest --format html");
      expect(text).toContain("report --run latest --format junit");
      expect(text).toContain("secrets.AIQA_AGENTS_API_KEY");
      expect(text).toContain('AIQA_ANALYZE: "false"');
      expect(text).toContain("env.AIQA_ANALYZE == 'true'");
      expect(text).toContain("analyze --run latest");
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{20}/);
      expect(() => parse(text) as unknown).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
