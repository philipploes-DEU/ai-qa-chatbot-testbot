# ADR 0002: Dateien statt Datenbank für Ergebnisse

Status: angenommen am 10.10.2026

## Kontext

Jeder Lauf erzeugt Iterationen (Anfrage, Antwort, Latenz) und Urteile (Check oder Judge). Nutzer
wollen Läufe vergleichen, Reports bauen und Ergebnisse im eigenen Repository oder Arbeitsbereich
ablegen. Eine Datenbank würde Betrieb, Zugangsdaten und ein weiteres System bedeuten.

## Entscheidung

Ergebnisse liegen als Dateien unter `runs/<run-id>/`: `run.json` mit den Metadaten des Laufs,
`iterations.jsonl` und `verdicts.jsonl` mit einer Zeile je Eintrag. Der Zugriff läuft
ausschließlich über das Interface `ResultStore`. Die einzige Implementierung in der Foundation
ist `FileResultStore`.

## Begründung

- JSONL ist anhängbar, streambar und mit Standardwerkzeugen lesbar (grep, jq).
- Läufe lassen sich in Git versionieren oder als CI-Artefakt ablegen, ohne Server.
- Keine Zugangsdaten, kein Betrieb, keine Migrationen in der ersten Phase.

## Konsequenzen

- Vergleich und Trend über viele Läufe sind Dateiarbeit, bis ein anderer Store kommt
  (Issue #15 für den Vergleich zweier Läufe).
- Eine spätere Variante mit Supabase oder einer gehosteten Plattform implementiert
  `ResultStore`, ohne den Runner anzufassen.
- `runs/` und `reports/` stehen in der `.gitignore` des Kern-Repos, weil sie Antworten des
  Zielsystems enthalten können.
