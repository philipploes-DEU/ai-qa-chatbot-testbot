import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoldsetSchema } from "../domain/goldset.js";
import {
  estimateSourceTokens,
  loadGoldsetSources,
  sourceChars,
  truncationWarning,
} from "./sources.js";

describe("loadGoldsetSources", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-sources-"));
    await mkdir(path.join(dir, "goldsets"));
    await writeFile(path.join(dir, "wissen.md"), "Standardversand kostet 4,90 Euro.", "utf8");
    await writeFile(path.join(dir, "goldsets", "faq.md"), "Express kostet 9,90 Euro.", "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const goldset = GoldsetSchema.parse({
    id: "versand",
    name: "Versand",
    owner: "QA",
    sources: ["../wissen.md", "faq.md"],
    cases: [{ id: "f1", kind: "qa", input: "Was kostet Versand?" }],
  });

  it("reads the documents relative to the goldset file and names them by path", async () => {
    const loaded = await loadGoldsetSources(goldset, path.join(dir, "goldsets", "goldset.yaml"));
    expect(loaded.documents).toEqual([
      { name: "../wissen.md", content: "Standardversand kostet 4,90 Euro." },
      { name: "faq.md", content: "Express kostet 9,90 Euro." },
    ]);
    expect(loaded.truncatedFrom).toBeUndefined();
    expect(sourceChars(loaded.documents)).toBe(58);
    expect(estimateSourceTokens(loaded.documents)).toBe(15);
  });

  it("cuts the documents at the limit and says how much the judge does not see", async () => {
    const loaded = await loadGoldsetSources(
      goldset,
      path.join(dir, "goldsets", "goldset.yaml"),
      40,
    );
    expect(sourceChars(loaded.documents)).toBe(40);
    expect(loaded.documents.map((document) => document.name)).toEqual(["../wissen.md", "faq.md"]);
    expect(loaded.truncatedFrom).toBe(58);
    const warning = truncationWarning("versand", loaded, 40);
    expect(warning).toContain("versand");
    expect(warning).toContain("58");
    expect(warning).toContain("40");
  });

  it("returns nothing for a goldset without sources", async () => {
    const loaded = await loadGoldsetSources(
      { ...goldset, sources: undefined },
      path.join(dir, "goldsets", "goldset.yaml"),
    );
    expect(loaded.documents).toEqual([]);
    expect(truncationWarning("versand", loaded, 40)).toBeUndefined();
  });

  it("fails with goldset and path when a document is missing", async () => {
    await expect(
      loadGoldsetSources(
        { ...goldset, sources: ["fehlt.md"] },
        path.join(dir, "goldsets", "goldset.yaml"),
      ),
    ).rejects.toThrow(/versand.*fehlt\.md/);
  });
});
