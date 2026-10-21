-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0140
--              (die Betriebssicherung kennt Freigabe, Lieferumfang und USK)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des PRODUCTION-Projekts einfuegen, ausfuehren. Nichts in Teilen:
-- jede Zeile gehoert zur selben Klammer, und ein Fehler irgendwo rollt ALLES
-- zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert — `0132` und `0133` landeten unbeabsichtigt auf
-- Production (`docs/history/2026-10-18-production-0132-0133.md`). Diese
-- Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: bin ich wirklich auf Production?
--   B   Migration 0140, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0140_business_backup_sale_release.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE NICHT TUT
--
--   * Sie fasst KEINE Tabellenzeile an.
--   * Keine Rechteaenderung, keine personenbezogene Spalte kommt dazu.
--
-- SIE SETZT `0139` VORAUS und laeuft als EIGENE Transaktion danach.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck.
--
-- RUECKNAHME: `supabase/rollback/R0140_back_to_0136.sql`.
-- REIHENFOLGE UND STOPP-KRITERIEN: `supabase/checks/production_release_0135_0141.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- ZWEI BEDINGUNGEN, UND BEIDE MUESSEN GELTEN. Eine negative allein waere
-- schwach: „kein Staging" stimmt auch fuer eine leere Datenbank.
--
--   A1  Der STAGING-Stempel fehlt. `SKY-0821` und `SKY-0822` gibt es auf
--       Staging und auf Production bewusst NICHT
--       (`supabase/checks/staging_pending_migrations.sql`, Zeile 101).
--   A2  `0133` ist angewendet. Sie liegt seit dem 2026-10-18 auf Production
--       und fehlt auf Staging — dieselbe Akte, dieselbe Zeile 211. Das ist
--       der POSITIVE Teil: er unterscheidet Production von einer beliebigen
--       anderen Datenbank, die nur den Staging-Stempel nicht hat.
--   A3  Und es ist kein leeres Projekt: der Katalog traegt Zeilen.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 0 then
    raise exception 'ABBRUCH A1: der STAGING-Stempel ist da. Diese Datei ist fuer '
      'Production (zmiwxswrpkmizvqsgype) — auf Staging gehoert die Datei '
      'supabase/operations/staging-0140.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;


-- ---------------------------------------------------------------------------
-- B. Die Migration, unveraendert
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0140_business_backup_sale_release.sql
-- ===========================================================================
-- 0140 — DIE SICHERUNG KENNT DIE VERKAUFSFREIGABE UND DIE USK-KENNZEICHNUNG
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  SIE SETZT `0139` VORAUS. Der Rumpf liest `t.sale_released` und       ##
-- ##  `t.usk_rating`; ohne die beiden Spalten laeuft sie nicht.            ##
-- ###########################################################################
--
-- WARUM ES SIE GIBT. `0139` legt zwei Spalten an, die eine ENTSCHEIDUNG
-- tragen und sich aus nichts anderem rekonstruieren lassen:
--
--   shop_inventory.sale_released   welche Position zum Verkauf freigegeben
--                                  war. Nicht aus `is_listed` ableitbar —
--                                  genau deshalb gibt es sie.
--   shop_inventory.delivery_scope  was im Paket lag. Nicht aus `condition`
--                                  ableitbar — genau deshalb gibt es sie.
--                                  Sie ist eine oeffentliche Produktangabe
--                                  und steht auf jedem Angebot.
--   skylanders.usk_rating          welche Alterskennzeichnung ein Spiel
--                                  traegt. Von Hand erfasst, aus keiner
--                                  Quelle im System ableitbar.
--
-- Eine Betriebssicherung, die beide verliert, gibt nach einer
-- Wiederherstellung einen Shop zurueck, in dem nichts freigegeben ist und
-- kein Spiel eine Kennzeichnung hat — und niemand koennte sagen, wie es
-- vorher war. `src/lib/backup/manifest-gap.test.ts` haelt genau das fest:
-- keine Spalte des Schemas darf unentschieden sein.
--
-- SIE IST EIN EIGENER SCHRITT, wie `0136` nach `0135`. Nicht dieselbe
-- Transaktion: der Beweis von `0139` („nichts hat sich geaendert") soll
-- lesbar bleiben, und beide Ruecknahmen sollen unabhaengig sein.
--
-- WAS SIE TUT: sie schreibt `seller_business_backup()` neu, mit genau drei
-- zusaetzlichen Feldzeilen. 353 Feldzeilen werden 356. Kein Bereich kommt
-- dazu, keiner faellt weg, kein anderes Feld aendert sich — Abschnitt 3
-- nimmt dafuer VOR der Aenderung einen Abdruck ueber die 26 uebrigen
-- Bereiche und vergleicht ihn danach.
--
-- WAS SIE NICHT TUT: sie liest weiterhin nur. Kein `insert`, kein `update`,
-- kein `nextval` — Abschnitt 3 prueft es wie `0131` und `0136`. Keine
-- Rechteaenderung. Keine personenbezogene Spalte kommt dazu; die neun
-- Einkaufsfelder aus Schritt c bleiben AUSDRUECKLICH draussen.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert, NACH `0139`.
-- Ruecknahme: `supabase/rollback/R0140_back_to_0136.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen und der Abdruck der 26 uebrigen Bereiche
-- ---------------------------------------------------------------------------
create temporary table z5_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_def  text;
  v_code text;
