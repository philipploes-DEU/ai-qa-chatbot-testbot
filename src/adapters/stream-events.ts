import type { EventSelector, RequestTemplate } from "../domain/target-config.js";
import { excerpt } from "./errors.js";
import { extractPath, readPath } from "./response-path.js";

/** A streamed answer could not be read or holds no event the template asks for. */
export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamError";
  }
}

/**
 * One Server-Sent Event: `data` parsed as JSON when it is JSON, else the text, with the event
 * name and id when the target sent them. Paths in the template start at this object, for
 * example $.data.type or $.event.
 */
export interface SseEvent {
  event?: string;
  id?: string;
  data: unknown;
}

/** Reads NDJSON (one JSON value per line, ADR 0024). Empty lines are skipped. */
export function parseNdjson(text: string): unknown[] {
  const events: unknown[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new StreamError(
        `Antwort ist kein NDJSON, Zeile ${String(index + 1)} ist kein JSON: ${excerpt(line)}`,
      );
    }
  });
  return events;
}

function parseData(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Reads Server-Sent Events (ADR 0024): events end with an empty line, several data lines are
 * joined with a newline, comments and unknown fields are ignored, `data: [DONE]` is the end
 * marker of OpenAI style streams and becomes no event.
 */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];
  const flush = (): void => {
    if (data.length > 0) {
      const joined = data.join("\n");
      if (joined !== "[DONE]") {
        events.push({
          ...(event === undefined ? {} : { event }),
          ...(id === undefined ? {} : { id }),
          data: parseData(joined),
        });
      }
    }
    event = undefined;
    id = undefined;
    data = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
  }
  flush();
  return events;
}

/** Whether the value at the selector's path equals its value; non-strings compare as JSON. */
export function matchesEvent(event: unknown, selector: EventSelector): boolean {
  const value = readPath(event, selector.path);
  if (value === undefined) return false;
  return (typeof value === "string" ? value : JSON.stringify(value)) === selector.equals;
}

/** The events a selector picks, all of them without a selector. */
export function selectEvents(
  events: readonly unknown[],
  selector: EventSelector | undefined,
): unknown[] {
  return selector === undefined ? [...events] : events.filter((e) => matchesEvent(e, selector));
}

function selectorOf(event: RequestTemplate["responseEvent"]): EventSelector | undefined {
  return event?.path !== undefined && event.equals !== undefined
    ? { path: event.path, equals: event.equals }
    : undefined;
}

export interface StreamAnswer {
  content: string;
  /** The last selected event: what captures and a body session read from. */
  event: unknown;
}

/**
 * The answer text of a stream by the rules of the request template (ADR 0024): the last event
 * the filter selects, read at responsePath, or the text at concat joined over every selected
 * event. Events without the concat path are skipped; none with it is an error.
 */
export function streamAnswer(
  events: readonly unknown[],
  request: Pick<RequestTemplate, "responseEvent" | "responsePath">,
): StreamAnswer {
  if (events.length === 0) throw new StreamError("die Antwort enthält kein Ereignis");
  const selector = selectorOf(request.responseEvent);
  const selected = selectEvents(events, selector);
  if (selected.length === 0) {
    throw new StreamError(
      `kein Ereignis passt zu responseEvent (${selector?.path ?? ""} = ${selector?.equals ?? ""}) in ${String(events.length)} Ereignissen: ${excerpt(JSON.stringify(events))}`,
    );
  }
  const last = selected[selected.length - 1];
  const concat = request.responseEvent?.concat;
  if (concat !== undefined) {
    const parts = selected.flatMap((event) => {
      const value = readPath(event, concat);
      return value === undefined ? [] : [typeof value === "string" ? value : JSON.stringify(value)];
    });
    if (parts.length === 0) {
      throw new StreamError(
        `concat ${concat} fehlt in allen ${String(selected.length)} gewählten Ereignissen: ${excerpt(JSON.stringify(selected))}`,
      );
    }
    return { content: parts.join(""), event: last };
  }
  if (request.responsePath === undefined) {
    throw new StreamError("responsePath fehlt im Request-Template");
  }
  return { content: extractPath(last, request.responsePath), event: last };
}
