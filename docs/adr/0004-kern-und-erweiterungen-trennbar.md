# ADR 0004: Kern und Erweiterungen bleiben trennbar

Status: angenommen am 10.10.2026

## Kontext

AI QA entsteht offen und soll später womöglich gegen Gebühr angeboten werden, als Erweiterung,
Katalog, Report-Design oder gehostete Plattform. Die Lizenzentscheidung ist offen (Issue #20).
Wenn Kundenlogik im Kern landet, lässt sich das später nicht mehr sauber trennen.

## Entscheidung

Der Kern (`src/`) kennt keine Kunden, keine konkreten Zielsysteme und keine Report-Gestaltung im
Detail. Erweiterungspunkte sind Interfaces:

- `TargetAdapter` für Zielsysteme
- `ModelProvider` für Modelle hinter Judge und Agenten
- `Check` für deterministische Prüfungen
- `ResultStore` für die Ablage von Läufen
- `ReportRenderer` und Themes für Reports

Kataloge liegen in `catalogs/`, Report-Themes in `src/report/themes/`, Kundeninhalte in
`workspaces/` (ignoriert).

## Begründung

- Interfaces machen Austausch ohne Umbau des Runners möglich.
- Ein getrennter Katalog erlaubt es, OWASP-Inhalte und eigene Testmuster unterschiedlich zu
  lizenzieren.
- Beiträge laufen über das DCO, damit eine spätere Umlizenzierung möglich bleibt.

## Konsequenzen

- Mehr Schnittstellen als für ein reines Skript nötig. Das ist beabsichtigt.
- Jede neue Fähigkeit beginnt mit der Frage, ob sie in den Kern oder in eine Erweiterung gehört.
  Der Spike dazu ist Issue #19.
