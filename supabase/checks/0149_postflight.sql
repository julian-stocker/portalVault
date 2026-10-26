-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0149, REIN LESEND
--
-- NACH `0149_notification_read_state.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
-- DIE ZUSAGEN VON `0149`, als Messung:
--
--   101-105  die Spalte steht, sie ist nullbar und ohne Vorgabewert, die
--            Tabelle hat sechs Spalten — und **keine einzige Meldung ist
--            als gelesen gefuehrt**. Das ist die Zeile, auf die es
--            ankommt: ein Vorgabewert `now()` oder ein Backfill haetten
--            eine Lesehandlung erfunden, die nicht stattgefunden hat.
--   111-120  die Sicherheit: der Schreibweg ist EINE Definer-Funktion mit
--            der Eigentuemerbedingung im Rumpf, `authenticated` hat auf der
--            Tabelle weiterhin GENAU `SELECT` und kein `update`, `anon` hat
--            nichts, RLS bleibt an und es bleibt bei der EINEN Richtlinie
--            aus `0148`.
--   121-126  dass es EINE Anweisung ist, dass der Teilindex steht, dass
--            `claim_availability_notifications()` `read_at` nicht anfasst
--            und dass kein Trigger entstanden ist.
--
-- WARUM 116 DIE WICHTIGSTE SICHERHEITSZEILE IST. Der naheliegende Weg zu
-- „als gelesen markieren" waere `grant update (read_at) … to authenticated`
-- gewesen. `0149` nimmt ihn nicht: ein Tabellenrecht ist breiter als die
-- Absicht, und es waere das erste Schreibrecht eines Clients auf dieser
-- Tabelle. Steht hier etwas anderes als `SELECT`, ist genau diese
-- Entscheidung unterlaufen worden.
--
-- WARUM 121 EINE PRUEFZEILE BEKOMMT: dieselbe Begruendung wie in `0148`.
-- Mehr als ein Semikolon im Rumpf heisst mehr als eine Anweisung.
--
-- RECHTEGESCHUETZTE ZEILEN. Der Pruefzugang darf
-- `availability_notifications` nicht lesen; diese Zeilen melden ihm
-- `KEIN-RECHT` und zaehlen in 9998. Die Abnahme braucht den Lauf als
-- `postgres`.
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

  -- ------------------------------------------------------------- Die Spalte
  (101, 'Spalte', 'availability_notifications hat jetzt SECHS Spalten',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_notifications')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'user_id,sky_id,buyable_since,cheapest_cents,created_at,read_at'),
  (102, 'Spalte', 'read_at ist timestamptz',
      coalesce((select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_notifications')
                   and a.attname = 'read_at'
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Spalte)'),
      'timestamp with time zone'),
  /*
   * NULLBAR UND OHNE VORGABEWERT, und beides ist die Aussage: NULL heisst
   * ungelesen. Ein `not null` waere ohne Vorgabewert nicht moeglich, und
   * ein Vorgabewert `now()` wuerde jede neue Meldung sofort als gelesen
   * fuehren.
   */
  (103, 'Spalte', 'read_at ist nullbar und hat KEINEN Vorgabewert',
      coalesce((select ((not a.attnotnull) and (not a.atthasdef))::text
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_notifications')
                   and a.attname = 'read_at'
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Spalte)'),
      'true'),
  /*
   * DIE ZEILE, AUF DIE ES ANKOMMT. Die Migration setzt kein `read_at` —
   * nicht per Vorgabewert, nicht per Backfill. Jede Meldung, die vor `0149`
   * entstanden ist, gilt danach als ungelesen, und das ist richtig: es gab
   * bis `0149` keine Oberflaeche, in der sie jemand hat sehen koennen.
   */
  (104, 'Spalte', 'KEINE Meldung ist als gelesen gefuehrt',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications '
               'where read_at is not null',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),
  (105, 'Spalte', 'Info: Meldungen insgesamt — alle ungelesen (Preflight 121)',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- --------------------------------------------------------- Die Sicherheit
  (111, 'Sicherheit', 'mark_availability_notifications_read(text[]) steht',
      (to_regprocedure(
         'public.mark_availability_notifications_read(text[])') is not null)::text,
      'true'),
  (112, 'Sicherheit', 'sie ist definer, volatile und legt den search_path leer fest',
      coalesce((select (p.prosecdef and p.provolatile = 'v'
                        and (select count(*)
                               from unnest(coalesce(p.proconfig, '{}')) x
                              where x like 'search\_path=%') = 1)::text
                  from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.mark_availability_notifications_read(text[])')),
               '(keine Funktion)'), 'true'),
  (113, 'Sicherheit', 'authenticated darf sie ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure(
                'public.mark_availability_notifications_read(text[])')
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),
  /*
   * UND NICHTS FUER `anon` ODER `PUBLIC`. `aclexplode(p.proacl)` ohne
   * `coalesce`: ein NULL-`proacl` gibt KEINE Zeile, und das wuerde hier 0
   * ergeben — waehrend NULL bei einer FUNKTION gerade „EXECUTE fuer PUBLIC"
   * bedeutet (ADR-0139). Deshalb steht die Gegenprobe in Zeile 115:
   * `proacl` ist nicht NULL, weil `0149` ausdruecklich entzieht und gewaehrt.
   */
  (114, 'Sicherheit', 'und kein EXECUTE fuer anon oder PUBLIC',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure(
                'public.mark_availability_notifications_read(text[])')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (115, 'Sicherheit', 'und proacl ist NICHT NULL — bei einer Funktion hiesse '
        'NULL: EXECUTE fuer PUBLIC',
      coalesce((select (p.proacl is not null)::text from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.mark_availability_notifications_read(text[])')),
               '(keine Funktion)'), 'true'),
  /*
   * KEIN SCHREIBRECHT FUER CLIENTS, UNVERAENDERT. Siehe Kopf: das ist die
   * Entscheidung, die `0149` getroffen hat, und diese Zeile ist ihr
   * Nachweis.
   */
  (116, 'Sicherheit', 'authenticated hat auf der Tabelle weiterhin GENAU select',
      coalesce((select string_agg(distinct a.privilege_type, ', '
                                  order by a.privilege_type)
                  from pg_class c, aclexplode(c.relacl) a
                 where c.oid = to_regclass('public.availability_notifications')
                   and a.grantee::regrole::text = 'authenticated'
                   and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE',
                                            'TRUNCATE','REFERENCES','TRIGGER')),
               '(nichts)'),
      'SELECT'),
  (117, 'Sicherheit', 'und anon sowie PUBLIC haben nichts auf der Tabelle',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid = to_regclass('public.availability_notifications')
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (118, 'Sicherheit', 'RLS ist an',
      coalesce((select c.relrowsecurity::text from pg_class c
                 where c.oid = to_regclass('public.availability_notifications')),
               '(keine Tabelle)'), 'true'),
  /*
   * ES BLEIBT BEI DER EINEN RICHTLINIE AUS `0148`. `0149` legt KEINE
   * Schreibrichtlinie an — geschrieben wird durch eine Funktion, nicht
   * durch ein Tabellenrecht mit Richtlinie dahinter.
   */
  (119, 'Sicherheit', 'und es ist GENAU die eine Richtlinie aus 0148',
      coalesce((select string_agg(pol.polname::text || ':' || pol.polcmd::text, ', '
                                  order by pol.polname)
                  from pg_policy pol
                 where pol.polrelid = to_regclass('public.availability_notifications')),
               '(keine)'),
      'availability_notifications_select_own:r'),
  (120, 'Sicherheit', 'die Eigentuemerbedingung steht im Rumpf — RLS gilt fuer '
        'eine Definer-Funktion nicht, dieses where IST die Grenze',
      coalesce((select ((position('(select auth.uid()) = n.user_id' in p.prosrc) > 0)
                        and (position('public.is_collector_account()' in p.prosrc) > 0)
                        and (position('n.read_at is null' in p.prosrc) > 0))::text
                  from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.mark_availability_notifications_read(text[])')),
               '(keine Funktion)'), 'true'),

  -- ---------------------------------------------------------- Die Mechanik
  /*
   * EINE EINZIGE ANWEISUNG, wie bei `claim_availability_notifications()`.
   * Ein `update` und ein `select` darauf, in einem `with`-Ausdruck.
   */
  (121, 'Mechanik', 'der Rumpf ist EINE Anweisung (hoechstens ein Semikolon)',
      coalesce((select (length(p.prosrc)
                        - length(replace(p.prosrc, ';', '')) <= 1)::text
                  from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.mark_availability_notifications_read(text[])')),
               '(keine Funktion)'), 'true'),
  (122, 'Mechanik', 'der Teilindex fuer den Zaehler steht, und er ist ein TEILindex',
      coalesce((select (i.indpred is not null)::text from pg_index i
                 where i.indexrelid
                       = to_regclass('public.availability_notifications_unread_idx')
                   and i.indrelid
                       = to_regclass('public.availability_notifications')),
               '(kein Index)'), 'true'),
  /*
   * EINE NEUE MELDUNG ENTSTEHT UNGELESEN, und das entscheidet die fehlende
   * Spaltenangabe im `insert` von `0148` — kein Wert. Nennt die Funktion
   * `read_at`, ist genau das nicht mehr wahr.
   */
  (123, 'Mechanik', 'claim_availability_notifications() nennt read_at NICHT',
      coalesce((select (position('read_at' in p.prosrc) = 0)::text from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (124, 'Mechanik', 'und sie ist unveraendert EINE Anweisung',
      coalesce((select (length(p.prosrc)
                        - length(replace(p.prosrc, ';', '')) <= 1)::text
                  from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (125, 'Mechanik', 'kein Trigger auf availability_notifications, offer_state '
        'oder favorites',
      coalesce((select string_agg(cl.relname::text || '.' || t.tgname::text, ', '
                                  order by cl.relname, t.tgname)
                  from pg_trigger t
                  join pg_class cl on cl.oid = t.tgrelid
                 where cl.oid in (to_regclass('public.availability_notifications'),
                                  to_regclass('public.offer_state'),
                                  to_regclass('public.favorites'))
                   and not t.tgisinternal),
               '(keine)'), '(keine)'),
  /*
   * DER PRIMAERSCHLUESSEL AUS `0148` IST UNANGETASTET. `read_at` gehoert
   * NICHT dazu: der Duplikatschutz ist „je Nutzer, Figur und Phase genau
   * eine Meldung" und nicht „je Lesezustand eine".
   */
  (126, 'Mechanik', 'der Primaerschluessel aus 0148 ist unveraendert',
      coalesce((select string_agg(a.attname::text, ','
                                  order by array_position(c.conkey, a.attnum))
                  from pg_constraint c
                  join pg_attribute a
                    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = to_regclass('public.availability_notifications')
                   and c.contype = 'p'),
               '(kein Schluessel)'),
      'user_id,sky_id,buyable_since'),

  -- ------------------------------------- Die Grundlage bleibt, wie sie war
  (131, 'Grundlage', 'offer_availability_due() steht unveraendert (0147)',
      (to_regprocedure('public.offer_availability_due()') is not null)::text, 'true'),
  (132, 'Grundlage', 'favorites hat weiterhin die drei Richtlinien aus 0145',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'), '3'),
  (133, 'Grundlage', 'offer_state hat weiterhin neun Spalten (0146 + 0147)',
      coalesce((select count(*)::text from pg_attribute a
                 where a.attrelid = to_regclass('public.offer_state')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'), '9'),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0149 ruehrt das nicht an)',
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
