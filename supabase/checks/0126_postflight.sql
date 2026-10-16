-- ===========================================================================
-- POSTFLIGHT fuer Migration 0126  —  nach dem Anlegen
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI PRUEFEN KANN UND WAS NICHT
--
-- Sie prueft den ZUSTAND: dass der Trigger die erwartete Form hat, dass die
-- neue Funktion die drei bestehenden ruft und keine Regel neu schreibt, dass
-- die Rechte stimmen und dass sich kein Bestand bewegt hat.
--
-- SIE KANN NICHT PRUEFEN, was nur ein Schreibvorgang zeigt: dass ein
-- fehlgeschlagenes Entfernen die Einkaufsfelder mit zurueckrollt, dass zwei
-- Sitzungen sich erkennen, dass mehrere Positionsaenderungen in einer
-- Transaktion durchgehen. Das sind vier Faelle fuer die Hand — sie stehen in
-- der Anleitung, nicht hier. Eine lesende Datei, die so etwas behauptet,
-- wuerde luegen.
--
-- UND EIN HINWEIS ZUM TRIGGER, DER HIERHER GEHOERT: ein row-level AFTER
-- UPDATE feuert auch, wenn das UPDATE nichts geaendert hat (`set x = x`).
-- Fuer einen Versionsstempel ist das die sichere Richtung — er bewegt sich
-- eher zu oft als zu selten. Pruefung 113 haelt fest, dass bewusst KEINE
-- `when`-Bedingung daran haengt.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure(
           'public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)')),
         '') as d
),
/*
 * DERSELBE TEXT OHNE KOMMENTARE.
 *
 * `pg_get_functiondef` liefert den Rumpf zeichengetreu. `0124` ist zweimal an
 * einer Pruefung gescheitert, die Prosa fuer Code hielt — hier wird deshalb
 * kommentarfrei gesucht, und Pruefung 102 belegt, dass das Strippen tragfaehig
 * ist.
 */
