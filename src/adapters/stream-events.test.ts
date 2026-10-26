import { describe, expect, it } from "vitest";

import { parseNdjson, parseSse, StreamError, streamAnswer } from "./stream-events.js";

describe("parseNdjson", () => {
  it("reads one JSON value per line and skips empty lines", () => {
    expect(
      parseNdjson('{"type":"thread","threadId":"t-1"}\n\n{"type":"final","reply":"Hallo"}\n'),
    ).toEqual([
      { type: "thread", threadId: "t-1" },
      { type: "final", reply: "Hallo" },
    ]);
  });

  it("names the line that is no JSON", () => {
    expect(() => parseNdjson('{"a":1}\nkein json')).toThrow(/Zeile 2.*kein json/);
  });
});

describe("parseSse", () => {
  it("reads events with name, id and JSON data, joins data lines, skips comments and [DONE]", () => {
    const text = [
      ": keep-alive",
      "event: delta",
      "id: 1",
      'data: {"text":"Hal"}',
      "",
      "event: delta",
      'data: {"text":',
      'data: "lo"}',
      "",
      "data: plain",
      "",
      "retry: 1000",
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(parseSse(text)).toEqual([
      { event: "delta", id: "1", data: { text: "Hal" } },
      { event: "delta", data: { text: "lo" } },
      { data: "plain" },
    ]);
  });

  it("accepts CRLF and a missing final blank line", () => {
    expect(parseSse('data: {"a":1}\r\n\r\ndata: {"a":2}')).toEqual([
      { data: { a: 1 } },
      { data: { a: 2 } },
    ]);
  });
});

describe("streamAnswer", () => {
  const events = [
    { type: "thread", threadId: "t-1" },
    { type: "delta", text: "Hal" },
    { type: "delta", text: "lo" },
    { type: "delta" },
    { type: "final", reply: "Hallo" },
  ];

  it("reads the answer at responsePath from the last event the filter selects", () => {
    expect(
      streamAnswer(events, {
        responseEvent: { path: "$.type", equals: "final" },
        responsePath: "$.reply",
      }),
    ).toEqual({ content: "Hallo", event: { type: "final", reply: "Hallo" } });
  });

  it("joins the text of every selected event with concat and skips events without it", () => {
    expect(
      streamAnswer(events, {
        responseEvent: { path: "$.type", equals: "delta", concat: "$.text" },
      }),
    ).toEqual({ content: "Hallo", event: { type: "delta" } });
  });

  it("takes the last event, or every event for concat, without a filter", () => {
    expect(streamAnswer(events, { responsePath: "$.reply" }).content).toBe("Hallo");
    expect(
      streamAnswer([{ data: "a" }, { data: "b" }], { responseEvent: { concat: "$.data" } }).content,
    ).toBe("ab");
  });

  it("fails with the filter and an excerpt when nothing matches or concat finds no text", () => {
    expect(() =>
      streamAnswer(events, {
        responseEvent: { path: "$.type", equals: "done" },
        responsePath: "$.x",
      }),
    ).toThrow(/\$\.type = done.*5 Ereignissen.*thread/);
    expect(() => streamAnswer([], { responsePath: "$.x" })).toThrow(/kein Ereignis/);
    const error = (() => {
      try {
        return streamAnswer(events, {
          responseEvent: { path: "$.type", equals: "delta", concat: "$.nope" },
        });
      } catch (caught: unknown) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(StreamError);
    expect((error as Error).message).toMatch(/\$\.nope.*3 gewählten Ereignissen/);
  });
});
