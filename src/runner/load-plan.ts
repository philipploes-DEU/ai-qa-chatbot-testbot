import path from "node:path";

import type { Goldset } from "../domain/goldset.js";
import { type Plan, PlanSchema } from "../domain/plan.js";
import type { TestCase } from "../domain/test-case.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { loadDocument } from "../io/yaml.js";
import { indexCases } from "./run-plan.js";

export interface LoadedPlan {
  plan: Plan;
  goldsets: Goldset[];
  /** Absolute paths of the goldset files, in the order of goldsets. */
  files: string[];
  cases: Map<string, TestCase>;
  /** Directory of the plan file; goldset paths are relative to it. */
  dir: string;
}

/** Loads a plan with the goldsets it references and checks that every case exists. */
export async function loadPlan(file: string): Promise<LoadedPlan> {
  const plan = await loadDocument(PlanSchema, file);
  const dir = path.dirname(path.resolve(file));
  const goldsets: Goldset[] = [];
  const files = plan.goldsets.map((ref) => path.resolve(dir, ref));
  for (const goldsetFile of files) {
    goldsets.push(await loadGoldset(goldsetFile));
  }
  const cases = indexCases(goldsets);
  const unknown = plan.caseRefs.filter((ref) => !cases.has(ref.caseId)).map((ref) => ref.caseId);
  if (unknown.length > 0) {
    throw new Error(`${file}: der Plan verweist auf unbekannte Fälle: ${unknown.join(", ")}`);
  }
  return { plan, goldsets, files, cases, dir };
}
