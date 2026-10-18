-- ===========================================================================
-- RUECKNAHME von 0132 — zurueck auf 0064 und 0121
--
-- NICHT TEIL DER MIGRATIONSKETTE. Nur nach ausdruecklicher Entscheidung,
-- einzeln, in `begin` / `commit` geklammert.
--
-- WAS SIE TUT: sie stellt beide Funktionen auf die Fassung zurueck, die vor
-- `0132` galt.
--
--   `seller_remove_purchase_item` -> 0064: das Entfernen lehnt dann wieder
--       ab, weil der ELTERN-EINKAUF importiert ist. Folge, die man wollen
--       muss: eine selbst nachgetragene Zeile an einem historischen Einkauf
--       ist danach nicht mehr entfernbar.
--   `seller_update_purchase`      -> 0121: der Riegel auf `total_cost` ist
--       dann weg. Folge, die man ebenfalls wollen muss: die bezahlte Summe
--       eines importierten Einkaufs ist wieder aenderbar.
--
-- WAS SIE NICHT TUT: sie faesst keine Daten an. Kein `insert`, `update`,
-- `delete`, kein DDL an einer Tabelle, keine Lagerbewegung, kein Beleg.
-- Zeilen, die unter `0132` hinzugefuegt oder entfernt wurden, bleiben, wie
-- sie sind — eine Ruecknahme der Funktion ist keine Ruecknahme der Arbeit.
--
-- VORBEDINGUNG: beide Funktionen sind die Fassung aus `0132`.
-- NACHBEDINGUNG: beide tragen wieder die Merkmale ihrer Vorgaengerfassung,
--   die Rechte stehen wie vorher, PUBLIC und anon duerfen nichts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_rm text;
  v_up text;
begin
  select p.prosrc into v_rm from pg_proc p
   where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)');
  if v_rm is null then
    raise exception 'R0132 Abbruch: seller_remove_purchase_item fehlt';
  end if;
  if position('v_source' in v_rm) > 0 then
    raise exception 'R0132 Abbruch: seller_remove_purchase_item ist nicht die Fassung aus 0132 (die Herkunftsbedingung steht noch drin)';
  end if;

  select p.prosrc into v_up from pg_proc p
   where p.oid = to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text)');
  if v_up is null then
    raise exception 'R0132 Abbruch: seller_update_purchase fehlt oder hat eine andere Signatur';
  end if;
  if position('the paid total of an imported purchase is final' in v_up) = 0 then
    raise exception 'R0132 Abbruch: seller_update_purchase ist nicht die Fassung aus 0132 (der Riegel fehlt)';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. seller_remove_purchase_item, Fassung aus 0064
