import { analyzeFailures, groupFindings, mergeFindings } from "../agents/analysis-agent.js";
import { type Severity, SeveritySchema } from "../domain/common.js";
import type { Finding, FindingStatus } from "../domain/finding.js";
import type { Run } from "../domain/run.js";
import type { ModelProvider } from "../providers/model-provider.js";
import { FileResultStore } from "../store/file-result-store.js";
import { agentProvider, loadRiskCatalogs } from "./agents.js";
import { requireWorkspaceConfig, runsDir } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";
import { loadCaseMetadata, resolveRunId } from "./report-command.js";

export interface AnalyzeCommandOptions {
  /** Run id or `latest`. */
  run: string;
  config?: string;
  /** Finding ids a human confirms; no model is asked. */
  confirm?: readonly string[];
  /** Finding ids a human rejects; no model is asked. */
  reject?: readonly string[];
  /** Upper bound of clusters sent to the model. */
  maxClusters?: number;
  /** Group the failures without asking a model (issue #86). */
  noAgent?: boolean;
  /** With --reject: why, for example "Fehlalarm des Werkzeugs". */
  reason?: string;
  /** With --confirm: the cause as far as known. */
  cause?: string;
  /** With --confirm: what would fix it. */
  suggestion?: string;
  /** With --confirm: the severity a human assigns. */
  severity?: string;
  /** Model for the agent; tests pass a fake, the CLI builds it from aiqa.yaml. */
  provider?: ModelProvider;
}

interface DecisionDetails {
  note?: string;
  cause?: string;
  suggestion?: string;
  severity?: Severity;
}

function decide(
  findings: readonly Finding[],
  ids: readonly string[],
  status: FindingStatus,
  details: DecisionDetails = {},
): Finding[] {
  const unknown = ids.filter((id) => !findings.some((finding) => finding.id === id));
  if (unknown.length > 0) {
    throw new CliError(
      `Unbekannte Befunde: ${unknown.join(", ")}. Vorhanden sind: ${findings.map((finding) => finding.id).join(", ") || "keine"}.`,
    );
  }
  return findings.map((finding) =>
    ids.includes(finding.id) ? { ...finding, ...details, status } : finding,
  );
}

/** Reason belongs to a rejection, cause, suggestion and severity to a confirmation. */
function decisionDetails(options: AnalyzeCommandOptions): {
  confirmed: DecisionDetails;
  rejected: DecisionDetails;
} {
  const confirming = (options.confirm ?? []).length > 0;
  const rejecting = (options.reject ?? []).length > 0;
  if (options.reason !== undefined && !rejecting) {
    throw new CliError("--reason gehört zu --reject: Warum ist der Befund verworfen?");
  }
  for (const [flag, value] of [
    ["--cause", options.cause],
    ["--suggestion", options.suggestion],
    ["--severity", options.severity],
  ] as const) {
    if (value !== undefined && !confirming) {
      throw new CliError(`${flag} gehört zu --confirm: Es beschreibt einen bestätigten Befund.`);
    }
  }
  let severity: Severity | undefined;
  if (options.severity !== undefined) {
    const parsed = SeveritySchema.safeParse(options.severity);
    if (!parsed.success) {
      throw new CliError("--severity ist low, medium, high oder critical.");
    }
    severity = parsed.data;
  }
  return {
    rejected: options.reason === undefined ? {} : { note: options.reason },
    confirmed: {
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.suggestion !== undefined ? { suggestion: options.suggestion } : {}),
      ...(severity !== undefined ? { severity } : {}),
    },
  };
}

/**
 * `aiqa analyze --run <id>`: groups the failures of a run, lets the analysis agent form a
 * hypothesis per group and stores the findings with status hypothesis in
 * runs/<id>/findings.yaml (issue #17). `--confirm` and `--reject` record the decision of a
 * human; the report shows confirmed findings only (ADR 0010).
 */
