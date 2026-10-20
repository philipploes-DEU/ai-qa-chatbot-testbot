import type { TargetConfigInput } from "../domain/target-config.js";

/** A request as the browser copied it. Secrets are still inside; it never goes to a file. */
export interface CurlRequest {
  method: string;
  url: string;
  /** Header names in lower case, in order. */
  headers: [string, string][];
  body?: string;
  cookies?: string;
}

export class CurlImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurlImportError";
  }
}

const ANSI_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "0": "\0",
};

/** Splits a bash command line into words: quotes, $'...', backslashes, line continuations. */
function tokenize(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let index = 0;
  const push = (): void => {
    if (inWord) words.push(current);
    current = "";
    inWord = false;
  };
  while (index < command.length) {
    const char = command[index] ?? "";
    if (char === "\\" && (command[index + 1] === "\n" || command[index + 1] === "\r")) {
      index += command[index + 1] === "\r" && command[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      index += 1;
      continue;
    }
    inWord = true;
    if (char === "$" && command[index + 1] === "'") {
      index += 2;
      while (index < command.length && command[index] !== "'") {
        if (command[index] === "\\") {
          const next = command[index + 1] ?? "";
          if (next === "u" || next === "x") {
            const length = next === "u" ? 4 : 2;
            const hex = command.slice(index + 2, index + 2 + length);
            current += String.fromCharCode(Number.parseInt(hex, 16));
            index += 2 + length;
            continue;
          }
          current += ANSI_ESCAPES[next] ?? next;
          index += 2;
          continue;
        }
        current += command[index] ?? "";
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1)
        throw new CurlImportError("Ein einfaches Anführungszeichen ist nicht geschlossen.");
      current += command.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < command.length && command[index] !== '"') {
        if (command[index] === "\\" && '"\\$`\n'.includes(command[index + 1] ?? "")) {
          current += command[index + 1] ?? "";
          index += 2;
          continue;
        }
        current += command[index] ?? "";
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "\\") {
      current += command[index + 1] ?? "";
      index += 2;
      continue;
    }
    current += char;
    index += 1;
  }
  push();
  return words;
}

const VALUE_FLAGS: Record<string, "method" | "header" | "data" | "cookie" | "url" | "ignore"> = {
  "-X": "method",
  "--request": "method",
  "-H": "header",
  "--header": "header",
  "-d": "data",
  "--data": "data",
  "--data-raw": "data",
  "--data-binary": "data",
  "--data-ascii": "data",
  "--json": "data",
  "-b": "cookie",
  "--cookie": "cookie",
  "--url": "url",
  "-A": "ignore",
  "--user-agent": "ignore",
  "-e": "ignore",
  "--referer": "ignore",
  "-u": "ignore",
  "--user": "ignore",
};

/**
 * Reads a request copied from the browser with "Copy as cURL (bash)" (issue #81). The Windows
 * cmd variant escapes with ^ and is refused with a hint.
 */
export function parseCurl(command: string): CurlRequest {
  if (command.includes('^"')) {
    throw new CurlImportError(
      'Das ist die Windows-Variante. Bitte im Browser "Als cURL kopieren (bash)" wählen.',
    );
  }
  const words = tokenize(command.trim());
  if (words[0] === "curl") words.shift();
  let method: string | undefined;
  let url: string | undefined;
  const headers: [string, string][] = [];
  const data: string[] = [];
  let cookies: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    const kind = VALUE_FLAGS[word];
    if (kind !== undefined) {
      const value = words[index + 1] ?? "";
      index += 1;
      if (kind === "method") method = value.toUpperCase();
      else if (kind === "header") {
        const colon = value.indexOf(":");
        if (colon > 0) {
          headers.push([value.slice(0, colon).trim().toLowerCase(), value.slice(colon + 1).trim()]);
        }
      } else if (kind === "data") {
        data.push(value);
        if (word === "--json") headers.push(["content-type", "application/json"]);
      } else if (kind === "cookie") cookies = value;
      else if (kind === "url") url = value;
      continue;
    }
    if (word.startsWith("-")) continue;
    url ??= word;
  }
  if (url === undefined) throw new CurlImportError("Im cURL-Befehl steht keine URL.");
  const body = data.length === 0 ? undefined : data.join("&");
  const cookieHeader = headers.find(([name]) => name === "cookie");
  return {
    method: method ?? (body === undefined ? "GET" : "POST"),
    url,
    headers: headers.filter(([name]) => name !== "cookie"),
    ...(body !== undefined ? { body } : {}),
    ...(cookies !== undefined || cookieHeader !== undefined
      ? { cookies: cookies ?? cookieHeader?.[1] ?? "" }
      : {}),
  };
}

