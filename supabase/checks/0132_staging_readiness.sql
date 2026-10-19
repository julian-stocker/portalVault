-- ===========================================================================
-- IST STAGING FUER DIE SCHREIBFAELLE H1-H12 UEBERHAUPT GEEIGNET?
--
-- ANLASS. `0132` soll auf Staging angewendet werden, und danach sollen die
-- zwoelf Schreibfaelle aus `0132_test_plan.md` ueber die Oberflaeche laufen.
-- Die kosten Zeit und erzeugen Zeilen; vorher gehoert geklaert, ob der
-- Datenbestand sie ueberhaupt traegt. Ein Testplan, dem die Testdaten fehlen,
-- faellt erst beim dritten Fall auf.
--
-- REIN LESEND. Ein einziges SELECT, kein DDL, keine Datenanweisung, keine
-- Transaktion. Kein Sollwert ausser bei den drei Zeilen, die die Vorbedingung
-- der Migration messen (900er).
--
-- FUER STAGING (`qqxcpesbwfxzgytkdsac`). Auf Production hat diese Datei keinen
-- Zweck: dort ist `0132` angewendet, und Schreibfaelle werden dort nicht
-- gefahren.
--
-- IDs IN DER AUSGABE sind Absicht. Wer H1 fahren will, braucht die Nummer des
-- Einkaufs, den er oeffnen soll — Raten kostet mehr Zeit als diese Spalte.
-- Keine personenbezogene Angabe, kein Preis, kein Kaeufer.
-- ===========================================================================

