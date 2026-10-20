import type { z } from "zod";

export type Issue = z.core.$ZodIssue;

export interface FormattedIssue {
  /** Location in the document, for example `cases[0].expected.mustContain[2]`. */
  path: string;
  message: string;
}

/** Renders a Zod issue path as `a.b[0].c`; the empty path becomes `(root)`. */
export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  let rendered = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      rendered += `[${String(segment)}]`;
    } else {
      const key = String(segment);
      rendered += rendered.length === 0 ? key : `.${key}`;
    }
  }
  return rendered;
}

export function formatIssues(issues: readonly Issue[]): FormattedIssue[] {
  return issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

/** One line per issue in the form `path: message`, ready for CLI output. */
export function issueLines(issues: readonly Issue[]): string[] {
  return formatIssues(issues).map((issue) => `${issue.path}: ${issue.message}`);
}
