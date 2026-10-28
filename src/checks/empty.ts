import { type Check, checkResult } from "./check.js";

const name = "empty";

/** Whether an answer holds nothing but whitespace (issue #113). */
export function isEmptyAnswer(content: string): boolean {
  return content.trim() === "";
}

/**
 * Applies to every case (issue #113): an empty answer fails, because a case that only forbids
 * things would pass by silence. A case allows it with expected.allowEmpty, and a case that
 * expects an HTTP status judges the status, not the text.
 */
export const emptyCheck: Check = {
  name,
  run(testCase, response) {
    if (testCase.expected.allowEmpty || testCase.expected.status !== undefined) return null;
    if (isEmptyAnswer(response.content)) return checkResult(name, false, "leere Antwort");
    return checkResult(name, true, "Antwort hat Inhalt");
  },
};
