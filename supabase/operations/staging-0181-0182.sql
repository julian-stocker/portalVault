-- ===========================================================================
-- STAGING — EIN LAUF FUER 0181 UND 0182
--            (Positionen importierter Verkaeufe von Hand korrigieren —
--             revisionssicher, ohne Lager und ohne Betrag — ADR-0179 —
--             und die Spur in beiden Sicherungen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0181`, diese Datei,
-- `npm run db:migrate:staging -- 0181 --resume`. `0182` startet denselben Lauf.
--
-- NOCH NICHT FREIGEGEBEN. Diese Huelle ist vorbereitet; gefahren wird sie erst
-- nach einer eigenen Freigabe des Betreibers.
--
-- BEIDE MIGRATIONEN SIND ZEICHENGLEICH EINGEBETTET, 0181 vor 0182. Sie legt die Spur
-- `sale_item_corrections` und acht Funktionen an und ersetzt die Ruempfe der
-- beiden Arbeitsmappen-Sync-Funktionen (Positionen 0088, Datum 0089); 0182
-- ersetzt die Ruempfe beider Sicherungen (0174 plus der eine Bereich). Bricht
-- eine davon ab, ist keine angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher — jede Spalte — Verkaeufe,
-- Positionen, Erstattungen, Gebuehren, Lagerbewegungen, Altbestandsereignisse,
-- das Orderbuch-Journal, Reservierungen, das Lager und die Sammlung, dazu die
-- Rechte jeder Funktion (ausser den acht neuen) und jeder Tabelle in `public`
-- (ausser der neuen Spur) und jede Policy. Z1 misst nachher dasselbe und
-- bricht ab, wenn sich auch nur ein Wert bewegt hat. Z2 prueft die neuen
-- Ruempfe und dass die unberuehrten unberuehrt sind, Z3 die Rechte.
--
-- NUR STAGING. Production ist eine eigene, spaetere Entscheidung.
--
-- ERWARTET: die NOTICE `0181 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel (Datenbankkommentar, wie beim Pruefzugang). */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — Daten und Rechte, vorher gemessen (Temporaertabelle, faellt mit commit). */
create temporary table corr_0181_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.legacy_stock_events t) as legacy_stock_events,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_correct_legacy_sale_item', 'seller_add_legacy_sale_item', 'seller_remove_legacy_added_item', 'seller_sale_item_corrections', 'sales_legacy_correction_sale', 'sales_legacy_correction_item', 'sales_legacy_correction_figure', 'sale_item_corrections_append_only')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname not in ('sale_item_corrections', 'sale_item_corrections_id_seq')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0181_legacy_sale_item_corrections.sql
-- ===========================================================================
-- 0181 — Positionen importierter Verkäufe von Hand korrigieren
--
-- WARUM
--
-- Der CSV-Abgleich findet bei Verkäufen aus der Arbeitsmappe (`source =
-- 'excel_order_2026'`) falsche Figuren und fehlende Positionen — im April
-- etwa Verkauf 152: drei Positionen in SkyIsles, fünf Stück im eBay-Bericht.
-- Korrigieren ließ sich das bisher nicht, und zwar mit Absicht:
-- `seller_remove_sale_item` und `seller_set_sale_item_sky` (0065/0110)
-- lehnen jede Arbeitsmappenzeile ab — „its provenance is not editable“. Die
-- Herkunft einer Zeile ist ihr Beweis; ein Werkzeug, das sie überschreibt,
-- würde die Rekonstruktion der Historie unprüfbar machen.
--
-- Diese Migration hebt die Sperre NICHT auf. Sie fügt einen eigenen,
-- engeren Weg hinzu, der die Herkunft nicht überschreibt, sondern daneben
-- schreibt.
--
-- WIE DIE ARBEITSMAPPE ERHALTEN BLEIBT
--
--   1. `sale_item_corrections` hält jede Korrektur mit altem und neuem Wert —
--      append-only (Trigger), ohne Fremdschlüssel auf die Position, damit
--      auch das Entfernen einer ergänzten Position seine Spur behält. Die
--      erste Ersetzung einer Arbeitsmappenzeile nennt deren ursprüngliche
--      `sky_id` und `raw_name`, für immer.
--   2. Auf der Position selbst bleibt alles, was aus der Mappe kam:
--      `source_row`, `position`, `raw_name` (Regel 4: roh, nie verändert),
--      `legacy_stock_flag`, `legacy_shipped_flag`. Korrigiert wird allein die
--      Katalogfigur, `sky_id` — dieselbe Disziplin wie `seller_set_sale_item_sky`.
--   3. Eine Arbeitsmappenzeile wird nie gelöscht. Entfernen kann man nur eine
--      Position, die selbst durch eine Korrektur ergänzt wurde.
--   4. Jede Änderung schreibt zusätzlich `orderbook_audit` (0062) und setzt
--      `sales.updated_at` (`orderbook_touch_sale`). Damit sieht der
--      CSV-Abgleich den Verkauf als geändert, und 0180 übernimmt aus einer
--      älteren Analyse nichts mehr (`stale`).
--   5. Der Arbeitsmappen-Sync (`system_sync_legacy_sale_item`, 0088) lehnt
--      eine korrigierte Zeile ab, statt den alten Wert zurückzuschreiben.
--   6. Dasselbe für das Verkaufsdatum (`system_sync_legacy_sale_group`,
--      0089): ein im Orderbuch korrigiertes `sold_at` schreibt die Mappe
--      nicht mehr zurück (Abschnitt 7b).
--
-- WAS NIE GESCHIEHT
--
-- Keine Lagerbewegung, keine Reservierung (`hold_sale_item` wird bewusst
-- NICHT gerufen — eine Historie ist längst verschickt), keine Beträge,
-- Gebühren, Erstattungen oder Auszahlungen. Nur Positionen ohne jeden
-- Vorgang: keine Bewegung, keine Rückgabe, keine angekündigte Rückgabe, kein
-- Abschluss, kein „nicht verschickt“, kein aktiver Hold. Nur das
-- Betriebskonto, nur ein externer, nicht stornierter Arbeitsmappenverkauf,
-- nur mit dem `updated_at`, mit dem das Fenster geöffnet wurde (PT409).
--
-- NORMALE VERKÄUFE: unverändert. Diese Funktionen lehnen jeden Verkauf ab,
-- der nicht aus der Arbeitsmappe stammt; dort gelten weiter
-- `seller_add_sale_item`, `seller_remove_sale_item`, `seller_set_sale_item_sky`.
-- ===========================================================================

