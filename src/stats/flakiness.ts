import { countPasses } from "./counts.js";

/**
 * Share of iterations that deviate from the majority outcome, between 0 and 0.5.
 * 0 means every iteration agreed, 0.5 means passes and fails were split evenly.
 */
export function minorityShare(outcomes: readonly boolean[]): number {
  if (outcomes.length === 0) {
    throw new RangeError("at least one outcome is required");
  }
  const passes = countPasses(outcomes);
  return Math.min(passes, outcomes.length - passes) / outcomes.length;
}

/** A case is flaky when the same input both passed and failed within one run. */
export function isFlaky(outcomes: readonly boolean[]): boolean {
  return outcomes.some((outcome) => outcome) && outcomes.some((outcome) => !outcome);
}

/** Minority share per case. */
export function flakiness(
  outcomesByCase: Readonly<Record<string, readonly boolean[]>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(outcomesByCase).map(([caseId, outcomes]) => [caseId, minorityShare(outcomes)]),
  );
}
