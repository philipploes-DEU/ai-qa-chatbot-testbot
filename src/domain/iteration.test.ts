import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { IterationSchema } from "./iteration.js";

const validIteration = {
  runId: "20261010-120000-ab12",
  caseId: "faq-001",
  index: 0,
  seed: 0,
  request: [{ role: "user", content: "Wie lauten die Öffnungszeiten?" }],
  response: "Montag bis Freitag von 9 Uhr bis 17 Uhr.",
  latencyMs: 12,
};

describe("IterationSchema", () => {
  it("accepts a successful iteration", () => {
    const parsed = IterationSchema.parse(validIteration);
    expect(parsed.error).toBeUndefined();
    expect(parsed.tokens).toBeUndefined();
  });

  it("accepts a failed iteration with null response and error", () => {
    const parsed = IterationSchema.parse({
      ...validIteration,
      response: null,
      error: "timeout",
      latencyMs: 15000,
    });
    expect(parsed.response).toBeNull();
    expect(parsed.error).toBe("timeout");
  });

  it("accepts token counts", () => {
    const parsed = IterationSchema.parse({ ...validIteration, tokens: { input: 12, output: 30 } });
    expect(parsed.tokens?.output).toBe(30);
  });

  it("rejects a negative latency", () => {
    const result = IterationSchema.safeParse({ ...validIteration, latencyMs: -1 });
    expect(failurePaths(result)).toContain("latencyMs");
  });

  it("rejects a negative index", () => {
    const result = IterationSchema.safeParse({ ...validIteration, index: -1 });
    expect(failurePaths(result)).toContain("index");
  });

  it("rejects an empty request", () => {
    const result = IterationSchema.safeParse({ ...validIteration, request: [] });
    expect(failurePaths(result)).toContain("request");
  });

  it("rejects a missing response field", () => {
    const { response: _response, ...withoutResponse } = validIteration;
    const result = IterationSchema.safeParse(withoutResponse);
    expect(failurePaths(result)).toContain("response");
  });
});

describe("IterationSchema rounds", () => {
  it("records the rounds of a dialog", () => {
    const parsed = IterationSchema.parse({
      runId: "run-1",
      caseId: "dialog-1",
      index: 0,
      seed: 0,
      request: [
        { role: "user", content: "Ich heiße Jonas." },
        { role: "user", content: "Wie heiße ich?" },
      ],
      response: "Du heißt Jonas.",
      latencyMs: 12,
      rounds: [
        {
          index: 0,
          request: { role: "user", content: "Ich heiße Jonas." },
          response: "Freut mich, Jonas.",
          latencyMs: 5,
        },
        {
          index: 1,
          request: { role: "user", content: "Wie heiße ich?" },
          response: "Du heißt Jonas.",
          latencyMs: 7,
        },
      ],
    });
    expect(parsed.rounds).toHaveLength(2);
    expect(parsed.rounds?.[1]?.response).toBe("Du heißt Jonas.");
  });
});
