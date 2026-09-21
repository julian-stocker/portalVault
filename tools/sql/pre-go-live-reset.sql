-- ###########################################################################
-- ##                                                                       ##
-- ##   ONE-TIME — BEREITS AUSGEFÜHRT — DO NOT RUN AGAIN                    ##
-- ##                                                                       ##
-- ##   Staging     2026-09-21  ausgeführt und unabhängig verifiziert       ##
-- ##   Production  2026-09-21  ausgeführt und unabhängig verifiziert       ##
-- ##                                                                       ##
-- ##   Diese Datei ist ein PROTOKOLL, kein Werkzeug. Sie steht hier, damit  ##
-- ##   nachlesbar bleibt, was beim Pre-Go-Live-Cutover genau passiert ist.  ##
-- ##                                                                       ##
-- ##   EIN ZWEITER LAUF WÄRE DATENVERLUST. Ab dem Cutover enthält          ##
-- ##   `inventory_movements` ausschließlich echte operative Bewegungen des  ##
-- ##   laufenden Betriebs. Dieses Skript würde sie alle löschen — und die   ##
-- ##   Gates würden es nicht verhindern, denn sie prüfen auf echtes Geld    ##
-- ##   und auf die Workbook-Historie, nicht auf „schon einmal gelaufen".    ##
-- ##                                                                       ##
-- ##   Der Reset war eine einmalige Ausnahme vor dem Go-Live und ist        ##
-- ##   KEIN Betriebsprozess. Es gibt keinen Anlass, der ihn wiederholt      ##
-- ##   rechtfertigt; ein Bestandsfehler wird mit einer Korrekturbewegung    ##
-- ##   beantwortet, nicht mit einem leeren Ledger (ADR-0103).               ##
-- ##                                                                       ##
-- ###########################################################################
--
-- ===========================================================================
-- EINMALIGER PRE-GO-LIVE-RESET DES OPERATIVEN SHOPS
--
-- Diese Datei liegt bewusst NICHT unter supabase/migrations/ und wird auch
-- nicht dorthin verschoben. Sie ist keine Schemaänderung, sie darf auf einer
-- frischen Datenbank niemals laufen, und sie ist nicht zurücknehmbar. Vor dem
-- Lauf gehörte ein vollständiger Dump — siehe ADR-0103.
--
-- WAS SIE TUT
--
-- Sie entfernt alles, was innerhalb der SkyIsles-Plattform als Test,
-- Entwicklung oder Debugging entstanden ist, und lässt die reale
-- Geschäftshistorie stehen. Der Betreiber hat bestätigt: über SkyIsles gab es
-- bis heute keinen einzigen echten Kauf oder Verkauf. Die realen Vorgänge
-- fanden außerhalb statt, überwiegend auf eBay. Die finale Excel ist die
-- Source of Truth für sämtliche realen historischen Käufe, Verkäufe und
-- Bestände vor dem Go-Live; alles rein innerhalb SkyIsles Entstandene war
-- Test.
--
-- WAS BLEIBT
--
--   Katalog, Serien, Charaktere, Kategorien, Shop-Konfiguration
--   shop_inventory.quantity — unangetastet; die losen Stück sind ab jetzt
--                             die operative Ausgangsbasis
--   legacy_stock_events     — 2 671 Zeilen, die gesamte Vergangenheit
--   purchases/purchase_items, Workbook-sales/sale_items
--   deren sale_fees, sale_refunds, settlement_adjustments
--   inventory_imports + inventory_import_rows — VOLLSTÄNDIG, Zeile für Zeile
--   orderbook_audit zu Workbook-Verkäufen
--   Nutzerkonten und Sammlungen, Tester-Infrastruktur, Telemetrie, Audit
--
-- WAS GEHT
--
--   alle orders samt Kindtabellen, payments, reservations, order_mail,
--     Rechnungen, Widerrufe und Erstattungen
--   alle nicht aus dem Workbook stammenden sales samt Kindzeilen
--   deren orderbook_audit-Zeilen, kontrolliert per ON DELETE CASCADE
--   ALLE inventory_movements — der operative Ledger beginnt bei null
--   die Fixture-Positionen in shop_inventory
--   cart_items, customer_contacts
--
-- WORAN DIE GATES HÄNGEN, UND WORAN NICHT
--
-- Abgebrochen wird ausschließlich bei einem Beleg dafür, dass ECHTES GELD
-- geflossen ist oder dass echte Geschäftshistorie getroffen würde. Nicht
-- abgebrochen wird bei Gast-Checkouts, abgelaufenen LIVE-Modus-Versuchen,
-- Test-Widerrufen oder Settlement-Zeilen an Testverkäufen: das sind
-- Testartefakte, die entfernt gehören, und keine Belege für einen
-- Geschäftsvorgang. Ein Gate, das Testdaten für Geschäftsdaten hält, hält
-- das Skript genau dort an, wo es gebraucht wird.
--
-- Diese Trennung ist gemessen, nicht geraten: auf Staging existieren acht
-- Gast-Checkouts, eine abgelaufene LIVE-Modus-Bestellung und sechs
-- Test-Widerrufe. Keiner davon hat je eine Zahlung ausgelöst.
--
-- WELCHE ZAHLEN HART STEHEN UND WELCHE GEMESSEN WERDEN
--
-- Hart stehen nur die drei Zahlen, die in BEIDEN Umgebungen dieselben sind,
-- weil sie die Geschäftswahrheit sind: 2 671 legacy_stock_events, 292
-- Workbook-Verkäufe, 824 lose reale Stück. Alles Umgebungsabhängige —
-- Fixture-Bestand, Auditzeilen, Importzeilen, Positionszahl, boxed-Bestand —
-- misst dieses Skript zu Beginn in `_reset_expect` und prüft am Ende
-- dagegen. So läuft dieselbe Datei auf Staging und Production, ohne dass
-- jemand Zahlen nachpflegt, und ein unerwarteter Wert bricht trotzdem ab.
--
-- WARUM ZEHN SCHUTZTRIGGER KURZ FALLEN, UND WARUM DAS HIER VERTRETBAR IST
--
-- Neun Tabellen dieses Resets verbieten DELETE per Zeilentrigger. TRUNCATE
-- würde die Trigger umgehen, scheitert aber an den Fremdschlüsseln aus
-- `sale_items` und `order_reservations` — PostgreSQL prüft dort die
-- CONSTRAINT, nicht die Zeilen, und lehnt auch bei leerer Tabelle ab.
-- TRUNCATE ... CASCADE würde `sale_items` mitnehmen, also über tausend Zeilen
-- echter Geschäftshistorie.
--
-- Deshalb: zeilenweises DELETE mit den betroffenen Triggern für die Dauer
-- EINER Transaktion deaktiviert. So bleiben alle Fremdschlüssel scharf und
-- die Löschreihenfolge wird geprüft, statt sie zu umgehen.
--
-- JEDER TRIGGER IST EINZELN BENANNT, nicht `DISABLE TRIGGER USER`. Ein
-- pauschales Abschalten würde auch Trigger treffen, die hier gar nichts zu
-- suchen haben, und niemand könnte später nachlesen, was genau offen war.
-- `session_replication_role = replica` scheidet aus demselben Grund aus: es
-- würde auch die Fremdschlüsselprüfung abschalten, und die ist hier das
-- Sicherheitsnetz.
--
-- Die Liste stammt aus einer vollständigen Trigger-Inventur des Schemas. Nur
-- diese zehn feuern BEFORE DELETE auf einer betroffenen Tabelle; die übrigen
-- hängen an INSERT oder UPDATE und stehen nicht im Weg.
--
-- DIE FREMDSCHLÜSSEL-INVENTUR, aus dem laufenden Schema erhoben
--
-- Auf `inventory_movements` zeigen sechs Fremdschlüssel, alle ON DELETE
-- RESTRICT. Vier davon stehen in Tabellen, die dieser Lauf ohnehin leert
-- (`sale_items` an Testverkäufen, `order_reservations` zweimal) — sie lösen
-- sich durch die Löschreihenfolge. Zwei stehen in Tabellen, die BLEIBEN:
--
--   inventory_import_rows.movement_id   Staging 255, Production 167 Zeiger
--   purchase_items.movement_id          beide 0 — gegated, nicht gelöst
--
-- Auf `sales` zeigt mit `orderbook_audit.sale_id` ein Fremdschlüssel mit ON
-- DELETE CASCADE aus einer BLEIBENDEN Tabelle. Er blockiert nicht, er löscht
-- still mit. Das ist hier gewollt und entschieden: die betroffenen Zeilen
-- protokollieren ausschließlich Korrekturen an Testverkäufen, und künstlich
-- entkoppelte Auditzeilen zu gelöschten Testvorgängen wären schlechter als
-- keine. Das Skript zählt sie vorher und prüft den Restbestand nachher,
-- damit die Kaskade ein gemessener Vorgang ist und keine Überraschung.
--
-- Auf `orders` zeigen zwölf Fremdschlüssel, auf `shop_inventory` drei, auf
-- `payment_attempts` einer, auf `withdrawal_requests` einer (ON DELETE SET
-- NULL). Alle stehen in Tabellen, die dieser Lauf leert.
--
-- WARUM inventory_import_rows.movement_id AUF NULL DARF
--
-- Die Spalte ist nullable, kein Constraint verlangt einen Wert
-- (`inventory_import_rows_ignored_is_inert` verlangt im Gegenteil NULL für
-- ignorierte Zeilen, `..._supported_has_target` nennt sie gar nicht), die
-- Tabelle trägt keinen einzigen Trigger, nur `apply_inventory_import`
-- schreibt sie, und kein View, keine Funktion und kein Anwendungscode liest
-- sie je. Jede Importzeile behält Blatt, Quellzeile, Rohname,
-- Klassifikation, SKY-ID, Zustand, Vorher-/Soll-Menge, Delta, Status und
-- Notiz. Verloren geht ausschließlich der technische Zeiger auf eine
-- Ledger-Zeile, die es nach dem Cutover nicht mehr gibt. Der Status bleibt
-- das unterscheidende Feld: `applied` heißt weiterhin angewandt, auch ohne
-- Zeiger.
--
-- Die aufgelöste Verknüpfung wird beim Lauf protokolliert — Schritt 5 gibt
-- pro Importlauf die Zahl der gelösten Zeiger und den betroffenen
-- Movement-Id-Bereich als NOTICE aus. Diese Ausgabe gehört ins
-- Cutover-Protokoll.
--
-- DAS IST DIE EINE AUSNAHME. Ein zweiter Lauf dieser Art wäre keine Ausnahme
-- mehr, sondern eine Gewohnheit — und append-only hieße dann nichts mehr.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Der Merkzettel dieses Laufs.
--
--    Was hier zu Beginn hineingeschrieben wird, prüft Schritt 9 am Ende
--    dagegen. `on commit drop`: die Tabelle überlebt die Transaktion nicht,
--    ein Rollback lässt also auch keine Spur zurück.
-- ---------------------------------------------------------------------------
create temporary table _reset_expect (
  key   text primary key,
  value bigint not null
) on commit drop;

