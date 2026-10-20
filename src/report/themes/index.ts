import { defaultTheme, type ReportTheme } from "./default/theme.js";
import { neutralTheme } from "./neutral/theme.js";
import { wirkmittelTheme } from "./wirkmittel/theme.js";

export * from "./default/theme.js";
export * from "./neutral/theme.js";
export * from "./wirkmittel/theme.js";

/** Themes shipped with the core, chosen by name with `aiqa report --theme`. */
export const reportThemes: Readonly<Record<string, ReportTheme>> = {
  [defaultTheme.name]: defaultTheme,
  [wirkmittelTheme.name]: wirkmittelTheme,
  [neutralTheme.name]: neutralTheme,
};
