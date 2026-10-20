import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MockTarget, startMockTarget } from "../../examples/mock-target/server.js";
import { createAdapter } from "../../src/adapters/factory.js";
import { createDefaultChecks } from "../../src/checks/run-checks.js";
import { loadWorkspaceConfig } from "../../src/cli/config.js";
import { PlanSchema } from "../../src/domain/plan.js";
import { type TargetConfig, TargetConfigSchema } from "../../src/domain/target-config.js";
import type { Verdict } from "../../src/domain/verdict.js";
import { MarkdownRenderer } from "../../src/report/markdown-renderer.js";
import { buildReportModel } from "../../src/report/report-model.js";
import { loadPlan } from "../../src/runner/load-plan.js";
import { runPlan } from "../../src/runner/run-plan.js";
import { MemoryResultStore } from "../helpers/memory-store.js";

const workspaceDir = path.resolve("examples/mock-target");

function failingChecks(verdicts: readonly Verdict[], caseId: string): string[] {
  return [
    ...new Set(
      verdicts
        .filter((verdict) => verdict.caseId === caseId && !verdict.pass)
        .flatMap((verdict) => verdict.criteria.filter((c) => !c.pass).map((c) => c.name)),
    ),
  ].sort();
}

/** The http adapter from the example workspace, pointed at the in-process mock without spacing. */
function adapter(target: TargetConfig, endpoint: string) {
  return createAdapter(
    { ...target, endpoint, rateLimit: { ...target.rateLimit, requestsPerMinute: 100000 } },
    { env: {}, baseDelayMs: 5 },
  );
}

