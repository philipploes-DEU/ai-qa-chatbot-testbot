import { describe, expect, it } from "vitest";

import { fieldOf, readRows } from "./rows.js";

const search = {
  hits: {
    hits: [
      { _source: { name: "Gartenhelden GmbH", stand: "B12", halle: 3 } },
      { _source: { name: "Rasenprofi AG", stand: "C4", halle: 3 } },
    ],
  },
};

describe("readRows (issue #93)", () => {
  it("projects every element with [*]", () => {
    expect(readRows(search, "$.hits.hits[*]._source").map((row) => row.name)).toEqual([
      "Gartenhelden GmbH",
      "Rasenprofi AG",
    ]);
  });

  it("takes an array at a plain path and the payload itself at $", () => {
    expect(readRows({ rows: [{ a: 1 }] }, "$.rows")).toEqual([{ a: 1 }]);
    expect(readRows([{ a: 1 }, { a: 2 }], "$")).toHaveLength(2);
  });

  it("refuses a path that does not end at a list of objects", () => {
    expect(() => readRows({ rows: { a: 1 } }, "$.rows")).toThrow(/keine Liste/);
    expect(() => readRows({ rows: [1, 2] }, "$.rows")).toThrow(/keine Objekte/);
    expect(() => readRows({}, "$.fehlt[*].x")).toThrow(/keine Liste/);
  });
});

describe("fieldOf (issue #93)", () => {
  it("reads a key or a path and turns numbers into text", () => {
    const row = { name: "Gartenhelden GmbH", ort: { halle: 3 } };
    expect(fieldOf(row, "name")).toBe("Gartenhelden GmbH");
    expect(fieldOf(row, "$.ort.halle")).toBe("3");
  });

  it("returns undefined for a missing field and refuses lists and objects", () => {
    expect(fieldOf({ name: "x" }, "stand")).toBeUndefined();
    expect(() => fieldOf({ ort: { halle: 3 } }, "ort")).toThrow(/kein einfacher Wert/);
  });
});
