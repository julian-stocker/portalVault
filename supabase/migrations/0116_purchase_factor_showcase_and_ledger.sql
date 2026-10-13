-- ===========================================================================
-- 0116 — DIE EINKAUFSLOGIK ZU 0115
--
-- Ersetzte Funktionen, eine neue. KEIN Schema: keine Spalte, kein Index, kein
-- Trigger, kein Constraint, keine Zeile geschrieben. Rollback ist die
-- jeweils vorige Fassung (0053 / 0064 / 0069 / 0070).
--
-- ---------------------------------------------------------------------------
-- WAS SICH FACHLICH ÄNDERT, UND WAS DAS KOSTET
--
-- 1. BESCHÄDIGT UND FEHLEND ZÄHLEN 0 EUR (Entscheidung D4).
--
--    Bisher: `purchase_market_value()` schloss `missing` ganz aus und zählte
--    `damaged` mit VOLLEM Marktwert. Künftig zählen beide mit 0 EUR, und die
--    Position bleibt in `total_items` sichtbar.
--
--    Die Kosten bleiben unangetastet — `purchases.total_cost` wird von dieser
--    Migration nicht berührt. Der Faktor STEIGT dadurch, und das ist gewollt:
--    wer 100 EUR zahlt und 90 EUR verwertbaren Marktwert erhält, kauft zu
--    1,111 und nicht zu 1,0. Der kalkulatorische Buy-in der verbleibenden
--    Figuren steigt mit.
--
--    RÜCKWIRKUNG, gemessen vor dem Rollout: auf Production und Staging gibt
--    es derzeit NULL beschädigte und NULL fehlende Positionen. Der globale
--    Faktor ändert sich durch diesen Punkt also um 0,00 % — die Regel wirkt
--    ausschliesslich auf künftige Daten.
--
-- 2. TESTEINKÄUFE FALLEN AUS DEM GLOBALEN FAKTOR (Entscheidung D5).
--
--    `orderbook_global_factor()` las bisher JEDEN Einkauf, auch die mit
--    `is_test`. Das Ledger filtert sie seit `0063` korrekt, der globale
--    Faktor nicht — eine Inkonsistenz, die niemand bestellt hat.
--
--    Gemessene Wirkung: Production 0 Testeinkäufe, also unverändert
--    0,376347. Staging 3 Testeinkäufe über 37,50 EUR, Faktor 0,376338 →
--    0,376347.
--
-- 3. OFFEN WIRD GEZÄHLT, NICHT GERECHNET.
--
--    `open_count` war `total_items - booked - settled` und zählte damit eine
--    beschädigte Position als offen, während `is_open` daneben sie korrekt
--    ausschloss. Beide fragen jetzt dasselbe.
--
-- 4. DIE VITRINE WIRD SETZBAR, UND SIE IST EIN SACKGASSE MIT EINEM AUSGANG.
--
--    `seller_set_purchase_item_state()` nimmt `showcase` an.
--    `seller_book_purchase_item()` lässt aus `showcase` einbuchen — das ist
--    die Überführung in den Shopbestand aus D1 — und aus `damaged` NICHT.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'purchase_items_state_known') not like '%showcase%' then
    raise exception '0116 setzt 0115 voraus: showcase fehlt im Zustands-CHECK';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'daily_index') then
    raise exception '0116 setzt 0115 voraus: purchases.daily_index fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'items_cost') then
    raise exception '0116 setzt 0115 voraus: purchases.items_cost fehlt';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Was ein Einkauf noch wert ist
--
-- Rumpf aus `0053`, zwei Änderungen:
--
--   `known_value`  beschädigt und fehlend tragen 0 EUR bei (D4), alles andere
--                  seinen bekannten Preis — Snapshot, sonst Katalogpreis.
--   WHERE          die Ausschlussklausel `state <> 'missing'` fällt weg. Eine
--                  fehlende Position IST Teil des Einkaufs; sie ist nur
--                  nichts mehr wert. Sie aus `total_items` zu entfernen hiess,
--                  sie aus der Übersicht zu entfernen, und dann sieht niemand
--                  mehr, warum der Faktor gestiegen ist.
--
-- `known_items` zählt eine beschädigte oder fehlende Position als BEKANNT:
-- ihr anrechenbarer Wert ist 0 und das ist eine Antwort, keine Lücke. Täte
-- sie es nicht, stünde jeder Einkauf mit einer beschädigten Figur für immer
-- auf „unvollständig".
-- ---------------------------------------------------------------------------
create or replace function public.purchase_market_value(p_purchase_id bigint)
returns table (
  known_value  numeric,
  known_items  integer,
  total_items  integer,
  booked_items integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(
      case when i.state in ('damaged', 'missing') then 0
           else coalesce(i.market_price_snapshot, s.market_price) end), 0)::numeric,
    count(*) filter (
      where i.state in ('damaged', 'missing')
         or coalesce(i.market_price_snapshot, s.market_price) is not null)::integer,
    count(*)::integer,
    count(*) filter (where i.state = 'booked')::integer
  from public.purchase_items i
  left join public.skylanders s on s.sky_id = i.sky_id
 where i.purchase_id = p_purchase_id;
$$;

