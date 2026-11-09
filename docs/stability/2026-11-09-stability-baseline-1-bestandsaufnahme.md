# SkyIsles V2 – Stability Baseline 1: Bestandsaufnahme und Konsolidierungsplan

Stand: **2026-11-09** · Branch `development/skyisles-v2` · rein analysierend erhoben.

Für diesen Bericht wurde nichts verändert: keine Migration, keine Datenänderung, keine
Production-Verbindung, kein Commit. Es lief keine vollständige Testsuite. Laufzeiten stammen
aus den Protokollen der Läufe vom 2026-11-07 bis 2026-11-09.

**Kennzeichnung** in allen Abschnitten:

- **[NACHGEWIESEN]**: im Code oder in Dateien geprüft, mit Fundstelle.
- **[RISIKO]**: ein möglicher Fehler, der noch nicht beobachtet wurde.
- **[IDEE]**: eine Verbesserung ohne nachgewiesenen Fehler.

---

## 1. Technischer Ist-Zustand

| Bereich | Stand |
|---|---|
| Stack | Next.js 16.3.4 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind 4, Supabase (PostgreSQL), Stripe, Vitest 5, PGlite 0.5 |
| Laufzeit | Node lokal v26.7.0. **Nirgends festgelegt:** kein `engines` in `package.json`, keine `.nvmrc` |
| Umfang | `src/lib` 722 Dateien / ~206 000 Zeilen · `src/components` 200 / ~46 000 · `src/app` 86 / ~8 700 · `tools/` 90 / ~42 000 · 186 Migrationen / ~88 000 Zeilen SQL · 267 Prüfdateien in `supabase/checks/` |
| Tests | 465 Testdateien. Der letzte vollständige Lauf (2026-11-08, damals 435 Dateien) ergab **17 083 Tests grün**. Die Gesamtlaufzeit liegt bei etwa **7–12 Minuten** |
| Staging | Migrationen bis **0186** angewendet (`supabase/migrations/APPLIED.md:77`) |
| Production | Migrationen bis **0167** angewendet (`APPLIED.md:642`). **19 Migrationen** liegen nur auf Staging (siehe Abschnitt 3) |
| Arbeitsverzeichnis | **73 geänderte und 83 untracked Dateien**, darunter die auf Staging angewendeten Migrationen 0181–0186 (siehe Abschnitt 6) |
| CI | **Keine**: kein `.github/workflows`, keine Git-Hooks, keine Vercel-Prüfschritte außer dem Build |

Kurzbewertung: Die Datenbank ist **auffallend sorgfältig abgesichert**.

- Jede `SECURITY DEFINER`-Funktion setzt `search_path = ''`.
- RLS ist auf allen 79 Tabellen aktiv.
- Der Lagerbestand wird nur über eine einzige Funktion verändert.
- Migrationen laufen über einen Runner mit Prüfsummen und eingefrorenen Baselines.

Die größten Schwächen liegen woanders:

- **unkommittierte, aber angewendete Arbeit**,
- **nie getesteter Restore**,
- fehlende **CI** und **festgelegte Testebenen**,
- eine **Dokumentation, die zur Chronik geworden ist**.

---

## 2. Architekturübersicht

### 2.1 Module in `src/lib` (Verantwortung → Abhängigkeiten)

| Modul | Verantwortung | importiert aus |
|---|---|---|
| `catalog` | Katalogprojektion, Karten, Bilder | supabase, shop, admin |
| `shop` | Angebote, Mengen | catalog, supabase, i18n, cart |
| `cart` | Warenkorb (Gast/Konto) | shop, catalog, supabase, auth |
| `commerce` | Checkout, Zahlung, Bestellbeträge | supabase, auth, shop, i18n, cart |
| `orderbook` | Einkaufs- und Verkaufsbuch, Legacy-Sync | supabase, auth, i18n, favorites, catalog, import |
| `reconciliation` | eBay-Berichte gegen Verkäufe (0169–0186) | supabase, auth, i18n, **admin**, **orderbook** |
| `admin` | Katalogpflege, aber auch Bestellungen, Erstattung, Widerruf, Lager, Händlerprofil, Berichte | supabase, auth, catalog, i18n, commerce, backup, shop, import, favorites |
| `backup` | Betriebs- und Plattformexport | catalog/image, zip |
| `legal` | Rechtstexte, Rechnungs-PDF, Verkäuferidentität | supabase |
| `business` | Eigenbelege | legal, supabase, i18n, auth |
| `calculator` | Einkaufskalkulator | orderbook, supabase, auth |
| `favorites`, `collection`, `messages`, `account`, `attention`, `perf` | jeweils ein klar umrissener Bereich | überwiegend supabase, auth, catalog |
| `i18n` | alle deutschen Texte (`de.ts`, 6 845 Zeilen) | format-number |
| `layout`, `design`, `ops`, `availability` | **nur Tests**, kein Produktionscode | – |

**Kopplungen:**

- **[NACHGEWIESEN] Zyklen:** admin↔catalog, catalog↔shop, shop↔cart, auth↔supabase. Alle sind klein und bisher ohne beobachtete Fehler.
- **[NACHGEWIESEN] `lib/admin` ist ein Sammelbecken.** Er enthält `order-actions`, `refund-actions`, `withdrawals`, `inventory`, `seller` und `shop-profile`. Diese bedienen überwiegend die `/business`-Routen. Die Rollentrennung aus ADR-0077 ist in `src/lib` **nicht** abgebildet.
- **[NACHGEWIESEN]** Der Staging-Detektor `isStagingProjectUrl` liegt in `admin/catalog-source.ts`, gebraucht wird er aber von `reconciliation/server/*`.
- **[NACHGEWIESEN]** `reconciliation` importiert Geldlogik relativ aus `orderbook/sales-money.ts` und `order-2026.ts`. Die Richtung ist einseitig und fachlich vertretbar, nur nicht dokumentiert.
- **[RISIKO]** Das Paket `server-only` wird nirgends eingesetzt. Heute importiert keine Client-Komponente Servercode, aber nichts würde es verhindern.

### 2.2 Server-Actions

34 Dateien tragen `"use server"`, zusammen etwa 175 Aktionen. Die größten Dateien:

- `admin/actions.ts`: 41 Aktionen, 1 713 Zeilen
- `orderbook/sales-actions.ts`: 36 Aktionen
- `orderbook/actions.ts`: 21 Aktionen

Das Muster ist einheitlich: Rechteprüfung (`canOperateSeller`/`isPlatformAdmin`), dann der RPC, die Fehlerabbildung und `revalidatePath`.

**[NACHGEWIESEN] Veraltete Revalidierung:** derselbe Fehler wie beim Händlernamen, inzwischen behoben in `setSellerContact`. Die folgenden Aktionen revalidieren `/admin`, ihr Formular liegt aber auf einer `/business`-Seite, die **nicht** revalidiert wird:

| Aktion (`src/lib/admin/actions.ts`) | Formular liegt auf | revalidiert |
|---|---|---|
| `setShopPercentage` | `/business/offers` | `/admin`, `/business/inventory`, `/`, `/cart` |
| `setCommerceMode` | `/business/offers` | `/admin`, `/checkout`, `/cart` |
| `setShippingCountry` | `/business/shipping` | `/admin`, `/checkout` |
| `setShopPolicies` | `/business/legal`, `/business/shipping` | `/admin`, `/checkout`, `/cart` |
| `setSellerDetails` | `/business/legal`, `/business/shipping` | `/admin`, `/business/legal` (kein `/business/shipping`) |

