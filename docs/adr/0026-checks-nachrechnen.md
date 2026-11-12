# ADR 0026: Checks auf gespeicherten Antworten nachrechnen

Status: angenommen am 12.11.2026

Ergebnis von Issue #121. Baut auf ADR 0002 (Dateien statt Datenbank), ADR 0003 (deterministische
Checks vor dem Judge) und ADR 0022 (Platzhalter aus Datenquellen) auf.

## Kontext

Ändert sich nach einem Lauf ein Check oder das Soll eines Falls, musste der ganze Lauf wiederholt
werden, obwohl die Antworten des Zielsystems gespeichert sind. Das kostet Aufrufe und Zeit. Vor
allem lässt sich so nicht trennen, ob eine andere Pass-Rate von der neuen Regel kommt oder von
einem veränderten Zielsystem. Für den Judge gibt es das Nachbewerten schon (`aiqa judge --run`),
für die Checks fehlte es.

## Entscheidung

1. `aiqa check --run <id>` wendet die deterministischen Checks mit den Goldsets von heute auf die
   gespeicherten Iterationen eines beendeten Laufs an. Kein Aufruf geht an Zielsystem oder Judge.
2. Das Ergebnis ist ein neuer Lauf mit eigener ID. Iterationen, Judge-Urteile, Iterationen ohne
   Judge-Urteil und die Bindung der Platzhalter werden aus dem Quelllauf kopiert, die Urteile
   der Checks sind neu. Der Quelllauf wird nicht verändert.
3. Die Herkunft steht in `warnings` des neuen Laufs ("Nachgerechnet aus Lauf X vom ..."). Der
   Report zeigt sie unter den Hinweisen zum Lauf. Das Lauf-Format bekommt kein neues Feld.
4. Der neue Lauf hat `usage` mit 0 Aufrufen und 0 Tokens, den Status des Quelllaufs
   (auch `aborted` mit Grund), die Goldset-Versionen von heute und als Start und Ende den
   Zeitpunkt des Nachrechnens.
5. Urteile über den Aufruf selbst bleiben, wie sie waren: `response` (Aufruf gescheitert) und
   `capture` (Wert nicht gefunden). Die gespeicherte Iteration enthält nicht, was sie brauchen.
   Ein erwarteter `status` gilt in der Fassung von heute, auch für Aufrufe ohne Antwort.
6. Fälle mit Iterationen, die es in den Goldsets nicht mehr gibt oder deren Platzhalter im
   Quelllauf keinen Wert hatten, behalten ihre Urteile unverändert und stehen in einem Hinweis.
   Ob ein Fall Entwurf ist, richtet sich nach dem Goldset von heute.
7. Der Befehl schreibt den Report des neuen Laufs und nennt, wie viele Iterationen nicht mehr
   oder jetzt bestehen und wie viele die Checks bestehen, aber kein Judge-Urteil haben.

## Begründung

- Neuer Lauf statt Überschreiben: Urteile hängen als Zeilen an einem Lauf, und eine Iteration
  besteht nur, wenn alle ihre Urteile bestehen. Neue Urteile im selben Lauf würden die alten
  nicht ersetzen. Sie zu löschen nähme dem Lauf den Stand, auf dem Reports, Befunde und Gates
  beruhen.
- Neuer Lauf statt nur ein Report: Report, Vergleich, Gates, Analyse und `aiqa judge --run`
  arbeiten auf Läufen. Als Lauf lässt sich das Nachgerechnete mit dem Quelllauf vergleichen und
  vom Judge ergänzen, ohne dass diese Befehle einen Sonderfall kennen.
- `warnings` statt eines neuen Felds: Der Hinweis ist genau das, was ein Leser wissen muss, und
  das Feld erreicht schon Markdown-, HTML- und Übergabe-Report. Ältere Versionen lesen den Lauf
  weiter.
- 0 Aufrufe in `usage`: Das Tageslimit zählt Aufrufe der Läufe eines Tages (Issue #112). Ein
  nachgerechneter Lauf hat das Zielsystem nicht belastet.
- Judge-Urteile übernehmen statt verwerfen: Sie zu erzeugen hat Geld gekostet, und die
  Abgrenzung des Issues lässt den Judge außen vor.

## Konsequenzen

- Der nachgerechnete Lauf steht als eigener Punkt im Trend und zählt für `latest` und
  `previous`. Wer danach Gates gegen `previous` prüft, vergleicht mit ihm.
- Übernommene Judge-Urteile beruhen auf Rubrik und Referenz des Quelllaufs. Ändert sich dort
  etwas, ersetzt `aiqa judge --run` sie nicht, es ergänzt nur fehlende. Dafür braucht es einen
  neuen Lauf oder ein eigenes Thema.
- Ein Treffer von `mustNotClaim` bleibt dem Judge überlassen, wenn der Quelllauf einen Judge
  hatte (ADR 0018). Kommt ein solcher Treffer erst durch das neue Soll dazu und liegt schon ein
  Judge-Urteil vor, hat der Judge ihn nicht gesehen.
- Befunde des Quelllaufs werden nicht kopiert. Sie gehören zu dessen Urteilen.
- Die Latenzgrenze kommt aus der Konfiguration von heute, die Latenz aus der gespeicherten
  Iteration.
