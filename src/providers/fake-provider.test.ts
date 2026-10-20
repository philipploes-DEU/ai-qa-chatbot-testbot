import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FakeProvider } from "./fake-provider.js";
import { InvalidJsonError, ModelRefusalError } from "./json.js";

const Verdict = z.strictObject({ pass: z.boolean(), reason: z.string() });

describe("FakeProvider", () => {
  it("answers recorded texts in order and records the calls", async () => {
    const provider = new FakeProvider([
      '{"pass": true, "reason": "eins"}',
      'Urteil: ```json\n{"pass": false, "reason": "zwei"}\n```',
    ]);
    const first = await provider.generateJson({ prompt: "A", schema: Verdict, system: "S" });
    const second = await provider.generateJson({ prompt: "B", schema: Verdict });
    expect(first.value).toEqual({ pass: true, reason: "eins" });
    expect(second.value).toEqual({ pass: false, reason: "zwei" });
    expect(first.attempts).toBe(1);
    expect(provider.calls).toEqual([{ system: "S", prompt: "A" }, { prompt: "B" }]);
    expect(provider.name).toBe("fake");
    expect(provider.model).toBe("fake-model");
  });

  it("fails like a provider when a recorded answer does not fit the schema", async () => {
    const provider = new FakeProvider(['{"pass": "ja"}']);
    await expect(provider.generateJson({ prompt: "A", schema: Verdict })).rejects.toBeInstanceOf(
      InvalidJsonError,
    );
  });

  it("fails when the recorded answers are used up", async () => {
    const provider = new FakeProvider([]);
    await expect(provider.generateJson({ prompt: "A", schema: Verdict })).rejects.toThrow(
      /keine aufgezeichnete Antwort/,
    );
  });
  it("fails with a recorded error, for example a refusal of the model (issue #83)", async () => {
    const provider = new FakeProvider([
      new ModelRefusalError("leere Antwort"),
      '{"pass": true, "reason": "x"}',
    ]);
    await expect(provider.generateJson({ prompt: "A", schema: Verdict })).rejects.toBeInstanceOf(
      ModelRefusalError,
    );
    const next = await provider.generateJson({ prompt: "B", schema: Verdict });
    expect(next.value.pass).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });
});
