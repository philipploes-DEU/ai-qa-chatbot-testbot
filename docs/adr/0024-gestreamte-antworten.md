# ADR 0024: Gestreamte Antworten im Adapter http

Status: angenommen am 26.10.2026

Ergebnis von Issue #106, gemeldet als Issue 1 im öffentlichen Release-Repository. Baut auf ADR
0017 (Folgeaufrufe im Dialog) und ADR 0021 (HTTP 429 beendet den Lauf) auf.

## Kontext

Viele Agenten und Assistenten antworten nicht mit einem JSON-Dokument, sondern streamen ihre
Antwort als NDJSON (eine JSON-Zeile je Ereignis) oder als Server-Sent Events. Der Adapter
`http` brach dann mit "Antwort ist kein JSON" ab, obwohl der Aufruf gelang. Der Ausweichweg über
den Adapter `script` verliert Auth, Wiederholungen, Statusprüfung, Variablen, Folgeaufrufe und
Sitzungen. Bei der Einrichtung eines Agenten kam die Antwort in dieser Form:

```
{"type":"thread","threadId":"3f2a9c1e-0000-4000-8000-000000000001"}
{"type":"final","reply":"Unser Kundenservice ist Montag bis Freitag von 9 bis 17 Uhr für Sie da."}
```

## Entscheidung

1. `request.responseFormat` wählt, wie der Adapter die Antwort liest: `json` (Standard, ein
   Dokument), `ndjson` oder `sse`. Der Adapter liest den Stream immer bis zum Ende, bewertet
   nichts unterwegs und bricht nicht nach einer Teilantwort ab. Die Latenz zählt bis zum Ende
   des Streams, Timeouts gelten unverändert für den ganzen Aufruf.
2. Ereignisse sind die Einheit eines Streams. Bei NDJSON ist jede nicht leere Zeile ein
   Ereignis, ihr JSON-Wert. Bei SSE ist jedes Ereignis ein Objekt `{ event, id, data }`: `data`
   als JSON, wenn es JSON ist, sonst als Text; `event` und `id` nur, wenn das Zielsystem sie
   sendet. Mehrere `data:`-Zeilen werden mit Zeilenumbruch verbunden, Kommentare und unbekannte
   Felder fallen weg, `data: [DONE]` ist die Endmarke und wird kein Ereignis.
3. `request.responseEvent` wählt die Ereignisse mit dem Text: `path` mit `equals` trifft die
   Ereignisse, deren Wert am Pfad gleich ist (Nicht-Strings als JSON verglichen). Ohne `path`
   zählen alle Ereignisse. Ohne `concat` liest `responsePath` das letzte gewählte Ereignis. Mit
   `concat` wird der Text am Pfad `concat` über alle gewählten Ereignisse aneinandergehängt,
   Ereignisse ohne den Pfad fallen weg, `responsePath` entfällt dann. Trifft kein Ereignis oder
   hat keines den Text, ist das ein Fehler der Iteration mit Filter und Auszug.
4. `data` für `capture` und die Sitzung bei `session.mode: body` lesen das letzte gewählte
   Ereignis. `session.event` (`path` und `equals`) wählt stattdessen ein anderes Ereignis für
   die Sitzung, etwa das Thread-Ereignis des Beispiels. Es gibt es nur bei `mode: body` und
   einem Stream-Format.
5. `aiqa import curl --call` und `--response` erkennen NDJSON und SSE am Content-Type, sonst an
   der Form, und schlagen Format, Ereignisfilter und Antwortpfad vor: das letzte Ereignis, wenn
   seine Art einmal vorkommt und Text trägt, sonst den Text über die häufigste Art
   zusammengesetzt. Ein Ereignis mit einem Feld wie `threadId` oder `sessionId` ergibt einen
   Hinweis mit dem passenden `session`-Block.
6. Das Mock-Zielsystem bekommt die Routen `/chat/ndjson` (Thread-Ereignis mit vom Mock vergebener
   ID, dann Final-Ereignis) und `/chat/sse` (Delta-Ereignisse, Done-Ereignis, `[DONE]`). Adapter
   und Import werden dagegen getestet, ohne Netzwerk.

## Begründung

- Ein Format je Request-Template statt Erkennung zur Laufzeit: der Lauf soll reproduzierbar
  sein, und ein Zielsystem, das mal streamt und mal nicht, ist ein Befund, kein Normalfall.
- Ereignisse als Objekte mit Pfaden statt neuer Syntax: `responsePath`, `capture` und
  `session.key` funktionieren wie bisher, nur bezogen auf ein Ereignis. Die SSE-Hülle
  `{ event, data }` ist bewusst sichtbar, weil der Ereignisname oft das Unterscheidungsmerkmal
  ist.
- Letztes statt erstes gewähltes Ereignis: die endgültige Antwort kommt am Ende, Zwischenstände
  davor.
- Kein Bewerten während des Streams: AI QA prüft Antworten, nicht Tippgeschwindigkeit. Wer
  Zeit bis zum ersten Token messen will, braucht ein eigenes Thema.

## Konsequenzen

- `responsePath` ist im Schema optional geworden, die Prüfung hängt am Format: bei `json`
  Pflicht, bei Streams Pflicht ohne `concat`, verboten mit `concat`. `responseEvent` ist bei
  `json` verboten.
- Keine WebSockets, keine Tool-Aufrufe, kein Streaming im Adapter `openai-compatible` (dort
  genügt `stream: false`). Eine Sitzungs-ID als Rückgabe des Adapters `script` bleibt ein
  eigenes Thema.
- Die Rohdaten einer Antwort halten bei Streams die Zahl der Ereignisse und einen Auszug, nicht
  die Ereignisse selbst.
- Nachtrag 28.10.2026 (Issue #111): `session.initial` regelt den ersten Zug einer
  `body`-Sitzung. `generated` schickt wie bisher eine eigene UUID, `omit` lässt das Feld mit
  `{{session}}` aus dem JSON-Body weg, `empty` schickt einen leeren Wert. Kommt im ersten Zug
  keine ID zurück, scheitert die Iteration mit dem Pfad, statt mit leerer ID weiterzumachen.
