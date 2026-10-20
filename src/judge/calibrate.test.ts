import { describe, expect, it } from "vitest";

import { GoldsetSchema } from "../domain/goldset.js";
import { FakeProvider } from "../providers/fake-provider.js";
import { calibrateJudge } from "./calibrate.js";
import { Judge } from "./judge.js";
import { JUDGE_PROMPT_V1 } from "./prompts/v1.js";
import { JUDGE_PROMPT_V2 } from "./prompts/v2.js";

const goldset = GoldsetSchema.parse({
  id: "kal",
  name: "Kalibrierung",
  owner: "QA",
  cases: [
    {
      id: "faq-oeffnungszeiten",
      kind: "qa",
      input: "Wie lauten die Öffnungszeiten?",
      expected: { answer: "Montag bis Freitag von 9 bis 17 Uhr." },
      rubric: [{ name: "Korrektheit", description: "Wie die Referenz." }],
    },
    { id: "ohne-rubrik", kind: "qa", input: "Witz?", expected: { mustContain: ["x"] } },
  ],
  calibration: {
    minKappa: 0.5,
    samples: [
      { caseId: "faq-oeffnungszeiten", answer: "Mo bis Fr 9 bis 17 Uhr.", pass: true },
      { caseId: "faq-oeffnungszeiten", answer: "Täglich 8 bis 20 Uhr.", pass: false },
      {
        caseId: "faq-oeffnungszeiten",
        answer: "Mo bis Sa.",
        pass: false,
        note: "Samstag erfunden",
      },
      { caseId: "faq-oeffnungszeiten", answer: "Montag bis Freitag, 9 bis 17.", pass: true },
    ],
  },
});

function verdict(pass: boolean): string {
  return JSON.stringify({
    criteria: [{ name: "Korrektheit", pass, reason: pass ? "stimmt" : "falsch" }],
    pass,
    confidence: 1,
    addressesJudge: false,
  });
}

describe("calibrateJudge", () => {
  it("compares the judge with the human labels and releases above minKappa", async () => {
    const provider = new FakeProvider(
      [verdict(true), verdict(false), verdict(false), verdict(true)],
      "richter",
    );
    const seen: string[] = [];
    const result = await calibrateJudge(new Judge(provider, JUDGE_PROMPT_V1), goldset, {
      now: () => new Date("2026-10-11T08:00:00Z"),
      onSample: (sample, error) => {
        seen.push(
          `${sample.caseId}:${sample.human === sample.judge ? "ok" : "anders"}:${error ?? ""}`,
        );
      },
    });
    expect(result).toMatchObject({
      goldsetId: "kal",
      goldsetVersion: "1",
      judgeModel: "richter",
      promptVersion: "v1",
      calibratedAt: "2026-10-11T08:00:00.000Z",
      samples: 4,
      errors: 0,
      agreement: 1,
      kappa: 1,
      minKappa: 0.5,
      released: true,
    });
    expect(result.results[2]?.reasoning).toBe("Korrektheit: falsch");
    expect(seen).toHaveLength(4);
    expect(seen.every((entry) => entry.endsWith(":ok:"))).toBe(true);
  });

  it("rates the samples with the source documents of the goldset", async () => {
    const provider = new FakeProvider([
      verdict(true),
      verdict(false),
      verdict(false),
      verdict(true),
    ]);
    await calibrateJudge(new Judge(provider, JUDGE_PROMPT_V2), goldset, {
      sources: [{ name: "wissen.md", content: "Geöffnet Montag bis Freitag 9 bis 17 Uhr." }],
    });
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls.every((call) => call.prompt.includes("### wissen.md"))).toBe(true);
  });

  it("counts a judge error as disagreement and withholds the release below minKappa", async () => {
    const provider = new FakeProvider([verdict(true), "kein json", verdict(true), verdict(true)]);
    const result = await calibrateJudge(new Judge(provider, JUDGE_PROMPT_V1), goldset);
    expect(result.errors).toBe(1);
    expect(result.results[1]?.judge).toBe(true);
    expect(result.results[1]?.reasoning).toMatch(/^Judge-Fehler: /);
    expect(result.agreement).toBe(0.5);
    expect(result.kappa).toBe(0);
    expect(result.released).toBe(false);
  });

  it("refuses goldsets without calibration set and samples of cases the judge cannot rate", async () => {
    const judge = new Judge(new FakeProvider([]), JUDGE_PROMPT_V1);
    await expect(
      calibrateJudge(judge, GoldsetSchema.parse({ ...goldset, calibration: undefined })),
    ).rejects.toThrow(/kein Kalibrierungsset/);
    const bad = GoldsetSchema.parse({
      ...goldset,
      calibration: { samples: [{ caseId: "ohne-rubrik", answer: "x", pass: true }] },
    });
    await expect(calibrateJudge(judge, bad)).rejects.toThrow(/weder Rubrik noch Referenzantwort/);
  });
});