begin
  if to_regclass('pg_temp.z5_abdruck') is null then
    raise exception '0140 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'sale_released') then
    raise exception '0140 setzt 0139 voraus: shop_inventory.sale_released fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'usk_rating') then
    raise exception '0140 setzt 0139 voraus: skylanders.usk_rating fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'delivery_scope') then
    raise exception '0140 setzt 0139 voraus: shop_inventory.delivery_scope fehlt';
  end if;

  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if v_def is null then
    raise exception '0140 setzt 0104/0131/0136 voraus: seller_business_backup fehlt';
  end if;

  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  insert into z5_abdruck (schluessel, wert)
  select 'bereiche', (select count(*)::text from anfang)
  union all
  select 'felder', (select count(*)::text from paar)
  union all
  -- Die 26 Bereiche, die diese Datei NICHT anfasst. Aendert sich daran
  -- etwas, ist beim Neuschreiben mehr mitgewandert als zwei Zeilen.
  select 'rest_md5',
         (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
            from paar p where p.bereich not in ('shop_inventory', 'figures'))
  union all
  select 'rest_anzahl',
         (select count(*)::text from paar p
           where p.bereich not in ('shop_inventory', 'figures'));

  if (select wert from z5_abdruck where schluessel = 'bereiche') <> '28' then
    raise exception '0140 Abbruch: % Bereiche statt 28',
      (select wert from z5_abdruck where schluessel = 'bereiche');
  end if;
  if (select wert from z5_abdruck where schluessel = 'felder') <> '353' then
    raise exception '0140 Abbruch: % Feldzeilen statt 353 — die Sicherung ist nicht '
      'die aus 0136', (select wert from z5_abdruck where schluessel = 'felder');
  end if;

  raise notice '0140 Abdruck: 28 Bereiche, % Feldzeilen, davon % ausserhalb der zwei',
    (select wert from z5_abdruck where schluessel = 'felder'),
    (select wert from z5_abdruck where schluessel = 'rest_anzahl');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Sicherung, mit genau zwei zusaetzlichen Feldzeilen
