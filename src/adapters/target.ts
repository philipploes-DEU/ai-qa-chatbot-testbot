import type { Tokens, Turn } from "../domain/common.js";

export type { Turn };

/** What a target answered to one request. */
export interface TargetResponse {
  content: string;
  /** Unparsed payload for debugging adapters, never written to reports. */
  raw?: unknown;
  /** The parsed JSON answer, for captures in dialogs (issue #84). Kept in memory only. */
  data?: unknown;
  /** HTTP status of the answer, when the adapter has one (issue #79). */
  status?: number;
  latencyMs: number;
  tokens?: Tokens;
}

/** Extras for one call: a follow-up of a dialog round (issue #84). */
export interface SendOptions {
  /** Top level fields merged into the JSON body of this call. */
  bodyMerge?: Readonly<Record<string, unknown>>;
  /** Values of the case for {{vars.name}} in the request template (issue #80). */
  vars?: Readonly<Record<string, string>>;
}

/**
 * Connects AI QA to one target system. Implementations exist per transport
 * (http, openai-compatible, script, playwright, dummy) and share auth, rate limit
 * and timeout handling (issues #3, #4, #5, #13).
 */
export interface TargetAdapter {
  readonly name: string;
  /** The adapter merges bodyMerge into its request and returns the parsed answer as data. */
  readonly supportsFollowUps?: boolean;
  /** The adapter fills {{vars.name}} from the case (issue #80). */
  readonly supportsVars?: boolean;
  /** Variables the request needs that have no default; every case must set them. */
  requiredVars?(): string[];
  /** Sends the conversation so far and returns the answer to the last user turn. */
  send(turns: readonly Turn[], session?: string, options?: SendOptions): Promise<TargetResponse>;
  /** Optional: targets with server side sessions open one per dialog. */
  startSession?(): Promise<string>;
  endSession?(session: string): Promise<void>;
  /** Optional: releases what the adapter holds, for example a browser. Called after a run. */
  close?(): Promise<void>;
}
