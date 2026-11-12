# ADR 0027: Das Token-Budget zählt gescheiterte Aufrufe, der Judge bekommt einen Ausgabe-Deckel

Status: angenommen am 12.11.2026

Ergebnis von Issue #125. Baut auf ADR 0006 (eigene Provider-Schicht) und ADR 0019 (Iterationen
ohne Judge-Urteil) auf.

## Kontext

Ein Plan begrenzt die Kosten eines Laufs mit `budget.maxCalls` und `budget.maxTokens`. Zwei
Lücken machten `maxTokens` zu einer weichen Grenze:

1. Der Judge rief sein Modell ohne Obergrenze für die Ausgabe auf. Ein Modell, das vor der
   Antwort nachdenkt, kann je Urteil viele Ausgabe-Tokens erzeugen, und Ausgabe kostet bei den
   meisten Anbietern ein Mehrfaches der Eingabe.
2. Tokens gescheiterter Aufrufe zählten nicht. Endete ein Kommando des Adapters `script` mit
   einem Exit-Code ungleich null, las AI QA keine Tokens. Scheiterte der Judge an einer
   Ablehnung, einer abgeschnittenen Antwort oder nach der Korrektur, gingen die Tokens aller
   Versuche verloren. In solchen Läufen bremste nur noch `maxCalls`.

## Entscheidung

1. `judge.maxOutputTokens` in `aiqa.yaml` begrenzt die Ausgabe je Judge-Aufruf. AI QA sendet den
   Wert als `max_tokens`. Ohne Angabe gibt es keine Grenze, bestehende Konfigurationen verhalten
   sich wie bisher. Der Wert gilt für jedes Urteil, auch je Dialogrunde und im Paarvergleich.
2. Eine Antwort mit `finish_reason: length` ist ein Fehler des Modellaufrufs, kein Urteil und
   kein Anlass für eine Korrektur. Das gilt auch, wenn der abgeschnittene Text zufällig gültiges
   JSON ist. Für den Judge heißt das: Die Iteration bleibt ohne Judge-Urteil (ADR 0019).
3. Der Provider zählt die Tokens jeder Antwort, bevor er sie prüft. Scheitert ein Aufruf, trägt
   der Fehler die Tokens aller Versuche bis dahin. Der Lauf rechnet sie in das Budget und in die
   Judge-Tokens ein. Bei Dialogen bleiben die Tokens der schon bewerteten Runden erhalten, wenn
   eine spätere Bewertung scheitert.
4. Der Adapter `script` liest bei einem Exit-Code ungleich null `tokens` aus stdout, wenn dort
   JSON mit `tokens` steht. `content` braucht es dafür nicht. Steht dort etwas anderes, gibt es
   keine Tokenmeldung und der Fehlertext bleibt, wie er war.
5. AI QA schätzt keine Tokens. Aufrufe ohne Tokenmeldung werden gezählt, getrennt nach
   Zielsystem und Judge, und stehen als `usage.unreportedCalls` in `run.json`. `aiqa run` und
   der Übergabe-Report nennen die Zahl, sobald sie größer als null ist.

## Begründung

- Deckel am Judge statt am Budget: Das Budget wird vor jeder Iteration geprüft. Es kann einen
  einzelnen teuren Aufruf nicht verhindern, nur den nächsten. Die Obergrenze je Aufruf setzt
  dort an, wo die Kosten entstehen.
- Kein Standardwert für den Deckel: Wie viele Tokens ein Urteil braucht, hängt von Rubrik,
  Modell und Nachdenken ab. Ein zu knapper Standard würde bestehende Läufe ohne Judge-Urteil
  zurücklassen.
- Abgeschnitten ist ein Fehler, keine Korrektur: Die Korrektur liefe gegen dieselbe Grenze und
  kostete einen weiteren Aufruf ohne Aussicht.
- Zählen statt schätzen: Ein Mittelwert der bisherigen Aufrufe wäre eine erfundene Zahl im
  Report, und gescheiterte Aufrufe kosten oft anders als gelungene. Die Zahl der Aufrufe ohne
  Meldung ist messbar und sagt dem Leser, wie weit er der Token-Summe trauen kann.
- Verbrauch am Fehler statt eigener Fehlerklasse: Der Provider reicht auch fremde Fehler durch,
  etwa einen HTTP-Status oder eine Zeitüberschreitung. Sie behalten Klasse und Meldung, der
  Verbrauch hängt daneben.

## Konsequenzen

- `maxTokens` bleibt eine Prüfung vor jeder Iteration. Die Iteration, die das Budget
  überschreitet, läuft noch zu Ende. Der Überschuss ist höchstens der Verbrauch einer Iteration
  samt Judge.
- Ein Aufruf ohne Antwort, etwa bei Zeitüberschreitung oder Netzfehler, meldet keine Tokens. Er
  steht in `unreportedCalls`. Ob er beim Anbieter Kosten verursacht hat, weiß AI QA nicht.
- Ob Tokens für das Nachdenken unter `max_tokens` fallen, legt der Anbieter fest. Ein knapper
  Deckel kann bei solchen Modellen jede Antwort abschneiden. Dann steigen die Judge-Fehler, und
  der Report zeigt die Iterationen ohne Judge-Urteil.
- Zielsysteme, die nie Tokens melden, stehen mit jedem Aufruf in `unreportedCalls`. Das ist
  gewollt: Für sie begrenzt `maxTokens` nur den Judge.
- Läufe aus Versionen vor dieser Entscheidung haben kein `unreportedCalls`. Der Übergabe-Report
  behält für sie den Hinweis, dass Tokens gescheiterter Judge-Aufrufe fehlen.
- `aiqa check --run` schreibt für den nachgerechneten Lauf null Aufrufe ohne Tokenmeldung
  (ADR 0026).
