-- ===========================================================================
-- 0112 — EIN EXTERNER VERKAUF MIT FREIEN ARTIKELN LÄSST SICH IN EINEM KLICK
--        ABSCHLIESSEN
--
-- ADDITIV. Eine neue Funktion, nichts geändert, nichts entfernt, keine Spalte,
-- kein Trigger, kein Index.
--
-- ---------------------------------------------------------------------------
-- DAS PROBLEM
--
-- Ein externer Verkauf darf seit `0059` Positionen enthalten, die kein
-- Katalogartikel sind: ein Portal, ein Spiel, ein Konvolut-Restposten, als
-- `sale_items`-Zeile mit `sky_id IS NULL` und `raw_name`. Für das Lager sind
-- sie unsichtbar, und das ist richtig — `sale_items_movement_needs_figure`
-- macht eine Lagerbewegung für sie unmöglich.
--
-- Genau deshalb konnten sie aber auch nicht enden. `is_open` in
-- `seller_sales()` fragt, ob noch eine Position offen ist; geschlossen ist
-- eine Position erst mit Bewegung, `settled_at` oder `not_shipped_at`
-- (`sale_item_is_closed`, 0075). Eine freie Position kann keine Bewegung
-- bekommen, also braucht sie `settled_at` — und das setzte bisher nur
-- `seller_settle_sale_item()`, Position für Position, und nur auf der
-- Detailseite. Ein Verkauf, der ausschließlich aus freien Artikeln besteht,
-- stand im Verkaufsbuch für immer auf „Offen", obwohl das Paket längst weg
-- war. Dazu kam, dass `sales.shipped_at` sich bisher ÜBERHAUPT NUR als
-- Nebenwirkung von `seller_ship_sale_item()` datieren ließ — und das verlangt
-- eine Regalposition.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE FUNKTION TUT, UND WAS SIE AUSDRÜCKLICH NICHT TUT
--
--   TUT     den Versand des Verkaufs datieren (`sales.shipped_at`)
--   TUT     jede noch offene Position OHNE `sky_id` als erledigt schließen
--   TUT     beides in EINER Transaktion, idempotent
--
--   NICHT   eine Lagerbewegung erzeugen — für eine freie Position ist das per
--           CHECK unmöglich, und für eine Regalposition wird hier gar nichts
--           angefasst
--   NICHT   einen Hold nehmen. Der Abschluss GIBT einen frei, falls einer
--           bestand (`release_sale_item_hold` in `seller_settle_sale_item`)
--   NICHT   den Bestand verändern
--   NICHT   eine katalogisierte Position stillschweigend schließen oder
--           ausbuchen. Die WHERE-Klausel wählt ausschließlich `sky_id IS
--           NULL`, und `seller_settle_sale_item()` würde eine Figur ohnehin
--           mit `check_violation` abweisen
--   NICHT   eine interne Bestellung anfassen. Commerce besitzt deren
--           Versandzustand (ADR-0089), und die Funktion weist sie ab
--
-- WARUM EINE EIGENE FUNKTION UND NICHT ZWEI AUFRUFE AUS DEM BROWSER. Zwei
-- Aufrufe sind zwei Transaktionen: der erste kann gelingen und der zweite
-- ausfallen, und dann steht ein Verkauf da, dessen Positionen erledigt sind,
-- dessen Versand aber nicht datiert ist — oder umgekehrt. Beides ist ein
-- Zwischenzustand, den niemand sieht und der von Hand repariert werden müsste.
-- Hier ist es eine Anweisungsfolge in einer Transaktion: entweder beides oder
-- nichts.
--
-- UND WARUM SIE `seller_settle_sale_item()` RUFT statt selbst zu schreiben:
-- was „erledigt" bedeutet, entscheidet genau eine Stelle. Deren Regeln —
-- idempotent, keine interne Bestellung, keine nicht freigegebene Historie,
-- keine Figur, Hold vorher freigeben — gelten damit hier unverändert, ohne
-- Kopie, die auseinanderlaufen könnte.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_settle_sale_item') then
    raise exception '0112 setzt 0110 voraus: seller_settle_sale_item() fehlt';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'sale_item_is_closed') then
    raise exception '0112 setzt 0075 voraus: sale_item_is_closed() fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'shipped_at') then
    raise exception '0112 setzt 0059 voraus: sales.shipped_at fehlt';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Verschickt — und die freien Positionen gleich mit
