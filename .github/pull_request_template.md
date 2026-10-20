## Bezug

Closes #<nr>. (GitHub schließt das Issue beim Merge nur bei diesem englischen Schlüsselwort.)

## Was ändert sich

Kurz, in Sätzen. Architekturentscheidungen als ADR verlinken.

## Wie geprüft

Welche Tests neu sind, was manuell ausgeführt wurde.

## Checkliste

- [ ] Test zuerst geschrieben, Tests grün (`pnpm test`)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format:check` ohne Fehler
- [ ] Keine Secrets, keine Kundendaten, keine Netzwerkaufrufe in Tests
- [ ] Dokumentation angepasst, falls Verhalten sichtbar wird
- [ ] Commits nach Conventional Commits mit Issue-Nummer und `Signed-off-by`