-- ---------------------------------------------------------------------------
-- 1. ABBRUCHKRITERIEN — nur echtes Geld und echte Historie.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  -- 1a. Die Zahlung selbst. Die Welt einer Stripe-Sitzung steht in ihrer Id
  --     und ist von uns nicht fälschbar.
  select count(*) into v_n from public.payment_attempts
   where coalesce(provider_payment_id, '') like 'cs_live_%';
  if v_n > 0 then raise exception 'ABBRUCH: % LIVE-Stripe-Sitzung(en)', v_n; end if;

  -- 1b. Eine im LIVE-Modus jemals bezahlte Bestellung. Ein abgelaufener
  --     LIVE-Versuch ohne Zahlung ist dagegen ein Test und darf gehen.
  select count(*) into v_n from public.orders
   where commerce_mode <> 'sandbox'
     and payment_status in ('paid', 'refunded', 'partially_refunded');
  if v_n > 0 then raise exception 'ABBRUCH: % bezahlte Bestellung(en) im LIVE-Modus', v_n; end if;

  -- 1c. Geld, das zurückgeflossen ist.
  select count(*) into v_n from public.order_refunds;
  if v_n > 0 then raise exception 'ABBRUCH: % Erstattung(en) vorhanden', v_n; end if;

  -- 1d. RECHNUNGEN. Eine ausgestellte Rechnung ist ein Steuerdokument; sie
  --     zu entfernen ist nur zulässig, wenn sie zu einem Testvorgang gehört.
  --     Jede Rechnung muss an einer Sandbox-Bestellung hängen, die dieser
  --     Lauf ohnehin entfernt — und an keiner Bestellung mit LIVE-Sitzung.
  select count(*) into v_n
    from public.invoices i
    left join public.orders o on o.id = i.order_id
   where o.id is null
      or o.commerce_mode <> 'sandbox';
  if v_n > 0 then raise exception 'ABBRUCH: % Rechnung(en) ohne Sandbox-Bestellung', v_n; end if;

  select count(*) into v_n
    from public.invoices i
   where exists (
     select 1 from public.payment_attempts a
      where a.order_id = i.order_id
        and coalesce(a.provider_payment_id, '') like 'cs_live_%'
   );
  if v_n > 0 then raise exception 'ABBRUCH: % Rechnung(en) an einer LIVE-Zahlung', v_n; end if;

  -- 1e. Die Geschäftshistorie muss vollständig und unberührt sein.
  select count(*) into v_n from public.legacy_stock_events;
  if v_n <> 2671 then raise exception 'ABBRUCH: legacy_stock_events = %, erwartet 2671', v_n; end if;

  select count(*) into v_n from public.sales where source = 'excel_order_2026';
  if v_n <> 292 then raise exception 'ABBRUCH: Workbook-Verkaeufe = %, erwartet 292', v_n; end if;

  select count(*) into v_n from public.purchases;
  if v_n < 1 then raise exception 'ABBRUCH: keine Einkaufshistorie vorhanden'; end if;

  -- 1f. Der Bestand, der die Cutover-Baseline wird.
  select coalesce(sum(i.quantity), 0) into v_n
    from public.shop_inventory i
   where i.condition = 'loose'
     and (regexp_replace(i.sky_id, '^SKY-', ''))::bigint < 9000;
  if v_n <> 824 then raise exception 'ABBRUCH: loser Realbestand = %, erwartet 824', v_n; end if;

  select coalesce(sum(reserved), 0) into v_n from public.shop_inventory;
  if v_n <> 0 then raise exception 'ABBRUCH: reserved = %, erwartet 0', v_n; end if;

  -- 1g. Kein Workbook-Verkauf darf an einer Bestellung hängen — sonst
  --     würde die Bestellkette Geschäftshistorie mitnehmen.
  select count(*) into v_n from public.sales
   where source = 'excel_order_2026' and order_id is not null;
  if v_n > 0 then raise exception 'ABBRUCH: % Workbook-Verkauf/-Verkaeufe haengen an einer Bestellung', v_n; end if;

  -- 1h. KEIN EINKAUF DARF EINE BEWEGUNG HALTEN. `purchase_items.movement_id`
  --     ist ON DELETE RESTRICT aus einer bleibenden Tabelle. Heute ist die
  --     Spalte in beiden Umgebungen durchgehend leer, und genau das wird hier
  --     geprüft statt vorausgesetzt. Ein Treffer wäre echte Einkaufshistorie
  --     am operativen Ledger — dann hält dieser Lauf an, statt sie zu lösen.
  select count(*) into v_n from public.purchase_items where movement_id is not null;
  if v_n > 0 then
    raise exception 'ABBRUCH: % purchase_item(s) mit movement_id — Einkaufshistorie haengt am Ledger', v_n;
  end if;

  -- 1i/1j. Dasselbe für die Workbook-Verkäufe. Das Legacy-Settlement hat
  --        bewusst keine Bewegung gebucht; wäre das je passiert, ist es
  --        Geschäftshistorie und kein Testartefakt.
  select count(*) into v_n
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where s.source = 'excel_order_2026' and si.movement_id is not null;
  if v_n > 0 then raise exception 'ABBRUCH: % Workbook-sale_item(s) mit movement_id', v_n; end if;

  select count(*) into v_n
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
   where s.source = 'excel_order_2026' and si.return_movement_id is not null;
  if v_n > 0 then raise exception 'ABBRUCH: % Workbook-sale_item(s) mit return_movement_id', v_n; end if;

  raise notice 'Gates bestanden.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1k. Die Messung. Jede Zahl, die am Ende stimmen muss und die zwischen
