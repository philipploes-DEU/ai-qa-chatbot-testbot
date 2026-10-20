import { type Check, checkResult } from "./check.js";

const name = "status";

/**
 * expected.status (issue #79): the answer must carry this HTTP status. A matching error status
 * never reaches the checks; the runner passes it on its own. Here a different status fails, for
 * example 200 with content where 403 was expected.
 */
export const statusCheck: Check = {
  name,
  run(testCase, response) {
    const expected = testCase.expected.status;
    if (expected === undefined) return null;
    if (response.status === undefined) {
      return checkResult(
        name,
        false,
        `erwartet ${String(expected)}, der Adapter meldet keinen Status`,
      );
    }
    if (response.status === expected) {
      return checkResult(name, true, `Status ${String(expected)} wie erwartet`);
    }
    return checkResult(
      name,
      false,
      `erwartet ${String(expected)}, erhalten ${String(response.status)}`,
    );
  },
};
