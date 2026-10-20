import type { ReportTheme } from "../default/theme.js";

/** A plain theme for reports that go out without a brand: black on white, system fonts. */
export const neutralTheme: ReportTheme = {
  name: "neutral",
  title: "AI QA Report",
  html: {
    colorScheme: "light",
    colors: {
      background: "#ffffff",
      surface: "#f4f4f5",
      line: "#d4d4d8",
      text: "#111111",
      muted: "#52525b",
      accent: "#1d4ed8",
      highlight: "#111111",
    },
    fonts: {
      heading: "system-ui, sans-serif",
      body: "system-ui, sans-serif",
      mono: "ui-monospace, 'Courier New', monospace",
    },
    fontFaces: [],
    shadow: "none",
  },
};
