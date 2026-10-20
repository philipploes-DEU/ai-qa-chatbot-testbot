import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_LOGIN = {
  email: "qa@example.test",
  password: "AIQAFAKE-passwort",
  anonKey: "AIQAFAKE-anon",
} as const;

export interface TokenRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeTokenServer {
  url: string;
  /** Every request to a token endpoint, oldest first. */
  tokenRequests: TokenRequest[];
  /** Authorization headers the target endpoints received, oldest first. */
  targetAuthorizations: (string | undefined)[];
  /** Lifetime the server reports for new tokens; undefined leaves expires_in out. */
  expiresIn: number | undefined;
  /** The target rejects this access token from now on. */
  revoke(token: string): void;
  /** Refresh tokens issued so far are rejected from now on. */
  revokeRefreshTokens(): void;
  close(): Promise<void>;
}

/**
 * Local stand-in for an auth server and a protected target (issue #73). Speaks the Supabase
 * flavour (JSON body, grant_type in the query, apikey header) under /auth/v1/token and the
 * OAuth 2 flavour (form body with grant_type) under /oauth/token. /no-token answers 200 without
 * a token. The target: /api/chat answers when the bearer is valid, /api/leaky repeats the token
 * in its answer, /api/always-401 rejects every call and echoes the header it got.
 */
export function startFakeTokenServer(): Promise<FakeTokenServer> {
  let issued = 0;
  const valid = new Set<string>();
  const refreshable = new Set<string>();
  const state: Omit<FakeTokenServer, "url" | "close"> = {
    tokenRequests: [],
    targetAuthorizations: [],
    expiresIn: 3600,
    revoke: (token) => valid.delete(token),
    revokeRefreshTokens: () => {
      refreshable.clear();
    },
  };

  const issue = (): Record<string, unknown> => {
    issued++;
    const access = `AIQAFAKE-access-${String(issued)}`;
    const refresh = `AIQAFAKE-refresh-${String(issued)}`;
    valid.add(access);
    refreshable.add(refresh);
    return {
      access_token: access,
      token_type: "bearer",
      ...(state.expiresIn !== undefined ? { expires_in: state.expiresIn } : {}),
      refresh_token: refresh,
    };
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = request.url ?? "/";
      const json = (status: number, payload: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      const invalidGrant = (description: string): void => {
        json(400, { error: "invalid_grant", error_description: description });
      };

      if (path.startsWith("/auth/v1/token") || path === "/oauth/token") {
        state.tokenRequests.push({ path, headers: request.headers, body });
        let grant: string | null;
        let fields: Record<string, string>;
        if (path === "/oauth/token") {
          const form = new URLSearchParams(body);
          grant = form.get("grant_type");
          fields = Object.fromEntries(form.entries());
        } else {
          if (request.headers.apikey !== FAKE_LOGIN.anonKey) {
            json(401, { message: "No API key found in request" });
            return;
          }
          grant = new URL(path, "http://localhost").searchParams.get("grant_type");
          fields = JSON.parse(body) as Record<string, string>;
        }
        if (grant === "password") {
          const user = fields.email ?? fields.username;
          if (user === FAKE_LOGIN.email && fields.password === FAKE_LOGIN.password) {
            json(200, issue());
          } else {
            invalidGrant("Invalid login credentials");
          }
        } else if (grant === "refresh_token") {
          const token = fields.refresh_token ?? "";
          if (refreshable.delete(token)) json(200, issue());
          else invalidGrant("Invalid Refresh Token");
        } else {
          invalidGrant("unsupported grant_type");
        }
        return;
      }

      if (path === "/no-token") {
        json(200, { token_type: "bearer", secret: "AIQAFAKE-hidden" });
        return;
      }

      const authorization = request.headers.authorization;
      state.targetAuthorizations.push(authorization);
      const token = authorization?.replace(/^Bearer /, "") ?? "";
      if (path === "/api/always-401" || !valid.has(token)) {
        json(401, { error: "unauthorized", got: authorization ?? "" });
      } else if (path === "/api/leaky") {
        json(200, { reply: `Dein Token ist ${token}` });
      } else {
        json(200, { reply: "Antwort des Zielsystems" });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(
        Object.assign(state, {
          url: `http://127.0.0.1:${String(port)}`,
          close: () =>
            new Promise<void>((done) => {
              server.close(() => {
                done();
              });
            }),
        }),
      );
    });
  });
}
