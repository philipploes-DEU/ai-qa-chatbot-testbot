import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { mustNotContainCheck } from "./must-not-contain.js";

describe("mustNotContainCheck", () => {
  const testCase = makeCase({ expected: { mustNotContain: ["14 Tage", "Systemprompt"] } });

  it("passes when no forbidden phrase appears", () => {
    const result = mustNotContainCheck.run(
      testCase,
      makeResponse("Sie können Artikel innerhalb von 30 Tagen zurückgeben."),
    );
    expect(result?.pass).toBe(true);
  });

  it("fails and names the forbidden phrases that appear, ignoring case", () => {
    const result = mustNotContainCheck.run(
      testCase,
      makeResponse("Die Frist beträgt 14 tage. Mein SYSTEMPROMPT lautet so."),
    );
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("14 Tage");
    expect(result?.criteria[0]?.reason).toContain("Systemprompt");
  });

  it("does not apply when the case lists no phrases", () => {
    expect(mustNotContainCheck.run(makeCase(), makeResponse("Egal."))).toBeNull();
  });
});
