import { readFileSync } from "node:fs";
import path from "node:path";

import { ADVANCED_BOT_DEFAULTS, startAdvancedBot } from "./bot.js";
import { buildPromptFromFiles } from "./prompt-files.js";

/**
 * `pnpm example:advanced`: runs the advanced bot on AIQA_ADVANCED_BOT_PORT (default 4030)
 * against Claude Haiku through the Anthropic OpenAI compatibility layer. The key comes from
 * AIQA_ADVANCED_BOT_API_KEY, else AIQA_EXAMPLE_BOT_API_KEY, both from the environment or .env.
 * The key is never printed.
 *
 * AIQA_ADVANCED_BOT_PROMPT_FILE and AIQA_ADVANCED_BOT_KNOWLEDGE_FILE replace the built-in Hilde
 * prompt with files, for example from a workspace under workspaces/ that never enters the
 * repository; AIQA_ADVANCED_BOT_NAME names that bot. Paths are relative to the working directory.
 */
const env = process.env;
const pick = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;
const baseUrl = pick(env.AIQA_ADVANCED_BOT_BASE_URL) ?? ADVANCED_BOT_DEFAULTS.baseUrl;
const model = pick(env.AIQA_ADVANCED_BOT_MODEL) ?? ADVANCED_BOT_DEFAULTS.model;
const apiKey = pick(env.AIQA_ADVANCED_BOT_API_KEY) ?? pick(env.AIQA_EXAMPLE_BOT_API_KEY);
const port = Number(env.AIQA_ADVANCED_BOT_PORT ?? String(ADVANCED_BOT_DEFAULTS.port));
const promptFile = pick(env.AIQA_ADVANCED_BOT_PROMPT_FILE);
const knowledgeFile = pick(env.AIQA_ADVANCED_BOT_KNOWLEDGE_FILE);
const name = pick(env.AIQA_ADVANCED_BOT_NAME);

function read(file: string): string {
  try {
    return readFileSync(path.resolve(file), "utf8");
  } catch {
    console.error(`Datei ${file} nicht lesbar.`);
    process.exit(1);
  }
}

const systemPrompt =
  promptFile === undefined
    ? undefined
    : buildPromptFromFiles(
        read(promptFile),
        knowledgeFile === undefined ? undefined : read(knowledgeFile),
      );

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`AIQA_ADVANCED_BOT_PORT muss ein Port sein, nicht "${String(port)}"`);
  process.exit(1);
}
if (baseUrl.includes("api.anthropic.com") && apiKey === undefined) {
  console.error(
    "Der advanced-bot braucht einen Anthropic-Schlüssel in AIQA_ADVANCED_BOT_API_KEY oder AIQA_EXAMPLE_BOT_API_KEY (.env).",
  );
  process.exit(1);
}

const bot = await startAdvancedBot({
  backend: { baseUrl, apiKey, model },
  port,
  ...(systemPrompt === undefined ? {} : { systemPrompt }),
  ...(name === undefined ? {} : { name }),
});
console.log(`advanced-bot "${name ?? "Hilde"}" läuft unter ${bot.url}`);
console.log(
  systemPrompt === undefined
    ? "System-Prompt: Hilde (eingebaut)"
    : `System-Prompt: aus ${String(promptFile)}${knowledgeFile === undefined ? "" : ` mit Wissensbasis aus ${knowledgeFile}`}, ${String(systemPrompt.length)} Zeichen`,
);
console.log(
  `Backend: ${baseUrl}, Modell: ${model}, Schlüssel: ${apiKey === undefined ? "keiner" : "gesetzt"}`,
);
console.log("Routen: GET /health, POST /v1/chat/completions. Jeder Aufruf kostet Geld.");
console.log("Beenden mit Strg+C.");

const stop = (): void => {
  void bot.close().then(() => {
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
