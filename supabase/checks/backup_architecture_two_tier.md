# Zweistufige Backup-Architektur — Analyse und Lückenbericht

**Nur Analyse.** Keine Migration, kein Importer, keine Datenbank, kein Restore.
`restore_supported` bleibt `false`. Production unverändert.

Grundlage: `0131_restore_plan.md` (Reihenfolge, Trigger, Identitäten) und die
sechs Entscheidungen vom 2026-10-16: Bestellzweig muss langfristig
wiederherstellbar sein · keine Platzhalter als Nachweis · keine unkontrollierte
Aufnahme personenbezogener Daten in das Geschäftsbackup · A2 bleibt
ausgeschlossen · `restore_supported` = false · Production unverändert.

Die Entscheidungen 1 und 3 ziehen in verschiedene Richtungen: ein vollständig
wiederherstellbarer Bestellzweig braucht Daten, die im Geschäftsbackup nichts
zu suchen haben. Genau das löst die Zweistufigkeit — nicht als Kompromiss,
sondern weil es zwei verschiedene Zwecke sind.

---

## A. Das zweistufige Konzept

### A.0 Die Einsicht, aus der alles folgt

Ein JSON-Export, der aus `public` liest, **kann** kein Notfall-Backup sein. Er
erreicht `auth.users` nicht (dort liegen Passwort-Hashes), nicht die
Storage-Objekte, nicht die Rollentabellen, nicht den Zustand der Sequenzen,
nicht die Rechte und RLS-Regeln, und nichts, was beim Zahlungsdienstleister
liegt. Das ist keine Lücke im Export, sondern seine Bauart: er ist ein
**Geschäftsdokument**, kein Abbild einer Maschine.

Daraus folgen zwei Stufen mit getrennten Zwecken, getrennter Aufbewahrung und
getrennten Zugriffsrechten.

### A.1 Stufe 1 — Geschäftsbackup (existiert, Stand `0131`)

| | |
|---|---|
| **Zweck** | Nachweis und Portabilität der Geschäftsdaten: Einkauf, Lager, Verkauf, Belege, Rechnungen, Stammdaten |
| **Technik** | `seller_business_backup()` → eine JSON-Datei, eine MVCC-Momentaufnahme, Formatversion 1 |
| **Umfang** | 28 Bereiche, 352 Feldzeilen, 5 508 Datensätze (Staging) |
| **Lesbarkeit** | für Menschen lesbar, ohne Datenbank interpretierbar, formatversioniert |
| **Enthält bewusst keine** | Kontoidentitäten, Geheimnisse, Zahlungsdienstleister-Interna, Rollen, A2-Felder |
| **Enthält personenbezogene Daten** | **ja** — `contains_personal_data: true`: Belegsnapshots (Absender, Inserat) und **alle Rechnungsempfänger** (`invoices.customer_*`) |
| **Aufbewahrung** | außerhalb des Repositories, beim Betreiber |
| **Restore-Eignung** | Geschäftszweig ja, Bestellzweig **nein** (siehe B) |

Stufe 1 bleibt im Umfang kontrolliert. Jede Erweiterung ist eine einzelne
Entscheidung mit eigener Begründung — so wie `0130` (A1/A3/B) und `0131`
(Rechtsangaben) einzeln entschieden wurden und A2 ausdrücklich nicht.

**Hier ist ein Befund, der die Diskussion verschiebt:** Stufe 1 enthält über
`invoices` schon heute Name, Straße, PLZ, Ort, Land und **E-Mail-Adresse**
jedes Rechnungsempfängers — alle 26 Spalten von `invoices` sind exportiert.
Das ist richtig so (eine Rechnung ist ein aufbewahrungspflichtiges Dokument),
aber es heißt: „keine personenbezogenen Daten in Stufe 1" war schon vor dieser
Entscheidung nicht die Lage. Die Lage ist: **kontrollierter, einzeln
begründeter Umfang.**

### A.2 Stufe 2 — geschütztes Notfall-Backup (existiert nicht)

| | |
|---|---|
| **Zweck** | den Betrieb nach einem Totalverlust wieder lauffähig machen |
| **Technik** | logischer Gesamtabzug der Datenbank (`pg_dump`, alle Schemata inkl. `auth` und `storage`) **oder** der projekteigene Supabase-Backup-/PITR-Mechanismus |
| **Umfang** | alles — auch Passwort-Hashes, Sitzungen, Rollen, Sequenzzustände, Rechte, RLS-Regeln, Trigger |
| **Zusätzlich** | die Storage-Objekte des Buckets `catalog` (Teilstück existiert: `npm run images:export:prod` samt geprüftem Manifest) |
| **Lesbarkeit** | nicht für Menschen, nur für dieselbe PostgreSQL-Hauptversion |
| **Aufbewahrung** | **verschlüsselt**, nicht in einem synchronisierten Ordner, nicht im Repository, Zugriff nur Betreiber (CLAUDE.md, `docs/SECURITY.md`) |
| **Restore-Eignung** | vollständig — das ist der einzige Weg, Entscheidung 1 zu erfüllen |