**[RISIKO]** Einige Aktionen haben keine eigene Rechteprüfung in der App und verlassen sich auf die Prüfung im RPC:

- `admin/legacy-actions.ts` `loadCardHistory`
- `attention/actions.ts` `markOrderAttentionRead`
- `messages/actions.ts` `sendOrderMessage`, `markConversationRead`
- `shop/quantity.ts` `checkCartQuantity`
- `perf/record.ts` `recordNavigations`

Das ist zulässig, solange jeder dieser RPCs selbst prüft. Für jeden einzelnen ist das noch zu belegen.

**[NACHGEWIESEN]** `setCommerceTester` ist toter Code. Ein Test sichert sogar ab, dass er unbenutzt bleibt.

### 2.3 Doppelte Implementierungen [NACHGEWIESEN]

- **Hülle aus Rechteprüfung, RPC und Revalidierung:** `run()` in `orderbook/actions.ts:24` und `orderbook/sales-actions.ts:150` sind zeilengleich. `call()` in `admin/actions.ts:106` folgt demselben Muster.
- **Fehlerabbildung:** Es gibt acht lokale `message(error)`-Funktionen. Sie vergleichen den englischen `RAISE`-Text per `includes`, damit hängt die Oberfläche am SQL-Wortlaut. Die Codes 42501, 23505, 23514 und PT409 werden in etwa 15 Dateien einzeln ausgewertet. `caseRefusal` und `takeRefusal` in `reconciliation/server/actions.ts` sind die jüngste Variante.
- **Datumsformat `dd.mm.yyyy`:** fünfmal kopiert:
  - `orderbuch/verkauf/[id]/page.tsx:26`
  - `sale-details.tsx:43`
  - `purchase-details.tsx:73`
  - `sales-ledger.tsx:134`
  - `orderbook-ledger.tsx:222`

  Dazu kommen etwa 20 einzelne `toLocale*`-Aufrufe. Auffällig: **`"de-DE"` in `legal/invoice.ts`**, sonst überall `de-AT` (CLAUDE.md, Regel 5). Ob das für Rechnungen gewollt ist, ist zu klären.
- **Geldbeträge:**
  - `refund-form.tsx:92` formatiert selbst (`toFixed(2).replace`).
  - `sale-details.tsx:342` baut `parseMoney` nach.
  - Es gibt zwei Formatmodule, `format.ts` und `format-number.ts`.
  - Die Mail-Function hat ein eigenes `NumberFormat`.
- **Derselbe RPC an zwei Stellen:**
  - `order_payment_state` wird direkt in `payment-status.tsx` und in `commerce/open-order-client.ts` aufgerufen.
  - `seller_sales` wird in `orderbook/sales-queries.ts` und in `reconciliation/server/queries.ts` aufgerufen.

### 2.4 Große und schwer testbare Dateien

| Datei | Zeilen | Bewertung |
|---|---|---|
| `tools/validate-check-sql.mts` | 12 846 | ein einziges `main()`, je Migration ein Prüfblock angehängt (P62…P82). **Höchstes Wartungsrisiko im Repository** |
| `src/lib/i18n/de.ts` | 6 845 | Mergekonflikte. Jede Client-Komponente, die ihn importiert, zieht alle Texte mit |
| `components/business/purchase-details.tsx` | 2 074 | 30 `useState`, fünf Aktionsmodule, eigene Datums- und Fachregeln |
| `tools/verify-rls.mts` | 1 787 | Prüfwerkzeug, zulässig |
| `lib/admin/actions.ts` | 1 713 | 41 Aktionen über fünf Fachbereiche |
| `components/catalog/catalog-view.tsx`, `calculator/calculator-modal.tsx`, `checkout/checkout-view.tsx`, `admin/figure-modal.tsx` | je ~1 000–1 150 | Komponenten, die Datenfluss, Fachlogik und Oberfläche mischen |

**[NACHGEWIESEN]** `tools/seed-category-groups.mts` enthält fünf rohe NUL-Bytes in Template-Literalen. `grep` behandelt die Datei deshalb als binär und **übergeht sie bei Textsuchen stillschweigend**.

**[NACHGEWIESEN]** Keine Tests haben:

- `lib/supabase`, einschließlich des Session-Proxys,
- `supabase/functions/*` (dort gibt es nur Quelltextvergleiche),
- die Skripte in `tools/`.

### 2.5 `tools/` und der Staging-Schutz

- **[NACHGEWIESEN, schwerster Werkzeugfund] `tools/sync-legacy-orderbook.mts` ruft keinen Guard auf.**
  - `sync:orderbook:staging` setzt zwar `SKYISLES_REQUIRE_STAGING=1`, das Werkzeug liest den Wert aber nie.
  - Mit `--apply` schreibt es über den Service-Role-Key `system_sync_legacy_*`-RPCs (Zeilen 537–613).
  - Auch `sync:orderbook:prod` verlangt keine Bestätigung für Production.
  - Ob das Ziel stimmt, hängt also allein an der `--env-file`-Angabe im Skriptnamen.
- **[NACHGEWIESEN] `CLAUDE.md` behauptet, dass jede `:staging`-Variante `SKYISLES_REQUIRE_STAGING=1` setzt. Das stimmt nicht.** 14 Skripte setzen es nicht. Bei den meisten fängt ein Schutz im Werkzeug selbst das ab:
  - `db:*:staging` über `tools/lib/staging-db.mts` mit fester Projektreferenz,
  - `cat03`/`cat05` über `requireStaging()`,
  - `storage:*` über die Projektprüfung in `verbinde()`,
  - `transfer:*` über eigene Schlüsselprüfungen.

  Ganz ohne Schutz sind `verify:shop|seller|commerce:staging`. Sie sind schreibfrei und machen nur anonyme Aufrufe, die abgelehnt werden sollen. `verify:payment-smoke:staging` hat eine eigene Prüfung, nicht den gemeinsamen Guard.
- **[RISIKO]** Elf Werkzeuge nutzen `requireStagingIfRequested` und sind deshalb nur geschützt, wenn das Flag gesetzt ist, zum Beispiel `import-catalog`, `import-legacy-*`, `reconcile-inventory` und `settle-legacy-sales`. Wer sie direkt mit `node` startet, umgeht den Guard.
- **[IDEE] Archivieren:** Einige Einmalwerkzeuge sind sichtbar abgeschlossen:
  - `preflight-0115/0116-staging`,
  - `cat01`–`cat05`,
  - `fix-legacy-raw-name`,
  - die Legacy-Cutover-Werkzeuge vom September (`import-sales`, `import-orderbook`, `apply-workbook-dates`, `import-legacy-*`, `settle-legacy-sales`, `reconcile-inventory`),
  - `verify-recon-0180`.

  Vorher ist zu prüfen, ob Tests auf ihren Quelltext zeigen.

---

## 3. Datenbank- und Migrationsstatus

### 3.1 Migrationen

