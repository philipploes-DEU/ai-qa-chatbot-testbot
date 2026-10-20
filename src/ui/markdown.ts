import { escapeHtml } from "../report/html-renderer.js";

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
  /** Lines with constructs the renderer does not know; they are shown as plain text. */
  warnings: string[];
}

/** Maps a link target to an address in the UI, or null to show the link text only. */
export type LinkResolver = (href: string) => string | null;

/** The anchor GitHub builds for a heading, so links like README.md#3-erster-lauf keep working. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const BOLD = /\*\*([^*]+)\*\*/g;

function plain(text: string, resolve: LinkResolver): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label = "", href = ""] = match;
    html += strong(escapeHtml(text.slice(last, match.index)));
    const target = resolve(href);
    html +=
      target === null
        ? `<span>${strong(escapeHtml(label))}</span>`
        : `<a href="${escapeHtml(target)}"${/^https?:/.test(target) ? ' rel="noreferrer noopener"' : ""}>${strong(escapeHtml(label))}</a>`;
    last = match.index + whole.length;
  }
  return html + strong(escapeHtml(text.slice(last)));
}

function strong(escaped: string): string {
  return escaped.replace(BOLD, "<strong>$1</strong>");
}

/** Inline markup: code spans first, then links and bold in the text around them. */
function inline(text: string, resolve: LinkResolver): string {
  return text
    .split("`")
    .map((part, index) =>
      index % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : plain(part, resolve),
    )
    .join("");
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * A small Markdown renderer for the documentation of AI QA (issue #63): headings, paragraphs,
 * flat lists with continuation lines, fenced code, tables, code spans, links and bold.
 * Everything is escaped; unknown constructs become warnings instead of guesses.
 */
export function renderMarkdown(text: string, resolve: LinkResolver): RenderedMarkdown {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  const warnings: string[] = [];
  const used = new Map<string, number>();
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[] } | null = null;

  const flush = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(" "), resolve)}</p>`);
      paragraph = [];
    }
    if (list !== null) {
      const open = list.kind === "ol" ? `<ol start="${String(list.start)}">` : "<ul>";
      out.push(
        [
          open,
          ...list.items.map((item) => `<li>${inline(item, resolve)}</li>`),
          `</${list.kind}>`,
        ].join("\n"),
      );
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.startsWith("```")) {
      flush();
      const lang = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      out.push(
        `<pre><code${lang.length > 0 ? ` data-lang="${escapeHtml(lang)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      const level = heading[1]?.length ?? 1;
      const title = heading[2] ?? "";
      const base = slugify(title);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const id = seen === 0 ? base : `${base}-${String(seen)}`;
      headings.push({ level, text: title.replace(/`/g, ""), id });
      out.push(
        `<h${String(level)} id="${escapeHtml(id)}">${inline(title, resolve)}</h${String(level)}>`,
      );
      continue;
    }

    if (line.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith("|")) {
        rows.push(cells(lines[index] ?? ""));
        index += 1;
      }
      index -= 1;
      const [head, separator, ...body] = rows;
      const isSeparator = separator?.every((cell) => /^:?-+:?$/.test(cell)) ?? false;
      const bodyRows = isSeparator
        ? body
        : [separator ?? [], ...body].filter((row) => row.length > 0);
      out.push(
        `<div class="scroll"><table><thead><tr>${(head ?? []).map((cell) => `<th>${inline(cell, resolve)}</th>`).join("")}</tr></thead><tbody>${bodyRows
          .map(
            (row) => `<tr>${row.map((cell) => `<td>${inline(cell, resolve)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    const bullet = /^- (.*)$/.exec(line);
    const numbered = /^(\d+)\. (.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      if (paragraph.length > 0) flush();
      const kind = bullet !== null ? "ul" : "ol";
      if (list !== null && list.kind !== kind) flush();
      list ??= { kind, start: numbered === null ? 1 : Number(numbered[1]), items: [] };
      list.items.push((bullet?.[1] ?? numbered?.[2] ?? "").trim());
      continue;
    }

    if (/^\s+-\s/.test(line) && list !== null) {
      warnings.push(`verschachtelte Liste: ${line.trim()}`);
    } else if (line.startsWith(">")) {
      warnings.push(`Zitat: ${line}`);
    } else if (line.startsWith("![")) {
      warnings.push(`Bild: ${line}`);
    }

    if (/^\s+\S/.test(line) && list !== null) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""} ${line.trim()}`;
      continue;
    }
    if (list !== null) flush();
    paragraph.push(line.trim());
  }
  flush();
  return { html: out.join("\n"), headings, warnings };
}