comment on function public.purchase_market_value(bigint) is
  'What a parcel is still worth, and how much of that is known (0053, rule changed in 0116). A `damaged` or `missing` unit contributes 0 EUR to `known_value` — SkyIsles sells only flawless figures, so a scratched one has no sellable value — while its share of `total_cost` stays untouched, which is what makes the buy-in factor rise. Both still count in `total_items`: a parcel that hides its losses cannot explain its own factor. `showcase` contributes its full price: it is physically here and worth what it is worth, it is simply not for sale.';

revoke all on function public.purchase_market_value(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Der globale Einkaufsfaktor, ohne Testeinkäufe
--
-- Rumpf aus `0059`, eine Zeile mehr. Die Division bleibt durch `sum > 0`
-- geschützt — bei einem anrechenbaren Wert von 0 EUR kommt NULL heraus und
-- keine Ausnahme. Das ist seit `0059` so und bleibt es; D8 verlangt genau das.
-- ---------------------------------------------------------------------------
create or replace function public.orderbook_global_factor()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when sum(v.known_value) > 0
              then round(sum(p.total_cost) / sum(v.known_value), 6) end
    from public.purchases p
    cross join lateral public.purchase_market_value(p.id) v
   /*
    * EIN TESTEINKAUF IST KEINE AUSGABE (0116, D5).
    *
    * Das Ledger filtert `is_test` seit `0063`; diese Funktion tat es nicht,
    * und damit floss jeder Probeeinkauf in die Kennzahl, auf die sich jeder
    * neue Verkauf als `buy_in_factor_snapshot` festschreibt.
    */
   where not p.is_test;
$$;

comment on function public.orderbook_global_factor() is
  'The operation''s all-time buy-in factor: real expenditure divided by creditable market value (0059, test purchases excluded in 0116). NULL while there is no creditable value — never a division by zero. `damaged` and `missing` units contribute 0 to the denominator since 0116, so losses raise the factor instead of disappearing from it.';

revoke all on function public.orderbook_global_factor() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Die Quickbox, um die Vitrine erweitert
--
-- Rumpf aus `0069`. `showcase` kommt in die erlaubte Liste; die drei
-- Sperren bleiben Wort für Wort: aus `booked` führt nur das Zurücknehmen der
-- Buchung, eine Arbeitsmappenzeile ändert ihren Zustand nicht, und eine
-- Katalogfigur wird nie `settled`.
-- ---------------------------------------------------------------------------
create or replace function public.seller_set_purchase_item_state(
  p_item_id bigint,
  p_state   text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_sky     text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  /*
   * `booked` steht BEWUSST nicht in dieser Liste. Bestand entsteht über
   * `seller_book_purchase_item()`, das eine Lagerbewegung schreibt — ein
   * Zustandswechsel hierher wäre Bestand ohne Beleg, und
   * `purchase_items_booked_has_movement` würde ihn ohnehin abweisen.
   */
  if p_state not in ('ordered', 'arrived', 'damaged', 'missing', 'settled', 'showcase') then
    raise exception 'this state is not one the Quickbox may set'
      using errcode = 'check_violation';
  end if;

  select state, sky_id into v_current, v_sky
    from public.purchase_items where id = p_item_id for update;
  if v_current is null then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;
  if v_current = 'booked' then
    raise exception 'this item is in inventory; reverse the booking first'
      using errcode = 'restrict_violation';
  end if;
  if v_current = 'reconciled_legacy' then
    raise exception 'a historical item is a record of what happened and does not change state'
      using errcode = 'restrict_violation';
  end if;

  /*
   * THE LOCK. A catalog figure is never `settled`.
   *
   * `settled` closes a position without a movement. For a portal that is the
   * truth; for a figure it would be a way past the inventory ledger — off
   * the open list, never booked, stock short by one and nothing to show for
   * it. `Einbuchen` is the only ending a figure has.
   */
  if p_state = 'settled' and v_sky is not null then
    raise exception 'a catalog figure is booked into inventory, never settled'
      using errcode = 'check_violation';
  end if;

  /*
   * UND EINE VITRINE IST EINE FIGUR (0116).
   *
   * Ein Portal in die Vitrine zu legen wäre kein Fehler des Betriebs, aber
   * `showcase` trägt eine Zusicherung, die für ein Portal nichts bedeutet:
   * „voller Marktwert im Faktor". Ein Nicht-Katalogartikel hat keinen
   * Katalogpreis, also wäre der Beitrag 0 — und dann ist `settled` das
   * richtige Wort und sagt dasselbe ehrlicher.
   */
  if p_state = 'showcase' and v_sky is null then
    raise exception 'only a catalog figure goes into the showcase; settle a non-figure instead'
      using errcode = 'check_violation';
  end if;

  /*
   * UND KEIN WEG VON `damaged`/`missing` DIREKT IN DIE VITRINE (0116,
   * nachgeschärft; Entscheidung D4).
   *
   * Aus der Vitrine DARF eingebucht werden — das ist D1, und es bleibt so.
   * Genau dadurch wäre `showcase` aber ein zweiter Weg in den
   * Verkaufsbestand geworden:
   *
   *     damaged  ->  showcase  ->  booked
   *
   * Zwei Klicks, beide erlaubt, und am Ende steht eine als beschädigt
   * verzeichnete Figur im Shopbestand. D4 verbietet das ausdrücklich: eine
   * beschädigte Figur wird NIE in den SkyIsles-Verkaufsbestand
   * zurückgeführt.
   *
   * Der eine nachvollziehbare Weg zurück ist deshalb `arrived` — die
   * ausdrückliche Aussage „sie ist doch in Ordnung" —, und von dort führt
   * jeder weitere Schritt offen weiter. Die Korrektur wird damit nicht
   * verboten, nur sichtbar: ein Umweg über die Vitrine hätte dieselbe
   * Aussage versteckt.
   */
  if p_state = 'showcase' and v_current in ('damaged', 'missing') then
    raise exception 'set this item to arrived first if it is in fact flawless; a damaged unit does not move into the showcase'
      using errcode = 'check_violation';
  end if;

  update public.purchase_items
     set state = p_state, updated_at = now()
   where id = p_item_id;
end;
$$;

comment on function public.seller_set_purchase_item_state(bigint, text) is
  'Moves one purchased unit between the states the operator owns (0069, `showcase` added in 0116): ordered, arrived, damaged, missing, settled, showcase. `booked` is deliberately absent — stock comes from `seller_book_purchase_item()`, which writes the movement that proves it. Refuses a booked unit (reverse the booking first), a reconciled workbook line, `settled` for a catalog figure, `showcase` for anything that is not one and `showcase` for a damaged or missing unit — that one would be a second road into sellable stock, since a showcase unit may be booked (D1/D4); the deliberate way back is `arrived`.';

revoke all on function public.seller_set_purchase_item_state(bigint, text) from public, anon;
grant execute on function public.seller_set_purchase_item_state(bigint, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Einbuchen — die Vitrine hinein, beschädigt endgültig heraus
-- ---------------------------------------------------------------------------
create or replace function public.seller_book_purchase_item(p_item_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item  record;
  v_price numeric;
  v_mid   bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;

  -- Already done. Hand back the movement that did it.
  if v_item.state = 'booked' then
    return v_item.movement_id;
  end if;

  if v_item.state = 'reconciled_legacy' then
    raise exception 'a historical purchase item is already reflected in stock and is never booked again'
      using errcode = 'restrict_violation';
  end if;
  if v_item.sky_id is null then
    raise exception 'this item is not a catalog figure and cannot enter figure inventory'
      using errcode = 'check_violation';
  end if;
  /*
   * BESCHÄDIGT WIRD NIEMALS VERKAUFBAR (0116, Entscheidung D4).
   *
   * SkyIsles bietet ausschliesslich einwandfreie Figuren an. Eine beschädigte
   * geht nicht in den Bestand — nicht automatisch, und auch nicht durch einen
   * zweiten Klick. Wer sich bei der Klassifizierung geirrt hat, setzt sie
   * BEWUSST über `seller_set_purchase_item_state` auf `arrived` zurück und
   * bucht dann ein; dieser Satz sagt genau das, und der Umweg ist der
   * nachvollziehbare Teil.
   */
  if v_item.state = 'damaged' then
    raise exception 'a damaged item does not enter sellable stock; set it to arrived first if it is in fact fine'
      using errcode = 'check_violation';
  end if;
  /*
   * UND FEHLEND AUCH NICHT — bis es da ist.
   *
   * Kommt eine vermeintlich fehlende Figur doch an, ist der Weg derselbe:
   * auf `arrived` setzen, dann einbuchen. Ein direkter Sprung von `missing`
   * nach `booked` wäre Bestand aus einer Figur, die als nicht angekommen
   * verzeichnet ist.
   */
  if v_item.state = 'missing' then
    raise exception 'an item that never arrived cannot be booked'
      using errcode = 'check_violation';
  end if;
  /*
   * AUS DER VITRINE DARF EINGEBUCHT WERDEN (0116, Entscheidung D1).
   *
   * Das ist die Überführung in den Shopbestand, und sie steht hier als
   * KOMMENTAR und nicht als Verbot — weil Schweigen an dieser Stelle keine
   * Entscheidung wäre. Eine Vitrinenfigur ist physisch da und einwandfrei;
   * sie gehörte nur dem Inhaber. Ab hier gehört sie dem Shop, mit einer
   * Lagerbewegung als Beleg wie jede andere.
   */

  -- The freeze, read in the same breath as the movement below.
  select s.market_price into v_price from public.skylanders s where s.sky_id = v_item.sky_id;

  v_mid := public.record_inventory_movement(
    v_item.sky_id, v_item.condition, 1, 'purchase',
    null, null,                                  -- no invented per-unit cost
    'Orderbuch Einkauf #' || v_item.purchase_id || ' Pos. ' || v_item.position
  );

  update public.purchase_items
     set state = 'booked',
         movement_id = v_mid,
         market_price_snapshot = v_price,
         market_price_snapshot_at = case when v_price is null then null else now() end,
         market_price_source = case when v_price is null then null else 'booking' end,
         updated_at = now()
   where id = p_item_id;

  return v_mid;
end;
$$;
comment on function public.seller_book_purchase_item(bigint) is
  'Takes one purchased unit into figure inventory (0053, state rules stated in 0116). Idempotent: an already booked unit hands back the movement that did it rather than writing a second. Refuses a non-figure, a reconciled workbook line, a `missing` unit and — permanently — a `damaged` one: SkyIsles offers only flawless figures, so a scratched one never becomes sellable stock, and a misclassification is corrected deliberately through `seller_set_purchase_item_state` first. A `showcase` unit MAY be booked: that is the owner handing a display piece over to the shop (D1).';

revoke all on function public.seller_book_purchase_item(bigint) from public, anon;
grant execute on function public.seller_book_purchase_item(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Zwei Einkäufe tauschen ihren Platz am Tag
--
-- Wortgleich mit `seller_swap_sale_daily_index` aus `0113`, nur auf
-- `purchases` und ohne die Tagesspalte — `purchased_at` IST der Tag.
--
-- Ein TAUSCH, keine Verschiebung: die Menge der Plätze eines Tages bleibt
-- dieselbe, also entsteht keine Lücke. Drei Anweisungen, weil PostgreSQL
-- `purchases_daily_index_uniq` je ZEILE prüft — ein einzelnes UPDATE über
-- beide Zeilen scheitert an der ersten, lange bevor die zweite ihren Platz
-- freigegeben hat. Geparkt wird auf `-p_with_index`: negativ, kollidiert mit
-- keinem echten Platz, und die Tagessperre lässt keinen zweiten Tausch
-- gleichzeitig zu. Deshalb gibt es auch keinen CHECK `daily_index > 0`.
-- ---------------------------------------------------------------------------
create or replace function public.seller_swap_purchase_daily_index(
  p_id bigint,
  p_with_index integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_day date; v_a public.purchases; v_b public.purchases; v_from integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_with_index is null or p_with_index < 1 then
    raise exception 'a place in a day starts at one' using errcode = 'invalid_parameter_value';
  end if;

  select purchased_at into v_day from public.purchases where id = p_id;
  if not found then
    raise exception 'no such purchase' using errcode = 'no_data_found';
  end if;
  if v_day is null then
    raise exception 'a purchase without a date has no place to swap'
      using errcode = 'restrict_violation';
  end if;

  /*
   * DIE SPERRE GILT DEM TAG, NICHT DEN ZWEI ZEILEN.
   *
   * Zwei gleichzeitige Tauschvorgänge am selben Tag, die ihre Zeilen in
   * verschiedener Reihenfolge sperren, verklemmen sich. Dieselbe Sperre, die
   * der Zuweisungstrigger nimmt, macht aus beiden eine Schlange — und sie
   * wird VOR dem ersten `for update` genommen, sonst wäre die Sperrordnung
   * wieder offen.
   */
  perform pg_advisory_xact_lock(hashtext('purchases_daily_index:' || v_day::text)::bigint);

  select * into v_a from public.purchases where id = p_id for update;
  if v_a.purchased_at is distinct from v_day then
    raise exception 'this purchase changed its date concurrently'
      using errcode = 'serialization_failure';
  end if;

  -- Schon dort. Kein Schreibvorgang, keine Ablehnung.
  if v_a.daily_index = p_with_index then
    return jsonb_build_object('ok', true, 'moved', false, 'daily_index', v_a.daily_index);
  end if;

  select * into v_b from public.purchases
   where purchased_at = v_day and daily_index = p_with_index and id <> v_a.id
   for update;
  if not found then
    raise exception 'no purchase holds that place in the day' using errcode = 'no_data_found';
  end if;

  v_from := v_a.daily_index;
  update public.purchases set daily_index = -p_with_index where id = v_a.id;
  update public.purchases set daily_index = v_from, updated_at = now(),
                              updated_by = (select auth.uid())
   where id = v_b.id;
  update public.purchases set daily_index = p_with_index, updated_at = now(),
                              updated_by = (select auth.uid())
   where id = v_a.id;

  return jsonb_build_object('ok', true, 'moved', true,
                            'daily_index', p_with_index,
                            'swapped_with', v_b.id,
                            'swapped_from', v_from);
end;
$$;

comment on function public.seller_swap_purchase_daily_index(bigint, integer) is
  'Exchanges two purchases'' places within their day (0116) — the same contract `seller_swap_sale_daily_index` has since 0113. A swap, not a move: the set of places on a day never changes, so no gap appears. Atomic, with one row parked on a negative index because a unique index is checked per row and a two-row swap in a single UPDATE would trip on itself. Refuses an undated purchase and a place no purchase holds. Already there is not an error: it writes nothing and says `moved: false`.';

revoke all on function public.seller_swap_purchase_daily_index(bigint, integer) from public, anon;
grant execute on function public.seller_swap_purchase_daily_index(bigint, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Anlegen mit Plattform, Verkäufer und Kostenaufteilung
--
-- WARUM GEDROPPT UND NEU ANGELEGT. Ein `create or replace` mit zusätzlichen
-- Parametern erzeugt in PostgreSQL eine zweite OVERLOAD — die Identität einer
-- Funktion umfasst ihre Argumenttypen. Zwei Fassungen, die sich nur in
-- nachgestellten Standardwerten unterscheiden, machen jeden Aufruf
-- mehrdeutig; `0062` beschreibt genau diese Falle.
--
-- Der bestehende Aufruf aus der Anwendung bleibt gültig: PostgREST löst über
-- die Argument-NAMEN auf, und die neuen Parameter haben Standardwerte. Der
-- heute live laufende Code ruft weiterhin mit fünf Argumenten und landet in
-- derselben Funktion.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb);

create or replace function public.seller_create_purchase_with_items(
  p_purchased_at date,
  p_total_cost   numeric,
  p_note         text    default null,
  p_is_test      boolean default false,
  p_items        jsonb   default '[]'::jsonb,
  p_platform     text    default null,
  p_seller_name  text    default null,
  p_items_cost   numeric default null,
  p_shipping_cost numeric default null,
  p_buyer_protection_cost numeric default null,
  p_payment_method text   default null,
  p_external_ref   text   default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      bigint;
  v_items   jsonb;
  v_element jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  -- A missing list is an empty one: a purchase with no items is legitimate
  -- and becomes `Unvollständig` (0063), which is a state the owner may want
  -- on purpose when only the date and the amount are known yet.
  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'the item list must be a json array'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * A ceiling, not a business rule. The largest real parcel in the workbook
   * is 65 units; 200 is far above anything anybody enters by hand and far
   * below the point where one request becomes a problem.
   */
  if jsonb_array_length(v_items) > 200 then
    raise exception 'a purchase may be created with at most 200 items at once'
      using errcode = 'program_limit_exceeded';
  end if;

  v_id := public.seller_create_purchase(p_purchased_at, p_total_cost, p_note, p_is_test);

  /*
   * DIE NEUEN FELDER IN EINEM ZWEITEN SCHRITT, UND DAS IST ABSICHT.
   *
   * `seller_create_purchase()` bedient auch den Arbeitsmappen-Import und
   * bleibt deshalb unverändert — eine zweite geänderte Signatur für
   * Felder, die kein Importeur kennt, wäre Aufwand ohne Nutzen. Dieselbe
   * Transaktion, also entsteht kein Zwischenzustand, den jemand sehen könnte.
   *
   * `purchases_cost_split_adds_up` prüft hier: ergibt die Aufteilung nicht
   * `total_cost`, bricht der ganze Einkauf ab, statt halb erfasst zu werden.
   */
  update public.purchases
     set platform              = nullif(btrim(coalesce(p_platform, '')), ''),
         seller_name           = nullif(btrim(coalesce(p_seller_name, '')), ''),
         items_cost            = p_items_cost,
         shipping_cost         = p_shipping_cost,
         buyer_protection_cost = p_buyer_protection_cost,
         payment_method        = nullif(btrim(coalesce(p_payment_method, '')), ''),
         external_ref          = coalesce(nullif(btrim(coalesce(p_external_ref, '')), ''),
                                          external_ref)
   where id = v_id;

  for v_element in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    /*
     * Delegated on purpose. `seller_add_purchase_item` assigns the position,
     * rejects an element that is neither a catalog figure nor a name, and
     * lets the foreign key reject a sky_id that is not in the catalog. All of
     * that happens inside this transaction, so a bad element three rows down
     * takes the purchase with it.
     */
    perform public.seller_add_purchase_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );
  end loop;

  return v_id;
end;
$$;

comment on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text) is
  'Creates one purchase with its platform, seller, cost breakdown and items in ONE transaction (0064, fields added in 0116). `total_cost` stays what was actually paid; the breakdown is checked against it by `purchases_cost_split_adds_up`, so a parcel whose parts do not add up is refused whole rather than saved half. Creating items moves no stock — that is `seller_book_purchase_item`, one unit at a time.';

revoke all on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Nachträglich bearbeiten
--
-- Dieselbe Signatur-Falle wie oben, dieselbe Lösung. Und dieselbe Konvention
-- wie bisher: `NULL` heisst „unverändert lassen", nicht „leeren". Für die drei
-- Kostenfelder ist das zu wenig — eine Aufteilung muss sich auch ENTFERNEN
-- lassen —, also gibt es dafür einen ausdrücklichen Schalter, genau wie
-- `p_clear_date` beim Verkauf seit `0062`.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_update_purchase(bigint, date, numeric, text);

create or replace function public.seller_update_purchase(
  p_id           bigint,
  p_purchased_at date    default null,
  p_total_cost   numeric default null,
  p_note         text    default null,
  p_platform     text    default null,
  p_seller_name  text    default null,
  p_items_cost   numeric default null,
  p_shipping_cost numeric default null,
  p_buyer_protection_cost numeric default null,
  p_payment_method text   default null,
  p_external_ref   text   default null,
  p_clear_cost_split boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * EINE AUFTEILUNG GANZ ODER GAR NICHT.
   *
   * `purchases_cost_split_is_whole` verlangt `items_cost`, sobald Versand
   * oder Käuferschutz gesetzt sind. Ein Aufruf, der nur den Versand ändert
   * und `items_cost` nirgends hat, würde daran scheitern — mit einer Meldung
   * über einen CHECK statt über die Sache. Deshalb dieser Satz.
   */
  if p_items_cost is null
     and (p_shipping_cost is not null or p_buyer_protection_cost is not null)
     and not exists (select 1 from public.purchases
                      where id = p_id and items_cost is not null) then
    raise exception 'a cost split needs the price of the figures; send it along'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.purchases p set
    purchased_at = coalesce(p_purchased_at, p.purchased_at),
    total_cost   = coalesce(p_total_cost, p.total_cost),
    note         = case when p_note is null then p.note
                        else nullif(btrim(p_note), '') end,
    /*
     * `p_clear_cost_split` räumt die Aufteilung weg und lässt `total_cost`
     * stehen — der Zustand, in dem jeder Einkauf von vor `0115` ist: bezahlt
     * wurde etwas, wie es sich aufteilt weiss niemand.
     */
    items_cost   = case when p_clear_cost_split then null
                        else coalesce(p_items_cost, p.items_cost) end,
    shipping_cost = case when p_clear_cost_split then null
                         else coalesce(p_shipping_cost, p.shipping_cost) end,
    buyer_protection_cost = case when p_clear_cost_split then null
                                 else coalesce(p_buyer_protection_cost,
                                               p.buyer_protection_cost) end,
    platform     = case when p_platform is null then p.platform
                        else nullif(btrim(p_platform), '') end,
    seller_name  = case when p_seller_name is null then p.seller_name
                        else nullif(btrim(p_seller_name), '') end,
    payment_method = case when p_payment_method is null then p.payment_method
                          else nullif(btrim(p_payment_method), '') end,
    external_ref = case when p_external_ref is null then p.external_ref
                        else nullif(btrim(p_external_ref), '') end,
    updated_at   = now(),
    updated_by   = (select auth.uid())
  where p.id = p_id;
end;
$$;

comment on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean) is
  'Edits one purchase own fields (0053, extended in 0116): date, total, note, platform, seller, cost split, payment method and reference. NULL means leave alone, as everywhere in this schema; p_clear_cost_split is the one way to REMOVE a split, which NULL cannot express. The split is checked against total_cost by constraint, so an edit that makes the parts stop adding up is refused rather than saved. Touches no item and no stock.';

revoke all on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean) from public, anon;
grant execute on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Ein Einkauf, gelesen
--
-- Rumpf aus `0053`. `to_jsonb(p)` bringt die sieben neuen Spalten von selbst
-- mit; dazu kommt nur, was aus den NACHBARN eines Tages folgt.
-- ---------------------------------------------------------------------------
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
        'name', coalesce(s.name, i.raw_name), 'raw_name', i.raw_name,
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


-- ---------------------------------------------------------------------------
-- 9. Das Einkaufsbuch
--
-- Rumpf aus `0070`. Was sich geändert hat, und NUR das:
--
--   1. drei Zähler je Zustand — damaged, missing, showcase
--   2. `open_count` wird GEZÄHLT statt als Rest gerechnet (siehe Kopf, 3.)
--   3. `daily_index` und die Sortierung danach, höchster Platz oben
--   4. Kostenaufteilung, Plattform, Verkäufer, Zahlungsweg, Referenz,
--      `updated_at` in der Projektion
--
-- Filter, Suche, `is_open`, `is_incomplete`, `factor` und jede Summe sind
-- Zeile für Zeile unverändert.
-- ---------------------------------------------------------------------------
create or replace function public.seller_orderbook_ledger(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_status  text    default 'normal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text;
  v_num    text;
  v_status text;
  v_rows   jsonb;
  v_sum    jsonb;
  v_class  jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  /*
   * German decimals. The owner types `67,02`; the column holds `67.02`. Only
   * the separator is translated — no rounding, no tolerance, no nearest-match.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           /*
            * DIE DREI ENDEN, DIE 0115/0116 UNTERSCHEIDBAR MACHEN.
            *
            * `showcase` ist physisch da und zählt voll in den Wert (D3);
            * `damaged` und `missing` zählen 0 EUR (D4) und sind damit im
            * Nennwert gar nicht mehr sichtbar — als ZAHL müssen sie es
            * bleiben, sonst sieht der Betrieb nicht, warum sein Faktor
            * gestiegen ist.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'damaged')::integer as damaged_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'missing')::integer as missing_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'showcase')::integer as showcase_items,
           /*
            * OFFEN ALS ZAHL, NICHT ALS REST.
            *
            * Hier stand `total_items - booked_items - settled_items` in der
            * Projektion, und das war seit `0069` falsch: eine beschädigte
            * oder fehlende Position ist weder gebucht noch `settled`, also
            * zählte sie als offen — während `is_open` daneben sie korrekt
            * ausschloss. Zahl und Wahrheitswert widersprachen sich. Jetzt
            * fragen beide dasselbe.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.movement_id is null
               and d.state in ('ordered', 'arrived'))::integer as open_items,
           /*
            * SETTLED, counted here and not in `purchase_market_value` (0070).
            *
            * That function returns a typed row, and widening it would mean
            * dropping and recreating it plus everything that reads it. This
            * is one scalar subquery over the same rows, needed by one caller.
            *
            * It is NOT added to `booked_items`. A settled portal owns no
            * movement, and `Eingebucht` means a movement exists — that is the
            * whole rule this release was written to restore.
            */
           (select count(*) from public.purchase_items s
             where s.purchase_id = p.id and s.state = 'settled')::integer as settled_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor,
           /*
            * UNVOLLSTÄNDIG, derived here and stored nowhere.
            *
            * A missing date, for every source — that is the thirteen `#REF!`
            * groups and anything the owner enters without an invoice to hand.
            * And a hand-made purchase with nothing in it: money recorded,
            * contents not, which is unfinished work rather than a parcel.
            *
            * The item rule is `manual` only. An imported group's contents are
            * the workbook's; nothing here can add to them, so listing one as
            * work outstanding would be listing something nobody can finish.
            */
           (p.purchased_at is null
            or (p.source = 'manual' and v.total_items = 0)) as is_incomplete,
           /*
            * OFFEN — an action is outstanding, not a fact. Derived too.
            *
            * A `reconciled_legacy` row is NOT outstanding: the historical
            * stock figure already contains those units, and the booking
            * function refuses that state outright. That is why a workbook
            * line the owner never ticked is absent here — and why 0067 moved
            * the five undelivered parcels to `ordered` rather than widening
            * this test to reach them.
            *
            * WHAT CHANGED IN 0068: `sky_id is not null` is gone.
            *
            * It was here because this expression mirrored
            * `seller_book_purchase_item` exactly, and that function needs a
            * catalog figure. But "can this be booked into figure inventory"
            * and "is there anything left to do with this" are two questions,
            * and a trophy and two portals in an undelivered parcel are where
            * they come apart: nobody can book them, and they are plainly not
            * dealt with either.
            *
            * Hiding them let a parcel report itself finished while three of
            * its items were still in the post — the false "nothing to do"
            * this axis exists to prevent.
            *
            * The BUTTON is a separate decision and is unchanged: `canCheckIn`
            * still requires a `sky_id`, so nothing offers an `Einbuchen` the
            * database would refuse.
            *
            * Independent of `Unvollständig`: a purchase can be fully recorded
            * and still have a parcel on the desk, and an incomplete one can
            * have nothing left to book.
            */
           exists (select 1
                     from public.purchase_items i
                    where i.purchase_id = p.id
                      and i.movement_id is null
                      and i.state in ('ordered', 'arrived')) as is_open
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
     where (case when coalesce(p_undated, false)
                 then p.purchased_at is null
                 else (p_year  is null or extract(year  from p.purchased_at) = p_year)
                  and (p_month is null or extract(month from p.purchased_at) = p_month)
            end)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'position', i.position,
                     'name', coalesce(s.name, i.raw_name, i.sky_id))
                   order by i.position)
              from public.purchase_items i
              left join public.skylanders s on s.sky_id = i.sky_id
              left join public.series se on se.code = s.series_code
             where i.purchase_id = f.id
               and v_q is not null
               and (i.raw_name ilike '%' || v_q || '%'
                 or s.name     ilike '%' || v_q || '%'
                 or i.sky_id   ilike '%' || v_q || '%'
                 or se.label   ilike '%' || v_q || '%')) as match_items
      from filtered f
  ),
  searched as (
    select h.*
      from hits h
     where v_q is null
        or h.match_items is not null
        -- Every date comparison yields NULL for an undated purchase, which is
        -- not true, so it simply does not match on date — and still matches on
        -- cost, note, source or any item inside it.
        or to_char(h.purchased_at, 'DD.MM.YYYY') ilike '%' || v_q  || '%'
        or h.purchased_at::text                  ilike '%' || v_q  || '%'
        or h.total_cost::text                    ilike '%' || v_num || '%'
        or round(h.known_value, 2)::text         ilike '%' || v_num || '%'
        or coalesce(round(h.factor, 2)::text, '') ilike '%' || v_num || '%'
        or coalesce(h.note, '')                  ilike '%' || v_q  || '%'
        or h.source                              ilike '%' || v_q  || '%'
  ),
  /*
   * The classification filter, and the LAST one applied — which is what makes
   * the counts below meaningful. They are taken from `searched`, i.e. after
   * the year, month and search filters and before this one, so `Test 1` means
   * "one test purchase in the view you are looking at" rather than "one in the
   * database".
   */
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.is_test
             when 'incomplete' then not r.is_test and r.is_incomplete
             when 'open'       then not r.is_test and r.is_open
             when 'test'       then r.is_test
             else true
           end
  ),
  /*
   * ONE STATEMENT, because a `with` clause belongs to the statement it is
   * attached to. The page and the counts are two aggregates over two
   * different CTEs of the same query, joined because each yields exactly one
   * row — not two queries, which would be two chances to disagree about the
   * filter.
   */
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'purchased_at', m.purchased_at, 'total_cost', m.total_cost,
      'currency', m.currency, 'source', m.source, 'note', m.note,
      /* 0115: der Tagesplatz, die Kostenaufteilung, Plattform und Verkäufer. */
      'daily_index', m.daily_index,
      'items_cost', m.items_cost, 'shipping_cost', m.shipping_cost,
      'buyer_protection_cost', m.buyer_protection_cost,
      'platform', m.platform, 'seller_name', m.seller_name,
      'payment_method', m.payment_method,
      'external_ref', m.external_ref, 'updated_at', m.updated_at,
      'item_count', m.total_items, 'booked_count', m.booked_items,
      'settled_count', m.settled_items,
      'damaged_count', m.damaged_items, 'missing_count', m.missing_items,
      'showcase_count', m.showcase_items,
      /* Gezählt, nicht gerechnet — siehe `open_items` oben. */
      'open_count', m.open_items,
      'known_value', m.known_value, 'known_items', m.known_items,
      'factor', m.factor, 'match_items', m.match_items,
      'is_test', m.is_test, 'is_incomplete', m.is_incomplete, 'is_open', m.is_open)
      /*
        HÖCHSTER TAGESPLATZ OBEN (0116) — dieselbe Ordnung, die das
        Verkaufsbuch seit `0113` hat. `id` bleibt der letzte Ausweg: ein
        undatierter Einkauf hat keinen Platz, und zwei davon brauchen
        trotzdem eine feste Reihenfolge.
      */
      order by m.purchased_at desc nulls last,
               m.daily_index desc nulls last,
               m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      /* Die drei Enden auch in der Summe: der Betrieb soll sehen, wie viele
         Positionen seinen Faktor belasten, ohne jede Zeile zu öffnen. */
      'damaged_count',  coalesce(sum(m.damaged_items), 0),
      'missing_count',  coalesce(sum(m.missing_items), 0),
      'showcase_count', coalesce(sum(m.showcase_items), 0),
      'open_count',     coalesce(sum(m.open_items), 0),
      -- SUM over SUM. Never avg(factor).
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.is_test),
             'incomplete', count(*) filter (where not r.is_test and r.is_incomplete),
             'open',       count(*) filter (where not r.is_test and r.is_open),
             'test',       count(*) filter (where r.is_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;
revoke all on function public.seller_orderbook_ledger(integer, integer, text, boolean, text)
  from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text, boolean, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Nachbedingungen
--
-- Die Suchbegriffe mit Anführungszeichen werden über `chr(39)` gebaut: ein
-- SQL-Literal, das selbst Anführungszeichen enthält, wird sonst zu einer
-- Zeichenkette, die man beim Lesen nicht mehr nachzählen kann.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text; v_count integer; v_def text; v_name text; v_q text := chr(39);
begin
  -- Die neun Funktionen, jede mit genau einer Overload.
  for v_name in
    select n from unnest(array[
      'purchase_market_value', 'orderbook_global_factor',
      'seller_set_purchase_item_state', 'seller_book_purchase_item',
      'seller_swap_purchase_daily_index', 'seller_create_purchase_with_items',
      'seller_update_purchase', 'seller_purchase', 'seller_orderbook_ledger']) as n
  loop
    select count(*) into v_count
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = v_name;
    if v_count <> 1 then
      raise exception '0116 Befund: %() hat % Overload(s), erwartet 1', v_name, v_count;
    end if;
  end loop;

  -- Die D4-Regel steht im ausgelieferten Rumpf, und der alte Ausschluss nicht.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'purchase_market_value';
  if position('i.state in (' || v_q || 'damaged' || v_q in v_def) = 0 then
    raise exception '0116 unvollständig: purchase_market_value kennt die 0-EUR-Regel nicht';
  end if;
  if position('state <> ' || v_q || 'missing' || v_q in v_def) > 0 then
    raise exception '0116 Befund: purchase_market_value schliesst missing noch aus';
  end if;

  -- Und D5.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'orderbook_global_factor';
  if position('not p.is_test' in v_def) = 0 then
    raise exception '0116 unvollständig: orderbook_global_factor filtert is_test nicht';
  end if;

  -- Und der behobene Widerspruch.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'seller_orderbook_ledger';
  if position('m.total_items - m.booked_items - m.settled_items' in v_def) > 0 then
    raise exception '0116 Befund: open_count wird noch als Rest gerechnet';
  end if;
  select string_agg(n, ', ') into v_missing
    from unnest(array['damaged_count', 'missing_count', 'showcase_count',
                      'daily_index', 'items_cost', 'platform', 'seller_name',
                      'm.daily_index desc nulls last',
                      'as is_open', 'as is_incomplete', 'as factor']) as n
   where position(n in v_def) = 0;
  if v_missing is not null then
    raise exception '0116 Befund: seller_orderbook_ledger fehlt: %', v_missing;
  end if;

  /*
   * UND KEINE ZEILE HAT SICH BEWEGT.
   *
   * Diese Migration ersetzt Funktionen und schreibt nichts. Die beiden
   * Prüfungen kosten nichts und halten die Behauptung fest.
   */
  select count(*) into v_count from public.purchase_items
   where state = 'booked' and movement_id is null;
  if v_count > 0 then
    raise exception '0116 Befund: % gebuchte Positionen ohne Lagerbewegung', v_count;
  end if;
  select count(*) into v_count from public.purchase_items
   where state in ('damaged', 'missing', 'showcase', 'settled')
     and movement_id is not null;
  if v_count > 0 then
    raise exception '0116 Befund: % Positionen mit Sonderzustand UND Lagerbewegung', v_count;
  end if;
end;
$$;
