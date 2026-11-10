# M-05 – Datenbankkonsistenz und Berechtigungen (Audit)

Stand: **2026-11-10** · Stability Baseline 1 · reine Code- und Schemaanalyse.

Grundlage sind die Migrationen 0001–0186 und der lokale, zeilenfreie Staging-Schema-Dump vom 2026-11-09 (`~/SkyIsles-Daten/dr/staging-schema-20261109/public.sql`). Es gab keine Verbindung zu Staging oder Production, keine Änderung und keinen Test-Lauf gegen eine Datenbank.

**Kennzeichnung:**

- **[NACHGEWIESEN]**: im Code oder im Schema belegt.
- **[ABGELEITET]**: aus dem Code geschlossen, nicht ausgeführt.
- **[UNSICHER]**: lokal nicht entscheidbar.

---

## 1. Ergebnis in einem Satz je Problem

| # | Problem | Befund | Stufe |
|---|---|---|---|
| 1 | Race Condition bei `seller_delete_sale` | **bestätigt als konstruierbare Race, nicht beobachtet.** Sie führt nur bei Positionen **ohne Hold** zu einer verwaisten Lagerbewegung. `seller_cancel_external_sale` hat eine verwandte Lücke. **Kein UI-Pfad ruft eine der beiden Funktionen auf** | **P2** |
| 2 | `anon`-EXECUTE auf `admin_set_shop_policies` | **bestätigt im Staging-Schema**: `GRANT ALL … TO anon, authenticated, service_role`, kein `REVOKE … FROM PUBLIC`. **Nicht ausnutzbar**, weil die erste Anweisung die Rollenprüfung ist | **P1** (Regelbruch, Verteidigung in der Tiefe) |
| 3 | Fünf Settings-Actions revalidieren `/admin` statt `/business` | **bestätigt im Code**: Keine der fünf revalidiert die Seite, auf der ihr Formular steht. Zwei der drei Formulare laden nicht selbst nach | **P2** (veraltete Anzeige, keine Datenwirkung) |

---

## 2. Aufgabe 1: `seller_delete_sale`

### 2.1 Implementierung [NACHGEWIESEN]

- **Letzte Fassung:** `supabase/migrations/0110_external_hold_runtime.sql` (ab Zeile ~1129), `security definer`, `search_path = ''`.
- **Ablauf:**
  1. Rollenprüfung (`can_operate_active_seller`).
  2. Abbruch bei internem Verkauf (`order_id is not null`).
  3. **`count(*)` gebuchter Positionen** (`movement_id` oder `return_movement_id` gesetzt), **ohne Sperre**.
  4. Für jede Position `release_sale_item_hold`. Das sperrt nur die **Reservierung** (`for update`) und gibt `shop_inventory.reserved` zurück, mit Wächter `reserved >= quantity`.
  5. `delete from public.sales where id = p_id`.
- **Keine Versionsprüfung** (`p_expected_updated_at` fehlt) und **keine Sperre auf `sales` oder `sale_items`** vor dem Zählen.
- **Fremdschlüssel beim Löschen eines Verkaufs:**
  - `sale_items`, `sale_fees`, `sale_refunds`, `orderbook_audit`: **`on delete cascade`** (0059, 0062).
  - `order_reservations.sale_item_id`: **`on delete cascade`** (0109).
  - `sale_items.movement_id` und `return_movement_id` → `inventory_movements`: `on delete restrict`. Das bremst **nicht**, denn die Bewegung bleibt einfach stehen.
  - `sale_item_corrections` (0181), `sales_recon_matches` und `sales_recon_applications` (0169): **`on delete restrict`**. Verkäufe mit Korrekturen oder mit Abgleich-Spuren sind nicht löschbar.
- **Löschschutz der Reservierungen:** `reservations_deny_delete` (0109). Ein Cascade auf eine Reservierung ist **nur** erlaubt, wenn sie `released` ist und weder `movement_id` noch `reverted_movement_id` trägt. **Ein aktiver oder umgewandelter Hold lässt das ganze Löschen scheitern** (Rollback).

