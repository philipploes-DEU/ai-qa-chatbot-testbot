import { describe, expect, it } from "vitest";

import { type BindingFile, FixturesConfigSchema } from "../domain/fixtures.js";
import { DummyResolver } from "./resolvers.js";
import { changedBindings, resolveBindings, withPrevious } from "./resolve.js";

const config = FixturesConfigSchema.parse({
  sources: { index: { type: "file", path: "egal.json" } },
  queries: {
    halle3: { source: "index", version: 2, approvedBy: "Fachbereich Messe", rows: "$" },
    leer: { source: "index", version: 1, rows: "$" },
  },
  bindings: {
    aussteller_1: { query: "halle3", row: 0, field: "name" },
    stand_1: { query: "halle3", row: 0, field: "stand" },
    aussteller_2: { query: "halle3", row: 1, field: "name" },
    ort_1: { query: "halle3", row: 0, field: "ort" },
    fehlt_1: { query: "halle3", row: 0, field: "telefon" },
    nichts_1: { query: "leer", field: "name" },
  },
});

const rows = {
  halle3: [{ name: "Gartenhelden GmbH", stand: "B12", ort: { halle: 3 } }],
  leer: [],
};

describe("resolveBindings (issue #93)", () => {
  it("binds values from the rows and says why others stay unresolved", async () => {
    const resolver = new DummyResolver(rows);
    let calls = 0;
    const binding = await resolveBindings({
      config,
      target: "messe",
      needed: ["aussteller_1", "stand_1", "aussteller_2", "ort_1", "fehlt_1", "nichts_1", "neu_1"],
      resolverFor: () => ({
        type: "dummy",
        rows: (query) => {
          calls++;
          return resolver.rows(query);
        },
      }),
      now: () => new Date("2026-10-20T08:00:00.000Z"),
    });
    expect(binding.createdAt).toBe("2026-10-20T08:00:00.000Z");
    const byName = new Map(binding.entries.map((entry) => [entry.placeholder, entry]));
    expect(byName.get("aussteller_1")).toMatchObject({
      status: "bound",
      value: "Gartenhelden GmbH",
      query: "halle3",
      queryVersion: "2",
      source: "index",
    });
    expect(byName.get("stand_1")?.value).toBe("B12");
    expect(byName.get("aussteller_2")).toMatchObject({
      status: "unresolved",
      reason: "die Abfrage halle3 lieferte 1 Zeile, gebraucht wird Zeile 1",
    });
    expect(byName.get("ort_1")?.reason).toContain("kein einfacher Wert");
    expect(byName.get("fehlt_1")?.reason).toBe("Feld telefon fehlt in Zeile 0 der Abfrage halle3");
    expect(byName.get("nichts_1")?.reason).toBe(
      "die Abfrage leer lieferte 0 Zeilen, gebraucht wird Zeile 0",
    );
    expect(byName.get("neu_1")).toEqual({
      placeholder: "neu_1",
      status: "unresolved",
      reason: "keine Bindung unter fixtures.bindings in aiqa.yaml",
    });
    // Each stored query runs once, however many placeholders use it.
    expect(calls).toBe(2);
  });

  it("marks every placeholder of a failing source unresolved with the error", async () => {
    const binding = await resolveBindings({
      config,
      target: "messe",
      needed: ["aussteller_1"],
      resolverFor: () => ({
        type: "kaputt",
        rows: () => Promise.reject(new Error("Index nicht erreichbar")),
      }),
    });
    expect(binding.entries[0]).toMatchObject({
      status: "unresolved",
      reason: "Abfrage halle3 gescheitert: Index nicht erreichbar",
    });
  });

  it("names stored queries without approval", async () => {
    const notes: string[] = [];
    await resolveBindings({
      config,
      target: "messe",
      needed: ["nichts_1"],
      resolverFor: () => new DummyResolver(rows),
      onNote: (note) => notes.push(note),
    });
    expect(notes).toEqual(["Abfrage leer (Version 1) ist nicht abgenommen: approvedBy fehlt."]);
  });
});

describe("withPrevious (issue #93)", () => {
  it("adds the value of the run before to every placeholder", () => {
    const current: BindingFile = {
      createdAt: "2026-10-20T08:00:00.000Z",
      target: "messe",
      entries: [
        { placeholder: "a", status: "bound", value: "neu" },
        { placeholder: "b", status: "bound", value: "gleich" },
        { placeholder: "c", status: "bound", value: "erstmals" },
      ],
    };
    const before: BindingFile = {
      createdAt: "2026-10-19T08:00:00.000Z",
      target: "messe",
      entries: [
        { placeholder: "a", status: "bound", value: "alt" },
        { placeholder: "b", status: "bound", value: "gleich" },
      ],
    };
    expect(withPrevious(current, before).entries.map((entry) => entry.previous)).toEqual([
      "alt",
      "gleich",
      undefined,
    ]);
    expect(withPrevious(current, undefined).entries[0]?.previous).toBeUndefined();
  });
});

describe("changedBindings (issue #93)", () => {
  const file = (entries: BindingFile["entries"]): BindingFile => ({
    createdAt: "2026-10-20T08:00:00.000Z",
    target: "messe",
    entries,
  });

  it("names placeholders whose value differs between two runs, without the values", () => {
    const base = file([
      { placeholder: "a", query: "halle3", queryVersion: "1", status: "bound", value: "alt" },
      { placeholder: "b", status: "bound", value: "gleich" },
      { placeholder: "c", query: "halle3", queryVersion: "1", status: "bound", value: "weg" },
    ]);
    const head = file([
      { placeholder: "a", query: "halle3", queryVersion: "2", status: "bound", value: "neu" },
      { placeholder: "b", status: "bound", value: "gleich" },
      { placeholder: "c", status: "unresolved", reason: "fehlt" },
      { placeholder: "d", status: "bound", value: "neu dabei" },
    ]);
    expect(changedBindings(base, head)).toEqual([
      { placeholder: "a", query: "halle3", queryVersion: "2" },
      { placeholder: "c", query: "halle3", queryVersion: "1" },
      { placeholder: "d" },
    ]);
  });

  it("has nothing to say when neither run used placeholders", () => {
    expect(changedBindings(null, null)).toEqual([]);
  });
});
