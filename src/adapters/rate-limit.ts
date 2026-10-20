import type { RateLimitConfig } from "../domain/target-config.js";

export interface RateLimiterClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Protects the target: at most `concurrency` calls at once and at least
 * 60000 / requestsPerMinute milliseconds between the starts of two calls.
 * Tasks start in the order they were handed in.
 */
export class RateLimiter {
  private readonly intervalMs: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue: (() => void)[] = [];
  private lastStart: number | null = null;
  private running = 0;

  constructor(config: RateLimitConfig, clock: RateLimiterClock = {}) {
    this.intervalMs = 60_000 / config.requestsPerMinute;
    this.concurrency = config.concurrency;
    this.now = clock.now ?? ((): number => performance.now());
    this.sleep = clock.sleep ?? defaultSleep;
  }

  /** Calls running right now. */
  get active(): number {
    return this.running;
  }

  /** Calls waiting for a free slot. */
  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      await this.pace();
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next !== undefined) next();
  }

  /**
   * Reserves the next start slot and waits for it. The slot is reserved before the wait so
   * that concurrent callers line up instead of starting together.
   */
  private async pace(): Promise<void> {
    const now = this.now();
    const start = this.lastStart === null ? now : Math.max(now, this.lastStart + this.intervalMs);
    this.lastStart = start;
    if (start > now) await this.sleep(start - now);
  }
}
