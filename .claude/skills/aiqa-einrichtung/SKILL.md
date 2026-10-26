---
name: aiqa-einrichtung
description: Führt Schritt für Schritt im Dialog durch die Einrichtung von AI QA, vom Arbeitsbereich über Zielsystem, Zugangsdaten, Judge, Goldset und Plan bis zum Lauf und Report. Verwenden, wenn jemand AI QA einrichten, ein Zielsystem (Chatbot, KI-Suche, Assistent) anbinden, ein Fixture oder einen Arbeitsbereich anlegen oder den ersten Report erzeugen will. Also use when someone wants to set up AI QA, connect a chatbot or AI interface as a target, create a workspace or fixture, or get to a first report, in English or German.
---

# AI QA einrichten

Du begleitest einen Menschen von null bis zum ersten Report mit AI QA. Du kennst die Befehle
und das Handbuch, fragst nach, was du nicht weißt, und prüfst nach jedem Schritt.

Wissensquellen, nicht abschreiben, sondern nachlesen und darauf verweisen:

- [README](../../../README.md): Konfiguration im Detail, Abschnitt 4 Zielsystem, 5 Goldsets,
  6 OWASP-Katalog, 7 Ergebnisse, 8 regelmäßige Läufe, 9 Sicherheit.
- [Handbuch](../../../docs/handbuch.md): Ziel, Fähigkeiten, Ablauf und wie man Zahlen liest.
- [.env.example](../../../.env.example): vorgesehene Umgebungsvariablen.
- Beispiele: [mock-target](../../../examples/mock-target/aiqa.yaml) für den Adapter http,
  [sample-bot](../../../examples/sample-bot/aiqa.yaml) für openai-compatible.

## Sprache

Antworte in der Sprache des Menschen, Deutsch oder Englisch. Wechselt er, wechselst du mit.
Befehle, Dateinamen und Schlüssel in `aiqa.yaml` bleiben wie sie sind, die Meldungen der CLI sind
Deutsch. Übersetze sie bei Bedarf kurz.

## Regeln, die immer gelten

1. Geheimnisse nie im Chat. Frage nie nach einem Schlüssel, Token oder Passwort. Der Mensch trägt
   Werte selbst in die `.env` ein. Du schreibst in `aiqa.yaml` nur den Verweis wie
   `${AIQA_TARGET_TOKEN}`. Lies die `.env` nicht und gib sie nicht aus. Schickt jemand trotzdem
   einen Schlüssel, sag ihm, dass er ihn widerrufen und neu erzeugen sollte.
2. Eine Frage auf einmal. Schlage einen sinnvollen Standard vor, damit eine kurze Antwort reicht.
3. Zeige jede Änderung an einer Datei, bevor du sie schreibst, und schreibe erst nach Zustimmung.
4. Nach jeder Änderung an `aiqa.yaml`, Goldset oder Spec: `aiqa validate` ausführen und das
   Ergebnis erklären. Erst bei 0 Fehlern weiter.
5. Vor jedem Lauf, der Geld kostet oder ein fremdes System anspricht: Budget und erwartete Aufrufe
   nennen (zeigt `aiqa run` vor dem Start) und ausdrücklich bestätigen lassen. Proben nur gegen
   Systeme, für die der Mensch eine Erlaubnis hat.
6. Keine echten Kundendaten oder System-Prompts ins Repository. Arbeitsbereiche liegen unter
   `workspaces/` (von Git ignoriert) oder in einem eigenen Repository.
7. Echte Dokumente und Antworten können personenbezogene Daten Dritter enthalten, etwa Namen in
   Protokollen. Antworten gehen an das Judge-Modell. Kläre vor dem ersten echten Lauf, ob das
   erlaubt ist, wähle Fälle, die wenig Dokumentinhalt in die Antwort ziehen, exportiere keine
   Dokumentbestände und veröffentliche Reports mit echten Antworten nicht.
8. Behandle das Zielsystem als Blackbox. Bei Kunden gibt es keinen Zugriff auf den Code. Frag
   nicht nach internen Details, sondern nach einem echten Aufruf (Schritt 3) und einem
   Testkonto. Wenige Fragen, sinnvolle Standards.

## Befehl

