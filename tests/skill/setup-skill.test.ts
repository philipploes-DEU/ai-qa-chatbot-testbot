import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createProgram } from "../../src/cli/program.js";

const SKILL_DIR = path.resolve(".claude/skills/aiqa-einrichtung");
const SKILL_FILE = path.join(SKILL_DIR, "SKILL.md");

function skillText(): string {
  return readFileSync(SKILL_FILE, "utf8");
}

function cliSurface(): { commands: Set<string>; options: Set<string> } {
  const io = { cwd: process.cwd(), writeOut: () => undefined, writeErr: () => undefined };
  const program = createProgram(io, { exitCode: 0 });
  const commands = new Set(program.commands.map((command) => command.name()));
  const options = new Set(
    [program, ...program.commands].flatMap((command) =>
      command.options.flatMap((option) => [option.long, option.short]),
    ),
  );
  options.add("--help");
  options.add("--version");
  return { commands, options: new Set([...options].filter((value) => value !== undefined)) };
}

describe("setup skill", () => {
  it("has a name and a description with German and English triggers", () => {
    const text = skillText();
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: aiqa-einrichtung$/m);
    expect(frontmatter).toMatch(/^description: .*einrichten.*/m);
    expect(frontmatter).toMatch(/set up/i);
  });

  it("names only commands and options the CLI has", () => {
    const text = skillText();
    const { commands, options } = cliSurface();
    const named = [...text.matchAll(/\baiqa(?: --)?(?: -w \S+)? ([a-z]+)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((name) => !commands.has(name))).toEqual([]);

    const flags = [...text.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)].map((match) => match[1] ?? "");
    expect(flags.filter((flag) => !options.has(flag))).toEqual([]);
  });

  it("links only to files that exist", () => {
    const links = [...skillText().matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(3);
    expect(links.filter((link) => !existsSync(path.resolve(SKILL_DIR, link)))).toEqual([]);
  });

  it("follows the writing rules: no dashes, no exclamation marks", () => {
    expect(skillText()).not.toMatch(/[–—]/);
    expect(skillText()).not.toMatch(/!/);
  });

  it("never asks for a secret in the chat", () => {
    const text = skillText();
    expect(text).toContain(".env");
    expect(text).toMatch(/nie im Chat/i);
  });
});
