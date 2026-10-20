import { describe, expect, it } from "vitest";

import { AuthSchema } from "../domain/target-config.js";
import { MissingCredentialError, resolveAuthHeaders } from "./auth.js";

describe("resolveAuthHeaders", () => {
  it("adds nothing for auth none", () => {
    expect(resolveAuthHeaders(AuthSchema.parse({ type: "none" }), {})).toEqual({});
  });

  it("builds a basic authorization header from two environment variables", () => {
    const auth = AuthSchema.parse({
      type: "basic",
      username: "${AIQA_TARGET_USER}",
      password: "${AIQA_TARGET_PASSWORD}",
    });
    const headers = resolveAuthHeaders(auth, {
      AIQA_TARGET_USER: "qa",
      AIQA_TARGET_PASSWORD: "AIQAFAKE-pass:wort",
    });
    expect(headers).toEqual({
      authorization: `Basic ${Buffer.from("qa:AIQAFAKE-pass:wort").toString("base64")}`,
    });
  });

  it("builds a bearer header", () => {
    const auth = AuthSchema.parse({ type: "bearer", token: "${AIQA_TARGET_TOKEN}" });
    expect(resolveAuthHeaders(auth, { AIQA_TARGET_TOKEN: "AIQAFAKE-token" })).toEqual({
      authorization: "Bearer AIQAFAKE-token",
    });
  });

  it("builds a custom header with the configured name", () => {
    const auth = AuthSchema.parse({
      type: "header",
      name: "X-Api-Key",
      value: "${AIQA_TARGET_TOKEN}",
    });
    expect(resolveAuthHeaders(auth, { AIQA_TARGET_TOKEN: "AIQAFAKE-key" })).toEqual({
      "X-Api-Key": "AIQAFAKE-key",
    });
  });

  it("fails with the variable name and config path when a variable is missing or empty", () => {
    const auth = AuthSchema.parse({
      type: "basic",
      username: "${AIQA_TARGET_USER}",
      password: "${AIQA_TARGET_PASSWORD}",
    });
    expect(() => resolveAuthHeaders(auth, { AIQA_TARGET_USER: "qa" })).toThrow(
      MissingCredentialError,
    );
    expect(() =>
      resolveAuthHeaders(auth, { AIQA_TARGET_USER: "qa", AIQA_TARGET_PASSWORD: "" }),
    ).toThrow(/AIQA_TARGET_PASSWORD .*auth\.password/);
  });

  it("never puts the secret value into the error message", () => {
    const auth = AuthSchema.parse({ type: "bearer", token: "${AIQA_TARGET_TOKEN}" });
    try {
      resolveAuthHeaders(auth, {});
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("AIQA_TARGET_TOKEN");
      expect(String(error)).not.toContain("Bearer");
    }
  });
});
