import { describe, expect, it } from "vitest";
import { z } from "zod";

import { extractJson, parseJsonWith } from "./json.js";

const Verdict = z.strictObject({ pass: z.boolean(), reason: z.string() });

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"pass": true}')).toBe('{"pass": true}');
  });

  it("takes the content of a fenced block", () => {
    expect(extractJson('Hier:\n```json\n{"pass": true}\n```\nFertig.')).toBe('{"pass": true}');
    expect(extractJson("```\n[1, 2]\n```")).toBe("[1, 2]");
  });

  it("cuts prose before and after the document", () => {
    expect(extractJson('Mein Urteil lautet {"pass": false, "reason": "x"} danke.')).toBe(
      '{"pass": false, "reason": "x"}',
    );
  });

  it("returns the trimmed text when there is no brace", () => {
    expect(extractJson("  keine ahnung  ")).toBe("keine ahnung");
  });
});

describe("parseJsonWith", () => {
  it("validates a matching document", () => {
    expect(parseJsonWith(Verdict, '{"pass": true, "reason": "stimmt"}')).toEqual({
      ok: true,
      value: { pass: true, reason: "stimmt" },
    });
  });

  it("explains broken JSON", () => {
    const result = parseJsonWith(Verdict, "{pass: true");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^kein JSON/);
  });

  it("lists schema violations with their path", () => {
    const result = parseJsonWith(Verdict, '{"pass": "ja", "extra": 1}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Schema verletzt");
      expect(result.reason).toContain("pass:");
      expect(result.reason).toContain("reason:");
    }
  });
});
