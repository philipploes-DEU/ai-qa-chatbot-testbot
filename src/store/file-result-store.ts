import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";
import { z } from "zod";

import { type CalibrationResult, CalibrationResultSchema } from "../domain/calibration.js";
import { type Finding, FindingSchema } from "../domain/finding.js";
import { type BindingFile, BindingFileSchema } from "../domain/fixtures.js";
import { type Iteration, IterationSchema } from "../domain/iteration.js";
import { type JudgeFailure, JudgeFailureSchema } from "../domain/judge-failure.js";
import { type Run, RunSchema } from "../domain/run.js";
import { type Verdict, VerdictSchema } from "../domain/verdict.js";
import type { ResultStore, RunOutcome } from "./result-store.js";

const RUN_FILE = "run.json";
const ITERATIONS_FILE = "iterations.jsonl";
const VERDICTS_FILE = "verdicts.jsonl";
/** Iterations without a judge verdict because the judge refused or failed (issue #83). */
const JUDGE_FAILURES_FILE = "judge-failures.jsonl";
/** YAML, because a human edits the status of a finding. */
const FINDINGS_FILE = "findings.yaml";
const FINDINGS_HEADER =
  "# Befunde von aiqa analyze. Der Status hypothesis heißt ungeprüft. Bestätigen oder verwerfen\n" +
  "# mit aiqa analyze --confirm oder --reject, oder hier den Status auf confirmed oder rejected setzen.\n";
