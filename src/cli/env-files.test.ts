import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFiles } from "./env-files.js";

describe("loadEnvFiles", () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aiqa-env-"));
    workspace = path.join(root, "workspaces", "bot");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      path.join(workspace, ".env"),
      [
        "# Zugang zum Zielsystem",
        "AIQA_TARGET_TOKEN=aus-arbeitsbereich",
        'AIQA_QUOTED="mit Leerzeichen"',
      ].join("\n"),
    );
    await writeFile(
      path.join(root, ".env"),
      ["AIQA_TARGET_TOKEN=aus-repo", "AIQA_JUDGE_API_KEY=aus-repo", "AIQA_EMPTY="].join("\n"),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads the workspace first, then the start directory, and reports file and count", () => {
    const env: Record<string, string | undefined> = {};
    const loaded = loadEnvFiles([workspace, root], env);
    expect(env.AIQA_TARGET_TOKEN).toBe("aus-arbeitsbereich");
    expect(env.AIQA_JUDGE_API_KEY).toBe("aus-repo");
    expect(env.AIQA_QUOTED).toBe("mit Leerzeichen");
    expect(loaded).toEqual([
      { file: path.join(workspace, ".env"), variables: 2 },
      { file: path.join(root, ".env"), variables: 2 },
    ]);
  });

  it("never overrides a variable that is already set", () => {
    const env: Record<string, string | undefined> = { AIQA_TARGET_TOKEN: "aus-der-shell" };
    loadEnvFiles([workspace, root], env);
    expect(env.AIQA_TARGET_TOKEN).toBe("aus-der-shell");
  });

  it("reads a directory only once and skips directories without .env", () => {
    const env: Record<string, string | undefined> = {};
    const loaded = loadEnvFiles([workspace, workspace, path.join(root, "workspaces")], env);
    expect(loaded).toHaveLength(1);
  });
});
