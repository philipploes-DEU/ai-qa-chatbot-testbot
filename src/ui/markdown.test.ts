import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderMarkdown, slugify } from "./markdown.js";

const keep = (href: string): string | null => href;

describe("slugify", () => {
  it("builds the anchors GitHub builds, so links into the README keep working", () => {
    expect(slugify("3. Erster Lauf in zehn Minuten")).toBe("3-erster-lauf-in-zehn-minuten");
    expect(slugify("Adapter openai-compatible")).toBe("adapter-openai-compatible");
    expect(slugify("Gates und Budget je Lauf")).toBe("gates-und-budget-je-lauf");
    expect(slugify("Rücksendung: 30 Tage")).toBe("rücksendung-30-tage");
  });
});

describe("renderMarkdown", () => {
  it("renders headings with anchors and collects them for the table of contents", () => {
    const result = renderMarkdown("# Titel\n\n## 1. Ziel\n\n### Teil `a`", keep);
    expect(result.html).toContain('<h1 id="titel">Titel</h1>');
    expect(result.html).toContain('<h2 id="1-ziel">1. Ziel</h2>');
    expect(result.html).toContain('<h3 id="teil-a">Teil <code>a</code></h3>');
    expect(result.headings.map((heading) => [heading.level, heading.id])).toEqual([
      [1, "titel"],
      [2, "1-ziel"],
      [3, "teil-a"],
    ]);
  });

  it("joins paragraph lines and list continuation lines", () => {
    const text = [
      "Ein Absatz",
      "über zwei Zeilen.",
      "",
      "- erster Punkt",
      "  mit Fortsetzung",
      "- zweiter Punkt",
      "",
      "1. Schritt eins",
      "   weiter",
      "10. Schritt zehn",
    ].join("\n");
    const { html, warnings } = renderMarkdown(text, keep);
    expect(html).toContain("<p>Ein Absatz über zwei Zeilen.</p>");
    expect(html).toContain(
      "<ul>\n<li>erster Punkt mit Fortsetzung</li>\n<li>zweiter Punkt</li>\n</ul>",
    );
    expect(html).toContain(
      '<ol start="1">\n<li>Schritt eins weiter</li>\n<li>Schritt zehn</li>\n</ol>',
    );
    expect(warnings).toEqual([]);
  });

  it("keeps fenced code verbatim and escaped", () => {
    const { html } = renderMarkdown("```yaml\nbody: '<b>{{input}}</b>'\n- nicht: liste\n```", keep);
    expect(html).toContain(
      '<pre><code data-lang="yaml">body: &#39;&lt;b&gt;{{input}}&lt;/b&gt;&#39;\n- nicht: liste</code></pre>',
    );
  });

  it("escapes text, renders code spans, bold and resolved links", () => {
    const { html } = renderMarkdown(
      "Mit `<tag>` und **fett** nach [README, Abschnitt 3](../README.md#3-x) und [weg](LICENSE) <script>",
      (href) => (href.startsWith("../README.md") ? `/referenz${href.slice(12)}` : null),
    );
    expect(html).toContain("<code>&lt;tag&gt;</code>");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain('<a href="/referenz#3-x">README, Abschnitt 3</a>');
    expect(html).toContain("<span>weg</span>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders a table", () => {
    const { html } = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | `x` |", keep);
    expect(html).toContain("<thead><tr><th>A</th><th>B</th></tr></thead>");
    expect(html).toContain("<tr><td>1</td><td><code>x</code></td></tr>");
  });

  it("warns about constructs it does not know instead of guessing", () => {
    const { warnings } = renderMarkdown(
      "> Zitat\n\n![Bild](x.png)\n\n- a\n  - verschachtelt",
      keep,
    );
    expect(warnings.length).toBe(3);
  });

  it("renders the handbook and the README without unknown constructs", () => {
    for (const file of ["docs/handbuch.md", "README.md"]) {
      const { warnings, headings } = renderMarkdown(readFileSync(file, "utf8"), keep);
      expect(warnings, file).toEqual([]);
      expect(headings.length).toBeGreaterThan(3);
    }
  });
});