Stufe 2 ist der Ort für `orders.customer_email`, `orders.request_id`,
`auth.users`, `commerce_settings.client_salt`, `payment_token_hash`,
`withdrawal_requests` und die 19 Kontoidentitätsspalten. Nicht weil sie
unwichtig sind, sondern weil sie dort **hingehören**: hinter Verschlüsselung,
ohne Lesbarkeit für Dritte, mit kurzer Aufbewahrung.

### A.3 Was die Stufen voneinander erben — und was nicht

* Stufe 2 ersetzt Stufe 1 **nicht**: ein `pg_dump` ist nach einem Jahr und
  zwei PostgreSQL-Versionen schwer zu lesen; ein JSON mit Formatversion ist
  es nicht. Für die Aufbewahrungspflicht zählt Lesbarkeit.
* Stufe 1 ersetzt Stufe 2 **nicht**: siehe A.0.
* **Der Wiederherstellungstest braucht beide.** Stufe 1 beweist, dass die
  Geschäftsdaten vollständig und stimmig sind (Rückvergleich, siehe E).
  Stufe 2 beweist, dass der Betrieb wieder läuft. Ein „vollständiger Restore"
  im Sinne von Entscheidung 1 und 2 ist nur mit Stufe 2 beweisbar.

### A.4 Aufbewahrungsfristen — offener Prüfpunkt

Fristen sind **nicht** geklärt und werden hier nicht behauptet. Zu klären ist
mindestens:

* Welche Frist für Belege, Rechnungen und Einkaufsnachweise gilt (AT/DE,
  Einzelunternehmen) — und ob sie für die Sicherung dieselbe ist wie für die
  Datenbank.
* Ob ein Löschverlangen (DSGVO Art. 17) auch die Sicherungen erreichen muss
  und wie das bei einer verschlüsselten Gesamtsicherung praktisch geht.
  Technisch sauber ist nur: Stufe 2 kurz aufbewahren und rollierend
  überschreiben; eine zehn Jahre alte Gesamtsicherung mit Passwort-Hashes ist
  ein Risiko, kein Nachweis.
* Wie lange `orders.customer_email` nötig ist, wenn die Rechnung die Adresse
  ohnehin trägt.

→ Das gehört vor eine Entscheidung über den Umfang von Stufe 1, nicht danach.

---

## B. `orders.customer_email` und `orders.request_id`

### B.1 Warum sie `not null` sind — aus dem Code, nicht geraten

**`request_id text not null`, `constraint orders_request_unique unique (request_id)`**
(`0010_commerce_core.sql`). Der Kommentar in der Migration:

> *Idempotency for the checkout button. A double submit carries the same
> request_id and gets the same order back instead of a second one.*

**Ja, `request_id` ist der Idempotenzschlüssel.** Er ist `not null` und
`unique`, weil beides zusammen die Regel trägt: ohne `not null` gäbe es Zeilen
ohne Schlüssel, und `unique` erlaubt beliebig viele `NULL` — die Doppelklick-
Sicherung hätte ein Loch. `seller_create_order()` (bzw. deren Nachfolger in
`0011`, `0013`, `0021`) prüft `length(p_request_id) >= 8` und sucht
`where o.request_id = p_request_id`, bevor sie etwas anlegt. Der
`orders_immutable`-Trigger friert die Spalte ein
(`new.request_id is distinct from old.request_id` → Abbruch).

**Ist er ein Sicherheitsschlüssel? Nein — und das steht ausdrücklich im Code.**
`src/lib/commerce/capability.ts`:

> *They have different rules: a request id may be logged and traced, a
> capability may not. Merging them would quietly turn every log line that
> records an idempotency key into a leaked secret.*

Der Sicherheitsschlüssel ist die **Zahlungsfähigkeit** (`payment_token`,
browserseitig erzeugt, nur ihr SHA-256 steht als `payment_token_hash` in der
Zeile). `request_id` ist ein `crypto.randomUUID()`, der protokolliert werden
darf. Wer ihn kennt, kann nichts: eine Wiederholung liefert dieselbe
Bestellung **nur** gegen Vorlage derselben Fähigkeit.

**`customer_email text not null`** (`0010`). Der Kommentar:

> *Who to reach about this order, as it was at the time. Carries the order when
> the account is gone, and is the only contact a guest order has.*

