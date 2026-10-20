# ADR 0014: Dialog-Rubrik gilt für die letzte Runde

Status: angenommen am 13.10.2026

Ergebnis von Issue #69. Ändert das Rundenurteil aus Issue #12 (Dialoge Runde für Runde).

## Kontext

Seit #12 bewertet der Judge in einem Dialogfall jede Runde und dazu das ganze Gespräch. Jede
Runde wurde an der Rubrik des ganzen Falls gemessen. Der erste echte Lauf gegen den
advanced-bot (#66) hat gezeigt, dass das falsche Fehlschläge erzeugt: Runde 1 "Hallo, ich bin
Jonas" scheiterte am Kriterium "nennt 9,90 € für Express", obwohl Express erst in Runde 2
gefragt wird.

Dazu kam ein zweiter Fehler: Hatte eine frühe Runde keine Antwort im Skript, übernahm der Judge
die Referenzantwort des ganzen Falls als Referenz für diese Runde. Die Referenzantwort beschreibt
aber das Ende des Gesprächs.

## Entscheidung

1. Die letzte Runde misst der Judge an Rubrik und Referenzantwort des Falls, mit dem Gespräch,
   wie es tatsächlich gelaufen ist, als Eingabe. Hat der Fall weder Rubrik noch
   Referenzantwort, bekommt die letzte Runde kein Rubrik-Urteil.
2. Eine frühere Runde bewertet der Judge nur, wenn das Skript dort eine Antwort hat. Diese
   Antwort ist die Referenz, die Rubrik des Falls gilt nicht. Statt des Standardkriteriums
   `Korrektheit` gilt das eigene, weichere Kriterium `passt-zur-runde`: die Antwort passt zur
   Nachricht des Nutzers in dieser Runde und widerspricht der Referenzantwort aus dem Skript
   nicht, andere Formulierungen sind in Ordnung.
3. Frühere Runden ohne Antwort im Skript bekommen kein Urteil. Die Referenzantwort des Falls
   gehört nur zur letzten Runde.
4. Das Urteil über das ganze Gespräch nach den vier festen Kriterien bleibt unverändert.
5. Report und Analyse zeigen die Urteile wie bisher je Runde, mit der Runde im Namen des
   Kriteriums, etwa "Runde 1: passt-zur-runde".
6. Der Judge-Prompt bleibt `v1`. Der Systemtext ändert sich nicht, nur welche Rubrik und
   Referenz eine Runde bekommt.

## Begründung

- Die Rubrik eines Falls beschreibt, was am Ende des Gesprächs stimmen muss. Auf frühe Runden
  angewendet, fordert sie Antworten auf Fragen, die noch nicht gestellt sind.
- Die Antwort im Skript ist eine plausible Antwort, nicht die einzige. Das Zielsystem antwortet
  in einer frühen Runde oft anders und trotzdem richtig, etwa mit einer Rückfrage in anderen
  Worten. Das Standardkriterium `Korrektheit` verlangt inhaltliche Übereinstimmung und wäre dafür
  zu streng.
- Ob das Zielsystem den Faden über alle Runden hält, misst schon das Gesamturteil mit
  `kontext-behalten` und `gespraech-vollstaendig`. Dafür braucht es keine Rubrik je Runde.

## Konsequenzen

- Dialogfälle brauchen weniger Judge-Aufrufe, wenn das Skript frühe Runden ohne Antwort lässt.
- Ältere Läufe mit Dialogfällen sind je Runde nicht direkt mit neuen vergleichbar, weil frühe
  Runden andere Kriterien hatten. Das Gesamturteil und das Urteil der letzten Runde bleiben
  vergleichbar. `aiqa judge --run` bewertet einen alten Lauf nur neu, wenn er noch kein
  Judge-Urteil hat.
- Rubriken je Runde gibt es in dieser Fassung nicht. Wer eine frühe Runde streng prüfen will,
  legt sie als eigenen Fall an.
