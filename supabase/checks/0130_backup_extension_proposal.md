# Vorschlag `0130` — die Betriebssicherung vollständig machen

**Status: A1, A3 und B sind umgesetzt (`0130`, `0131` — lokal vorbereitet,
nicht angewendet). A2 ist NICHT freigegeben. D ist ein eigener Vorschlag
(`0132_platform_export_receipts_proposal.md`).**

| Schritt | Stand |
|---|---|
| A1 — Kostenteile, Plattform, Verkäufername (6) | **in `0130`** |
| A3 — Idempotenz, Tagesplatz (3 Ausschlüsse) | **in `0130`** |
| B — die übrigen Bereiche ohne `sellers` (13 Felder, 11 Ausschlüsse) | **in `0130`** |
| B — `sellers` (13 Felder, 2 Ausschlüsse) | **in `0131`** |
| A2 — Absender, Inserat, Vereinbarung (9) | **nicht freigegeben**, siehe unten |
| D — Plattformexport | eigener Vorschlag `0132` |

Nach `0130` und `0131` ist **keine Spalte mehr unentschieden**;
`manifest-gap.test.ts` prüft das für alle 28 Bereiche. Was bleibt, ist A2 — und
das ist eine Rechtsfrage, keine technische.

## Der Befund

`src/lib/backup/manifest.ts` ist von `0104`. Das Schema ist seither gewachsen.
Nachgezählt (`manifest-gap.test.ts`, festgenagelt):

**57 Spalten in 10 Bereichen sind weder exportiert noch begründet ausgelassen.**

| Bereich | Spalten | Woher |
|---|---|---|
| `purchases` | 18 | `0113`, `0115`, `0120`, `0121` |
| `sellers` | 15 | Rechtsangaben, über mehrere Migrationen |
| `order_refunds` | 9 | Zahlungsdienstleister-Felder |
| `skylanders` | 6 | Katalogverwaltung |
| `sales` | 2 | Tagesplatz, Verkaufstag |
| `series`, `categories` | je 2 | `created_at`, `position` |
| `order_reservations` | 1 | `sale_item_id` |
| `shop_settings` | 1 | `id` |
| `shipping_methods` | 1 | `updated_at` |

Die drei Belegbereiche und `purchase_items` haben **keine** Lücke — das ist die
Zusicherung von `0129`.

## Der Grundsatz, an dem sich jede Zeile entscheidet

Aus `manifest.ts` und `docs/SECURITY.md`:

> Personenbezogene Daten stehen nur dort, wo sie hingehören — und sie gehören
> dorthin, wo ein **eigener Aufbewahrungszweck** sie verlangt.

Für die Rechnung ist dieser Zweck § 147 AO. Für den Eigenbeleg gilt dasselbe,
und deshalb war `0129` richtig. **Für den Einkauf selbst ist er noch nicht
geschrieben** — das ist derselbe offene Punkt wie die Aufbewahrungsfrist, und
er entscheidet die Hälfte dieses Vorschlags.

## A. `purchases` — 18 Spalten, drei Gruppen

### A1 — Geschäftszahlen: aufnehmen (6 Spalten)

`items_cost`, `shipping_cost`, `buyer_protection_cost`, `payment_method`,
`platform`, `seller_name`

Keine personenbezogenen Daten im engeren Sinn: `platform` ist ein Marktplatz,
`seller_name` ein Anzeigenname. Sie sind die **Kostenseite des
Buy-in-Faktors** — ohne die Aufteilung ist aus dem Backup nicht
nachvollziehbar, wie sich `total_cost` zusammensetzt, und genau das ist der
erklärte Zweck des Bereichs.

**Empfehlung: aufnehmen.** Beträge als Text, wie überall.

### A2 — Absender, Inserat, Vereinbarung: aufnehmen, aber erst nach der Frist (9 Spalten)

`sender_name`, `sender_street`, `sender_postal_code`, `sender_city`,
`sender_country`, `listing_title`, `listing_url`, `listing_details`,
`agreement_note`

Das ist Name und Anschrift einer **Privatperson**. Drei Beobachtungen:

1. **Für Einkäufe mit Eigenbeleg ist die Lücke schon gedeckt** — der Snapshot
   in `purchase_receipts` trägt diese Angaben selbst, und `0129` hat ihn
   aufgenommen. Eine zweite Kopie im Einkaufsbereich bringt für diese
   Einkäufe nichts dazu.
2. **Für Einkäufe ohne Beleg ist es ein echter Verlust.**
   `0129_export_baseline.sql`, Prüfung 406, zählt genau diese Einkäufe — die
   Zahl entscheidet, wie dringend das ist.
3. `listing_url` und `agreement_note` können beliebigen Freitext tragen, auch
   Kontaktdaten.

**Empfehlung: aufnehmen — aber erst, wenn die Aufbewahrungsfrist für Ankaufsdaten
geschrieben ist und die Datenschutzerklärung Ankäufe überhaupt erwähnt.** Beides
steht seit `0122` als offener Punkt in `docs/LEGAL.md`. Eine Exportdatei, die
Privatanschriften ohne geschriebenen Zweck und ohne Frist vervielfacht, ist
genau der Fehler, den der Grundsatz oben verhindern soll.

**Zwischenlösung, falls A2 warten muss:** `sender_postal_code` und
`sender_country` allein aufnehmen. Sie machen einen Ankauf nachvollziehbar
(Inland/Ausland, Region) ohne die Person zu benennen. Das ist keine
Datensparsamkeit auf dem Papier, sondern der Unterschied zwischen einer
Statistik und einer Adresse.

