import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import type { Environment } from "../adapters/auth.js";
import { HttpStatusError } from "../adapters/errors.js";
import { TargetHttpClient } from "../adapters/http-client.js";
import type { FixtureSource, StoredQuery } from "../domain/fixtures.js";
import { RateLimitSchema, TimeoutsSchema } from "../domain/target-config.js";
import { readRows } from "./rows.js";

/** A stored query with its id from aiqa.yaml. */
export type NamedQuery = StoredQuery & { id: string };

/**
 * Reads the rows of a stored query from a data source (ADR 0022). Implementations exist per
 * source type; tests and CI use the DummyResolver, without network.
 */
export interface FixtureResolver {
  readonly type: string;
  rows(query: NamedQuery, signal?: AbortSignal): Promise<Record<string, unknown>[]>;
}

export interface ResolverOptions {
  /** Directory of aiqa.yaml: file paths and script working directory are relative to it. */
  dir: string;
  /** Where ${NAME} references in auth are resolved. */
  env: Environment;
  fetchImpl?: typeof fetch;
}

/** Rows from a JSON or YAML file next to aiqa.yaml. */
class FileResolver implements FixtureResolver {
  readonly type = "file";
  constructor(
    private readonly file: string,
    private readonly dir: string,
  ) {}

  async rows(query: NamedQuery): Promise<Record<string, unknown>[]> {
    const absolute = path.resolve(this.dir, this.file);
    const text = await readFile(absolute, "utf8");
    let data: unknown;
    try {
      data = /\.json$/i.test(absolute) ? JSON.parse(text) : parse(text);
    } catch {
      // The parser quotes the content; it may be personal data (ADR 0022).
      throw new Error(`${this.file} ist kein gültiges JSON oder YAML`);
    }
    return readRows(data, query.rows);
  }
}

/** Rows from an HTTP API such as Elastic or Solr, through the shared client of the adapters. */
class HttpResolver implements FixtureResolver {
  readonly type = "http";
  private readonly client: TargetHttpClient;

  constructor(
    private readonly source: Extract<FixtureSource, { type: "http" }>,
    options: ResolverOptions,
  ) {
    this.client = new TargetHttpClient(
      {
        auth: source.auth ?? { type: "none" },
        rateLimit: RateLimitSchema.parse({}),
        timeouts: TimeoutsSchema.parse({
          requestMs: source.timeoutMs,
          dialogMs: source.timeoutMs * 2,
        }),
      },
      {
        env: options.env,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      },
    );
  }

  async rows(query: NamedQuery): Promise<Record<string, unknown>[]> {
    const request = query.request;
    const url = `${this.source.endpoint.replace(/\/$/, "")}${request?.path ?? ""}`;
    let response;
    try {
      response = await this.client.request(url, {
        method: request?.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...this.source.headers,
          ...request?.headers,
        },
        ...(request?.body !== undefined ? { body: request.body } : {}),
      });
    } catch (error) {
      // The body of an error answer may hold data; the status is enough to act on (ADR 0022).
      // Only the message reaches console and report; the cause keeps the original for code.
      if (error instanceof HttpStatusError) {
        throw new Error(`http ${String(error.status)}`, { cause: error });
      }
      throw error;
    }
    let data: unknown;
    try {
      data = response.json();
    } catch {
      throw new Error("die Quelle antwortete nicht mit JSON");
    }
    return readRows(data, query.rows);
  }
}

/** Rows from a local command that prints JSON, without a shell, for SQL and the rest. */
class ScriptResolver implements FixtureResolver {
  readonly type = "script";
  constructor(
    private readonly source: Extract<FixtureSource, { type: "script" }>,
    private readonly dir: string,
  ) {}

  rows(query: NamedQuery): Promise<Record<string, unknown>[]> {
    const [command, ...args] = this.source.command;
    return new Promise((resolve, reject) => {
      const child = spawn(command ?? "", [...args, ...query.args], {
        cwd: this.dir,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const timer = setTimeout(() => {
        finish(() => {
          child.kill();
          reject(new Error(`keine Antwort innerhalb von ${String(this.source.timeoutMs)} ms`));
        });
      }, this.source.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (error) => {
        finish(() => {
          reject(
            new Error(`Kommando ${command ?? ""} konnte nicht gestartet werden: ${error.message}`),
          );
        });
      });
      child.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            // stderr may quote data; the reader runs the command by hand to see it (ADR 0022).
            reject(
              new Error(
                `exit ${String(code)}${stderr.trim() === "" ? "" : ", Meldung auf stderr"}`,
              ),
            );
            return;
          }
          try {
            resolve(readRows(JSON.parse(stdout) as unknown, query.rows));
          } catch (error) {
            reject(
              error instanceof SyntaxError
                ? new Error("Skript antwortete nicht mit JSON")
                : error instanceof Error
                  ? error
                  : new Error(String(error)),
            );
          }
        });
      });
    });
  }
}

/** Answers recorded rows per query id. For tests and CI, without network (ADR 0022). */
export class DummyResolver implements FixtureResolver {
  readonly type = "dummy";
  constructor(private readonly rowsByQuery: Readonly<Record<string, Record<string, unknown>[]>>) {}

  rows(query: NamedQuery): Promise<Record<string, unknown>[]> {
    const rows = this.rowsByQuery[query.id];
    if (rows === undefined) {
      return Promise.reject(new Error(`keine Zeilen für die Abfrage ${query.id} aufgezeichnet`));
    }
    return Promise.resolve(rows);
  }
}

/** The resolver for a source of aiqa.yaml. */
export function createResolver(source: FixtureSource, options: ResolverOptions): FixtureResolver {
  switch (source.type) {
    case "file":
      return new FileResolver(source.path, options.dir);
    case "http":
      return new HttpResolver(source, options);
    case "script":
      return new ScriptResolver(source, options.dir);
  }
}
