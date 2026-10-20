import { describe, expect, it } from "vitest";

import { makeCase } from "../../tests/helpers/cases.js";
import { statusCheck } from "./status.js";

describe("status", () => {
  const forbidden = makeCase({ id: "fremdes-mandat", expected: { status: 403 } });

  it("does not apply without an expected status", () => {
    expect(statusCheck.run(makeCase(), { content: "x", latencyMs: 1, status: 200 })).toBeNull();
  });

  it("passes when the answer carries the expected status", () => {
    const ok = makeCase({ expected: { status: 200 } });
    expect(statusCheck.run(ok, { content: "x", latencyMs: 1, status: 200 })?.pass).toBe(true);
  });

  it("fails an answer with another status and names both", () => {
    const result = statusCheck.run(forbidden, {
      content: "Hier die Dokumente",
      latencyMs: 1,
      status: 200,
    });
    expect(result?.pass).toBe(false);
    expect(result?.reasoning).toBe("status: erwartet 403, erhalten 200");
  });

  it("fails when the adapter reports no status", () => {
    const result = statusCheck.run(forbidden, { content: "x", latencyMs: 1 });
    expect(result?.pass).toBe(false);
    expect(result?.reasoning).toContain("meldet keinen Status");
  });
});