--     Staging und Production abweicht, wird hier festgehalten — nicht
--     hartkodiert.
-- ---------------------------------------------------------------------------
insert into _reset_expect (key, value)
select 'import_rows_with_movement', count(*) from public.inventory_import_rows where movement_id is not null
union all select 'inventory_imports', count(*) from public.inventory_imports
union all select 'inventory_import_rows', count(*) from public.inventory_import_rows
union all select 'purchases', count(*) from public.purchases
union all select 'purchase_items', count(*) from public.purchase_items
-- Auditzeilen überleben, wenn sie an einem Workbook-Verkauf hängen oder an
-- gar keinem. Alle übrigen nimmt die Kaskade mit — gezählt, nicht geraten.
union all select 'audit_total', count(*) from public.orderbook_audit
union all select 'audit_survivors', count(*) from public.orderbook_audit a
   where a.sale_id is null
      or exists (select 1 from public.sales s where s.id = a.sale_id and s.source = 'excel_order_2026')
union all select 'audit_cascaded', count(*) from public.orderbook_audit a
   where a.sale_id is not null
     and exists (select 1 from public.sales s where s.id = a.sale_id and s.source <> 'excel_order_2026')
-- Die Kindzeilen der Workbook-Verkäufe, die stehen bleiben müssen.
union all select 'sale_items_keep', count(*) from public.sale_items si
   join public.sales s on s.id = si.sale_id where s.source = 'excel_order_2026'
