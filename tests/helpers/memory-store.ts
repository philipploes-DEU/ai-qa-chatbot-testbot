import type { CalibrationResult } from "../../src/domain/calibration.js";
import type { Finding } from "../../src/domain/finding.js";
import type { BindingFile } from "../../src/domain/fixtures.js";
import type { Iteration } from "../../src/domain/iteration.js";
import type { JudgeFailure } from "../../src/domain/judge-failure.js";
import type { Run } from "../../src/domain/run.js";
import type { Verdict } from "../../src/domain/verdict.js";
import type { ResultStore, RunOutcome } from "../../src/store/result-store.js";

/** In-memory ResultStore for runner tests. */
export class MemoryResultStore implements ResultStore {
  readonly runs = new Map<string, Run>();
  readonly iterations: Iteration[] = [];
  readonly verdicts: Verdict[] = [];
  readonly judgeFailures: JudgeFailure[] = [];
  readonly calibrations = new Map<string, CalibrationResult>();
  readonly findings = new Map<string, Finding[]>();
  readonly bindings: BindingFile[] = [];
  readonly runBindings = new Map<string, BindingFile>();

  writeBinding(binding: BindingFile): Promise<void> {
    this.bindings.push(binding);
    return Promise.resolve();
  }

  latestBinding(target: string): Promise<BindingFile | null> {
    const own = this.bindings
      .filter((binding) => binding.target === target)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Promise.resolve(own.at(-1) ?? null);
  }

  writeRunBinding(runId: string, binding: BindingFile): Promise<void> {
    this.runBindings.set(runId, binding);
    return Promise.resolve();
  }

  readRunBinding(runId: string): Promise<BindingFile | null> {
    return Promise.resolve(this.runBindings.get(runId) ?? null);
  }

  readFindings(runId: string): Promise<Finding[]> {
    return Promise.resolve([...(this.findings.get(runId) ?? [])]);
  }

  writeFindings(runId: string, findings: readonly Finding[]): Promise<void> {
    this.findings.set(runId, [...findings]);
    return Promise.resolve();
  }

  createRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  finishRun(runId: string, finishedAt: string, outcome?: RunOutcome): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return Promise.reject(new Error(`unknown run ${runId}`));
    this.runs.set(runId, {
      ...run,
      finishedAt,
      status: outcome?.status ?? "completed",
      ...(outcome?.abortReason !== undefined ? { abortReason: outcome.abortReason } : {}),
      ...(outcome?.usage !== undefined ? { usage: outcome.usage } : {}),
    });
    return Promise.resolve();
  }

  appendIteration(iteration: Iteration): Promise<void> {
    this.iterations.push(iteration);
    return Promise.resolve();
  }

  appendVerdict(verdict: Verdict): Promise<void> {
    this.verdicts.push(verdict);
    return Promise.resolve();
  }

  appendJudgeFailure(failure: JudgeFailure): Promise<void> {
    this.judgeFailures.push(failure);
    return Promise.resolve();
  }

  readJudgeFailures(runId: string): Promise<JudgeFailure[]> {
    return Promise.resolve(this.judgeFailures.filter((entry) => entry.runId === runId));
  }

  readRun(runId: string): Promise<Run> {
    const run = this.runs.get(runId);
    return run ? Promise.resolve(run) : Promise.reject(new Error(`unknown run ${runId}`));
  }

  readIterations(runId: string): Promise<Iteration[]> {
    return Promise.resolve(this.iterations.filter((entry) => entry.runId === runId));
  }

  readVerdicts(runId: string): Promise<Verdict[]> {
    return Promise.resolve(this.verdicts.filter((entry) => entry.runId === runId));
  }

  listRuns(): Promise<string[]> {
    return Promise.resolve(
      [...this.runs.values()]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
        .map((run) => run.id),
    );
  }

  writeCalibration(result: CalibrationResult): Promise<void> {
    this.calibrations.set(
      `${result.goldsetId}|${result.judgeModel}|${result.promptVersion}`,
      result,
    );
    return Promise.resolve();
  }

  readCalibration(
    goldsetId: string,
    judgeModel: string,
    promptVersion: string,
  ): Promise<CalibrationResult | null> {
    return Promise.resolve(
      this.calibrations.get(`${goldsetId}|${judgeModel}|${promptVersion}`) ?? null,
    );
  }
}