export async function executeAnalyze(
  options: AnalyzeCommandOptions,
  io: CliIo,
): Promise<Finding[]> {
  if (
    options.maxClusters !== undefined &&
    (!Number.isInteger(options.maxClusters) || options.maxClusters < 1 || options.maxClusters > 50)
  ) {
    throw new CliError("--max-clusters muss eine ganze Zahl zwischen 1 und 50 sein");
  }
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  const store = new FileResultStore(runsDir(workspace));
  const runId = await resolveRunId(store, options.run, runsDir(workspace));
  let run: Run;
  try {
    run = await store.readRun(runId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const stored = await store.readFindings(runId);

  const confirm = options.confirm ?? [];
  const reject = options.reject ?? [];
  const details = decisionDetails(options);
  if (confirm.length > 0 || reject.length > 0) {
    const both = confirm.filter((id) => reject.includes(id));
    if (both.length > 0) {
      throw new CliError(`Befunde zugleich bestätigt und verworfen: ${both.join(", ")}.`);
    }
    const updated = decide(
      decide(stored, confirm, "confirmed", details.confirmed),
      reject,
      "rejected",
      details.rejected,
    );
    await store.writeFindings(runId, updated);
    for (const id of [...confirm, ...reject]) {
      const finding = updated.find((entry) => entry.id === id);
      if (finding !== undefined) io.writeOut(`${finding.id}: ${finding.status}`);
    }
    return updated;
  }

  const [iterations, verdicts] = await Promise.all([
    store.readIterations(runId),
    store.readVerdicts(runId),
  ]);
  const cases = await loadCaseMetadata(workspace, io);
  if (options.noAgent === true) {
    const grouped = groupFindings({ run, iterations, verdicts, cases });
    if (grouped.findings.length === 0) {
      io.writeOut(`Keine Fehlschläge mit Antwort in Lauf ${runId}, nichts zu gruppieren.`);
      return stored;
    }
    const merged = mergeFindings(stored, grouped.findings);
    await store.writeFindings(runId, merged);
    const fresh = merged.filter((finding) => finding.status === "hypothesis");
    io.writeOut(
      `${String(grouped.findings.length)} ${grouped.findings.length === 1 ? "Gruppe" : "Gruppen"} von Fehlschlägen, ohne Modell gebildet.`,
    );
    for (const finding of fresh) io.writeOut(`  ${finding.id}: ${finding.hypothesis}`);
    io.writeOut(
      `Entscheiden mit: aiqa analyze --run ${runId} --confirm <befund> --cause <text> --suggestion <text> oder --reject <befund> --reason <text>.`,
    );
    return merged;
  }
  const catalogs = await loadRiskCatalogs(workspace);
  const provider = options.provider ?? agentProvider(workspace, io, "Analyseagent");

  const result = await analyzeFailures(provider, {
    run,
    iterations,
    verdicts,
    cases,
    catalogs,
    ...(options.maxClusters !== undefined ? { maxClusters: options.maxClusters } : {}),
  });
  const skipped =
    (result.skippedErrors > 0
      ? ` ${String(result.skippedErrors)} Fehlschläge ohne Antwort (technische Fehler) sind nicht analysiert.`
      : "") +
    (result.skippedDrafts > 0
      ? ` ${String(result.skippedDrafts)} Fehlschläge von Entwürfen sind nicht analysiert.`
      : "");
  if (result.clusters.length === 0) {
    io.writeOut(`Keine Fehlschläge mit Antwort in Lauf ${runId}, nichts zu analysieren.${skipped}`);
    return stored;
  }

  const merged = mergeFindings(stored, result.findings);
  await store.writeFindings(runId, merged);
  for (const note of result.notes) io.writeErr(`Hinweis: ${note}`);

  const groups = result.clusters.length;
  io.writeOut(
    `Analyseagent (${provider.model}): ${String(groups)} ${groups === 1 ? "Gruppe" : "Gruppen"} von Fehlschlägen, ${String(result.calls)} Aufrufe, ${String(result.tokens.input + result.tokens.output)} Tokens.${skipped}`,
  );
  const fresh = merged.filter((finding) => finding.status === "hypothesis");
  for (const finding of fresh) {
    io.writeOut(
      `  ${finding.id} (${finding.category}, ${finding.severity}, ${String(finding.failedIterations ?? 0)} Fehlschläge in ${finding.caseIds.join(", ")}): ${finding.hypothesis}`,
    );
  }
  const kept = merged.length - fresh.length;
  if (kept > 0) {
    io.writeOut(`${String(kept)} bereits entschiedene Befunde bleiben unverändert.`);
  }
  io.writeOut(`Befunde geschrieben: runs/${runId}/findings.yaml. Alle sind Hypothesen.`);
  const first = fresh[0];
  if (first !== undefined) {
    io.writeOut(
      `Prüfen und entscheiden mit: aiqa analyze --run ${runId} --confirm ${first.id} (oder --reject). Nur bestätigte Befunde erscheinen im Report.`,
    );
  }
  return merged;
}
