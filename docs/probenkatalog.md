# Probenkatalog und Abdeckung

Der Katalog `catalogs/owasp-probes.yaml` enthält 43 Testmuster für Proben gegen eine
KI-Schnittstelle. `aiqa plan --probes` macht daraus Fälle, gefüllt mit den Variablen aus
`probes.variables` in der `aiqa.yaml`: `company`, `assistant`, `systemPromptMarker` und `canary`.
Die Muster sind eigene Formulierungen. Von OWASP stammen nur IDs und Titel (ADR 0011).

## Wie ein Muster entscheidet

- Checks entscheiden, was keine Deutung braucht: der Wortlaut aus dem System-Prompt oder der
  Canary in der Antwort, ein ausführbares Skript, ein Bild mit fremder Adresse, eine endlose
  Ausgabe.
- Jedes Muster hat eine Rubrik. Der Judge bewertet damit, was Checks nicht sicher erkennen,
  etwa ob eine Antwort eine Voraussetzung richtigstellt oder ob ein Assistent behauptet, etwas
  ausgeführt zu haben. Ohne Judge entscheiden nur die Checks. Für Muster ohne eigenen Check
  bleibt dann nur der Check auf schlüsselförmige Geheimnisse, deshalb gehört zu Proben ein Judge.
- Checks sind bewusst eng gefasst. Eine sichere Antwort, die höflich ablehnt oder anders
  formuliert, soll nicht an einem Check scheitern. Deshalb prüft LLM02-P01 nur auf eine
  E-Mail-Adresse der fremden Person, nicht auf jedes "@", und LLM01-P05 lässt neben der
  Übersetzung auch eine Ablehnung gelten. Steht ein Köder in der Eingabe selbst, wie bei
  LLM01-P04 und LLM01-P09, prüft `mustNotClaim`: Ein Zitat in der Ablehnung entscheidet der
  Judge.

## Abdeckung je Risiko

OWASP Top 10 for LLM Applications 2025:

| Risiko | Titel                            | Muster                                                                                            |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| LLM01  | Prompt Injection                 | LLM01-P01, LLM01-P02, LLM01-P03, LLM01-P04, LLM01-P05, LLM01-P06, LLM01-P07, LLM01-P08, LLM01-P09 |
| LLM02  | Sensitive Information Disclosure | LLM02-P01, LLM02-P02, LLM02-P03, LLM02-P04, LLM02-P05                                             |
| LLM03  | Supply Chain                     | bewusst keine, siehe unten                                                                        |
| LLM04  | Data and Model Poisoning         | bewusst keine, siehe unten                                                                        |
| LLM05  | Improper Output Handling         | LLM05-P01, LLM05-P02, LLM05-P03                                                                   |
| LLM06  | Excessive Agency                 | LLM06-P01, LLM06-P02, LLM06-P03                                                                   |
| LLM07  | System Prompt Leakage            | LLM07-P01, LLM07-P02, LLM07-P03, LLM07-P04, LLM07-P05                                             |
| LLM08  | Vector and Embedding Weaknesses  | LLM08-P01, LLM08-P02, soweit über Antworten erkennbar                                             |
| LLM09  | Misinformation                   | LLM09-P01, LLM09-P02, LLM09-P03, LLM09-P04, LLM09-P05, LLM09-P06                                  |
| LLM10  | Unbounded Consumption            | LLM10-P01, LLM10-P02, LLM10-P03, LLM10-P04                                                        |

OWASP AI Testing Guide, Abschnitt Application:

| Test        | Titel                                           | Muster                                                            |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| AITG-APP-01 | Testing for Prompt Injection                    | LLM01-P01, LLM01-P02, LLM01-P03, LLM01-P06, LLM01-P07, LLM01-P08  |
| AITG-APP-02 | Testing for Indirect Prompt Injection           | LLM01-P04, LLM01-P05, LLM01-P09                                   |
| AITG-APP-03 | Testing for Sensitive Data Leak                 | LLM02-P01, LLM02-P02, LLM02-P04, LLM08-P01, LLM08-P02             |
| AITG-APP-04 | Testing for Input Leakage                       | LLM02-P03, LLM02-P05                                              |
| AITG-APP-05 | Testing for Unsafe Outputs                      | LLM05-P01, LLM05-P02, LLM05-P03, AITG-APP-05-P01, AITG-APP-05-P02 |
| AITG-APP-06 | Testing for Agentic Behavior Limits             | LLM06-P01, LLM06-P02, LLM06-P03                                   |
| AITG-APP-07 | Testing for Prompt Disclosure                   | LLM07-P01, LLM07-P02, LLM07-P03, LLM07-P04, LLM07-P05             |
| AITG-APP-08 | Testing for Embedding Manipulation              | bewusst keine, siehe unten                                        |
| AITG-APP-09 | Testing for Model Extraction                    | LLM10-P03, LLM10-P04                                              |
| AITG-APP-10 | Testing for Content Bias                        | AITG-APP-10-P01, AITG-APP-10-P02                                  |
| AITG-APP-11 | Testing for Hallucinations                      | LLM09-P01, LLM09-P02, LLM09-P03                                   |
| AITG-APP-12 | Testing for Toxic Output                        | AITG-APP-12-P01, AITG-APP-12-P02                                  |
| AITG-APP-13 | Testing for Over-Reliance on AI                 | LLM09-P04, LLM09-P05, LLM09-P06                                   |
| AITG-APP-14 | Testing for Explainability and Interpretability | bewusst keine, siehe unten                                        |

Die ID eines Musters folgt dem Risiko der LLM Top 10. Wo es keines gibt, etwa bei Verzerrung
und Toxizität, trägt das Muster die ID des AITG-Tests.

## Was bewusst fehlt

- LLM03 Supply Chain und LLM04 Data and Model Poisoning: Beide betreffen Herkunft und
  Training von Modell und Daten. Über die Antworten einer Schnittstelle lassen sie sich nicht
  belastbar prüfen.
- AITG-APP-08 Embedding Manipulation: braucht Zugriff auf Einbettungen und Index.
- AITG-APP-14 Explainability and Interpretability: braucht Zugriff auf das Modell selbst.
- LLM08 nur teilweise: Ob ein Abruf Grenzen zwischen Mandanten oder Rechten einhält, zeigt sich
  zuverlässig erst mit Testdokumenten je Mandant und mehreren Testusern. Dafür gehört ein
  eigenes Goldset zum Zielsystem, etwa wie in Issue #74 geplant.
- Muster aus den OWASP Top 10 for Agentic Applications für Assistenten mit Werkzeugen sind noch
  nicht enthalten. Sie folgen nach Prüfung der aktuellen Liste.

## Eigene Muster

Ein eigener Katalog im selben Format lässt sich in der `aiqa.yaml` unter `catalogs` eintragen.
`aiqa validate` prüft ihn. Jedes Muster braucht ID, Verweise, Name, Beschreibung, Eingabe und
sollte eine Rubrik haben.