/** Directory below the runs root; it holds no run.json, so listRuns ignores it. */
const CALIBRATIONS_DIR = "calibrations";
/** Bindings of aiqa resolve, per target and time; like calibrations no run (issue #93). */
const BINDINGS_DIR = "bindings";
/** The binding a run used, with the values of the run before. */
const RUN_BINDING_FILE = "bindings.json";

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readJsonl<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${path.basename(file)} Zeile ${String(index + 1)}: ${message}`, {
          cause: error,
        });
      }
    });
}

/**
 * Stores every run in its own directory: run.json with the metadata, iterations.jsonl,
 * verdicts.jsonl and judge-failures.jsonl with one entry per line (ADR 0002).
 */
export class FileResultStore implements ResultStore {
  constructor(private readonly rootDir: string) {}

  runDir(runId: string): string {
    return path.join(this.rootDir, runId);
  }

  async createRun(run: Run): Promise<void> {
    await mkdir(this.runDir(run.id), { recursive: true });
    await this.writeRun(run);
  }

  async finishRun(runId: string, finishedAt: string, outcome?: RunOutcome): Promise<void> {
    const run = await this.readRun(runId);
    await this.writeRun({
      ...run,
      finishedAt,
      status: outcome?.status ?? "completed",
      ...(outcome?.abortReason !== undefined ? { abortReason: outcome.abortReason } : {}),
      ...(outcome?.usage !== undefined ? { usage: outcome.usage } : {}),
    });
  }

  async appendIteration(iteration: Iteration): Promise<void> {
    await appendFile(
      path.join(this.runDir(iteration.runId), ITERATIONS_FILE),
      `${JSON.stringify(iteration)}\n`,
    );
  }

  async appendVerdict(verdict: Verdict): Promise<void> {
    await appendFile(
      path.join(this.runDir(verdict.runId), VERDICTS_FILE),
      `${JSON.stringify(verdict)}\n`,
    );
  }

  async appendJudgeFailure(failure: JudgeFailure): Promise<void> {
    await appendFile(
      path.join(this.runDir(failure.runId), JUDGE_FAILURES_FILE),
      `${JSON.stringify(failure)}\n`,
    );
  }

  async readRun(runId: string): Promise<Run> {
    let text: string;
    try {
      text = await readFile(path.join(this.runDir(runId), RUN_FILE), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`Lauf "${runId}" nicht gefunden unter ${this.rootDir}`, { cause: error });
      }
      throw error;
    }
    return RunSchema.parse(JSON.parse(text));
  }

  readIterations(runId: string): Promise<Iteration[]> {
    return readJsonl(path.join(this.runDir(runId), ITERATIONS_FILE), IterationSchema);
  }

  readVerdicts(runId: string): Promise<Verdict[]> {
    return readJsonl(path.join(this.runDir(runId), VERDICTS_FILE), VerdictSchema);
  }

  readJudgeFailures(runId: string): Promise<JudgeFailure[]> {
    return readJsonl(path.join(this.runDir(runId), JUDGE_FAILURES_FILE), JudgeFailureSchema);
  }

  /**
   * Run ids in the order the runs started. Ids carry the second only, so runs of one second
   * are ordered by startedAt from run.json, which has milliseconds.
   */
  async listRuns(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const runs: { id: string; startedAt: string }[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && (await exists(path.join(this.rootDir, entry.name, RUN_FILE)))) {
        const run = await this.readRun(entry.name);
        runs.push({ id: entry.name, startedAt: run.startedAt });
      }
    }
    return runs
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
      .map((run) => run.id);
  }

  async readFindings(runId: string): Promise<Finding[]> {
    let text: string;
    try {
      text = await readFile(path.join(this.runDir(runId), FINDINGS_FILE), "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    try {
      return z.array(FindingSchema).parse(parse(text) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${FINDINGS_FILE} von Lauf ${runId}: ${message}`, { cause: error });
    }
  }

  async writeFindings(runId: string, findings: readonly Finding[]): Promise<void> {
    await writeFile(
      path.join(this.runDir(runId), FINDINGS_FILE),
      FINDINGS_HEADER + stringify(findings),
      "utf8",
    );
  }

  async writeBinding(binding: BindingFile): Promise<void> {
    const dir = path.join(this.rootDir, BINDINGS_DIR);
    await mkdir(dir, { recursive: true });
    const stamp = binding.createdAt.replace(/[:.]/g, "-");
    await writeFile(
      path.join(dir, `${safeName(binding.target)}--${stamp}.json`),
      `${JSON.stringify(binding, null, 2)}\n`,
    );
  }

  async latestBinding(target: string): Promise<BindingFile | null> {
    let names: string[];
    try {
      names = await readdir(path.join(this.rootDir, BINDINGS_DIR));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const prefix = `${safeName(target)}--`;
    const candidates = names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort()
      .reverse();
    // Names like "a b" and "a_b" share a file prefix; the target inside the file decides.
    for (const name of candidates) {
      try {
        const text = await readFile(path.join(this.rootDir, BINDINGS_DIR, name), "utf8");
        const binding = BindingFileSchema.parse(JSON.parse(text));
        if (binding.target === target) return binding;
      } catch {
        continue; // A broken or foreign file must not hide the binding of this target.
      }
    }
    return null;
  }

  async writeRunBinding(runId: string, binding: BindingFile): Promise<void> {
    await writeFile(
      path.join(this.runDir(runId), RUN_BINDING_FILE),
      `${JSON.stringify(binding, null, 2)}\n`,
    );
  }

  async readRunBinding(runId: string): Promise<BindingFile | null> {
    let text: string;
    try {
      text = await readFile(path.join(this.runDir(runId), RUN_BINDING_FILE), "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    return BindingFileSchema.parse(JSON.parse(text));
  }

  calibrationFile(goldsetId: string, judgeModel: string, promptVersion: string): string {
    return path.join(
      this.rootDir,
      CALIBRATIONS_DIR,
      `${safeName(goldsetId)}--${safeName(judgeModel)}--${safeName(promptVersion)}.json`,
    );
  }

  async writeCalibration(result: CalibrationResult): Promise<void> {
    const file = this.calibrationFile(result.goldsetId, result.judgeModel, result.promptVersion);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  }

  async readCalibration(
    goldsetId: string,
    judgeModel: string,
    promptVersion: string,
  ): Promise<CalibrationResult | null> {
    let text: string;
    try {
      text = await readFile(this.calibrationFile(goldsetId, judgeModel, promptVersion), "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    return CalibrationResultSchema.parse(JSON.parse(text));
  }

  private async writeRun(run: Run): Promise<void> {
    await writeFile(path.join(this.runDir(run.id), RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
  }
}
