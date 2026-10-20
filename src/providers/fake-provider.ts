import { InvalidJsonError, parseJsonWith } from "./json.js";
import type { JsonRequest, JsonResult, ModelProvider } from "./model-provider.js";

export interface FakeCall {
  system?: string;
  prompt: string;
  schemaName?: string;
}

/**
 * Answers from recorded texts in order, validating them like a real provider would. Tests of
 * the agents use it instead of a model: no network, no key, deterministic. A recorded error,
 * for example a ModelRefusalError, is thrown in its turn.
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly calls: FakeCall[] = [];
  private readonly answers: (string | Error)[];

  constructor(
    answers: readonly (string | Error)[],
    readonly model = "fake-model",
  ) {
    this.answers = [...answers];
  }

  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    this.calls.push({
      ...(request.system !== undefined ? { system: request.system } : {}),
      prompt: request.prompt,
      ...(request.schemaName !== undefined ? { schemaName: request.schemaName } : {}),
    });
    const raw = this.answers.shift();
    if (raw === undefined) {
      return Promise.reject(new Error("der FakeProvider hat keine aufgezeichnete Antwort mehr"));
    }
    if (raw instanceof Error) return Promise.reject(raw);
    const parsed = parseJsonWith(request.schema, raw);
    if (!parsed.ok) return Promise.reject(new InvalidJsonError(parsed.reason, raw));
    return Promise.resolve({
      value: parsed.value,
      raw,
      tokens: { input: request.prompt.length, output: raw.length },
      latencyMs: 1,
      attempts: 1,
    });
  }
}
