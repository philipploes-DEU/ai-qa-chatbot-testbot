# Mitmachen

Danke für dein Interesse an AI QA. Diese Seite beschreibt, wie Beiträge ablaufen.

## Developer Certificate of Origin

Jeder Commit braucht ein `Signed-off-by` mit deinem Namen und deiner E-Mail-Adresse. Damit
bestätigst du das Developer Certificate of Origin (DCO), nachzulesen unter
https://developercertificate.org. Kurz gesagt: du hast das Recht, den Beitrag unter der Lizenz
des Projekts einzubringen.

```
git commit -s -m "feat(checks): add refusal detector (#7)"
```

Commits ohne Sign-off werden nicht gemergt. Beiträge stehen unter derselben Lizenz wie das
Repository, der Apache License 2.0 (ADR 0011).

## Ablauf

1. Jeder Beitrag beginnt mit einem Issue. Neue Wünsche folgen dem Issue-Format: Nutzerproblem,
   Gewünschtes Verhalten, Kontext, Abgrenzung, Priorität, Bezug, Originalwortlaut. Vorlagen
   liegen unter `.github/ISSUE_TEMPLATE/`.
2. Je Issue ein Branch `<nr>-<kurzname>`, zum Beispiel `3-http-adapter`.
3. Test zuerst (TDD): fehlschlagender Test, dann Umsetzung, dann Aufräumen.
4. Pull Request gegen `main`, Squash-Merge. Merge nur bei grüner CI.

## Öffentliches Repository und Entwicklung

AI QA wird in einem privaten Repository entwickelt. Öffentlich erscheinen die Releases unter
https://github.com/philipploes-DEU/ai-qa-chatbot-testbot, je Release ein Commit (ADR 0023).
Issues sind dort willkommen. Einen Pull Request übernehme ich von Hand ins
Entwicklungs-Repository, mit dir als Autor und deinem Sign-off. Er erscheint mit dem nächsten
Release, die Release-Notes nennen deinen Beitrag. Den Pull Request schließe ich dann mit Verweis auf das
Release. Issue-Nummern in ADRs und CHANGELOG beziehen sich auf das Entwicklungs-Repository.

## Commits

Conventional Commits auf Englisch mit Issue-Nummer im Betreff.

```
feat(runner): write iterations as JSONL (#12)
```

Typen: feat, fix, docs, test, refactor, chore, ci.
Scopes: cli, domain, adapters, providers, checks, runner, judge, stats, report, agents, catalog,
goldset. Repo-weite Änderungen kommen ohne Scope aus.

## Qualität

Vor jedem Commit laufen lokal die Hooks:

- Pre-Commit: Prettier und ESLint auf den gestagten Dateien, dann gitleaks als Secret-Scan.
- Pre-Push: `pnpm typecheck` und `pnpm test`.

Umgehe die Hooks nicht mit `--no-verify`. Schlägt gitleaks an, prüfe den Fund und entferne das
Geheimnis, bevor du erneut committest.

```
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
```

## Regeln für Inhalte

- Code, Bezeichner und Commits auf Englisch. Dokumentation, Issues, Goldsets und Reports auf
  Deutsch.
- Keine Emojis, keine Ausrufezeichen, keine Gedankenstriche in Doku, Commits und Issues.
- Keine Secrets, keine Kundendaten, keine echten System-Prompts. Beispiel-Goldsets nur mit
  erfundenen Firmen, Personen und Inhalten.
- Tests machen keine Netzwerkaufrufe. Agenten und Provider werden mit Fixtures getestet.
- Architekturentscheidungen als ADR unter `docs/adr/`.
