import { describe, expect, it } from "vitest";

import { TargetConfigSchema } from "../domain/target-config.js";
import {
  CurlImportError,
  draftTarget,
  parseCurl,
  parseSampleAnswer,
  type StreamSample,
  suggestResponsePaths,
  suggestStream,
} from "./curl.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJBSVFBRkFLRSJ9.AIQAFAKEsignatureAIQAFAKE";

/** As Chrome copies it with "Copy as cURL (bash)", line continuations included. */
const CHROME = String.raw`curl 'https://api.example.test/chat?lang=de' \
  -H 'accept: */*' \
  -H 'accept-language: de-DE,de;q=0.9' \
  -H 'authorization: Bearer ${JWT}' \
  -H 'content-type: application/json' \
  -H 'origin: https://app.example.test' \
  -H 'sec-fetch-mode: cors' \
  -H 'user-agent: Mozilla/5.0' \
  -H 'x-tenant: haus-1' \
  -b 'session=AIQAFAKEcookie' \
  --data-raw '{"query":"Welche Dokumente liegen vor?","k":20}' \
  --compressed`;

describe("parseCurl", () => {
  it("reads method, url, headers, cookies and body from a Chrome copy", () => {
    const request = parseCurl(CHROME);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.example.test/chat?lang=de");
    expect(request.headers).toContainEqual(["authorization", `Bearer ${JWT}`]);
    expect(request.headers).toContainEqual(["x-tenant", "haus-1"]);
    expect(request.cookies).toBe("session=AIQAFAKEcookie");
    expect(request.body).toBe('{"query":"Welche Dokumente liegen vor?","k":20}');
  });

  it("understands quotes inside quotes, $'...' and an explicit method", () => {
    const request = parseCurl(
      String.raw`curl -X PUT "https://api.example.test/a" --data-raw $'{"query":"Was ist\'s?\nZeile 2"}'`,
    );
    expect(request.method).toBe("PUT");
    expect(request.body).toBe(`{"query":"Was ist's?\nZeile 2"}`);
    const single = parseCurl(String.raw`curl 'https://x.test' --data-raw '{"q":"It'\''s"}'`);
    expect(single.body).toBe(`{"q":"It's"}`);
  });

  it("asks for the bash variant when it gets a Windows cmd copy", () => {
    expect(() => parseCurl('curl ^"https://x.test^" -H ^"accept: */*^"')).toThrow(/bash/);
  });

  it("needs a url", () => {
    expect(() => parseCurl("curl -H 'accept: */*'")).toThrow(CurlImportError);
  });
});

describe("draftTarget", () => {
  it("turns the question into {{input}}, keeps the headers that matter and never a secret", () => {
    const draft = draftTarget(parseCurl(CHROME), { question: "Welche Dokumente liegen vor?" });
    const target = TargetConfigSchema.parse(draft.target);
    expect(target.adapter).toBe("http");
    expect(target.endpoint).toBe("https://api.example.test/chat?lang=de");
    expect(target.request?.method).toBe("POST");
    expect(target.request?.body).toBe('{"query":"{{input}}","k":20}');
    expect(target.request?.headers).toEqual({
      accept: "*/*",
      "content-type": "application/json",
      "x-tenant": "haus-1",
    });
    expect(target.auth).toEqual({ type: "bearer", token: "${AIQA_TARGET_TOKEN}" });
    const text = JSON.stringify(draft);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain("AIQAFAKEcookie");
    expect(draft.notes.join(" ")).toMatch(/AIQA_TARGET_TOKEN/);
    expect(draft.notes.join(" ")).toMatch(/auth token/);
    expect(draft.notes.join(" ")).toMatch(/Cookie/);
  });

  it("finds the question in usual fields when none is given", () => {
    const draft = draftTarget(
      parseCurl(
        `curl 'https://x.test/ask' -H 'content-type: application/json' --data-raw '{"question":"Hallo?","mode":"fast"}'`,
      ),
      {},
    );
    expect(TargetConfigSchema.parse(draft.target).request?.body).toBe(
      '{"question":"{{input}}","mode":"fast"}',
    );
  });

  it("uses {{turns}} for a list of messages", () => {
    const draft = draftTarget(
      parseCurl(
        `curl 'https://x.test/chat' --data-raw '{"messages":[{"role":"user","content":"Hallo?"}],"stream":false}'`,
      ),
      { question: "Hallo?" },
    );
    expect(TargetConfigSchema.parse(draft.target).request?.body).toBe(
      '{"messages":{{turns}},"stream":false}',
    );
  });

  it("puts a single key header into auth header and drops further secrets with a note", () => {
    const draft = draftTarget(
      parseCurl(
        `curl 'https://x.test/ask' -H 'x-api-key: AIQAFAKEkey1234567890abcdef' -H 'x-other-token: AIQAFAKEzzzzzzzzzzzzzzzzzzzzzzzzzzzz' --data-raw '{"query":"Hallo?"}'`,
      ),
      { question: "Hallo?" },
    );
    const target = TargetConfigSchema.parse(draft.target);
    expect(target.auth).toEqual({
      type: "header",
      name: "x-api-key",
      value: "${AIQA_TARGET_TOKEN}",
    });
    expect(target.request?.headers).toEqual({});
    expect(draft.notes.join(" ")).toContain("x-other-token");
  });

  it("names the response path from a sample answer, best candidate first", () => {
    const draft = draftTarget(parseCurl(CHROME), {
      question: "Welche Dokumente liegen vor?",
      response: {
        answered: true,
        answer: "Es liegen Teilungserklärungen und Protokolle vor [1].",
        citations: [{ label: 1, filename: "protokoll.md" }],
        mandateId: "m-1",
      },
    });
    expect(TargetConfigSchema.parse(draft.target).request?.responsePath).toBe("$.answer");
  });

  it("refuses a body without the question and a request without body", () => {
    expect(() =>
      draftTarget(parseCurl(`curl 'https://x.test' --data-raw '{"a":"b"}'`), {
        question: "Hallo?",
      }),
    ).toThrow(/Hallo\?/);
    expect(() => draftTarget(parseCurl("curl 'https://x.test/?q=Hallo'"), {})).toThrow(/Body/);
  });
});

