/** Length of the response excerpt kept in error messages and iteration logs. */
export const EXCERPT_LENGTH = 200;

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}...` : flat;
}

/** A non-2xx answer of the target. The message is what the iteration records as error. */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly bodyExcerpt: string,
    /** Parsed Retry-After header in milliseconds, when the target sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(bodyExcerpt === "" ? `http ${String(status)}` : `http ${String(status)}: ${bodyExcerpt}`);
    this.name = "HttpStatusError";
  }
}

export type TimeoutScope = "request" | "dialog";

/**
 * AI QA gave up waiting. `request` is one attempt (timeouts.requestMs), `dialog` is one call of
 * the adapter including retries and waits (timeouts.dialogMs). Both count as technical errors.
 */
export class TimeoutError extends Error {
  constructor(
    readonly ms: number,
    readonly scope: TimeoutScope,
  ) {
    super(
      scope === "request"
        ? `keine Antwort innerhalb von ${String(ms)} ms`
        : `Dialog nicht innerhalb von ${String(ms)} ms abgeschlossen`,
    );
    this.name = "TimeoutError";
  }
}

/** The target could not be reached at all (connection refused, DNS, TLS). */
export class ConnectionError extends Error {
  constructor(reason: string) {
    super(`Verbindung fehlgeschlagen: ${reason}`);
    this.name = "ConnectionError";
  }
}

/**
 * Every further call to the target is pointless, for example because no token can be obtained
 * (issue #73). The runner stops the run with this message instead of recording an error per
 * iteration.
 */
export class FatalTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalTargetError";
  }
}

/** fetch was aborted by its signal, usually AbortSignal.timeout. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** The most specific reason of a failed fetch: undici puts it into the cause. */
export function causeMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message !== "") return cause.message;
  return error.message;
}
