import type { ResultStore } from "../store/result-store.js";

/** The calls already made against a target on one local calendar day (issue #112). */
export interface DailyCalls {
  /** Calls from `usage` of every finished run of the day against the target. */
  calls: number;
  /** Runs that count. */
  runs: number;
  /** Runs of the day against the target without `usage`, for example unfinished ones. */
  withoutUsage: number;
  /** The day as YYYY-MM-DD in the time zone of this machine. */
  day: string;
  timeZone: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The local calendar day of a date, as YYYY-MM-DD. */
export function localDay(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Sums the calls of every run against the target that started on the local day of `now`,
 * from `usage` in run.json (ADR 0020). Runs without usage are counted apart, not added. A run
 * that cannot be read is skipped: an old or broken run must not stop a new one.
 */
export async function callsOnDay(
  store: Pick<ResultStore, "listRuns" | "readRun">,
  target: string,
  now: Date,
): Promise<DailyCalls> {
  const day = localDay(now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const result: DailyCalls = { calls: 0, runs: 0, withoutUsage: 0, day, timeZone };
  let ids: string[];
  try {
    ids = await store.listRuns();
  } catch {
    return result;
  }
  for (const id of ids) {
    try {
      const run = await store.readRun(id);
      if (run.target !== target || localDay(new Date(run.startedAt)) !== day) continue;
      if (run.usage === undefined) {
        result.withoutUsage++;
        continue;
      }
      result.calls += run.usage.calls;
      result.runs++;
    } catch {
      continue;
    }
  }
  return result;
}