code as (
  select regexp_replace(
           regexp_replace(d.d, '/\*.*?\*/', '', 'g'),
           '--.*', '', 'gn') as d
    from def d
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Der Trigger
  -- =====================================================================
  (101, 'Trigger', 'purchase_items_touch_purchase_trg steht auf purchase_items',
        (exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgname = 'purchase_items_touch_purchase_trg'
                    and t.tgrelid = 'public.purchase_items'::regclass))::text, 'true'),
  (102, 'Trigger', 'kein Stringliteral im Funktionsrumpf traegt einen Kommentarstarter',
        ((select count(*) from def d,
               regexp_matches(d.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text, '0'),
  /*
   * DIE FORM, NICHT DER NAME.
   *
   * `tgtype` Bit 0 = ROW, Bit 1 = BEFORE; Ereignisse 4 = INSERT, 8 = DELETE,
   * 16 = UPDATE. Erwartet: ROW, AFTER, alle drei — also 1 + 4 + 8 + 16 = 29.
   * Ein BEFORE-Trigger haette 31, ein statement-level 28, einer ohne DELETE 21.
   */
  (103, 'Trigger', 'ROW, AFTER, insert/update/delete — tgtype',
        (coalesce((select t.tgtype::int from pg_trigger t
                    where t.tgname = 'purchase_items_touch_purchase_trg'
                      and t.tgrelid = 'public.purchase_items'::regclass), -1))::text, '29'),
  (110, 'Trigger', 'die Triggerfunktion existiert',
        (to_regprocedure('public.purchase_items_touch_purchase()') is not null)::text, 'true'),
  (111, 'Trigger', 'sie bewegt purchases.updated_at',
        ((select count(*) from (values ('update public.purchases'),
            ('set updated_at = now()'),
            ('coalesce(new.purchase_id, old.purchase_id)')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_items_touch_purchase'), '')) > 0))::text, '3'),
  (112, 'Trigger', 'und faesst sonst nichts an',
        ((select count(*) from (values ('purchase_items'), ('inventory_movements'),
            ('shop_inventory'), ('purchase_receipts'), ('delete')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_items_touch_purchase'), '')) > 0))::text, '0'),
  (113, 'Trigger', 'ohne when-Bedingung — er feuert bei jedem Schreibvorgang',
        (coalesce((select (t.tgqual is null)::text from pg_trigger t
                    where t.tgname = 'purchase_items_touch_purchase_trg'
                      and t.tgrelid = 'public.purchase_items'::regclass), '(fehlt)'))::text,
        'true'),
  (114, 'Trigger', 'und es ist der EINZIGE Trigger auf purchase_items',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid = 'public.purchase_items'::regclass))::text, '1'),
  (115, 'Trigger', 'die Triggerfunktion haengt an keiner zweiten Tabelle',
        ((select count(distinct t.tgrelid) from pg_trigger t
           where not t.tgisinternal
             and t.tgfoid = to_regprocedure('public.purchase_items_touch_purchase()')))::text,
        '1'),
  (116, 'Trigger', 'security definer mit leerem search_path',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_items_touch_purchase'), '(fehlt)'))::text,
        'true'),
  (117, 'Trigger', 'und sie ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_items_touch_purchase'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (118, 'Trigger', 'EXECUTE nur an Eigentuemer und service_role',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_items_touch_purchase'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> p.proowner
             and (a.grantee = 0
                  or a.grantee::regrole::text <> 'service_role')))::text, '0'),
  (119, 'Trigger', 'Info: alle EXECUTE-Empfaenger im Klartext',
        (coalesce((select string_agg(
                     case when a.grantee = 0 then 'PUBLIC'
                          else a.grantee::regrole::text end, ', '
                     order by case when a.grantee = 0 then 'PUBLIC'
                                   else a.grantee::regrole::text end)
                     from pg_proc p, aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_items_touch_purchase'
                      and a.privilege_type = 'EXECUTE'), '(keine)'))::text, null),

  -- =====================================================================
  -- 2xx  Die neue Speicherfunktion
  -- =====================================================================
  (201, 'Speichern', 'seller_save_purchase_edit vorhanden',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null)::text, 'true'),
  (202, 'Speichern', 'genau eine Overload',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, '1'),
  (203, 'Speichern', 'genau FUENF Argumente, in dieser Reihenfolge (typbasiert)',
        (coalesce((select (p.pronargs = 5
                           and p.proargtypes[0]::regtype = 'bigint'::regtype
                           and p.proargtypes[1]::regtype = 'jsonb'::regtype
                           and p.proargtypes[2]::regtype = 'jsonb'::regtype
                           and p.proargtypes[3]::regtype = 'bigint[]'::regtype
                           and p.proargtypes[4]::regtype = 'timestamptz'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, 'true'),
  (204, 'Speichern', 'Rueckgabetyp jsonb',
        (coalesce(pg_get_function_result(to_regprocedure(
          'public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)')),
          '(fehlt)'))::text, 'jsonb'),
  (205, 'Speichern', 'volatile — sie schreibt',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, 'v'),
  (206, 'Speichern', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, 'true'),
  (207, 'Speichern', 'mit search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'seller_save_purchase_edit'
                    and c like 'search\_path=%'))::text, 'true'),
  (208, 'Speichern', 'und sie ist LEER',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (210, 'Rechte', 'anon darf NICHT ausfuehren',
        (has_function_privilege('anon', 'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)', 'EXECUTE'))::text, 'false'),
  (211, 'Rechte', 'authenticated darf ausfuehren',
        (has_function_privilege('authenticated', 'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)', 'EXECUTE'))::text, 'true'),
  (212, 'Rechte', 'PUBLIC hat kein EXECUTE',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'seller_save_purchase_edit'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee = 0))::text, 'true'),

  -- =====================================================================
  -- 22x  Sie ruft die drei bestehenden Funktionen — und schreibt nichts neu
  -- =====================================================================
  (221, 'Rumpf', 'das Betreibertor steht vor der Sperre',
        ((position('can_operate_active_seller()' in (select d from code)) > 0
          and position('can_operate_active_seller()' in (select d from code))
              < position('for update' in (select d from code))))::text, 'true'),
  (222, 'Rumpf', 'die Einkaufszeile wird gesperrt, bevor etwas geschrieben wird',
        ((position('for update' in (select d from code)) > 0
          and position('for update' in (select d from code))
              < position('public.seller_update_purchase(' in (select d from code))))::text,
        'true'),
  (223, 'Rumpf', 'die Version wird gegen purchases.updated_at geprueft',
        ((select count(*) from (values ('p_expected_updated_at'), ('is distinct from'),
            ('PT409')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (224, 'Rumpf', 'und NICHT als wiederholbarer Fehler gemeldet',
        (position('serialization_failure' in (select d from code)) = 0)::text, 'true'),
  (225, 'Rumpf', 'sie ruft alle drei bestehenden Funktionen',
        ((select count(*) from (values ('public.seller_update_purchase('),
            ('public.seller_remove_purchase_item('),
            ('public.seller_add_purchase_item(')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (226, 'Rumpf', 'ENTFERNEN kommt vor HINZUFUEGEN',
        ((position('public.seller_remove_purchase_item(' in (select d from code))
          < position('public.seller_add_purchase_item(' in (select d from code))))::text,
        'true'),
  /*
   * DER KERN DER FREIGABE: KEINE LOCKERUNG.
   *
   * Die drei gerufenen Funktionen tragen ihre Pruefungen selbst. Faende sich
   * hier eine Tabelle oder ein `delete`, waere eine Regel umgangen worden.
   */
  (227, 'Rumpf', 'sie beruehrt Lager, Beleg und Positionen NICHT direkt',
        ((select count(*) from (values ('inventory_movements'), ('shop_inventory'),
            ('purchase_receipts'), ('delete from')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (228, 'Rumpf', 'und setzt keinen Positionszustand',
        ((select count(*) from (values ('''booked'''), ('state =')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (229, 'Rumpf', 'eine Position muss zu DIESEM Einkauf gehoeren',
        ((select count(*) from (values ('i.purchase_id = p_id'),
            ('does not belong to purchase')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (230, 'Rumpf', 'und die neue Version kommt zurueck',
        (position('''updated_at'', v_actual' in (select d from code)) > 0)::text, 'true'),

  -- =====================================================================
  -- 3xx  Die drei gerufenen Funktionen sind unveraendert
  -- =====================================================================
  (301, 'Kette', 'alle fuenf Funktionen haben EINEN Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_save_purchase_edit', 'seller_update_purchase',
                               'seller_add_purchase_item', 'seller_remove_purchase_item',
                               'purchase_items_touch_purchase')))::text, '1'),
  (302, 'Kette', 'Info: wer ist dieser Eigentuemer (Preflight 132 vergleichen)',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, null),
  (303, 'Kette', 'der Lagerschutz in 0064 steht unveraendert',
        ((select count(*) from (values ('this item is already in inventory'),
            ('movement_id is not null'), ('for update')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_remove_purchase_item'), '')) > 0))::text, '3'),
  (304, 'Kette', 'der Arbeitsmappenschutz ebenso',
        ((select count(*) from (values ('its provenance is not removable'),
            ('reconciled_legacy'), ('source_row'), ('legacy_booked_flag'),
            ('legacy_condition_flag')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_remove_purchase_item'), '')) > 0))::text, '5'),
  (305, 'Kette', 'seller_add_purchase_item setzt weiterhin KEINEN Zustand',
        (position('state' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_add_purchase_item'), '')) = 0)::text, 'true'),
  (306, 'Kette', 'seller_update_purchase hat weiterhin die 21er-Signatur',
        (to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
          || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
          || ' text, text, text, text, text, text, text, text)') is not null)::text, 'true'),

  -- =====================================================================
  -- 4xx  Der Beleg bleibt unveraenderlich
  -- =====================================================================
  (401, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen weiterhin',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (402, 'Beleg', 'der Fingerabdruck hasht weiter die Positionsliste',
        ((select count(*) from (values ('''lines'''), ('''position'''), ('''sky_id'''),
            ('''name'''), ('''condition''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '5'),
  (403, 'Beleg', 'und weiterhin NICHT updated_at — der Trigger veraltet keinen Beleg',
        (position('updated_at' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (404, 'Beleg', 'die Belegtabellen bleiben fuer anon und authenticated gesperrt',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'INSERT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'UPDATE')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'DELETE')))::text, '0'),

  -- =====================================================================
  -- 9xx  Bestand — gegen den Preflight vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe (Preflight 902)',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen (Preflight 903)',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Summe total_cost (Preflight 904)',
        (coalesce((select sum(total_cost) from public.purchases), 0))::text, null),
  (905, 'Bestand', 'booked / nicht booked (Preflight 905)',
        ((select (count(*) filter (where state = 'booked'))::text || ' / '
                 || (count(*) filter (where state <> 'booked'))::text
            from public.purchase_items))::text, null),
  (906, 'Bestand', 'Positionen MIT Lagerbewegung (Preflight 906)',
        ((select count(*) from public.purchase_items where movement_id is not null))::text, null),
  (907, 'Bestand', 'Lagerbewegungen (Preflight 907)',
        ((select count(*) from public.inventory_movements))::text, null),
  (908, 'Bestand', 'Lagerzeilen / Menge (Preflight 908)',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  (909, 'Bestand', 'Eigenbelege (Preflight 909)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (910, 'Bestand', 'hoechste Positionsnummer je Einkauf (Preflight 910)',
        (coalesce((select string_agg(x.purchase_id::text || ':' || x.maxpos::text, ' | '
                                     order by x.purchase_id)
                     from (select purchase_id, max(position) as maxpos
                             from public.purchase_items group by purchase_id
                            order by purchase_id limit 5) x), '(keine)'))::text, null),
  (921, 'Beleg', 'Belege, deren Fingerabdruck stimmt (Preflight 921)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (922, 'Beleg', 'erste 16 Zeichen je Beleg — MUSS Preflight 922 gleichen',
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