- **Staging bis 0186, Production bis 0167.** Nur auf Staging liegen:
  - 0166, bewusst nie für Production (ADR-0167),
  - 0168–0176,
  - 0178–0186.

  Damit fehlt auf Production der **gesamte CSV-Abgleich** sowie die Korrekturen und Zuordnungen von 0181–0186.
- **0177 existiert nicht.** Die Nummer ist „reserviert“ (`APPLIED.md:785`, `migration-integrity.test.ts:298`). Das widerspricht der Regel in derselben Datei, Nummern durch Schreiben statt durch Lücken zu reservieren.
- **[NACHGEWIESEN] `APPLIED.md` widerspricht sich.**
  - Zu 0142/0143: `:763` sagt „seit 2026-10-22 auf Staging“, `:850–855` nennt beide nie gemessen und die Buchführung offen.
  - Die Übersichtstabelle bei `:841–842` endet bei 0164/0165.
  - 0134, 0150 und 0151 sind nirgends als angewendet geführt.
- **Prüfsummen:** Alle 584 Einträge in `supabase/SHA256SUMS.txt` stimmen. 0180–0186 und `staging-0181…0186.sql` sind enthalten.
- **[NACHGEWIESEN] Lücke:** `supabase/rollback/` (55 R-Dateien) und `tools/dr/` fehlen in der Prüfsummenliste (`tools/checksums.mts:26–38`), obwohl beide auf Datenbanken wirken.
- Die Köpfe von 0180 und 0182–0186 sagen noch „NOT APPLIED“. Das ist nach der Regel der eingefrorenen Köpfe zulässig, führt Leser aber in die Irre.
- **Rollback-Dateien:** Jede Migration ab 0170 hat eine, auch 0181–0186.

### 3.2 Rechte, RLS, SECURITY DEFINER

- **[NACHGEWIESEN, gut]** 355 `SECURITY DEFINER`-Funktionen, **alle** mit `search_path = ''`. RLS ist auf allen 79 Tabellen aktiv. 62 Tabellen sind policy-los, also für Clients gesperrt und nur per RPC erreichbar, wie beabsichtigt. `using (true)` steht nur auf SELECT-Policies für Stammdaten.
- **[NACHGEWIESEN] Ein Projekt-weites `alter default privileges … revoke execute from public` fehlt.** Jede Funktion hängt an ihrem eigenen `revoke`.
- **[NACHGEWIESEN, statisch] `admin_set_shop_policies` ist für PUBLIC und damit für anon ausführbar.**
  - `0041:1385–1388` legt die Funktion mit neuer Signatur neu an.
  - Weder 0041 noch eine spätere Migration widerruft die Rechte. Die Rechte aus 0040:643 galten nur für die alte Signatur.
  - **Ausnutzbar ist das nicht:** Der Funktionskörper prüft `can_operate_active_seller()` (`0041:1407`). Es bricht aber die Projektregel.
  - Der Parameter `p_free_shipping_threshold` wird angenommen, aber nicht verwendet.
  - Auf Staging ist das noch nicht bestätigt. Die Bestätigung geht mit einer lesenden Katalogabfrage (`has_function_privilege('anon', …)`).
- Bewusst für anon schreibbar sind nur `create_order` und `receive_withdrawal`.
- Seit 0170 entziehen alle neuen RPCs PUBLIC und anon das Ausführungsrecht und erlauben es nur `authenticated`.

### 3.3 Lager, Verkäufe, Korrekturen

- **[NACHGEWIESEN, gut]** `shop_inventory.quantity` wird ausschließlich von `apply_inventory_movement` (0093) geschrieben. Die Funktion sperrt die Zeile mit `for update`, verlangt `quantity + delta >= reserved` und schreibt eine Bewegungszeile. `reserved` ändern nur `hold_*`, `release_*`, `convert_*` und `reserve_for_order`, jeweils unter `for update`.
- **Idempotenz durch Unique-Constraints:**
  - `sale_items.movement_id` und `return_movement_id`,
  - `order_reservations (order_id, inventory_id)`,
  - ein aktiver Hold je Position,
  - die externe Bestellnummer je Kanal (0171),
  - `orders.request_id`.
- **[RISIKO] Race in `seller_delete_sale`** (`0110:1129–1157`).
  - Die Funktion zählt gebuchte Positionen **ohne Sperre auf dem Verkauf** und ohne Versionsargument. Danach löscht sie per Cascade.
  - Bucht `seller_book_sale_item` dazwischen und committet, kann eine Lagerbewegung ohne Verkauf übrig bleiben.
  - `seller_cancel_external_sale` (0170:78) hat eine schwächere Form desselben Problems: Die Versionsprüfung ist dort optional.

### 3.4 CSV-Abgleich 0180–0186

- **[NACHGEWIESEN] Der 0180-Vertrag ist tragfähig:**
  - Nur `take_external` schreibt, und nur vier freigegebene Felder.
  - Den Beweis führt einzig `sales_recon_take_check`, und zwar bei der Entscheidung, in der Vorschau und noch einmal unter Sperre bei der Übernahme.
  - Die Übernahme braucht ein Token über Auswahl, Werte und Versionen. Sie sperrt die Sitzung und danach die Verkäufe in aufsteigender ID-Reihenfolge und gilt ganz oder gar nicht.
  - `sales_recon_applications` ist pro Entscheidung eindeutig.
- **0183, 0185 und 0186** sperren zuerst die Bestellzeile, dann den Verkauf, und verlangen dessen Version. 0186 berechnet zusätzlich die Konkurrenten neu und verlangt einen exakt passenden Ausschluss mit `for share`.
- **[RISIKO] Lücken (keine Datenkorruption, aber fachlich offen):**
  1. **0186, Prüfzeitpunkt vor Sperre:** Die Konkurrenzmenge wird vor den `for share`-Sperren berechnet. Ein Konkurrent, der **gleichzeitig neu angelegt** oder ins ±3-Tage-Fenster verschoben wird, entgeht der Prüfung.
  2. **0186, mögliche Verklemmung:** Ziel mit `for update`, Konkurrenten mit `for share`. Zwei Aufrufe mit vertauschten Rollen können sich gegenseitig blockieren. PostgreSQL erkennt das und bricht einen Aufruf ab.
  3. **Verkäufe ohne Datum sind nie Konkurrenten** (0180, 0185, 0186, `sold_at between …`).
  4. **0185 und 0186 kennen kein Datumsfenster** für die Zuordnung.
  5. **Uneinheitlicher Sitzungszustand:** 0183 verlangt `open`, 0185 und 0186 lehnen nur `discarded` ab. Gelesen wird der Zustand jeweils ohne Sperre.
- **Offen aus dieser Arbeitsphase:**
  - Der manuelle Zuordnungstest 155/157 mit Konkurrenzausschluss steht aus.
  - Die neue Sammelübernahme der Bestellnummern ist nur automatisiert getestet: Server, PGlite mit den echten 0180-Funktionen, Oberfläche. Manuell ist sie noch nicht geprüft.
  - Der privilegierte Postflight für 0183–0186 (`0186-postflight-berechtigt.sql` usw.) ist nicht gelaufen.

### 3.5 Backup und Restore

