# ADR 0023: Öffentliches Release-Repository per Export

Status: angenommen am 20.10.2026, umgesetzt am 20.10.2026

Ergebnis von Issue #102, ersetzt den Weg aus Issue #22. Baut auf ADR 0011 (Apache 2.0) auf.

## Kontext

AI QA soll öffentlich werden. Das Entwicklungs-Repository ist aber auch Arbeitsumgebung:
interne Arbeitsregeln für die Entwicklung mit Claude Code, Briefings, Issues und PRs mit
Bezügen zu Prüfungen echter Zielsysteme. Auch seine Historie enthält Angaben, die nicht
öffentlich sein sollen.

Ein Repository lässt sich nicht kurzzeitig öffentlich stellen: Klone, Forks und Archive
bleiben, und wer eine Kopie hat, darf sie unter Apache 2.0 nutzen. Ein einmaliges Bereinigen und
danach öffentlich entwickeln würde die Arbeitsweise ändern und bei jedem Commit Aufmerksamkeit
verlangen.

## Entscheidung

1. Zwei Rollen. Das Entwicklungs-Repository bleibt privat, mit Historie, Issues, PRs und den
   internen Regeln. Öffentlich gibt es nur Releases.
2. Das öffentliche Repository heißt `ai-qa-chatbot-testbot`, Anzeigename "AI QA: Der
   Chatbot-Testbot". Es hat eine eigene Historie mit einem Commit "Release v0.x.y" je Release,
   mit Tag und GitHub Release. Der Befehl bleibt `aiqa`, `package.json` bleibt `private`, es gibt
   keine Veröffentlichung auf npm. ADR 0011 gilt für das Release-Repository: Apache 2.0, NOTICE
   und die Lizenzen der Schriften gehen mit.
3. Ein Exportskript (`pnpm exec tsx release/export.ts <ziel>`) baut den öffentlichen Stand nach
   einer Positivliste in `release/export.yaml`, die jeden Pfad einzeln nennt. Es hat keinen
   Eintrag in `package.json`, sonst enthielte der Export ein Skript ohne Datei. Neue Dateien sind erst
   öffentlich, wenn jemand sie bewusst aufnimmt. Die Liste umfasst:
   - Code und Daten: `src`, `assets`, `catalogs`, `examples`, `goldsets/beispiel`, `specs`,
     `tests` mit Fixtures und Helfern, `aiqa.yaml`, `workspaces/.gitkeep`.
   - Bauen und Prüfen: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, die
     TypeScript-, Vitest-, ESLint- und Prettier-Konfiguration, `scripts`, `.gitleaks.toml`,
     `.gitignore`, `.gitattributes`, `.env.example`, `cliff.toml`, `.husky` und die CI
     `.github/workflows/ci.yml` mit den Vorlagen für Issues und PRs.
   - Doku: README, `docs/handbuch.md`, `docs/probenkatalog.md`, `docs/adr`, `AGENTS.md`,
     LICENSE, NOTICE, SECURITY.md, CONTRIBUTING.md, CHANGELOG und der Einrichtungs-Skill unter
     `.claude/skills/aiqa-einrichtung`.
4. Privat bleiben die internen Arbeitsregeln (`CLAUDE.md`), `docs/foundation-briefing.md`,
   `docs/konzept.md`, `docs/veroeffentlichung.md`, `spikes`, das Exportwerkzeug unter `release`
   mit seinem Workflow `.github/workflows/release-export.yml` und die übrigen Einstellungen unter
   `.claude`. Ein `AGENTS.md` mit den fachlichen Regeln für Mitwirkende (TDD, Sprache, Commits,
   Sign-off) entsteht hier im Repository und geht mit, die internen Regeln verweisen darauf.
5. Der Export verändert keinen Inhalt. Was öffentlich wird, ist schon hier so, wie es öffentlich
   sein soll, und hier getestet. Dafür gilt für alle exportierten Dateien: keine Namen echter
   Zielsysteme, keine Testdaten, die auf deren Fehler schließen lassen, keine Personennamen außer
   als Urheber, keine Verweise auf private Dateien, Klon- und Vorlagen-Adressen zeigen auf das
   öffentliche Repository. Issue-Nummern in ADRs und CHANGELOG beziehen sich auf das
   Entwicklungs-Repository, ein Hinweis in `docs/adr/README.md` und im Kopf des CHANGELOG sagt
   das.
6. Ein Test im privaten Repository baut den Export und prüft: nur Pfade der Positivliste, kein
   Verweis auf einen nicht exportierten Pfad, keine Begriffe einer Sperrliste (Namen echter
   Zielsysteme, private Adressen, Projekt-IDs), Secret-Scan, und Installation, Lint, Typecheck,
   Format und Tests im exportierten Stand sind grün. Die ersten drei Prüfungen laufen in
   `release/export.test.ts` bei jedem `pnpm test`, alle zusammen im Workflow `release-export`
   bei jedem PR. Der Export bricht ab, bevor er etwas schreibt, wenn eine Prüfung scheitert.
7. Veröffentlicht wird je Release erst nach Freigabe und zunächst von Hand. Eine Automatik per
   Deploy Key braucht ein Geheimnis in den Einstellungen und kommt als eigenes Issue.
8. Im öffentlichen Repository sind Secret Scanning, Push Protection und Branch-Schutz
   eingeschaltet, dort kostenlos. Issues sind offen für Rückmeldungen. PRs von außen werden im
   Entwicklungs-Repository übernommen: der Commit behält den Beitragenden als Autor und sein
   Sign-off, die Release-Notes nennen die Beiträge. Der PR im öffentlichen Repository wird mit
   Verweis auf das Release geschlossen.

## Begründung

- Die Arbeitsweise mit internen Regeln und echten Zielsystemen bleibt, ohne dass jeder Commit
  ein Veröffentlichungsrisiko ist.
- Eine Positivliste macht Vergessen sicher: Was niemand aufnimmt, bleibt privat. Eine Sperrliste
  würde jede neue interne Datei durchlassen.
- Saubere Inhalte an der Quelle statt Umschreiben beim Export: Der öffentliche Code ist genau
  der getestete, und der Export bleibt einfach prüfbar.
- Bei einem Werkzeug für Sicherheitsprüfungen wiegt ein Leck aus der Arbeitsumgebung schwerer
  als der Aufwand für einen Export.

## Konsequenzen

- Zwei Repositories. Die Issue-Nummern unterscheiden sich, Beiträge von außen brauchen
  Handarbeit, die öffentliche Historie zeigt Releases statt einzelner Änderungen.
- Vor dem ersten Export werden hier angepasst: ADRs ohne Namen echter Zielsysteme, neutrale
  Testdaten statt Fehlertexten aus echten Prüfungen und statt Personennamen, README ohne Verweise
  auf private Dateien und mit der Klon-Adresse des öffentlichen Repositories, die Workflow-Vorlage
  von `aiqa init --with-schedule` mit dem öffentlichen Repository, `AGENTS.md` und
  `docs/adr/README.md` neu.
- `docs/veroeffentlichung.md` wird zur privaten Checkliste für jeden Export.
