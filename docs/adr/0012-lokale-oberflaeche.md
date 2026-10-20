# ADR 0012: Lokale Oberfläche ohne Skript, nur auf 127.0.0.1

Status: angenommen am 11.10.2026

Ergebnis von Issue #60. Baut auf ADR 0002 (Dateien statt Datenbank), ADR 0007 (Kern und
Erweiterungen) und ADR 0009 (HTML-Report) auf.

## Kontext

AI QA wird über Befehle und YAML-Dateien bedient. Für die tägliche Arbeit am eigenen Rechner
soll eine einfache Oberfläche dazukommen: Läufe überblicken, einen Lauf im Detail ansehen,
Reports erzeugen, Entwürfe freigeben und Befunde entscheiden. Sie läuft lokal und zeigt
vertrauliche Inhalte, nämlich wörtliche Antworten des Zielsystems.

## Entscheidung

1. `aiqa ui` startet einen HTTP-Server aus `node:http`, gebunden nur an `127.0.0.1`, Standardport
   4317, und öffnet den Browser (`--no-open` unterdrückt das). Keine neue Abhängigkeit, kein
   Framework, kein Build-Schritt.
2. Die Seiten rendert der Server als HTML, wie den HTML-Report. Es gibt kein Skript im Browser:
   Aktionen sind Formulare mit POST, danach leitet der Server auf die Seite zurück. Die
   Content-Security-Policy verbietet Skripte vollständig (`script-src 'none'`) und lädt nur von
   der eigenen Adresse.
3. Schutz gegen fremde Webseiten im selben Browser: Der Server antwortet nur, wenn der Host-Kopf
   `127.0.0.1:<port>` oder `localhost:<port>` lautet (gegen DNS-Rebinding). Jedes POST braucht ein
   Token, das beim Start zufällig entsteht und nur in den eigenen Formularen steht, und ein
   passendes `Origin`, wenn der Browser eines schickt. Formulardaten sind auf wenige Kilobyte
   begrenzt. Dateien unter `/assets/` kommen aus einer festen Liste, nicht aus Pfaden der Anfrage.
4. Die Oberfläche nutzt dieselben Bausteine wie die CLI: `FileResultStore`, Report-Modell,
   Renderer, Schreiben der Befunde. Entwürfe ändert sie über das YAML-Dokument, damit Kommentare
   erhalten bleiben, und prüft das Goldset vor dem Schreiben gegen das Schema.
5. Erste Fassung: Übersicht der Läufe mit Trend, Lauf im Detail mit eingebettetem HTML-Report,
   Reports als Markdown, HTML oder JUnit erzeugen, Entwürfe freigeben oder verwerfen, Befunde
   bestätigen oder verwerfen. Nicht dabei: Läufe starten, `aiqa.yaml` bearbeiten, Zugangsdaten.
6. Gestaltung im Wirkmittel-Design mit den Farben aus `wirkmittelTheme`, Schriften als Dateien
   aus `assets/fonts`. Claim "AI QA: Der Chatbot-Testbot". Das Icon entstand mit Wirkmittel
   Studio und liegt als nachgezeichnetes SVG in den Markenfarben (`assets/ui/icon.svg`) und als
   PNG des Originals (`assets/ui/icon-studio-256.png`) im Repository.

## Begründung

- Ohne Skript im Browser gibt es keine Angriffsfläche für eingeschleuste Inhalte aus Antworten
  des Zielsystems, und der Test der Oberfläche ist ein Test von HTTP-Antworten.
- Ein lokaler Server ohne Anmeldung ist nur vertretbar, wenn er von außen nicht erreichbar ist und
  fremde Seiten im Browser ihn nicht steuern können. Bindung, Host-Prüfung und Token decken die
  bekannten Wege ab (Zugriff aus dem Netz, DNS-Rebinding, Cross-Site-Formulare).
- Server-Rendering hält die Oberfläche klein und ohne Abhängigkeiten, im Sinne von ADR 0007.

## Konsequenzen

- Jede Aktion lädt die Seite neu. Für eine erste, lokale Fassung reicht das.
- Wer die Oberfläche aus einem anderen Rechner erreichen will, braucht einen eigenen Weg, etwa
  einen SSH-Tunnel. Eine gehostete Variante bleibt ein eigenes Thema (ADR 0007).
- Läufe starten kommt später und braucht dann eine Bestätigung mit Budget wie in der CLI.
