import type { Tokens, Turn } from "../domain/common.js";
import type { OpenAiConfig, TargetConfig } from "../domain/target-config.js";
import { excerpt } from "./errors.js";
import { TargetHttpClient, type TargetHttpOptions } from "./http-client.js";
import { ResponsePathError } from "./response-path.js";
import type { TargetAdapter, TargetResponse } from "./target.js";

interface ContentPart {
  type?: string;
  text?: string;
}

interface Completion {
  model?: string;
  choices?: { message?: { content?: string | ContentPart[] | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Appends /chat/completions to a base url unless the endpoint already names it. */
export function completionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function textOf(content: string | ContentPart[] | null | undefined): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === undefined || part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }
  return undefined;
}

function tokensOf(usage: Completion["usage"]): Tokens | undefined {
  if (usage === undefined) return undefined;
  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input, output };
}

/**
 * Adapter `openai-compatible` (issue #4): the chat completions format that own gateways, local
 * models behind Ollama and hosting providers speak. Every call sends the whole dialog, stateless.
 * No streaming, no tool calls, no responses API. Auth, rate limit, backoff and timeouts come from
 * the shared client (issue #5).
 */
export class OpenAiCompatibleAdapter implements TargetAdapter {
  readonly name: string;
  private readonly url: string;
  private readonly openai: OpenAiConfig;
  private readonly client: TargetHttpClient;

  constructor(target: TargetConfig, options: TargetHttpOptions = {}) {
    if (target.openai === undefined || target.endpoint === undefined) {
      throw new Error(
        `Zielsystem ${target.name}: Adapter openai-compatible braucht endpoint und einen openai-Block`,
      );
    }
    this.name = target.name;
    this.url = completionsUrl(target.endpoint);
    this.openai = target.openai;
    this.client = new TargetHttpClient(target, options);
  }

  async send(turns: readonly Turn[]): Promise<TargetResponse> {
    if (!turns.some((turn) => turn.role === "user")) {
      throw new Error(
        "der Adapter openai-compatible braucht mindestens einen Gesprächszug mit role user",
      );
    }
    const messages =
      this.openai.systemPrompt === undefined
        ? [...turns]
        : [
            { role: "system", content: this.openai.systemPrompt },
            ...turns.filter((turn) => turn.role !== "system"),
          ];
    const response = await this.client.request(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.openai.model,
        ...(this.openai.temperature !== undefined ? { temperature: this.openai.temperature } : {}),
        ...(this.openai.maxTokens !== undefined ? { max_tokens: this.openai.maxTokens } : {}),
        stream: false,
        messages,
      }),
    });

    let completion: Completion;
    try {
      completion = response.json() as Completion;
    } catch {
      throw new ResponsePathError(`Antwort ist kein JSON: ${excerpt(response.text)}`);
    }
    const content = textOf(completion.choices?.[0]?.message?.content);
    if (content === undefined) {
      throw new ResponsePathError(
        `Antwort enthält keinen Text unter choices[0].message.content: ${excerpt(response.text)}`,
      );
    }
    const tokens = tokensOf(completion.usage);
    return {
      content,
      raw: {
        status: response.status,
        attempts: response.attempts,
        ...(completion.model !== undefined ? { model: completion.model } : {}),
        ...(completion.usage !== undefined ? { usage: completion.usage } : {}),
      },
      latencyMs: response.latencyMs,
      status: response.status,
      ...(tokens !== undefined ? { tokens } : {}),
    };
  }
}
