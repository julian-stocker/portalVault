-- ===========================================================================
-- STAGING — EIN LAUF FUER 0188
--            (seller_delete_sale sperrt erst den Verkauf, dann seine Positionen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0188`, diese Datei,
-- `npm run db:migrate:staging -- 0188 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie ersetzt NUR den Rumpf von
-- `seller_delete_sale(bigint)`; bricht sie ab, ist nichts angewendet.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher Verkaeufe, Positionen,
-- Reservierungen, Lager, Bewegungen, Journal und Sammlung, den Rumpf der
-- Buchung, die Rechte jeder Funktion (AUCH dieser — sie bleiben) und jeder
-- Tabelle, jede Policy und jeden anderen Funktionsrumpf. Z1 misst nachher
-- dasselbe und bricht ab, wenn sich auch nur ein Wert bewegt hat. Z2 prueft
-- den neuen Rumpf und die Helfer, Z3 Rechte und Form.
--
-- DIESER LAUF IST FUER STAGING. ERWARTET: die NOTICE `0188 ok`, dann `commit`.
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
  /* A3 — noch der Rumpf aus 0110: 0188 ist nicht angewendet, und es ist die bekannte Fassung. */
  if to_regprocedure('public.seller_delete_sale(bigint)') is null or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_delete_sale(bigint)')) is distinct from 'e64a0822c3cda50a1a26b0f8cf456144' then
    raise exception 'ABBRUCH A3: seller_delete_sale(bigint) ist nicht die Fassung aus 0110 — 0188 schon angewendet oder unbekannter Stand';
  end if;
end
$lauf_a$;

/* A2 — Daten, Rechte und Ruempfe, vorher gemessen. */
create temporary table t0188_vorher on commit drop as
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
    where n.nspname = 'public' and p.oid <> to_regprocedure('public.seller_delete_sale(bigint)')) as andere_ruempfe;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0188_sale_delete_lock_order.sql
-- ===========================================================================
-- 0188 — seller_delete_sale: erst den Verkauf, dann seine Positionen sperren
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Each environment only after a separate approval by the operator.     ##
-- ###########################################################################
--
-- WARUM (M-05C, Stability Baseline 1, 2026-11-10)
--
-- Die Fassung aus `0110` zählt gebuchte Positionen OHNE jede Sperre und löscht
-- den Verkauf erst danach. Eine Buchung, die zwischen dem Zählen und dem
-- `delete` committet, wird vom Cascade mitgelöscht — ihre Lagerbewegung bleibt
-- stehen, ohne Verkauf und ohne Position. Auf echtem PostgreSQL mit drei
-- Verbindungen reproduziert (`src/lib/orderbook/sale-race-0188-0189.test.ts`):
-- ein Verkauf mit einer gehaltenen und einer ungehaltenen Position; das
-- Löschen wartet an der Reservierung der einen, während die andere gebucht
-- wird. Mit Hold auf der gebuchten Position fängt der Löschschutz der
-- Reservierungen (`reservations_deny_delete`, 0109) den Fall ab; ohne nicht.
--
-- DIE SPERREN, IN DIESER REIHENFOLGE:
--
--   1. DER VERKAUF, `for update`. Das ist die Sperre, mit der neue Positionen
--      kollidieren: ein `insert into sale_items` prüft seinen Fremdschlüssel
--      mit `FOR KEY SHARE` auf `sales`, und das verträgt sich nicht mit
--      `FOR UPDATE`. Solange das Löschen läuft, entsteht keine neue Position.
--      Eine Sperre nur auf die VORHANDENEN Positionen schützte davor nicht.
--
--   2. JEDE VORHANDENE POSITION, `for update nowait`. Eine laufende Buchung
--      hält ihre Position und will am Ende den Verkauf aktualisieren
--      (`seller_book_sale_item`, 0110: Position → Reservierung → Lager →
--      Verkauf). Hier auf sie zu WARTEN, während das Löschen den Verkauf hält,
--      wäre ein Deadlock. Also wird nicht gewartet: ist eine Position gerade
--      gesperrt, bricht das Löschen ab (SQLSTATE 55P03) und kann wiederholt
--      werden. Danach kann keine Buchung mehr beginnen — sie bräuchte die
--      Position zuerst.
--
--   3. ERST DANN wird gezählt, freigegeben und gelöscht — wortgleich wie in
--      0110. Die Zählung sieht jetzt den endgültigen Stand jeder Position.
--
-- KEINE ANDERE FUNKTION ÄNDERT SICH. Buchen, Halten, Hinzufügen und Entfernen
-- behalten ihre Reihenfolge; sie kollidieren mit dieser hier über die Sperren
-- 1 und 2, nicht über eine neue. Keine Advisory Locks, keine strengere
-- Isolationsstufe: die Zeilensperren reichen und sind sichtbar
-- (`pg_locks`), ein Advisory Lock müsste jede Schreibfunktion kennen.
--
-- UNVERÄNDERT: Signatur `seller_delete_sale(bigint)`, Rückgabe, jede
-- Geschäftsregel (interne Verkäufe nicht löschbar, gebuchte Positionen erst
-- zurückbuchen, Holds vor dem Cascade freigeben), ein nicht vorhandener
-- Verkauf bleibt ein stiller Leerlauf wie bisher. `security definer`,
-- `search_path = ''`. Rechte ausdrücklich: authenticated und service_role,
-- nicht PUBLIC und nicht anon (wie auf Staging gemessen).
--
-- ANWENDBAR AUF BEIDE STÄNDE. Die Funktion stammt aus 0059/0110; Staging
-- (0186) und Production (0167) tragen sie. Nichts aus 0168–0187 wird
-- vorausgesetzt.
--
-- RÜCKNAHME: `supabase/rollback/R0188_sale_delete_lock_order.sql` (die
-- Fassung aus 0110, wortgleich).
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.seller_delete_sale(bigint)') is null then
    raise exception '0188 precondition: public.seller_delete_sale(bigint) does not exist';
  end if;
  if to_regprocedure('public.release_sale_item_hold(bigint)') is null then
    raise exception '0188 precondition: public.release_sale_item_hold(bigint) (0110) does not exist';
  end if;
