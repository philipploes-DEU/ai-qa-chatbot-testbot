import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { executeImport } from "../../src/cli/import-command.js";
import { initWorkspace } from "../../src/cli/init.js";
import type { CliIo } from "../../src/cli/io.js";
import { validatePaths } from "../../src/cli/validate.js";
import { GoldsetSchema } from "../../src/domain/goldset.js";

function collectIo(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out,
    err,
    writeOut: (line) => {
      out.push(line);
    },
    writeErr: (line) => {
      err.push(line);
    },
  };
}

describe("aiqa import promptfoo-cases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-import-cases-"));
    await initWorkspace(dir, () => new Date("2026-10-11T08:00:00Z"));
    await copyFile(
      path.resolve("tests/fixtures/promptfoo/redteam.yaml"),
      path.join(dir, "redteam.yaml"),
    );
    const config = path.join(dir, "aiqa.yaml");
    await writeFile(
      config,
      `${await readFile(config, "utf8")}\nprobes:\n  variables:\n    systemPromptMarker: Du bist der Gartenhelden-Assistent\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the attacks as draft cases into a goldset and explains the next steps", async () => {
    const io = collectIo(dir);
    const file = await executeImport({ source: "promptfoo-cases", file: "redteam.yaml" }, io);
    expect(file).toBe(path.join(dir, "goldsets", "promptfoo-angriffe-redteam.yaml"));

    const goldset = GoldsetSchema.parse(parse(await readFile(file, "utf8")));
    expect(goldset.cases).toHaveLength(8);
    expect(goldset.cases.every((testCase) => testCase.status === "draft")).toBe(true);
    const extraction = goldset.cases.find((testCase) => testCase.tags[0] === "prompt-extraction");
    expect(extraction?.expected.mustNotContain).toEqual(["Du bist der Gartenhelden-Assistent"]);

    const text = io.out.join("\n");
    expect(text).toContain("8 Entwürfe");
    expect(text).toContain("8 übersprungen");
    expect(text).toContain("goldsets/promptfoo-angriffe-redteam.yaml");
    expect(text).toContain("aiqa ui");
    expect(io.err.join("\n")).toContain("canary");

    const result = await validatePaths([file], dir);
    expect(result.ok).toBe(true);
  });

  it("refuses to overwrite an earlier import and takes another id", async () => {
    await executeImport({ source: "promptfoo-cases", file: "redteam.yaml" }, collectIo(dir));
    await expect(
      executeImport({ source: "promptfoo-cases", file: "redteam.yaml" }, collectIo(dir)),
    ).rejects.toThrow(/--id/);
    const second = await executeImport(
      { source: "promptfoo-cases", file: "redteam.yaml", id: "angriffe-zwei" },
      collectIo(dir),
    );
    expect(path.basename(second)).toBe("angriffe-zwei.yaml");
  });

  it("validates the shipped templates", async () => {
    const result = await validatePaths(["catalogs/promptfoo-case-templates.yaml"], process.cwd());
    expect(result.ok).toBe(true);
    expect(result.files[0]?.kind).toBe("promptfoo-case-templates");
  });
});
