import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { CliError } from "./errors.js";
import {
  renderWorkspaceConfig,
  renderWorkspacePlan,
  renderWorkspaceReadme,
  WORKSPACE_GITIGNORE,
  WORKSPACE_GOLDSET,
} from "./templates.js";
import { renderWorkflow } from "./workflow-template.js";

export interface InitOptions {
  /** Also write a GitHub Actions workflow for scheduled runs (issue #14). */
  withSchedule?: boolean;
}

/** Turns a folder name into a safe id, for example "Mein Bot" into "mein-bot". */
export function toTargetName(folderName: string): string {
  const cleaned = folderName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return `${cleaned.length > 0 ? cleaned : "mein-bot"}-dummy`;
}

/**
 * Creates a workspace: aiqa.yaml with a dummy target, an example goldset with three cases,
 * a plan, a .gitignore and a short README. Refuses to touch a non-empty directory.
 */
export async function initWorkspace(
  dir: string,
  now: () => Date = () => new Date(),
  options: InitOptions = {},
): Promise<string[]> {
  const absolute = path.resolve(dir);
  let existing: Awaited<ReturnType<typeof stat>> | null;
  try {
    existing = await stat(absolute);
  } catch {
    existing = null;
  }
  if (existing !== null && !existing.isDirectory()) {
    throw new CliError(`${absolute} ist kein Verzeichnis`);
  }
  if (existing !== null && (await readdir(absolute)).length > 0) {
    throw new CliError(
      `Verzeichnis ${absolute} ist nicht leer. aiqa init legt nur leere oder neue Ordner an.`,
    );
  }

  const folderName = path.basename(absolute);
  const targetName = toTargetName(folderName);
  const files: [string, string][] = [
    ["aiqa.yaml", renderWorkspaceConfig(targetName)],
    [path.join("goldsets", "beispiel", "goldset.yaml"), WORKSPACE_GOLDSET],
    [
      path.join("goldsets", "beispiel", "plan.yaml"),
      renderWorkspacePlan(targetName, now().toISOString()),
    ],
    [".gitignore", WORKSPACE_GITIGNORE],
    ["README.md", renderWorkspaceReadme(folderName)],
  ];
  if (options.withSchedule === true) {
    files.push([
      path.join(".github", "workflows", "aiqa.yml"),
      renderWorkflow("goldsets/beispiel/plan.yaml"),
    ]);
  }

  const created: string[] = [];
  for (const [relative, content] of files) {
    const target = path.join(absolute, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    created.push(target);
  }
  return created;
}
