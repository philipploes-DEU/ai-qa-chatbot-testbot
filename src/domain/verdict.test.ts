import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { VerdictSchema } from "./verdict.js";

const checkVerdict = {
  runId: "20261010-120000-ab12",
  caseId: "faq-001",
  index: 0,
  source: "check",
  pass: true,
  criteria: [{ name: "mustContain", pass: true, reason: "Alle Pflichtbegriffe enthalten." }],
  reasoning: "mustContain: Alle Pflichtbegriffe enthalten.",
};

describe("VerdictSchema", () => {
  it("accepts a check verdict without judge fields", () => {
    const parsed = VerdictSchema.parse(checkVerdict);
    expect(parsed.score).toBeUndefined();
    expect(parsed.judgeModel).toBeUndefined();
  });

  it("accepts a judge verdict with score, confidence and model", () => {
    const parsed = VerdictSchema.parse({
      ...checkVerdict,
      source: "judge",
      pass: false,
      score: 0.4,
      confidence: 0.9,
      judgeModel: "fixture-judge",
      promptVersion: "v1",
      criteria: [
        { name: "Korrektheit", pass: false, reason: "Nennt falsche Uhrzeit.", score: 0.2 },
        { name: "Ton", pass: true, reason: "Freundlich.", score: 1 },
      ],
    });
    expect(parsed.criteria).toHaveLength(2);
  });

  it("rejects a judge verdict without model and prompt version", () => {
    const result = VerdictSchema.safeParse({ ...checkVerdict, source: "judge" });
    const paths = failurePaths(result);
    expect(paths).toContain("judgeModel");
    expect(paths).toContain("promptVersion");
  });

  it("rejects unknown sources", () => {
    const result = VerdictSchema.safeParse({ ...checkVerdict, source: "human" });
    expect(failurePaths(result)).toContain("source");
  });

  it("rejects scores outside 0 to 1", () => {
    const result = VerdictSchema.safeParse({ ...checkVerdict, score: 1.5 });
    expect(failurePaths(result)).toContain("score");
  });

  it("rejects an empty criteria list", () => {
    const result = VerdictSchema.safeParse({ ...checkVerdict, criteria: [] });
    expect(failurePaths(result)).toContain("criteria");
  });
});
