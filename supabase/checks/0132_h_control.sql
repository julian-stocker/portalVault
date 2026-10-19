-- ===========================================================================
-- KONTROLLE FUER DEN H-LAUF (H1-H12) AUF STAGING — rein lesend
--
-- WOZU. Der Testplan prueft Vorgaenge ueber die Oberflaeche. Was die
-- Oberflaeche zeigt, ist aber nicht der Nachweis — der steht in der Datenbank.
-- Diese Datei liefert VOR jedem Schritt den Ausgangszustand und NACH jedem
-- Schritt die Gegenprobe, und zwar fuer die drei konkreten Kandidaten:
--
--   Einkauf #6   geschuetzte Legacy-Positionen        (H7a, H8, H9)
--   Einkauf #88  wiedereroeffnete Originalpositionen  (H7b — der 0067-Fall)
--   Einkauf #92  bereits eingebuchte Positionen       (H9)
--
-- SO WIRD SIE BENUTZT: einmal vor dem ersten Schreibtest ausfuehren und das
-- Raster aufbewahren. Nach jedem Schritt erneut und gegen das erste Raster
-- vergleichen. Die 800er-Zeilen sind die Invarianten — sie muessen in JEDEM
-- Lauf gelten, vorher, zwischendrin und nachher.
--
-- REIN LESEND. Ein einziges SELECT, kein DDL, keine Datenanweisung, keine
-- Transaktion. Sie veraendert nichts und legt nichts an.
--
-- FUER STAGING (`qqxcpesbwfxzgytkdsac`). Auf Production hat sie keinen Zweck:
-- dort werden keine Schreibtests gefahren.
-- ===========================================================================