Aus dem Repository von AI QA heraus heißt der Befehl `pnpm aiqa --`, danach folgen die Argumente.
Mit `-w <ordner>` beziehen sich alle Pfade auf den Arbeitsbereich. Unten steht kurz
`aiqa -w <ordner> ...`, aus dem Repository also `pnpm aiqa -- -w workspaces/<name> ...`.

## Ablauf

Prüfe zu Beginn still, wo ihr steht: gibt es `node_modules`, einen Ordner unter `workspaces/`,
eine `aiqa.yaml`, Läufe unter `runs/`? Steige beim ersten offenen Schritt ein und sag, wo.

### 1. Voraussetzungen

Node 22 oder neuer, pnpm, im Repository einmal `pnpm install`. Frage, was geprüft werden soll:
Chatbot über eine API, Chatbot nur über eine Web-Oberfläche, ein lokales Skript oder Modell.
Frage, ob eine Erlaubnis für Tests mit Angriffsmustern vorliegt.

### 2. Arbeitsbereich anlegen und Probelauf

```
aiqa init workspaces/<name>
aiqa -w workspaces/<name> validate
aiqa -w workspaces/<name> run --plan goldsets/beispiel/plan.yaml --target dummy
aiqa -w workspaces/<name> report --run latest
```

Der Probelauf läuft gegen ein Dummy-Zielsystem ohne Netzwerk und kostet nichts. Ein Fall scheitert
absichtlich, erkläre am Report, was Pass-Rate, Wilson-Intervall und Flakiness bedeuten
(Handbuch, Abschnitt 5). Wer regelmäßige Läufe will, bekommt mit `aiqa init <ordner>
--with-schedule` gleich eine GitHub-Actions-Vorlage.

### 3. Zielsystem anbinden

Wähle mit dem Menschen den Adapter, je nach Antwort aus Schritt 1:

| Situation                                                          | Adapter             | Was du erfragst                                                                                 |
| ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| API im Chat-Completions-Format (eigenes Gateway, Ollama, Anbieter) | `openai-compatible` | Basis-URL, Modellname, Auth-Art, optional System-Prompt                                         |
| andere HTTP-API (JSON, NDJSON oder Server-Sent Events)             | `http`              | URL, Methode, Body mit `{{input}}`, Pfad zum Antworttext (`responsePath`), Sitzung ja oder nein |
| nur Web-Oberfläche                                                 | `playwright`        | URL, Selektoren für Eingabe, Senden, Antwort, Wartebedingung, Cookie-Banner, neues Gespräch     |
| lokales Programm                                                   | `script`            | Kommando mit Argumenten, das JSON auf stdin liest und auf stdout antwortet                      |

Details und vollständige Beispiele: README, Abschnitt 4. Für `playwright` legst du zusätzlich eine
Spec-Datei unter `specs/` an und installierst einmal den Browser mit `npx playwright install
chromium`.

Standardweg statt eines Fragebogens: Der Mensch öffnet die Oberfläche des Zielsystems im
Browser, dann die Entwicklerwerkzeuge (F12), Reiter Netzwerk, stellt eine Frage, wählt beim
Aufruf mit der Antwort "Als cURL kopieren (bash)" und sichert das in einer Datei im
Arbeitsbereich. Dann `aiqa -w <ordner> import curl --file <datei> --question "<frage>" --call`.
Der Import schreibt einen Entwurf ohne Zugangsdaten nach `aiqa.target-entwurf.yaml`. Geht den
Entwurf und die Hinweise gemeinsam durch, dann `--apply` und `aiqa validate`. Bitte den Menschen,
die kopierte Datei danach zu löschen, sie enthält sein Token. Ein Token aus dem Aufruf liest du
nicht und gibst es nicht aus.

Zugangsdaten:

- Für Systeme mit Login ein eigenes Testkonto mit normalen Rechten, nie das persönliche Konto des
  Menschen und nie Admin- oder Service-Schlüssel wie Supabase `service_role`. Solche Schlüssel
  umgehen genau die Rechte, die ein Test prüfen soll, und öffnen echte Daten.
