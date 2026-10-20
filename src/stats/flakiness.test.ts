import { describe, expect, it } from "vitest";

import { flakiness, isFlaky, minorityShare } from "./flakiness.js";

describe("minorityShare", () => {
  it("is zero when all iterations agree", () => {
    expect(minorityShare([true, true, true])).toBe(0);
    expect(minorityShare([false, false])).toBe(0);
  });

  it("is the share of iterations that deviate from the majority", () => {
    expect(minorityShare([true, true, true, true, false])).toBeCloseTo(0.2, 10);
    expect(minorityShare([true, true, true, false, false])).toBeCloseTo(0.4, 10);
    expect(minorityShare([true, false])).toBe(0.5);
  });

  it("rejects an empty list", () => {
    expect(() => minorityShare([])).toThrow(RangeError);
  });
});

describe("isFlaky", () => {
  it("is true only when passes and fails both occur", () => {
    expect(isFlaky([true, false, true])).toBe(true);
    expect(isFlaky([true, true])).toBe(false);
    expect(isFlaky([false, false])).toBe(false);
  });
});

describe("flakiness", () => {
  it("computes the minority share per case", () => {
    const result = flakiness({
      stable: [true, true, true],
      wobbly: [true, false, true, true],
      broken: [false, false],
    });
    expect(result).toEqual({ stable: 0, wobbly: 0.25, broken: 0 });
  });

  it("returns an empty object for no cases", () => {
    expect(flakiness({})).toEqual({});
  });
});
