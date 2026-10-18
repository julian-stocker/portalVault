-- ===========================================================================
-- Eingangszustand vor 0132 — rein lesend
--
-- 0132 streicht in `seller_remove_purchase_item` die eine Bedingung, die auf
-- die HERKUNFT DES EINKAUFS sieht. Diese Datei prueft, dass die Fassung aus
-- 0064 wirklich hier steht, dass die vier Zeilenbedingungen vorhanden sind —
-- und vor allem die Annahme, auf der die Verschaerfung ruht: jede importierte
-- Zeile traegt mindestens ein Herkunftsmerkmal, und zwar immer eine
-- `source_row` (201, 203). NICHT geprueft wird `reconciled_legacy` als
-- Zustand: `0067` hat ihn fuer 109 nie gelieferte Zeilen bewusst auf
-- `ordered` zurueckgesetzt, und ihre `source_row` schuetzt sie weiter.
--
--
-- ---------------------------------------------------------------------------
-- BERICHTIGT AM 2026-10-18 — DIESE FASSUNG IST NICHT DIE GELAUFENE
--
-- Am 2026-10-18 lief diese Datei auf PRODUCTION (`zmiwxswrpkmizvqsgype`) und
-- meldete `9999 = 2`, vor und nach der Migration identisch. Vorgesehen war
-- Staging; der Betreiber hat die Verwechslung am selben Tag festgestellt und
-- gemeldet (`docs/history/2026-10-18-production-0132-0133.md`). Beide
-- Abweichungen waren richtig gemessen und falsch erwartet:
--
--   202  verlangte `reconciled_legacy` fuer jede importierte Zeile. `0067`
--        hat genau das fuer 109 nie gelieferte Zeilen bewusst aufgehoben.
--   303  verlangte `quantity = sum(delta)`. Der Pre-Go-Live-Reset vom
--        2026-09-21 hat das Journal geleert und `quantity` stehen lassen.
--
-- Die Zahlen aus jenem Lauf sind damit PRODUCTION-Zahlen. Auf Staging ist
-- `0132` nicht angewendet; dort ist diese Datei erst ab dem Staging-Rollout
-- aussagekraeftig (`supabase/checks/0132_staging_plan.md`).
--
-- Keine Daten wurden angefasst. Geaendert wurden die beiden Erwartungen, und
-- 303 prueft seither die Richtung der Differenz statt ihrer Abwesenheit.
-- 201 und 203 — die Pruefungen, die den Schutz der Arbeitsmappe tragen —
-- stehen unveraendert und waren in beiden Laeufen gruen.
-- ---------------------------------------------------------------------------
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with code as (
  select coalesce((select p.prosrc from pg_proc p
                    where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)')),
                  '') as d
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- -------------------------------------------------------------- Umgebung
  -- OHNE SOLLWERT, mit Absicht: dieselbe Datei laeuft spaeter auf Staging.
  -- Sie sagt nur, aus welcher Datenbank das Blatt kommt — die Lehre aus dem
  -- 2026-10-18, als zwei Migrationen in der falschen Umgebung liefen.
  -- Supabase fuehrt die Projektkennung nicht in der Datenbank; entschieden
  -- wird am einzigen Merkmal, das nur Staging hat: die beiden synthetischen
  -- Testfiguren der RLS- und Zahlungsproben. 2 = Staging, 0 = Production.
  (1, 'Umgebung', 'Info: Testfiguren SKY-9101/SKY-9998 (Staging 2, Production 0)',
        ((select count(*) from public.skylanders
           where sky_id in ('SKY-9101', 'SKY-9998')))::text, null),
  (2, 'Umgebung', 'Info: Einkaeufe insgesamt / davon importiert',
        ((select count(*)::text from public.purchases) || ' / '
         || (select count(*)::text from public.purchases where source <> 'manual')), null),
  (101, 'Fassung', 'seller_remove_purchase_item(bigint) ist da',
        (to_regprocedure('public.seller_remove_purchase_item(bigint)') is not null)::text, 'true'),
  (102, 'Fassung', 'die Herkunftsbedingung des Einkaufs steht noch drin (0064)',
        ((select position('v_source is distinct from ''manual''' in d) > 0 from code))::text, 'true'),
  (103, 'Fassung', 'alle vier Zeilenbedingungen stehen drin',
        ((select (position('v_item.state = ''reconciled_legacy''' in d) > 0
                  and position('v_item.source_row is not null' in d) > 0
                  and position('v_item.legacy_booked_flag is not null' in d) > 0
                  and position('v_item.legacy_condition_flag is not null' in d) > 0)
            from code))::text, 'true'),
  (104, 'Fassung', 'die Bedingung fuer eine eingebuchte Zeile steht drin',
        ((select position('v_item.movement_id is not null' in d) > 0 from code))::text, 'true'),
  (105, 'Fassung', 'die Funktion fasst keine Lagerbewegung an',
        ((select position('inventory_movements' in d) = 0 from code))::text, 'true'),

  -- Die Annahme, auf der 0132 ruht.
  (201, 'Arbeitsmappe', 'importierte Zeilen OHNE jedes Merkmal (muss 0 sein)',
        ((select count(*) from public.purchase_items i
           join public.purchases p on p.id = i.purchase_id
          where p.source <> 'manual'
            and i.state <> 'reconciled_legacy'
            and i.source_row is null
            and i.legacy_booked_flag is null
            and i.legacy_condition_flag is null))::text, '0'),
  -- KORRIGIERT. Die urspruengliche Fassung verlangte `reconciled_legacy` fuer
  -- jede importierte Zeile. Das war eine falsche Annahme: `0067` hat genau
  -- diese Gleichsetzung bewusst aufgehoben und 109 Zeilen auf `ordered`
  -- zurueckgesetzt — fuenf Pakete, die Ende August bestellt und nie geliefert
  -- wurden. `0053` hatte sie faelschlich als abgerechnet importiert. Der
  -- Zustand ist also kein Herkunftsmerkmal und darf keines sein: eine
  -- importierte Zeile laeuft nach ihrer Lieferung regulaer weiter ueber
  -- `arrived` nach `booked`. Was die Herkunft traegt, pruefen 201 und 203.
  (202, 'Arbeitsmappe', 'Info: Zustaende importierter Zeilen',
        ((select string_agg(z.state || '=' || z.n::text, ', ' order by z.state)
            from (select i.state, count(*) as n
                    from public.purchase_items i
                    join public.purchases p on p.id = i.purchase_id
                   where p.source <> 'manual'
                   group by i.state) z))::text, null),
  (203, 'Arbeitsmappe', 'importierte Zeilen ohne source_row (muss 0 sein)',
        ((select count(*) from public.purchase_items i
           join public.purchases p on p.id = i.purchase_id
          where p.source <> 'manual' and i.source_row is null))::text, '0'),
  (204, 'Arbeitsmappe', 'Info: Zeilen an importierten Einkaeufen insgesamt',
        ((select count(*) from public.purchase_items i
           join public.purchases p on p.id = i.purchase_id
          where p.source <> 'manual'))::text, null),
  (205, 'Arbeitsmappe', 'Info: Einkaeufe je Herkunft',
        ((select string_agg(h.source || '=' || h.n::text, ', ' order by h.source)
            from (select p.source, count(*) as n from public.purchases p
                   group by p.source) h))::text, null),

  -- Teil 2: die Zahlung
  (401, 'Zahlung', 'seller_update_purchase mit 21 Parametern ist da (0121)',
        (to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text)') is not null)::text, 'true'),
  (402, 'Zahlung', 'der Riegel auf total_cost fehlt noch',
        (position('the paid total of an imported purchase is final' in
          coalesce((select p.prosrc from pg_proc p
                     where p.oid = to_regprocedure(
                       'public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text)')), '')) = 0)::text, 'true'),
  (403, 'Zahlung', 'der CHECK purchases_cost_split_adds_up steht',
        (exists (select 1 from pg_constraint
                  where conname = 'purchases_cost_split_adds_up'))::text, 'true'),
  (404, 'Zahlung', 'Aufteilungen, die nicht aufgehen (muss 0 sein)',
        ((select count(*) from public.purchases p
           where p.items_cost is not null
             and round(p.items_cost + coalesce(p.shipping_cost, 0)
                       + coalesce(p.buyer_protection_cost, 0), 2)
                 <> round(p.total_cost, 2)))::text, '0'),
  (405, 'Zahlung', 'Info: importierte Einkaeufe mit Aufteilung / ohne',
        ((select count(*) filter (where p.items_cost is not null)::text || ' / '
                 || count(*) filter (where p.items_cost is null)::text
            from public.purchases p where p.source <> 'manual')), null),
  (406, 'Zahlung', 'Info: Summe total_cost aller importierten Einkaeufe',
        ((select coalesce(sum(p.total_cost), 0)::text from public.purchases p
           where p.source <> 'manual')), null),
  -- Was unberuehrt bleiben muss.
  (301, 'Bestand', 'Info: Lagerzeilen / Summe quantity',
        ((select count(*)::text || ' / ' || coalesce(sum(i.quantity), 0)::text
            from public.shop_inventory i)), null),
  (302, 'Bestand', 'Info: Lagerbewegungen',
        ((select count(*) from public.inventory_movements))::text, null),
  -- KORRIGIERT. `quantity = sum(delta)` gilt in diesen beiden Datenbanken
  -- seit dem Cutover nicht mehr und soll es nicht: der Pre-Go-Live-Reset vom
  -- 2026-09-21 hat `inventory_movements` vollstaendig geleert und
  -- `shop_inventory.quantity` ausdruecklich stehen lassen — „die losen Stueck
  -- sind ab jetzt die operative Ausgangsbasis"
  -- (docs/history/2026-09-21-pre-go-live-reset.md). Die Differenz je Position
  -- IST dieser Eroeffnungsbestand. Pruefbar bleibt die Richtung: er kann nie
  -- negativ sein, denn `quantity` bewegt sich seit dem Cutover ausschliesslich
  -- ueber `apply_inventory_movement` (0003/0093), und jede Bewegung schreibt
  -- beide Seiten in einer Transaktion. Eine negative Differenz hiesse, dass
  -- `quantity` ohne Bewegung gesunken ist oder eine Bewegung ohne `quantity`
  -- entstand — genau der Fehler, den die Pruefung finden soll.
  (303, 'Bestand', 'Lagerbilanz: Positionen mit negativem Eroeffnungsbestand (muss 0 sein)',
        ((select count(*) from public.shop_inventory i
           where i.quantity < coalesce((select sum(m.delta)
                                          from public.inventory_movements m
                                         where m.inventory_id = i.id), 0)))::text, '0'),
  -- Muss im Nachher denselben Wert zeigen wie im Vorher: 0132 fasst weder
  -- `shop_inventory` noch `inventory_movements` an.
  (307, 'Bestand', 'Info: Eroeffnungsbestand aus dem Cutover (Positionen / Summe)',
        ((select (count(*) filter (where d.diff <> 0))::text || ' / '
                 || coalesce(sum(d.diff), 0)::text
            from (select i.quantity - coalesce((select sum(m.delta)
                                                  from public.inventory_movements m
                                                 where m.inventory_id = i.id), 0) as diff
                    from public.shop_inventory i) d)), null),
  (304, 'Beleg', 'Eigenbelege (0132 fasst sie nicht an)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (305, 'Rechte', 'authenticated darf die Funktion ausfuehren',
        (has_function_privilege('authenticated',
          'public.seller_remove_purchase_item(bigint)', 'execute'))::text, 'true'),
  (306, 'Rechte', 'die Funktion hat einen materialisierten ACL (NULL waere PUBLIC)',
        ((select (p.proacl is not null) from pg_proc p
           where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)')))::text,
        'true')
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
