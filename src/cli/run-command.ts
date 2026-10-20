import path from "node:path";

import { createAdapter } from "../adapters/factory.js";
import type { RunCalibration } from "../domain/calibration.js";
import { createDefaultChecks } from "../checks/run-checks.js";
import { toPosix } from "../io/files.js";
import { sameModelWarning } from "../domain/judge-hygiene.js";
import { createJudge } from "../judge/create-judge.js";
import { judgeFailureLabel } from "../report/markdown-renderer.js";
import { loadPlan } from "../runner/load-plan.js";
import { type JudgeSources, loadJudgeSources } from "./judge-sources.js";
import { callsPerIteration, runPlan, type RunSummary } from "../runner/run-plan.js";
import type { BindingFile } from "../domain/fixtures.js";
import type { Goldset } from "../domain/goldset.js";
import { bindCases } from "../fixtures/placeholders.js";
import { boundValues, withPrevious } from "../fixtures/resolve.js";
import { plannedPlaceholders, resolveAndStore } from "./resolve-command.js";
import { FileResultStore } from "../store/file-result-store.js";
import { requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface RunCommandOptions {
  plan: string;
  target?: string;
  config?: string;
  /** Run although judge and target share a model; the run and the report carry a warning. */
  allowSameModel?: boolean;
  /** Bind the placeholders {{fixtures.name}} anew before the run (issue #93). */
  resolve?: boolean;
}

/** The binding of the latest earlier run against the same target, for "vorher" in the report. */
async function previousRunBinding(
  store: FileResultStore,
  target: string,
): Promise<BindingFile | undefined> {
  let ids: string[];
  try {
    ids = await store.listRuns();
  } catch {
    return undefined; // "vorher" in the report is a nicety; a broken run must not stop this one.
  }
  for (const id of ids.reverse()) {
    try {
      const run = await store.readRun(id);
      if (run.target !== target) continue;
      const binding = await store.readRunBinding(id);
      if (binding !== null) return binding;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * `aiqa run --plan <datei> [--target <name>]`: runs the plan against the configured target,
 * with the judge from aiqa.yaml when one is configured.
 */
export async function executeRun(
  options: RunCommandOptions,
  io: CliIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunSummary> {
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const target = workspace.config.target;
  if (
    options.target !== undefined &&
    options.target !== target.name &&
    options.target !== target.adapter
  ) {
    throw new CliError(
      `Zielsystem "${options.target}" ist in ${toPosix(path.relative(io.cwd, workspace.file))} nicht konfiguriert. Konfiguriert ist "${target.name}" mit Adapter ${target.adapter}.`,
    );
  }

  const loaded = await loadPlan(path.resolve(io.cwd, options.plan));
  const store = new FileResultStore(runsDir(workspace));

  // Placeholders {{fixtures.name}}: the cases run with the stored binding (issue #93, ADR 0022).
  const needed = plannedPlaceholders(
    loaded.plan.caseRefs.map((ref) => loaded.cases.get(ref.caseId)),
  );
  let runGoldsets: Goldset[] = loaded.goldsets;
  let runBinding: BindingFile | undefined;
  let unresolvedCases: Map<string, string[]> | undefined;
  if (needed.length > 0) {
    const binding =
      options.resolve === true
        ? await resolveAndStore(workspace, store, needed, io, env)
        : await store.latestBinding(target.name);
    if (binding === null) {
      throw new CliError(
        `Der Plan nutzt Platzhalter (${needed.join(", ")}), für ${target.name} gibt es noch keine Bindung. Erst aiqa resolve --plan ${options.plan} ausführen oder aiqa run --resolve.`,
      );
    }
    const missing = needed.filter(
      (name) => !binding.entries.some((entry) => entry.placeholder === name),
    );
    if (missing.length > 0) {
      throw new CliError(
        `Die Bindung vom ${binding.createdAt} kennt ${missing.join(", ")} nicht. aiqa resolve --plan ${options.plan} erneut ausführen.`,
      );
    }
    const values = boundValues(binding);
    io.writeOut(
      `Bindung vom ${binding.createdAt}: ${String(needed.filter((name) => values.has(name)).length)} von ${String(needed.length)} Platzhaltern mit Wert.`,
    );
    const bound = bindCases([...loaded.cases.values()], values);
    runGoldsets = loaded.goldsets.map((goldset) => ({
      ...goldset,
      cases: goldset.cases.map((testCase) => bound.cases.get(testCase.id) ?? testCase),
    }));
    runBinding = withPrevious(binding, await previousRunBinding(store, target.name));
    const planned = new Set(loaded.plan.caseRefs.map((ref) => ref.caseId));
    unresolvedCases = new Map([...bound.unresolved].filter(([caseId]) => planned.has(caseId)));
    for (const [caseId, names] of unresolvedCases) {
      io.writeErr(
        `Hinweis: Fall ${caseId} wird nicht geschickt, Platzhalter ohne Wert: ${names.join(", ")}`,
      );
    }
  }

  const adapter = createAdapter(target, { env, workspaceDir: workspace.dir });
  const checks = createDefaultChecks({ maxLatencyMs: target.expectations.maxLatencyMs });

  const warnings: string[] = [];
  const judgeConfig = workspace.config.judge;
  const planJudge = loaded.plan.judge;
  if (planJudge !== undefined && judgeConfig === undefined) {
    throw new CliError(
      `Der Plan verlangt den Judge ${planJudge.model}, in aiqa.yaml ist kein judge-Block konfiguriert.`,
    );
  }
  if (
    planJudge !== undefined &&
    judgeConfig !== undefined &&
    planJudge.model !== judgeConfig.model
  ) {
    throw new CliError(
      `Der Plan wurde für den Judge ${planJudge.model} freigegeben, aiqa.yaml konfiguriert ${judgeConfig.model}.`,
    );
  }
  const hygiene = sameModelWarning(workspace.config);
  if (hygiene !== null) {
    if (options.allowSameModel !== true) {
      throw new CliError(`${hygiene} Anderes Modell wählen oder --allow-same-model setzen.`);
    }
    warnings.push(hygiene);
    io.writeErr(`Hinweis: ${hygiene}`);
  }
  const judge =
    judgeConfig === undefined
      ? undefined
      : createJudge(
          planJudge === undefined
            ? judgeConfig
            : { ...judgeConfig, promptVersion: planJudge.promptVersion },
          env,
        );

  io.writeOut(
    `Starte Plan ${loaded.plan.id} gegen ${target.name} (Adapter ${target.adapter}), ${String(
      loaded.plan.caseRefs
        .filter((ref) => unresolvedCases?.has(ref.caseId) !== true)
        .reduce((sum, ref) => sum + ref.iterations, 0),
    )} Iterationen.`,
  );
  io.writeOut(
    judge === undefined
      ? "Judge: keiner konfiguriert, es urteilen nur die deterministischen Checks."
      : `Judge: ${judge.model} (Prompt ${judge.promptVersion}).`,
  );
  const calibrations: RunCalibration[] = [];
  if (judge !== undefined) {
    for (const goldset of loaded.goldsets) {
      const calibration = await store.readCalibration(goldset.id, judge.model, judge.promptVersion);
      if (calibration === null) {
        if (goldset.calibration !== undefined) {
          const note = `Judge ${judge.model} ist für Goldset ${goldset.id} nicht kalibriert. Vor dem Vertrauen in die Urteile: aiqa calibrate.`;
          warnings.push(note);
          io.writeErr(`Hinweis: ${note}`);
        }
        continue;
      }
      calibrations.push({
        goldsetId: goldset.id,
        kappa: calibration.kappa,
        minKappa: calibration.minKappa,
        released: calibration.released,
        samples: calibration.samples,
        calibratedAt: calibration.calibratedAt,
      });
      if (!calibration.released) {
        const note = `Judge ${judge.model} ist für Goldset ${goldset.id} nicht freigegeben: Kappa ${calibration.kappa.toFixed(2)} liegt unter der Schwelle ${calibration.minKappa.toFixed(2)}. Die Judge-Urteile dieses Laufs sind nicht belastbar.`;
        warnings.push(note);
        io.writeErr(`Hinweis: ${note}`);
      }
    }
  }
  let sources: JudgeSources | undefined;
  if (judge !== undefined) {
    sources = await loadJudgeSources(
      loaded.goldsets.map((goldset, index) => ({ goldset, file: loaded.files[index] ?? "" })),
      judge,
      judgeConfig?.maxSourceChars,
    );
    for (const line of sources.lines) io.writeOut(line);
    for (const note of sources.notes) {
      warnings.push(note);
      io.writeErr(`Hinweis: ${note}`);
    }
  }
  const goldsetOfCase = new Map(
    loaded.goldsets.flatMap((goldset) =>
      goldset.cases.map((testCase) => [testCase.id, goldset.id] as const),
    ),
  );
  let judgeCalls = 0;
  let sourceTokens = 0;
  if (judge !== undefined) {
    for (const ref of loaded.plan.caseRefs) {
      const testCase = loaded.cases.get(ref.caseId);
      if (testCase === undefined || !judge.applies(testCase)) continue;
      if (unresolvedCases?.has(ref.caseId) === true) continue;
      judgeCalls += ref.iterations;
      const perCall = sources?.tokensByGoldset.get(goldsetOfCase.get(ref.caseId) ?? "") ?? 0;
      sourceTokens += perCall * ref.iterations * callsPerIteration(testCase);
    }
  }
  const { maxCalls, maxTokens } = loaded.plan.budget;
  const expectedCalls = loaded.plan.caseRefs.reduce((sum, ref) => {
    if (unresolvedCases?.has(ref.caseId) === true) return sum;
    const testCase = loaded.cases.get(ref.caseId);
    return sum + ref.iterations * (testCase === undefined ? 1 : callsPerIteration(testCase));
  }, 0);
  io.writeOut(
    `Budget: ${String(maxCalls)} Aufrufe an das Zielsystem` +
      (maxTokens === undefined ? "" : `, ${String(maxTokens)} Tokens für Zielsystem und Judge`) +
      `. Erwartet: ${String(expectedCalls)} Aufrufe` +
      (judge === undefined
        ? "."
        : ` und bis zu ${String(judgeCalls)} Judge-Aufrufe` +
          (sourceTokens === 0
            ? "."
            : ` mit rund ${String(sourceTokens)} Tokens zusätzlicher Eingabe aus Quelldokumenten.`)),
  );
  if (expectedCalls > maxCalls) {
    io.writeErr(
      `Hinweis: Dialoge brauchen einen Aufruf je Nutzerzug, ${String(expectedCalls)} erwartete Aufrufe übersteigen das Budget von ${String(maxCalls)}. Der Lauf bricht ab, wenn es erreicht ist.`,
    );
  }
  const perDay = target.rateLimit.maxCallsPerDay;
  if (perDay !== undefined && expectedCalls > perDay) {
    io.writeErr(
      `Hinweis: Der Plan braucht ${String(expectedCalls)} Aufrufe, das Zielsystem erlaubt ${String(perDay)} am Tag (rateLimit.maxCallsPerDay). Der Lauf bricht ab, sobald es mit HTTP 429 ablehnt.`,
    );
  }
  const maxCallsPerRun = workspace.config.budget?.maxCallsPerRun;
  if (maxCallsPerRun !== undefined && maxCallsPerRun < maxCalls) {
    io.writeErr(
      `Hinweis: aiqa.yaml begrenzt jeden Lauf auf ${String(maxCallsPerRun)} Aufrufe, der Plan erlaubt ${String(maxCalls)}. Die niedrigere Grenze gilt.`,
    );
  }

  const plannedIterations = new Map(
    loaded.plan.caseRefs.map((ref) => [ref.caseId, ref.iterations]),
  );
  const passesByCase = new Map<string, number>();
  const unjudgedByCase = new Map<string, number>();
  // Ctrl+C ends the run after the current iteration with status and usage (issue #96); a
  // second Ctrl+C stops at once.
  const interrupt = new AbortController();
  const onInterrupt = (): void => {
    if (interrupt.signal.aborted) process.exit(130);
    interrupt.abort();
    io.writeErr(
      "Abbruch angefordert: der Lauf endet nach der laufenden Iteration. Erneut Strg+C bricht sofort ab.",
    );
  };
  process.on("SIGINT", onInterrupt);
  let summary: RunSummary;
  try {
    summary = await runPlan({
      plan: loaded.plan,
      goldsets: runGoldsets,
      ...(runBinding !== undefined ? { binding: runBinding } : {}),
      ...(unresolvedCases !== undefined ? { unresolvedCases } : {}),
      target,
      adapter,
      checks,
      ...(judge === undefined ? {} : { judge }),
      ...(sources === undefined ? {} : { judgeSources: sources.byGoldset }),
      warnings,
      calibrations,
      ...(maxCallsPerRun === undefined ? {} : { maxCallsPerRun }),
      store,
      signal: interrupt.signal,
      onProgress: (event) => {
        if (event.judgeFailure !== undefined) {
          io.writeErr(
            `  ${event.caseId}/${String(event.index)}: ${judgeFailureLabel(event.judgeFailure.kind)}, kein Judge-Urteil: ${event.judgeFailure.reason}`,
          );
        }
        // Passed without a judge verdict means unjudged: it leaves the rate (issue #83).
        const unjudged = event.pass && event.judgeFailure !== undefined;
        const passes = (passesByCase.get(event.caseId) ?? 0) + (event.pass && !unjudged ? 1 : 0);
        passesByCase.set(event.caseId, passes);
        const open = (unjudgedByCase.get(event.caseId) ?? 0) + (unjudged ? 1 : 0);
        unjudgedByCase.set(event.caseId, open);
        const planned = plannedIterations.get(event.caseId) ?? 0;
        if (event.index === planned - 1) {
          io.writeOut(
            `  ${event.caseId}: ${String(passes)} von ${String(planned)} bestanden` +
              (open === 0 ? "" : `, ${String(open)} ohne Judge-Urteil`),
          );
        }
      },
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    await adapter.close?.();
  }

  const passed = summary.iterations - summary.failedIterations - summary.unjudgedIterations;
  if (summary.abortReason !== undefined) {
    io.writeErr(`Abbruch: ${summary.abortReason}. Der Lauf ist unvollständig.`);
  }
  io.writeOut(
    `Lauf ${summary.runId} ${summary.status === "aborted" ? "abgebrochen" : "abgeschlossen"}: ${String(passed)} von ${String(summary.iterations)} Iterationen bestanden${summary.unjudgedIterations === 0 ? "" : `, ${String(summary.unjudgedIterations)} ohne Judge-Urteil`}, ${String(summary.verdicts)} Urteile` +
      (judge === undefined
        ? "."
        : `, davon ${String(summary.judgedIterations)} vom Judge, ${String(summary.judgeErrors)} Judge-Fehler, ${String(summary.judgeRefusals)} Ablehnungen durch den Judge.`),
  );
  io.writeOut(
    `Verbraucht: ${String(summary.calls)} Aufrufe, ${String(summary.tokens.input + summary.tokens.output)} Tokens (${String(summary.tokens.input)} Eingabe, ${String(summary.tokens.output)} Ausgabe).`,
  );
  io.writeOut(`Ergebnisse: ${toPosix(path.relative(io.cwd, store.runDir(summary.runId)))}/`);
  io.writeOut(`Report erzeugen mit: aiqa report --run ${summary.runId}`);
  return summary;
}
