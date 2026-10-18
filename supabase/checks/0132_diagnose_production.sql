-- ===========================================================================
-- Diagnose der beiden Abweichungen aus dem PRODUCTION-Lauf von 0132
--
-- FUER PRODUCTION (`zmiwxswrpkmizvqsgype`). `0132` und `0133` wurden am
-- 2026-10-18 dort ausgefuehrt — unbeabsichtigt, vorgesehen war Staging. Die
-- Zahlen, die der Lauf gemeldet hat, sind damit Production-Zahlen, und diese
-- Datei prueft sie dort nach. Auf Staging liefe sie ins Leere: dort ist `0132`
-- nicht angewendet, und die Zeilen 1-10 haetten andere Sollwerte.
--
-- Die Zeilen 0a und 0b nennen die Umgebung, bevor irgendetwas gemessen wird.
-- Sie sind die Antwort auf den Vorfall: ein Ergebnisblatt, das nicht sagt, aus
-- welcher Datenbank es kommt, laesst sich verwechseln.
--
-- REIN LESEND. Ein einziges SELECT, keine Schreiboperation, kein DDL, kein
-- Trigger wird beruehrt. Die Datei beantwortet mit Daten, was aus den beiden
-- historischen Protokollen bereits hervorgeht:
--
--   A  Warum 109 importierte Positionen keinen `reconciled_legacy` tragen
--      (0067) — und ob sie trotzdem geschuetzt sind.
--   B  Warum `quantity <> sum(delta)` fuer 245 Positionen gilt
--      (Pre-Go-Live-Reset vom 2026-09-21) — und ob die Abweichung die
--      erwartete Richtung und Herkunft hat.
--
-- Erwartungen stehen in der Spalte `erwartet`. Wo sie leer ist, ist die Zeile
-- eine Messung ohne Sollwert.
-- ===========================================================================