with
-- Zeilen importierter Einkaeufe, mit der Ablehnungsbedingung aus `0064`/`0132`.
importzeilen as (
  select i.id, i.purchase_id, i.state, i.sky_id, i.source_row, i.movement_id,
         i.legacy_booked_flag, i.legacy_condition_flag, p.source
    from public.purchase_items i
    join public.purchases p on p.id = i.purchase_id
   where p.source <> 'manual'
),
zeilen (nr, bereich, gegenstand, befund, erwartet) as (values

  -- -------------------------------------------------------------- Umgebung
  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s
                 where s.sky_id >= 'SKY-9000'), '(keine)'), null),
  (2, 'Umgebung', 'Info: Einkaeufe je Herkunft',
      coalesce((select string_agg(h.source || '=' || h.n::text, ', ' order by h.source)
                  from (select source, count(*) as n from public.purchases
                         group by source) h), '(keine)'), null),

  -- ------------------------------------------- Anmeldung: wer darf bedienen
  -- Ohne ein freigeschaltetes Bedienkonto zeigt `/business` nichts, und keine
  -- der zwoelf Faelle ist fahrbar. `auth.uid()` ist im SQL-Editor NULL —
  -- gezaehlt wird deshalb die Zahl der Konten, nicht die eigene Berechtigung.
  (101, 'Anmeldung', 'aktive Verkaeuferbetriebe (muss >= 1 sein)',
      (select count(*)::text from public.sellers s where s.is_active), null),
  (102, 'Anmeldung', 'freigeschaltete Bedienkonten (muss >= 1 sein)',
      (select count(*)::text from public.seller_operators o
        join public.sellers s on s.id = o.seller_id
       where o.is_enabled and s.is_active), null),

  -- ----------------------------------- H7/H8: geschuetzte Originalzeilen
  (201, 'H1/H7', 'importierte Zeilen insgesamt',
      (select count(*)::text from importzeilen), null),
  (202, 'H7/H8', 'davon mit reconciled_legacy (Faelle H7 und H8)',
      (select count(*)::text from importzeilen where state = 'reconciled_legacy'), null),
  (203, 'H7', 'davon wiedereroeffnet, aber mit source_row (der 0067-Fall zu H7)',
      (select count(*)::text from importzeilen
        where state <> 'reconciled_legacy' and source_row is not null), null),
  (204, 'H7', 'davon mit einer Legacy-Flagge',
      (select count(*)::text from importzeilen
        where legacy_booked_flag is not null or legacy_condition_flag is not null), null),
  (205, 'H7/H8', 'Einkauf mit der kleinsten Nummer, der eine reconciled_legacy-Zeile traegt',
      coalesce((select min(purchase_id)::text from importzeilen
                 where state = 'reconciled_legacy'), '(keiner)'), null),
  (206, 'H7', 'Einkauf mit der kleinsten Nummer, der eine wiedereroeffnete Zeile traegt',
      coalesce((select min(purchase_id)::text from importzeilen
                 where state <> 'reconciled_legacy' and source_row is not null), '(keiner)'),
      null),

  -- ------------------------------- H1-H6: oeffnen, nachtragen, buchen, entfernen
  (301, 'H4', 'waehlbare Katalogzeilen fuer das Nachtragen (aktiv und sichtbar)',
      (select count(*)::text from public.skylanders s
        where s.is_active and s.catalog_visible), null),
  (302, 'H1-H4', 'importierte Einkaeufe insgesamt — Kandidaten fuer H1 bis H4',
      (select count(*)::text from public.purchases where source <> 'manual'), null),
  (303, 'H6', 'bereits von Hand nachgetragene Zeilen an Importeinkaeufen (ohne source_row)',
      (select count(*)::text from importzeilen
        where source_row is null and legacy_booked_flag is null
          and legacy_condition_flag is null), null),

  -- ---------------------------------------------- H10/H11: die Zahlung
  (401, 'H11', 'importierte Einkaeufe mit Aufteilung / ohne',
      (select count(*)::text from public.purchases
        where source <> 'manual' and items_cost is not null) || ' / ' ||
      (select count(*)::text from public.purchases
        where source <> 'manual' and items_cost is null), null),
  (402, 'H10', 'Summe total_cost aller importierten Einkaeufe (Bezugswert)',
      (select coalesce(sum(total_cost), 0)::text from public.purchases
        where source <> 'manual'), null),
  (403, 'H11', 'Aufteilungen, die nicht aufgehen (muss 0 sein)',
      (select count(*)::text from public.purchases
        where items_cost is not null
          and round(coalesce(items_cost, 0) + coalesce(shipping_cost, 0)
                    + coalesce(buyer_protection_cost, 0), 2) <> round(total_cost, 2)), '0'),

  -- -------------------------------------------- H9: eine eingebuchte Zeile
  (501, 'H9', 'eingebuchte Zeilen an importierten Einkaeufen',
      (select count(*)::text from importzeilen where movement_id is not null), null),
  (502, 'H9', 'Einkauf mit der kleinsten Nummer, der eine eingebuchte Zeile traegt',
      coalesce((select min(purchase_id)::text from importzeilen
                 where movement_id is not null), '(keiner)'), null),

  -- ----------------------------------------- H12: Belege und die Bezugswerte
  (601, 'H12', 'Eigenbelege (muss vorher und nachher gleich sein)',
      (select count(*)::text from public.purchase_receipts), null),
  /*
   * BERICHTIGT AM 2026-10-18. Hier stand derselbe Zaehler mit dem Sollwert 0 —
   * und der Staging-Lauf hat gezeigt, dass das die falsche Erwartung ist:
   * `authenticated` DARF die Ausstellung aufrufen, denn genau das erklaeren
   * `0122` und `0128`. Was das auf Production verhindert, ist
   * `supabase/operations/lock-receipt-issuance.sql`, und dieser Schritt ist in
   * `APPLIED.md` ausschliesslich fuer Production verzeichnet. Eine Prueffrage,
   * die den Production-Sonderzustand von Staging verlangt, misst die falsche
   * Umgebung.
   *
   * Blockierend bleibt, was in BEIDEN Umgebungen falsch waere: ein fehlender
   * ACL (Standard = EXECUTE fuer PUBLIC), PUBLIC selbst, und `anon`.
   * `authenticated` und `service_role` sind Messung — sie unterscheiden die
   * beiden erklaerbaren Staende. Vollstaendige Aufstellung:
   * `supabase/checks/receipt_grants_diagnosis.sql`.
   */
  (602, 'H12', 'Belegausstellung offen fuer PUBLIC, anon oder per NULL-ACL (muss 0 sein)',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.seller_issue_purchase_receipt(bigint)')
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a
                           where a.privilege_type = 'EXECUTE'
                             and (a.grantee = 0
                                  or a.grantee::regrole::text = 'anon')))), '0'),
  -- Nach der Staging-Belegsperre (manuell angewendet, per Postflight
  -- bestaetigt) ist die Antwort in BEIDEN Umgebungen `false`. Vor der Sperre
  -- war sie auf Staging `true` — deshalb bleibt die Zeile eine Messung und
  -- bekommt keinen Sollwert: sie sagt, welcher Rechtestand gerade gilt.
  (603, 'H12', 'Info: darf authenticated ausstellen? (nach der Sperre: false)',
      (select has_function_privilege('authenticated',
         'public.seller_issue_purchase_receipt(bigint)', 'execute')::text
         where to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is not null),
      null),
  (611, 'H5/H9', 'Lagerzeilen / Einheiten / Bewegungen (Bezugswert)',
      (select count(*)::text from public.shop_inventory) || ' / ' ||
      (select coalesce(sum(quantity), 0)::text from public.shop_inventory) || ' / ' ||
      (select count(*)::text from public.inventory_movements), null),
  (612, 'H12', 'Eroeffnungsbestand aus dem Cutover (Positionen / Summe)',
      (select (count(*) filter (where d.diff <> 0))::text || ' / '
              || coalesce(sum(d.diff), 0)::text
         from (select i.quantity - coalesce((select sum(m.delta)
                                               from public.inventory_movements m
                                              where m.inventory_id = i.id), 0) as diff
                 from public.shop_inventory i) d), null),
  (613, 'H12', 'Positionen mit negativem Eroeffnungsbestand (muss 0 sein)',
      (select count(*)::text from public.shop_inventory i
        where i.quantity < coalesce((select sum(m.delta)
                                       from public.inventory_movements m
                                      where m.inventory_id = i.id), 0)), '0'),

  -- --------------------------------- 900er: die Vorbedingung der Migration
  (901, 'Vorbedingung', '0132 ist hier NOCH NICHT angewendet',
      (select (position('v_source is distinct from ''manual''' in p.prosrc) > 0)::text
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)')),
      'true'),
  (902, 'Vorbedingung', '0133-Trigger steht hier NOCH NICHT',
      (exists (select 1 from pg_trigger
                where not tgisinternal
                  and tgname = 'purchases_paid_total_immutable_trg'))::text, 'false'),
  (903, 'Vorbedingung', '0134 ist hier NOCH NICHT angewendet (seller_purchase ohne source_row)',
      (select (position('''source_row'', i.source_row' in p.prosrc) = 0)::text
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_purchase(bigint)')), 'true')
),
ergebnis as (
  select nr, bereich, gegenstand, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from zeilen
)
select nr, bereich, gegenstand, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
