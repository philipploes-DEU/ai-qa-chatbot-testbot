import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * Sample bot: the invented Gartenhelden GmbH customer service bot behind an OpenAI compatible
 * chat completions endpoint. The bot owns the system prompt and forwards every dialog to a
 * backend that speaks the same format, for example Ollama locally or the Anthropic
 * compatibility layer. It is a target for the openai-compatible adapter (issue #4), the judge
 * (issue #6) and the README demo. Local use only, never in CI, deliberately not hardened.
 *
 * Routes
 *   GET  /health                 liveness, backend and model, never the key
 *   POST /v1/chat/completions    OpenAI chat completions shape, stateless, no streaming
 */

export const SAMPLE_BOT_NAME = "gartenhelden-bot";

export interface BackendConfig {
  /** Base URL of the OpenAI compatible API, for example http://localhost:11434/v1. */
  baseUrl: string;
  /** Sent as bearer token when set. Ollama needs none, the Anthropic layer does. */
  apiKey?: string;
  model: string;
}

export interface SampleBotOptions {
  backend: BackendConfig;
  systemPrompt?: string;
  maxTokens?: number;
  /** Name in completions and /health; the advanced bot (issue #66) uses its own. */
  name?: string;
  /** Replaceable for tests. */
  fetchImpl?: typeof fetch;
}

export interface SampleBot {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface BackendCompletion {
  choices?: unknown[];
  usage?: unknown;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ChatMessage).role === "string" &&
    typeof (value as ChatMessage).content === "string"
  );
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "invalid_request_error", "Body ist kein gültiges JSON"));
      }
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: HttpError): void {
  sendJson(response, error.status, {
    error: { message: error.message, type: error.type },
  });
}

export function createSampleBotServer(options: SampleBotOptions): Server {
  const { backend } = options;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const maxTokens = options.maxTokens ?? 400;
  const name = options.name ?? SAMPLE_BOT_NAME;
  const fetchImpl = options.fetchImpl ?? fetch;
  const completionsUrl = `${backend.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function handleCompletions(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readBody(request);
    const record =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    if (!Array.isArray(record.messages) || !record.messages.every(isChatMessage)) {
      throw new HttpError(
        400,
        "invalid_request_error",
        "messages muss eine Liste aus { role, content } sein",
      );
    }
    // The bot owns its instructions: system messages from the caller are dropped.
    const dialog = record.messages.filter((message) => message.role !== "system");
    if (!dialog.some((message) => message.role === "user")) {
      throw new HttpError(400, "invalid_request_error", "messages braucht einen user-Zug");
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(completionsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(backend.apiKey !== undefined ? { authorization: `Bearer ${backend.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: backend.model,
          max_tokens: maxTokens,
          messages: [{ role: "system", content: systemPrompt }, ...dialog],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, "backend_error", `Backend nicht erreichbar: ${message}`);
    }
    if (!upstream.ok) {
      throw new HttpError(
        502,
        "backend_error",
        `Backend antwortete mit HTTP ${String(upstream.status)}`,
      );
    }
    const completion = (await upstream.json()) as BackendCompletion;
    if (!Array.isArray(completion.choices)) {
      throw new HttpError(502, "backend_error", "Backend-Antwort enthält keine choices");
    }
    sendJson(response, 200, {
      id: `chatcmpl-${String(Date.now())}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: name,
      choices: completion.choices,
      ...(completion.usage !== undefined ? { usage: completion.usage } : {}),
    });
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        name,
        model: backend.model,
        backend: backend.baseUrl,
      });
      return;
    }
    if (method === "POST" && pathname === "/v1/chat/completions") {
      return handleCompletions(request, response);
    }
    throw new HttpError(404, "not_found", `Route ${method} ${pathname} gibt es nicht`);
  }

  return createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(response, error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        sendError(response, new HttpError(500, "server_error", message));
      }
    });
  });
}

/** Starts the bot on 127.0.0.1. Port 0 (the default) picks a free port. */
export async function startSampleBot(
  options: SampleBotOptions & { port?: number },
): Promise<SampleBot> {
  const server = createSampleBotServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