do $pre$
begin
  if to_regclass('public.sale_item_corrections') is not null then
    raise exception '0181 abort: sale_item_corrections exists — applied here already';
  end if;
  if to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null
     or to_regprocedure('public.orderbook_touch_sale(bigint)') is null
     or to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)') is null
     or to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)') is null then
    raise exception '0181 needs 0062 (orderbook_log, orderbook_guard_stale, orderbook_touch_sale), 0088 and 0089';
  end if;
  -- The two bodies 0181 replaces must be 0088's and 0089's: a foreign version is not overwritten blindly.
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'))
     is distinct from '864a99c5017b3de08056bfed740b8b56' then
    raise exception '0181 abort: system_sync_legacy_sale_item is not the body of 0088 — not overwritten blindly';
  end if;
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
     is distinct from '6de873975a90579e1dcc8f2de0987f42' then
    raise exception '0181 abort: system_sync_legacy_sale_group is not the body of 0089 — not overwritten blindly';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Die Spur: jede Korrektur, für immer
-- ---------------------------------------------------------------------------
create table public.sale_item_corrections (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales (id) on delete restrict,
  -- No foreign key: a removed (added) line keeps its record.
  sale_item_id bigint not null,
  action text not null,
  position integer not null,
  -- The workbook row the line came from; NULL for a line added by a correction.
  source_row integer,
  old_sky_id text,
  old_raw_name text,
  new_sky_id text,
  new_raw_name text,
  corrected_at timestamptz not null default now(),
  corrected_by uuid references auth.users (id) on delete set null,
  constraint sale_item_corrections_action_known check (action in ('replace', 'add', 'remove')),
  constraint sale_item_corrections_shape check (
    (action = 'replace' and new_sky_id is not null and old_sky_id is distinct from new_sky_id)
    or (action = 'add' and old_sky_id is null and old_raw_name is null
        and (new_sky_id is not null or new_raw_name is not null) and source_row is null)
    or (action = 'remove' and new_sky_id is null and new_raw_name is null and source_row is null))
);

create index sale_item_corrections_sale_idx on public.sale_item_corrections (sale_id, id);
create index sale_item_corrections_item_idx on public.sale_item_corrections (sale_item_id);

comment on table public.sale_item_corrections is
  'Every hand correction of a position of an imported workbook sale (0181): replace (the catalog figure), add (a missing line), remove (a line that was itself added). Append-only. The first replace of a workbook line holds its original sky_id and raw_name for good; the line itself keeps source_row, raw_name and the legacy flags.';

alter table public.sale_item_corrections enable row level security;
revoke all on table public.sale_item_corrections from public, anon, authenticated;

create or replace function public.sale_item_corrections_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.sale_item_corrections_append_only() from public, anon, authenticated;

create trigger sale_item_corrections_append_only
  before update or delete on public.sale_item_corrections
  for each row execute function public.sale_item_corrections_append_only();

-- ---------------------------------------------------------------------------
-- 2. Die gemeinsamen Prüfungen
-- ---------------------------------------------------------------------------

/*
 * The sale, locked: the seller operator, an external workbook sale that is
 * not cancelled, and the version the screen was opened with — required here,
 * not optional as elsewhere: a correction of history is never blind.
 */
create or replace function public.sales_legacy_correction_sale(p_sale_id bigint, p_expected_updated_at timestamptz)
returns public.sales
language plpgsql volatile security definer set search_path = ''
as $$
declare v_sale public.sales;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if p_expected_updated_at is null then
    raise exception 'the version of the sale is required for a correction' using errcode = 'check_violation';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an internal sale takes its items from the order' using errcode = 'restrict_violation';
  end if;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'only an imported workbook sale is corrected this way; use the normal positions'
      using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'a cancelled sale is not corrected' using errcode = 'restrict_violation';
  end if;
  perform public.orderbook_guard_stale(p_sale_id, p_expected_updated_at);
  return v_sale;
end;
$$;

revoke all on function public.sales_legacy_correction_sale(bigint, timestamptz) from public, anon, authenticated;

/* A position without any operation on it: nothing moved, returned, closed or held. */
create or replace function public.sales_legacy_correction_item(p_item public.sale_items)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_item.movement_id is not null or p_item.return_movement_id is not null then
    raise exception 'this item has a stock movement; it is not corrected here' using errcode = 'restrict_violation';
  end if;
  if p_item.returned_at is not null or p_item.return_announced_at is not null then
    raise exception 'this item has a return; it is not corrected here' using errcode = 'restrict_violation';
  end if;
  if p_item.settled_at is not null or p_item.not_shipped_at is not null then
    raise exception 'this item is already closed; it is not corrected here' using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from public.order_reservations r where r.sale_item_id = p_item.id and r.state = 'active') then
    raise exception 'this item holds stock; it is not corrected here' using errcode = 'restrict_violation';
  end if;
end;
$$;

revoke all on function public.sales_legacy_correction_item(public.sale_items) from public, anon, authenticated;

