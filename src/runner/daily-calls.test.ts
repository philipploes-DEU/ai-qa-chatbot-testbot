import { describe, expect, it } from "vitest";

import { MemoryResultStore } from "../../tests/helpers/memory-store.js";
import type { Run } from "../domain/run.js";
import { callsOnDay, localDay } from "./daily-calls.js";

function run(id: string, target: string, startedAt: string): Run {
  return { id, planId: "plan", target, startedAt, goldsets: [{ id: "g", version: "1" }] };
}

function usage(calls: number) {
  return { calls, targetTokens: { input: 0, output: 0 }, judgeTokens: { input: 0, output: 0 } };
}

describe("callsOnDay (issue #112)", () => {
  it("sums the calls of every run against the target on the local day of now", async () => {
    const store = new MemoryResultStore();
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const sameDay = (hour: number): string => new Date(2026, 9, 28, hour, 0, 0).toISOString();
    await store.createRun(run("a", "bot", sameDay(9)));
    await store.finishRun("a", sameDay(10), { status: "completed", usage: usage(12) });
    await store.createRun(run("b", "bot", sameDay(11)));
    await store.finishRun("b", sameDay(12), { status: "aborted", usage: usage(1) });
    await store.createRun(run("c", "anderer", sameDay(13)));
    await store.finishRun("c", sameDay(13), { status: "completed", usage: usage(50) });
    const yesterday = new Date(2026, 9, 27, 23, 30, 0).toISOString();
    await store.createRun(run("d", "bot", yesterday));
    await store.finishRun("d", yesterday, { status: "completed", usage: usage(7) });
    await store.createRun(run("e", "bot", sameDay(14)));

    const today = await callsOnDay(store, "bot", now);
    expect(today).toEqual({
      calls: 13,
      runs: 2,
      withoutUsage: 1,
      day: localDay(now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("formats the local day as YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 0, 5, 1, 2, 3))).toBe("2026-01-05");
  });
});
