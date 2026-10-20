import { startSampleBot } from "./bot.js";

/**
 * `pnpm example:bot`: runs the sample bot on AIQA_EXAMPLE_BOT_PORT (default 4020) against the
 * OpenAI compatible backend from AIQA_EXAMPLE_BOT_BASE_URL, AIQA_EXAMPLE_BOT_API_KEY and
 * AIQA_EXAMPLE_BOT_MODEL. Defaults target Ollama locally. Values come from the environment or
 * from .env, which the script loads itself when present.
 */
const env = process.env;
const baseUrl = env.AIQA_EXAMPLE_BOT_BASE_URL ?? "http://localhost:11434/v1";
const apiKey = env.AIQA_EXAMPLE_BOT_API_KEY === "" ? undefined : env.AIQA_EXAMPLE_BOT_API_KEY;
const model = env.AIQA_EXAMPLE_BOT_MODEL ?? "llama3.2";
const port = Number(env.AIQA_EXAMPLE_BOT_PORT ?? "4020");

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`AIQA_EXAMPLE_BOT_PORT muss ein Port sein, nicht "${String(port)}"`);
  process.exit(1);
}
if (baseUrl.includes("api.anthropic.com") && apiKey === undefined) {
  console.error("Die Anthropic-Kompatibilitätsschicht braucht AIQA_EXAMPLE_BOT_API_KEY.");
  process.exit(1);
}

const bot = await startSampleBot({ backend: { baseUrl, apiKey, model }, port });
console.log(`Beispielbot läuft unter ${bot.url}`);
console.log(
  `Backend: ${baseUrl}, Modell: ${model}, Schlüssel: ${apiKey === undefined ? "keiner" : "gesetzt"}`,
);
console.log("Routen: GET /health, POST /v1/chat/completions");
console.log("Beenden mit Strg+C.");

const stop = (): void => {
  void bot.close().then(() => {
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
