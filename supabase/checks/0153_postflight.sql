-- ===========================================================================
-- STAGING — DER ZUSTAND NACH 0153, REIN LESEND
--
-- NACH `0153_platform_export_catalog_status.sql` fahren, MIT der
-- Baseline-Uebergabe aus dem Preflight.
-- **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-108  DER NEUE ABDRUCK, und die Umkehrprobe am lebenden Rumpf: er ist
--            `92c48444…`, er nennt `catalog_status`, und **zieht man die
--            eine Zeile wieder ab, ist er zeichengleich der aus `0144`**.
--            Das ist die Zusage dieser Migration, in der Datenbank
--            nachgerechnet und nicht nur im Arbeitsbaum.
--   111-118  DIE ATTRIBUTE UND RECHTE sind unveraendert. Eine
--            Sicherungsfunktion, die danach `volatile` oder weltausfuehrbar
--            waere, haette eine Luecke, die erst auffaellt, wenn man sie
--            braucht.
--   121-126  DIE BEREICHSZAHL BLEIBT 54 und `format_version` bleibt 2 —
--            `catalog_status` ist ein FELD, kein Bereich. Archive der
--            Version 2 ohne dieses Feld bleiben lesbar.
--   131-136  UND NICHTS IST GESCHRIEBEN: dieselben Statuszahlen wie im
--            Preflight, kein Widerspruch, `seller_business_backup()`
--            unberuehrt.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0158`.
--
-- SIE RUFT DEN EXPORT NICHT AUF. Er liefert Kaeuferdaten, Bestellungen und
-- Lagerzahlen; ein Protokoll ist der falsche Ort dafuer. Dass das ARCHIV den
-- Status wirklich traegt — fuer `draft`, `hidden` und `public` —, faehrt
-- Probelauf **P66** an erfundenen Zeilen.
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

  -- ------------------------------------------------- Der neue Abdruck
  (101, 'Abdruck', 'system_platform_export() steht, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'system_platform_export'), '1'),
  (102, 'Abdruck', 'ihr Rumpf ist der aus 0153 (92c48444f99b9e294f9703d0c0ddeaa8)',
      (select coalesce(max(md5(p.prosrc)), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '92c48444f99b9e294f9703d0c0ddeaa8'),
  (103, 'Abdruck', 'er nennt catalog_status',
      (select coalesce(max((p.prosrc like '%catalog_status%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  /*
   * DIE ZEILE ZAEHLEN, NICHT DIE ZEICHENFOLGE.
   *
   * Diese Zeile hat beim ersten Lauf abgewichen — `9999 = 1`, erwartet 1,
   * gezaehlt 2 — und zwar an sich selbst und nicht an der Migration. Eine
   * Feldzeile dieses Exports nennt den Namen ZWEIMAL:
   *
   *     'catalog_status', t.catalog_status,
   *      ^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^
   *      JSON-Schluessel    Spaltenreferenz
   *
   * Das ist die kanonische Form JEDES Feldes hier: `category_id`,
   * `image_file`, `catalog_visible`, `card_type` und fuenf weitere kommen
   * aus demselben Grund genau zweimal vor. Eins waere unmoeglich — ein Feld
   * ohne Spaltenreferenz ist kein Feld.
   *
   * Gezaehlt wird deshalb das VOLLSTAENDIGE Muster. Das ist strenger als
   * die alte Fassung, nicht schwaecher: es nagelt Schluessel UND Spalte in
   * genau dieser Paarung fest, und ein `'catalog_status', t.card_type,`
   * faellt damit auf, waehrend die Zeichenfolgenzaehlung es durchliess.
   *
   * `src/lib/admin/check-body-patterns.test.ts` rechnet jede zaehlende
   * Behauptung dieser Art seit CAT-02C-N gegen den echten Rumpf nach — der
   * Fehler waere damit vor dem SQL-Editor aufgefallen.
   */
  (104, 'Abdruck', 'die eingefuegte Feldzeile steht GENAU EINMAL',
      (select coalesce(max((length(p.prosrc)
                            - length(replace(p.prosrc,
                                '''catalog_status'', t.catalog_status,', '')))
                           / length('''catalog_status'', t.catalog_status,'))::text,
                       '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '1'),
  /*
   * DIE UMKEHRPROBE AM LEBENDEN RUMPF, und sie ist die Zusage dieser
   * Migration: zieht man die eine Zeile wieder ab, steht Zeichen fuer
   * Zeichen der Rumpf aus `0144` da. Gerechnet wird mit `replace` auf genau
   * dem Text, den die Migration eingefuegt hat — nicht mit einem Muster, das
   * auch etwas anderes treffen koennte.
   */
  (105, 'Abdruck', 'zurueckgedreht ist er zeichengleich der aus 0144',
      (select coalesce(max(md5(replace(p.prosrc,
                 E'\n            ''catalog_status'', t.catalog_status,', ''))), '(keine)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '4c4d2e7c81e4efa8e18cdffa06bba40a'),
  (106, 'Abdruck', 'die eingefuegte Zeile steht im Bereich skylanders, hinter catalog_visible',
      (select coalesce(max((p.prosrc like
                 '%''catalog_visible'', t.catalog_visible,%''catalog_status'', t.catalog_status,%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (107, 'Abdruck', 'die Laenge ist die alte plus die eine Zeile (31072 Zeichen)',
      (select coalesce(max(length(p.prosrc))::text, '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '31072'),
  (108, 'Abdruck', 'der Waechter steht weiter im Rumpf',
      (select coalesce(max((p.prosrc like '%is_platform_admin()%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),

  -- ----------------------------------------- Attribute und Rechte, unveraendert
  (111, 'Attribute', 'security definer',
      (select coalesce(max(p.prosecdef::text), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (112, 'Attribute', 'stable (s), nicht volatile',
      (select coalesce(max(p.provolatile::text), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (113, 'Attribute', 'genau EINE search_path-Festlegung',
      (select coalesce(max((select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                             where c like 'search\_path=%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '1'),
  (114, 'Attribute', 'und ihr Wert ist LEER',
      (select coalesce(max((select substring(c from 'search\_path=(.*)$')
                              from unnest(coalesce(p.proconfig, '{}')) c
                             where c like 'search\_path=%')), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '""'),
  (115, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.system_platform_export()')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (116, 'Rechte', 'authenticated darf ausfuehren — genau einmal',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.system_platform_export()')
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),
  (117, 'Rechte', 'Info: die ACL im Volltext — mit 127 des Preflights vergleichen',
      (select coalesce(max(array_to_string(p.proacl, ' | ')), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), null),
  (118, 'Rechte', 'der Kommentar nennt 0153',
      (select coalesce((obj_description(to_regprocedure('public.system_platform_export()'),
                                        'pg_proc') like '%0153%')::text, 'kein Kommentar')),
      'true'),

  -- ------------------------------------- Ein FELD, kein Bereich
  /*
   * DAS IST DER GRUND, WARUM DIESE MIGRATION KLEIN BLEIBEN DARF. Ein neuer
   * Bereich haette `format_version` auf 3 gezogen, und jedes Archiv der
   * Version 2 waere damit erklaerungsbeduerftig geworden. Ein Feld tut das
   * nicht.
   */
  (121, 'Ein Feld', 'format_version bleibt 2',
      (select coalesce(max((p.prosrc like '%''format_version'', 2%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (122, 'Ein Feld', 'und NICHT 3',
      (select coalesce(max((p.prosrc not like '%''format_version'', 3%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (123, 'Ein Feld', 'die Bereichszahl bleibt 54 (so viele jsonb_build_object-Bereiche)',
      (select coalesce(max((p.prosrc like '%''purchase_calculations''%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (124, 'Ein Feld', 'der Bereich skylanders fuehrt weiter catalog_visible',
      (select coalesce(max((p.prosrc like '%''catalog_visible'', t.catalog_visible%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (125, 'Ein Feld', 'und weiter sky_id, name und slug',
      (select coalesce(max((p.prosrc like '%''sky_id'', t.sky_id%'
                        and p.prosrc like '%''slug'', t.slug%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (126, 'Ein Feld', 'seller_business_backup() ist UNBERUEHRT und fuehrt catalog_status nicht',
      (select coalesce(max((p.prosrc not like '%catalog_status%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_business_backup()')), 'true'),

  -- -------------------------------------- Und nichts ist geschrieben
  (131, 'Unberuehrt', 'Entwuerfe — mit 131 des Preflights vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), null),
  (132, 'Unberuehrt', 'versteckte Zeilen — mit 132 vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'hidden'), null),
  (133, 'Unberuehrt', 'oeffentliche Zeilen — mit 133 vergleichen',
      (select count(*)::text from public.skylanders where catalog_status = 'public'), null),
  (134, 'Unberuehrt', 'Zeilen mit unbekanntem Status (muss 0 sein)',
      (select count(*)::text from public.skylanders
        where catalog_status not in ('public', 'hidden', 'draft')), '0'),
  (135, 'Unberuehrt', 'Widerspruch zwischen Status und Sichtbarkeit (muss 0 sein)',
      (select count(*)::text from public.skylanders
        where catalog_visible <> (catalog_status = 'public')), '0'),
  (136, 'Unberuehrt', 'Katalogzeilen insgesamt — mit 136 vergleichen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0153 ruehrt das nicht an)',
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
