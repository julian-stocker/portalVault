-- ===========================================================================
-- POSTFLIGHT fuer Migration 0127  —  nach dem Austausch der Funktion
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI PRUEFEN KANN UND WAS NICHT
--
-- Sie prueft den ZUSTAND: dass genau eine Fassung existiert und sie sechs
-- Parameter mit den erwarteten Namen und Typen hat, dass fuenf davon einen
-- Default tragen (daran haengt der bestehende Client), dass die Rechte nach
-- dem `drop` wieder stehen, dass der Rumpf die vier bestehenden Funktionen
-- ruft und keine Regel umgeht, und dass sich kein Bestand bewegt hat.
--
-- SIE KANN NICHT PRUEFEN, was nur ein Schreibvorgang zeigt: dass ein
-- fehlgeschlagener Wechsel die Einkaufsfelder mit zurueckrollt, dass eine
-- eingebuchte Position wirklich abgelehnt wird, dass ein Aufruf mit FUENF
-- benannten Argumenten durchgeht. Das sind Faelle fuer die Hand — sie stehen
-- in der Anleitung, nicht hier. Eine lesende Datei, die so etwas behauptet,
-- wuerde luegen.
--
-- DIE RUECKWAERTSKOMPATIBILITAET WIRD HIER ALSO NUR IN IHREN VORAUSSETZUNGEN
-- GEPRUEFT: Namen, Typen, Defaults und genau eine Fassung. Ob PostgREST den
-- Aufruf tatsaechlich aufloest, zeigt erst der Aufruf selbst.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure(
           'public.seller_save_purchase_edit('
           || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)')),
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
  -- 1xx  Eine Fassung, und zwar die richtige
  -- =====================================================================
  (101, 'Fassung', 'die Sechs-Parameter-Fassung ist da',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null)::text,
        'true'),
  (102, 'Fassung', 'kein Stringliteral im Rumpf traegt einen Kommentarstarter',
        ((select count(*) from def d,
               regexp_matches(d.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text, '0'),
  /*
   * GENAU EINE FASSUNG — DAS IST DER GRUND FUER DAS `drop`.
   *
   * Zwei Fassungen waeren der Fehler, den `0127` gerade vermeidet: ein Aufruf
   * mit fuenf benannten Argumenten wuerde mit `function ... is not unique`
   * scheitern, und der Dialog koennte nicht mehr speichern.
   */
  (103, 'Fassung', 'genau EINE Overload',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, '1'),
  (104, 'Fassung', 'die Fuenf-Parameter-Fassung ist weg',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null)::text, 'true'),
  (105, 'Fassung', 'Rueckgabetyp jsonb',
        (coalesce(pg_get_function_result(to_regprocedure(
          'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)')), '(fehlt)'))::text,
        'jsonb'),
  (106, 'Fassung', 'volatile — sie schreibt',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, 'v'),
  (107, 'Fassung', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text,
        'true'),
  (108, 'Fassung', 'mit search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'seller_save_purchase_edit'
                    and c like 'search\_path=%'))::text, 'true'),
  /*
   * UND SIE IST LEER. Ein leerer `search_path` wird GEQUOTET gespeichert —
   * `search_path=""` —, deshalb wird der Wert ausgepackt und nicht der Text
   * verglichen. Die Lehre aus `0124` Pruefung 106.
   */
  (109, 'Fassung', 'und sie ist LEER',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),

  -- =====================================================================
  -- 12x  Die Signatur — hier haengt der bestehende Client
  -- =====================================================================
  /*
   * PostgREST loest einen RPC ueber die NAMEN der uebergebenen Argumente auf.
   * Ein Aufruf mit den ersten fuenf Namen trifft diese Funktion genau dann,
   * wenn (a) diese fuenf Namen und Typen unveraendert sind, (b) der sechste
   * einen Default hat und (c) es nur eine Fassung gibt.
   *
   * Typen werden ueber `proargtypes` nach POSITION verglichen, nicht als Text:
   * `pg_get_function_identity_arguments` druckt die Parameternamen mit, und
   * genau daran ist `0124` Pruefung 102 gescheitert. `proargtypes` ist dabei
   * ein NULLBASIERTER oidvector — `[0]` ist das erste Argument; `0125`
   * Pruefung 202 hat das auf die harte Art gezeigt.
   */
  (121, 'Signatur', 'genau sechs Parameter',
        (coalesce((select p.pronargs::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, '6'),
  (122, 'Signatur', 'die Namen, in dieser Reihenfolge',
        (coalesce((select array_to_string(p.proargnames, ', ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text,
        'p_id, p_fields, p_add, p_remove, p_expected_updated_at, p_swap'),
  (123, 'Signatur', 'die Typen, nach Position und nicht als Text',
        (coalesce((select (p.pronargs = 6
                           and p.proargtypes[0]::regtype = 'bigint'::regtype
                           and p.proargtypes[1]::regtype = 'jsonb'::regtype
                           and p.proargtypes[2]::regtype = 'jsonb'::regtype
                           and p.proargtypes[3]::regtype = 'bigint[]'::regtype
                           and p.proargtypes[4]::regtype = 'timestamptz'::regtype
                           and p.proargtypes[5]::regtype = 'jsonb'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text,
        'true'),
  (124, 'Signatur', 'FUENF der sechs haben einen Default — p_id nicht',
        (coalesce((select p.pronargdefaults::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, '5'),
  (125, 'Signatur', 'alle sechs sind Eingabeparameter (kein OUT, kein VARIADIC)',
        (coalesce((select (p.proargmodes is null)::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text,
        'true'),
  (126, 'Signatur', 'Info: die Signatur im Klartext, mit Namen',
        (coalesce(pg_get_function_arguments(to_regprocedure(
          'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)')), '(fehlt)'))::text,
        null),

  -- =====================================================================
  -- 2xx  Die Rechte, die das drop mitgenommen hat
  -- =====================================================================
  (201, 'Rechte', 'die Funktion hat einen ACL (NULL waere EXECUTE fuer PUBLIC)',
        ((select p.proacl is not null from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'))::text, 'true'),
  (202, 'Rechte', 'anon darf NICHT ausfuehren',
        (has_function_privilege('anon', 'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)', 'EXECUTE'))::text,
        'false'),
  (203, 'Rechte', 'authenticated darf ausfuehren — sonst speichert der Dialog nicht',
        (has_function_privilege('authenticated', 'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)', 'EXECUTE'))::text,
        'true'),
  (204, 'Rechte', 'PUBLIC hat kein EXECUTE',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'seller_save_purchase_edit'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee = 0))::text, 'true'),
  /*
   * UND SONST NIEMAND — AUSSER service_role UND DEM EIGENTUEMER.
   *
   * `service_role` behaelt EXECUTE mit Absicht (ADR-0125); der Eigentuemer
   * steht ohnehin im ACL. Eine Pruefung, die beide als Fehler liest, waere
   * falsch — das war der Befund an `0124` Pruefung 206.
   */
  (205, 'Rechte', 'kein weiterer Empfaenger als authenticated, service_role, Eigentuemer',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> p.proowner
             and (a.grantee = 0
                  or a.grantee::regrole::text not in ('authenticated', 'service_role'))))::text,
        '0'),
  (206, 'Rechte', 'Info: alle EXECUTE-Empfaenger im Klartext (Preflight 225 vergleichen)',
        (coalesce((select string_agg(
                     case when a.grantee = 0 then 'PUBLIC'
                          else a.grantee::regrole::text end, ', '
                     order by case when a.grantee = 0 then 'PUBLIC'
                                   else a.grantee::regrole::text end)
                     from pg_proc p, aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'
                      and a.privilege_type = 'EXECUTE'), '(keine)'))::text, null),
  (207, 'Rechte', 'und der Kommentar ist wieder da — das drop nimmt ihn mit',
        (coalesce(obj_description(to_regprocedure(
          'public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)'), 'pg_proc'),
          '(kein Kommentar)') like '%0127%')::text, 'true'),

  -- =====================================================================
  -- 3xx  Der Rumpf: vier gerufene Funktionen, keine umgangene Regel
  -- =====================================================================
  (301, 'Rumpf', 'das Betreibertor steht vor der Sperre',
        ((position('can_operate_active_seller()' in (select d from code)) > 0
          and position('can_operate_active_seller()' in (select d from code))
              < position('for update' in (select d from code))))::text, 'true'),
  (302, 'Rumpf', 'die Einkaufszeile wird gesperrt, bevor etwas geschrieben wird',
        ((position('for update' in (select d from code)) > 0
          and position('for update' in (select d from code))
              < position('public.seller_update_purchase(' in (select d from code))))::text,
        'true'),
  (303, 'Rumpf', 'die Version wird gegen purchases.updated_at geprueft',
        ((select count(*) from (values ('p_expected_updated_at'), ('is distinct from'),
            ('PT409')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '3'),
  (304, 'Rumpf', 'und NICHT als wiederholbarer Fehler gemeldet',
        (position('serialization_failure' in (select d from code)) = 0)::text, 'true'),
  (305, 'Rumpf', 'sie ruft alle VIER bestehenden Funktionen',
        ((select count(*) from (values ('public.seller_update_purchase('),
            ('public.seller_set_purchase_item_sky('),
            ('public.seller_remove_purchase_item('),
            ('public.seller_add_purchase_item(')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '4'),
  (306, 'Rumpf', 'WECHSELN kommt vor ENTFERNEN',
        ((position('public.seller_set_purchase_item_sky(' in (select d from code))
          < position('public.seller_remove_purchase_item(' in (select d from code))))::text,
        'true'),
  (307, 'Rumpf', 'und ENTFERNEN vor HINZUFUEGEN',
        ((position('public.seller_remove_purchase_item(' in (select d from code))
          < position('public.seller_add_purchase_item(' in (select d from code))))::text,
        'true'),
  /*
   * p_remember IST IMMER false.
   *
   * Eine gelernte Namensregel wuerde kuenftige Importe beeinflussen — das ist
   * eine andere Entscheidung als „diese eine Zeile korrigieren". Geprueft wird
   * beides: dass `false` dasteht und dass `true` NICHT dasteht.
   */
  (308, 'Rumpf', 'der Wechsel uebergibt p_remember als false',
        (position('v_sid, v_sky, false' in (select d from code)) > 0)::text, 'true'),
  (309, 'Rumpf', 'und lernt keine Namensregel',
        (position('v_sid, v_sky, true' in (select d from code)) = 0)::text, 'true'),
  (310, 'Rumpf', 'ein Wechsel auf dieselbe SKY-ID schreibt nicht',
        (position('v_current is distinct from v_sky' in (select d from code)) > 0)::text,
        'true'),
  (311, 'Rumpf', 'wechseln und entfernen zugleich wird abgelehnt',
        ((select count(*) from (values ('swapped and removed in the same save'),
            ('check_violation')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  (312, 'Rumpf', 'eine Position muss zu DIESEM Einkauf gehoeren',
        ((select count(*) from (values ('i.purchase_id = p_id'),
            ('does not belong to purchase')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '2'),
  /*
   * DER KERN DER FREIGABE: KEINE LOCKERUNG.
   *
   * Die vier gerufenen Funktionen tragen ihre Pruefungen selbst. Faende sich
   * hier eine Tabelle, ein `delete` oder die Namensregel-Tabelle, waere eine
   * Regel umgangen worden.
   */
  (313, 'Rumpf', 'sie beruehrt Lager, Beleg und Namensregeln NICHT direkt',
        ((select count(*) from (values ('inventory_movements'), ('shop_inventory'),
            ('purchase_receipts'), ('orderbook_name_mappings'), ('delete from')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (314, 'Rumpf', 'und setzt keinen Positionszustand',
        ((select count(*) from (values ('''booked'''), ('state =')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (315, 'Rumpf', 'sie schreibt purchase_items nicht selbst',
        (position('update public.purchase_items' in (select d from code)) = 0)::text, 'true'),
  (316, 'Rumpf', 'und die neue Version kommt zurueck',
        (position('''updated_at'', v_actual' in (select d from code)) > 0)::text, 'true'),
  (317, 'Rumpf', 'die Rueckgabe nennt alle fuenf Schluessel',
        ((select count(*) from (values ('''updated_at'''), ('''added'''), ('''removed'''),
            ('''swapped'''), ('''unchanged''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '5'),

  -- =====================================================================
  -- 4xx  Die gerufene Kette ist unveraendert
  -- =====================================================================
  (401, 'Kette', 'alle sechs Funktionen haben EINEN Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_save_purchase_edit', 'seller_update_purchase',
                               'seller_set_purchase_item_sky', 'seller_add_purchase_item',
                               'seller_remove_purchase_item',
                               'purchase_items_touch_purchase')))::text, '1'),
  (402, 'Kette', 'Info: wer ist dieser Eigentuemer (Preflight 122 vergleichen)',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_save_purchase_edit'), '(fehlt)'))::text, null),
  (403, 'Kette', 'der Lagerschutz in 0054 steht unveraendert',
        ((select count(*) from (values ('this item is in inventory'),
            ('movement_id is not null'), ('for update'), ('Deliberately untouched')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_set_purchase_item_sky'), '')) > 0))::text, '4'),
  (404, 'Kette', 'und sie setzt weiterhin keine der fuenf erhaltenen Spalten',
        ((select count(*) from (values ('position ='), ('source_row ='),
            ('state ='), ('legacy_booked_flag ='), ('legacy_condition_flag =')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_set_purchase_item_sky'), '')) = 0))::text, '5'),
  (405, 'Kette', 'der Lagerschutz in 0064 steht unveraendert',
        ((select count(*) from (values ('this item is already in inventory'),
            ('movement_id is not null'), ('for update')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_remove_purchase_item'), '')) > 0))::text, '3'),
  (406, 'Kette', 'der Arbeitsmappenschutz ebenso',
        ((select count(*) from (values ('its provenance is not removable'),
            ('reconciled_legacy'), ('source_row'), ('legacy_booked_flag'),
            ('legacy_condition_flag')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'seller_remove_purchase_item'), '')) > 0))::text, '5'),
  (407, 'Kette', 'seller_add_purchase_item setzt weiterhin KEINEN Zustand',
        (position('state' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_add_purchase_item'), '')) = 0)::text, 'true'),
  (408, 'Kette', 'seller_update_purchase hat weiterhin die 21er-Signatur',
        (to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
          || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
          || ' text, text, text, text, text, text, text, text)') is not null)::text, 'true'),
  (409, 'Kette', 'der Versionstrigger aus 0126 steht unveraendert',
        ((select t.tgtype::int from pg_trigger t
           where not t.tgisinternal
             and t.tgname = 'purchase_items_touch_purchase_trg'
             and t.tgrelid = 'public.purchase_items'::regclass))::text, '29'),
  (410, 'Kette', 'und seine Funktion ist fuer niemanden ausfuehrbar',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_items_touch_purchase'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> p.proowner
             and (a.grantee = 0
                  or a.grantee::regrole::text <> 'service_role')))::text, '0'),

  -- =====================================================================
  -- 5xx  Der Beleg bleibt unveraenderlich
  -- =====================================================================
  (501, 'Beleg', 'die Unveraenderlichkeits-Trigger stehen weiterhin',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (502, 'Beleg', 'der Fingerabdruck hasht weiter die Positionsliste',
        ((select count(*) from (values ('''lines'''), ('''position'''), ('''sky_id'''),
            ('''name'''), ('''condition''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '5'),
  (503, 'Beleg', 'und weiterhin NICHT updated_at',
        (position('updated_at' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (504, 'Beleg', 'authenticated darf den Fingerabdruck weiterhin nicht rufen (0125)',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),
  (505, 'Beleg', 'die Belegtabellen bleiben fuer anon und authenticated gesperrt',
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
  (910, 'Bestand', 'Pruefsumme (Position, SKY-ID, Zustand) — MUSS Preflight 910 gleichen',
        (coalesce((select md5(string_agg(
                     i.id::text || ':' || i.position::text || ':'
                     || coalesce(i.sky_id, '-') || ':' || i.state,
                     '|' order by i.id))
                     from public.purchase_items i), '(keine Positionen)'))::text, null),
  (911, 'Bestand', 'Positionen OHNE SKY-ID (Preflight 911)',
        ((select count(*) from public.purchase_items where sky_id is null))::text, null),
  (912, 'Bestand', 'gelernte Namensregeln — MUSS Preflight 912 gleichen',
        ((select count(*) from public.orderbook_name_mappings))::text, null),
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
