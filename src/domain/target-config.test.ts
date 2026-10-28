import { describe, expect, it } from "vitest";

import { failureMessages, failurePaths } from "../../tests/helpers/schema.js";
import { TargetConfigSchema } from "./target-config.js";

const dummyTarget = {
  name: "beispiel-dummy",
  adapter: "dummy",
  dummy: {
    responses: { Hallo: "Guten Tag, wie kann ich helfen?" },
    fallback: "Dazu kann ich leider nichts sagen.",
  },
};

const httpTarget = {
  name: "kundenbot-staging",
  adapter: "http",
  endpoint: "https://staging.example.test/api/chat",
  auth: {
    type: "basic",
    username: "${AIQA_TARGET_USER}",
    password: "${AIQA_TARGET_PASSWORD}",
  },
  rateLimit: { requestsPerMinute: 30, concurrency: 2, backoff: "exponential", maxRetries: 3 },
  timeouts: { requestMs: 15000, dialogMs: 120000 },
  expectations: { maxLatencyMs: 8000 },
  request: {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"message": "{{input}}", "session": "{{session}}"}',
    responsePath: "$.reply",
  },
  session: { mode: "header", key: "X-Session-Id" },
};

const playwrightTarget = {
  name: "kundenbot-web",
  adapter: "playwright",
  endpoint: "https://staging.example.test/chat",
  auth: { type: "basic", username: "${AIQA_TARGET_USER}", password: "${AIQA_TARGET_PASSWORD}" },
  playwright: { spec: "specs/kundenbot-web.spec.yaml", headless: true, browser: "chromium" },
};

