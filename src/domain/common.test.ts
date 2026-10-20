import { describe, expect, it } from "vitest";

import { IdSchema, SeveritySchema, TimestampSchema, TurnSchema, VersionSchema } from "./common.js";

describe("IdSchema", () => {
  it.each(["faq-001", "LLM01", "AITG-APP-01", "run.20261010", "a"])("accepts %s", (id) => {
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["", " leading space", "has space", "../escape", "-leading-dash", "slash/inside"])(
    "rejects %j",
    (id) => {
      expect(IdSchema.safeParse(id).success).toBe(false);
    },
  );
});

describe("VersionSchema", () => {
  it("keeps strings", () => {
    expect(VersionSchema.parse("1.2")).toBe("1.2");
  });

  it("turns numbers from YAML into strings", () => {
    expect(VersionSchema.parse(2)).toBe("2");
  });

  it.each(["", -1, 1.5, true, null])("rejects %j", (value) => {
    expect(VersionSchema.safeParse(value).success).toBe(false);
  });
});

describe("SeveritySchema", () => {
  it("accepts the four levels", () => {
    for (const level of ["low", "medium", "high", "critical"]) {
      expect(SeveritySchema.safeParse(level).success).toBe(true);
    }
  });

  it("rejects other words", () => {
    expect(SeveritySchema.safeParse("extreme").success).toBe(false);
  });
});

describe("TimestampSchema", () => {
  it("accepts ISO 8601 with offset", () => {
    expect(TimestampSchema.safeParse("2026-10-10T14:30:00Z").success).toBe(true);
    expect(TimestampSchema.safeParse("2026-10-10T14:30:00.123+02:00").success).toBe(true);
  });

  it("rejects dates without time", () => {
    expect(TimestampSchema.safeParse("2026-10-10").success).toBe(false);
  });
});

describe("TurnSchema", () => {
  it("accepts user, assistant and system turns", () => {
    expect(TurnSchema.safeParse({ role: "user", content: "Hallo" }).success).toBe(true);
    expect(TurnSchema.safeParse({ role: "assistant", content: "Guten Tag" }).success).toBe(true);
    expect(TurnSchema.safeParse({ role: "system", content: "Du bist knapp." }).success).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(TurnSchema.safeParse({ role: "bot", content: "x" }).success).toBe(false);
  });

  it("rejects missing content", () => {
    expect(TurnSchema.safeParse({ role: "user" }).success).toBe(false);
  });
});
