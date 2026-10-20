import { describe, expect, it } from "vitest";

import { binomial, passAllK, passAllKForCase } from "./pass-all-k.js";

describe("binomial", () => {
  it("computes n choose k", () => {
    expect(binomial(5, 3)).toBe(10);
    expect(binomial(5, 0)).toBe(1);
    expect(binomial(5, 5)).toBe(1);
    expect(binomial(10, 2)).toBe(45);
  });

  it("is zero when k exceeds n", () => {
    expect(binomial(3, 5)).toBe(0);
  });
});

describe("passAllKForCase", () => {
  it("is one when every iteration passed", () => {
    expect(passAllKForCase([true, true, true, true, true], 3)).toBe(1);
  });

  it("estimates the chance that k random iterations all pass", () => {
    // 4 passes of 5: C(4,3) / C(5,3) = 4 / 10
    expect(passAllKForCase([true, true, true, true, false], 3)).toBeCloseTo(0.4, 10);
  });

  it("is zero when fewer than k iterations passed", () => {
    expect(passAllKForCase([true, true, false, false, false], 3)).toBe(0);
  });

  it("equals the pass rate for k of 1", () => {
    expect(passAllKForCase([true, false, false], 1)).toBeCloseTo(1 / 3, 10);
  });

  it("rejects k below 1 or above the number of iterations", () => {
    expect(() => passAllKForCase([true, true], 0)).toThrow(RangeError);
    expect(() => passAllKForCase([true, true], 3)).toThrow(RangeError);
  });
});

describe("passAllK", () => {
  it("averages the estimate over all cases", () => {
    const outcomes = { a: [true, true, true], b: [true, false, false] };
    expect(passAllK(outcomes, 1)).toBeCloseTo((1 + 1 / 3) / 2, 10);
    expect(passAllK(outcomes, 3)).toBeCloseTo(0.5, 10);
  });

  it("rejects an empty set of cases", () => {
    expect(() => passAllK({}, 1)).toThrow(RangeError);
  });

  it("rejects when any case has fewer iterations than k", () => {
    expect(() => passAllK({ a: [true, true, true], b: [true] }, 2)).toThrow(RangeError);
  });
});