end
$pre$;

create or replace function public.seller_delete_sale(p_id bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_booked integer; v_item bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * 1. Der Verkauf (0188). Verträgt sich nicht mit dem FOR KEY SHARE eines
   *    neuen `sale_items`-Inserts: keine neue Position, solange dies läuft.
   */
  perform 1 from public.sales where id = p_id for update;

  /*
   * 2. Jede vorhandene Position, ohne zu warten (0188). Eine laufende Buchung
   *    hält ihre Position und will danach den Verkauf — warten hieße Deadlock.
   */
  begin
    perform 1 from public.sale_items where sale_id = p_id order by id for update nowait;
  exception when lock_not_available then
    raise exception 'a position of this sale is being changed right now; nothing was deleted, try again'
      using errcode = 'lock_not_available';
  end;

  if exists (select 1 from public.sales where id = p_id and order_id is not null) then
    raise exception 'an internal sale exists because an order was paid' using errcode = 'restrict_violation';
  end if;
  select count(*) into v_booked from public.sale_items
   where sale_id = p_id and (movement_id is not null or return_movement_id is not null);
  if v_booked > 0 then
    raise exception 'this sale has % item(s) with stock movements; reverse them first', v_booked
      using errcode = 'restrict_violation';
  end if;

  /*
   * Jeden aktiven Hold freigeben, bevor der Cascade die Positionen nimmt
   * (0110). Aufsteigend nach `id`, dieselbe Ordnung wie überall sonst.
   */
  for v_item in
    select i.id from public.sale_items i where i.sale_id = p_id order by i.id
  loop
    perform public.release_sale_item_hold(v_item);
  end loop;

  delete from public.sales where id = p_id;
end;
$$;

comment on function public.seller_delete_sale(bigint) is
  'Deletes an external sale (0059, 0110; locking 0188): locks the sale (no new position can be inserted meanwhile), then every position without waiting (a booking in flight makes it fail with 55P03 instead of a deadlock), then refuses internal sales and sales with booked positions, releases every active hold and deletes. Seller operator only.';

revoke all on function public.seller_delete_sale(bigint) from public, anon;
grant execute on function public.seller_delete_sale(bigint) to authenticated, service_role;

do $post$
declare v_sig constant text := 'public.seller_delete_sale(bigint)';
begin
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure(v_sig) and p.prosecdef
                    and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
                    and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                           from unnest(p.proconfig) c where c like 'search\_path=%')) then
    raise exception '0188 postcondition: seller_delete_sale is not a security definer with an empty search_path';
  end if;
  if has_function_privilege('anon', v_sig, 'execute')
     or not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(v_sig) and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0188 postcondition: the rights of seller_delete_sale are not as promised';
  end if;
end
$post$;
-- <<< ENDE: supabase/migrations/0188_sale_delete_lock_order.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table t0188_nachher on commit drop as
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
    where n.nspname = 'public' and p.oid <> to_regprocedure('public.seller_delete_sale(bigint)')) as andere_ruempfe;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt. */
  if exists (select 1 from pg_temp.t0188_vorher v, pg_temp.t0188_nachher n
              where (v.sales, v.sale_items, v.order_reservations, v.shop_inventory, v.inventory_movements, v.orderbook_audit, v.collection_items, v.buchung, v.funktionsrechte, v.tabellenrechte, v.policies, v.andere_ruempfe)
                    is distinct from (n.sales, n.sale_items, n.order_reservations, n.shop_inventory, n.inventory_movements, n.orderbook_audit, n.collection_items, n.buchung, n.funktionsrechte, n.tabellenrechte, n.policies, n.andere_ruempfe)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, Rechte, Policies oder einen anderen Rumpf bewegt — nichts wird angewendet';
  end if;

  /* Z2 — der neue Rumpf aus 0188; die gerufenen Helfer unveraendert. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_delete_sale(bigint)')) is distinct from '2498b653971f54fe2b99cb76c9a98a34'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_operate_active_seller()')) is distinct from '3e220b0b1a0b33d0b5ad9afc1be4719d'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.release_sale_item_hold(bigint)')) is distinct from 'fa55019eae858efa4fed3186b581a7f5' then
    raise exception 'ABBRUCH Z2: ein Rumpf steht nicht wie zugesagt';
  end if;

  /* Z3 — Rechte und Form: authenticated und service_role, nie anon oder PUBLIC. */
  if not (select (has_function_privilege('authenticated', to_regprocedure('public.seller_delete_sale(bigint)'), 'execute')
               and has_function_privilege('service_role', to_regprocedure('public.seller_delete_sale(bigint)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.seller_delete_sale(bigint)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.seller_delete_sale(bigint)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))) or (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.seller_delete_sale(bigint)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) <> '1' then
    raise exception 'ABBRUCH Z3: ein Recht oder die Form von seller_delete_sale steht nicht wie zugesagt';
  end if;

  raise notice '0188 ok: seller_delete_sale sperrt jetzt Verkauf und Positionen vor dem Loeschen; keine Zeile, kein Recht, kein anderer Rumpf bewegt.';
end
$lauf_z$;

commit;
