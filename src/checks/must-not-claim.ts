import type { TestCase } from "../domain/test-case.js";
import { type Check, checkResult, quoteList } from "./check.js";
import { includesIgnoreCase } from "./text.js";

const name = "mustNotClaim";

/** The terms of expected.mustNotClaim that appear in the answer, ignoring case (issue #82). */
export function claimHits(testCase: TestCase, content: string): string[] {
  return testCase.expected.mustNotClaim.filter((term) => includesIgnoreCase(content, term));
}

/**
 * The criterion a mustNotClaim hit fails with when the judge gives no verdict (ADR 0018,
 * issue #83): a tool failure must never produce a pass. undefined without a hit.
 */
export function claimFallback(
  testCase: TestCase,
  content: string,
): { name: string; reason: string } | undefined {
  const hits = claimHits(testCase, content);
  if (hits.length === 0) return undefined;
  return {
    name,
    reason: `kommt vor: ${quoteList(hits)}, ohne Judge-Urteil gewertet wie mustNotContain`,
  };
}

/**
 * expected.mustNotClaim (issue #82): the answer must not state these terms as true. Without a
 * hit the check passes on its own. A hit may be a quote in a refusal, so with a judge the check
 * passes and the judge decides with the criterion nicht-behauptet; without a judge a hit fails
 * like mustNotContain.
 */
export const mustNotClaimCheck: Check = {
  name,
  run(testCase, response, context) {
    if (testCase.expected.mustNotClaim.length === 0) return null;
    const hits = claimHits(testCase, response.content);
    if (hits.length === 0) {
      return checkResult(name, true, "keine der Angaben kommt vor");
    }
    if (context?.judge === true) {
      return checkResult(
        name,
        true,
        `kommt vor: ${quoteList(hits)}, der Judge entscheidet, ob die Antwort sie behauptet`,
      );
    }
    return checkResult(
      name,
      false,
      `kommt vor: ${quoteList(hits)}, ohne Judge nicht entscheidbar und gewertet wie mustNotContain`,
    );
  },
};