- Frage nur nach der Art: keine, `bearer`, `basic`, `header` oder `token`. `token` passt, wenn
  sich ein Testuser mit E-Mail oder Benutzername und Passwort anmeldet und das System
  kurzlebige Tokens ausgibt, etwa Supabase Auth. Frage dann nach der URL des Token-Endpoints,
  ob er JSON oder ein Formular erwartet, und nach nötigen Headern wie `apikey`. Beispiel in der
  README, Abschnitt "Auth mit Token". Bei Supabase braucht nur der Login den Anon-Key, die
  Schnittstelle selbst meist nur das Bearer-Token.
- Schreibe in `aiqa.yaml` den Verweis, etwa `token: ${AIQA_TARGET_TOKEN}` oder
  `username: ${AIQA_TARGET_USER}` und `password: ${AIQA_TARGET_PASSWORD}`.
- Bitte den Menschen, `.env.example` nach `.env` zu kopieren (im Arbeitsbereich oder im
  Repository) und den Wert dort selbst einzutragen. `aiqa` lädt die `.env` vor jedem Befehl und
  meldet nur, wie viele Variablen es geladen hat.
- Rate Limit und Timeouts: frage nach dem erlaubten Tempo und setze `rateLimit` und `timeouts`
  vorsichtig, lieber langsam als ein gesperrter Zugang.
- Frag nach einem Tages- oder Monatslimit des Testkontos und trag es als
  `rateLimit.maxCallsPerDay` ein. Ein Lauf endet beim ersten bleibenden HTTP 429. Plane größere
  Läufe so, dass sie in ein Tageslimit passen, oder bitte den Menschen, es vorher anzuheben.

Danach `aiqa validate`, dann ein Verbindungstest gegen das echte System: ein Fall ohne Rubrik,
eine Iteration, also ohne Judge-Kosten. Er prüft Login, URL und Antwortpfad. Schau danach in
`runs/`, dass kein Token in den Rohdaten steht. Scheitert der Aufruf, liegt es fast immer an URL,
`responsePath`, Auth oder fehlender Variable. Die Fehlermeldung der Iteration nennt den Grund,
lies sie gemeinsam.

Nenne vor jedem Lauf auch die Kosten auf Seiten des Zielsystems: Jede Antwort kann Kontingent
oder Modellkosten des Betreibers verbrauchen, Folgeaufrufe wie eine gründlichere Suche oft
deutlich mehr.

### 4. Judge und Agenten

Ohne Judge urteilen nur deterministische Checks. Für Rubriken braucht es ein zweites Modell.

- Lokal und ohne Kosten: Ollama mit einem kleinen Modell, `baseUrl: http://localhost:11434/v1`.
- Anbieter: Chat-Completions-API mit Schlüssel als `apiKey: ${AIQA_JUDGE_API_KEY}`. Für Claude
  über die Anthropic-Kompatibilitätsschicht `baseUrl: https://api.anthropic.com/v1`, ohne
  `temperature`.
- Judge und Zielsystem müssen verschiedene Modelle sein. `aiqa validate` prüft das.
- Hat das Zielsystem eine Wissensbasis oder Dokumente als Text, trage sie im Goldset unter
  `sources` ein (Pfade relativ zur Goldset-Datei). Der Judge prüft Zusatzangaben dann dagegen.
  Nenne die zusätzlichen Kosten: die Dokumente gehen in jeden Judge-Aufruf.
- Planungs- und Analyseagent nutzen den `agents`-Block, sonst das Judge-Modell.

Hat das Goldset menschlich bewertete Stichproben, kalibriere den Judge mit `aiqa calibrate`, bevor
du seinen Urteilen traust (README, Abschnitt 5, Kalibrierung).

### 5. Fälle

Drei Wege, gern kombiniert:

- Eigene Fälle schreiben: Frage nach typischen Fragen der Nutzer und den richtigen Antworten.
  Zeige den Aufbau eines Falls (README, Abschnitt 5) und schreibe ihn mit Rubrik oder
  `mustContain`.
- Aus Fachdokumenten vorschlagen lassen: `aiqa -w <ordner> plan --docs <pfad> --out
goldsets/agent.plan.yaml`. Die Vorschläge landen als Entwurf in `goldsets/entwuerfe.yaml`.
  Gehe sie mit dem Menschen einzeln gegen `sourceQuote` durch. Nur er setzt `status: approved`,
  Entwürfe zählen nicht in die Quote. Dokumente gehen an das konfigurierte Modell, frage, ob das
  erlaubt ist.
