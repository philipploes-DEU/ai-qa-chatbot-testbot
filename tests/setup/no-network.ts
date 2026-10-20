// Tests never talk to the network. Any fetch call to a host other than the local loopback
// fails loudly so that an accidental provider or target call is caught by the test suite itself.
// Loopback stays open: the example targets under examples/ run in-process as real HTTP servers.
const realFetch = globalThis.fetch;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(input: string | URL | Request): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).hostname;
}

const guardedFetch: typeof fetch = (input, init) => {
  const host = hostOf(input);
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Network access is disabled in tests (blocked ${host}). Use fixtures and fake providers.`,
    );
  }
  return realFetch(input, init);
};

globalThis.fetch = guardedFetch;
