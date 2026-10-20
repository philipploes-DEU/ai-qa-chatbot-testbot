import type { CalibrationResult, CalibrationSampleResult } from "../domain/calibration.js";
import type { Goldset } from "../domain/goldset.js";
import { agreement, cohensKappa, type RatedPair } from "../stats/kappa.js";
import type { Judge } from "./judge.js";
import type { SourceDocument } from "./sources.js";

export interface CalibrateOptions {
  now?: () => Date;
  /** Called after every sample, for progress output. */
  onSample?: (result: CalibrationSampleResult, error?: string) => void;
  /** Source documents of the goldset, the same the judge gets in a run (issue #70). */
  sources?: readonly SourceDocument[];
}

/**
 * Runs the judge over the calibration set of a goldset and compares its verdicts with the
 * human labels (issue #11). A sample the judge cannot rate counts as disagreement, so a flaky
 * judge does not look better by failing. The judge is released for the goldset when Cohen's
 * kappa reaches the goldset's minKappa.
 */
export async function calibrateJudge(
  judge: Judge,
  goldset: Goldset,
  options: CalibrateOptions = {},
): Promise<CalibrationResult> {
  const calibration = goldset.calibration;
  if (calibration === undefined) {
    throw new Error(`Goldset ${goldset.id} hat kein Kalibrierungsset (calibration.samples)`);
  }
  const cases = new Map(goldset.cases.map((testCase) => [testCase.id, testCase]));
  const results: CalibrationSampleResult[] = [];
  const pairs: RatedPair[] = [];
  let errors = 0;

  for (const sample of calibration.samples) {
    const testCase = cases.get(sample.caseId);
    if (testCase === undefined) {
      throw new Error(
        `Kalibrierungsset von ${goldset.id} verweist auf den unbekannten Fall ${sample.caseId}`,
      );
    }
    if (!judge.applies(testCase, sample.answer)) {
      throw new Error(
        `Fall ${sample.caseId} hat weder Rubrik noch Referenzantwort, der Judge kann ihn nicht bewerten`,
      );
    }
    let result: CalibrationSampleResult;
    let error: string | undefined;
    try {
      const outcome = await judge.judge(
        testCase,
        { content: sample.answer, latencyMs: 0 },
        options.sources,
      );
      result = {
        caseId: sample.caseId,
        human: sample.pass,
        judge: outcome.verdict.pass,
        reasoning: outcome.verdict.reasoning,
      };
    } catch (caught) {
      errors++;
      error = caught instanceof Error ? caught.message : String(caught);
      // Disagreement by construction: the judge did not deliver.
      result = {
        caseId: sample.caseId,
        human: sample.pass,
        judge: !sample.pass,
        reasoning: `Judge-Fehler: ${error}`,
      };
    }
    results.push(result);
    pairs.push({ human: result.human, judge: result.judge });
    options.onSample?.(result, error);
  }

  const kappa = cohensKappa(pairs);
  return {
    goldsetId: goldset.id,
    goldsetVersion: goldset.version,
    judgeModel: judge.model,
    promptVersion: judge.promptVersion,
    calibratedAt: (options.now ?? ((): Date => new Date()))().toISOString(),
    samples: pairs.length,
    errors,
    agreement: agreement(pairs),
    kappa,
    minKappa: calibration.minKappa,
    released: kappa >= calibration.minKappa,
    results,
  };
}
