# ADR 0005: Eigene Beispielziele statt fremder Systeme, Loopback in Tests erlaubt

Status: angenommen am 10.10.2026

## Kontext

Ohne Zielsystem lässt sich AI QA weder entwickeln noch vorführen. Fremde Chatbots dürfen ohne
Erlaubnis nicht mit OWASP-Proben geprüft werden, das wäre ein Angriff auf ein fremdes System.
Gleichzeitig gilt: Tests und CI machen keine Netzwerkaufrufe, Agenten werden mit Fixtures
getestet (Issue #23).

## Entscheidung

Das Repository bringt zwei eigene Ziele der erfundenen Gartenhelden GmbH mit, beide unter
`examples/`:

- `mock-target`: ein HTTP-Server mit festen Antworten und absichtlichen Schwächen, je eine pro
  Detektor. Kein Modell, kein Netz, deterministisch. Die Tests von Runner, Checks, Statistik
  und Report fahren gegen diesen Server als echtes HTTP-Ziel.
- `sample-bot`: ein Bot mit System-Prompt und bewusst lückenhaften Regeln hinter einer
  OpenAI-kompatiblen Schnittstelle, mit Ollama oder der Anthropic-Kompatibilitätsschicht als
  Backend. Nur lokal, nie in der CI.

Der Netzwerk-Guard der Tests (`tests/setup/no-network.ts`) blockiert weiterhin jeden Host außer
dem lokalen Loopback (localhost, 127.0.0.1, ::1). Die Regel "keine Netzwerkaufrufe in Tests"
heißt damit: keine Aufrufe, die den Rechner verlassen.

## Begründung

- Ein echter HTTP-Server im Test deckt Fehler auf, die ein In-Memory-Dummy verbirgt:
  Statuscodes, Header, Sessions, Latenz, Verbindungsfehler.
- Fest eingebaute Schwächen machen die Detektoren prüfbar, ohne dass ein Modell laufen muss.
- Der Beispielbot zeigt die eigentliche Arbeitsweise mit Judge und Modell, bleibt aber
  außerhalb der CI, weil jeder Aufruf Geld und Zeit kostet und nicht deterministisch ist.
- Fremdprojekte wie Damn Vulnerable LLM Agent erscheinen nur als Hinweis in der Doku, nicht im
  Repository.

## Konsequenzen

- Die Beispielziele sind keine Produkte und werden nicht gehärtet. Ihre Schwächen sind Absicht
  und dokumentiert.
- Beispielbot und Judge nutzen verschiedene Modelle, der Bot ein kleines (Issue #24).
- Bis die Adapter http (Issue #3) und openai-compatible (Issue #4) existieren, sprechen die
  Tests den Mock über einen kleinen Test-Adapter unter `tests/helpers/` an. Die Arbeitsbereiche
  unter `examples/` sind für die Adapter vorbereitet und werden in der CI validiert.