### A3 — Technik: begründet auslassen (3 Spalten)

`client_token`, `client_request_fingerprint` — Doppelklick-Sicherung aus
`0120`. Idempotenzschlüssel; `FORBIDDEN_FIELDS` führt `request_id` aus genau
diesem Grund schon.

`daily_index` — der Tagesplatz. Eine Anzeigeordnung, aus der Reihenfolge
wiederherstellbar.

**Empfehlung: in `excluded` aufnehmen, je mit Grund.** Damit ist die Lücke
geschlossen, ohne dass ein Feld mitfährt — „begründet draußen" ist auch eine
Entscheidung.

## B. Die übrigen neun Bereiche

| Bereich | Empfehlung | Begründung |
|---|---|---|
| `sellers` (15) | **aufnehmen** | Register, Gericht, Streitbeteiligung, Rückportoregel: sie stehen auf jeder Rechnung und in jedem Belegsnapshot. Ohne sie ist eine wiederhergestellte Rechnung nicht reproduzierbar. Keine personenbezogenen Daten Dritter — es sind die eigenen Geschäftsangaben. `phone` und die drei Kontaktadressen sind veröffentlicht (Impressum) |
| `order_refunds` (9) | `requested_at`, `settled_at`, `provider_status`, `failure_code` **aufnehmen**; `provider`, `provider_payment_ref`, `provider_attempts`, `provider_confirmed_by`, `idempotency_key` **begründet auslassen** | Zeitpunkte und Ergebnis sind der Geschäftsvorfall; die Stripe-Interna sind es nicht — `FORBIDDEN_FIELDS` führt `provider_refund_id` schon so |
| `skylanders` (6) | `category_id`, `is_active`, `source` **aufnehmen**; `created_at`, `updated_at`, `price_updated_at` **auslassen** | Der Stammdatenschnappschuss soll die Datei lesbar halten; drei Zeitstempel tun das nicht |
| `sales` (2) | `sale_day` **aufnehmen**, `daily_index` auslassen | Der Verkaufstag ist die Zuordnung zum Geschäftstag; der Platz darin ist Anzeige |
| `series`, `categories` (4) | `position` **aufnehmen**, `created_at` auslassen | Die Reihenfolge ist kuratiert und nicht wiederherstellbar |
| `order_reservations` (1) | `sale_item_id` **aufnehmen** | Die Brücke von der Reservierung zur Verkaufsposition — ohne sie ist der Weg einer Figur unterbrochen |
| `shop_settings` (1) | `id` **aufnehmen** | Primärschlüssel; ohne ihn ist die Zeile nicht einspielbar |
| `shipping_methods` (1) | `updated_at` auslassen | Zeitstempel einer Konfigurationszeile |

Summe der Empfehlung: **36 Spalten aufnehmen, 21 begründet auslassen** — und
damit 0 unentschiedene. Von den 36 warten 9 (A2) auf die Rechtsfragen.

## C. Was das für das Format heißt

`BACKUP_FORMAT_VERSION` bleibt **1**. Das Manifest sagt die Regel selbst:
erhöht wird sie, wenn sich die **Bedeutung** eines Feldes ändert oder ein
Bereich verschwindet — nicht, wenn Felder dazukommen. Ein Leser, der `1` kennt,
liest die erweiterte Datei weiter richtig; er sieht mehr Schlüssel.

`restore_supported` bleibt **false**, bis es eine Importfunktion gibt. Mehr
Felder machen einen Restore vollständiger, aber nicht automatisch.

## D. Der Plattformexport

Er führt die drei Belegtabellen **nicht** (`platform-manifest.ts`, als offener
Punkt verzeichnet, in `platform-manifest.test.ts` als geprüfte Ausnahme). Die
Zusicherung „der Plattformexport ist das größere Netz" ist damit heute
verletzt.

**Empfehlung: in `0130` mitnehmen** — dieselben drei Bereiche, dieselben
Ausschlüsse. Es ist ein Admin-Werkzeug mit eigener Archivdatei und eigenen
Prüfsummen; deshalb braucht es eine eigene Freigabe und sollte nicht als
Nebenwirkung einer Betriebsänderung passieren.

## E. Vorgeschlagener Zuschnitt

| Schritt | Umfang | Abhängigkeit |
|---|---|---|
| `0130a` | A1 (6 Spalten) + A3 (3 Ausschlüsse) + B ohne `sellers` | keine |
| `0130b` | `sellers` (15) | keine, aber eigener Prüfblock |
| `0130c` | A2 (9 Spalten) | **Datenschutzerklärung + Aufbewahrungsfrist** |
| `0130d` | Plattformexport um die drei Belegbereiche | eigene Freigabe |

Jeder Schritt: Manifest, Migration mit vollem Rumpf (`create or replace`
ersetzt ihn als Ganzes — eine Anweisung, eine Momentaufnahme), Preflight,
Postflight, und `manifest-gap.test.ts` entsprechend kürzen. Fällt dieser Test
nach einem Schritt nicht, wurde nichts geschlossen.

## F. Was ohne Entscheidung passiert

Nichts Dramatisches, und das ist die Gefahr: die Sicherung läuft, die Datei
sieht vollständig aus, und erst eine Wiederherstellung zeigt, was fehlt.
`manifest-gap.test.ts` hält die Lücke sichtbar, bis sie entschieden ist — mehr
kann ein Test nicht tun.
