import { z } from "zod";

import { excerpt } from "../adapters/errors.js";
import { TargetHttpClient, type TargetHttpOptions } from "../adapters/http-client.js";
import { completionsUrl } from "../adapters/openai-compatible.js";
import { RateLimitSchema, TimeoutsSchema } from "../domain/target-config.js";
import { InvalidJsonError, ModelRefusalError, parseJsonWith } from "./json.js";
import type { JsonRequest, JsonResult, ModelProvider } from "./model-provider.js";

export interface OpenAiCompatibleProviderConfig {
  /** Base url of the chat completions API, for example http://localhost:11434/v1. */
  baseUrl: string;
  model: string;
  /** Sent as bearer token when set. */
  apiKey?: string;
  /** Sent when set. Current Claude models reject sampling parameters, so leave it unset there. */
  temperature?: number;
  /** Ask the API for JSON through response_format. Not every endpoint honours or accepts it. */
  responseFormat?: "none" | "json_object";
  /** Repairs after an invalid answer: the model sees the reason and answers again. */
  maxRepairs?: number;
  requestMs?: number;
  requestsPerMinute?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Completion {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string; refusal?: string }[] | null;
      refusal?: string | null;
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Stop reasons that mean the model declined, as OpenAI and compatible layers report them. */
const REFUSAL_FINISH_REASONS = new Set(["content_filter", "refusal"]);

function jsonInstruction<T>(request: JsonRequest<T>): string {
  const schema = JSON.stringify(z.toJSONSchema(request.schema));
  const name = request.schemaName === undefined ? "" : ` (${request.schemaName})`;
  return (
    `Antworte ausschließlich mit einem JSON-Dokument${name}, ohne Erklärung davor oder danach. ` +
    `Es muss diesem JSON-Schema entsprechen: ${schema}`
  );
}

function textOf(completion: Completion): string | undefined {
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return undefined;
}

/**
 * Why the model declined, or undefined when it answered (issue #83): a refusal text, a stop
 * for safety reasons, or an empty answer. An empty answer at the token limit is no refusal.
 */
function refusalOf(completion: Completion, text: string | undefined): string | undefined {
  const choice = completion.choices?.[0];
  const content = choice?.message?.content;
  const parts = Array.isArray(content) ? content.map((part) => part.refusal) : [];
  const refusal = [choice?.message?.refusal, ...parts]
    .filter((text): text is string => typeof text === "string")
    .map((text) => text.trim())
    .find((text) => text.length > 0);
  if (refusal !== undefined) return refusal;
  const finish = choice?.finish_reason ?? undefined;
  if (finish !== undefined && REFUSAL_FINISH_REASONS.has(finish)) {
    return `Abbruch durch das Modell (finish_reason ${finish})`;
  }
  if ((text ?? "").trim().length === 0 && finish !== "length") {
    return finish === undefined ? "leere Antwort" : `leere Antwort (finish_reason ${finish})`;
  }
  return undefined;
}

/**
 * ModelProvider over the chat completions format: Ollama, OpenAI, gateways and the Anthropic
 * compatibility layer. JSON comes from an instruction with the JSON schema, is validated with
 * Zod and repaired once by default. Auth, rate limit, backoff and timeouts reuse the shared
 * client of the adapters.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly url: string;
  private readonly config: OpenAiCompatibleProviderConfig;
  private readonly client: TargetHttpClient;

  constructor(config: OpenAiCompatibleProviderConfig, options: TargetHttpOptions = {}) {
    this.model = config.model;
    this.config = config;
    this.url = completionsUrl(config.baseUrl);
    const env = { AIQA_PROVIDER_KEY: config.apiKey ?? "" };
    this.client = new TargetHttpClient(
      {
        auth:
          config.apiKey === undefined
            ? { type: "none" }
            : { type: "bearer", token: "${AIQA_PROVIDER_KEY}" },
        rateLimit: RateLimitSchema.parse({
          ...(config.requestsPerMinute !== undefined
            ? { requestsPerMinute: config.requestsPerMinute }
            : {}),
        }),
        timeouts: TimeoutsSchema.parse({
          ...(config.requestMs !== undefined
            ? { requestMs: config.requestMs, dialogMs: config.requestMs * 4 }
            : {}),
        }),
      },
      { ...options, env },
    );
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const system = [request.system, jsonInstruction(request)].filter(Boolean).join("\n\n");
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: request.prompt },
    ];
    const repairs = this.config.maxRepairs ?? 1;
    const started = performance.now();
    let tokens = { input: 0, output: 0 };
    let sawUsage = false;
    let lastRaw = "";
    let lastReason = "";

    for (let attempt = 1; attempt <= repairs + 1; attempt++) {
      const response = await this.client.request(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          ...(this.config.temperature !== undefined
            ? { temperature: this.config.temperature }
            : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(this.config.responseFormat === "json_object"
            ? { response_format: { type: "json_object" } }
            : {}),
          stream: false,
          messages,
        }),
      });
      const completion = response.json() as Completion;
      if (completion.choices?.[0]?.message === undefined) {
        throw new InvalidJsonError("keine Antwort unter choices[0].message", response.text);
      }
      const raw = textOf(completion);
      const refusal = refusalOf(completion, raw);
      if (refusal !== undefined) throw new ModelRefusalError(refusal);
      if (raw === undefined || raw.trim().length === 0) {
        throw new InvalidJsonError(
          "leere Antwort, Token-Grenze erreicht (finish_reason length)",
          "",
        );
      }
      if (completion.usage !== undefined) {
        sawUsage = true;
        tokens = {
          input: tokens.input + (completion.usage.prompt_tokens ?? 0),
          output: tokens.output + (completion.usage.completion_tokens ?? 0),
        };
      }
      const parsed = parseJsonWith(request.schema, raw);
      if (parsed.ok) {
        return {
          value: parsed.value,
          raw,
          ...(sawUsage ? { tokens } : {}),
          latencyMs: performance.now() - started,
          attempts: attempt,
        };
      }
      lastRaw = raw;
      lastReason = parsed.reason;
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            `Die Antwort war ungültig: ${parsed.reason}. ` +
            "Antworte erneut, nur mit dem korrigierten JSON-Dokument.",
        },
      );
    }
    throw new InvalidJsonError(
      `${lastReason} nach ${String(repairs + 1)} Versuchen`,
      excerpt(lastRaw),
    );
  }
}
