# Isolierter Wiederherstellungstest — Plan (Stand 0131)

**Nichts davon ausführen.** Dieses Dokument ist der Plan und die Lücken­analyse.
Es ersetzt `0129_restore_test.md` nicht, sondern führt ihn mit den Erkenntnissen
aus `0130`/`0131` zu Ende.

`restore_supported` bleibt `false`. Es gibt **keine** Importfunktion im Projekt;
jede Wiederherstellung wäre Handarbeit oder ein neu zu schreibendes Werkzeug.
Solange der Test nicht durchgelaufen ist, gilt die Sicherung als **geprüft
vollständig im Inhalt, aber unbewiesen in der Wiederherstellbarkeit**.

Grundlage: Exportstand `0131` — 28 Bereiche, 352 Feldzeilen, Formatversion 1,
verifizierter Staging-Download mit 5 508 Datensätzen und 0 Abweichungen,
2 unveränderliche Belege mit Korrekturkette, 7 Abrufe, 1 Zählerzeile.

> **Stand 2026-10-19:** `0136` ist vorbereitet und nimmt `item_type` in den
> Bereich `figures` auf — dann **353 Feldzeilen** und Abdruck
> `f6d08440707ba72a8040a8d1e666c092` (21 494 Zeichen). Angewendet ist sie
> nirgends; `0131_function_body_check.sql` kennt beide Stände.

---

## 1. Was der Export für einen Restore hergibt — und was nicht

Der Export deckt **352 von 418 Spalten** der 28 Quelltabellen ab. Die 66
übrigen Spalten sind nach Folgen sortiert:

### 1.1 Zwei harte Blocker — `orders` lässt sich nicht einfügen

| Spalte | Typ | Lage |
|---|---|---|
| `orders.customer_email` | `text` | **not null, kein Default, nicht im Export** |
| `orders.request_id` | `text` | **not null, kein Default, nicht im Export** |

Ohne Ersatzwerte bricht jedes `insert into public.orders` ab. Betroffen sind
dann **8 Bereiche vollständig** — `orders`, `order_lines`, `order_line_events`,
`order_reservations`, `order_refunds`, `order_refund_allocations`,
`order_legal_snapshots`, `invoices`: alle verweisen mit einer `not null`-Spalte
auf `orders.id` (bei `order_legal_snapshots` ist `order_id` sogar der
Primärschlüssel).

**Teilweise** betroffen sind fünf weitere: `sales.order_id` ist **nullable**.
Die Verkäufe aus dem Orderbuch (`source = 'orderbook'`, kein Bestellbezug)
lassen sich einfügen, die Verkäufe aus dem Shop nicht — und mit ihnen nicht
ihre `sale_items`, `sale_fees`, `sale_refunds` und
`settlement_adjustments`. Dasselbe gilt für `order_reservations`, die über
`sale_item_id` an einem solchen Verkauf hängen.

Unberührt bleiben die 15 Bereiche um Einkauf, Lager, Belege und Stammdaten —
genau die, um die es bei den Eigenbelegen geht.

Drei Wege, zu entscheiden **vor** dem Test:

1. **Platzhalter** — `customer_email` = `'restore-test@invalid'`,
   `request_id` = `'restore-' || id`. Billig, sofort machbar, aber der
   wiederhergestellte Bestand enthält dann nachweislich erfundene Werte. Für
   einen *Technik*-Test der Reihenfolge und der Mengen genügt das; als
   Nachweis einer *vollständigen* Wiederherstellung genügt es nicht.
2. **Export erweitern** (`request_id` ist technisch, nicht personenbezogen —
   `customer_email` ist personenbezogen und braucht eine Aufbewahrungs- und
   Datenschutzentscheidung wie A2).
3. **Zweig ausklammern** und den Test auf die 15 unberührten Bereiche plus die
   Orderbuch-Verkäufe begrenzen.

Empfehlung: **Variante 1 für den ersten Durchlauf**, ausdrücklich als
Technik-Test deklariert, und Variante 2 als eigene Entscheidung danach.

### 1.2 Neun Spalten, deren Wert beim Restore *erfunden* wird

`not null` **mit** Default, nicht im Export — die Zeile entsteht, aber mit dem
Datum des Restores statt dem Original:

`categories.created_at` · `sellers.created_at` · `sellers.updated_at` ·
`series.created_at` · `shipping_methods.updated_at` · `skylanders.created_at` ·
`skylanders.updated_at` · `skylanders.catalog_visible` ·
`order_refunds.provider_attempts`

Folge: Stammdaten-Zeitstempel sind nach einem Restore **nicht** die originalen.
Für `sellers` war das eine bewusste Entscheidung in `0130`/`0131`
(Zeitstempel der Stammdaten bleiben draußen). `skylanders.catalog_visible`
fällt auf den Default — die redaktionelle Katalogsichtbarkeit ist kein
Betriebsdatum und kommt aus dem Katalogimport.

### 1.3 55 Spalten, die als `NULL` wieder entstehen

Nullable und nicht im Export. Die vier Gruppen:

* **Kontoidentität (19 Spalten)** — 18 Fremdschlüsselspalten auf `auth.users`
  in 15 Tabellen (`created_by`, `updated_by`, `issued_by`, `delivered_by`,
  `orders.user_id`, `orders.sandbox_archived_by`) plus
  `seller_monthly_reports.finalized_by`, eine `uuid`-Spalte **ohne**
  Fremdschlüssel. Bewusst draußen (`0129`: „keine Kontoidentität"). **Folge: die Spur, wer was getan hat, ist nach einem
  Restore verloren.** Das ist dokumentarisch die schwerste der weichen Lücken.
* **Personenbezogene Einkaufsfelder (A2, 9 Spalten)** —
  `purchases.sender_name/street/postal_code/city/country`,
  `listing_title/url/details`, `agreement_note`. **Nicht freigegeben.** Sie
  stehen eingefroren in `purchase_receipts` und nur dort.
* **Technik und Idempotenz (12 Spalten)** — `client_token`,
  `client_request_fingerprint`, `import_fingerprint`, `idempotency_key`,
  `request_id`, `client_hash`, `payment_token_hash`, `provider*`,
  `daily_index` (zweimal), `source_row`, Legacy-Flaggen.
* **Darstellung und Redaktion (5 Spalten)** — `order_lines.image_snapshot`,
  `skylanders.image_file`, `image_override_path`, `display_name_override`,
  `price_updated_at`.

### 1.4 Drei Fremdschlüssel zeigen aus dem Export hinaus

| Ziel | referenziert von | im Export? |
|---|---|---|
| `auth.users` | 15 Tabellen | **nein** — bewusst |
| `public.characters` | `skylanders.character_id` | **nein** — kuratierte Quelle `data/characters/characters.json` |
| `public.withdrawal_requests` | `order_refunds.withdrawal_request_id` | **nein** — Lücke |

Alle drei Spalten sind nullable, der Restore scheitert daran also nicht. Aber:
die Widerrufsnachweise (`withdrawal_requests`) sind **gar nicht gesichert**.
Für einen Betrieb mit Widerrufsrecht ist das eine eigene Lücke, unabhängig vom
Restore — sie gehört in denselben Entscheidungsgang wie A2.

### 1.5 Nicht gesicherte Nachbartabellen, die der Betrieb braucht

* `commerce_settings` — nur `mode` steht in den Metadaten. `client_salt` ist ein
  **Geheimnis** und gehört nicht in eine Sicherung; die Ratenschranken fallen
  auf die Defaults der Migrationen. Konsequenz: `orders.client_hash` (nicht
  exportiert) wäre nach einem Restore ohnehin bedeutungslos — in sich stimmig.
* **Die Rollentabellen** — `seller_operators`, `platform_admins`,
  `shop_admins`, `testers`. Keine davon im Export. `seller_business_backup()`
  hängt an `can_operate_active_seller()`, und das prüft `sellers.is_active`
  **und** eine eingeschaltete Zeile in `seller_operators` für `auth.uid()`.
  **Der wiederhergestellte Betrieb hat also keinen Bediener**, bis einer von
  Hand eingetragen wird. Für die Verifikation heißt das: als `postgres` im
  SQL-Editor prüfen, nicht über die Oberfläche.
* `catalog_editorial`, Bild-Dateien im Storage-Bucket, Stripe-Daten (liegen
  beim Dienstleister), `inventory_imports`, `payment_attempts`, `testers`.
* **`skylanders` ist absichtlich unvollständig**: der Bereich `figures` führt
  nur SKY-IDs, die in Lager, Einkauf, Verkauf oder Bestellzeilen vorkommen
  (`used_figures`). Der vollständige Katalog kommt aus
  `npm run catalog:import` — und das ist richtig so.

---

## 2. Reihenfolge

### 2.1 Identitätsspalten: `overriding system value` ist Pflicht

Alle 41 Identitätsspalten des Schemas sind `generated **always** as identity`.
22 der 28 Exporttabellen haben eine:

`categories` · `inventory_movements` · `invoices` · `order_line_events` ·
`order_lines` · `order_refund_allocations` · `order_refunds` ·
`order_reservations` · `orderbook_name_mappings` · `orders` ·
`purchase_items` · `purchase_receipt_downloads` · `purchase_receipts` ·
`purchases` · `sale_fees` · `sale_items` · `sale_refunds` · `sales` ·
`seller_monthly_reports` · `sellers` · `settlement_adjustments` ·
`shop_inventory`

Jedes `insert` dieser Tabellen braucht
`insert into public.X (id, …) overriding system value values …`, sonst
vergibt PostgreSQL neue IDs und **jeder** Fremdschlüssel im Backup zeigt ins
Leere. Die sechs übrigen haben natürliche Schlüssel:
`order_legal_snapshots(order_id)` · `purchase_receipt_counters(year)` ·
`series(code)` · `shipping_methods(code)` · `shop_settings(id boolean)` ·
`skylanders(sky_id)`.

**Nach** dem Einfügen jeder Identitätstabelle:
`alter table public.X alter column id restart with <max(id)+1>`.
Ohne das vergibt die erste echte Neuanlage eine schon belegte ID.

Zusätzlich drei eigene Sequenzen, aus den eingefügten Werten nachzuziehen:

| Sequenz | speist | nachziehen auf |
|---|---|---|
| `order_number_seq` | `orders.order_number` (`SI-<Jahr>-NNNNNN`) | höchste vergebene Nummer |
| `invoice_number_seq` | `invoices.invoice_number` | höchste vergebene Nummer |
| `sky_id_seq` | neue `SKY-NNNN` ab 821 | höchste Zahl in `skylanders.sky_id` |

### 2.2 Einfügereihenfolge — sieben Stufen

Topologisch aus den tatsächlichen Fremdschlüsseln der 28 Tabellen berechnet:

| Stufe | Tabellen |
|---|---|
| 1 | `sellers`, `shop_settings`, `shipping_methods`, `series`, `purchase_receipt_counters`, `purchases`, `orders`¹, `seller_monthly_reports` |
| 2 | `categories`, `purchase_receipts`², `sales`, `invoices`, `order_legal_snapshots`, `order_refunds` |
| 3 | `skylanders`, `purchase_receipt_downloads`, `sale_fees`, `sale_refunds`, `settlement_adjustments` |
| 4 | `shop_inventory`, `orderbook_name_mappings` |
| 5 | `inventory_movements`, `order_lines` |
| 6 | `purchase_items`, `sale_items`, `order_line_events`, `order_refund_allocations` |
| 7 | `order_reservations` |

¹ nur mit der Entscheidung aus 1.1.
² **innerhalb** der Tabelle nach `revision` aufsteigend — `purchase_receipts`
trägt einen zusammengesetzten Selbstverweis
`(supersedes_id, purchase_id) → (id, purchase_id)`. Revision 2 lässt sich erst
einfügen, wenn Revision 1 steht.

`purchase_receipt_counters` steht bewusst in Stufe 1: der Zähler wird
**eingefügt, nie hergeleitet**.

### 2.3 Trigger: neun Stück müssen aus, sonst erfindet die Datenbank Daten

Ermittelt aus `pg_trigger`-Definitionen der Migrationen; aufgeführt sind nur
die, die bei `insert` feuern.

| Tabelle | Trigger | Was er beim Restore anrichten würde |
|---|---|---|
| `orders` | `orders_register_sale_trg` | **legt eine `sales`-Zeile an** (bei `payment_status = 'paid'`) → Doppelungen |
| `orders` | `orders_snapshot_legal_trg` | **legt eine `order_legal_snapshots`-Zeile an** → Konflikt mit der echten |
| `orders` | `orders_stamp_payment_mode_trg` | überschreibt `payment_mode` (ist exportiert) |
| `orders` | `orders_clear_client_hash_trg` | räumt `client_hash` (nicht exportiert) |
| `sales` | `sales_set_day_and_index_trg` | rechnet `sale_day` neu — **`sale_day` ist exportiert** |
| `sale_items` | `sale_items_no_historical_movement_trg` | **verweigert** historische Positionen mit Lagerbewegung → bricht ab |
| `order_lines` | `order_lines_series_snapshot` | füllt `series_snapshot` (ist exportiert) |
| `purchase_items` | `purchase_items_touch_purchase_trg` | setzt `purchases.updated_at = now()` — **`updated_at` ist exportiert** |
| `purchases` | `purchases_set_daily_index_trg` | errechnet `daily_index` (nicht exportiert, also nicht prüfbar) |

Mechanik: `alter table public.X disable trigger user` je Tabelle, danach
`enable trigger user`. **Nicht** `session_replication_role = replica` — das
schaltet auch die Fremdschlüsselprüfung ab, und gerade die soll der Restore
beweisen.

Unkritisch und eingeschaltet bleiben alle Trigger, die nur auf `update` oder
`delete` hören — darunter beide Unveränderlichkeitstrigger
(`purchase_receipts_immutable_trg`, `purchase_receipt_downloads_immutable_trg`,
`inventory_movements_append_only`, `invoices_protect_issued_trg`,
`order_legal_snapshots_protect_trg`, `orders_immutable`).

### 2.4 Generierte Spalte

`shop_inventory.available_quantity` ist `generated` — sie darf im `insert`
**nicht** vorkommen, obwohl der Export sie führt. Genau deshalb ist sie ein
gutes Prüfmaß: die Datenbank muss nach dem Restore denselben Wert errechnen.

### 2.5 Typen

Alle Geldbeträge stehen im Export als `::text` (`items_cost`, `total_cost`,
`sale_price`, `market_price`, `base_price`, `price_percentage`,
`free_shipping_threshold`, `unit_cost`, …) — bewusst, damit `numeric` nicht
über JSON-Fließkomma läuft. Beim Einfügen zurück nach `numeric` casten, nicht
nach `float`.

---

## 3. Ablauf

**Phase 0 — Vorbereitung (ohne Datenbank).** Backup-JSON außerhalb des
Repositories ablegen, SHA-256 notieren. Entscheidung aus 1.1 schriftlich
festhalten. Dieses Dokument und `0130_staging_order.md` gelesen.

**Phase 1 — leeres Projekt.** Ein **neues, eigenes** Supabase-Projekt in der
EU-Region, ausschließlich für diesen Test. Nicht Staging, nicht Production.
Service-Role-Key nur in `.env.restore-test` (nicht committen). Ein Guard nach
dem Muster von `tools/lib/staging-guard.mts`, der **vor** dem Verbindungsaufbau
abbricht, wenn die Projekt-Referenz nicht genau die des Testprojekts ist —
`zmiwxswrpkmizvqsgype` (Production) und `qqxcpesbwfxzgytkdsac` (Staging)
gehören auf eine ausdrückliche Verbotsliste.

**Phase 2 — Schema.** Alle 131 Migrationen `0001` … `0131` in Reihenfolge,
ohne Auslassung. Danach `0131_postflight.sql` → muss `9999 = 0` liefern, und
`0129_postflight.sql` → 28 Bereiche. Erst dann ist das Schema beweisbar das
der Sicherung.

**Phase 3 — Werkzeug.** `tools/restore-backup.mts`, zu schreiben, mit:
Datei lesen · `format_version = 1` und `format = 'skyisles-business-backup'`
prüfen · Bereichsliste gegen die 28 des Manifests prüfen · `--dry-run`
(zählt und validiert, schreibt nicht) · Trigger aus/ein · Einfügen in den
sieben Stufen · `overriding system value` · Identitäten und Sequenzen
nachziehen · **eine** Transaktion über den ganzen Lauf. Kein Logeintrag mit
Inhalten — nur Bereich, Zeilenzahl, Dauer.

Die eine Transaktion ist nicht Kosmetik: `purchase_receipts` und
`purchase_receipt_downloads` lassen sich nach dem Commit **nicht mehr
löschen** (Unveränderlichkeitstrigger). Ein halb gelaufener Restore ist nur
noch durch Verwerfen der ganzen Testdatenbank zu heilen.

**Phase 4 — Verifikation** (Abschnitt 4).

**Phase 5 — Abbau.** Testprojekt löschen, JSON-Datei und `.env.restore-test`
entfernen, Ergebnis in `docs/DATABASE.md` und `PROJECT_STATUS.md` festhalten.
`restore_supported` bleibt `false`, bis der Test **vollständig** bestanden ist
und die Entscheidung aus 1.1 getroffen wurde.

---

## 4. Verifikation

### 4.1 Der Hauptbeweis: Export → Restore → Export → Vergleich

`seller_business_backup()` liest **genau** die 352 Felder, die der Restore
schreibt. Ein zweiter Export auf der wiederhergestellten Datenbank muss daher
im `data`-Objekt **zeichengleich** sein — über alle 28 Bereiche, alle 5 508
Datensätze. Das ist kein Stichprobentest, sondern ein Gleichheitsbeweis über
die gesamte wiederherstellbare Fläche.

Erwartete und zu *erklärende* Abweichungen, abschließend:

* Metadaten `created_at` und `snapshot_txid` (Zeitpunkt und Transaktion),
* `commerce_mode` (kommt aus `commerce_settings`, nicht gesichert),
* was aus 1.1 nicht eingefügt werden konnte,
* `purchases.updated_at`, falls ein Trigger entgegen 2.3 lief.

Jede weitere Abweichung ist ein Fehler. Der Vergleich läuft **lokal** auf zwei
Dateien, ohne Datenbankverbindung und ohne Inhalte in der Ausgabe — derselbe
Weg wie `npm run verify:backup`, erweitert auf einen Datei-gegen-Datei-Diff.

Voraussetzung: `seller_business_backup()` ist durch
`can_operate_active_seller()` abgeriegelt. Für den zweiten Export braucht das
Testprojekt genau **einen** Auth-Nutzer mit einer eingeschalteten
`seller_operators`-Zeile, mit **fiktiven** Daten. Das ist zugleich die Probe, dass die Berechtigungskette
nach dem Restore funktioniert.

### 4.2 Datensatzzahlen

Je Bereich gegen `0129_export_baseline.sql` (auf der Testdatenbank, rein
lesend) **und** gegen die Zählung im JSON. Summe 5 508. Insbesondere:
90 Einkäufe, 2 128 Einkaufspositionen, 2 Belege, 7 Abrufe, 1 Zählerzeile.

### 4.3 Lager

* `sum(quantity)` = Metadatum `inventory_units` des Original-Exports.
* Je Lagerzeile: `sum(inventory_movements.delta) = quantity` — die
  Bestandsgleichung. Sie ist der eigentliche Lagerbeweis, nicht die Zeilenzahl.
* `available_quantity` von der Datenbank neu errechnet = exportierter Wert
  (siehe 2.4).
* `reserved` gegen die offenen `order_reservations`.

### 4.4 Kostenwerte

* Je Einkauf: `items_cost + shipping_cost + buyer_protection_cost = total_cost`.
* Summen über `purchases`, `sales`, `sale_fees`, `sale_refunds`,
  `settlement_adjustments` gegen die Baseline.
* `orderbook_global_factor()` auf der Testdatenbank neu errechnet =
  Metadatum `buy_in_factor`. Der Faktor ist **abgeleitet**, nicht gespeichert —
  stimmt er, sind Einkaufsmengen und -werte stimmig wiederhergestellt.

### 4.5 Belegfingerabdrücke — der gefährliche Punkt

Zwei Dinge, die nicht verwechselt werden dürfen:

* **Richtig:** die gespeicherten `purchase_receipts.content_fingerprint` sind
  exportiert; sie werden als Zeichenketten 1 : 1 verglichen, vorher gegen
  nachher. Dazu die Prüfsummen über alle Fingerabdrücke, die Positionslisten
  und die Kette, die `0129_export_baseline.sql` bildet.
* **Falsch:** `purchase_receipt_fingerprint(purchase_id)` auf der
  wiederhergestellten Datenbank aufrufen und mit dem gespeicherten Wert
  vergleichen. Diese Funktion hasht die **lebenden** Einkaufsfelder —
  darunter `sender_*`, `listing_*`, `agreement_note` und
  `skylanders.display_name_override`, also **genau die Felder, die der Export
  nicht enthält**. Sie würde für jeden Einkauf eine Abweichung melden, und die
  Abweichung hätte nichts mit dem Beleg zu tun. Solange A2 nicht freigegeben
  ist, ist dieser Vergleich **kein** Prüfmittel, sondern ein Fehlalarm.

### 4.6 Belegketten

* Revision 1: `supersedes_id is null`, Nummer `SI-E-2026-000001`.
* Revision 2: `supersedes_id` zeigt auf Revision 1, `supersedes_number` und
  `supersedes_issued_at` stimmen mit Revision 1 überein.
* Die drei Zwänge aus `0122` halten:
  `receipts_revision_matches_chain` (`supersedes_id is null` ⇔ `revision = 1`),
  `receipts_no_self_reference`, `receipts_revision_sane`.
* Die zwei Teilindizes greifen: `purchase_receipts_origin_uniq` (genau ein
  Ursprungsbeleg je Einkauf), `purchase_receipts_supersedes_uniq` (kein Beleg
  wird zweimal ersetzt).
* Kein Einkauf hat eine Lücke in der Revisionsfolge.

### 4.7 Nummernzähler

`purchase_receipt_counters.next_number` = exportierter Wert, und
`next_number > max(Nummernanteil)` der tatsächlich vorhandenen Belege dieses
Jahres. **Nie herleiten.** Der Zähler ist der Grund, warum eine Nummer nicht
zweimal vergeben wird.

### 4.8 Referenzen

Der Restore mit aktiven Fremdschlüsseln ist bereits der Beweis. Zusätzlich für
die nullable Verweise je Paar eine Anti-Join-Zählung = 0 (`purchase_items`
→ `inventory_movements`, `sale_items` → beide Bewegungen,
`order_reservations` → `sale_items`, `order_line_events` → beide Bewegungen,
`order_refund_allocations` → `order_lines`). Und: wie viele Verweise auf
`auth.users`, `characters`, `withdrawal_requests` nun `NULL` sind — die Zahl
ist die **Größe des Verlusts** und gehört ins Protokoll.

### 4.9 PDF-Vergleich

Der stärkste Teil, weil er ohne Datenbank auskommt:
`seller_purchase_receipt_document()` liest **ausschließlich** die
Beleg­zeile (`to_jsonb(r) - 'issued_by' - 'content_fingerprint'`), und
`renderPurchaseReceiptPdf()` ist nachweislich deterministisch — die
4 506 Bytes und der SHA-256 des echten Staging-Abrufs sind in
`receipt-format.test.ts` festgenagelt.

Daraus folgt der Ablauf:

1. Für jeden der 2 Belege das PDF **aus dem Original-JSON** rendern → SHA-256.
2. Dasselbe **aus dem Nach-Restore-JSON** → SHA-256. Beide müssen gleich sein.
3. Beide gegen `purchase_receipt_downloads.byte_count` der 7 Abrufe prüfen —
   das ist der Abgleich gegen einen echten, in der Datenbank bezeugten
   Download.
4. Die Formatnummer je Beleg beachten: `format_version` entscheidet, ob V1
   oder V2 gezeichnet wird.

**Nicht** über die Oberfläche herunterladen:
`seller_record_purchase_receipt_download` **schreibt** eine Abrufzeile und
würde die Zahl 7 verfälschen — und die Zeile ließe sich wegen des
Unveränderlichkeitstriggers nicht mehr entfernen.

### 4.10 Was während des Tests niemals passieren darf

* `seller_issue_purchase_receipt` oder
  `seller_issue_purchase_receipt_correction` aufrufen. Beide vergeben eine
  **neue** Nummer aus dem Zähler.
* Einen Einkauf ändern. Auf der wiederhergestellten Datenbank fehlen
  `sender_*`, `listing_*` und `agreement_note` (A2) — ein danach ausgestellter
  Beleg wäre inhaltlich **leer** an genau diesen Stellen. Das ist der
  gefährlichste Nebeneffekt der A2-Lücke und der Grund, den Test rein lesend
  zu Ende zu bringen.
* `restore_supported` auf `true` setzen.

---

## 5. Die nachträgliche Änderung an `0130` (revisionssichere Dokumentation)

### 5.1 Der Befund, belegt

`0130` wurde auf Staging ausgeführt und **danach** verändert.

| | SHA-256 |
|---|---|
| ausgeführte Fassung | `37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe` |
| heutige Fassung | `bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77` |

Der Unterschied sind **genau diese vier Zeilen**, eingefügt in die
Prüfschleife der Nachbedingung (Anweisung 4, der zweite `do`-Block):

```sql
    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then
      raise exception '%: der Pruefeintrag "%" hat keine Form Bereich|Feldzeile',
        v_wer, v_key;
    end if;
```

**Beweis statt Behauptung:** entfernt man aus der heutigen Datei genau diesen
Block, ergibt sie wieder `37417c45…` — bitweise die ausgeführte Fassung. Damit
ist die Änderung vollständig eingegrenzt.

Folgen für die Datenbank: **keine.** Die vier Zeilen stehen im
Nachbedingungsblock, nicht im Funktionsrumpf und nicht im Kommentar.
`create or replace function` (Anweisung 2) und `comment on function`
(Anweisung 3) sind unverändert; Schema, Funktion und Daten auf Staging sind
dieselben, die die ausgeführte Fassung hinterlassen hat.

Geprüft wurden auch die übrigen angewendeten Migrationen: `0126`, `0128`,
`0129` und `0131` sind bitgleich mit der Fassung, die zuletzt vor ihrer
Ausführung berichtet wurde. `0127` wurde vor dem erfolgreichen zweiten Versuch
geändert (der erste brach ab und rollte zurück) — das ist dokumentiert und
kein Nachträglich-Fall. **`0130` ist der einzige Fall.**

### 5.2 Warum es überhaupt passieren konnte

`0126` bis `0131` sind **nicht committet**. `git ls-files` endet bei `0125`.
Sechs angewendete Migrationen existieren nur als Dateien im Arbeitsverzeichnis
— ohne Baseline, gegen die eine Änderung auffällt. Die Prüfsummen in
`supabase/checks/SHA256SUMS.txt` deckten bisher nur den `checks`-Ordner ab.

### 5.3 Vorschlag

1. **Datei so lassen, Änderung aktenkundig machen.** Ein
   `supabase/checks/0130_amendment.md` mit beiden Prüfsummen, den vier Zeilen,
   dem Rekonstruktionsbeweis aus 5.1 und der Feststellung, dass die Datenbank
   unberührt ist. Dazu ein Satz in `docs/DATABASE.md` beim Abschnitt zu `0130`.
   Die ausgeführte Fassung wird als
   `supabase/checks/0130_as_executed.sql` daneben abgelegt — nicht zum
   Ausführen, als Beleg.
2. **Gegenprobe gegen die Datenbank.** Eine rein lesende Prüfung vergleicht
   `md5(prosrc)` der lebenden `seller_business_backup()` auf Staging mit dem
   aus der Repository-Datei errechneten Rumpf. Erwartet für Stand `0131`:
   `24c3810288bb20929fe995554a267adf` (Rumpflänge 21 458 Zeichen). Stimmt er,
   ist bewiesen, dass die ausgeführte Funktion zeichengleich die des
   Repositories ist — und die Frage nach der Änderung ist nicht nur erklärt,
   sondern gemessen.
3. **Baseline herstellen.** `0126`–`0131` committen (mit ausdrücklicher
   Freigabe) und `SHA256SUMS.txt` auf `supabase/migrations/` ausweiten. Erst
   danach ist „nachträglich geändert" überhaupt automatisch erkennbar.
4. **Regel für die Zukunft.** Die Nachbedingung einer ausgeführten Migration
   ist eingefroren. Ein neuer Wächter gehört in die Prüfdateien und in die
   Tests — dort wirkt er auch bei schon gelaufenen Migrationen, in der
   Migrationsdatei nicht mehr. Der Formwächter selbst bleibt zusätzlich in
   `0131` (noch nicht ausgeführt, als sie eingebaut wurde) und in
   `src/lib/backup/backup-sql-areas.test.ts`.

Nicht vorgeschlagen: `0130` zurückschreiben und den Wächter in eine neue
Migration `0132` heben. Das wäre eine Migration, die nichts ändert, nur prüft —
und es verlagert die Dokumentationslast auf eine weitere Datei, ohne etwas zu
beweisen, was 5.1 nicht schon beweist.

---

## 6. Voraussetzungen vor dem echten Test

| # | Voraussetzung | Zustand |
|---|---|---|
| 1 | Entscheidung zu `orders.customer_email` / `request_id` (1.1) | **offen** |
| 2 | Entscheidung zu A2 (neun personenbezogene Einkaufsfelder) | **offen, nicht freigegeben** |
| 3 | Eigenes, leeres Supabase-Testprojekt in der EU | **nicht angelegt** (legt der Nutzer an) |
| 4 | Guard, der nur die Testprojekt-Referenz zulässt | **zu schreiben** |
| 5 | `tools/restore-backup.mts` samt `--dry-run` | **zu schreiben** |
| 6 | Alle 131 Migrationen im Testprojekt, `0131_postflight` = 0 | offen |
| 7 | Ein fiktiver Auth-Nutzer + `seller_operators`-Zeile (`is_enabled`) im Testprojekt | offen |
| 8 | Backup-JSON außerhalb des Repositories, SHA-256 notiert | beim Nutzer |
| 9 | Dokumentation der `0130`-Änderung (Abschnitt 5) | **zu erledigen** |
| 10 | `0126`–`0131` committet, Prüfsummen über `migrations/` | **offen, braucht Freigabe** |

## 7. Risiken

1. **Der Bestellzweig ist ohne Entscheidung 1 nicht wiederherstellbar.** Acht
   Bereiche vollständig, fünf weitere teilweise (1.1). Ein Test ohne diese
   Entscheidung prüft die 15 Bereiche um Einkauf, Lager, Belege und Stammdaten
   sowie die Orderbuch-Verkäufe — und sonst nichts.
2. **Die Spur, wer was getan hat, ist weg** (19 Spalten Kontoidentität). Für
   die Belege ist das verkraftbar, weil Nummer, Datum und Fingerabdruck im
   Snapshot stehen; für einen Prüfer kann es dennoch zu wenig sein.
3. **A2-Lücke mit Folgewirkung:** nach einem Restore stellt ein Beleg, der
   *neu* ausgestellt würde, leere Absender- und Inseratsfelder dar. Die
   Betriebsregel „auf der wiederhergestellten Datenbank keine Belege
   ausstellen" ist daher Teil des Restore-Verfahrens, nicht nur des Tests.
4. **`withdrawal_requests` ist nicht gesichert.** Widerrufsnachweise
   überleben keinen Restore.
5. **Das Importwerkzeug ist selbst unerprobt.** Ein Fehler darin sieht aus wie
   ein Fehler der Sicherung. Deshalb `--dry-run`, eine Transaktion und der
   Export-Rückvergleich aus 4.1 als Hauptbeweis.
6. **Belege und Abrufe sind nach dem Commit unlöschbar.** Ein halb gelaufener
   Restore kostet die ganze Testdatenbank.
7. **Die JSON-Datei enthält personenbezogene Daten**
   (`contains_personal_data: true`). Sie darf nicht ins Repository, nicht in
   Logs, nicht in Testausgaben, und sie gehört nach dem Test gelöscht.
8. **Größe.** Die Datei ist zu groß für bequemes Einfügen in den SQL-Editor;
   der Weg führt über das Werkzeug aus Phase 3 mit dem Service-Role-Key des
   **Testprojekts**.
9. **Keine Aussage über Vollständigkeit vorwegnehmen.** Bis 4.1 bestanden ist,
   bleibt die Formulierung: Inhalt geprüft, Wiederherstellbarkeit unbewiesen,
   `restore_supported = false`.