--
--     shop_inventory  'sale_released',  t.sale_released   (hinter is_listed)
--     shop_inventory  'delivery_scope', t.delivery_scope  (dahinter)
--     figures         'usk_rating',     t.usk_rating      (hinter item_type)
--
-- Alles andere ist Zeichen fuer Zeichen die Fassung aus `0136`.
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_backup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with used_figures as (
    /*
     * Die SKY-IDs, die im Backup überhaupt vorkommen. Der
     * Stammdatenschnappschuss beschränkt sich darauf — 605 Katalogzeilen
     * mitzuschicken, von denen die Hälfte nie gehandelt wurde, machte die
     * Datei größer und nicht verständlicher.
     */
    select sky_id from public.shop_inventory
    union select sky_id from public.purchase_items
    union select sky_id from public.sale_items
    union select sky_id from public.order_lines
  )
  select case when not public.can_operate_active_seller() then null else jsonb_build_object(

    /* ---- Metadaten -------------------------------------------------- */
    'format',          'skyisles-business-backup',
    'format_version',  1,
    'created_at',      now(),
    'commerce_mode',   (select s.mode from public.commerce_settings s limit 1),
    'seller_legal_name', (select s.legal_name from public.sellers s limit 1),
    'snapshot_txid',   pg_current_snapshot()::text,
    'inventory_units', (select coalesce(sum(i.quantity), 0) from public.shop_inventory i),
    'buy_in_factor',   public.orderbook_global_factor()::text,
    'contains_personal_data', true,
    'restore_supported',      false,

    /* ---- Die Bereiche ----------------------------------------------- */
    'data', jsonb_build_object(
      'shop_inventory', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'reserved', t.reserved,
          'available_quantity', t.available_quantity,
          'sale_price', t.sale_price::text,
          'is_listed', t.is_listed,
          'sale_released', t.sale_released,
          'delivery_scope', t.delivery_scope,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_inventory t
      ), '[]'::jsonb),
  
      'inventory_movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'inventory_id', t.inventory_id,
          'delta', t.delta,
          'reason', t.reason,
          'unit_cost', t.unit_cost::text,
          'currency', t.currency,
          'note', t.note,
          'created_at', t.created_at,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'purchases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchased_at', t.purchased_at,
          'total_cost', t.total_cost::text,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'platform', t.platform,
          'seller_name', t.seller_name,
          'source', t.source,
          'external_ref', t.external_ref,
          'note', t.note,
          'is_test', t.is_test,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchases t
      ), '[]'::jsonb),
  
      'purchase_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'raw_name', t.raw_name,
          'state', t.state,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'market_price_source', t.market_price_source,
          'movement_id', t.movement_id,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.purchase_items t
      ), '[]'::jsonb),
  
      /* ---------------------------------------------- Eigenbelege (0129) */
      /*
       * DIE DREI BELEGTABELLEN. Sie fehlten bis `0129` ganz — eine
       * Wiederherstellung aus dieser Datei haette jeden Eigenbeleg verloren,
       * samt Nummernkreis und Abrufnachweis.
       *
       * `lines` kommt als ganzes `jsonb` mit: es IST der eingefrorene
       * Snapshot und wird nicht neu aus `purchase_items` gebildet. Genau
       * darin liegt sein Zweck.
       */
      'purchase_receipts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'receipt_number', t.receipt_number,
          'issued_at', t.issued_at,
          'revision', t.revision,
          'supersedes_id', t.supersedes_id,
          'supersedes_number', t.supersedes_number,
          'supersedes_issued_at', t.supersedes_issued_at,
          'format_version', t.format_version,
          'content_fingerprint', t.content_fingerprint,
          'buyer_legal_name', t.buyer_legal_name,
          'buyer_trade_name', t.buyer_trade_name,
          'buyer_street', t.buyer_street,
          'buyer_postal_code', t.buyer_postal_code,
          'buyer_city', t.buyer_city,
          'buyer_country', t.buyer_country,
          'buyer_email', t.buyer_email,
          'buyer_vat_id', t.buyer_vat_id,
          'seller_platform', t.seller_platform,
          'seller_handle', t.seller_handle,
          'sender_name', t.sender_name,
          'sender_street', t.sender_street,
          'sender_postal_code', t.sender_postal_code,
          'sender_city', t.sender_city,
          'sender_country', t.sender_country,
          'listing_ref', t.listing_ref,
          'listing_title', t.listing_title,
          'listing_url', t.listing_url,
          'listing_details', t.listing_details,
          'purchased_at', t.purchased_at,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'total_cost', t.total_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'agreement_note', t.agreement_note,
          'lines', t.lines
        ) order by t.id)
          from public.purchase_receipts t
      ), '[]'::jsonb),
  
      /*
       * DER ABRUFNACHWEIS. Ohne ihn waere nach einer Wiederherstellung nicht
       * mehr belegbar, dass ein Beleg je vollstaendig ausgeliefert wurde —
       * und der gruene Haken in der Oberflaeche haengt daran.
       */
      'purchase_receipt_downloads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'receipt_id', t.receipt_id,
          'delivered_at', t.delivered_at,
          'byte_count', t.byte_count
        ) order by t.id)
          from public.purchase_receipt_downloads t
      ), '[]'::jsonb),
  
      /*
       * DER NUMMERNZAEHLER. Er ist der Grund, warum der Nummernkreis
       * lueckenlos bleibt. Ohne ihn vergaebe eine wiederhergestellte Datenbank
       * Nummern, die es schon gibt — und `receipts_number_unique` schluege
       * beim naechsten Ausstellen zu.
       */
      'purchase_receipt_counters', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', t.year,
          'next_number', t.next_number
        ) order by t.year)
          from public.purchase_receipt_counters t
      ), '[]'::jsonb),
  
      'sales', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'channel', t.channel,
          'order_id', t.order_id,
          'sold_at', t.sold_at,
          'shipped_at', t.shipped_at,
          'destination_country_code', t.destination_country_code,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_charged', t.shipping_charged::text,
          'discount_amount', t.discount_amount::text,
          'reported_payout_amount', t.reported_payout_amount::text,
          'reported_payout_ref', t.reported_payout_ref,
          'reported_payout_at', t.reported_payout_at,
          'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
          'external_order_ref', t.external_order_ref,
          'buyer_ref', t.buyer_ref,
          'note', t.note,
          'source', t.source,
          'is_test', t.is_test,
          'cancelled_at', t.cancelled_at,
          'stock_released_at', t.stock_released_at,
          'sale_day', t.sale_day,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sales t
      ), '[]'::jsonb),
  
      'sale_items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'position', t.position,
          'sky_id', t.sky_id,
          'raw_name', t.raw_name,
          'condition', t.condition,
          'market_price_snapshot', t.market_price_snapshot::text,
          'market_price_snapshot_at', t.market_price_snapshot_at,
          'movement_id', t.movement_id,
          'returned_at', t.returned_at,
          'return_movement_id', t.return_movement_id,
          'settled_at', t.settled_at,
          'not_shipped_at', t.not_shipped_at,
          'return_announced_at', t.return_announced_at,
          'note', t.note,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.sale_items t
      ), '[]'::jsonb),
  
      'sale_fees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'kind', t.kind,
          'label', t.label,
          'amount', t.amount::text,
          'settled_by', t.settled_by,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_fees t
      ), '[]'::jsonb),
  
      'sale_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'amount', t.amount::text,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'created_at', t.created_at
        ) order by t.id)
          from public.sale_refunds t
      ), '[]'::jsonb),
  
      'settlement_adjustments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'channel', t.channel,
          'amount', t.amount::text,
          'reason', t.reason,
          'external_ref', t.external_ref,
          'note', t.note,
          'occurred_at', t.occurred_at,
          'source', t.source,
          'created_at', t.created_at
        ) order by t.id)
          from public.settlement_adjustments t
      ), '[]'::jsonb),
  
      'name_mappings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'normalised_name', t.normalised_name,
          'sky_id', t.sky_id,
          'not_a_figure', t.not_a_figure,
          'sample_raw_name', t.sample_raw_name,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.orderbook_name_mappings t
      ), '[]'::jsonb),
  
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_number', t.order_number,
          'currency', t.currency,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'payment_status', t.payment_status,
          'fulfillment_status', t.fulfillment_status,
          'needs_resolution', t.needs_resolution,
          'placed_at', t.placed_at,
          'paid_at', t.paid_at,
          'shipped_at', t.shipped_at,
          'completed_at', t.completed_at,
          'cancelled_at', t.cancelled_at,
          'updated_at', t.updated_at,
          'tax_regime', t.tax_regime,
          'shipping_method_code', t.shipping_method_code,
          'shipping_method_name', t.shipping_method_name,
          'tracking_number', t.tracking_number,
          'commerce_mode', t.commerce_mode
        ) order by t.id)
          from public.orders t
      ), '[]'::jsonb),
  
      'order_lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'sky_id', t.sky_id,
          'condition', t.condition,
          'quantity', t.quantity,
          'name_snapshot', t.name_snapshot,
          'series_snapshot', t.series_snapshot,
          'unit_price', t.unit_price::text,
          'discount_amount', t.discount_amount::text,
          'line_total', t.line_total::text,
          'inventory_id', t.inventory_id,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_lines t
      ), '[]'::jsonb),
  
      'order_line_events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'order_line_id', t.order_line_id,
          'kind', t.kind,
          'quantity', t.quantity,
          'stock_outcome', t.stock_outcome,
          'movement_id', t.movement_id,
          'correction_movement_id', t.correction_movement_id,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'reason_code', t.reason_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_line_events t
      ), '[]'::jsonb),
  
      'order_reservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'inventory_id', t.inventory_id,
          'quantity', t.quantity,
          'state', t.state,
          'reserved_at', t.reserved_at,
          'expires_at', t.expires_at,
          'released_at', t.released_at,
          'converted_at', t.converted_at,
          'movement_id', t.movement_id,
          'reverted_movement_id', t.reverted_movement_id,
          'sale_item_id', t.sale_item_id,
          'sky_id', inv.sky_id,
          'condition', inv.condition
        ) order by t.id)
          from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
      ), '[]'::jsonb),
  
      'order_refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'amount', t.amount::text,
          'currency', t.currency,
          'occurred_at', t.occurred_at,
          'reason', t.reason,
          'withdrawal_request_id', t.withdrawal_request_id,
          'requested_at', t.requested_at,
          'settled_at', t.settled_at,
          'provider_status', t.provider_status,
          'failure_code', t.failure_code,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_refunds t
      ), '[]'::jsonb),
  
      'order_refund_allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'refund_id', t.refund_id,
          'order_line_id', t.order_line_id,
          'quantity', t.quantity,
          'amount', t.amount::text,
          'allocation_type', t.allocation_type
        ) order by t.id)
          from public.order_refund_allocations t
      ), '[]'::jsonb),
  
      'order_legal_snapshots', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_id', t.order_id,
          'agb_version', t.agb_version,
          'widerruf_version', t.widerruf_version,
          'seller_name', t.seller_name,
          'seller_legal_name', t.seller_legal_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country_code', t.seller_country_code,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'created_at', t.created_at
        ) order by t.order_id)
          from public.order_legal_snapshots t
      ), '[]'::jsonb),
  
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_id', t.order_id,
          'invoice_number', t.invoice_number,
          'issued_at', t.issued_at,
          'seller_legal_name', t.seller_legal_name,
          'seller_trade_name', t.seller_trade_name,
          'seller_street', t.seller_street,
          'seller_postal_code', t.seller_postal_code,
          'seller_city', t.seller_city,
          'seller_country', t.seller_country,
          'seller_email', t.seller_email,
          'seller_vat_id', t.seller_vat_id,
          'customer_name', t.customer_name,
          'customer_company', t.customer_company,
          'customer_street', t.customer_street,
          'customer_postal_code', t.customer_postal_code,
          'customer_city', t.customer_city,
          'customer_country', t.customer_country,
          'customer_email', t.customer_email,
          'items_subtotal', t.items_subtotal::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'total_amount', t.total_amount::text,
          'currency', t.currency,
          'tax_regime', t.tax_regime,
          'lines', t.lines
        ) order by t.id)
          from public.invoices t
      ), '[]'::jsonb),
  
      'monthly_reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'period_year', t.period_year,
          'period_month', t.period_month,
          'commerce_mode', t.commerce_mode,
          'finalized_at', t.finalized_at,
          'order_count', t.order_count,
          'order_value', t.order_value::text,
          'merchandise_amount', t.merchandise_amount::text,
          'shipping_amount', t.shipping_amount::text,
          'discount_amount', t.discount_amount::text,
          'currency', t.currency,
          'paid_count', t.paid_count,
          'unpaid_count', t.unpaid_count,
          'tax_regime', t.tax_regime,
          'included_orders', t.included_orders
        ) order by t.id)
          from public.seller_monthly_reports t
      ), '[]'::jsonb),
  
      'figures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sky_id', t.sky_id,
          'name', t.name,
          'slug', t.slug,
          'series_code', t.series_code,
          'card_type', t.card_type,
          'item_type', t.item_type,
          'usk_rating', t.usk_rating,
          'market_price', t.market_price::text,
          'category_id', t.category_id,
          'is_active', t.is_active,
          'source', t.source
        ) order by t.sky_id)
          from public.skylanders t
         where t.sky_id in (select sky_id from used_figures)
      ), '[]'::jsonb),
  
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'label', t.label,
          'release_year', t.release_year,
          'position', t.position
        ) order by t.code)
          from public.series t
      ), '[]'::jsonb),
  
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'series_code', t.series_code,
          'name', t.name,
          'catalog_group', t.catalog_group,
          'position', t.position
        ) order by t.id)
          from public.categories t
      ), '[]'::jsonb),
  
      'seller', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'display_name', t.display_name,
          'legal_name', t.legal_name,
          'trading_name', t.trading_name,
          'legal_form', t.legal_form,
          'street', t.street,
          'postal_code', t.postal_code,
          'city', t.city,
          'country_code', t.country_code,
          'phone', t.phone,
          'direct_contact', t.direct_contact,
          'register_court', t.register_court,
          'register_number', t.register_number,
          'vat_id', t.vat_id,
          'w_id', t.w_id,
          'small_business_19', t.small_business_19,
          'contact_email', t.contact_email,
          'transactional_reply_to', t.transactional_reply_to,
          'withdrawal_contact_email', t.withdrawal_contact_email,
          'complaints_contact_email', t.complaints_contact_email,
          'dispute_participation', t.dispute_participation,
          'dispute_body', t.dispute_body,
          'dispatch_statement', t.dispatch_statement,
          'return_postage_borne_by', t.return_postage_borne_by,
          'is_active', t.is_active,
          'free_shipping_threshold', t.free_shipping_threshold::text
        ) order by t.id)
          from public.sellers t
      ), '[]'::jsonb),
  
      'shop_settings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'price_percentage', t.price_percentage::text,
          'free_shipping_threshold', t.free_shipping_threshold::text,
          'updated_at', t.updated_at
        ) order by t.id)
          from public.shop_settings t
      ), '[]'::jsonb),
  
      'shipping_methods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'name', t.name,
          'base_price', t.base_price::text,
          'is_enabled', t.is_enabled,
          'sort_order', t.sort_order
        ) order by t.code)
          from public.shipping_methods t
      ), '[]'::jsonb)
    )
  ) end;
