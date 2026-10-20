# AI QA: Handbuch

Dieses Handbuch erklärt, wofür AI QA da ist, was es kann, was du dafür brauchst, wie du es
bedienst und was die Ergebnisse bedeuten. Es richtet sich an Fachleute, die eine
KI-Schnittstelle verantworten oder prüfen, ohne Entwicklerhintergrund. Für Details zu Befehlen
und Dateien verweist es auf die [README](../README.md).

## 1. Ziel

Wer einen Chatbot, eine KI-Suche oder einen Assistenten verantwortet, muss belegen können, dass
das System das Richtige sagt und das Falsche verweigert. Eine einzelne Stichprobe beweist wenig,
weil KI-Antworten nicht deterministisch sind: dieselbe Frage bekommt heute eine andere Antwort
als morgen. Prüfungen gegen bekannte Risiken wie Prompt Injection oder das Preisgeben interner
Anweisungen sind ohne Werkzeug Handarbeit.

AI QA beantwortet dafür eine Frage mit Zahlen: Wie oft antwortet die Schnittstelle richtig, wie
oft verweigert sie, was sie verweigern soll, und wie sicher ist dieses Ergebnis. Dafür stellt AI
QA jede Frage mehrfach, bewertet die Antworten mit festen Regeln und einem zweiten Modell als
Prüfer und rechnet aus, was die Wiederholungen über die Zuverlässigkeit aussagen. Das Ergebnis
ist ein Report, den du ablegen, vergleichen und weitergeben kannst.

Was AI QA nicht ist: kein Live-Monitoring deines Betriebs, kein Vergleich von Sprachmodellen
untereinander und kein Ersatz für eine Sicherheitsprüfung durch Menschen. AI QA liefert Belege
für ein konkretes System gegen einen konkreten Satz von Testfällen.

## 2. Was AI QA kann

- Testfälle fahren: Frage-Antwort-Fälle, Dialoge mit mehreren Gesprächszügen und Proben, die
  gezielt Fehlverhalten auslösen wollen. Die Fälle liegen als Goldset in einer Textdatei, mit
  Erwartung, Bewertungsrubrik, Schweregrad und Freigabestatus.
- Zielsysteme anbinden: jede Chat-Schnittstelle mit JSON-Antwort über ein Request-Template, jede
  OpenAI-kompatible Schnittstelle (eigene Gateways, Ollama, Hosting-Anbieter), die
  Web-Oberfläche eines Bots über einen gesteuerten Browser, ein lokales Kommando als Ausweichweg
  und ein Dummy ohne Netzwerk zum Ausprobieren. Zugang über Umgebungsvariablen, auch mit Login
  und kurzlebigen Tokens, die AI QA selbst holt und erneuert. Rate Limit, Wiederholung bei
  Überlast, Timeouts.
- Antworten bewerten: deterministische Checks entscheiden, was keine Interpretation braucht
  (Begriff enthalten oder nicht, Muster, JSON-Struktur, Verweigerung, schlüsselförmige Geheimnisse,
  Antwortzeit). Was übrig bleibt, bewertet der Judge, ein zweites Modell, nach der Rubrik des
  Falls mit Begründung je Kriterium. Antworten, die den Prüfer ansprechen, scheitern immer.
- Fehlschläge analysieren lassen: der Analyseagent gruppiert die Fehlschläge eines Laufs und
  bildet je Gruppe eine Hypothese zur Ursache mit Vorschlägen für neue Testfälle. Ein Mensch
  bestätigt oder verwirft, nur Bestätigtes erscheint im Report.
- Im Browser arbeiten: `aiqa ui` öffnet eine lokale Oberfläche mit Läufen, Trend, Reports,
  Entwürfen und Befunden. Freigaben und Entscheidungen gehen dort per Klick. Dieses Handbuch
  steht dort ebenfalls, unter "Handbuch".
- Testfälle vorschlagen lassen: der Planungsagent liest Fachdokumente und schlägt Fälle mit
  Referenzantwort, Rubrik und wörtlichem Beleg vor. Sie bleiben Entwürfe, bis ein Mensch sie
  freigibt, und zählen bis dahin nicht in die Quote.
