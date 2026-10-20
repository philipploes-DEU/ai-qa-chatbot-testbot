# ADR 0009: HTML-Report als zweiter Renderer, Themes als Daten mit eingebetteten Schriften

Status: angenommen am 11.10.2026

Ergebnis von Issue #18. Baut auf ADR 0007 auf (gemeinsame Schnittstelle, sobald zwei Formate
je Modell existieren).

## Kontext

Der Markdown-Report reicht für Entwickler. Für eine Abnahme braucht ein Fachbereich einen
lesbaren Bericht mit Kernaussage, Quoten, Fehlerquote je Kategorie, Befunden, Stichproben,
Kalibrierung, Trend und Lauf-Metadaten. Der Bericht soll im Wirkmittel-Design erscheinen,
ein neutrales Theme für Kunden muss möglich bleiben. Er wird als Datei weitergegeben, oft per
Mail, und darf beim Öffnen nichts nachladen: keine Schrift von einem fremden Server, kein Skript.

## Entscheidung

1. `Renderer<Model>` ist die gemeinsame Schnittstelle (`format`, `fileExtension`,
   `render(model, theme)`). `ReportRenderer` ist `Renderer<ReportModel>` und bleibt als Name
   im öffentlichen Einstieg. `MarkdownRenderer` und `HtmlRenderer` rendern dasselbe
   `ReportModel`. Der Markdown-Report bleibt Standard.
2. Das Report-Modell rechnet alles, die Renderer formatieren nur. Neu im Modell: Fehlerquote
   je Kategorie (Quelle des Falls, sonst erstes Tag) mit Wilson-Intervall, Trend über die
   letzten zehn Läufe gegen dasselbe Zielsystem und Befunde. Befunde erscheinen nur mit Status
   `confirmed`; Hypothesen eines Agenten erreichen keinen Report.
3. Der HTML-Report ist eine einzelne Datei ohne Skripte und ohne externe Ressourcen. Eine
   Content-Security-Policy im Dokument verbietet jede Anfrage (`default-src 'none'`), nur
   eingebettete Stile und `data:`-Schriften sind erlaubt. Antworten des Zielsystems werden
   immer maskiert. Der Trend ist ein Inline-SVG mit Tabelle der Werte, Tooltips kommen aus
   `<title>`-Elementen statt aus Skript.
4. Ein Theme ist ein `ReportTheme`-Objekt mit optionalem `html`-Stil: Farben, Schriftstapel,
   Schriftdateien, Verlauf des Untertitels und Schatten. Die Schriftdateien werden beim Rendern
   als Base64 eingebettet. Mitgeliefert werden `default` (Markdown), `wirkmittel` (Standard für
   HTML) und `neutral` (schwarz auf weiß, Systemschriften). Gewählt wird mit
   `aiqa report --theme <name>`.
5. Inter und Space Grotesk liegen unter `assets/fonts` mit ihren Lizenztexten (SIL Open Font
   License 1.1, Einbetten und Weitergeben erlaubt). `assets` gehört zu den veröffentlichten
   Dateien des Pakets.

## Begründung

- Eine Datei ohne Nachladen ist rechtlich und technisch die sichere Form: keine Übermittlung
  der IP-Adresse an Dritte beim Öffnen (Regel des Wirkmittel-Designs), kein Skript, das aus
  einer maskierten Antwort doch noch ausgeführt werden könnte.
- Zahlen nur im Modell halten Markdown und HTML deckungsgleich und testbar.
- Ein Theme als Datenobjekt lässt sich später als eigenes Paket ausliefern, ohne den Renderer
  zu ändern (ADR 0007, Punkt 2).

## Konsequenzen

- Ein HTML-Report ist rund 550 KB groß, fast alles Schriften. Das neutrale Theme bettet keine
  Schriften ein und bleibt klein.
- ADR 0007 nennt das HTML-Theme im Wirkmittel-Design als mögliche bezahlte Erweiterung. Es liegt
  vorläufig im Kern, weil Issue #18 es als Standard verlangt. Ob es mit der Lizenzentscheidung
  (Issue #20) in ein eigenes Paket wandert, entscheidet dieses Issue. Nachtrag: ADR 0011 lässt es
  im Kern unter Apache 2.0.
- PDF-Export und interaktive Ansichten sind nicht Teil dieser Fassung.
