import type { Tokens } from "../domain/common.js";

/**
 * What calls to a model cost as far as it is known (issue #125, ADR 0027): the tokens the API
 * reported, and how many calls reported none. The second number is what a token budget cannot
 * see.
 */
export interface CallUsage {
  tokens: Tokens;
  /** Calls that reported no tokens: no usage in the answer, or no answer at all. */
  unreportedCalls: number;
}

export const NO_USAGE: CallUsage = { tokens: { input: 0, output: 0 }, unreportedCalls: 0 };

/** One call nobody reported tokens for, the assumption for an error without a record. */
export const ONE_UNREPORTED_CALL: CallUsage = {
  tokens: { input: 0, output: 0 },
  unreportedCalls: 1,
};

export function addUsage(sum: CallUsage, usage: CallUsage): CallUsage {
  return {
    tokens: {
      input: sum.tokens.input + usage.tokens.input,
      output: sum.tokens.output + usage.tokens.output,
    },
    unreportedCalls: sum.unreportedCalls + usage.unreportedCalls,
  };
}

// Kept beside the error instead of in it: providers pass on errors of other layers, such as an
// HTTP status or a timeout, and those keep their class and their message.
const usageByError = new WeakMap<object, CallUsage>();

/** Records what the calls behind a failure cost. A later record replaces an earlier one. */
export function withUsage<E>(error: E, usage: CallUsage): E {
  if (typeof error === "object" && error !== null) usageByError.set(error, usage);
  return error;
}

/** What the calls behind a failure cost, undefined when nobody recorded it. */
export function usageOfError(error: unknown): CallUsage | undefined {
  return typeof error === "object" && error !== null ? usageByError.get(error) : undefined;
}
