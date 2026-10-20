import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectKind, validatePaths } from "./validate.js";

const root = process.cwd();
const fixtures = path.join("tests", "fixtures", "validate");

describe("detectKind", () => {
  it("uses the file name first", () => {
    expect(detectKind("aiqa.yaml", {})).toBe("workspace");
    expect(detectKind("kundenbot-web.spec.yaml", {})).toBe("playwright-spec");
    expect(detectKind("plan.yaml", {})).toBe("plan");
    expect(detectKind("nacht.plan.yaml", {})).toBe("plan");
  });

  it("falls back to the content", () => {
    expect(detectKind("x.yaml", { cases: [] })).toBe("goldset");
    expect(detectKind("x.yaml", { entries: [] })).toBe("catalog");
    expect(detectKind("x.yaml", { patterns: [] })).toBe("probes");
    expect(detectKind("x.yaml", { caseRefs: [] })).toBe("plan");
    expect(detectKind("x.yaml", { plugins: [] })).toBe("promptfoo-mapping");
    expect(detectKind("x.yaml", { version: 1, target: {} })).toBe("workspace");
    expect(detectKind("x.yaml", { foo: "bar" })).toBe("unknown");
    expect(detectKind("x.yaml", "nur text")).toBe("unknown");
  });
});

describe("validatePaths promptfoo mapping", () => {
  it("validates the shipped promptfoo mapping", async () => {
    const result = await validatePaths(["catalogs/promptfoo-mapping.yaml"], process.cwd());
    expect(result.ok).toBe(true);
    expect(result.files[0]?.kind).toBe("promptfoo-mapping");
    expect(result.files[0]?.summary).toMatch(/Plugin-Regeln/);
  });
});

describe("validatePaths", () => {
  it("checks every YAML file below a directory and reports errors with paths", async () => {
    const result = await validatePaths([fixtures], root);

    expect(result.ok).toBe(false);
    const byName = new Map(result.files.map((file) => [path.basename(file.path), file]));
    expect([...byName.keys()]).toEqual([
      "aiqa.yaml",
      "broken.yaml",
      "catalog-ok.yaml",
      "goldset-bad.yaml",
      "goldset-duplicate.yaml",
      "goldset-ok.yaml",
      "plan-unknown-case.plan.yaml",
      "plan.yaml",
      "unknown.yaml",
      "web.spec.yaml",
    ]);

    expect(byName.get("aiqa.yaml")).toMatchObject({ kind: "workspace", errors: [] });
    expect(byName.get("catalog-ok.yaml")).toMatchObject({ kind: "catalog", errors: [] });
    expect(byName.get("goldset-ok.yaml")).toMatchObject({ kind: "goldset", errors: [] });
    expect(byName.get("plan.yaml")).toMatchObject({ kind: "plan", errors: [] });
    expect(byName.get("web.spec.yaml")).toMatchObject({ kind: "playwright-spec", errors: [] });

    expect(byName.get("broken.yaml")?.errors[0]).toMatch(/YAML/);
    expect(byName.get("goldset-bad.yaml")?.errors.some((line) => line.startsWith("owner:"))).toBe(
      true,
    );
    expect(byName.get("goldset-duplicate.yaml")?.errors).toEqual([
      'cases[1].id: doppelte Fall-ID "fall-a"',
    ]);
    expect(byName.get("plan-unknown-case.plan.yaml")?.errors[0]).toMatch(/fall-z/);
    expect(byName.get("unknown.yaml")?.errors[0]).toMatch(/unbekannter Dokumenttyp/);
  });

  it("adds a short summary for valid documents", async () => {
    const result = await validatePaths([path.join(fixtures, "goldset-ok.yaml")], root);
    expect(result.ok).toBe(true);
    expect(result.files[0]?.summary).toBe("2 Fälle");
  });

  it("reports a missing path as an error", async () => {
    const result = await validatePaths(["gibt-es-nicht.yaml"], root);
    expect(result.ok).toBe(false);
    expect(result.files[0]?.errors[0]).toMatch(/nicht gefunden/);
  });

  it("accepts the shipped goldsets, catalogs, workspace config and spec", async () => {
    const result = await validatePaths(["goldsets", "catalogs", "aiqa.yaml", "specs"], root);
    expect(result.files.filter((file) => file.errors.length > 0)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.files.map((file) => file.kind).sort()).toEqual([
      "catalog",
      "catalog",
      "goldset",
      "plan",
      "playwright-spec",
      "probes",
      "promptfoo-case-templates",
      "promptfoo-mapping",
      "workspace",
    ]);
  });
});

