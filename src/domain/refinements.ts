import type { z } from "zod";

/**
 * Adds one issue per repeated value. The issue points at the repeated element,
 * for example `cases[1].id`, and names the duplicate value.
 */
export function addDuplicateIssues(
  values: readonly string[],
  basePath: readonly PropertyKey[],
  key: string,
  ctx: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, index, key],
        message: `doppelte ${label} "${value}"`,
      });
    }
    seen.add(value);
  });
}
