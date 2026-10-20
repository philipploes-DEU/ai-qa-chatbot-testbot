import type { Turn } from "../domain/common.js";

export interface TemplateValues {
  /** Last user message. */
  input: string;
  /** Session id or token, empty without a session. */
  session: string;
  /** The whole conversation so far. */
  turns: readonly Turn[];
  /** Values for {{vars.name}}: defaults of the target, overridden by the case (issue #80). */
  vars?: Readonly<Record<string, string>>;
}

export class UnknownPlaceholderError extends Error {
  constructor(readonly placeholder: string) {
    super(
      `unbekannter Platzhalter {{${placeholder}}}, erlaubt sind input, session, turns und vars.name`,
    );
    this.name = "UnknownPlaceholderError";
  }
}

/** A {{vars.name}} without a value from the case or the defaults of the target (issue #80). */
export class MissingVariableError extends Error {
  constructor(readonly variable: string) {
    super(
      `{{vars.${variable}}} hat keinen Wert: im Fall unter vars oder im target-Block unter request.vars setzen`,
    );
    this.name = "MissingVariableError";
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+(?:\.[A-Za-z][A-Za-z0-9_]*)?)\s*\}\}/g;

/** Names of the variables a template uses as {{vars.name}}, in order, without repeats. */
export function templateVars(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const placeholder = match[1] ?? "";
    if (!placeholder.startsWith("vars.")) continue;
    const name = placeholder.slice("vars.".length);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** JSON string content without the surrounding quotes, safe inside a quoted template field. */
function jsonContent(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Fills {{input}}, {{session}} and {{turns}} in a request template. In mode `json` (the body)
 * input and session are escaped for use inside a JSON string and turns becomes a JSON array.
 * In mode `raw` (headers, urls) values are inserted as they are.
 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
  mode: "json" | "raw" = "json",
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (name.startsWith("vars.")) {
      const variable = name.slice("vars.".length);
      const value = values.vars?.[variable];
      if (value === undefined) throw new MissingVariableError(variable);
      return mode === "json" ? jsonContent(value) : value;
    }
    switch (name) {
      case "input":
        return mode === "json" ? jsonContent(values.input) : values.input;
      case "session":
        return mode === "json" ? jsonContent(values.session) : values.session;
      case "turns":
        return JSON.stringify(values.turns);
      default:
        throw new UnknownPlaceholderError(name);
    }
  });
}
