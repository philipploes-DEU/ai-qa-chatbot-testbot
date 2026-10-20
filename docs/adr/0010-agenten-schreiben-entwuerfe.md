# ADR 0010: Agenten schreiben nur Entwürfe, Zahlen kommen nie von ihnen

Status: angenommen am 11.10.2026

Ergebnis von Issue #16 (Planungsagent). Gilt auch für den Analyseagenten (Issue #17).

## Kontext

AI QA bekommt Agenten, die mit einem Sprachmodell arbeiten: der Planungsagent schlägt Testfälle
aus Fachdokumenten vor, der Analyseagent gruppiert Fehlschläge zu Hypothesen. Beide sind so
unzuverlässig wie das Modell dahinter. Ein Prüfwerkzeug, dessen Prüfgegenstand ein Agent ungeprüft
verändert, verliert seine Aussagekraft.

## Entscheidung

1. Agenten schreiben nur Entwürfe. Der Planungsagent legt Fälle mit `status: draft` in einem
   eigenen Goldset an (`goldsets/entwuerfe.yaml`), der Analyseagent Befunde mit
   `status: hypothesis`. `approved` oder `confirmed` setzt nur ein Mensch.
2. Entwürfe laufen mit, zählen aber nicht. Der Lauf hält fest, welche Fälle beim Start Entwürfe
   waren (`Run.draftCases`). Report, Trend, Vergleich und Gates lassen sie aus allen Quoten; der
   Report kennzeichnet sie. Befunde erscheinen im Report nur, wenn sie bestätigt sind.
3. Vorschläge werden deterministisch gegen ihre Quelle geprüft, bevor sie geschrieben werden. Ein
   Fall des Planungsagenten braucht ein wörtliches Zitat aus dem Dokument, jeder Pflichtbegriff
   muss im Dokument stehen, Katalog-IDs müssen im Katalog existieren. Was nicht besteht, wird
   verworfen und genannt.
4. Alle Zahlen kommen aus dem Ergebnisspeicher. Ein Agent liefert Text (Fälle, Hypothesen), nie
   Quoten, Intervalle oder Budgets. Iterationen und Budgetschätzung des Plans rechnet AI QA nach
   einer festen Regel (Iterationen nach Schwere).
5. Agenten nutzen `ModelProvider` aus `src/providers`. Das Modell steht im `agents`-Block von
   `aiqa.yaml`, ohne ihn das Modell des Judge. Tests laufen nur mit `FakeProvider`.
6. Dokumente und Antworten des Zielsystems sind im Prompt Material, keine Anweisung. Sie stehen
   zwischen Markierungen, der Systemprompt sagt das ausdrücklich.
7. Der Planungsagent erzeugt keine Angriffsmuster. Proben kommen ausschließlich aus dem Katalog.

## Begründung

- Die menschliche Freigabe ist die Stelle, an der Verantwortung entsteht. Ohne sie wäre eine
  Abnahme auf Fälle gestützt, die niemand gelesen hat.
- Entwürfe mitlaufen zu lassen zeigt früh, wie sich ein Fall verhält, ohne die Quote zu
  verfälschen.
- Die Zitatprüfung fängt die häufigste Schwäche kleiner Modelle ab: Antworten, die plausibel
  klingen, aber nicht im Dokument stehen.

## Konsequenzen

- Ein Goldset kann approved und draft mischen. Wer eine Quote liest, sieht im Report, wie viele
  Entwürfe ausgeklammert sind.
- Die Zitatprüfung ist streng (wörtlich, nur Groß- und Kleinschreibung und Leerraum egal). Ein
  Modell, das paraphrasiert, verliert Vorschläge. Das ist gewollt.
- Befunde liegen als YAML in `runs/<lauf>/findings.yaml`, damit ein Mensch den Status auch von
  Hand setzen kann. `ResultStore` hat dafür `readFindings` und `writeFindings`.
- Fachdokumente gehen an das konfigurierte Modell. Bei Kundendokumenten gehört das in die
  Absprache mit dem Kunden; ein lokales Modell hält sie auf dem Rechner.
