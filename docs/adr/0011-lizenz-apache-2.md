# ADR 0011: Apache 2.0 für den Kern, Kataloge nur mit eigenen Worten

Status: angenommen am 11.10.2026

Ergebnis von Issue #20. Baut auf ADR 0004 und ADR 0007 auf.

## Kontext

Bis hierher stand im Repository ein Platzhalter ohne Nutzungsrechte. Vor der Veröffentlichung
muss klar sein, unter welcher Lizenz der Kern steht. Zur Wahl standen Open Core mit Apache 2.0,
Dual Licensing mit AGPL und kommerzieller Lizenz sowie Source available (BSL, FSL, PolyForm
Noncommercial). Zusätzlich offen: wie die OWASP-Quellen unter CC BY-SA 4.0 in die Kataloge
eingehen dürfen.

## Entscheidung

1. Der Kern steht unter der Apache License 2.0. `LICENSE` enthält den Lizenztext, `NOTICE` den
   Urheber (Philipp Löschner) und die Drittmaterialien. `package.json` nennt `Apache-2.0`.
   Ergänzt am 20.10.2026: NOTICE, README und `author` in `package.json` nennen Wirkmittel AI
   mit https://wirkmittel.ai als Herausgeber, die Copyright-Zeile bleibt beim Urheber.
2. Open Core, einfach gehalten: alles in diesem Repository ist Apache 2.0, auch das HTML-Theme
   im Wirkmittel-Design. Bezahlbare Angebote (weitere Kataloge, gehostete Variante, Betreuung)
   entstehen bei Bedarf in eigenen Repositories mit eigener Lizenz, wie in ADR 0007
   beschrieben. Das ersetzt dort die Einordnung des Themes als bezahlte Erweiterung.
3. Kataloge enthalten von OWASP nur IDs, Titel und den Link zur Quelle. Kurzfassungen,
   Prüfansätze und Testmuster sind eigene Formulierungen. Originaltexte werden nicht
   eingebettet, damit die ShareAlike-Pflicht von CC BY-SA 4.0 nicht auf das Repository
   durchgreift. Wer Originaltexte braucht, folgt dem Link.
4. Die Schriften Inter und Space Grotesk stehen unter der SIL Open Font License 1.1. Sie
   dürfen mit Software gebündelt und in Reports eingebettet werden, die Lizenztexte liegen in
   `assets/fonts`.
5. Beiträge kommen mit Developer Certificate of Origin (`git commit -s`) und stehen unter
   derselben Lizenz wie das Repository.

## Begründung

- Apache 2.0 ist die einfachste Lizenz für Nutzer und Beitragende: bekannt, mit
  Patentklausel, ohne Pflicht zur Offenlegung eigener Änderungen. Ein Prüfwerkzeug lebt davon,
  dass Teams es ohne Rechtsabteilung einsetzen können.
- Eine Non-Commercial- oder Source-available-Lizenz hätte geschäftliche Nutzer abgeschreckt und
  Beiträge erschwert. Der Wert eines Angebots gegen Gebühr liegt nach ADR 0007 ohnehin in
  Inhalten und Betrieb, nicht in abgeschalteten Funktionen.
- Dual Licensing mit AGPL bräuchte für jeden Beitrag eine Rechteeinräumung und lohnt sich erst
  bei echter Nachfrage nach einer kommerziellen Lizenz.

## Konsequenzen

- Jeder darf AI QA nutzen, verändern und weitergeben, auch geschäftlich und als Dienst, solange
  `LICENSE` und `NOTICE` mitgehen. Ein Wettbewerber kann den Kern betreiben. Das ist bewusst
  in Kauf genommen.
- Eine spätere Änderung der Lizenz gilt nur für neue Versionen. Bereits veröffentlichte Stände
  bleiben Apache 2.0.
- Neue Kataloge folgen Punkt 3. Ein Katalog, der fremde Texte übernimmt, braucht deren Lizenz im
  `license`-Feld und gehört in ein eigenes Paket.
- Keine Rechtsberatung. Vor einem kommerziellen Angebot mit Verträgen lohnt eine Rücksprache mit
  jemandem, der Softwarelizenzen macht. Die Markenprüfung des Namens bleibt ein eigenes Thema.
