-- ===========================================================================
-- 0131 — DIE HAENDLERSTAMMDATEN IN DER SICHERUNG (Schritt b)
--
-- `0130` hat die fachlich eindeutigen Luecken geschlossen. Was blieb, ist der
-- Bereich `seller`: 13 von 28 Spalten der Tabelle `sellers` standen im Export,
-- 15 nicht — und darunter die Rechtsangaben, die auf JEDER Rechnung stehen.
--
-- WARUM GETRENNT VON `0130`
--
-- Weil es eine eigene Frage ist: nicht „fehlt eine Spalte", sondern „welche
-- Angaben machen eine Rechnung reproduzierbar". Die Antwort steht im Code und
-- nicht in einer Meinung — `src/lib/admin/shop-profile-model.ts` liest genau
-- diese Felder fuer Impressum, Rechtsseiten und Rechnungsfuss.
--
-- ---------------------------------------------------------------------------
-- WAS DAZUKOMMT (13 Spalten) UND WARUM JEDE
--
--   is_active                 WELCHE Verkaeuferzeile gilt. `0122` stellt den
--                             Eigenbeleg mit `from public.sellers where
--                             is_active limit 1` aus — ohne dieses Feld ist
--                             nach einer Wiederherstellung nicht entscheidbar,
--                             welche Zeile der Betrieb ist.
--   register_court            Registergericht und -nummer: Impressumspflicht,
--   register_number           stehen im Rechnungsfuss.
--   w_id                      Verpackungsregister-Nummer (LUCID).
--   phone                     veroeffentlichte Geschaeftsnummer.
--   direct_contact            der Satz zur unmittelbaren Kommunikation.
--   transactional_reply_to    Absender der Transaktionsmails.
--   withdrawal_contact_email  die Adresse der Widerrufsbelehrung.
--   complaints_contact_email  die Beschwerdeadresse.
--   dispute_participation     Teilnahme an der Streitbeilegung, und
--   dispute_body              die genannte Stelle — beides Rechtsseite.
--   dispatch_statement        die Versandaussage im Shop.
--   return_postage_borne_by   wer das Rueckporto traegt.
--
-- KEINE DATEN DRITTER. Das sind die EIGENEN, veroeffentlichten
-- Geschaeftsangaben des Betriebs: Impressumspflicht, nicht Datenschutz. Die
-- Rechnung traegt sie ohnehin, und `invoices` ist seit `0104` im Export.
--
-- DRAUSSEN BLEIBEN `created_at`, `updated_at` (Zeitstempel einer
-- Stammdatenzeile) und `updated_by` (Kontoidentitaet, wie seit `0104`).
--
-- ---------------------------------------------------------------------------
-- UNVERAENDERT BLEIBT DIE GRENZE ZU SCHRITT c
--
-- Absender, Inserat und Kaufvereinbarung eines Einkaufs stehen weiterhin
-- NICHT im Export. Das ist Name und Anschrift einer PRIVATPERSON, und die
-- Entscheidung darueber haengt an der Datenschutzerklaerung und der
-- Aufbewahrungsfrist — beides offen seit `0122`. Die Nachbedingung unten
-- prueft das ein zweites Mal: diese Migration darf die neun Felder nicht
-- nebenbei mitnehmen.
--
-- Der Rumpf ist der aus `0130`, um 13 Feldzeilen ergaenzt. Eine Anweisung,
-- eine Momentaufnahme. `BACKUP_FORMAT_VERSION` bleibt 1, `restore_supported`
-- bleibt `false`. Keine Tabelle, keine Zeile, kein Recht, kein Trigger.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_fehlt text;
begin
  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0131 setzt 0104 voraus: seller_business_backup fehlt';
  end if;

  -- 0130 muss da sein: die Kostenteile gehoeren in denselben Rumpf.
  /*
   * BEREICHSGENAU, NICHT RUMPFWEIT. `items_cost` steht seit `0129` im
   * Belegsnapshot — rumpfweit gesucht bestaende diese Vorbedingung auch dann,
   * wenn `0130` nie gelaufen ist. Gesucht wird deshalb die Zeile samt
   * Einrueckung IM Bereich `purchases`, und der Bereich wird zeilenweise
   * bestimmt.
   */
  if not exists (
    with zeile as (
      select z.nr, z.txt
        from regexp_split_to_table(
               coalesce(pg_get_functiondef(
                 to_regprocedure('public.seller_business_backup()')), ''),
               E'\n') with ordinality as z(txt, nr)
    ),
    anfang as (
      select z.nr,
             (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
        from zeile z
       where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
    )
    select 1 from zeile z
     where z.txt ~ '^ {10}''items_cost'', t\.items_cost::text'
       and (select a.name from anfang a
             where a.nr < z.nr order by a.nr desc limit 1) = 'purchases') then
    raise exception '0131 setzt 0130 voraus: der Bereich purchases fuehrt items_cost nicht';
  end if;

  foreach v_fehlt in array array[
    'is_active', 'register_court', 'register_number', 'w_id', 'phone',
    'direct_contact', 'transactional_reply_to', 'withdrawal_contact_email',
    'complaints_contact_email', 'dispute_participation', 'dispute_body',
    'dispatch_statement', 'return_postage_borne_by'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'sellers'
                      and column_name = v_fehlt) then
      raise exception '0131 Abbruch: sellers.% fehlt', v_fehlt;
    end if;
  end loop;

  /*
   * UND ES GIBT GENAU EINE AKTIVE VERKAEUFERZEILE.
   *
   * `is_active` kommt in den Export, weil `0122` danach auswaehlt. Gaebe es
   * zwei aktive Zeilen, waere die Auswahl schon heute zufaellig — dann ist das
   * ein Befund und kein Exportproblem.
   */
  if (select count(*) from public.sellers where is_active) <> 1 then
    raise exception '0131 Abbruch: es gibt nicht genau eine aktive Verkaeuferzeile (%)',
      (select count(*) from public.sellers where is_active);
  end if;

  raise notice '0131: Vorbedingungen erfuellt.';
end
$$;


-- ---------------------------------------------------------------------------
-- 1. Die Sicherung, um 13 Feldzeilen ergaenzt
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
  'Eine Momentaufnahme der Betriebsdaten als JSON (0104; Eigenbelege in 0129, Kostenteile und Katalogordnung in 0130, Haendlerstammdaten in 0131) — 28 Bereiche in EINER Anweisung und damit aus EINER MVCC-Momentaufnahme. Liest nur. Der Bereich seller traegt seit 0131 die Rechtsangaben, die auf jeder Rechnung stehen, samt is_active: nach einer Wiederherstellung ist damit entscheidbar, welche Zeile der Betrieb ist. Absender, Inserat und Kaufvereinbarung eines Einkaufs bleiben AUSDRUECKLICH draussen (personenbezogen, offene Aufbewahrungsfrage); Kontoidentitaeten, Zeitstempel der Stammdaten und Zahlungsdienstleister-Interna ebenso. Kein Restore: restore_supported ist false.';


-- ---------------------------------------------------------------------------
-- 2. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_def       text;
  v_code      text;
  v_key       text;
  v_paare     text[];
  v_bereiche  integer;
  v_felder    integer;
  v_mal       integer;
  v_wer       text := '0131 Abbruch';
begin
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if v_def is null then
    raise exception '0131 unvollstaendig: seller_business_backup fehlt';
  end if;

  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '0131 Abbruch: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter';
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  /*
   * ==================================================================
   * DIE BEREICH-FELD-PAARE, ZEILENWEISE BESTIMMT.
   *
   * WAS HIER VORHER STAND UND WARUM ES WEG IST. Der erste Entwurf schnitt
   * einen Bereich mit `substring(v_code from '… coalesce\(\((.*?)…')` aus. In
   * Python und JavaScript tut das, was es soll; in PostgreSQL ist die
   * Gierigkeit eine Eigenschaft des ganzen ZWEIGS und wird vom ERSTEN
   * quantifizierten Atom mit Vorliebe bestimmt (Handbuch 9.7.3.5). In der
   * Diagnosedatei stand dort ein `[a-z_0-9]+` — gierig —, und damit
   * verschluckte der erste Bereich den gesamten Rumpf: EIN Bereich mit 321
   * Schluesseln statt 28 Bereichen.
   *
   * Hier lief dasselbe Muster mit einem LITERALEN Bereichsnamen, bei dem
   * `(.*?)` das erste Atom mit Vorliebe gewesen waere — es haette also
   * vermutlich funktioniert. „Vermutlich" ist kein Pruefkriterium. Deshalb
   * steht jetzt ueberall dieselbe zeilenweise Erkennung: jede Zeile einzeln,
   * verankert, kein Ausdruck ueber mehr als eine Zeile, keine Gierigkeit im
   * Spiel.
   * ==================================================================
   */
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
  select coalesce(array_agg(x.paar), '{}'::text[]),
         (select count(*) from anfang),
         count(*)
    into v_paare, v_bereiche, v_felder
    from (select coalesce((select a.name from anfang a
                            where a.nr < z.nr order by a.nr desc limit 1), '')
                 || '|' || rtrim(btrim(z.txt), ',') as paar
            from zeile z
           where z.txt ~ '^ {10}''[a-z_0-9]+'',') x;

  /*
   * EINE PARSERABWEICHUNG BRICHT AB — und wird niemals als Erfolg gewertet.
   *
   * 28 Bereiche sind eine Bedingung, keine Information. Jede Feldzeile muss
   * genau einem Bereich zugeordnet sein; ein Paar, das mit `|` beginnt, hat
   * keinen. Schlaegt eines davon an, ist jede Feldaussage danach wertlos —
   * also wird sie nicht getroffen.
   */
  if v_bereiche <> 28 then
    raise exception '%: der Bereichsparser erkennt % Bereiche statt 28 — Abbruch vor jeder Feldaussage',
      v_wer, v_bereiche;
  end if;
  if v_felder <> coalesce(array_length(v_paare, 1), 0) then
    raise exception '%: % Feldzeilen, aber % Paare — eine Zuordnung fehlt',
      v_wer, v_felder, coalesce(array_length(v_paare, 1), 0);
  end if;
  if exists (select 1 from unnest(v_paare) p where p like '|%') then
    raise exception '%: mindestens eine Feldzeile gehoert zu keinem Bereich', v_wer;
  end if;
  raise notice '%: Parser in Ordnung — % Bereiche, % Feldzeilen.',
    v_wer, v_bereiche, v_felder;


  /*
   * ==================================================================
   * BEREICHSGENAU — DIESELBE LEHRE WIE IN `0130`.
   *
   * `is_active` steht seit `0130` auch im Bereich `figures`, `items_cost` seit
   * `0129` im Belegsnapshot. Im ganzen Rumpf gesucht, bestaenden diese
   * Pruefungen, ohne etwas zu pruefen — und die Ausschlusspruefung weiter
   * unten haette die Migration faelschlich abgebrochen.
   * ==================================================================
   */
  -- ---- die 13 neuen Feldzeilen, im Bereich seller --------------------
  /*
   * JEDER EINTRAG TRAEGT SEINEN BEREICH — ALLE DREIZEHN.
   *
   * HIER LAG DER ABBRUCH. Beim Umbau auf Bereich-Feld-Paare bekamen nur der
   * erste und der letzte Eintrag das Praefix `seller|`; die elf dazwischen
   * blieben nackte Feldzeilen. Sie passten damit auf kein Paar in `v_paare`
   * (die tragen alle einen Bereich), und `split_part(v_key, '|', 2)` gab fuer
   * einen Wert ohne `|` die leere Zeichenkette zurueck — daher die Meldung
   * „0131 Abbruch:  fehlt im Bereich seller" ohne Feldnamen.
   *
   * Die Pruefung war also nicht zu streng, sondern falsch gestellt. Sie bleibt
   * blockierend; nur die Eintraege sind jetzt vollstaendig. Die Schleife prueft
   * zusaetzlich die FORM jedes Eintrags, bevor sie ihn sucht: ohne Bereich
   * kann sie nichts Sinnvolles sagen, und das soll sie dann auch nicht.
   */
  foreach v_key in array array[
    'seller|''is_active'', t.is_active',
    'seller|''register_court'', t.register_court',
    'seller|''register_number'', t.register_number',
    'seller|''w_id'', t.w_id',
    'seller|''phone'', t.phone',
    'seller|''direct_contact'', t.direct_contact',
    'seller|''transactional_reply_to'', t.transactional_reply_to',
    'seller|''withdrawal_contact_email'', t.withdrawal_contact_email',
    'seller|''complaints_contact_email'', t.complaints_contact_email',
    'seller|''dispute_participation'', t.dispute_participation',
    'seller|''dispute_body'', t.dispute_body',
    'seller|''dispatch_statement'', t.dispatch_statement',
    'seller|''return_postage_borne_by'', t.return_postage_borne_by'] loop
    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then
      raise exception '%: der Pruefeintrag "%" hat keine Form Bereich|Feldzeile',
        v_wer, v_key;
    end if;
    if not (v_key = any (v_paare)) then
      raise exception '%: % fehlt im Bereich %',
        v_wer, split_part(v_key, '|', 2), split_part(v_key, '|', 1);
    end if;
  end loop;
  /* Und keine Zeitstempel der Stammdatenzeile. */
  if exists (select 1 from unnest(v_paare) p
              where p like 'seller|''created_at''%'
                 or p like 'seller|''updated_at''%') then
    raise exception '%: der Bereich seller nennt einen Zeitstempel', v_wer;
  end if;

  -- ---- die neun personenbezogenen Einkaufsfelder: nur im Belegsnapshot
  /*
   * DIE NEUN PERSONENBEZOGENEN FELDER — bereichsgenau und dreifach geprueft.
   *
   * Erstens: im Bereich `purchases` darf keines stehen. Zweitens: in keinem
   * anderen Bereich als `purchase_receipts` — der Belegsnapshot friert den
   * Ankauf ein, dort stehen sie berechtigt. Drittens: dort MUESSEN sie stehen,
   * sonst waere der Snapshot unvollstaendig. Ein vierter Bereich, der eines
   * aufnimmt, faellt damit auf, ohne dass ihn jemand aufzaehlen muss.
   */
  foreach v_key in array array[
    '''sender_name''', '''sender_street''', '''sender_postal_code''',
    '''sender_city''', '''sender_country''', '''listing_title''',
    '''listing_url''', '''listing_details''', '''agreement_note'''] loop
    if exists (select 1 from unnest(v_paare) p
                where p like 'purchases|' || v_key || '%') then
      raise exception '%: der Bereich purchases nennt % — personenbezogen und nicht freigegeben',
        v_wer, v_key;
    end if;
    select count(*) into v_mal from unnest(v_paare) p
      where p like '%|' || v_key || '%'
        and p not like 'purchase_receipts|%';
    if v_mal <> 0 then
      raise exception '%: % steht in % Bereich(en) ausser purchase_receipts',
        v_wer, v_key, v_mal;
    end if;
    if not exists (select 1 from unnest(v_paare) p
                    where p like 'purchase_receipts|' || v_key || '%') then
      raise exception '%: % fehlt im Belegsnapshot — dort gehoert es hin',
        v_wer, v_key;
    end if;
  end loop;

  -- ---- Kontoidentitaeten und Zeitstempel der Stammdaten draussen -----
  foreach v_key in array array['''updated_by''', '''issued_by''', '''delivered_by''',
                               '''client_salt''', '''idempotency_key'''] loop
    if position(v_key in v_code) > 0 then
      raise exception '0131 Abbruch: der Export nennt % ', v_key;
    end if;
  end loop;

  -- ---- was 0129 und 0130 gebracht haben, bereichsgenau nachgeprueft -
  foreach v_key in array array[
    'purchase_receipts|''lines'', t.lines',
    'purchase_receipts|''supersedes_number'', t.supersedes_number',
    'purchases|''items_cost'', t.items_cost::text',
    'sales|''sale_day'', t.sale_day',
    'order_reservations|''sale_item_id'', t.sale_item_id',
    'figures|''category_id'', t.category_id',
    'shop_settings|''id'', t.id'] loop
    /* Dieselbe Formpruefung wie oben: ein Eintrag ohne Bereich kann nichts
       Sinnvolles melden — 0131 brach genau daran ab. */
    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then
      raise exception '%: der Pruefeintrag "%" hat keine Form Bereich|Feldzeile',
        v_wer, v_key;
    end if;
    if not (v_key = any (v_paare)) then
      raise exception '%: % fehlt im Bereich %',
        v_wer, split_part(v_key, '|', 2), split_part(v_key, '|', 1);
    end if;
  end loop;
  if position('from public.purchase_receipts t' in v_code) = 0 then
    raise exception '0131 Abbruch: der Belegbereich aus 0129 fehlt';
  end if;

  -- ---- sie schreibt nichts und bleibt wie sie war --------------------
  foreach v_key in array array['insert into', 'update public.', 'delete from',
                               'create temp', 'truncate', 'nextval', 'setval',
                               'txid_current()'] loop
    if position(v_key in v_code) > 0 then
      raise exception '0131 Abbruch: die Sicherung schreibt (%)', v_key;
    end if;
  end loop;

  if (select p.provolatile from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) <> 's' then
    raise exception '0131 Abbruch: seller_business_backup muss stable bleiben';
  end if;
  if position('''format_version'',  1' in v_code) = 0 then
    raise exception '0131 Abbruch: die Formatversion wurde veraendert';
  end if;
  if position('''restore_supported'',      false' in v_code) = 0 then
    raise exception '0131 Abbruch: restore_supported ist nicht mehr false';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = to_regprocedure('public.seller_business_backup()')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0131 Abbruch: PUBLIC oder anon darf die Sicherung abrufen';
  end if;

  raise notice '0131 ok: Haendlerstammdaten vollstaendig, Privatdaten weiter draussen.';
end
$$;
