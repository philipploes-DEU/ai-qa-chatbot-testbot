# ADR 0008: promptfoo-Ergebnisse importieren, keine Abhängigkeit, kein Unterprozess

Status: angenommen am 11.10.2026

Ergebnis des Spikes aus Issue #21.

## Kontext

promptfoo (MIT) bringt Red-Team-Plugins für die OWASP-LLM-Risiken und Multi-Turn-Strategien
mit (Crescendo, GOAT, Hydra, Tree, Composite). Das nachzubauen wäre Verschwendung, es zu
ignorieren ließe eine Lücke im Katalog. Geprüft wurde, wie promptfoo-Ergebnisse in AI QA
erscheinen können: als Import der Ergebnisdatei, als Aufruf von promptfoo als Unterprozess
oder gar nicht.

Gemessen am 11.10.2026 mit promptfoo 0.120.0 (Echo-Provider, kein Modell, kein Netz außer
npm). Die aktuelle Version 0.124.1 verlangt Node 22.22 oder neuer; AI QA verlangt 22.12.

## Befund

- `promptfoo redteam run` erzeugt nur die Angriffsfälle (`redteam.yaml`), die Bewertung läuft
  über `promptfoo redteam eval`, das wie `eval` arbeitet. `eval --output ergebnis.json` schreibt
  die Ergebnisse, aber nur, wenn promptfoo seine lokale Datenbank beschreiben darf (`--no-write`
  liefert eine leere Liste).
- Die JSON-Datei hat auf oberster Ebene `evalId`, `results`, `config`, `shareableUrl` und
  `metadata`. `config` enthält die Konfiguration mit nur teilweise geschwärzten Werten und darf
  nicht ungeprüft in einen Arbeitsbereich wandern.
- `results.results[]` ist eine Zeile je Test und Prompt mit `vars`, `prompt.raw`,
  `provider.id`, `response.output`, `success`, `score`, `latencyMs`,
  `gradingResult.componentResults[]` (je Assertion `pass`, `score`, `reason`,
  `assertion.type`, `assertion.value`) und `metadata` mit `pluginId` und `severity`. Damit ist
  jede Zeile auf die Form einer Iteration plus Urteile von AI QA abbildbar.
- Die Plugin-IDs lassen sich auf OWASP-IDs abbilden: `prompt-extraction` auf LLM07,
  `pii:*` und `harmful:privacy` auf LLM02, `hijacking`, `excessive-agency`, `rbac` auf LLM06,
  `indirect-prompt-injection`, `bola`, `bfla` auf LLM08, `hallucination`, `overreliance` auf
  LLM09, `divergent-repetition` auf LLM10, Jailbreak-Strategien auf LLM01. Für LLM03 und LLM05
  hat promptfoo keine eigenen Plugins; dort bleibt AI QA bei eigenen Proben und Checks.
- Die Multi-Turn- und viele dynamischen Strategien brauchen ein Angreifer-Modell, mehrere davon
  in der Community-Edition den entfernten Dienst von promptfoo. Das passt nicht zu "keine
  Netzwerkaufrufe in Tests und CI" und nicht in den Kern.

## Entscheidung

AI QA importiert promptfoo-Ergebnisdateien, optional und ohne Abhängigkeit vom Paket
promptfoo. Kein Aufruf als Unterprozess, keine Plugin-Integration.

- Ein Befehl `aiqa import promptfoo --file ergebnis.json --target <name>` legt aus der Datei
  einen Lauf im Arbeitsbereich an: je Zeile eine Iteration (Anfrage aus `prompt.raw`, Antwort
  aus `response.output`, Latenz, Tokens aus `response.tokenUsage`) und je Assertion ein Urteil
  mit `source: check`, Name `promptfoo:<assertion.type>`, `pass` und `reason`. Ein Fall je
  Plugin und Testindex, `kind: probe`, `source` die OWASP-ID aus der Abbildung, `severity` aus
  `metadata.severity`. Die Fälle landen in einem erzeugten Goldset `goldsets/promptfoo-<evalId>.yaml`,
  damit Report und Vergleich sie wie eigene Proben behandeln.
- `config` und `shareableUrl` werden nicht übernommen.
- Die Abbildung von Plugin-IDs auf OWASP-IDs ist Daten (`catalogs/promptfoo-mapping.yaml`),
  nicht Code, und wird mit promptfoo-Versionen nachgezogen.
- Der Import ist ein eigenes Issue (Folgeausbau), nicht Teil dieses Spikes.

## Begründung

- Der Import nutzt, was promptfoo gut kann (Angriffserzeugung, Strategien), ohne dass der Kern
  ein Modell, einen entfernten Dienst oder ein 100-MB-Paket braucht.
- Ergebnisse als Iterationen und Urteile machen promptfoo-Befunde vergleichbar mit eigenen
  Läufen: Wiederholungen, Pass-Rate, Vergleich, Gates funktionieren unverändert.
- Ein Unterprozess würde die Versionsanforderungen von promptfoo (Node, Datenbank, Telemetrie)
  in AI QA hineinziehen und die Tests an ein Fremdprojekt binden.

## Konsequenzen

- promptfoo-Läufe bleiben Sache des Nutzers, mit eigenen Schlüsseln und Kosten. AI QA sieht nur
  die Datei.
- Die Abbildung muss bei neuen Plugins ergänzt werden. Unbekannte Plugin-IDs importiert der
  Befehl mit `source` leer und nennt sie.
- Für Multi-Turn-Angriffe gibt es in AI QA weiterhin keine eigenen Strategien (Abgrenzung aus
  Issue #12); importierte Dialoge erscheinen als einzelne Iterationen mit dem letzten Prompt.

## Nachtrag zur Umsetzung (Issue #55, 11.10.2026)

- promptfoo 0.120.0 vergibt jeder Wiederholung (`--repeat`) einen eigenen `testIdx`. Ein Fall je
  Plugin und Testindex hätte Wiederholungen in getrennte Fälle zerlegt. Umgesetzt ist daher ein
  Fall je Plugin, Strategie und Eingabetext; Wiederholungen werden Iterationen desselben Falls.
  Die Fall-IDs zählen je Plugin hoch (`pf-prompt-extraction-0`, `pf-test-0`).
- Vergleicht eine Datei mehrere Provider, verlangt der Import `--provider`, weil ein Lauf genau
  ein Zielsystem hat.
- Muster in der Zuordnung enden mit `*` für Präfixe, etwa `pii*` für alle PII-Plugins.
