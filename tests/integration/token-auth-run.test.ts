import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../src/adapters/factory.js";
import { createDefaultChecks } from "../../src/checks/run-checks.js";
import { GoldsetSchema } from "../../src/domain/goldset.js";
import { PlanSchema } from "../../src/domain/plan.js";
import { TargetConfigSchema } from "../../src/domain/target-config.js";
import { MarkdownRenderer } from "../../src/report/markdown-renderer.js";
import { buildReportModel } from "../../src/report/report-model.js";
import { runPlan } from "../../src/runner/run-plan.js";
import { MemoryResultStore } from "../helpers/memory-store.js";
import { FAKE_LOGIN, type FakeTokenServer, startFakeTokenServer } from "../helpers/token-server.js";

const goldset = GoldsetSchema.parse({
  id: "token-ziel",
  name: "Token-Ziel",
  version: 1,
  owner: "QA",
  cases: [
    {
      id: "frage",
      kind: "qa",
      input: "Hallo?",
      expected: { mustContain: ["Antwort"] },
      status: "approved",
    },
  ],
});

const env: Record<string, string> = {
  AIQA_TARGET_EMAIL: FAKE_LOGIN.email,
  AIQA_TARGET_PASSWORD: FAKE_LOGIN.password,
  AIQA_SUPABASE_ANON_KEY: FAKE_LOGIN.anonKey,
};

describe("a run against a target behind token auth", () => {
  let server: FakeTokenServer;

  beforeEach(async () => {
    server = await startFakeTokenServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function target(password = "${AIQA_TARGET_PASSWORD}") {
    return TargetConfigSchema.parse({
      name: "token-ziel",
      adapter: "http",
      endpoint: `${server.url}/api/chat`,
      auth: {
        type: "token",
        tokenEndpoint: `${server.url}/auth/v1/token?grant_type=password`,
        refreshEndpoint: `${server.url}/auth/v1/token?grant_type=refresh_token`,
        format: "json",
        usernameField: "email",
        username: "${AIQA_TARGET_EMAIL}",
        password,
        headers: { apikey: "${AIQA_SUPABASE_ANON_KEY}" },
      },
      rateLimit: { requestsPerMinute: 100000 },
      request: {
        headers: { "content-type": "application/json" },
        body: '{"message": "{{input}}"}',
        responsePath: "$.reply",
      },
    });
  }

  const plan = PlanSchema.parse({
    id: "plan-token",
    createdAt: "2026-10-13T12:00:00Z",
    target: "token-ziel",
    goldsets: ["goldset.yaml"],
    caseRefs: [{ caseId: "frage", iterations: 3 }],
    budget: { maxCalls: 10 },
  });

  it("renews a revoked token, passes every iteration and records no token anywhere", async () => {
    const config = target();
    const adapter = createAdapter(config, { env });
    const store = new MemoryResultStore();
    let revoked = false;
    const summary = await runPlan({
      plan,
      goldsets: [goldset],
      target: config,
      adapter,
      checks: createDefaultChecks({}),
      store,
      runId: "run-token",
      onProgress: () => {
        if (!revoked) {
          server.revoke("AIQAFAKE-access-1");
          revoked = true;
        }
      },
    });

    expect(summary.status).toBe("completed");
    expect(summary.failedIterations).toBe(0);
    expect(server.tokenRequests).toHaveLength(2);

    const run = store.runs.get("run-token");
    if (run === undefined) throw new Error("Lauf fehlt");
    const report = new MarkdownRenderer().render(
      buildReportModel({ run, iterations: store.iterations, verdicts: store.verdicts }),
    );
    const recorded = JSON.stringify([run, store.iterations, store.verdicts]) + report;
    expect(recorded).not.toMatch(/AIQAFAKE-(access|refresh|passwort|anon)/);
  });

  it("aborts the run with the reason when the login fails", async () => {
    const config = target();
    const adapter = createAdapter(config, { env: { ...env, AIQA_TARGET_PASSWORD: "AIQAFAKE-x" } });
    const store = new MemoryResultStore();
    const summary = await runPlan({
      plan,
      goldsets: [goldset],
      target: config,
      adapter,
      checks: createDefaultChecks({}),
      store,
      runId: "run-token-fail",
    });

    expect(summary.status).toBe("aborted");
    expect(summary.iterations).toBe(0);
    expect(summary.abortReason).toMatch(/Anmeldung.*http 400.*Invalid login credentials/);
    expect(server.targetAuthorizations).toHaveLength(0);
  });
});
