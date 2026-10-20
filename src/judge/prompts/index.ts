import type { JudgePrompt } from "./prompt.js";
import { JUDGE_PROMPT_V1 } from "./v1.js";
import { JUDGE_PROMPT_V2 } from "./v2.js";

export type { JudgePrompt } from "./prompt.js";
export { JUDGE_PROMPT_V1 } from "./v1.js";
export { JUDGE_PROMPT_V2 } from "./v2.js";

/** All judge prompts by version, oldest first. */
export const JUDGE_PROMPTS: readonly JudgePrompt[] = [JUDGE_PROMPT_V1, JUDGE_PROMPT_V2];

/** The version new runs use unless a plan or the judge block names another. */
export const LATEST_JUDGE_PROMPT: JudgePrompt = JUDGE_PROMPT_V2;

/** Resolves a prompt version; the newest when none is given. Unknown versions are an error. */
export function judgePrompt(version?: string): JudgePrompt {
  if (version === undefined) return LATEST_JUDGE_PROMPT;
  const found = JUDGE_PROMPTS.find((prompt) => prompt.version === version);
  if (found === undefined) {
    const known = JUDGE_PROMPTS.map((prompt) => prompt.version).join(", ");
    throw new Error(`Judge-Prompt-Version "${version}" gibt es nicht, bekannt sind: ${known}`);
  }
  return found;
}
