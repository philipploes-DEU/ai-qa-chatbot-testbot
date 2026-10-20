import type { DummyConfig } from "../domain/target-config.js";
import type { TargetAdapter, TargetResponse, Turn } from "./target.js";

/**
 * Answers deterministically from a table that maps the last user message to an answer.
 * Serves the end-to-end path without any network and lets users try AI QA before they
 * connect a real target.
 */
export class DummyAdapter implements TargetAdapter {
  readonly name: string;
  private readonly responses: ReadonlyMap<string, string>;
  private readonly fallback: string;

  constructor(config: DummyConfig, name = "dummy") {
    this.name = name;
    this.responses = new Map(
      Object.entries(config.responses).map(([input, answer]) => [input.trim(), answer]),
    );
    this.fallback = config.fallback;
  }

  send(turns: readonly Turn[]): Promise<TargetResponse> {
    const started = performance.now();
    const lastUserTurn = turns.findLast((turn) => turn.role === "user");
    if (lastUserTurn === undefined) {
      return Promise.reject(
        new Error("der Dummy-Adapter braucht mindestens einen Gesprächszug mit role user"),
      );
    }
    const matched = this.responses.get(lastUserTurn.content.trim());
    return Promise.resolve({
      content: matched ?? this.fallback,
      raw: { matched: matched !== undefined },
      latencyMs: performance.now() - started,
    });
  }
}
