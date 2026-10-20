import { z } from "zod";

import { IdSchema, TimestampSchema } from "./common.js";

/** One answer with a human label, judged by the same case's rubric and reference. */
export const CalibrationSampleSchema = z.strictObject({
  /** Case of the goldset whose rubric and reference answer apply. */
  caseId: IdSchema,
  /** The answer a human rated. */
  answer: z.string().min(1),
  /** The human verdict. */
  pass: z.boolean(),
  note: z.string().min(1).optional(),
});
export type CalibrationSample = z.infer<typeof CalibrationSampleSchema>;

/** Calibration set of a goldset: human labelled answers and the kappa the judge must reach. */
export const CalibrationSetSchema = z.strictObject({
  samples: z.array(CalibrationSampleSchema).min(1),
  /** Cohen's kappa the judge needs on this set to be released for the goldset. */
  minKappa: z.number().min(-1).max(1).default(0.6),
});
export type CalibrationSet = z.infer<typeof CalibrationSetSchema>;

export const CalibrationSampleResultSchema = z.strictObject({
  caseId: IdSchema,
  human: z.boolean(),
  judge: z.boolean(),
  reasoning: z.string(),
});
export type CalibrationSampleResult = z.infer<typeof CalibrationSampleResultSchema>;

/** Result of `aiqa calibrate` for one goldset and one judge, stored next to the runs. */
export const CalibrationResultSchema = z.strictObject({
  goldsetId: IdSchema,
  goldsetVersion: z.string().min(1),
  judgeModel: z.string().min(1),
  promptVersion: z.string().min(1),
  calibratedAt: TimestampSchema,
  samples: z.number().int().positive(),
  /** Samples the judge could not rate (errors); they count as disagreement. */
  errors: z.number().int().nonnegative(),
  agreement: z.number().min(0).max(1),
  kappa: z.number().min(-1).max(1),
  minKappa: z.number().min(-1).max(1),
  /** kappa reached minKappa: the judge may rate this goldset. */
  released: z.boolean(),
  results: z.array(CalibrationSampleResultSchema),
});
export type CalibrationResult = z.infer<typeof CalibrationResultSchema>;

/** What a run records about the calibration of its judge per goldset. */
export const RunCalibrationSchema = z.strictObject({
  goldsetId: IdSchema,
  kappa: z.number().min(-1).max(1),
  minKappa: z.number().min(-1).max(1),
  released: z.boolean(),
  samples: z.number().int().positive(),
  calibratedAt: TimestampSchema,
});
export type RunCalibration = z.infer<typeof RunCalibrationSchema>;
