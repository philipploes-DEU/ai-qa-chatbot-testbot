import type { AuthConfig, TargetConfig } from "../domain/target-config.js";
import { type AuthProvider, type Environment, StaticAuth } from "./auth.js";
import { Deadline } from "./deadline.js";
import {
  causeMessage,
  ConnectionError,
  excerpt,
  HttpStatusError,
  isAbort,
  TimeoutError,
} from "./errors.js";
import { RateLimiter } from "./rate-limit.js";
import { withRetries } from "./retry.js";
import { TokenAuth } from "./token-auth.js";

export interface TargetHttpOptions {
  /** Where ${NAME} references in auth are resolved. Defaults to process.env. */
  env?: Environment;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** First backoff wait, doubles per retry. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Clock in milliseconds for token lifetimes, for tests. */
  now?: () => number;
}

export interface TargetHttpRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TargetHttpResponse {
  status: number;
  headers: Headers;
  text: string;
  /** Parses the body as JSON; throws when it is none. */
  json(): unknown;
  /** Attempts the call took, 1 without retries. */
  attempts: number;
  /** Duration of the successful attempt only: waits and failed attempts are not the target's answer time. */
  latencyMs: number;
}

/** Retry-After as seconds or HTTP date, in milliseconds from now. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Static headers for most auth types, a token that renews itself for auth token (issue #73). */
export function createAuth(
  auth: AuthConfig,
  timeouts: TargetConfig["timeouts"],
  options: TargetHttpOptions = {},
): AuthProvider {
  const env = options.env ?? process.env;
  if (auth.type !== "token") return new StaticAuth(auth, env);
  return new TokenAuth(auth, {
    env,
    requestMs: timeouts.requestMs,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * The shared HTTP building blocks of all network adapters (issue #5): auth headers from
 * environment references, rate limit and concurrency, backoff on 429 and 503, a timeout per
 * attempt (timeouts.requestMs) and a bound for the whole call including retries and waits
 * (timeouts.dialogMs). Adapters build their request and parse the answer, nothing else.
 * With auth token a 401 renews the token once and repeats the call; the token is removed from
 * every text the client hands on (issue #73).
 */
export class TargetHttpClient {
  private readonly auth: AuthProvider;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly timeouts: TargetConfig["timeouts"];
  private readonly rateLimit: TargetConfig["rateLimit"];
  private readonly retryOptions: {
    sleep?: (ms: number) => Promise<void>;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };

  constructor(
    target: Pick<TargetConfig, "auth" | "rateLimit" | "timeouts">,
    options: TargetHttpOptions = {},
  ) {
    this.auth = createAuth(target.auth, target.timeouts, options);
    this.limiter = new RateLimiter(target.rateLimit, { sleep: options.sleep });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeouts = target.timeouts;
    this.rateLimit = target.rateLimit;
    this.retryOptions = {
      sleep: options.sleep,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
    };
  }

  /** One call of the target with all building blocks applied. One call is one dialog. */
  async request(url: string | URL, init: TargetHttpRequest = {}): Promise<TargetHttpResponse> {
    const deadline = new Deadline(this.timeouts.dialogMs);
    const authHeaders = await this.auth.headers();
    try {
      return await this.send(url, init, authHeaders, deadline);
    } catch (error) {
      const unauthorized = error instanceof HttpStatusError && error.status === 401;
      if (!unauthorized || !this.auth.reject(authHeaders)) throw error;
    }
    return this.send(url, init, await this.auth.headers(), deadline);
  }

  private async send(
    url: string | URL,
    init: TargetHttpRequest,
    authHeaders: Record<string, string>,
    deadline: Deadline,
  ): Promise<TargetHttpResponse> {
    const { value, attempts } = await withRetries(
      () => this.limiter.run(() => this.attempt(url, init, authHeaders, deadline)),
      this.rateLimit,
      { ...this.retryOptions, deadline },
    );
    return { ...value, attempts };
  }

  private async attempt(
    url: string | URL,
    init: TargetHttpRequest,
    authHeaders: Record<string, string>,
    deadline: Deadline,
  ): Promise<Omit<TargetHttpResponse, "attempts">> {
    const remaining = deadline.remainingMs();
    if (remaining === 0) throw new TimeoutError(this.timeouts.dialogMs, "dialog");
    // AbortSignal.timeout wants an integer; remaining comes from performance.now().
    const budget = Math.ceil(Math.min(this.timeouts.requestMs, remaining));

    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? "POST",
        headers: { ...init.headers, ...authHeaders },
        body: init.body,
        signal: AbortSignal.timeout(budget),
      });
    } catch (error) {
      if (isAbort(error)) {
        throw remaining < this.timeouts.requestMs
          ? new TimeoutError(this.timeouts.dialogMs, "dialog")
          : new TimeoutError(this.timeouts.requestMs, "request");
      }
      throw new ConnectionError(causeMessage(error));
    }
    const text = this.auth.redact(await response.text());
    const latencyMs = performance.now() - started;
    if (!response.ok) {
      throw new HttpStatusError(
        response.status,
        excerpt(text),
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: () => JSON.parse(text) as unknown,
      latencyMs,
    };
  }
}
