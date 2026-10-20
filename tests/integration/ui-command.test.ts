import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initWorkspace } from "../../src/cli/init.js";
import { executeUi } from "../../src/cli/ui-command.js";

function collectIo(cwd: string) {
  const out: string[] = [];
  return { cwd, out, writeOut: (line: string) => out.push(line), writeErr: () => undefined };
}

describe("aiqa ui", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-ui-cmd-"));
    await initWorkspace(dir, () => new Date("2026-10-11T08:00:00Z"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts the UI for the workspace and names the local address", async () => {
    const io = collectIo(dir);
    const server = await executeUi({ port: 0, open: false }, io);
    try {
      expect(io.out.join("\n")).toContain(server.url);
      expect(io.out.join("\n")).toContain("Strg+C");
      const reply = await fetch(server.url);
      expect(reply.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("names a port that is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await expect(executeUi({ port, open: false }, collectIo(dir))).rejects.toThrow(/belegt/);
    } finally {
      await new Promise<void>((resolve) =>
        blocker.close(() => {
          resolve();
        }),
      );
    }
  });
});
