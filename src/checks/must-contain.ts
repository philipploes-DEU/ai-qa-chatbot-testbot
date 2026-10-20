import { type Check, checkResult, quoteList } from "./check.js";
import { includesIgnoreCase } from "./text.js";

const name = "mustContain";

/** Every phrase in expected.mustContain must appear in the answer, ignoring case. */
export const mustContainCheck: Check = {
  name,
  run(testCase, response) {
    const phrases = testCase.expected.mustContain;
    if (phrases.length === 0) return null;
    const missing = phrases.filter((phrase) => !includesIgnoreCase(response.content, phrase));
    if (missing.length === 0) {
      return checkResult(name, true, `alle ${String(phrases.length)} Pflichtbegriffe enthalten`);
    }
    return checkResult(name, false, `fehlt: ${quoteList(missing)}`);
  },
};
