import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { mustContainCheck } from "./must-contain.js";

describe("mustContainCheck", () => {
  const testCase = makeCase({ expected: { mustContain: ["Montag", "Freitag", "9"] } });

  it("passes when every phrase is present, ignoring case", () => {
    const result = mustContainCheck.run(
      testCase,
      makeResponse("Unser Kundenservice ist montag bis freitag von 9 bis 17 Uhr da."),
    );
    expect(result?.pass).toBe(true);
    expect(result?.source).toBe("check");
    expect(result?.criteria[0]?.name).toBe("mustContain");
  });

  it("fails and names the missing phrases", () => {
    const result = mustContainCheck.run(testCase, makeResponse("Wir sind werktags erreichbar."));
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("Montag");
    expect(result?.criteria[0]?.reason).toContain("Freitag");
    expect(result?.criteria[0]?.reason).not.toContain("17");
  });

  it("does not apply when the case lists no phrases", () => {
    expect(mustContainCheck.run(makeCase(), makeResponse("Egal."))).toBeNull();
  });
});