/** Headers the browser adds on its own; they say nothing about the API. */
const NOISE = new Set([
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connection",
  "content-length",
  "dnt",
  "host",
  "origin",
  "pragma",
  "priority",
  "referer",
  "upgrade-insecure-requests",
  "user-agent",
]);

const SECRET_NAMES = new Set([
  "authorization",
  "apikey",
  "api-key",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "proxy-authorization",
]);

/** Long opaque values such as tokens or keys, also in headers with other names. */
function looksSecret(value: string): boolean {
  return /^[A-Za-z0-9._~+/=-]{32,}$/.test(value) || /^eyJ[A-Za-z0-9_-]{10,}\./.test(value);
}

const TOKEN_REF = "${AIQA_TARGET_TOKEN}";
const INPUT_MARK = "__AIQA_INPUT__";
const TURNS_MARK = "__AIQA_TURNS__";
const QUESTION_KEYS = ["query", "question", "message", "prompt", "input", "text", "q", "content"];

interface Found {
  /** Replace the parent array of messages by {{turns}}. */
  turns: boolean;
  set: (value: unknown) => void;
}

function isMessageList(value: unknown): value is { role: unknown; content: unknown }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === "object" && entry !== null && "role" in entry && "content" in entry,
    )
  );
}

/** Finds the field that holds the question, exact match first, then usual field names. */
function findQuestion(root: unknown, question: string | undefined): Found | undefined {
  const candidates: { found: Found; score: number }[] = [];
  const visit = (
    value: unknown,
    key: string,
    set: (v: unknown) => void,
    inMessages: boolean,
    setList?: (v: unknown) => void,
  ): void => {
    if (typeof value === "string") {
      const wanted = question?.trim();
      const exact = wanted !== undefined && value.trim() === wanted;
      const contains = wanted !== undefined && !exact && value.includes(wanted);
      const usual = question === undefined && QUESTION_KEYS.includes(key.toLowerCase());
      if (exact || contains || usual) {
        const score = (exact ? 100 : contains ? 50 : 10) + (inMessages ? 5 : 0);
        candidates.push({
          found:
            inMessages && setList !== undefined
              ? { turns: true, set: setList }
              : { turns: false, set },
          score,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      const list = isMessageList(value);
      value.forEach((entry, index) => {
        visit(
          entry,
          key,
          (v) => {
            value[index] = v;
          },
          list || inMessages,
          list ? set : setList,
        );
      });
      return;
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      for (const [name, entry] of Object.entries(record)) {
        visit(
          entry,
          name,
          (v) => {
            record[name] = v;
          },
          inMessages,
          setList,
        );
      }
    }
  };
  visit(root, "", () => undefined, false);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.found;
}

const PREFERRED = ["answer", "reply", "content", "text", "message", "output", "response", "result"];
const SKIPPED = new Set([
  "id",
  "model",
  "role",
  "status",
  "type",
  "url",
  "object",
  "finish_reason",
]);

function pathOf(segments: readonly (string | number)[]): string {
  return (
    "$" +
    segments
      .map((segment) =>
        typeof segment === "number"
          ? `[${String(segment)}]`
          : /^[A-Za-z_$][\w$-]*$/.test(segment)
            ? `.${segment}`
            : `['${segment}']`,
      )
      .join("")
  );
}

/**
 * Candidates for responsePath in a sample answer: text fields ranked by name and length,
 * best first (issue #81).
 */
export function suggestResponsePaths(payload: unknown): { path: string; excerpt: string }[] {
  const found: { path: string; excerpt: string; score: number }[] = [];
  const visit = (value: unknown, segments: (string | number)[], depth: number): void => {
    if (depth > 6) return;
    if (typeof value === "string") {
      const key = segments.findLast((segment) => typeof segment === "string") ?? "";
      if (SKIPPED.has(key.toLowerCase()) || value.trim().length < 2) return;
      const preferred = PREFERRED.indexOf(key.toLowerCase());
      const score = (preferred === -1 ? 0 : 1000 - preferred * 10) + Math.min(value.length, 500);
      found.push({
        path: pathOf(segments),
        excerpt: value.length > 60 ? `${value.slice(0, 60)}...` : value,
        score,
      });
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 3).forEach((entry, index) => {
        visit(entry, [...segments, index], depth + 1);
      });
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, [...segments, name], depth + 1);
      }
    }
  };
  visit(payload, [], 0);
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ path, excerpt }) => ({ path, excerpt }));
}

export interface DraftOptions {
  /** The question as typed in the interface; found in the body and replaced by {{input}}. */
  question?: string;
  /** Name of the target; from the host when missing. */
  name?: string;
  /** A sample answer of the target for the response path. */
  response?: unknown;
}

