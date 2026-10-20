import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MockTarget, startMockTarget } from "../../examples/mock-target/server.js";
import { MemoryResultStore } from "../../tests/helpers/memory-store.js";
import { createDefaultChecks } from "../checks/run-checks.js";
import { GoldsetSchema } from "../domain/goldset.js";
import { PlanSchema } from "../domain/plan.js";
import { type TargetConfig, TargetConfigSchema } from "../domain/target-config.js";
import { runPlan } from "../runner/run-plan.js";
import { HttpStatusError } from "./errors.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

interface Captured {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

/** Records requests and answers in the shapes providers actually send. */
function startProvider(): Promise<{ url: string; server: Server; requests: Captured[] }> {
  const requests: Captured[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
      const path = request.url ?? "/";
      requests.push({ path, headers: request.headers, body });
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (path === "/parts/chat/completions") {
        json(200, {
          choices: [
            {
              message: {
                role: "assistant",
                content: [
                  { type: "text", text: "Teil eins. " },
                  { type: "text", text: "Teil zwei." },
                ],
              },
              finish_reason: "stop",
            },
          ],
        });
      } else if (path === "/empty/chat/completions") {
        json(200, { choices: [] });
      } else if (path === "/nousage/chat/completions") {
        json(200, { choices: [{ message: { role: "assistant", content: "ohne usage" } }] });
      } else if (path === "/error/chat/completions") {
        json(401, { error: { message: "Invalid API key", type: "invalid_request_error" } });
      } else {
        json(404, { error: "unbekannt" });
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${String(port)}`, server, requests });
    });
  });
}

function target(endpoint: string, overrides: Record<string, unknown> = {}): TargetConfig {
  return TargetConfigSchema.parse({
    name: "bot",
    adapter: "openai-compatible",
    endpoint,
    rateLimit: { requestsPerMinute: 100000, backoff: "none" },
    timeouts: { requestMs: 2000, dialogMs: 5000 },
    openai: { model: "gartenhelden-mock" },
    ...overrides,
  });
}

describe("OpenAiCompatibleAdapter", () => {
  let mock: MockTarget;
  let provider: { url: string; server: Server; requests: Captured[] };

  beforeAll(async () => {
    mock = await startMockTarget();
    provider = await startProvider();
  });

  afterAll(async () => {
    await mock.close();
    await new Promise<void>((resolve) => {
      provider.server.close(() => {
        resolve();
      });
    });
  });

  it("posts chat completions to the base url and reads text and tokens", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${mock.url}/v1`), { env: {} });
    expect(adapter.name).toBe("bot");
    const response = await adapter.send([
      { role: "user", content: "Was kostet der Versand nach Österreich?" },
    ]);
    expect(response.content).toContain("9,90");
    expect(response.tokens).toEqual({ input: 6, output: 9 });
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.raw).toMatchObject({ model: "gartenhelden-mock", attempts: 1 });
  });

  it("accepts an endpoint that already names chat/completions and a trailing slash", async () => {
    for (const endpoint of [`${mock.url}/v1/chat/completions`, `${mock.url}/v1/`]) {
      const adapter = new OpenAiCompatibleAdapter(target(endpoint), { env: {} });
      const response = await adapter.send([
        { role: "user", content: "Was kostet der Versand nach Österreich?" },
      ]);
      expect(response.content).toContain("9,90");
    }
  });

  it("sends the whole dialog, the model and the optional settings, with the system prompt first", async () => {
    const adapter = new OpenAiCompatibleAdapter(
      target(`${provider.url}/nousage`, {
        auth: { type: "bearer", token: "${AIQA_TARGET_TOKEN}" },
        openai: {
          model: "klein",
          systemPrompt: "Du bist knapp.",
          temperature: 0.2,
          maxTokens: 50,
        },
      }),
      { env: { AIQA_TARGET_TOKEN: "AIQAFAKE" } },
    );
    const response = await adapter.send([
      { role: "user", content: "Ich möchte meine Bestellung ändern." },
      { role: "assistant", content: "Gern. Wie lautet Ihre Bestellnummer?" },
      { role: "user", content: "GH-2026-4711" },
    ]);
    expect(response.content).toBe("ohne usage");
    expect(response.status).toBe(200);
    expect(response.tokens).toBeUndefined();

    const sent = provider.requests.at(-1);
    expect(sent?.path).toBe("/nousage/chat/completions");
    expect(sent?.headers.authorization).toBe("Bearer AIQAFAKE");
    expect(sent?.headers["content-type"]).toBe("application/json");
    expect(sent?.body).toEqual({
      model: "klein",
      temperature: 0.2,
      max_tokens: 50,
      stream: false,
      messages: [
        { role: "system", content: "Du bist knapp." },
        { role: "user", content: "Ich möchte meine Bestellung ändern." },
        { role: "assistant", content: "Gern. Wie lautet Ihre Bestellnummer?" },
        { role: "user", content: "GH-2026-4711" },
      ],
    });
  });

  it("keeps a system turn from the case when no system prompt is configured", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${provider.url}/nousage`), { env: {} });
    await adapter.send([
      { role: "system", content: "Aus dem Fall." },
      { role: "user", content: "Hallo" },
    ]);
    const sent = provider.requests.at(-1);
    expect(sent?.body.messages).toEqual([
      { role: "system", content: "Aus dem Fall." },
      { role: "user", content: "Hallo" },
    ]);
  });

  it("joins content parts into one text", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${provider.url}/parts`), { env: {} });
    const response = await adapter.send([{ role: "user", content: "x" }]);
    expect(response.content).toBe("Teil eins. Teil zwei.");
  });

  it("fails with an excerpt when the answer has no choices", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${provider.url}/empty`), { env: {} });
    await expect(adapter.send([{ role: "user", content: "x" }])).rejects.toThrow(
      /choices.*\{"choices":\[\]\}/,
    );
  });

  it("passes provider errors through with status and message", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${provider.url}/error`), { env: {} });
    const error = await adapter
      .send([{ role: "user", content: "x" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as Error).message).toContain("http 401");
    expect((error as Error).message).toContain("Invalid API key");
  });

  it("requires a user turn and the openai block", async () => {
    const adapter = new OpenAiCompatibleAdapter(target(`${mock.url}/v1`), { env: {} });
    await expect(adapter.send([{ role: "system", content: "x" }])).rejects.toThrow(/role user/);
    const dummy = TargetConfigSchema.parse({ name: "d", adapter: "dummy" });
    expect(() => new OpenAiCompatibleAdapter(dummy, { env: {} })).toThrow(/openai/);
  });

  it("writes the token numbers into the iteration when the runner uses it", async () => {
    const goldset = GoldsetSchema.parse({
      id: "g",
      name: "G",
      owner: "QA",
      cases: [
        {
          id: "versand",
          kind: "qa",
          input: "Was kostet der Versand nach Österreich?",
          expected: { mustContain: ["9,90"] },
        },
      ],
    });
    const plan = PlanSchema.parse({
      id: "p",
      createdAt: "2026-10-11T00:00:00Z",
      target: "bot",
      goldsets: ["g.yaml"],
      caseRefs: [{ caseId: "versand", iterations: 2 }],
      budget: { maxCalls: 2 },
    });
    const config = target(`${mock.url}/v1`);
    const store = new MemoryResultStore();
    const summary = await runPlan({
      plan,
      goldsets: [goldset],
      target: config,
      adapter: new OpenAiCompatibleAdapter(config, { env: {} }),
      checks: createDefaultChecks({}),
      store,
      runId: "run-openai",
    });
    expect(summary.failedIterations).toBe(0);
    expect(store.iterations.map((iteration) => iteration.tokens)).toEqual([
      { input: 6, output: 9 },
      { input: 6, output: 9 },
    ]);
  });
});
