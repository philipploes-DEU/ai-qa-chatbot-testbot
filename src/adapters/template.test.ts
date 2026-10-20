import { describe, expect, it } from "vitest";

import {
  MissingVariableError,
  renderTemplate,
  templateVars,
  UnknownPlaceholderError,
} from "./template.js";

const turns = [
  { role: "user" as const, content: 'Sag "Hallo"' },
  { role: "assistant" as const, content: "Hallo" },
  { role: "user" as const, content: "Zeile 1\nZeile 2" },
];

describe("renderTemplate", () => {
  it("renders input and session as JSON string content without quotes", () => {
    const body = renderTemplate('{"message": "{{input}}", "session": "{{session}}"}', {
      input: 'Zeile 1\nZeile 2 mit "Zitat" und \\ Backslash',
      session: "abc-123",
      turns,
    });
    expect(JSON.parse(body)).toEqual({
      message: 'Zeile 1\nZeile 2 mit "Zitat" und \\ Backslash',
      session: "abc-123",
    });
  });

  it("renders {{vars.name}} like input: escaped in the body, as is in headers", () => {
    const values = { input: "x", session: "", turns, vars: { mandate: 'm-"b"' } };
    expect(JSON.parse(renderTemplate('{"mandateId": "{{vars.mandate}}"}', values))).toEqual({
      mandateId: 'm-"b"',
    });
    expect(renderTemplate("{{ vars.mandate }}", values, "raw")).toBe('m-"b"');
  });

  it("fails with the name when a variable has no value", () => {
    expect(() =>
      renderTemplate('{"m": "{{vars.mandate}}"}', { input: "x", session: "", turns }),
    ).toThrow(MissingVariableError);
    expect(() =>
      renderTemplate('{"m": "{{vars.mandate}}"}', { input: "x", session: "", turns, vars: {} }),
    ).toThrow(/vars\.mandate/);
  });

  it("lists the variables a template uses", () => {
    expect(templateVars('{"a": "{{vars.mandate}}", "b": "{{input}}", "c": "{{vars.k}}"}')).toEqual([
      "mandate",
      "k",
    ]);
  });

  it("renders turns as a JSON array", () => {
    const body = renderTemplate('{"messages": {{turns}}}', { input: "x", session: "", turns });
    expect(JSON.parse(body)).toEqual({ messages: turns });
  });

  it("renders an empty session as empty string", () => {
    expect(renderTemplate('"{{session}}"', { input: "", session: "", turns: [] })).toBe('""');
  });

  it("replaces every occurrence and tolerates spaces inside the braces", () => {
    expect(
      renderTemplate("{{ input }} und {{input}}", { input: "a", session: "", turns: [] }),
    ).toBe("a und a");
  });

  it("rejects unknown placeholders with their name", () => {
    expect(() =>
      renderTemplate('{"x": "{{nutzer}}"}', { input: "", session: "", turns: [] }),
    ).toThrow(UnknownPlaceholderError);
    expect(() =>
      renderTemplate('{"x": "{{nutzer}}"}', { input: "", session: "", turns: [] }),
    ).toThrow(/nutzer/);
  });

  it("renders raw values when asked, for headers and urls", () => {
    expect(
      renderTemplate("Bearer {{session}}", { input: "", session: 'a"b', turns: [] }, "raw"),
    ).toBe('Bearer a"b');
  });
});