export interface TargetDraft {
  target: TargetConfigInput;
  /** What the human should know or check, never a secret. */
  notes: string[];
}

/**
 * A draft of the target block from a copied request (issue #81). Tokens, keys and cookies never
 * end up in the draft: auth refers to ${AIQA_TARGET_TOKEN}, the notes say what to fill in.
 */
export function draftTarget(request: CurlRequest, options: DraftOptions): TargetDraft {
  const notes: string[] = [];
  if (request.body === undefined) {
    throw new CurlImportError(
      "Der Aufruf hat keinen Body. Fragen in der URL unterstützt der Import nicht, die Vorlage bitte von Hand anlegen.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    throw new CurlImportError("Der Body ist kein JSON. Die Vorlage bitte von Hand anlegen.");
  }
  const found = findQuestion(parsed, options.question);
  if (found === undefined) {
    throw new CurlImportError(
      options.question === undefined
        ? "Die Frage ist im Body nicht zu finden. Gib sie mit --question genau so an, wie du sie gestellt hast."
        : `Die Frage "${options.question}" steht nicht im Body. Gib sie genau so an, wie du sie gestellt hast.`,
    );
  }
  found.set(found.turns ? TURNS_MARK : INPUT_MARK);
  const body = JSON.stringify(parsed)
    .replace(`"${INPUT_MARK}"`, '"{{input}}"')
    .replace(`"${TURNS_MARK}"`, "{{turns}}");
  if (found.turns) {
    notes.push(
      "Der Verlauf geht als {{turns}} mit. Systemnachrichten der Oberfläche fehlen darin, prüfe, ob das Zielsystem sie braucht.",
    );
  }

  let auth: TargetConfigInput["auth"] = { type: "none" };
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    if (NOISE.has(name) || name.startsWith("sec-")) continue;
    const secret = SECRET_NAMES.has(name) || looksSecret(value);
    if (!secret) {
      headers[name] = value;
      continue;
    }
    if (auth.type !== "none") {
      notes.push(
        `Header ${name} sieht nach Zugangsdaten aus und ist weggelassen. Braucht das Zielsystem ihn, trage ihn von Hand ein.`,
      );
      continue;
    }
    if (name === "authorization" && /^bearer\s/i.test(value)) {
      auth = { type: "bearer", token: TOKEN_REF };
      notes.push(
        "Das Bearer-Token ist entfernt. Trage den Wert in die .env als AIQA_TARGET_TOKEN ein.",
      );
      if (/^bearer\s+eyJ/i.test(value)) {
        notes.push(
          "Das Token ist ein JWT und läuft vermutlich bald ab. Mit Login über E-Mail und Passwort passt auth token besser (README, Auth mit Token).",
        );
      }
    } else if (name === "authorization" && /^basic\s/i.test(value)) {
      auth = {
        type: "basic",
        username: "${AIQA_TARGET_USER}",
        password: "${AIQA_TARGET_PASSWORD}",
      };
      notes.push(
        "Basic-Zugangsdaten sind entfernt. Trage AIQA_TARGET_USER und AIQA_TARGET_PASSWORD in die .env ein.",
      );
    } else {
      auth = { type: "header", name, value: TOKEN_REF };
      notes.push(
        `Der Wert von ${name} ist entfernt. Trage ihn in die .env als AIQA_TARGET_TOKEN ein.`,
      );
    }
  }
  if (request.cookies !== undefined) {
    notes.push(
      "Cookies sind weggelassen. Braucht das Zielsystem eine Sitzung per Cookie, nutze session mit mode cookie.",
    );
  }

  let responsePath = "$.answer";
  if (options.response === undefined) {
    notes.push("Antwortpfad geraten ($.answer). Prüfe ihn mit --response oder --call.");
  } else {
    const candidates = suggestResponsePaths(options.response);
    const best = candidates[0];
    if (best === undefined) {
      notes.push("In der Antwort ist kein Text zu finden. Antwortpfad bitte von Hand setzen.");
    } else {
      responsePath = best.path;
      const others = candidates.slice(1, 3).map((candidate) => candidate.path);
      if (others.length > 0)
        notes.push(`Weitere Kandidaten für den Antwortpfad: ${others.join(", ")}.`);
    }
  }
  notes.push(
    "Sitzungen erkennt der Import nicht. Führt das Zielsystem Gespräche über eine Sitzungs-ID, ergänze session.",
  );

  const host = new URL(request.url).hostname.replace(/[^A-Za-z0-9.-]/g, "-");
  return {
    target: {
      name: options.name ?? host,
      adapter: "http",
      endpoint: request.url,
      auth,
      request: {
        method: request.method as "POST" | "GET" | "PUT" | "PATCH",
        headers,
        body,
        responsePath,
      },
    },
    notes,
  };
}
