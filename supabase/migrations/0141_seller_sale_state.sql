-- ===========================================================================
-- 0141 — DER BETRIEB SIEHT, WARUM EINE POSITION NOCH NICHT VERKAEUFLICH IST
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET. Braucht eine eigene Freigabe des Betreibers.       ##
-- ###########################################################################
--
-- WOFUER. `0139` hat drei Angaben eingefuehrt, die der Betrieb pflegen muss
-- — `sale_released`, `delivery_scope`, `usk_rating` — und eine
-- Gruendeleiter, die sagt, was noch fehlt. Lesen kann die Oberflaeche davon
-- bisher NICHTS: `admin_shop_inventory()` (`0041`) liefert die drei Spalten
-- nicht, und `admin_shop_listing_audit()` liefert zwar den Grund, aber nicht
-- die Werte.
--
-- WAS SIE TUT: EINE neue Funktion, und sonst nichts.
--
--   `seller_sale_state()` — je Lagerposition: Artikeltyp, die drei Angaben,
--   ob sie verkaeuflich ist und warum nicht.
--
-- SIE IST REIN ADDITIV. Keine Spalte, keine Tabelle, keine Zeile, kein
-- bestehender Funktionsrumpf, kein bestehendes Recht. Insbesondere wird
-- `admin_shop_inventory()` NICHT erweitert: ihr Rueckgabetyp zu aendern
-- hiesse, sie zu droppen und neu anzulegen — eine Funktion, an der die
-- ganze Lagerseite haengt, fuer zwei Spalten. Eine zusaetzliche Funktion
-- kostet einen Aufruf je Seitenaufbau und kein Risiko.
--
-- UND SIE RECHNET DEN GRUND NICHT NACH. Die Gruendeleiter steht in
-- `admin_shop_listing_audit()` (`0139`), und zwar genau einmal; diese
-- Funktion JOINT sie dazu. Eine zweite Herleitung waere eine zweite
-- Wahrheit — und die beiden liefen auseinander, sobald jemand eine Regel
-- aendert.
--
-- WAS SIE NICHT TUT: nichts schreiben, nichts freigeben, nichts anbieten.
-- Sie liest. Nach ihr ist genau so viel kaufbar wie vorher: nichts Neues.
--
-- SETZT `0139` VORAUS (die drei Spalten) und `0041` (die Betriebsrolle).
-- AUSFUEHRUNG: `supabase/operations/staging-0141.sql`.
-- Ruecknahme: `supabase/rollback/R0141_drop_sale_state.sql`.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'sale_released') then
    raise exception '0141 setzt 0139 voraus: shop_inventory.sale_released fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'delivery_scope') then
    raise exception '0141 setzt 0139 voraus: shop_inventory.delivery_scope fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'usk_rating') then
    raise exception '0141 setzt 0139 voraus: skylanders.usk_rating fehlt';
  end if;
  if to_regprocedure('public.admin_shop_listing_audit()') is null then
    raise exception '0141 setzt 0008/0041/0139 voraus: admin_shop_listing_audit fehlt';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0141 setzt 0041 voraus: can_operate_active_seller fehlt';
  end if;
  if to_regprocedure('public.seller_sale_state()') is not null then
    raise exception '0141 Abbruch: seller_sale_state steht schon';
  end if;
end $$;


create function public.seller_sale_state()
returns table (
  sky_id         text,
  condition      text,
  item_type      text,
  sale_released  boolean,
  delivery_scope text,
  usk_rating     smallint,
  sellable       boolean,
  reason         text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * DER GRUND KOMMT AUS DER EINEN LEITER, nicht aus einer zweiten.
   * `admin_shop_listing_audit()` prueft dieselbe Rolle und liefert
   * `eligible` und `reason`; hier kommen nur die drei Werte dazu, die der
   * Betrieb bedient.
   *
   * `left join`: faende die Leiter eine Position nicht, stuende hier NULL —
   * und NULL heisst in der Oberflaeche „unbekannt", nicht „verkaeuflich".
   */
  return query
    select i.sky_id,
           i.condition,
           s.item_type,
           i.sale_released,
           i.delivery_scope,
           s.usk_rating,
           a.eligible,
           a.reason
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
      left join public.admin_shop_listing_audit() a
        on a.sky_id = i.sky_id and a.condition = i.condition
     order by i.sky_id, i.condition;
end;
$$;

comment on function public.seller_sale_state() is
  'Per stock position, for the operator (0141): item type, the three things the business maintains (sale_released, delivery_scope, usk_rating), whether the position may be sold, and the reason when it may not. Reads only. The reason is JOINED from admin_shop_listing_audit(), never recomputed - one ladder, one place. Additive: it changes no existing function, column, row or privilege, and in particular does not widen admin_shop_inventory(), whose return type could not be replaced without dropping the function the whole stock page depends on.';

revoke all on function public.seller_sale_state() from public, anon;
grant execute on function public.seller_sale_state() to authenticated;


do $$
begin
  if to_regprocedure('public.seller_sale_state()') is null then
    raise exception '0141 unvollstaendig: seller_sale_state fehlt';
  end if;
  if (select count(*) from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(nm, md)
       where p.oid = to_regprocedure('public.seller_sale_state()') and a.md = 't') <> 8 then
    raise exception '0141 Abbruch: seller_sale_state liefert nicht acht Spalten';
  end if;
  if (select p.prosecdef from pg_proc p
       where p.oid = to_regprocedure('public.seller_sale_state()')) is not true then
    raise exception '0141 Abbruch: security definer fehlt';
  end if;
  if exists (select 1 from information_schema.role_routine_grants g
              where g.routine_schema = 'public' and g.routine_name = 'seller_sale_state'
                and g.grantee = 'anon') then
    raise exception '0141 Abbruch: anon darf seller_sale_state ausfuehren';
  end if;
  -- Und es ist nichts kaufbar geworden: diese Datei schreibt nicht.
  if (select count(*) from public.shop_inventory where sale_released) <> 0 then
    raise notice '0141 Hinweis: es gibt bereits freigegebene Positionen — '
      'diese Datei hat daran nichts geaendert.';
  end if;
  raise notice '0141 ok: seller_sale_state steht, acht Spalten, nur fuer das Betriebskonto';
end $$;
