import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FixtureSourceSchema, StoredQuerySchema } from "../domain/fixtures.js";
import { createResolver, DummyResolver } from "./resolvers.js";

function query(input: Record<string, unknown>, id = "q") {
  return { ...StoredQuerySchema.parse({ source: "s", version: 1, ...input }), id };
}

describe("fixture resolvers (issue #93)", () => {
  let dir: string;
  let server: Server;
  let url: string;
  const requests: { method?: string; url?: string; auth?: string; body: string }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-fixtures-"));
    await writeFile(
      path.join(dir, "aussteller.json"),
      JSON.stringify({ rows: [{ name: "Gartenhelden GmbH", stand: "B12" }] }),
    );
    await writeFile(path.join(dir, "aussteller.yaml"), "- name: Rasenprofi AG\n  stand: C4\n");
    await writeFile(
      path.join(dir, "zeilen.mjs"),
      "process.stdout.write(JSON.stringify({ rows: process.argv.slice(2).map((name) => ({ name })) }));\n",
    );
    await writeFile(
      path.join(dir, "kaputt.mjs"),
      "process.stderr.write('Datenbank nicht erreichbar'); process.exit(3);\n",
    );
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          method: request.method,
          url: request.url,
          auth: request.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ hits: { hits: [{ _source: { name: "Index GmbH" } }] } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("reads rows from a JSON or YAML file next to aiqa.yaml", async () => {
    const json = createResolver(
      FixtureSourceSchema.parse({ type: "file", path: "aussteller.json" }),
      {
        dir,
        env: {},
      },
    );
    expect(await json.rows(query({ rows: "$.rows" }))).toEqual([
      { name: "Gartenhelden GmbH", stand: "B12" },
    ]);
    const yaml = createResolver(
      FixtureSourceSchema.parse({ type: "file", path: "aussteller.yaml" }),
      {
        dir,
        env: {},
      },
    );
    expect((await yaml.rows(query({}))).map((row) => row.name)).toEqual(["Rasenprofi AG"]);
  });

  it("sends the stored request to an http source with its auth and reads the rows", async () => {
    const resolver = createResolver(
      FixtureSourceSchema.parse({
        type: "http",
        endpoint: url,
        auth: { type: "bearer", token: "${AIQA_FIXTURE_TOKEN}" },
      }),
      { dir, env: { AIQA_FIXTURE_TOKEN: "AIQAFAKE-fixture" } },
    );
    const rows = await resolver.rows(
      query({
        request: { path: "/messe/_search", body: '{"query": {"term": {"halle": 3}}}' },
        rows: "$.hits.hits[*]._source",
      }),
    );
    expect(rows).toEqual([{ name: "Index GmbH" }]);
    expect(requests.at(-1)).toEqual({
      method: "POST",
      url: "/messe/_search",
      auth: "Bearer AIQAFAKE-fixture",
      body: '{"query": {"term": {"halle": 3}}}',
    });
  });

  it("runs a script source without a shell, with the arguments of the query", async () => {
    const resolver = createResolver(
      FixtureSourceSchema.parse({ type: "script", command: [process.execPath, "zeilen.mjs"] }),
      { dir, env: {} },
    );
    const rows = await resolver.rows(query({ args: ["Eins", "Zwei; rm -rf /"], rows: "$.rows" }));
    expect(rows.map((row) => row.name)).toEqual(["Eins", "Zwei; rm -rf /"]);
  });

  it("names exit code and stderr of a failing script", async () => {
    const resolver = createResolver(
      FixtureSourceSchema.parse({ type: "script", command: [process.execPath, "kaputt.mjs"] }),
      { dir, env: {} },
    );
    // The reason may reach console and report: the output of the source stays out of it.
    const error = await resolver.rows(query({})).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("exit 3, Meldung auf stderr");
    expect((error as Error).message).not.toContain("Datenbank");
  });

  it("names an answer that is no JSON without repeating it", async () => {
    await writeFile(
      path.join(dir, "text.mjs"),
      "process.stdout.write('Max Mustermann, 0171 1234567');\n",
    );
    const resolver = createResolver(
      FixtureSourceSchema.parse({ type: "script", command: [process.execPath, "text.mjs"] }),
      { dir, env: {} },
    );
    const error = await resolver.rows(query({})).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("Skript antwortete nicht mit JSON");
  });

  it("answers recorded rows per query with the DummyResolver", async () => {
    const dummy = new DummyResolver({ q: [{ name: "Dummy GmbH" }] });
    expect(await dummy.rows(query({}))).toEqual([{ name: "Dummy GmbH" }]);
    await expect(dummy.rows(query({}, "andere"))).rejects.toThrow(
      /keine Zeilen für die Abfrage andere/,
    );
  });
});
