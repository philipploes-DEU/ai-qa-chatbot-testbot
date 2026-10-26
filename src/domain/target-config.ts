import { z } from "zod";

import { IdSchema } from "./common.js";

export const AdapterKindSchema = z.enum([
  "http",
  "openai-compatible",
  "script",
  "playwright",
  "dummy",
]);
export type AdapterKind = z.infer<typeof AdapterKindSchema>;

/** Credentials are never written into config files, only references like ${AIQA_TARGET_TOKEN}. */
export const EnvRefSchema = z
  .string()
  .regex(
    /^\$\{[A-Z][A-Z0-9_]*\}$/,
    "muss auf eine Umgebungsvariable verweisen, zum Beispiel ${AIQA_TARGET_PASSWORD}, nie auf einen Wert",
  );

/**
 * Auth with short-lived access tokens (issue #73, ADR 0015): AI QA logs in with the password
 * grant before the first call, renews the token before it expires and once after HTTP 401, and
 * sends it as bearer. Supabase: format json, usernameField email, apikey header, grant_type in
 * the endpoint urls. OAuth 2: format form, grant_type in the body.
 */
export const TokenAuthSchema = z.strictObject({
  type: z.literal("token"),
  /** Url that issues tokens, for Supabase https://<projekt>.supabase.co/auth/v1/token?grant_type=password. */
  tokenEndpoint: z.url(),
  /** Url for the refresh_token grant. Without it AI QA logs in again with the password. */
  refreshEndpoint: z.url().optional(),
  grantType: z.literal("password").default("password"),
  username: EnvRefSchema,
  password: EnvRefSchema,
  /** form: application/x-www-form-urlencoded with grant_type (OAuth 2), json: JSON body. */
  format: z.enum(["form", "json"]).default("form"),
  usernameField: z.string().min(1).default("username"),
  passwordField: z.string().min(1).default("password"),
  /** Extra headers of the token requests; a value written as ${NAME} comes from the environment. */
  headers: z.record(z.string(), z.string().min(1)).default({}),
  tokenPath: z.string().min(1).default("$.access_token"),
  /** Lifetime in seconds. Without it the token is renewed only after HTTP 401. */
  expiresInPath: z.string().min(1).default("$.expires_in"),
  refreshTokenPath: z.string().min(1).default("$.refresh_token"),
});
export type TokenAuthConfig = z.infer<typeof TokenAuthSchema>;

export const AuthSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({ type: z.literal("basic"), username: EnvRefSchema, password: EnvRefSchema }),
  z.strictObject({ type: z.literal("bearer"), token: EnvRefSchema }),
  z.strictObject({ type: z.literal("header"), name: z.string().min(1), value: EnvRefSchema }),
  TokenAuthSchema,
]);
export type AuthConfig = z.infer<typeof AuthSchema>;

export const RateLimitSchema = z.strictObject({
  requestsPerMinute: z.number().int().positive().default(60),
  concurrency: z.number().int().positive().default(1),
  /** Behaviour on HTTP 429 and 503. */
  backoff: z.enum(["none", "exponential"]).default("exponential"),
  maxRetries: z.number().int().nonnegative().default(3),
  /**
   * Calls the target allows per day, for example the daily limit of a test account. aiqa run
   * warns before the first call when a plan needs more (issue #96).
   */
  maxCallsPerDay: z.number().int().positive().optional(),
});
export type RateLimitConfig = z.infer<typeof RateLimitSchema>;

/** Technical limits enforced by AI QA. A hit counts as an error of the iteration. */
export const TimeoutsSchema = z
  .strictObject({
    /** One attempt against the target. */
    requestMs: z.number().int().positive().default(15000),
    /** One call of the adapter including retries and waits; a dialog scenario later. */
    dialogMs: z.number().int().positive().default(120000),
  })
  .superRefine((timeouts, ctx) => {
    if (timeouts.dialogMs < timeouts.requestMs) {
      ctx.addIssue({
        code: "custom",
        path: ["dialogMs"],
        message: "dialogMs darf nicht kleiner als requestMs sein",
      });
    }
  });
