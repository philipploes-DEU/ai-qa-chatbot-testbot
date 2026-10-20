import { describe, expect, it } from "vitest";

import { RateLimitSchema } from "../domain/target-config.js";
import { RateLimiter } from "./rate-limit.js";

/** Clock whose sleep advances time instantly and records every wait. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  waits: number[];
  advance: (ms: number) => void;
} {
  let time = 0;
  const waits: number[] = [];
  return {
    now: () => time,
    sleep: (ms) => {
      waits.push(ms);
      time += ms;
      return Promise.resolve();
    },
    waits,
    advance: (ms) => {
      time += ms;
    },
  };
}

/** Lets queued promise callbacks and timers of the limiter run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("RateLimiter", () => {
  it("spaces calls by 60000 / requestsPerMinute milliseconds", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(RateLimitSchema.parse({ requestsPerMinute: 120 }), clock);

    await limiter.run(() => Promise.resolve("a"));
    clock.advance(100);
    await limiter.run(() => Promise.resolve("b"));
    await limiter.run(() => Promise.resolve("c"));

    expect(clock.waits).toEqual([400, 500]);
  });

  it("does not wait when enough time has passed", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(RateLimitSchema.parse({ requestsPerMinute: 60 }), clock);
    await limiter.run(() => Promise.resolve(1));
    clock.advance(5000);
    await limiter.run(() => Promise.resolve(2));
    expect(clock.waits).toEqual([]);
  });

  it("runs at most `concurrency` tasks at the same time and keeps the order", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(
      RateLimitSchema.parse({ requestsPerMinute: 100000, concurrency: 2 }),
      clock,
    );
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: string[] = [];
    const results = gates.map((gate, index) =>
      limiter.run(() => {
        started.push(String(index));
        return gate.promise;
      }),
    );
    await flush();

    expect(started).toEqual(["0", "1"]);
    expect(limiter.active).toBe(2);
    expect(limiter.waiting).toBe(1);

    gates[0]?.resolve("erste");
    await results[0];
    await flush();
    expect(started).toEqual(["0", "1", "2"]);

    gates[1]?.resolve("zweite");
    gates[2]?.resolve("dritte");
    expect(await Promise.all(results)).toEqual(["erste", "zweite", "dritte"]);
    expect(limiter.active).toBe(0);
  });

  it("releases the slot when the task fails and passes the error on", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(RateLimitSchema.parse({ requestsPerMinute: 100000 }), clock);
    await expect(limiter.run(() => Promise.reject(new Error("kaputt")))).rejects.toThrow("kaputt");
    expect(limiter.active).toBe(0);
    await expect(limiter.run(() => Promise.resolve("weiter"))).resolves.toBe("weiter");
  });
});
