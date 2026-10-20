# ADR 0019: Iterationen ohne Judge-Urteil

Status: angenommen am 19.10.2026

Ergebnis von Issue #83. Präzisiert ADR 0003 (Regeln vor Richter) und ADR 0006 (eigene
Provider-Schicht).

## Kontext

Im Sicherheitslauf gegen ein echtes Zielsystem (#74) lieferte der Judge Claude Sonnet 5.5 beim Fall
`ausgabe-js-link` zweimal eine leere Antwort. AI QA meldete "kein gültiges JSON", versuchte eine
Reparatur ohne Aussicht und speicherte nichts über den Ausfall. Der Report zählte beide
Iterationen nur nach ihren Checks und damit als bestanden. Ein Fehler im Werkzeug erzeugte ein
Bestehen, das widerspricht dem Grundsatz aus ADR 0018.

## Entscheidung

1. Der OpenAI-kompatible Provider erkennt eine Ablehnung des Modells und wirft
   `ModelRefusalError` mit Grund: `message.refusal` mit Text, `finish_reason` `content_filter`
   oder `refusal`, eine leere Antwort. Eine leere Antwort mit `finish_reason` `length` ist keine
   Ablehnung, sondern die Token-Grenze, und bleibt ein gewöhnlicher Fehler. Eine Antwort ohne
   `choices[0].message` bleibt ein Protokollfehler.
2. Bei einer Ablehnung gibt es keine Reparaturrunde. Sie kostet einen Aufruf und ändert nichts.
3. Scheitert der Judge an einer Iteration, schreibt der Lauf einen Eintrag nach
   `runs/<lauf>/judge-failures.jsonl`: Fall, Iteration, Art (`refusal` oder `error`), Grund,
   Judge-Modell und Prompt-Version. `ResultStore` bekommt dafür `appendJudgeFailure` und
   `readJudgeFailures`.
4. Lauf und CLI zählen Ablehnungen getrennt von Judge-Fehlern und melden je Iteration "Judge
   lehnt ab" oder "Judge-Fehler".
5. Eine Iteration ohne Judge-Urteil fällt aus der Pass-Rate, aus Fehlerquoten, Trend, Gates und
   Vergleich. Der Report weist sie als eigene Kennzahl und Liste "Ohne Judge-Urteil" aus.
   Ausnahme: Ein Treffer in `mustNotClaim` zählt nach ADR 0018 ohne Urteil als Fehlschlag. Der
   Ausfall-Eintrag trägt dafür ein Ersatzkriterium (`fallback`), das der Report als
   gescheitertes Check-Urteil wertet. Es steht bewusst nicht in `verdicts.jsonl`, sonst
   würde `aiqa judge --run` die Iteration überspringen und ein späteres Judge-Urteil könnte
   den Fehlschlag nie aufheben.
6. Ein späteres Judge-Urteil, etwa aus `aiqa judge --run`, ersetzt den Ausfall samt
   Ersatzkriterium, ob es besteht oder nicht. Scheitert der Judge erneut, gilt der letzte
   Eintrag. Lauf und Nachbewertung bilden den Eintrag mit derselben Funktion.

## Begründung

- Eine Iteration, die der Judge bewerten sollte, ist ohne sein Urteil weder bestanden noch
  gescheitert. Sie mitzuzählen verfälscht die Quote in eine der beiden Richtungen.
- Eine eigene Datei lässt Urteile Urteile bleiben. Ein Pseudo-Urteil für den Ausfall müsste
  jeder Leser von `verdicts.jsonl` kennen, sonst zählt er es falsch.
- Ältere Läufe haben die Datei nicht und zählen wie bisher.

## Konsequenzen

- Wer `ResultStore` selbst umsetzt, braucht die zwei neuen Methoden.
- Ein Judge, der oft ablehnt, senkt die Zahl der bewerteten Iterationen. Der Report macht das
  sichtbar, statt es zu verdecken. Abhilfe ist ein anderes Judge-Modell oder `aiqa judge --run`
  mit anderem Prompt, kein automatischer Wechsel.
- Ob Claude über die OpenAI-Kompatibilitätsschicht einen Sicherheitsabbruch als
  `content_filter`, als `refusal` oder als leere Antwort meldet, ist nicht belegt. Alle drei
  Wege führen zu `ModelRefusalError`.
