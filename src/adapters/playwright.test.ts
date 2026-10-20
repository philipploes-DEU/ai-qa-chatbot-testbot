import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { TargetConfigSchema } from "../domain/target-config.js";
import { TimeoutError } from "./errors.js";
import { PlaywrightAdapter } from "./playwright.js";

const page = pathToFileURL(path.resolve("tests", "fixtures", "chat-page.html")).href;
const specFile = path.resolve("specs", "beispiel-web.spec.yaml");

function target(overrides: Record<string, unknown> = {}) {
  return TargetConfigSchema.parse({
    name: "beispiel-web",
    adapter: "playwright",
    endpoint: page,
    rateLimit: { requestsPerMinute: 100000 },
    timeouts: { requestMs: 10000, dialogMs: 30000 },
    playwright: { spec: "specs/beispiel-web.spec.yaml", headless: true, browser: "chromium" },
    ...overrides,
  });
}

describe("PlaywrightAdapter against the static chat page", () => {
  const adapters: PlaywrightAdapter[] = [];
  function adapter(overrides: Record<string, unknown> = {}): PlaywrightAdapter {
    const created = new PlaywrightAdapter(target(overrides), { env: {}, specFile });
    adapters.push(created);
    return created;
  }

  afterAll(async () => {
    for (const created of adapters) await created.close();
  }, 60000);

  it("types the last user turn, sends it and reads the answer", async () => {
    const web = adapter();
    expect(web.name).toBe("beispiel-web");
    const response = await web.send([
      { role: "user", content: "Wie lauten die Öffnungszeiten des Kundenservice?" },
    ]);
    expect(response.content).toBe(
      "Unser Kundenservice ist Montag bis Freitag von 9 bis 17 Uhr für Sie da.",
    );
    expect(response.latencyMs).toBeGreaterThan(100);
    const unknown = await web.send([{ role: "user", content: "Wie wird das Wetter?" }]);
    expect(unknown.content).toBe("Dazu habe ich leider keine Informationen.");
  });

  it("starts fresh between sends and keeps a session's conversation", async () => {
    const web = adapter();
    await web.send([{ role: "user", content: "Erste Frage" }]);
    const second = await web.send([{ role: "user", content: "Zweite Frage" }]);
    // The reset clicked "Neues Gespräch": the second answer is the first on the page again.
    expect(second.raw).toMatchObject({ answers: 1 });

    const session = await web.startSession();
    await web.send([{ role: "user", content: "Frage A" }], session);
    const within = await web.send([{ role: "user", content: "Frage B" }], session);
    expect(within.raw).toMatchObject({ answers: 2 });
    await web.endSession(session);
    const after = await web.send([{ role: "user", content: "Frage C" }]);
    expect(after.raw).toMatchObject({ answers: 1 });
  });

  it("gives up with a request timeout when the answer takes too long", async () => {
    const slow = adapter({ timeouts: { requestMs: 60, dialogMs: 1000 } });
    const error = await slow
      .send([{ role: "user", content: "Wie lauten die Öffnungszeiten des Kundenservice?" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
  }, 30000);

  it("refuses targets without playwright block and unsupported auth", () => {
    expect(
      () =>
        new PlaywrightAdapter(TargetConfigSchema.parse({ name: "d", adapter: "dummy" }), {
          env: {},
          specFile,
        }),
    ).toThrow(/playwright-Block/);
    expect(
      () =>
        new PlaywrightAdapter(target({ auth: { type: "bearer", token: "${AIQA_TARGET_TOKEN}" } }), {
          env: { AIQA_TARGET_TOKEN: "x" },
          specFile,
        }),
    ).toThrow(/auth none und basic/);
    expect(
      () =>
        new PlaywrightAdapter(
          target({ auth: { type: "basic", username: "${U}", password: "${P}" } }),
          { env: { U: "qa" }, specFile },
        ),
    ).toThrow(/P /);
  });

  it("requires a user turn", async () => {
    const web = adapter();
    await expect(web.send([{ role: "assistant", content: "x" }])).rejects.toThrow(/role user/);
  });
});
