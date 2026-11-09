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
