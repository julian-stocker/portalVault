-- ===========================================================================
-- WIRKUNGSPRUEFUNG nach dem gemeldeten Fehlversuch im Bearbeitungsdialog
--
-- Die Oberflaeche konnte nach dem Speichern nicht sagen, ob der Figurenwechsel
-- geschrieben wurde: sie zeichnete die Figurenliste aus einem veralteten
-- Zwischenspeicher und las den Belegzustand nicht neu nach. Diese Datei fragt
-- die Datenbank.
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung. Sie stellt
-- NICHTS richtig — sie sagt nur, was dasteht.
--
-- ABLESEN
--   Die 1xx- und 2xx-Zeilen sind BEFUNDE, keine Urteile: sie haben kein
--   `erwartet`. Ob ein Beleg abweicht, ist eine Tatsache und kein Fehler.
--   Blockierend sind nur die Invarianten in 99x. Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- DIE ENTSCHEIDENDE ZEILE IST 104
--
-- Seit `0126` bewegt JEDE Positionsaenderung `purchases.updated_at` (Trigger
-- `purchase_items_touch_purchase_trg`). Liegt `updated_at` NACH der
-- Ausstellung des Belegs, ist nach der Ausstellung geschrieben worden. Zusammen
-- mit 102 — stimmt der Fingerabdruck noch? — sagt das, ob der Wechsel
-- angekommen ist:
--
--   102 stimmt  und 104 nein   → es wurde nichts geaendert.
--   102 weicht ab              → die Figurenliste ist nicht mehr die des Belegs.
--   102 stimmt  und 104 ja     → geschrieben wurde etwas, aber nichts
--                                Belegrelevantes (z. B. nur die Notiz).
--
-- Belegnummern in der Ausgabe sind STAGING-TESTREFERENZEN.
-- ===========================================================================

with
beleg as (
  select r.id, r.purchase_id, r.receipt_number, r.issued_at, r.content_fingerprint,
         p.updated_at,
         public.purchase_receipt_fingerprint(r.purchase_id) as jetzt
    from public.purchase_receipts r
    join public.purchases p on p.id = r.purchase_id
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die Belege und ihr Verhaeltnis zum heutigen Stand
  -- =====================================================================
  (101, 'Beleg', 'Info: Anzahl Eigenbelege',
        ((select count(*) from beleg))::text, null),
  (102, 'Beleg', 'Info: je Beleg — Einkauf, Nummer, stimmt der Fingerabdruck?',
        (coalesce((select string_agg(
                     b.purchase_id::text || ' / ' || b.receipt_number || ' / '
                     || case when b.content_fingerprint = b.jetzt
                             then 'stimmt' else 'WEICHT AB' end,
                     ' | ' order by b.purchase_id)
                     from beleg b), '(keine Belege)'))::text, null),
  (103, 'Beleg', 'Info: Anzahl Belege, deren Fingerabdruck abweicht',
        ((select count(*) from beleg b
           where b.content_fingerprint is distinct from b.jetzt))::text, null),
  (104, 'Beleg', 'Info: je Beleg — wurde NACH der Ausstellung geschrieben?',
        (coalesce((select string_agg(
                     b.purchase_id::text || ': '
                     || case when b.updated_at > b.issued_at then 'ja' else 'nein' end,
                     ' | ' order by b.purchase_id)
                     from beleg b), '(keine Belege)'))::text, null),
  /*
   * `download_count` IST KEINE SPALTE. Die Belegtabelle kennt nur `revision`;
   * die Zahl der Abrufe faellt in `seller_purchase_receipt` aus
   * `purchase_receipt_downloads` an. Hier wird sie deshalb gezaehlt und nicht
   * gelesen — eine erfundene Spalte waere ein Laufzeitfehler statt einer
   * Antwort.
   */
  (105, 'Beleg', 'Info: Belegstand — revision und bestaetigte Abrufe',
        (coalesce((select string_agg(
                     b.receipt_number || ': rev ' || r.revision::text
                     || ', Abrufe ' || (select count(*) from public.purchase_receipt_downloads d
                                         where d.receipt_id = b.id)::text,
                     ' | ' order by b.purchase_id)
                     from beleg b join public.purchase_receipts r on r.id = b.id),
                  '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 2xx  Die Positionen der Einkaeufe MIT Beleg
  -- =====================================================================
  /*
   * DIE ZUORDNUNG IM KLARTEXT. `sky_id` ist das, was ein Wechsel aendert;
   * `raw_name` und `position` sind das, was er NICHT anfassen darf. Steht hier
   * die gewuenschte neue SKY-ID, ist der Wechsel angekommen.
   */
  (201, 'Position', 'Info: id · Nummer · SKY-ID · Zustand, je Position',
        (coalesce((select string_agg(
                     i.id::text || '·' || i.position::text || '·'
                     || coalesce(i.sky_id, '(ohne)') || '·' || i.state,
                     ' | ' order by i.purchase_id, i.position)
                     from public.purchase_items i
                    where i.purchase_id in (select purchase_id from beleg)),
                  '(keine Positionen)'))::text, null),
  (202, 'Position', 'Info: dieselben Positionen mit Rohnamen — Herkunft unberuehrt?',
        (coalesce((select string_agg(
                     i.id::text || '·' || coalesce(i.raw_name, '(ohne Rohname)')
                     || '·' || coalesce(i.source_row::text, '-'),
                     ' | ' order by i.purchase_id, i.position)
                     from public.purchase_items i
                    where i.purchase_id in (select purchase_id from beleg)),
                  '(keine Positionen)'))::text, null),
  (203, 'Position', 'Info: Positionen dieser Einkaeufe MIT Lagerbewegung',
        ((select count(*) from public.purchase_items i
           where i.purchase_id in (select purchase_id from beleg)
             and i.movement_id is not null))::text, null),
  (204, 'Position', 'Info: gelernte Namensregeln insgesamt (p_remember ist immer false)',
        ((select count(*) from public.orderbook_name_mappings))::text, null),

  -- =====================================================================
  -- 99x  Invarianten — hier wird geurteilt
  -- =====================================================================
  (991, 'Invariante', 'jede Position zeigt auf eine SKY-ID, die es gibt',
        ((select count(*) from public.purchase_items i
           where i.sky_id is not null
             and not exists (select 1 from public.skylanders s
                              where s.sky_id = i.sky_id)))::text, '0'),
  (992, 'Invariante', 'keine Position ohne SKY-ID UND ohne Rohname',
        ((select count(*) from public.purchase_items
           where sky_id is null and coalesce(btrim(raw_name), '') = ''))::text, '0'),
  (993, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (994, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0'),
  (995, 'Invariante', 'doppelte Positionsnummern je Einkauf',
        ((select count(*) from (select purchase_id, position
                                  from public.purchase_items
                                 group by purchase_id, position
                                having count(*) > 1) d))::text, '0')
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
