-- ===========================================================================
-- PREFLIGHT fuer Migration 0126  —  Figuren hinzufuegen und entfernen
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- ABLESEN
--   ok = true    Bedingung erfuellt
--   ok = false   BLOCKIEREND. Nicht migrieren, bis geklaert ist, warum.
--   ok = null    Zahl oder Text zum Vergleich, kein Urteil
--
-- Zeile 9999 muss 0 zeigen.
--
-- DIE 9xx-ZEILEN SIND DIE EINGANGSSEITIGE BASELINE. Der Postflight vergleicht
-- gegen genau diese Zahlen; `0126` darf keine davon bewegen — sie legt eine
-- Funktion und einen Trigger an und faesst keine Daten an.
--
-- ---------------------------------------------------------------------------
-- WORAUF 0126 AUFSETZT
--
-- Sie schreibt keine Regel neu, sondern ruft drei bestehende Funktionen. Die
-- 1xx-Zeilen pruefen deshalb nicht nur, DASS es sie gibt, sondern dass ihre
-- Schutzregeln noch im Rumpf stehen. Verschwindet eine davon, waere `0126`
-- eine Lockerung — und genau das soll sie nicht sein.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die drei gerufenen Funktionen, mit ihren Schutzregeln
  -- =====================================================================
  (101, 'Felder', 'seller_update_purchase mit genau dieser 21er-Signatur',
        (to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
          || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
          || ' text, text, text, text, text, text, text, text)') is not null)::text,
        'true'),
  (102, 'Felder', 'und sie hat ein Betreibertor im Rumpf',
        (position('can_operate_active_seller' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_update_purchase'), '')) > 0)::text, 'true'),
  (110, 'Hinzufuegen', 'seller_add_purchase_item(bigint, text, text, text) vorhanden',
        (to_regprocedure('public.seller_add_purchase_item(bigint, text, text, text)')
           is not null)::text, 'true'),
  (111, 'Hinzufuegen', 'sie setzt KEINEN Zustand — der Default ordered bleibt',
        (position('state' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_add_purchase_item'), '')) = 0)::text, 'true'),
  (112, 'Hinzufuegen', 'und zaehlt die Position aus max(position) + 1',
        (position('coalesce(max(position), 0) + 1' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_add_purchase_item'), '')) > 0)::text, 'true'),
  (120, 'Entfernen', 'seller_remove_purchase_item(bigint) vorhanden',
        (to_regprocedure('public.seller_remove_purchase_item(bigint)') is not null)::text,
        'true'),
  /*
   * DER LAGERSCHUTZ IST DIE EINZIGE SPERRE — DER FREMDSCHLUESSEL IST ES NICHT.
   *
   * `purchase_items_movement_fk` zeigt VON der Position AUF die Bewegung, mit
   * `on delete restrict`. Das verhindert, die BEWEGUNG zu loeschen, solange
   * eine Position sie nennt — nicht, die Position zu loeschen. Wer die Zeile
   * entfernt, laesst eine Bewegung zurueck, die kein Einkauf mehr erklaert.
   *
   * Der Kommentar in `0064` sagt „the foreign key would refuse it anyway";
   * das trifft so nicht zu. Geprueft wird deshalb die Regel im Rumpf, und nur
   * sie.
   */
  (121, 'Entfernen', 'der Lagerschutz steht im Rumpf',
        (position('this item is already in inventory' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (122, 'Entfernen', 'und er prueft movement_id, nicht nur den Zustand',
        (position('movement_id is not null' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (123, 'Entfernen', 'der Arbeitsmappenschutz steht im Rumpf',
        (position('its provenance is not removable' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (124, 'Entfernen', 'und nennt alle vier Herkunftsmerkmale',
        ((select count(*) from (values ('reconciled_legacy'), ('source_row'),
            ('legacy_booked_flag'), ('legacy_condition_flag')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_remove_purchase_item'), '')) > 0))::text, '4'),
  (125, 'Entfernen', 'und sperrt die Zeile mit for update',
        (position('for update' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (130, 'Kette', 'alle drei sind security definer',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_update_purchase', 'seller_add_purchase_item',
                               'seller_remove_purchase_item')
             and p.prosecdef))::text, '3'),
  (131, 'Kette', 'und gehoeren EINEM Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_update_purchase', 'seller_add_purchase_item',
                               'seller_remove_purchase_item')))::text, '1'),
  (132, 'Kette', 'Info: wer ist dieser Eigentuemer',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_remove_purchase_item'), '(fehlt)'))::text,
        null),

  -- =====================================================================
  -- 2xx  Was 0126 anlegt, darf noch NICHT da sein
  -- =====================================================================
  (201, '0126', 'seller_save_purchase_edit existiert noch NICHT',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null)::text, 'true'),
  (202, '0126', 'die Triggerfunktion existiert noch NICHT',
        (to_regprocedure('public.purchase_items_touch_purchase()') is null)::text, 'true'),
  (203, '0126', 'und der Trigger auch nicht',
        (not exists (select 1 from pg_trigger t
                      where not t.tgisinternal
                        and t.tgname = 'purchase_items_touch_purchase_trg'))::text, 'true'),
  /*
   * UND HEUTE BEWEGT KEINE POSITIONSOPERATION purchases.updated_at.
   *
   * Das ist der Befund, aus dem `0126` entstanden ist: der Zeitstempel war als
   * Version unbrauchbar. Steht hier schon `0`, hat jemand den Trigger oder
   * eine andere Loesung vorab eingebaut — dann erst klaeren.
   */
  (204, '0126', 'keine der vier Positionsfunktionen fasst purchases an',
        ((select count(*) from (values ('seller_add_purchase_item'),
            ('seller_remove_purchase_item'), ('seller_set_purchase_item_sky'),
            ('seller_book_purchase_item')) t(fn)
           where position('update public.purchases' in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = t.fn), '')) > 0))::text, '0'),
  (205, '0126', 'und purchase_items hat keinen eigenen updated_at-Trigger',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid = 'public.purchase_items'::regclass))::text, '0'),

  -- =====================================================================
  -- 3xx  Die Annahmen des Datenmodells, auf denen 0126 ruht
  -- =====================================================================
  /*
   * KEINE KOSTEN AUF DER POSITION.
   *
   * Darauf ruht die Zusage „Hinzufuegen und Entfernen aendert keine Summe".
   * Gaebe es je eine Kostenspalte, waere sie falsch.
   */
  (301, 'Modell', 'purchase_items hat keine Kosten- oder Preisspalte',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_items'
             and (column_name like '%cost%'
                  or (column_name like '%price%' and column_name not like 'market_price%'))))::text,
        '0'),
  (302, 'Modell', 'der Zustands-Default ist ordered',
        (coalesce((select column_default from information_schema.columns
                    where table_schema = 'public' and table_name = 'purchase_items'
                      and column_name = 'state'), '(fehlt)'))::text,
        '''ordered''::text'),
  (303, 'Modell', 'der Zustands-CHECK steht',
        (exists (select 1 from pg_constraint
                  where conname = 'purchase_items_state_known'
                    and conrelid = 'public.purchase_items'::regclass))::text, 'true'),
  (304, 'Modell', 'movement_id zeigt mit on delete restrict auf die Bewegung',
        (coalesce((select c.confdeltype::text from pg_constraint c
                    where c.conname = 'purchase_items_movement_fk'), '(fehlt)'))::text, 'r'),
  (305, 'Modell', 'und die Positionszahl ist abgeleitet, nicht gespeichert',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'
             and column_name in ('item_count', 'items_count', 'total_items')))::text, '0'),
  (306, 'Modell', 'purchase_market_value(bigint) liefert sie',
        (to_regprocedure('public.purchase_market_value(bigint)') is not null)::text, 'true'),

  -- =====================================================================
  -- 4xx  Der Beleg-Fingerabdruck — was eine Positionsaenderung bewegt
  -- =====================================================================
  (401, 'Beleg', 'der Fingerabdruck hasht die Positionsliste',
        ((select count(*) from (values ('''lines'''), ('''position'''), ('''sky_id'''),
            ('''name'''), ('''condition''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '5'),
  (402, 'Beleg', 'und NICHT updated_at — der Trigger kann keinen Beleg veralten',
        (position('updated_at' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (403, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),

  -- =====================================================================
  -- 9xx  Eingangsseitige Baseline — der Postflight vergleicht dagegen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Summe total_cost',
        (coalesce((select sum(total_cost) from public.purchases), 0))::text, null),
  (905, 'Bestand', 'Positionen je Zustand: booked / nicht booked',
        ((select (count(*) filter (where state = 'booked'))::text || ' / '
                 || (count(*) filter (where state <> 'booked'))::text
            from public.purchase_items))::text, null),
  (906, 'Bestand', 'Positionen MIT Lagerbewegung',
        ((select count(*) from public.purchase_items where movement_id is not null))::text, null),
  (907, 'Bestand', 'Lagerbewegungen',
        ((select count(*) from public.inventory_movements))::text, null),
  (908, 'Bestand', 'Lagerzeilen / Summe Menge',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  (909, 'Bestand', 'Eigenbelege',
        ((select count(*) from public.purchase_receipts))::text, null),
  (910, 'Bestand', 'hoechste Positionsnummer je Einkauf, aufsteigend nach Einkauf',
        (coalesce((select string_agg(x.purchase_id::text || ':' || x.maxpos::text, ' | '
                                     order by x.purchase_id)
                     from (select purchase_id, max(position) as maxpos
                             from public.purchase_items group by purchase_id
                            order by purchase_id limit 5) x), '(keine)'))::text, null),
  /*
   * UND DER FINGERABDRUCK JEDES BELEGS.
   *
   * `0126` darf ihn nicht bewegen — die Migration legt nur an. Bewegt er sich
   * doch, hat zwischen den beiden Laeufen jemand eine Figur geaendert, und das
   * gehoert geklaert, bevor weitergearbeitet wird.
   */
  (921, 'Beleg', 'Belege, deren Fingerabdruck stimmt',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (922, 'Beleg', 'die ersten 16 Zeichen je Beleg — Postflight vergleicht exakt',
        (coalesce((select string_agg(
                     r.purchase_id::text || ':' ||
                     left(public.purchase_receipt_fingerprint(r.purchase_id), 16),
                     ' | ' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (992, 'Invariante', 'Positionen mit Sonderzustand UND Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state in ('damaged', 'missing')
             and movement_id is not null))::text, '0'),
  (993, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0')
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
