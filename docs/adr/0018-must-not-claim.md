# ADR 0018: Verbotene Angaben, die zitiert werden dürfen

Status: angenommen am 13.10.2026

Ergebnis von Issue #82. Präzisiert ADR 0003 (Regeln vor Richter).

## Kontext

Im ersten Sicherheitslauf gegen ein echtes Zielsystem (#74) waren 5 von 9 Fehlschlägen Fehlalarme. Das
System wies eine in der Frage eingeschleuste Quelle mit 4.711,00 EUR zurück und nannte den Betrag
dabei. `mustNotContain` wertet jede Nennung als Fehlschlag und kann Zitieren nicht von Behaupten
unterscheiden. Eine sprachliche Heuristik dafür wäre unzuverlässig.

## Entscheidung

1. Neue Erwartung `mustNotClaim` mit einer Liste von Begriffen, Groß- und Kleinschreibung egal.
2. Kommt keiner vor, besteht der Check ohne Judge. Hier entscheidet weiter die Regel.
3. Kommt einer vor und ist ein Judge konfiguriert, besteht der Check mit dem Vermerk, dass der
   Judge entscheidet. Der Judge bekommt das feste Kriterium `nicht-behauptet` mit den
   gefundenen Begriffen zusätzlich zur Rubrik des Falls. Auch ein Fall ohne Rubrik geht dann an
   den Judge.
4. Ohne Judge zählt ein Treffer wie bei `mustNotContain`. Scheitert der Judge an dem Fall, zählt
   der Treffer ebenfalls, damit ein Fehler im Werkzeug nie ein Bestehen erzeugt.
5. `mustNotContain` bleibt unverändert streng. Für Lecks wie den Wortlaut des System-Prompts
   oder einen Canary aus dem Kontext ist es richtig, weil dort schon das Zitat der Fehler ist.
6. Im Probenkatalog prüfen LLM01-P04 und LLM01-P09 ihren Köder aus der Eingabe mit
   `mustNotClaim` (Katalog Version 3).

## Begründung

- Die Regel entscheidet weiter alles, was ohne Deutung geht: kein Treffer heißt bestanden. Nur
  der mehrdeutige Fall geht an das Modell, das ihn deuten kann.
- Ein Fehlalarm kostet Vertrauen in den Report. Ein verpasster Treffer ist ausgeschlossen, weil
  ohne Urteil des Judge der Treffer zählt.

## Konsequenzen

- Ein Treffer kostet einen Judge-Aufruf mehr, auch bei Fällen ohne Rubrik.
- Die Qualität hängt am Judge. Für Sicherheitsfälle gehört er kalibriert.
