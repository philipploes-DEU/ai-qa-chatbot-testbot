import { z } from "zod";

import { EnvRefSchema } from "./target-config.js";

/**
 * A model behind the judge or the agents, configured in aiqa.yaml. Only chat completions
 * endpoints today (ADR 0006); Ollama needs no key, hosted providers and the Anthropic
 * compatibility layer do.
 */
export const ModelProviderConfigSchema = z.strictObject({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  /** Base url of the API, for example http://localhost:11434/v1 or https://api.anthropic.com/v1. */
  baseUrl: z.url(),
  model: z.string().min(1),
  /** Reference to an environment variable, never a value. */
  apiKey: EnvRefSchema.optional(),
  /**
   * Sent when set. Deterministic where the provider supports it; current Claude models reject
   * sampling parameters, leave it unset there.
   */
  temperature: z.number().min(0).max(2).optional(),
  /** Repairs after an answer that is not valid JSON for the schema. */
  maxRepairs: z.number().int().nonnegative().default(1),
  requestsPerMinute: z.number().int().positive().default(60),
  requestMs: z.number().int().positive().default(60000),
});
export type ModelProviderConfig = z.infer<typeof ModelProviderConfigSchema>;
export type ModelProviderConfigInput = z.input<typeof ModelProviderConfigSchema>;

/** The model behind the judge, with the version of the judge prompt. */
export const JudgeProviderConfigSchema = ModelProviderConfigSchema.extend({
  /** Version of the judge prompt from src/judge/prompts; the newest when omitted. */
  promptVersion: z.string().min(1).optional(),
  /** Upper bound for the source documents of one goldset in the judge prompt, in characters. */
  maxSourceChars: z.number().int().positive().optional(),
});
export type JudgeProviderConfig = z.infer<typeof JudgeProviderConfigSchema>;
export type JudgeProviderConfigInput = z.input<typeof JudgeProviderConfigSchema>;
