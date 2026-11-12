import type { TargetResponse } from "../adapters/target.js";
import type { Tokens, Turn } from "../domain/common.js";
import type { Round } from "../domain/iteration.js";
import type { TestCase } from "../domain/test-case.js";
import {
  addUsage,
  type CallUsage,
  NO_USAGE,
  ONE_UNREPORTED_CALL,
  usageOfError,
  withUsage,
} from "../providers/usage.js";
import type { Judge, JudgeOutcome, JudgeVerdict } from "./judge.js";
import type { SourceDocument } from "./sources.js";

export interface JudgedIteration {
  verdicts: JudgeVerdict[];
  tokens: Tokens;
  /** Judge calls that reported no tokens (issue #125). */
  unreportedCalls: number;
  pass: boolean;
}

function usageOf(outcome: JudgeOutcome): CallUsage {
  return {
    tokens: outcome.tokens ?? { input: 0, output: 0 },
    unreportedCalls: outcome.unreportedCalls,
  };
}

/** Reference answers from the script: the assistant turn that follows each user turn. */
export function scriptedReferences(testCase: TestCase): (string | undefined)[] {
  if (typeof testCase.input === "string") return [];
  const references: (string | undefined)[] = [];
  for (const turn of testCase.input) {
    if (turn.role === "user") references.push(undefined);
    else if (turn.role === "assistant" && references.length > 0) {
      references[references.length - 1] = turn.content;
    }
  }
  return references;
}

/** The user turn of a round, with the follow-up call it made (issue #84). */
function requestOf(round: Round): Turn {
  if (round.followUp === undefined) return round.request;
  return {
    ...round.request,
    content: `${round.request.content}\n(Folgeaufruf: ${round.followUp})`,
  };
}

/** The conversation as it happened: scripted user turns and the target's answers. */
export function transcriptOf(rounds: readonly Round[]): Turn[] {
  const transcript: Turn[] = [];
  for (const round of rounds) {
    transcript.push(requestOf(round));
    if (round.response !== null) transcript.push({ role: "assistant", content: round.response });
  }
  return transcript;
}

/**
 * Judges one iteration the way the runner and `aiqa judge` share it. A single answer gets one
 * verdict against the case. In a dialog the last round is judged against the rubric and the
 * reference answer of the case; an earlier round only when the script has an answer for it,
 * then against that answer with the round criterion (issue #69). One more verdict rates the
 * whole conversation against the fixed dialog criteria (issue #12). Round criteria carry the
 * round in their name. Source documents of the goldset go into every rating of an answer
 * (issue #70), not into the verdict on the whole conversation.
 */
export async function judgeIteration(
  judge: Judge,
  testCase: TestCase,
  final: TargetResponse,
  rounds?: readonly Round[],
  sources: readonly SourceDocument[] = [],
): Promise<JudgedIteration> {
  const verdicts: JudgeVerdict[] = [];
  let usage: CallUsage = NO_USAGE;
  // One rating. A failure leaves with what the ratings before it cost plus its own share, so
  // the budget of a run sees the whole iteration (issue #125).
  const rate = async (call: () => Promise<JudgeOutcome>): Promise<JudgeOutcome> => {
    try {
      const outcome = await call();
      usage = addUsage(usage, usageOf(outcome));
      return outcome;
    } catch (error) {
      throw withUsage(error, addUsage(usage, usageOfError(error) ?? ONE_UNREPORTED_CALL));
    }
  };

  if (rounds === undefined || rounds.length === 0) {
    const outcome = await rate(() => judge.judge(testCase, final, sources));
    return {
      verdicts: [outcome.verdict],
      tokens: usage.tokens,
      unreportedCalls: usage.unreportedCalls,
      pass: outcome.verdict.pass,
    };
  }

  const references = scriptedReferences(testCase);
  const lastRound = references.length - 1;
  const history: Turn[] = [];
  for (const [position, round] of rounds.entries()) {
    history.push(requestOf(round));
    if (round.response === null) break;
    const response = round.response;
    const reference = references[position];
    let outcome: JudgeOutcome | undefined;
    if (position === lastRound) {
      if (judge.applies(testCase)) {
        outcome = await rate(() => judge.judgeLastRound(testCase, history, response, sources));
      }
    } else if (reference !== undefined) {
      outcome = await rate(() => judge.judgeRound(testCase, history, response, reference, sources));
    }
    if (outcome !== undefined) {
      verdicts.push({
        ...outcome.verdict,
        round: position + 1,
        criteria: outcome.verdict.criteria.map((criterion) => ({
          ...criterion,
          name: `Runde ${String(position + 1)}: ${criterion.name}`,
        })),
        reasoning: `Runde ${String(position + 1)}: ${outcome.verdict.reasoning}`,
      });
    }
    history.push({ role: "assistant", content: response });
  }

  const whole = await rate(() => judge.judgeDialog(testCase, transcriptOf(rounds)));
  verdicts.push(whole.verdict);

  return {
    verdicts,
    tokens: usage.tokens,
    unreportedCalls: usage.unreportedCalls,
    pass: verdicts.every((verdict) => verdict.pass),
  };
}