`not null`, weil `user_id` nullable ist — bei einem Gastkauf gibt es kein
Konto, und bei einer Kontolöschung wird `user_id` auf `NULL` gesetzt
(`on delete set null`, nie `cascade`, weil eine Bestellung ein
aufbewahrungspflichtiges Dokument ist). `customer_email` ist dann der
**einzige** Weg, den Käufer zu erreichen. Eine Bestellung ohne jede
Kontaktmöglichkeit ist fachlich keine Bestellung.

### B.2 Wer die beiden Spalten braucht

| Verbraucher | `request_id` | `customer_email` |
|---|---|---|
| `orders_request_unique` (unique) | **ja, tragend** | — |
| Checkout-RPC (`length ≥ 8`, Idempotenzsuche) | **ja, tragend** | ja (schreibt sie) |
| `orders_immutable`-Trigger | ja (eingefroren) | ja (eingefroren) |
| Bestellmails (`send-order-mail`) | — | **ja, tragend** |
| Rechnung (`invoices.customer_email`) | — | ja (dorthin kopiert) |
| Widerruf (`withdrawal_requests.contact_email`) | — | ja (dorthin kopiert) |
| Gastzugang zur Bestellung | — | nein (das ist die Fähigkeit) |
| Bestelldokument-RPC | **nein** — ausdrücklich ausgenommen | ja |

Der Kommentar der Dokument-RPC aus `0021` sagt es selbst: *„No client_hash, no
payment_token_hash, no request_id, no internal id."* Die Spalte ist technisch
und verlässt die Datenbank nie in Richtung Oberfläche.

### B.3 Wege zur Wiederherstellung, ohne die Sicherheitsregeln zu unterlaufen

**`request_id` — Empfehlung: in Stufe 1 aufnehmen.**
Begründung in einem Satz: Nach der Doktrin des eigenen Codes ist er
protokollierbar, also kein Geheimnis; er ist ein Zufalls-UUID, also kein
personenbezogenes Datum; und er ist `not null` und `unique`, also ohne ihn
kein Restore. Das löst **einen der beiden Blocker vollständig** und kostet
datenschutzrechtlich nichts. Risiko, offen benannt: ein Dritter mit der
Sicherung könnte eine Checkout-Wiederholung mit bekannter `request_id`
versuchen — er bekäme nichts, weil die Fähigkeit fehlt, und die Bestellung
existiert ohnehin schon.

**`customer_email` — drei Wege, Empfehlung (c) + (a):**

**(a) Aus der Rechnung rekonstruieren.** `invoices.customer_email` ist
exportiert. Für jede Bestellung **mit** Rechnung ist die Adresse also in
Stufe 1 vorhanden; der Restore könnte sie von dort übernehmen.
*Deckung:* nur Bestellungen, die zu einer Rechnung geführt haben — also
bezahlte. Unbezahlte, abgebrochene und stornierte Bestellungen haben keine
Quelle. *Bewertung:* technisch sauber, dokumentierbar, **aber unvollständig**
— und nach Entscheidung 2 ist Unvollständigkeit kein Nachweis.

**(b) `orders.customer_email` in Stufe 1 aufnehmen.** Vollständig, einfach —
und eine echte Ausweitung: jede Bestellung trägt dann in jeder Sicherung eine
E-Mail-Adresse, auch die nie bezahlten. Das koppelt die Aufbewahrung der
Adresse an die Sicherung statt an die Rechnung und macht A.4 zur
Vorbedingung. Widerspricht Entscheidung 3, solange A.4 offen ist.

**(c) Aus Stufe 2 wiederherstellen.** Die Adresse steht im verschlüsselten
Gesamtabzug, wo auch `auth.users` steht. Der vollständige Restore des
Bestellzweigs ist damit **beweisbar** (Entscheidung 1), ohne Stufe 1
auszuweiten (Entscheidung 3), und ohne Platzhalter (Entscheidung 2).

**Was ausdrücklich nicht geht:** die Spalte auf `null` erlauben. Das wäre eine
Lockerung einer Sicherheitsregel, um ein Backup-Problem zu lösen — die
Bestellung verlöre ihre einzige Kontaktmöglichkeit. Ebenso nicht: ein Default
wie `'unknown@invalid'`; das macht aus einem Abbruch eine stille Falschangabe.

**Konsequenz, klar benannt:** Mit (c) ist Stufe 1 **kein** vollständiger
Restore-Pfad für Bestellungen — und soll es nicht sein. Der technische
Restore-Test aus `0131_restore_plan.md` bleibt damit auf die 15
Geschäftsbereiche und die Orderbuch-Verkäufe beschränkt, bis Stufe 2 existiert.
Das ist keine Einschränkung des Nachweises, sondern seine richtige Zuordnung.

