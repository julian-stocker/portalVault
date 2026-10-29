-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0163, REIN LESEND
--
-- VOR `0163_catalog_types.sql` fahren. **ERST `0162`, DANN `0163`.**
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0163 TUT. Drei Spalten auf `skylanders` — `types`, `visible_type`,
-- `visible_type_decided` —, zwei Funktionen, ein normalisierender Trigger,
-- zwei Journalwerte, und die zwei Zusammenfuehrungsfunktionen aus `0157` mit
-- je einem Block mehr.
--
--   101-112  DIE GRUNDLAGE: `catalog_group` an den Kategorien (die Quelle der
--            Figuren- und Zubehoertypen), `card_type` samt CHECK (die
--            KARTENKUNST, die unberuehrt bleibt), die zwei Ruempfe, die
--            ersetzt werden, und — Zeile 112 — die REIHENFOLGE: die
--            Audit-Constraint muss die Werte aus `0162` kennen.
--   121-124  DIE DREI SPALTEN STEHEN NOCH NICHT.
--   131-139  DER EINSATZ, und hier liegt die Auskunft, die der Betreiber
--            braucht: wie viele Zeilen welchen Type bekommen, wie viele
--            ZWEI bekommen, und wie viele Banner sich aendern.
--   141-146  DIE KURATIERTE LIGHTCORE-LISTE, gegengeprueft: stehen die 21
--            SKY-IDs wirklich im Katalog, und tragen sie die Kartenkunst,
--            von der die Migration ausgeht?
--   151-156  DIE ABDRUECKE, die unveraendert bleiben muessen — vor allem
--            der von `card_type`. Die Nachkontrolle nennt sie wieder.
--
-- SIE SCHREIBT NICHTS.
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
  (101, 'Grundlage', 'categories.catalog_group steht (0040) — die Quelle der '
                     'Figuren- und Zubehoertypen',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.categories')
          and a.attname = 'catalog_group' and not a.attisdropped), '1'),
  (102, 'Grundlage', 'skylanders.card_type steht (0030) — die KARTENKUNST',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'card_type' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'ihr CHECK mit den sieben Werten — 0163 laesst ihn stehen',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%prestige%'
                        and pg_get_constraintdef(c.oid) like '%elite%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_card_type_known'), 'true'),
  (104, 'Grundlage', 'skylanders.catalog_status steht (0152)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '1'),
  (105, 'Grundlage', 'is_platform_admin() steht (0026)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (106, 'Grundlage', 'admin_merge_plan(text,text,text) steht (0157)',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is not null)::text,
      'true'),
  (107, 'Grundlage', 'admin_merge_draft(text,text,text,jsonb) steht (0157)',
      (to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')
       is not null)::text, 'true'),
  /*
   * ZEILE 112 IST DIE REIHENFOLGE, ALS MESSUNG. `0162` nennt ihre vierzehn
   * Journalwerte fest; lief sie NACH dieser Migration, wuerfe sie `types`
   * und `visible_type` wieder heraus, und der erste Typwechsel liefe in
   * `23514`. Ist diese Zeile nicht `true`, gehoert `0162` zuerst gefahren.
   */
  (112, 'Grundlage', 'DIE REIHENFOLGE: die Audit-Constraint kennt market_price '
                     'und deleted (= 0162 liegt)',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%''market_price''%'
                        and pg_get_constraintdef(c.oid) like '%''deleted''%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),

  -- -------------------------------------- Die drei Spalten stehen noch nicht
  (121, 'Neu', 'skylanders.types steht NOCH NICHT',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped), '0'),
  (122, 'Neu', 'skylanders.visible_type steht NOCH NICHT',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type' and not a.attisdropped), '0'),
  (123, 'Neu', 'skylanders.visible_type_decided steht NOCH NICHT',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type_decided' and not a.attisdropped), '0'),
  (124, 'Neu', 'und keine der zwei Funktionen',
      (select count(*)::text from pg_proc p join pg_namespace n
        on n.oid = p.pronamespace where n.nspname = 'public'
         and p.proname in ('admin_set_figure_types', 'admin_set_visible_type')),
      '0'),

  -- ----------------------------------------------------------- Der Einsatz
  (131, 'Einsatz', 'Zeilen je Gruppe (daraus entstehen die Figuren- und '
                   'Zubehoertypen)',
      (select coalesce(string_agg(coalesce(g, '(ohne)') || '=' || n::text, ', '
                                  order by n desc), '(leer)')
         from (select c.catalog_group as g, count(*) as n
                 from public.skylanders s
                 left join public.categories c on c.id = s.category_id
                group by c.catalog_group) x), null),
  (132, 'Einsatz', 'Zeilen je Kartentyp (daraus entstehen die Variantentypen)',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(leer)')
         from (select card_type, count(*) as n from public.skylanders
                group by card_type) x), null),
  (133, 'Einsatz', 'Minis und Sidekicks — sie tragen DIESELBE Gruppe und '
                   'werden am Kategorienamen getrennt',
      (select coalesce(string_agg(c.name || '=' || n::text, ', ' order by c.name),
                       '(keine)')
         from (select s.category_id, count(*) as n from public.skylanders s
                group by s.category_id) x
         join public.categories c on c.id = x.category_id
        where c.catalog_group = 'mini'), null),
  (134, 'Einsatz', 'Zeilen, die ZWEI Types bekommen (Gruppe UND Kartentyp)',
      (select count(*)::text from public.skylanders s
        join public.categories c on c.id = s.category_id
       where c.catalog_group is not null and c.catalog_group <> 'figure'
         and s.card_type <> 'standard'), null),
  (135, 'Einsatz', 'Zeilen, die KEINEN Type bekommen (= Standard)',
      (select count(*)::text from public.skylanders s
        left join public.categories c on c.id = s.category_id
       where s.card_type = 'standard'
         and (c.catalog_group is null or c.catalog_group = 'figure')), null),
  /*
   * ZEILE 136 IST DIE EINE GEWOLLTE AENDERUNG AM BILDSCHIRM: eine LightCore
   * traegt danach das Banner LIGHTCORE statt SPECIAL, weil `special` nach
   * Entscheidung D3 nicht mitwandert. Ihre KARTENKUNST bleibt `special`.
   *
   * SIE IST EINE AUSKUNFT UND KEIN SOLLWERT — und das ist eine Korrektur.
   * Hier stand `'17'`, die Zahl vom 2026-10-29 um 11:12. Verschiebt der
   * Betreiber bis zum Lauf eine LightCore von `special` auf `chase` (genau
   * das ist mit SKY-0172 geschehen), sind es sechzehn — und die Migration
   * waere an einer Zahl gescheitert, die gar keine Regel ist. Die SCHUTZ-
   * WIRKUNG ist nicht entfallen, sondern umgezogen: die Huelle
   * `staging-0163.sql` MISST diese Zahl vor dem Lauf (Waechter A7) und
   * vergleicht sie danach (B5), und die Nachkontrolle prueft zusaetzlich die
   * REGEL dahinter (Zeile 128) — die gilt bei jedem Bestand.
   */
  (136, 'Einsatz', 'Banner, die von SPECIAL auf LIGHTCORE wechseln (Auskunft; '
                   'die Huelle vergleicht sie vor und nach dem Lauf)',
      (select count(*)::text from public.skylanders
        where card_type = 'special'
          and sky_id = any (array['SKY-0129','SKY-0130','SKY-0140','SKY-0143',
                                  'SKY-0146','SKY-0157','SKY-0159','SKY-0166',
                                  'SKY-0171','SKY-0172','SKY-0243','SKY-0246',
                                  'SKY-0251','SKY-0252','SKY-0263','SKY-0265',
                                  'SKY-0266','SKY-0294','SKY-0295','SKY-0296',
                                  'SKY-0854'])), null),
  (137, 'Einsatz', 'alle UEBRIGEN Banner bleiben zeichengleich',
      (select count(*)::text from public.skylanders
        where card_type <> 'standard'
          and not (card_type = 'special'
                   and sky_id = any (array['SKY-0129','SKY-0130','SKY-0140',
                                           'SKY-0143','SKY-0146','SKY-0157',
                                           'SKY-0159','SKY-0166','SKY-0171',
                                           'SKY-0172','SKY-0243','SKY-0246',
                                           'SKY-0251','SKY-0252','SKY-0263',
                                           'SKY-0265','SKY-0266','SKY-0294',
                                           'SKY-0295','SKY-0296','SKY-0854']))),
      null),

  -- ------------------------------------------- Die kuratierte LightCore-Liste
  (141, 'LightCore', 'wie viele der 21 SKY-IDs es im Katalog wirklich gibt',
      (select count(*)::text from public.skylanders
        where sky_id = any (array['SKY-0129','SKY-0130','SKY-0140','SKY-0143',
                                  'SKY-0146','SKY-0157','SKY-0159','SKY-0166',
                                  'SKY-0171','SKY-0172','SKY-0243','SKY-0246',
                                  'SKY-0251','SKY-0252','SKY-0263','SKY-0265',
                                  'SKY-0266','SKY-0294','SKY-0295','SKY-0296',
                                  'SKY-0854'])), '21'),
  (142, 'LightCore', 'ihre heutige Kartenkunst — die Migration geht von '
                     'special=17, legendary=2, prestige=1, standard=1 aus',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(keine)')
         from (select card_type, count(*) as n from public.skylanders
                where sky_id = any (array['SKY-0129','SKY-0130','SKY-0140',
                                          'SKY-0143','SKY-0146','SKY-0157',
                                          'SKY-0159','SKY-0166','SKY-0171',
                                          'SKY-0172','SKY-0243','SKY-0246',
                                          'SKY-0251','SKY-0252','SKY-0263',
                                          'SKY-0265','SKY-0266','SKY-0294',
                                          'SKY-0295','SKY-0296','SKY-0854'])
                group by card_type) x), null),
  (143, 'LightCore', 'und keine davon traegt heute schon einen Namen OHNE '
                     '„lightcore" (Gegenprobe der Liste)',
      (select count(*)::text from public.skylanders
        where sky_id = any (array['SKY-0129','SKY-0130','SKY-0140','SKY-0143',
                                  'SKY-0146','SKY-0157','SKY-0159','SKY-0166',
                                  'SKY-0171','SKY-0172','SKY-0243','SKY-0246',
                                  'SKY-0251','SKY-0252','SKY-0263','SKY-0265',
                                  'SKY-0266','SKY-0294','SKY-0295','SKY-0296',
                                  'SKY-0854'])
          and lower(replace(name, ' ', '')) not like '%lightcore%'), '0'),

  -- ------------------------------------------------ Die Abdruecke, die bleiben
  /*
   * ZEILE 151 IST DIE ZUSAGE DIESER MIGRATION. Die Kartenkunst wird NICHT
   * abgeleitet und NICHT angefasst; die Nachkontrolle nennt denselben
   * Abdruck wieder. Gemessen am 2026-10-29: 4d6bbb026b37449cc0d2def77949d095.
   */
  (151, 'Abdruecke', 'DIE KARTENKUNST — die Nachkontrolle nennt sie wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders), null),
  (152, 'Abdruecke', 'die Variantenbeziehung (base_sky_id) — unberuehrt (D7)',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders where base_sky_id is not null), null),
  (153, 'Abdruecke', 'die Familienzuordnung (character_id) — ebenso',
      (select coalesce(md5(string_agg(sky_id || '|' || character_id::text, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders where character_id is not null), null),
  (154, 'Abdruecke', 'admin_merge_plan — 0163 ersetzt ihn, der Riegel nennt '
                     'diesen Wert',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)')),
      'ef512e9ea093ae36926d3f0333bd0622'),
  (155, 'Abdruecke', 'admin_merge_draft — ebenso',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)')),
      '0b724dff0bb0fe535e3e5b9ec3573298'),
  (156, 'Abdruecke', 'der Exportrumpf (0160) — 0164 ersetzt ihn, NICHT diese',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      'ff4f38e61cbd4e5857ea914d6be68d44'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0163 ruehrt das nicht an)',
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
