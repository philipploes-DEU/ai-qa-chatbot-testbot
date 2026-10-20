import type { ReportTheme } from "../default/theme.js";

/** Four levels up from src/report/themes/wirkmittel and from dist/report/themes/wirkmittel. */
const FONTS = new URL("../../../../assets/fonts/", import.meta.url);

/**
 * The report in the Wirkmittel design: dark only on petrol, radius 0, rules instead of
 * boxes, Electric Blue for structure and Neon Orange once for the key number. Inter and
 * Space Grotesk are embedded from assets/fonts (SIL Open Font License, texts next to them).
 */
export const wirkmittelTheme: ReportTheme = {
  name: "wirkmittel",
  title: "AI QA Report",
  html: {
    colorScheme: "dark",
    colors: {
      background: "#131122",
      surface: "#1a1830",
      line: "#252240",
      text: "#f5f5f5",
      muted: "#a3a3a3",
      accent: "#0EA5E9",
      highlight: "#FB923C",
    },
    fonts: {
      heading: "'Space Grotesk', 'Inter', system-ui, sans-serif",
      body: "'Inter', system-ui, sans-serif",
      mono: "'Courier New', Courier, monospace",
    },
    fontFaces: [
      { family: "Inter", weight: "100 900", file: new URL("InterVariable.woff2", FONTS) },
      {
        family: "Space Grotesk",
        weight: "300 700",
        file: new URL("SpaceGrotesk-Variable.woff2", FONTS),
      },
    ],
    subtitleGradient: "linear-gradient(to right, #0EA5E9, #FB923C)",
    shadow: "6px 6px 0px #0EA5E9",
  },
};
