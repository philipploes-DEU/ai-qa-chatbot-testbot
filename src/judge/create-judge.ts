import type { Environment } from "../adapters/auth.js";
import type { TargetHttpOptions } from "../adapters/http-client.js";
import type { JudgeProviderConfig } from "../domain/judge-config.js";
import { createProvider } from "../providers/factory.js";
import { Judge } from "./judge.js";
import { judgePrompt } from "./prompts/index.js";

/** Builds the judge from the judge block of aiqa.yaml. */
export function createJudge(
  config: JudgeProviderConfig,
  env: Environment = process.env,
  options: Omit<TargetHttpOptions, "env"> = {},
): Judge {
  return new Judge(createProvider(config, env, options), judgePrompt(config.promptVersion));
}
