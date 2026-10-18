-- ===========================================================================
-- Eingangszustand vor 0133 — rein lesend
--
-- 0133 macht die bezahlte Summe eines importierten Einkaufs auch gegen ein
-- DIREKTES `update` unveraenderlich, mit einem Trigger. Diese Datei prueft,
-- dass die Grundlage steht (0115, 0132), dass der Trigger noch fehlt und
-- dass die Zahlen stimmen, an denen es sich danach messen laesst.
--
--
-- ERGAENZT AM 2026-10-18 um den Umgebungsstempel in Zeile 1. Die Fassung, die
-- auf Production gelaufen ist, hatte ihn noch nicht — sie ist im Uebrigen
-- unveraendert, und die Pruefnummern 101 und hoeher sind dieselben.
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ===========================================================================
with pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- -------------------------------------------------------------- Umgebung
  -- OHNE SOLLWERT: dieselbe Datei laeuft auf Production und auf Staging. Sie
  -- sagt nur, aus welcher Datenbank das Blatt kommt — die Lehre aus dem
  -- 2026-10-18, als 0132 und 0133 in der falschen Umgebung liefen. Supabase
  -- fuehrt die Projektkennung nicht in der Datenbank; entschieden wird am
  -- einzigen Merkmal, das nur Staging hat: die beiden synthetischen
  -- Testfiguren der RLS- und Zahlungsproben. 2 = Staging, 0 = Production.
  (1, 'Umgebung', 'Info: Testfiguren SKY-9101/SKY-9998 (Staging 2, Production 0)',
        ((select count(*) from public.skylanders
           where sky_id in ('SKY-9101', 'SKY-9998')))::text, null),
  (101, 'Grundlage', 'purchases ist da',
        (to_regclass('public.purchases') is not null)::text, 'true'),
  (102, 'Grundlage', 'CHECK purchases_cost_split_adds_up (0115)',
        (exists (select 1 from pg_constraint
                  where conname = 'purchases_cost_split_adds_up'))::text, 'true'),
  (103, 'Grundlage', 'der Riegel aus 0132 steht in seller_update_purchase',
        (position('the paid total of an imported purchase is final' in
          coalesce((select p.prosrc from pg_proc p
                     where p.oid = to_regprocedure(
                       'public.seller_update_purchase(bigint, date, numeric, text,'
                       || ' text, text, numeric, numeric, numeric, text, text,'
                       || ' boolean, text, text, text, text, text, text, text,'
                       || ' text, text)')), '')) > 0)::text, 'true'),
  (104, 'Grundlage', 'der Trigger fehlt noch',
        (exists (select 1 from pg_trigger
                  where not tgisinternal
                    and tgname = 'purchases_paid_total_immutable_trg'))::text, 'false'),
  (105, 'Grundlage', 'bisher kein Trigger auf purchases',
        ((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and c.relname = 'purchases'))::text, null),

  (201, 'Zahlung', 'Einkaeufe je Herkunft',
        ((select string_agg(h.source || '=' || h.n::text, ', ' order by h.source)
            from (select p.source, count(*) as n from public.purchases p
                   group by p.source) h)), null),
  (202, 'Zahlung', 'Summe total_cost der importierten Einkaeufe',
        ((select coalesce(sum(p.total_cost), 0)::text from public.purchases p
           where p.source <> 'manual')), null),
  (203, 'Zahlung', 'Aufteilungen, die nicht aufgehen (muss 0 sein)',
        ((select count(*) from public.purchases p
           where p.items_cost is not null
             and round(p.items_cost + coalesce(p.shipping_cost, 0)
                       + coalesce(p.buyer_protection_cost, 0), 2)
                 <> round(p.total_cost, 2)))::text, '0'),
  (204, 'Zahlung', 'Waehrungen der importierten Einkaeufe',
        ((select string_agg(distinct p.currency, ',' order by p.currency)
            from public.purchases p where p.source <> 'manual')), null),

  (301, 'Bestand', 'Lagerzeilen / Summe quantity',
        ((select count(*)::text || ' / ' || coalesce(sum(i.quantity), 0)::text
            from public.shop_inventory i)), null),
  (302, 'Bestand', 'Lagerbewegungen',
        ((select count(*) from public.inventory_movements))::text, null),
  (303, 'Beleg', 'Eigenbelege (0133 fasst sie nicht an)',
        ((select count(*) from public.purchase_receipts))::text, null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
order by nr;
