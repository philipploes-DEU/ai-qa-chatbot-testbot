# ADR 0001: TypeScript als Sprache für den Kern

Status: angenommen am 10.10.2026

## Kontext

AI QA ist ein CLI, das gegen HTTP-APIs, OpenAI-kompatible Endpunkte und später
Browser-Oberflächen (Playwright) läuft. Die Agenten sollen über das Vercel AI SDK angebunden
werden. Kataloge, Goldsets und Konfiguration sind YAML, Ergebnisse JSONL. Das Werkzeug soll
später als Paket installierbar und zu einer gehosteten Variante erweiterbar sein.

## Entscheidung

Der Kern wird in TypeScript geschrieben: Node 22 LTS, strict, ESM, pnpm. Validierung mit Zod,
Tests mit Vitest, CLI mit commander.

## Begründung

- Playwright und das Vercel AI SDK sind im Node-Ökosystem zu Hause.
- Zod liefert Schema und Typ aus einer Quelle. Das hält Datenmodell, Validierung und
  Agenten-Ausgaben konsistent.
- Ein npm-Paket ist für Nutzer mit Node direkt installierbar, ohne weitere Laufzeit.
- Eine spätere gehostete Variante teilt Sprache und Typen mit dem CLI.

## Konsequenzen

- Python-Werkzeuge aus dem Umfeld von promptfoo werden nicht direkt genutzt. Ein Import von
  promptfoo-Fällen bleibt als Spike offen (Issue #21).
- Code, Bezeichner und Commits sind Englisch, Dokumentation und Goldsets Deutsch.
- Die Entscheidung ist getroffen und wird nicht erneut diskutiert.
