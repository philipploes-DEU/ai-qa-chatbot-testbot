import { spawn } from "node:child_process";

import { DEFAULT_UI_PORT, startUiServer, type UiServer } from "../ui/server.js";
import { requireWorkspaceConfig } from "./config.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export interface UiCommandOptions {
  port?: number;
  /** Open the browser; commander sets false for --no-open. */
  open?: boolean;
  config?: string;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Without a browser the address on the console is enough.
  }
}

/**
 * `aiqa ui`: starts the local UI for the workspace (issue #60, ADR 0012) and keeps running
 * until the process ends. Returns the server so tests can close it.
 */
export async function executeUi(options: UiCommandOptions, io: CliIo): Promise<UiServer> {
  const port = options.port ?? DEFAULT_UI_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CliError("--port muss eine ganze Zahl zwischen 1 und 65535 sein");
  }
  const workspace = await requireWorkspaceConfig(io.cwd, options.config);
  let server: UiServer;
  try {
    server = await startUiServer({ workspace, port });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EADDRINUSE"
    ) {
      throw new CliError(`Port ${String(port)} ist belegt. Wähle einen anderen mit --port.`);
    }
    throw error;
  }
  io.writeOut(`AI QA läuft unter ${server.url} (nur auf diesem Rechner). Beenden mit Strg+C.`);
  if (options.open !== false) openBrowser(server.url);
  return server;
}
