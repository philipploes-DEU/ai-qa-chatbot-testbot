import { describe, expect, it } from "vitest";

import { agreement, cohensKappa, describeKappa } from "./kappa.js";

describe("cohensKappa", () => {
  it("is 1 for perfect agreement and 0 for chance", () => {
    expect(
      cohensKappa([
        { human: true, judge: true },
        { human: false, judge: false },
        { human: true, judge: true },
      ]),
    ).toBe(1);
    // The judge passes everything: agreement equals the share of human passes, chance too.
    expect(
      cohensKappa([
        { human: true, judge: true },
        { human: false, judge: true },
      ]),
    ).toBe(0);
  });

  it("matches a hand computed value", () => {
    // 20 samples: human pass 10, judge pass 12, both pass 9, both fail 7.
    const pairs = [
      ...Array.from({ length: 9 }, () => ({ human: true, judge: true })),
      ...Array.from({ length: 1 }, () => ({ human: true, judge: false })),
      ...Array.from({ length: 3 }, () => ({ human: false, judge: true })),
      ...Array.from({ length: 7 }, () => ({ human: false, judge: false })),
    ];
    // po = 16/20 = 0.8, pe = 0.5*0.6 + 0.5*0.4 = 0.5, kappa = 0.3/0.5 = 0.6
    expect(cohensKappa(pairs)).toBeCloseTo(0.6, 10);
    expect(agreement(pairs)).toBeCloseTo(0.8, 10);
  });

  it("is below zero when the raters disagree more than chance predicts", () => {
    expect(
      cohensKappa([
        { human: true, judge: false },
        { human: false, judge: true },
      ]),
    ).toBe(-1);
  });

  it("handles a degenerate set where both raters always agree on one label", () => {
    expect(cohensKappa([{ human: true, judge: true }])).toBe(1);
    expect(cohensKappa([{ human: true, judge: false }])).toBe(0);
  });

  it("rejects an empty set", () => {
    expect(() => cohensKappa([])).toThrow(RangeError);
    expect(() => agreement([])).toThrow(RangeError);
  });
});

describe("describeKappa", () => {
  it("maps the value to the Landis and Koch scale", () => {
    expect(describeKappa(-0.1)).toBe("schlechter als Zufall");
    expect(describeKappa(0.1)).toBe("kaum Übereinstimmung");
    expect(describeKappa(0.3)).toBe("geringe Übereinstimmung");
    expect(describeKappa(0.5)).toBe("mäßige Übereinstimmung");
    expect(describeKappa(0.7)).toBe("gute Übereinstimmung");
    expect(describeKappa(0.9)).toBe("sehr gute Übereinstimmung");
  });
});
