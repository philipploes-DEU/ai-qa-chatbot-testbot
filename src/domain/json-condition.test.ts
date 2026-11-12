import { describe, expect, it } from "vitest";

import {
  evaluateJsonCondition,
  JsonConditionSchema,
  jsonConditionLabel,
  parseJsonPath,
  readJsonPath,
} from "./json-condition.js";

const answer = {
  treffer: 12,
  erfunden: [],
  fehler: null,
  hinweis: "",
  eintraege: [
    { kennung: "p-jonas", kosten: 0.4 },
    { kennung: "p-mara", kosten: 1.2 },
  ],
  "mit-strich": { wert: true },
};

function condition(input: Record<string, unknown>) {
  return JsonConditionSchema.parse(input);
}

describe("parseJsonPath", () => {
  it("reads names, indexes, quoted names and the wildcard", () => {
    expect(parseJsonPath("$.eintraege[0].kennung")).toEqual(["eintraege", 0, "kennung"]);
    expect(parseJsonPath("eintraege[*].kennung")).toEqual([
      "eintraege",
      { wildcard: true },
      "kennung",
    ]);
    expect(parseJsonPath("$['mit-strich'].wert")).toEqual(["mit-strich", "wert"]);
    expect(parseJsonPath("$")).toEqual([]);
  });

  it("rejects paths it cannot read", () => {
    expect(() => parseJsonPath("$.a[")).toThrow(/nicht lesbar/);
    expect(() => parseJsonPath("$..a")).toThrow(/nicht lesbar/);
    expect(() => parseJsonPath("")).toThrow(/leer/);
  });
});

describe("readJsonPath", () => {
  it("returns the value at a plain path, null included", () => {
    expect(readJsonPath(answer, "$.treffer")).toEqual({ many: false, values: [12] });
    expect(readJsonPath(answer, "$.fehler")).toEqual({ many: false, values: [null] });
    expect(readJsonPath(answer, "$.gibt.es.nicht")).toEqual({ many: false, values: [] });
  });

  it("reads length of lists and texts", () => {
    expect(readJsonPath(answer, "$.erfunden.length").values).toEqual([0]);
    expect(readJsonPath(answer, "$.eintraege.length").values).toEqual([2]);
    expect(readJsonPath(answer, "$.eintraege[0].kennung.length").values).toEqual([7]);
    expect(readJsonPath({ length: "eigenes Feld" }, "$.length").values).toEqual(["eigenes Feld"]);
  });

  it("collects every match of a wildcard and skips members without the field", () => {
    expect(readJsonPath(answer, "$.eintraege[*].kennung")).toEqual({
      many: true,
      values: ["p-jonas", "p-mara"],
    });
    expect(readJsonPath({ liste: [{ a: 1 }, {}, { a: 3 }] }, "$.liste[*].a").values).toEqual([
      1, 3,
    ]);
    expect(readJsonPath(answer, "$.treffer[*]")).toEqual({ many: true, values: [] });
  });
});

describe("JsonConditionSchema", () => {
  it("requires a readable path and at least one comparison", () => {
    expect(JsonConditionSchema.safeParse({ path: "$.treffer" }).success).toBe(false);
    expect(JsonConditionSchema.safeParse({ path: "$.a[", min: 1 }).success).toBe(false);
    expect(JsonConditionSchema.safeParse({ path: "$.treffer", min: 1, mehr: 2 }).success).toBe(
      false,
    );
    expect(JsonConditionSchema.safeParse({ path: "$.fehler", equals: null }).success).toBe(true);
  });
});