- promptfoo übernehmen: `aiqa import promptfoo` macht aus einer Ergebnisdatei von promptfoo einen
  Lauf mit Goldset, ausgewertet wie ein eigener. `aiqa import promptfoo-cases` übernimmt die von
  promptfoo erzeugten Angriffe als Entwürfe mit Erwartung, die du prüfst und dann selbst fährst.
- Risiken aus dem OWASP-Katalog prüfen: 43 fertige Testmuster zu allen von außen prüfbaren
  Risiken der OWASP Top 10 for LLM Applications und des OWASP AI Testing Guide, von Prompt
  Injection und Datenlecks über unsichere Ausgaben und Handlungsfreiheit bis zu Fehlinformation,
  Verzerrung und Toxizität, mit deinen Angaben zum System befüllt. Die Abdeckung je Risiko steht
  in `docs/probenkatalog.md`.
- Wiederholen und rechnen: jeder Fall läuft n-mal. AI QA berechnet Pass-Rate, Konfidenzintervall,
  Schwankung und die Wahrscheinlichkeit, dass mehrere Wiederholungen alle bestehen.
- Kosten begrenzen: ein Plan hat ein Budget an Aufrufen und Tokens. Wird es erreicht, endet der
  Lauf sauber und ist im Report als unvollständig gekennzeichnet.
- Berichten: ein Report je Lauf mit Zusammenfassung, Fehlerquote je Kategorie, Trend über die
  letzten Läufe, Tabelle je Fall, Fehlschlägen mit Begründung und Hinweisen. Als Markdown für
  Entwickler oder als eigenständige HTML-Datei für die Abnahme durch einen Fachbereich. Die
  Rohdaten liegen daneben als Textdateien.

Dialoge laufen Runde für Runde mit einer Sitzung. Der Judge misst die letzte Runde an Rubrik und
Referenzantwort des Falls, frühere Runden nur an ihrer Antwort aus dem Skript, wenn es eine gibt,
und das ganze Gespräch an vier festen Kriterien (Ziel erreicht, Rolle gehalten, Kontext
behalten, Gespräch vollständig). Bietet das Zielsystem eine Folgeaktion an, etwa eine
gründlichere Suche, kann ein Dialog sie annehmen: Werte aus der Antwort übernehmen und in den
nächsten Aufruf einsetzen.