- **Betriebsexport:** enthält `sale_item_corrections` (0181) über `manifest.ts:526`.
- **Plattformexport:** Formatversion 4 mit 62 Bereichen (0182). 0181–0186 sind abgedeckt.
- **[NACHGEWIESEN] Ein Restore wurde nie durchgeführt.**
  - `restore_supported=false` (`platform-manifest.ts:29`).
  - Der pg_dump-Drill (`tools/dr/*`, `supabase/checks/disaster_recovery_pg_dump.md`) ist geskriptet, aber **nie gelaufen** (`tools/dr/README.md:3–4`).
  - Production läuft auf Supabase Free, **ohne native Backups und ohne PITR**.
- Bewusst nicht im Plattformexport:
  - favorites, offer_state, availability_notifications und availability_alerts,
  - die Belegtabellen,
  - catalog_removed_sky_ids.

### 3.6 Händlername, Handelsname, rechtliche Identität (offene Entscheidung)

| Feld | Inhalt auf Staging | wirkt auf |
|---|---|---|
| `sellers.display_name` | „skyisles.shop“ | Katalog, Shop, Kasse, Betrieb. **Auch `seller_trade_name` neuer Rechnungen** (`0047:560`) |
| `sellers.trading_name` | „yulez.collectibles“ | Geschäftsdaten. Ist auf **keine Rechnung** verdrahtet |
| `SELLER_IDENTITY` (Code) | „Julian Stocker, handelnd unter yulez.collectibles“ | Fußzeile, Impressum, AGB, Widerruf, Datenschutz |

**[NACHGEWIESEN] Widerspruch:** Neue Rechnungen nennen derzeit einen anderen Handelsnamen als Impressum und AGB. Keine Dokumentation sagt, welches Feld auf der Rechnung landet. Dafür ist eine Entscheidung nötig (ADR-0064/0086), siehe Maßnahme M-08.

---

## 4. Testinventar und Laufzeitbewertung

### 4.1 Inventar

| Art | Dateien | Erkennungsmerkmal |
|---|---|---|
| Alle Testdateien | 465 | `src/**/*.test.ts(x)` (`vitest.config.mts`) |
| UI mit DOM (jsdom) | 25 | `// @vitest-environment jsdom`, `*.test.tsx` |
| PGlite (echtes PostgreSQL im Prozess, Schema aus den Migrationen) | 41 | `reconciliationWorld`, `@electric-sql/pglite` |
| Echtes PostgreSQL mit mehreren Verbindungen | 4 | `src/lib/reconciliation/pg/concurrency-018x.test.ts`, nur mit `RECON_REAL_PG=1` (`npm run test:recon-pg`) |
| Quelltextvergleiche (`readFileSync` + `toContain`) | 365 Dateien lesen Dateien, **275** davon TS/TSX-Quelltext | etwa 13 200 solche Zusicherungen. Spitzenreiter: `orderbook/sales.test.ts` mit 543 |
| Lesen Migrationen oder SQL-Dateien | 175 | Prüfung von Akte, Prüfsumme, Prüfdatei und Operationsdatei |
| Mit `vi.mock` | 42 | Server-Action-Tests mit gemocktem Supabase |
| Bedingt (`runIf`/`skipIf`) | 7 | lokale Akten (`cat03`/`cat04`), echte eBay-Berichte (`real-reports.local.test.ts`), RECON_REAL_PG |
| Prüfskripte gegen Staging | ~30 `verify:*:staging` plus `db:check`/`db:privileges` | laufen nicht unter Vitest. Ein Teil davon **schreibt** (z. B. `verify:rls:staging`) |
| SQL-Planprüfung | `npm run verify:check-sql` | plant jede Datei in `supabase/checks/` gegen PGlite. Teil von `npm run check` |

**Testdateien je Modul:**

| Modul | Testdateien |
|---|---|
| catalog | 71 |
| orderbook | 65 |
| admin | 64 |
| reconciliation | 55 |
| commerce | 43 |
| backup | 23 |
| shop | 20 |
| components/business | 16 |
| favorites | 10 |
| components/catalog | 10 |
| restliche Module | ≤ 9 |

### 4.2 Laufzeit und Engpässe

Die Werte stammen aus den Laufprotokollen dieser Sitzung.

| Lauf | Dateien | Tests | Dauer |
|---|---|---|---|
| voll, 2026-11-07 | 425 | 16 891 | **713 s** |
| voll, 2026-11-08 | 435 | 17 083 grün | etwa 7–12 min |
| gezielt, Abgleich, 2026-11-08 | 51 | 1 048 | **409 s**, davon 99 % Testzeit |
| gezielt, 2026-11-09 | 62–69 | 1 085–1 211 | einige Minuten |

**[NACHGEWIESEN] Der Engpass sind die PGlite-Tests.** Eine Auswahl von 51 Abgleichsdateien braucht so lange wie die halbe Gesamtsuite. Der Grund: Viele PGlite-Dateien bauen in `beforeEach` die Welt aus allen Migrationen neu auf (z. B. `bulk-order-numbers-0180.test.ts`). 19 Dateien heben deshalb die Zeitgrenze auf 60–90 s an.

Die etwa 16 000 Quelltextvergleiche sind dagegen schnell. Sie sind **brüchig, aber nicht teuer**.

**[NACHGEWIESEN] Kopplung über die Migrationsnummer.** Jede neue Migration bricht zuverlässig Registertests in anderen Modulen: `availability/alerts-schema.test.ts`, `backup/manifest-gap.test.ts`, `platform-manifest.test.ts`, `business/purchase-receipt.test.ts` und `admin/migration-integrity.test.ts`. 10 Testdateien nennen „0186“, im Arbeitsbaum sind 32 Testdateien geändert. Die Wächter sind gewollt, sie schützen Backup-Abdeckung und Lückenlosigkeit. Aber ihre Anpassung ist **nicht als Schritt der Migrations-Checkliste beschrieben**. Deshalb fallen sie erst in einem späten Gesamtlauf auf. So geschah es bei den Fehlschlägen vom 2026-11-07 und 2026-11-08 (2, 3 und 9 rote Tests).

**[NACHGEWIESEN] Testlauf braucht Umgebung.** In dieser Sitzung liefen gezielte Tests mit `node --env-file=.env.staging` und `SUPABASE_SERVICE_ROLE_KEY=offline-check-sentinel-not-a-key`. 13 Testdateien lesen Umgebungsvariablen. Ob `npm test` ohne diese Vorbereitung grün läuft, ist **zu messen**. Dokumentiert ist es nirgends.

**[NACHGEWIESEN] Ablaufproblem:** Eine Warteschleife (`until grep …; do sleep 3; done`) ohne Zeitgrenze lief mehr als neun Stunden weiter, weil das gesuchte Muster nie erschien. Sie wurde am 2026-11-09 gezielt beendet.

### 4.3 Vorschlag: sechs Testebenen

Grundsatz: **Kein Test wird gelöscht, keine Prüfung abgeschwächt.** Die Ebenen ordnen bestehende Tests nur über **Pfad- und Namenskonventionen**. Technisch umgesetzt wird das mit Vitest-`projects` in `vitest.config.mts` und je einem npm-Skript (Maßnahme M-12).

