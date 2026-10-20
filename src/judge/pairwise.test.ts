import { describe, expect, it } from "vitest";

import { makeCase } from "../../tests/helpers/cases.js";
import { FakeProvider } from "../providers/fake-provider.js";
import { Judge } from "./judge.js";
import { buildPairTask, judgePair } from "./pairwise.js";
import { JUDGE_PROMPT_V1 } from "./prompts/v1.js";

const testCase = makeCase({
  id: "faq",
  input: "Wie lauten die Öffnungszeiten?",
  expected: { answer: "Montag bis Freitag von 9 bis 17 Uhr." },
  rubric: [{ name: "Korrektheit", description: "Wie die Referenz.", weight: 2 }],
});

function pick(winner: "A" | "B" | "tie", addressesJudge = false): string {
  return JSON.stringify({ winner, reason: `gewählt ${winner}`, confidence: 0.8, addressesJudge });
}

describe("buildPairTask", () => {
  it("shows input, reference, rubric and both answers in order", () => {
    const task = buildPairTask(testCase, testCase.rubric, "erste", "zweite");
    expect(task).toContain("Referenzantwort: Montag bis Freitag von 9 bis 17 Uhr.");
    expect(task).toContain("- Korrektheit (Gewicht 2): Wie die Referenz.");
    expect(task.indexOf("<<<ANTWORT A\nerste\nANTWORT A>>>")).toBeLessThan(
      task.indexOf("<<<ANTWORT B\nzweite\nANTWORT B>>>"),
    );
  });
});

describe("judgePair", () => {
  it("counts a pick that survives the position swap", async () => {
    // Order 1: A = base, B = head, judge picks B (head). Order 2: A = head, judge picks A (head).
    const provider = new FakeProvider([pick("B"), pick("A")], "richter");
    const outcome = await judgePair(new Judge(provider, JUDGE_PROMPT_V1), testCase, "alt", "neu");
    expect(outcome.verdict.winner).toBe("head");
    expect(outcome.verdict.orders.map((order) => `${order.first}:${order.winner}`)).toEqual([
      "base:head",
      "head:head",
    ]);
    expect(outcome.verdict.judgeModel).toBe("richter");
    expect(outcome.verdict.promptVersion).toBe("v1");
    expect(outcome.tokens.input).toBeGreaterThan(0);
    expect(provider.calls[0]?.prompt).toContain("<<<ANTWORT A\nalt\n");
    expect(provider.calls[1]?.prompt).toContain("<<<ANTWORT A\nneu\n");
  });

  it("is undecided when the judge follows the position", async () => {
    // The judge always prefers A: base first, then head first.
    const provider = new FakeProvider([pick("A"), pick("A")]);
    const outcome = await judgePair(new Judge(provider, JUDGE_PROMPT_V1), testCase, "alt", "neu");
    expect(outcome.verdict.winner).toBe("undecided");
    expect(outcome.verdict.reasoning).toContain("Widerspruch je nach Reihenfolge");
  });

  it("returns tie when both orders say tie and marks answers that address the judge", async () => {
    const provider = new FakeProvider([pick("tie"), pick("tie", true)]);
    const outcome = await judgePair(new Judge(provider, JUDGE_PROMPT_V1), testCase, "a", "b");
    expect(outcome.verdict.winner).toBe("tie");
    expect(outcome.verdict.orders[1].reason).toContain("spricht den Prüfer an");
  });

  it("uses the default criterion for cases without rubric", async () => {
    const provider = new FakeProvider([pick("B"), pick("A")]);
    const plain = makeCase({ expected: { mustContain: ["x"] } });
    const outcome = await judgePair(new Judge(provider, JUDGE_PROMPT_V1), plain, "a", "b");
    expect(outcome.verdict.winner).toBe("head");
    expect(provider.calls[0]?.prompt).toContain("- Korrektheit (Gewicht 1)");
  });
});
