import type { RateLimitConfig } from "../domain/target-config.js";
import type { Deadline } from "./deadline.js";
import { HttpStatusError, TimeoutError } from "./errors.js";

export interface RetryOptions {
  sleep?: (ms: number) => Promise<void>;
  /** First wait; every further wait doubles it. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** When set, a wait that would pass the deadline ends the dialog with a timeout. */
  deadline?: Deadline;
}

export interface RetryResult<T> {
  value: T;
  /** 1 when the first attempt succeeded. */
  attempts: number;
}

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 503]);

/** Only HTTP 429 and 503 are retried: the target asks for patience, not for a different request. */
export function isRetryable(error: unknown): boolean {
  return error instanceof HttpStatusError && RETRYABLE_STATUS.has(error.status);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attempt` until it succeeds or the retries are used up. With backoff `none` there is one
 * attempt. Retry-After from the target wins over the exponential delay.
 */
export async function withRetries<T>(
  attempt: (index: number) => Promise<T>,
  config: Pick<RateLimitConfig, "backoff" | "maxRetries">,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const retries = config.backoff === "none" ? 0 : config.maxRetries;

  for (let index = 0; ; index++) {
    try {
      return { value: await attempt(index), attempts: index + 1 };
    } catch (error) {
      if (index >= retries || !isRetryable(error)) throw error;
      const retryAfter = error instanceof HttpStatusError ? error.retryAfterMs : undefined;
      const delay = retryAfter ?? Math.min(maxDelayMs, baseDelayMs * 2 ** index);
      if (options.deadline !== undefined && delay > options.deadline.remainingMs()) {
        throw new TimeoutError(options.deadline.ms, "dialog");
      }
      await sleep(delay);
    }
  }
}
