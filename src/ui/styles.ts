import { wirkmittelTheme } from "../report/themes/wirkmittel/theme.js";

/**
 * Stylesheet of the local UI in the Wirkmittel design: dark petrol, radius 0, rules instead of
 * boxes, Electric Blue for structure, Neon Orange once per page. Fonts come as files from
 * /assets/fonts, never from a font host.
 */
export function uiStylesheet(): string {
  const style = wirkmittelTheme.html;
  if (style === undefined) throw new Error("Das Wirkmittel-Theme hat keinen HTML-Stil.");
  const { colors, fonts } = style;
  return `@font-face {
  font-family: 'Inter';
  src: url('/assets/fonts/InterVariable.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: 'Space Grotesk';
  src: url('/assets/fonts/SpaceGrotesk-Variable.woff2') format('woff2');
  font-weight: 300 700;
  font-display: swap;
}
:root {
  color-scheme: dark;
  --bg: ${colors.background};
  --surface: ${colors.surface};
  --line: ${colors.line};
  --text: ${colors.text};
  --muted: ${colors.muted};
  --accent: ${colors.accent};
  --highlight: ${colors.highlight};
  --font-heading: ${fonts.heading};
  --font-body: ${fonts.body};
  --font-mono: ${fonts.mono};
}
* { box-sizing: border-box; border-radius: 0; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font-family: var(--font-body); font-size: 1rem; line-height: 1.625; }
a { color: var(--accent); text-decoration: none; }
a:hover, a:focus-visible { color: var(--highlight); }
header.top { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5rem; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 0.875rem; color: var(--text); }
.brand img { display: block; }
.brand-name { display: block; font-family: var(--font-heading); font-weight: 700; font-size: 1.5rem; line-height: 1; letter-spacing: -0.025em; margin: 0; }
.brand-claim { display: block; margin: 0.25rem 0 0; font-weight: 500; background-image: linear-gradient(to right, ${colors.accent}, ${colors.highlight}); background-clip: text; -webkit-background-clip: text; color: transparent; }
header.top nav { display: flex; gap: 1.5rem; margin-left: auto; }
header.top nav a { color: var(--muted); font-weight: 500; }
header.top nav a[aria-current="page"] { color: var(--text); border-bottom: 2px solid var(--accent); }
main { max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.5rem 5rem; }
h1, h2, h3 { font-family: var(--font-heading); font-weight: 700; letter-spacing: -0.025em; line-height: 1.25; }
h1 { font-size: 2.25rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.5rem; margin: 0 0 1rem; }
h3 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; }
section { padding: 2rem 0; border-bottom: 1px solid var(--line); }
.meta, .mono { font-family: var(--font-mono); }
.meta { color: var(--muted); font-size: 0.875rem; margin: 0; }
.muted { color: var(--muted); }
.notice { padding: 0.75rem 1rem; border-left: 4px solid var(--accent); background: var(--surface); margin: 1rem 0 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); border: 1px solid var(--line); margin: 0; }
.tile { padding: 1.25rem 1.5rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: -1px -1px 0 0; }
.tile dt { font-size: 0.875rem; color: var(--muted); }
.tile dd { margin: 0.25rem 0 0; font-family: var(--font-heading); font-weight: 700; font-size: 1.75rem; line-height: 1.2; }
.tile dd.highlight { color: var(--highlight); }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
th, td { text-align: left; vertical-align: top; padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 500; background: var(--surface); }
td a.mono { white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
form.inline { display: inline; margin: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
button { font: inherit; font-weight: 700; cursor: pointer; border: 0; padding: 0.625rem 1.25rem; background: var(--accent); color: #0a0a0a; }
button:hover, button:focus-visible { background: var(--highlight); }
button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
button.secondary:hover, button.secondary:focus-visible { color: var(--highlight); border-color: var(--highlight); background: transparent; }
.item { padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.status { font-family: var(--font-mono); font-size: 0.875rem; color: var(--muted); }
blockquote { margin: 0.5rem 0; padding: 0.75rem 1rem; background: var(--surface); border-left: 2px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
dl.facts { display: grid; grid-template-columns: minmax(8rem, 12rem) 1fr; margin: 0.5rem 0; }
dl.facts dt, dl.facts dd { margin: 0; padding: 0.25rem 0; }
dl.facts dt { color: var(--muted); }
dl.facts dd { white-space: pre-line; }
iframe.report { width: 100%; height: 80vh; border: 1px solid var(--line); background: var(--bg); }
svg text { font-family: var(--font-mono); font-size: 12px; fill: var(--muted); }
svg .grid { stroke: var(--line); stroke-width: 1; }
svg .band { fill: var(--accent); fill-opacity: 0.18; }
svg .line { fill: none; stroke: var(--accent); stroke-width: 2; }
svg .dot { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
svg .value { fill: var(--text); font-weight: 700; }
nav.toc { padding: 1rem 1.25rem; background: var(--surface); border-left: 4px solid var(--accent); margin-bottom: 2rem; }
nav.toc ul { list-style: none; margin: 0.5rem 0 0; padding: 0; columns: 2 18rem; }
nav.toc li { margin: 0.125rem 0; break-inside: avoid; }
nav.toc li.toc-3 { padding-left: 1rem; font-size: 0.875rem; }
article.doc h1 { font-size: 2.25rem; }
article.doc h2 { margin: 2.5rem 0 1rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
article.doc ul, article.doc ol { padding-left: 1.5rem; }
article.doc li { margin: 0.375rem 0; }
article.doc code { font-family: var(--font-mono); font-size: 0.9em; background: var(--surface); padding: 0 0.25em; }
article.doc pre { background: var(--surface); padding: 1rem 1.25rem; overflow-x: auto; border-left: 2px solid var(--line); }
article.doc pre code { background: none; padding: 0; font-size: 0.875rem; }
@media (max-width: 40rem) { header.top nav { margin-left: 0; } h1 { font-size: 1.75rem; } dl.facts { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { transition: none; } }
`;
}
