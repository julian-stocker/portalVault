-- ===========================================================================
-- 0118 — EBAY IST EINE PLATTFORM
--
-- Eine Zeile Vokabular. `0115` liess `kleinanzeigen`, `willhaben` und
-- `manual` zu; eBay fehlte, und es ist der dritte Marktplatz, über den
-- tatsächlich eingekauft wird.
--
-- ---------------------------------------------------------------------------
-- WAS SICH NICHT ÄNDERT
--
-- Die Spalte `purchases.platform` gibt es seit `0115`. `seller_update_purchase`
-- nimmt `p_platform` seit `0116`, `seller_create_purchase_with_items` auch,
-- und `seller_orderbook_ledger` projiziert sie. Nachträgliches Setzen an
-- einem historischen Einkauf ist also API-seitig längst möglich — es fehlte
-- nur der zulässige Wert und das Feld auf dem Schirm.
--
-- Diese Migration fasst deshalb KEINE Funktion an, KEINE Zeile, KEINEN
-- Kostenwert, KEINEN Marktwert, KEINEN Faktor und KEINE Lagerbewegung. Sie
-- erweitert einen CHECK.
--
-- ---------------------------------------------------------------------------
-- DIE FÜNF ANTWORTEN UND IHRE VIER WERTE
--
--   Kleinanzeigen   `kleinanzeigen`
--   eBay            `ebay`          ← neu
--   Willhaben       `willhaben`
--   Andere          `manual`
--   Unbekannt       NULL
--
-- „Unbekannt" ist bewusst kein Wort, sondern die Abwesenheit eines Wortes.
-- `0115` hat das so entschieden und begründet: ein Standardwert hätte die
-- Bedeutung jeder bestehenden Zeile umgeschrieben, und die 84 historischen
-- Einkäufe tragen keine Antwort. Sie behalten sie auch nach dieser
-- Migration — es wird NICHTS zugeordnet und NICHTS geraten.
--
-- `manual` behält seinen Namen und bekommt nur ein deutsches Etikett. Ein
-- neuer Wert `other` hätte dasselbe bedeutet und einen Datenumzug für jede
-- künftig schon erfasste Zeile verlangt; `0115` nennt `manual` ausdrücklich
-- „for anything else".
--
-- ---------------------------------------------------------------------------
-- WARUM DAS RISIKOLOS IST
--
-- `add constraint … check` prüft die bestehenden Zeilen sofort. Hier sind
-- das 84 Einkäufe, die alle `platform IS NULL` tragen — der neue CHECK ist
-- für jede von ihnen wahr, bevor er geschrieben wird. Die Prüfung in
-- Abschnitt 0 stellt das fest, statt es anzunehmen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_count integer; v_bad text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'platform') then
    raise exception '0118 setzt 0115 voraus: purchases.platform fehlt';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'purchases_platform_known';
  if v_def is null then
    raise exception '0118 setzt 0115 voraus: der CHECK purchases_platform_known fehlt';
  end if;
  if position('ebay' in v_def) > 0 then
    raise notice '0118: ebay steht bereits im CHECK — die Migration ist wirkungslos und das ist in Ordnung.';
  end if;

  /*
   * UND JEDE BESTEHENDE ZEILE MUSS DEN NEUEN CHECK SCHON ERFÜLLEN.
   *
   * Sonst bricht `add constraint` mitten im Lauf ab, und zwar mit einer
   * Meldung über einen Constraint statt über die Sache. Hier gesagt, wer es
   * wäre.
   */
  select string_agg(distinct coalesce(p.platform, '(null)'), ', ')
    into v_bad
    from public.purchases p
   where p.platform is not null
     and p.platform not in ('kleinanzeigen', 'willhaben', 'ebay', 'manual');
  if v_bad is not null then
    raise exception '0118 Abbruch: diese Plattformwerte wären nach der Erweiterung unzulässig: %', v_bad;
  end if;

  select count(*) into v_count from public.purchases where platform is not null;
  raise notice '0118: % von % Einkäufen tragen heute eine Plattform.',
    v_count, (select count(*) from public.purchases);
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Der erweiterte CHECK
-- ---------------------------------------------------------------------------
alter table public.purchases drop constraint if exists purchases_platform_known;
alter table public.purchases
  add constraint purchases_platform_known
  check (platform is null
         or platform in ('kleinanzeigen', 'willhaben', 'ebay', 'manual'));

comment on column public.purchases.platform is
  'WHERE the parcel was bought (0115, `ebay` added in 0118): kleinanzeigen, ebay, willhaben, or manual for anything else. NULL means unknown and is the honest answer for every purchase recorded before the field existed — never guessed, never defaulted. NOT the seller — that is `seller_name`, and confusing the two would turn a marketplace into a person. Also not the payment route: `payment_method` has its own value `platform` for a marketplace''s internal checkout.';


-- ---------------------------------------------------------------------------
-- 2. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_count integer; v_missing text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'purchases_platform_known';
  if v_def is null then
    raise exception '0118 unvollständig: der CHECK purchases_platform_known fehlt';
  end if;

  -- Die vier Werte stehen drin. Keiner ist Teilzeichenkette eines anderen,
  -- also ist `position` hier eindeutig.
  select string_agg(w, ', ' order by w) into v_missing
    from unnest(array['kleinanzeigen', 'willhaben', 'ebay', 'manual']) as w
   where position(w in v_def) = 0;
  if v_missing is not null then
    raise exception '0118 unvollständig: diese Werte fehlen im CHECK (%): %', v_def, v_missing;
  end if;

  /*
   * UND KEINE ZEILE HAT SICH BEWEGT.
   *
   * Diese Migration schreibt keine Daten. Die zwei Prüfungen kosten nichts
   * und halten die Behauptung fest.
   */
  select count(*) into v_count from public.purchases where platform is not null;
  raise notice '0118: % von % Einkäufen tragen eine Plattform — unverändert gegenüber vorher.',
    v_count, (select count(*) from public.purchases);

  select count(*) into v_count from public.purchase_items
   where state = 'booked' and movement_id is null;
  if v_count > 0 then
    raise exception '0118 Befund: % gebuchte Positionen ohne Lagerbewegung', v_count;
  end if;

  select count(*) into v_count from public.purchase_items
   where state in ('damaged', 'missing', 'showcase', 'settled')
     and movement_id is not null;
  if v_count > 0 then
    raise exception '0118 Befund: % Positionen mit Sonderzustand UND Lagerbewegung', v_count;
  end if;
end;
$$;
