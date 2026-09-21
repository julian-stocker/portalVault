-- ===========================================================================
-- 0086 — Lifetime-Zähler, die an keiner Liste hängen (Lager V2, ADR-0102)
--
-- WAS KAPUTT WAR
--
-- `Eingekauft` und `Verkauft` wurden bisher zur Hälfte aus einer Liste
-- gerechnet: die Legacy-Hälfte kam aus `seller_legacy_stock_summary()` und
-- war vollständig, die operative Hälfte summierte der Browser aus den Zeilen,
-- die `seller_business_movements()` gerade zurückgegeben hatte — und die sind
-- per `p_limit` gekappt, hart bei 500. Eine Position mit mehr Bewegungen
-- hätte still zu wenig gezählt.
--
-- Eine Kennzahl über die Lebenszeit einer Position darf nicht davon abhängen,
-- wie viele Zeilen eine Zeitleiste gerade anzeigt. Das ist keine Einstellung,
-- die man groß genug wählen kann, sondern ein Kategorienfehler.
--
-- WAS DIESE MIGRATION TUT
--
-- Sie gibt dem operativen Pfad dieselbe Form, die der Legacy-Pfad seit 0079
-- schon hat: ein vollständiges Aggregat für die Seite, Einzelereignisse auf
-- Abruf. `seller_business_trade_totals()` summiert OHNE LIMIT über den ganzen
-- Ledger und ist damit per Konstruktion unabhängig von jeder Pagination.
--
-- EINE DEFINITION, NICHT ZWEI
--
-- Die Zähler und die Zeitleiste müssen exakt dieselbe Menge meinen. Stünde
-- der Filter zweimal da, könnte ihn jemand an einer Stelle ändern und an der
-- anderen vergessen — und das Ergebnis wären zwei Zahlen, die sich
-- widersprechen, ohne dass es auffällt. Genau die Sorte Fehler, die dieses
-- Feature gerade beseitigt.
--
-- Deshalb steht die Definition ab jetzt EINMAL, in `business_movements`, und
-- beide Funktionen lesen daraus. `seller_business_movements()` behält
-- Signatur, Rückgabespalten, Sortierung, Limit und Gate unverändert; nur ihr
-- Rumpf verweist auf den View statt den Filter zu wiederholen. Additive
-- Migration: nichts wird gelöscht, keine Spalte, keine Tabelle, keine
-- Funktion verschwindet.
--
-- WARUM EIN VIEW UND KEINE ZEILENFUNKTION
--
-- Eine `is_business_movement(id)` müsste je Zeile fünf Unterabfragen
-- auswerten. Der View lässt den Planer einmal über die ganze Menge gehen —
-- und er ist lesbar: wer wissen will, was eine Geschäftsbewegung ist, liest
-- eine Definition statt zweier.
--
-- ZUGRIFF
--
-- Der View trägt keine Rechte für `public`, `anon` oder `authenticated`,
-- genau wie die Tabellen darunter. Erreichbar ist er ausschließlich aus den
-- beiden `security definer`-Funktionen, und die fragen beide
-- `can_operate_active_seller()`, bevor sie eine Zeile ansehen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Was eine Geschäftsbewegung ist — die einzige Stelle, an der das steht.
--
--    Wortgleich die fünf Ausschlüsse aus 0085. Jeder davon ist eine Referenz
--    oder eine geprüfte Spalte; keiner liest `note`, keiner rät über
--    `reason`. Die Begründung zu jedem einzelnen steht im Kopf von 0085 und
--    wird hier nicht verdoppelt.
-- ---------------------------------------------------------------------------
create or replace view public.business_movements as
  select m.id,
         m.inventory_id,
         m.delta,
         m.reason,
         m.unit_cost,
         m.currency,
         m.note,
         m.created_at
    from public.inventory_movements m
    join public.shop_inventory i on i.id = m.inventory_id

   -- 1. Der technische Legacy-Startbestand.
   where m.reason <> 'initial_import'

     -- 2. Fixtures. Die Katalognummerierung endet weit unter 9000.
     and coalesce(
           nullif(regexp_replace(i.sky_id, '^SKY-', ''), '') ~ '^\d+$', false)
     and (regexp_replace(i.sky_id, '^SKY-', ''))::bigint < 9000

     -- 3. + 4. Alles, was eine Sandbox-Bestellung aus- oder zurückgebucht hat.
     and not exists (
       select 1
         from public.order_reservations r
         join public.orders o on o.id = r.order_id
        where o.commerce_mode = 'sandbox'
          and (r.movement_id = m.id or r.reverted_movement_id = m.id)
     )

     -- 5. Alles, was ein Orderbuch-Testverkauf gebucht oder retourniert hat.
     and not exists (
       select 1
         from public.sale_items si
         join public.sales s on s.id = si.sale_id
        where s.is_test
          and (si.movement_id = m.id or si.return_movement_id = m.id)
     );

