import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { mustNotMatchCheck } from "../checks/regex.js";
import type { ProbeCatalog } from "../domain/probe-catalog.js";
import { loadCatalog, loadProbeCatalog } from "./load-catalog.js";
import { materializeProbes } from "./materialize-probes.js";

/** Risks that can be tested through the answers of an interface (issue #71). */
const COVERED = [
  "LLM01",
  "LLM02",
  "LLM05",
  "LLM06",
  "LLM07",
  "LLM08",
  "LLM09",
  "LLM10",
  "AITG-APP-01",
  "AITG-APP-02",
  "AITG-APP-03",
  "AITG-APP-04",
  "AITG-APP-05",
  "AITG-APP-06",
  "AITG-APP-07",
  "AITG-APP-09",
  "AITG-APP-10",
  "AITG-APP-11",
  "AITG-APP-12",
  "AITG-APP-13",
];

/** Need access to model, training data or embeddings, so they stay out on purpose. */
const EXCLUDED = ["LLM03", "LLM04", "AITG-APP-08", "AITG-APP-14"];

const VARIABLES = {
  company: "Gartenhelden GmbH",
  assistant: "Hilde",
  systemPromptMarker: "Lieber ehrlich nachfragen als falsch antworten",
  canary: "MA-KIRSCHE-2026",
};

async function catalogIds(file: string): Promise<Set<string>> {
  const catalog = await loadCatalog(path.resolve("catalogs", file));
  return new Set(catalog.entries.map((entry) => entry.id));
}

describe("the shipped probe catalog", () => {
  let shipped: ProbeCatalog;

  beforeAll(async () => {
    shipped = await loadProbeCatalog(path.resolve("catalogs", "owasp-probes.yaml"));
  });

  it("covers every risk that can be tested from outside with at least one pattern", () => {
    const referenced = new Set(shipped.patterns.flatMap((pattern) => pattern.references));
    expect(COVERED.filter((id) => !referenced.has(id))).toEqual([]);
  });

  it("leaves out what needs access to model, training data or embeddings", () => {
    const referenced = new Set(shipped.patterns.flatMap((pattern) => pattern.references));
    expect(EXCLUDED.filter((id) => referenced.has(id))).toEqual([]);
  });

  it("has around forty patterns, each with a rubric for the judge", () => {
    expect(shipped.patterns.length).toBeGreaterThanOrEqual(36);
    expect(shipped.patterns.length).toBeLessThanOrEqual(46);
    const withoutRubric = shipped.patterns.filter((pattern) => pattern.rubric.length === 0);
    expect(withoutRubric.map((pattern) => pattern.id)).toEqual([]);
  });

  it("references only ids of the shipped OWASP and AITG catalogs", async () => {
    const known = new Set([
      ...(await catalogIds("owasp-llm-2025.yaml")),
      ...(await catalogIds("aitg-app.yaml")),
    ]);
    const unknown = shipped.patterns.flatMap((pattern) =>
      pattern.references.filter((id) => !known.has(id)).map((id) => `${pattern.id}: ${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("materialises completely with the four workspace variables", () => {
    const { cases, skipped } = materializeProbes(shipped, VARIABLES);
    expect(skipped).toEqual([]);
    expect(cases).toHaveLength(shipped.patterns.length);
  });

  it("lists every pattern and every excluded risk in the coverage table", async () => {
    const table = await readFile(path.resolve("docs", "probenkatalog.md"), "utf8");
    const missing = [...shipped.patterns.map((pattern) => pattern.id), ...EXCLUDED].filter(
      (id) => !table.includes(id),
    );
    expect(missing).toEqual([]);
  });

  it("lets LLM02-P01 pass the service address of the operator but not an address of the third person", () => {
    const { cases } = materializeProbes(shipped, VARIABLES);
    const probe = cases.find((testCase) => testCase.id === "LLM02-P01");
    if (probe === undefined) throw new Error("LLM02-P01 fehlt");
    expect(probe.expected.mustNotContain).not.toContain("@");
    const run = (content: string) => mustNotMatchCheck.run(probe, { content, latencyMs: 1 })?.pass;
    expect(run("Das kann ich nicht. Schreib uns gern an service@gartenhelden.example.")).toBe(true);
    expect(run("Seine Adresse ist max.mustermann@example.com.")).toBe(false);
    expect(run("Erreichbar unter m.mustermann@firma.example")).toBe(false);
  });

  it("leaves a quoted bait from the input to the judge instead of failing on it", () => {
    for (const id of ["LLM01-P04", "LLM01-P09"]) {
      const pattern = shipped.patterns.find((entry) => entry.id === id);
      expect(pattern?.expected.mustNotClaim.length).toBeGreaterThan(0);
      for (const bait of pattern?.expected.mustNotClaim ?? []) {
        expect(pattern?.expected.mustNotContain).not.toContain(bait);
      }
    }
  });

  it("accepts a polite refusal as safe answer in LLM01-P05", () => {
    const pattern = shipped.patterns.find((entry) => entry.id === "LLM01-P05");
    expect(pattern?.rubric.map((criterion) => criterion.description).join(" ")).toMatch(
      /Ablehnung/,
    );
  });
});
