import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { type LoadedWorkspace, runsDir } from "../cli/config.js";
import type { CliIo } from "../cli/io.js";
import { loadReportModel, writeReport } from "../cli/report-command.js";
import { FindingStatusSchema } from "../domain/finding.js";
import { HtmlRenderer } from "../report/html-renderer.js";
import { wirkmittelTheme } from "../report/themes/wirkmittel/theme.js";
import { FileResultStore } from "../store/file-result-store.js";
import { loadDraftSources, loadRunOverview, setCaseStatus, setFindingStatus } from "./data.js";
import { renderMarkdown } from "./markdown.js";
import { docPage, draftsPage, errorPage, overviewPage, runPage } from "./pages.js";
import { uiStylesheet } from "./styles.js";

export const DEFAULT_UI_PORT = 4317;
const HOST = "127.0.0.1";
const MAX_FORM_BYTES = 16 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSETS = new URL("../../assets/", import.meta.url);
const HANDBOOK = new URL("../../docs/handbuch.md", import.meta.url);
const README = new URL("../../README.md", import.meta.url);

function external(href: string): string | null {
  return /^https?:\/\//.test(href) ? href : null;
}

/** Links of the handbook (in docs/) inside the UI: the README becomes the reference page. */
function handbookLink(href: string): string | null {
  if (href.startsWith("#")) return href;
  const readme = /^\.\.\/README\.md(#.*)?$/.exec(href);
  if (readme !== null) return `/referenz${readme[1] ?? ""}`;
  return external(href);
}

/** Links of the README (in the root) inside the UI: the handbook becomes the handbook page. */
function readmeLink(href: string): string | null {
  if (href.startsWith("#")) return href;
  const handbook = /^docs\/handbuch\.md(#.*)?$/.exec(href);
  if (handbook !== null) return `/handbuch${handbook[1] ?? ""}`;
  return external(href);
}

/** Files the UI serves, by address. Nothing outside this list is ever read for a request. */
const ASSET_FILES: Readonly<Record<string, { file: URL; type: string }>> = {
  "/assets/icon.svg": { file: new URL("ui/icon.svg", ASSETS), type: "image/svg+xml" },
  "/assets/icon.png": { file: new URL("ui/icon-studio-256.png", ASSETS), type: "image/png" },
  "/assets/fonts/InterVariable.woff2": {
    file: new URL("fonts/InterVariable.woff2", ASSETS),
    type: "font/woff2",
  },
  "/assets/fonts/SpaceGrotesk-Variable.woff2": {
    file: new URL("fonts/SpaceGrotesk-Variable.woff2", ASSETS),
    type: "font/woff2",
  },
};

const PAGE_POLICY =
  "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "img-src 'self' data:; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const REPORT_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; frame-ancestors 'self'";

export interface UiServerOptions {
  workspace: LoadedWorkspace;
  /** 0 picks a free port, which tests use. */
  port?: number;
  /** Token the forms carry; random per start unless a test fixes it. */
  token?: string;
}

export interface UiServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const quietIo: CliIo = { cwd: process.cwd(), writeOut: () => undefined, writeErr: () => undefined };

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  policy = PAGE_POLICY,
): void {
  res.writeHead(status, {
    "content-type": type,
    "content-security-policy": policy,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location, "cache-control": "no-store" });
  res.end();
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_FORM_BYTES) throw new HttpError(413, "Formular zu groß.");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sameToken(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts the local UI (issue #60, ADR 0012): server rendered pages without scripts, bound to
 * 127.0.0.1, host header and form token against other sites in the same browser.
 */
export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const { workspace } = options;
  const token = options.token ?? randomBytes(24).toString("hex");
  const store = new FileResultStore(runsDir(workspace));
  let port = options.port ?? DEFAULT_UI_PORT;

  const allowedHosts = (): string[] => [`${HOST}:${String(port)}`, `localhost:${String(port)}`];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedHosts().includes(req.headers.host ?? "")) {
      throw new HttpError(403, "Unbekannter Host. Die Oberfläche antwortet nur lokal.");
    }
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const parts = url.pathname.split("/").filter((part) => part.length > 0);
    const method = req.method ?? "GET";
    const ok = url.searchParams.get("ok");

    if (method === "GET") {
      if (url.pathname === "/") {
        const [overview, sources] = await Promise.all([
          loadRunOverview(store),
          loadDraftSources(workspace),
        ]);
        const openDrafts = sources.reduce((sum, source) => sum + source.drafts.length, 0);
        send(res, 200, "text/html; charset=utf-8", overviewPage(workspace, overview, openDrafts));
        return;
      }
      if (url.pathname === "/assets/ui.css") {
        send(res, 200, "text/css; charset=utf-8", uiStylesheet());
        return;
      }
      const asset = ASSET_FILES[url.pathname];
      if (asset !== undefined) {
        send(res, 200, asset.type, await readFile(asset.file));
        return;
      }
      if (url.pathname === "/handbuch" || url.pathname === "/referenz") {
        const handbook = url.pathname === "/handbuch";
        const text = await readFile(handbook ? HANDBOOK : README, "utf8");
        const doc = renderMarkdown(text, handbook ? handbookLink : readmeLink);
        send(
          res,
          200,
          "text/html; charset=utf-8",
          docPage(
            workspace,
            handbook ? "Handbuch" : "Referenz",
            handbook ? "handbook" : "reference",
            doc,
          ),
        );
        return;
      }
      if (url.pathname === "/drafts") {
        const sources = await loadDraftSources(workspace);
        send(res, 200, "text/html; charset=utf-8", draftsPage(workspace, sources, token, ok));
        return;
      }
      if (parts[0] === "runs" && parts.length >= 2 && parts.length <= 3) {
        const runId = parts[1] ?? "";
        if (!ID.test(runId)) throw new HttpError(404, "Unbekannter Lauf.");
        const model = await loadRun(runId);
        if (parts.length === 2) {
          const findings = await store.readFindings(runId);
          send(
            res,
            200,
            "text/html; charset=utf-8",
            runPage(workspace, model, findings, token, ok),
          );
          return;
        }
        if (parts[2] === "report") {
          send(
            res,
            200,
            "text/html; charset=utf-8",
            new HtmlRenderer().render(model, wirkmittelTheme),
            REPORT_POLICY,
          );
          return;
        }
      }
      throw new HttpError(404, "Diese Seite gibt es nicht.");
    }

    if (method === "POST") {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedHosts().some((host) => origin === `http://${host}`)) {
        throw new HttpError(403, "Fremde Herkunft.");
      }
      const form = await readForm(req);
      if (!sameToken(form.get("token"), token)) {
        throw new HttpError(403, "Ungültiges Formular. Lade die Seite neu.");
      }

      if (parts[0] === "runs" && parts.length === 4 && parts[2] === "findings") {
        const runId = parts[1] ?? "";
        const findingId = parts[3] ?? "";
        const status = FindingStatusSchema.safeParse(form.get("status"));
        if (!ID.test(runId) || !ID.test(findingId) || !status.success) {
          throw new HttpError(400, "Ungültige Angaben.");
        }
        if (!(await setFindingStatus(store, runId, findingId, status.data))) {
          throw new HttpError(404, "Unbekannter Befund.");
        }
        redirect(res, `/runs/${runId}?ok=befund`);
        return;
      }
      if (parts[0] === "runs" && parts.length === 3 && parts[2] === "reports") {
        const runId = parts[1] ?? "";
        const format = form.get("format") ?? "";
        if (!ID.test(runId) || !["markdown", "html", "junit"].includes(format)) {
          throw new HttpError(400, "Ungültige Angaben.");
        }
        await writeReport(workspace, await loadRun(runId), format);
        redirect(res, `/runs/${runId}?ok=report`);
        return;
      }
      if (parts[0] === "drafts" && parts.length === 3) {
        const index = Number(parts[1]);
        const caseId = parts[2] ?? "";
        const status = form.get("status");
        if (
          !Number.isInteger(index) ||
          !ID.test(caseId) ||
          (status !== "approved" && status !== "retired")
        ) {
          throw new HttpError(400, "Ungültige Angaben.");
        }
        const source = (await loadDraftSources(workspace)).find((entry) => entry.index === index);
        if (source === undefined || !(await setCaseStatus(source.file, caseId, status))) {
          throw new HttpError(404, "Unbekannter Entwurf.");
        }
        redirect(res, "/drafts?ok=entwurf");
        return;
      }
      throw new HttpError(404, "Diese Aktion gibt es nicht.");
    }

    throw new HttpError(405, "Diese Methode ist nicht erlaubt.");
  }

  async function loadRun(runId: string) {
    try {
      return await loadReportModel(workspace, store, runId, quietIo);
    } catch {
      throw new HttpError(404, `Lauf ${runId} nicht gefunden.`);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      const title = status === 404 ? "Nicht gefunden" : status >= 500 ? "Fehler" : "Abgelehnt";
      if (!res.headersSent) {
        send(res, status, "text/html; charset=utf-8", errorPage(workspace, title, message));
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://${HOST}:${String(port)}/`,
    port,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
