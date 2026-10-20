/** One sample rated by two raters: the human label and the judge's verdict. */
export interface RatedPair {
  human: boolean;
  judge: boolean;
}

/** Share of samples where both raters agree. */
export function agreement(pairs: readonly RatedPair[]): number {
  if (pairs.length === 0) throw new RangeError("at least one pair is required");
  return pairs.filter((pair) => pair.human === pair.judge).length / pairs.length;
}

/**
 * Cohen's kappa for two raters with binary labels: agreement corrected for the agreement
 * expected by chance. 1 is perfect agreement, 0 is chance level, below 0 is worse than chance.
 * When chance agreement is 1 (both raters always say the same thing) kappa is 1 for perfect
 * agreement and 0 otherwise, so a degenerate set never looks better than it is.
 */
export function cohensKappa(pairs: readonly RatedPair[]): number {
  if (pairs.length === 0) throw new RangeError("at least one pair is required");
  const n = pairs.length;
  const observed = agreement(pairs);
  const humanPass = pairs.filter((pair) => pair.human).length / n;
  const judgePass = pairs.filter((pair) => pair.judge).length / n;
  const expected = humanPass * judgePass + (1 - humanPass) * (1 - judgePass);
  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}

/** Verbal scale after Landis and Koch, for reports. */
export function describeKappa(kappa: number): string {
  if (kappa < 0) return "schlechter als Zufall";
  if (kappa < 0.2) return "kaum Übereinstimmung";
  if (kappa < 0.4) return "geringe Übereinstimmung";
  if (kappa < 0.6) return "mäßige Übereinstimmung";
  if (kappa < 0.8) return "gute Übereinstimmung";
  return "sehr gute Übereinstimmung";
}