### 2.2 Gegenspieler und ihre Sperrreihenfolge [NACHGEWIESEN]

| Funktion | Reihenfolge der Sperren |
|---|---|
| `seller_book_sale_item` (0110) | **Position** `for update` → Hold umwandeln (Reservierung) → `record_inventory_movement` (Lager) → `update sale_items` → **`update sales`** (Zeilensperre am Schluss). Liest `sales` vorher **ohne** Sperre |
| `seller_remove_sale_item` (0110) | Position `for update`, verweigert gebuchte Positionen |
| `seller_cancel_external_sale` (0170) | **Verkauf** `for update` → prüft gebuchte Positionen **ohne** Positionssperre → gibt Holds frei (Reservierung). Version **optional** (`default null`) |
| `seller_delete_sale` (0110) | **keine** auf Verkauf oder Position → Reservierung (je Hold) → beim `delete` die Zeile des Verkaufs, danach per Cascade die Positionen |

Die Reihenfolgen sind **nicht einheitlich**. Buchen geht von der Position zum Verkauf, Storno vom Verkauf zur Reservierung, Löschen von der Reservierung zum Verkauf.

### 2.3 Der konkrete Ablauf [ABGELEITET]

**Löschen gegen Buchen, Position ohne Hold:**

1. T1 `seller_book_sale_item(item)`: sperrt die Position, schreibt die Lagerbewegung (−1), setzt `movement_id`, aktualisiert `sales` und hält damit die Zeilensperre. **Noch kein Commit.**
2. T2 `seller_delete_sale(sale)`: Das Zählen sieht T1 nicht (READ COMMITTED) und kommt auf 0 gebuchte Positionen. Es gibt keinen Hold, also keine Wartezeit. `delete from sales` **wartet** auf die Zeilensperre von T1.
3. T1 committet. T2 prüft die Zeile neu (sie passt weiter), **löscht den Verkauf**, und der Cascade löscht die jetzt gebuchte Position.
4. **Ergebnis:** eine `sale_external`-Bewegung ohne Verkauf und ohne Position. Der Bestand ist dauerhaft um 1 gesunken, ohne dass ein Beleg dazu existiert. Es gibt **keine** doppelte Rückbuchung, denn das Löschen bucht nie zurück. Es fehlt eine.

**Mit Hold:** Die Buchung wandelt den Hold um (`movement_id` gesetzt). Beim Cascade wirft `reservations_deny_delete`, das Löschen wird zurückgerollt, **alles bleibt konsistent**. Seit 0184 ist der Hold der Standard. Ohne Hold sind Verkäufe, die mit `p_hold = false` angelegt wurden, Legacy-Verkäufe und Positionen, die vor den Holds entstanden.

**Weitere Abläufe:**

- **Löschen gegen Hinzufügen mit Hold:** Eine neue Position mit aktivem Hold nach der Freigabe-Schleife lässt den Cascade am Trigger scheitern. Das Löschen bricht ab: **sicher**.
- **Löschen gegen Löschen:** Die Reservierungssperre serialisiert. Der zweite Lauf löscht 0 Zeilen ohne Fehler: **sicher**.
- **Storno gegen Buchen [ABGELEITET]:** Der Storno sperrt den Verkauf und prüft „keine gebuchte Position“, während die Buchung die Position schon gesperrt, aber noch nicht committet hat. Zwei mögliche Ausgänge:
  - (a) ohne Hold: Der Storno committet, danach committet die Buchung (ihr `update sales` wartet nur). Ergebnis: **ein stornierter Verkauf mit gebuchter Position**. Das widerspricht der Regel „storniert = nichts hat das Regal verlassen“.
  - (b) mit Hold: Die Buchung hält die Reservierung und will den Verkauf, der Storno hält den Verkauf und will die Reservierung. Ergebnis: **Deadlock**. PostgreSQL bricht einen Aufruf ab, es entsteht keine Inkonsistenz.

### 2.4 Bewertung

