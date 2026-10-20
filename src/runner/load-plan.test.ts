import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadPlan } from "./load-plan.js";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "validate");

describe("loadPlan", () => {
  it("loads the plan and the goldsets it references relative to the plan file", async () => {
    const loaded = await loadPlan(path.join(fixtures, "plan.yaml"));
    expect(loaded.plan.id).toBe("fixture-plan");
    expect(loaded.goldsets.map((goldset) => goldset.id)).toEqual(["fixture-goldset"]);
    expect(loaded.cases.has("fall-a")).toBe(true);
  });

  it("rejects a plan that references an unknown case", async () => {
    await expect(loadPlan(path.join(fixtures, "plan-unknown-case.plan.yaml"))).rejects.toThrow(
      /fall-z/,
    );
  });

  it("rejects a plan whose goldset file does not exist", async () => {
    await expect(
      loadPlan(path.join(fixtures, "..", "..", "..", "goldsets", "fehlt", "plan.yaml")),
    ).rejects.toThrow(/plan\.yaml/);
  });

  it("loads the shipped example plan", async () => {
    const loaded = await loadPlan(path.join(process.cwd(), "goldsets", "beispiel", "plan.yaml"));
    expect(loaded.plan.caseRefs).toHaveLength(8);
    expect(loaded.cases.size).toBe(8);
  });
});
