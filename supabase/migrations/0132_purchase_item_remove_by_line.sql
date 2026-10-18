-- ===========================================================================
-- 0132 — Ein historischer Einkauf wird nachgetragen; die ZAHLUNG bleibt
--
-- Zwei Funktionen, zwei Richtungen (ADR-0126):
--
--   1. `seller_remove_purchase_item` LOCKERT: entfernen entscheidet die
--      Zeile, nicht ihr Eltern-Einkauf.
--   2. `seller_update_purchase` VERSCHAERFT: die bezahlte Summe eines
--      importierten Einkaufs ist abgeschlossen und bleibt es.
--
-- Zusammen ergibt das, was gebraucht wird: fehlende Figuren, Anschriften und
-- Inserate nachtragen — ohne an einer abgeschlossenen Zahlung zu ruehren.
--
-- ---------------------------------------------------------------------------
-- TEIL 1 — Entfernen entscheidet die ZEILE, nicht der Einkauf
--
-- WAS SICH AENDERT, UND WARUM
--
-- `seller_remove_purchase_item` (0053, verschaerft in 0064) lehnt bisher
-- unter anderem ab, weil der ELTERN-EINKAUF importiert ist:
--
--     if v_source is distinct from 'manual'        <-- diese Zeile geht
--        or v_item.state = 'reconciled_legacy'
--        or v_item.source_row is not null
--        or v_item.legacy_booked_flag is not null
--        or v_item.legacy_condition_flag is not null
--
-- Die Regel sollte die Arbeitsmappe schuetzen. Sie trifft aber auch den
-- eigenen Nachtrag: wer eine fehlende Figur an einen historischen Einkauf
-- haengt — genau der Fall, fuer den `seller_add_purchase_item` nie eine
-- Herkunftspruefung hatte — bekommt sie nie wieder weg. Ein Fehlgriff waere
-- damit dauerhaft.
--
-- DIE ARBEITSMAPPE BLEIBT VOLLSTAENDIG GESCHUETZT. Das ist nicht gehofft,
-- sondern eine Eigenschaft des Imports: `0053` legt JEDE importierte Zeile
-- mit `state = 'reconciled_legacy'` UND einer `source_row` an (und `0088`
-- fuer spaetere Arbeitsmappen-Nachtraege ebenso, dort ist die `source_row`
-- sogar Pflicht). Von den vier verbleibenden Bedingungen lehnt also schon
-- jede EINZELNE jede importierte Zeile ab — zwei unabhaengige Merkmale, und
-- der Teilindex auf `source_row` haelt sie auch eindeutig.
--
-- Was danach entfernbar ist: eine von Hand angelegte, nicht eingebuchte
-- Zeile. Die traegt keines der vier Merkmale, an keinem Einkauf.
--
-- WAS SIE NICHT AENDERT: Lagerbewegungen, Bestaende, Kosten, Belege. Die
-- Funktion ruehrt `inventory_movements` nicht an und hat es nie getan; die
-- Ablehnung fuer eine eingebuchte Zeile steht unveraendert an erster Stelle.
-- Kein `insert`, kein `update`, kein DDL an einer Tabelle.
--
-- Die Fehlermeldung bleibt WOERTLICH dieselbe. Die Oberfläche bildet sie
-- ueber `legacy workbook` auf einen deutschen Satz ab
-- (`src/lib/orderbook/actions.ts`); ein neuer Text haette diese Abbildung
-- stillschweigend aufgehoben.
--
-- NUR LOKAL VORBEREITET. Nicht auf Staging und nicht auf Production
-- ausgefuehrt. Vorher `0132_preflight.sql`, danach `0132_postflight.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_code text;
begin
  if to_regprocedure('public.seller_remove_purchase_item(bigint)') is null then
    raise exception '0132 setzt 0053/0064 voraus: seller_remove_purchase_item fehlt';
  end if;
  if to_regclass('public.purchase_items') is null then
    raise exception '0132 setzt 0053 voraus: purchase_items fehlt';
  end if;

  select p.prosrc into v_code from pg_proc p
    where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)');

  /* Wir ersetzen, was wir zu ersetzen glauben — sonst nichts. */
  if position('v_source is distinct from ''manual''' in v_code) = 0 then
    raise exception '0132 Abbruch: die Fassung aus 0064 steht hier nicht (die Herkunftsbedingung fehlt schon)';
  end if;
  if position('v_item.source_row is not null' in v_code) = 0 then
    raise exception '0132 Abbruch: die Zeilenbedingungen aus 0064 fehlen';
  end if;

  /* Die Annahme, auf der die Verschaerfung ruht: jede importierte Zeile
     traegt BEIDE Merkmale. Faende sich eine ohne, waere sie nach dieser
     Migration entfernbar — dann bricht sie hier ab, statt es zu erlauben. */
  if exists (select 1 from public.purchase_items i
              join public.purchases p on p.id = i.purchase_id
             where p.source <> 'manual'
               and i.state <> 'reconciled_legacy'
               and i.source_row is null
               and i.legacy_booked_flag is null
               and i.legacy_condition_flag is null) then
    raise exception '0132 Abbruch: es gibt Zeilen an importierten Einkaeufen ohne jedes Arbeitsmappen-Merkmal — erst klaeren, woher sie kommen';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktion, ohne die Herkunftsbedingung des Einkaufs
-- ---------------------------------------------------------------------------
create or replace function public.seller_remove_purchase_item(p_item_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item record;
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

  /*
   * DIE ZEILE ENTSCHEIDET, NICHT IHR ELTERNTEIL (0132).
   *
   * Vier Merkmale, jedes fuer sich hinreichend. Der Import setzt
   * `reconciled_legacy` und `source_row` immer, die beiden Flaggen, wenn die
   * Arbeitsmappe etwas dazu sagte. Eine von Hand angelegte Zeile traegt
   * keines — und nur die darf wieder gehen.
   */
  if v_item.state = 'reconciled_legacy'
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
  'Removes one hand-made, unbooked purchase item (0053, hardened in 0064, narrowed in 0132). Refuses an item that owns an inventory movement and refuses anything carrying legacy provenance OF ITS OWN — the reconciled_legacy state, a workbook row number or either legacy marker. The PARENT purchase no longer decides: a figure added by hand to an imported purchase carries none of those markers and may be taken off again, which is what makes correcting the imported history possible at all (ADR-0126). Every imported line still carries reconciled_legacy AND a source_row, so each of the remaining conditions alone refuses it. Correcting a historical line''s FIGURE remains possible through seller_set_purchase_item_sky; only deleting the line is refused. Touches no inventory.';

revoke all on function public.seller_remove_purchase_item(bigint) from public, anon;
grant execute on function public.seller_remove_purchase_item(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_code text;
  v_oid  oid;
begin
  v_oid := to_regprocedure('public.seller_remove_purchase_item(bigint)');
  if v_oid is null then
    raise exception '0132 Abbruch: die Funktion fehlt nach der Migration';
  end if;
  select p.prosrc into v_code from pg_proc p where p.oid = v_oid;

  if position('v_source' in v_code) > 0 then
    raise exception '0132 Abbruch: die Herkunftsbedingung des Einkaufs steht noch im Rumpf';
  end if;

  if position('v_item.state = ''reconciled_legacy''' in v_code) = 0
     or position('v_item.source_row is not null' in v_code) = 0
     or position('v_item.legacy_booked_flag is not null' in v_code) = 0
     or position('v_item.legacy_condition_flag is not null' in v_code) = 0 then
    raise exception '0132 Abbruch: eine der vier Zeilenbedingungen fehlt';
  end if;
  if position('v_item.movement_id is not null' in v_code) = 0 then
    raise exception '0132 Abbruch: die Bedingung fuer eine eingebuchte Zeile fehlt';
  end if;
  if position('legacy workbook' in v_code) = 0 then
    raise exception '0132 Abbruch: die Meldung hat sich geaendert — die Oberflaeche bildet sie ueber diesen Text ab';
  end if;
  if position('inventory_movements' in v_code) > 0 then
    raise exception '0132 Abbruch: die Funktion fasst Lagerbewegungen an';
  end if;
  if position('can_operate_active_seller' in v_code) = 0 then
    raise exception '0132 Abbruch: die Rollenpruefung fehlt';
  end if;

  /*
   * PUBLIC UEBER DEN ACL, NICHT UEBER has_function_privilege.
   *
   * `has_function_privilege('public', ...)` bricht mit `role "public" does
   * not exist` ab — `public` ist ein Pseudo-Empfaenger im ACL (grantee = 0),
   * kein Eintrag in `pg_roles`. Dieselbe Lehre steht in `0124` und `0125`.
   *
   * Und ein NULL-ACL heisst nicht „keine Rechte", sondern „Standardrechte" —
   * fuer eine Funktion also EXECUTE fuer PUBLIC. Ein fehlender ACL ist hier
   * genau der Zustand, den die Pruefung verhindern soll.
   */
  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception '0132 Abbruch: die Funktion hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0132 Abbruch: PUBLIC oder anon hat EXECUTE';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0132 Abbruch: authenticated hat kein EXECUTE';
  end if;

  /* Und die Belege bleiben, wie sie sind: diese Migration kennt sie nicht. */
  if position('purchase_receipts' in v_code) > 0 then
    raise exception '0132 Abbruch: die Funktion nennt die Belegtabelle';
  end if;

  raise notice '0132: Entfernen entscheidet die Zeile; importierte Zeilen bleiben geschuetzt';
end $$;


-- ===========================================================================
-- TEIL 2 — Die bezahlte Summe eines importierten Einkaufs ist abgeschlossen
--
-- WELCHES FELD IST DIE ZAHLUNG? Gemessen, nicht angenommen:
--
--   `purchases.total_cost`      der tatsaechlich gezahlte Betrag. DIES ist
--                               die Zahlung.
--   `items_cost`, `shipping_cost`, `buyer_protection_cost`
--                               ihre AUFTEILUNG. `purchases_cost_split_adds_up`
--                               (0115) nagelt sie auf `total_cost` fest: eine
--                               Aufteilung, die nicht aufgeht, lehnt die
--                               Datenbank ab. Sie kann die Summe also nicht
--                               verschieben und darf deshalb nachgetragen
--                               werden.
--   `currency`                  gehoert zum Betrag — `seller_update_purchase`
--                               nimmt sie gar nicht an, sie ist auf diesem
--                               Weg schon unveraenderlich.
--   `payment_method`, `platform`, `seller_name`, `purchased_at`, `note`,
--   `external_ref`, Absender, Inserat, Vereinbarung
--                               beschreibend. Ergaenzbar, ohne eine Zahlung
--                               zu beruehren.
--   `market_price_snapshot`     Bewertung, keine Zahlung (0053/0116).
--
-- UND WO ES KEINE GELDBUCHUNG GIBT: ein Einkauf hat keine Zahlungstabelle.
-- `payment_attempts`, `order_refunds` und `sale_fees` gehoeren dem Shop und
-- dem Verkauf, nicht dem Orderbuch. Die Zahlung eines Einkaufs IST
-- `total_cost` — und der Monatsbericht (`seller_monthly_reports`) rechnet
-- ausschliesslich mit Bestellungen, nicht mit Einkaeufen. Ein geaendertes
-- Kaufdatum kann also keinen abgeschlossenen Bericht verfaelschen.
--
-- Die Funktion ist die Fassung aus 0121, unveraendert bis auf den einen
-- Riegel. Der Rumpf wurde aus 0121 uebernommen, nicht abgeschrieben.
-- ===========================================================================

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
   * ===========================================================================
   * DIE BEZAHLTE SUMME EINES HISTORISCHEN EINKAUFS IST VERBINDLICH (0132)
   * ===========================================================================
   *
   * `total_cost` ist der Betrag, der tatsaechlich gezahlt wurde — nicht eine
   * Bewertung und nicht eine Schaetzung. Bei einem aus der Arbeitsmappe
   * uebernommenen Einkauf (`source <> 'manual'`) ist er abgeschlossen: er
   * darf nachtraeglich weder direkt noch indirekt anders werden.
   *
   * WAS DAMIT NICHT GESPERRT IST, und das ist der ganze Punkt:
   *
   *   * die AUFTEILUNG (`items_cost`, `shipping_cost`,
   *     `buyer_protection_cost`) darf nachgetragen und geaendert werden. Sie
   *     kann die Summe nicht verschieben, weil
   *     `purchases_cost_split_adds_up` (0115) sie auf `total_cost` festnagelt:
   *     eine Aufteilung, die nicht aufgeht, lehnt die Datenbank ab.
   *   * Zahlungsart, Plattform, Verkaeufername, Datum, Absender, Inserat,
   *     Vereinbarung, Notiz, externe Referenz — alles beschreibend, alles
   *     ergaenzbar.
   *
   * Ein manueller Einkauf bleibt vollstaendig aenderbar; dort ist nichts
   * abgeschlossen, solange der Betreiber es nicht abschliesst.
   */
  if p_total_cost is not null then
    if exists (select 1 from public.purchases p
                where p.id = p_id
                  and p.source <> 'manual'
                  and round(p.total_cost, 2) <> round(p_total_cost, 2)) then
      raise exception 'the paid total of an imported purchase is final and cannot be changed'
        using errcode = 'restrict_violation';
    end if;
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
  'Edits one purchase own fields (0053, extended in 0116 and 0121): date, total, note, platform, seller, cost split, payment method, reference — and since 0121 the parcel sender, the listing reference and the agreement note. NULL means leave alone, as everywhere in this schema; an EMPTY STRING clears that one field and touches no other. p_clear_cost_split stays the one exception, because the split is three columns that only make sense together. The listing address is checked for http/https shape here and by constraint; nothing is fetched. Touches no item and no stock. Seit 0132: bei einem importierten Einkauf (source <> ''manual'') lehnt sie eine Aenderung von total_cost ab — die bezahlte Summe ist abgeschlossen. Die AUFTEILUNG bleibt nachtragbar, weil purchases_cost_split_adds_up sie ohnehin auf total_cost festnagelt; alles Beschreibende ebenso. Ein manueller Einkauf bleibt vollstaendig aenderbar.';

revoke all on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- TEIL 2, Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_code text;
  v_name text;
  v_oid  oid;
begin
  v_oid := to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text)');
  if v_oid is null then
    raise exception '0132 Abbruch: seller_update_purchase fehlt oder hat eine andere Signatur';
  end if;
  select p.prosrc into v_code from pg_proc p where p.oid = v_oid;

  if position('the paid total of an imported purchase is final' in v_code) = 0 then
    raise exception '0132 Abbruch: der Riegel auf total_cost fehlt';
  end if;
  if position('p.source <> ''manual''' in v_code) = 0 then
    raise exception '0132 Abbruch: der Riegel prueft die Herkunft nicht';
  end if;

  /*
   * Der Riegel darf NUR die Summe betreffen. Faende sich die Aufteilung oder
   * eines der beschreibenden Felder nicht mehr im Rumpf, haette die Migration
   * mehr gesperrt als gewollt — und genau das soll sie nicht.
   */
  foreach v_name in array array[
      'p_items_cost', 'p_shipping_cost', 'p_buyer_protection_cost',
      'p_clear_cost_split',
      'p_sender_name', 'p_sender_street', 'p_sender_postal_code',
      'p_sender_city', 'p_sender_country',
      'p_listing_title', 'p_listing_url', 'p_listing_details',
      'p_agreement_note', 'p_platform', 'p_seller_name', 'p_payment_method',
      'p_purchased_at', 'p_note', 'p_external_ref'] loop
    if position(v_name in v_code) = 0 then
      raise exception '0132 Abbruch: % kommt in der Funktion nicht mehr vor', v_name;
    end if;
  end loop;

  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception '0132 Abbruch: seller_update_purchase hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '0132 Abbruch: PUBLIC oder anon darf seller_update_purchase ausfuehren';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0132 Abbruch: authenticated darf seller_update_purchase nicht ausfuehren';
  end if;

  raise notice '0132: die bezahlte Summe eines importierten Einkaufs ist gesperrt, die Aufteilung nicht';
end $$;
