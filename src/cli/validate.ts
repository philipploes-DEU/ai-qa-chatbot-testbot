import path from "node:path";

import type { z } from "zod";

import { CatalogSchema } from "../domain/catalog.js";
import { GoldsetSchema } from "../domain/goldset.js";
import { sameModelWarning } from "../domain/judge-hygiene.js";
import { PlanSchema, totalPlannedCalls } from "../domain/plan.js";
import { PlaywrightSpecSchema } from "../domain/playwright-spec.js";
import { ProbeCatalogSchema } from "../domain/probe-catalog.js";
import { PromptfooCaseTemplatesSchema } from "../domain/promptfoo-case-templates.js";
import { PromptfooMappingSchema } from "../domain/promptfoo-mapping.js";
import { WorkspaceConfigSchema } from "../domain/workspace-config.js";
import { checkMappings } from "../fixtures/mapping.js";
import { loadGoldset } from "../goldset/load-goldset.js";
import { isDirectory, listYamlFiles, pathExists, toPosix } from "../io/files.js";
import { parseDocument, readYamlFile, ValidationError } from "../io/yaml.js";
import { loadPlan } from "../runner/load-plan.js";

export type DocumentKind =
  | "goldset"
  | "catalog"
  | "probes"
  | "plan"
  | "workspace"
  | "playwright-spec"
  | "promptfoo-mapping"
  | "promptfoo-case-templates"
  | "unknown";

export interface FileResult {
  /** Path as shown to the user, relative to the working directory. */
  path: string;
  kind: DocumentKind;
  errors: string[];
  /** One line about the valid document, for example "8 Fälle". */
  summary?: string;
}

export interface ValidationResult {
  ok: boolean;
  files: FileResult[];
}

export interface ValidateOptions {
  /** Accept a workspace whose judge and target share a model; the finding becomes a note. */
  allowSameModel?: boolean;
}

/** File names decide first (aiqa.yaml, *.spec.yaml, plan.yaml), then the top level keys. */
export function detectKind(fileName: string, data: unknown): DocumentKind {
  const base = path.basename(fileName).toLowerCase();
  if (base === "aiqa.yaml" || base === "aiqa.yml") return "workspace";
  if (base.endsWith(".spec.yaml") || base.endsWith(".spec.yml")) return "playwright-spec";
  if (/^(.*\.)?plan\.ya?ml$/.test(base)) return "plan";
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "unknown";
  if ("cases" in data) return "goldset";
  if ("entries" in data) return "catalog";
  if ("patterns" in data) return "probes";
  if ("caseRefs" in data) return "plan";
  if ("plugins" in data) return "promptfoo-mapping";
  if ("templates" in data) return "promptfoo-case-templates";
  if ("target" in data && "version" in data) return "workspace";
  return "unknown";
}

