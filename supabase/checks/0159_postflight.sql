-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0159, REIN LESEND
--
-- NACH `0159_variant_base_figure.sql` fahren, MIT der Baseline-Uebergabe aus
-- dem Preflight. **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-108  DIE RIEGEL AM KATALOG, nicht am Funktionsrumpf: die Spalte, der
--            ZUSAMMENGESETZTE Fremdschluessel mit RESTRICT, die
--            Eindeutigkeit, die er braucht, der CHECK, der Trigger, der
--            Teilindex. Ein Fremdschluessel und ein CHECK lassen sich direkt
--            abfragen — das ist mehr als ein `prosrc like`.
--   111-116  DER ERSETZTE RUMPF VON `admin_merge_references`: sie weist
--            einen mehrspaltigen Fremdschluessel NICHT mehr ab und leitet
--            die Spalte ueber `confkey` her. Ohne das braeche jede
--            Zusammenfuehrung, sobald `base_sky_id` steht.
--   121-128  DIE ZWEI NEUEN FUNKTIONEN mit Rechten und Attributen, und die
--            Zusagen am Rumpf: kein Name, kein Slug, Weg B nur fuer
--            Entwuerfe, die Familie nie gegen eine vorhandene.
--   131-138  DIE 0158-FUNKTIONEN STEHEN NOCH, der zwoelfte Journalwert ist
--            da, die elf alten sind es auch — und NICHTS ist zugeordnet.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0158`.
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

  -- ------------------------------------------- Die Riegel am Katalog
  (101, 'Riegel', 'skylanders.base_sky_id steht',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '1'),
  /*
   * DER SERIENRIEGEL, DIREKT AM KATALOG GEFRAGT. Er ist die Zusage dieser
   * Migration: weil `series_code` auf BEIDEN Seiten steht, kann eine
   * Variante nur auf eine Basisfigur derselben Serie zeigen. Ein
   * einspaltiger Schluessel auf `sky_id` allein saehe aehnlich aus und
   * liesse jede Serie zu — deshalb wird der Wortlaut geprueft.
   */
  (102, 'Riegel', 'skylanders_base_same_series ist ein Fremdschluessel',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_same_series' and c.contype = 'f'), '1'),
  (103, 'Riegel', 'er nennt BEIDE Spalten und RESTRICT (nicht CASCADE)',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%base_sky_id%series_code%'
                        and pg_get_constraintdef(c.oid) like '%ON UPDATE RESTRICT%'
                        and pg_get_constraintdef(c.oid) like '%ON DELETE RESTRICT%')::text),
                       '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_same_series'), 'true'),
  (104, 'Riegel', 'Info: sein Wortlaut',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_same_series'), null),
  (105, 'Riegel', 'skylanders_id_series_uniq steht — ohne sie kann er nicht zeigen',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_id_series_uniq' and c.contype = 'u'), '1'),
  (106, 'Riegel', 'skylanders_base_not_self ist ein CHECK',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_not_self' and c.contype = 'c'), '1'),
  (107, 'Riegel', 'der Kettenriegel steht als Trigger auf base_sky_id',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_base_guard_trg' and not t.tgisinternal), '1'),
  (108, 'Riegel', 'und der Teilindex fuer "alle Varianten dieser Figur"',
      (select count(*)::text from pg_class c
        where c.relname = 'skylanders_base_sky_id_idx' and c.relkind = 'i'), '1'),

  -- ------------------------- Die ersetzte Referenzzaehlung (der Regressionsfund)
  /*
   * OHNE DIESE KORREKTUR BRAECHE ALLES. `admin_merge_references` nahm blind
   * `conkey[1]` und wies einen mehrspaltigen Fremdschluessel ab — und `0159`
   * legt genau so einen an. Jede Zusammenfuehrung und jedes Verwerfen waere
   * danach gescheitert. Gefunden hat das der Probelauf P67, vor dem
   * SQL-Editor; diese vier Zeilen halten die Korrektur fest.
   */
  (111, 'Zaehlung', 'admin_merge_references steht',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text, 'true'),
  (112, 'Zaehlung', 'sie weist einen mehrspaltigen Fremdschluessel NICHT mehr ab',
      (select coalesce(max((p.prosrc not like '%mehrspaltigen Fremdschluessel%')::text),
                       '(fehlt)') from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (113, 'Zaehlung', 'sie leitet die Spalte ueber confkey her',
      (select coalesce(max((p.prosrc like '%confkey%')::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (114, 'Zaehlung', 'und ein Schluessel ohne sky_id bricht weiter laut ab',
      (select coalesce(max((p.prosrc like '%nicht auf sky_id%')::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (115, 'Zaehlung', 'catalog_editorial bleibt ausgeschlossen (die eigene Notiz)',
      (select coalesce(max((p.prosrc like '%catalog_editorial%')::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)')), 'true'),
  (116, 'Zaehlung', 'Fremdschluessel auf skylanders jetzt (einer mehr als vorher)',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'), null),

  -- ---------------------------------------------- Die zwei neuen Funktionen
  (121, 'Funktion', 'admin_set_variant_base steht',
      (to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null)::text, 'true'),
  (122, 'Funktion', 'admin_publish_with_base steht',
      (to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is not null)::text, 'true'),
  (123, 'Funktion', 'beide sind security definer mit genau einer search_path-Festlegung',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
          and p.prosecdef
          and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%') = 1), '2'),
  (124, 'Rechte', 'kein EXECUTE fuer anon oder public',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (125, 'Rechte', 'authenticated darf beide genau einmal ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '2'),
  (126, 'Zusagen', 'keine der beiden schreibt name oder slug',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
          and (p.prosrc like '%set name%' or p.prosrc like '%set slug%')), '0'),
  (127, 'Zusagen', 'Weg B laesst nur Entwuerfe durch und verlangt eine Basisfigur',
      (select coalesce(max((p.prosrc like '%ist kein Entwurf%'
                        and p.prosrc like '%braucht eine Basisfigur%')::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)')), 'true'),
  (128, 'Zusagen', 'die Familie wird nie gegen eine vorhandene geschrieben',
      (select coalesce(max((p.prosrc like '%klaeren, welche gilt%')::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')), 'true'),

  -- ------------------------- Die 0158-Funktionen, das Journal, und nichts sonst
  (131, 'Erhalten', 'die drei Funktionen aus 0158 stehen noch',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_set_character', 'admin_create_character',
                            'admin_publish_as_variant')), '3'),
  (132, 'Erhalten', 'die Constraint kennt base_sky_id',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%base_sky_id%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (133, 'Erhalten', 'und alle elf bisherigen Werte',
      (select coalesce(max((
             pg_get_constraintdef(c.oid) like '%catalog_visible%'
         and pg_get_constraintdef(c.oid) like '%display_name_override%'
         and pg_get_constraintdef(c.oid) like '%admin_note%'
         and pg_get_constraintdef(c.oid) like '%catalog_group%'
         and pg_get_constraintdef(c.oid) like '%image_override_path%'
         and pg_get_constraintdef(c.oid) like '%card_type%'
         and pg_get_constraintdef(c.oid) like '%created%'
         and pg_get_constraintdef(c.oid) like '%catalog_status%'
         and pg_get_constraintdef(c.oid) like '%merged_from%'
         and pg_get_constraintdef(c.oid) like '%discarded%'
         and pg_get_constraintdef(c.oid) like '%character_id%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (134, 'Unberuehrt', 'NICHTS ist zugeordnet — 0159 ordnet nicht zu',
      (select count(*)::text from public.skylanders where base_sky_id is not null), '0'),
  (135, 'Unberuehrt', 'keine Journalzeile base_sky_id',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes where field = 'base_sky_id'$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),
  (136, 'Unberuehrt', 'Katalogzeilen — mit 131 des Preflights vergleichen',
      (select count(*)::text from public.skylanders), null),
  (137, 'Unberuehrt', 'Zeilen MIT Familie — mit 132 vergleichen',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (138, 'Unberuehrt', 'Entwuerfe — mit 133 vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0159 ruehrt das nicht an)',
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
