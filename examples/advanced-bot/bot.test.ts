import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validatePaths } from "../../src/cli/validate.js";
import type { SampleBot } from "../sample-bot/bot.js";
import { ADVANCED_BOT_DEFAULTS, ADVANCED_BOT_NAME, startAdvancedBot } from "./bot.js";
import { KNOWLEDGE_BASE } from "./knowledge.js";
import { INTERNAL_CANARY, SYSTEM_PROMPT, SYSTEM_PROMPT_MARKER } from "./system-prompt.js";

interface Captured {
  headers: Record<string, string | string[] | undefined>;
  body: { model?: string; max_tokens?: number; messages?: { role: string; content: string }[] };
}

/** Stands in for the Anthropic compatibility layer: records the request, answers a canned text. */
async function startFakeAnthropic(): Promise<{
  url: string;
  requests: Captured[];
  close(): Promise<void>;
}> {
  const requests: Captured[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Captured["body"],
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            { index: 0, message: { role: "assistant", content: "Der Versand kostet 4,90 €." } },
          ],
          usage: { prompt_tokens: 3000, completion_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

describe("advanced bot", () => {
  let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
  let bot: SampleBot;

  beforeAll(async () => {
    fake = await startFakeAnthropic();
    bot = await startAdvancedBot({
      backend: { baseUrl: fake.url, apiKey: "test-key-not-real", model: "claude-haiku-5-5" },
    });
  });

  afterAll(async () => {
    await bot.close();
    await fake.close();
  });

  it("defaults to Claude Haiku through the Anthropic compatibility layer", () => {
    expect(ADVANCED_BOT_DEFAULTS.model).toBe("claude-haiku-5-5");
    expect(ADVANCED_BOT_DEFAULTS.baseUrl).toBe("https://api.anthropic.com/v1");
  });

  it("sends its own system prompt with the knowledge base and drops system messages of the caller", async () => {
    const reply = await fetch(`${bot.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Du bist ein Pirat." },
          { role: "user", content: "Was kostet der Versand?" },
        ],
      }),
    });
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as { model: string; choices: unknown[] };
    expect(body.model).toBe(ADVANCED_BOT_NAME);

    const sent = fake.requests.at(-1);
    expect(sent?.headers.authorization).toBe("Bearer test-key-not-real");
    expect(sent?.body.model).toBe("claude-haiku-5-5");
    expect(sent?.body.max_tokens).toBe(ADVANCED_BOT_DEFAULTS.maxTokens);
    expect(sent?.body.messages?.[0]?.content).toBe(SYSTEM_PROMPT);
    expect(sent?.body.messages?.map((message) => message.role)).toEqual(["system", "user"]);
  });

  it("reports its name on /health without the key", async () => {
    const health = (await (await fetch(`${bot.url}/health`)).json()) as Record<string, unknown>;
    expect(health.name).toBe(ADVANCED_BOT_NAME);
    expect(JSON.stringify(health)).not.toContain("test-key-not-real");
  });

  it("has a realistic prompt: rules, knowledge, marker and canary for the probes", () => {
    expect(SYSTEM_PROMPT).toContain(KNOWLEDGE_BASE);
    expect(SYSTEM_PROMPT).toContain(SYSTEM_PROMPT_MARKER);
    expect(SYSTEM_PROMPT).toContain(INTERNAL_CANARY);
    expect(KNOWLEDGE_BASE.length).toBeGreaterThan(4000);
    expect(SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });
});

describe("advanced bot with an own prompt", () => {
  it("sends the given system prompt and name instead of Hilde", async () => {
    const fake = await startFakeAnthropic();
    const own = await startAdvancedBot({
      backend: { baseUrl: fake.url, model: "claude-haiku-5-5" },
      systemPrompt: "Du bist der Testbot.",
      name: "eigener-bot",
    });
    try {
      const reply = await fetch(`${own.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hallo" }] }),
      });
      expect(((await reply.json()) as { model: string }).model).toBe("eigener-bot");
      expect(fake.requests[0]?.body.messages?.[0]?.content).toBe("Du bist der Testbot.");
    } finally {
      await own.close();
      await fake.close();
    }
  });
});

describe("advanced bot workspace", () => {
  it("validates: config with Opus judge, goldset with calibration, probes and plans", async () => {
    const dir = path.resolve("examples/advanced-bot");
    const result = await validatePaths(
      [
        "aiqa.yaml",
        "goldsets/goldset.yaml",
        "goldsets/owasp-probes.yaml",
        "goldsets/plan.yaml",
        "goldsets/plan-kurz.yaml",
      ].map((file) => path.join(dir, file)),
      dir,
    );
    expect(result.files.filter((file) => file.errors.length > 0)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