/* A catalog figure that exists, or an error. */
create or replace function public.sales_legacy_correction_figure(p_sky_id text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_sky text := nullif(btrim(coalesce(p_sky_id, '')), '');
begin
  if v_sky is not null and not exists (select 1 from public.skylanders k where k.sky_id = v_sky) then
    raise exception 'no such catalog figure' using errcode = 'check_violation';
  end if;
  return v_sky;
end;
$$;

revoke all on function public.sales_legacy_correction_figure(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Die Figur einer Position korrigieren
-- ---------------------------------------------------------------------------
create or replace function public.seller_correct_legacy_sale_item(
  p_item_id bigint, p_sky_id text, p_expected_updated_at timestamptz
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item public.sale_items; v_sky text;
begin
  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    -- The operator check comes first when there is no item to name a sale.
    if not public.can_operate_active_seller() then
      raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;
  perform public.sales_legacy_correction_sale(v_item.sale_id, p_expected_updated_at);
  select * into v_item from public.sale_items where id = p_item_id for update;
  perform public.sales_legacy_correction_item(v_item);
  v_sky := public.sales_legacy_correction_figure(p_sky_id);
  if v_sky is null then
    raise exception 'a correction names a catalog figure' using errcode = 'check_violation';
  end if;
  if v_item.sky_id is not distinct from v_sky then
    raise exception 'the correction changes nothing' using errcode = 'check_violation';
  end if;

  insert into public.sale_item_corrections
    (sale_id, sale_item_id, action, position, source_row, old_sky_id, old_raw_name, new_sky_id, new_raw_name, corrected_by)
  values (v_item.sale_id, v_item.id, 'replace', v_item.position, v_item.source_row,
          v_item.sky_id, v_item.raw_name, v_sky, v_item.raw_name, (select auth.uid()));

  -- Only the catalog figure. raw_name, source_row, position and the legacy flags stay the workbook's.
  update public.sale_items set sky_id = v_sky, updated_at = now() where id = p_item_id;

  perform public.orderbook_log(v_item.sale_id, 'sale_item', p_item_id, 'update', 'sky_id', v_item.sky_id, v_sky);
  perform public.orderbook_touch_sale(v_item.sale_id);
end;
$$;

comment on function public.seller_correct_legacy_sale_item(bigint, text, timestamptz) is
  'Corrects the catalog figure of one position of an imported workbook sale (0181). Seller operator only, the sale version required (PT409), an external non-cancelled workbook sale only, a position without movement, return, closing or hold only. Writes sky_id only — raw_name, source_row, position and legacy flags stay — records old and new in sale_item_corrections and orderbook_audit, touches sales.updated_at. No stock, no hold, no money. Normal sales keep seller_set_sale_item_sky.';

-- ---------------------------------------------------------------------------
-- 4. Eine fehlende Position ergänzen
-- ---------------------------------------------------------------------------
create or replace function public.seller_add_legacy_sale_item(
  p_sale_id bigint, p_sky_id text, p_raw_name text, p_condition text, p_expected_updated_at timestamptz
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_sale public.sales; v_sky text; v_raw text; v_pos integer; v_id bigint;
begin
  v_sale := public.sales_legacy_correction_sale(p_sale_id, p_expected_updated_at);
  v_sky := public.sales_legacy_correction_figure(p_sky_id);
  v_raw := nullif(btrim(coalesce(p_raw_name, '')), '');
  if v_sky is null and v_raw is null then
    raise exception 'a position needs a catalog figure or a name' using errcode = 'check_violation';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos from public.sale_items where sale_id = p_sale_id;
  -- No source_row, no legacy flags: this line did not come from the workbook, and says so.
  insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
  values (p_sale_id, v_pos, v_sky, v_raw, coalesce(nullif(btrim(p_condition), ''), 'loose'))
  returning id into v_id;
  -- Deliberately NO hold_sale_item: history does not reserve stock.

  insert into public.sale_item_corrections
    (sale_id, sale_item_id, action, position, source_row, new_sky_id, new_raw_name, corrected_by)
  values (p_sale_id, v_id, 'add', v_pos, null, v_sky, v_raw, (select auth.uid()));

  perform public.orderbook_log(p_sale_id, 'sale_item', v_id, 'insert', null, null, coalesce(v_sky, v_raw));
  perform public.orderbook_touch_sale(p_sale_id);
  return v_id;
end;
$$;

comment on function public.seller_add_legacy_sale_item(bigint, text, text, text, timestamptz) is
  'Adds a missing position to an imported workbook sale (0181): no source_row, no legacy flags, NO hold and no stock. Seller operator only, the sale version required, an external non-cancelled workbook sale only. Recorded in sale_item_corrections (add) and orderbook_audit; touches sales.updated_at. Normal sales keep seller_add_sale_item.';

-- ---------------------------------------------------------------------------
-- 5. Eine ergänzte Position wieder entfernen — nie eine Arbeitsmappenzeile
-- ---------------------------------------------------------------------------
create or replace function public.seller_remove_legacy_added_item(p_item_id bigint, p_expected_updated_at timestamptz)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_item public.sale_items;
begin
  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    if not public.can_operate_active_seller() then
      raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;
  perform public.sales_legacy_correction_sale(v_item.sale_id, p_expected_updated_at);
  select * into v_item from public.sale_items where id = p_item_id for update;
  perform public.sales_legacy_correction_item(v_item);
  if v_item.source_row is not null or v_item.legacy_stock_flag is not null or v_item.legacy_shipped_flag is not null
     or not exists (select 1 from public.sale_item_corrections c
                     where c.sale_item_id = p_item_id and c.action = 'add') then
    raise exception 'only a position added by a correction is removed; a workbook line stays'
      using errcode = 'restrict_violation';
  end if;

  insert into public.sale_item_corrections
    (sale_id, sale_item_id, action, position, source_row, old_sky_id, old_raw_name, corrected_by)
  values (v_item.sale_id, v_item.id, 'remove', v_item.position, null, v_item.sky_id, v_item.raw_name, (select auth.uid()));

  delete from public.sale_items where id = p_item_id;

  perform public.orderbook_log(v_item.sale_id, 'sale_item', p_item_id, 'delete', null, coalesce(v_item.sky_id, v_item.raw_name), null);
  perform public.orderbook_touch_sale(v_item.sale_id);
end;
$$;

comment on function public.seller_remove_legacy_added_item(bigint, timestamptz) is
  'Removes a position that was itself added to an imported workbook sale by seller_add_legacy_sale_item (0181). Never a workbook line (source_row or legacy flags), never a position with movement, return, closing or hold. Seller operator only, the sale version required. The removal stays in sale_item_corrections and orderbook_audit; touches sales.updated_at.';

-- ---------------------------------------------------------------------------
-- 6. Lesen: was an einem Verkauf korrigiert wurde
-- ---------------------------------------------------------------------------
create or replace function public.seller_sale_item_corrections(p_sale_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'saleItemId', c.sale_item_id, 'action', c.action, 'position', c.position,
             'sourceRow', c.source_row, 'oldSkyId', c.old_sky_id, 'oldRawName', c.old_raw_name,
             'newSkyId', c.new_sky_id, 'newRawName', c.new_raw_name, 'correctedAt', c.corrected_at)
           order by c.id)
      from public.sale_item_corrections c where c.sale_id = p_sale_id), '[]'::jsonb);
end;
$$;

comment on function public.seller_sale_item_corrections(bigint) is
  'The hand corrections of one sale''s positions (0181), oldest first, with old and new values. Seller operator only.';

-- ---------------------------------------------------------------------------
-- 7. Der Arbeitsmappen-Sync schreibt keine korrigierte Zeile zurück
--    (0088, Wortlaut unverändert bis auf die eine Prüfung)
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_legacy_sale_item(
  p_item_id       bigint,
  p_raw_name      text,
  p_sky_id        text,
  p_stock_flag    text,
  p_shipped_flag  text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
begin
  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'sale_item % does not exist', p_item_id using errcode = 'no_data_found';
  end if;
  if v_item.source_row is null then
    raise exception 'sale_item % has no source row and is not a workbook line', p_item_id;
  end if;
  /*
   * 0181: A LINE CORRECTED IN SKYISLES IS NO LONGER THE WORKBOOK'S TO WRITE.
   * The operator fixed its figure by hand (`seller_correct_legacy_sale_item`);
   * a sync from the workbook would silently put the old value back. Refused,
   * never skipped: the sync tool checks first and stops before any write.
   */
  if exists (select 1 from public.sale_item_corrections c where c.sale_item_id = p_item_id) then
    raise exception 'sale_item % was corrected in SkyIsles (0181); the workbook no longer writes it', p_item_id
      using errcode = 'restrict_violation';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', v_sale.id, v_sale.source;
  end if;
  -- An order owns its lines through `order_lines`; a sale that belongs to one
  -- is operative history and the workbook has no say over it.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', v_sale.id, v_sale.order_id;
  end if;

  update public.sale_items
     set raw_name            = p_raw_name,
         sky_id              = p_sky_id,
         legacy_stock_flag   = p_stock_flag,
         legacy_shipped_flag = p_shipped_flag,
         updated_at          = now()
   where id = p_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7b. Der Arbeitsmappen-Sync schreibt kein von Hand korrigiertes Datum zurück
--     (0089, Wortlaut unverändert bis auf die eine Prüfung)
--
-- `system_sync_legacy_sale_group` ist der einzige Weg, auf dem die Mappe ein
-- Kopffeld eines bestehenden Verkaufs schreibt — `sold_at`, sonst nichts.
-- Käufer, Beträge, Referenz, Land und Notiz haben keinen Schreibpfad: weicht
-- einer davon ab, ist die Gruppe für den Sync `unexplained`, und er schreibt
-- nichts (`legacy-sync-groups.ts`). Das Datum aber würde er still
-- überschreiben, auch nachdem der Betreiber es im Orderbuch korrigiert hat.
--
-- Bewusst korrigiert heißt: `orderbook_audit` hält eine Änderung von
-- `sold_at` an diesem Verkauf (`seller_update_sale`, `seller_set_sale_date`,
-- 0062/0091). Der Sync selbst schreibt keine Audit-Zeile, der Import nur
-- `insert` ohne Feld — eine solche Zeile stammt also immer aus SkyIsles.
-- Weicht das Datum der Mappe dann ab, wird abgelehnt, nicht übersprungen; das
-- Werkzeug prüft es vorher und schreibt dann gar nichts. Gleiches Datum:
-- nichts zu verteidigen, der Aufruf läuft wie bisher.
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_legacy_sale_group(
  p_sale_id bigint,
  p_sold_at date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'sale % does not exist', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.source is distinct from 'excel_order_2026' then
    raise exception 'sale % is not a workbook sale (source %)', p_sale_id, v_sale.source;
  end if;
  -- A sale that belongs to an order is operative history; the workbook has
  -- no say over when it happened.
  if v_sale.order_id is not null then
    raise exception 'sale % belongs to order % and is operative', p_sale_id, v_sale.order_id;
  end if;
  -- A date is what this function is for. Clearing one would be a different
  -- act with a different justification, and nobody has asked for it.
  if p_sold_at is null then
    raise exception 'sale %: refusing to clear sold_at', p_sale_id;
  end if;
  -- The business year is the whole point of the cut (ADR-0102). A workbook
  -- date outside it means the sheet was misread, not that history moved.
  if p_sold_at < date '2026-01-01' then
    raise exception 'sale %: % is before the business cut', p_sale_id, p_sold_at;
  end if;
  /*
   * 0181: A DATE CORRECTED IN SKYISLES IS NO LONGER THE WORKBOOK'S TO WRITE.
   * orderbook_audit holds a sold_at change of this sale, made in the
   * Orderbuch; the workbook would silently put its own date back. Refused,
   * never skipped: the sync tool checks first and stops before any write.
   */
  if p_sold_at is distinct from v_sale.sold_at
     and exists (select 1 from public.orderbook_audit a
                  where a.sale_id = p_sale_id and a.entity_type = 'sale'
                    and a.action = 'update' and a.field = 'sold_at') then
    raise exception 'sale %: sold_at was corrected in SkyIsles (0181); the workbook no longer writes it', p_sale_id
      using errcode = 'restrict_violation';
  end if;

  update public.sales
     set sold_at = p_sold_at, updated_at = now()
   where id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Rechte
-- ---------------------------------------------------------------------------
revoke all on function public.seller_correct_legacy_sale_item(bigint, text, timestamptz) from public, anon;
revoke all on function public.seller_add_legacy_sale_item(bigint, text, text, text, timestamptz) from public, anon;
revoke all on function public.seller_remove_legacy_added_item(bigint, timestamptz) from public, anon;
revoke all on function public.seller_sale_item_corrections(bigint) from public, anon;
grant execute on function public.seller_correct_legacy_sale_item(bigint, text, timestamptz) to authenticated;
grant execute on function public.seller_add_legacy_sale_item(bigint, text, text, text, timestamptz) to authenticated;
grant execute on function public.seller_remove_legacy_added_item(bigint, timestamptz) to authenticated;
grant execute on function public.seller_sale_item_corrections(bigint) to authenticated;
-- create or replace keeps 0088's rights; said again so the file stands on its own.
revoke all on function public.system_sync_legacy_sale_item(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_item(bigint, text, text, text, text) to service_role;
revoke all on function public.system_sync_legacy_sale_group(bigint, date) from public, anon, authenticated;
grant execute on function public.system_sync_legacy_sale_group(bigint, date) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Nachbedingung
-- ---------------------------------------------------------------------------
do $post$
declare v_fn text;
begin
  foreach v_fn in array array[
    'seller_correct_legacy_sale_item(bigint,text,timestamptz)',
    'seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)',
    'seller_remove_legacy_added_item(bigint,timestamptz)',
    'seller_sale_item_corrections(bigint)',
    'sales_legacy_correction_sale(bigint,timestamptz)',
    'sales_legacy_correction_item(public.sale_items)',
    'sales_legacy_correction_figure(text)',
    'system_sync_legacy_sale_item(bigint,text,text,text,text)',
    'system_sync_legacy_sale_group(bigint,date)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure('public.' || v_fn)
                      and p.prosecdef
                      and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                      and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                             from unnest(p.proconfig) c where c like 'search\_path=%')) then
      raise exception '0181 postcondition: % is not a security definer with an empty search_path', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.seller_correct_legacy_sale_item(bigint,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.sales_legacy_correction_sale(bigint,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.system_sync_legacy_sale_item(bigint,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.system_sync_legacy_sale_group(bigint,date)', 'execute')
     or not has_function_privilege('service_role', 'public.system_sync_legacy_sale_group(bigint,date)', 'execute')
     or has_table_privilege('authenticated', 'public.sale_item_corrections', 'select') then
    raise exception '0181 postcondition: a client role holds a right it must not have';
  end if;
end
$post$;
-- <<< ENDE: supabase/migrations/0181_legacy_sale_item_corrections.sql

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0182_backup_sale_item_corrections.sql
-- ===========================================================================
-- 0182 — THE HAND CORRECTIONS OF 0181 IN BOTH BACKUPS (ADR-0134, ADR-0135, ADR-0179)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Staging only, after a separate approval by the operator, and only    ##
-- ##  AFTER `0181` (the bodies read the table it creates).                 ##
-- ###########################################################################
--
-- WHAT FOR. `0181` creates `sale_item_corrections`, the append-only record
-- of every hand correction of a position of an imported workbook sale: the
-- figure the workbook said, the figure it became, the line a correction
-- added and its removal. ADR-0134 demands that every table be decided in
-- BOTH backups, and the record has to stay interpretable after a restore:
--
--   * it is the only place that still names the workbook's ORIGINAL figure
--     of a corrected line once `sale_items.sky_id` was changed;
--   * it is what the workbook sync of `0181` checks before it writes —
--     restored without it, a later sync would put the old figures back.
--
-- So it goes into the business backup AND the platform backup, the way
-- `0174` took the reconciliation record into both. 10 of 12 columns:
--
--   sale_item_corrections   id, sale_id, sale_item_id, action, position,
--                           old_sky_id, old_raw_name, new_sky_id,
--                           new_raw_name, corrected_at
--
-- EXACTLY TWO COLUMNS STAY OUT, and both by existing rule of both manifests:
--
--   * `corrected_by` — an account identity ("Kontoidentität");
--   * `source_row` — the row number in the old workbook. Both backups keep
--     the legacy machinery out entirely (`FORBIDDEN_FIELDS`), and
--     `sale_items.source_row` is not exported either. The record stays
--     readable without it: `sale_item_id` and `position` name the line,
--     `old_sky_id` and `old_raw_name` what the workbook said.
--
-- Nothing new is invented here. The raw names go out raw (rule 4). No buyer
-- data: the table has no column for it.
--
-- WHAT IT DOES — TWO FUNCTION BODIES, NOTHING ELSE:
--
--   1. `seller_business_backup()`: the body from `0174`, character for
--      character, plus ONE contiguous block — a comment and the area —
--      between `sales_recon_applications` and `orders`. 35 areas become 36.
--      `format_version` stays **1** (ADR-0114: a new area does not raise it).
--   2. `system_platform_export()`: the body from `0174`, character for
--      character, plus three changes:
--        a. `'format_version', 3` becomes `'format_version', 4`;
--        b. the group header "Lager und Orderbuch" says 21 areas / 42
--           arguments instead of 20 / 40 — far below the 100-argument
--           limit and the 80 that `platform-sql.test.ts` enforces;
--        c. one contiguous block — a comment and the area — between
--           `sales_recon_applications` and `seller_monthly_reports`.
--      61 sections become 62. THE VERSION RISES, as in `0144` and `0174`
--      (ADR-0135): the archive reader certifies completeness by
--      `SECTIONS_BY_FORMAT_VERSION` (`1: 53, 2: 54, 3: 61, 4: 62`). Older
--      archives stay readable: version 3 with 61, 2 with 54, 1 with 53.
--
-- WHAT IT DOES NOT DO. No table, column, index, policy, trigger or right. No
-- row is read or written while it runs. It does not touch `0181`'s table or
-- functions, the sales book or any other function. Both functions stay
-- `stable`, `security definer`, empty `search_path`, behind their gates
-- (`can_operate_active_seller()`, `is_platform_admin()`); `create or
-- replace` keeps both ACLs, and section 4 checks them.
--
-- THREE LATCHES PER FUNCTION, the pattern of `0153`/`0160`/`0164`/`0174`:
--
--   1. `0181` must be applied — `sale_item_corrections` exists with all
--      ten exported columns.
--   2. The existing body MUST be the previous one:
--        seller_business_backup()  md5 **3a798f506f5f43e5b1b69dc242a1b16f** (0174, 26388 chars)
--        system_platform_export()  md5 **23be72d581589b063d6938a863757b31** (0174, 35715 chars)
--      A foreign version is not overwritten blindly.
--   3. A second run bounces off latch 2, because afterwards the bodies are
--        seller_business_backup()  md5 **b42609b64d8771f1792a09b344ba80de** (27009 chars)
--        system_platform_export()  md5 **307e1c10a99afdaa683292e2a495e8ad** (36366 chars)
--      and section 1 says so by name.
--
-- Both are checked BEFORE either function is replaced, and section 4 checks
-- the result. Run the file as ONE unit: any failure leaves both functions as
-- they were. `src/lib/backup/backup-sale-item-corrections.test.ts` recomputes
-- the fingerprints' sources on every test run and proves new = old + exactly
-- the block; `npm run verify:check-sql` (P82) creates both bodies in real
-- PostgreSQL, exports a correction through both and restores it from the
-- archive.
--
-- Rollback: `supabase/rollback/R0182_backups_without_sale_item_corrections.sql`
-- (both bodies of `0174`, character for character). It must run BEFORE
-- `R0181`, which drops the table: a SQL function body records no dependency,
-- so the drop would succeed and every export would then fail.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Preconditions — both functions, before either is replaced
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_business text;
  v_platform text;
begin
  if to_regclass('public.sale_item_corrections') is null then
    raise exception '0182 needs 0181: public.sale_item_corrections is missing';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.sale_item_corrections') and a.attnum > 0
         and not a.attisdropped
         and a.attname in ('id', 'sale_id', 'sale_item_id', 'action', 'position', 'old_sky_id', 'old_raw_name', 'new_sky_id', 'new_raw_name', 'corrected_at')) <> 10 then
    raise exception '0182 needs 0181: sale_item_corrections lacks an exported column';
  end if;
  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0182 needs 0104/0174: seller_business_backup() is missing';
  end if;
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0182 needs 0105/0174: system_platform_export() is missing';
  end if;

  select md5(p.prosrc) into v_business from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  select md5(p.prosrc) into v_platform from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  -- Latch 3: already applied (either half).
  if v_business = 'b42609b64d8771f1792a09b344ba80de' or v_platform = '307e1c10a99afdaa683292e2a495e8ad' then
    raise exception '0182 abort: a body already carries the fingerprint of this '
      'migration (business %, platform %). It is applied here already.',
      v_business, v_platform;
  end if;

  -- Latch 2: exactly the previous bodies.
  if v_business is distinct from '3a798f506f5f43e5b1b69dc242a1b16f' then
    raise exception '0182 abort: seller_business_backup() is % and not the body '
      'from 0174 (3a798f506f5f43e5b1b69dc242a1b16f). A foreign version is not overwritten blindly.',
      coalesce(v_business, '(none)');
  end if;
  if v_platform is distinct from '23be72d581589b063d6938a863757b31' then
    raise exception '0182 abort: system_platform_export() is % and not the body '
      'from 0174 (23be72d581589b063d6938a863757b31). A foreign version is not overwritten blindly.',
      coalesce(v_platform, '(none)');
  end if;

  /*
   * THE RIGHTS AS THEY STAND — recorded, so the postcondition can prove that
   * this migration did not move them (the contract of 0174, see there for
   * why the service_role grant on the business backup is left alone). What
   * stays forbidden, before AND after: EXECUTE for PUBLIC or anon; a NULL
   * ACL is the PostgreSQL default, which grants PUBLIC.
   */
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in (to_regprocedure('public.seller_business_backup()'),
                              to_regprocedure('public.system_platform_export()'))
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0182 abort: PUBLIC or anon may already execute a backup function. '
      'That is a finding of its own and is not carried into a new body.';
  end if;
  perform set_config('skyisles.acl_0182_business',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.seller_business_backup()')), '(default)'), false);
  perform set_config('skyisles.acl_0182_platform',
    coalesce((select p.proacl::text from pg_proc p
               where p.oid = to_regprocedure('public.system_platform_export()')), '(default)'), false);
end
$pre$;


-- ---------------------------------------------------------------------------
-- 2. The business backup: the body from `0174`, plus the one area
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
  
      /* ------------------------------ Sales reconciliation (0169, 0174) */
      /*
       * The record of every reconciliation of a platform report against
       * the sales book: sessions, files, orders, matches, findings,
       * decisions and applications. A decision is only readable together
       * with its finding, match, order and sale, so all seven come along.
       * sales_recon_orders leaves out ONE column, lines (the purgeable
       * position snapshot) - every value an audit needs is in
       * sales_recon_findings. No account identity, no buyer data.
       */
      'sales_recon_sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'channel', t.channel,
          'parser', t.parser,
          'parser_version', t.parser_version,
          'state', t.state,
          'files_key', t.files_key,
          'covered_from', t.covered_from,
          'covered_to', t.covered_to,
          'record_first', t.record_first,
          'record_last', t.record_last,
          'chain_complete', t.chain_complete,
          'summary', t.summary,
          'created_at', t.created_at,
          'closed_at', t.closed_at,
          'discarded_at', t.discarded_at,
          'snapshots_purged_at', t.snapshots_purged_at
        ) order by t.id)
          from public.sales_recon_sessions t
      ), '[]'::jsonb),
  
      'sales_recon_files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'file_name', t.file_name,
          'fingerprint', t.fingerprint,
          'footer_count', t.footer_count,
          'orders', t.orders,
          'first_sold_on', t.first_sold_on,
          'last_sold_on', t.last_sold_on,
          'record_first', t.record_first,
          'record_last', t.record_last
        ) order by t.id)
          from public.sales_recon_files t
      ), '[]'::jsonb),
  
      'sales_recon_orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'channel', t.channel,
          'order_ref', t.order_ref,
          'record_no', t.record_no,
          'sold_on', t.sold_on,
          'paid_on', t.paid_on,
          'shipped_on', t.shipped_on,
          'items_value', t.items_value::text,
          'shipping', t.shipping::text,
          'total', t.total::text,
          'pieces', t.pieces,
          'combined', t.combined,
          'destination_country', t.destination_country,
          'shipping_service', t.shipping_service,
          'source_file', t.source_file
        ) order by t.id)
          from public.sales_recon_orders t
      ), '[]'::jsonb),
  
      'sales_recon_matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'session_id', t.session_id,
          'order_id', t.order_id,
          'sale_id', t.sale_id,
          'category', t.category,
          'certainty', t.certainty,
          'score', t.score::text,
          'date_delta', t.date_delta,
          'competitors', t.competitors,
          'reason', t.reason,
          'sale_updated_at', t.sale_updated_at
        ) order by t.id)
          from public.sales_recon_matches t
      ), '[]'::jsonb),
  
      'sales_recon_findings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'match_id', t.match_id,
          'finding_key', t.finding_key,
          'field', t.field,
          'kind', t.kind,
          'ledger_value', t.ledger_value,
          'external_value', t.external_value,
          'delta', t.delta::text,
          'causes', t.causes,
          'allowed_decisions', t.allowed_decisions
        ) order by t.id)
          from public.sales_recon_findings t
      ), '[]'::jsonb),
  
      'sales_recon_decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'finding_id', t.finding_id,
          'decision', t.decision,
          'manual_value', t.manual_value,
          'reason', t.reason,
          'shown_ledger', t.shown_ledger,
          'shown_external', t.shown_external,
          'decided_at', t.decided_at
        ) order by t.id)
          from public.sales_recon_decisions t
      ), '[]'::jsonb),
  
      'sales_recon_applications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'decision_id', t.decision_id,
          'session_id', t.session_id,
          'sale_id', t.sale_id,
          'field', t.field,
          'outcome', t.outcome,
          'old_value', t.old_value,
          'new_value', t.new_value,
          'applied_at', t.applied_at
        ) order by t.id)
          from public.sales_recon_applications t
      ), '[]'::jsonb),
  
      /* ----------- Hand corrections of workbook positions (0181, 0182) */
      'sale_item_corrections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'sale_id', t.sale_id,
          'sale_item_id', t.sale_item_id,
          'action', t.action,
          'position', t.position,
          'old_sky_id', t.old_sky_id,
          'old_raw_name', t.old_raw_name,
          'new_sky_id', t.new_sky_id,
          'new_raw_name', t.new_raw_name,
          'corrected_at', t.corrected_at
        ) order by t.id)
          from public.sale_item_corrections t
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
  'A snapshot of the business data as JSON (0104; receipts in 0129, cost parts and catalogue order in 0130, seller master data in 0131, item type in 0136, sale release and age rating in 0140, sales reconciliation in 0174, hand corrections of workbook positions in 0182) - 36 areas in ONE statement and therefore from ONE MVCC snapshot. Reads only. Since 0174 the seven sales_recon_* tables of 0169 are areas: sessions, files, orders, matches, findings, decisions and applications, so that every decision stays readable after a restore together with its finding, match, order and sale. sales_recon_orders leaves out lines, the purgeable position snapshot - every value an audit needs is in sales_recon_findings. Since 0182 sale_item_corrections (0181) is an area: every hand correction of a workbook position with its old and new figure and raw name, so that after a restore the workbook original of every corrected line stays provable and the sync guard of 0181 still has its record. Account identities (created_by, closed_by, discarded_by, decided_by, applied_by, corrected_by) stay out, as everywhere in this export; the tables hold no buyer data. Sender, listing and purchase agreement of a purchase stay EXPLICITLY out (personal, open retention question); account identities, master-data timestamps and payment-provider internals as well. format_version stays 1: a new area does not raise it (ADR-0114). No restore: restore_supported is false.';


