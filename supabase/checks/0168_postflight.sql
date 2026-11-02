-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0168, REIN LESEND
--
-- NACH `supabase/operations/staging-0168.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT DIE ZWEI BASELINES AUS DEM PREFLIGHT. Der Runner setzt sie
-- selbst (`skyisles.base`, `skyisles.coll`).
--
--   201-209  DIE ZWEI TRIGGER, die neu gefasste admin_set_variant_base und
--            admin_delete_empty_character stehen; die zwei Journalwerte.
--   211-214  RECHTE: die Loeschfunktion nur fuer authenticated (sie prueft
--            selbst is_platform_admin), nie anon oder PUBLIC.
--   221-223  AUSKUNFT: dieselben Zahlen wie Preflight 113-115 — 0168
--            korrigiert und loescht nichts.
--   231-235  WAS SICH NICHT BEWEGT HAT.
--
-- SIE RUFT KEINE FUNKTION AUF.
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
   where n.nspname = 'public' and p.proname = 'admin_delete_empty_character'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------------ Was 0168 anlegt
  (201, 'Anlage', 'der Folge-Trigger steht an skylanders',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_family_follow_trg' and not t.tgisinternal), '1'),
  (202, 'Anlage', 'der Kaskaden-Trigger steht an skylanders',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_family_cascade_trg' and not t.tgisinternal), '1'),
  (203, 'Anlage', 'admin_set_variant_base ist NICHT mehr die Fassung aus 0159',
      coalesce((select (p.prosrc not like '%nicht stillschweigend ueberschrieben%')::text
                  from pg_proc p
                 where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')),
               '(fehlt)'), 'true'),
  (204, 'Anlage', 'admin_delete_empty_character steht genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_delete_empty_character'), '1'),
  (205, 'Anlage', 'SECURITY DEFINER',
      (coalesce((select p.prosecdef::text from pg_proc p
                  where p.oid = to_regprocedure('public.admin_delete_empty_character(bigint)')), '(fehlt)')), 'true'),
  (206, 'Anlage', 'mit LEEREM search_path',
      (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                   from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.oid = to_regprocedure('public.admin_delete_empty_character(bigint)')
                    and c like 'search\_path=%'), '(leer)')), '(leer)'),
  (207, 'Anlage', 'das Journal kennt die Entitaet character',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_entity_known'
          and pg_get_constraintdef(c.oid) like '%''character''%'), '1'),
  (208, 'Anlage', 'das Journal kennt den Feldwert family_deleted',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%''family_deleted''%'), '1'),
  (209, 'Anlage', 'und weiterhin character_id und deleted',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%''character_id''%'
          and pg_get_constraintdef(c.oid) like '%''deleted''%'), '1'),

  -- ----------------------------------------------------------- Die Rechte
  (211, 'Rechte', 'anon darf die Loeschfunktion NICHT',
      coalesce(has_function_privilege('anon', to_regprocedure('public.admin_delete_empty_character(bigint)'), 'execute')::text, '(fehlt)'), 'false'),
  (212, 'Rechte', 'authenticated darf sie (sie prueft selbst is_platform_admin)',
      coalesce(has_function_privilege('authenticated', to_regprocedure('public.admin_delete_empty_character(bigint)'), 'execute')::text, '(fehlt)'), 'true'),
  (213, 'Rechte', 'PUBLIC darf sie NICHT',
      coalesce(has_function_privilege('public', to_regprocedure('public.admin_delete_empty_character(bigint)'), 'execute')::text, '(fehlt)'), 'false'),
  (214, 'Rechte', 'anon darf admin_set_variant_base NICHT',
      coalesce(has_function_privilege('anon',
        to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), 'execute')::text,
        '(fehlt)'), 'false'),

  -- ------------------------------------------------- Was 0168 NICHT getan hat
  (221, 'Auskunft', 'Varianten mit abweichender Familie (Preflight 113 nennt dieselbe Zahl)',
      (select count(*)::text from public.skylanders v
         join public.skylanders b on b.sky_id = v.base_sky_id
        where v.character_id is distinct from b.character_id), null),
  (222, 'Auskunft', 'Familien ohne Mitglied (Preflight 114)',
      case when has_table_privilege('public.characters', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.characters c where not exists (select 1 from public.skylanders s where s.character_id = c.id)', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (223, 'Auskunft', 'Familien insgesamt (Preflight 115)',
      case when has_table_privilege('public.characters', 'select')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.characters', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- ------------------------------------------- Was sich NICHT bewegt haben darf
  /*
   * DIE SECHS ZAHLEN AUS DEM PREFLIGHT, Zeilen 131-136. Sie stehen hier ohne
   * `erwartet`, weil der Runner den Vergleich fuehrt: er haelt die
   * Preflightwerte und meldet jede Bewegung. Von Hand gefahren vergleicht
   * sie der Bediener Zeile fuer Zeile.
   */
  (231, 'Unveraendert', 'Katalogzeilen (Preflight 131)',
      (select count(*)::text from public.skylanders), null),
  (233, 'Unveraendert', 'hoechste regulaere SKY-ID (Preflight 133)',
      (select coalesce(max(sky_id), '(leer)') from public.skylanders
        where sky_id ~ '^SKY-[0-8][0-9]{3}$'), null),
  /*
   * WARUM HIER KEINE JOURNALZEILE STEHT, obwohl sie fachlich dazugehoerte.
   *
   * `public.catalog_admin_changes` ist dem lesenden Pruefzugang NICHT
   * geteilt. `src/lib/admin/migration-runner.test.ts` faengt jede Pruefdatei
   * ab, die ein ungeteiltes Objekt direkt liest, und nennt die zwei
   * Moeglichkeiten: hinter `has_table_privilege` + `query_to_xml` setzen —
   * oder die Frage gar nicht aus Daten beantworten. Dem Pruefzugang ein
   * Recht mehr zu geben steht ausdruecklich NICHT zur Wahl, sonst ist er in
   * zwanzig Migrationen ein Vollleser.
   *
   * Hier gilt die zweite Moeglichkeit, und sie kostet nichts: `0168` enthaelt
   * keine einzige Datenanweisung. Dass die Journalzeilen unveraendert
   * bleiben, steht deshalb nicht in dieser Datei, sondern an zwei besseren
   * Stellen — in der NOTICE von `staging-0168.sql` (Waechter A3, laeuft als
   * `postgres`) und in `SYNC-13` als erwarteter Postflightwert, den der
   * Bediener im SQL-Editor nachsieht.
   */
  /*
   * DER SEQUENZSTAND, GESCHUETZT. `0033` entzieht `sky_id_seq` jedem
   * Clientrecht; der Pruefzugang hat es nicht. Also wie in `0164` ueber
   * `query_to_xml` hinter einer Rechtepruefung: fehlt das Recht, steht hier
   * `KEIN-RECHT`, Zeile 9998 zaehlt es als OFFEN, und die Datei bricht NICHT
   * ab. Als `postgres` im SQL-Editor steht eine Zahl.
   */
  (234, 'Unveraendert', 'Sequenzstand sky_id_seq (Preflight 134)',
      case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select last_value::text || ''|'' || is_called::text as c '
                  'from public.sky_id_seq', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (235, 'Unveraendert', 'Abdruck des freigegebenen Katalogs (Preflight 135)',
      (select coalesce(md5(string_agg(x.z, chr(10) order by x.z)), '(leer)') from (
         select s.sky_id || '|' || s.name || '|' || s.slug || '|' || s.catalog_status
                || '|' || s.source as z
           from public.skylanders s
          where s.series_code not in ('TEST', 'SMOK')
            and s.sky_id < 'SKY-9000' and s.catalog_status <> 'draft') x), null),
   -- --------------------------------------------- Was sie NICHT angelegt hat
  /*
   * DIE ZEILE 241 STAND HIER UND IST FORT — aus demselben Grund wie die
   * Journalzeilen oben: sie haette `public.catalog_admin_changes` direkt
   * gelesen, und dem Pruefzugang ist die Tabelle nicht geteilt. Dass `0168`
   * die Funktion nicht aufruft, ist ohnehin am Dateiinhalt ablesbar: die
   * Migration enthaelt keine einzige Datenanweisung.
   */
  /*
   * DIESE ZEILE STAND HIER FALSCH, und der Lauf vom 2026-10-30 hat es
   * gezeigt: sie zaehlte, wie viele der Rechte TRUNCATE/REFERENCES/TRIGGER
   * `service_role` auf den zwei Tabellen hat, und erwartete **0**. Gemeldet
   * wurden **6** — und zwar zu Recht.
   *
   * WAS DIE 6 WIRKLICH WAREN: die Supabase-Projektvorgabe. Rein lesend
   * nachgemessen am selben Tag: **68 von 69** Tabellen im Schema `public`
   * tragen dasselbe Muster, jede mit acht Rechten fuer `service_role`
   * (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
   * MAINTAIN), alle erteilt von `postgres`, keines weitergebbar. Die Rolle
   * ist in KEINER anderen Rolle Mitglied — es sind also direkte GRANTs und
   * nichts Vererbtes.
   *
   * DER FEHLER WAR MEINER UND NICHT DER DER MIGRATION. `0165` enthaelt
   * genau zwei Rechteanweisungen, beide auf die FUNKTION
   * (`revoke all … from public, anon, authenticated` und
   * `grant execute … to service_role`); kein einziges Tabellenrecht. Die
   * Zeile haette auch dann 6 gemeldet, wenn die Migration nie gelaufen
   * waere — sie behauptete einen Ausgangszustand, den es nie gab.
   *
   * WAS STATTDESSEN HIER STEHT: eine Zusage, die ABSOLUT gilt und
   * sicherheitsrelevant ist — die Clientrollen haben auf dem Journal
   * ueberhaupt kein Recht (`0004` entzieht es ihnen). Nachgemessen: 0.
   * Und darunter die Zahl der service_role-Rechte als AUSKUNFT, damit ein
   * kuenftiger Lauf sie gegen den Preflight vergleichen kann statt gegen
   * eine geratene Konstante.
   */
  (242, 'Nichts sonst', 'anon und authenticated haben auf catalog_admin_changes '
                        'KEIN Recht — 0004 entzieht es ihnen',
      (select count(*)::text from pg_class cl, aclexplode(cl.relacl) a
        where cl.oid = to_regclass('public.catalog_admin_changes')
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),
  (243, 'Nichts sonst', 'Auskunft: Tabellenrechte von service_role auf den zwei '
                        'Tabellen (Preflight 141 nennt dieselbe Zahl)',
      (select count(*)::text from pg_class cl, aclexplode(cl.relacl) a
        where cl.oid in (to_regclass('public.skylanders'),
                         to_regclass('public.catalog_admin_changes'))
          and a.grantee::regrole::text = 'service_role'), null),

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
