#!/usr/bin/env node
// Installs a pinned gitleaks release into .tools/gitleaks and verifies its SHA-256
// against checksums recorded here. Runs during `pnpm install` (prepare script), so the
// pre-commit hook works without a global gitleaks installation.
// Skipped in CI, where the official gitleaks GitHub Action scans the full history.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "8.30.1";

// From https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt
const CHECKSUMS = {
  "darwin_arm64.tar.gz": "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  "darwin_x64.tar.gz": "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  "linux_arm64.tar.gz": "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  "linux_x64.tar.gz": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  "windows_arm64.zip": "b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f",
  "windows_x64.zip": "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = path.join(root, ".tools", "gitleaks");
const binaryName = process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
const binaryPath = path.join(toolsDir, binaryName);

function assetSuffix() {
  const os = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "x64", arm64: "arm64" }[process.arch];
  if (!os || !arch) {
    throw new Error(`no pinned gitleaks build for ${process.platform}/${process.arch}`);
  }
  return `${os}_${arch}.${os === "windows" ? "zip" : "tar.gz"}`;
}

function installedVersion() {
  if (!existsSync(binaryPath)) return null;
  const result = spawnSync(binaryPath, ["version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function extract(archivePath, destination) {
  // Windows ships bsdtar in System32, which also extracts zip archives.
  const tar =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe")
      : "tar";
  const result = spawnSync(tar, ["-xf", archivePath, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`extracting ${path.basename(archivePath)} failed with status ${result.status}`);
  }
}

async function main() {
  if (process.env.CI) {
    console.log("ensure-gitleaks: CI detected, skipping (CI runs the gitleaks action)");
    return;
  }
  if (installedVersion() === VERSION) {
    console.log(`ensure-gitleaks: gitleaks ${VERSION} already installed`);
    return;
  }

  const suffix = assetSuffix();
  const expected = CHECKSUMS[suffix];
  const asset = `gitleaks_${VERSION}_${suffix}`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset}`;

  console.log(`ensure-gitleaks: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed with HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }

  rmSync(toolsDir, { recursive: true, force: true });
  mkdirSync(toolsDir, { recursive: true });
  const archivePath = path.join(toolsDir, asset);
  writeFileSync(archivePath, archive);
  extract(archivePath, toolsDir);
  rmSync(archivePath);
  if (process.platform !== "win32") {
    chmodSync(binaryPath, 0o755);
  }
  if (installedVersion() !== VERSION) {
    throw new Error(`gitleaks binary missing or wrong version after extraction at ${binaryPath}`);
  }
  console.log(
    `ensure-gitleaks: installed gitleaks ${VERSION} to ${path.relative(root, binaryPath)}`,
  );
}

main().catch((error) => {
  // Do not fail `pnpm install` when offline. The pre-commit hook fails closed until
  // the binary exists, so secrets can not slip through silently.
  console.warn(`ensure-gitleaks: ${error instanceof Error ? error.message : String(error)}`);
  console.warn(
    "ensure-gitleaks: gitleaks is not available. Commits are blocked until `pnpm secrets:setup` succeeds.",
  );
});