- Den Judge prüfen: je Goldset kannst du Antworten hinterlegen, die ein Mensch bewertet hat.
  AI QA misst den Judge daran (Cohen's Kappa) und gibt ihn erst ab einer Schwelle frei. Der
  Report sagt, ob der Judge für ein Goldset freigegeben ist, und zeigt eine Stichprobe der
  Fehlschläge mit Originalantwort und Begründung.

- Läufe vergleichen: `aiqa compare` stellt zwei Läufe gegenüber, je Fall mit Pass-Raten,
  Intervallen, neuen und verschwundenen Fehlschlägen, als Markdown und JSON. Mit `--pairwise`
  lässt der Judge beide Antworten gegeneinander antreten, in beiden Reihenfolgen, damit die
  Position der Antwort das Urteil nicht bestimmt.
- Regelmäßig laufen: eine Vorlage für GitHub Actions fährt den Lauf nächtlich, von Hand oder
  nach einem Deployment. Gates in der Konfiguration (Mindest-Pass-Rate, kritische Fehlschläge,
  Rückgang gegenüber dem Vorlauf) lassen den Job scheitern, ein Budget je Lauf deckelt die Kosten.

Was heute noch nicht geht: PDF-Export. Die
Reihenfolge steht als Issues im Repository.

## 3. Voraussetzungen

- Ein Rechner mit Node 22 oder neuer und pnpm. AI QA läuft als Kommandozeilenwerkzeug, bis zum
  ersten Paket aus dem Repository heraus.
- Zugang zur Schnittstelle, die du prüfen willst: eine URL und, wenn nötig, Zugangsdaten. Für
  das Ausprobieren reicht das mitgelieferte Dummy-Zielsystem oder der Mock-Server unter
  `examples/`, beide ohne Netzwerk.
- Die Erlaubnis, das System zu prüfen. Proben gegen fremde Systeme ohne Erlaubnis sind ein
  Angriff, auch wenn sie nur Fragen stellen.
- Ein Modell für den Judge, sobald Rubriken bewertet werden sollen: lokal über Ollama ohne
  Schlüssel oder ein Anbieter mit OpenAI-kompatibler Schnittstelle und API-Schlüssel. Der Judge
  muss ein anderes Modell sein als das Zielsystem, AI QA prüft das. Ohne Judge urteilen nur die
  deterministischen Checks.
- Wissen über das System: die richtigen Antworten auf die wichtigsten Fragen, was das System
  verweigern soll, ein kurzer Wortlaut aus seinem System-Prompt für die Leck-Prüfung. Das
  schreibst du in die Testfälle, kein Werkzeug kann es für dich wissen.
- Ein Budget für Modellaufrufe. Jeder Fall mal jede Wiederholung ist ein Aufruf des Zielsystems
  und meist einer des Judges.

## 4. Bedienung

Jeder Schritt entspricht einem Befehl. Die genaue Schreibweise und die Ausgabe jedes Schritts
stehen in der [README, Abschnitt 3](../README.md#3-erster-lauf-in-zehn-minuten).

Wer lieber geführt wird: Im Repository mit Claude Code nach der Einrichtung von AI QA fragen. Der
Skill `aiqa-einrichtung` unter `.claude/skills/` geht die Schritte unten im Dialog durch, auf
Deutsch oder Englisch, und prüft nach jedem Schritt mit `aiqa validate`.

1. Arbeitsbereich anlegen: `aiqa init <ordner>` erzeugt einen Ordner mit der Konfiguration
   `aiqa.yaml`, einem Beispiel-Goldset und einem Plan. Der Arbeitsbereich gehört dir, deine
   Fälle und Ergebnisse bleiben dort, nie im Werkzeug selbst.
2. Zielsystem eintragen: in `aiqa.yaml` den Adapter wählen, die URL und das Format der
   Schnittstelle beschreiben, Zugangsdaten als Verweis auf Umgebungsvariablen hinterlegen. Am
   einfachsten geht das aus einem Aufruf, den du im Browser als cURL kopierst:
   `aiqa import curl --file <datei>` schreibt daraus einen Entwurf ohne Zugangsdaten.
   Die Werte trägst du in eine `.env` ein, Vorlage ist `.env.example`. Die Datei lädt aiqa vor
   jedem Befehl, zuerst aus dem Arbeitsbereich, dann aus dem Startverzeichnis.
   Beispiele für beide Adapter stehen in der README, Abschnitt 4, lauffähige Vorlagen unter
   `examples/`.
3. Judge eintragen: in `aiqa.yaml` den `judge`-Block mit Adresse und Modell ausfüllen. Ohne ihn
   läuft alles weiter, nur ohne Bewertung nach Rubrik. Hat dein Zielsystem eine Wissensbasis,
   trage sie im Goldset unter `sources` ein. Dann wertet der Judge richtige Angaben, die über
   die Referenzantwort hinausgehen, nicht als erfunden.
4. Fälle schreiben: das Goldset ist eine YAML-Datei. Je Fall eine Eingabe, die Erwartung
   (Begriffe, die vorkommen oder fehlen müssen, Verweigerung, Referenzantwort) und eine Rubrik
   für den Judge. Fälle beginnen als Entwurf und werden nach Prüfung freigegeben. Aufbau und
   Beispiele: README, Abschnitt 5.
5. Proben hinzufügen: in `aiqa.yaml` unter `probes.variables` den Namen deines Betreibers, den
   des Assistenten, einen Wortlaut aus dem System-Prompt und eine erfundene Canary eintragen.
   `aiqa plan --probes` macht daraus Probe-Fälle aus dem OWASP-Katalog. README, Abschnitt 6.
6. Prüfen: `aiqa validate` prüft alle Dateien auf Fehler, bevor ein Aufruf Geld kostet.
   Liegen Fachdokumente vor (FAQ, Richtlinien, Tickets), schlägt `aiqa plan --docs <pfad>`
   Testfälle daraus vor. Sie landen als Entwurf in `goldsets/entwuerfe.yaml`, du prüfst jeden
   gegen sein Zitat und setzt `status: approved`. Entwürfe laufen mit, zählen aber nicht.
7. Plan schreiben: `aiqa plan` erzeugt einen Plan über alle aktiven Fälle mit der Zahl der
   Wiederholungen und dem Budget. Mit `--docs` wählt er die Wiederholungen nach Schwere und
   nennt eine Budgetschätzung. Den Plan kannst du vor dem Lauf anpassen.
8. Laufen lassen: `aiqa run --plan <plan>` zeigt Budget und erwartete Aufrufe, fährt die Fälle,
   meldet je Fall, wie viele Wiederholungen bestanden haben, und schreibt die Rohdaten.
9. Report bauen: `aiqa report --run latest` erzeugt den Markdown-Report des letzten Laufs,
   `aiqa report --run latest --format html` eine HTML-Datei für die Abnahme. Sie lädt beim
   Öffnen nichts nach und lässt sich so per Mail weitergeben. `--theme neutral` liefert sie ohne
   Wirkmittel-Design, schwarz auf weiß. `--format junit` schreibt JUnit-XML für Testanzeigen,
   etwa in GitHub Actions.
   Vorher einmal `aiqa calibrate`, sobald ein Goldset menschlich bewertete Stichproben trägt,
   damit der Report sagen kann, wie weit dem Judge zu trauen ist. Für eine Übergabe fasst
   `aiqa report --run <a> --run <b>` mehrere Läufe desselben Zielsystems zu einem Report
   zusammen: Ergebnis, Befunde, Bestanden je Kategorie, bewusst nicht geprüfte Bereiche aus
   `outOfScope` in Plan oder Goldset, Grenzen der Prüfung und Aufwand.
10. Veränderliche Daten: Hängen erwartete Antworten von Daten ab, die sich ändern, stehen im
    Fall Platzhalter `{{fixtures.name}}`. `aiqa resolve` holt die Werte aus einer gespeicherten
    Abfrage, `aiqa run` setzt sie ein. Der Report zeigt, welche Werte seit dem letzten Lauf
    getauscht wurden.
11. Nachbewerten: `aiqa judge --run <id>` ergänzt Judge-Urteile für einen Lauf, der ohne Judge
    entstand oder mit einem neuen Judge-Prompt bewertet werden soll, und für Iterationen, bei
    denen der Judge ablehnte oder scheiterte.
12. Analysieren: `aiqa analyze --run latest` bildet Hypothesen zu den Fehlschlägen,
    `--confirm` und `--reject` halten deine Entscheidung fest, mit Ursache und Vorschlag oder
    mit Grund, etwa "Fehlalarm des Werkzeugs". Mit `--no-agent` geht keine Antwort an ein
    Modell. Der Report zeigt dann neben der rohen auch die bereinigte Quote.
13. Im Browser arbeiten: `aiqa ui` zeigt Läufe und Reports und nimmt Freigaben von Entwürfen
    und Entscheidungen über Befunde entgegen, nur auf deinem Rechner.
14. Vergleichen: `aiqa compare --base previous --head latest` zeigt, was sich zwischen zwei
    Läufen geändert hat.
15. Automatisieren: `aiqa init <ordner> --with-schedule` legt einen GitHub-Actions-Workflow an,
    `aiqa gate --run latest --base previous` prüft die Gates aus der Konfiguration. Jeder Lauf
    hinterlässt in GitHub den Report in der Job-Zusammenfassung und ein Artefakt mit Läufen,
    HTML-Report und JUnit-XML. Auf Wunsch läuft danach der Analyseagent mit.

Vor dem ersten echten Lauf lohnt ein Durchlauf gegen das Dummy-Zielsystem, wie in der README
beschrieben. Er kostet nichts und zeigt alle Schritte.

## 5. Ergebnisse

Ein Lauf hinterlässt drei Dateien im Ordner `runs/<lauf-id>/`: die Metadaten des Laufs
(Zielsystem, Plan, Judge, Status, Hinweise), eine Zeile je Aufruf mit Anfrage, Antwort,
Antwortzeit und Tokens, und eine Zeile je Urteil. Lehnt der Judge eine Bewertung ab oder
scheitert er, kommt eine vierte Datei mit diesen Iterationen dazu. Der Report fasst alles
zusammen.

- Iteration: eine Wiederholung eines Falls. Jede Zahl im Report bezieht sich auf Iterationen.
- Urteil: die Bewertung einer Iteration durch einen Check oder den Judge, je mit Begründung.
  Eine Iteration besteht nur, wenn alle ihre Urteile bestehen.
- Pass-Rate: Anteil der bestandenen Iterationen eines Falls. Fünf von fünf heißt 100 Prozent,
  sagt aber wenig über das nächste Mal.
- Wilson-Intervall: der Bereich, in dem die wahre Pass-Rate mit 95 Prozent Sicherheit liegt. Bei
  fünf von fünf reicht er von 56,6 bis 100 Prozent. Erst mehr Wiederholungen machen ihn eng. Das
  ist der Grund, warum AI QA wiederholt statt einmal zu fragen.
- Flakiness: Anteil der Iterationen, die vom Mehrheitsergebnis abweichen, von 0 (stabil) bis 0,5
  (halb und halb). Eine Schwankung ist selbst ein Befund, auch wenn die Pass-Rate gut aussieht.
- pass-all-k: die geschätzte Wahrscheinlichkeit, dass k zufällig gezogene Iterationen eines
  Falls alle bestehen. Für Fälle, die jedes Mal stimmen müssen, ist das die strengere Zahl.
- Fehlschläge: je gescheiterter Iteration das Kriterium und seine Begründung, zum Beispiel
  "fehlt: 17" von einem Check oder "Korrektheit: nennt Samstag, die Referenz nennt Montag bis
  Freitag" vom Judge.
- Fehler: Aufrufe, die technisch scheiterten (Timeout, Verbindungsfehler, Statuscode). Sie
  zählen als gescheiterte Iteration, mit dem Grund.
- Nicht ausgeführt (HTTP 429): Lehnt das Zielsystem weitere Anfragen ab, etwa am Tageslimit
  eines Testkontos, endet der Lauf. Solche Aufrufe haben nichts geprüft und zählen in keiner
  Quote. Mit `rateLimit.maxCallsPerDay` warnt AI QA schon vor dem Lauf.
- Ohne Judge-Urteil: Iterationen, die der Judge bewerten sollte, aber nicht bewertet hat. "Judge
  lehnt ab" heißt, das Modell hat die Bewertung verweigert oder leer geantwortet, "Judge-Fehler"
  heißt, seine Antwort war unbrauchbar. Sie zählen nicht in der Pass-Rate, außer ein Treffer in `mustNotClaim` zählt
  ohne Urteil als Fehlschlag. Ein Judge, der oft ablehnt, braucht ein anderes Modell oder einen anderen Prompt.
- Hinweise zum Lauf: der Report nennt den Judge mit Prompt-Version, warnt, wenn Judge und
  Zielsystem dasselbe Modell nutzen, und kennzeichnet einen abgebrochenen Lauf als unvollständig.
- Fehlerquote je Kategorie: Anteil der gescheiterten Iterationen je OWASP-ID oder Fachtag, mit
  Intervall. Zeigt, wo das System am schwächsten ist.
- Trend: Pass-Rate der letzten zehn Läufe gegen dasselbe Zielsystem. Im HTML-Report als
  Diagramm mit Intervall, darunter die Werte als Tabelle.
- Kernaussage: der HTML-Report beginnt mit wenigen Sätzen aus den Zahlen des Laufs, Pass-Rate
  mit Intervall, schwächste Kategorie, Schwankung, und was die Zahlen weniger belastbar macht.

Wie du die Zahlen liest: Ein Fall mit 100 Prozent und breitem Intervall braucht mehr
Wiederholungen, bevor du ihn als sicher einstufst. Ein Fall mit hoher Flakiness ist ein
Zuverlässigkeitsproblem, auch wenn er meist besteht. Ein Probe-Fall mit Schweregrad `critical`,
der auch nur einmal scheitert, ist ein Befund, den du nicht wegmitteln solltest. Ein Befund im
Sinne von AI QA ist eine Hypothese über mehrere Fehlschläge hinweg, zum Beispiel "Rollenwechsel
in der Eingabe hebelt die Regeln aus". Das Gruppieren übernimmt `aiqa analyze`, die Hypothesen
prüfst du selbst.

Läufe und Reports enthalten wörtlich, was das Zielsystem geantwortet hat, auch versehentlich
preisgegebene Inhalte. Behandle sie wie vertrauliche Daten. Mehr dazu in der README, Abschnitt 9.
