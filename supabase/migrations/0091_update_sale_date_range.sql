-- ===========================================================================
-- 0091 — ein Speichern, ein Schreibvorgang (PT409)
--
-- DER FEHLER, DEN DAS BESEITIGT
--
-- Der Verkaufsdialog speicherte Datum und Metadaten nacheinander: erst
-- `seller_set_sale_date`, dann `seller_update_sale` — und beide mit
-- DEMSELBEN `expected_updated_at`. Der erste Aufruf setzt `updated_at`
-- neu, der zweite prüft gegen den alten Wert und bekommt `PT409`, „this
-- sale changed while you were editing it". Der Betreiber hatte niemanden
-- neben sich: er war selbst der konkurrierende Schreiber.
--
-- WARUM HIER NUR EINE PRÜFUNG DAZUKOMMT
--
-- `seller_update_sale` kann das Datum längst: `p_sold_at` setzt es,
-- `p_clear_date` löscht es, und beides geschieht in DERSELBEN Anweisung wie
-- Land, Beträge, Referenzen und Notiz — mit genau einem
-- `orderbook_guard_stale` davor und genau einem `updated_at` danach. Der
-- Dialog muss also nur aufhören, zweimal zu schreiben; eine zweite
-- Update-Architektur braucht es nicht.
--
-- Was der Funktion fehlte, war die Plausibilitätsprüfung des Datums, die
-- `seller_set_sale_date` seit 0059 hat. Ohne sie hätte der Umbau eine
-- Prüfung verloren — ein Datum im Jahr 3000 wäre über den neuen Weg
-- durchgegangen und über den alten nicht. Genau dieser Satz kommt deshalb
-- hinzu, im Wortlaut der bestehenden Regel.
--
-- SONST ÄNDERT SICH NICHTS: dieselbe Signatur, dasselbe Operator-Gate,
-- dieselbe Ablehnung für Bestellungen, dieselbe Länderprüfung, dasselbe
-- `orderbook_guard_stale`, dieselben Audit-Zeilen. `seller_set_sale_date`
-- bleibt unverändert bestehen — das Werkzeug für nachgetragene
-- Arbeitsmappen-Daten benutzt es weiterhin.
-- ===========================================================================

create or replace function public.seller_update_sale(
  p_id bigint,
  p_sold_at date default null, p_clear_date boolean default false,
  p_country text default null,
  p_items_subtotal numeric default null,
  p_shipping_charged numeric default null,
  p_discount_amount numeric default null,
  p_external_ref text default null, p_buyer_ref text default null, p_note text default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_order bigint; v_before public.sales; v_country text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_before from public.sales where id = p_id;
  if not found then raise exception 'no such sale' using errcode = 'no_data_found'; end if;
  v_order := v_before.order_id;
  /*
   * COMMERCE OWNS THE MONEY OF AN INTERNAL SALE. Refusing here rather than
   * silently ignoring the arguments: a caller that tried to change an order's
   * subtotal through the Orderbuch has a bug, and should be told.
   */
  if v_order is not null and (p_items_subtotal is not null or p_shipping_charged is not null
                              or p_discount_amount is not null or p_clear_date or p_sold_at is not null
                              or p_country is not null) then
    raise exception 'these belong to the order, not to the Orderbuch'
      using errcode = 'restrict_violation';
  end if;

  /*
   * Dieselbe Regel wie in `seller_set_sale_date` (0059): ein abgeschlossener
   * externer Verkauf kann nicht morgen stattgefunden haben, und die
   * Arbeitsmappe beginnt lange nach 2000. Sie steht hier, seit der Dialog
   * das Datum über diesen Weg speichert — eine Prüfung, die nur auf einem
   * von zwei Wegen greift, ist keine.
   */
  if p_sold_at is not null and (p_sold_at < date '2000-01-01' or p_sold_at > current_date + 1) then
    raise exception 'that sale date is outside the plausible range' using errcode = 'check_violation';
  end if;

  -- A country is two letters or it is not a country.
  v_country := upper(nullif(btrim(coalesce(p_country, '')), ''));
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'a destination country is a two-letter code' using errcode = 'check_violation';
  end if;

  perform public.orderbook_guard_stale(p_id, p_expected_updated_at);

  update public.sales s set
    sold_at = case when p_clear_date then null
                   when p_sold_at is not null then p_sold_at else s.sold_at end,
    destination_country_code = coalesce(v_country, s.destination_country_code),
    items_subtotal   = coalesce(p_items_subtotal, s.items_subtotal),
    shipping_charged = coalesce(p_shipping_charged, s.shipping_charged),
    discount_amount  = coalesce(p_discount_amount, s.discount_amount),
    external_order_ref = coalesce(nullif(btrim(coalesce(p_external_ref,'')),''), s.external_order_ref),
    buyer_ref = coalesce(nullif(btrim(coalesce(p_buyer_ref,'')),''), s.buyer_ref),
    note = case when p_note is null then s.note else nullif(btrim(p_note),'') end,
    updated_at = now(), updated_by = (select auth.uid())
  where s.id = p_id;

  -- One audit line per field that actually moved.
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'sold_at',
    v_before.sold_at::text,
    (case when p_clear_date then null when p_sold_at is not null then p_sold_at
          else v_before.sold_at end)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'destination_country_code',
    v_before.destination_country_code, coalesce(v_country, v_before.destination_country_code));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'items_subtotal',
    v_before.items_subtotal::text, coalesce(p_items_subtotal, v_before.items_subtotal)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'shipping_charged',
    v_before.shipping_charged::text, coalesce(p_shipping_charged, v_before.shipping_charged)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'discount_amount',
    v_before.discount_amount::text, coalesce(p_discount_amount, v_before.discount_amount)::text);
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'external_order_ref',
    v_before.external_order_ref,
    coalesce(nullif(btrim(coalesce(p_external_ref,'')),''), v_before.external_order_ref));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'buyer_ref',
    v_before.buyer_ref, coalesce(nullif(btrim(coalesce(p_buyer_ref,'')),''), v_before.buyer_ref));
  perform public.orderbook_log(p_id, 'sale', p_id, 'update', 'note',
    v_before.note, case when p_note is null then v_before.note else nullif(btrim(p_note),'') end);
end;
$$;

comment on function public.seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text, timestamptz) is
  'Updates the editable fields of an external sale in ONE write (0062, date range added in 0091): sold_at (p_clear_date clears it), country, the three money columns, both references and the note — one orderbook_guard_stale, one UPDATE, one updated_at, one audit pass. The dialog saves date and metadata through this single call; saving them separately produced a PT409 against the caller''s own first write. Refuses an internal sale''s money and date, an implausible date, a malformed country and a stale token. seller_set_sale_date stays for the date on its own.';

revoke all on function public.seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text, timestamptz) from public, anon;
grant execute on function public.seller_update_sale(bigint, date, boolean, text, numeric, numeric, numeric, text, text, text, timestamptz) to authenticated;
