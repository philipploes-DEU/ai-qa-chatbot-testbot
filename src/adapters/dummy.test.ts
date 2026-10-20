import { describe, expect, it } from "vitest";

import { TargetConfigSchema } from "../domain/target-config.js";
import { DummyAdapter } from "./dummy.js";
import { createAdapter } from "./factory.js";
import { HttpTemplateAdapter } from "./http-template.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import { PlaywrightAdapter } from "./playwright.js";
import { ScriptAdapter } from "./script.js";

const config = {
  responses: {
    "Wie lauten die Öffnungszeiten?": "Montag bis Freitag von 9 bis 17 Uhr.",
    "GH-2026-4711, bitte die Lieferadresse ändern.":
      "Die Änderung für GH-2026-4711 ist vorgemerkt.",
  },
  fallback: "Dazu habe ich keine Informationen.",
};

const baseTarget = {
  auth: { type: "none" as const },
  rateLimit: {
    requestsPerMinute: 60,
    concurrency: 1,
    backoff: "exponential" as const,
    maxRetries: 3,
  },
  timeouts: { requestMs: 15000, dialogMs: 120000 },
  expectations: {},
};

describe("DummyAdapter", () => {
  const adapter = new DummyAdapter(config, "beispiel-dummy");

  it("carries the target name", () => {
    expect(adapter.name).toBe("beispiel-dummy");
  });

  it("answers from the table for the last user turn", async () => {
    const response = await adapter.send([
      { role: "user", content: "Wie lauten die Öffnungszeiten?" },
    ]);
    expect(response.content).toBe("Montag bis Freitag von 9 bis 17 Uhr.");
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back for unknown input", async () => {
    const response = await adapter.send([
      { role: "user", content: "Was ist der Sinn des Lebens?" },
    ]);
    expect(response.content).toBe("Dazu habe ich keine Informationen.");
  });

  it("uses the last user turn of a dialog and ignores other roles", async () => {
    const response = await adapter.send([
      { role: "system", content: "Du bist knapp." },
      { role: "user", content: "Ich möchte meine Bestellung ändern." },
      { role: "assistant", content: "Gern, wie lautet die Bestellnummer?" },
      { role: "user", content: "GH-2026-4711, bitte die Lieferadresse ändern." },
    ]);
    expect(response.content).toBe("Die Änderung für GH-2026-4711 ist vorgemerkt.");
  });

  it("matches input regardless of surrounding whitespace", async () => {
    const response = await adapter.send([
      { role: "user", content: "  Wie lauten die Öffnungszeiten? " },
    ]);
    expect(response.content).toBe("Montag bis Freitag von 9 bis 17 Uhr.");
  });

  it("rejects a conversation without a user turn", async () => {
    await expect(adapter.send([{ role: "system", content: "x" }])).rejects.toThrow(/role user/);
  });
});

describe("createAdapter", () => {
  it("creates a dummy adapter from a target config", async () => {
    const adapter = createAdapter({
      ...baseTarget,
      name: "beispiel-dummy",
      adapter: "dummy",
      dummy: config,
    });
    expect(adapter.name).toBe("beispiel-dummy");
    const response = await adapter.send([
      { role: "user", content: "Wie lauten die Öffnungszeiten?" },
    ]);
    expect(response.content).toBe("Montag bis Freitag von 9 bis 17 Uhr.");
  });

  it("uses an empty table when the dummy block is missing", async () => {
    const adapter = createAdapter({ ...baseTarget, name: "leer", adapter: "dummy" });
    const response = await adapter.send([{ role: "user", content: "Hallo" }]);
    expect(response.content.length).toBeGreaterThan(0);
  });

  it("creates the http adapter and resolves credentials from the given environment", () => {
    const httpTarget = {
      ...baseTarget,
      name: "kundenbot",
      adapter: "http" as const,
      endpoint: "https://example.test/chat",
      auth: { type: "bearer" as const, token: "${AIQA_TARGET_TOKEN}" },
      request: { body: '{"message": "{{input}}"}', responsePath: "$.reply" },
    };
    const adapter = createAdapter(TargetConfigSchema.parse(httpTarget), {
      env: { AIQA_TARGET_TOKEN: "AIQAFAKE" },
    });
    expect(adapter).toBeInstanceOf(HttpTemplateAdapter);
    expect(adapter.name).toBe("kundenbot");
    expect(() => createAdapter(TargetConfigSchema.parse(httpTarget), { env: {} })).toThrow(
      /AIQA_TARGET_TOKEN/,
    );
  });

  it("creates the playwright adapter with the spec resolved against the workspace", () => {
    const adapter = createAdapter(
      TargetConfigSchema.parse({
        ...baseTarget,
        name: "web",
        adapter: "playwright",
        endpoint: "https://example.test/chat",
        playwright: { spec: "specs/web.spec.yaml" },
      }),
      { env: {}, workspaceDir: "/arbeitsbereich" },
    );
    expect(adapter).toBeInstanceOf(PlaywrightAdapter);
    expect(adapter.name).toBe("web");
  });

  it("creates the openai-compatible adapter", () => {
    const adapter = createAdapter(
      TargetConfigSchema.parse({
        ...baseTarget,
        name: "bot",
        adapter: "openai-compatible",
        endpoint: "http://localhost:4020/v1",
        openai: { model: "gartenhelden-bot" },
      }),
      { env: {} },
    );
    expect(adapter).toBeInstanceOf(OpenAiCompatibleAdapter);
  });

  it("creates the script adapter with the workspace as working directory", () => {
    const adapter = createAdapter(
      TargetConfigSchema.parse({
        ...baseTarget,
        name: "skript",
        adapter: "script",
        endpoint: "node answer.mjs",
      }),
      { env: {}, workspaceDir: "/arbeitsbereich" },
    );
    expect(adapter).toBeInstanceOf(ScriptAdapter);
    expect(adapter.name).toBe("skript");
  });
});
