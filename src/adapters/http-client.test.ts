import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TargetConfigSchema } from "../domain/target-config.js";
import { HttpStatusError, TimeoutError } from "./errors.js";
import { TargetHttpClient } from "./http-client.js";

interface Echo {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Test server: /echo mirrors the request, /flaky fails twice with 503 before it answers,
 * /limited answers 429 with Retry-After once, /slow answers after 300 ms, /broken answers 500,
 * /always-503 never recovers.
 */
function startServer(): Promise<{ url: string; server: Server; reset: () => void }> {
  let flakyCalls = 0;
  let limitedCalls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = request.url ?? "/";
      const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(JSON.stringify(payload));
      };
      if (path === "/echo") {
        json(200, { method: request.method ?? "", headers: request.headers, body } satisfies Echo, {
          "x-session-id": "sitzung-1",
        });
      } else if (path === "/flaky") {
        flakyCalls++;
        if (flakyCalls <= 2) json(503, { error: "gleich wieder da" });
        else json(200, { reply: "jetzt" });
      } else if (path === "/limited") {
        limitedCalls++;
        if (limitedCalls === 1) json(429, { error: "zu viel" }, { "retry-after": "0" });
        else json(200, { reply: "langsamer bitte" });
      } else if (path === "/slow") {
        setTimeout(() => {
          json(200, { reply: "spät" });
        }, 300);
      } else if (path === "/broken") {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end("Interner Fehler: " + "x".repeat(500));
      } else if (path === "/always-503") {
        json(503, { error: "nie" });
      } else {
        json(404, { error: "unbekannt" });
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        server,
        reset: () => {
          flakyCalls = 0;
          limitedCalls = 0;
        },
      });
    });
  });
}

const baseTarget = {
  name: "test",
  adapter: "http",
  endpoint: "http://127.0.0.1:1/",
  request: { body: "{}", responsePath: "$.reply" },
  rateLimit: { requestsPerMinute: 100000, concurrency: 1, backoff: "exponential", maxRetries: 3 },
  timeouts: { requestMs: 2000, dialogMs: 5000 },
};

describe("TargetHttpClient", () => {
  let base: string;
  let server: Server;
  let reset: () => void;

  beforeAll(async () => {
    ({ url: base, server, reset } = await startServer());
  });

  beforeEach(() => {
    reset();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("sends auth headers resolved from the environment and returns body, headers and latency", async () => {
    const target = TargetConfigSchema.parse({
      ...baseTarget,
      auth: { type: "bearer", token: "${AIQA_TARGET_TOKEN}" },
    });
    const client = new TargetHttpClient(target, { env: { AIQA_TARGET_TOKEN: "AIQAFAKE-token" } });
    const response = await client.request(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-custom": "ja" },
      body: '{"message":"hallo"}',
    });

    expect(response.status).toBe(200);
    expect(response.attempts).toBe(1);
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.headers.get("x-session-id")).toBe("sitzung-1");
    const echo = response.json() as Echo;
    expect(echo.method).toBe("POST");
    expect(echo.body).toBe('{"message":"hallo"}');
    expect(echo.headers.authorization).toBe("Bearer AIQAFAKE-token");
    expect(echo.headers["x-custom"]).toBe("ja");
  });

  it("fails early with the variable name when a credential is missing", () => {
    const target = TargetConfigSchema.parse({
      ...baseTarget,
      auth: { type: "bearer", token: "${AIQA_TARGET_TOKEN}" },
    });
    expect(() => new TargetHttpClient(target, { env: {} })).toThrow(/AIQA_TARGET_TOKEN/);
  });

  it("retries 503 with backoff and reports the attempts", async () => {
    const client = new TargetHttpClient(TargetConfigSchema.parse(baseTarget), {
      env: {},
      baseDelayMs: 5,
    });
    const response = await client.request(`${base}/flaky`, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(response.attempts).toBe(3);
    expect((response.json() as { reply: string }).reply).toBe("jetzt");
  });

  it("honours Retry-After on 429", async () => {
    const client = new TargetHttpClient(TargetConfigSchema.parse(baseTarget), {
      env: {},
      baseDelayMs: 5,
    });
    const response = await client.request(`${base}/limited`, { method: "POST", body: "{}" });
    expect(response.attempts).toBe(2);
  });

  it("does not retry with backoff none and exposes status and body excerpt", async () => {
    const target = TargetConfigSchema.parse({
      ...baseTarget,
      rateLimit: { ...baseTarget.rateLimit, backoff: "none" },
    });
    const client = new TargetHttpClient(target, { env: {} });
    const error = await client
      .request(`${base}/flaky`, { method: "POST", body: "{}" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(503);
    expect((error as HttpStatusError).message).toBe('http 503: {"error":"gleich wieder da"}');
  });

  it("does not retry 500 and truncates the excerpt", async () => {
    const client = new TargetHttpClient(TargetConfigSchema.parse(baseTarget), { env: {} });
    const error = await client
      .request(`${base}/broken`, { method: "POST", body: "{}" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(500);
    expect((error as HttpStatusError).message).toMatch(/^http 500: Interner Fehler: x+\.\.\.$/);
    expect((error as HttpStatusError).message.length).toBeLessThan(260);
  });

  it("aborts a single attempt after timeouts.requestMs", async () => {
    const target = TargetConfigSchema.parse({
      ...baseTarget,
      timeouts: { requestMs: 50, dialogMs: 5000 },
    });
    const client = new TargetHttpClient(target, { env: {} });
    const error = await client
      .request(`${base}/slow`, { method: "POST", body: "{}" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).scope).toBe("request");
    expect((error as TimeoutError).message).toContain("50 ms");
  });

  it("bounds attempts and waits of one dialog by timeouts.dialogMs", async () => {
    const target = TargetConfigSchema.parse({
      ...baseTarget,
      rateLimit: { ...baseTarget.rateLimit, maxRetries: 10 },
      timeouts: { requestMs: 1000, dialogMs: 1000 },
    });
    const client = new TargetHttpClient(target, { env: {}, baseDelayMs: 400 });
    const error = await client
      .request(`${base}/always-503`, { method: "POST", body: "{}" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).scope).toBe("dialog");
  });

  it("turns a refused connection into an error with the reason", async () => {
    const client = new TargetHttpClient(TargetConfigSchema.parse(baseTarget), { env: {} });
    await expect(
      client.request("http://127.0.0.1:9/", { method: "POST", body: "{}" }),
    ).rejects.toThrow(/Verbindung/);
  });
});
