import { type Check, checkResult, quoteList } from "./check.js";
import { includesIgnoreCase } from "./text.js";

const name = "mustNotContain";

/** No phrase in expected.mustNotContain may appear in the answer, ignoring case. */
export const mustNotContainCheck: Check = {
  name,
  run(testCase, response) {
    const phrases = testCase.expected.mustNotContain;
    if (phrases.length === 0) return null;
    const present = phrases.filter((phrase) => includesIgnoreCase(response.content, phrase));
    if (present.length === 0) {
      return checkResult(name, true, "kein verbotener Begriff enthalten");
    }
    return checkResult(name, false, `verbotene Begriffe enthalten: ${quoteList(present)}`);
  },
};
