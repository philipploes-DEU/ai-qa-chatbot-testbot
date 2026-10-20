# ADR 0003: Deterministische Checks laufen vor dem Judge

Status: angenommen am 10.10.2026

## Kontext

Antworten von KI-Schnittstellen sind nicht deterministisch. Ihre Bewertung braucht deshalb in der
Regel einen Richter: ein zweites Modell, das nach einer Rubrik urteilt. Daneben gibt es
Eigenschaften, die sich mit festen Regeln prüfen lassen (enthält, enthält nicht, Regex,
JSON-Schema, Verweigerung, Leck, Latenz). Ein Richter kostet Geld, ist selbst nicht deterministisch
und muss kalibriert werden.

## Entscheidung

Jede Antwort durchläuft zuerst die deterministischen Checks. Jeder Check erzeugt ein eigenes
Urteil mit `source: check`. Der Judge-Agent kommt danach und erzeugt Urteile mit
`source: judge`. Alle Urteile liegen getrennt in `verdicts.jsonl`. Ein Fall gilt in einer
Iteration als bestanden, wenn alle Urteile dieser Iteration bestanden sind.

## Begründung

- Regeln sind reproduzierbar und kostenlos. Was sie entscheiden können, soll kein Modell
  entscheiden.
- Harte Fehler (Leck eines Schlüssels, fehlende Pflichtangabe, Timeout) brauchen keine
  Interpretation.
- Getrennte Urteile machen sichtbar, wo der Richter anders urteilt als die Regeln. Das ist die
  Grundlage für Kalibrierung (Issue #11).

## Konsequenzen

- Die Foundation enthält nur Checks. Der Judge ist Issue #6 und wird in Tests nie mit einem
  Live-Modell verbunden.
- Die Statistik (Pass-Rate, Wilson-Intervall, Flakiness) arbeitet auf dem kombinierten Ergebnis
  je Iteration und ist unabhängig von der Quelle des Urteils.
- Die Latenz-Erwartung (`expectations.maxLatencyMs`) ist ein Check und erzeugt ein Urteil. Der
  technische Abbruch (`timeouts.requestMs`) ist davon getrennt und zählt als Fehler der
  Iteration.
