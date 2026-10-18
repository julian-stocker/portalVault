-- ===========================================================================
-- R0134 — Ruecknahme von 0134
--
-- Stellt `seller_purchase(bigint)` auf den Stand aus `0119` zurueck: ohne
-- `source_row` in der Positionsliste. Der Koerper darunter ist Zeichen fuer
-- Zeichen der aus `0119`.
--
-- FOLGE DER RUECKNAHME: `canRemoveItem()` sieht `source_row` nicht mehr und
-- bietet „Position entfernen" wieder fuer die 109 wiedereroeffneten
-- Importzeilen an. Die Datenbank lehnt sie weiter ab — die Aktion scheitert
-- also mit einer Meldung statt zu verschwinden. Kein Datenverlust, nur die
-- alte Unstimmigkeit.
--
-- Diese Datei wird nur zusammen mit einer Ruecknahme des Oberflaechenstands
-- angewendet.
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
  'One purchase with its value, its day order and its items (0053, fields added in 0116, display name in 0119). The item field `name` resolves display_name_override → skylanders.name → raw_name → sky_id; `raw_name` travels beside it so the historical snapshot stays visible instead of being replaced. Reads only.';
