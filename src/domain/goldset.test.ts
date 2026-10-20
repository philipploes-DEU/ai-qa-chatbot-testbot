import { describe, expect, it } from "vitest";

import { failureMessages, failurePaths } from "../../tests/helpers/schema.js";
import { GoldsetSchema } from "./goldset.js";

const caseA = { id: "faq-001", kind: "qa", input: "Frage A", expected: { mustContain: ["A"] } };
const caseB = { id: "faq-002", kind: "qa", input: "Frage B", expected: { mustContain: ["B"] } };

const validGoldset = {
  id: "beispiel",
  name: "Beispiel-Goldset",
  version: 1,
  owner: "QA Team Musterfirma",
  cases: [caseA, caseB],
};

describe("GoldsetSchema", () => {
  it("accepts a goldset with unique cases", () => {
    const parsed = GoldsetSchema.parse(validGoldset);
    expect(parsed.version).toBe("1");
    expect(parsed.cases).toHaveLength(2);
    expect(parsed.approvedAt).toBeUndefined();
  });

  it("accepts an approval timestamp", () => {
    const parsed = GoldsetSchema.parse({ ...validGoldset, approvedAt: "2026-10-10T12:00:00Z" });
    expect(parsed.approvedAt).toBe("2026-10-10T12:00:00Z");
  });

  it("rejects duplicate case ids and names the duplicate", () => {
    const result = GoldsetSchema.safeParse({
      ...validGoldset,
      cases: [caseA, { ...caseB, id: "faq-001" }],
    });
    expect(failurePaths(result)).toContain("cases[1].id");
    expect(failureMessages(result).join(" ")).toContain("faq-001");
  });

  it("rejects an empty case list", () => {
    const result = GoldsetSchema.safeParse({ ...validGoldset, cases: [] });
    expect(failurePaths(result)).toContain("cases");
  });

  it("rejects a missing owner", () => {
    const { owner: _owner, ...withoutOwner } = validGoldset;
    const result = GoldsetSchema.safeParse(withoutOwner);
    expect(failurePaths(result)).toContain("owner");
  });

  it("rejects an approval date without time", () => {
    const result = GoldsetSchema.safeParse({ ...validGoldset, approvedAt: "2026-10-10" });
    expect(failurePaths(result)).toContain("approvedAt");
  });
});

describe("GoldsetSchema calibration", () => {
  const base = {
    id: "g",
    name: "G",
    owner: "QA",
    cases: [{ id: "c1", kind: "qa", input: "Frage?", expected: { answer: "Antwort." } }],
  };

  it("accepts a calibration set with a default threshold", () => {
    const parsed = GoldsetSchema.parse({
      ...base,
      calibration: { samples: [{ caseId: "c1", answer: "Antwort.", pass: true }] },
    });
    expect(parsed.calibration?.minKappa).toBe(0.6);
    expect(parsed.calibration?.samples).toHaveLength(1);
  });

  it("rejects samples that reference unknown cases", () => {
    const result = GoldsetSchema.safeParse({
      ...base,
      calibration: { samples: [{ caseId: "nix", answer: "x", pass: false }] },
    });
    expect(result.success).toBe(false);
    expect(failurePaths(result)).toContain("calibration.samples[0].caseId");
  });
});