export type TimeoutsConfig = z.infer<typeof TimeoutsSchema>;

/** Requirements on the target. A miss produces a failed verdict, not an error. */
export const ExpectationsSchema = z.strictObject({
  maxLatencyMs: z.number().int().positive().optional(),
});
export type ExpectationsConfig = z.infer<typeof ExpectationsSchema>;

/** How the http adapter reads the answer: one JSON document or a stream (ADR 0024). */
export const ResponseFormatSchema = z.enum(["json", "ndjson", "sse"]);
export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

/** Selects the events of a streamed answer by a value in them, for example $.type equals final. */
export const EventSelectorSchema = z.strictObject({
  path: z.string().min(1),
  equals: z.string().min(1),
});
export type EventSelector = z.infer<typeof EventSelectorSchema>;

/**
 * Which events of a streamed answer carry the text (issue #106, ADR 0024). `path` with
 * `equals` selects events, without them every event counts. `concat` joins the text at that
 * path over every selected event; without it `responsePath` reads the last selected event.
 */
export const ResponseEventSchema = z
  .strictObject({
    path: z.string().min(1).optional(),
    equals: z.string().min(1).optional(),
    concat: z.string().min(1).optional(),
  })
  .superRefine((event, ctx) => {
    if ((event.path === undefined) !== (event.equals === undefined)) {
      ctx.addIssue({ code: "custom", message: "responseEvent braucht path und equals zusammen" });
    } else if (event.path === undefined && event.concat === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "responseEvent braucht path mit equals oder concat",
      });
    }
  });
export type ResponseEvent = z.infer<typeof ResponseEventSchema>;

/** Request template for the http adapter with {{input}} and {{session}} placeholders. */
export const RequestTemplateSchema = z
  .strictObject({
    method: z.enum(["POST", "GET", "PUT", "PATCH"]).default("POST"),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().min(1),
    /** One JSON document (json), JSON lines (ndjson) or Server-Sent Events (sse). */
    responseFormat: ResponseFormatSchema.default("json"),
    /** Which events of a stream carry the text; only with ndjson and sse. */
    responseEvent: ResponseEventSchema.optional(),
    /**
     * JSONPath-like pointer to the answer, for example $.reply. In a stream it reads the chosen
     * event; with responseEvent.concat it is not used.
     */
    responsePath: z.string().min(1).optional(),
    /** Defaults for {{vars.name}}; a case overrides them with its own vars (issue #80). */
    vars: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string()).optional(),
  })
  .superRefine((request, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (request.responseFormat === "json") {
      if (request.responsePath === undefined) {
        issue("responsePath", "Adapter http braucht responsePath, den Pfad zum Antworttext");
      }
      if (request.responseEvent !== undefined) {
        issue("responseEvent", "responseEvent gibt es nur bei responseFormat ndjson oder sse");
      }
      return;
    }
    if (request.responseEvent?.concat !== undefined) {
      if (request.responsePath !== undefined) {
        issue(
          "responsePath",
          "mit responseEvent.concat entfällt responsePath, der Text kommt aus den gewählten Ereignissen",
        );
      }
    } else if (request.responsePath === undefined) {
      issue(
        "responsePath",
        `responseFormat ${request.responseFormat} braucht responsePath oder responseEvent.concat`,
      );
    }
  });
export type RequestTemplate = z.infer<typeof RequestTemplateSchema>;

export const SessionConfigSchema = z
  .strictObject({
    mode: z.enum(["none", "header", "body", "cookie"]).default("none"),
    key: z.string().min(1).optional(),
    /** In a streamed answer, the event the session value at key is read from (ADR 0024). */
    event: EventSelectorSchema.optional(),
  })
  .superRefine((session, ctx) => {
    if (session.mode !== "none" && session.key === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: `Session-Modus ${session.mode} braucht einen Schlüssel (key)`,
      });
    }
    if (session.event !== undefined && session.mode !== "body") {
      ctx.addIssue({
        code: "custom",
        path: ["event"],
        message: "session.event gibt es nur bei mode body",
      });
    }
  });
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const PlaywrightConfigSchema = z.strictObject({
  /** Spec file that describes the user interface, relative to the workspace. */
  spec: z.string().min(1),
  headless: z.boolean().default(true),
  browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
});
export type PlaywrightConfig = z.infer<typeof PlaywrightConfigSchema>;

