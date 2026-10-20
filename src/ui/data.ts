import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

import { DRAFTS_GOLDSET_FILE } from "../cli/plan-command.js";
import type { LoadedWorkspace } from "../cli/config.js";
import { type FindingStatus } from "../domain/finding.js";
import { GoldsetSchema } from "../domain/goldset.js";
import type { TestCase, TestCaseStatus } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { toPosix } from "../io/files.js";
import { type TrendPoint, trendPoint } from "../report/report-model.js";
import type { FileResultStore } from "../store/file-result-store.js";

export interface RunRow {
  point: TrendPoint;
  target: string;
  drafts: number;
  openFindings: number;
  confirmedFindings: number;
}

export interface RunOverview {
  /** Newest first. */
  rows: RunRow[];
  /** Up to ten runs against the target of the newest run, oldest first. */
  trend: TrendPoint[];
}

/** Every run of the workspace with its pass rate and the state of its findings. */
export async function loadRunOverview(store: FileResultStore): Promise<RunOverview> {
  const rows: RunRow[] = [];
  for (const id of await store.listRuns()) {
    try {
      const [run, verdicts, findings, judgeFailures, iterations] = await Promise.all([
        store.readRun(id),
        store.readVerdicts(id),
        store.readFindings(id),
        store.readJudgeFailures(id),
        store.readIterations(id),
      ]);
      rows.push({
        point: trendPoint(run, verdicts, false, { judgeFailures, iterations }),
        target: run.target,
        drafts: run.draftCases?.length ?? 0,
        openFindings: findings.filter((finding) => finding.status === "hypothesis").length,
        confirmedFindings: findings.filter((finding) => finding.status === "confirmed").length,
      });
    } catch {
      // A broken run directory must not take the overview down; the CLI reports it.
    }
  }
  const newest = rows.at(-1);
  const trend =
    newest === undefined
      ? []
      : rows
          .filter((row) => row.target === newest.target)
          .slice(-10)
          .map((row) => ({ ...row.point, current: row === newest }));
  return { rows: rows.reverse(), trend };
}

export interface DraftSource {
  /** Position in the list, used in form addresses instead of a path. */
  index: number;
  file: string;
  /** Path relative to the workspace, for display. */
  display: string;
  drafts: TestCase[];
  error?: string;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** The goldsets of aiqa.yaml plus the drafts goldset of the planning agent, with their drafts. */
export async function loadDraftSources(workspace: LoadedWorkspace): Promise<DraftSource[]> {
  const files = workspace.config.goldsets.map((ref) => path.resolve(workspace.dir, ref));
  const drafts = path.resolve(workspace.dir, DRAFTS_GOLDSET_FILE);
  if (!files.includes(drafts) && (await exists(drafts))) files.push(drafts);
  const sources: DraftSource[] = [];
  for (const [index, file] of files.entries()) {
    const display = toPosix(path.relative(workspace.dir, file));
    try {
      const goldset = await loadGoldset(file);
      sources.push({
        index,
        file,
        display,
        drafts: goldset.cases.filter((testCase) => testCase.status === "draft"),
      });
    } catch (error) {
      sources.push({
        index,
        file,
        display,
        drafts: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return sources;
}

/**
 * Sets the status of one case in a goldset file. Works on the YAML document so comments stay,
 * and checks the result against the schema before it writes. False when the case is unknown.
 */
export async function setCaseStatus(
  file: string,
  caseId: string,
  status: TestCaseStatus,
): Promise<boolean> {
  const document = parseDocument(await readFile(file, "utf8"));
  const cases: unknown = (document.toJS() as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) return false;
  const position = cases.findIndex(
    (entry: unknown) =>
      typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === caseId,
  );
  if (position === -1) return false;
  document.setIn(["cases", position, "status"], status);
  GoldsetSchema.parse(document.toJS());
  await writeFile(file, document.toString(), "utf8");
  return true;
}

/** Sets the status of one finding of a run. False when the finding is unknown. */
export async function setFindingStatus(
  store: FileResultStore,
  runId: string,
  findingId: string,
  status: FindingStatus,
): Promise<boolean> {
  const findings = await store.readFindings(runId);
  if (!findings.some((finding) => finding.id === findingId)) return false;
  await store.writeFindings(
    runId,
    findings.map((finding) => (finding.id === findingId ? { ...finding, status } : finding)),
  );
  return true;
}
