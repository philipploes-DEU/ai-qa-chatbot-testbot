import { readPath } from "../adapters/response-path.js";
import { parseNdjson, parseSse, StreamError } from "../adapters/stream-events.js";
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
  "event",
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

/** A sample answer that arrived as a stream: its events as the http adapter sees them. */
export interface StreamSample {
  format: "ndjson" | "sse";
  events: readonly unknown[];
}

export type SampleAnswer = { format: "json"; payload: unknown } | StreamSample;

const STREAM_TYPES: readonly { match: RegExp; format: StreamSample["format"] }[] = [
  { match: /text\/event-stream/i, format: "sse" },
  { match: /ndjson|jsonl|json-seq|jsonlines/i, format: "ndjson" },
];

function parseStream(text: string, format: StreamSample["format"]): StreamSample {
  try {
    const events = format === "sse" ? parseSse(text) : parseNdjson(text);
    if (events.length === 0) {
      throw new CurlImportError(
        "Die Antwort enthält kein Ereignis. Antwortformat und Ereignisfilter bitte von Hand setzen.",
      );
    }
    return { format, events };
  } catch (error) {
    if (error instanceof StreamError) throw new CurlImportError(error.message);
    throw error;
  }
}

/**
 * Reads a sample answer as JSON, NDJSON or Server-Sent Events (issue #106): by the content
 * type when one is known, else by its shape.
 */
export function parseSampleAnswer(text: string, contentType?: string): SampleAnswer {
  const known = STREAM_TYPES.find((entry) => entry.match.test(contentType ?? ""));
  if (known !== undefined) return parseStream(text, known.format);
  try {
    return { format: "json", payload: JSON.parse(text) as unknown };
  } catch {
    // Not one JSON document; maybe several lines or events.
  }
  if (/^data:/m.test(text)) return parseStream(text, "sse");
  try {
    return parseStream(text, "ndjson");
  } catch {
    throw new CurlImportError(
      "Die Antwort ist weder JSON noch NDJSON noch Server-Sent Events. Der Adapter http braucht eines davon.",
    );
  }
}

export interface StreamSuggestion {
  responseEvent?: { path?: string; equals?: string; concat?: string };
  responsePath?: string;
  /** What the human should check, never a secret. */
  notes: string[];
}

const DISCRIMINATOR_KEYS = ["type", "event", "kind", "name", "status", "object"];
const SESSION_KEY = /thread|session|conversation/i;

function stringAt(event: unknown, path: string): string | undefined {
  const value = readPath(event, path);
  return typeof value === "string" ? value : undefined;
}

/** A path whose string value every event has, so it tells the events apart. */
function discriminatorOf(sample: StreamSample): string | undefined {
  const prefix = sample.format === "sse" ? "$.data." : "$.";
  const candidates = [
    ...(sample.format === "sse" ? ["$.event"] : []),
    ...DISCRIMINATOR_KEYS.map((key) => `${prefix}${key}`),
  ];
  return candidates.find((path) =>
    sample.events.every((event) => stringAt(event, path) !== undefined),
  );
}

