#!/usr/bin/env node
// Runs the pinned gitleaks binary from .tools with the repository configuration.
// Fails closed: if the binary is missing, the command exits with status 1.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(
  root,
  ".tools",
  "gitleaks",
  process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
);

if (!existsSync(binary)) {
  console.error("gitleaks is not installed. Run `pnpm secrets:setup` and retry.");
  process.exit(1);
}

const args = process.argv.slice(2);
const hasConfig = args.includes("--config") || args.includes("-c");
const finalArgs = hasConfig ? args : ["--config", path.join(root, ".gitleaks.toml"), ...args];
const result = spawnSync(binary, finalArgs, { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
