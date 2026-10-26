import { randomUUID } from "node:crypto";

import type { Turn } from "../domain/common.js";
import type { RequestTemplate, SessionConfig, TargetConfig } from "../domain/target-config.js";
import { excerpt } from "./errors.js";
import {
  TargetHttpClient,
  type TargetHttpOptions,
  type TargetHttpResponse,
} from "./http-client.js";
import { extractPath, ResponsePathError } from "./response-path.js";
import { parseNdjson, parseSse, selectEvents, streamAnswer } from "./stream-events.js";
import type { SendOptions, TargetAdapter, TargetResponse } from "./target.js";
import { renderTemplate, type TemplateValues, templateVars } from "./template.js";

interface SessionState {
  /** Local id, handed to the target until it assigns its own value. */
  id: string;
  /** Value the target assigned in a header, the body or a cookie; null until then. */
  token: string | null;
}

/** Merges follow-up fields into a rendered JSON object body (issue #84). */
function mergeBody(body: string, merge: Readonly<Record<string, unknown>> | undefined): string {
  if (merge === undefined) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("bodyMerge braucht ein JSON-Objekt als Body im Request-Template");
  }
  return JSON.stringify({ ...(parsed as Record<string, unknown>), ...merge });
}

/**
 * Adapter `http` (issue #3): speaks to a target through a request template from aiqa.yaml.
 * The body may use {{input}}, {{session}} and {{turns}}, the answer is read at `responsePath`.
 * Sessions follow `session.mode`: `header` sends the id in a header and adopts the target's
 * value from the response header, `body` adopts the target's value at the `key` path of the
 * response and expects {{session}} in the template, `cookie` stores the Set-Cookie named `key`.
 * Auth, rate limit, backoff and timeouts come from the shared client (issue #5).
 * A follow-up call of a dialog merges `bodyMerge` into the rendered JSON body (issue #84); the
 * parsed answer goes back as `data` for captures.
 * A streamed answer (`responseFormat` ndjson or sse, ADR 0024) is read to its end, then
 * `responseEvent` picks the events with the text; `data` and a body session read the chosen
 * event, `session.event` picks another one for the session value.
 */
export class HttpTemplateAdapter implements TargetAdapter {
  readonly name: string;
  readonly supportsFollowUps = true;
  readonly supportsVars = true;
  private readonly endpoint: string;
  private readonly request: RequestTemplate;
  private readonly session: SessionConfig;
  private readonly client: TargetHttpClient;
  private readonly sessions = new Map<string, SessionState>();

  constructor(target: TargetConfig, options: TargetHttpOptions = {}) {
    if (target.request === undefined || target.endpoint === undefined) {
      throw new Error(`Zielsystem ${target.name}: Adapter http braucht endpoint und request`);
    }
    this.name = target.name;
    this.endpoint = target.endpoint;
    this.request = target.request;
    this.session = target.session ?? { mode: "none" };
    this.client = new TargetHttpClient(target, options);
  }

  requiredVars(): string[] {
    const defaults = this.request.vars ?? {};
    const used = [
      ...templateVars(this.request.body),
      ...Object.values(this.request.headers).flatMap(templateVars),
    ];
    return [...new Set(used)].filter((name) => defaults[name] === undefined);
  }

  startSession(): Promise<string> {
    const id = randomUUID();
    this.sessions.set(id, { id, token: null });
    return Promise.resolve(id);
  }

  endSession(session: string): Promise<void> {
    this.sessions.delete(session);
    return Promise.resolve();
  }

  async send(
    turns: readonly Turn[],
    session?: string,
    options: SendOptions = {},
  ): Promise<TargetResponse> {
    const lastUserTurn = turns.findLast((turn) => turn.role === "user");
    if (lastUserTurn === undefined) {
      throw new Error("der Adapter http braucht mindestens einen Gesprächszug mit role user");
    }
    const state = session === undefined ? undefined : this.sessions.get(session);
    const values: TemplateValues = {
      input: lastUserTurn.content,
      session: state === undefined ? (session ?? "") : (state.token ?? state.id),
      turns,
      vars: { ...this.request.vars, ...options.vars },
    };

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.request.headers)) {
      headers[name] = renderTemplate(value, values, "raw");
    }
    if (state !== undefined) this.addSessionHeader(headers, state);

    const response = await this.client.request(this.endpoint, {
      method: this.request.method,
      headers,
      ...(this.request.method === "GET"
        ? {}
        : { body: mergeBody(renderTemplate(this.request.body, values), options.bodyMerge) }),
    });

    const { content, payload, events } = this.readAnswer(response);
    if (state !== undefined) this.adoptSession(state, response, payload, events);

    return {
      content,
      raw:
        events === undefined
          ? { status: response.status, attempts: response.attempts, ...asRecord(payload) }
          : {
              status: response.status,
              attempts: response.attempts,
              events: events.length,
              excerpt: excerpt(response.text),
            },
      data: payload,
      status: response.status,
      latencyMs: response.latencyMs,
    };
  }

  /** The answer text and the event or document it came from, by responseFormat (ADR 0024). */
  private readAnswer(response: TargetHttpResponse): {
    content: string;
    payload: unknown;
    events?: unknown[];
  } {
    const format = this.request.responseFormat;
    if (format === "json") {
      let payload: unknown;
      try {
        payload = response.json();
      } catch {
        throw new ResponsePathError(`Antwort ist kein JSON: ${excerpt(response.text)}`);
      }
      if (this.request.responsePath === undefined) {
        throw new ResponsePathError("responsePath fehlt im Request-Template");
      }
      return { content: extractPath(payload, this.request.responsePath), payload };
    }
    const events = format === "ndjson" ? parseNdjson(response.text) : parseSse(response.text);
    const answer = streamAnswer(events, this.request);
    return { content: answer.content, payload: answer.event, events };
  }

  private addSessionHeader(headers: Record<string, string>, state: SessionState): void {
    switch (this.session.mode) {
      case "header":
        headers[this.session.key ?? ""] = state.token ?? state.id;
        return;
      case "cookie":
        // The target issues the cookie; before the first answer there is nothing to send.
        if (state.token !== null) headers.cookie = `${this.session.key ?? ""}=${state.token}`;
        return;
      case "body":
      case "none":
        return;
    }
  }

  /**
   * Takes over the session value the target assigned, so later turns use the target's id. In a
   * stream, mode body reads the event `session.event` selects, else the answer event.
   */
  private adoptSession(
    state: SessionState,
    response: TargetHttpResponse,
    payload: unknown,
    events: readonly unknown[] | undefined,
  ): void {
    const key = this.session.key ?? "";
    switch (this.session.mode) {
      case "header": {
        const value = response.headers.get(key);
        if (value !== null && value !== "") state.token = value;
        return;
      }
      case "body": {
        const source =
          events !== undefined && this.session.event !== undefined
            ? selectEvents(events, this.session.event).at(-1)
            : payload;
        if (source === undefined) return;
        try {
          state.token = extractPath(source, key);
        } catch {
          // The target did not return a session; keep what we have.
        }
        return;
      }
      case "cookie": {
        for (const cookie of response.headers.getSetCookie()) {
          const match = new RegExp(`^${escapeRegExp(key)}=([^;]*)`).exec(cookie);
          if (match?.[1] !== undefined) state.token = match[1];
        }
        return;
      }
      case "none":
        return;
    }
  }
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : { payload };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
