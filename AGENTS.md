# Hinweise für Coding-Agenten und Mitwirkende

AI QA ist ein Prüfwerkzeug für KI-Schnittstellen, zum Beispiel Chatbots, KI-Suche oder
Assistenten. Es fährt Goldsets und OWASP-Testfälle gegen die Schnittstelle, bewertet die Antworten
mit LLM-Judges nach Rubrik und mit deterministischen Checks, sichert Fehlerquoten über Iterationen
statistisch ab und erzeugt Reports. Einstieg: [README.md](README.md), Bedienung:
[docs/handbuch.md](docs/handbuch.md), Entscheidungen: [docs/adr](docs/adr).

## Befehle

```
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm aiqa -- <befehl>
```

## Regeln

- Test zuerst: erst ein fehlschlagender Test, dann die Umsetzung. Kein Commit ohne grüne Tests,
  Lint, Typecheck und Format.
- Keine Netzwerkaufrufe in Tests. Zielsysteme und Modelle werden mit Fixtures, dem
  `DummyAdapter`, dem `FakeProvider` und Loopback-Servern getestet.
- Keine Geheimnisse und keine echten Daten in Dateien. Zugangsdaten stehen nur als `${NAME}` in
  der Konfiguration, die Werte in einer `.env`, die nie eingecheckt wird. Beispiele nutzen die
  erfundene Gartenhelden GmbH und `.example`-Adressen.
- Sprache: Code, Bezeichner und Commits auf Englisch. Dokumentation, Meldungen für Nutzer, Goldsets
  und Reports auf Deutsch, ohne Emojis, ohne Ausrufezeichen, ohne Gedankenstriche.
- Commits nach Conventional Commits mit Issue-Nummer und `Signed-off-by` (Developer Certificate
  of Origin), zum Beispiel `feat(runner): write iterations as JSONL (#12)`.
- Architekturentscheidungen als ADR in `docs/adr`. Ändert sich Sichtbares, README und Handbuch
  mitziehen.
- Die Hooks (Prettier, ESLint, gitleaks vor dem Commit, Typecheck und Tests vor dem Push) nie mit
  `--no-verify` umgehen.

Ablauf für Beiträge und das öffentliche Release-Repository: [CONTRIBUTING.md](CONTRIBUTING.md).
