# Sicherheit

## Sicherheitslücken melden

Melde Sicherheitslücken bitte nicht als öffentliches Issue. Nutze die private Meldung über
GitHub (Tab Security des Repositories, "Report a vulnerability"). Beschreibe, was du beobachtet
hast, wie es sich reproduzieren lässt und welche Auswirkung du erwartest. Du bekommst innerhalb
von zehn Werktagen eine Rückmeldung.

## Was in den Geltungsbereich fällt

- Der Kern von AI QA (`src/`): CLI, Parser für YAML und JSONL, Adapter, Checks, Runner, Report.
- Die mitgelieferten Kataloge und Beispiel-Goldsets.
- Die Build- und Hook-Konfiguration des Repositories.

Nicht im Geltungsbereich: Schwächen der geprüften Zielsysteme. AI QA findet solche Schwächen, sie
sind Befunde für den Betreiber des Zielsystems, nicht für dieses Projekt.

## Umgang mit Daten

- AI QA speichert Anfragen und Antworten des Zielsystems lokal unter `runs/` als JSONL. Darin
  kann stehen, was das Zielsystem geantwortet hat, also auch versehentlich preisgegebene Inhalte.
  Behandle `runs/` und `reports/` wie vertrauliche Daten.
- Zugangsdaten gehören in Umgebungsvariablen. `aiqa.yaml` verweist nur mit `${NAME}` auf sie und
  enthält nie Werte.
- Kundendaten, echte System-Prompts und Goldsets mit echten Inhalten gehören in einen
  Arbeitsbereich unter `workspaces/` oder in ein eigenes Repository, nie in den Kern.
- `workspaces/`, `runs/`, `reports/` und `.env` sind in `.gitignore`.

## Schutz des Repositories

- Pre-Commit-Hook mit gitleaks blockt Commits mit erkennbaren Schlüsselmustern.
- Die CI scannt die gesamte Historie mit gitleaks als zweite Verteidigungslinie.
- Tests und CI machen keine Netzwerkaufrufe an LLM-Anbieter oder Zielsysteme.

## Unterstützte Versionen

Vor Version 0.1.0 gibt es keine Releases. Sicherheitsrelevante Korrekturen landen auf `main` und
im nächsten Release.
