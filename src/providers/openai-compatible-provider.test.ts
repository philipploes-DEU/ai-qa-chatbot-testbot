import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { InvalidJsonError, ModelRefusalError } from "./json.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";

const Verdict = z.strictObject({ pass: z.boolean(), reason: z.string() });

interface Captured {
  headers: Record<string, string | string[] | undefined>;
  body: { messages: { role: string; content: string }[] } & Record<string, unknown>;
}

/** A scripted text, or a whole choice for answers without plain content (issue #83). */
type Scripted = string | { choice: Record<string, unknown> };

/** Answers the scripted texts in order, with usage numbers, and records the requests. */
function startModel(): Promise<{
  url: string;
  server: Server;
  requests: Captured[];
  script: Scripted[];
}> {
  const requests: Captured[] = [];
  const script: Scripted[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Captured["body"],
      });
      const next = script.shift() ?? "{}";
      const choice =
        typeof next === "string" ? { message: { role: "assistant", content: next } } : next.choice;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [choice],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${String(port)}/v1`, server, requests, script });
    });
  });
}

describe("OpenAiCompatibleProvider", () => {
  let model: Awaited<ReturnType<typeof startModel>>;

  beforeAll(async () => {
    model = await startModel();
  });

  beforeEach(() => {
    model.requests.length = 0;
    model.script.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      model.server.close(() => {
        resolve();
      });
    });
  });

  it("asks for JSON with the schema, validates the answer and reports tokens", async () => {
    model.script.push('Gern:\n```json\n{"pass": true, "reason": "stimmt"}\n```');
    const provider = new OpenAiCompatibleProvider({
      baseUrl: model.url,
      model: "klein",
      apiKey: "AIQAFAKE",
      temperature: 0,
      requestsPerMinute: 100000,
    });
    const result = await provider.generateJson({
      system: "Du bist der Judge.",
      prompt: "Bewerte.",
      schema: Verdict,
      schemaName: "Urteil",
      maxTokens: 200,
    });
    expect(result.value).toEqual({ pass: true, reason: "stimmt" });
    expect(result.attempts).toBe(1);
    expect(result.tokens).toEqual({ input: 100, output: 10 });
    expect(result.raw).toContain("stimmt");
    expect(provider.name).toBe("openai-compatible");
    expect(provider.model).toBe("klein");

    const sent = model.requests[0];
    expect(sent?.headers.authorization).toBe("Bearer AIQAFAKE");
    expect(sent?.body.model).toBe("klein");
    expect(sent?.body.temperature).toBe(0);
    expect(sent?.body.max_tokens).toBe(200);
    expect(sent?.body.response_format).toBeUndefined();
    expect(sent?.body.messages[0]?.role).toBe("system");
    expect(sent?.body.messages[0]?.content).toContain("Du bist der Judge.");
    expect(sent?.body.messages[0]?.content).toContain("(Urteil)");
    expect(sent?.body.messages[0]?.content).toContain('"pass"');
    expect(sent?.body.messages[1]).toEqual({ role: "user", content: "Bewerte." });
  });

  it("omits temperature and auth when not configured and can ask for json_object", async () => {
    model.script.push('{"pass": false, "reason": "nein"}');
    const provider = new OpenAiCompatibleProvider({
      baseUrl: model.url,
      model: "klein",
      responseFormat: "json_object",
      requestsPerMinute: 100000,
    });
    await provider.generateJson({ prompt: "x", schema: Verdict });
    const sent = model.requests[0];
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.body.temperature).toBeUndefined();
    expect(sent?.body.response_format).toEqual({ type: "json_object" });
  });

  it("repairs an invalid answer once with the reason and sums the tokens", async () => {
    model.script.push('{"pass": "ja"}', '{"pass": true, "reason": "jetzt"}');
    const provider = new OpenAiCompatibleProvider({
      baseUrl: model.url,
      model: "klein",
      requestsPerMinute: 100000,
    });
    const result = await provider.generateJson({ prompt: "x", schema: Verdict });
    expect(result.value).toEqual({ pass: true, reason: "jetzt" });
    expect(result.attempts).toBe(2);
    expect(result.tokens).toEqual({ input: 200, output: 20 });

    const repair = model.requests[1]?.body.messages;
    expect(repair).toHaveLength(4);
    expect(repair?.[2]).toEqual({ role: "assistant", content: '{"pass": "ja"}' });
    expect(repair?.[3]?.content).toContain("Schema verletzt");
    expect(repair?.[3]?.content).toContain("pass:");
  });

  it("gives up after the configured repairs", async () => {
    model.script.push("keine ahnung", "immer noch nicht", "{}");
    const provider = new OpenAiCompatibleProvider({
      baseUrl: model.url,
      model: "klein",
      maxRepairs: 2,
      requestsPerMinute: 100000,
    });
    const error = await provider
      .generateJson({ prompt: "x", schema: Verdict })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidJsonError);
    expect((error as Error).message).toContain("3 Versuchen");
    expect(model.requests).toHaveLength(3);
  });
  describe("refusals (issue #83)", () => {
    function provider(): OpenAiCompatibleProvider {
      return new OpenAiCompatibleProvider({
        baseUrl: model.url,
        model: "klein",
        requestsPerMinute: 100000,
      });
    }

    async function refusal(): Promise<ModelRefusalError> {
      const error = await provider()
        .generateJson({ prompt: "x", schema: Verdict })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ModelRefusalError);
      return error as ModelRefusalError;
    }

    it("reports message.refusal as a refusal with its text and without a repair", async () => {
      model.script.push({
        choice: {
          message: { role: "assistant", content: null, refusal: "Dazu kann ich nichts sagen." },
          finish_reason: "stop",
        },
      });
      const error = await refusal();
      expect(error.reason).toContain("Dazu kann ich nichts sagen.");
      expect(error.message).toContain("lehnt");
      expect(model.requests).toHaveLength(1);
    });

    it("reports a refusal content part with its text", async () => {
      model.script.push({
        choice: {
          message: {
            role: "assistant",
            content: [{ type: "refusal", refusal: "Nicht mit mir." }],
          },
          finish_reason: "stop",
        },
      });
      const error = await refusal();
      expect(error.reason).toBe("Nicht mit mir.");
    });

    it("reports finish_reason content_filter as a refusal", async () => {
      model.script.push({
        choice: { message: { role: "assistant", content: "" }, finish_reason: "content_filter" },
      });
      const error = await refusal();
      expect(error.reason).toContain("content_filter");
      expect(model.requests).toHaveLength(1);
    });

    it("reports finish_reason refusal as a refusal even with partial text", async () => {
      model.script.push({
        choice: { message: { role: "assistant", content: '{"pass": ' }, finish_reason: "refusal" },
      });
      const error = await refusal();
      expect(error.reason).toContain("refusal");
      expect(model.requests).toHaveLength(1);
    });

    it("reports an empty answer as a refusal without a repair", async () => {
      model.script.push("   ");
      const error = await refusal();
      expect(error.reason).toContain("leere Antwort");
      expect(model.requests).toHaveLength(1);
    });

    it("reports a missing content as a refusal", async () => {
      model.script.push({
        choice: { message: { role: "assistant", content: null }, finish_reason: "stop" },
      });
      const error = await refusal();
      expect(error.reason).toContain("leere Antwort");
    });

    it("recognises a refusal after a repair", async () => {
      model.script.push("kein json", "");
      await refusal();
      expect(model.requests).toHaveLength(2);
    });

    it("keeps an empty answer at the token limit an error, not a refusal", async () => {
      model.script.push({
        choice: { message: { role: "assistant", content: "" }, finish_reason: "length" },
      });
      const error = await provider()
        .generateJson({ prompt: "x", schema: Verdict })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvalidJsonError);
      expect(error).not.toBeInstanceOf(ModelRefusalError);
      expect((error as Error).message).toContain("Token-Grenze");
      expect(model.requests).toHaveLength(1);
    });

    it("keeps an answer without choices an error, not a refusal", async () => {
      model.script.push({ choice: {} });
      const error = await provider()
        .generateJson({ prompt: "x", schema: Verdict })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvalidJsonError);
      expect(error).not.toBeInstanceOf(ModelRefusalError);
    });
  });
});
