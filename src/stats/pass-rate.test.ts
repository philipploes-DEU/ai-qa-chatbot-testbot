import { describe, expect, it } from "vitest";

import { passRate } from "./pass-rate.js";

describe("passRate", () => {
  it("divides passes by iterations", () => {
    expect(passRate(5, 10)).toBe(0.5);
    expect(passRate(10, 10)).toBe(1);
    expect(passRate(0, 10)).toBe(0);
    expect(passRate(1, 3)).toBeCloseTo(0.3333, 4);
  });

  it("rejects zero or negative iterations", () => {
    expect(() => passRate(0, 0)).toThrow(RangeError);
    expect(() => passRate(0, -1)).toThrow(RangeError);
  });

  it("rejects passes outside 0 to n", () => {
    expect(() => passRate(-1, 10)).toThrow(RangeError);
    expect(() => passRate(11, 10)).toThrow(RangeError);
  });

  it("rejects fractional counts", () => {
    expect(() => passRate(1.5, 10)).toThrow(RangeError);
    expect(() => passRate(1, 10.5)).toThrow(RangeError);
  });
});
