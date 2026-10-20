import { describe, expect, it } from "vitest";

import { failureMessages, failurePaths } from "../../tests/helpers/schema.js";
import { PlanSchema, totalPlannedCalls } from "./plan.js";

const validPlan = {
  id: "plan-beispiel",
  createdAt: "2026-10-10T12:00:00Z",
  target: "beispiel-dummy",
  goldsets: ["goldset.yaml"],
  caseRefs: [
    { caseId: "faq-001", iterations: 5 },
    { caseId: "faq-002", iterations: 3 },
  ],
  budget: { maxCalls: 50 },
};

describe("PlanSchema", () => {
  it("accepts a plan without judge and approval", () => {
    const parsed = PlanSchema.parse(validPlan);
    expect(parsed.judge).toBeUndefined();
    expect(parsed.approvedBy).toBeUndefined();
    expect(parsed.budget.maxTokens).toBeUndefined();
  });

  it("accepts a judge configuration", () => {
    const parsed = PlanSchema.parse({
      ...validPlan,
      judge: { provider: "fake", model: "fixture-judge", promptVersion: "v1" },
      approvedBy: "QA-Leitung",
    });
    expect(parsed.judge?.model).toBe("fixture-judge");
  });

  it("rejects zero iterations", () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      caseRefs: [{ caseId: "faq-001", iterations: 0 }],
    });
    expect(failurePaths(result)).toContain("caseRefs[0].iterations");
  });

  it("rejects duplicate case references", () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      caseRefs: [
        { caseId: "faq-001", iterations: 1 },
        { caseId: "faq-001", iterations: 2 },
      ],
    });
    expect(failurePaths(result)).toContain("caseRefs[1].caseId");
  });

  it("rejects a budget smaller than the planned calls", () => {
    const result = PlanSchema.safeParse({ ...validPlan, budget: { maxCalls: 7 } });
    expect(failurePaths(result)).toContain("budget.maxCalls");
    expect(failureMessages(result).join(" ")).toContain("8");
  });

  it("rejects a missing budget", () => {
    const { budget: _budget, ...withoutBudget } = validPlan;
    const result = PlanSchema.safeParse(withoutBudget);
    expect(failurePaths(result)).toContain("budget");
  });

  it("rejects an empty goldset list", () => {
    const result = PlanSchema.safeParse({ ...validPlan, goldsets: [] });
    expect(failurePaths(result)).toContain("goldsets");
  });
});

describe("totalPlannedCalls", () => {
  it("sums the iterations of all case references", () => {
    expect(totalPlannedCalls(PlanSchema.parse(validPlan))).toBe(8);
  });
});
