import { describe, expect, it } from "vitest";

import { failurePaths } from "../../tests/helpers/schema.js";
import { PlaywrightSpecSchema } from "./playwright-spec.js";

const validSpec = {
  name: "beispiel-web",
  input: { selector: "textarea[name=message]" },
  send: { method: "enter" },
  response: {
    selector: ".chat-message.assistant",
    wait: { type: "stable", forMs: 1500 },
  },
  before: [{ action: "click", selector: "#cookie-ok" }],
  reset: { method: "reload" },
};

describe("PlaywrightSpecSchema", () => {
  it("accepts a spec with enter to send and stable wait", () => {
    const parsed = PlaywrightSpecSchema.parse(validSpec);
    expect(parsed.send).toEqual({ method: "enter" });
    expect(parsed.before).toHaveLength(1);
  });

  it("defaults before to empty and reset to reload", () => {
    const { before: _before, reset: _reset, ...minimal } = validSpec;
    const parsed = PlaywrightSpecSchema.parse(minimal);
    expect(parsed.before).toEqual([]);
    expect(parsed.reset).toEqual({ method: "reload" });
  });

  it("accepts a send button, a signal wait and preparation steps", () => {
    const parsed = PlaywrightSpecSchema.parse({
      ...validSpec,
      send: { method: "click", selector: "button[type=submit]" },
      response: {
        selector: ".chat-message.assistant",
        wait: { type: "signal", selector: ".streaming-indicator", state: "hidden" },
      },
      before: [
        { action: "goto", url: "https://staging.example.test/login" },
        { action: "fill", selector: "#user", value: "${AIQA_TARGET_USER}" },
        { action: "waitFor", selector: "#chat" },
      ],
      reset: { method: "click", selector: "#new-conversation" },
    });
    expect(parsed.before).toHaveLength(3);
  });

  it("rejects unknown send methods", () => {
    const result = PlaywrightSpecSchema.safeParse({ ...validSpec, send: { method: "tap" } });
    expect(failurePaths(result).some((path) => path.startsWith("send"))).toBe(true);
  });

  it("rejects unknown wait types", () => {
    const result = PlaywrightSpecSchema.safeParse({
      ...validSpec,
      response: { selector: ".x", wait: { type: "sleep", forMs: 100 } },
    });
    expect(failurePaths(result).some((path) => path.startsWith("response.wait"))).toBe(true);
  });

  it("rejects a missing response selector", () => {
    const result = PlaywrightSpecSchema.safeParse({
      ...validSpec,
      response: { wait: { type: "stable", forMs: 1000 } },
    });
    expect(failurePaths(result)).toContain("response.selector");
  });

  it("rejects unknown fields", () => {
    const result = PlaywrightSpecSchema.safeParse({ ...validSpec, timeoutMs: 5 });
    expect(result.success).toBe(false);
  });
});