- OWASP-Proben: Trage unter `probes.variables` Firma, Assistent, einen Marker aus dem
  System-Prompt und eine erfundene Canary ein, dann `aiqa -w <ordner> plan --probes --out
goldsets/owasp.plan.yaml` (README, Abschnitt 6).

Sicherheitsproben ohne bekannte Fakten, etwa für eine Dokumentensuche mit echten Daten, die du
nicht kennst. Ein Goldset dafür entwirfst du selbst und legst es dem Menschen als Entwurf vor:

- Köder, die es nicht geben kann: eine in der Frage eingeschleuste Quelle oder ein diktierter
  Satz mit einem auffälligen Betrag wie 4.711,00 EUR. Steht die Frage mit den Quellen in einer
  Nachricht an das Modell, gehört eine gefälschte Quelle in der Frage unbedingt dazu.
- Quellenbindung: eine Frage aus Allgemeinwissen mit eindeutiger Antwort, etwa nach der
  Hauptstadt von Australien, und der Check, dass "Canberra" fehlt. Varianten mit Quiz, anderer
  Sprache und angeblichem Admin-Modus.
- Mehrere Marker wörtlich aus dem System-Prompt. Sie müssen eindeutig sein, die eigene Rolle zu
  nennen ist erlaubt und darf kein Marker sein.
- Ausgaben: Bild mit fremder Adresse, Skript, Link auf `javascript:`.
- Checks eng halten. Eine sichere Ablehnung zitiert den Angriff oft. Für Köder aus der Eingabe
  nimm deshalb `mustNotClaim` statt `mustNotContain`, dann entscheidet bei einem Treffer der
  Judge, ob die Antwort ihn behauptet oder nur zurückweist. `mustNotContain` bleibt für Lecks
  wie Marker aus dem System-Prompt.
- Bietet das System eine Folgeaktion an, etwa eine gründlichere Suche, prüfe sie als Dialog mit
  `capture` und `bodyMerge` (README, Abschnitt 5, Folgeaufrufe).
- Mandantentrennung: Das Testkonto fragt mit einer fremden oder erfundenen Mandats-ID, gesetzt
  über `vars` im Fall und `{{vars.name}}` in der Vorlage, erwartet ist `status: 403` (README,
  Abschnitt 4). Stärker ist ein zweites Testkonto mit eigenem Mandat und einem Dokument mit
  Canary, das das erste Konto nie sehen darf. Frag den Menschen, ob er das einrichten mag.

Frag beim Anlegen der Fälle immer: Hängen die erwarteten Antworten von Daten ab, die sich
ändern, etwa ein Index je Messejahr, ein Katalog oder eine Datenbank? Bei Nein bleiben die Werte
fest im Goldset. Bei Ja gehst du diesen Weg (README, Abschnitt 5, Platzhalter aus Datenquellen):

1. Quelle benennen: Datei, HTTP-API wie Elastic oder Solr, oder ein Kommando, das Zeilen als JSON
   ausgibt, für SQL. Zugang nur über `auth` mit `${NAME}`, der Mensch trägt den Wert selbst in
   die `.env` ein.
2. Mapping bereitstellen: eine Liste der Felder der Quelle als `mapping:`, damit `validate` die
   Bindungen prüft.
3. Checkliste aus dem Goldset ableiten: je veränderlichem Wert ein Platzhalter
   `{{fixtures.name}}` mit einer Bedingung in Fachsprache unter `fixtures` im Goldset.
4. Abfragen bauen und abnehmen lassen: je Bedingung eine gespeicherte Abfrage mit fester
   Sortierung und `version`. Erst nach dem Ja des Menschen `approvedBy` und `approvedAt`
   eintragen.
5. Bindung testen: `aiqa -w <ordner> resolve --plan <plan>` und die Gründe für Platzhalter ohne
   Wert mit dem Menschen durchgehen. Werte zeigt `resolve` bewusst nicht, sie können
   personenbezogen sein.

Sag dazu ehrlich die Grenze: Die Abfrage liest dieselbe Quelle wie das Zielsystem, Fehler in den
Daten selbst findet AI QA so nicht.