- **Reproduzierbar?** Konstruierbar mit zwei Verbindungen und einer festen Verschränkung, wie in den bestehenden `concurrency-018x`-Tests. Beobachtet oder reproduziert wurde sie bisher **nicht** [UNSICHER: kein Lauf].
- **Erreichbarkeit:**
  - **Kein UI-Pfad** ruft `seller_delete_sale` oder `seller_cancel_external_sale` auf. Gesucht in `src/`.
  - Aufrufer sind nur `tools/ui-fixtures-ship-day.mts` und `tools/verify-ship-and-day.mts`, beide Staging-Fixtures.
  - Möglich bleibt ein direkter RPC-Aufruf eines angemeldeten Betreibers (`authenticated`) gegen PostgREST, gleichzeitig mit einer Buchung.
  - Deshalb **P2**: echt, aber selten erreichbar.
- **Erkennbarkeit:** Eine verwaiste `sale_external`-Bewegung ist per Abfrage auffindbar: Bewegung mit Grund `sale_external` und ohne `sale_items.movement_id`. Eine solche Prüfung existiert in `supabase/checks/` **nicht** [NACHGEWIESEN per Suche].

### 2.5 Vorschlag (minimalinvasiv, Migration)

Neue Fassung von `seller_delete_sale`; **die Geschäftsregeln bleiben unverändert**:

1. **Zuerst die Positionen des Verkaufs sperren** (`select … from sale_items where sale_id = p_id order by id for update`). Das ist dieselbe Sperre, die `seller_book_sale_item` zuerst nimmt. Eine laufende Buchung wird abgewartet, und das anschließende Zählen sieht ihr Ergebnis.
2. **Dann den Verkauf sperren** (`select … from sales where id = p_id for update`). So lautet die Reihenfolge wie beim Buchen: Position vor Verkauf. Das vermeidet einen neuen Deadlock.
3. Danach wie bisher: zählen, Holds freigeben, löschen.

`seller_cancel_external_sale` bekommt dieselbe Positionssperre vor der Prüfung „keine gebuchte Position“ (Position vor Verkauf). Außerdem ist zu entscheiden, ob die Version **Pflicht** werden soll; heute ist sie optional. **Keine Signaturänderung** ohne eigene Entscheidung: Beide Funktionen haben keine UI-Aufrufer, und die Werkzeuge rufen sie ohne Version.

Optional, ohne Migration: eine Prüfdatei `supabase/checks/…_orphan_sale_movements.sql`, die verwaiste `sale_external`-Bewegungen zählt. Sie würde zeigen, ob die Race je eingetreten ist.

---

## 3. Aufgabe 2: `admin_set_shop_policies`

### 3.1 Befund [NACHGEWIESEN]

- **Definition:**
  - 0040 legte die Funktion mit 10 Parametern an, mit `revoke all … from public` und `grant … to authenticated`.
  - **0041** (Zeile 1385–1388) `drop function` und `create or replace` mit **neuer Signatur** (9 Parameter: `text, text, text, boolean, boolean, text, text, text, numeric`), **ohne** `revoke` oder `grant`.
  - Die Rechte aus 0040 galten nur für die alte Signatur.
- **`security definer`, `search_path = ''`.** Die erste Anweisung ist `if not public.can_operate_active_seller() then raise …`.
- **Staging (Dump vom 2026-11-09):** `GRANT ALL ON FUNCTION … TO anon`, `TO authenticated`, `TO service_role`, **kein `REVOKE … FROM PUBLIC`**.
  - Ursache: Die Standardrechte von PostgreSQL (EXECUTE für PUBLIC) und die Supabase-Standardrechte auf neue Funktionen in `public` greifen, weil 0041 die Rechte nicht neu setzt.
  - **Production:** Den Stand habe ich nicht gemessen. Weil 0041 dort ebenfalls lief und keine spätere Migration die Funktion anfasst, ist er **sehr wahrscheinlich gleich** [ABGELEITET].