describe("TargetConfigSchema", () => {
  it("accepts a dummy target and fills defaults", () => {
    const parsed = TargetConfigSchema.parse(dummyTarget);

    expect(parsed.auth).toEqual({ type: "none" });
    expect(parsed.rateLimit).toEqual({
      requestsPerMinute: 60,
      concurrency: 1,
      backoff: "exponential",
      maxRetries: 3,
    });
    expect(parsed.timeouts).toEqual({ requestMs: 15000, dialogMs: 120000 });
    expect(parsed.expectations.maxLatencyMs).toBeUndefined();
    expect(parsed.dummy?.responses.Hallo).toBe("Guten Tag, wie kann ich helfen?");
  });

  it("accepts the http example from the briefing", () => {
    const parsed = TargetConfigSchema.parse(httpTarget);
    expect(parsed.adapter).toBe("http");
    expect(parsed.request?.responsePath).toBe("$.reply");
    expect(parsed.session?.key).toBe("X-Session-Id");
  });

  it("accepts the playwright example from the briefing", () => {
    const parsed = TargetConfigSchema.parse(playwrightTarget);
    expect(parsed.playwright?.browser).toBe("chromium");
  });

  it("accepts bearer and header auth with environment references", () => {
    const bearer = TargetConfigSchema.safeParse({
      ...httpTarget,
      auth: { type: "bearer", token: "${AIQA_TARGET_TOKEN}" },
    });
    const header = TargetConfigSchema.safeParse({
      ...httpTarget,
      auth: { type: "header", name: "X-Api-Key", value: "${AIQA_TARGET_TOKEN}" },
    });
    expect(bearer.success).toBe(true);
    expect(header.success).toBe(true);
  });

  it("accepts token auth for Supabase with defaults for paths, format and grant", () => {
    const parsed = TargetConfigSchema.parse({
      ...httpTarget,
      auth: {
        type: "token",
        tokenEndpoint: "https://projekt.supabase.example/auth/v1/token?grant_type=password",
        refreshEndpoint: "https://projekt.supabase.example/auth/v1/token?grant_type=refresh_token",
        format: "json",
        usernameField: "email",
        username: "${AIQA_TARGET_EMAIL}",
        password: "${AIQA_TARGET_PASSWORD}",
        headers: { apikey: "${AIQA_SUPABASE_ANON_KEY}" },
      },
    });
    expect(parsed.auth).toMatchObject({
      type: "token",
      grantType: "password",
      passwordField: "password",
      tokenPath: "$.access_token",
      expiresInPath: "$.expires_in",
      refreshTokenPath: "$.refresh_token",
    });
    const form = TargetConfigSchema.parse({
      ...httpTarget,
      auth: {
        type: "token",
        tokenEndpoint: "https://login.example.test/oauth/token",
        username: "${AIQA_TARGET_USER}",
        password: "${AIQA_TARGET_PASSWORD}",
      },
    });
    expect(form.auth).toMatchObject({ format: "form", usernameField: "username", headers: {} });
  });

  it("rejects token auth with a literal password or for adapters without http client", () => {
    const tokenAuth = {
      type: "token",
      tokenEndpoint: "https://login.example.test/oauth/token",
      username: "${AIQA_TARGET_USER}",
      password: "${AIQA_TARGET_PASSWORD}",
    };
    const literal = TargetConfigSchema.safeParse({
      ...httpTarget,
      auth: { ...tokenAuth, password: "geheim123" },
    });
    expect(failurePaths(literal)).toContain("auth.password");
    const script = TargetConfigSchema.safeParse({
      name: "skript",
      adapter: "script",
      endpoint: "node bot.js",
      auth: tokenAuth,
    });
    expect(failurePaths(script)).toContain("auth");
    expect(failureMessages(script).join(" ")).toMatch(/http und openai-compatible/);
  });

  it("rejects literal credentials instead of environment references", () => {
    const result = TargetConfigSchema.safeParse({
      ...httpTarget,
      auth: { type: "basic", username: "${AIQA_TARGET_USER}", password: "geheim123" },
    });
    expect(failurePaths(result)).toContain("auth.password");
    expect(failureMessages(result).join(" ")).toMatch(/Umgebungsvariable|environment variable/);
  });

  it("rejects an http target without request template", () => {
    const { request: _request, ...withoutRequest } = httpTarget;
    const result = TargetConfigSchema.safeParse(withoutRequest);
    expect(failurePaths(result)).toContain("request");
  });

  it("rejects an http target without endpoint", () => {
    const { endpoint: _endpoint, ...withoutEndpoint } = httpTarget;
    const result = TargetConfigSchema.safeParse(withoutEndpoint);
    expect(failurePaths(result)).toContain("endpoint");
  });

  it("rejects an endpoint that is not a url", () => {
    const result = TargetConfigSchema.safeParse({ ...httpTarget, endpoint: "staging/api" });
    expect(failurePaths(result)).toContain("endpoint");
  });

  it("rejects a session mode that needs a key without one", () => {
    const result = TargetConfigSchema.safeParse({ ...httpTarget, session: { mode: "header" } });
    expect(failurePaths(result)).toContain("session.key");
  });

  it("rejects a playwright target without playwright block", () => {
    const { playwright: _playwright, ...withoutBlock } = playwrightTarget;
    const result = TargetConfigSchema.safeParse(withoutBlock);
    expect(failurePaths(result)).toContain("playwright");
  });

  it("rejects a request template on a non http adapter", () => {
    const result = TargetConfigSchema.safeParse({ ...dummyTarget, request: httpTarget.request });
    expect(failurePaths(result)).toContain("request");
  });

  it("rejects unknown adapters and unknown fields", () => {
    expect(TargetConfigSchema.safeParse({ ...dummyTarget, adapter: "grpc" }).success).toBe(false);
    expect(TargetConfigSchema.safeParse({ ...dummyTarget, retries: 3 }).success).toBe(false);
  });
});

describe("TimeoutsSchema", () => {
  it("rejects a dialog timeout shorter than the request timeout", () => {
    const result = TargetConfigSchema.safeParse({
      ...dummyTarget,
      timeouts: { requestMs: 5000, dialogMs: 1000 },
    });
    expect(result.success).toBe(false);
    expect(failurePaths(result)).toContain("timeouts.dialogMs");
    expect(failureMessages(result).join(" ")).toContain("requestMs");
  });
});

