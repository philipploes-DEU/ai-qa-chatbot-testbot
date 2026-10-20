import { describe, expect, it } from "vitest";

import { makeCase } from "../../tests/helpers/cases.js";
import type { Round } from "../domain/iteration.js";
import { FakeProvider } from "../providers/fake-provider.js";
import { judgeIteration } from "./judge-iteration.js";
import { DIALOG_CRITERIA, Judge } from "./judge.js";
import { JUDGE_PROMPT_V1 } from "./prompts/v1.js";

function answer(names: string[], pass = true): string {
  return JSON.stringify({
    criteria: names.map((name) => ({ name, pass, reason: pass ? "ok" : "nein" })),
    pass,
    confidence: 0.9,
    addressesJudge: false,
  });
}

const DIALOG_ANSWER = answer(DIALOG_CRITERIA.map((criterion) => criterion.name));

function roundsOf(...pairs: [string, string][]): Round[] {
  return pairs.map(([question, response], index) => ({
    index,
    request: { role: "user", content: question },
    response,
    latencyMs: 1,
  }));
}

describe("judgeIteration for dialogs", () => {
  const express = makeCase({
    id: "dialog-express",
    kind: "dialog",
    input: [
      { role: "user", content: "Hallo, ich bin Jonas." },
      { role: "assistant", content: "Hallo Jonas, wobei kann ich helfen?" },
      { role: "user", content: "Was kostet Express, und wie heiße ich?" },
    ],
    expected: { answer: "Express kostet 9,90 €, Jonas." },
    rubric: [{ name: "Kontext", description: "Nennt Jonas und 9,90 € für Express." }],
  });

  it("judges the last round against the case rubric and reference, an earlier scripted round against the round criterion", async () => {
    const provider = new FakeProvider([
      answer(["passt-zur-runde"]),
      answer(["Kontext"]),
      DIALOG_ANSWER,
    ]);
    const rounds = roundsOf(
      ["Hallo, ich bin Jonas.", "Hallo Jonas, was kann ich für dich tun?"],
      ["Was kostet Express, und wie heiße ich?", "Express kostet 9,90 €, Jonas."],
    );
    const rated = await judgeIteration(
      new Judge(provider, JUDGE_PROMPT_V1),
      express,
      { content: "Express kostet 9,90 €, Jonas.", latencyMs: 1 },
      rounds,
    );

    expect(rated.pass).toBe(true);
    expect(rated.verdicts.map((verdict) => verdict.round)).toEqual([1, 2, undefined]);
    expect(rated.verdicts[0]?.criteria.map((c) => c.name)).toEqual(["Runde 1: passt-zur-runde"]);
    expect(rated.verdicts[1]?.criteria.map((c) => c.name)).toEqual(["Runde 2: Kontext"]);

    const early = provider.calls[0]?.prompt ?? "";
    expect(early).toContain("Referenzantwort: Hallo Jonas, wobei kann ich helfen?");
    expect(early).toContain("- passt-zur-runde (Gewicht 1)");
    expect(early).not.toContain("Kontext (Gewicht");
    expect(early).not.toContain("9,90");

    const last = provider.calls[1]?.prompt ?? "";
    expect(last).toContain("Referenzantwort: Express kostet 9,90 €, Jonas.");
    expect(last).toContain("- Kontext (Gewicht 1)");
    expect(last).not.toContain("passt-zur-runde");
    expect(last).toContain("Zielsystem: Hallo Jonas, was kann ich für dich tun?");
    expect(provider.calls[2]?.prompt).toContain("Rubrik für das Gesamtgespräch");
  });

  it("gives an earlier round without a scripted answer no verdict and never the reference of the case", async () => {
    const unscripted = makeCase({
      ...express,
      input: [
        { role: "user", content: "Hallo, ich bin Jonas." },
        { role: "user", content: "Was kostet Express, und wie heiße ich?" },
      ],
    });
    const provider = new FakeProvider([answer(["Kontext"]), DIALOG_ANSWER]);
    const rounds = roundsOf(
      ["Hallo, ich bin Jonas.", "Hallo Jonas."],
      ["Was kostet Express, und wie heiße ich?", "Express kostet 9,90 €, Jonas."],
    );
    const rated = await judgeIteration(
      new Judge(provider, JUDGE_PROMPT_V1),
      unscripted,
      { content: "Express kostet 9,90 €, Jonas.", latencyMs: 1 },
      rounds,
    );

    expect(provider.calls).toHaveLength(2);
    expect(rated.verdicts.map((verdict) => verdict.round)).toEqual([2, undefined]);
    expect(provider.calls[0]?.prompt).toContain("Referenzantwort: Express kostet 9,90 €, Jonas.");
    expect(provider.calls[0]?.prompt).toContain("Zielsystem: Hallo Jonas.");
  });

  it("judges only the scripted earlier rounds when the case has neither rubric nor reference", async () => {
    const bare = makeCase({ ...express, expected: {}, rubric: [] });
    const provider = new FakeProvider([answer(["passt-zur-runde"], false), DIALOG_ANSWER]);
    const rounds = roundsOf(
      ["Hallo, ich bin Jonas.", "Was willst du?"],
      ["Was kostet Express, und wie heiße ich?", "Express kostet 9,90 €, Jonas."],
    );
    const rated = await judgeIteration(
      new Judge(provider, JUDGE_PROMPT_V1),
      bare,
      { content: "Express kostet 9,90 €, Jonas.", latencyMs: 1 },
      rounds,
    );

    expect(provider.calls).toHaveLength(2);
    expect(rated.verdicts.map((verdict) => verdict.round)).toEqual([1, undefined]);
    expect(rated.verdicts[0]?.criteria[0]?.name).toBe("Runde 1: passt-zur-runde");
    expect(rated.pass).toBe(false);
  });
});