- **Aufrufer:** genau einer, `src/lib/admin/actions.ts` (`setShopPolicies` über `call()`). Er läuft als angemeldeter Betreiber, also `authenticated`. Keine andere Funktion ruft sie.
- **Der ganze Bestand im Staging-Schema:**
  - `admin_set_shop_policies` ist die **einzige aufrufbare, schreibende Nicht-Trigger-Funktion** ohne `REVOKE … FROM PUBLIC`.
  - Die übrigen Funktionen ohne Revoke sind Triggerfunktionen. Diese lassen sich nicht direkt aufrufen.
  - Dazu kommen zwei reine Lesehilfen: `orderbook_normalise` und `sale_item_is_closed`.
- **Die eingefrorene Liste in `src/lib/commerce/revoke-coverage.test.ts`** führt neun Funktionen als „ungeprüft“. Laut Staging-Schema sind **acht davon längst korrekt** (`FROM PUBLIC`, nur `authenticated` und `service_role`): `admin_platform_settings`, `seller_set_sale_date`, `seller_set_sale_payout`, `seller_update_sale`, `seller_create_purchase`, `seller_create_sale`, `seller_orderbook_ledger`, `seller_sales`. **Nur `admin_set_shop_policies` ist eine echte Lücke.**

### 3.2 Antworten

1. **Warum hat anon EXECUTE?** Weil 0041 die Funktion neu anlegt, ohne ihre Rechte neu zu setzen.
2. **Ist der Grant nötig?** **Nein.** Der einzige Aufrufer ist `authenticated`.
3. **Unerwünschte Effekte eines anonymen Aufrufs?**
   - **Keine Schreibwirkung.** Die Rollenprüfung ist die erste Anweisung und wirft, bevor irgendetwas gelesen oder geschrieben wird.
   - Ein anonymer Aufrufer kann nur einen Fehler erzeugen. Er sieht dabei die Fehlermeldung „seller operator role required“ und erfährt so, dass die Funktion existiert.
   - Das Risiko ist **zukünftig**: Würde der Funktionskörper je so geändert, dass vor der Prüfung etwas passiert, wäre es sofort öffentlich.
4. **Erforderlich:** `EXECUTE` für `authenticated`. `service_role` folgt dem Muster der übrigen Admin-Funktionen (Supabase-Standard, kein Aufrufer). Kein `anon`, kein `PUBLIC`.

### 3.3 Vorschlag (Migration)

```sql
revoke all on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)
  from public, anon;
grant execute on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)
  to authenticated;
```

`service_role` behält sein Recht; es wird nicht entzogen, das entspricht dem Muster. Nebenbei fällt auf: Der Parameter `p_free_shipping_threshold` wird angenommen, aber nicht verwendet [NACHGEWIESEN]. Das ist eine **eigene fachliche Frage** und nicht Teil dieser Bereinigung.

---

## 4. Aufgabe 3: Revalidierung der Settings-Actions

### 4.1 Befund [NACHGEWIESEN]

| Action (`src/lib/admin/actions.ts`) | Formular, Seite | revalidiert heute | fehlt | Formular lädt selbst nach? |
|---|---|---|---|---|
| `setShopPercentage` | `shop-settings.tsx` auf **`/business/offers`** | `/admin`, `/business/inventory`, `/`, `/cart` | `/business/offers`, `/shop`, `/zubehoer`, `/favoriten` (Preise) | ja (`router.refresh`) |
| `setCommerceMode` | `commerce-panel.tsx` auf **`/business/offers`** | `/admin`, `/checkout`, `/cart` | `/business/offers`, `/shop` | **nein** |
| `setShippingCountry` | `shop-profile-panel.tsx` auf **`/business/shipping`** und `/business/legal` | `/admin`, `/checkout` | `/business/shipping`, `/business/legal`, `/cart` | **nein** |
| `setShopPolicies` | `shop-profile-panel.tsx`, dito | `/admin`, `/checkout`, `/cart` | `/business/shipping`, `/business/legal`, `/shop` (Versandfreigrenze), `/widerruf` | **nein** |
| `setSellerDetails` | `shop-profile-panel.tsx`, dito | `/admin`, `/business/legal` | `/business/shipping` | **nein** |

