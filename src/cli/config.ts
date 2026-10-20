import path from "node:path";

import { type WorkspaceConfig, WorkspaceConfigSchema } from "../domain/workspace-config.js";
import { pathExists } from "../io/files.js";
import { loadDocument } from "../io/yaml.js";
import { CliError } from "./errors.js";

export interface LoadedWorkspace {
  config: WorkspaceConfig;
  file: string;
  /** Directory of aiqa.yaml; goldsets, catalogs, runs and reports are relative to it. */
  dir: string;
}

export async function loadWorkspaceConfig(file: string): Promise<LoadedWorkspace> {
  const resolved = path.resolve(file);
  const config = await loadDocument(WorkspaceConfigSchema, resolved);
  return { config, file: resolved, dir: path.dirname(resolved) };
}

/** Loads aiqa.yaml from the working directory or the given path, with a hint when it is missing. */
export async function requireWorkspaceConfig(
  cwd: string,
  configPath?: string,
): Promise<LoadedWorkspace> {
  const file = path.resolve(cwd, configPath ?? "aiqa.yaml");
  if (!(await pathExists(file))) {
    throw new CliError(
      `Keine Konfiguration unter ${file}. Lege mit "aiqa init <ordner>" einen Arbeitsbereich an oder gib --config an.`,
    );
  }
  return loadWorkspaceConfig(file);
}

export function runsDir(workspace: LoadedWorkspace): string {
  return path.resolve(workspace.dir, workspace.config.runsDir);
}

export function reportsDir(workspace: LoadedWorkspace): string {
  return path.resolve(workspace.dir, workspace.config.reportsDir);
}
