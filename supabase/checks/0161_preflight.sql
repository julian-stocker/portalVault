-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0161, REIN LESEND
--
-- VOR `0161_variant_family_auto.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0161 TUT. Eine vierte Funktion, `admin_publish_variant_auto(text,
-- text)`. Der Bediener waehlt nur die Basisfigur; die Familie regelt die
-- Datenbank — uebernehmen, suchen, anlegen, und bei Widerspruch abbrechen.
-- Die Checkbox „neue Familie anlegen?" entfaellt.
--
--   101-108  DIE GRUNDLAGE: die fuenf Funktionen aus `0152`/`0158`/`0159`,
--            die `0161` AUFRUFT, und der eindeutige Index auf
--            `lower(characters.canonical_name)` — ohne ihn waere „die
--            Familie mit diesem Namen" keine Beschreibung mehr.
--   111-118  DIE ABDRUECKE dieser fuenf. `0161` ersetzt keine von ihnen; die
--            Nachkontrolle nennt dieselben Zahlen wieder, und damit ist
--            „unveraendert" gemessen und nicht behauptet.
--   121-124  DIE NEUE FUNKTION STEHT NOCH NICHT.
--   131-139  DER EINSATZ: wie viele Entwuerfe ueberhaupt betroffen sind, und
--            — die Frage des Betreibers — ob irgendein Name im Katalog fuer
--            ZWEI verschiedene Familien steht. Zeile 134 ist der Kern:
--            waere sie nicht 0, waere Namensgleichheit kein Beweis.
--   141-146  DIE DREI FAELLE, die der Betreiber namentlich genannt hat:
--            Chop Chop, Stump Smash, Wrecking Ball. Jeder steht zweimal im
--            Katalog, in zwei Serien, und beide Zeilen sind Basisfigur eines
--            Entwurfs.
--
-- SIE SCHREIBT NICHTS und ruft keine der Funktionen auf.
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
coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
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
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------------- Die Grundlage
  (101, 'Grundlage', 'admin_set_variant_base(text,text,boolean) steht (0159)',
      (to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null)::text,
      'true'),
  (102, 'Grundlage', 'admin_publish_with_base(text,text,boolean) steht (0159)',
      (to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is not null)::text,
      'true'),
  (103, 'Grundlage', 'admin_create_character(text) steht (0158)',
      (to_regprocedure('public.admin_create_character(text)') is not null)::text, 'true'),
  (104, 'Grundlage', 'admin_set_character(text,bigint) steht (0158)',
      (to_regprocedure('public.admin_set_character(text,bigint)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_set_catalog_status(text,text) steht (0152)',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text,
      'true'),
  (106, 'Grundlage', 'skylanders.base_sky_id steht (0159)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '1'),
  /*
   * ZEILE 107 IST EINE VORBEDINGUNG UND KEINE FORMALIE. `0161` sucht „die
   * Familie mit dem Namen der Basisfigur". Gaebe es zwei gleichnamige, waere
   * das keine Beschreibung, sondern eine Auswahl — und die Funktion muesste
   * raten. Der eindeutige Index aus `0002` schliesst das aus.
   */
  (107, 'Grundlage', 'der eindeutige Index auf lower(characters.canonical_name) steht',
      (select count(*)::text from pg_index i
        where i.indrelid = to_regclass('public.characters') and i.indisunique
          and pg_get_indexdef(i.indexrelid) like '%lower(canonical_name)%'), '1'),
  (108, 'Grundlage', 'das Journal kennt character_id UND base_sky_id',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%character_id%'
                        and pg_get_constraintdef(c.oid) like '%base_sky_id%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- ------------------------------- Die Abdruecke der fuenf, die bleiben
  (111, 'Abdruecke', 'admin_set_variant_base — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)')),
      'b47289cb9b630ba5d3b6b186955539f6'),
  (112, 'Abdruecke', 'admin_publish_with_base',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_with_base(text,text,boolean)')),
      '3df170dff2915bc2e4e9092cae289e27'),
  (113, 'Abdruecke', 'admin_create_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_create_character(text)')),
      '5f8137b4acd0a325b8c2c1572850e3ea'),
  (114, 'Abdruecke', 'admin_set_character',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_character(text,bigint)')),
      '4b02bf104a095e61c9df29c50fe34647'),
  (115, 'Abdruecke', 'admin_publish_as_variant',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_as_variant(text,bigint)')),
      '99339dc5a2d51a165e0ce88c5012502d'),
  (116, 'Abdruecke', 'admin_set_catalog_status',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')),
      'e3c76fa571341e737c41fc2c3d6cdb8e'),

  -- ------------------------------------- Die neue Funktion steht noch nicht
  (121, 'Neu', 'admin_publish_variant_auto(text,text) steht NOCH NICHT',
      (to_regprocedure('public.admin_publish_variant_auto(text,text)') is null)::text,
      'true'),
  (122, 'Neu', 'und es gibt keine andere Funktion dieses Namens',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_publish_variant_auto'), '0'),

  -- ----------------------------------------------------------- Der Einsatz
  (131, 'Einsatz', 'Entwuerfe im Katalog',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Einsatz', 'Zeilen mit Familie',
      (select count(*)::text from public.skylanders where character_id is not null), null),
  (133, 'Einsatz', 'Varianten mit Basisfigur',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  /*
   * ZEILE 134 IST DIE FRAGE DES BETREIBERS, als Messung. Traegt ein Name
   * zwei verschiedene `character_id`, dann beweist Namensgleichheit nichts —
   * und `0161` duerfte eine gefundene Familie nicht benutzen. Sie darf es
   * trotzdem nur nach der Vetopruefung; diese Zeile sagt, wie gross das
   * Restrisiko ueberhaupt ist.
   */
  (134, 'Einsatz', 'Namen, die ZWEI verschiedene Familien tragen (muss 0 sein)',
      (select count(*)::text from (
         select lower(s.name) from public.skylanders s
          join public.categories c on c.id = s.category_id
         where s.is_active
           and not (c.name = any (public.non_collectible_categories()))
           and not (c.name = any (array['Traps', 'Trap Items', 'Fahrzeuge',
                                        'Kreationskristalle', 'Magic Items',
                                        'Trophies', 'Locations & Truhen']))
         group by lower(s.name) having count(distinct s.character_id) > 1) x), '0'),
  (135, 'Einsatz', 'Namen, die mehrfach vorkommen (dort greift die Wiederverwendung)',
      (select count(*)::text from (
         select lower(s.name) from public.skylanders s
          join public.categories c on c.id = s.category_id
         where s.is_active
           and not (c.name = any (public.non_collectible_categories()))
           and not (c.name = any (array['Traps', 'Trap Items', 'Fahrzeuge',
                                        'Kreationskristalle', 'Magic Items',
                                        'Trophies', 'Locations & Truhen']))
         group by lower(s.name) having count(*) > 1) x), null),
  (136, 'Einsatz', 'Ketten (eine Variante als Basisfigur) — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (137, 'Einsatz', 'Zuordnungen ueber Seriengrenzen — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.series_code <> v.series_code), '0'),
  (138, 'Einsatz', 'Abdruck der Variantenbeziehung — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n' order by sky_id)),
                       '(leer)')
         from public.skylanders where base_sky_id is not null), null),
  (139, 'Einsatz', 'Abdruck der Familienzuordnung — ebenso',
      (select coalesce(md5(string_agg(sky_id || '|' || character_id::text,
                                      E'\n' order by sky_id)), '(leer)')
         from public.skylanders where character_id is not null), null),

  -- ----------------------------------------------- Die drei genannten Faelle
  (141, 'Drei Faelle', 'Chop Chop: Zeilen, Serien, Familien',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Chop Chop'), null),
  (142, 'Drei Faelle', 'Stump Smash: Zeilen, Serien, Familien',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Stump Smash'), null),
  (143, 'Drei Faelle', 'Wrecking Ball: Zeilen, Serien, Familien',
      (select coalesce(string_agg(s.sky_id || ' ' || s.series_code || ' '
                                  || coalesce('F' || s.character_id::text, 'ohne')
                                  || ' ' || s.catalog_status, ' | ' order by s.sky_id),
                       '(keine)')
         from public.skylanders s where s.name = 'Wrecking Ball'), null),
  (144, 'Drei Faelle', 'und keiner der drei Namen traegt heute eine Familie '
                       '(dann legt 0161 sie an)',
      (select count(*)::text from public.skylanders
        where name in ('Chop Chop', 'Stump Smash', 'Wrecking Ball')
          and character_id is not null), null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0161 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
