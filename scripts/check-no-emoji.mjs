#!/usr/bin/env node
// Rejects emoji in commit messages and pull request texts (issue #126). The rules of the
// project forbid them, and tools add them unasked, for example in an attribution line.
//
//   node scripts/check-no-emoji.mjs <file>...          the commit-msg hook passes the message file
//   node scripts/check-no-emoji.mjs --env NAME ...     the workflow passes title and text of a PR
//
// Exit code 0 without emoji, 1 with at least one, 2 when there is nothing to check or a file
// cannot be read. Findings name source, line and code point, never the emoji itself.
import { readFileSync } from "node:fs";

// Pictographs, the letters flags are built from, and the mark that turns a digit into a keycap.
// Three signs of the pictograph class are ordinary text in legal lines and stay allowed:
// copyright, registered and trademark.
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|⃣/gu;

/** The emoji in a text as { line, codePoint }, lines counted from 1. */
export function findEmoji(text) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(EMOJI)) {
      const codePoint = (match[0].codePointAt(0) ?? 0).toString(16).toUpperCase();
      findings.push({ line: index + 1, codePoint: `U+${codePoint.padStart(4, "0")}` });
    }
  }
  return findings;
}

/** The texts to check from the command line: files, and environment variables after --env. */
function sources(args) {
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env") {
      const name = args[++index];
      if (name === undefined) throw new Error("--env braucht den Namen einer Umgebungsvariable");
      result.push({ name, text: process.env[name] ?? "" });
    } else {
      result.push({ name: arg, text: readFileSync(arg, "utf8") });
    }
  }
  return result;
}

function main(args) {
  let texts;
  try {
    texts = sources(args);
  } catch (error) {
    console.error(`Emoji-Prüfung: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (texts.length === 0) {
    console.error(
      "Emoji-Prüfung: nichts zu prüfen. Aufruf: check-no-emoji.mjs <Datei>... oder --env <NAME>...",
    );
    return 2;
  }
  let found = 0;
  for (const { name, text } of texts) {
    for (const { line, codePoint } of findEmoji(text)) {
      console.error(`Emoji in ${name}, Zeile ${String(line)}: ${codePoint}`);
      found++;
    }
  }
  if (found > 0) {
    console.error(
      "Commit-Nachrichten und PR-Texte bleiben ohne Emojis. Zeichen entfernen und erneut versuchen.",
    );
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