comment on view public.business_movements is
  'The operative ledger as a business reads it (0086): inventory_movements without its technical and test rows. The single definition behind seller_business_movements() and seller_business_trade_totals(), so the timeline and the lifetime counters can never mean different sets. Every exclusion is a reference or a checked column; none reads a note. Internal — no role holds a privilege on it; both readers are security definer and both check can_operate_active_seller() first. admin_inventory_movements() is unchanged and still returns everything for audit.';

revoke all on table public.business_movements from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Die Zeitleiste liest jetzt den View.
--
--    Signatur, Rückgabespalten, Sortierung, Limit und Gate bleiben exakt wie
--    in 0085. Nur der Filter steht nicht mehr hier, sondern einmal oben.
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_movements(
  p_inventory_id bigint,
  p_limit        integer default 200
)
returns table (
  id         bigint,
  delta      integer,
  reason     text,
  unit_cost  numeric,
  currency   text,
  note       text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.id, b.delta, b.reason, b.unit_cost, b.currency, b.note, b.created_at
      from public.business_movements b
     where b.inventory_id = p_inventory_id
     order by b.created_at desc, b.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

comment on function public.seller_business_movements(bigint, integer) is
  'The operative stock history of one position as a business reads it (0085, view extracted in 0086): the ledger without its technical and test rows, newest first, capped by p_limit. THE LIMIT IS A DISPLAY CUT-OFF AND NOTHING ELSE — no lifetime figure may be computed from these rows; seller_business_trade_totals() answers that without a limit. admin_inventory_movements() is unchanged and still returns everything for audit.';

revoke all on function public.seller_business_movements(bigint, integer) from public, anon;
grant execute on function public.seller_business_movements(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Die Lebenszeit-Summen. Eine Zeile je Position, kein Limit.
--
--    WAS ZÄHLT UND WAS NICHT: `purchase` ist ein Einkauf; `sale`,
--    `sale_external` und das historische `sale_skyisles` sind Verkäufe.
--    `return`, `correction`, `writeoff` sind keins von beidem — eine Retoure
--    ist kein Einkauf, und eine Korrektur ist eine Nachzählung. Dieselbe
--    Aufteilung wie in `PURCHASE_REASONS` / `SALE_REASONS` der Anwendung und
--    dieselbe wie in `seller_legacy_stock_summary()` für die Legacy-Hälfte.
--
--    Die Vorzeichenprüfung ist bewusst doppelt gemoppelt: ein Einkauf mit
--    negativem Delta wäre eine Fehlbuchung und soll den Zähler nicht nach
--    unten ziehen.
--
--    Nur Positionen, die etwas zu zählen haben, kommen zurück. Die Anwendung
--    liest fehlende Positionen als 0 — das ist dieselbe Vereinbarung, die
--    `seller_legacy_stock_summary()` schon trägt.
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_trade_totals()
returns table (
  inventory_id    bigint,
  purchased_units integer,
  sold_units      integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.inventory_id,
           coalesce(sum(b.delta) filter (
             where b.reason = 'purchase' and b.delta > 0), 0)::integer,
           coalesce(-sum(b.delta) filter (
             where b.reason in ('sale', 'sale_external', 'sale_skyisles')
               and b.delta < 0), 0)::integer
      from public.business_movements b
     group by b.inventory_id
    having coalesce(sum(b.delta) filter (
             where b.reason = 'purchase' and b.delta > 0), 0) <> 0
        or coalesce(sum(b.delta) filter (
             where b.reason in ('sale', 'sale_external', 'sale_skyisles')
               and b.delta < 0), 0) <> 0;
end;
$$;

comment on function public.seller_business_trade_totals() is
  'Lifetime operative purchases and sales per inventory_id as positive unit counts (0086, Lager V2). Reads public.business_movements, the same definition seller_business_movements() uses, so the counters and the timeline can never disagree. NO LIMIT AND NO PAGINATION: a position with ten thousand movements is counted in full. Returns and corrections count as neither, matching PURCHASE_REASONS/SALE_REASONS in the application and seller_legacy_stock_summary() for the legacy half. A position with nothing to count is absent; the caller reads that as zero.';

revoke all on function public.seller_business_trade_totals() from public, anon;
grant execute on function public.seller_business_trade_totals() to authenticated;