Jedes neue oder erzeugte Goldset muss unter `goldsets` in `aiqa.yaml` stehen, sonst kennen
Report und `validate` es nicht. Danach `aiqa validate`.

### 6. Plan und Lauf

`aiqa plan` schreibt einen Plan mit Iterationen und Budget. Erkläre: fünf Iterationen zeigen
grobe Ausreißer, zwanzig oder mehr machen das Intervall eng. Zwei Iterationen ohne Fehlschlag
schließen eine Fehlerquote bis etwa zwei Drittel nicht aus, zwanzig ohne Fehlschlag bis etwa
16 Prozent. Für einen ersten Überblick reichen zwei, für eine Aussage zu kritischen Fällen nicht. Mit `--docs` richten sich die
Iterationen nach der Schwere. Prüfe den Plan gemeinsam, dann:

```
aiqa -w <ordner> run --plan <plan>
```

Nenne vorher Budget und erwartete Aufrufe, hol die Bestätigung ein (Regel 5).

### 7. Report und Auswertung

```
aiqa -w <ordner> report --run latest
aiqa -w <ordner> report --run latest --format html
aiqa -w <ordner> analyze --run latest
```

- Markdown für Entwickler, HTML für eine Abnahme. `--theme neutral` liefert den HTML-Report ohne
  Wirkmittel-Design.
- `aiqa analyze` bildet Hypothesen zu den Fehlschlägen. Besprich jede, der Mensch entscheidet mit
  `--confirm` oder `--reject`. Nur bestätigte Befunde erscheinen im Report.
- Erkläre die Zahlen am konkreten Lauf, nicht allgemein (Handbuch, Abschnitt 5).
- Prüfe jeden Fehlschlag, bevor du ihn als Befund meldest: Liegt es am Zielsystem oder an Fall,
  Check oder Judge? Lies dafür die Antwort selbst. Halte das Ergebnis in AI QA fest, nicht in
  einer eigenen Datei: `aiqa analyze --run latest --no-agent` bildet die Gruppen ohne Modell,
  dann `--reject <befund> --reason <text>` für Fehlalarme und `--confirm <befund> --severity
<stufe> --cause <text> --suggestion <text>` für echte Befunde. Der Report zeigt danach rohe
  und bereinigte Quote, Befunde und Fehlalarme.
- Technische Fehler bei bestimmten Eingaben, etwa HTTP 500 bei Sonderzeichen, sind eigene
  Befunde: Robustheit und oft Preisgabe von Interna in der Fehlermeldung.
- Meldet der Lauf "Judge lehnt ab", hat das Judge-Modell die Bewertung verweigert, oft bei
  Sicherheitsinhalten. Das ist kein Urteil über das Zielsystem. Die Iteration fällt aus der
  Quote und steht im Report unter "Ohne Judge-Urteil". Schlag ein anderes Judge-Modell vor oder
  bewerte mit `aiqa judge --run <id>` nach, und nenne vorher die Kosten.
- Wohin ein Befund geht, entscheidet der Mensch. Lege nichts im Repository des Zielsystems an,
  ohne dass er es ausdrücklich will.
- Für die Übergabe mehrerer Läufe: `aiqa -w <ordner> report --run <a> --run <b> --format html`.
  Frag vorher, was bewusst nicht geprüft wurde, und trag es als `outOfScope` in Plan oder
  Goldset ein, bevor die Läufe starten. Sonst steht im Report nur, dass nichts genannt ist.
- Wer lieber im Browser arbeitet: `aiqa -w <ordner> ui` öffnet die lokale Oberfläche mit Läufen,
  Reports, Entwürfen und Befunden.

### 8. Weiter

Nutzt der Mensch schon promptfoo, übernimmt `aiqa -w <ordner> import promptfoo --file
ergebnis.json` dessen Ergebnisse als Lauf (README, Abschnitt 6).

Zum Abschluss in zwei Sätzen, was eingerichtet ist und was als Nächstes sinnvoll ist:
`aiqa compare --base previous --head latest` nach einer Änderung am Zielsystem, Gates und
Zeitplan für regelmäßige Läufe (README, Abschnitt 8), Kalibrierung, falls der Judge noch nicht
geprüft ist.
