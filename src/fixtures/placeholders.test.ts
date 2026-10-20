import { describe, expect, it } from "vitest";

import { TestCaseSchema } from "../domain/test-case.js";
import { bindCases, bindForRun, placeholdersOf, sameBoundValues } from "./placeholders.js";

const stand = TestCaseSchema.parse({
  id: "stand",
  kind: "qa",
  input: "Wo finde ich {{fixtures.aussteller_1}}?",
  expected: {
    mustContain: ["{{ fixtures.stand_1 }}"],
    mustNotContain: ["{{fixtures.stand_2}}"],
    mustNotClaim: ["{{fixtures.stand_2}} gehört zu {{fixtures.aussteller_1}}"],
    mustMatch: ["Halle \\d"],
    answer: "{{fixtures.aussteller_1}} steht an {{fixtures.stand_1}}.",
  },
  rubric: [{ name: "Ort", description: "Nennt {{fixtures.stand_1}}." }],
  vars: { aussteller: "{{fixtures.aussteller_1}}" },
  tags: ["{{fixtures.aussteller_1}}"],
});

const dialog = TestCaseSchema.parse({
  id: "nachfrage",
  kind: "dialog",
  input: [
    { role: "user", content: "Ist {{fixtures.aussteller_1}} dabei?" },
    { role: "assistant", content: "Ja, an {{fixtures.stand_1}}." },
    { role: "user", content: "Danke." },
  ],
});

const plain = TestCaseSchema.parse({ id: "plain", kind: "qa", input: "Öffnungszeiten?" });

describe("placeholdersOf (issue #93)", () => {
  it("lists the placeholders of the allowed fields in order, each once", () => {
    expect(placeholdersOf(stand)).toEqual(["aussteller_1", "stand_1", "stand_2"]);
    expect(placeholdersOf(dialog)).toEqual(["aussteller_1", "stand_1"]);
    expect(placeholdersOf(plain)).toEqual([]);
  });
});

describe("bindCases (issue #93)", () => {
  const values = new Map([
    ["aussteller_1", "Gartenhelden GmbH"],
    ["stand_1", "Halle 3, Stand B12"],
    ["stand_2", "Halle 5, Stand A1"],
  ]);

  it("fills every allowed field and leaves the rest alone", () => {
    const { cases, unresolved } = bindCases([stand, dialog, plain], values);
    expect(unresolved.size).toBe(0);
    const bound = cases.get("stand");
    expect(bound?.input).toBe("Wo finde ich Gartenhelden GmbH?");
    expect(bound?.expected.mustContain).toEqual(["Halle 3, Stand B12"]);
    expect(bound?.expected.mustNotContain).toEqual(["Halle 5, Stand A1"]);
    expect(bound?.expected.mustNotClaim).toEqual(["Halle 5, Stand A1 gehört zu Gartenhelden GmbH"]);
    expect(bound?.expected.mustMatch).toEqual(["Halle \\d"]);
    expect(bound?.expected.answer).toBe("Gartenhelden GmbH steht an Halle 3, Stand B12.");
    expect(bound?.rubric[0]?.description).toBe("Nennt Halle 3, Stand B12.");
    expect(bound?.vars).toEqual({ aussteller: "Gartenhelden GmbH" });
    expect(bound?.tags).toEqual(["{{fixtures.aussteller_1}}"]);
    const turns = cases.get("nachfrage")?.input;
    expect(Array.isArray(turns) ? turns.map((turn) => turn.content) : []).toEqual([
      "Ist Gartenhelden GmbH dabei?",
      "Ja, an Halle 3, Stand B12.",
      "Danke.",
    ]);
    expect(cases.get("plain")).toBe(plain);
  });

  it("marks a case unresolved when one of its placeholders has no value", () => {
    const { cases, unresolved } = bindCases(
      [stand, dialog],
      new Map([
        ["aussteller_1", "X"],
        ["stand_1", "Y"],
      ]),
    );
    expect(unresolved.get("stand")).toEqual(["stand_2"]);
    expect(unresolved.has("nachfrage")).toBe(false);
    expect(cases.has("stand")).toBe(false);
    expect(cases.get("nachfrage")?.id).toBe("nachfrage");
  });
});

describe("bindForRun (issue #93)", () => {
  const binding = (value: string) => ({
    createdAt: "2026-10-20T08:00:00.000Z",
    target: "messe",
    entries: [
      { placeholder: "aussteller_1", status: "bound" as const, value },
      { placeholder: "stand_1", status: "bound" as const, value: "B12" },
      { placeholder: "stand_2", status: "unresolved" as const, reason: "fehlt" },
    ],
  });
  const all = new Map([
    ["stand", stand],
    ["nachfrage", dialog],
    ["plain", plain],
  ]);

  it("fills the cases of a run with the binding that run used", () => {
    const { cases, skipped } = bindForRun(all, binding("Gartenhelden GmbH"));
    expect(cases.get("nachfrage")?.input).toEqual([
      { role: "user", content: "Ist Gartenhelden GmbH dabei?" },
      { role: "assistant", content: "Ja, an B12." },
      { role: "user", content: "Danke." },
    ]);
    expect(cases.get("plain")).toBe(plain);
    expect(skipped).toEqual(["stand"]);
  });

  it("skips every case with placeholders when the run has no binding", () => {
    const { cases, skipped } = bindForRun(all, null);
    expect([...cases.keys()]).toEqual(["plain"]);
    expect(skipped).toEqual(["stand", "nachfrage"]);
  });

  it("tells whether two runs bound the placeholders of a case alike", () => {
    expect(sameBoundValues(dialog, binding("A"), binding("A"))).toBe(true);
    expect(sameBoundValues(dialog, binding("A"), binding("B"))).toBe(false);
    expect(sameBoundValues(dialog, binding("A"), null)).toBe(false);
    expect(sameBoundValues(plain, null, null)).toBe(true);
  });
});
