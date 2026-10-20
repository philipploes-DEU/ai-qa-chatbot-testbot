import { countPasses } from "./counts.js";

/** Binomial coefficient n choose k, 0 when k is outside 0 to n. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const smaller = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= smaller; i++) {
    result = (result * (n - smaller + i)) / i;
  }
  return Math.round(result);
}

/**
 * Unbiased estimate of the probability that k randomly drawn iterations of one case all
 * pass: C(passes, k) / C(n, k). For k equal to n this is 1 when every iteration passed and
 * 0 otherwise.
 */
export function passAllKForCase(outcomes: readonly boolean[], k: number): number {
  const n = outcomes.length;
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`k must be a positive integer, got ${String(k)}`);
  }
  if (k > n) {
    throw new RangeError(`k (${String(k)}) exceeds the number of iterations (${String(n)})`);
  }
  return binomial(countPasses(outcomes), k) / binomial(n, k);
}

/** Mean of passAllKForCase over all cases. */
export function passAllK(
  outcomesByCase: Readonly<Record<string, readonly boolean[]>>,
  k: number,
): number {
  const allOutcomes = Object.values(outcomesByCase);
  if (allOutcomes.length === 0) {
    throw new RangeError("at least one case is required");
  }
  const sum = allOutcomes.reduce((total, outcomes) => total + passAllKForCase(outcomes, k), 0);
  return sum / allOutcomes.length;
}