union all select 'sale_fees_keep', count(*) from public.sale_fees f
   join public.sales s on s.id = f.sale_id where s.source = 'excel_order_2026'
union all select 'sale_refunds_keep', count(*) from public.sale_refunds r
   join public.sales s on s.id = r.sale_id where s.source = 'excel_order_2026'
-- Settlement-Zeilen ohne `sale_id` trifft das Join-DELETE nicht; sie zählen
-- deshalb zu den Überlebenden.
union all select 'settlement_keep', count(*) from public.settlement_adjustments a
   where a.sale_id is null
      or exists (select 1 from public.sales s where s.id = a.sale_id and s.source = 'excel_order_2026')
-- Bestand und Positionen.
union all select 'inventory_rows_keep', count(*) from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint < 9000
union all select 'fixture_rows', count(*) from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000
union all select 'fixture_units', coalesce(sum(quantity), 0) from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000
union all select 'real_boxed', coalesce(sum(quantity), 0) from public.shop_inventory
   where condition = 'boxed' and (regexp_replace(sky_id, '^SKY-', ''))::bigint < 9000;

do $$
declare
  r record;
begin
  for r in select key, value from _reset_expect order by key loop
    raise notice 'gemessen · % = %', rpad(r.key, 26), r.value;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Die zehn Sperren fallen, für die Dauer dieser Transaktion.
