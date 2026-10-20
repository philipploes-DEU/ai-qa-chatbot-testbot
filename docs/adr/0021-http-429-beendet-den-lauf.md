# ADR 0021: Ein bleibendes HTTP 429 beendet den Lauf

Status: angenommen am 19.10.2026

Ergebnis von Issue #96. Ergänzt ADR 0019 (aus der Quote nehmen) und ADR 0020 (Aufwand im Lauf).

## Kontext

Im Sicherheitslauf gegen ein echtes Zielsystem (#74) antwortete das Zielsystem ab einem Aufruf
nur noch mit HTTP 429, weil das Tageslimit des Testkontos erreicht war. AI QA schickte weiter Anfragen,
wartete jeweils die Wiederholungen ab und zählte 11 Iterationen als Fehlschlag. Der Lauf musste
von Hand gestoppt werden und hatte danach weder Status noch Aufwand.

## Entscheidung

1. Bleibt ein Aufruf nach den Wiederholungen aus `rateLimit` bei HTTP 429, endet der Lauf mit
   Status `aborted` und dem Grund "Das Zielsystem lehnt weitere Anfragen ab (HTTP 429)" samt
   Text der Antwort. Der Aufruf zählt im Aufwand, die Iteration wird nicht gespeichert.
2. Erwartet der Fall `status: 429`, ist die Ablehnung das gewünschte Verhalten und der Lauf geht
   weiter (#79).
3. Iterationen, die schon mit 429 und Fehler gespeichert sind, gelten als nicht ausgeführt. Sie
   fallen aus Pass-Rate, Fehlerquoten, Trend, Gates, Vergleich und Analyse und erscheinen als
   Kennzahl "Nicht ausgeführt (HTTP 429)", nicht als technischer Fehler.
4. Strg+C beendet den Lauf nach der laufenden Iteration mit Status `aborted`, Grund und
   Aufwand. Ein zweites Strg+C beendet den Prozess sofort.
5. `rateLimit.maxCallsPerDay` nennt ein Tageslimit. `aiqa run` warnt vor dem ersten Aufruf,
   wenn der Plan mehr Aufrufe braucht. AI QA zählt keine Aufrufe über Läufe hinweg, das Limit
   kennt nur das Zielsystem.

## Begründung

- Ein abgelehnter Aufruf prüft nichts. Ihn als Fehlschlag zu zählen senkt die Quote, ihn als
  bestanden zu verwerfen hebt sie. Beides wäre falsch.
- Nach einem bleibenden 429 scheitern alle weiteren Aufrufe gleich. Weiterlaufen kostet nur
  Zeit und belastet das Zielsystem.

## Konsequenzen

- Ohne Wiederholungen (`backoff: none`) beendet schon ein einzelnes 429 den Lauf. Wer ein
  kurzes Drosseln erwartet, lässt `backoff: exponential` stehen.
- Ein abgebrochener Lauf lässt sich nicht fortsetzen. Die fehlenden Fälle laufen als eigener
  Plan, der Übergabe-Report fasst beide Läufe zusammen.
