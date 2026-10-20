import { Ajv, type ValidateFunction } from "ajv";

import { type Check, checkResult } from "./check.js";
import { extractJsonText } from "./text.js";

const name = "schema";
const ajv = new Ajv({ strict: false, allErrors: true });
const compiled = new WeakMap<object, ValidateFunction>();

function compile(schema: Record<string, unknown>): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  compiled.set(schema, validate);
  return validate;
}

function describeErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((error) =>
      `${error.instancePath === "" ? "(root)" : error.instancePath} ${error.message ?? ""}`.trim(),
    )
    .join("; ");
}

/** The answer, parsed as JSON, must satisfy the JSON Schema in expected.schema. */
export const schemaCheck: Check = {
  name,
  run(testCase, response) {
    const schema = testCase.expected.schema;
    if (schema === undefined) return null;

    let data: unknown;
    try {
      data = JSON.parse(extractJsonText(response.content));
    } catch {
      return checkResult(name, false, "Antwort ist kein gültiges JSON");
    }

    let validate: ValidateFunction;
    try {
      validate = compile(schema);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return checkResult(name, false, `Schema konnte nicht kompiliert werden: ${message}`);
    }

    if (validate(data)) {
      return checkResult(name, true, "Antwort entspricht dem Schema");
    }
    return checkResult(name, false, `Schema verletzt: ${describeErrors(validate)}`);
  },
};