---

## C. Abhängigkeitsmatrix

Spalten: **T** = für den technischen Restore-Test nötig · **B** = für den
echten Betrieb nötig · **R** = rechtlicher Nachweis · **P** =
personenbezogen, Speicherdauer begrenzt.

| Abhängigkeit | Wo sie hängt | T | B | R | P | Stufe | Zustand |
|---|---|---|---|---|---|---|---|
| **`auth.users`** | 18 FK-Spalten in 15 Tabellen; `orders.user_id`; RLS über `auth.uid()` | nein¹ | **ja** | teils² | **ja** (Mail, Hash) | **2** | fehlt |
| **`seller_operators`** | `can_operate_active_seller()` → gates `seller_business_backup()` und den ganzen `/business`-Bereich | **ja**³ | **ja** | nein | ja (user_id) | **2** | fehlt |
| **`platform_admins`** | `/admin`, Katalogredaktion | nein | **ja** | nein | ja | **2** | fehlt |
| **`shop_admins`** | älteres Adminprädikat, u. a. `send-order-mail` | nein | **ja** | nein | ja | **2** | fehlt |
| **`testers`** | Testkennzeichnung | nein | nein | nein | ja | 2 | fehlt |
| **`withdrawal_requests`** | `order_refunds.withdrawal_request_id` (nullable) | nein | ja | **ja**⁴ | **ja** (Name, Mail, Erklärung) | **2**, Nachweis evtl. 1 | **fehlt — echte Lücke** |
| **`public.characters`** | `skylanders.character_id` (nullable) | nein | ja | nein | nein | — | **gedeckt**: `data/characters/characters.json` im Repository, `npm run characters:import` |
| **`commerce_settings`** | `mode` (nur als Metadatum), `client_salt` (**Geheimnis**), Ratenschranken | nein | **ja** | nein | nein | **2** (Salt) | `mode` in Stufe 1, Rest fehlt |
| **Storage `catalog`** | `skylanders.image_override_path`, `image_file` | nein | ja | nein | nein | **2** | **teilweise gedeckt**: `npm run images:export:prod` mit geprüftem Manifest; importierte Bilder liegen in Git |
| **19 Kontoidentitätsspalten** | s. unten | nein | teils⁵ | **ja**⁶ | **ja** | **2** | fehlt |
| `orders.customer_email` | B | nein | **ja** | ja (Rechnung trägt sie auch) | **ja** | **2** (+1 via `invoices`) | fehlt in `orders` |
| `orders.request_id` | B | **ja** | **ja** | nein | nein | **1** (Empfehlung) | fehlt |
| `payment_token_hash` | Gastzugang zur Zahlung | nein | ja⁷ | nein | nein (Digest) | 2 | fehlt |
| Stripe-Daten | Zahlungen, Erstattungen | nein | **ja** | **ja** | ja | **beim Dienstleister** | außerhalb unserer Sicherung |

¹ Alle 18 FK-Spalten sind nullable → der Restore läuft ohne sie durch.
² Eine Rechnung ist ohne Konto gültig; ob für einen Prüfer die *Kontozuordnung*
nötig ist, ist ein **offener Prüfpunkt**.
³ Nur für den Rückvergleich aus E (ein zweiter Export braucht einen Bediener).
Für das reine Einfügen nicht.
⁴ Ein Widerruf ist ein Nachweis mit Frist — **offener Prüfpunkt**, welche.
⁵ Operativ meist verzichtbar (Einzelunternehmen, ein Bediener), für die
Zurechenbarkeit nicht.
⁶ Wer einen Eigenbeleg ausgestellt hat (`issued_by`), ist dokumentarisch
relevant — **offener Prüfpunkt**, ob die Belegnummer plus Betriebsinhaber
genügt, wenn es ohnehin nur einen Bediener gibt.
⁷ Nach einem Restore könnten sonst offene Gastzahlungen nicht abgeschlossen
werden.

### C.1 Die 19 Kontoidentitätsspalten im Einzelnen

18 Fremdschlüssel auf `auth.users`, alle `on delete set null`:

`inventory_movements.created_by` · `purchases.created_by` ·
`purchases.updated_by` · `purchase_receipts.issued_by` ·
`purchase_receipt_downloads.delivered_by` · `sales.created_by` ·
`sales.updated_by` · `sale_fees.created_by` · `sale_refunds.created_by` ·
`settlement_adjustments.created_by` · `orderbook_name_mappings.created_by` ·
`orders.user_id` · `orders.sandbox_archived_by` ·
`order_line_events.created_by` · `order_refunds.created_by` ·
`sellers.updated_by` · `shop_settings.updated_by` ·
`shipping_methods.updated_by`