$$;

comment on function public.seller_business_backup() is
  'Eine Momentaufnahme der Betriebsdaten als JSON (0104; Eigenbelege in 0129, Kostenteile und Katalogordnung in 0130, Haendlerstammdaten in 0131, Artikeltyp in 0136, Verkaufsfreigabe und Alterskennzeichnung in 0140) — 28 Bereiche in EINER Anweisung und damit aus EINER MVCC-Momentaufnahme. Liest nur. Der Bereich seller traegt seit 0131 die Rechtsangaben, die auf jeder Rechnung stehen, samt is_active: nach einer Wiederherstellung ist damit entscheidbar, welche Zeile der Betrieb ist. Der Bereich figures traegt seit 0136 item_type: der Artikeltyp ist eine eigenstaendige fachliche Eigenschaft und wird bei einer Wiederherstellung abgelesen, nicht aus der Kategorie rekonstruiert. Absender, Inserat und Kaufvereinbarung eines Einkaufs bleiben AUSDRUECKLICH draussen (personenbezogen, offene Aufbewahrungsfrage); Kontoidentitaeten, Zeitstempel der Stammdaten und Zahlungsdienstleister-Interna ebenso. Der Bereich shop_inventory traegt seit 0140 sale_released und der Bereich figures usk_rating: beide sind eigenstaendige Entscheidungen — welche Position zum Verkauf freigegeben war und welche Alterskennzeichnung ein Spiel traegt — und keine von beiden laesst sich aus den uebrigen Feldern rekonstruieren. Kein Restore: restore_supported ist false.';

