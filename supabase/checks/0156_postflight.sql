-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0156, REIN LESEND
--
-- NACH `0156_merge_selected_fields.sql` fahren, MIT der Baseline-Uebergabe
-- aus dem Preflight. **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-108  DIE DREI FUNKTIONEN: der Plan, die Vierparameterfassung und die
--            Dreiparameterfassung aus `0154`. Alle `security definer`, alle
--            mit genau einer `search_path`-Festlegung, keine mit einem Recht
--            fuer `anon`/`public`.
--   111-119  DIE RIEGEL STEHEN IM RUMPF — einzeln geprueft. Ein fehlender
--            Riegel ist keine Abweichung, die man sieht; er faellt erst auf,
--            wenn etwas Falsches geschrieben ist. Geprueft werden die
--            Allowlist, die Kopplung von Serie und Kategorie, die beiden
--            Bildbedingungen, die Veraltungspruefung, die leere Auswahl —
--            und dass es kein dynamisches SQL gibt.
--   121-123  DIE ABWAERTSKOMPATIBILITAET: die Dreiparameterfassung steht
--            noch, sie ist eine WEITERLEITUNG (es gibt also genau eine
--            Uebernahmelogik), und sie hat ihr Recht behalten.
--   131-135  UND NICHTS IST GESCHRIEBEN. `0156` legt Funktionen an und sonst
--            nichts — kein Entwurf ist verschwunden, keiner ist sichtbar.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0155`.
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
   where n.nspname = 'public' and p.proname = 'admin_merge_draft'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------------- Die Funktionen
  (101, 'Funktion', 'admin_merge_plan(text,text,text) steht',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is not null)::text, 'true'),
  (102, 'Funktion', 'admin_merge_draft(text,text,text,jsonb) steht',
      (to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is not null)::text, 'true'),
  (103, 'Funktion', 'der Plan ist stable — er schreibt nichts',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)')), 's'),
  (104, 'Funktion', 'alle drei sind security definer',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and p.prosecdef), '3'),
  (105, 'Funktion', 'alle drei haben genau eine search_path-Festlegung',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%') = 1), '3'),
  (106, 'Rechte', 'kein EXECUTE fuer anon oder public, auf keiner der drei',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (107, 'Rechte', 'authenticated darf jede der drei genau einmal ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '3'),
  (108, 'Funktion', 'die Adminpruefung steht in beiden Rumpfen',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and p.prosrc like '%is_platform_admin()%'), '2'),

  -- ------------------------------------------------- Die Riegel, einzeln
  (111, 'Riegel', 'die Allowlist steht als Konstante im Rumpf',
      (select (p.prosrc like '%c_allow text[] := array[%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (112, 'Riegel', 'jeder Schluessel wird gegen die Allowlist geprueft',
      (select (p.prosrc like '%v_feld = any (c_allow)%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  /*
   * DIE BEDINGUNG, NICHT DIE WOERTER. `%series_code%category_id%` war grün,
   * aber wertlos: beide Namen stehen ein Dutzend Mal in diesem Rumpf, und
   * das Muster waere auch ohne jede Kopplungspruefung getroffen worden. Eine
   * Pruefung, die nicht scheitern kann, ist keine.
   */
  (113, 'Riegel', 'Serie und Kategorie nur gemeinsam',
      (select (p.prosrc like
         '%(p_selection ? ''series_code'') <> (p_selection ? ''category_id'')%')::text
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (114, 'Riegel', 'ein Bildpfad ohne ausgewaehltes Bild wird abgewiesen',
      (select (p.prosrc like '%nicht ausgewaehlt%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  /*
   * DAS MUSTER MUSS INNERHALB EINES SQL-LITERALS LIEGEN.
   *
   * Diese Zeile hat beim ersten Lauf abgewichen, und zwar an sich selbst und
   * nicht an der Migration: die Meldung ist im Quelltext ueber ZWEI Literale
   * verteilt (`… es kommt kein '` + `'Bildpfad mit`), und `prosrc` traegt
   * den Rumpf so, wie er geschrieben ist — mit Zeilenumbruch und
   * Anfuehrungszeichen dazwischen. `%kein Bildpfad%` konnte ihn deshalb nie
   * treffen, obwohl der Riegel steht und wirkt (Probelauf P63 loest ihn aus).
   *
   * Gesucht wird jetzt ein Stueck, das GANZ im ersten Literal liegt.
   * `src/lib/admin/check-body-patterns.test.ts` rechnet diese Regel fuer
   * jede Zeile nach, die `prosrc` liest.
   */
  (115, 'Riegel', 'ein ausgewaehltes Bild ohne Pfad ebenso',
      (select (p.prosrc like '%das Bild ist ausgewaehlt%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (116, 'Riegel', 'eine veraltete Vorschau fuehrt zum Abbruch',
      (select (p.prosrc like '%seit der Vorschau geaendert%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  /* OHNE UMLAUT UND IN EINEM STUECK: die Meldung lautet „es ist kein Feld
     zur Uebernahme ausgewaehlt", im Rumpf mit echten Umlauten. Pruefdateien
     bleiben ASCII, also wird der umlautfreie Anfang gesucht — und zwar als
     EIN Stueck, nicht als zwei kurze um ein `%` herum. */
  (117, 'Riegel', 'eine leere Auswahl loescht keinen Entwurf',
      (select (p.prosrc like '%es ist kein Feld zur %')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  (118, 'Riegel', 'die Uebernahme rechnet mit admin_merge_plan und nicht selbst',
      (select (p.prosrc like '%public.admin_merge_plan(p_draft, p_target, v_bild)%')::text
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),
  /*
   * KEIN DYNAMISCHES SQL. Ein `execute format(...)` mit einem Feldnamen aus
   * dem Aufruf waere die bequeme Loesung und die gefaehrliche: die Allowlist
   * muesste dann lueckenlos sein, statt nur vollstaendig. Die Spalten sind
   * getippt — diese Zeile haelt das fest.
   */
  (119, 'Riegel', 'kein execute, kein format, kein quote_ident im Rumpf',
      (select (not (p.prosrc like '%execute %' or p.prosrc like '%format(%'
                    or p.prosrc like '%quote_ident%'))::text
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')), 'true'),

  -- --------------------------------------------- Die Abwaertskompatibilitaet
  (121, 'Abwaerts', 'admin_merge_draft(text,text,text) steht noch',
      (to_regprocedure('public.admin_merge_draft(text,text,text)') is not null)::text, 'true'),
  (122, 'Abwaerts', 'und sie ist eine WEITERLEITUNG — es gibt eine Logik, nicht zwei',
      (select (p.prosrc like '%admin_merge_draft(p_draft, p_target, p_image_path, null::jsonb)%')::text
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text)')), 'true'),
  (123, 'Abwaerts', 'genau ZWEI Fassungen von admin_merge_draft, nicht drei',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_merge_draft'), '2'),

  -- ------------------------------------------- Und nichts ist geschrieben
  (131, 'Unberuehrt', 'Info: Entwuerfe — mit 124 des Preflights vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Unberuehrt', 'kein Entwurf ist sichtbar',
      (select count(*)::text from public.skylanders
        where catalog_status = 'draft' and catalog_visible), '0'),
  (133, 'Unberuehrt', 'Status und Sichtbarkeit widersprechen sich nirgends',
      (select count(*)::text from public.skylanders
        where catalog_visible <> (catalog_status = 'public')), '0'),
  (134, 'Unberuehrt', 'admin_merge_references(text) ist unberuehrt (0154)',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text, 'true'),
  (135, 'Unberuehrt', 'admin_discard_draft(text) ist unberuehrt (0155)',
      (to_regprocedure('public.admin_discard_draft(text)') is not null)::text, 'true'),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0156 ruehrt das nicht an)',
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
