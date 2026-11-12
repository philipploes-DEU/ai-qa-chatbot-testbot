# ADR 0028: Gate für Iterationen ohne Judge-Urteil

Status: angenommen am 12.11.2026

Ergebnis von Issue #133. Baut auf ADR 0019 (Iterationen ohne Judge-Urteil) und ADR 0027
(Ausgabe-Deckel für den Judge) auf.

## Kontext

Scheitert der Judge an einer Iteration, bleibt sie ohne Judge-Urteil und fällt aus Pass-Rate,
Trend, Vergleich und Gates (ADR 0019). Das ist richtig für die Aussage über das Zielsystem, lässt
aber eine Lücke in der Pipeline: Ein Judge, der überall scheitert, etwa weil
`judge.maxOutputTokens` zu knapp gesetzt ist oder der Anbieter ablehnt, reißt kein Gate. Der Lauf
endet mit `completed`, `aiqa run` mit Exit-Code 0, und `aiqa gate` prüft nur die Iterationen, die
übrig bleiben. Ein Test mit einem Deckel von 60 Tokens gegen einen echten Anbieter hat das am
12.11.2026 gezeigt.

## Entscheidung

1. Neues Gate `gates.maxUnjudgedRate` in `aiqa.yaml`, ein Anteil zwischen 0 und 1. Ohne Angabe
   gibt es das Gate nicht.
2. Gemessen wird der Anteil der Iterationen ohne Judge-Urteil an den Iterationen, für die der
   Judge gefragt wurde: ohne Urteil geteilt durch die Summe aus Iterationen mit Judge-Urteil und
   Iterationen ohne. Das Gate reißt, wenn der Anteil über der Grenze liegt.
3. Ablehnungen und Judge-Fehler zählen gleich. Eine Iteration ohne Urteil, die über ein
   Ersatzkriterium als Fehlschlag zählt (ADR 0018), zählt hier ebenfalls als ohne Urteil.
4. Entwürfe bleiben außen vor, wie bei den anderen Gates.
5. Wurde der Judge für keine Iteration gefragt, ist das Gate nicht messbar. Es gilt dann als
   übersprungen und wird genannt, wie das Regressions-Gate ohne Vorlauf.
6. Der Exit-Code von `aiqa run` bleibt unverändert. Ob ein Job scheitert, entscheidet weiter
   `aiqa gate`.

## Begründung

- Anteil statt Anzahl: Ein Anteil bedeutet bei zehn wie bei fünfhundert Iterationen dasselbe,
  und ein Plan mit mehr Iterationen braucht keine neue Grenze. `minPassRate` ist ebenfalls ein
  Anteil. Wer keinen einzigen Ausfall duldet, setzt 0.
- Nenner sind die gefragten Iterationen, nicht alle: Der Judge läuft nur für Fälle mit Rubrik
  oder Referenzantwort und nur, wenn alle Checks bestanden sind (ADR 0003). In einem Lauf mit
  vielen reinen Check-Fällen würde ein Judge, der bei jeder seiner Iterationen scheitert, sonst
  als kleiner Anteil erscheinen.
- Eigenes Gate statt geändertem Exit-Code von `aiqa run`: Der Lauf selbst ist gelungen, die
  Antworten liegen vor und lassen sich mit `aiqa judge --run` nachbewerten. Was als gescheitert
  gilt, legt die Konfiguration fest, nicht der Lauf.
- Ersatzkriterien zählen mit: Das Gate misst, wie oft der Judge ausfiel. Ob die Iteration aus
  einem anderen Grund trotzdem zählt, ändert daran nichts.

## Konsequenzen

- Bestehende Konfigurationen ändern sich nicht. Das Gate muss gesetzt werden.
- Bewertet `aiqa judge --run` die Iterationen nach, sinkt der Anteil, und das Gate kann danach
  halten. Ein späteres Judge-Urteil ersetzt den Ausfall (ADR 0019).
- Iterationen, die der Judge nie sah, weil ein Check schon scheiterte, gehören nicht zum Nenner.
  Scheitern fast alle an den Checks, steht der Anteil auf wenigen Iterationen. Dafür ist
  `minPassRate` das passende Gate.
- Das Report-Modell trägt die Zahl der Iterationen mit Judge-Urteil als eigene Kennzahl.
