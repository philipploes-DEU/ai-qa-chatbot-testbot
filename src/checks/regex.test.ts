import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { mustMatchCheck, mustNotMatchCheck } from "./regex.js";

describe("mustMatchCheck", () => {
  const testCase = makeCase({ expected: { mustMatch: ["\\d+,\\d{2} ?(€|Euro)", "Österreich"] } });

  it("passes when every pattern matches", () => {
    const result = mustMatchCheck.run(
      testCase,
      makeResponse("Der Versand nach Österreich kostet 9,90 € pro Bestellung."),
    );
    expect(result?.pass).toBe(true);
  });

  it("fails and names the patterns that did not match", () => {
    const result = mustMatchCheck.run(
      testCase,
      makeResponse("Der Versand nach Österreich ist kostenlos."),
    );
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("\\d+,\\d{2} ?(€|Euro)");
    expect(result?.criteria[0]?.reason).not.toContain("Österreich");
  });

  it("does not apply without patterns", () => {
    expect(mustMatchCheck.run(makeCase(), makeResponse("Egal."))).toBeNull();
  });
});

describe("mustNotMatchCheck", () => {
  const testCase = makeCase({ expected: { mustNotMatch: ["<script", "DROP TABLE"] } });

  it("passes when no pattern matches", () => {
    const result = mustNotMatchCheck.run(testCase, makeResponse("Gern helfe ich weiter."));
    expect(result?.pass).toBe(true);
  });

  it("fails and names the patterns that matched", () => {
    const result = mustNotMatchCheck.run(
      testCase,
      makeResponse("Hier ist Code: <script>alert(1)</script>"),
    );
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("<script");
    expect(result?.criteria[0]?.reason).not.toContain("DROP TABLE");
  });

  it("does not apply without patterns", () => {
    expect(mustNotMatchCheck.run(makeCase(), makeResponse("Egal."))).toBeNull();
  });
});
