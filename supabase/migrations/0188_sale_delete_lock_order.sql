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