- Keines der Formulare steht noch unter `/admin` (ADR-0077). Die `/admin`-Revalidierung ist wirkungslos, aber unschädlich.
- `revalidatePath("/")` ohne `"layout"` erneuert nur die Startseite, keine Unterseiten.
- **Wirkung des Fehlers:** Nach dem Speichern zeigt die Seite des Formulars und andere bereits besuchte Seiten unter Umständen alte Werte, bis sie neu geladen werden. Die Daten selbst sind korrekt gespeichert. **Keine Datenwirkung.** Es ist derselbe Fehler, der beim Händlernamen beobachtet wurde.

### 4.2 Vorschlag

Dieselbe Lösung wie bei `setSellerContact` (2026-11-09): **`revalidatePath("/", "layout")`** statt der einzelnen Pfadlisten, für alle fünf Actions.

- Die Einstellungen ändern sich selten, und alle betroffenen Seiten sind ohnehin dynamisch. Eine vollständige Liste von Unterseiten wäre fehleranfällig und würde beim nächsten neuen Ort wieder veralten.
- `/admin` ist darin eingeschlossen; daraus folgt keine Änderung für `/admin`.
- Bei `commerce-panel.tsx` und `shop-profile-panel.tsx` zusätzlich `router.refresh()` nach Erfolg, wie in `shop-settings.tsx` und `seller-settings.tsx`.

Eine **Migration ist nicht nötig.**

---

## 5. Teststrategie (gezielt, ohne vollständige Suite)

| Ziel | Werkzeug | Test |
|---|---|---|
| Löschen gegen Buchen, Storno gegen Buchen | **echtes PostgreSQL mit zwei Verbindungen**, nach dem Muster `src/lib/reconciliation/pg/concurrency-018x.test.ts` (`RECON_REAL_PG=1`, Wegwerf-Cluster). Welt aus `src/lib/reconciliation/sql/create-sale-world.ts` (hat schon `seller_book_sale_item` und `convert_sale_item_hold`), ergänzt um `seller_delete_sale`, `release_sale_item_hold`, `seller_cancel_external_sale` und `reservations_deny_delete` wortgleich aus den Migrationen | (1) **vorher rot:** T1 bucht ohne Hold und wartet, T2 löscht, T1 committet. Mit der alten Fassung bleibt eine verwaiste Bewegung (Nachweis der Race). (2) **nachher grün:** T2 wartet auf die Positionssperre und verweigert dann („has 1 item(s) with stock movements“); Bestand und Bewegungen stimmen. (3) mit Hold: Das Löschen scheitert am Trigger, wie heute. (4) Storno gegen Buchen: entweder Storno verweigert oder Buchung verweigert, nie beides durch. (5) **kein Deadlock** bei vertauschter Startreihenfolge (Ablauf über `pg_stat_activity`-Warten, wie in `concurrency-0186`) |
| Bestandskonsistenz | dieselbe Welt | Summe der Bewegungen = `shop_inventory.quantity`, `reserved` unverändert nach Freigabe. Keine Bewegung ohne Position |
| Keine doppelte Rückbuchung | PGlite | Zweimal löschen ergibt einen Lauf, der zweite löscht 0 Zeilen. `reserved` sinkt genau einmal |
| Rechte von `admin_set_shop_policies` | statisch und PGlite | Die neue Migration nennt `revoke … from public, anon` und `grant … to authenticated` mit der exakten Signatur. `revoke-coverage.test.ts`: Die eingefrorene Liste schrumpft auf **0** offene Lücken (die acht gelösten mit Beleg entfernen, diese eine mit der neuen Migration). PGlite mit Rollen: `has_function_privilege('anon', …)` = false, `authenticated` = true. `set role anon` und Aufruf → `42501` |
| Autorisierter Admin-Aufruf | PGlite (Stub `can_operate_active_seller` = true als `authenticated`) | Die Policies werden geschrieben. Ohne Betreiberrolle kommt `seller operator role required` |
| Nachweis auf Staging (nach Anwendung) | Postflight-Prüfdatei, lesend | `has_function_privilege` für anon/authenticated/service_role; `db:privileges:staging` unverändert |
| Revalidierung | Vitest mit `vi.mock("next/cache")`, Muster `src/lib/admin/seller-name-refresh.test.ts` | Jede der fünf Actions ruft `revalidatePath("/", "layout")` nach Erfolg und nichts bei Ablehnung. Die zwei Formulare rufen `router.refresh()` |

