import path from "node:path";

import { DummyConfigSchema, type TargetConfig } from "../domain/target-config.js";
import { DummyAdapter } from "./dummy.js";
import type { TargetHttpOptions } from "./http-client.js";
import { HttpTemplateAdapter } from "./http-template.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import { PlaywrightAdapter } from "./playwright.js";
import { ScriptAdapter } from "./script.js";
import type { TargetAdapter } from "./target.js";

export class AdapterNotImplementedError extends Error {
  constructor(adapter: string, issue: string | null) {
    super(
      issue === null
        ? `Adapter "${adapter}" ist noch nicht umgesetzt und hat noch kein Issue`
        : `Adapter "${adapter}" ist noch nicht umgesetzt, siehe Issue ${issue}`,
    );
    this.name = "AdapterNotImplementedError";
  }
}

export interface CreateAdapterOptions extends TargetHttpOptions {
  /** Directory the playwright spec path is relative to, usually the workspace. */
  workspaceDir?: string;
}

/**
 * Builds the adapter for a target config. Network adapters resolve ${NAME} references in auth
 * from `options.env` (process.env by default) and fail here when a variable is missing.
 */
export function createAdapter(
  target: TargetConfig,
  options: CreateAdapterOptions = {},
): TargetAdapter {
  switch (target.adapter) {
    case "dummy":
      return new DummyAdapter(target.dummy ?? DummyConfigSchema.parse({}), target.name);
    case "http":
      return new HttpTemplateAdapter(target, options);
    case "openai-compatible":
      return new OpenAiCompatibleAdapter(target, options);
    case "playwright":
      return new PlaywrightAdapter(target, {
        ...(options.env !== undefined ? { env: options.env } : {}),
        specFile: path.resolve(
          options.workspaceDir ?? process.cwd(),
          target.playwright?.spec ?? "",
        ),
      });
    case "script":
      return new ScriptAdapter(target, { cwd: options.workspaceDir ?? process.cwd() });
  }
}
