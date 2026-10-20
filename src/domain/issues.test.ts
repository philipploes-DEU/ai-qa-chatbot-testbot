import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatIssues, formatPath, issueLines } from "./issues.js";

describe("formatPath", () => {
  it("joins keys with dots and indexes with brackets", () => {
    expect(formatPath(["cases", 0, "expected", "mustContain", 2])).toBe(
      "cases[0].expected.mustContain[2]",
    );
  });

  it("names the root when the path is empty", () => {
    expect(formatPath([])).toBe("(root)");
  });
});

describe("formatIssues", () => {
  const schema = z.object({
    id: z.string().min(1),
    cases: z.array(z.object({ id: z.string().min(1) })),
  });

  it("returns one entry per issue with path and message", () => {
    const result = schema.safeParse({ id: "", cases: [{ id: "ok" }, { id: 7 }] });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = formatIssues(result.error.issues);
    expect(issues.map((issue) => issue.path)).toEqual(["id", "cases[1].id"]);
    for (const issue of issues) {
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it("renders lines as path colon message", () => {
    const result = schema.safeParse({ id: "", cases: [] });
    if (result.success) throw new Error("expected failure");

    const lines = issueLines(result.error.issues);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^id: .+/);
  });
});
