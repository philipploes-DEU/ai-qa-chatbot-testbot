import { startMockTarget } from "./server.js";

/** `pnpm example:mock`: runs the mock target on AIQA_EXAMPLE_MOCK_PORT (default 4010). */
const port = Number(process.env.AIQA_EXAMPLE_MOCK_PORT ?? "4010");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`AIQA_EXAMPLE_MOCK_PORT muss ein Port sein, nicht "${String(port)}"`);
  process.exit(1);
}

const target = await startMockTarget({ port });
console.log(`Mock-Zielsystem läuft unter ${target.url}`);
console.log("Routen: GET /health, POST /session, DELETE /session/:id, POST /chat,");
console.log("        POST /chat/slow (10 s), POST /chat/limited (jeder zweite Aufruf 429),");
console.log("        POST /v1/chat/completions");
console.log("Beenden mit Strg+C.");

const stop = (): void => {
  void target.close().then(() => {
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
