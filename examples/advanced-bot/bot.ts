import { type BackendConfig, type SampleBot, startSampleBot } from "../sample-bot/bot.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * Advanced bot (issue #66): the realistic Gartenhelden customer service bot "Hilde" behind an
 * OpenAI compatible chat completions endpoint. It reuses the server of the sample bot with a
 * detailed system prompt, a larger knowledge base and room for longer answers. The backend is
 * Claude Haiku through the Anthropic OpenAI compatibility layer (ADR 0006: no SDK dependency).
 * Local use only, never in CI; every call costs money.
 */
export const ADVANCED_BOT_NAME = "gartenhelden-hilde";
export const ADVANCED_BOT_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
  model: "claude-haiku-5-5",
  port: 4030,
  maxTokens: 1200,
} as const;

export interface AdvancedBotOptions {
  backend: BackendConfig;
  port?: number;
  /** Own system prompt, for example from buildPromptFromFiles; Hilde when omitted. */
  systemPrompt?: string;
  /** Own name in completions and /health; gartenhelden-hilde when omitted. */
  name?: string;
  /** Replaceable for tests. */
  fetchImpl?: typeof fetch;
}

export function startAdvancedBot(options: AdvancedBotOptions): Promise<SampleBot> {
  return startSampleBot({
    backend: options.backend,
    systemPrompt: options.systemPrompt ?? SYSTEM_PROMPT,
    maxTokens: ADVANCED_BOT_DEFAULTS.maxTokens,
    name: options.name ?? ADVANCED_BOT_NAME,
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });
}
