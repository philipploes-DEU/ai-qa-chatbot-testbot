# ADR 0013: Von promptfoo erzeugte Angriffe als Entwürfe mit Vorlage je Plugin

Status: angenommen am 11.10.2026

Ergebnis von Issue #58. Ergänzt ADR 0008 (Import der Ergebnisse) und folgt ADR 0010 (Entwürfe).

## Kontext

promptfoo erzeugt mit `promptfoo redteam generate` Angriffe zu OWASP-Risiken und schreibt sie in
eine `redteam.yaml`. Der Import aus ADR 0008 übernimmt nur Ergebnisse eines promptfoo-Laufs.
Wer die Angriffe selbst mit AI QA fahren will, mit Wiederholungen, Statistik, Vergleich und Gates,
braucht sie als Fälle mit Erwartung. promptfoo bewertet seine Angriffe mit eigenen,
modellgestützten Assertions (`promptfoo:redteam:<plugin>`), die AI QA nicht ausführt.

Gemessen am 11.10.2026 mit promptfoo 0.120.0 an einer echten Datei (Plugins prompt-extraction,
pii:direct, excessive-agency, hallucination; Strategien basic und jailbreak; Angreifer-Modell
qwen2.5:7b über Ollama):

- Jeder Angriff steht unter `tests[]`, der Prompt in `vars.<injectVar>` (Standard `prompt`),
  Plugin und Schwere in `metadata.pluginId` und `metadata.severity`. Die Datei nutzt YAML-Anker.
- Die Strategie `jailbreak` erzeugt in der Datei keinen neuen Text. Sie wiederholt den
  Ausgangsprompt mit `metadata.strategyId` und einem `provider`, der den Angriff erst beim Lauf
  in promptfoo baut.
- Kleine Angreifer-Modelle setzen gelegentlich "Prompt:" vor den Angriff und halten die
  gewünschte Sprache nicht immer ein.
- Mit Claude als Angreifer-Modell scheitert die Erzeugung, weil promptfoo 0.120.0 einen
  `temperature`-Wert schickt, den aktuelle Claude-Modelle ablehnen. Einige Plugins wie
  `hijacking` brauchen den entfernten Dienst von promptfoo.

## Entscheidung

1. `aiqa import promptfoo-cases --file redteam.yaml` schreibt je Angriff einen Fall `kind: probe`
   in ein eigenes Goldset (`goldsets/promptfoo-angriffe-<datei>.yaml`, anderer Name mit `--id`).
   Alle Fälle sind Entwürfe (`status: draft`) und zählen erst nach Freigabe (ADR 0010).
2. Erwartung und Rubrik kommen je Plugin aus einer Vorlage in Daten,
   `catalogs/promptfoo-case-templates.yaml` (eigene Datei mit `--templates`): Checks wie
   `mustNotContain` mit den Variablen aus `probes.variables` und mindestens ein Rubrik-Kriterium
   für den Judge. Fehlt eine Variable, entfällt der Check und der Import nennt sie. Plugins ohne
   Vorlage werden nicht übernommen und genannt.
3. Einträge iterativer Strategien (`jailbreak*`, `crescendo`, `goat`, in der Vorlagendatei
   gepflegt) werden übersprungen und gezählt; ihr Ausgangsprompt ist schon als Fall übernommen.
   Statische Strategien, die den Text in der Datei verändern, ergeben eigene Fälle.
4. Quelle ist die OWASP-ID aus `catalogs/promptfoo-mapping.yaml`, Schwere und Plugin kommen aus
   der Datei. Ein vorangestelltes "Prompt:" wird entfernt, sonst bleibt der Text wörtlich.
5. Weiter kein Aufruf von promptfoo und keine Abhängigkeit vom Paket.

## Begründung

- Vorlagen in Daten lassen sich ohne Code ergänzen, wenn promptfoo neue Plugins bringt, und
  machen sichtbar, wonach geprüft wird.
- Entwürfe statt freigegebener Fälle, weil generierte Angriffe in Sprache und Treffsicherheit
  schwanken. Ein Mensch prüft sie, etwa in `aiqa ui` unter Entwürfe.
- Iterative Strategien lassen sich ohne Angreifer-Modell nicht nachbilden. Sie zu überspringen
  ist ehrlicher als den Ausgangsprompt mehrfach zu zählen.

## Konsequenzen

- Für die Angriffserzeugung empfiehlt die README ein lokales Modell über Ollama oder einen
  Anbieter, den promptfoo ohne `temperature`-Problem anspricht.
- Die Vorlagen bestimmen die Qualität der Prüfung. Sie sind bewusst knapp und gehören bei neuen
  Plugins oder Erkenntnissen aus Läufen nachgezogen.
