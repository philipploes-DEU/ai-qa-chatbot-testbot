# ADR 0006: Eigene dünne Provider-Schicht statt Vercel AI SDK

Status: angenommen am 11.10.2026

Das Issue #2 nannte diese Entscheidung ADR 0005. Die Nummer war bei der Umsetzung vergeben
(Beispielziele), deshalb 0006.

## Kontext

Die Agenten von AI QA (Judge, Planung, Analyse, Report) sollen modellagnostisch laufen, hinter
dem Interface `ModelProvider`. Das Konzept nahm das Vercel AI SDK als Schicht an, ungeprüft.
Der Spike unter `spikes/0002-provider-abstraktion` im Entwicklungs-Repository hat beide Wege gegen Ollama (qwen2.5:7b)
gemessen; Anthropic konnte mangels Schlüssel nicht laufen, der Durchlauf ist vorbereitet.

## Entscheidung

AI QA nutzt eine eigene dünne Schicht in `src/providers`:

- `ModelProvider` mit `generateJson(request)`: System-Prompt, Aufgabe, Zod-Schema, Antwort als
  geprüftes Objekt plus Rohtext, Tokens, Latenz und Zahl der Versuche.
- `OpenAiCompatibleProvider` für alles, was das Chat-Completions-Format spricht: Ollama, OpenAI,
  Gateways, die Anthropic-Kompatibilitätsschicht. Das JSON-Schema steht im System-Prompt, die
  Antwort wird mit Zod geprüft, ein Verstoß geht mit Begründung einmal zur Reparatur zurück.
  Auth, Rate Limit, Backoff und Timeouts kommen aus den Adapter-Bausteinen (Issue #5).
- `FakeProvider` mit aufgezeichneten Antworten für die Tests der Agenten.
- Für Claude nativ folgt mit dem Judge (Issue #6) eine Umsetzung über das offizielle SDK, wenn
  die Kompatibilitätsschicht nicht reicht. Sie bleibt klein, weil Validierung und Reparatur in
  der Schicht liegen, nicht im Provider.

Das Vercel AI SDK kommt nicht ins Repository.

## Begründung

Messung mit fünf Wiederholungen je Kandidat (Details im README des Spikes):

| Variante         | gültig | korrekt | Latenz  |
| ---------------- | ------ | ------- | ------- |
| A AI SDK         | 10/15  | 10/15   | 2442 ms |
| B eigene Schicht | 15/15  | 15/15   | 1701 ms |

- Die strukturierte Ausgabe des AI SDK erzwingt über die Grammatik des Anbieters nur Typen.
  Wertebereiche wie `confidence` zwischen 0 und 1 kennt das Modell nicht, der Verstoß endet in
  `NoObjectGeneratedError` ohne Reparatur. Die eigene Schicht zeigt dem Modell das Schema und
  lässt es einen Verstoß korrigieren. Für einen Judge, dessen Urteile in die Statistik gehen,
  zählt jede gültige Antwort.
- Das AI SDK ändert seine Oberfläche schnell: `generateObject` ist in Version 7 bereits als
  veraltet markiert, Provider brauchen Schalter wie `supportsStructuredOutputs`, Warnungen
  laufen über globale Variablen. Jede Version kostet Anpassung in einem Kern, der stabil bleiben
  soll.
- Die eigene Schicht ist etwa 150 Zeilen und nutzt, was für die Adapter ohnehin existiert.
  Kein weiterer Abhängigkeitsbaum, kein zweites Zod, kein Provider-Registry.
- Ein Chat-Completions-Client erreicht fast jeden Anbieter. Was er nicht erreicht, bekommt eine
  eigene kleine Umsetzung hinter demselben Interface.

Ein Fund für die Designregeln: aktuelle Claude-Modelle lehnen Sampling-Parameter ab,
`temperature: 0` ist dort kein Mittel. Determinismus entsteht je Provider anders (Temperatur 0
wo verfügbar, sonst niedriger Effort) und wird über die Wiederholungen des Plans abgesichert,
nicht angenommen.

## Konsequenzen

- Jeder neue Anbieter außerhalb des Chat-Completions-Formats ist eigener Code, klein, mit Fake
  getestet. Streaming und Tool-Aufrufe sind nicht Teil der Schicht; die Agenten brauchen sie
  nicht.
- Die Reparaturrunde kostet bei Verstößen einen zweiten Aufruf. Die Tokens beider Aufrufe werden
  summiert und fallen ins Budget (Issue #8).
- Der Anthropic-Durchlauf des Spikes bleibt offen, bis ein Schlüssel vorliegt. Die Entscheidung
  hängt nicht daran: die Gründe betreffen die Schicht, nicht den Anbieter.
