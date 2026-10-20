import { describe, expect, it } from "vitest";

import { extractPath, parsePath, ResponsePathError } from "./response-path.js";

const payload = {
  reply: "Hallo",
  data: {
    choices: [{ message: { content: "Erste" } }, { message: { content: "Zweite" } }],
    count: 2,
    nested: { ok: true },
  },
  "with-dash": "ja",
};

describe("parsePath", () => {
  it("accepts JSONPath-like and dot notation", () => {
    expect(parsePath("$.reply")).toEqual(["reply"]);
    expect(parsePath("reply")).toEqual(["reply"]);
    expect(parsePath("$.data.choices[0].message.content")).toEqual([
      "data",
      "choices",
      0,
      "message",
      "content",
    ]);
    expect(parsePath("data.choices[1].message.content")).toEqual([
      "data",
      "choices",
      1,
      "message",
      "content",
    ]);
    expect(parsePath("$['with-dash']")).toEqual(["with-dash"]);
    expect(parsePath('$["with-dash"]')).toEqual(["with-dash"]);
  });

  it("rejects malformed paths", () => {
    expect(() => parsePath("")).toThrow(ResponsePathError);
    expect(() => parsePath("$.a[b]")).toThrow(ResponsePathError);
    expect(() => parsePath("a..b")).toThrow(ResponsePathError);
  });
});

describe("extractPath", () => {
  it("returns strings as they are", () => {
    expect(extractPath(payload, "$.reply")).toBe("Hallo");
    expect(extractPath(payload, "$.data.choices[1].message.content")).toBe("Zweite");
    expect(extractPath(payload, "$['with-dash']")).toBe("ja");
  });

  it("turns numbers and booleans into text and objects into JSON", () => {
    expect(extractPath(payload, "data.count")).toBe("2");
    expect(extractPath(payload, "data.nested.ok")).toBe("true");
    expect(extractPath(payload, "data.nested")).toBe('{"ok":true}');
  });

  it("names the missing segment and shows an excerpt of the payload", () => {
    expect(() => extractPath(payload, "$.data.answer")).toThrow(ResponsePathError);
    expect(() => extractPath(payload, "$.data.answer")).toThrow(/answer/);
    expect(() => extractPath(payload, "$.data.answer")).toThrow(/"reply":"Hallo"/);
    expect(() => extractPath(payload, "$.data.choices[5].message")).toThrow(/\[5\]/);
  });

  it("rejects null and undefined values at the path", () => {
    expect(() => extractPath({ reply: null }, "$.reply")).toThrow(ResponsePathError);
  });
});
