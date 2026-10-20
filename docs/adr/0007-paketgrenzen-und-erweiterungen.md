# ADR 0007: Ein Paket mit öffentlichem Einstieg, Erweiterungen als Pakete mit Manifest

Status: angenommen am 11.10.2026

Ergebnis des Spikes aus Issue #19. Er baut auf ADR 0004 auf (Kern und Erweiterungen bleiben
trennbar) und bereitet die Lizenzentscheidung in Issue #20 vor.

## Kontext

AI QA soll später möglicherweise gegen Gebühr angeboten werden: zusätzliche Kataloge,
Report-Designs, eine gehostete Variante. Heute ist das Repository ein einzelnes npm-Paket
`ai-qa` mit dem Befehl `aiqa`, ausgeliefert werden `dist/` und `catalogs/`. Es gab keinen
öffentlichen Programmeinstieg, nur die CLI. Der Spike hat geprüft: Paketgrenzen, wie externe
Kataloge und Themes geladen und geprüft werden, was der Kern ohne Erweiterungen kann, wie ein
Arbeitsbereich den Kern nutzt, und ob `ResultStore` und `ReportRenderer` als Schnittstellen
reichen.

## Entscheidung

1. Ein Paket, solange es nur den Kern gibt. `ai-qa` bleibt ein Paket mit CLI und einem
   öffentlichen Einstieg `src/index.ts`, der die Erweiterungspunkte exportiert: `TargetAdapter`,
   `Check`, `ModelProvider`, `Judge`, `ResultStore`, `ReportRenderer`, die Zod-Schemas und die
   Lader. `package.json` nennt `main`, `types` und `exports`. Ein Monorepo entsteht erst mit dem
   ersten zweiten Paket; pnpm Workspaces sind dafür vorbereitet (`pnpm-workspace.yaml` existiert).
   Dann heißen die Pakete `@wirkmittel/aiqa-core`, `@wirkmittel/aiqa-catalog-<name>` und
   `@wirkmittel/aiqa-theme-<name>`; `ai-qa` bleibt als Metapaket mit der CLI.
2. Kataloge und Themes sind Daten beziehungsweise kleine Module, nie Code im Kern. Ein
   Katalogpaket ist ein npm-Paket mit YAML-Dateien und einem Manifest in seiner `package.json`:
   `"aiqa": { "catalogs": ["catalogs/llm03.yaml"], "themes": [] }`. Der Kern lädt es über
   den Modulpfad des Arbeitsbereichs (`createRequire(workspaceDir)`), liest die Dateien und prüft
   sie mit denselben Schemas wie lokale Dateien (`CatalogSchema`, `ProbeCatalogSchema`). Ein
   Katalog aus einem Paket muss `version` und `license` tragen. In `aiqa.yaml` steht ein Paket
   als `pkg:@wirkmittel/aiqa-catalog-llm03` neben lokalen Pfaden. Themes exportieren ein
   `ReportTheme`-Objekt und werden über ihren Namen gewählt. Die Umsetzung des `pkg:`-Laders
   kommt mit dem ersten echten Katalogpaket, nicht vorher.
3. Der Kern ist ohne Erweiterungen vollständig nutzbar: alle Adapter, Judge, Statistik, die
   mitgelieferten OWASP-Kataloge in eigenen Worten, der Markdown-Report mit Standard-Theme,
   Vergleich, Gates und Workflow-Vorlage. Der Kern prüft keine Lizenzschlüssel und ruft nirgends
   nach Hause. Bezahlbar sind Inhalte und Komfort: weitere Kataloge, das HTML-Theme im
   Wirkmittel-Design (Issue #18), eine gehostete Variante mit Trend und Benachrichtigung.
4. Ein Arbeitsbereich ist ein eigenes Repository, das den Kern als Abhängigkeit nutzt:
   `pnpm add ai-qa` nach der ersten Veröffentlichung, bis dahin der Checkout des Repositorys
   wie in der Workflow-Vorlage. Der Arbeitsbereich enthält `aiqa.yaml`, Goldsets, Specs, den
   Workflow und seine Läufe, nie den Kern.
5. `ResultStore` reicht für Läufe, Iterationen, Urteile und Kalibrierungen. Vergleiche,
   Gate-Ergebnisse und Paarurteile schreibt die CLI heute direkt als Dateien unter `reports/`.
   Für eine gehostete Variante wandern sie in den Store (`writeArtifact`), erst dann.
   `ReportRenderer` reicht für den Lauf-Report; der Vergleich hat eine eigene Render-Funktion.
   Eine gemeinsame Schnittstelle `Renderer<Model>` entsteht mit dem HTML-Theme (Issue #18), wenn
   zwei Formate je Modell existieren.

## Begründung

- Ein Paket hält Versionierung, CI und Release einfach, solange nichts getrennt verkauft wird.
  Die Trennung bleibt durch Interfaces und den öffentlichen Einstieg vorbereitet, nicht durch
  Paketgrenzen, die niemand braucht.
- Kataloge als Daten mit Manifest lassen sich einzeln lizenzieren und versionieren, ohne dass
  der Kern sie kennt. Dieselben Schemas für lokale und paketierte Kataloge halten `validate`
  ehrlich.
- Ein Kern, der ohne Bezahlung alles kann, ist für Open Core oder eine Non-Commercial-Lizenz
  (Issue #20) die saubere Basis: der Unterschied liegt in Inhalten und Betrieb, nicht in
  abgeschalteten Funktionen.

## Konsequenzen

- `src/index.ts` ist ab jetzt öffentliche Schnittstelle. Änderungen daran sind Breaking Changes
  und folgen SemVer.
- Der `pkg:`-Lader und das Manifest sind beschrieben, aber nicht gebaut. Das erste Katalogpaket
  bringt sie mit und ist ein eigenes Issue.
- Bezahlbare Erweiterungen entstehen in eigenen Repositories mit eigener Lizenz. Der Kern
  bekommt keine Abhängigkeit auf sie.
