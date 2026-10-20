import path from "node:path";

import { describe, expect, it } from "vitest";

import { TargetConfigSchema } from "../domain/target-config.js";
import { TimeoutError } from "./errors.js";
import { ScriptAdapter, splitCommand } from "./script.js";

const script = path.resolve("examples", "script-target", "answer.mjs");

function target(overrides: Record<string, unknown> = {}) {
  return TargetConfigSchema.parse({
    name: "skript",
    adapter: "script",
    endpoint: `node "${script}"`,
    rateLimit: { requestsPerMinute: 100000 },
    timeouts: { requestMs: 5000, dialogMs: 10000 },
    ...overrides,
  });
}

describe("splitCommand", () => {
  it("splits on whitespace and keeps quoted parts together", () => {
    expect(splitCommand('node "C:\\Pfad mit Leerzeichen\\answer.mjs" --flag  x')).toEqual({
      command: "node",
      args: ["C:\\Pfad mit Leerzeichen\\answer.mjs", "--flag", "x"],
    });
    expect(splitCommand("python3 bot.py")).toEqual({ command: "python3", args: ["bot.py"] });
  });

  it("rejects an empty command", () => {
    expect(() => splitCommand("   ")).toThrow(/Kommando/);
  });
});

describe("ScriptAdapter", () => {
  it("hands the turns to the script and reads content and tokens", async () => {
    const adapter = new ScriptAdapter(target());
    expect(adapter.name).toBe("skript");
    const response = await adapter.send([
      { role: "user", content: "Wie lauten die Öffnungszeiten des Kundenservice?" },
    ]);
    expect(response.content).toBe(
      "Unser Kundenservice ist Montag bis Freitag von 9 bis 17 Uhr für Sie da.",
    );
    expect(response.tokens).toEqual({ input: 6, output: 14 });
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.raw).toMatchObject({ stdout: expect.stringContaining("content") as string });
  });

  it("answers the last user turn of a dialog with the fallback for unknown input", async () => {
    const adapter = new ScriptAdapter(target());
    const response = await adapter.send([
      { role: "user", content: "Hallo" },
      { role: "assistant", content: "Hallo zurück" },
      { role: "user", content: "Wie wird das Wetter?" },
    ]);
    expect(response.content).toBe("Dazu habe ich leider keine Informationen.");
  });

  it("turns a non-zero exit code into an error with stderr", async () => {
    const adapter = new ScriptAdapter(target());
    await expect(adapter.send([{ role: "user", content: "fehler" }])).rejects.toThrow(
      /^exit 2: Absichtlicher Fehler/,
    );
  });

  it("rejects output that is not the expected JSON", async () => {
    const adapter = new ScriptAdapter(target());
    await expect(adapter.send([{ role: "user", content: "kaputt" }])).rejects.toThrow(
      /nicht mit JSON: das ist kein JSON/,
    );
  });

  it("kills the script after timeouts.requestMs", async () => {
    const adapter = new ScriptAdapter(target({ timeouts: { requestMs: 300, dialogMs: 1000 } }));
    const error = await adapter
      .send([{ role: "user", content: "langsam" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it("fails clearly when the command does not exist", async () => {
    const adapter = new ScriptAdapter(target({ endpoint: "gibt-es-nicht-aiqa --x" }));
    await expect(adapter.send([{ role: "user", content: "Hallo" }])).rejects.toThrow(
      /gibt-es-nicht-aiqa/,
    );
  });

  it("requires a user turn", async () => {
    const adapter = new ScriptAdapter(target());
    await expect(adapter.send([{ role: "assistant", content: "x" }])).rejects.toThrow(/role user/);
  });
});