-- ---------------------------------------------------------------------------
create or replace function public.seller_remove_purchase_item(p_item_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item   record;
  v_source text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_item from public.purchase_items where id = p_item_id for update;
  if not found then
    raise exception 'no such purchase item' using errcode = 'no_data_found';
  end if;

  -- Unchanged from 0053. The foreign key would refuse it anyway; this says
  -- why in a sentence a person can act on.
  if v_item.movement_id is not null then
    raise exception 'this item is already in inventory; reverse the booking before removing it'
      using errcode = 'restrict_violation';
  end if;

  select p.source into v_source from public.purchases p where p.id = v_item.purchase_id;

  if v_source is distinct from 'manual'
     or v_item.state = 'reconciled_legacy'
     or v_item.source_row is not null
     or v_item.legacy_booked_flag is not null
     or v_item.legacy_condition_flag is not null
  then
    raise exception 'this item came from the legacy workbook; its provenance is not removable'
      using errcode = 'restrict_violation';
  end if;

  delete from public.purchase_items where id = p_item_id;
end;
$$;

comment on function public.seller_remove_purchase_item(bigint) is
  'Removes one hand-made, unbooked purchase item (0053, hardened in 0064). Refuses an item that owns an inventory movement and refuses anything carrying legacy provenance — an imported parent, the reconciled_legacy state, a workbook row number or either legacy marker. Correcting a historical line''s FIGURE remains possible through seller_set_purchase_item_sky; only deleting the line is refused. Touches no inventory.';

revoke all on function public.seller_remove_purchase_item(bigint) from public, anon;
grant execute on function public.seller_remove_purchase_item(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. seller_update_purchase, Fassung aus 0121
-- ---------------------------------------------------------------------------
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
  p_clear_cost_split boolean default false,
  p_sender_name        text default null,
  p_sender_street      text default null,
  p_sender_postal_code text default null,
  p_sender_city        text default null,
  p_sender_country     text default null,
  p_listing_title      text default null,
  p_listing_url        text default null,
  p_listing_details    text default null,
  p_agreement_note     text default null
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

  /*
   * DIE URL, BEVOR DER CHECK SIE ABLEHNT.
   *
   * Der CHECK ist die Grenze; dieser Satz ist die Erklärung. Ein Leerstring
   * bedeutet „löschen" und ist deshalb ausdrücklich erlaubt.
   */
  if p_listing_url is not null and btrim(p_listing_url) <> ''
     and btrim(p_listing_url) !~ '^https?://[^[:space:]]+$' then
    raise exception 'a listing address has to start with http:// or https:// and contain no spaces'
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
    /*
     * DIE NEUN NEUEN, nach derselben Regel wie die fünf darüber: NULL lässt
     * stehen, ein Leerstring löscht, alles andere wird geschrieben. Jedes
     * Feld für sich — ein Aufruf, der nur die Postleitzahl leert, lässt
     * Name, Strasse und Ort unberührt.
     */
    sender_name        = case when p_sender_name is null then p.sender_name
                              else nullif(btrim(p_sender_name), '') end,
    sender_street      = case when p_sender_street is null then p.sender_street
                              else nullif(btrim(p_sender_street), '') end,
    sender_postal_code = case when p_sender_postal_code is null then p.sender_postal_code
                              else nullif(btrim(p_sender_postal_code), '') end,
    sender_city        = case when p_sender_city is null then p.sender_city
                              else nullif(btrim(p_sender_city), '') end,
    sender_country     = case when p_sender_country is null then p.sender_country
                              else nullif(btrim(p_sender_country), '') end,
    listing_title      = case when p_listing_title is null then p.listing_title
                              else nullif(btrim(p_listing_title), '') end,
    listing_url        = case when p_listing_url is null then p.listing_url
                              else nullif(btrim(p_listing_url), '') end,
    listing_details    = case when p_listing_details is null then p.listing_details
                              else nullif(btrim(p_listing_details), '') end,
    agreement_note     = case when p_agreement_note is null then p.agreement_note
                              else nullif(btrim(p_agreement_note), '') end,
    updated_at   = now(),
    updated_by   = (select auth.uid())
  where p.id = p_id;
end;
$$;

comment on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) is
  'Edits one purchase own fields (0053, extended in 0116 and 0121): date, total, note, platform, seller, cost split, payment method, reference — and since 0121 the parcel sender, the listing reference and the agreement note. NULL means leave alone, as everywhere in this schema; an EMPTY STRING clears that one field and touches no other. p_clear_cost_split stays the one exception, because the split is three columns that only make sense together. The listing address is checked for http/https shape here and by constraint; nothing is fetched. Touches no item and no stock.';

revoke all on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_rm  text;
  v_up  text;
  v_oid oid;
begin
  v_oid := to_regprocedure('public.seller_remove_purchase_item(bigint)');
  select p.prosrc into v_rm from pg_proc p where p.oid = v_oid;
  if position('v_source is distinct from ''manual''' in v_rm) = 0 then
    raise exception 'R0132 Abbruch: die Herkunftsbedingung aus 0064 ist nicht zurueck';
  end if;
  if position('legacy workbook' in v_rm) = 0 then
    raise exception 'R0132 Abbruch: die Meldung fehlt';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception 'R0132 Abbruch: PUBLIC oder anon darf entfernen';
  end if;

  v_oid := to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text)');
  select p.prosrc into v_up from pg_proc p where p.oid = v_oid;
  if position('the paid total of an imported purchase is final' in v_up) > 0 then
    raise exception 'R0132 Abbruch: der Riegel auf total_cost steht noch im Rumpf';
  end if;
  if position('p_sender_street' in v_up) = 0 or position('p_items_cost' in v_up) = 0 then
    raise exception 'R0132 Abbruch: die Fassung aus 0121 ist unvollstaendig';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception 'R0132 Abbruch: PUBLIC oder anon darf aendern';
  end if;

  raise notice 'R0132: beide Funktionen stehen wieder auf 0064 bzw. 0121';
end $$;
