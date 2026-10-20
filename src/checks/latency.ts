import { type Check, checkResult } from "./check.js";

const name = "latency";

/**
 * expectations.maxLatencyMs from the target config: a slower answer fails the iteration
 * even when its content is right. The technical timeout is a separate concern.
 */
export function createLatencyCheck(maxLatencyMs: number): Check {
  if (!Number.isFinite(maxLatencyMs) || maxLatencyMs <= 0) {
    throw new RangeError(`maxLatencyMs must be a positive number, got ${String(maxLatencyMs)}`);
  }
  return {
    name,
    run(_testCase, response) {
      const actual = String(Math.round(response.latencyMs));
      const limit = String(maxLatencyMs);
      if (response.latencyMs <= maxLatencyMs) {
        return checkResult(name, true, `Antwort nach ${actual} ms, innerhalb von ${limit} ms`);
      }
      return checkResult(
        name,
        false,
        `Antwort nach ${actual} ms, langsamer als die erwarteten ${limit} ms`,
      );
    },
  };
}
