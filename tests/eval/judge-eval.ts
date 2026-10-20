/**
 * `pnpm eval:judge`: runs the judge eval set against the judge block of an aiqa.yaml and prints
 * how often the verdict matched the expectation. Local only, never in CI: every case is a model
 * call. Usage: pnpm eval:judge [pfad/zur/aiqa.yaml]  (default: tests/eval/judge/aiqa.ollama.yaml)
 */
import path from "node:path";

import { z } from "zod";

import { loadWorkspaceConfig } from "../../src/cli/config.js";
import { TestCaseSchema } from "../../src/domain/test-case.js";
import { loadDocument } from "../../src/io/yaml.js";
import { createJudge } from "../../src/judge/create-judge.js";

const EvalSetSchema = z.strictObject({
  samples: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        case: TestCaseSchema,
        answer: z.string().min(1),
        expectedPass: z.boolean(),
      }),
    )
    .min(1),
});

const configFile = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "judge", "aiqa.ollama.yaml"),
);
const workspace = await loadWorkspaceConfig(configFile);
if (workspace.config.judge === undefined) {
  console.error(`${configFile}: kein judge-Block konfiguriert.`);
  process.exit(1);
}
const judge = createJudge(workspace.config.judge);
const evalSet = await loadDocument(
  EvalSetSchema,
  path.resolve(import.meta.dirname, "judge", "cases.yaml"),
);

console.log(
  `Judge ${judge.model} (Prompt ${judge.promptVersion}), ${String(evalSet.samples.length)} Fälle.`,
);
let agreed = 0;
for (const entry of evalSet.samples) {
  try {
    const outcome = await judge.judge(entry.case, { content: entry.answer, latencyMs: 0 });
    const ok = outcome.verdict.pass === entry.expectedPass;
    if (ok) agreed++;
    console.log(
      `${ok ? "OK    " : "ANDERS"} ${entry.id}: Judge ${outcome.verdict.pass ? "pass" : "fail"}, erwartet ${entry.expectedPass ? "pass" : "fail"}, Konfidenz ${String(outcome.verdict.confidence ?? "")}, ${String(outcome.attempts)} Versuch(e)`,
    );
    if (!ok) console.log(`       ${outcome.verdict.reasoning}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FEHLER ${entry.id}: ${message}`);
  }
}
console.log(`Übereinstimmung: ${String(agreed)} von ${String(evalSet.samples.length)}.`);
process.exit(agreed === evalSet.samples.length ? 0 : 1);