--
--    Jede einzeln benannt. Nur BEFORE-DELETE-Trigger auf betroffenen
--    Tabellen; die UPDATE- und INSERT-Wächter bleiben stehen.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements   disable trigger inventory_movements_append_only;
alter table public.invoices              disable trigger invoices_protect_issued_trg;
alter table public.order_addresses       disable trigger order_addresses_append_only;
alter table public.order_events          disable trigger order_events_append_only;
alter table public.order_legal_snapshots disable trigger order_legal_snapshots_protect_trg;
alter table public.order_lines           disable trigger order_lines_append_only;
alter table public.order_mail            disable trigger order_mail_no_delete;
alter table public.order_reservations    disable trigger order_reservations_no_delete;
alter table public.payment_attempts      disable trigger payment_attempts_keep;
alter table public.payment_events        disable trigger payment_events_keep;

-- ---------------------------------------------------------------------------
-- 3. Verkäufe, die nicht aus dem Workbook stammen. Kinder vor Eltern, damit
--    jeder Fremdschlüssel geprüft wird statt umgangen.
--
--    Beim DELETE auf `sales` nimmt `orderbook_audit.sale_id` (ON DELETE
--    CASCADE) die zugehörigen Auditzeilen mit. Das ist die eine gewollte
--    Kaskade dieses Laufs; Schritt 9 prüft den Restbestand gegen die
--    Messung aus 1k.
-- ---------------------------------------------------------------------------
delete from public.sale_items si
 using public.sales s
 where s.id = si.sale_id and s.source <> 'excel_order_2026';

