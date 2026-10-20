import { z } from "zod";

import { FixturesConfigSchema } from "./fixtures.js";
import { GatesConfigSchema, WorkspaceBudgetSchema } from "./gates.js";
import { JudgeProviderConfigSchema, ModelProviderConfigSchema } from "./judge-config.js";
import { ProbeVariablesSchema } from "./probe-catalog.js";
import { TargetConfigSchema } from "./target-config.js";

/** Content of `aiqa.yaml` in a workspace. */
export const WorkspaceConfigSchema = z.strictObject({
  version: z.literal(1),
  target: TargetConfigSchema,
  /** Model behind the judge. Without it only the deterministic checks judge. */
  judge: JudgeProviderConfigSchema.optional(),
  /** Model behind the planning and analysis agents. Without it they use the judge model. */
  agents: ModelProviderConfigSchema.optional(),
  /** Thresholds for scheduled runs, checked by aiqa gate. */
  gates: GatesConfigSchema.optional(),
  /** Hard limits per run, on top of the plan's budget. */
  budget: WorkspaceBudgetSchema.optional(),
  /** Values for the placeholders of the probe catalog (aiqa plan --probes). */
  probes: z
    .strictObject({
      variables: ProbeVariablesSchema.default({}),
    })
    .optional(),
  /** Sources, stored queries and bindings for {{fixtures.name}} (issue #93, ADR 0022). */
  fixtures: FixturesConfigSchema.optional(),
  /** Goldset files, relative to the config file. */
  goldsets: z.array(z.string().min(1)).default([]),
  /** Catalog files, relative to the config file. */
  catalogs: z.array(z.string().min(1)).default([]),
  runsDir: z.string().min(1).default("runs"),
  reportsDir: z.string().min(1).default("reports"),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type WorkspaceConfigInput = z.input<typeof WorkspaceConfigSchema>;