describe("the mock target as a real HTTP target of runner, checks, statistics and report", () => {
  let mock: MockTarget;
  let target: TargetConfig;

  beforeAll(async () => {
    mock = await startMockTarget({ slowMs: 60 });
    const workspace = await loadWorkspaceConfig(path.join(workspaceDir, "aiqa.yaml"));
    target = workspace.config.target;
  });

  afterAll(async () => {
    await mock.close();
  });

  it("runs the example plan and fails exactly the cases with built-in weaknesses", async () => {
    const loaded = await loadPlan(path.join(workspaceDir, "goldsets", "plan.yaml"));
    const store = new MemoryResultStore();
    const summary = await runPlan({
      plan: loaded.plan,
      goldsets: loaded.goldsets,
      target,
      adapter: adapter(target, `${mock.url}/chat`),
      checks: createDefaultChecks({ maxLatencyMs: target.expectations.maxLatencyMs }),
      store,
      runId: "run-mock",
    });

    expect(summary.iterations).toBe(33);
    expect(store.iterations.every((iteration) => iteration.error === undefined)).toBe(true);

    const failedCases = [...new Set(store.verdicts.filter((v) => !v.pass).map((v) => v.caseId))];
    expect(failedCases.sort()).toEqual([
      "faq-banner",
      "faq-filialen",
      "probe-api-key",
      "probe-system-prompt-leak",
    ]);
    expect(failingChecks(store.verdicts, "probe-system-prompt-leak")).toEqual([
      "mustNotContain",
      "refusal",
    ]);
    expect(failingChecks(store.verdicts, "faq-filialen")).toEqual([
      "mustContain",
      "mustNotContain",
    ]);
    expect(failingChecks(store.verdicts, "faq-banner")).toEqual(["mustNotMatch"]);
    expect(failingChecks(store.verdicts, "probe-api-key")).toEqual(["leak", "refusal"]);
    expect(summary.failedIterations).toBe(12);

    const model = buildReportModel({
      run: await store.readRun("run-mock"),
      iterations: store.iterations,
      verdicts: store.verdicts,
      cases: loaded.cases,
    });
    expect(model.totals.iterations).toBe(33);
    expect(model.totals.passedIterations).toBe(21);
    expect(model.totals.flakyCases).toBe(0);
    expect(model.totals.errors).toBe(0);

    const markdown = new MarkdownRenderer().render(model);
    expect(markdown).toContain("faq-filialen");
    expect(markdown).toContain("LLM09");
    expect(markdown).toContain("Geheimnis-Muster gefunden: openai-style-key");
  });

  it("fails the latency expectation on the slow route without a technical error", async () => {
    const loaded = await loadPlan(path.join(workspaceDir, "goldsets", "plan.yaml"));
    const plan = PlanSchema.parse({
      ...loaded.plan,
      caseRefs: [{ caseId: "faq-oeffnungszeiten", iterations: 2 }],
    });
    const slowTarget = TargetConfigSchema.parse({
      ...target,
      endpoint: `${mock.url}/chat/slow`,
      expectations: { maxLatencyMs: 20 },
    });
    const store = new MemoryResultStore();
    await runPlan({
      plan,
      goldsets: loaded.goldsets,
      target: slowTarget,
      adapter: adapter(slowTarget, `${mock.url}/chat/slow`),
      checks: createDefaultChecks({ maxLatencyMs: 20 }),
      store,
      runId: "run-slow",
    });

    expect(store.iterations.every((iteration) => iteration.error === undefined)).toBe(true);
    expect(store.iterations.every((iteration) => iteration.latencyMs >= 50)).toBe(true);
    const latency = store.verdicts.filter((v) => v.criteria[0]?.name === "latency");
    expect(latency).toHaveLength(2);
    expect(latency.every((verdict) => !verdict.pass)).toBe(true);
  });

  it("retries HTTP 429 on the limited route with backoff so every iteration passes", async () => {
    const loaded = await loadPlan(path.join(workspaceDir, "goldsets", "plan.yaml"));
    const plan = PlanSchema.parse({
      ...loaded.plan,
      caseRefs: [{ caseId: "faq-rueckgabe", iterations: 4 }],
    });
    const store = new MemoryResultStore();
    await runPlan({
      plan,
      goldsets: loaded.goldsets,
      target,
      adapter: adapter(target, `${mock.url}/chat/limited`),
      checks: createDefaultChecks({}),
      store,
      runId: "run-429",
    });

    expect(store.iterations.map((iteration) => iteration.error)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(store.verdicts.every((verdict) => verdict.pass)).toBe(true);
  });

  it("ends the run at HTTP 429 without backoff and records no iteration for it (issue #96)", async () => {
    const loaded = await loadPlan(path.join(workspaceDir, "goldsets", "plan.yaml"));
    const plan = PlanSchema.parse({
      ...loaded.plan,
      caseRefs: [{ caseId: "faq-rueckgabe", iterations: 4 }],
    });
    const noBackoff = TargetConfigSchema.parse({
      ...target,
      rateLimit: { ...target.rateLimit, backoff: "none" },
    });
    const store = new MemoryResultStore();
    await runPlan({
      plan,
      goldsets: loaded.goldsets,
      target: noBackoff,
      adapter: adapter(noBackoff, `${mock.url}/chat/limited`),
      checks: createDefaultChecks({}),
      store,
      runId: "run-429-none",
    });

    // Without retries the first 429 ends the run: the call tested nothing.
    expect(store.iterations).toEqual([]);
    const run = await store.readRun("run-429-none");
    expect(run.status).toBe("aborted");
    expect(run.abortReason).toBe(
      'Das Zielsystem lehnt weitere Anfragen ab (HTTP 429): {"error":"Zu viele Anfragen, bitte später erneut versuchen"}',
    );
    expect(run.usage?.calls).toBe(1);
  });

  it("records a request timeout as a technical error when the slow route exceeds requestMs", async () => {
    const loaded = await loadPlan(path.join(workspaceDir, "goldsets", "plan.yaml"));
    const plan = PlanSchema.parse({
      ...loaded.plan,
      caseRefs: [{ caseId: "faq-oeffnungszeiten", iterations: 1 }],
    });
    const impatient = TargetConfigSchema.parse({
      ...target,
      timeouts: { requestMs: 20, dialogMs: 1000 },
    });
    const store = new MemoryResultStore();
    await runPlan({
      plan,
      goldsets: loaded.goldsets,
      target: impatient,
      adapter: adapter(impatient, `${mock.url}/chat/slow`),
      checks: createDefaultChecks({}),
      store,
      runId: "run-timeout",
    });

    expect(store.iterations[0]?.error).toBe("timeout");
    expect(store.verdicts[0]?.criteria[0]?.name).toBe("response");
    expect(store.verdicts[0]?.criteria[0]?.reason).toContain("20 ms");
  });
});
