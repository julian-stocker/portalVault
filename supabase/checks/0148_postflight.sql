-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0148, REIN LESEND
--
-- NACH `0148_availability_notifications.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
-- DIE DREI ZUSAGEN VON `0148`, als Messung:
--
--   101-106  die Tabelle steht, und — die wichtigste Zeile — ihr
--            PRIMAERSCHLUESSEL ist `(user_id, sky_id, buyable_since)`. Er
--            IST der Duplikatschutz: „genau eine Meldung je Nutzer, Figur
--            und Phase" ist damit eine Eigenschaft der Datenbank und keine
--            Zusage der Anwendungslogik.
--   111-118  die Sicherheit: RLS an, EINE Richtlinie (nur lesen, nur das
--            Eigene), `authenticated` nur `SELECT`, **nichts** fuer `anon`,
--            kein Schreibweg fuer Clients, und die Funktion `definer`,
--            `volatile`, mit leerem `search_path`, nur fuer
--            `authenticated`.
--   121-124  dass es EINE Anweisung ist, dass sie die Erkennung aus `0147`
--            benutzt, dass kein Trigger entstanden ist und dass die
--            Migration keine Meldung angelegt hat.
--
-- WARUM „EINE ANWEISUNG" EINE PRUEFZEILE BEKOMMT (121): die Atomaritaet
-- haengt daran. Mehr als ein Semikolon im Rumpf heisst mehr als eine
-- Anweisung — und dann gaebe es einen Zustand, in dem ein Ereignis als
-- verarbeitet gilt und die Meldungen fehlen.
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

  -- -------------------------------------------------------- Die Tabelle
  (101, 'Tabelle', 'availability_notifications steht',
      (to_regclass('public.availability_notifications') is not null)::text, 'true'),
  (102, 'Tabelle', 'fuenf Spalten, in dieser Reihenfolge',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_notifications')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'user_id,sky_id,buyable_since,cheapest_cents,created_at'),

  /*
   * ------------------------------------------------- DIE WICHTIGSTE ZEILE
   *
   * Der Primaerschluessel IST der Duplikatschutz. Steht hier etwas anderes,
   * ist „genau eine Meldung je Nutzer, Figur und Phase" nur noch eine
   * Absicht — und zwei gleichzeitige Aufrufe koennten sie verletzen.
   */
  (103, 'Tabelle', 'der Primaerschluessel ist (user_id, sky_id, buyable_since)',
      coalesce((select string_agg(a.attname::text, ','
                                  order by array_position(c.conkey, a.attnum))
                  from pg_constraint c
                  join pg_attribute a
                    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = to_regclass('public.availability_notifications')
                   and c.contype = 'p'),
               '(kein Schluessel)'),
      'user_id,sky_id,buyable_since'),
  /*
   * MIT NAMEN, NICHT NUR MIT BUCHSTABEN. `string_agg(confdeltype order by
   * conname)` ergab `r,c` — richtig, aber unlesbar: `sky` steht
   * alphabetisch vor `user`. Eine Zeile, deren Erwartung man nachzaehlen
   * muss, sagt beim Abbruch nichts.
   *
   * `c` = cascade (ein geloeschtes Konto nimmt seine Meldungen mit),
   * `r` = restrict (eine Katalogzeile darf nicht unter einer Meldung
   * wegbrechen — dieselbe Regel wie bei `favorites` und
   * `collection_items`).
   */
  (104, 'Tabelle', 'zwei Fremdschluessel: skylanders RESTRICT, auth.users CASCADE',
      (select coalesce(string_agg(
                replace(c.conname::text, 'availability_notifications_', '')
                || '=' || c.confdeltype::text, ',' order by c.conname), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.availability_notifications')
          and c.contype = 'f'), 'sky_fk=r,user_fk=c'),
  (105, 'Tabelle', 'und KEINE read_at-Spalte — Anzeige und Lesen sind S4',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.availability_notifications')
          and a.attname = 'read_at'
          and a.attnum > 0 and not a.attisdropped), '0'),
  (106, 'Tabelle', 'die Migration hat KEINE Meldung angelegt',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  -- ------------------------------------------------------- Die Sicherheit
  (111, 'Rechte', 'RLS ist an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.availability_notifications')),
               '(keine Tabelle)'), 'true'),
  (112, 'Rechte', 'genau EINE Richtlinie',
      (select count(*)::text from pg_policies
        where schemaname = 'public'
          and tablename = 'availability_notifications'), '1'),
  (113, 'Rechte', 'und sie gilt nur fuer select',
      (select coalesce(string_agg(cmd, ',' order by cmd), '(keine)')
         from pg_policies
        where schemaname = 'public'
          and tablename = 'availability_notifications'), 'SELECT'),
  (114, 'Rechte', 'sie fragt auth.uid() UND is_collector_account()',
      (select coalesce((qual like '%auth.uid()%'
                        and qual like '%is_collector_account()%')::text, 'false')
         from pg_policies
        where schemaname = 'public'
          and tablename = 'availability_notifications'), 'true'),
  (115, 'Rechte', 'authenticated hat genau SELECT',
      coalesce((select string_agg(distinct a.privilege_type, ','
                                  order by a.privilege_type)
                  from pg_class c, aclexplode(c.relacl) a
                 where c.oid = to_regclass('public.availability_notifications')
                   and a.grantee::regrole::text = 'authenticated'
                   and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                            'TRUNCATE', 'REFERENCES', 'TRIGGER')),
               '(keine)'), 'SELECT'),
  (116, 'Rechte', 'und anon oder PUBLIC haben nichts',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid = to_regclass('public.availability_notifications')
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (117, 'Funktion', 'claim_availability_notifications() ist definer und volatile',
      coalesce((select (prosecdef and provolatile = 'v')::text from pg_proc
                 where oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (118, 'Funktion', 'mit GENAU EINER search_path-Festlegung, Wert LEER '
        '(ausgepackt, nicht verglichen)',
      coalesce((select (select substring(x from 'search_path=(.*)$')
                          from unnest(coalesce(p.proconfig, '{}')) x
                         where x like 'search\_path=%')
                  from pg_proc p
                 where p.oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine)'), '""'),
  (119, 'Funktion', 'und kein EXECUTE fuer anon oder PUBLIC',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.claim_availability_notifications()')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),

  -- ------------------------------------------- Die Atomaritaet, als Messung
  (121, 'Atomar', 'der Rumpf ist EINE Anweisung (hoechstens ein Semikolon)',
      coalesce((select (length(prosrc) - length(replace(prosrc, ';', '')) <= 1)::text
                  from pg_proc
                 where oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (122, 'Atomar', 'und er benutzt die Erkennung aus 0147',
      coalesce((select (position('offer_availability_due()' in prosrc) > 0)::text
                  from pg_proc
                 where oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (123, 'Atomar', 'das insert liest aus dem returning des update',
      coalesce((select (position('from beansprucht' in prosrc) > 0)::text
                  from pg_proc
                 where oid = to_regprocedure(
                         'public.claim_availability_notifications()')),
               '(keine Funktion)'), 'true'),
  (124, 'Trigger', 'kein Trigger auf der neuen Tabelle, auf favorites oder offer_state',
      (select count(*)::text from pg_trigger t
        where t.tgrelid in (to_regclass('public.availability_notifications'),
                            to_regclass('public.favorites'),
                            to_regclass('public.offer_state'))
          and not t.tgisinternal), '0'),

  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0148 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  -- ================================== Die Shop-Baseline aus dem Preflight
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
