import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FixturesConfigSchema } from "../domain/fixtures.js";
import { checkMappings } from "./mapping.js";

describe("checkMappings (issue #93)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-mapping-"));
    await writeFile(path.join(dir, "felder.json"), JSON.stringify(["name", "stand", "ort.halle"]));
    await writeFile(path.join(dir, "felder.yaml"), "- name\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function config(
    bindings: Record<string, { query: string; field: string }>,
    mapping = "felder.json",
  ) {
    return FixturesConfigSchema.parse({
      sources: { index: { type: "file", path: "x.json", mapping } },
      queries: { halle3: { source: "index", version: 1, rows: "$" } },
      bindings,
    });
  }

  it("accepts fields of the mapping, as key or path", async () => {
    expect(
      await checkMappings(
        config({
          a: { query: "halle3", field: "name" },
          b: { query: "halle3", field: "$.ort.halle" },
          c: { query: "halle3", field: "$.ort[0].halle" },
        }),
        dir,
      ),
    ).toEqual([]);
  });

  it("names a field the mapping of its source does not know", async () => {
    expect(await checkMappings(config({ t: { query: "halle3", field: "telefon" } }), dir)).toEqual([
      "fixtures.bindings.t.field: Feld telefon steht nicht im Mapping felder.json der Quelle index",
    ]);
  });

  it("reads YAML and names a missing or unreadable mapping file", async () => {
    expect(
      await checkMappings(config({ a: { query: "halle3", field: "name" } }, "felder.yaml"), dir),
    ).toEqual([]);
    expect(
      await checkMappings(config({ a: { query: "halle3", field: "name" } }, "fehlt.json"), dir),
    ).toEqual([
      "fixtures.sources.index.mapping: fehlt.json nicht lesbar, erwartet eine Liste von Feldnamen",
    ]);
  });

  it("checks nothing for sources without a mapping", async () => {
    const plain = FixturesConfigSchema.parse({
      sources: { index: { type: "file", path: "x.json" } },
      queries: { halle3: { source: "index", version: 1, rows: "$" } },
      bindings: { t: { query: "halle3", field: "irgendwas" } },
    });
    expect(await checkMappings(plain, dir)).toEqual([]);
  });
});
