import type { AuthConfig } from "../domain/target-config.js";

export type Environment = Readonly<Record<string, string | undefined>>;

/** Auth types whose headers follow from the environment alone, without a request. */
export type StaticAuthConfig = Exclude<AuthConfig, { type: "token" }>;

/** A configured ${NAME} reference points to a variable that is not set or empty. */
export class MissingCredentialError extends Error {
  constructor(
    readonly variable: string,
    readonly configPath: string,
  ) {
    super(`Umgebungsvariable ${variable} ist nicht gesetzt oder leer, gebraucht für ${configPath}`);
    this.name = "MissingCredentialError";
  }
}

/** Reads the value behind a ${NAME} reference. The value itself never appears in errors. */
export function resolveEnvRef(ref: string, env: Environment, configPath: string): string {
  const variable = ref.slice(2, -1);
  const value = env[variable];
  if (value === undefined || value === "") {
    throw new MissingCredentialError(variable, configPath);
  }
  return value;
}

/**
 * Headers that authenticate every request to the target, keyed in lower case where standard.
 * Auth token has no fixed headers; TokenAuth obtains them with a request.
 */
export function resolveAuthHeaders(auth: AuthConfig, env: Environment): Record<string, string> {
  switch (auth.type) {
    case "none":
      return {};
    case "basic": {
      const username = resolveEnvRef(auth.username, env, "auth.username");
      const password = resolveEnvRef(auth.password, env, "auth.password");
      const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
      return { authorization: `Basic ${encoded}` };
    }
    case "bearer":
      return { authorization: `Bearer ${resolveEnvRef(auth.token, env, "auth.token")}` };
    case "header":
      return { [auth.name]: resolveEnvRef(auth.value, env, "auth.value") };
    case "token":
      throw new Error("auth token hat keine festen Header, das Token holt TokenAuth");
  }
}

/**
 * Where the HTTP client gets its auth headers from. Static auth always returns the same headers;
 * token auth (issue #73) fetches and renews a token and may be asked for a fresh one after 401.
 */
export interface AuthProvider {
  /** Headers for the next request. */
  headers(): Promise<Record<string, string>>;
  /**
   * The target answered 401 to a request with these headers. True when fresh headers are worth
   * one more try; the next call of headers() then returns them.
   */
  reject(headers: Readonly<Record<string, string>>): boolean;
  /** Removes secrets the provider obtained from a text before it reaches records. */
  redact(text: string): string;
}

export class StaticAuth implements AuthProvider {
  private readonly resolved: Record<string, string>;

  constructor(auth: StaticAuthConfig, env: Environment) {
    this.resolved = resolveAuthHeaders(auth, env);
  }

  headers(): Promise<Record<string, string>> {
    return Promise.resolve(this.resolved);
  }

  reject(): boolean {
    return false;
  }

  redact(text: string): string {
    return text;
  }
}
