import type { z } from "zod";

import type { Tokens } from "../domain/common.js";

/** One request for a JSON answer that must satisfy a schema. */
export interface JsonRequest<T> {
  /** Standing instructions, for example the judge prompt. */
  system?: string;
  /** The task, for example the case, the answer and the rubric. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Name of the schema for prompts and structured output modes. */
  schemaName?: string;
  /** Upper bound for the output of one call. An answer cut off there is an error. */
  maxTokens?: number;
}

export interface JsonResult<T> {
  value: T;
  /** The text the model produced, for records and debugging. */
  raw: string;
  tokens?: Tokens;
  /**
   * Calls behind this result that reported no tokens (issue #125). Absent means the provider
   * does not count them: then a result without tokens stands for one such call.
   */
  unreportedCalls?: number;
  latencyMs: number;
  /** 1 when the first answer was valid JSON for the schema. */
  attempts: number;
}

/**
 * A model behind the agents of AI QA (judge, planning, analysis, report). Implementations exist
 * per API family; tests use a fake with recorded answers (ADR 0006).
 */
export interface ModelProvider {
  /** Kind of provider, for example openai-compatible or anthropic. */
  readonly name: string;
  /** Model name as recorded in verdicts and reports. */
  readonly model: string;
  /**
   * A failure carries what its calls cost where the provider knows it, readable with
   * usageOfError (issue #125).
   */
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}

/** Calls behind a result that reported no tokens, for providers that do not count them too. */
export function unreportedCallsOf(result: JsonResult<unknown>): number {
  return result.unreportedCalls ?? (result.tokens === undefined ? 1 : 0);
}
