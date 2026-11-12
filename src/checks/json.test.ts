import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { jsonCheck } from "./json.js";

const json = [
  { path: "$.erfunden.length", equals: 0 },
  { path: "$.treffer", min: 12 },
  { path: "$.eintraege[*].kennung", contains: "p-jonas" },
  { path: "$.fehler", empty: true },
];

describe("jsonCheck", () => {
  const testCase = makeCase({ expected: { json } });

  it("gives every condition its own criterion", () => {
    const result = jsonCheck.run(
      testCase,
      makeResponse('{"erfunden": [], "treffer": 14, "eintraege": [{"kennung": "p-jonas"}]}'),
    );
    expect(result?.pass).toBe(true);
    expect(result?.source).toBe("check");
    expect(result?.criteria.map((criterion) => [criterion.name, criterion.pass])).toEqual([
      ["json: $.erfunden.length = 0", true],
      ["json: $.treffer >= 12", true],
      ['json: $.eintraege[*].kennung enthält "p-jonas"', true],
      ["json: $.fehler leer", true],
    ]);
  });

  it("fails only the conditions that do not hold", () => {
    const result = jsonCheck.run(
      testCase,
      makeResponse(
        '```json\n{"erfunden": ["x"], "treffer": 14, "eintraege": [], "fehler": null}\n```',
      ),
    );
    expect(result?.pass).toBe(false);
    expect(result?.criteria.map((criterion) => criterion.pass)).toEqual([false, true, false, true]);
    expect(result?.criteria[0]?.reason).toBe("Wert ist 1, erwartet 0");
    expect(result?.reasoning).toBe(
      'json: 2 von 4 Bedingungen verletzt: $.erfunden.length = 0, $.eintraege[*].kennung enthält "p-jonas"',
    );
  });

  it("fails every condition when the answer is not JSON", () => {
    const result = jsonCheck.run(testCase, makeResponse("Leider kein JSON."));
    expect(result?.pass).toBe(false);
    expect(result?.criteria).toHaveLength(4);
    expect(result?.criteria.every((criterion) => !criterion.pass)).toBe(true);
    expect(result?.criteria[0]?.reason).toBe("Antwort ist kein gültiges JSON");
  });

  it("uses the name of a condition", () => {
    const named = makeCase({
      expected: { json: [{ name: "nichts erfunden", path: "$.erfunden.length", equals: 0 }] },
    });
    const result = jsonCheck.run(named, makeResponse('{"erfunden": []}'));
    expect(result?.criteria[0]?.name).toBe("json: nichts erfunden");
  });

  it("does not apply without conditions", () => {
    expect(jsonCheck.run(makeCase(), makeResponse("{}"))).toBeNull();
  });
});