describe("streamed sample answers (issue #106)", () => {
  const ndjson =
    '{"type":"thread","threadId":"3f2a9c1e-0000-4000-8000-000000000001"}\n' +
    '{"type":"final","reply":"Unser Kundenservice ist Montag bis Freitag für Sie da."}\n';
  const sse =
    'event: delta\ndata: {"type":"delta","text":"Unser "}\n\n' +
    'event: delta\ndata: {"type":"delta","text":"Kundenservice"}\n\n' +
    'event: done\ndata: {"type":"done"}\n\ndata: [DONE]\n\n';
  const stream = (text: string, contentType: string): StreamSample => {
    const sample = parseSampleAnswer(text, contentType);
    if (sample.format === "json") throw new Error("kein Stream");
    return sample;
  };

  it("reads JSON, NDJSON and SSE by content type, else by shape", () => {
    expect(parseSampleAnswer('{"answer":"x"}', "application/json; charset=utf-8")).toEqual({
      format: "json",
      payload: { answer: "x" },
    });
    expect(parseSampleAnswer(ndjson, "application/x-ndjson")).toMatchObject({
      format: "ndjson",
      events: [{ type: "thread" }, { type: "final" }],
    });
    expect(parseSampleAnswer(sse, "text/event-stream")).toMatchObject({
      format: "sse",
      events: [{ event: "delta" }, { event: "delta" }, { event: "done" }],
    });
    expect(parseSampleAnswer(ndjson).format).toBe("ndjson");
    expect(parseSampleAnswer(sse).format).toBe("sse");
    expect(() => parseSampleAnswer("<html>nope</html>")).toThrow(CurlImportError);
    expect(() => parseSampleAnswer('{"a":1}\nkaputt', "application/x-ndjson")).toThrow(/Zeile 2/);
  });

  it("suggests the final event with its text and names the event that carries the thread", () => {
    const suggestion = suggestStream(stream(ndjson, "application/x-ndjson"));
    expect(suggestion).toMatchObject({
      responseEvent: { path: "$.type", equals: "final" },
      responsePath: "$.reply",
    });
    expect(suggestion.notes.join(" ")).toContain("$.threadId");
    expect(suggestion.notes.join(" ")).toContain("equals: thread");
  });

  it("suggests joining delta events when the text comes in pieces", () => {
    expect(suggestStream(stream(sse, "text/event-stream"))).toMatchObject({
      responseEvent: { path: "$.event", equals: "delta", concat: "$.data.text" },
    });
    expect(
      suggestStream({ format: "ndjson", events: [{ text: "Hal" }, { text: "lo" }] }),
    ).toMatchObject({ responseEvent: { concat: "$.text" } });
  });

  it("reads a single event directly and falls back with a note when no text is found", () => {
    expect(suggestStream({ format: "ndjson", events: [{ reply: "Hallo" }] })).toMatchObject({
      responsePath: "$.reply",
    });
    const none = suggestStream({ format: "ndjson", events: [{ type: "a" }, { type: "b" }] });
    expect(none.responsePath).toBe("$.answer");
    expect(none.notes.join(" ")).toMatch(/von Hand/);
  });

  it("suggests initial: omit when the copied call sends no session field (issue #111)", () => {
    const sample = stream(ndjson, "application/x-ndjson");
    expect(suggestStream(sample, { bodyHasSession: false }).notes.join(" ")).toContain(
      "initial: omit",
    );
    expect(suggestStream(sample, { bodyHasSession: true }).notes.join(" ")).not.toContain(
      "initial: omit",
    );
    const draft = draftTarget(parseCurl(CHROME), {
      question: "Welche Dokumente liegen vor?",
      response: { sessionId: "s-1", answer: "Es liegen Protokolle vor." },
    });
    expect(draft.notes.join(" ")).toContain("key: $.sessionId");
    expect(draft.notes.join(" ")).toContain("initial: omit");
  });

  it("puts format, event filter and path into the draft so that it validates", () => {
    const final = draftTarget(parseCurl(CHROME), {
      question: "Welche Dokumente liegen vor?",
      stream: stream(ndjson, "application/x-ndjson"),
    });
    const target = TargetConfigSchema.parse(final.target);
    expect(target.request?.responseFormat).toBe("ndjson");
    expect(target.request?.responseEvent).toEqual({ path: "$.type", equals: "final" });
    expect(target.request?.responsePath).toBe("$.reply");

    const delta = draftTarget(parseCurl(CHROME), {
      question: "Welche Dokumente liegen vor?",
      stream: stream(sse, "text/event-stream"),
    });
    const parsed = TargetConfigSchema.parse(delta.target);
    expect(parsed.request?.responseFormat).toBe("sse");
    expect(parsed.request?.responseEvent?.concat).toBe("$.data.text");
    expect(parsed.request?.responsePath).toBeUndefined();
  });
});

describe("suggestResponsePaths", () => {
  it("ranks long text in answer-like fields over ids and short values", () => {
    const paths = suggestResponsePaths({
      id: "chatcmpl-123",
      choices: [
        { message: { role: "assistant", content: "Die Öffnungszeiten sind 9 bis 17 Uhr." } },
      ],
      model: "x",
    });
    expect(paths[0]?.path).toBe("$.choices[0].message.content");
    expect(paths.map((entry) => entry.path)).not.toContain("$.id");
  });
});
