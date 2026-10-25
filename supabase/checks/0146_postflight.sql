-- ===========================================================================
-- 0146 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0146_offer_state.sql` fahren. Zeile 9999 muss 0 zeigen.
--
-- WAS SIE BEANTWORTET: steht `offer_state` mit acht Spalten, dem
-- Primaerschluessel auf `sky_id`, fuenf CHECKs, RLS und **null** Richtlinien;
-- hat keine API-Rolle ein Tabellen- oder Sichtrecht; ist
-- `refresh_offer_state()` `definer`+`volatile` mit leerem `search_path` und
-- nur fuer `authenticated` ausfuehrbar; ist **kein Trigger** entstanden — und
-- hat sich weder am Shop noch an der Sammlung etwas bewegt.
--
-- WAS SIE NICHT BEANTWORTET: ob der Spiegel fachlich RICHTIG spiegelt. Das
-- zeigt erst ein Aufruf von `refresh_offer_state()` samt Vergleich mit
-- `offer_state_live` — Zeile 171 und 172 messen es nach dem ersten Lauf, und
-- Probelauf **P53** faehrt alle Zustandswechsel an echtem PostgreSQL.
--
-- DIE TABELLE IST NACH DER MIGRATION LEER, und das ist richtig: die
-- Erstbefuellung gehoert in den ersten Aufruf der Funktion, nicht in die
-- Migration. Zeile 161 haelt das fest.
--
-- WOHER DIE BEIDEN BASISZEILEN KOMMEN. Diese Datei vergleicht gegen die
-- Zeilen 900 und 901 DES PREFLIGHTS — den Stand VOR der Migration. Sie
-- erhebt sie nicht selbst, und die aktuellen Werte werden NIEMALS als
-- Sollwert eingesetzt.
--
-- AUF STAGING UEBERNIMMT DAS EIN BEFEHL.
-- `npm run db:migrate:staging -- 0146` friert die beiden Zeilen nach dem
-- Preflight in `supabase/baselines/` ein, und `--resume` reicht sie dieser
-- Datei in DERSELBEN Einreichung mit. Kein Kopieren, kein Platzhalter. Genau
-- diese Handarbeit ist bei `0145` und bei `0146` vergessen worden, und beide
-- Male meldete Zeile 9999 achtzehn Abweichungen — ausschliesslich die der
-- Uebergabe.
--
-- AUF PRODUCTION GIBT ES DIESEN BEFEHL NICHT, und das ist Absicht: der
-- Runner haengt an einem Zugang, der ausschliesslich auf Staging zeigt und
-- dort nur lesen darf. Fuer Production gilt der Weg von Hand — mit FRISCH
-- auf Production gemessenen Zeilen. Eine Staging-Baseline hier einzusetzen
-- waere die schlimmste Form von gruen: sie vergliche Production gegen die
-- Zahlen einer anderen Datenbank.
--
-- SO GEHT ES VON HAND: Zeile 900 und 901 des Preflights DERSELBEN Umgebung
-- vollstaendig kopieren und VOR diesem SELECT ausfuehren —
--
--   select set_config('skyisles.base', 'skyisles-base-1|…', true);
--   select set_config('skyisles.coll', 'skyisles-coll-1|…', true);
--
-- Alles zusammen markieren und ausfuehren: `set_config(…, true)` gilt nur in
-- DERSELBEN Transaktion, und der SQL-Editor fuehrt jeden Lauf getrennt aus.
--
-- BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH. Die Huelle
-- bringt beide `set_config`-Zeilen schon mit, damit niemand sie vergisst —
-- und genau deshalb zaehlt ein nicht ersetzter Platzhalter wie eine fehlende
-- Zeile. Sonst waere die Bequemlichkeit die Luecke im Riegel.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
-- Beide unveraendert aus `0142` bis `0145`; die Messbloecke unten sind
-- zeichengleich dieselben.
--
-- DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS, ausdruecklich.
--
-- Er sagt „zwischen den beiden Laeufen hat sich X bewegt". Er sagt NICHT,
-- WER es bewegt hat. Zwischen Preflight und Nachkontrolle kann regulaerer
-- Betrieb stattgefunden haben: ein Verkauf im Shop, ein Wareneingang, eine
-- Umpreisung — und an der Sammlung ein Sammler, der eine Figur hinzufuegt.
--
-- SO UNTERSCHEIDET MAN BEIDES:
--
--   1. ZEITFENSTER KLEIN HALTEN. Preflight, Migration und Nachkontrolle
--      hintereinander fahren.
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN. `0146` legt eine Tabelle,
--      eine Sicht und zwei Funktionen an. Sie enthaelt kein `update`,
--      `insert` oder `delete` auf irgendeine bestehende Tabelle, und sie
--      legt keinen Trigger an — Zeile 181 misst das.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest die
--      Shop-Seite tagweise auf.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben. Die Abdruecke fangen das ab — sie haengen an Inhalt
-- und Reihenfolge, nicht nur an der Anzahl.
--
-- NUR LESEN. Ein einziges SELECT.
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
    (select count(*)::text from public.shop_offers())                      as angebote,
    (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                    || coalesce(o.price::text, ''),
                                    ';' order by o.sky_id, o.condition), ''))
       from public.shop_offers() o)                                        as angebote_md5,
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

  -- ------------------------------------------------------------ Die Tabelle
  (101, 'Tabelle', 'offer_state steht',
      (to_regclass('public.offer_state') is not null)::text, 'true'),
  (102, 'Tabelle', 'genau acht Spalten, in dieser Reihenfolge',
      coalesce((select string_agg(column_name, ',' order by ordinal_position)
                  from information_schema.columns
                 where table_schema = 'public' and table_name = 'offer_state'),
               '(keine Tabelle)'),
      'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
      || 'announced_buyable,announced_cents,announced_at'),
  (103, 'Tabelle', 'der Primaerschluessel ist sky_id',
      coalesce((select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
                  from pg_constraint c
                  join pg_attribute a on a.attrelid = c.conrelid
                                     and a.attnum = any (c.conkey)
                 where c.conrelid = to_regclass('public.offer_state')
                   and c.contype = 'p'), '(keiner)'), 'sky_id'),
  (104, 'Tabelle', 'offer_state_sky_fk ist ON DELETE RESTRICT — eine Katalogzeile '
        'bricht nicht unter dem Spiegel weg',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state')
          and conname = 'offer_state_sky_fk' and confdeltype = 'r'), '1'),
  (105, 'Tabelle', 'alle FUENF CHECKs stehen',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state') and contype = 'c'
          and conname in ('offer_state_price_consistent', 'offer_state_price_sane',
                          'offer_state_announced_price_sane',
                          'offer_state_announced_consistent',
                          'offer_state_checked_after_changed')), '5'),
  (106, 'Tabelle', 'darunter der, der eine Pruefung ohne Aenderung bewacht '
        '(checked_at >= changed_at)',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state')
          and conname = 'offer_state_checked_after_changed'), '1'),

  -- ---------------------------------------------------- Rechte und RLS
  (111, 'Rechte', 'RLS ist an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.offer_state')), '(keine Tabelle)'),
      'true'),
  (112, 'Rechte', 'und es gibt KEINE Richtlinie — die Form der Handelstabellen',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'offer_state'), '0'),
  (113, 'Rechte', 'keine API-Rolle hat ein Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'offer_state'
          and grantee in ('anon', 'authenticated', 'PUBLIC')), '0'),
  (114, 'Rechte', 'und keine ein Recht auf die Sicht offer_state_live',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'offer_state_live'
          and grantee in ('anon', 'authenticated', 'PUBLIC')), '0'),

  -- -------------------------------------------------------------- Die Sicht
  (121, 'Sicht', 'offer_state_live steht',
      (to_regclass('public.offer_state_live') is not null)::text, 'true'),
  (122, 'Sicht', 'sie liest shop_offers() — und rechnet keinen Preis nach',
      (select (definition like '%shop_offers()%'
               and definition not like '%price_percentage%'
               and definition not like '%market_price%')::text
         from pg_views where schemaname = 'public' and viewname = 'offer_state_live'),
      'true'),
  (123, 'Sicht', 'sie nimmt nur kaufbare Zeilen und den V1-Zustand',
      (select (definition like '%available%'
               and definition like '%v1_sale_condition()%')::text
         from pg_views where schemaname = 'public' and viewname = 'offer_state_live'),
      'true'),
  (124, 'Sicht', 'Info: wie viele Figuren sie JETZT als kaufbar sieht',
      (select count(*)::text from public.offer_state_live), null),

  -- ----------------------------------------------------- Die Funktionen
  (131, 'Funktion', 'refresh_offer_state() steht, genau einmal',
      (select count(*)::text from fn), '1'),
  (132, 'Funktion', 'security definer',
      coalesce((select prosecdef::text from fn), '(keine)'), 'true'),
  (133, 'Funktion', 'volatile (v) — sie schreibt',
      coalesce((select provolatile::text from fn), '(keine)'), 'v'),
  (134, 'Funktion', 'es gibt GENAU EINE search_path-Festlegung',
      coalesce((select pfadanzahl::text from fn), '(keine)'), '1'),
  (135, 'Funktion', 'und ihr Wert ist LEER (ausgepackt, nicht verglichen)',
      coalesce((select pfadwert from fn), '(keine)'), '""'),
  (136, 'Funktion', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (137, 'Funktion', 'authenticated darf ausfuehren',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),
  (138, 'Funktion', 'sie nennt favorites NICHT — keine personenbezogenen Daten',
      coalesce((select (prosrc not like '%favorites%'
                        and prosrc not like '%user_id%')::text from fn), '(keine)'),
      'true'),
  (139, 'Funktion', 'sie drosselt ueber offer_state_window() und nicht ueber eine Zahl',
      coalesce((select (prosrc like '%offer_state_window()%')::text from fn), '(keine)'),
      'true'),
  (140, 'Funktion', 'und sie nimmt ein Transaktionsschloss',
      coalesce((select (prosrc like '%pg_try_advisory_xact_lock%')::text from fn),
               '(keine)'), 'true'),
  (141, 'Funktion', 'offer_state_window() steht, ohne Clientrecht',
      (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, '{}'))  a
        where p.oid = to_regprocedure('public.offer_state_window()')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text
               in ('anon', 'public', 'authenticated'))), '0'),
  (142, 'Funktion', 'Info: und das Drosselfenster ist',
      (select public.offer_state_window()::text), null),

  -- -------------------------------- Die Migration hat nichts geschrieben
  (161, 'Leer', 'die Migration hat KEINE Zeile angelegt — die Erstbefuellung '
        'gehoert in den ersten Aufruf',
      (select count(*)::text from public.offer_state), '0'),

  -- ------------------------- Und kein Trigger an den drei Quellen
  /*
   * DIE ZENTRALE ZUSAGE VON 0146, als Messung. Fremde Trigger darf es geben
   * (Zeitstempel, Unveraenderlichkeit, Artikeltyp); was es nicht geben darf,
   * ist einer von DIESER Migration.
   */
  (181, 'Kein Trigger', 'kein Trigger mit offer_state im Namen auf shop_inventory, '
        'skylanders oder shop_settings',
      (select count(*)::text from pg_trigger
        where tgrelid in ('public.shop_inventory'::regclass,
                          'public.skylanders'::regclass,
                          'public.shop_settings'::regclass)
          and not tgisinternal and tgname like '%offer_state%'), '0'),
  (182, 'Kein Trigger', 'Info: eigene Trigger auf shop_inventory',
      coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                 where tgrelid = 'public.shop_inventory'::regclass
                   and not tgisinternal), '(keine)'), null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0146 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
  (402, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

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
