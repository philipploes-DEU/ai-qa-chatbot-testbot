import { type Environment, resolveEnvRef } from "../adapters/auth.js";
import type { TargetHttpOptions } from "../adapters/http-client.js";
import type { ModelProviderConfig } from "../domain/judge-config.js";
import type { ModelProvider } from "./model-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";

/**
 * Builds the model provider for a judge or agents config. The API key reference is resolved from `env`
 * here, so a missing variable fails before the first call and names the variable.
 */
export function createProvider(
  config: ModelProviderConfig,
  env: Environment = process.env,
  options: Omit<TargetHttpOptions, "env"> = {},
  /** Where the key reference sits in aiqa.yaml, for the error message. */
  keyPath = "judge.apiKey",
): ModelProvider {
  // `provider` has one value today; this is the place where further API families branch off.
  return new OpenAiCompatibleProvider(
    {
      baseUrl: config.baseUrl,
      model: config.model,
      ...(config.apiKey !== undefined
        ? { apiKey: resolveEnvRef(config.apiKey, env, keyPath) }
        : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      maxRepairs: config.maxRepairs,
      requestMs: config.requestMs,
      requestsPerMinute: config.requestsPerMinute,
    },
    options,
  );
}
