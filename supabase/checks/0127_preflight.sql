-- ===========================================================================
-- PREFLIGHT fuer Migration 0127  —  eine Figur direkt austauschen
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
-- gegen genau diese Zahlen; `0127` darf keine davon bewegen — sie tauscht eine
-- Funktion gegen eine mit einem Parameter mehr und faesst keine Daten an.
--
-- ---------------------------------------------------------------------------
-- WARUM DIESER PREFLIGHT ANDERS AUSSIEHT ALS DER VON 0126
--
-- `0126` hat angelegt, was es noch nicht gab. `0127` LOESCHT eine bestehende
-- Funktion und legt sie mit einem sechsten Parameter neu an. Daran haengen
-- drei Fragen, die `0126` nicht hatte:
--
--   1. Haengt etwas an der Funktion? Ein `drop` ohne `cascade` scheitert dann
--      — und das ist gewollt, soll aber vorher bekannt sein. Geprueft wird
--      `pg_depend` UND der Quelltext aller anderen Funktionen, denn ein
--      PL/pgSQL-Rumpf erzeugt keine Abhaengigkeit, die PostgreSQL kennt.
--   2. Welche Rechte hat sie heute? Das `drop` nimmt den ACL mit; `0127` setzt
--      ihn neu. Die 2xx-Zeilen schreiben den Soll-Zustand auf, damit der
--      Postflight ihn vergleichen kann.
--   3. Ist die Funktion mehrfach ueberladen? Dann waere ein Aufruf mit fuenf
--      benannten Argumenten schon heute mehrdeutig.
--
-- UND EIN SICHERER ZUSTAND DARF NICHT BLOCKIEREN. Laeuft dieser Preflight
-- nach `0127`, steht in 210 `NACH_0127` statt `VOR_0127` — beides ist in
-- Ordnung, `UNKLAR` nicht. Dieselbe Lehre wie bei `0125`.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Woraus 0127 besteht: vier gerufene Funktionen, unveraendert
  -- =====================================================================
  (101, 'Wechsel', 'seller_set_purchase_item_sky(bigint, text, boolean) vorhanden',
        (to_regprocedure('public.seller_set_purchase_item_sky(bigint, text, boolean)')
           is not null)::text, 'true'),
  (102, 'Wechsel', 'ihr dritter Parameter heisst p_remember',
        (coalesce((select p.proargnames[3] from pg_proc p
                    where p.oid = to_regprocedure(
                      'public.seller_set_purchase_item_sky(bigint, text, boolean)')),
                  '(fehlt)'))::text, 'p_remember'),
  /*
   * DER LAGERSCHUTZ IM WECHSEL IST DIE GANZE SPERRE.
   *
   * `0127` bietet den Tausch nicht an, wo er abgelehnt wuerde — aber
   * entschieden wird es hier, in `0054`. Faellt diese Zeile weg, waere der
   * Tausch durch `0127` eine Lockerung des Lagerschutzes.
   */
  (103, 'Wechsel', 'der Lagerschutz steht im Rumpf',
        (position('this item is in inventory' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_set_purchase_item_sky'), '')) > 0)::text, 'true'),
  (104, 'Wechsel', 'und er prueft movement_id, nicht nur den Zustand',
        (position('movement_id is not null' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_set_purchase_item_sky'), '')) > 0)::text, 'true'),
  (105, 'Wechsel', 'der Erhaltungskommentar steht: ID, Position, Herkunft bleiben',
        (position('Deliberately untouched' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_set_purchase_item_sky'), '')) > 0)::text, 'true'),
  (106, 'Wechsel', 'sie sperrt die Zeile mit for update',
        (position('for update' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_set_purchase_item_sky'), '')) > 0)::text, 'true'),
  /*
   * UND SIE SETZT WEDER POSITION NOCH HERKUNFT.
   *
   * Die Zusage des Betreibers — ID, Position, Zustand und Herkunft bleiben —
   * haengt daran, dass der Rumpf diese Spalten nicht nennt. Gezaehlt wird
   * deshalb, wie viele von fuenf er NICHT setzt; erwartet werden alle fuenf.
   */
  (107, 'Wechsel', 'sie setzt keine der fuenf erhaltenen Spalten',
        ((select count(*) from (values ('position ='), ('source_row ='),
            ('state ='), ('legacy_booked_flag ='), ('legacy_condition_flag =')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_set_purchase_item_sky'), '')) = 0))::text, '5'),
  (110, 'Felder', 'seller_update_purchase mit genau dieser 21er-Signatur',
        (to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
          || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
          || ' text, text, text, text, text, text, text, text)') is not null)::text,
        'true'),
  (111, 'Hinzufuegen', 'seller_add_purchase_item(bigint, text, text, text) vorhanden',
        (to_regprocedure('public.seller_add_purchase_item(bigint, text, text, text)')
           is not null)::text, 'true'),
  (112, 'Entfernen', 'seller_remove_purchase_item(bigint) vorhanden',
        (to_regprocedure('public.seller_remove_purchase_item(bigint)') is not null)::text,
        'true'),
  (113, 'Entfernen', 'der Lagerschutz steht im Rumpf',
        (position('this item is already in inventory' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (114, 'Entfernen', 'und der Arbeitsmappenschutz auch',
        (position('its provenance is not removable' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_remove_purchase_item'), '')) > 0)::text, 'true'),
  (120, 'Kette', 'alle vier gerufenen Funktionen sind security definer',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_update_purchase', 'seller_add_purchase_item',
                               'seller_remove_purchase_item',
                               'seller_set_purchase_item_sky')
             and p.prosecdef))::text, '4'),
  (121, 'Kette', 'und tragen alle ein Betreibertor',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_update_purchase', 'seller_add_purchase_item',
                               'seller_remove_purchase_item',
                               'seller_set_purchase_item_sky')
             and position('can_operate_active_seller' in p.prosrc) > 0))::text, '4'),
  (122, 'Kette', 'Info: wer ist ihr Eigentuemer',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_set_purchase_item_sky'), '(fehlt)'))::text,
        null),

  -- =====================================================================
  -- 15x  Was 0126 hinterlassen hat und 0127 voraussetzt
  -- =====================================================================
  (151, '0126', 'der Versionstrigger auf purchase_items steht',
        (exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgname = 'purchase_items_touch_purchase_trg'
                    and t.tgrelid = 'public.purchase_items'::regclass))::text, 'true'),
  (152, '0126', 'er feuert AFTER und fuer alle drei Ereignisse',
        ((select t.tgtype::int & (1 + 4 + 8 + 16) from pg_trigger t
           where not t.tgisinternal
             and t.tgname = 'purchase_items_touch_purchase_trg'
             and t.tgrelid = 'public.purchase_items'::regclass))::text, '29'),
  (153, '0126', 'und die Triggerfunktion ist fuer niemanden ausfuehrbar',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_items_touch_purchase()')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),

  -- =====================================================================
  -- 2xx  Die Funktion, die 0127 ersetzt
  -- =====================================================================
  (201, '0127', 'Info: Fuenf-Parameter-Fassung vorhanden',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null)::text, null),
  (202, '0127', 'Info: Sechs-Parameter-Fassung vorhanden',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null)::text, null),
  (203, '0127', 'genau EINE Fassung — zwei waeren schon heute mehrdeutig',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, '1'),
  /*
   * DER GESAMTBEFUND, ALS TEXT UND NICHT ALS FEHLER.
   *
   * Dieselbe Lehre wie `0125`: ein Preflight, der einen bereits korrekten
   * Zustand blockiert, zwingt zum Umgehen. Beide Zustaende sind sicher, nur
   * „keine Fassung" und „beide Fassungen" sind es nicht.
   */
  (210, '0127', 'Gesamtbefund zur Fassung',
        (case
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null
             then 'NACH_0127'
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is null
             then 'VOR_0127'
           else 'UNKLAR'
         end)::text, null),
  (211, '0127', 'der Befund ist VOR_0127 oder NACH_0127, nicht UNKLAR',
        (case
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null
             then 'true'
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is null
             then 'true'
           else 'false'
         end)::text, 'true'),
  (212, '0127', 'Info: Parameternamen der heutigen Fassung',
        (coalesce((select array_to_string(p.proargnames, ', ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, null),
  (213, '0127', 'Info: Anzahl Parameter mit Default',
        (coalesce((select p.pronargdefaults::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, null),

  -- =====================================================================
  -- 22x  Die Rechte, die das drop mitnimmt — Soll-Zustand fuer den Postflight
  -- =====================================================================
  (221, 'Rechte', 'die Funktion hat einen ACL (NULL waere EXECUTE fuer PUBLIC)',
        ((select p.proacl is not null from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, 'true'),
  /*
   * PUBLIC IST GRANTEE 0 UND KEINE ROLLE.
   *
   * `has_function_privilege('public', …)` wirft deshalb. Gelesen wird der ACL
   * mit `aclexplode` — dieselbe Lehre wie in `0124`.
   */
  (222, 'Rechte', 'PUBLIC hat kein EXECUTE',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'
             and a.privilege_type = 'EXECUTE'
             and a.grantee = 0))::text, '0'),
  (223, 'Rechte', 'anon hat kein EXECUTE',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> 0
             and a.grantee::regrole::text = 'anon'))::text, '0'),
  (224, 'Rechte', 'authenticated hat EXECUTE — sonst speichert der Dialog nicht',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> 0
             and a.grantee::regrole::text = 'authenticated'))::text, '1'),
  (225, 'Rechte', 'Info: der ganze ACL, Zeichen fuer Zeichen',
        (coalesce((select array_to_string(p.proacl, ' | ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(kein ACL)'))::text,
        null),
  (226, 'Rechte', 'sie ist security definer',
        ((select p.prosecdef from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, 'true'),
  (227, 'Rechte', 'und hat einen leeren search_path',
        ((select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'
             and c like 'search\_path=%'
             and nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '') is null))::text,
        '1'),

  -- =====================================================================
  -- 23x  Haengt etwas an der Funktion? Das drop hat kein cascade.
  -- =====================================================================
  /*
   * ZWEI VERSCHIEDENE ARTEN VON ABHAENGIGKEIT, UND POSTGRESQL KENNT NUR EINE.
   *
   * `pg_depend` verzeichnet Views, Defaults, Constraints, Policies und
   * Trigger. Ein PL/pgSQL-Rumpf, der die Funktion ruft, steht dort NICHT —
   * ein Name in einem Rumpf ist Text. Deshalb wird beides gezaehlt.
   */
  (231, 'Abhaengig', 'nichts in pg_depend haengt an der Funktion',
        ((select count(*) from pg_depend d
           where d.refclassid = 'pg_proc'::regclass
             and d.refobjid in (select p.oid from pg_proc p
                                 where p.pronamespace = 'public'::regnamespace
                                   and p.proname = 'seller_save_purchase_edit')))::text,
        '0'),
  (232, 'Abhaengig', 'keine andere Funktion nennt sie im Rumpf',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname <> 'seller_save_purchase_edit'
             and p.prosrc is not null
             and position('seller_save_purchase_edit' in p.prosrc) > 0))::text, '0'),
  (233, 'Abhaengig', 'keine View nennt sie',
        ((select count(*) from pg_views
           where schemaname not in ('pg_catalog', 'information_schema')
             and position('seller_save_purchase_edit' in definition) > 0))::text, '0'),
  (234, 'Abhaengig', 'keine Policy nennt sie',
        ((select count(*) from pg_policies
           where coalesce(qual, '') || ' ' || coalesce(with_check, '')
                 like '%seller_save_purchase_edit%'))::text, '0'),
  (235, 'Abhaengig', 'kein Spaltendefault nennt sie',
        ((select count(*) from pg_attrdef d
           where position('seller_save_purchase_edit'
                          in pg_get_expr(d.adbin, d.adrelid)) > 0))::text, '0'),
  (236, 'Abhaengig', 'kein Trigger nennt sie',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and position('seller_save_purchase_edit'
                          in pg_get_triggerdef(t.oid)) > 0))::text, '0'),

  -- =====================================================================
  -- 3xx  Die Annahmen des Datenmodells
  -- =====================================================================
  (301, 'Modell', 'purchase_items hat keine Kosten- oder Preisspalte',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_items'
             and (column_name like '%cost%'
                  or (column_name like '%price%' and column_name not like 'market_price%'))))::text,
        '0'),
  (302, 'Modell', 'sky_id und position sind beide da',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchase_items'
             and column_name in ('sky_id', 'position')))::text, '2'),
  (303, 'Modell', 'movement_id zeigt mit on delete restrict auf die Bewegung',
        (coalesce((select c.confdeltype::text from pg_constraint c
                    where c.conname = 'purchase_items_movement_fk'), '(fehlt)'))::text, 'r'),
  (304, 'Modell', 'und die Positionszahl ist abgeleitet, nicht gespeichert',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'
             and column_name in ('item_count', 'items_count', 'total_items')))::text, '0'),

  -- =====================================================================
  -- 4xx  Der Beleg — ein Wechsel veraltet ihn, und das ist beabsichtigt
  -- =====================================================================
  (401, 'Beleg', 'der Fingerabdruck hasht sky_id UND name',
        ((select count(*) from (values ('''sky_id'''), ('''name''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '2'),
  (402, 'Beleg', 'und NICHT updated_at — der Versionstrigger veraltet keinen Beleg',
        (position('updated_at' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (403, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (404, 'Beleg', 'authenticated darf den Fingerabdruck nicht rufen (0125)',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),

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
  /*
   * UND DIE ZUORDNUNG SELBST, ALS EINE ZAHL.
   *
   * `0127` aendert die Funktion, die Zuordnungen aendern KANN — angewendet
   * aendert sie keine. Bewegt sich diese Pruefsumme zwischen den beiden
   * Laeufen, hat jemand in der Zwischenzeit eine Figur getauscht, und das
   * gehoert geklaert, bevor weitergearbeitet wird.
   */
  (910, 'Bestand', 'Pruefsumme ueber (Position, SKY-ID, Zustand) aller Positionen',
        (coalesce((select md5(string_agg(
                     i.id::text || ':' || i.position::text || ':'
                     || coalesce(i.sky_id, '-') || ':' || i.state,
                     '|' order by i.id))
                     from public.purchase_items i), '(keine Positionen)'))::text, null),
  (911, 'Bestand', 'Positionen OHNE SKY-ID — nur Rohname',
        ((select count(*) from public.purchase_items where sky_id is null))::text, null),
  (912, 'Bestand', 'gelernte Namensregeln (p_remember ist immer false)',
        ((select count(*) from public.orderbook_name_mappings))::text, null),
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
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0'),
  (994, 'Invariante', 'Positionen mit SKY-ID, die es im Katalog nicht gibt',
        ((select count(*) from public.purchase_items i
           where i.sky_id is not null
             and not exists (select 1 from public.skylanders s
                              where s.sky_id = i.sky_id)))::text, '0')
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
