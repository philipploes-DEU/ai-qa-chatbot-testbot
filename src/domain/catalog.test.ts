import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { CatalogEntrySchema, CatalogSchema } from "./catalog.js";

const entry = {
  id: "LLM01",
  source: "OWASP Top 10 for LLM Applications 2025",
  name: "Prompt Injection",
  summary: "Eingaben verändern das Verhalten gegen die Absicht des Betreibers.",
  approach: "Probes mit Anweisungen, die Regeln aushebeln sollen.",
  detectors: ["refusal", "mustNotContain"],
};

const catalog = {
  id: "owasp-llm-2025",
  name: "OWASP Top 10 for LLM Applications 2025",
  version: "2025",
  source: "OWASP GenAI Security Project",
  url: "https://genai.owasp.org/llm-top-10/",
  entries: [entry],
};

describe("CatalogEntrySchema", () => {
  it("accepts an entry with only id, source and name", () => {
    const parsed = CatalogEntrySchema.parse({
      id: "AITG-APP-01",
      source: "OWASP AI Testing Guide",
      name: "Testing for Prompt Injection",
    });
    expect(parsed.detectors).toEqual([]);
    expect(parsed.summary).toBeUndefined();
  });

  it("rejects lowercase ids", () => {
    const result = CatalogEntrySchema.safeParse({ ...entry, id: "llm01" });
    expect(failurePaths(result)).toContain("id");
  });
});

describe("CatalogSchema", () => {
  it("accepts a catalog with entries", () => {
    const parsed = CatalogSchema.parse(catalog);
    expect(parsed.entries[0]?.name).toBe("Prompt Injection");
    expect(parsed.license).toBeUndefined();
  });

  it("rejects duplicate entry ids", () => {
    const result = CatalogSchema.safeParse({
      ...catalog,
      entries: [entry, { ...entry, name: "Other" }],
    });
    expect(failurePaths(result)).toContain("entries[1].id");
  });

  it("rejects an invalid url", () => {
    const result = CatalogSchema.safeParse({ ...catalog, url: "not a url" });
    expect(failurePaths(result)).toContain("url");
  });

  it("rejects an empty entry list", () => {
    const result = CatalogSchema.safeParse({ ...catalog, entries: [] });
    expect(failurePaths(result)).toContain("entries");
  });
});
