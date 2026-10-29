-- ===========================================================================
-- STAGING — DER ZUSTAND NACH 0161, REIN LESEND
--
-- NACH `0161_variant_family_auto.sql` fahren, MIT der Baseline-Uebergabe aus
-- dem Preflight.
-- **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-109  DIE NEUE FUNKTION: sie steht, `security definer`, leerer
--            Suchpfad, nur `authenticated` — und ihr Rumpf traegt die vier
--            Zusagen, auf die es ankommt: den Advisory-Lock, die feste
--            Sperrordnung, die VETOPRUEFUNG und den Verzicht auf jedes
--            eigene `update`.
--   111-116  DIE FUENF FUNKTIONEN AUS `0152`/`0158`/`0159` sind
--            UNVERAENDERT — dieselben Abdruecke wie im Preflight, Zeile fuer
--            Zeile. Das ist Anforderung 1 des Betreibers, gemessen.
--   121-126  WAS DER RUMPF NICHT TUT: kein `update` auf `skylanders`, kein
--            `insert` ausser ueber die vorhandenen Funktionen, kein Name,
--            kein Slug, kein Preis, keine Sichtbarkeit.
--   131-139  UND NICHTS IST GESCHRIEBEN: dieselben Zahlen und dieselben
--            Abdruecke der Variantenbeziehung UND der Familienzuordnung wie
--            im Preflight (138, 139). Eine Migration, die eine Funktion
--            anlegt, darf keine Zeile anfassen.
--   141-144  die drei genannten Faelle, unveraendert.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0160`.
--
-- SIE RUFT DIE FUNKTION NICHT AUF. Was sie TUT, faehrt Probelauf **P70** an
-- erfundenen Zeilen — einschliesslich der drei Faelle Chop Chop, Stump Smash
-- und Wrecking Ball und des Vetos.
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

  -- ------------------------------------------------- Die neue Funktion
  (101, 'Funktion', 'admin_publish_variant_auto(text,text) steht',
      (to_regprocedure('public.admin_publish_variant_auto(text,text)') is not null)::text,
      'true'),
  (102, 'Funktion', 'genau EINE Fassung dieses Namens',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_publish_variant_auto'), '1'),
  (103, 'Funktion', 'security definer',
      (select coalesce(max(p.prosecdef::text), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (104, 'Funktion', 'genau EINE search_path-Festlegung, und ihr Wert ist LEER',
      (select coalesce(max((select substring(c from 'search\_path=(.*)$')
                              from unnest(coalesce(p.proconfig, '{}')) c
                             where c like 'search\_path=%')), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      '""'),
  (105, 'Rechte', 'kein EXECUTE fuer anon oder public',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (106, 'Rechte', 'authenticated darf ausfuehren — genau einmal',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),
  /*
   * ZEILE 107 IST DIE NEBENLAEUFIGKEITSZUSAGE. Ohne den Advisory-Lock liefen
   * zwei gleichzeitige Veroeffentlichungen derselben Basisfigur in `23505`
   * am Eindeutigkeitsindex. Der Riegel steht im Rumpf, und hier steht, dass
   * er dort steht.
   */
  (107, 'Rumpf', 'der Advisory-Lock auf dem Familiennamen steht im Rumpf',
      (select coalesce(max((p.prosrc like '%pg_advisory_xact_lock%'
                        and p.prosrc like '%skyisles.family:%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (108, 'Rumpf', 'die feste Sperrordnung (beide Zeilen in EINER Anweisung, nach sky_id)',
      (select coalesce(max((p.prosrc like '%order by s.sky_id%'
                        and p.prosrc like '%for update%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  /*
   * ZEILE 109 IST DIE ANTWORT AUF DIE FRAGE DES BETREIBERS. Die
   * Vetopruefung ist der Unterschied zwischen „der Name stimmt" und „die
   * Identitaet ist bestaetigt". Gezaehlt wird das vollstaendige Muster, nicht
   * eine Zeichenfolge.
   */
  (109, 'Rumpf', 'die VETOPRUEFUNG steht im Rumpf: right() statt like, und die '
                 'Meldung nennt das unvereinbare Mitglied',
      (select coalesce(max((p.prosrc like '%nicht vereinbar%'
                        and p.prosrc like '%right(lower(s.name)%'
                        and p.prosrc not like '%like ''%'' || v_klein%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),

  -- --------------------- Die fuenf aus 0152/0158/0159 sind UNVERAENDERT
  (111, 'Unveraendert', 'admin_set_variant_base — derselbe Abdruck wie im Preflight',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')),
      'b47289cb9b630ba5d3b6b186955539f6'),
  (112, 'Unveraendert', 'admin_publish_with_base',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)')),
      '3df170dff2915bc2e4e9092cae289e27'),
  (113, 'Unveraendert', 'admin_create_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_create_character(text)')),
      '5f8137b4acd0a325b8c2c1572850e3ea'),
  (114, 'Unveraendert', 'admin_set_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_character(text,bigint)')),
      '4b02bf104a095e61c9df29c50fe34647'),
  (115, 'Unveraendert', 'admin_publish_as_variant',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_as_variant(text,bigint)')),
      '99339dc5a2d51a165e0ce88c5012502d'),
  (116, 'Unveraendert', 'admin_set_catalog_status',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')),
      'e3c76fa571341e737c41fc2c3d6cdb8e'),

  -- ------------------------------------------- Was der Rumpf NICHT tut
  (121, 'Nicht', 'kein eigenes update auf skylanders — geschrieben wird ueber '
                 'admin_set_character und admin_set_variant_base',
      (select coalesce(max((p.prosrc not like '%update public.skylanders%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (122, 'Nicht', 'kein delete, kein truncate',
      (select coalesce(max((p.prosrc not like '%delete from%'
                        and p.prosrc not like '%truncate%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (123, 'Nicht', 'kein Name, kein Slug, kein Preis, keine Sichtbarkeit im Rumpf',
      (select coalesce(max((p.prosrc not like '%set name%'
                        and p.prosrc not like '%set slug%'
                        and p.prosrc not like '%market_price%'
                        and p.prosrc not like '%set catalog_visible%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (124, 'Nicht', 'der Adminriegel steht im Rumpf',
      (select coalesce(max((p.prosrc like '%is_platform_admin()%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (125, 'Nicht', 'sie ruft admin_set_character UND admin_set_variant_base auf',
      (select coalesce(max((p.prosrc like '%admin_set_character%'
                        and p.prosrc like '%admin_set_variant_base%'
                        and p.prosrc like '%admin_set_catalog_status%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),
  (126, 'Nicht', 'und sie ruft admin_set_variant_base mit false auf (eine Stelle '
                 'fuer die Familie, nicht zwei)',
      (select coalesce(max((p.prosrc like '%admin_set_variant_base(p_sky_id, p_base_sky_id, false)%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'true'),

  -- -------------------------------------- Und nichts ist geschrieben
  (131, 'Unberuehrt', 'Entwuerfe — mit 131 des Preflights vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Unberuehrt', 'Zeilen mit Familie — mit 132 vergleichen',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (133, 'Unberuehrt', 'Varianten mit Basisfigur — mit 133 vergleichen',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (134, 'Unberuehrt', 'Namen mit zwei verschiedenen Familien — muss 0 sein',
      (select count(*)::text from (
         select lower(s.name) from public.skylanders s
          join public.categories c on c.id = s.category_id
         where s.is_active
           and not (c.name = any (public.non_collectible_categories()))
           and not (c.name = any (array['Traps', 'Trap Items', 'Fahrzeuge',
                                        'Kreationskristalle', 'Magic Items',
                                        'Trophies', 'Locations & Truhen']))
         group by lower(s.name) having count(distinct s.character_id) > 1) x), '0'),
  (136, 'Unberuehrt', 'Ketten — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (137, 'Unberuehrt', 'Zuordnungen ueber Seriengrenzen — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.series_code <> v.series_code), '0'),
  (138, 'Unberuehrt', 'Abdruck der Variantenbeziehung — MIT 138 DES PREFLIGHTS VERGLEICHEN',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n' order by sky_id)),
                       '(leer)')
         from public.skylanders where base_sky_id is not null), null),
  (139, 'Unberuehrt', 'Abdruck der Familienzuordnung — MIT 139 VERGLEICHEN',
      (select coalesce(md5(string_agg(sky_id || '|' || character_id::text,
                                      E'\n' order by sky_id)), '(leer)')
         from public.skylanders where character_id is not null), null),

  -- ----------------------------------------------- Die drei genannten Faelle
  (141, 'Drei Faelle', 'Chop Chop — mit 141 des Preflights vergleichen',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Chop Chop'), null),
  (142, 'Drei Faelle', 'Stump Smash — mit 142 vergleichen',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Stump Smash'), null),
  (143, 'Drei Faelle', 'Wrecking Ball — mit 143 vergleichen',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Wrecking Ball'), null),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0161 ruehrt das nicht an)',
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