revoke all on function public.seller_business_backup() from public, anon;
grant execute on function public.seller_business_backup() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_def       text;
  v_code      text;
  v_key       text;
  v_bereiche  integer;
  v_felder    integer;
  v_rest_md5  text;
  v_rest_n    integer;
  v_inv       text;
  v_fig       text;
  v_wer       text := '0140 Abbruch';
begin
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if v_def is null then
    raise exception '0140 unvollstaendig: seller_business_backup fehlt';
  end if;

  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '%: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter', v_wer;
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  select (select count(*) from anfang),
         (select count(*) from paar),
         (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
            from paar p where p.bereich not in ('shop_inventory', 'figures')),
         (select count(*) from paar p
           where p.bereich not in ('shop_inventory', 'figures')),
         (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
            from paar p where p.bereich = 'shop_inventory'),
         (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
            from paar p where p.bereich = 'figures')
    into v_bereiche, v_felder, v_rest_md5, v_rest_n, v_inv, v_fig;

  if v_bereiche <> 28 then
    raise exception '%: % Bereiche statt 28', v_wer, v_bereiche;
  end if;
  if v_felder <> 356 then
    raise exception '%: % Feldzeilen statt 356 (353 aus 0136 plus sale_released, delivery_scope und usk_rating)',
      v_wer, v_felder;
  end if;
  if v_rest_n::text <> (select wert from z5_abdruck where schluessel = 'rest_anzahl') then
    raise exception '%: % Feldzeilen ausserhalb der zwei Bereiche, vorher %',
      v_wer, v_rest_n, (select wert from z5_abdruck where schluessel = 'rest_anzahl');
  end if;
  if v_rest_md5 <> (select wert from z5_abdruck where schluessel = 'rest_md5') then
    raise exception '%: die 26 anderen Bereiche haben sich geaendert', v_wer;
  end if;

  -- Die zwei Bereiche, Feld fuer Feld ausgeschrieben.
  if v_inv <> '''id'', t.id;''sky_id'', t.sky_id;''condition'', t.condition;'
            || '''quantity'', t.quantity;''reserved'', t.reserved;'
            || '''available_quantity'', t.available_quantity;'
            || '''sale_price'', t.sale_price::text;''is_listed'', t.is_listed;'
            || '''sale_released'', t.sale_released;'
            || '''delivery_scope'', t.delivery_scope;''note'', t.note;'
            || '''created_at'', t.created_at;''updated_at'', t.updated_at' then
    raise exception '%: der Bereich shop_inventory ist nicht der erwartete (%)', v_wer, v_inv;
  end if;
  if v_fig <> '''sky_id'', t.sky_id;''name'', t.name;''slug'', t.slug;'
            || '''series_code'', t.series_code;''card_type'', t.card_type;'
            || '''item_type'', t.item_type;''usk_rating'', t.usk_rating;'
            || '''market_price'', t.market_price::text;''category_id'', t.category_id;'
            || '''is_active'', t.is_active;''source'', t.source' then
    raise exception '%: der Bereich figures ist nicht der erwartete (%)', v_wer, v_fig;
  end if;

  -- Und sie schreibt weiterhin nichts (0131, 0136).
  foreach v_key in array array['insert into', 'update public.', 'delete from',
                               'create temp', 'truncate', 'nextval', 'setval',
                               'txid_current()'] loop
    if position(v_key in v_code) > 0 then
      raise exception '%: die Sicherung schreibt (%)', v_wer, v_key;
    end if;
  end loop;

  /*
   * DIE NEUN PERSONENBEZOGENEN FELDER — bereichsgenau, nicht rumpfweit.
   *
   * Wortgleich zu `0130`, `0131` und `0136`. Im Belegsnapshot stehen sie
   * berechtigt, in jedem anderen Bereich waere es ein Befund; rumpfweit
   * gesucht pruefte das nichts.
   */
  foreach v_key in array array[
    '''sender_name''', '''sender_street''', '''sender_postal_code''',
    '''sender_city''', '''sender_country''', '''listing_title''',
    '''listing_url''', '''listing_details''', '''agreement_note'''] loop
    if exists (
      with zeile as (
        select z.nr, z.txt
          from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
      ),
      anfang as (
        select z.nr,
               (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
          from zeile z
         where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
      )
      select 1 from zeile z
       where z.txt ~ ('^ {10}' || v_key || ',')
         and coalesce((select a.name from anfang a
                        where a.nr < z.nr order by a.nr desc limit 1), '')
             <> 'purchase_receipts') then
      raise exception '%: % steht in einem anderen Bereich als purchase_receipts — '
        'personenbezogen und nicht freigegeben', v_wer, v_key;
    end if;
  end loop;

  -- Und die Form der Sicherung ist unveraendert (0131, 0136).
  if (select p.provolatile from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) <> 's' then
    raise exception '%: seller_business_backup muss stable bleiben', v_wer;
  end if;
  if (select p.prosecdef from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) is not true then
    raise exception '%: security definer ist weg', v_wer;
  end if;
  if position('''restore_supported'',      false' in v_code) = 0 then
    raise exception '%: restore_supported ist nicht mehr false', v_wer;
  end if;

  raise notice '0140 ok: 28 Bereiche, 356 Feldzeilen, die 26 uebrigen unveraendert';
end $$;
-- <<< ENDE: supabase/migrations/0140_business_backup_sale_release.sql

commit;
