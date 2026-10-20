import type { ReportModel } from "./report-model.js";
import type { ReportTheme } from "./themes/default/theme.js";

/**
 * Turns a model into a document of one format (ADR 0007, ADR 0009). The run report has a
 * Markdown and an HTML renderer; further models such as the comparison can follow.
 */
export interface Renderer<Model> {
  readonly format: string;
  readonly fileExtension: string;
  render(model: Model, theme?: ReportTheme): string;
}

/** Renders the report of one run. */
export type ReportRenderer = Renderer<ReportModel>;
