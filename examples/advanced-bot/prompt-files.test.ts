import { describe, expect, it } from "vitest";

import { buildPromptFromFiles, extractPromptBlock, stripHeader } from "./prompt-files.js";

const PROMPT_FILE = [
  "# System Prompt Testbot",
  "",
  "Einsatz: `{{WISSENSBASIS}}` durch die Wissensbasis ersetzen.",
  "",
  "---",
  "",
  "Du bist der Assistent. Heute ist {{DATUM}}.",
  "",
  "<wissensbasis>",
  "{{WISSENSBASIS}}",
  "</wissensbasis>",
  "",
  "---",
  "",
].join("\n");

const KNOWLEDGE_FILE = [
  "# Wissensbasis",
  "",
  "Stand und Quelle, gehört nicht in den Prompt.",
  "",
  "---",
  "",
  "## 1. Unternehmen",
  "",
  "Fakten.",
].join("\n");

describe("prompt files for the advanced bot", () => {
  it("takes the block between the separator lines, else the whole text", () => {
    expect(extractPromptBlock(PROMPT_FILE)).toContain("Du bist der Assistent.");
    expect(extractPromptBlock(PROMPT_FILE)).not.toContain("Einsatz:");
    expect(extractPromptBlock("Nur ein Prompt.")).toBe("Nur ein Prompt.");
  });

  it("drops the header of the knowledge base up to the first separator", () => {
    expect(stripHeader(KNOWLEDGE_FILE)).toBe("## 1. Unternehmen\n\nFakten.");
    expect(stripHeader("## Ohne Kopf")).toBe("## Ohne Kopf");
  });

  it("fills knowledge base and date into the prompt", () => {
    const prompt = buildPromptFromFiles(
      PROMPT_FILE,
      KNOWLEDGE_FILE,
      new Date("2026-10-11T09:00:00Z"),
    );
    expect(prompt).toContain("Heute ist 11.10.2026.");
    expect(prompt).toContain("<wissensbasis>\n## 1. Unternehmen\n\nFakten.\n</wissensbasis>");
    expect(prompt).not.toContain("{{");
    expect(prompt.startsWith("Du bist der Assistent.")).toBe(true);
  });

  it("works without a knowledge base file", () => {
    const prompt = buildPromptFromFiles(
      "Hallo {{DATUM}}",
      undefined,
      new Date("2026-01-02T00:00:00Z"),
    );
    expect(prompt).toBe("Hallo 02.01.2026");
  });
});
