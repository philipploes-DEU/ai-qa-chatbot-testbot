import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../catalog/load-catalog.js";
import type { Catalog } from "../domain/catalog.js";
import { createProvider } from "../providers/factory.js";
import type { ModelProvider } from "../providers/model-provider.js";
import type { LoadedWorkspace } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

/** The risk catalog that ships with AI QA, offered to the planning agent for tags. */
export const SHIPPED_RISK_CATALOG = new URL("../../catalogs/owasp-llm-2025.yaml", import.meta.url);

/** The risk catalogs of the workspace, else the shipped OWASP catalog. */
export async function loadRiskCatalogs(workspace: LoadedWorkspace): Promise<Catalog[]> {
  const refs = workspace.config.catalogs;
  if (refs.length === 0) return [await loadCatalog(fileURLToPath(SHIPPED_RISK_CATALOG))];
  const catalogs: Catalog[] = [];
  for (const ref of refs) catalogs.push(await loadCatalog(path.resolve(workspace.dir, ref)));
  return catalogs;
}

/** The model of the agents block, else the judge model, for the planning and analysis agent. */
export function agentProvider(workspace: LoadedWorkspace, io: CliIo, agent: string): ModelProvider {
  const { agents, judge } = workspace.config;
  if (agents !== undefined) return createProvider(agents, process.env, {}, "agents.apiKey");
  if (judge !== undefined) {
    io.writeOut(
      `Der ${agent} nutzt das Modell des Judge (${judge.model}). Ein eigener agents-Block in aiqa.yaml trennt beide.`,
    );
    return createProvider(judge);
  }
  throw new CliError(
    `Für den ${agent} braucht aiqa.yaml einen agents-Block (oder einen judge-Block) mit seinem Modell.`,
  );
}