/** Chat completions settings for the openai-compatible adapter. */
export const OpenAiConfigSchema = z.strictObject({
  /** Model name sent in the request; the target decides what it means. */
  model: z.string().min(1),
  /** Sent as first message with role system when set. */
  systemPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type OpenAiConfig = z.infer<typeof OpenAiConfigSchema>;

/** Table driven answers for the dummy adapter: exact last user message to answer. */
export const DummyConfigSchema = z.strictObject({
  responses: z.record(z.string(), z.string()).default({}),
  fallback: z.string().min(1).default("Dazu ist keine Antwort hinterlegt."),
});
export type DummyConfig = z.infer<typeof DummyConfigSchema>;

const urlAdapters: ReadonlySet<AdapterKind> = new Set(["http", "openai-compatible", "playwright"]);
const tokenAdapters: ReadonlySet<AdapterKind> = new Set(["http", "openai-compatible"]);

export const TargetConfigSchema = z
  .strictObject({
    name: IdSchema,
    adapter: AdapterKindSchema,
    /** Url for http and playwright, base url (.../v1) for openai-compatible, command for script. */
    endpoint: z.string().min(1).optional(),
    auth: AuthSchema.prefault({ type: "none" }),
    rateLimit: RateLimitSchema.prefault({}),
    timeouts: TimeoutsSchema.prefault({}),
    expectations: ExpectationsSchema.prefault({}),
    request: RequestTemplateSchema.optional(),
    session: SessionConfigSchema.optional(),
    playwright: PlaywrightConfigSchema.optional(),
    openai: OpenAiConfigSchema.optional(),
    dummy: DummyConfigSchema.optional(),
  })
  .superRefine((target, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };

    if (urlAdapters.has(target.adapter)) {
      if (target.endpoint === undefined) {
        issue("endpoint", `Adapter ${target.adapter} braucht eine Endpoint-URL`);
      } else if (!z.url().safeParse(target.endpoint).success) {
        issue("endpoint", "endpoint muss eine gültige URL sein");
      }
    }
    if (target.auth.type === "token" && !tokenAdapters.has(target.adapter)) {
      issue("auth", "auth token nutzen nur die Adapter http und openai-compatible");
    }
    if (target.adapter === "script" && target.endpoint === undefined) {
      issue("endpoint", "Adapter script braucht den auszuführenden Befehl als endpoint");
    }
    if (target.adapter === "http" && target.request === undefined) {
      issue("request", "Adapter http braucht ein Request-Template");
    }
    if (target.adapter !== "http" && target.request !== undefined) {
      issue("request", "Request-Templates nutzt nur der Adapter http");
    }
    if (
      target.session?.event !== undefined &&
      (target.request?.responseFormat ?? "json") === "json"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["session", "event"],
        message: "session.event braucht request.responseFormat ndjson oder sse",
      });
    }
    if (target.adapter === "playwright" && target.playwright === undefined) {
      issue("playwright", "Adapter playwright braucht einen playwright-Block");
    }
    if (target.adapter !== "playwright" && target.playwright !== undefined) {
      issue("playwright", "den playwright-Block nutzt nur der Adapter playwright");
    }
    if (target.adapter === "openai-compatible" && target.openai === undefined) {
      issue("openai", "Adapter openai-compatible braucht einen openai-Block mit model");
    }
    if (target.adapter !== "openai-compatible" && target.openai !== undefined) {
      issue("openai", "den openai-Block nutzt nur der Adapter openai-compatible");
    }
    if (target.adapter !== "dummy" && target.dummy !== undefined) {
      issue("dummy", "den dummy-Block nutzt nur der Adapter dummy");
    }
  });
export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type TargetConfigInput = z.input<typeof TargetConfigSchema>;