| Ebene | Inhalt | Befehl (Vorschlag) | Ziel-Laufzeit | Wann |
|---|---|---|---|---|
| **1 Fast** | Unit- und Quelltexttests ohne PGlite, ohne jsdom; nur geänderte und abhängige Dateien | `npm run test:fast` → `vitest run --project unit --changed` | < 60 s | während der Entwicklung, beliebig oft |
| **2 Feature** | alle Ebenen eines Fachbereichs (Pfadfilter) | `npm run test:feature -- reconciliation` → `vitest run src/lib/reconciliation src/components/business/reconciliation src/app/(business)/business/orderbuch` | 1–7 min | vor dem Abschluss einer Aufgabe |
| **3 Integration** | PGlite-Tests (`**/sql/**`, Dateien mit `reconciliationWorld`), jsdom-UI- und Seitentests | `npm run test:integration` → `vitest run --project pglite --project ui` | einige Minuten, nach Beschleunigung messen | vor dem Commit eines Bereichs |
| **4 DB/Security** | `verify:check-sql`, `verify:sums`, `migration-integrity`/`public-surface`/Manifest-Wächter, `test:recon-pg` (lokal), danach **lesend** `db:check:staging` und `db:privileges:staging` | `npm run test:db` (lokal), Staging-Teile weiter einzeln | wenige Minuten | bei jeder Migration und Rechteänderung |
| **5 Full** | `npm run check` + `npm test` vollständig | unverändert | ~10–12 min | vor Push, Release und Production-Migration |
| **6 Smoke/E2E** | heute: `verify:sandbox-e2e:staging`, `verify:payment-smoke:staging`, `verify:shop:staging` plus eine **schriftliche Browser-Checkliste** für Kauf, Orderbuch, Abgleich und Händlerprofil | `npm run smoke:staging` (Sammelskript, nur lesende oder Sandbox-Werkzeuge) | < 5 min | nach Staging-Migration und nach Deploy |

**Begleitende Regeln:**

- Jede Testdatei bekommt eine eindeutige Ebene. PGlite-Dateien liegen unter `sql/` oder `pg/` oder tragen `.db.test.ts`. UI-Dateien tragen `.test.tsx`. Ein kleiner Wächtertest prüft die Zuordnung.
- **Erst messen, dann beschleunigen:** einmal mit `--reporter=json` die Dauer je Datei erheben (Maßnahme M-11). Danach wird für die PGlite-Welten ein einmal gebautes Schema-Abbild je Worker geprüft, über PGlite `dumpDataDir`/`loadDataDir` oder ein Template. Die Tests selbst bleiben unverändert.
- Hintergrundläufe nur mit Zeitgrenze (`timeout`), auf den Exit-Code warten, ohne Polling. Ein Lauf der Ebene 5 gleichzeitig, nie zwei parallel.

---

## 5. Dokumentationsaudit

### 5.1 Bestand

| Datei | Zeilen | Zustand |
|---|---|---|
| `CLAUDE.md` | 279 | Regeln gut. Produktabschnitt „Stand 2026-09-25“ veraltet |
| `PROJECT_STATUS.md` | **8 348** | will „aktuellen Zustand, nicht Historie“ beschreiben (Z. 3), ist aber **eine Chronik**: 159 Überschriften, datierte Blöcke vom 09-17 bis 11-03, allein die CAT/UX-Protokolle füllen Z. 527–2537. Kopf „Stand 2026-11-03“, letzte Änderung 11-07 |
| `docs/DECISIONS.md` | **18 964** | 183 ADRs, lückenlos. **Reihenfolge bricht:** 0001–0161 aufsteigend, danach 0183→0162 absteigend. Etwa 25 Schreibweisen für den Status. `ERSETZT DURCH` ist definiert, wird aber nie genutzt. ADR-0152 hat keinen Titel |
| `docs/DATABASE.md` | 5 598 | Schema plus Migrationschronik. Z. 3 „Production bis 0098“ veraltet, richtig ist 0167 |
| `docs/SECURITY.md` | 2 158 | Kopf „Stand 2026-09-03“ |
| `docs/DEPLOYMENT.md` | 1 049 | Umgebungen plus viele datierte Rollout-Protokolle. Keine Node-Version |
| `docs/ARCHITECTURE.md` | 685 | **src-Baum vom Projektstart** (Z. 212–235): `src/types/` existiert nicht, die `(business)`-Gruppe fehlt, 5 von ~35 lib-Modulen sind genannt. Z. 486 nennt `reconciliation` „ohne Datenbank, ohne Server-Aktion“, das ist falsch |
| `docs/AUTH.md`, `SKYLANDERS_DATA.md`, `LEGAL.md`, `ROADMAP.md` | 438–1 314 | inhaltlich gepflegt. `ROADMAP.md` „Stand 2026-09-04“ |
| `docs/FAVORITE_NOTIFICATIONS.md` | 954 | als „HISTORISCHE AKTE“ markiert, liegt aber noch in `docs/` |
| `docs/history/*.md` | 5 Dateien | Laufprotokolle, sauber |
| `supabase/migrations/APPLIED.md` | 1 009 | Staging- und Production-Buch mit langen Protokollen, Widersprüche siehe Abschnitt 3.1 |
| READMEs | 7 Stück | `supabase/checks` (469 Zeilen), `operations`, `privileges`, `rollback`, `baselines`, `tools/dr` |
| `.env.example` | 30 | nennt nur `.env.local`, also Production, und kein Wort zu `.env.staging` |

### 5.2 Widersprüche und veraltete Angaben [NACHGEWIESEN]

1. `CLAUDE.md:103–105`: der Satz „jede `:staging`-Variante setzt `SKYISLES_REQUIRE_STAGING=1`“ ist falsch, siehe Abschnitt 2.5.
2. `CLAUDE.md:13–16` („kein Marketplace, Zahlungen erst bewerten wenn …“) widerspricht Z. 36–42 (Stripe live, Checkout, Orderbuch). Die Single-Seller-Regel (Z. 27–34) ist die tatsächliche Aussage. ADR-0021 (`DECISIONS.md:680`) steht unverändert auf „ANGENOMMEN“, ohne einen Vermerk wie „eingeschränkt durch ADR-0032/0064/…“.
3. `CLAUDE.md:125`: „SKY-0001 … SKY-0820“ stimmt nicht mehr, seit ADR-0070 neue IDs vergeben werden.
4. `ARCHITECTURE.md:212–235` und `:486`, siehe 5.1.
5. `DATABASE.md:3` nennt einen veralteten Production-Stand.
6. Projektname: „PortalVault“ in CLAUDE.md, PROJECT_STATUS und `.env.example`, „SkyIsles“ sonst überall.
7. Händlername und Handelsname: Welches Feld auf die Rechnung kommt, ist nirgends beschrieben (Abschnitt 3.6).
8. `APPLIED.md` widerspricht sich selbst zu 0142/0143.

### 5.3 Fehlend oder mehrfach

- **Fehlend:**
  - Modulübersicht `src/lib`,
  - **Testanleitung** (Ebenen, jsdom, PGlite, `RECON_REAL_PG`, Umgebungsvariablen; bisher nur in ADR-Texten wie DECISIONS Z. 12464, 17012, 17496),
  - **Runbook Production-Migration**,
  - **ein einziger Einstieg für den Restore**,
  - **Anleitung lokale Entwicklung** (`dev` = Production-Daten).