Dazu `seller_monthly_reports.finalized_by` — eine `uuid`-Spalte **ohne**
Fremdschlüssel, also auch ohne die Schutzwirkung von `on delete set null`.

**Bewertung:** Für ein Einzelunternehmen mit genau einem Bediener ist der
Informationsverlust gering — aber er ist nicht *null*, und er ist nicht
reparabel: eine `uuid` lässt sich nach einem Restore nicht erraten. Wenn
Zurechenbarkeit nachweispflichtig ist, gehört sie in Stufe 2, nicht in
Stufe 1 (eine `uuid` in einem lesbaren Geschäftsbackup ist ein
personenbezogenes Datum ohne Nutzen für den Leser).

**Mittelweg, nur als Option:** Stufe 1 könnte statt der `uuid` ein
pseudonymes, stabiles Kürzel führen (etwa „Bediener A") — das erhält die
*Unterscheidbarkeit* ohne die Identität. Nicht empfohlen, solange nur ein
Bediener existiert: es erzeugt eine Zuordnungstabelle, die selbst gesichert
werden muss.

---

## D. Vier Datenklassen, getrennt

### D.1 Für den technischen Restore-Test nötig

Nur, was ein `insert` überhaupt möglich macht:

* `orders.request_id` (not null, unique) und `orders.customer_email` (not null)
  — die beiden Blocker.
* Für den Rückvergleich (E): ein Auth-Nutzer plus eine eingeschaltete
  `seller_operators`-Zeile im **Testprojekt**, mit fiktiven Daten.
* Nichts weiter. Alle übrigen 64 nicht exportierten Spalten sind nullable
  oder haben einen Default.

### D.2 Für eine echte Wiederherstellung des Betriebs nötig

`auth.users` (sonst kann niemand sich anmelden) · alle vier Rollentabellen ·
`commerce_settings` inkl. `client_salt` · Storage-Bucket `catalog` ·
`payment_token_hash` (offene Gastzahlungen) · `withdrawal_requests` ·
Sequenzzustände (`order_number_seq`, `invoice_number_seq`, `sky_id_seq`, 22
Identitätssequenzen) · Rechte, RLS-Regeln, Trigger, Constraints, Funktionen —
also das Schema selbst, in der Fassung der Migrationen.
**Nur Stufe 2 liefert das.**

### D.3 Rechtlich aufzubewahrende Nachweise — als offene Prüfpunkte

Nicht geklärt, hier nur benannt:

* Eigenbelege samt Korrekturketten, Fingerabdrücken und Abrufnachweisen
  (`purchase_receipts`, `purchase_receipt_downloads`,
  `purchase_receipt_counters`) — in Stufe 1 **vollständig vorhanden**.
* Rechnungen (`invoices`, 26/26 Spalten) — vollständig vorhanden.
* Rechtsstände je Bestellung (`order_legal_snapshots`: AGB- und
  Widerrufsversion) — vorhanden, aber nur mit `orders` einfügbar.
* Widerrufserklärungen (`withdrawal_requests`) — **nicht gesichert**.
* Einkaufsnachweise (`purchases`, `purchase_items`) — vorhanden, **ohne** die
  A2-Felder; der Beleg trägt sie eingefroren.
* **Offen:** Frist, Form (JSON genügt? PDF nötig?), Ort der Aufbewahrung,
  ob eine verschlüsselte Sicherung als „verfügbar" gilt. Das ist eine
  steuerliche und rechtliche Frage, keine technische — und sie ist **nicht**
  geklärt.

### D.4 Personenbezogene Daten mit begrenzter Speicherdauer

In Stufe 1 bereits enthalten: `invoices.customer_*` (Name, Adresse, E-Mail),
Belegsnapshots (`sender_*`, `listing_*`, `agreement_note`),
`purchases.seller_name` (der Verkäufername einer Ankaufsplattform),
`sellers.*` (eigene Daten, kein Fremdbezug).
In Stufe 2 zusätzlich: `auth.users` (E-Mail, Passwort-Hash, Sitzungen),
`orders.customer_email`, `withdrawal_requests` (Name, E-Mail, Erklärung),
Kontoidentitäten.

**Daraus folgt für die Praxis:** Stufe 2 rollierend und kurz aufbewahren,
verschlüsselt, nicht in einem synchronisierten Ordner — und ein
Löschverlangen muss die Sicherungen erreichen können. Die genaue Frist ist
ein **offener Prüfpunkt** (A.4). Ein unbefristet aufbewahrter Gesamtabzug ist
das größte Datenschutzrisiko dieser Architektur, nicht der Export.

---

## E. Was ein zweiter Export beweist — und was nicht

### E.1 Was er beweist

`seller_business_backup()` liest genau die 352 Felder, die ein Restore
schreibt. Der Vergleich zweier `data`-Objekte ist daher ein **Gleichheitsbeweis
über die gesamte wiederherstellbare Fläche** von Stufe 1: 28 Bereiche, 5 508
Datensätze, Feld für Feld. Das deckt ab: Werte, Verweise innerhalb des
Exports, Sortierung, Belegketten, gespeicherte Fingerabdrücke, Zählerstände,
Mengen.

### E.2 Was er strukturell nicht beweisen kann

| Nicht bewiesen | Warum | Zusätzliche Prüfung |
|---|---|---|
| Die 66 nicht exportierten Spalten | kommen im Export nicht vor → ein Vergleich sieht sie nicht | **Spalten-für-Spalten-Zählung** gegen `information_schema.columns`: je Tabelle `count(*) filter (where spalte is null)` vorher/nachher. Erwartung dokumentieren, nicht hoffen. |
| Stand der 22 Identitätssequenzen und der 3 Nummernsequenzen | nicht im Export | `pg_sequences.last_value` gegen `max(id)` je Tabelle; `order_number_seq`/`invoice_number_seq` gegen die höchste vergebene Nummer |
| Dass eine **neue** Nummer richtig weitergeht | Export ist ein Standbild | **nur auf der Testdatenbank, als letzter Schritt:** einen Eigenbeleg zu einem Testeinkauf ausstellen und prüfen, dass er `next_number` zieht und der Zähler weiterzählt. Danach ist die Testdatenbank verbraucht. Auf Staging/Production **nicht**. |
| Fremdschlüssel-Waisen bei nullable Verweisen | `NULL` ist gültig, fällt nicht auf | Anti-Join-Zählung = 0 je Paar (`purchase_items`→`inventory_movements`, `sale_items`→beide Bewegungen, `order_reservations`→`sale_items`, `order_line_events`→beide Bewegungen, `order_refund_allocations`→`order_lines`) |
| Trigger, Constraints, Indizes, Funktionen, Rechte, RLS | Schema, nicht Daten | **Schema-Inventar**: `pg_trigger`, `pg_constraint`, `pg_index`, `pg_proc`, `pg_policy`, `information_schema.role_routine_grants` zählen und mit dem Stand nach `0131` vergleichen. Dafür genügen Zahlen und Namen — keine Inhalte. |
| Dass die Unveränderlichkeit greift | Export sagt nichts über Trigger | **Negativprobe auf der Testdatenbank:** ein `update` auf `purchase_receipts` muss abbrechen. Ein Trigger, der nach dem Restore fehlt, fällt sonst erst auf, wenn jemand einen Beleg ändert. |
| `auth.users`, Rollen, Storage | andere Schemata | Zeilenzahlen und Objekt-Manifest (SHA-256 je Datei) vergleichen — Stufe 2 |
| PDF-Gleichheit | Export ist JSON | PDFs **lokal** aus beiden JSON-Dateien rendern, SHA-256 vergleichen, gegen `purchase_receipt_downloads.byte_count` halten (4 506 Bytes sind durch einen echten Abruf belegt). Kein Download über die Oberfläche — der **schreibt** eine Abrufzeile. |
| Dass die Funktion selbst unverändert ist | sie erzeugt den Vergleich — ein Zirkel | `md5(prosrc)` der lebenden Funktion gegen den Rumpf aus der Repository-Datei. Für Stand `0131`: `24c3810288bb20929fe995554a267adf`, Rumpflänge 21 458 Zeichen. **Das schließt den Zirkel.** |

### E.3 Der Zirkel, ausdrücklich

Ein Export, der mit sich selbst verglichen wird, beweist nichts über seine
eigene Vollständigkeit. Deshalb braucht der Rückvergleich zwei Anker außerhalb
seiner selbst: den **Funktionsrumpf-Digest** (E.2, letzte Zeile) und den
**Spaltenabgleich** gegen `information_schema` (erste Zeile). Beide sind rein
lesend und kosten nichts. Ohne sie ist der Rückvergleich ein hübsches, aber
leeres Ergebnis.

---

## F. Revisionssichere Dokumentation der nachträglichen `0130`-Änderung

Ausgeführt und danach geändert — Befund, Beweis und Vorschlag stehen in
`supabase/checks/0130_amendment.md`. Kurzfassung:

| | SHA-256 |
|---|---|
| ausgeführte Fassung | `37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe` |
| heutige Fassung | `bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77` |

Der Unterschied sind vier Zeilen im **Nachbedingungsblock** (Anweisung 4),
nicht im Funktionsrumpf. Nachvollziehbar gehalten wird die ausgeführte Fassung
**nicht als zweite Datei**, sondern als geprüftes Rezept: entfernt man genau
diesen Block aus der heutigen Datei, ergibt sie wieder `37417c45…`. Ein Test
in der Suite rechnet das bei jedem Lauf nach
(`backup-sql-areas.test.ts`), sodass jede weitere Änderung an `0130` auffällt,
statt unbemerkt zu bleiben.

Warum keine zweite `.sql`-Datei: eine fast identische, ausführbare Migration
neben der echten ist eine Falle. `0130` wird **nicht erneut angewendet**.

---

## G. Implementierungsplan — klein, einzeln prüfbar, priorisiert

Jeder Schritt ist für sich testbar und endet in einem Nachweis. Kein Schritt
ändert Production. Schritte mit ⚠ brauchen eine ausdrückliche Freigabe.

### Priorität 1 — Revisionssicherheit herstellen (keine Datenbank nötig)

| # | Schritt | Nachweis | Aufwand |
|---|---|---|---|
| 1 | `0130_amendment.md` samt Rezept und Regressionstest | Test rechnet `37417c45…` nach | **erledigt** |
| 2 | ⚠ `0126`–`0131` committen | `git ls-files` zeigt sie; ab dann gibt es eine Baseline | klein |
| 3 | `SHA256SUMS.txt` auf `supabase/migrations/` ausweiten, Prüfung in die Suite | `shasum -c` über beide Ordner | klein |
| 4 | Rein lesende Prüfung „lebende Funktion = Repository-Rumpf" (`md5(prosrc)`) | auf Staging ausführbar, erwartet `24c3810288bb20929fe995554a267adf` | klein |

### Priorität 2 — Stufe 1 schließen, ohne sie auszuweiten

| # | Schritt | Nachweis | Aufwand |
|---|---|---|---|
| 5 | ⚠ Entscheidung: `orders.request_id` in Stufe 1 (Empfehlung B.3) | schriftlich, mit Begründung | — |
| 6 | Migration für `request_id` **entwerfen** (nicht ausführen): 1 Feldzeile, Pre-/Postflight, Feldzahl 352→353 | Tests, Parser-Selbsttest, Bereichszahl bleibt 28 | klein |
| 7 | Dokumentieren: `customer_email` kommt aus Stufe 2, für berechnete Bestellungen zusätzlich aus `invoices` | Abschnitt in `docs/DATABASE.md` | klein |
| 8 | Die zwei Anker aus E.3 als Prüfdatei (Spaltenabgleich + Funktionsdigest) | läuft gegen Staging, rein lesend | mittel |

### Priorität 3 — Stufe 2 entwerfen

| # | Schritt | Nachweis | Aufwand |
|---|---|---|---|
| 9 | Klären, was der Supabase-Tarif an Backup/PITR hergibt, und ob ein eigener `pg_dump` nötig ist | schriftlicher Befund | klein |
| 10 | Verfahren festlegen: Werkzeug, Verschlüsselung, Ort, Frist, wer darf lesen | `docs/SECURITY.md` + `docs/DECISIONS.md` (neue ADR) | mittel |
| 11 | Storage-Teil anbinden: `images:export` + Manifest in dasselbe Verfahren | Manifestvergleich mit SHA-256 je Datei | klein |
| 12 | ⚠ Erste Gesamtsicherung herstellen und ihre **Lesbarkeit** prüfen (nicht ihre Wiederherstellbarkeit) | Dateigröße, Schemaliste, Zeilenzahlen je Tabelle | mittel |

### Priorität 4 — Restore-Test, zweistufig

| # | Schritt | Nachweis | Aufwand |
|---|---|---|---|
| 13 | ⚠ Leeres Testprojekt (legt der Nutzer an), Guard auf dessen Referenz | Guard bricht gegen Staging/Production ab — mit Test | klein |
| 14 | 131 Migrationen einspielen, `0131_postflight` = 0 | Postflight-Ausgabe | klein |
| 15 | `tools/restore-backup.mts` **mit `--dry-run` zuerst**: liest, validiert, zählt, schreibt nichts | Zählungen je Bereich = JSON | mittel |
| 16 | Restore der 15 Geschäftsbereiche + Orderbuch-Verkäufe, eine Transaktion | Rückvergleich (E.1) ohne Abweichung | mittel |
| 17 | Zusatzprüfungen aus E.2 (Sequenzen, Waisen, Schema-Inventar, Negativprobe Unveränderlichkeit, PDF-Digests) | je Prüfung eine Zahl | mittel |
| 18 | Bestellzweig aus Stufe 2 wiederherstellen — erst wenn Stufe 2 existiert | Zeilenzahlen und FK-Integrität | groß |
| 19 | Letzter Schritt, Testdatenbank verbraucht: Nummernfortschreibung prüfen | neuer Beleg zieht `next_number` | klein |
| 20 | ⚠ Erst danach: `restore_supported` bewerten | Protokoll aller Schritte | — |

### Was dabei bewusst nicht passiert

Keine Lockerung von `not null` · kein Platzhalterwert als Nachweis · keine
A2-Felder · keine Belegausstellung außerhalb der Testdatenbank · keine
Änderung an einer angewendeten Migration · keine Aussage über
Wiederherstellbarkeit vor Schritt 17.

---

## Risiken, offen benannt

### Sicherheit

1. **Stufe 2 ist das größte neue Risiko dieser Architektur.** Ein
   Gesamtabzug enthält Passwort-Hashes und jede Kundenadresse. Unverschlüsselt
   oder in einem synchronisierten Ordner ist er schlimmer als gar kein Backup,
   weil er ein einzelnes, vollständiges Ziel schafft. Verschlüsselung, Ort und
   Frist sind **Teil** des Verfahrens, nicht Zubehör.
2. **`client_salt` in einer Sicherung** entwertet die
   Missbrauchserkennung, wenn die Sicherung abfließt. Alternative: Salt
   **nicht** sichern und nach einem Restore neu setzen — die Drosselhistorie
   ist dann verloren, was verkraftbar ist.
3. **`payment_token_hash` wiederherstellen** heißt: alte Fähigkeiten gelten
   wieder. Nach einem Notfall richtig, nach einem Test nicht — die
   Testdatenbank gehört danach gelöscht.
4. **Der Restore-Importer läuft mit dem Service-Role-Key.** Ein falsch
   gesetztes `.env` trifft Staging oder Production. Der Guard muss **vor** dem
   Verbindungsaufbau greifen und beide Projektreferenzen ausdrücklich
   verbieten.

### Datenschutz

5. **Stufe 1 enthält schon heute personenbezogene Daten** (`invoices.customer_*`,
   Belegsnapshots). Jede Kopie der Datei ist eine Verarbeitung. Dateien
   gehören nicht ins Repository, nicht in Logs, nicht in Testausgaben.
6. **Löschverlangen gegen Sicherungen** sind praktisch kaum erfüllbar, wenn
   lange aufbewahrt wird. Kurze, rollierende Aufbewahrung von Stufe 2 ist die
   einzige saubere Antwort. → **offener Prüfpunkt**, Frist nicht geklärt.
7. **Die A2-Felder** bleiben ausgeschlossen. Folge, die bestehen bleibt: nach
   einem Restore stellt ein *neu* ausgestellter Beleg leere Absender- und
   Inseratsfelder dar. Betriebsregel: auf einer wiederhergestellten Datenbank
   keine Belege ausstellen.

### Restore-Vollständigkeit

8. **Ohne Stufe 2 ist der Bestellzweig nicht wiederherstellbar** — 8 Bereiche
   vollständig, 5 teilweise. Entscheidung 1 ist bis dahin **nicht erfüllt**,
   und das soll so benannt bleiben.
9. **`withdrawal_requests` ist in keiner Stufe gesichert.** Widerrufsnachweise
   überleben heute keinen Verlust. Unabhängig vom Restore eine eigene Lücke.
10. **Die Kontoidentitäten sind unwiederbringlich**, wenn `auth.users` fehlt.
    Eine `uuid` lässt sich nicht rekonstruieren.
11. **Der Importer ist selbst unerprobt**; ein Fehler darin sieht aus wie ein
    Fehler der Sicherung. Deshalb `--dry-run`, eine Transaktion, und der
    Rückvergleich plus die zwei Anker aus E.3 als Beweis.
12. **Belege und Abrufe sind nach dem Commit unlöschbar** — ein halb
    gelaufener Restore kostet die ganze Testdatenbank.
13. **Keine Aussage über Vollständigkeit vorwegnehmen.** Bis Schritt 17
    bestanden ist: Inhalt geprüft, Wiederherstellbarkeit unbewiesen,
    `restore_supported = false`.

### Rechtlich — alles offene Prüfpunkte, nichts davon geklärt

14. Aufbewahrungsfristen für Belege, Rechnungen, Einkaufsnachweise,
    Widerrufserklärungen (AT/DE, Einzelunternehmen).
15. Ob eine verschlüsselte Sicherung als „verfügbarer" Nachweis gilt.
16. Ob die Kontozuordnung (`issued_by`, `user_id`) nachweispflichtig ist.
17. Ob ein JSON-Export als Form genügt oder PDFs vorzuhalten sind.
18. Wie Löschverlangen und Aufbewahrungspflicht sich in Sicherungen vertragen.