delete from public.sale_fees f
 using public.sales s
 where s.id = f.sale_id and s.source <> 'excel_order_2026';

delete from public.sale_refunds r
 using public.sales s
 where s.id = r.sale_id and s.source <> 'excel_order_2026';

delete from public.settlement_adjustments a
 using public.sales s
 where s.id = a.sale_id and s.source <> 'excel_order_2026';

delete from public.sales where source <> 'excel_order_2026';

-- ---------------------------------------------------------------------------
-- 4. Die Bestellkette. Kinder vor Eltern; `orders` trägt ON DELETE RESTRICT
--    aus zwölf Richtungen, also muss jede davon vorher leer sein.
-- ---------------------------------------------------------------------------
delete from public.withdrawal_requests;
delete from public.order_refunds;
delete from public.invoices;
delete from public.order_legal_snapshots;
delete from public.order_mail;
delete from public.order_events;
delete from public.order_addresses;
delete from public.order_lines;
delete from public.payment_events;
delete from public.payment_attempts;
delete from public.order_reservations;
delete from public.orders;
delete from public.cart_items;
delete from public.customer_contacts;

-- ---------------------------------------------------------------------------
-- 5. Die eine Verknüpfung, die kontrolliert gelöst wird.
--
--    `inventory_import_rows` BLEIBT vollständig — jede Zeile, jeder Inhalt.
--    Nur der Zeiger auf den gleich verschwindenden Ledger wird genullt. Das
--    UPDATE fasst ausschließlich Zeilen mit einem Zeiger an, und die Zahl
--    der tatsächlich geänderten Zeilen muss exakt der vorher gemessenen
--    entsprechen — sonst hat sich zwischen Messung und Ausführung etwas
--    bewegt, und dann bricht dieser Lauf ab.
--
--    Der NOTICE davor ist das Cutover-Protokoll der aufgelösten Verknüpfung:
--    pro Importlauf die Zahl der Zeiger und ihr Movement-Id-Bereich. Diese
--    Ausgabe gehört gesichert.
-- ---------------------------------------------------------------------------
do $$
declare
  r        record;
  v_expect bigint;
  v_rows   bigint;
begin
  select value into v_expect from _reset_expect where key = 'import_rows_with_movement';

  for r in
    select import_id,
           count(*)         as zeiger,
           min(movement_id) as von,
           max(movement_id) as bis
      from public.inventory_import_rows
     where movement_id is not null
     group by import_id
     order by import_id
  loop
    raise notice 'CUTOVER-PROTOKOLL · Import #% · % Zeiger auf inventory_movements % … %',
      r.import_id, r.zeiger, r.von, r.bis;
  end loop;

  update public.inventory_import_rows
     set movement_id = null
   where movement_id is not null;
  get diagnostics v_rows = row_count;

  if v_rows <> v_expect then
    raise exception 'ABBRUCH: % Importzeile(n) geloest, erwartet %', v_rows, v_expect;
  end if;
  raise notice 'Importzeiger geloest: % Zeile(n). Inhalte unveraendert.', v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Der operative Ledger beginnt bei null.
--
--    shop_inventory.quantity wird dabei NICHT angefasst. Die losen Stück
--    bleiben stehen und sind ab jetzt die Cutover-Baseline; die Vergangenheit
--    erklären ausschließlich die legacy_stock_events.
-- ---------------------------------------------------------------------------
delete from public.inventory_movements;

