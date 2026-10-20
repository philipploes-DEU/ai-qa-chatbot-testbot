import type { TargetResponse } from "../../src/adapters/target.js";
import { type TestCase, type TestCaseInput, TestCaseSchema } from "../../src/domain/test-case.js";

/** Builds a parsed test case with defaults; pass only what the test cares about. */
export function makeCase(overrides: Partial<TestCaseInput> = {}): TestCase {
  return TestCaseSchema.parse({
    id: "case-1",
    kind: "qa",
    input: "Wie lauten die Öffnungszeiten?",
    ...overrides,
  });
}

export function makeResponse(content: string, latencyMs = 10): TargetResponse {
  return { content, latencyMs };
}