- **Mehrfach beschrieben:**
  - Migrationsprozess: CLAUDE, SECURITY, PROJECT_STATUS, DECISIONS, APPLIED, DEPLOYMENT,
  - Restore: sechs Dateien plus sechs Prüfdateien,
  - Migrationsstand: DATABASE, DEPLOYMENT, APPLIED und PROJECT_STATUS, die sich **gegenseitig widersprechen**.

### 5.4 Zielstruktur: eine verbindliche Quelle je Thema

| Thema | verbindliche Quelle | Größenrahmen |
|---|---|---|
| Arbeitsregeln für Claude | `CLAUDE.md` (ohne „Stand“-Momentaufnahmen, verlinkt den Status) | ≤ 300 Z. |
| Aktueller Stand, offene Punkte, nächster Schritt | `PROJECT_STATUS.md`. Jede datierte `##`-Sektion wandert nach `docs/history/AAAA-MM-*.md` | ≤ 300 Z. |
| Migrationsstand Staging/Production | **nur** `supabase/migrations/APPLIED.md` als Tabelle. Laufprotokolle nach `docs/history/` | Tabelle |
| Migrationsablauf (Staging und Production) | neu `docs/RUNBOOK_MIGRATIONS.md` | – |
| Backup und Restore | neu `docs/RUNBOOK_RESTORE.md` als Index auf `tools/dr` und `supabase/checks/*restore*` | – |
| Tests | neu `docs/TESTING.md` (Ebenen, Befehle, Umgebungen, lesend oder schreibend je `verify:*`) | – |
| Lokale Entwicklung | neu `docs/DEVELOPMENT.md` plus korrigierte `.env.example` | – |
| Architektur und Module | `docs/ARCHITECTURE.md` mit echtem src-Baum und Modulkarte | ≤ 800 Z. |
| Schema | `docs/DATABASE.md`, nur Referenz, keine Chronik | ≤ 2 000 Z. |
| Sicherheit (service_role, RLS, Secrets) | `docs/SECURITY.md`; andere Dokumente verlinken nur | – |
| Entscheidungen | `docs/DECISIONS.md` aufsteigend, mit erzeugtem Index (Nummer, Titel, Status, ersetzt/ersetzt durch) und einheitlichem Statusvokabular | später ggf. `docs/adr/NNNN-*.md` |
| Recht | `docs/LEGAL.md` | – |
| Historie | `docs/history/` (auch `FAVORITE_NOTIFICATIONS.md`) | – |

---

## 6. Git- und Umgebungsaudit

| Punkt | Befund |
|---|---|
| Branch | `development/skyisles-v2`, im Gleichstand mit `origin/development/skyisles-v2` (letzter Commit `3f34716`, 2026-11-07). 30 Commits vor `main` |
| Arbeitsbaum | **73 geänderte Dateien** (+4 407 / −807) und **83 untracked** |
| **[NACHGEWIESEN, P0] auf Staging angewendet, aber nicht versioniert** | Die Migrationen `0181`–`0186`, ihre Operations-, Preflight-, Postflight- und Rollback-Dateien, die Baselines `0181`–`0186` und die neuen Module `reconciliation/candidates.ts`, `rivals.ts`, `live.ts` und `server/candidate-actions.ts`. **Diese Dateien gibt es nur auf dieser einen Festplatte.** Geht sie verloren, ist der Staging-Schemastand ohne Quelle |
| Sensible Dateien | `.env.local` (Production) und `.env.staging` sind korrekt ignoriert. Getrackt sind keine `.env`-, CSV- oder xlsx-Dateien. `supabase/log/` (177 Dateien) ist ignoriert. `repository-data-hygiene.test.ts` bewacht die Regeln |
| Fraglich, untracked | `public/images/series/` (6 WebP, 96 KB), erzeugt von `designs:build --with-series`. Laut ADR-0173 werden sie derzeit weder verwendet noch ausgeliefert, also entweder ignorieren oder bewusst committen. Außerdem `resources/sync/name-decisions.md`, eine Entscheidungsvorlage zu Katalognamen ohne Secrets, Ablageort zu entscheiden |
| `.gitignore` | gründlich und begründet. Keine Lücke gefunden |
| Lokale Befehle | **`npm run dev` arbeitet mit Production-Daten** (`.env.local`). `.env.example` führt Neueinsteiger genau dorthin. Der richtige Alltag ist `dev:staging` bzw. `dev:staging:lan`, der läuft (Port 3000) |
| Staging/Production-Trennung | Datenbankseitig stark (Guard, feste Projektreferenz, Prüfzugang ohne Schreibrecht). Lücken in einzelnen Werkzeugen, siehe Abschnitt 2.5 |
| Hintergrundprozesse | Nur der Entwicklungsserver aus dieser Sitzung läuft. Ein fremder Shell-Prozess aus einer alten Sitzung (PID 97001, anderes Projektverzeichnis) wurde nicht angefasst |
| CI/CD | **Keine CI.** Vercel baut Production aus `main`. Prüfungen laufen nur, wenn jemand sie lokal startet. Kein Pre-Commit-Hook, keine festgelegte Node-Version |
| Release-Ablauf | nur in Protokollen beschrieben (PROJECT_STATUS, history, APPLIED). Production steht auf Migration 0167. Welcher Code-Commit dort läuft, steht in keiner aktuellen Datei an einer verbindlichen Stelle |

---

## 7. Priorisierter Konsolidierungsplan

Aufwand: **S** < ½ Tag · **M** ½–2 Tage · **L** > 2 Tage.
„Migration?“ heißt: Eine neue Migration ist nötig, mit dem üblichen Freigabeablauf.

### P0: Sicherheit, Datenintegrität, Blocker

| Nr. | Problem (Art) | Dateien/Module | Risiko/Auswirkung | Lösung | Aufwand | Tests | Migration/Staging | hängt ab von |
|---|---|---|---|---|---|---|---|---|
| **M-01** | Angewendete Migrationen 0181–0186 und die zugehörige Anwendung sind unversioniert **[NACHGEWIESEN]** | 156 Dateien im Arbeitsbaum | Datenverlust der Schemaquelle. Staging ist nicht mehr reproduzierbar | Nach Freigabe in fachlich getrennten Commits sichern: (1) 0181/0182 Korrekturen mit Backup, (2) 0183/0184, (3) 0185, (4) 0186, (5) Sammelaktionen und UI, (6) Händlerprofil-Fix, (7) Doku. Vorher `verify:sums`, `check` und die Ebene Feature je Commit | M | `npm run check`, `verify:sums`, Feature-Tests Abgleich und Orderbuch | nein / nein | – |
| **M-02** | `sync-legacy-orderbook.mts` schreibt ohne Guard **[NACHGEWIESEN]** | `tools/sync-legacy-orderbook.mts`, `package.json` | Ein falsches `--env-file` schreibt in die falsche Datenbank, auch Production | `requireStaging()` bzw. ein expliziter Production-Bestätigungsschalter wie bei `catalog:finish:apply`. Werkzeug-Test analog `staging-guard.test.ts` | S | neuer Guard-Test | nein / nein | – |
| **M-03** | Restore nie erprobt, Production ohne PITR **[NACHGEWIESEN]** | `tools/dr/*`, `supabase/checks/disaster_recovery_pg_dump.md` | Im Ernstfall unbekannt, ob und wie lange eine Wiederherstellung dauert | DR-Drill gegen ein **lokales** Postgres mit einem Staging-Dump durchführen und protokollieren. `RUNBOOK_RESTORE.md`. **Vor** dem nächsten Production-Rollout (0168+) | M | Drill-Protokoll, Zeilenzahlenvergleich | nein / ja (lesender Dump) | M-01 |

