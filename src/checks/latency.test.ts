import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { createLatencyCheck } from "./latency.js";

describe("createLatencyCheck", () => {
  const check = createLatencyCheck(8000);

  it("is named latency", () => {
    expect(check.name).toBe("latency");
  });

  it("passes when the answer arrived within the expectation", () => {
    const result = check.run(makeCase(), makeResponse("Antwort", 500));
    expect(result?.pass).toBe(true);
  });

  it("passes exactly at the limit", () => {
    expect(check.run(makeCase(), makeResponse("Antwort", 8000))?.pass).toBe(true);
  });

  it("fails and reports both numbers when the answer was too slow", () => {
    const result = check.run(makeCase(), makeResponse("Antwort", 9000));
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("9000");
    expect(result?.criteria[0]?.reason).toContain("8000");
  });

  it("rejects a non positive expectation", () => {
    expect(() => createLatencyCheck(0)).toThrow(RangeError);
  });
});
