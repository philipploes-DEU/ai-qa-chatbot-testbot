import type { Verdict } from "../domain/verdict.js";
import { countPasses } from "./counts.js";
import { isFlaky, minorityShare } from "./flakiness.js";
import { passRate } from "./pass-rate.js";
import { type Interval, wilsonInterval } from "./wilson.js";

/** Pass or fail per iteration, per case, ordered by iteration index. */
export type OutcomesByCase = Record<string, boolean[]>;

/**
 * Reduces verdicts to one boolean per iteration. An iteration passes only when every
 * verdict about it passes, whether it came from a check or from the judge (ADR 0003).
 */
export function outcomesFromVerdicts(verdicts: readonly Verdict[]): OutcomesByCase {
  const byCase = new Map<string, Map<number, boolean>>();
  for (const verdict of verdicts) {
    let iterations = byCase.get(verdict.caseId);
    if (iterations === undefined) {
      iterations = new Map<number, boolean>();
      byCase.set(verdict.caseId, iterations);
    }
    const previous = iterations.get(verdict.index) ?? true;
    iterations.set(verdict.index, previous && verdict.pass);
  }

  const outcomes: OutcomesByCase = {};
  for (const [caseId, iterations] of byCase) {
    outcomes[caseId] = [...iterations.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, pass]) => pass);
  }
  return outcomes;
}

export interface CaseSummary {
  n: number;
  passes: number;
  passRate: number;
  interval: Interval;
  flakiness: number;
  flaky: boolean;
}

/** Everything the report shows per case, computed from the iteration outcomes. */
export function summarizeCase(outcomes: readonly boolean[], z = 1.96): CaseSummary {
  const n = outcomes.length;
  const passes = countPasses(outcomes);
  return {
    n,
    passes,
    passRate: passRate(passes, n),
    interval: wilsonInterval(passes, n, z),
    flakiness: minorityShare(outcomes),
    flaky: isFlaky(outcomes),
  };
}
