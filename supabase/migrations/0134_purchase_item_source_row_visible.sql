-- ===========================================================================
-- 0134 — DIE VIERTE HERKUNFTSBEDINGUNG ERREICHT DEN BILDSCHIRM
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  GESPERRT durch Entscheidung des Betreibers vom 2026-10-18.           ##
-- ##                                                                       ##
-- ##  Stand der Umgebungen am 2026-10-18:                                  ##
-- ##    Staging    qqxcpesbwfxzgytkdsac   0126-0131                        ##
-- ##    Production zmiwxswrpkmizvqsgype   0126-0133                        ##
-- ##                                                                       ##
-- ##  Vor einer Anwendung fehlen: ein Preflight, ein Postflight und die    ##
-- ##  Reihenfolge-Entscheidung zum Deployment — `canRemoveItem()` liest    ##
-- ##  `source_row` aus der Antwort von `seller_purchase()`, eine           ##
-- ##  Oberflaeche VOR dieser Migration bekaeme `null` und boete das        ##
-- ##  Entfernen der 109 wiedereroeffneten Importzeilen wieder an.          ##
-- ##  Reihenfolge und Freigaben: `supabase/checks/0132_staging_plan.md`.   ##
-- ###########################################################################
--
-- WAS FEHLT. `seller_remove_purchase_item` lehnt eine Zeile aus vier Gruenden
-- ab (0064, unveraendert in 0132): `state = 'reconciled_legacy'`, eine
-- gesetzte `source_row`, `legacy_booked_flag`, `legacy_condition_flag`. Der
-- Bildschirm kennt drei davon. `source_row` liefert `seller_purchase()` nicht
-- aus, und `canRemoveItem()` kann sie deshalb nicht pruefen.
--
-- WARUM DAS JETZT AUFFAELLT. Der Lauf von 0132 am 2026-10-18 — auf Production,
-- vorgesehen war Staging — hat 109 importierte
-- Positionen gezeigt, die kein `reconciled_legacy` tragen: `0067` hat sie
-- bewusst auf `ordered` zurueckgesetzt — fuenf Pakete, die Ende August
-- bestellt und nie geliefert wurden. Sie behalten ihre `source_row`, die
-- Datenbank lehnt sie also weiter ab. Der Bildschirm sieht bei ihnen aber
-- keines der drei Merkmale, die er kennt, und bietet „Position entfernen" an.
-- Das Ergebnis ist eine Aktion, die immer scheitert.
--
-- WAS DIESE MIGRATION TUT. Sie gibt `source_row` in der Positionsliste mit
-- aus. Ein Feld mehr in einem JSON-Objekt, sonst nichts.
--
-- WAS SIE NICHT TUT. Sie aendert keine Regel, keine Berechtigung, keine
-- Zeile. Der Funktionskoerper ist Zeichen fuer Zeichen der aus `0119` mit
-- genau einem zusaetzlichen Schluessel. Sie fasst `purchase_items` nicht an,
-- schreibt nichts und ist beliebig oft wiederholbar.
--
-- `source_row` ist eine Zeilennummer der Arbeitsmappe — keine
-- personenbezogene Angabe, kein Preis, kein Name. Sie steht ohnehin schon
-- in `seller_purchases_overview` nicht, wird aber auf dem Bildschirm auch
-- nicht angezeigt: sie entscheidet nur, ob ein Knopf erscheint.
-- ===========================================================================


create or replace function public.seller_purchase(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'purchase', to_jsonb(p) - 'created_by' - 'updated_by',
    'value', to_jsonb(val),
    'factor', case when val.known_value > 0 then round(p.total_cost / val.known_value, 4) end,
    /*
     * DER TAG, ALS LISTE (0116) — wortgleich mit `seller_sale` seit 0113.
     *
     * Die Oberfläche soll „nach oben" nicht raten müssen: `day_order` nennt
     * jeden belegten Platz des Tages mit der Einkaufs-ID dahinter, absteigend
     * wie auf dem Bildschirm. Eine Lücke — ein Einkauf, der sein Datum
     * gewechselt hat — ist damit sichtbar statt erschlossen.
     *
     * `to_jsonb(p)` oben bringt `daily_index` und die Kostenaufteilung schon
     * mit; hier kommt nur dazu, was aus den NACHBARN folgt.
     */
    'daily_index_count', case when p.purchased_at is null then 0 else (
      select count(*) from public.purchases d where d.purchased_at = p.purchased_at) end,
    'day_order', case when p.purchased_at is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'daily_index', d.daily_index)
                       order by d.daily_index desc)
        from public.purchases d
       where d.purchased_at = p.purchased_at and d.daily_index is not null), '[]'::jsonb) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
        'name', coalesce(s.display_name_override, s.name, i.raw_name, i.sky_id),
        'raw_name', i.raw_name,
        'series_code', s.series_code, 'condition', i.condition, 'state', i.state,
        -- One field for the screen: frozen when frozen, live when live.
        'market_price', coalesce(i.market_price_snapshot, s.market_price),
        'price_is_frozen', i.market_price_snapshot is not null,
        'market_price_snapshot_at', i.market_price_snapshot_at,
        'movement_id', i.movement_id,
        'legacy_condition_flag', i.legacy_condition_flag,
        'legacy_booked_flag', i.legacy_booked_flag,
        -- NEU IN 0134. Die vierte Herkunftsbedingung, die die Datenbank seit
        -- `0064` prueft und der Bildschirm bis heute nicht kannte.
        'source_row', i.source_row,
        'note', i.note
      ) order by i.position, i.id)
      from public.purchase_items i
      left join public.skylanders s on s.sky_id = i.sky_id
     where i.purchase_id = p.id), '[]'::jsonb)
  ) into v
  from public.purchases p
  cross join lateral public.purchase_market_value(p.id) val
  where p.id = p_id;

  return v;
end;
$$;

revoke all on function public.seller_purchase(bigint) from public, anon;
grant execute on function public.seller_purchase(bigint) to authenticated;

comment on function public.seller_purchase(bigint) is
  'One purchase with its value, its day order and its items (0053, fields added in 0116, display name in 0119, source_row in 0134). The item field `name` resolves display_name_override → skylanders.name → raw_name → sky_id; `raw_name` travels beside it so the historical snapshot stays visible instead of being replaced. `source_row` is the workbook line number and decides whether the screen may offer removal at all. Reads only.';
