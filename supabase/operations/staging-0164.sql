-- ===========================================================================
-- STAGING — EIN LAUF FUER 0164
--            (der TYPE kommt in die Plattformsicherung, CAT-10)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- *** ERST 0163, DANN DIESE ***
--
-- Ohne die drei Spalten gaebe es nichts zu exportieren; Waechter A2 bricht
-- dann ab.
--
-- *** SIE ERSETZT EINEN FUNKTIONSRUMPF — SONST NICHTS ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Recht, kein Trigger. Am
-- Inhalt sind es drei Zeilen mehr im Bereich `skylanders`:
--
--     'types', t.types,
--     'visible_type', t.visible_type,
--     'visible_type_decided', t.visible_type_decided,
--
-- Die Bereichszahl bleibt 54, `format_version` bleibt 2, und ein Archiv von
-- vorher bleibt lesbar.
--
-- *** WARUM ALLE DREI ***
--
-- `types` allein waere eine halbe Sicherung: die Menge stuende wieder da und
-- JEDES Banner waere fort. Ohne `visible_type_decided` waere „ausdruecklich
-- kein Banner" danach wieder „unentschieden". Probelauf **P73** faehrt den
-- Umlauf — sichern, loeschen, einspielen — und zeigt es Zeile fuer Zeile.
--
-- ERWARTET: die NOTICE-Zeile der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  /* A2: die drei Spalten aus 0163. */
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 3 then
    raise exception 'ABBRUCH A2: eine der drei Spalten aus 0163 fehlt. 0163 '
      'zuerst anwenden.';
  end if;

  /* A3: DER ABDRUCK. Nur der Rumpf aus 0160 wird ersetzt. */
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.system_platform_export()'))
     <> 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception 'ABBRUCH A3: der Exportrumpf ist nicht der aus 0160. Eine '
      'fremde Fassung wird nicht ueberschrieben — erst klaeren.';
  end if;

  /* A4: der Einsatz, als NOTICE. */
  raise notice 'A4: % Zeilen tragen eine Typmenge, % ein Banner, % ein '
    'ausdrueckliches „–". Ohne diese Migration fehlte alles davon im Archiv.',
    (select count(*) from public.skylanders where cardinality(types) > 0),
    (select count(*) from public.skylanders where visible_type is not null),
    (select count(*) from public.skylanders
      where visible_type is null and visible_type_decided);
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0164_platform_export_types.sql
-- ---------------------------------------------------------------------------
-- 0164 — der TYPE kommt in die Plattformsicherung
--
-- DIESELBE BAUFORM WIE `0153` UND `0160`, zum dritten Mal: EIN Funktionsrumpf
-- wird ersetzt, und am Inhalt sind es genau DREI Zeilen mehr im Bereich
-- `skylanders`:
--
--     'base_sky_id',  t.base_sky_id,
--   + 'types',                t.types,                   <- neu
--   + 'visible_type',         t.visible_type,            <- neu
--   + 'visible_type_decided', t.visible_type_decided,    <- neu
--
-- WARUM ALLE DREI UND NICHT NUR DIE MENGE. `types` allein waere eine halbe
-- Sicherung: nach einer Wiederherstellung stuende die Menge wieder da, aber
-- JEDE Kachel haette ihr Banner verloren — Stand 2026-10-29 tragen 189
-- Zeilen eines (die Zahl folgt dem Katalog), und
-- welches es ist, ist eine redaktionelle Entscheidung und aus nichts
-- ableitbar. `visible_type_decided` muss ebenfalls mit: ohne das Kennzeichen
-- waere „ausdruecklich kein Banner" nach der Wiederherstellung wieder
-- „unentschieden", und der Vorschlag wuerde beim naechsten Oeffnen etwas
-- anderes anbieten. Drei Spalten, drei Aussagen, drei Felder.
--
-- WAS SIE NICHT TUT:
--
--   * **Die Bereichszahl bleibt 54.** Die drei sind FELDER eines bestehenden
--     Bereichs, keine Bereiche. Deshalb bleibt `format_version` bei **2**,
--     und ein Archiv von vorher bleibt lesbar — es traegt die drei Felder
--     einfach nicht, und ein Leser, der sie nicht findet, liest einen Katalog
--     ohne Types. Genau die Zusage, die `0153` und `0160` schon gegeben
--     haben.
--   * **Keine Tabelle, keine Spalte, kein Recht, keine Zeile.** Der Rumpf
--     ist der aus `0160`, Zeichen fuer Zeichen, plus drei Zeilen.
--   * **Die Betriebssicherung bleibt unberuehrt.** `system_business_export()`
--     fuehrt den Katalog als Schnappschuss fuer den VERKAEUFER; ein Type ist
--     eine redaktionelle Angabe der Plattform (ADR-0039) und gehoert nicht in
--     das Archiv des Betriebs. Dieselbe Begruendung, mit der `catalog_status`
--     und `base_sky_id` dort fehlen.
--
-- DREI RIEGEL, wie bei `0153`/`0160`:
--
--   1. `0163` muss liegen — sonst gaebe es die drei Spalten nicht.
--   2. Der vorhandene Rumpf MUSS der aus `0160` sein (`md5`
--      **ff4f38e61cbd4e5857ea914d6be68d44**). Eine fremde Fassung wird nicht
--      blind ueberschrieben.
--   3. Ein zweiter Lauf prallt an Riegel 2 ab, weil der Abdruck danach
--      **7e9e58e2d84a9f8a7c660262aa21926b** ist.
--
-- Ruecknahme: `supabase/rollback/R0164_platform_export_back_to_0160.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_abdruck text;
begin
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0164 setzt 0105 voraus: system_platform_export() fehlt';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 3 then
    raise exception '0164 setzt 0163 voraus: eine der drei Spalten fehlt — '
      'types, visible_type, visible_type_decided';
  end if;

  select md5(p.prosrc) into v_abdruck from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  if v_abdruck = '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0164 Abbruch: der Rumpf traegt schon den Abdruck dieser '
      'Migration. Sie ist hier bereits angewendet.';
  end if;
  if v_abdruck is distinct from 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception '0164 Abbruch: der vorhandene Rumpf ist nicht der aus 0160 '
      '(gefunden %). Er wird nicht blind ueberschrieben — erst klaeren.',
      coalesce(v_abdruck, '(keiner)');
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Rumpf aus `0160`, plus drei Zeilen
-- ---------------------------------------------------------------------------
create or replace function public.system_platform_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else jsonb_build_object(

    /* ---- Was nur die Datenbank weiß --------------------------------- */
    'format',         'skyisles-platform-backup',
    'format_version', 2,
    'created_at',     now(),
    'commerce_mode',  (select s.mode from public.commerce_settings s limit 1),
    'snapshot_txid',  pg_current_snapshot()::text,

    /* ---- Die Bereiche, in sechs Gruppen wegen FUNC_MAX_ARGS ---------- */
    'data', (
      /* ---- Katalog — 6 Bereiche, 12 Argumente ---- */
      jsonb_build_object(
        'skylanders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'name', t.name,
            'slug', t.slug,
            'series_code', t.series_code,
            'category_id', t.category_id,
            'market_price', t.market_price::text,
            'price_updated_at', t.price_updated_at,
            'image_file', t.image_file,
            'image_override_path', t.image_override_path,
            'is_active', t.is_active,
            'catalog_visible', t.catalog_visible,
            'catalog_status', t.catalog_status,
            'display_name_override', t.display_name_override,
            'card_type', t.card_type,
            'source', t.source,
            'character_id', t.character_id,
            'base_sky_id', t.base_sky_id,
            'types', t.types,
            'visible_type', t.visible_type,
            'visible_type_decided', t.visible_type_decided,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.skylanders t
        ), '[]'::jsonb),

        'series', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'label', t.label,
            'release_year', t.release_year,
            'position', t.position,
            'created_at', t.created_at
          ) order by t.code)
            from public.series t
        ), '[]'::jsonb),

        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'series_code', t.series_code,
            'position', t.position,
            'name', t.name,
            'catalog_group', t.catalog_group,
            'created_at', t.created_at
          ) order by t.id)
            from public.categories t
        ), '[]'::jsonb),

        'characters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'canonical_name', t.canonical_name,
            'element', t.element,
            'species', t.species,
            'role_type', t.role_type,
            'short_description', t.short_description,
            'source_url', t.source_url,
            'source_label', t.source_label,
            'verified_at', t.verified_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.characters t
        ), '[]'::jsonb),

        'catalog_editorial', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'admin_note', t.admin_note,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.catalog_editorial t
        ), '[]'::jsonb),

        'catalog_admin_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'entity', t.entity,
            'entity_id', t.entity_id,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.catalog_admin_changes t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Nutzer und Sammlung — 2 Bereiche, 4 Argumente ---- */
      jsonb_build_object(
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'username', t.username,
            'display_name', t.display_name,
            'country', t.country,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.profiles t
        ), '[]'::jsonb),

        'collection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'sky_id', t.sky_id,
            'quantity', t.quantity,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.collection_items t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Seller und Shop — 10 Bereiche, 20 Argumente ---- */
      jsonb_build_object(
        'sellers', coalesce((
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
            'contact_email', t.contact_email,
            'transactional_reply_to', t.transactional_reply_to,
            'withdrawal_contact_email', t.withdrawal_contact_email,
            'complaints_contact_email', t.complaints_contact_email,
            'small_business_19', t.small_business_19,
            'dispute_participation', t.dispute_participation,
            'dispute_body', t.dispute_body,
            'return_postage_borne_by', t.return_postage_borne_by,
            'dispatch_statement', t.dispatch_statement,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'is_active', t.is_active,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sellers t
        ), '[]'::jsonb),

        'seller_operators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'seller_id', t.seller_id,
            'user_id', t.user_id,
            'is_enabled', t.is_enabled,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.seller_operators t
        ), '[]'::jsonb),

        'shop_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'granted_at', t.granted_at,
            'note', t.note
          ) order by t.user_id)
            from public.shop_admins t
        ), '[]'::jsonb),

        'platform_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'created_at', t.created_at,
            'note', t.note
          ) order by t.user_id)
            from public.platform_admins t
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

        'platform_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'contact_email', t.contact_email,
            'support_email', t.support_email,
            'catalog_market_boost_percent', t.catalog_market_boost_percent::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.platform_settings t
        ), '[]'::jsonb),

        'commerce_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'mode', t.mode,
            'max_open_checkouts', t.max_open_checkouts,
            'max_reserved_units', t.max_reserved_units,
            'max_orders_per_hour', t.max_orders_per_hour,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.commerce_settings t
        ), '[]'::jsonb),

        'shipping_methods', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'name', t.name,
            'base_price', t.base_price::text,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.code)
            from public.shipping_methods t
        ), '[]'::jsonb),

        'shipping_countries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'country_code', t.country_code,
            'label', t.label,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.country_code)
            from public.shipping_countries t
        ), '[]'::jsonb),

        'legal_document_versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'version', t.version,
            'effective_from', t.effective_from,
            'updated_at', t.updated_at
          ) order by t.slug)
            from public.legal_document_versions t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */
      jsonb_build_object(
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
            'currency', t.currency,
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

        'orderbook_name_mappings', coalesce((
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

        'orderbook_audit', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'action', t.action,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.orderbook_audit t
        ), '[]'::jsonb),

        'seller_monthly_reports', coalesce((
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

        'purchase_calculations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'name', t.name,
            'status', t.status,
            'lines', t.lines,
            'factor_percent', t.factor_percent,
            'total_cents', t.total_cents,
            'positions', t.positions,
            'units', t.units,
            'purchase_id', t.purchase_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_calculations t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Bestellungen — 18 Bereiche, 36 Argumente ---- */
      jsonb_build_object(
        'orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_number', t.order_number,
            'user_id', t.user_id,
            'customer_email', t.customer_email,
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
            'image_snapshot', t.image_snapshot,
            'series_snapshot', t.series_snapshot,
            'unit_price', t.unit_price::text,
            'discount_amount', t.discount_amount::text,
            'line_total', t.line_total::text,
            'inventory_id', t.inventory_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_lines t
        ), '[]'::jsonb),

        'order_addresses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'kind', t.kind,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_addresses t
        ), '[]'::jsonb),

        'order_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'event_type', t.event_type,
            'actor_kind', t.actor_kind,
            'payload', t.payload,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_events t
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

        'order_messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'author_kind', t.author_kind,
            'body', t.body,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_messages t
        ), '[]'::jsonb),

        'order_conversation_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_conversation_reads t
        ), '[]'::jsonb),

        'order_attention_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_attention_reads t
        ), '[]'::jsonb),

        'order_mail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'kind', t.kind,
            'ref', t.ref,
            'state', t.state,
            'claimed_at', t.claimed_at,
            'sent_at', t.sent_at,
            'attempts', t.attempts,
            'last_error', t.last_error,
            'updated_at', t.updated_at
          ) order by t.order_id, t.kind, coalesce(t.ref, ''))
            from public.order_mail t
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

        'customer_contacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'email', t.email,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.customer_contacts t
        ), '[]'::jsonb),

        'payment_attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'provider', t.provider,
            'status', t.status,
            'amount', t.amount::text,
            'currency', t.currency,
            'created_at', t.created_at,
            'updated_at', t.updated_at,
            'paid_at', t.paid_at,
            'failed_at', t.failed_at
          ) order by t.id)
            from public.payment_attempts t
        ), '[]'::jsonb),

        'payment_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'provider', t.provider,
            'event_type', t.event_type,
            'payment_attempt_id', t.payment_attempt_id,
            'order_id', t.order_id,
            'received_at', t.received_at,
            'processed_at', t.processed_at,
            'outcome', t.outcome
          ) order by t.id)
            from public.payment_events t
        ), '[]'::jsonb),

        'withdrawal_requests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'consumer_name', t.consumer_name,
            'contact_email', t.contact_email,
            'declaration', t.declaration,
            'received_at', t.received_at,
            'receipt_state', t.receipt_state,
            'receipt_sent_at', t.receipt_sent_at,
            'handled_at', t.handled_at,
            'receipt_attempt_at', t.receipt_attempt_at
          ) order by t.id)
            from public.withdrawal_requests t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Tester — 5 Bereiche, 10 Argumente ---- */
      jsonb_build_object(
        'testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.user_id)
            from public.testers t
        ), '[]'::jsonb),

        'tester_permissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'permission', t.permission,
            'granted_at', t.granted_at
          ) order by t.user_id, t.permission)
            from public.tester_permissions t
        ), '[]'::jsonb),

        'tester_features', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', t.key,
            'label', t.label,
            'description', t.description,
            'position', t.position
          ) order by t.key)
            from public.tester_features t
        ), '[]'::jsonb),

        'tester_permission_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'permission', t.permission,
            'action', t.action,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.tester_permission_changes t
        ), '[]'::jsonb),

        'commerce_testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'granted_at', t.granted_at
          ) order by t.user_id)
            from public.commerce_testers t
        ), '[]'::jsonb)
      )
    )
  ) end;
$$;

comment on function public.system_platform_export() is
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153, 0160 and 0164) - the archive file database.json. 54 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and simply carry 53 sections. 0153 added skylanders.catalog_status (0152), 0160 added skylanders.base_sky_id (0159), and 0164 adds the CAT-10 type system - types, visible_type and visible_type_decided (0163). All of those are FIELDS, not sections, so format_version stays 2 and older version-2 archives without them stay readable. Each one would be a real loss: without catalog_status a draft could not be told from a hidden row, without base_sky_id every variant would come back as a figure of its own, and without the three type fields a restored catalogue would keep its sets but lose every banner - which is editorial and derivable from nothing. There is still no restore - format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_abdruck text;
  v_laenge  integer;
  v_offen   integer;
begin
  select md5(p.prosrc), length(p.prosrc) into v_abdruck, v_laenge
    from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()');

  if v_abdruck is distinct from '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0164 Nachbedingung: der Rumpf traegt den Abdruck % statt '
      '7e9e58e2d84a9f8a7c660262aa21926b', coalesce(v_abdruck, '(keiner)');
  end if;
  if v_laenge <> 31248 then
    raise exception '0164 Nachbedingung: der Rumpf ist % Zeichen lang, erwartet '
      'sind 31248', v_laenge;
  end if;

  -- DIE DREI FELDER STEHEN DRIN, jedes einzeln nachgewiesen.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''types'', t.types,%') then
    raise exception '0164 Nachbedingung: das Feld types fehlt im Rumpf';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''visible_type'', t.visible_type,%') then
    raise exception '0164 Nachbedingung: das Feld visible_type fehlt im Rumpf';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like
                        '%''visible_type_decided'', t.visible_type_decided,%') then
    raise exception '0164 Nachbedingung: das Feld visible_type_decided fehlt '
      'im Rumpf';
  end if;

  -- UND DIE FELDER AUS 0153 UND 0160 STEHEN NOCH.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''base_sky_id'', t.base_sky_id,%'
                    and p.prosrc like '%''catalog_status'', t.catalog_status,%') then
    raise exception '0164 Nachbedingung: ein Feld aus 0153 oder 0160 ist verloren';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''format_version'', 2,%') then
    raise exception '0164 Nachbedingung: format_version ist nicht mehr 2';
  end if;

  -- Die Attribute und die Rechte, unveraendert.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosecdef
                    and (select count(*) = 1
                           from unnest(coalesce(p.proconfig, '{}')) c
                          where c like 'search\_path=%')) then
    raise exception '0164 Nachbedingung: die Attribute der Funktion stimmen nicht';
  end if;
  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public',
                                                        'service_role'));
  if v_offen <> 0 then
    raise exception '0164 Nachbedingung: % offene EXECUTE-Rechte auf dem Export',
      v_offen;
  end if;

  raise notice '0164: Rumpf %, 54 Bereiche, format_version 2, drei Felder mehr, '
    'keine Zeile angefasst.', v_abdruck;
end
$nach$;
-- <<< ENDE: supabase/migrations/0164_platform_export_types.sql

do $lauf_b$
declare
  v_abdruck text;
begin
  select md5(prosrc) into v_abdruck from pg_proc
   where oid = to_regprocedure('public.system_platform_export()');
  if v_abdruck <> '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0164 Nachbedingung: der Rumpf traegt % statt '
      '7e9e58e2d84a9f8a7c660262aa21926b', coalesce(v_abdruck, '(keiner)');
  end if;

  /*
   * DIE UMKEHRPROBE AM LEBENDEN RUMPF: die drei Zeilen abgezogen MUSS der
   * Rumpf aus `0160` sein. Eine zweite Aenderung irgendwo in 31 248 Zeichen
   * faellt damit auf.
   */
  if (select md5(replace(replace(replace(prosrc,
        E'\n            ''types'', t.types,', ''),
        E'\n            ''visible_type'', t.visible_type,', ''),
        E'\n            ''visible_type_decided'', t.visible_type_decided,', ''))
        from pg_proc where oid = to_regprocedure('public.system_platform_export()'))
     <> 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception '0164 Nachbedingung: der Rumpf ist nicht der aus 0160 plus '
      'drei Zeilen. Transaktion abbrechen.';
  end if;

  raise notice '0164: der Exportrumpf fuehrt Menge, Banner und Kennzeichen. '
    '54 Bereiche, format_version 2, keine Zeile angefasst.';
end
$lauf_b$;

commit;