-- ---------------------------------------------------------------------------
create or replace function public.seller_ship_sale(p_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale    public.sales;
  v_item    record;
  v_settled integer := 0;
  v_open    integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_sale from public.sales where id = p_id for update;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;

  /*
   * EINE BESTELLUNG BESITZT IHREN VERSANDZUSTAND SELBST.
   *
   * Wortgleich mit `seller_set_sale_shipped()` aus `0059`: der Versand einer
   * internen Bestellung ist eine Erfüllungshandlung von Commerce, und das
   * Orderbuch spiegelt sie nur.
   */
  if v_sale.order_id is not null then
    raise exception 'the order owns its shipping state' using errcode = 'restrict_violation';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'a cancelled sale is not shipped' using errcode = 'restrict_violation';
  end if;

  /*
   * Eine nicht freigegebene Arbeitsmappenzeile bleibt gefroren (0071/0073).
   * `seller_settle_sale_item()` würde sie ohnehin abweisen; hier scheitert es
   * früh und mit demselben Satz, statt mitten in der Schleife.
   */
  if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then
    raise exception 'this historical sale has not been released'
      using errcode = 'restrict_violation';
  end if;

  /*
   * NUR DIE FREIEN, UND NUR DIE NOCH OFFENEN.
   *
   * `sky_id is null` ist die ganze Auswahl — eine Regalposition wird hier
   * nicht angefasst, in keiner Richtung. `not sale_item_is_closed(i)` lässt
   * aus, was schon ein Ende hat: eine zweite Ausführung findet nichts mehr
   * und schreibt nichts. Das ist die Idempotenz dieser Schleife.
   *
   * `order by id` ist kein Geschmack: es ist die Sperrordnung. Zwei
   * gleichzeitige Aufrufe auf denselben Verkauf stehen ohnehin schon am
   * `for update` der Verkaufszeile oben an, aber eine feste Reihenfolge
   * kostet nichts und schließt eine Verklemmung aus.
   */
  for v_item in
    select i.id
      from public.sale_items i
     where i.sale_id = p_id
       and i.sky_id is null
       and not public.sale_item_is_closed(i)
     order by i.id
  loop
    perform public.seller_settle_sale_item(v_item.id, true);
    v_settled := v_settled + 1;
  end loop;

  /*
   * DATIERT, FALLS NOCH NICHT DATIERT.
   *
   * `coalesce` ist hier die Idempotenz: ein zweiter Aufruf lässt das
   * ursprüngliche Versanddatum stehen, statt es auf heute zu schieben. Die
   * Prüfspur wird trotzdem fortgeschrieben — auch ein Aufruf, der nur noch
   * Positionen geschlossen hat, hat den Verkauf angefasst. Deshalb EINE
   * Anweisung und kein zusätzliches `orderbook_touch_sale()`:
   * `seller_settle_sale_item()` berührt nur die Position, nicht den Verkauf.
   */
  update public.sales
     set shipped_at = coalesce(shipped_at, now()),
         updated_at = now(),
         updated_by = (select auth.uid())
   where id = p_id;

  /*
   * WAS NOCH OFFEN IST, WIRD ZURÜCKGEMELDET STATT VERSCHWIEGEN.
   *
   * Bei einem gemischten Verkauf bleiben die Regalpositionen offen — das ist
   * richtig, sie müssen ausgebucht werden. Die Oberfläche soll das sagen
   * können, statt „abgeschlossen" zu behaupten.
   */
  select count(*) into v_open
    from public.sale_items i
   where i.sale_id = p_id and not public.sale_item_is_closed(i);

  return jsonb_build_object(
    'ok',            true,
    'settled',       v_settled,
    'still_open',    v_open,
    'shipped_at',    (select shipped_at from public.sales where id = p_id),
    'already_shipped', v_sale.shipped_at is not null);
end;
$$;

comment on function public.seller_ship_sale(bigint) is
  'Marks ONE external sale as shipped and closes its free positions in the same transaction (0112). A position without a sky_id can never own an inventory movement (sale_items_movement_needs_figure), so settled_at is its only possible ending — this is the one click that writes it for all of them and dates sales.shipped_at. Touches no catalog position in either direction, creates no movement, takes no hold (settling RELEASES one), changes no stock. Refuses an internal sale (commerce owns its shipping state), a cancelled sale and an unreleased workbook sale. Idempotent: a second call settles nothing and does not move the shipping date. Returns how many were settled and how many positions are STILL open, so the screen can say so instead of claiming the sale is finished.';


-- ---------------------------------------------------------------------------
-- 2. Wer darf
--
-- Wie jede `seller_*`-RPC: die Berechtigung steckt in der Funktion, und
-- `authenticated` darf sie rufen. Nichts weiter — `anon` nie.
-- ---------------------------------------------------------------------------
revoke all on function public.seller_ship_sale(bigint) from public, anon;
grant execute on function public.seller_ship_sale(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_count integer;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_ship_sale') then
    raise exception '0112 unvollständig: seller_ship_sale() fehlt';
  end if;

  -- Und sie ist definer mit festgesetztem search_path, wie jede Funktion hier.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_ship_sale'
     and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as c
                  where c like 'search\_path=%');
  if v_count <> 1 then
    raise exception '0112 unvollständig: seller_ship_sale() ist nicht definer mit gesetztem search_path';
  end if;

  /*
   * Und nichts hat sich an den Daten geändert: diese Migration erzeugt eine
   * Funktion und sonst nichts. Eine freie Position mit Bewegung wäre ein
   * Befund, der schon vorher unmöglich war — geprüft, weil es nichts kostet.
   */
  select count(*) into v_count from public.sale_items
   where sky_id is null and movement_id is not null;
  if v_count > 0 then
    raise exception '0112 Befund: % freie Positionen mit Lagerbewegung', v_count;
  end if;
end;
$$;
