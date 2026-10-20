import { assertCounts } from "./counts.js";

export interface Interval {
  low: number;
  high: number;
}

/**
 * Wilson score interval for a binomial proportion. With the default z of 1.96 it is the
 * 95 percent interval. It behaves well for small n and for pass rates near 0 or 1, which is
 * why it is preferred over the normal approximation.
 */
export function wilsonInterval(passes: number, n: number, z = 1.96): Interval {
  assertCounts(passes, n);
  if (!Number.isFinite(z) || z <= 0) {
    throw new RangeError(`z must be a positive number, got ${String(z)}`);
  }
  const p = passes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const halfWidth = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, centre - halfWidth),
    high: Math.min(1, centre + halfWidth),
  };
}
