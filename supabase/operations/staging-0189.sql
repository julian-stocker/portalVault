-- ===========================================================================
-- STAGING — EIN LAUF FUER 0189
--            (seller_cancel_external_sale sperrt auch die Positionen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0189`, diese Datei,
-- `npm run db:migrate:staging -- 0189 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt NUR den Rumpf von
-- `seller_cancel_external_sale(bigint,text,date,timestamptz)`; bricht sie ab, ist nichts angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher Verkaeufe, Positionen,
-- Reservierungen, Lager, Bewegungen, Journal und Sammlung, den Rumpf der
-- Buchung, die Rechte jeder Funktion (AUCH dieser — sie bleiben) und jeder
-- Tabelle, jede Policy und jeden anderen Funktionsrumpf. Z1 misst nachher
-- dasselbe und bricht ab, wenn sich auch nur ein Wert bewegt hat. Z2 prueft
-- den neuen Rumpf und die Helfer, Z3 Rechte und Form.
--
-- NUR STAGING (Production hat 0170 nicht). ERWARTET: die NOTICE `0189 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
  /* A3 — noch der Rumpf aus 0170: 0189 ist nicht angewendet, und es ist die bekannte Fassung. */
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)')) is distinct from '8b6496f3c20f8b706db7eb1df2d8c32b' then
    raise exception 'ABBRUCH A3: seller_cancel_external_sale(bigint,text,date,timestamptz) ist nicht die Fassung aus 0170 — 0189 schon angewendet oder unbekannter Stand';
  end if;
end
$lauf_a$;

/* A2 — Daten, Rechte und Ruempfe, vorher gemessen. */
create temporary table t0189_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_book_sale_item(bigint)')) as buchung,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public') as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc), chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)')) as andere_ruempfe;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0189_external_cancel_lock_order.sql
-- ===========================================================================
-- 0189 — seller_cancel_external_sale: die Positionen sperren, bevor geprüft wird
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  STAGING ONLY: the function exists only where 0170 is applied.        ##
-- ##  Production (0167) does NOT have 0170 — this file refuses to run      ##
-- ##  there instead of creating the function out of order.                 ##
-- ###########################################################################
--
-- WARUM (M-05C, Stability Baseline 1, 2026-11-10)
--
-- Die Fassung aus `0170` sperrt den Verkauf, prüft aber OHNE Positionssperre,
-- ob eine Position schon gebucht ist. Auf echtem PostgreSQL reproduziert
-- (`src/lib/orderbook/sale-race-0188-0189.test.ts`):
--
--   ohne Hold  Eine Buchung hält ihre Position, steht am Lager an und hat den
--              Verkauf ungesperrt als "nicht storniert" gelesen. Der Storno
--              sperrt den Verkauf, sieht keine Buchung, storniert und
--              committet; danach committet die Buchung. Ergebnis: ein
--              STORNIERTER Verkauf mit gebuchter Position und Lagerbewegung.
--   mit Hold   Die Buchung hält zusätzlich die umgewandelte Reservierung und
--              will den Verkauf; der Storno hält den Verkauf und will die
--              Reservierung — DEADLOCK (40P01), PostgreSQL bricht einen ab.
--
-- DIE KORREKTUR. Nach der vorhandenen Sperre des Verkaufs werden alle seine
-- Positionen `for update nowait` gesperrt — genau wie in `0188`. Neue
-- Positionen kann es dabei nicht geben (die Verkaufssperre verträgt sich nicht
-- mit dem FOR KEY SHARE ihres Fremdschlüssels). Ist eine Position gerade in
-- Arbeit, bricht der Storno ab (55P03) statt zu warten oder Falsches zu sehen;
-- er kann wiederholt werden. Der Rest des Rumpfs ist WORTGLEICH der aus 0170.
--
-- KEINE PFLICHT-VERSION. `p_expected_updated_at` bleibt optional: die Race
-- schließt die Sperre, nicht die Version. Keine andere Funktion ändert sich.
-- Signatur, Rückgabe und Geschäftsregeln unverändert; `security definer`,
-- `search_path = ''`; Rechte ausdrücklich authenticated und service_role.
--
-- RÜCKNAHME: `supabase/rollback/R0189_external_cancel_lock_order.sql` (die
-- Fassung aus 0170, wortgleich).
-- ===========================================================================

do $pre$
begin
  /* Nur wo 0170 liegt. Ein `create or replace` legte die Funktion sonst NEU an —
     auf Production, ohne den Rest von 0170. */
  if to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null then
    raise exception '0189 precondition: seller_cancel_external_sale (0170) does not exist here — 0189 applies only where 0170 is applied';
  end if;
  if to_regprocedure('public.release_sale_item_hold(bigint)') is null
     or to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)') is null then
    raise exception '0189 precondition: release_sale_item_hold (0110) or orderbook_guard_stale (0062) is missing';
  end if;
end
$pre$;

create or replace function public.seller_cancel_external_sale(
  p_id bigint,
  p_reason text,
  p_cancelled_on date default null,
  p_expected_updated_at timestamptz default null
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sale public.sales;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on date := coalesce(p_cancelled_on, current_date);
  v_item record;
  v_released integer := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'a cancellation needs a reason (at most 500 characters)' using errcode = 'check_violation';
  end if;
  if v_on < date '2000-01-01' or v_on > current_date + 1 then
    raise exception 'that cancellation date is outside the plausible range' using errcode = 'check_violation';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  if v_sale.order_id is not null then
    raise exception 'an order is cancelled in commerce, not in the Orderbuch' using errcode = 'restrict_violation';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'this sale is already cancelled' using errcode = 'restrict_violation';
  end if;
  if v_sale.stock_released_at is not null then
    raise exception 'a sale released for stock work cannot be cancelled' using errcode = 'restrict_violation';
  end if;
  /*
   * Jede Position des Verkaufs, ohne zu warten (0189). Der Verkauf ist schon
   * gesperrt; eine laufende Buchung hält ihre Position und will danach den
   * Verkauf — warten hieße Deadlock, und ohne diese Sperre sähe die Prüfung
   * darunter eine Buchung nicht, die gerade entsteht.
   */
  begin
    perform 1 from public.sale_items where sale_id = p_id order by id for update nowait;
  exception when lock_not_available then
    raise exception 'a position of this sale is being changed right now; nothing was cancelled, try again'
      using errcode = 'lock_not_available';
  end;

  if exists (select 1 from public.sale_items i
              where i.sale_id = p_id
                and (i.movement_id is not null or i.return_movement_id is not null
                     or i.returned_at is not null or i.return_announced_at is not null
                     or i.settled_at is not null)) then
    raise exception 'a position of this sale has already ended (booked out, returned or settled)'
      using errcode = 'restrict_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  for v_item in select i.id from public.sale_items i where i.sale_id = p_id order by i.id loop
    if public.release_sale_item_hold(v_item.id) = 'released' then
      v_released := v_released + 1;
    end if;
  end loop;

  update public.sales
     set cancelled_at = v_on::timestamptz, updated_at = now(), updated_by = (select auth.uid())
   where id = p_id;

  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancelled_at', null, v_on::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'cancel_reason', null, v_reason);
  return v_released;
end;
$$;

comment on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) is
  'Cancels an external sale (0170, ADR-0174; locking 0189): locks the sale, then every position without waiting (a booking in flight makes it fail with 55P03 instead of a wrong state or a deadlock), releases its holds without any inventory movement, sets cancelled_at, audits date and reason. Refuses internal, already cancelled, released-historical sales and any sale with an ended position. Returns the number of holds released.';

revoke all on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) from public, anon;
grant execute on function public.seller_cancel_external_sale(bigint, text, date, timestamptz) to authenticated, service_role;

do $post$
declare v_sig constant text := 'public.seller_cancel_external_sale(bigint,text,date,timestamptz)';
begin
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure(v_sig) and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0189 postcondition: seller_cancel_external_sale is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', v_sig, 'execute')
     or not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(v_sig) and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0189 postcondition: the rights of seller_cancel_external_sale are not as promised';
  end if;
end
$post$;
-- <<< ENDE: supabase/migrations/0189_external_cancel_lock_order.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table t0189_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sales t) as sales,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sale_items t) as sale_items,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.order_reservations t) as order_reservations,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orderbook_audit t) as orderbook_audit,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_book_sale_item(bigint)')) as buchung,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public') as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc), chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)')) as andere_ruempfe;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt. */
  if exists (select 1 from pg_temp.t0189_vorher v, pg_temp.t0189_nachher n
              where (v.sales, v.sale_items, v.order_reservations, v.shop_inventory, v.inventory_movements, v.orderbook_audit, v.collection_items, v.buchung, v.funktionsrechte, v.tabellenrechte, v.policies, v.andere_ruempfe)
                    is distinct from (n.sales, n.sale_items, n.order_reservations, n.shop_inventory, n.inventory_movements, n.orderbook_audit, n.collection_items, n.buchung, n.funktionsrechte, n.tabellenrechte, n.policies, n.andere_ruempfe)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte, Policies oder einen anderen Rumpf bewegt — nichts wird angewendet';
  end if;

  /* Z2 — der neue Rumpf aus 0189; die gerufenen Helfer unveraendert. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)')) is distinct from '1a67b44de9da7fa96349aa197a05c027'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_operate_active_seller()')) is distinct from '3e220b0b1a0b33d0b5ad9afc1be4719d'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_guard_stale(bigint,timestamptz)')) is distinct from '3152b6595d78de9b479199da28b05411'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.orderbook_log(bigint,text,bigint,text,text,text,text)')) is distinct from 'a8a7e665d64e656e0ecc6515f55b3cb7'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.release_sale_item_hold(bigint)')) is distinct from 'fa55019eae858efa4fed3186b581a7f5' then
    raise exception 'ABBRUCH Z2: ein Rumpf steht nicht wie zugesagt';
  end if;

  /* Z3 — Rechte und Form: authenticated und service_role, nie anon oder PUBLIC. */
  if not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)'), 'execute')
               and has_function_privilege('service_role', to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))) or (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) <> '1' then
    raise exception 'ABBRUCH Z3: ein Recht oder die Form von seller_cancel_external_sale steht nicht wie zugesagt';
  end if;

  raise notice '0189 ok: seller_cancel_external_sale sperrt jetzt Verkauf und Positionen vor dem Stornieren; keine Zeile, kein Recht, kein anderer Rumpf bewegt.';
end
$lauf_z$;

commit;
