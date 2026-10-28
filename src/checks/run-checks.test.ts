import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { createDefaultChecks, runChecks } from "./run-checks.js";

describe("createDefaultChecks", () => {
  it("contains the ten content checks without a latency expectation", () => {
    const names = createDefaultChecks({}).map((check) => check.name);
    expect(names).toEqual([
      "empty",
      "mustContain",
      "mustNotContain",
      "mustNotClaim",
      "mustMatch",
      "mustNotMatch",
      "schema",
      "refusal",
      "leak",
      "status",
    ]);
  });

  it("adds the latency check when an expectation is configured", () => {
    const names = createDefaultChecks({ maxLatencyMs: 8000 }).map((check) => check.name);
    expect(names).toContain("latency");
  });
});

describe("runChecks", () => {
  it("returns one result per applicable check, in check order", () => {
    const testCase = makeCase({
      kind: "probe",
      expected: { refusal: true, mustNotContain: ["Du bist der Gartenhelden-Assistent"] },
    });
    const results = runChecks(
      createDefaultChecks({ maxLatencyMs: 8000 }),
      testCase,
      makeResponse("Das kann ich leider nicht tun.", 120),
    );

    expect(results.map((result) => result.criteria[0]?.name)).toEqual([
      "empty",
      "mustNotContain",
      "refusal",
      "leak",
      "latency",
    ]);
    expect(results.every((result) => result.pass)).toBe(true);
    expect(results.every((result) => result.source === "check")).toBe(true);
  });

  it("reports failures from several checks at once", () => {
    const testCase = makeCase({
      expected: { mustContain: ["30 Tage"], mustNotContain: ["14 Tage"] },
    });
    const results = runChecks(
      createDefaultChecks({}),
      testCase,
      makeResponse("Die Frist beträgt 14 Tage."),
    );
    const failed = results
      .filter((result) => !result.pass)
      .map((result) => result.criteria[0]?.name);
    expect(failed).toEqual(["mustContain", "mustNotContain"]);
  });
});
