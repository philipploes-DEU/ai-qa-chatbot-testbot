import { spawn } from "node:child_process";

import type { Tokens, Turn } from "../domain/common.js";
import type { TargetConfig } from "../domain/target-config.js";
import { excerpt, TimeoutError } from "./errors.js";
import { RateLimiter } from "./rate-limit.js";
import type { SendOptions, TargetAdapter, TargetResponse } from "./target.js";

export interface ScriptAdapterOptions {
  /** Working directory of the command, usually the workspace. */
  cwd?: string;
}

/** Splits a command line into command and arguments; double quotes group words, no shell. */
export function splitCommand(line: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let inWord = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      inWord = true;
    } else if (/\s/.test(char) && !quoted) {
      if (inWord) parts.push(current);
      current = "";
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) parts.push(current);
  const [command, ...args] = parts;
  if (command === undefined || command === "") {
    throw new Error("Adapter script braucht ein Kommando als endpoint");
  }
  return { command, args };
}

/** Prefix of the environment variables that carry the variables of the case (issue #119). */
export const VAR_ENV_PREFIX = "AIQA_VAR_";

type Vars = Readonly<Record<string, string>>;

/**
 * The variables of the case as environment variables, named AIQA_VAR_<name> as written in the
 * case. Windows ignores case in the environment, so names that differ only in case are refused
 * instead of one silently replacing the other.
 */
export function varsEnvironment(vars: Vars): Record<string, string> {
  const seen = new Map<string, string>();
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) {
    const other = seen.get(name.toLowerCase());
    if (other !== undefined) {
      throw new Error(
        `Variablen ${other} und ${name} unterscheiden sich nur in Groß- und Kleinschreibung, als Umgebungsvariable sind sie unter Windows dieselbe`,
      );
    }
    seen.set(name.toLowerCase(), name);
    environment[`${VAR_ENV_PREFIX}${name}`] = value;
  }
  return environment;
}

interface ScriptOutput {
  content: string;
  tokens?: Tokens;
}

function parseOutput(stdout: string): ScriptOutput {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`Skript antwortete nicht mit JSON: ${excerpt(stdout)}`);
  }
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as ScriptOutput).content !== "string"
  ) {
    throw new Error(`Skript-Antwort braucht ein Feld content (string): ${excerpt(stdout)}`);
  }
  const output = data as { content: string; tokens?: unknown };
  const tokens = output.tokens;
  if (
    tokens !== undefined &&
    (typeof tokens !== "object" ||
      tokens === null ||
      typeof (tokens as Tokens).input !== "number" ||
      typeof (tokens as Tokens).output !== "number")
  ) {
    throw new Error(
      `Skript-Antwort: tokens braucht input und output als Zahlen: ${excerpt(stdout)}`,
    );
  }
  return { content: output.content, ...(tokens === undefined ? {} : { tokens: tokens as Tokens }) };
}

/**
 * Adapter `script` (issue #25): runs a local command per call, hands the conversation as JSON
 * on stdin ({ turns, session, vars }) and reads the answer as JSON from stdout
 * ({ content, tokens? }). The variables of a case (issue #119) travel as vars on stdin and as
 * environment variables AIQA_VAR_<name>; a case without vars leaves both out.
 * A non-zero exit code or a timeout is an error of the iteration. No shell: the command line is
 * split into command and arguments, pipes and redirections are not interpreted.
 */
export class ScriptAdapter implements TargetAdapter {
  readonly name: string;
  readonly supportsVars = true;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string | undefined;
  private readonly requestMs: number;
  private readonly limiter: RateLimiter;

  constructor(target: TargetConfig, options: ScriptAdapterOptions = {}) {
    if (target.endpoint === undefined) {
      throw new Error(
        `Zielsystem ${target.name}: Adapter script braucht das Kommando als endpoint`,
      );
    }
    this.name = target.name;
    const { command, args } = splitCommand(target.endpoint);
    this.command = command;
    this.args = args;
    this.cwd = options.cwd;
    this.requestMs = target.timeouts.requestMs;
    this.limiter = new RateLimiter(target.rateLimit);
  }

  send(turns: readonly Turn[], session?: string, options?: SendOptions): Promise<TargetResponse> {
    if (!turns.some((turn) => turn.role === "user")) {
      return Promise.reject(
        new Error("der Adapter script braucht mindestens einen Gesprächszug mit role user"),
      );
    }
    const vars = options?.vars;
    let environment: Record<string, string> | undefined;
    try {
      environment = vars === undefined ? undefined : varsEnvironment(vars);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return this.limiter.run(() => this.run(turns, session, vars, environment));
  }

  private run(
    turns: readonly Turn[],
    session: string | undefined,
    vars: Vars | undefined,
    environment: Record<string, string> | undefined,
  ): Promise<TargetResponse> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        ...(environment === undefined ? {} : { env: { ...process.env, ...environment } }),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new TimeoutError(this.requestMs, "request"));
      }, this.requestMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(`Kommando ${this.command} konnte nicht gestartet werden: ${error.message}`),
        );
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const latencyMs = performance.now() - started;
        if (code !== 0) {
          reject(
            new Error(`exit ${String(code)}${stderr.trim() === "" ? "" : `: ${excerpt(stderr)}`}`),
          );
          return;
        }
        try {
          const output = parseOutput(stdout);
          resolve({
            content: output.content,
            raw: {
              stdout: excerpt(stdout),
              ...(stderr.trim() === "" ? {} : { stderr: excerpt(stderr) }),
            },
            latencyMs,
            ...(output.tokens !== undefined ? { tokens: output.tokens } : {}),
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      child.stdin.on("error", () => {
        // A script that exits before reading stdin closes the pipe; the close handler reports it.
      });
      child.stdin.end(
        JSON.stringify({
          turns,
          ...(session === undefined ? {} : { session }),
          ...(vars === undefined ? {} : { vars }),
        }),
      );
    });
  }
}