describe("streamed answers (issue #106)", () => {
  function withRequest(request: Record<string, unknown>, session?: Record<string, unknown>) {
    return TargetConfigSchema.safeParse({
      ...httpTarget,
      request: { body: '{"q": "{{input}}"}', ...request },
      ...(session === undefined ? {} : { session }),
    });
  }
  const finalEvent = {
    responseFormat: "ndjson",
    responseEvent: { path: "$.type", equals: "final" },
    responsePath: "$.reply",
  };

  it("defaults to json and accepts ndjson and sse with an event filter", () => {
    expect(TargetConfigSchema.parse(httpTarget).request?.responseFormat).toBe("json");
    expect(withRequest(finalEvent).success).toBe(true);
    expect(
      withRequest({
        responseFormat: "sse",
        responseEvent: { path: "$.data.type", equals: "delta", concat: "$.data.text" },
      }).success,
    ).toBe(true);
    expect(
      withRequest({ responseFormat: "sse", responseEvent: { concat: "$.data" } }).success,
    ).toBe(true);
    expect(withRequest({ responseFormat: "ndjson", responsePath: "$.reply" }).success).toBe(true);
  });

  it("rejects a filter for json, a stream without text source and concat next to a path", () => {
    expect(
      failurePaths(
        withRequest({
          responseEvent: { path: "$.type", equals: "final" },
          responsePath: "$.reply",
        }),
      ),
    ).toContain("request.responseEvent");
    expect(failurePaths(withRequest({ responseFormat: "ndjson" }))).toContain(
      "request.responsePath",
    );
    expect(
      failurePaths(
        withRequest({
          responseFormat: "ndjson",
          responseEvent: { path: "$.type", equals: "delta", concat: "$.text" },
          responsePath: "$.reply",
        }),
      ),
    ).toContain("request.responsePath");
    expect(
      failurePaths(
        withRequest({
          responseFormat: "sse",
          responseEvent: { path: "$.type" },
          responsePath: "$.reply",
        }),
      ),
    ).toContain("request.responseEvent");
    expect(
      failurePaths(
        withRequest({ responseFormat: "sse", responseEvent: {}, responsePath: "$.reply" }),
      ),
    ).toContain("request.responseEvent");
  });

  it("takes the session from a chosen event only with mode body and a stream", () => {
    const fromEvent = {
      mode: "body",
      key: "$.threadId",
      event: { path: "$.type", equals: "thread" },
    };
    expect(withRequest(finalEvent, fromEvent).success).toBe(true);
    expect(failurePaths(withRequest({ responsePath: "$.reply" }, fromEvent))).toContain(
      "session.event",
    );
    expect(
      failurePaths(withRequest(finalEvent, { ...fromEvent, mode: "header", key: "X" })),
    ).toContain("session.event");
  });
});

describe("daily call limit (issue #112)", () => {
  it("accepts enforceDaily with a daily limit and rejects it without one", () => {
    const withLimit = TargetConfigSchema.safeParse({
      ...httpTarget,
      rateLimit: { maxCallsPerDay: 35, enforceDaily: true },
    });
    expect(withLimit.success).toBe(true);
    const withoutLimit = TargetConfigSchema.safeParse({
      ...httpTarget,
      rateLimit: { enforceDaily: true },
    });
    expect(failurePaths(withoutLimit)).toContain("rateLimit.enforceDaily");
  });
});

describe("first turn of a body session (issue #111)", () => {
  it("defaults to generated and accepts omit and empty with mode body", () => {
    expect(TargetConfigSchema.parse(httpTarget).session?.initial).toBe("generated");
    for (const initial of ["omit", "empty"]) {
      const result = TargetConfigSchema.safeParse({
        ...httpTarget,
        session: { mode: "body", key: "$.threadId", initial },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects omit and empty for the other modes", () => {
    const result = TargetConfigSchema.safeParse({
      ...httpTarget,
      session: { mode: "header", key: "X-Session-Id", initial: "omit" },
    });
    expect(failurePaths(result)).toContain("session.initial");
  });
});

describe("openai block", () => {
  const openAiTarget = {
    name: "bot",
    adapter: "openai-compatible",
    endpoint: "http://localhost:4020/v1",
    openai: { model: "gartenhelden-bot", systemPrompt: "Du bist knapp.", temperature: 0.2 },
  };

  it("accepts the openai block for the openai-compatible adapter", () => {
    const parsed = TargetConfigSchema.parse(openAiTarget);
    expect(parsed.openai).toEqual({
      model: "gartenhelden-bot",
      systemPrompt: "Du bist knapp.",
      temperature: 0.2,
    });
  });

  it("requires the openai block for the openai-compatible adapter", () => {
    const result = TargetConfigSchema.safeParse({ ...openAiTarget, openai: undefined });
    expect(result.success).toBe(false);
    expect(failurePaths(result)).toContain("openai");
  });

  it("rejects the openai block for other adapters", () => {
    const result = TargetConfigSchema.safeParse({ ...dummyTarget, openai: { model: "x" } });
    expect(result.success).toBe(false);
    expect(failurePaths(result)).toContain("openai");
  });
});