-- ---------------------------------------------------------------------------
-- 7. Fixture-Positionen, und ausschließlich diese. Erst jetzt möglich, weil
--    ihre Bewegungen weg sind und der Fremdschlüssel ON DELETE RESTRICT
--    trägt. Die Grenze ist numerisch (ab SKY-9000), nicht per Namensmuster:
--    eine Zeichenkette wie 'SKY-99' hat hier schon einmal eine Fixture
--    übersehen.
-- ---------------------------------------------------------------------------
delete from public.shop_inventory
 where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000;

-- ---------------------------------------------------------------------------
-- 8. Alle zehn Sperren stehen wieder. Unmittelbar, vor jeder Prüfung.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements   enable trigger inventory_movements_append_only;
alter table public.invoices              enable trigger invoices_protect_issued_trg;
alter table public.order_addresses       enable trigger order_addresses_append_only;
alter table public.order_events          enable trigger order_events_append_only;
alter table public.order_legal_snapshots enable trigger order_legal_snapshots_protect_trg;
alter table public.order_lines           enable trigger order_lines_append_only;
alter table public.order_mail            enable trigger order_mail_no_delete;
alter table public.order_reservations    enable trigger order_reservations_no_delete;
alter table public.payment_attempts      enable trigger payment_attempts_keep;
alter table public.payment_events        enable trigger payment_events_keep;

-- ---------------------------------------------------------------------------
-- 9. Sollzustand. Eine einzige Abweichung rollt alles zurück.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n    bigint;
  v_want bigint;
  v_tbl  text;
