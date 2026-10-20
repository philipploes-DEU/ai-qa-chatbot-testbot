/**
 * Knowledge base of the invented Gartenhelden GmbH for the advanced bot (issue #66). Company,
 * people, prices, phone numbers and addresses are made up. The goldset in goldsets/goldset.yaml
 * checks answers against exactly these facts; change both together.
 */
export const KNOWLEDGE_BASE = `# Wissensbasis Gartenhelden GmbH (Stand Frühjahr 2026)

## Unternehmen
Die Gartenhelden GmbH ist ein Versandhandel für Gartenbedarf mit Sitz in Musterstadt. Neben dem Onlineshop gibt es 12 Filialen in Deutschland: Hamburg, Bremen, Hannover, Berlin, Leipzig, Dresden, Köln, Düsseldorf, Frankfurt am Main, Stuttgart, München und Nürnberg. In Österreich, der Schweiz und anderen Ländern gibt es keine Filialen.

## Kontakt und Öffnungszeiten
- Kundenservice per Telefon: Montag bis Freitag von 8 bis 18 Uhr unter 0800 0000000 (kostenfrei).
- Kundenservice per Chat und E-Mail (service@gartenhelden.example): Montag bis Freitag von 8 bis 18 Uhr, Samstag von 9 bis 14 Uhr. Samstags gibt es keine telefonische Beratung.
- Filialen: Montag bis Samstag von 9 bis 19 Uhr, an Sonn- und Feiertagen geschlossen.
- Datenschutzfragen: datenschutz@gartenhelden.example.

## Sortiment und Preise (Auswahl, Preise inklusive Mehrwertsteuer)
- Hochbeet Lärche 120 x 60 cm, Artikel HB-120: 149,00 €
- Hochbeet Lärche 200 x 80 cm, Artikel HB-200: 219,00 €
- Bio-Tomatenerde 40 Liter, Artikel ER-40: 8,99 €
- Tomatenpflanze 'Rote Murmel' im 12-cm-Topf, Artikel PF-TOM: 3,49 €
- Lavendel 'Hidcote', 3er-Set, Artikel PF-LAV3: 12,90 €
- Apfelbaum 'Elstar' Halbstamm, Artikel PF-APF: 39,90 €
- Rasensamen Spiel und Sport 2 kg, Artikel RS-2: 19,90 €
- Gartenschere Profi, Artikel WZ-GS: 24,90 €
- Gießkanne Zink 10 Liter, Artikel WZ-GK: 34,90 €
- Kompostbehälter 400 Liter, Artikel KO-400: 59,90 €
- Regentonne 300 Liter, Artikel RT-300: 79,00 €
- Vogelhaus Kiefer, Artikel DE-VH: 29,90 €
- Gartenhandschuhe Leder, Artikel WZ-HS: 6,99 €
- Akku-Rasenmäher RM 36, Artikel GE-RM36: 329,00 €, Akku separat für 99,00 € (Artikel GE-AK36)

Verfügbarkeit: Der Akku-Rasenmäher RM 36 ist ausverkauft und voraussichtlich ab Mai wieder lieferbar. Obstbäume wie der Apfelbaum 'Elstar' werden nur von Oktober bis April verschickt. Gewächshäuser, Gartenmöbel und Grills führt Gartenhelden nicht.

## Versand
- Deutschland, Standard: 4,90 € pro Bestellung, ab 50,00 € Bestellwert versandkostenfrei.
- Sperrgut (Hochbeete, Regentonnen, Kompostbehälter): Zuschlag von 19,90 € pro Bestellung für die Lieferung per Spedition, auch bei Bestellungen ab 50,00 €.
- Express innerhalb Deutschlands: 9,90 € zusätzlich, Zustellung am nächsten Werktag bei Bestellung bis 12 Uhr, nur für Pakete ohne Sperrgut und ohne Pflanzen.
- Österreich: 9,90 € pro Bestellung, kein Sperrgut, kein Express.
- Schweiz und alle anderen Länder: kein Versand.
- Lieferzeit: 2 bis 4 Werktage, Sperrgut 5 bis 8 Werktage.
- Pflanzen werden nur montags bis mittwochs verschickt, damit sie nicht über das Wochenende unterwegs sind.

## Zahlung
Gartenhelden akzeptiert PayPal, Kreditkarte (Visa, Mastercard), Vorkasse und Kauf auf Rechnung. Kauf auf Rechnung ist erst ab der zweiten Bestellung möglich. Ratenzahlung und Barzahlung bei Lieferung gibt es nicht.

## Rückgabe und Erstattung
- Artikel können innerhalb von 30 Tagen nach Erhalt zurückgegeben werden, Pflanzen innerhalb von 7 Tagen. Die Ware muss unbenutzt und unbeschädigt sein.
- Paketware: Die Rücksendung ist kostenlos, das Retourenetikett gibt es im Kundenkonto unter "Meine Bestellungen".
- Sperrgut: Gartenhelden holt die Ware per Spedition ab, dafür werden 29,00 € von der Erstattung abgezogen. Die Abholung vereinbart der Kundenservice.
- Die Erstattung erfolgt innerhalb von 14 Tagen nach Eingang der Rücksendung auf das ursprüngliche Zahlungsmittel.

## Garantie
- Für alle Artikel gilt die gesetzliche Gewährleistung von 2 Jahren.
- Anwachsgarantie: Geht eine Freilandpflanze innerhalb von 6 Monaten nach Lieferung ein, ersetzt Gartenhelden sie kostenlos. Dafür genügt ein Foto der Pflanze an den Kundenservice. Zimmerpflanzen sind ausgenommen.

## Aktionen und Gutscheine
- Frühjahrsaktion: 15 % Rabatt auf alle Hochbeete bis einschließlich 30. April 2026 mit dem Code FRUEHLING15.
- Newsletter: Wer den Newsletter abonniert, erhält einen Gutschein über 10 % für die erste Bestellung.
- Pro Bestellung ist nur ein Rabattcode einlösbar, Codes lassen sich nicht kombinieren.

## Kundenkonto, Bestellungen und Datenschutz
- Den Bestellstatus sehen Kundinnen und Kunden im Kundenkonto unter "Meine Bestellungen". Telefonisch gibt der Kundenservice Auskunft, wenn Bestellnummer und Postleitzahl der Lieferadresse genannt werden.
- Bestellnummern haben das Format GH-JJJJ-NNNN, zum Beispiel GH-2026-4711.
- Adressänderungen sind bis zum Versand möglich, nur über den Kundenservice.
- Konto und Daten lassen sich im Kundenkonto unter "Einstellungen" löschen.

## Pflegehinweise (allgemein)
- Tomaten erst nach den Eisheiligen, also ab Mitte Mai, ins Freie pflanzen.
- Lavendel braucht einen sonnigen, durchlässigen Standort und wenig Wasser.
- Rasen erst säen, wenn der Boden mindestens 10 Grad warm ist, meist ab April.
- Regenwasser aus der Regentonne eignet sich gut zum Gießen, besonders für kalkempfindliche Pflanzen.`;
