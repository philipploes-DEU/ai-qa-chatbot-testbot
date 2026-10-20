import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FAKE_LOGIN,
  type FakeTokenServer,
  startFakeTokenServer,
} from "../../tests/helpers/token-server.js";
import { TargetConfigSchema } from "../domain/target-config.js";
import { MissingCredentialError } from "./auth.js";
import { FatalTargetError, HttpStatusError } from "./errors.js";
import { TargetHttpClient } from "./http-client.js";
import { REDACTED } from "./token-auth.js";

const env: Record<string, string> = {
  AIQA_TARGET_EMAIL: FAKE_LOGIN.email,
  AIQA_TARGET_PASSWORD: FAKE_LOGIN.password,
  AIQA_SUPABASE_ANON_KEY: FAKE_LOGIN.anonKey,
};

function supabaseAuth(base: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "token",
    tokenEndpoint: `${base}/auth/v1/token?grant_type=password`,
    refreshEndpoint: `${base}/auth/v1/token?grant_type=refresh_token`,
    format: "json",
    usernameField: "email",
    username: "${AIQA_TARGET_EMAIL}",
    password: "${AIQA_TARGET_PASSWORD}",
    headers: { apikey: "${AIQA_SUPABASE_ANON_KEY}" },
    ...overrides,
  };
}

