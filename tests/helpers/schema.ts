import { formatIssues, type Issue } from "../../src/domain/issues.js";

interface SafeParseLike {
  success: boolean;
  error?: { issues: readonly Issue[] };
}

/** Paths of all validation issues of a failed safeParse, formatted like `cases[0].id`. */
export function failurePaths(result: SafeParseLike): string[] {
  if (result.success || !result.error) return [];
  return formatIssues(result.error.issues).map((issue) => issue.path);
}

/** Messages of all validation issues of a failed safeParse. */
export function failureMessages(result: SafeParseLike): string[] {
  if (result.success || !result.error) return [];
  return formatIssues(result.error.issues).map((issue) => issue.message);
}
