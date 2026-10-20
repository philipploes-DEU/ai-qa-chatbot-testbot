/** A font file the HTML renderer embeds as a data URL, so the report loads nothing. */
export interface FontFaceSource {
  readonly family: string;
  /** CSS font-weight, a single value or a range such as "100 900". */
  readonly weight: string;
  /** Location of a woff2 file. */
  readonly file: URL;
}

/** Colours, fonts and shapes of an HTML report. */
export interface HtmlStyle {
  readonly colorScheme: "dark" | "light";
  readonly colors: {
    readonly background: string;
    /** Slightly raised areas such as quotes and table heads. */
    readonly surface: string;
    readonly line: string;
    readonly text: string;
    readonly muted: string;
    /** Structure: rules, bars, the trend line. */
    readonly accent: string;
    /** The one element per page that must stand out: the key number. */
    readonly highlight: string;
  };
  readonly fonts: {
    readonly heading: string;
    readonly body: string;
    readonly mono: string;
  };
  readonly fontFaces: readonly FontFaceSource[];
  /** CSS gradient for the subtitle, or undefined for plain text. */
  readonly subtitleGradient?: string;
  /** Hard offset shadow of the key statement, or "none". */
  readonly shadow: string;
}

/**
 * A theme carries what a renderer should not decide on its own: the title and, for HTML,
 * colours, fonts and shapes. Markdown only uses the title.
 */
export interface ReportTheme {
  readonly name: string;
  readonly title: string;
  readonly html?: HtmlStyle;
}

export const defaultTheme: ReportTheme = {
  name: "default",
  title: "AI QA Report",
};
