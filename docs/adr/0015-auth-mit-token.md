# ADR 0015: Auth mit Token-Beschaffung und Erneuerung

Status: angenommen am 13.10.2026

Ergebnis von Issue #73. Erweitert die Auth-Bausteine aus Issue #5.

## Kontext

Bisher kennt AI QA nur statische Zugangsdaten: `basic`, `bearer` und `header`, jeweils als
Verweis auf eine Umgebungsvariable. Viele Zielsysteme geben nach einem Login aber kurzlebige
Access-Tokens aus. Anlass ist ein Produkt mit Supabase Auth: Login per E-Mail und Passwort mit
`POST <projekt-url>/auth/v1/token?grant_type=password`, Header `apikey` mit dem Anon-Key, Body
mit `email` und `password`, Antwort mit `access_token`, `expires_in` und `refresh_token`. Ein
statisches Token läuft während eines längeren Laufs ab, und ein Kunde kann Tokens oft nicht von
Hand holen.

## Entscheidung

1. Neuer Auth-Typ `token` im `target`-Block mit `tokenEndpoint`, optional `refreshEndpoint`,
   `grantType` (zunächst nur `password`), `username` und `password` als Verweis auf
   Umgebungsvariablen, `format` (`form` nach OAuth 2 oder `json`), Feldnamen für die
   Zugangsdaten, zusätzlichen Headern und Pfaden zu Token, Lebensdauer und Refresh-Token in der
   Antwort. Header-Werte als `${NAME}` kommen aus der Umgebung.
2. Der HTTP-Client holt seine Auth-Header über eine Schnittstelle `AuthProvider`. Statische
   Typen liefern feste Header, `TokenAuth` holt das Token vor dem ersten Aufruf und schickt es
   als `Authorization: Bearer`.
3. Erneuerung: Ab einer Minute vor Ablauf, bei kurzer Lebensdauer ab ihrer Hälfte. Mit
   `refreshEndpoint` per Refresh-Token, sonst oder wenn das scheitert per neuer Anmeldung. Ohne
   `expires_in` gilt das Token, bis das Zielsystem es ablehnt. Gleichzeitige Aufrufe teilen sich
   eine laufende Token-Anfrage.
4. Auf HTTP 401 erneuert der Client das Token einmal und wiederholt den Aufruf einmal. Ein
   zweites 401 wird zum Fehler dieser Iteration, nicht des Laufs.
5. Scheitert die Token-Beschaffung (Status, kein JSON, kein Token unter dem Pfad, nicht
   erreichbar, Zeitüberschreitung nach `timeouts.requestMs`), wirft `TokenAuth` einen
   `FatalTargetError`. Der Runner beendet den Lauf dann sauber als abgebrochen mit diesem
   Grund. Die unterbrochene Iteration wird nicht gespeichert.
6. Tokens und Passwort stehen nur im Speicher. Fehlermeldungen nennen den Antwortauszug des
   Token-Endpoints nur bei einem Fehlerstatus und ohne Geheimnisse, nie die Antwort mit Token.
   Taucht ein Token in Antworten oder Fehlermeldungen des Zielsystems auf, ersetzt der Client
   es vor der Weitergabe durch `[Token entfernt]`. Das Passwort geht nie an das Zielsystem und
   wird nur aus Fehlermeldungen des Token-Endpoints entfernt.
7. `token` nutzen die Adapter `http` und `openai-compatible`. Die Konfiguration lehnt es für
   andere Adapter ab.

## Begründung

- Eine Schnittstelle für Auth-Header hält den Client frei von Sonderfällen und lässt weitere
  Verfahren später zu, ohne Adapter zu ändern.
- `form` als Standard folgt OAuth 2, `json` mit Feldnamen und Grant in der URL deckt Supabase
  und ähnliche Dienste ab, ohne eigenen Typ je Anbieter.
- Ohne gültiges Token ist jeder weitere Aufruf sinnlos. Ein Abbruch mit klarer Meldung ist
  ehrlicher als ein Lauf, in dem jede Iteration mit demselben Fehler endet, und spart Budget.
- Ein zweites 401 mit frischem Token kann gewollt sein, etwa wenn ein Fall einen gesperrten
  Bereich prüft. Deshalb bricht es nur die Iteration ab.
- Das Ersetzen von Tokens in Antworten macht sichtbar, dass ein Token zurückkam, ohne es in
  JSONL, Logs oder Reports zu schreiben.

## Konsequenzen

- Ein Login je Lauf und Zielsystem, ein Testuser je Lauf. Mehrere Testuser, etwa für die
  Mandantentrennung, sind ein eigenes Thema.
- Kein interaktiver OAuth-Flow, kein Browser-Login, kein Client-Credentials-Grant in dieser
  Fassung. `grantType` ist dafür vorbereitet.
- Token-Anfragen laufen nicht über Rate Limit und Backoff des Zielsystems. Ein vorübergehender
  Fehler des Token-Endpoints bricht den Lauf ab.
- Statische Zugangsdaten werden weiter nicht aus Antworten entfernt, nur aus Fehlermeldungen
  von AI QA selbst herausgehalten.