describe("jsonConditionLabel", () => {
  it("describes the condition from path and comparison", () => {
    expect(jsonConditionLabel(condition({ path: "$.erfunden.length", equals: 0 }))).toBe(
      "$.erfunden.length = 0",
    );
    expect(jsonConditionLabel(condition({ path: "$.treffer", min: 12, max: 20 }))).toBe(
      "$.treffer >= 12 und <= 20",
    );
    expect(
      jsonConditionLabel(condition({ path: "$.eintraege[*].kennung", contains: "p-jonas" })),
    ).toBe('$.eintraege[*].kennung enthält "p-jonas"');
    expect(jsonConditionLabel(condition({ path: "$.fehler", empty: true }))).toBe("$.fehler leer");
    expect(jsonConditionLabel(condition({ path: "$.hinweis", empty: false }))).toBe(
      "$.hinweis nicht leer",
    );
  });

  it("prefers the name of the condition", () => {
    expect(jsonConditionLabel(condition({ name: "nichts erfunden", path: "$.x", equals: 0 }))).toBe(
      "nichts erfunden",
    );
  });
});

describe("evaluateJsonCondition", () => {
  function pass(input: Record<string, unknown>, data: unknown = answer): boolean {
    return evaluateJsonCondition(condition(input), data).pass;
  }

  it("compares with equals, deeply and with null", () => {
    expect(pass({ path: "$.erfunden.length", equals: 0 })).toBe(true);
    expect(pass({ path: "$.erfunden", equals: [] })).toBe(true);
    expect(pass({ path: "$.fehler", equals: null })).toBe(true);
    expect(pass({ path: "$.eintraege[*].kennung", equals: ["p-jonas", "p-mara"] })).toBe(true);
    expect(pass({ path: "$.treffer", equals: "12" })).toBe(false);
    expect(pass({ path: "$.fehlt", equals: 0 })).toBe(false);
  });

  it("compares numbers with min and max, for every match of a wildcard", () => {
    expect(pass({ path: "$.treffer", min: 12 })).toBe(true);
    expect(pass({ path: "$.treffer", min: 13 })).toBe(false);
    expect(pass({ path: "$.treffer", min: 10, max: 11 })).toBe(false);
    expect(pass({ path: "$.eintraege[*].kosten", max: 1.5 })).toBe(true);
    expect(pass({ path: "$.eintraege[*].kosten", max: 1 })).toBe(false);
    expect(pass({ path: "$.eintraege[*].fehlt", max: 1 })).toBe(false);
    expect(pass({ path: "$.hinweis", min: 0 })).toBe(false);
  });

  it("looks for a member of a list or a part of a text with contains", () => {
    expect(pass({ path: "$.eintraege[*].kennung", contains: "p-jonas" })).toBe(true);
    expect(pass({ path: "$.eintraege[*].kennung", contains: "p-kai" })).toBe(false);
    expect(pass({ path: "$.eintraege", contains: { kennung: "p-mara", kosten: 1.2 } })).toBe(true);
    expect(pass({ path: "$.eintraege[0].kennung", contains: "jonas" })).toBe(true);
    expect(pass({ path: "$.treffer", contains: 1 })).toBe(false);
  });

  it("treats missing, null, empty text, list and object as empty", () => {
    for (const path of ["$.fehler", "$.hinweis", "$.erfunden", "$.fehlt", "$.treffer[*]"]) {
      expect(pass({ path, empty: true })).toBe(true);
      expect(pass({ path, empty: false })).toBe(false);
    }
    expect(pass({ path: "$.leer", empty: true }, { leer: {} })).toBe(true);
    expect(pass({ path: "$.treffer", empty: true })).toBe(false);
    expect(pass({ path: "$.treffer", empty: false })).toBe(true);
  });

  it("names the value in the reason", () => {
    expect(evaluateJsonCondition(condition({ path: "$.treffer", min: 13 }), answer).reason).toBe(
      "Wert 12 liegt unter 13",
    );
    expect(evaluateJsonCondition(condition({ path: "$.fehlt", equals: 0 }), answer).reason).toBe(
      "Pfad fehlt in der Antwort",
    );
    expect(evaluateJsonCondition(condition({ path: "$.treffer", min: 12 }), answer).reason).toBe(
      "Wert ist 12",
    );
  });
});
