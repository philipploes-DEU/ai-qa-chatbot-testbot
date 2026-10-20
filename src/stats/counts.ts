/** Guards shared by the statistics functions. */
export function assertCounts(passes: number, n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n must be a positive integer, got ${String(n)}`);
  }
  if (!Number.isInteger(passes) || passes < 0 || passes > n) {
    throw new RangeError(
      `passes must be an integer between 0 and ${String(n)}, got ${String(passes)}`,
    );
  }
}

export function countPasses(outcomes: readonly boolean[]): number {
  return outcomes.filter((outcome) => outcome).length;
}
