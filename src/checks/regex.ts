import { type Check, checkResult, quoteList } from "./check.js";

/** Patterns are validated when the goldset is parsed, so compiling here cannot fail. */
function matches(pattern: string, content: string): boolean {
  return new RegExp(pattern).test(content);
}

/** Every pattern in expected.mustMatch must match the answer. */
export const mustMatchCheck: Check = {
  name: "mustMatch",
  run(testCase, response) {
    const patterns = testCase.expected.mustMatch;
    if (patterns.length === 0) return null;
    const unmatched = patterns.filter((pattern) => !matches(pattern, response.content));
    if (unmatched.length === 0) {
      return checkResult("mustMatch", true, `alle ${String(patterns.length)} Muster treffen zu`);
    }
    return checkResult("mustMatch", false, `Muster ohne Treffer: ${quoteList(unmatched)}`);
  },
};

/** No pattern in expected.mustNotMatch may match the answer. */
export const mustNotMatchCheck: Check = {
  name: "mustNotMatch",
  run(testCase, response) {
    const patterns = testCase.expected.mustNotMatch;
    if (patterns.length === 0) return null;
    const matched = patterns.filter((pattern) => matches(pattern, response.content));
    if (matched.length === 0) {
      return checkResult("mustNotMatch", true, "kein verbotenes Muster trifft zu");
    }
    return checkResult("mustNotMatch", false, `verbotene Muster treffen zu: ${quoteList(matched)}`);
  },
};
