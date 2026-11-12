# ADR 0025: Bedingungen auf JSON-Pfade mit eigener Pass-Rate

Status: angenommen am 12.11.2026

Ergebnis von Issue #120. Baut auf ADR 0003 (deterministische Checks vor dem Judge) auf.

## Kontext

Manche Zielsysteme antworten mit JSON, etwa ein Messstand, der eine Extraktion selbst bewertet
und Treffer, Erfundenes und Kosten ausgibt. Der Check `schema` liefert dafür ein Urteil für die
ganze Antwort. Einzelne Aussagen (nichts erfunden, mindestens zwölf Treffer, eine Pflicht-Kennung
ist dabei) ließen sich nicht getrennt bewerten, und es gab je Aussage keine Pass-Rate über die
Iterationen. Der Ausweg über `mustContain` je Kennung prüft Text statt Struktur.

## Entscheidung

1. `expected.json` ist eine Liste von Bedingungen. Jede hat einen Pfad und mindestens einen
   Vergleich: `equals`, `min`, `max`, `contains`, `empty`. Mehrere Vergleiche einer Bedingung
   müssen alle zutreffen. `name` benennt die Bedingung, sonst nennen Pfad und Vergleich sie.
2. Der Check `json` schreibt je Iteration ein Urteil mit einem Kriterium je Bedingung, benannt
   `json: <Bedingung>`. Die Iteration besteht nur, wenn jede Bedingung besteht.
3. Der Report rechnet je Fall und Bedingung Pass-Rate, Wilson-Intervall und Flakiness aus den
   Kriterien und zeigt sie im Abschnitt "JSON-Bedingungen". Entwürfe und Iterationen, die nicht
   zählen, bleiben wie bei den Fällen außen vor.
4. Pfade nutzen die Syntax von `responsePath` (Feld, Index, Name in Klammern) plus `[*]` für
   jedes Element und `length` für die Länge einer Liste oder eines Texts. Ein eigenes Feld
   `length` in einem Objekt hat Vorrang. Der Parser liegt im Domänenmodell
   (`src/domain/json-condition.ts`), damit `aiqa validate` Pfade schon im Goldset prüft.
5. Ein `null` in der Antwort ist ein Wert, ein fehlendes Feld ist keiner. `empty: true` trifft
   auf beides zu, `equals: null` nur auf `null`.
6. Ist die Antwort kein JSON, scheitert jede Bedingung mit demselben Grund. Wie bei `schema`
   darf das JSON in einem Markdown-Codeblock stehen.

## Begründung

- Kriterien statt eines Urteils je Bedingung: Das Datenmodell kennt Urteile mit mehreren
  Kriterien schon vom Judge. Ein Urteil je Check hält die Zahl der Urteile je Iteration stabil,
  die Fehlschläge im Report nennen trotzdem jede verletzte Bedingung einzeln.
- Eigene Pfad-Auswertung statt einer JSONPath-Bibliothek: Gebraucht werden Feld, Index,
  Platzhalter für alle Elemente und Länge. Filterausdrücke und rekursive Suche bleiben draußen,
  ein Goldset soll ohne JSONPath-Kenntnis lesbar sein. Eine zweite Syntax neben `responsePath`
  gibt es so nicht.
- Kein Umbau von `responsePath`: `[*]` und `length` würden dort Antworttext, Captures und
  Sitzungs-IDs betreffen. Der Check hat deshalb einen eigenen Parser mit derselben Grundsyntax.
- Eindeutige Namen je Fall: Der Report führt Bedingungen über ihren Namen zusammen. Zwei gleiche
  Namen lehnt das Schema ab.

## Konsequenzen

- Platzhalter `{{fixtures.name}}` sind in `expected.json` nicht erlaubt, `aiqa validate` meldet
  sie wie in anderen Feldern außerhalb der ersetzten Texte.
- Der Check ersetzt den Judge nicht. Kennzahlen mit Mittelwert und Streuung über Iterationen
  (etwa Kosten) sind ein eigenes Thema, `min` und `max` prüfen nur Grenzen je Iteration.
- JUnit-Export, Übergabe-Report und Vergleich zweier Läufe zeigen die Bedingungen nicht einzeln,
  sie zählen wie bisher die Iteration.
- Läufe vor dieser Entscheidung haben keine Kriterien `json: ...`, ihr Report zeigt den Abschnitt
  nicht.
