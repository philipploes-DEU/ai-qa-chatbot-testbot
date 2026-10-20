import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkspaceConfig } from "../../src/cli/config.js";
import { executeImport } from "../../src/cli/import-command.js";
import { initWorkspace } from "../../src/cli/init.js";
import type { CliIo } from "../../src/cli/io.js";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJBSVFBRkFLRSJ9.AIQAFAKEsig";

function collectIo(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out,
    err,
    writeOut: (line) => {
      out.push(line);
    },
    writeErr: (line) => {
      err.push(line);
    },
  };
}

function curl(url: string): string {
  return `curl '${url}' -H 'authorization: Bearer ${TOKEN}' -H 'content-type: application/json' -H 'user-agent: Mozilla/5.0' --data-raw '{"query":"Welche Dokumente liegen vor?"}'`;
}

describe("aiqa import curl", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-curl-"));
    await initWorkspace(dir, () => new Date("2026-10-13T08:00:00Z"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a draft of the target block without the token and applies it on request", async () => {
    await writeFile(path.join(dir, "anfrage.txt"), curl("https://api.example.test/ask"), "utf8");
    await writeFile(
      path.join(dir, "antwort.json"),
      JSON.stringify({ answer: "Teilungserklärungen und Protokolle [1].", citations: [] }),
      "utf8",
    );
    const io = collectIo(dir);
    await executeImport(
      {
        source: "curl",
        file: "anfrage.txt",
        question: "Welche Dokumente liegen vor?",
        response: "antwort.json",
        name: "mydocs",
      },
      io,
    );
    const draft = await readFile(path.join(dir, "aiqa.target-entwurf.yaml"), "utf8");
    expect(draft).toContain("name: mydocs");
    expect(draft).toContain("{{input}}");
    expect(draft).toContain("${AIQA_TARGET_TOKEN}");
    expect(draft).toContain("responsePath: $.answer");
    expect(draft).not.toContain(TOKEN);
    expect(draft).not.toContain("Mozilla");
    const text = io.out.join("\n");
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("AIQA_TARGET_TOKEN");
    expect(text).toContain("anfrage.txt enthält Zugangsdaten");
    expect(text).toContain("--apply");

    const before = await readFile(path.join(dir, "aiqa.yaml"), "utf8");
    expect(before).not.toContain("api.example.test");

    await executeImport(
      {
        source: "curl",
        file: "anfrage.txt",
        question: "Welche Dokumente liegen vor?",
        response: "antwort.json",
        name: "mydocs",
        apply: true,
      },
      collectIo(dir),
    );
    const workspace = await loadWorkspaceConfig(path.join(dir, "aiqa.yaml"));
    expect(workspace.config.target.name).toBe("mydocs");
    expect(workspace.config.target.endpoint).toBe("https://api.example.test/ask");
    expect(await readFile(path.join(dir, "aiqa.yaml"), "utf8")).not.toContain(TOKEN);
  });

  describe("with a test call", () => {
    let server: Server;
    let url: string;
    let received: string | undefined;

    beforeEach(async () => {
      server = createServer((request, response) => {
        received = request.headers.authorization;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { text: "Es liegen drei Protokolle vor." } }));
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          resolve();
        });
      });
      url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/ask`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    });

    it("calls the target once with the copied request and takes the response path from it", async () => {
      await writeFile(path.join(dir, "anfrage.txt"), curl(url), "utf8");
      const io = collectIo(dir);
      await executeImport(
        {
          source: "curl",
          file: "anfrage.txt",
          question: "Welche Dokumente liegen vor?",
          call: true,
        },
        io,
      );
      expect(received).toBe(`Bearer ${TOKEN}`);
      const draft = await readFile(path.join(dir, "aiqa.target-entwurf.yaml"), "utf8");
      expect(draft).toContain("responsePath: $.result.text");
      expect(io.out.join("\n")).toContain("HTTP 200");
      expect(io.out.join("\n")).not.toContain(TOKEN);
    });
  });
});