-- ---------------------------------------------------------------------------
-- 3. The platform export: the body from `0174`, version 4, the one section
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
    'format_version', 4,
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
      /* ---- Lager und Orderbuch — 21 Bereiche, 42 Argumente ---- */
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

        /* Sales reconciliation (0169, added by 0174): seven sections. */
        'sales_recon_sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'parser', t.parser,
            'parser_version', t.parser_version,
            'state', t.state,
            'files_key', t.files_key,
            'covered_from', t.covered_from,
            'covered_to', t.covered_to,
            'record_first', t.record_first,
            'record_last', t.record_last,
            'chain_complete', t.chain_complete,
            'summary', t.summary,
            'created_at', t.created_at,
            'closed_at', t.closed_at,
            'discarded_at', t.discarded_at,
            'snapshots_purged_at', t.snapshots_purged_at
          ) order by t.id)
            from public.sales_recon_sessions t
        ), '[]'::jsonb),

        'sales_recon_files', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'file_name', t.file_name,
            'fingerprint', t.fingerprint,
            'footer_count', t.footer_count,
            'orders', t.orders,
            'first_sold_on', t.first_sold_on,
            'last_sold_on', t.last_sold_on,
            'record_first', t.record_first,
            'record_last', t.record_last
          ) order by t.id)
            from public.sales_recon_files t
        ), '[]'::jsonb),

        'sales_recon_orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'channel', t.channel,
            'order_ref', t.order_ref,
            'record_no', t.record_no,
            'sold_on', t.sold_on,
            'paid_on', t.paid_on,
            'shipped_on', t.shipped_on,
            'items_value', t.items_value::text,
            'shipping', t.shipping::text,
            'total', t.total::text,
            'pieces', t.pieces,
            'combined', t.combined,
            'destination_country', t.destination_country,
            'shipping_service', t.shipping_service,
            'source_file', t.source_file
          ) order by t.id)
            from public.sales_recon_orders t
        ), '[]'::jsonb),

        'sales_recon_matches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'session_id', t.session_id,
            'order_id', t.order_id,
            'sale_id', t.sale_id,
            'category', t.category,
            'certainty', t.certainty,
            'score', t.score::text,
            'date_delta', t.date_delta,
            'competitors', t.competitors,
            'reason', t.reason,
            'sale_updated_at', t.sale_updated_at
          ) order by t.id)
            from public.sales_recon_matches t
        ), '[]'::jsonb),

        'sales_recon_findings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'match_id', t.match_id,
            'finding_key', t.finding_key,
            'field', t.field,
            'kind', t.kind,
            'ledger_value', t.ledger_value,
            'external_value', t.external_value,
            'delta', t.delta::text,
            'causes', t.causes,
            'allowed_decisions', t.allowed_decisions
          ) order by t.id)
            from public.sales_recon_findings t
        ), '[]'::jsonb),

        'sales_recon_decisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'finding_id', t.finding_id,
            'decision', t.decision,
            'manual_value', t.manual_value,
            'reason', t.reason,
            'shown_ledger', t.shown_ledger,
            'shown_external', t.shown_external,
            'decided_at', t.decided_at
          ) order by t.id)
            from public.sales_recon_decisions t
        ), '[]'::jsonb),

        'sales_recon_applications', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'decision_id', t.decision_id,
            'session_id', t.session_id,
            'sale_id', t.sale_id,
            'field', t.field,
            'outcome', t.outcome,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'applied_at', t.applied_at
          ) order by t.id)
            from public.sales_recon_applications t
        ), '[]'::jsonb),

        /* ----------- Hand corrections of workbook positions (0181, 0182) */
        'sale_item_corrections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'sale_item_id', t.sale_item_id,
            'action', t.action,
            'position', t.position,
            'old_sky_id', t.old_sky_id,
            'old_raw_name', t.old_raw_name,
            'new_sky_id', t.new_sky_id,
            'new_raw_name', t.new_raw_name,
            'corrected_at', t.corrected_at
          ) order by t.id)
            from public.sale_item_corrections t
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
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153, 0160, 0164, 0174 and 0182) - the archive file database.json. 62 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and carry 53 sections. 0153, 0160 and 0164 added FIELDS (catalog_status, base_sky_id, the CAT-10 type system), which left the version alone. 0174 adds the seven sales reconciliation tables of 0169 as SECTIONS and therefore raises format_version to 3, exactly as 0144 did: archives of version 2 stay valid and carry 54 sections. sales_recon_orders leaves out lines, the purgeable position snapshot; every value an audit needs is in sales_recon_findings. 0182 adds sale_item_corrections (0181), the append-only record of every hand correction of a workbook position, as a SECTION and raises format_version to 4: archives of version 3 stay valid and carry 61 sections; corrected_by stays out as an account identity. There is still no restore - format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';


