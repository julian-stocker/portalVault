-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0150, REIN LESEND
--
-- NACH `0150_availability_alerts.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
-- DIE ZUSAGEN VON `0150`, als Messung:
--
--   101-106  die Tabelle: sieben Spalten in dieser Folge, `id` als
--            GENERATED ALWAYS, der Primaerschluessel, beide Fremdschluessel
--            mit der richtigen Richtung, die drei CHECKs — und **kein
--            einziger Alarm**. Die Migration legt keinen an.
--   111-121  die Sicherheit: RLS an, GENAU EINE Richtlinie (nur lesen, nur
--            das Eigene), `authenticated` mit GENAU `select`, `anon` mit
--            nichts, vier Definer-Funktionen mit leerem `search_path`, kein
--            `EXECUTE` fuer `anon` oder `PUBLIC`, und die
--            Identitaetssequenz ohne jedes Clientrecht.
--   131-138  die Mechanik, und hier stehen die drei Zusagen, deren Bruch
--            unbemerkt bliebe:
--              * der Teilindex `availability_alerts_open_uniq` ist eindeutig
--                UND partiell — er IST die Regel „ein offener Alarm je Konto
--                und Figur", und ohne das Praedikat waere er eine andere;
--              * `fire_availability_alerts()` ist EINE Anweisung und nennt
--                `auth.uid()` GENAU EINMAL — in der Zaehlung, nie im
--                `update`. Das ist die Zusage an den spaeteren Scheduler:
--                ohne Nutzerkontext loest sie vollstaendig aus und gibt 0;
--              * `acknowledge_availability_alerts()` trifft die `id` und
--                traegt `read_at is null` — ereignisgenau, und historische
--                Meldungen bleiben unberuehrt.
--   141-143  die Grundlage bleibt, wie sie war. `offer_state_live` und
--            `shop_offers()` MUESSEN stehen (`0150` liest sie); die alte
--            Bauform ist **Auskunft ohne Erwartung** — sie darf fehlen
--            (Production) und darf sich nicht bewegen (Staging).
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang darf
-- `availability_alerts`, `favorites`, `offer_state` und
-- `availability_notifications` nicht lesen. Diese Zeilen melden ihm
-- `KEIN-RECHT`, zaehlen in Zeile 9998 und sind OFFEN — die Abnahme braucht
-- den Lauf als `postgres` (ADR-0139, ADR-0141).
-- ===========================================================================

with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
),
basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile.
   */
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.base', true), '')), ''),
                'BASIS-HIER-EINSETZEN') as roh
),
basis_teil as (
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as t
    from basis_roh
),
basis as (
  select roh, t,
         (t is not null and array_length(t, 1) = 9)                 as neun,
         (t is not null and t[1] = 'skyisles-base-1')               as marke,
         case when t is not null and array_length(t, 1) = 9
              then t[9] = left(md5(array_to_string(t[2:8], '|')), 12)
         end                                                        as schutz_ok,
         (t is not null and array_length(t, 1) = 9
          and t[1] = 'skyisles-base-1'
          and t[9] = left(md5(array_to_string(t[2:8], '|')), 12))   as gueltig
    from basis_teil
),
coll_mess as (
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
),
coll_roh as (
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.coll', true), '')), ''),
                'SAMMLUNG-HIER-EINSETZEN') as roh
),
coll_teil as (
  /*
   * `k` UND NICHT `t`, UND DAS IST KEIN SCHOENHEITSWUNSCH.
   *
   * Der Basis-Vertrag oben legt seine Felder in `t` ab und entscheidet mit
   * `gueltig`. `staging-oneshot.test.ts` haelt fuer die ganze Familie fest,
   * dass GENAU SIEBEN Vergleiche ihren Sollwert aus `when gueltig then t[…]`
   * holen — so faellt auf, wenn einer davon heimlich aus der Messung kaeme.
   * Haette der zweite Vertrag dieselben Namen, waeren es zehn Treffer, und
   * der Waechter koennte die beiden nicht mehr trennen. Er schlug beim
   * ersten Lauf dieser Datei genau deshalb an und hatte recht damit.
   *
   * Zwei Vertraege, zwei Namen: `t`/`gueltig` fuer den Shop,
   * `k`/`coll_gueltig` fuer die Sammlung.
   */
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as k
    from coll_roh
),
coll as (
  select roh, k,
         (k is not null and k[1] = 'skyisles-coll-1')               as marke,
         case when k is not null and array_length(k, 1) = 5
              then k[5] = left(md5(array_to_string(k[2:4], '|')), 12)
         end                                                        as schutz_ok,
         (k is not null and array_length(k, 1) = 5
          and k[1] = 'skyisles-coll-1'
          and k[5] = left(md5(array_to_string(k[2:4], '|')), 12))   as coll_gueltig
    from coll_teil
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proacl, p.proname,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab. Ein
          * Vergleich gegen ein Literal waere ein Fehlalarm in Wartestellung
          * — `src/lib/admin/migration-integrity.test.ts` haelt diese Regel
          * fuer jede Pruefdatei fest, die `proconfig` liest.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadanzahl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refresh_offer_state'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ----------------------------------------------------------- Die Tabelle
  (101, 'Tabelle', 'availability_alerts hat sieben Spalten in dieser Folge',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                 from pg_attribute a
                where a.attrelid = to_regclass('public.availability_alerts')
                  and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'id,user_id,sky_id,created_at,notified_at,notified_cents,read_at'),
  (102, 'Tabelle', 'id ist GENERATED ALWAYS AS IDENTITY, nicht BY DEFAULT',
      coalesce((select a.attidentity::text from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_alerts')
                   and a.attname = 'id'), '(keine Spalte)'), 'a'),
  (103, 'Tabelle', 'der Primaerschluessel ist (id)',
      coalesce((select string_agg(a.attname::text, ','
                        order by array_position(c.conkey, a.attnum))
                 from pg_constraint c
                 join pg_attribute a on a.attrelid = c.conrelid
                                    and a.attnum = any (c.conkey)
                where c.conrelid = to_regclass('public.availability_alerts')
                  and c.contype = 'p'), '(keiner)'), 'id'),
  (104, 'Tabelle', 'skylanders RESTRICT und auth.users CASCADE — sortiert nach Constraint-Name, also sky_fk vor user_fk',
      coalesce((select string_agg(c.confdeltype::text, '|' order by c.conname)
                 from pg_constraint c
                where c.conrelid = to_regclass('public.availability_alerts')
                  and c.contype = 'f'), '(keine)'), 'r|c'),
  (105, 'Tabelle', 'die drei CHECKs stehen',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.availability_alerts')
          and c.contype = 'c'
          and c.conname in ('availability_alerts_notified_price',
                            'availability_alerts_read_after_notified',
                            'availability_alerts_price_sane')), '3'),
  (106, 'Tabelle', 'KEIN Alarm steht — die Migration legt keinen an',
      case when to_regclass('public.availability_alerts') is null
             then '(keine Tabelle)'
           when has_table_privilege('public.availability_alerts', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.availability_alerts',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  -- -------------------------------------------------------- Die Sicherheit
  (111, 'Sicherheit', 'RLS ist an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.availability_alerts')),
               '(keine Tabelle)'), 'true'),
  (112, 'Sicherheit', 'es gibt GENAU EINE Richtlinie',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'availability_alerts'), '1'),
  (113, 'Sicherheit', 'und sie fragt das eigene Konto UND die Rolle',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'availability_alerts'
          and coalesce(qual, with_check) like '%is_collector_account()%'
          and coalesce(qual, with_check) like '%auth.uid()%'), '1'),
  (114, 'Sicherheit', 'keine Richtlinie gilt fuer anon',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'availability_alerts'
          and 'anon' = any (roles)), '0'),
  (115, 'Sicherheit', 'authenticated hat auf der Tabelle GENAU select',
      coalesce((select string_agg(distinct a.privilege_type, ','
                        order by a.privilege_type)
                 from pg_class c, aclexplode(c.relacl) a
                where c.oid = to_regclass('public.availability_alerts')
                  and a.grantee::regrole::text = 'authenticated'
                  and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                           'TRUNCATE', 'REFERENCES', 'TRIGGER')),
               '(keine)'), 'SELECT'),
  (116, 'Sicherheit', 'anon und PUBLIC haben nichts auf der Tabelle',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid = to_regclass('public.availability_alerts')
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (117, 'Sicherheit', 'alle vier Funktionen stehen',
      (select count(*)::text from unnest(array[
          'public.watch_availability(text)',
          'public.unwatch_availability(text)',
          'public.fire_availability_alerts()',
          'public.acknowledge_availability_alerts(bigint[])']) s
        where to_regprocedure(s) is not null), '4'),
  (118, 'Sicherheit', 'und alle vier sind definer, volatile und legen den '
        'search_path leer fest',
      (select count(*)::text from unnest(array[
          'public.watch_availability(text)',
          'public.unwatch_availability(text)',
          'public.fire_availability_alerts()',
          'public.acknowledge_availability_alerts(bigint[])']) s
        join pg_proc p on p.oid = to_regprocedure(s)
       where p.prosecdef and p.provolatile = 'v'
         and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
               where c like 'search\_path=%') = 1), '4'),
  (119, 'Sicherheit', 'kein EXECUTE fuer anon oder PUBLIC auf den vieren',
      (select count(*)::text from unnest(array[
          'public.watch_availability(text)',
          'public.unwatch_availability(text)',
          'public.fire_availability_alerts()',
          'public.acknowledge_availability_alerts(bigint[])']) s
        join pg_proc p on p.oid = to_regprocedure(s)
        cross join lateral aclexplode(p.proacl) a
       where a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (120, 'Sicherheit', 'und proacl ist bei allen vier NICHT NULL — sonst waere '
        'die Vorgabe "PUBLIC darf alles" still in Kraft',
      (select count(*)::text from unnest(array[
          'public.watch_availability(text)',
          'public.unwatch_availability(text)',
          'public.fire_availability_alerts()',
          'public.acknowledge_availability_alerts(bigint[])']) s
        join pg_proc p on p.oid = to_regprocedure(s)
       where p.proacl is not null), '4'),
  (121, 'Sicherheit', 'die Identitaetssequenz hat kein Clientrecht',
      /*
       * ERST FRAGEN, DANN RECHNEN. `pg_get_serial_sequence()` WIRFT, wenn
       * die Tabelle fehlt — und eine Pruefdatei, die an einer fehlenden
       * Tabelle abbricht statt sie zu melden, nimmt alle folgenden Zeilen
       * mit (dieselbe Lehre wie der Waechter in ADR-0141).
       */
      case when to_regclass('public.availability_alerts') is null
             then '(keine Tabelle)'
           else coalesce(
             (select count(*)::text from pg_class c, aclexplode(c.relacl) a
               where c.oid = pg_get_serial_sequence(
                               'public.availability_alerts', 'id')::regclass
                 and (a.grantee = 0
                      or a.grantee::regrole::text in ('anon', 'authenticated'))),
             '0') end, '0'),

  -- ---------------------------------------------------------- Die Mechanik
  (131, 'Mechanik', 'availability_alerts_open_uniq ist EINDEUTIG und ein '
        'TEILindex — er IST die Regel "ein offener Alarm je Konto und Figur"',
      coalesce((select (i.indisunique and i.indpred is not null)::text
                 from pg_index i
                where i.indexrelid = to_regclass('public.availability_alerts_open_uniq')),
               '(kein Index)'), 'true'),
  (132, 'Mechanik', 'die beiden anderen Indizes stehen und sind Teilindizes',
      (select count(*)::text from pg_index i
        where i.indexrelid in (to_regclass('public.availability_alerts_unread_idx'),
                               to_regclass('public.availability_alerts_pending_idx'))
          and i.indpred is not null), '2'),
  (133, 'Mechanik', 'fire_availability_alerts() ist EINE Anweisung — die '
        'Atomaritaet haengt daran',
      coalesce((select (length(p.prosrc) - length(replace(p.prosrc, ';', '')) <= 1)::text
                 from pg_proc p
                where p.oid = to_regprocedure('public.fire_availability_alerts()')),
               '(keine Funktion)'), 'true'),
  (134, 'Mechanik', 'und sie nennt auth.uid() GENAU EINMAL — in der Zaehlung, '
        'nie im update. Das ist die Zusage an den Scheduler',
      coalesce((select (select count(*)::text
                          from regexp_matches(p.prosrc, 'auth\.uid\(\)', 'g'))
                 from pg_proc p
                where p.oid = to_regprocedure('public.fire_availability_alerts()')),
               '(keine Funktion)'), '1'),
  (135, 'Mechanik', 'und sie liest die SICHT offer_state_live und nicht die '
        'Spiegeltabelle',
      coalesce((select (position('offer_state_live' in p.prosrc) > 0
                        and position('offer_state ' in p.prosrc) = 0
                        and position('offer_state.' in p.prosrc) = 0)::text
                 from pg_proc p
                where p.oid = to_regprocedure('public.fire_availability_alerts()')),
               '(keine Funktion)'), 'true'),
  (136, 'Mechanik', 'und sie nennt favorites NICHT — Herz und Glocke sind '
        'unabhaengig (ADR-0147)',
      coalesce((select (position('favorites' in p.prosrc) = 0)::text
                 from pg_proc p
                where p.oid = to_regprocedure('public.fire_availability_alerts()')),
               '(keine Funktion)'), 'true'),
  (137, 'Mechanik', 'acknowledge_availability_alerts() ist EINE Anweisung, '
        'traegt die Eigentuemerbedingung, schont die Historie und trifft die id',
      coalesce((select (
                  (length(p.prosrc) - length(replace(p.prosrc, ';', '')) <= 1)
                  and position('(select auth.uid()) = a.user_id' in p.prosrc) > 0
                  and position('a.read_at is null' in p.prosrc) > 0
                  and position('a.id = any (p_ids)' in p.prosrc) > 0)::text
                 from pg_proc p
                where p.oid = to_regprocedure(
                        'public.acknowledge_availability_alerts(bigint[])')),
               '(keine Funktion)'), 'true'),
  (138, 'Mechanik', 'kein Trigger auf availability_alerts und keiner an den '
        'Shopquellen — ein Fehler im Abgleich darf keinen Kauf erreichen',
      (select count(*)::text from pg_trigger t
        where not t.tgisinternal
          and t.tgrelid in (to_regclass('public.availability_alerts'),
                            to_regclass('public.shop_inventory'),
                            to_regclass('public.skylanders'),
                            to_regclass('public.shop_settings'))
          and t.tgname like '%availability_alert%'), '0'),

  -- ------------------------------------- Die Grundlage bleibt, wie sie war
  (141, 'Grundlage', 'die SICHT offer_state_live steht unveraendert (0146)',
      (to_regclass('public.offer_state_live') is not null)::text, 'true'),
  (142, 'Grundlage', 'shop_offers() steht unveraendert',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  /*
   * AUSKUNFT OHNE ERWARTUNG. Die alte Bauform darf FEHLEN (Production) und
   * darf sich nicht bewegen (Staging) — eine Erwartung waere beides zugleich
   * falsch. Verglichen wird sie ueber den Preflight (121-124), nicht hier.
   */
  (143, 'Grundlage', 'Info: steht die alte Bauform noch? '
        'favorites/offer_state/availability_notifications',
      (to_regclass('public.favorites') is not null)::text || '/'
      || (to_regclass('public.offer_state') is not null)::text || '/'
      || (to_regclass('public.availability_notifications') is not null)::text, null),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0150 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (801, 'Basis', 'eine Shop-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 900 des '
                        || 'Preflights in set_config(''skyisles.base'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-base-1',
      (select coalesce(marke::text, 'keine Baseline') from basis), 'true'),
  (803, 'Basis', 'sie hat neun Felder',
      (select case when t is null then 'keine Baseline'
                   else array_length(t, 1)::text end from basis), '9'),
  (804, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from basis), 'true'),

  (811, 'Shop', 'oeffentliche Angebote wie vor der Migration',
      (select angebote from basis_mess),
      (select case when gueltig then t[2] else '(keine gueltige Basis)' end from basis)),
  (812, 'Shop', 'Angebots-Abdruck wie vor der Migration',
      (select angebote_md5 from basis_mess),
      (select case when gueltig then t[3] else '(keine gueltige Basis)' end from basis)),
  (813, 'Shop', 'shopfaehige Katalogzeilen wie vor der Migration',
      (select shopfaehig from basis_mess),
      (select case when gueltig then t[4] else '(keine gueltige Basis)' end from basis)),
  (814, 'Shop', 'sammelbare Katalogzeilen wie vor der Migration',
      (select sammelbar from basis_mess),
      (select case when gueltig then t[5] else '(keine gueltige Basis)' end from basis)),
  (815, 'Shop', 'Lagerzeilen wie vor der Migration',
      (select lagerzeilen from basis_mess),
      (select case when gueltig then t[6] else '(keine gueltige Basis)' end from basis)),
  (816, 'Shop', 'Katalogzeilen wie vor der Migration',
      (select katalogzeilen from basis_mess),
      (select case when gueltig then t[7] else '(keine gueltige Basis)' end from basis)),
  (817, 'Shop', 'Lager-Abdruck wie vor der Migration',
      (select lager_md5 from basis_mess),
      (select case when gueltig then t[8] else '(keine gueltige Basis)' end from basis)),

  -- ============================ Die Sammlungs-Baseline aus dem Preflight
  /*
   * DIE ZUSAGE, DIE 0145 GIBT: die Wunschliste kommt DANEBEN, die Sammlung
   * bleibt, wie sie war. Diese sechs Zeilen sind die Messung dazu.
   */
  (821, 'Sammlung', 'eine Sammlungs-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 901 des '
                        || 'Preflights in set_config(''skyisles.coll'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from coll), 'ja'),
  (822, 'Sammlung', 'sie traegt die Marke skyisles-coll-1',
      (select coalesce(marke::text, 'keine Baseline') from coll), 'true'),
  (823, 'Sammlung', 'sie hat fuenf Felder',
      (select case when k is null then 'keine Baseline'
                   else array_length(k, 1)::text end from coll), '5'),
  (824, 'Sammlung', 'die Schutzsumme stimmt',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from coll), 'true'),

  (831, 'Sammlung', 'Sammlungszeilen wie vor der Migration',
      (select zeilen from coll_mess),
      (select case when coll_gueltig then k[2]
                   else '(keine gueltige Basis)' end from coll)),
  (832, 'Sammlung', 'Konten mit Sammlung wie vor der Migration',
      (select konten from coll_mess),
      (select case when coll_gueltig then k[3]
                   else '(keine gueltige Basis)' end from coll)),
  (833, 'Sammlung', 'Sammlungs-Abdruck wie vor der Migration — Inhalt UND Reihenfolge',
      (select sammlung_md5 from coll_mess),
      (select case when coll_gueltig then k[4]
                   else '(keine gueltige Basis)' end from coll)),

  -- ------------------------------------------------------------ Zum Nachlesen
  /*
   * DIE NUMMERN 818 UND 819 SIND DIE DER FAMILIE. `0142` bis `0144` fuehren
   * den heutigen Stand unter 819, und `staging-oneshot.test.ts` prueft das
   * fuer jede Datei des Basis-Vertrags. Eine eigene Nummerierung hier waere
   * eine zweite Ordnung fuer dieselbe Sache.
   */
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
      (select zeile from basis_zeile), null),
  (828, 'Sammlung', 'Info: die uebergebene Sammlungs-Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from coll), null),
  (829, 'Sammlung', 'Info: der heutige Sammlungsstand als Baseline-Zeile',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI.
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile liest ein Objekt, auf das die
   * aufrufende Rolle kein `select` hat. Das ist KEINE Abweichung — es ist
   * eine nicht durchgefuehrte Pruefung, und als solche wird sie in Zeile
   * 9998 GEZAEHLT UND GEMELDET. Sie als bestanden zu buchen waere die
   * stille Ignorierung, die es hier nicht gibt.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
/*
 * ZEILE 9998 — WAS DIESE ROLLE NICHT PRUEFEN KONNTE.
 *
 * Der lesende Pruefzugang `skyisles_agent` hat `select` auf zwoelf Tabellen;
 * `offer_state` und `offer_state_live` gehoeren bewusst nicht dazu (0146
 * erteilt gar kein Clientrecht darauf). Fuer ihn bleiben die beiden
 * Datenzeilen offen — die ~100 Katalogzeilen laufen trotzdem durch, und das
 * ist der Punkt: EIN fehlendes Recht darf nicht hundert gute Pruefungen
 * mitnehmen.
 *
 * Im SQL-Editor (als `postgres`) ist die Zahl 0 und jede Zeile gemessen.
 */
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
