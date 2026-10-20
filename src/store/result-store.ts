import type { CalibrationResult } from "../domain/calibration.js";
import type { Finding } from "../domain/finding.js";
import type { BindingFile } from "../domain/fixtures.js";
import type { Iteration } from "../domain/iteration.js";
import type { JudgeFailure } from "../domain/judge-failure.js";
import type { Run, RunStatus, RunUsage } from "../domain/run.js";
import type { Verdict } from "../domain/verdict.js";

/**
 * Where runs, iterations and verdicts live. The runner only talks to this interface,
 * so files can later be replaced by a database or a hosted service (ADR 0002, ADR 0004).
 */
/** How a run ended. Without it a finished run counts as completed. */
export interface RunOutcome {
  status: RunStatus;
  abortReason?: string;
  /** Calls and tokens of the run (issue #87). */
  usage?: RunUsage;
}

export interface ResultStore {
  createRun(run: Run): Promise<void>;
  finishRun(runId: string, finishedAt: string, outcome?: RunOutcome): Promise<void>;
  appendIteration(iteration: Iteration): Promise<void>;
  appendVerdict(verdict: Verdict): Promise<void>;
  /** Records an iteration the judge should have rated but did not (issue #83). */
  appendJudgeFailure(failure: JudgeFailure): Promise<void>;
  readRun(runId: string): Promise<Run>;
  readIterations(runId: string): Promise<Iteration[]>;
  readVerdicts(runId: string): Promise<Verdict[]>;
  /** Judge failures of a run in the order they happened, empty for older runs. */
  readJudgeFailures(runId: string): Promise<JudgeFailure[]>;
  /** Run ids in the order the runs started (startedAt, then id). */
  listRuns(): Promise<string[]>;
  /** Findings of a run in every status, empty when the run was never analysed. */
  readFindings(runId: string): Promise<Finding[]>;
  /** Replaces the findings of a run. */
  writeFindings(runId: string, findings: readonly Finding[]): Promise<void>;
  /** Stores a binding of aiqa resolve (issue #93, ADR 0022). */
  writeBinding(binding: BindingFile): Promise<void>;
  /** The newest binding for a target, or null. */
  latestBinding(target: string): Promise<BindingFile | null>;
  /** Stores the binding a run used, with the values of the run before. */
  writeRunBinding(runId: string, binding: BindingFile): Promise<void>;
  /** The binding a run used, or null for runs without placeholders. */
  readRunBinding(runId: string): Promise<BindingFile | null>;
  /** Stores the calibration of one judge for one goldset, replacing an earlier one. */
  writeCalibration(result: CalibrationResult): Promise<void>;
  /** The stored calibration for this goldset, judge model and prompt version, or null. */
  readCalibration(
    goldsetId: string,
    judgeModel: string,
    promptVersion: string,
  ): Promise<CalibrationResult | null>;
}