describe("validatePaths judge hygiene", () => {
  const fixture = path.join("tests", "fixtures", "hygiene", "aiqa.yaml");

  it("rejects a workspace whose judge and target share a model", async () => {
    const result = await validatePaths([fixture], root);
    expect(result.ok).toBe(false);
    expect(result.files[0]?.errors[0]).toMatch(
      /judge\.model: .*dasselbe Modell.*--allow-same-model/,
    );
  });

  it("accepts it with allowSameModel and says so in the summary", async () => {
    const result = await validatePaths([fixture], root, { allowSameModel: true });
    expect(result.ok).toBe(true);
    expect(result.files[0]?.summary).toContain("Judge qwen2.5:7b");
    expect(result.files[0]?.summary).toContain("gleiches Modell wie das Zielsystem (erlaubt)");
  });
});

describe("validatePaths probe catalog", () => {
  it("validates the shipped probe catalog", async () => {
    const result = await validatePaths([path.join("catalogs", "owasp-probes.yaml")], root);
    expect(result.ok).toBe(true);
    expect(result.files[0]?.kind).toBe("probes");
    expect(result.files[0]?.summary).toMatch(/\d+ Muster/);
  });
});

describe("validatePaths with placeholders from data sources (issue #93)", () => {
  it("names a declared placeholder of a workspace goldset without a binding", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aiqa-validate-fixtures-"));
    try {
      await mkdir(path.join(dir, "goldsets"));
      await writeFile(
        path.join(dir, "aiqa.yaml"),
        [
          "version: 1",
          "target: { name: messe, adapter: dummy }",
          "fixtures:",
          "  sources: { export: { type: file, path: aussteller.json } }",
          '  queries: { halle3: { source: export, version: 1, rows: "$" } }',
          "  bindings: { aussteller_1: { query: halle3, field: name } }",
          "goldsets: [goldsets/goldset.yaml]",
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(dir, "goldsets", "goldset.yaml"),
        [
          "id: messe",
          "name: Messe",
          "owner: QA",
          "fixtures:",
          "  aussteller_1: { condition: Ein Aussteller }",
          "  telefon_1: { condition: Seine Telefonnummer }",
          "cases:",
          "  - { id: anruf, kind: qa, input: 'Ruf {{fixtures.aussteller_1}} an: {{fixtures.telefon_1}}' }",
          "",
        ].join("\n"),
      );
      const result = await validatePaths(["aiqa.yaml"], dir);
      expect(result.ok).toBe(false);
      expect(result.files[0]?.errors).toEqual([
        "fixtures.bindings: Platzhalter telefon_1 aus goldsets/goldset.yaml hat keine Bindung",
      ]);

      // With a mapping the fields of the bindings are checked against it.
      await writeFile(path.join(dir, "felder.yaml"), "- stand\n");
      await writeFile(
        path.join(dir, "aiqa.yaml"),
        [
          "version: 1",
          "target: { name: messe, adapter: dummy }",
          "fixtures:",
          "  sources: { export: { type: file, path: aussteller.json, mapping: felder.yaml } }",
          '  queries: { halle3: { source: export, version: 1, rows: "$" } }',
          "  bindings:",
          "    aussteller_1: { query: halle3, field: name }",
          "    telefon_1: { query: halle3, field: telefon }",
          "goldsets: [goldsets/goldset.yaml]",
          "",
        ].join("\n"),
      );
      const mapped = await validatePaths(["aiqa.yaml"], dir);
      expect(mapped.files[0]?.errors).toEqual([
        "fixtures.bindings.aussteller_1.field: Feld name steht nicht im Mapping felder.yaml der Quelle export",
        "fixtures.bindings.telefon_1.field: Feld telefon steht nicht im Mapping felder.yaml der Quelle export",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
