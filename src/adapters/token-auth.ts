import type { TokenAuthConfig } from "../domain/target-config.js";
import { type AuthProvider, type Environment, resolveEnvRef } from "./auth.js";
import { causeMessage, excerpt, FatalTargetError, isAbort } from "./errors.js";
import { parsePath, readPath } from "./response-path.js";

/** Stands in for a token or password wherever a text from target or token endpoint is kept. */
export const REDACTED = "[Token entfernt]";

/** Renew this long before expiry; for short lifetimes at half of it. */
const RENEW_MARGIN_MS = 60_000;

const ENV_REF = /^\$\{[A-Z][A-Z0-9_]*\}$/;

interface TokenState {
  accessToken: string;
  refreshToken?: string;
  /** Clock time from which the next call renews the token first. */
  renewAt: number;
}

export interface TokenAuthOptions {
  env: Environment;
  /** Bound of one token request, timeouts.requestMs of the target. */
  requestMs: number;
  fetchImpl?: typeof fetch;
  /** Clock in milliseconds, for tests. */
  now?: () => number;
}

/**
 * Auth type `token` (issue #73, ADR 0015). Logs in with the password grant before the first
 * call, renews the token before it expires (refresh grant when a refresh endpoint is set, a new
 * login otherwise or when the refresh fails) and once after HTTP 401. Concurrent calls share
 * one token request. When no token can be obtained, a FatalTargetError stops the run. Tokens and
 * the password live only in memory; redact() removes the tokens from texts that reach records.
 * The password never goes to the target, only token endpoint errors are cleaned of it.
 */
export class TokenAuth implements AuthProvider {
  private readonly username: string;
  private readonly password: string;
  private readonly extraHeaders: Record<string, string> = {};
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly secrets = new Set<string>();
  private current: TokenState | undefined;
  private pending: Promise<TokenState> | undefined;

  constructor(
    private readonly config: TokenAuthConfig,
    private readonly options: TokenAuthOptions,
  ) {
    this.username = resolveEnvRef(config.username, options.env, "auth.username");
    this.password = resolveEnvRef(config.password, options.env, "auth.password");
    for (const [name, value] of Object.entries(config.headers)) {
      this.extraHeaders[name] = ENV_REF.test(value)
        ? resolveEnvRef(value, options.env, `auth.headers.${name}`)
        : value;
    }
    for (const path of [config.tokenPath, config.expiresInPath, config.refreshTokenPath]) {
      parsePath(path);
    }
    this.secrets.add(this.password);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async headers(): Promise<Record<string, string>> {
    const state = await this.valid();
    return { authorization: `Bearer ${state.accessToken}` };
  }

  reject(headers: Readonly<Record<string, string>>): boolean {
    const current = this.current;
    if (current !== undefined && headers.authorization === `Bearer ${current.accessToken}`) {
      this.current = { ...current, renewAt: Number.NEGATIVE_INFINITY };
    }
    return true;
  }

  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) result = result.replaceAll(secret, REDACTED);
    return result;
  }

  private valid(): Promise<TokenState> {
    const current = this.current;
    if (current !== undefined && this.now() < current.renewAt) return Promise.resolve(current);
    this.pending ??= this.renew(current).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async renew(previous: TokenState | undefined): Promise<TokenState> {
    let next: TokenState | undefined;
    const endpoint = this.config.refreshEndpoint;
    if (previous?.refreshToken !== undefined && endpoint !== undefined) {
      const fields = { refresh_token: previous.refreshToken };
      next = await this.requestToken(endpoint, "refresh_token", fields, "Erneuerung").catch(
        () => undefined,
      );
    }
    next ??= await this.requestToken(
      this.config.tokenEndpoint,
      this.config.grantType,
      { [this.config.usernameField]: this.username, [this.config.passwordField]: this.password },
      "Anmeldung",
    );
    this.current = next;
    return next;
  }

  private async requestToken(
    endpoint: string,
    grant: string,
    fields: Record<string, string>,
    step: string,
  ): Promise<TokenState> {
    const failed = `Token für das Zielsystem: ${step} fehlgeschlagen`;
    const form = this.config.format === "form";
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
          ...this.extraHeaders,
        },
        body: form
          ? new URLSearchParams({ grant_type: grant, ...fields }).toString()
          : JSON.stringify(fields),
        signal: AbortSignal.timeout(this.options.requestMs),
      });
    } catch (error) {
      throw new FatalTargetError(
        isAbort(error)
          ? `${failed}, keine Antwort innerhalb von ${String(this.options.requestMs)} ms`
          : `${failed}, Token-Endpoint nicht erreichbar: ${causeMessage(error)}`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const reason = this.redact(text).replaceAll(this.password, REDACTED);
      throw new FatalTargetError(`${failed}, http ${String(response.status)}: ${excerpt(reason)}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new FatalTargetError(`${failed}, die Antwort ist kein JSON`);
    }
    const accessToken = readPath(payload, this.config.tokenPath);
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new FatalTargetError(`${failed}, kein Token unter ${this.config.tokenPath}`);
    }
    this.secrets.add(accessToken);
    const refreshValue = readPath(payload, this.config.refreshTokenPath);
    const refreshToken =
      typeof refreshValue === "string" && refreshValue !== "" ? refreshValue : fields.refresh_token;
    if (refreshToken !== undefined) this.secrets.add(refreshToken);
    const expiresIn = Number(readPath(payload, this.config.expiresInPath));
    const lifetimeMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : undefined;
    return {
      accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      renewAt:
        lifetimeMs === undefined
          ? Number.POSITIVE_INFINITY
          : this.now() + lifetimeMs - Math.min(RENEW_MARGIN_MS, lifetimeMs / 2),
    };
  }
}
