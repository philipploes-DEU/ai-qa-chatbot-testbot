import { describe, expect, it } from "vitest";

import { sameModelWarning, targetModel } from "./judge-hygiene.js";
import { WorkspaceConfigSchema } from "./workspace-config.js";

function config(targetModelName: string, judgeModel?: string) {
  return WorkspaceConfigSchema.parse({
    version: 1,
    target: {
      name: "bot",
      adapter: "openai-compatible",
      endpoint: "http://localhost:4020/v1",
      openai: { model: targetModelName },
    },
    ...(judgeModel === undefined
      ? {}
      : { judge: { baseUrl: "http://localhost:11434/v1", model: judgeModel } }),
  });
}

describe("sameModelWarning", () => {
  it("warns when judge and target share a model, ignoring case and spaces", () => {
    expect(sameModelWarning(config("qwen2.5:7b", "qwen2.5:7b"))).toMatch(/dasselbe Modell/);
    expect(sameModelWarning(config("Qwen2.5:7b", " qwen2.5:7b "))).toMatch(/qwen2\.5:7b/i);
  });

  it("stays quiet for different models, without judge, or for targets that are no model", () => {
    expect(sameModelWarning(config("llama3.2", "qwen2.5:7b"))).toBeNull();
    expect(sameModelWarning(config("qwen2.5:7b"))).toBeNull();
    const dummy = WorkspaceConfigSchema.parse({
      version: 1,
      target: { name: "d", adapter: "dummy" },
      judge: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
    });
    expect(sameModelWarning(dummy)).toBeNull();
    expect(targetModel(dummy)).toBeNull();
    expect(targetModel(config("llama3.2"))).toBe("llama3.2");
  });
});
