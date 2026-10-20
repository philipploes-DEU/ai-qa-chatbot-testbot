# ADR 0022: Platzhalter aus Datenquellen (Fixture-Resolver)

Status: angenommen am 19.10.2026, umgesetzt am 19.10.2026

Ergebnis der Klärung zu Issue #93. Baut auf ADR 0002 (Dateien statt Datenbank), ADR 0016
(Judge mit Quelldokumenten), ADR 0017 (Folgeaufrufe im Dialog) und ADR 0019 (Iterationen ohne
Judge-Urteil) auf.

## Kontext

Bei Zielsystemen mit veränderlichem Index, etwa einer KI-Suche über Aussteller je Messejahr,
altern feste Werte im Goldset mit jedem Datenstand. Fehlschläge entstehen dann ohne Regression,
und das Goldset muss von Hand nachgepflegt werden. Prüfabsicht und konkrete Werte sollen
getrennt werden.

Heute ersetzt AI QA Platzhalter nur in der Request-Vorlage des `http`-Adapters (`{{input}}`,
`{{vars.name}}`, `{{capture.name}}`). Die Felder eines Falls selbst werden nirgends ersetzt.

## Entscheidung

1. Platzhalter heißen `{{fixtures.name}}`, in derselben Form wie `{{vars.name}}` und
   `{{capture.name}}` und mit denselben Namensregeln. Eckige Klammern wie `[NAME_1]` scheiden
   aus, weil sie mit Quellenmarken wie `[1]` und mit Markdown kollidieren.
2. Erlaubt sind Platzhalter in `input` und Dialogzügen, `expected.answer`, `mustContain`,
   `mustNotContain`, `mustNotClaim`, Rubrikbeschreibungen und Werten unter `vars`. Nicht in
   `mustMatch`, `mustNotMatch` und `schema`, weil ein Wert mit Sonderzeichen dort als Muster
   wirken würde. `validate` lehnt einen Platzhalter dort ab.
3. Eine neue Ersetzungsschicht setzt die gebundenen Werte vor Lauf, Checks und Judge in den
   Fall ein. Adapter, Checks und Judge sehen nur den fertigen Fall.
4. Das Goldset deklariert je Platzhalter die Bedingung in Fachsprache, die Prüfabsicht. Der
   Block heißt im Goldset wie in `aiqa.yaml` `fixtures`, im Goldset steht aber nur die Absicht:

   ```yaml
   fixtures:
     aussteller_1: { condition: "Ein Aussteller des aktuellen Messejahrs mit Stand in Halle 3" }
   ```

   `validate` lehnt einen genutzten, aber nicht deklarierten Platzhalter ab.

5. Die Technik steht im Block `fixtures` der `aiqa.yaml`:
   - `sources`: benannte Quellen vom Typ `file`, `http` oder `script`, Zugangsdaten nur als
     `${NAME}`.
   - `queries`: gespeicherte Abfragen mit Quelle, `version`, `approvedBy`, `approvedAt`, dem
     Request und dem Pfad auf die Zeilen, etwa `rows: $.hits.hits[*]._source`.
   - `bindings`: je Platzhalter Abfrage, Zeile und Feld. Werte aus derselben Zeile halten
     Eingabe und Erwartung zusammen:

   ```yaml
   bindings:
     aussteller_1: { query: aussteller-halle-3, row: 0, field: name }
     stand_1: { query: aussteller-halle-3, row: 0, field: stand }
   ```

   Die Reihenfolge der Zeilen ist Sache der gespeicherten Abfrage, etwa ein `sort` im Request.
   AI QA kann sie nicht prüfen. Das Bindungsprotokoll macht jeden Wertetausch sichtbar.

6. Resolver-Schnittstelle:

   ```ts
   interface FixtureResolver {
     readonly type: string;
     rows(query: StoredQuery, signal: AbortSignal): Promise<Record<string, unknown>[]>;
   }
   ```

   Im Kern stehen `file`, `http` und `script`. `http` deckt Elastic und Solr ohne neue
   Abhängigkeit ab. SQL läuft über `script`, ein Kommando, das Zeilen als JSON ausgibt, wie beim
   ScriptAdapter. Kein Datenbanktreiber im Kern. Für Tests und CI gibt es einen
   `DummyResolver`, ohne Netzwerk.