with kandidat (nr, zweck) as (values
  (6::bigint,  'H7a/H8/H9 — geschuetzte Legacy-Positionen'),
  (88::bigint, 'H7b — wiedereroeffnete Originalpositionen mit source_row'),
  (92::bigint, 'H9 — bereits eingebuchte Positionen')
),
-- Alle Zeilen der drei Kandidaten, mit der Ablehnungsbedingung aus `0132`.
zeile as (
  select i.id, i.purchase_id, i.position, i.state, i.sky_id, i.source_row,
         i.legacy_booked_flag, i.legacy_condition_flag, i.movement_id,
         (i.state = 'reconciled_legacy'
          or i.source_row is not null
          or i.legacy_booked_flag is not null
          or i.legacy_condition_flag is not null) as wird_abgelehnt
    from public.purchase_items i
   where i.purchase_id in (select k.nr from kandidat k)
),
pruef (nr, bereich, gegenstand, befund, erwartet) as (values

  -- -------------------------------------------------------------- Umgebung
  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s where s.sky_id >= 'SKY-9000'), '(keine)'), null),
  (2, 'Umgebung', '0132 ist angewendet (Herkunftsbedingung ist weg)',
      (select (position('v_source is distinct from ''manual''' in p.prosrc) = 0)::text
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_remove_purchase_item(bigint)')), 'true'),
  (3, 'Umgebung', '0133-Trigger steht NOCH NICHT (H10 prueft die Funktion, nicht den Trigger)',
      (exists (select 1 from pg_trigger where not tgisinternal
                and tgname = 'purchases_paid_total_immutable_trg'))::text, 'false'),
  (4, 'Umgebung', '0134 ist NOCH NICHT angewendet (seller_purchase ohne source_row)',
      (select (position('''source_row'', i.source_row' in p.prosrc) = 0)::text
         from pg_proc p where p.oid = to_regprocedure('public.seller_purchase(bigint)')), 'true'),

  -- ------------------------------------------------- Die drei Kandidaten
  (101, 'Kandidat', 'alle drei Einkaeufe vorhanden und importiert (muss 3 sein)',
      (select count(*)::text from public.purchases p
        where p.id in (select k.nr from kandidat k) and p.source <> 'manual'), '3'),
  (102, 'Kandidat', 'je Einkauf: Herkunft / Datum / bezahlte Summe / Waehrung',
      coalesce((select string_agg('#' || p.id::text || ': ' || p.source || ' / '
                 || coalesce(p.purchased_at::text, '(kein Datum)') || ' / '
                 || p.total_cost::text || ' ' || p.currency,
                 '  |  ' order by p.id)
                  from public.purchases p
                 where p.id in (select k.nr from kandidat k)), '(keiner)'), null),
  (103, 'Kandidat', 'je Einkauf: Aufteilung gesetzt?',
      coalesce((select string_agg('#' || p.id::text || ': '
                 || case when p.items_cost is null then 'ohne Aufteilung'
                         else 'items=' || p.items_cost::text
                              || ' versand=' || coalesce(p.shipping_cost, 0)::text
                              || ' schutz=' || coalesce(p.buyer_protection_cost, 0)::text end,
                 '  |  ' order by p.id)
                  from public.purchases p
                 where p.id in (select k.nr from kandidat k)), '(keiner)'), null),
  (104, 'Kandidat', 'je Einkauf: Absender / Inserat / Vereinbarung schon gefuellt?',
      coalesce((select string_agg('#' || p.id::text || ': absender='
                 || case when p.sender_name is null and p.sender_street is null
                           and p.sender_city is null then 'leer' else 'gefuellt' end
                 || ' inserat='
                 || case when p.listing_title is null and p.listing_url is null
                           and p.listing_details is null then 'leer' else 'gefuellt' end
                 || ' vereinbarung='
                 || case when p.agreement_note is null then 'leer' else 'gefuellt' end,
                 '  |  ' order by p.id)
                  from public.purchases p
                 where p.id in (select k.nr from kandidat k)), '(keiner)'), null),
  (105, 'Kandidat', 'je Einkauf: Positionen insgesamt',
      coalesce((select string_agg('#' || z.purchase_id::text || ': ' || z.n::text,
                                  '  |  ' order by z.purchase_id)
                  from (select purchase_id, count(*) as n from zeile group by purchase_id) z),
               '(keine)'), null),
  (106, 'Kandidat', 'je Einkauf: Zustaende',
      coalesce((select string_agg(x.txt, '  |  ' order by x.purchase_id)
                  from (select z.purchase_id,
                               '#' || z.purchase_id::text || ': '
                               || string_agg(z.state || '=' || z.n::text, ', ' order by z.state) as txt
                          from (select purchase_id, state, count(*) as n
                                  from zeile group by purchase_id, state) z
                         group by z.purchase_id) x), '(keine)'), null),
  (107, 'Kandidat', 'je Einkauf: Zeilen mit source_row / mit Legacy-Flagge / eingebucht',
      coalesce((select string_agg('#' || z.purchase_id::text || ': '
                 || z.mit_row::text || ' / ' || z.mit_flagge::text || ' / ' || z.gebucht::text,
                 '  |  ' order by z.purchase_id)
                  from (select purchase_id,
                               count(*) filter (where source_row is not null) as mit_row,
                               count(*) filter (where legacy_booked_flag is not null
                                                   or legacy_condition_flag is not null) as mit_flagge,
                               count(*) filter (where movement_id is not null) as gebucht
                          from zeile group by purchase_id) z), '(keine)'), null),

  -- ------------------------------------- Die Vorbedingungen je Testfall
  (201, 'H7a', '#6 hat mindestens eine reconciled_legacy-Zeile (muss true sein)',
      (exists (select 1 from zeile where purchase_id = 6
                and state = 'reconciled_legacy'))::text, 'true'),
  (202, 'H7b', '#88 hat mindestens eine wiedereroeffnete Zeile MIT source_row',
      (exists (select 1 from zeile where purchase_id = 88
                and state <> 'reconciled_legacy' and source_row is not null))::text, 'true'),
  (203, 'H7b', '#88: solche Zeilen OHNE Legacy-Flagge (nur die zeigen den 0134-Fall)',
      (select count(*)::text from zeile
        where purchase_id = 88 and state <> 'reconciled_legacy'
          and source_row is not null
          and legacy_booked_flag is null and legacy_condition_flag is null), null),
  (204, 'H9', '#92 hat mindestens eine eingebuchte Zeile (muss true sein)',
      (exists (select 1 from zeile where purchase_id = 92
                and movement_id is not null))::text, 'true'),
  (205, 'H7/H9', 'Zeilen der drei Kandidaten, die 0132 NICHT ablehnen wuerde',
      (select count(*)::text from zeile where not wird_abgelehnt), null),
  (206, 'H11', 'kleinste Nummer eines importierten Einkaufs OHNE Aufteilung',
      coalesce((select min(p.id)::text from public.purchases p
                 where p.source <> 'manual' and p.items_cost is null), '(keiner)'), null),
  (207, 'H4', 'waehlbare Katalogzeilen (aktiv und sichtbar)',
      (select count(*)::text from public.skylanders s
        where s.is_active and s.catalog_visible), null),
  (208, 'Anmeldung', 'aktive Betriebe / freigeschaltete Bedienkonten',
      (select count(*)::text from public.sellers where is_active) || ' / ' ||
      (select count(*)::text from public.seller_operators o
         join public.sellers s on s.id = o.seller_id
        where o.is_enabled and s.is_active), null),

  -- ---------------------------------------------- Bezugswerte (vor/nach)
  (301, 'Bezug', 'Lagerzeilen / Einheiten / Bewegungen',
      (select count(*)::text from public.shop_inventory) || ' / ' ||
      (select coalesce(sum(quantity), 0)::text from public.shop_inventory) || ' / ' ||
      (select count(*)::text from public.inventory_movements), null),
  (302, 'Bezug', 'importierte Einkaeufe / Positionen daran',
      (select count(*)::text from public.purchases where source <> 'manual') || ' / ' ||
      (select count(*)::text from public.purchase_items i
         join public.purchases p on p.id = i.purchase_id
        where p.source <> 'manual'), null),
  (303, 'Bezug', 'Summe total_cost aller importierten Einkaeufe',
      (select coalesce(sum(total_cost), 0)::text from public.purchases
        where source <> 'manual'), null),
  (304, 'Bezug', 'Eigenbelege / Zaehlerzeilen / Abrufnachweise',
      (select count(*)::text from public.purchase_receipts) || ' / ' ||
      (select count(*)::text from public.purchase_receipt_counters) || ' / ' ||
      (select count(*)::text from public.purchase_receipt_downloads), null),
  (305, 'Bezug', 'Eroeffnungsbestand aus dem Cutover (Positionen / Summe)',
      (select (count(*) filter (where d.diff <> 0))::text || ' / '
              || coalesce(sum(d.diff), 0)::text
         from (select i.quantity - coalesce((select sum(m.delta)
                                               from public.inventory_movements m
                                              where m.inventory_id = i.id), 0) as diff
                 from public.shop_inventory i) d), null),

  -- ------------------------------------------- Die letzten Bewegungen
  -- Damit sichtbar wird, WAS H5 angelegt hat und was die Ruecknahme bewirkt.
  (401, 'Journal', 'die letzten fuenf Bewegungen (Grund, delta, Figur)',
      coalesce((select string_agg(x.txt, '  |  ' order by x.id desc)
                  from (select m.id, m.reason || ' ' || m.delta::text || ' ' || i.sky_id
                               || coalesce(' [' || left(m.note, 40) || ']', '') as txt
                          from public.inventory_movements m
                          join public.shop_inventory i on i.id = m.inventory_id
                         order by m.id desc limit 5) x), '(keine)'), null),

  -- ---------------------------------------------------- Die Invarianten
  (801, 'Invariante', 'importierte Zeilen OHNE jedes Merkmal (muss immer 0 sein)',
      (select count(*)::text from public.purchase_items i
         join public.purchases p on p.id = i.purchase_id
        where p.source <> 'manual' and i.state <> 'reconciled_legacy'
          and i.source_row is null and i.legacy_booked_flag is null
          and i.legacy_condition_flag is null), '0'),
  (802, 'Invariante', 'importierte Zeilen ohne source_row (muss immer 0 sein)',
      (select count(*)::text from public.purchase_items i
         join public.purchases p on p.id = i.purchase_id
        where p.source <> 'manual' and i.source_row is null), '0'),
  (803, 'Invariante', 'Aufteilungen, die nicht aufgehen (muss immer 0 sein)',
      (select count(*)::text from public.purchases
        where items_cost is not null
          and round(coalesce(items_cost, 0) + coalesce(shipping_cost, 0)
                    + coalesce(buyer_protection_cost, 0), 2) <> round(total_cost, 2)), '0'),
  (804, 'Invariante', 'Positionen mit negativem Eroeffnungsbestand (muss immer 0 sein)',
      (select count(*)::text from public.shop_inventory i
        where i.quantity < coalesce((select sum(m.delta) from public.inventory_movements m
                                      where m.inventory_id = i.id), 0)), '0'),
  (805, 'Invariante', 'Belegausstellung offen fuer PUBLIC, anon oder per NULL-ACL',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.seller_issue_purchase_receipt(bigint)')
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a
                           where a.privilege_type = 'EXECUTE'
                             and (a.grantee = 0
                                  or a.grantee::regrole::text in ('anon', 'authenticated',
                                                                  'service_role'))))), '0'),
  (806, 'Invariante', 'state und movement_id stimmen ueberein (muss immer 0 sein)',
      (select count(*)::text from public.purchase_items
        where (state = 'booked') <> (movement_id is not null)), '0')
),
ergebnis as (
  select nr, bereich, gegenstand, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, gegenstand, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
