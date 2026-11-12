import {
  evaluateJsonCondition,
  JSON_CRITERION_PREFIX,
  jsonConditionLabel,
} from "../domain/json-condition.js";
import type { Check, CheckResult } from "./check.js";
import { extractJsonText } from "./text.js";

const name = "json";

/**
 * The answer, parsed as JSON, must meet the conditions in expected.json (issue #120, ADR 0025).
 * Every condition is a criterion of its own, so the report gives it its own pass rate. An
 * answer that is not JSON fails every condition.
 */
export const jsonCheck: Check = {
  name,
  run(testCase, response) {
    const conditions = testCase.expected.json;
    if (conditions.length === 0) return null;

    let data: unknown;
    let readable = true;
    try {
      data = JSON.parse(extractJsonText(response.content));
    } catch {
      readable = false;
    }

    const criteria = conditions.map((condition) => {
      const label = jsonConditionLabel(condition);
      const outcome = readable
        ? evaluateJsonCondition(condition, data)
        : { pass: false, reason: "Antwort ist kein gültiges JSON" };
      return { label, name: `${JSON_CRITERION_PREFIX}${label}`, ...outcome };
    });
    const failed = criteria.filter((criterion) => !criterion.pass);
    const total = String(criteria.length);
    const result: CheckResult = {
      source: "check",
      pass: failed.length === 0,
      criteria: criteria.map(({ label: _label, ...criterion }) => criterion),
      reasoning:
        failed.length === 0
          ? `${name}: alle ${total} Bedingungen erfüllt`
          : `${name}: ${String(failed.length)} von ${total} Bedingungen verletzt: ${failed.map((criterion) => criterion.label).join(", ")}`,
    };
    return result;
  },
};