7. Binden ist ein eigener Schritt: `aiqa resolve [--plan <datei>]` führt die Abfragen aus und
   schreibt `runs/bindings/<zeitpunkt>.json`, ein Verzeichnis ohne `run.json`, wie die
   Kalibrierungen. `aiqa run` nimmt die neueste Bindung, kopiert sie nach
   `runs/<lauf>/bindings.json` und bricht vor dem ersten Aufruf ab, wenn ein Plan Platzhalter
   ohne Bindung nutzt. Während des Laufs gibt es keine Zugriffe auf die Datenquelle.
   `aiqa run --resolve` darf beides in einem Aufruf erledigen.
8. Bindungsprotokoll je Lauf: Platzhalter, Abfrage mit Version, Quelle, Zeitpunkt, Wert, Wert
   im Vorlauf desselben Zielsystems und Status `bound` oder `unresolved`. Werte können personenbezogen sein und liegen deshalb nur unter `runs/`, das nie ins
   Repository gehört. Der Report nennt unter "Getauschte Werte seit dem Vorlauf" die
   Platzhalter mit geändertem Wert, mit Abfrage und Version, ohne die Werte. Fehlermeldungen
   der Quellen nennen nur die Art des Fehlers, keine Datenauszüge. `aiqa compare` nennt die
   Platzhalter, deren Werte sich zwischen Base und Head unterscheiden, ebenfalls ohne Werte.
9. `unresolved`: Liefert eine Abfrage zu wenige Zeilen, fehlt das Feld oder scheitert die
   Quelle, wird kein Fall mit diesem Platzhalter geschickt. Er steht mit Status `unresolved` im
   Lauf, fällt aus jeder Quote und erscheint als eigene Kennzahl im Report.
10. Befehle, die auf einem gespeicherten Lauf arbeiten, nutzen dessen Bindung: `aiqa judge
--run` bewertet mit den Werten des Laufs und überspringt Fälle ohne Wert. Der Paarvergleich
    lässt Fälle aus, deren Werte sich zwischen den Läufen unterscheiden. Kalibrierungsstichproben
    auf Fällen mit Platzhaltern lehnt das Schema ab, weil die gelabelte Antwort zu einem festen
    Datenstand gehört.
11. Mit `mapping:` je Quelle, einer Liste der Felder, prüft `validate` die Felder der
    Bindungen. Eine Prüfung der Abfragesprache selbst kommt später.
12. Abfragen sind gespeichert, versioniert und abgenommen und entstehen nie pro Lauf. Werte aus
    dem Goldset fließen nie in eine Abfrage. Fehlt `approvedBy`, nennt der Lauf einen Hinweis.

## Begründung

- Das Goldset bleibt bei der Prüfabsicht, die Konfiguration bei der Technik. Ein neuer
  Datenstand ändert nur die Bindung, nicht die Fälle.
- Ein eigener Schritt macht Läufe reproduzierbar: dieselbe Bindung ergibt denselben Lauf, und
  ein Wertetausch ist sichtbar statt versteckt.
- `file`, `http` und `script` decken die genannten Quellen ab, ohne den Kern mit Treibern und
  ihrer Angriffsfläche zu belasten.

## Konsequenzen

- Der Resolver liest dieselbe Quelle wie das Zielsystem. Fehler in den Daten des Index bleiben
  damit unsichtbar. Doku und Report sagen das.
- Phase 1: Schema, Ersetzungsschicht, die drei Resolver, `aiqa resolve`, Bindung im Lauf,
  `unresolved` und Report. Phase 2: `compare`, Prüfung gegen das Mapping und der
  Einrichtungs-Skill mit der Frage, ob erwartete Antworten von veränderlichen Daten abhängen.
