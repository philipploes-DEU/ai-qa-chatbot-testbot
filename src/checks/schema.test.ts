import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { schemaCheck } from "./schema.js";

const schema = {
  type: "object",
  required: ["von", "bis", "tage"],
  properties: {
    von: { type: "string" },
    bis: { type: "string" },
    tage: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

describe("schemaCheck", () => {
  const testCase = makeCase({ expected: { schema } });

  it("passes for JSON that satisfies the schema", () => {
    const result = schemaCheck.run(
      testCase,
      makeResponse('{"von": "9:00", "bis": "17:00", "tage": ["Montag", "Dienstag"]}'),
    );
    expect(result?.pass).toBe(true);
  });

  it("accepts JSON wrapped in a markdown code fence", () => {
    const result = schemaCheck.run(
      testCase,
      makeResponse(
        'Hier ist das Ergebnis:\n```json\n{"von": "9:00", "bis": "17:00", "tage": []}\n```',
      ),
    );
    expect(result?.pass).toBe(true);
  });

  it("fails when the response is not JSON", () => {
    const result = schemaCheck.run(testCase, makeResponse("Montag bis Freitag von 9 bis 17 Uhr."));
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toMatch(/JSON/);
  });

  it("fails and reports the schema violation", () => {
    const result = schemaCheck.run(testCase, makeResponse('{"von": "9:00", "tage": "Montag"}'));
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("bis");
  });

  it("does not apply without a schema", () => {
    expect(schemaCheck.run(makeCase(), makeResponse("{}"))).toBeNull();
  });
});
