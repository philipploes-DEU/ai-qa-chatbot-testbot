import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadDocument, parseDocument, readYamlFile, ValidationError } from "./yaml.js";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "validate");

describe("readYamlFile", () => {
  it("parses a YAML file into plain data", async () => {
    const data = await readYamlFile(path.join(fixtures, "unknown.yaml"));
    expect(data).toEqual({ foo: "bar" });
  });

  it("names the file when the YAML is broken", async () => {
    await expect(readYamlFile(path.join(fixtures, "broken.yaml"))).rejects.toThrow(/broken\.yaml/);
  });

  it("names the file when it does not exist", async () => {
    await expect(readYamlFile(path.join(fixtures, "fehlt.yaml"))).rejects.toThrow(/fehlt\.yaml/);
  });
});

describe("parseDocument", () => {
  const schema = z.strictObject({ id: z.string().min(1), count: z.number().int() });

  it("returns typed data for valid input", () => {
    expect(parseDocument(schema, { id: "a", count: 1 }, "x.yaml")).toEqual({ id: "a", count: 1 });
  });

  it("throws a ValidationError with one line per issue", () => {
    let caught: unknown;
    try {
      parseDocument(schema, { id: "", count: "viele" }, "x.yaml");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const error = caught as ValidationError;
    expect(error.source).toBe("x.yaml");
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toMatch(/^id: /);
    expect(error.issues[1]).toMatch(/^count: /);
    expect(error.message).toContain("x.yaml");
  });
});

describe("loadDocument", () => {
  it("reads and validates in one step", async () => {
    const schema = z.object({ foo: z.string() });
    const data = await loadDocument(schema, path.join(fixtures, "unknown.yaml"));
    expect(data.foo).toBe("bar");
  });
});
