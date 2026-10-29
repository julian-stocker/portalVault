-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0160, REIN LESEND
--
-- VOR `0160_platform_export_base_sky_id.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0160 TUT UND WARUM DAS JETZT DRINGT. Sie fuegt dem Rumpf von
-- `system_platform_export()` EINE Zeile hinzu: `base_sky_id`. Ohne sie
-- fuehrt das JSON-Archiv `character_id` — also die FAMILIE einer Figur —,
-- aber nicht die MITTE: nach einer Wiederherstellung kaeme jede Variante als
-- eigenstaendige Figur zurueck. Seit `0159` kann diese Beziehung gesetzt
-- werden; Zeile 131 sagt, wie viele Zeilen sie heute tragen.
--
--   101-107  DIE GRUNDLAGE: die Funktion, die Spalte aus `0159` und die
--            Riegel, die an ihr haengen. Der zusammengesetzte
--            Fremdschluessel ist der Grund, warum eine Wiederherstellung
--            eine REIHENFOLGE hat (`supabase/checks/0160_restore_order.md`).
--   111-118  DER ABDRUCK, und das ist der Kern. `0160` ist aus dem Rumpf von
--            `0153` GERECHNET und ersetzt nur genau diesen. Steht hier etwas
--            anderes, bricht sie ab, statt eine fremde Fassung blind zu
--            ueberschreiben — Zeile 112 ist der Nachweis, dass sie es hier
--            nicht tut.
--   121-128  DIE ATTRIBUTE UND RECHTE, die unveraendert bleiben muessen.
--            Eine Sicherungsfunktion, die nach einer Migration `volatile`
--            oder weltausfuehrbar waere, haette eine Luecke, die erst
--            auffaellt, wenn man sie braucht.
--   131-138  DER BESTAND, den `0160` nicht anfasst — und die Zahlen, an
--            denen sich ablesen laesst, WIE VIEL auf dem Spiel steht: die
--            Varianten, die ohne diese Migration ihre Basisfigur verlieren.
--            Zeile 137 ist der Abdruck der Beziehung selbst; die
--            Nachkontrolle nennt ihn wieder.
--
-- SIE RUFT DEN EXPORT NICHT AUF. `system_platform_export()` liefert
-- Kaeuferdaten, Bestellungen und Lagerzahlen; ein Protokoll ist der falsche
-- Ort dafuer. Geprueft wird der RUMPF, nicht sein Ergebnis — und das
-- Ergebnis prueft Probelauf **P69** an erfundenen Zeilen, einschliesslich
-- des vollstaendigen Umlaufs mit einer Basisfigur und drei Varianten.
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
  (101, 'Grundlage', 'system_platform_export() steht (0105), genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'system_platform_export'), '1'),
  (102, 'Grundlage', 'skylanders.base_sky_id steht (0159) — ohne sie laeuft 0160 nicht',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'base_sky_id' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'is_platform_admin() steht (0026) — der Waechter im Rumpf',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  /*
   * ZEILE 104 IST MEHR ALS EINE GRUNDLAGE: dieser Fremdschluessel zeigt auf
   * DIESELBE Tabelle. Das ist der Grund, warum eine Wiederherstellung des
   * Katalogs eine Reihenfolge hat — ein zeilenweises Einspielen, bei dem
   * eine Variante vor ihrer Basisfigur kommt, scheitert mit `23503`.
   * Gemessen und aufgeschrieben in `supabase/checks/0160_restore_order.md`.
   */
  (104, 'Grundlage', 'der Serienriegel ist ein zusammengesetzter Fremdschluessel auf '
                     'dieselbe Tabelle, mit RESTRICT in beide Richtungen',
      (select coalesce(max((c.contype = 'f' and c.confrelid = c.conrelid
                        and array_length(c.conkey, 1) = 2
                        and c.confupdtype = 'r' and c.confdeltype = 'r')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_base_same_series'), 'true'),
  (105, 'Grundlage', 'der Kettenschutz-Trigger aus 0159 steht',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_variant_base_guard_trg'
          and not t.tgisinternal), '1'),
  (106, 'Grundlage', 'seller_business_backup() steht und wird NICHT angefasst',
      (to_regprocedure('public.seller_business_backup()') is not null)::text, 'true'),
  (107, 'Grundlage', 'purchase_calculations steht (0142) — der Bereich aus 0144',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),

  -- ------------------------------------------- Der Abdruck (der Kern)
  /*
   * ZEILE 112 IST DIE EIGENTLICHE VORBEDINGUNG. `0160` ist aus dem Rumpf von
   * `0153` gerechnet; der neue Rumpf MINUS die eine Zeile IST der alte, und
   * `src/lib/backup/platform-export-0160.test.ts` rechnet das bei jedem
   * Testlauf nach. Steht hier ein anderer Abdruck, ist die Rechnung
   * gegenstandslos.
   */
  (111, 'Abdruck', 'Info: der heutige Abdruck des Rumpfes',
      (select coalesce(max(md5(p.prosrc)), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), null),
  (112, 'Abdruck', 'er IST der aus 0153 (92c48444f99b9e294f9703d0c0ddeaa8)',
      (select coalesce(max(md5(p.prosrc)), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '92c48444f99b9e294f9703d0c0ddeaa8'),
  (113, 'Abdruck', 'also NICHT der aus 0105 (dann waere 0144 nicht angewendet)',
      (select coalesce(max((md5(p.prosrc) <> '2e2da90e976a1e73ca00aba7cd830fae')::text),
                       '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (114, 'Abdruck', 'und NICHT der aus 0144 (dann waere 0153 nicht angewendet)',
      (select coalesce(max((md5(p.prosrc) <> '4c4d2e7c81e4efa8e18cdffa06bba40a')::text),
                       '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (115, 'Abdruck', 'und NICHT schon der neue aus 0160',
      (select coalesce(max((md5(p.prosrc) <> 'ff4f38e61cbd4e5857ea914d6be68d44')::text),
                       '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (116, 'Abdruck', 'der Rumpf nennt base_sky_id NOCH NICHT (der Anlass)',
      (select coalesce(max((p.prosrc not like '%base_sky_id%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (117, 'Abdruck', 'er nennt catalog_status schon (0153 ist hier angewendet)',
      (select coalesce(max((p.prosrc like '%''catalog_status'', t.catalog_status,%')::text),
                       '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (118, 'Abdruck', 'die Formatversion ist 2 und bleibt es (kein Bereich kommt dazu)',
      (select coalesce(max((p.prosrc like '%''format_version'', 2%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),

  -- ------------------------------------------- Attribute und Rechte
  (121, 'Attribute', 'security definer',
      (select coalesce(max(p.prosecdef::text), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (122, 'Attribute', 'stable (s), nicht volatile',
      (select coalesce(max(p.provolatile::text), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (123, 'Attribute', 'genau EINE search_path-Festlegung',
      (select coalesce(max((select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                             where c like 'search\_path=%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '1'),
  (124, 'Attribute', 'und ihr Wert ist LEER (ausgepackt, nicht verglichen)',
      (select coalesce(max((select substring(c from 'search\_path=(.*)$')
                              from unnest(coalesce(p.proconfig, '{}')) c
                             where c like 'search\_path=%')), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), '""'),
  (125, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.system_platform_export()')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (126, 'Rechte', 'authenticated darf ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.system_platform_export()')
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),
  (127, 'Rechte', 'Info: die ACL im Volltext',
      (select coalesce(max(array_to_string(p.proacl, ' | ')), '(keine)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), null),
  (128, 'Rechte', 'seller_business_backup() fuehrt base_sky_id NICHT (dauerhafter Ausschluss)',
      (select coalesce(max((p.prosrc not like '%base_sky_id%')::text), '(fehlt)')
         from pg_proc p
        where p.oid = to_regprocedure('public.seller_business_backup()')), 'true'),

  -- ------------------------------------- Wie viel auf dem Spiel steht
  /*
   * DIE ZAHL, DIE DIESE MIGRATION BEGRUENDET. Jede dieser Varianten kaeme
   * ohne `0160` nach einer Wiederherstellung aus dem JSON-Archiv ohne ihre
   * Basisfigur zurueck — als eigenstaendige Figur, die Familie noch da, die
   * Mitte fort.
   *
   * ZEILE 137 IST DER ABDRUCK DER BEZIEHUNG SELBST. Die Nachkontrolle nennt
   * ihn wieder; stimmen beide, hat die Migration keine Zuordnung angefasst —
   * und das ist mehr als eine Zaehlung, denn ein Tausch zweier Zuordnungen
   * liesse die Zahl gleich.
   */
  (131, 'Einsatz', 'Varianten, die ohne 0160 ihre Basisfigur verlieren wuerden',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (132, 'Einsatz', 'verschiedene Basisfiguren, auf die sie zeigen',
      (select count(distinct base_sky_id)::text from public.skylanders
        where base_sky_id is not null), null),
  (133, 'Einsatz', 'Ketten (eine Variante als Basisfigur) — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.base_sky_id is not null), '0'),
  (134, 'Einsatz', 'Zuordnungen ueber Seriengrenzen — muss 0 sein',
      (select count(*)::text from public.skylanders v
        join public.skylanders b on b.sky_id = v.base_sky_id
       where v.base_sky_id is not null and b.series_code <> v.series_code), '0'),
  (135, 'Einsatz', 'Selbstbezuege — muss 0 sein',
      (select count(*)::text from public.skylanders
        where base_sky_id = sky_id), '0'),
  (136, 'Einsatz', 'verwaiste Verweise (Basisfigur fehlt) — muss 0 sein',
      (select count(*)::text from public.skylanders v
        where v.base_sky_id is not null
          and not exists (select 1 from public.skylanders b where b.sky_id = v.base_sky_id)), '0'),
  (137, 'Einsatz', 'Abdruck der Variantenbeziehung — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n' order by sky_id)),
                       '(leer)')
         from public.skylanders where base_sky_id is not null), null),
  (138, 'Einsatz', 'Info: Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders), null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0160 ruehrt das nicht an)',
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
