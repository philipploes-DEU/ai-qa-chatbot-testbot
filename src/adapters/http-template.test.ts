import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MockTarget, startMockTarget } from "../../examples/mock-target/server.js";
import { type TargetConfig, TargetConfigSchema } from "../domain/target-config.js";
import { HttpStatusError } from "./errors.js";
import { HttpTemplateAdapter } from "./http-template.js";
import { ResponsePathError } from "./response-path.js";

/**
 * Echo server for body and cookie sessions: answers with the session it received in the body
 * or cookie and assigns one on the first call.
 */
function startEcho(): Promise<{ url: string; server: Server }> {
  let issued = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
      const path = request.url ?? "/";
      if (path === "/body") {
        const session =
          typeof body.session === "string" && body.session !== ""
            ? body.session
            : `server-${String(++issued)}`;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ answer: { text: `echo:${String(body.message)}` }, session }));
      } else if (path === "/cookie") {
        const cookie = request.headers.cookie ?? "";
        const match = /sid=([^;]+)/.exec(cookie);
        const sid = match?.[1] ?? `cookie-${String(++issued)}`;
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": `sid=${sid}; Path=/; HttpOnly`,
        });
        response.end(JSON.stringify({ reply: `sid:${sid}` }));
      } else if (path === "/merge") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ reply: "angebot", received: body, offer: { ids: ["d-1", "d-2"] } }),
        );
      } else if (path === "/text") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("kein json");
      } else if (path === "/get") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ reply: `GET ${request.method ?? ""}` }));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${String(port)}`, server });
    });
  });
}

function headerTarget(endpoint: string): TargetConfig {
  return TargetConfigSchema.parse({
    name: "mock-http",
    adapter: "http",
    endpoint,
    rateLimit: { requestsPerMinute: 100000 },
    timeouts: { requestMs: 2000, dialogMs: 5000 },
    request: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"messages": {{turns}}}',
      responsePath: "$.reply",
    },
    session: { mode: "header", key: "X-Session-Id" },
  });
}

describe("HttpTemplateAdapter", () => {
  let mock: MockTarget;
  let echo: { url: string; server: Server };

  beforeAll(async () => {
    mock = await startMockTarget();
    echo = await startEcho();
  });

  afterAll(async () => {
    await mock.close();
    await new Promise<void>((resolve) => {
      echo.server.close(() => {
        resolve();
      });
    });
  });

  it("renders the template, sends it and reads the answer at the response path", async () => {
    const adapter = new HttpTemplateAdapter(headerTarget(`${mock.url}/chat`), { env: {} });
    expect(adapter.name).toBe("mock-http");
    const response = await adapter.send([
      { role: "user", content: "Wie lauten die Öffnungszeiten des Kundenservice?" },
    ]);
    expect(response.content).toContain("Montag bis Freitag von 9 bis 17 Uhr");
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.raw).toMatchObject({ status: 200, attempts: 1 });
    expect(response.status).toBe(200);
  });

  it("merges follow-up fields into the JSON body and hands the parsed answer back", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/merge`),
      session: undefined,
      request: { body: '{"query": "{{input}}"}', responsePath: "$.reply" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    expect(adapter.supportsFollowUps).toBe(true);
    const response = await adapter.send([{ role: "user", content: "Alle Filialen?" }], undefined, {
      bodyMerge: { pageIds: ["d-1", "d-2"], mode: "deep" },
    });
    expect(response.content).toBe("angebot");
    expect(response.data).toMatchObject({
      received: {
        query: "Alle Filialen?",
        pageIds: ["d-1", "d-2"],
        mode: "deep",
      },
      offer: { ids: ["d-1", "d-2"] },
    });
  });

  it("fills {{vars.name}} from the case over the defaults of the target", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/merge`),
      session: undefined,
      request: {
        body: '{"query": "{{input}}", "mandateId": "{{vars.mandate}}", "k": "{{vars.k}}"}',
        responsePath: "$.reply",
        vars: { mandate: "m-a", k: "20" },
      },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    expect(adapter.supportsVars).toBe(true);
    expect(adapter.requiredVars()).toEqual([]);
    const response = await adapter.send([{ role: "user", content: "Frage" }], undefined, {
      vars: { mandate: "m-b" },
    });
    expect(response.data).toMatchObject({
      received: { query: "Frage", mandateId: "m-b", k: "20" },
    });
  });

  it("names the variables a template needs that have no default", () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/merge`),
      session: undefined,
      request: {
        headers: { "x-mandat": "{{vars.mandate}}" },
        body: '{"query": "{{input}}", "k": "{{vars.k}}"}',
        responsePath: "$.reply",
        vars: { k: "20" },
      },
    });
    expect(new HttpTemplateAdapter(target, { env: {} }).requiredVars()).toEqual(["mandate"]);
  });

  it("refuses follow-up fields when the body template is no JSON object", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/merge`),
      session: undefined,
      request: { body: "query={{input}}", responsePath: "$.reply" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    await expect(
      adapter.send([{ role: "user", content: "x" }], undefined, { bodyMerge: { a: 1 } }),
    ).rejects.toThrow(/bodyMerge.*JSON/);
  });

  it("fills {{input}} with the last user turn, escaped for JSON", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${mock.url}/chat`),
      request: {
        body: '{"message": "{{input}}"}',
        responsePath: "reply",
      },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const response = await adapter.send([
      { role: "user", content: "Ich möchte meine Bestellung ändern." },
      { role: "assistant", content: "Gern. Wie lautet Ihre Bestellnummer?" },
      { role: "user", content: "GH-2026-4711, bitte die Lieferadresse auf Beelitz ändern." },
    ]);
    expect(response.content).toContain("GH-2026-4711");
    const quoted = await adapter.send([{ role: "user", content: 'Sag "Hallo"\nbitte' }]);
    expect(quoted.content).toContain("keine Informationen");
  });

  it("keeps a header session across turns", async () => {
    const adapter = new HttpTemplateAdapter(headerTarget(`${mock.url}/chat`), { env: {} });
    const session = await adapter.startSession();
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    await adapter.send([{ role: "user", content: "Ich heiße Jonas." }], session);
    const recall = await adapter.send([{ role: "user", content: "Wie heiße ich?" }], session);
    expect(recall.content).toBe("Du heißt Jonas.");

    const other = await adapter.startSession();
    const stranger = await adapter.send([{ role: "user", content: "Wie heiße ich?" }], other);
    expect(stranger.content).toContain("noch nicht gesagt");

    const none = await adapter.send([{ role: "user", content: "Wie heiße ich?" }]);
    expect(none.content).toContain("noch nicht gesagt");
    await adapter.endSession(session);
  });

  it("adopts a session the target assigns in the response body", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/body`),
      request: {
        body: '{"message": "{{input}}", "session": "{{session}}"}',
        responsePath: "$.answer.text",
      },
      session: { mode: "body", key: "session" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const session = await adapter.startSession();
    const first = await adapter.send([{ role: "user", content: "eins" }], session);
    expect(first.content).toBe("echo:eins");
    expect(first.raw).toMatchObject({ session: session });

    const second = await adapter.send([{ role: "user", content: "zwei" }], session);
    expect(second.raw).toMatchObject({ session: session });
  });

  it("stores and sends a cookie session", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/cookie`),
      request: { body: '{"message": "{{input}}"}', responsePath: "$.reply" },
      session: { mode: "cookie", key: "sid" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const session = await adapter.startSession();
    const first = await adapter.send([{ role: "user", content: "a" }], session);
    const second = await adapter.send([{ role: "user", content: "b" }], session);
    expect(first.content).toMatch(/^sid:cookie-\d+$/);
    expect(second.content).toBe(first.content);

    const other = await adapter.startSession();
    const third = await adapter.send([{ role: "user", content: "c" }], other);
    expect(third.content).not.toBe(first.content);
  });

  it("sends no body with GET", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/get`),
      request: { method: "GET", body: "{{input}}", responsePath: "$.reply" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const response = await adapter.send([{ role: "user", content: "x" }]);
    expect(response.content).toBe("GET GET");
  });

  it("fails with the path and an excerpt when the answer field is missing", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${mock.url}/chat`),
      request: { body: '{"message": "{{input}}"}', responsePath: "$.answer" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const error = await adapter
      .send([{ role: "user", content: "Hallo" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResponsePathError);
    expect((error as Error).message).toContain("$.answer");
    expect((error as Error).message).toContain('"reply"');
  });

  it("fails when the answer is not JSON", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${echo.url}/text`),
      request: { body: "{}", responsePath: "$.reply" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    await expect(adapter.send([{ role: "user", content: "Hallo" }])).rejects.toThrow(
      /kein JSON.*kein json/,
    );
  });

  it("passes HTTP errors with status and excerpt through", async () => {
    const target = TargetConfigSchema.parse({
      ...headerTarget(`${mock.url}/nirgendwo`),
      rateLimit: { requestsPerMinute: 100000, backoff: "none" },
    });
    const adapter = new HttpTemplateAdapter(target, { env: {} });
    const error = await adapter
      .send([{ role: "user", content: "Hallo" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as Error).message).toMatch(/^http 404: .*nirgendwo/);
  });

  it("requires a user turn", async () => {
    const adapter = new HttpTemplateAdapter(headerTarget(`${mock.url}/chat`), { env: {} });
    await expect(adapter.send([{ role: "assistant", content: "Hallo" }])).rejects.toThrow(
      /role user/,
    );
  });

  it("refuses a target without request template or endpoint", () => {
    const target = TargetConfigSchema.parse({ name: "d", adapter: "dummy" });
    expect(() => new HttpTemplateAdapter(target, { env: {} })).toThrow(/request/);
  });
});
