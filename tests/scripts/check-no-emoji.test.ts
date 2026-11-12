import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const script = path.resolve("scripts", "check-no-emoji.mjs");

// Written as escapes: the repository itself stays free of emoji.
const ROBOT = "\u{1F916}";
const CHECK_MARK = "✅";
const WARNING = "⚠️";
const FLAG = "\u{1F1E9}\u{1F1EA}";
const KEYCAP = "1️⃣";

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("scripts/check-no-emoji.mjs (issue #126)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aiqa-emoji-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function message(name: string, text: string): Promise<string> {
    const file = path.join(dir, name);
    await writeFile(file, text, "utf8");
    return file;
  }

  it("accepts a commit message without emoji, with umlauts, arrows and legal signs", async () => {
    const file = await message(
      "ok.txt",
      [
        "feat(runner): write iterations as JSONL (#12)",
        "",
        "Prüft Größe und Maße, a -> b, a → b, 5 €, © 2026, Marke™, ®.",
        "",
        "Co-Authored-By: Jemand <jemand@example.com>",
      ].join("\n"),
    );
    const result = run([file]);
    expect(result.output).toBe("");
    expect(result.status).toBe(0);
  });

  it("rejects a commit message with an emoji and names line and code point", async () => {
    const file = await message(
      "robot.txt",
      ["fix(report): align the table (#3)", "", `${ROBOT} Generated with a tool`].join("\n"),
    );
    const result = run([file]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("robot.txt");
    expect(result.output).toContain("Zeile 3");
    expect(result.output).toContain("U+1F916");
    // The finding is reported without printing the emoji again.
    expect(result.output).not.toContain(ROBOT);
  });

  it.each([
    ["a check mark", CHECK_MARK, "U+2705"],
    ["a sign forced to emoji presentation", WARNING, "U+26A0"],
    ["a flag", FLAG, "U+1F1E9"],
    ["a keycap", KEYCAP, "U+20E3"],
  ])("rejects %s", async (_name, emoji, codePoint) => {
    const file = await message("case.txt", `docs: describe the check ${emoji}`);
    const result = run([file]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(codePoint);
  });

  it("checks the title and the text of a pull request from environment variables", () => {
    const clean = run(["--env", "PR_TITLE", "--env", "PR_BODY"], {
      PR_TITLE: "feat(checks): rate conditions one by one (#120)",
      PR_BODY:
        "## Bezug\n\nCloses #120.\n\nGenerated with [Claude Code](https://claude.com/claude-code)",
    });
    expect(clean.status).toBe(0);

    const dirty = run(["--env", "PR_TITLE", "--env", "PR_BODY"], {
      PR_TITLE: "feat(checks): rate conditions one by one (#120)",
      PR_BODY: `## Bezug\n\nCloses #120.\n\n${ROBOT} Generated with [Claude Code](https://claude.com/claude-code)`,
    });
    expect(dirty.status).toBe(1);
    expect(dirty.output).toContain("PR_BODY");
    expect(dirty.output).toContain("Zeile 5");
  });

  it("treats an unset or empty variable as empty text", () => {
    const result = run(["--env", "AIQA_TEST_UNSET_PR_BODY"]);
    expect(result.status).toBe(0);
  });

  it("fails closed without input and for a file that does not exist", () => {
    expect(run([]).status).toBe(2);
    const missing = run([path.join(dir, "fehlt.txt")]);
    expect(missing.status).toBe(2);
    expect(missing.output).toContain("fehlt.txt");
  });
});

describe("the hooks and workflows that call the emoji check (issue #126)", () => {
  it("runs the check on the commit message in the commit-msg hook", async () => {
    const hook = await readFile(path.resolve(".husky", "commit-msg"), "utf8");
    expect(hook).toContain('node scripts/check-no-emoji.mjs "$1"');
  });

  it("runs the check on title and text of a pull request, also after an edit", async () => {
    const workflow = await readFile(path.resolve(".github", "workflows", "pr-text.yml"), "utf8");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("edited");
    expect(workflow).toContain("node scripts/check-no-emoji.mjs --env PR_TITLE --env PR_BODY");
    // The text travels as environment variable, never through the shell command line.
    expect(workflow).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    expect(workflow).not.toMatch(/run:.*\$\{\{/);
  });
});