function stripPrefix(message: string, file: string): string {
  const prefix = `${file}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function tryParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  file: string,
): { data: T; errors: [] } | { data: null; errors: string[] } {
  try {
    return { data: parseDocument(schema, data, file), errors: [] };
  } catch (error) {
    if (error instanceof ValidationError) return { data: null, errors: [...error.issues] };
    throw error;
  }
}

async function validateFile(
  file: string,
  display: string,
  options: ValidateOptions,
): Promise<FileResult> {
  let data: unknown;
  try {
    data = await readYamlFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: display, kind: "unknown", errors: [stripPrefix(message, file)] };
  }

  const kind = detectKind(file, data);
  switch (kind) {
    case "goldset": {
      const parsed = tryParse(GoldsetSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : { path: display, kind, errors: [], summary: `${String(parsed.data.cases.length)} Fälle` };
    }
    case "catalog": {
      const parsed = tryParse(CatalogSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : {
            path: display,
            kind,
            errors: [],
            summary: `${String(parsed.data.entries.length)} Einträge`,
          };
    }
    case "probes": {
      const parsed = tryParse(ProbeCatalogSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : {
            path: display,
            kind,
            errors: [],
            summary: `${String(parsed.data.patterns.length)} Muster`,
          };
    }
    case "promptfoo-case-templates": {
      const parsed = tryParse(PromptfooCaseTemplatesSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : {
            path: display,
            kind,
            errors: [],
            summary: `${String(parsed.data.templates.length)} Vorlagen`,
          };
    }
    case "promptfoo-mapping": {
      const parsed = tryParse(PromptfooMappingSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : {
            path: display,
            kind,
            errors: [],
            summary: `${String(parsed.data.plugins.length)} Plugin-Regeln, ${String(parsed.data.strategies.length)} Strategie-Regeln`,
          };
    }
    case "plan": {
      const parsed = tryParse(PlanSchema, data, file);
      if (parsed.data === null) return { path: display, kind, errors: parsed.errors };
      try {
        const loaded = await loadPlan(file);
        return {
          path: display,
          kind,
          errors: [],
          summary: `${String(totalPlannedCalls(loaded.plan))} Aufrufe geplant, ${String(loaded.goldsets.length)} Goldset(s)`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { path: display, kind, errors: [stripPrefix(message, file)] };
      }
    }
    case "workspace": {
      const parsed = tryParse(WorkspaceConfigSchema, data, file);
      if (parsed.data === null) return { path: display, kind, errors: parsed.errors };
      const judge = parsed.data.judge;
      const summary =
        `Zielsystem ${parsed.data.target.name} (${parsed.data.target.adapter})` +
        (judge === undefined ? "" : `, Judge ${judge.model}`);
      // Every declared placeholder of a workspace goldset needs a binding (issue #93).
      const unbound: string[] = [];
      for (const ref of parsed.data.goldsets) {
        let declared: string[];
        try {
          const goldset = await loadGoldset(path.resolve(path.dirname(file), ref));
          declared = Object.keys(goldset.fixtures ?? {});
        } catch {
          continue; // A broken goldset is reported when it is validated itself.
        }
        for (const name of declared) {
          if (parsed.data.fixtures?.bindings[name] === undefined) {
            unbound.push(`fixtures.bindings: Platzhalter ${name} aus ${ref} hat keine Bindung`);
          }
        }
      }
      // Fields of the bindings against the mapping of their source (issue #93).
      if (parsed.data.fixtures !== undefined) {
        unbound.push(...(await checkMappings(parsed.data.fixtures, path.dirname(file))));
      }
      if (unbound.length > 0) return { path: display, kind, errors: unbound };
      const warning = sameModelWarning(parsed.data);
      if (warning !== null && options.allowSameModel !== true) {
        return {
          path: display,
          kind,
          errors: [`judge.model: ${warning} Anderes Modell wählen oder --allow-same-model setzen.`],
        };
      }
      return {
        path: display,
        kind,
        errors: [],
        summary:
          warning === null ? summary : `${summary}, gleiches Modell wie das Zielsystem (erlaubt)`,
      };
    }
    case "playwright-spec": {
      const parsed = tryParse(PlaywrightSpecSchema, data, file);
      return parsed.data === null
        ? { path: display, kind, errors: parsed.errors }
        : { path: display, kind, errors: [], summary: `Oberfläche ${parsed.data.name}` };
    }
    case "unknown":
      return {
        path: display,
        kind,
        errors: [
          "unbekannter Dokumenttyp: erwartet goldset (cases), catalog (entries), probes (patterns), plan (caseRefs), aiqa.yaml oder *.spec.yaml",
        ],
      };
  }
}

/** Validates files and directories (recursively) against the schemas of their document kind. */
export async function validatePaths(
  paths: readonly string[],
  cwd: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const files: FileResult[] = [];
  for (const given of paths) {
    const absolute = path.resolve(cwd, given);
    if (!(await pathExists(absolute))) {
      files.push({ path: toPosix(given), kind: "unknown", errors: ["Pfad nicht gefunden"] });
      continue;
    }
    const targets = (await isDirectory(absolute)) ? await listYamlFiles(absolute) : [absolute];
    for (const file of targets) {
      files.push(
        await validateFile(file, toPosix(path.relative(cwd, file) || path.basename(file)), options),
      );
    }
  }
  return { ok: files.every((file) => file.errors.length === 0), files };
}
