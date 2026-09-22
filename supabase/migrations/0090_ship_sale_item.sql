-- ===========================================================================
-- 0090 — „Verschickt" ist ein Klick, nicht zwei (ADR-0092, ADR-0095)
--
-- WAS VORHER FEHLTE
--
-- Eine frisch angelegte externe Verkaufsposition steht auf `Offen`, und die
-- Aktionsspalte war leer. `Ausbuchen` erschien erst, nachdem der Betreiber
-- den ganzen Verkauf über den Versandschalter auf „verschickt" gestellt
-- hatte — zwei Handgriffe für einen Vorgang, und der erste von beiden sagt
-- über das Regal nichts aus. Genau deshalb blieb der Bestand stehen.
--
-- WAS DIESE FUNKTION TUT — UND WAS SIE BEWUSST NICHT SELBST TUT
--
-- Sie bucht NICHT. Sie ruft `seller_book_sale_item()` auf, den einen
-- vorhandenen Weg, der eine Verkaufsposition ausbucht, und der wiederum
-- `record_inventory_movement()` benutzt. Es entsteht also genau eine
-- `sale_external`-Bewegung über −1 auf dem kanonischen Pfad; niemand fasst
-- `shop_inventory.quantity` direkt an, und niemand rechnet die Menge selbst
-- aus. Jede Ablehnung dieser Funktion ist die Ablehnung dieses Wegs:
--
--   historischer Verkauf   `excel_order_2026` bewegt nie Bestand
--   Bestellung             `order_id is not null` — die Bestellung besitzt ihn
--   kein Katalogartikel    `sky_id is null` hat keine Lagerposition
--   zu wenig Bestand       `record_inventory_movement` verweigert es
--
-- Dazu kommt genau ein eigener Schreibvorgang: der Verkauf bekommt sein
-- Versanddatum, falls er noch keines hat.
--
-- WARUM `coalesce` UND NICHT `now()`
--
-- Ein Verkauf hat EIN Versanddatum, auch wenn er drei Figuren hat, die der
-- Betreiber nacheinander verschickt. Das erste Mal gilt; ein zweiter Klick
-- auf eine andere Position verschiebt es nicht. Zusammen mit der
-- Idempotenz von `seller_book_sale_item` — die Funktion gibt eine bereits
-- vorhandene Bewegung unverändert zurück — ist der ganze Aufruf damit
-- wiederholbar, ohne ein zweites Mal Bestand zu bewegen.
--
-- WAS SIE NICHT ANFASST
--
-- `legacy_stock_events`, `shop_inventory` (direkt), Preise, Gebühren,
-- Erstattungen, Positionsnummern, `settled_at`, `not_shipped_at`,
-- `returned_at` und jede Retourenspalte. Die Retourensemantik bleibt, wie
-- sie ist: `sale −1`, später `return +1`.
-- ===========================================================================

create or replace function public.seller_ship_sale_item(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_mid  bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.sale_items where id = p_item_id;
  if not found then
    raise exception 'no such sale item' using errcode = 'no_data_found';
  end if;

  -- Eine Position, die schon woanders geendet ist, wird nicht nachträglich
  -- verschickt: `Erledigt` und `Nicht verschickt` sind eigene Enden, und
  -- beide bedeuten, dass nichts das Regal verlässt.
  if v_item.settled_at is not null then
    raise exception 'this item is already settled and moves no stock'
      using errcode = 'restrict_violation';
  end if;
  if v_item.not_shipped_at is not null then
    raise exception 'this item was marked as not shipped'
      using errcode = 'restrict_violation';
  end if;

  -- DER EINE BUCHUNGSWEG. Alle weiteren Prüfungen stehen dort.
  v_mid := public.seller_book_sale_item(p_item_id);

  update public.sales
     set shipped_at = coalesce(shipped_at, now()),
         updated_at = now(),
         updated_by = (select auth.uid())
   where id = v_item.sale_id;

  return v_mid;
end;
$$;

comment on function public.seller_ship_sale_item(bigint) is
  'Ships one external sale position in a single step (0090): books it through seller_book_sale_item — which is the only path that writes a sale_external movement of -1 via record_inventory_movement — and stamps the sale''s shipped_at if it has none. Writes no stock itself and never touches shop_inventory.quantity directly. Idempotent: a second call returns the existing movement and leaves the first shipping date alone. Refuses a settled or not-shipped position; everything else is refused by the booking path (historical sale, order-owned sale, no catalog figure, not enough stock).';

revoke all on function public.seller_ship_sale_item(bigint) from public, anon;
grant execute on function public.seller_ship_sale_item(bigint) to authenticated;
