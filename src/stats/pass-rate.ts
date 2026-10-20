import { assertCounts } from "./counts.js";

/** Share of passed iterations, between 0 and 1. */
export function passRate(passes: number, n: number): number {
  assertCounts(passes, n);
  return passes / n;
}
