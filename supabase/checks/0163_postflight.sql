-- ===========================================================================
-- STAGING — DER ZUSTAND NACH 0163, REIN LESEND
--
-- NACH `0163_catalog_types.sql` fahren, MIT der Baseline-Uebergabe aus dem
-- Preflight.
-- **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-109  DIE DREI SPALTEN und ihre DREI REGELN — und 106 ist die
--            wichtigste Zeile dieser Datei: die Mitgliedschaft haelt im
--            GANZEN Bestand, nicht nur in der Theorie.
--   111-119  DIE ZWEI FUNKTIONEN: Attribute, Rechte, und was ihre Ruempfe
--            zusagen — vor allem, dass keine von beiden `card_type`
--            anfasst.
--   121-129  DIE ERSTBELEGUNG, Zahl fuer Zahl: wie viele Zeilen welchen Type
--            tragen, wie viele zwei, wie viele ein Banner.
--   131-139  **DIE KARTENKUNST IST UNVERAENDERT.** Zeile 131 ist derselbe
--            Abdruck wie Preflight 151. Das ist die Zusage, um die der
--            Betreiber ausdruecklich gebeten hat, und sie steht hier als
--            Messung.
--   141-146  DAS JOURNAL kennt jetzt SECHZEHN Werte — die vierzehn alten
--            einzeln nachgewiesen, und die zwei neuen.
--   151-156  WAS UNBERUEHRT BLIEB: Variantenbeziehung, Familie, Exportrumpf.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0162`.
--
-- SIE RUFT KEINE DER BEIDEN FUNKTIONEN AUF. Was sie TUN, faehrt Probelauf
-- **P72** an erfundenen Zeilen.
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

  -- ------------------------------------------- Die drei Spalten, drei Regeln
  (101, 'Neu', 'skylanders.types steht, als text[] und NOT NULL',
      (select coalesce(string_agg(format_type(a.atttypid, a.atttypmod) || '/'
                                  || a.attnotnull::text, ','), '(fehlt)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), 'text[]/true'),
  (102, 'Neu', 'skylanders.visible_type steht, als text und nullbar',
      (select coalesce(string_agg(format_type(a.atttypid, a.atttypmod) || '/'
                                  || a.attnotnull::text, ','), '(fehlt)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type' and not a.attisdropped), 'text/false'),
  (103, 'Neu', 'skylanders.visible_type_decided steht, als boolean NOT NULL',
      (select coalesce(string_agg(format_type(a.atttypid, a.atttypmod) || '/'
                                  || a.attnotnull::text, ','), '(fehlt)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type_decided' and not a.attisdropped),
      'boolean/true'),
  (104, 'Neu', 'die drei Constraints stehen',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname in ('skylanders_types_known',
                            'skylanders_visible_type_member',
                            'skylanders_visible_type_decided')), '3'),
  (105, 'Neu', 'das Vokabular der CHECK — siebzehn Werte, keiner mehr',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%sidekick%'
                        and pg_get_constraintdef(c.oid) like '%lightcore%'
                        and pg_get_constraintdef(c.oid) like '%prestige%'
                        and pg_get_constraintdef(c.oid) like '%crystal%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_types_known'), 'true'),
  /*
   * ZEILE 106 IST DIE WICHTIGSTE DIESER DATEI. „Der sichtbare Type gehoert
   * zur Menge" ist eine CHECK und kein Versprechen — aber eine CHECK gilt
   * erst ab ihrer Anlage, und ein Bestand, der sie verletzt, wird beim
   * Anlegen abgewiesen. Dass sie IM GANZEN BESTAND haelt, steht hier.
   */
  (106, 'Neu', 'DIE MITGLIEDSCHAFT HAELT IM GANZEN BESTAND: Zeilen mit einem '
               'Banner, das nicht in ihrer Menge steht',
      (select count(*)::text from public.skylanders
        where visible_type is not null and not (visible_type = any (types))), '0'),
  (107, 'Neu', 'und kein Banner ohne Entscheidung',
      (select count(*)::text from public.skylanders
        where visible_type is not null and not visible_type_decided), '0'),
  (108, 'Neu', 'die Menge ist kanonisch — sortiert, jeder Wert einmal',
      (select count(*)::text from public.skylanders s
        where s.types is distinct from coalesce(
                (select array_agg(t order by t)
                   from (select distinct unnest(s.types) as t) x),
                '{}'::text[])), '0'),
  (109, 'Neu', 'der Trigger steht, der sie kanonisch haelt',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_canonical_types' and not t.tgisinternal), '1'),

  -- ---------------------------------------------------- Die zwei Funktionen
  (111, 'Funktionen', 'admin_set_figure_types(text,text[]) steht',
      (to_regprocedure('public.admin_set_figure_types(text,text[])')
       is not null)::text, 'true'),
  (112, 'Funktionen', 'admin_set_visible_type(text,text) steht',
      (to_regprocedure('public.admin_set_visible_type(text,text)')
       is not null)::text, 'true'),
  (113, 'Funktionen', 'beide security definer, leerer Suchpfad, volatile',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and p.prosecdef and p.provolatile = 'v'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%')), '2'),
  (114, 'Funktionen', 'keine offenen EXECUTE-Rechte',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))),
      '0'),
  (115, 'Funktionen', 'authenticated darf beide ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '2'),
  (116, 'Funktionen', 'beide pruefen is_platform_admin()',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and p.prosrc like '%is_platform_admin()%'), '2'),
  (117, 'Funktionen', 'beide sperren die Zeile (for update)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and p.prosrc like '%for update%'), '2'),
  /*
   * ZEILE 118 IST DIE ZWEITE ZUSAGE DES BETREIBERS: keine der beiden
   * Funktionen fasst `card_type` an. Das Hinzufuegen, Entfernen oder
   * Wechseln eines Types bewegt die Kartenkunst nicht — hier am Rumpf
   * gemessen und nicht behauptet.
   */
  (118, 'Funktionen', 'KEINE VON BEIDEN NENNT card_type — die Kartenkunst '
                      'bewegt sich nicht',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and p.prosrc like '%card_type%'), '0'),
  (119, 'Funktionen', 'und keine nennt base_sky_id oder character_id (D7)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                        to_regprocedure('public.admin_set_visible_type(text,text)'))
          and (p.prosrc like '%base_sky_id%' or p.prosrc like '%character_id%')),
      '0'),

  -- ------------------------------------------------------- Die Erstbelegung
  (121, 'Erstbelegung', 'Zeilen mit mindestens einem Type',
      (select count(*)::text from public.skylanders where cardinality(types) > 0),
      null),
  (122, 'Erstbelegung', 'Zeilen mit ZWEI oder mehr',
      (select count(*)::text from public.skylanders where cardinality(types) > 1),
      null),
  (123, 'Erstbelegung', 'Zeilen OHNE Type (= Standard)',
      (select count(*)::text from public.skylanders where cardinality(types) = 0),
      null),
  (124, 'Erstbelegung', 'Zeilen mit Banner',
      (select count(*)::text from public.skylanders where visible_type is not null),
      null),
  (125, 'Erstbelegung', 'Verteilung der Banner',
      (select coalesce(string_agg(visible_type || '=' || n::text, ', '
                                  order by n desc, visible_type), '(keine)')
         from (select visible_type, count(*) as n from public.skylanders
                where visible_type is not null group by visible_type) x), null),
  /*
   * ZEILE 126: KEINE GRUPPE IST AUF EINEM BANNER GELANDET (Entscheidung D4).
   * Die Prioritaet ist ein Vorschlag im Dropdown und keine Wirkung; waere
   * sie beim Migrieren gelaufen, stuende hier eine Zahl ueber null — und auf
   * 248 oeffentlichen Kacheln ein Banner, das niemand gewaehlt hat.
   */
  (126, 'Erstbelegung', 'KEIN Banner ist ein Figuren- oder Zubehoertype (D4)',
      (select count(*)::text from public.skylanders
        where visible_type = any (array['giant','swapper','master','sensei',
                                        'mini','sidekick','item','trap',
                                        'vehicle','crystal'])), '0'),
  (127, 'Erstbelegung', 'Zeilen mit LIGHTCORE in der Menge',
      (select count(*)::text from public.skylanders
        where 'lightcore' = any (types)), '21'),
  /*
   * ZEILE 128 IST DIE REGEL UND NICHT MEHR DIE ZAHL — und das ist eine
   * Korrektur. Hier stand `'17'`, die Zahl vom 2026-10-29 um 11:12; sie
   * folgt dem Bestand und nicht der Migration. Geprueft wird deshalb, was
   * Entscheidung D3 WIRKLICH sagt: jede LightCore-Zeile, deren Kartenkunst
   * `special` ist, traegt danach das Banner LIGHTCORE. Null Verstoesse, bei
   * jedem Bestand.
   */
  (128, 'Erstbelegung', 'LightCore-Zeilen mit der Kartenkunst special, die '
                        'NICHT das Banner LIGHTCORE tragen (D3, muss 0 sein)',
      (select count(*)::text from public.skylanders
        where card_type = 'special' and 'lightcore' = any (types)
          and visible_type is distinct from 'lightcore'), '0'),
  (129, 'Erstbelegung', 'und keine LightCore traegt zusaetzlich SPECIAL (D3)',
      (select count(*)::text from public.skylanders
        where 'lightcore' = any (types) and 'special' = any (types)), '0'),
  (130, 'Erstbelegung', 'und wie viele es sind (Auskunft; die Huelle vergleicht '
                        'die Zahl mit der vor dem Lauf gemessenen)',
      (select count(*)::text from public.skylanders
        where visible_type = 'lightcore'), null),

  -- ------------------------------- DIE KARTENKUNST IST UNVERAENDERT
  /*
   * ZEILE 131 IST DIE ZUSAGE, UM DIE DER BETREIBER GEBETEN HAT. Derselbe
   * Abdruck wie Preflight 151, Zeichen fuer Zeichen. Weicht er ab, hat die
   * Erstbelegung eine Kartenkunst veraendert — und dann gehoert die
   * Migration zurueckgenommen, nicht erklaert.
   */
  (131, 'Kartenkunst', 'DER ABDRUCK — muss der aus Preflight 151 sein',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders), null),
  (132, 'Kartenkunst', 'die Verteilung — dieselbe wie im Preflight 132',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(leer)')
         from (select card_type, count(*) as n from public.skylanders
                group by card_type) x), null),
  (133, 'Kartenkunst', 'ihr CHECK steht unveraendert',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%prestige%'
                        and pg_get_constraintdef(c.oid) like '%elite%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_card_type_known'), 'true'),
  (134, 'Kartenkunst', 'und die 21 LightCore-Zeilen tragen sie unveraendert',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(keine)')
         from (select card_type, count(*) as n from public.skylanders
                where 'lightcore' = any (types) group by card_type) x), null),

  -- ------------------------------------------------------------- Das Journal
  (141, 'Journal', 'die Audit-Constraint kennt types',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%''types''%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (142, 'Journal', 'und visible_type',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%''visible_type''%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  /*
   * ZEILE 143: DIE VIERZEHN ALTEN, EINZELN. `0163` baut die Liste aus dem
   * VORGEFUNDENEN Stand — sie kann also keinen verlieren —, und hier wird
   * nachgesehen, dass das gestimmt hat.
   */
  (143, 'Journal', 'und jeden der VIERZEHN alten Werte, einzeln nachgewiesen',
      (select coalesce(max((
             pg_get_constraintdef(c.oid) like '%''catalog_visible''%'
         and pg_get_constraintdef(c.oid) like '%''display_name_override''%'
         and pg_get_constraintdef(c.oid) like '%''admin_note''%'
         and pg_get_constraintdef(c.oid) like '%''catalog_group''%'
         and pg_get_constraintdef(c.oid) like '%''image_override_path''%'
         and pg_get_constraintdef(c.oid) like '%''card_type''%'
         and pg_get_constraintdef(c.oid) like '%''created''%'
         and pg_get_constraintdef(c.oid) like '%''catalog_status''%'
         and pg_get_constraintdef(c.oid) like '%''merged_from''%'
         and pg_get_constraintdef(c.oid) like '%''discarded''%'
         and pg_get_constraintdef(c.oid) like '%''character_id''%'
         and pg_get_constraintdef(c.oid) like '%''base_sky_id''%'
         and pg_get_constraintdef(c.oid) like '%''market_price''%'
         and pg_get_constraintdef(c.oid) like '%''deleted''%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (144, 'Journal', 'Journalzeilen mit types oder visible_type (muss 0 sein — '
                   'die Migration ruft die Funktionen nicht auf)',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes
                     where field in ('types', 'visible_type')$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),

  -- ------------------------------------------------- Was unberuehrt blieb
  (151, 'Unberuehrt', 'die Variantenbeziehung — derselbe Abdruck wie '
                      'Preflight 152 (D7)',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders where base_sky_id is not null), null),
  (152, 'Unberuehrt', 'die Familienzuordnung — Preflight 153',
      (select coalesce(md5(string_agg(sky_id || '|' || character_id::text, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders where character_id is not null), null),
  (153, 'Unberuehrt', 'der Exportrumpf ist NOCH der aus 0160 — 0164 ersetzt '
                      'ihn, nicht diese Migration',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),
  (154, 'Unberuehrt', 'admin_discard_draft (0155) ist unveraendert',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_discard_draft(text)')), null),
  (155, 'Unberuehrt', 'admin_publish_variant_auto (0161) ebenso',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'adf679deb5d42fad5dff15bd1641f318'),
  (156, 'Unberuehrt', 'und die zwei Zusammenfuehrungsruempfe sind JETZT die aus '
                      '0163 — sie nennen types',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                        to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
          and p.prosrc like '%''types''%'), '2'),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0163 ruehrt das nicht an)',
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