-- ---------------------------------------------------------------------------
-- 4. Postconditions — both bodies, both shapes, both ACLs
-- ---------------------------------------------------------------------------
do $post$
declare
  v_fn      text;
  v_src     text;
  v_block   text;
  v_open    integer;
  v_acl     text;
  v_before  text;
begin
  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.seller_business_backup()');
  if md5(v_src) is distinct from 'b42609b64d8771f1792a09b344ba80de' or length(v_src) <> 27009 then
    raise exception '0182 postcondition: seller_business_backup() is % (% chars), '
      'expected b42609b64d8771f1792a09b344ba80de (27009)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 36 then
    raise exception '0182 postcondition: the business backup does not carry 36 areas';
  end if;
  if strpos(v_src, '''format_version'',  1,') = 0 then
    raise exception '0182 postcondition: the business format_version is not 1 any more';
  end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');
  if md5(v_src) is distinct from '307e1c10a99afdaa683292e2a495e8ad' or length(v_src) <> 36366 then
    raise exception '0182 postcondition: system_platform_export() is % (% chars), '
      'expected 307e1c10a99afdaa683292e2a495e8ad (36366)', md5(v_src), length(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, 'coalesce((', ''))) / length('coalesce((') <> 62 then
    raise exception '0182 postcondition: the platform export does not carry 62 sections';
  end if;
  if strpos(v_src, '''format_version'', 4,') = 0 then
    raise exception '0182 postcondition: the platform format_version is not 4';
  end if;

  foreach v_fn in array array['public.seller_business_backup()',
                              'public.system_platform_export()'] loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_fn);
    -- The area is there, and it carries no account identity.
    v_block := substr(v_src, strpos(v_src, '''sale_item_corrections'', coalesce(('));
    v_block := left(v_block, strpos(v_block, 'from public.sale_item_corrections t'));
    if v_block = '' or strpos(v_block, '''old_sky_id''') = 0 or strpos(v_block, '''old_raw_name''') = 0 then
      raise exception '0182 postcondition: % has no sale_item_corrections area with the originals', v_fn;
    end if;
    if strpos(v_block, '''corrected_by''') > 0 or strpos(v_block, '''source_row''') > 0 then
      raise exception '0182 postcondition: % exports corrected_by or source_row', v_fn;
    end if;

    -- Shape and rights, unchanged.
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_fn)
                      and p.prosecdef and p.provolatile = 's'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0182 postcondition: % lost security definer, stable or '
        'its search_path', v_fn;
    end if;
    select count(*) into v_open
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = to_regprocedure(v_fn)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
    if v_open <> 0 then
      raise exception '0182 postcondition: % open EXECUTE rights on %', v_open, v_fn;
    end if;
    select coalesce(p.proacl::text, '(default)') into v_acl from pg_proc p
     where p.oid = to_regprocedure(v_fn);
    v_before := current_setting(case v_fn when 'public.seller_business_backup()'
                                  then 'skyisles.acl_0182_business'
                                  else 'skyisles.acl_0182_platform' end, true);
    if v_before is null or v_before = '' then
      raise exception '0182 postcondition: the rights of % were not recorded before', v_fn;
    end if;
    if v_acl is distinct from v_before then
      raise exception '0182 postcondition: the rights on % changed (% -> %)', v_fn, v_before, v_acl;
    end if;
  end loop;
  perform set_config('skyisles.acl_0182_business', '', false);
  perform set_config('skyisles.acl_0182_platform', '', false);

  raise notice '0182: business backup b42609b64d8771f1792a09b344ba80de, 36 areas, format_version 1; '
    'platform export 307e1c10a99afdaa683292e2a495e8ad, 62 sections, format_version 4. No row touched.';
end
$post$;
-- <<< ENDE: supabase/migrations/0182_backup_sale_item_corrections.sql

/* Z0 — dieselben Messungen nachher, in derselben Form. */
create temporary table corr_0181_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_refunds t) as sale_refunds,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_fees t) as sale_fees,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.legacy_stock_events t) as legacy_stock_events,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('seller_correct_legacy_sale_item', 'seller_add_legacy_sale_item', 'seller_remove_legacy_added_item', 'seller_sale_item_corrections', 'sales_legacy_correction_sale', 'sales_legacy_correction_item', 'sales_legacy_correction_figure', 'sale_item_corrections_append_only')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and c.relname not in ('sale_item_corrections', 'sale_item_corrections_id_seq')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt: keine Zeile, kein Recht, keine Policy. */
  if exists (select 1 from pg_temp.corr_0181_vorher v, pg_temp.corr_0181_nachher n
              where (v.sales, v.sale_items, v.sale_refunds, v.sale_fees, v.inventory_movements, v.legacy_stock_events, v.orderbook_audit, v.order_reservations, v.shop_inventory, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sales, n.sale_items, n.sale_refunds, n.sale_fees, n.inventory_movements, n.legacy_stock_events, n.orderbook_audit, n.order_reservations, n.shop_inventory, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die Fassungen aus 0181 und 0182 stehen, und Journalhelfer und normale Positionswege sind die alten. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)')) is distinct from '3d79cf1706961107464a720035c914e6'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)')) is distinct from 'd7b5ba1020ce4490299e2fe21075e7f3'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)')) is distinct from 'd20ab29004e12c2c5d308bf024c964ed'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_sale_item_corrections(bigint)')) is distinct from '547a44013c3b29e563ef7c390a586bac'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_sale(bigint,timestamptz)')) is distinct from '715081a60a5bc9b667634cda7dc70fbc'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_item(public.sale_items)')) is distinct from 'ca3e1200efc8753d94f9034a3024cbe5'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sales_legacy_correction_figure(text)')) is distinct from '230487e64d50e8ec669b55f20882d629'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.sale_item_corrections_append_only()')) is distinct from 'aedd3c64076884fbf29d0308f5e26ec7'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)')) is distinct from '54b6c5d96992db8fce723732d277b3f6'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)')) is distinct from 'b020a3d90901b3d64585b534eb8b119e'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')) is distinct from 'b42609b64d8771f1792a09b344ba80de'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')) is distinct from '307e1c10a99afdaa683292e2a495e8ad'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)')) is distinct from 'a8a7e665d64e656e0ecc6515f55b3cb7'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)')) is distinct from '3152b6595d78de9b479199da28b05411'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_touch_sale(bigint)')) is distinct from 'cd7584eabbe65b43d834b2709d6ff792'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_add_sale_item(bigint,text,text,text)')) is distinct from 'da912f44a62052d52fd6da1bd8cfdd19'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_remove_sale_item(bigint)')) is distinct from '81011d31798d10ab12bac5f0e906be91'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_set_sale_item_sky(bigint,text)')) is distinct from 'f46a0011b33230e66f782e12acc81cf6'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.hold_sale_item(bigint)')) is distinct from 'bf3502a3f6f5ec849a4ef22785063431' then
    raise exception 'ABBRUCH Z2: die Fassung aus 0181 oder 0182 steht nicht, oder ein Journalhelfer oder normaler Positionsweg hat sich bewegt';
  end if;

  /* Z3 — die Rechte: Korrekturwege und Lesefunktion nur authenticated, Helfer niemand, Sync service_role, Spur ohne Clientrecht. */
  if (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.sales_legacy_correction_sale(bigint,timestamptz)'),
                        to_regprocedure('public.sales_legacy_correction_item(public.sale_items)'),
                        to_regprocedure('public.sales_legacy_correction_figure(text)'),
                        to_regprocedure('public.sale_item_corrections_append_only()'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) <> '0'
     or (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) <> '0'
     or not has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_item(bigint,text,text,text,text)'), 'execute')
     or (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in (to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) <> '0'
     or not has_function_privilege('service_role', to_regprocedure('public.system_sync_legacy_sale_group(bigint,date)'), 'execute')
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_correct_legacy_sale_item(bigint,text,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0)))
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_add_legacy_sale_item(bigint,text,text,text,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0)))
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_remove_legacy_added_item(bigint,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0)))
     or not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_sale_item_corrections(bigint)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_sale_item_corrections(bigint)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_sale_item_corrections(bigint)') and a.privilege_type = 'EXECUTE' and a.grantee = 0)))
     or not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.sale_item_corrections')), false)
     or exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                 where c.oid = to_regclass('public.sale_item_corrections')
                   and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception 'ABBRUCH Z3: ein Recht von 0181 steht nicht wie zugesagt';
  end if;

  /* Z4 — die Spur ist leer: 0181 schreibt keine Zeile. */
  if exists (select 1 from public.sale_item_corrections) then
    raise exception 'ABBRUCH Z4: die Spur sale_item_corrections ist nicht leer';
  end if;

  raise notice '0181+0182 ok: Positionen importierter Verkaeufe korrigierbar, Spur append-only und leer, der Sync weist korrigierte Zeilen und korrigierte Daten ab, beide Sicherungen fuehren die Spur. Keine Zeile bewegt.';
end
$lauf_z$;

commit;