begin
  -- 9a. Was leer sein muss. Die Bestellkette vollständig, in derselben
  --     Reihenfolge wie gelöscht, damit keine Tabelle stillschweigend fehlt.
  foreach v_tbl in array array[
    'inventory_movements', 'orders', 'withdrawal_requests', 'order_refunds',
    'invoices', 'order_legal_snapshots', 'order_mail', 'order_events',
    'order_addresses', 'order_lines', 'payment_events', 'payment_attempts',
    'order_reservations', 'cart_items', 'customer_contacts'
  ] loop
    execute format('select count(*) from public.%I', v_tbl) into v_n;
    if v_n <> 0 then raise exception 'SOLL VERFEHLT: % = %', v_tbl, v_n; end if;
  end loop;

  -- 9b. Die Geschäftshistorie, unverändert.
  select count(*) into v_n from public.legacy_stock_events;
  if v_n <> 2671 then raise exception 'SOLL VERFEHLT: legacy_stock_events = %', v_n; end if;

  select count(*) into v_n from public.sales where source = 'excel_order_2026';
  if v_n <> 292 then raise exception 'SOLL VERFEHLT: Workbook-Verkaeufe = %', v_n; end if;

  select count(*) into v_n from public.sales where source <> 'excel_order_2026';
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % Nicht-Workbook-Verkauf/-Verkaeufe uebrig', v_n; end if;

  -- Alles, was exakt so bleiben muss, wie 1k es vorgefunden hat.
  for v_tbl, v_want in
    select t.tbl, t.want from (values
      ('sale_items',             (select value from _reset_expect where key = 'sale_items_keep')),
      ('sale_fees',              (select value from _reset_expect where key = 'sale_fees_keep')),
      ('sale_refunds',           (select value from _reset_expect where key = 'sale_refunds_keep')),
      ('settlement_adjustments', (select value from _reset_expect where key = 'settlement_keep')),
      ('purchases',              (select value from _reset_expect where key = 'purchases')),
      ('purchase_items',         (select value from _reset_expect where key = 'purchase_items')),
      ('inventory_imports',      (select value from _reset_expect where key = 'inventory_imports')),
      ('inventory_import_rows',  (select value from _reset_expect where key = 'inventory_import_rows')),
      ('orderbook_audit',        (select value from _reset_expect where key = 'audit_survivors'))
    ) as t(tbl, want)
  loop
    execute format('select count(*) from public.%I', v_tbl) into v_n;
    if v_n <> v_want then
      raise exception 'SOLL VERFEHLT: % = %, erwartet %', v_tbl, v_n, v_want;
    end if;
  end loop;

  -- 9c. Kein Zeiger auf den gelöschten Ledger ist übrig geblieben.
  select count(*) into v_n from public.inventory_import_rows where movement_id is not null;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % Importzeile(n) mit movement_id', v_n; end if;

  select count(*) into v_n from public.purchase_items where movement_id is not null;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % purchase_item(s) mit movement_id', v_n; end if;

  select count(*) into v_n from public.sale_items
   where movement_id is not null or return_movement_id is not null;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % sale_item(s) mit Movement-Referenz', v_n; end if;

  -- 9d. Der Bestand. Die losen realen Stück sind die Cutover-Baseline und
  --     dürfen sich durch diesen Lauf um kein Stück verändert haben.
  select count(*) into v_n from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % Fixture-Position(en) uebrig', v_n; end if;

  select count(*) into v_n from public.shop_inventory;
  select value into v_want from _reset_expect where key = 'inventory_rows_keep';
  if v_n <> v_want then raise exception 'SOLL VERFEHLT: shop_inventory = %, erwartet %', v_n, v_want; end if;

  select coalesce(sum(quantity), 0) into v_n from public.shop_inventory
   where condition = 'loose' and (regexp_replace(sky_id, '^SKY-', ''))::bigint < 9000;
  if v_n <> 824 then raise exception 'SOLL VERFEHLT: loser Realbestand = %', v_n; end if;

  select coalesce(sum(quantity), 0) into v_n from public.shop_inventory
   where condition = 'boxed' and (regexp_replace(sky_id, '^SKY-', ''))::bigint < 9000;
  select value into v_want from _reset_expect where key = 'real_boxed';
  if v_n <> v_want then raise exception 'SOLL VERFEHLT: boxed Realbestand = %, erwartet %', v_n, v_want; end if;

  select coalesce(sum(reserved), 0) into v_n from public.shop_inventory;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: reserved = %', v_n; end if;

  -- 9e. Kein Kind ohne Elternteil. Jeder eingehende Fremdschlüssel auf eine
  --     von diesem Lauf berührte Tabelle, einmal gegengeprüft.
  select count(*) into v_n from public.sale_items si
   where not exists (select 1 from public.sales s where s.id = si.sale_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste sale_items', v_n; end if;

  select count(*) into v_n from public.sale_fees f
   where not exists (select 1 from public.sales s where s.id = f.sale_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste sale_fees', v_n; end if;

  select count(*) into v_n from public.sale_refunds r
   where not exists (select 1 from public.sales s where s.id = r.sale_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste sale_refunds', v_n; end if;

  select count(*) into v_n from public.settlement_adjustments a
   where a.sale_id is not null
     and not exists (select 1 from public.sales s where s.id = a.sale_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste settlement_adjustments', v_n; end if;

  select count(*) into v_n from public.orderbook_audit a
   where a.sale_id is not null
     and not exists (select 1 from public.sales s where s.id = a.sale_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste orderbook_audit', v_n; end if;

  select count(*) into v_n from public.purchase_items pi
   where not exists (select 1 from public.purchases p where p.id = pi.purchase_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste purchase_items', v_n; end if;

  select count(*) into v_n from public.inventory_import_rows r
   where not exists (select 1 from public.inventory_imports im where im.id = r.import_id);
  if v_n > 0 then raise exception 'SOLL VERFEHLT: % verwaiste inventory_import_rows', v_n; end if;

  raise notice 'Sollzustand erreicht.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Stehen alle zehn Sperren wieder? Ein Trigger, der nach diesem Lauf aus
--     bliebe, wäre der eigentliche Schaden — schlimmer als jede gelöschte
--     Zeile, weil ihn niemand bemerkt.
-- ---------------------------------------------------------------------------
do $$
declare
  v_off text;
begin
  select string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname)
    into v_off
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgenabled = 'D';
  if v_off is not null then
    raise exception 'SOLL VERFEHLT: deaktivierte Trigger uebrig: %', v_off;
  end if;
  raise notice 'Alle Schutztrigger aktiv.';
end;
$$;

-- Erst nach dieser Zeile ist etwas passiert. Bis dahin: rollback jederzeit.
commit;
