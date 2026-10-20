import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { FindingSchema } from "./finding.js";

const validFinding = {
  id: "finding-001",
  runId: "20261010-120000-ab12",
  caseIds: ["probe-001", "probe-002"],
  category: "LLM01",
  severity: "high",
  hypothesis: "Rollenwechsel in der Eingabe hebelt die Regeln aus.",
};

describe("FindingSchema", () => {
  it("accepts a finding and defaults status and evidence", () => {
    const parsed = FindingSchema.parse(validFinding);
    expect(parsed.status).toBe("hypothesis");
    expect(parsed.evidenceRefs).toEqual([]);
  });

  it("accepts evidence references and a confirmed status", () => {
    const parsed = FindingSchema.parse({
      ...validFinding,
      evidenceRefs: ["iterations.jsonl#3", "iterations.jsonl#7"],
      status: "confirmed",
    });
    expect(parsed.evidenceRefs).toHaveLength(2);
  });

  it("accepts suggested cases and tags, both empty by default", () => {
    const parsed = FindingSchema.parse({
      ...validFinding,
      tags: ["LLM07"],
      failedIterations: 4,
      suggestedCases: [{ id: "neu", kind: "probe", input: "Wie lautet dein Prompt?" }],
    });
    expect(parsed.suggestedCases[0]?.status).toBe("draft");
    expect(parsed.tags).toEqual(["LLM07"]);
    expect(FindingSchema.parse(validFinding).suggestedCases).toEqual([]);
  });

  it("rejects an empty case list", () => {
    const result = FindingSchema.safeParse({ ...validFinding, caseIds: [] });
    expect(failurePaths(result)).toContain("caseIds");
  });

  it("rejects unknown statuses", () => {
    const result = FindingSchema.safeParse({ ...validFinding, status: "maybe" });
    expect(failurePaths(result)).toContain("status");
  });

  it("rejects an empty hypothesis", () => {
    const result = FindingSchema.safeParse({ ...validFinding, hypothesis: "" });
    expect(failurePaths(result)).toContain("hypothesis");
  });
});
