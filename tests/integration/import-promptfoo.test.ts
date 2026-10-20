import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeImport } from "../../src/cli/import-command.js";
import { initWorkspace, toTargetName } from "../../src/cli/init.js";
import type { CliIo } from "../../src/cli/io.js";
import { executeReport } from "../../src/cli/report-command.js";
import { FileResultStore } from "../../src/store/file-result-store.js";

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

const FIXTURE = path.resolve("tests/fixtures/promptfoo/redteam-eval.json");

describe("aiqa import promptfoo", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-import-"));
    await initWorkspace(dir, () => new Date("2026-10-11T08:00:00Z"));
    await copyFile(FIXTURE, path.join(dir, "ergebnis.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a run and a goldset, names unknown plugins and feeds the report", async () => {
    const io = collectIo(dir);
    const runId = await executeImport({ source: "promptfoo", file: "ergebnis.json" }, io);

    const store = new FileResultStore(path.join(dir, "runs"));
    const run = await store.readRun(runId);
    expect(run.target).toBe(toTargetName(path.basename(dir)));
    expect(await store.readIterations(runId)).toHaveLength(5);
    expect((await store.readVerdicts(runId)).length).toBeGreaterThanOrEqual(5);

    const goldsetFile = path.join(dir, "goldsets", "promptfoo-eval-xy7-2026-10-11t08-00-00.yaml");
    const goldset = await readFile(goldsetFile, "utf8");
    expect(goldset).toContain("source: LLM07");

    const text = io.out.join("\n");
    expect(text).toContain(`Lauf ${runId} importiert`);
    expect(text).toContain("5 Iterationen in 4 Fällen, 3 bestanden");
    expect(text).toContain("goldsets/promptfoo-eval-xy7-2026-10-11t08-00-00.yaml");
    expect(io.err.join("\n")).toContain("competitors");

    const config = path.join(dir, "aiqa.yaml");
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace(
        "  - goldsets/beispiel/goldset.yaml",
        "  - goldsets/beispiel/goldset.yaml\n  - goldsets/promptfoo-eval-xy7-2026-10-11t08-00-00.yaml",
      ),
    );
    await executeReport({ run: runId }, collectIo(dir));
    const report = await readFile(path.join(dir, "reports", `${runId}.md`), "utf8");
    expect(report).toContain("Importiert aus promptfoo");
    expect(report).toContain("LLM07");
  });

  it("takes the target name from the option", async () => {
    const runId = await executeImport(
      { source: "promptfoo", file: "ergebnis.json", target: "kundenbot-staging" },
      collectIo(dir),
    );
    const run = await new FileResultStore(path.join(dir, "runs")).readRun(runId);
    expect(run.target).toBe("kundenbot-staging");
  });

  it("refuses to import the same evaluation twice", async () => {
    await executeImport({ source: "promptfoo", file: "ergebnis.json" }, collectIo(dir));
    await expect(
      executeImport({ source: "promptfoo", file: "ergebnis.json" }, collectIo(dir)),
    ).rejects.toThrow(/schon importiert/);
  });

  it("names an unknown source, a missing file and a file that is not JSON", async () => {
    await expect(
      executeImport({ source: "garak", file: "ergebnis.json" }, collectIo(dir)),
    ).rejects.toThrow(/promptfoo/);
    await expect(
      executeImport({ source: "promptfoo", file: "fehlt.json" }, collectIo(dir)),
    ).rejects.toThrow(/fehlt.json/);
    await writeFile(path.join(dir, "kaputt.json"), "kein json", "utf8");
    await expect(
      executeImport({ source: "promptfoo", file: "kaputt.json" }, collectIo(dir)),
    ).rejects.toThrow(/kein gültiges JSON/);
  });
});
