import { describe, expect, it } from "vitest";

import { RateLimitSchema } from "../domain/target-config.js";
import { Deadline } from "./deadline.js";
import { HttpStatusError, TimeoutError } from "./errors.js";
import { isRetryable, withRetries } from "./retry.js";

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

/** Fails with the given errors in order, then succeeds. */
function failing(errors: readonly Error[]): (attempt: number) => Promise<string> {
  return (attempt) => {
    const error = errors[attempt];
    return error === undefined ? Promise.resolve("ok") : Promise.reject(error);
  };
}

const exponential = RateLimitSchema.parse({ backoff: "exponential", maxRetries: 3 });

describe("isRetryable", () => {
  it("retries only HTTP 429 and 503", () => {
    expect(isRetryable(new HttpStatusError(429, ""))).toBe(true);
    expect(isRetryable(new HttpStatusError(503, ""))).toBe(true);
    expect(isRetryable(new HttpStatusError(500, ""))).toBe(false);
    expect(isRetryable(new HttpStatusError(404, ""))).toBe(false);
    expect(isRetryable(new TimeoutError(10, "request"))).toBe(false);
    expect(isRetryable(new Error("connection refused"))).toBe(false);
  });
});

describe("withRetries", () => {
  it("returns the value and the number of attempts", async () => {
    const { sleep, waits } = recordingSleep();
    const result = await withRetries(failing([]), exponential, { sleep });
    expect(result).toEqual({ value: "ok", attempts: 1 });
    expect(waits).toEqual([]);
  });

  it("backs off exponentially on 503 and 429 up to maxRetries", async () => {
    const { sleep, waits } = recordingSleep();
    const result = await withRetries(
      failing([
        new HttpStatusError(503, ""),
        new HttpStatusError(429, ""),
        new HttpStatusError(503, ""),
      ]),
      exponential,
      { sleep, baseDelayMs: 100 },
    );
    expect(result).toEqual({ value: "ok", attempts: 4 });
    expect(waits).toEqual([100, 200, 400]);
  });

  it("gives up after maxRetries with the last error", async () => {
    const { sleep, waits } = recordingSleep();
    const errors = [1, 2, 3, 4, 5].map((n) => new HttpStatusError(503, `versuch ${String(n)}`));
    await expect(
      withRetries(failing(errors), RateLimitSchema.parse({ maxRetries: 2 }), {
        sleep,
        baseDelayMs: 10,
      }),
    ).rejects.toThrow("versuch 3");
    expect(waits).toEqual([10, 20]);
  });

  it("prefers Retry-After over the computed delay", async () => {
    const { sleep, waits } = recordingSleep();
    await withRetries(failing([new HttpStatusError(429, "", 2500)]), exponential, {
      sleep,
      baseDelayMs: 100,
    });
    expect(waits).toEqual([2500]);
  });

  it("caps the delay at maxDelayMs", async () => {
    const { sleep, waits } = recordingSleep();
    await withRetries(
      failing([new HttpStatusError(503, ""), new HttpStatusError(503, "")]),
      exponential,
      { sleep, baseDelayMs: 1000, maxDelayMs: 1500 },
    );
    expect(waits).toEqual([1000, 1500]);
  });

  it("does not retry with backoff none", async () => {
    const { sleep, waits } = recordingSleep();
    await expect(
      withRetries(
        failing([new HttpStatusError(503, "")]),
        RateLimitSchema.parse({ backoff: "none" }),
        {
          sleep,
        },
      ),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(waits).toEqual([]);
  });

  it("does not retry errors that are not retryable", async () => {
    const { sleep, waits } = recordingSleep();
    await expect(
      withRetries(failing([new HttpStatusError(500, "kaputt")]), exponential, { sleep }),
    ).rejects.toThrow("http 500: kaputt");
    expect(waits).toEqual([]);
  });

  it("stops with a dialog timeout when the next wait would pass the deadline", async () => {
    const { sleep, waits } = recordingSleep();
    let time = 0;
    const deadline = new Deadline(250, () => time);
    const attempt = (n: number): Promise<string> => {
      time += 100;
      return n < 3 ? Promise.reject(new HttpStatusError(503, "")) : Promise.resolve("ok");
    };
    await expect(
      withRetries(attempt, exponential, { sleep, baseDelayMs: 100, deadline }),
    ).rejects.toThrow(TimeoutError);
    expect(waits).toEqual([100]);
  });
});