---

## 6. Migrationsstrategie

- **Letzte Migration:** `0186_recon_order_ref_with_exclusions.sql`. `0177` ist reserviert (siehe `APPLIED.md`). **Nächste Nummern: 0187, 0188.**
- **Angewendete Migrationen bleiben unverändert.** 0041 und 0110 werden nicht angefasst, die Korrekturen kommen als neue Dateien.
- **M-05B → `0187_revoke_shop_policies_public.sql`:** nur `revoke` und `grant`, idempotent. Dazu Preflight und Postflight, Rollback (`grant … to anon` wiederherstellen), Prüfsumme und Operationsdatei, über `db:migrate:staging`.
- **M-05C → `0188_sale_delete_lock_order.sql` und `0189_external_cancel_lock_order.sql`** (zur Aufteilung siehe Production): `create or replace` von `seller_delete_sale` und `seller_cancel_external_sale` mit **unveränderter Signatur**, die Rechte werden ausdrücklich neu gesetzt (Lehre aus 0041). Rollback: die Fassungen aus 0110 und 0170 wortgleich.
- **Staging:** beide in Reihenfolge 0187, 0188, jeweils mit eigener Freigabe.
- **Production (Stand 0167):**
  - Beide Korrekturen hängen **nicht** an 0168–0186. 0041 und 0110 sind dort angewendet. **0170 nicht**: Laut `APPLIED.md` liegt 0170 nur auf Staging, also gibt es `seller_cancel_external_sale` auf Production **nicht** [NACHGEWIESEN].
  - Sie wären **einzeln** anwendbar, außerhalb der Nummernfolge. Das ist eine bewusste Ausnahme und braucht eine **eigene Production-Freigabe** mit eigener Zeile im Production-Teil von `APPLIED.md`.
  - Weil 0170 auf Production fehlt, muss 0188 **aufgeteilt** werden: `0188` ersetzt nur `seller_delete_sale` und ist auf beiden Umgebungen anwendbar; `0189` ersetzt `seller_cancel_external_sale` und kommt nur auf Staging, bis 0170 auf Production ausgerollt ist. Die andere Möglichkeit, eine Existenzprüfung in einer gemeinsamen Datei, ist weniger durchsichtig und wird nicht empfohlen.
  - Keine automatische Ausführung. Production weiter nur über den manuellen Ablauf.

---

## 7. Verbleibende Risiken und Unsicherheiten

- Die Race ist **abgeleitet**, nicht ausgeführt. Der Real-PG-Test aus Abschnitt 5 soll sie zuerst **rot** zeigen, bevor die Korrektur kommt.
- Der Production-Stand der Rechte ist **nicht gemessen**, er gilt nur als wahrscheinlich gleich.
- `seller_cancel_external_sale`: Ob die Version Pflicht werden soll, ist eine fachliche Entscheidung.
- `p_free_shipping_threshold` wird nicht verwendet, eine eigene Frage.
- Ein Supabase-Standard bleibt: Jede **neue** Funktion in `public` bekommt `anon`. Ein projektweites `alter default privileges … revoke execute … from anon, public` wäre die zweite Sicherung, eine **eigene Entscheidung** (Audit M-27 aus Stability Baseline 1).

---

## 8. Empfohlene Reihenfolge

| Schritt | Inhalt | Migration | Aufwand |
|---|---|---|---|
| **M-05A** | Revalidierung der fünf Settings-Actions (`"/", "layout"`) und `router.refresh()` in zwei Formularen, mit Tests | **nein** | klein |
| **M-05B** | `0187`: `admin_set_shop_policies` ohne PUBLIC und anon. `revoke-coverage.test.ts` auf 0 offene Lücken, mit Belegen. Staging, später Production gesondert | **ja**, klein | klein |
| **M-05C** | erst der Real-PG-Test (rot), dann `0188` (Löschen) und `0189` (Storno, nur Staging) mit der Sperrreihenfolge Position vor Verkauf, dann grün. Optional die Prüfdatei für verwaiste `sale_external`-Bewegungen | **ja** | mittel |

