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
  maxTokens?: number;
}

export interface JsonResult<T> {
  value: T;
  /** The text the model produced, for records and debugging. */
  raw: string;
  tokens?: Tokens;
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
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}