with
-- Jede Zeile eines importierten Einkaufs, mit der Ablehnungsbedingung aus
-- `seller_remove_purchase_item` (0132) als Spalte.
import_items as (
  select i.id,
         i.state,
         i.source_row,
         i.legacy_booked_flag,
         i.legacy_condition_flag,
         i.movement_id,
         p.source,
         (i.state = 'reconciled_legacy'
          or i.source_row is not null
          or i.legacy_booked_flag is not null
          or i.legacy_condition_flag is not null) as wird_abgelehnt
    from public.purchase_items i
    join public.purchases p on p.id = i.purchase_id
   where p.source <> 'manual'
),
-- Je Lagerposition: gespeicherte Menge, Summe des Journals, Differenz.
bilanz as (
  select i.id,
         i.quantity,
         coalesce((select sum(m.delta) from public.inventory_movements m
                    where m.inventory_id = i.id), 0)::integer as journal,
         i.quantity - coalesce((select sum(m.delta) from public.inventory_movements m
                                 where m.inventory_id = i.id), 0)::integer as diff,
         (select count(*) from public.inventory_movements m
           where m.inventory_id = i.id) as bewegungen
    from public.shop_inventory i
),
befund (nr, bereich, frage, messung, erwartet) as (values

  -- ------------------------------------------------------- 0 Welche Datenbank
  -- Supabase fuehrt die Projektkennung nicht in der Datenbank. Entschieden
  -- wird daher an einem Merkmal, das nur Staging hat: die beiden synthetischen
  -- Testfiguren der RLS- und Zahlungsproben (`tools/seed-shop-fixtures.mts`).
  -- Beweiskraft in EINE Richtung — sind sie da, ist es Staging. Sind sie es
  -- nicht, spricht alles fuer Production; sicher sagt es die Projektkennung in
  -- der Adresszeile des SQL-Editors, und die gehoert ins Protokoll.
  (0, 'Umgebung', 'Testfiguren SKY-9101/SKY-9998 (Staging hat 2, Production 0)',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-9101', 'SKY-9998')), '0'),
  -- Die Funktion muss DA sein und die Herkunftsbedingung des Einkaufs
  -- NICHT mehr tragen. Fehlt die Funktion, ist die Messung NULL und die
  -- Zeile faellt durch — nicht „true, weil nichts gefunden".
  (1, 'Umgebung', 'Hoechste angewendete Migration dieser Reihe: 0132 ist da',
      (select (position('v_source is distinct from ''manual''' in p.prosrc) = 0)::text
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)')),
      'true'),
  (2, 'Umgebung', '0133: der Trigger auf purchases steht',
      (exists (select 1 from pg_trigger
                where not tgisinternal
                  and tgname = 'purchases_paid_total_immutable_trg'))::text, 'true'),

  -- ----------------------------------------------------------------- A 109
  (11, 'A Importzeilen', 'Zeilen an importierten Einkaeufen insgesamt',
      (select count(*)::text from import_items), null),
  (12, 'A Importzeilen', 'Zustaende dieser Zeilen',
      (select string_agg(z.state || '=' || z.n::text, ', ' order by z.state)
         from (select state, count(*) as n from import_items group by state) z), null),
  (13, 'A Importzeilen', 'Zeilen ohne reconciled_legacy — 0067 hat 109 wiedereroeffnet',
      (select count(*)::text from import_items where state <> 'reconciled_legacy'), '109'),
  (14, 'A Importzeilen', 'davon OHNE source_row (muss 0 sein — sonst waere der Schutz weg)',
      (select count(*)::text from import_items
        where state <> 'reconciled_legacy' and source_row is null), '0'),
  (15, 'A Importzeilen', 'davon mit legacy_booked_flag',
      (select count(*)::text from import_items
        where state <> 'reconciled_legacy' and legacy_booked_flag is not null), null),
  (16, 'A Importzeilen', 'davon mit legacy_condition_flag',
      (select count(*)::text from import_items
        where state <> 'reconciled_legacy' and legacy_condition_flag is not null), null),
  (17, 'A Importzeilen', 'davon bereits eingebucht (movement_id gesetzt)',
      (select count(*)::text from import_items
        where state <> 'reconciled_legacy' and movement_id is not null), null),
  (18, 'A Importzeilen', 'Zeilen, die seller_remove_purchase_item NICHT ablehnen wuerde',
      (select count(*)::text from import_items where not wird_abgelehnt), '0'),
  (19, 'A Importzeilen', 'Einkaeufe, zu denen die wiedereroeffneten Zeilen gehoeren',
      (select count(distinct i.purchase_id)::text
         from public.purchase_items i
         join public.purchases p on p.id = i.purchase_id
        where p.source <> 'manual' and i.state <> 'reconciled_legacy'), null),
  (20, 'A Importzeilen', 'Zeilen an Einkaeufen je Herkunft',
      (select string_agg(h.source || '=' || h.n::text, ', ' order by h.source)
         from (select source, count(*) as n from import_items group by source) h), null),

  -- --------------------------------------------------------------- B Bestand
  (30, 'B Bestand', 'Lagerpositionen insgesamt',
      (select count(*)::text from bilanz), null),
  (31, 'B Bestand', 'Summe quantity / Summe journal',
      (select coalesce(sum(quantity), 0)::text || ' / '
              || coalesce(sum(journal), 0)::text from bilanz), null),
  (32, 'B Bestand', 'Positionen mit diff <> 0',
      (select count(*)::text from bilanz where diff <> 0), null),
  (33, 'B Bestand', 'Positionen mit diff < 0 (muss 0 sein — Journal ohne quantity)',
      (select count(*)::text from bilanz where diff < 0), '0'),
  (34, 'B Bestand', 'Summe der positiven Differenzen = Eroeffnungsbestand',
      (select coalesce(sum(diff), 0)::text from bilanz where diff > 0), null),
  (35, 'B Bestand', 'Positionen ganz ohne Bewegung, aber mit quantity > 0',
      (select count(*)::text from bilanz where bewegungen = 0 and quantity > 0), null),
  (36, 'B Bestand', 'Positionen mit Bewegung UND diff <> 0 (Cutover plus Betrieb)',
      (select count(*)::text from bilanz where bewegungen > 0 and diff <> 0), null),
  (37, 'B Bestand', 'Positionen mit diff = 0 (erst nach dem Cutover entstanden)',
      (select count(*)::text from bilanz where diff = 0), null),
  (38, 'B Bestand', 'Bewegungen je Grund',
      (select string_agg(g.reason || '=' || g.n::text, ', ' order by g.reason)
         from (select reason, count(*) as n from public.inventory_movements
                group by reason) g), null),
  (39, 'B Bestand', 'initial_import-Bewegungen (0 belegt den geleerten Ledger)',
      (select count(*)::text from public.inventory_movements
        where reason = 'initial_import'), '0'),
  (40, 'B Bestand', 'aelteste Bewegung (nach dem Reset vom 2026-09-21)',
      (select coalesce(min(created_at)::date::text, '(keine)')
         from public.inventory_movements), null),
  (41, 'B Bestand', 'Bewegungen vor dem 2026-09-21 (muss 0 sein — der Reset loeschte alle)',
      (select count(*)::text from public.inventory_movements
        where created_at < date '2026-09-21'), '0'),
  (42, 'B Bestand', 'Lagerbilanz-View zeigt dieselbe Zahl wie Pruefung 303 alt',
      (select count(*)::text from public.shop_inventory_reconciliation
        where drift <> 0), null),
  (43, 'B Bestand', 'reserved ueberschreitet nirgends quantity (muss 0 sein)',
      (select count(*)::text from public.shop_inventory where reserved > quantity), '0'),
  (44, 'B Bestand', 'negative Menge oder negative Reservierung (muss 0 sein)',
      (select count(*)::text from public.shop_inventory
        where quantity < 0 or reserved < 0), '0'),
  (45, 'B Bestand', 'legacy_stock_events (die Rekonstruktion, 0079) Zeilen / Summe quantity',
      (select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
         from public.legacy_stock_events), null)
),
ergebnis as (
  select nr, bereich, frage, messung, erwartet,
         case when erwartet is null then null
              else messung is not distinct from erwartet end as ok
    from befund
)
select nr, bereich, frage, messung, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'Zeilen, die von der Erwartung abweichen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