**Begründung:** Zuerst das Risikoärmste ohne Migration. Dann die kleine Rechte-Bereinigung, die einen echten Regelbruch schließt. Zuletzt die Race: Sie ist schwer erreichbar, braucht aber den größten Testaufwand und eine fachliche Entscheidung zur Version.

---

## 9. Umsetzung M-05A (2026-11-10, nicht committet)

**Strategie: eng statt global.** Jede der fünf Actions revalidiert die Seite(n) ihres Formulars und jede Seite, die den Wert nachweislich liest. Ermittelt habe ich das über die Datenabfragen in `src/app`. Es gibt bewusst **kein** `revalidatePath("/", "layout")`: Ein Speichern in den Einstellungen soll nicht jeden zwischengespeicherten Stand verwerfen. Jeder bisher revalidierte Pfad bleibt erhalten, `/admin` eingeschlossen.

| Action | neu revalidiert (zusätzlich zu bisher) |
|---|---|
| `setShopPercentage` | `OFFER_PAGES`: `/shop`, `/zubehoer`, `/favoriten`, `/checkout`, `/business/offers` (Formular), `/(public)/skylanders/[slug]` und `/(public)/zubehoer/[slug]` (Seitenmuster), dazu wie bisher `/`, `/cart`, `/business/inventory` |
| `setCommerceMode` | `/business/offers` (Formular). Bisher schon: `/checkout` (Freigabe der Kasse) und `/cart` |
| `setShippingCountry` | `SHOP_PROFILE_PAGES`: `/business/legal`, `/business/shipping` (Formular), dazu `/versand` (Versandtabelle) |
| `setShopPolicies` | `SHOP_PROFILE_PAGES`. Bisher schon: `/checkout`, `/cart` |
| `setSellerDetails` | `/business/shipping` (dasselbe Formular wie auf `/business/legal`) |

**Technisch:**

- `call()` nimmt jetzt neben festen Pfaden auch Seitenmuster mit Typ (`RevalidationTarget`). Next 16 verlangt den Typ bei dynamischen Segmenten.
- Die Policy- und Rechtsfelder erscheinen außerhalb des Formulars nirgends. Die Rechtsseiten lesen Konstanten, und Rechnungen frieren ihre Werte beim Ausstellen ein. Deshalb gibt es für sie keine weiteren Pfade.
- **`router.refresh()` ist nicht ergänzt.** `revalidatePath` aus einer Server Action aktualisiert die gerade angezeigte Seite sofort, wenn sie in der Liste steht (Next-16-Doku, `revalidatePath`). Die Seiten beider Formulare stehen jetzt darin. Ein Test hält fest, dass `commerce-panel` und `shop-profile-panel` auf Seiten liegen, die ihre Actions revalidieren.

**Tests:**

- Neu ist `src/lib/admin/settings-revalidation.test.ts` mit **36 Tests**. Für alle fünf Actions:
  - Formularseite und lesende Seiten werden revalidiert,
  - `/admin` bleibt in der Liste,
  - es gibt keinen globalen Purge,
  - lehnt die Datenbank ab, gibt es keine Erfolgsmeldung und keine Revalidierung,
  - fehlt die Berechtigung, gibt es keinen Aufruf und keine Revalidierung,
  - jeder revalidierte Pfad ist eine echte Route oder Seitendatei.
- Angepasst wurde `seller-name-refresh.test.ts`: `setSellerDetails` nennt beide Formularseiten.
- **51 betroffene Testdateien mit 1 671 Tests grün**, `tsc`, `eslint` und `git diff --check` ohne Befund.
- Keine Migration, keine Änderung an Rechten, an `seller_delete_sale` oder an `seller_cancel_external_sale`.

**Status: M-05A ist lokal abgeschlossen.** Noch nicht im Browser geprüft. M-05B und M-05C warten auf Freigabe.
