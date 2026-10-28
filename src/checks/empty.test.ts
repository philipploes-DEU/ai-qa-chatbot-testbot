import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { emptyCheck } from "./empty.js";

describe("emptyCheck (issue #113)", () => {
  it("fails an empty answer and one made of whitespace", () => {
    expect(emptyCheck.run(makeCase(), makeResponse(""))).toMatchObject({
      pass: false,
      criteria: [{ name: "empty", pass: false, reason: "leere Antwort" }],
    });
    expect(emptyCheck.run(makeCase(), makeResponse(" \n\t "))?.pass).toBe(false);
  });

  it("passes an answer with content", () => {
    expect(emptyCheck.run(makeCase(), makeResponse("Montag bis Freitag."))).toMatchObject({
      pass: true,
      criteria: [{ name: "empty", pass: true }],
    });
  });

  it("does not apply when the case allows an empty answer or expects an HTTP status", () => {
    expect(emptyCheck.run(makeCase({ expected: { allowEmpty: true } }), makeResponse(""))).toBe(
      null,
    );
    expect(emptyCheck.run(makeCase({ expected: { status: 403 } }), makeResponse(""))).toBe(null);
  });
});