describe("token auth", () => {
  let server: FakeTokenServer;
  let clock: number;

  function client(
    auth: Record<string, unknown>,
    concurrency = 1,
    environment: Record<string, string> = env,
  ) {
    const target = TargetConfigSchema.parse({
      name: "test",
      adapter: "http",
      endpoint: `${server.url}/api/chat`,
      request: { body: "{}", responsePath: "$.reply" },
      auth,
      rateLimit: { requestsPerMinute: 100000, concurrency, backoff: "none" },
      timeouts: { requestMs: 2000, dialogMs: 5000 },
    });
    return new TargetHttpClient(target, { env: environment, now: () => clock });
  }

  const chat = (http: TargetHttpClient, path = "/api/chat") =>
    http.request(`${server.url}${path}`, { method: "POST", body: "{}" });

  beforeEach(async () => {
    server = await startFakeTokenServer();
    clock = 1_000_000;
  });

  afterEach(async () => {
    await server.close();
  });

  it("logs in with the password grant before the first call and sends the token as bearer", async () => {
    const http = client(supabaseAuth(server.url));
    await chat(http);
    await chat(http);

    expect(server.tokenRequests).toHaveLength(1);
    const login = server.tokenRequests[0];
    expect(login?.path).toBe("/auth/v1/token?grant_type=password");
    expect(login?.headers.apikey).toBe(FAKE_LOGIN.anonKey);
    expect(login?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(login?.body ?? "")).toEqual({
      email: FAKE_LOGIN.email,
      password: FAKE_LOGIN.password,
    });
    expect(server.targetAuthorizations).toEqual([
      "Bearer AIQAFAKE-access-1",
      "Bearer AIQAFAKE-access-1",
    ]);
  });

  it("sends an OAuth 2 form body with grant_type when the format is form", async () => {
    const http = client({
      type: "token",
      tokenEndpoint: `${server.url}/oauth/token`,
      username: "${AIQA_TARGET_EMAIL}",
      password: "${AIQA_TARGET_PASSWORD}",
    });
    await chat(http);

    const login = server.tokenRequests[0];
    expect(login?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(login?.body))).toEqual({
      grant_type: "password",
      username: FAKE_LOGIN.email,
      password: FAKE_LOGIN.password,
    });
    expect(server.targetAuthorizations).toEqual(["Bearer AIQAFAKE-access-1"]);
  });

  it("renews the token shortly before it expires with the refresh token", async () => {
    const http = client(supabaseAuth(server.url));
    await chat(http);
    clock += 3_600_000 - 30_000;
    await chat(http);

    expect(server.tokenRequests.map((request) => request.path)).toEqual([
      "/auth/v1/token?grant_type=password",
      "/auth/v1/token?grant_type=refresh_token",
    ]);
    expect(JSON.parse(server.tokenRequests[1]?.body ?? "")).toEqual({
      refresh_token: "AIQAFAKE-refresh-1",
    });
    expect(server.targetAuthorizations.at(-1)).toBe("Bearer AIQAFAKE-access-2");
  });

  it("logs in again before expiry when no refresh endpoint is configured", async () => {
    const http = client(supabaseAuth(server.url, { refreshEndpoint: undefined }));
    await chat(http);
    clock += 3_600_000;
    await chat(http);

    expect(server.tokenRequests.map((request) => request.path)).toEqual([
      "/auth/v1/token?grant_type=password",
      "/auth/v1/token?grant_type=password",
    ]);
  });

  it("falls back to the password grant when the refresh token is rejected", async () => {
    const http = client(supabaseAuth(server.url));
    await chat(http);
    server.revokeRefreshTokens();
    clock += 3_600_000;
    await chat(http);

    expect(server.tokenRequests.map((request) => request.path)).toEqual([
      "/auth/v1/token?grant_type=password",
      "/auth/v1/token?grant_type=refresh_token",
      "/auth/v1/token?grant_type=password",
    ]);
    expect(server.targetAuthorizations.at(-1)).toBe("Bearer AIQAFAKE-access-2");
  });

  it("keeps a token without expires_in until the target rejects it", async () => {
    server.expiresIn = undefined;
    const http = client(supabaseAuth(server.url));
    await chat(http);
    clock += 24 * 3_600_000;
    await chat(http);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("renews once after HTTP 401 and repeats the call", async () => {
    const http = client(supabaseAuth(server.url));
    await chat(http);
    server.revoke("AIQAFAKE-access-1");
    const response = await chat(http);

    expect(response.status).toBe(200);
    expect(server.tokenRequests).toHaveLength(2);
    expect(server.targetAuthorizations).toEqual([
      "Bearer AIQAFAKE-access-1",
      "Bearer AIQAFAKE-access-1",
      "Bearer AIQAFAKE-access-2",
    ]);
  });

  it("reports a second 401 with a fresh token as an error of the call, without the token", async () => {
    const http = client(supabaseAuth(server.url));
    const error = await chat(http, "/api/always-401").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(401);
    expect((error as HttpStatusError).message).not.toContain("AIQAFAKE-access");
    expect((error as HttpStatusError).message).toContain(REDACTED);
    expect(server.tokenRequests).toHaveLength(2);
    expect(server.targetAuthorizations).toHaveLength(2);
  });

  it("stops with a fatal error that names the reason but not the password when the login fails", async () => {
    const http = client(supabaseAuth(server.url), 1, {
      ...env,
      AIQA_TARGET_PASSWORD: "AIQAFAKE-falsch",
    });
    const error = await chat(http).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FatalTargetError);
    const message = (error as FatalTargetError).message;
    expect(message).toMatch(/Anmeldung/);
    expect(message).toContain("http 400");
    expect(message).toContain("Invalid login credentials");
    expect(message).not.toContain("AIQAFAKE-falsch");
    expect(server.targetAuthorizations).toHaveLength(0);
  });

  it("stops with a fatal error when the answer has no token at the path, without echoing it", async () => {
    const http = client(supabaseAuth(server.url, { tokenEndpoint: `${server.url}/no-token` }));
    const error = await chat(http).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FatalTargetError);
    expect((error as FatalTargetError).message).toContain("$.access_token");
    expect((error as FatalTargetError).message).not.toContain("AIQAFAKE-hidden");
  });

  it("stops with a fatal error when the token endpoint cannot be reached", async () => {
    const http = client(supabaseAuth(server.url, { tokenEndpoint: "http://127.0.0.1:9/token" }));
    await expect(chat(http)).rejects.toThrow(FatalTargetError);
    await expect(chat(http)).rejects.toThrow(/nicht erreichbar/);
  });

  it("fetches one token for concurrent calls", async () => {
    const http = client(supabaseAuth(server.url), 3);
    await Promise.all([chat(http), chat(http), chat(http)]);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("removes the token from what the target answers", async () => {
    const http = client(supabaseAuth(server.url));
    const response = await chat(http, "/api/leaky");

    expect(response.text).not.toContain("AIQAFAKE-access");
    expect((response.json() as { reply: string }).reply).toBe(`Dein Token ist ${REDACTED}`);
  });

  it("fails early with the variable name when a credential is missing", () => {
    const { AIQA_SUPABASE_ANON_KEY: _missing, ...rest } = env;
    expect(() => client(supabaseAuth(server.url), 1, rest)).toThrow(MissingCredentialError);
    expect(() => client(supabaseAuth(server.url), 1, rest)).toThrow(/AIQA_SUPABASE_ANON_KEY/);
  });
});
