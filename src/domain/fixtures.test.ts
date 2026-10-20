import { describe, expect, it } from "vitest";

import { GoldsetSchema } from "./goldset.js";
import { BindingFileSchema, FixturesConfigSchema } from "./fixtures.js";
import { WorkspaceConfigSchema } from "./workspace-config.js";

const config = {
  sources: {
    export: { type: "file", path: "fixtures/aussteller.json" },
    index: { type: "http", endpoint: "http://127.0.0.1:9200/messe/_search" },
    db: { type: "script", command: ["node", "scripts/aussteller.mjs"] },
  },
  queries: {
    "aussteller-halle-3": {
      source: "index",
      version: 2,
      approvedBy: "Fachbereich Messe",
      approvedAt: "2026-10-20",
      request: { body: '{"query": {"term": {"halle": 3}}, "sort": ["name"]}' },
      rows: "$.hits.hits[*]._source",
    },
  },
  bindings: {
    aussteller_1: { query: "aussteller-halle-3", row: 0, field: "name" },
    stand_1: { query: "aussteller-halle-3", field: "stand" },
  },
};

describe("FixturesConfigSchema (issue #93)", () => {
  it("accepts sources, stored queries and bindings", () => {
    const parsed = FixturesConfigSchema.parse(config);
    expect(parsed.queries["aussteller-halle-3"]?.version).toBe("2");
    expect(parsed.bindings.stand_1?.row).toBe(0);
    expect(parsed.queries["aussteller-halle-3"]?.request?.method).toBe("POST");
  });

  it("rejects a query of an unknown source and a binding of an unknown query", () => {
    const result = FixturesConfigSchema.safeParse({
      ...config,
      queries: { a: { source: "fehlt", version: 1, rows: "$" } },
      bindings: { x: { query: "b", field: "name" } },
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message).join(" | ") ?? "";
    expect(messages).toContain('unbekannte Quelle "fehlt"');
    expect(messages).toContain('unbekannte Abfrage "b"');
  });

  it("rejects a script source with a command string instead of a list", () => {
    expect(
      FixturesConfigSchema.safeParse({
        ...config,
        sources: { db: { type: "script", command: "node x.mjs" } },
        queries: {},
        bindings: {},
      }).success,
    ).toBe(false);
  });

  it("is part of aiqa.yaml", () => {
    const workspace = WorkspaceConfigSchema.parse({
      version: 1,
      target: { name: "messe", adapter: "dummy" },
      fixtures: config,
    });
    expect(Object.keys(workspace.fixtures?.bindings ?? {})).toEqual(["aussteller_1", "stand_1"]);
  });
});

describe("placeholders in goldsets (issue #93)", () => {
  const base = { id: "messe", name: "Messe", owner: "QA" };

  it("accepts declared placeholders in input, expected and rubric", () => {
    const goldset = GoldsetSchema.parse({
      ...base,
      fixtures: {
        aussteller_1: { condition: "Ein Aussteller des aktuellen Messejahrs in Halle 3" },
        stand_1: { condition: "Der Stand dieses Ausstellers" },
      },
      cases: [
        {
          id: "stand",
          kind: "qa",
          input: "Wo finde ich {{fixtures.aussteller_1}}?",
          expected: {
            mustContain: ["{{ fixtures.stand_1 }}"],
            answer: "Am Stand {{fixtures.stand_1}}.",
          },
          rubric: [{ name: "Ort", description: "Nennt {{fixtures.stand_1}}." }],
        },
      ],
    });
    expect(goldset.fixtures?.aussteller_1?.condition).toContain("Halle 3");
  });

  it("rejects an undeclared placeholder and names it", () => {
    const result = GoldsetSchema.safeParse({
      ...base,
      cases: [{ id: "stand", kind: "qa", input: "Wo finde ich {{fixtures.aussteller_1}}?" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      "{{fixtures.aussteller_1}} ist im Goldset unter fixtures nicht deklariert",
    );
  });

  it("accepts text that only mentions fixtures in braces, for example a template question", () => {
    const result = GoldsetSchema.safeParse({
      ...base,
      cases: [{ id: "vue", kind: "qa", input: "Was macht {{ fixtures }} im Template?" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a calibration sample on a case with placeholders", () => {
    const result = GoldsetSchema.safeParse({
      ...base,
      fixtures: { aussteller_1: { condition: "Ein Aussteller" } },
      cases: [
        {
          id: "stand",
          kind: "qa",
          input: "Wo ist {{fixtures.aussteller_1}}?",
          expected: { answer: "Halle 3" },
        },
      ],
      calibration: { samples: [{ caseId: "stand", answer: "In Halle 3.", pass: true }] },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      "Kalibrierung braucht Fälle mit festen Werten",
    );
  });

  it("rejects placeholders in fields that are never filled and malformed ones", () => {
    for (const [field, testCase] of [
      [
        "bodyMerge",
        {
          id: "d",
          kind: "dialog",
          input: [
            { role: "user", content: "Hallo" },
            { role: "user", content: "Weiter", bodyMerge: { firma: "{{fixtures.aussteller_1}}" } },
          ],
        },
      ],
      ["tags", { id: "t", kind: "qa", input: "Wo?", tags: ["{{fixtures.aussteller_1}}"] }],
      ["Tippfehler", { id: "m", kind: "qa", input: "Wo ist {{fixtures.aussteller.1}}?" }],
    ] as const) {
      const result = GoldsetSchema.safeParse({
        ...base,
        fixtures: { aussteller_1: { condition: "Ein Aussteller" } },
        cases: [testCase],
      });
      expect(result.success, field).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message).join(" | "), field).toContain(
        "steht außerhalb der Felder, die AI QA ersetzt, oder ist nicht lesbar",
      );
    }
  });

  it("rejects placeholders in patterns and schemas, where a value would act as a pattern", () => {
    const result = GoldsetSchema.safeParse({
      ...base,
      fixtures: { stand_1: { condition: "Ein Stand" } },
      cases: [
        {
          id: "stand",
          kind: "qa",
          input: "Wo?",
          expected: { mustMatch: ["{{fixtures.stand_1}}"] },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      "Platzhalter sind in mustMatch, mustNotMatch und schema nicht erlaubt",
    );
  });
});

describe("BindingFileSchema (issue #93)", () => {
  it("records bound and unresolved placeholders with their query", () => {
    const binding = BindingFileSchema.parse({
      createdAt: "2026-10-20T08:00:00.000Z",
      target: "messe",
      entries: [
        {
          placeholder: "aussteller_1",
          query: "aussteller-halle-3",
          queryVersion: 2,
          source: "index",
          status: "bound",
          value: "Gartenhelden GmbH",
        },
        {
          placeholder: "stand_2",
          query: "aussteller-halle-3",
          queryVersion: 2,
          source: "index",
          status: "unresolved",
          reason: "die Abfrage lieferte 1 Zeile, gebraucht wird Zeile 1",
        },
      ],
    });
    expect(binding.entries[0]?.queryVersion).toBe("2");
  });
});
