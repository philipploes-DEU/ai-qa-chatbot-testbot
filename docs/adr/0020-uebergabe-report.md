# ADR 0020: Übergabe-Report über mehrere Läufe

Status: angenommen am 19.10.2026

Ergebnis von Issue #87. Baut auf ADR 0009 (HTML-Report), ADR 0019 (ohne Judge-Urteil) und den
Befunden aus #86 auf.

## Kontext

Für eine Übergabe gehören mehrere Läufe eines Zielsystems zusammen, etwa ein Sicherheitslauf,
ein Dialoglauf und ein Test der Mandantentrennung. Bisher entstand die Zusammenfassung von
Hand neben den Reports der einzelnen Läufe. Aufrufe und Tokens eines Laufs standen nur in der
Ausgabe der CLI, bewusst nicht geprüfte Bereiche nirgends.

## Entscheidung

1. `aiqa report --run <a> --run <b>` erzeugt mit zwei oder mehr Läufen einen Übergabe-Report
   als Markdown oder HTML, Standard ist `reports/uebergabe-<neuester lauf>.md`. JUnit gibt es
   nur für einen Lauf.
2. Alle Läufe müssen dasselbe Zielsystem haben, sonst bricht der Befehl ab. Doppelte Läufe
   zählen einmal.
3. Das Modell der Übergabe entsteht aus den Report-Modellen der Läufe, die Zahlen werden nicht
   neu erfunden: Pass-Rate roh und bereinigt, Iterationen ohne Judge-Urteil, Fehlerquote je
   Kategorie summiert über die Läufe mit Wilson-Intervall.
4. Befunde: alle bestätigten Befunde der Läufe mit Lauf, Schwere, Ursache und Vorschlag, nach
   Schwere sortiert. Verworfene Befunde stehen mit Grund in einer eigenen Liste.
5. Bewusst nicht geprüft: neues optionales Feld `outOfScope` (Liste von Sätzen) in Plan und
   Goldset. Der Lauf übernimmt beide in `run.json`, der Report führt sie ohne Dubletten auf.
6. Aufwand: der Lauf schreibt beim Abschluss `usage` nach `run.json`, mit Aufrufen des
   Zielsystems sowie Tokens von Zielsystem und Judge getrennt. Ältere Läufe ohne `usage`
   erscheinen als "nicht erfasst".
7. Grenzen: abgebrochene Läufe, Entwürfe, Iterationen je Fall mit der unteren Grenze des
   Wilson-Intervalls bei vollem Bestehen, Kalibrierung des Judge, Quelldokumente je Goldset,
   Iterationen ohne Judge-Urteil und die Hinweise der Läufe. Für die Quellen hält der Lauf je
   Goldset die Zahl der Dokumente fest, die der Judge gelesen hat.

## Begründung

- Wer übergibt, braucht eine Aussage über das Zielsystem, nicht drei Dateien. Die Zahlen
  bleiben dieselben wie in den Einzelreports, weil sie aus denselben Modellen stammen.
- Was nicht geprüft wurde, gehört in die Übergabe, sonst liest der Empfänger eine hohe Quote als
  Freigabe für Bereiche, die nie getestet wurden. Die Angabe gehört zu Plan und Goldset, weil
  dort die Entscheidung fällt.
- Aufwand in `run.json` macht den Report reproduzierbar, ohne die Ausgabe der CLI aufzuheben.

## Konsequenzen

- `Run` bekommt `outOfScope` und `usage`, `RunGoldsetRef` die Zahl der Quelldokumente.
  `RunOutcome` trägt `usage` bis in den Store.
- Kein PDF. Das HTML lädt nichts nach und lässt sich weitergeben.
- Läufe verschiedener Zielsysteme lassen sich nicht zusammenfassen. Dafür bleibt
  `aiqa compare`.
