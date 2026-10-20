import type { WorkspaceConfig } from "./workspace-config.js";

/** The model name of the target when the target is a model, null for other adapters. */
export function targetModel(config: WorkspaceConfig): string | null {
  return config.target.adapter === "openai-compatible"
    ? (config.target.openai?.model ?? null)
    : null;
}

/**
 * A judge that rates its own model's answers favours them (self-enhancement bias, issue #24).
 * Returns the warning text when judge and target share a model, null otherwise. Callers block
 * on it unless the user overrides with --allow-same-model, which puts the text into the run.
 */
export function sameModelWarning(config: WorkspaceConfig): string | null {
  const judgeModel = config.judge?.model;
  const target = targetModel(config);
  if (judgeModel === undefined || target === null) return null;
  if (judgeModel.trim().toLowerCase() !== target.trim().toLowerCase()) return null;
  return (
    `Judge und Zielsystem nutzen dasselbe Modell (${judgeModel}). Ein Modell bewertet seine eigenen ` +
    "Antworten und neigt dazu, sie zu bevorzugen. Die Urteile dieses Laufs sind nur eingeschränkt belastbar."
  );
}