/** The best text path of the first event that every event of the group has as a string. */
function sharedTextPath(events: readonly unknown[]): string | undefined {
  const first = events[0];
  if (first === undefined) return undefined;
  return suggestResponsePaths(first)
    .map((candidate) => candidate.path)
    .find((path) => events.every((event) => stringAt(event, path) !== undefined));
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** A note about an event that carries a thread or session id, for session.event (ADR 0024). */
function sessionNote(sample: StreamSample, path: string, answerValue: string): string[] {
  const prefix = sample.format === "sse" ? "$.data." : "$.";
  for (const event of sample.events) {
    const value = stringAt(event, path);
    if (value === undefined || value === answerValue) continue;
    const record = sample.format === "sse" ? readPath(event, "$.data") : event;
    if (typeof record !== "object" || record === null) continue;
    const key = Object.keys(record as Record<string, unknown>).find(
      (name) =>
        SESSION_KEY.test(name) && typeof (record as Record<string, unknown>)[name] === "string",
    );
    if (key === undefined) continue;
    return [
      `Das Ereignis ${path} = ${value} enthält ${prefix}${key}, vermutlich die Sitzung. Führt das Zielsystem Gespräche damit, ergänze session mit mode: body, key: ${prefix}${key}, event: { path: ${path}, equals: ${value} } und {{session}} im Body.`,
    ];
  }
  return [];
}

/**
 * Format, event filter and text path for a streamed sample answer (issue #106): the last event
 * when its kind appears once and carries text, else the text joined over the most common kind.
 */
export function suggestStream(sample: StreamSample): StreamSuggestion {
  const { events } = sample;
  const fallback: StreamSuggestion = {
    responsePath: "$.answer",
    notes: [
      "Im Stream ist kein Text zu finden. Ereignisfilter (responseEvent) und Antwortpfad bitte von Hand setzen, siehe README, Adapter http, gestreamte Antworten.",
    ],
  };
  const last = events[events.length - 1];
  if (last === undefined) return fallback;
  const lastText = suggestResponsePaths(last)[0]?.path;
  const path = discriminatorOf(sample);
  if (path === undefined) {
    if (events.length === 1 && lastText !== undefined) {
      return { responsePath: lastText, notes: [] };
    }
    const shared = sharedTextPath(events);
    if (shared !== undefined) {
      return {
        responseEvent: { concat: shared },
        notes: [
          `Der Text wird aus allen ${String(events.length)} Ereignissen bei ${shared} zusammengesetzt.`,
        ],
      };
    }
    return lastText === undefined
      ? fallback
      : { responsePath: lastText, notes: ["Gelesen wird das letzte Ereignis des Streams."] };
  }
  const values = events.map((event) => stringAt(event, path) ?? "");
  const lastValue = values[values.length - 1] ?? "";
  if (values.filter((value) => value === lastValue).length === 1 && lastText !== undefined) {
    return {
      responseEvent: { path, equals: lastValue },
      responsePath: lastText,
      notes: [
        `Die Antwort steht im Ereignis ${path} = ${lastValue} bei ${lastText}.`,
        ...sessionNote(sample, path, lastValue),
      ],
    };
  }
  const common = mostCommon(values);
  const group = events.filter((_, index) => values[index] === common);
  const shared = sharedTextPath(group);
  if (shared !== undefined && group.length > 1) {
    return {
      responseEvent: { path, equals: common, concat: shared },
      notes: [
        `Der Text wird aus den ${String(group.length)} Ereignissen ${path} = ${common} bei ${shared} zusammengesetzt.`,
        ...sessionNote(sample, path, common),
      ],
    };
  }
  if (lastText !== undefined) {
    return {
      responseEvent: { path, equals: lastValue },
      responsePath: lastText,
      notes: [`Gelesen wird das letzte Ereignis ${path} = ${lastValue} bei ${lastText}.`],
    };
  }
  return fallback;
}

export interface DraftOptions {
  /** The question as typed in the interface; found in the body and replaced by {{input}}. */
  question?: string;
  /** Name of the target; from the host when missing. */
  name?: string;
  /** A sample answer of the target for the response path. */
  response?: unknown;
  /** A sample answer that arrived as a stream; wins over response (issue #106). */
  stream?: StreamSample;
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

  let responsePath: string | undefined = "$.answer";
  let stream: Pick<StreamSuggestion, "responseEvent"> & {
    responseFormat?: StreamSample["format"];
  } = {};
  if (options.stream !== undefined) {
    const suggestion = suggestStream(options.stream);
    stream = {
      responseFormat: options.stream.format,
      ...(suggestion.responseEvent === undefined
        ? {}
        : { responseEvent: suggestion.responseEvent }),
    };
    responsePath = suggestion.responsePath;
    notes.push(
      `Die Antwort kommt als ${options.stream.format === "sse" ? "Server-Sent Events" : "NDJSON"} mit ${String(options.stream.events.length)} Ereignissen.`,
      ...suggestion.notes,
    );
  } else if (options.response === undefined) {
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
        ...stream,
        ...(responsePath === undefined ? {} : { responsePath }),
      },
    },
    notes,
  };
}
