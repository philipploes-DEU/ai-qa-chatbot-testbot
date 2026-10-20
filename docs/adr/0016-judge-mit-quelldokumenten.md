# ADR 0016: Judge mit Quelldokumenten

Status: angenommen am 13.10.2026

Ergebnis von Issue #70. Erweitert den Judge aus Issue #6.

## Kontext

Der Judge kannte bisher nur Rubrik und Referenzantwort. Realistische Zielsysteme nennen oft
mehr als die Referenz, etwa Express und Sperrgut zusätzlich zum Standardversand. Im Lauf gegen
den advanced-bot (#66) wertete der Judge solche richtigen Zusatzangaben als erfunden, etwa bei
den Fällen `versand-kosten-de` und `versand-oesterreich`. Das erzeugt falsche Fehlschläge und
verleitet dazu, Rubriken künstlich aufzuweichen.

## Entscheidung

1. Ein Goldset kann unter `sources` Quelldokumente angeben, als Pfade relativ zur
   Goldset-Datei. Typisch ist die Wissensbasis des Zielsystems.
2. Neuer Judge-Prompt `v2`. Er erklärt Quelldokumente: Angaben über die Referenz hinaus prüft
   der Judge dagegen, belegt ist richtig, widersprüchlich oder unbelegt gilt als erfunden. Bei
   einem Widerspruch geht die Referenz vor. `v2` ist Standard für neue Läufe, `v1` bleibt
   wählbar und bekommt keine Quellen. Ein Plan, der `v1` festhält, läuft unverändert.
3. Die Dokumente stehen im Auftrag zwischen `<<<QUELLEN` und `QUELLEN>>>`, nach der
   Referenzantwort und vor der Rubrik. Sie sind Daten, keine Anweisungen, wie die Antwort des
   Zielsystems und die Dokumente der Agenten (ADR 0010).
4. Sie gehen in jede Bewertung einer Antwort, auch in die Runden eines Dialogs, nicht in das
   Urteil über das ganze Gespräch.
5. Obergrenze `judge.maxSourceChars` je Goldset, Standard 60000 Zeichen. Darüber kürzt AI QA
   von hinten und vermerkt das als Hinweis im Lauf und damit im Report.
6. `aiqa run` nennt vor dem Lauf die geschätzten Tokens je Judge-Aufruf (vier Zeichen je
   Token) und die zusätzliche Eingabe über alle möglichen Judge-Aufrufe.
7. `aiqa calibrate` und `aiqa judge --run` nutzen dieselben Dokumente, damit Kalibrierung und
   Lauf denselben Judge messen.

## Begründung

- Die Quellen gehören zum Goldset, weil Fälle und Wissensstand zusammen gepflegt werden. Ein
  Arbeitsbereich mit mehreren Goldsets kann verschiedene Quellen haben.
- Eine neue Prompt-Version macht die Änderung in jedem Urteil sichtbar und hält ältere Läufe
  vergleichbar. Kalibrierungen gelten je Prompt-Version, ein Judge mit `v2` muss also neu
  kalibriert werden.
- Vollständige Dokumente im Prompt sind einfach, nachvollziehbar und brauchen keine
  Einbettungen. Für Wissensbasen in der Größe typischer Chatbots reicht das.

## Konsequenzen

- Jeder Judge-Aufruf wird um die Quellen länger. Bei großen Modellen kostet das spürbar, die
  Schätzung vor dem Lauf macht das sichtbar.
- Gekürzte Quellen können zu falschen Fehlschlägen führen, deshalb der Hinweis im Report.
- Kein Retrieval und keine Einbettungen in dieser Fassung. Quellen, die das Zielsystem selbst
  in seiner Antwort mitliefert, etwa Belege einer Dokumentensuche, sind ein eigenes Thema. Die
  Schnittstelle des Judge nimmt Quellen je Aufruf und lässt das später zu.
- Der Paarvergleich (`aiqa compare --pairwise`) nutzt die Quellen noch nicht.
