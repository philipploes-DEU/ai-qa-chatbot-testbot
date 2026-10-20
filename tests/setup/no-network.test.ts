import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("blocks network access through fetch", () => {
    expect(() => fetch("https://example.test/")).toThrow(/Network access is disabled/);
  });

  it("lets fetch reach a loopback server, where the example targets run", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("loopback");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`);
      expect(await response.text()).toBe("loopback");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