### P1: Stabilität und nachgewiesene Fehler

| Nr. | Problem (Art) | Dateien/Module | Risiko/Auswirkung | Lösung | Aufwand | Tests | Migration/Staging | hängt ab von |
|---|---|---|---|---|---|---|---|---|
| **M-04** | Offene Staging-Nachweise **[NACHGEWIESEN]** | `supabase/log/staging/*-postflight-berechtigt.sql` 0183–0186; 155/157-Test; Sammelübernahme | Die Rechte- und Funktionslage von 0183–0186 ist nur durch den Prüfzugang belegt | Du führst die privilegierten Postflights aus, ich werte lesend aus. Danach manueller Zuordnungstest 155/157 und Sammelübernahme in einer Sitzung, mit lesender Gegenprüfung | S | lesende Staging-Prüfung | nein / ja | – |
| **M-05** | Veraltete Revalidierung in 5 Aktionen **[NACHGEWIESEN]** | `src/lib/admin/actions.ts` (`setShopPercentage`, `setCommerceMode`, `setShippingCountry`, `setShopPolicies`, `setSellerDetails`) | Nach dem Speichern zeigen `/business/offers`, `/business/shipping` und `/business/legal` alte Werte | Revalidierungsziele der tatsächlichen Formularseiten ergänzen, `router.refresh()` im Formular wie beim Händlerprofil. Ein Test je Aktion analog `seller-name-refresh.test.ts` | S | Unit | nein / nein | – |
| **M-06** | `admin_set_shop_policies` für PUBLIC/anon ausführbar **[NACHGEWIESEN statisch, nicht ausnutzbar]** | `0041:1385–1440` | Regelbruch. Ein künftiger Fehler im Körper wäre sofort öffentlich | (a) lesend auf Staging bestätigen, (b) kleine Guard-Migration `revoke … from public, anon; grant … to authenticated`, (c) Wächtertest: keine anon-ausführbare Funktion außer einer Erlaubnisliste | S | PGlite-Test, `verify:check-sql`, `db:privileges:staging` | **ja** / ja | M-01 |
| **M-07** | Race in `seller_delete_sale`, optionale Version bei `seller_cancel_external_sale` **[RISIKO]** | `0110:1129–1157`, `0170:78` | Lagerbewegung ohne Verkauf bei gleichzeitigem Buchen und Löschen | Migration: Verkauf `for update` sperren, Version verlangen. Die Signatur ändert sich, Aufrufer sind anzupassen | M | real-PG-Konkurrenztest wie `concurrency-018x` | **ja** / ja | M-01 |
| **M-08** | Händlername vs. Handelsname auf Rechnungen **[NACHGEWIESEN, Entscheidung]** | `0047:560`, `src/lib/legal/seller-identity.ts`, `sellers.trading_name` | Rechnung und Impressum nennen verschiedene Handelsnamen | **Deine Entscheidung:** (a) Rechnungen nehmen `trading_name` (Migration) oder (b) die Rechtsangaben folgen „skyisles.shop“ (Code, rechtlich prüfen). Danach in `LEGAL.md`/`DATABASE.md` festhalten | S–M | Rechnungs-PGlite-Test, `identity.test.ts` | (a) ja / ja | Entscheidung |
| **M-09** | Fachliche Lücken 0185/0186 **[RISIKO]**: Prüfung vor Sperre, Verklemmung, Verkäufe ohne Datum keine Konkurrenten, kein Datumsfenster, uneinheitlicher Sitzungszustand | `0180`, `0185`, `0186` | Seltene Fehlzuordnung bei gleichzeitiger Bearbeitung oder bei undatierten Verkäufen | Zuerst **messen**: Wie viele Staging-Verkäufe haben `sold_at is null`? Dann eine Folgemigration: Konkurrenten in einem Durchgang nach ID sperren, undatierte Verkäufe als Konkurrenten blockieren lassen, Sitzungszustand einheitlich und gesperrt lesen | M | real-PG- und PGlite-Tests | **ja** / ja | M-04 |
| **M-10** | Buchführung und Prüfsummen **[NACHGEWIESEN]** | `APPLIED.md` (0142/0143, Übersicht, 0134/0150/0151, 0177), `tools/checksums.mts` | Der Migrationsstand ist nicht eindeutig ablesbar. Rollbacks sind ungeschützt | 0142/0143 auf Staging lesend messen und eintragen. Übersicht als einzige Tabelle. 0177 als „nie vergeben“ festhalten. `supabase/rollback/` und `tools/dr/` in die Prüfsummen aufnehmen | S | `verify:sums`, `migration-integrity` | nein / ja (lesend) | M-01 |

### P2: Testgeschwindigkeit, Wartbarkeit, Dokumentation

