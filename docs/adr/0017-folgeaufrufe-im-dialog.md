# ADR 0017: Folgeaufrufe im Dialog

Status: angenommen am 13.10.2026

Ergebnis von Issue #84. Erweitert die Dialoge aus Issue #12.

## Kontext

Manche Zielsysteme bieten in der Antwort eine Folgeaktion an, die der Nutzer per Klick annimmt.
Ein echtes Zielsystem (#74) erkennt Fragen nach einer vollständigen Übersicht und bietet in einem
Feld der Antwort an, über vorgeschlagene Dokumente gründlicher zu suchen. Die Oberfläche nimmt
das Angebot an, indem sie dieselbe Frage mit den Kennungen aus dem Angebot und einem Modus für
die gründliche Suche erneut schickt. Bisher schickte AI QA jede Runde mit derselben
Vorlage und las nur den Antworttext. Solche Abläufe ließen sich nicht prüfen.

## Entscheidung

1. Ein Nutzerzug im Skript eines Dialogs kann `capture` und `bodyMerge` tragen. Andere Fälle und
   andere Rollen lehnt die Prüfung des Goldsets ab, ebenso einen Verweis auf ein `capture`, das
   in keiner früheren Runde festgelegt ist.
2. `capture` ordnet Namen einen Pfad in der JSON-Antwort zu, im Format von `responsePath`. Der
   Adapter gibt die geparste Antwort dafür als `data` zurück, nur im Speicher.
3. `bodyMerge` setzt Felder auf oberster Ebene des gerenderten JSON-Bodys. Ein Wert, der nur aus
   `{{capture.name}}` besteht, wird mit seinem Typ ersetzt. Ist der Body kein JSON-Objekt, ist
   das ein Fehler der Konfiguration.
4. Findet ein `capture` nichts, endet der Dialog. Der Fall scheitert mit dem Check `capture`,
   nicht als technischer Fehler, denn das Zielsystem hat das erwartete Angebot nicht gemacht.
   Weitere Runden werden nicht geschickt.
5. Jede Runde mit Folgeaufruf trägt in den Rohdaten `followUp`, eine kurze Beschreibung wie
   "pageIds: 4 Werte aus angebot, mode: deep". Der Judge sieht sie im Verlauf
   hinter dem Nutzerzug. Die Werte selbst landen nicht in den Rohdaten.
6. Gesendet und gespeichert werden Gesprächszüge nur mit Rolle und Inhalt. Die Felder des
   Skripts bleiben draußen.
7. Folgeaufrufe kann nur ein Adapter, der das ausdrücklich unterstützt, heute `http`. Nutzt ein
   Plan sie mit einem anderen Adapter, bricht der Lauf vor dem ersten Aufruf ab.

## Begründung

- Werte aus der Antwort und Felder im Request decken den häufigsten Fall ab: ein Angebot mit
  Kennungen, das ein Klick annimmt. Bedingungen oder Schleifen im Skript wären mehr Sprache, als
  ein Goldset braucht.
- Ein fehlendes Angebot ist eine Aussage über das Zielsystem und gehört als Urteil in die Quote.
  Ein Abbruch spart Kontingent, weil der Folgeaufruf ohne Angebot nichts prüfen würde.
- Die Beschreibung des Folgeaufrufs gibt dem Judge den Kontext, warum dieselbe Frage zweimal im
  Verlauf steht.

## Konsequenzen

- Variablen je Fall (#80) können später dieselbe Ersetzung nutzen.
- Zugangsdaten gehören nie in `capture` oder `bodyMerge`, sie bleiben Sache der Auth.
- Andere Adapter lassen sich nachrüsten, sobald ein Zielsystem es braucht.
