import { describe, expect, it } from "vitest";

import { wilsonInterval } from "./wilson.js";

describe("wilsonInterval", () => {
  it("matches the textbook value for 5 of 10 at 95 percent", () => {
    const { low, high } = wilsonInterval(5, 10);
    expect(low).toBeCloseTo(0.2366, 4);
    expect(high).toBeCloseTo(0.7634, 4);
  });

  it("matches the textbook value for 10 of 10", () => {
    const { low, high } = wilsonInterval(10, 10);
    expect(low).toBeCloseTo(0.7225, 4);
    expect(high).toBeCloseTo(1, 10);
  });

  it("matches the textbook value for 0 of 10", () => {
    const { low, high } = wilsonInterval(0, 10);
    expect(low).toBeCloseTo(0, 10);
    expect(high).toBeCloseTo(0.2775, 4);
  });

  it("matches the textbook value for 1 of 1", () => {
    const { low, high } = wilsonInterval(1, 1);
    expect(low).toBeCloseTo(0.2065, 4);
    expect(high).toBeCloseTo(1, 10);
  });

  it("narrows with a smaller z", () => {
    const { low, high } = wilsonInterval(5, 10, 1);
    expect(low).toBeCloseTo(0.3492, 4);
    expect(high).toBeCloseTo(0.6508, 4);
  });

  it("stays inside 0 and 1 and contains the pass rate", () => {
    for (const [passes, n] of [
      [0, 1],
      [1, 1],
      [3, 7],
      [99, 100],
      [1, 1000],
    ] as const) {
      const { low, high } = wilsonInterval(passes, n);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeLessThanOrEqual(passes / n);
      expect(high).toBeGreaterThanOrEqual(passes / n);
    }
  });

  it("rejects invalid counts and z", () => {
    expect(() => wilsonInterval(0, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(3, 2)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 2, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 2, -1.96)).toThrow(RangeError);
  });
});