| Nr. | Problem (Art) | Dateien/Module | Lösung | Aufwand | Tests | Migration/Staging | hängt ab von |
|---|---|---|---|---|---|---|---|
| **M-11** | Laufzeit je Datei unbekannt **[NACHGEWIESEN]** | Testsuite | Ein vollständiger Lauf mit `--reporter=json` als Messgrundlage. Top 20 nach Dauer, Anteil PGlite | S | – | nein / nein | M-01 |
| **M-12** | Keine Testebenen **[NACHGEWIESEN]** | `vitest.config.mts`, `package.json` | Vitest-`projects` (unit, ui, pglite, realpg) und Skripte `test:fast`, `test:feature`, `test:integration`, `test:db`, `smoke:staging`. Wächtertest für die Zuordnung, siehe Abschnitt 4.3 | M | Ebenenlauf je Projekt, Gesamtzahl unverändert | nein / nein | M-11 |
| **M-13** | PGlite-Welten werden je Test neu migriert **[NACHGEWIESEN, Engpass]** | `src/lib/reconciliation/sql/schema.ts`, `create-sale-world.ts` | Einmal gebautes Schema-Abbild je Worker laden. Die Testlogik bleibt unverändert. Nutzen erst nach M-11 belegen | M | identische Testzahlen und Ergebnisse vorher/nachher | nein / nein | M-11 |
| **M-14** | Migrationswächter brechen spät **[NACHGEWIESEN]** | `alerts-schema`, `manifest-gap`, `platform-manifest`, `purchase-receipt`, `migration-integrity` | Wächter behalten, aber in `RUNBOOK_MIGRATIONS.md` als Pflichtschritt „neue Migration → diese Wächter anpassen“ aufnehmen. In `test:db` bündeln, damit sie früh laufen | S | `test:db` | nein / nein | M-12 |
| **M-15** | Keine CI, keine festgelegte Node-Version **[NACHGEWIESEN]** | – | GitHub Actions ohne Secrets: lint, typecheck, `verify:sums`, `verify:check-sql`, `test:fast`/Unit, später Full nachts. `.nvmrc` und `engines` setzen. **Kosten und Freigabe vorher klären** | M | CI-Lauf | nein / nein | M-12 |
| **M-16** | Dokumentation ist Chronik, Widersprüche **[NACHGEWIESEN]** | siehe Abschnitt 5 | Zielstruktur 5.4 umsetzen: PROJECT_STATUS auf ≤ 300 Zeilen, Historie auslagern, DECISIONS sortieren und indexieren, ADR-0021 vermerken. Neu: TESTING, DEVELOPMENT, RUNBOOK_MIGRATIONS, RUNBOOK_RESTORE. ARCHITECTURE-Baum und Modulkarte, CLAUDE.md-Korrekturen (Guard-Satz, Produktziel, SKY-ID-Bereich), `.env.example` | L (in Etappen) | Doku-Tests, die Pfade prüfen, anpassen | nein / nein | M-01, M-12 |
| **M-17** | Doppelte Hilfsfunktionen **[NACHGEWIESEN]** | `run()`/`call()`, `message(error)`, Datumsformatierer (inkl. `de-DE` in `legal/invoice.ts`), Geldformat in `refund-form.tsx`/`sale-details.tsx` | Nur dort zusammenführen, wo ein Fehler belegt oder wahrscheinlich ist: Datumsformat in `format.ts`, Rechnungs-Locale klären, gemeinsame Fehlercodes-Abbildung. **Kein Großumbau** | M | Unit | nein / nein | M-12 |
| **M-18** | Werkzeuge: Guard nur mit Flag, Einmalwerkzeuge, NUL-Bytes **[RISIKO/NACHGEWIESEN]** | `tools/*` | `requireStagingIfRequested` → `requireStaging`/explizite Production-Bestätigung. `verify:shop/seller/commerce:staging` mit Guard. Abgeschlossene Einmalwerkzeuge nach `tools/archive/`, nachdem Testverweise geprüft sind. `\0` statt NUL-Byte | M | Guard-Tests | nein / nein | M-02 |
| **M-19** | Untracked Artefakte **[NACHGEWIESEN]** | `public/images/series/`, `resources/sync/name-decisions.md` | Entscheiden: ignorieren oder committen | S | `repository-data-hygiene` | nein / nein | M-01 |

### P3: Optional

| Nr. | Idee | Nutzen | Aufwand |
|---|---|---|---|
| M-20 | Seller-Betriebscode aus `lib/admin` nach `lib/business` (ADR-0077 im Code abbilden) | klarere Zuständigkeit | L |
| M-21 | `tools/validate-check-sql.mts` (12 846 Z.) in Prüfblöcke je Migration aufteilen | Wartbarkeit, weniger Konflikte | M |
| M-22 | `de.ts` nach Bereichen aufteilen | Mergekonflikte, Bundlegröße (nach Messung) | M |
| M-23 | Große Komponenten (`purchase-details`, `checkout-view`, `calculator-modal`) in Fachlogik plus Oberfläche teilen, sobald dort ein Fehler oder eine Änderung ansteht | Testbarkeit | je M |
| M-24 | Echte Browser-E2E (z. B. Playwright) gegen Staging für Kauf, Orderbuch und Abgleich | ersetzt Teile der Quelltextvergleiche | L, neue Abhängigkeit, Freigabe nötig |
| M-25 | `server-only` in Query- und Servermodulen | Schutz gegen versehentlichen Client-Import | S |
| M-26 | Gemeinsame Supabase-Client-Fabrik für `tools/` | weniger Kopien | S |
| M-27 | Projekt-weites `alter default privileges … revoke execute on functions from public` | zweite Sicherung neben M-06 | S, Migration |

---

## 8. Künftiger Entwicklungs- und Testablauf

**Für jede Aufgabe:**

1. Den laufenden `dev:staging`-Server weiterverwenden, nicht neu starten. `npm run dev` (Production) nur bewusst.
2. Während der Arbeit: `test:fast`, im Vordergrund und mit Exit-Code.
3. Vor dem Abschluss: `test:feature -- <bereich>` und `npm run check`.
4. Berührt die Aufgabe SQL: `test:db`, und bei Konkurrenzlogik `test:recon-pg`.
5. Commit je Fachschritt, erst nach deiner Freigabe.

**Für jede Migration (Staging):**

1. Migration, Prüfdateien, Rollback, Operationsdatei, `sums:write`.
2. Die Migrationswächter anpassen (Liste in `RUNBOOK_MIGRATIONS.md`).
3. `test:db`, danach die Feature-Ebene.
4. **Commit vor der Anwendung**, damit nichts Angewendetes unversioniert bleibt.
5. `db:migrate:staging -- NNNN` → du führst die Operationsdatei aus → `--resume` → `db:privileges:staging` → privilegierter Postflight.
6. `APPLIED.md`-Zeile, danach `smoke:staging`.

**Vor Push oder Production:** Full plus Smoke/E2E, ein bestandener DR-Drill (M-03) und ein eigenes Production-Runbook mit Preflight und Postflight.

**Hintergrundaufgaben:**

- Nur mit Zeitgrenze, ohne Polling-Schleifen.
- Nach Abschluss gezielt schließen.
- Höchstens ein vollständiger Testlauf gleichzeitig.

---

## 9. Abschlusskriterien für Stability Baseline 1

Stability Baseline 1 gilt als abgeschlossen, wenn **alle** folgenden Punkte nachgewiesen sind:

1. **Arbeitsbaum sauber:** Alles auf Staging Angewendete ist versioniert und gepusht (M-01). `git status` zeigt nur bewusst Ungetracktes (M-19).
2. **Kein schreibendes Werkzeug ohne Guard** (M-02, M-18). Die Aussage in `CLAUDE.md` dazu stimmt.
3. **Ein dokumentierter, erfolgreich durchgeführter Restore-Drill** (M-03).
4. **Staging-Nachweise vollständig:** privilegierte Postflights 0183–0186, 155/157-Test und Sammelübernahme manuell bestätigt (M-04). `APPLIED.md` ist widerspruchsfrei, und Rollbacks stehen in den Prüfsummen (M-10).
5. **Alle P1-Befunde behoben oder bewusst entschieden und dokumentiert:** M-05 bis M-09, inklusive der Entscheidung zum Handelsnamen.
6. **Testebenen 1–6 existieren als Befehle**, sind in `docs/TESTING.md` beschrieben, und die Gesamtzahl der Tests ist nicht gesunken (M-12). Gemessene Laufzeit je Ebene ist dokumentiert (M-11). **Fast < 60 s.**
7. **CI** führt mindestens lint, typecheck, Prüfsummen, SQL-Planprüfung und die Unit-Ebene bei jedem Push aus. Die Node-Version ist festgelegt (M-15).
8. **Dokumentation nach Zielstruktur 5.4:** `PROJECT_STATUS.md` ≤ 300 Zeilen und aktuell, ein Migrationsbuch, TESTING, DEVELOPMENT und beide Runbooks vorhanden, die Widersprüche aus 5.2 beseitigt (M-16).
9. Ein abschließender **Full-Lauf und `npm run check` grün** auf dem Baseline-Commit, als Tag `stability-baseline-1`.
