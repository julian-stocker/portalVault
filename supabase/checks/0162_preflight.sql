-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0162, REIN LESEND
--
-- VOR `0162_admin_price_and_delete.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0162 TUT. Zwei Funktionen und zwei Journalwerte.
-- `admin_set_market_price(text, numeric)` schreibt EINE Spalte;
-- `admin_delete_figure(text)` loescht EINE Zeile, wenn nichts auf sie zeigt.
--
--   101-109  DIE GRUNDLAGE: `admin_merge_references` (0154), aus der die
--            Loeschung ihre Verweise herleitet; `is_platform_admin` (0026);
--            `order_lines` (0010) fuer den STILLEN Verweis; die
--            Preis-Constraint aus `0001`, die `null or > 0` sagt; und die
--            Audit-Constraint mit ihren zwoelf Werten.
--   111-114  DIE ABDRUECKE der zwei Funktionen, die `0162` AUFRUFT bzw.
--            deren Bauform sie kopiert. Sie ersetzt keine von ihnen; die
--            Nachkontrolle nennt dieselben Zahlen wieder.
--   121-123  DIE NEUEN FUNKTIONEN STEHEN NOCH NICHT.
--   131-139  DER EINSATZ, und hier liegt die eigentliche Auskunft:
--
--              131  wie viele Zeilen ueberhaupt KEINEN Preis haben
--              132  der Abdruck ALLER Preise. Die Nachkontrolle nennt ihn
--                   wieder — `0162` darf keinen einzigen anfassen.
--              134  Zeilen, auf die NICHTS zeigt, also wirklich loeschbar
--              135  die vierzehn Fremdschluessel, als Zahl
--              136  die VIER mit `ON DELETE CASCADE` — sie sind der Grund,
--                   warum die Funktion vorher prueft statt zu loeschen
--              137  der STILLE VERWEIS: Bestellzeilen ohne Fremdschluessel
--              138  geteilte Bilddateien. Darum fasst die Loeschung Storage
--                   nicht an.
--              139  der Stand der Sequenz und die Luecken darin — eine
--                   SKY-ID kommt nie zurueck.
--
-- SIE SCHREIBT NICHTS, loescht nichts und ruft keine der Funktionen auf.
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
  (101, 'Grundlage', 'admin_merge_references(text) steht (0154) — die Loeschung '
                     'leitet ihre Verweise daraus her',
      (to_regprocedure('public.admin_merge_references(text)') is not null)::text,
      'true'),
  (102, 'Grundlage', 'is_platform_admin() steht (0026)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (103, 'Grundlage', 'admin_discard_draft(text) steht (0155) — 0162 kopiert ihre '
                     'Bauform und laesst sie unberuehrt',
      (to_regprocedure('public.admin_discard_draft(text)') is not null)::text,
      'true'),
  /*
   * ZEILE 104 IST KEINE FORMALIE. `admin_delete_figure` fragt
   * `order_lines.sky_id` AUSDRUECKLICH, weil dort kein Fremdschluessel steht.
   * Fehlte die Tabelle, waere „referenzfrei" eine halbe Aussage.
   */
  (104, 'Grundlage', 'public.order_lines steht (0010) — der stille Verweis',
      (to_regclass('public.order_lines') is not null)::text, 'true'),
  (105, 'Grundlage', 'order_lines.sky_id traegt WIRKLICH keinen Fremdschluessel '
                     '(darum fragt die Funktion sie einzeln)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.order_lines') and c.contype = 'f'
          and c.confrelid = to_regclass('public.skylanders')), '0'),
  /*
   * ZEILE 106: die Preisregel steht in der Datenbank, nicht nur in der
   * Funktion. `null or > 0` heisst: „Preis offen" ist NULL, und 0 ist kein
   * Preis (ADR-0010). Die Funktion weist die 0 mit einem SATZ ab — aber
   * fiele dieser Satz je weg, faenge die Constraint es trotzdem.
   */
  (106, 'Grundlage', 'skylanders_market_price_positive sagt „null oder > 0"',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%> (0)%'
                         or pg_get_constraintdef(c.oid) like '%> 0%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_market_price_positive'), 'true'),
  (107, 'Grundlage', 'skylanders.price_updated_at steht — das Datum folgt dem Preis',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'price_updated_at' and not a.attisdropped), '1'),
  (108, 'Grundlage', 'das Journal kennt heute base_sky_id (0159) …',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%base_sky_id%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  /*
   * ZEILE 109 IST DIE EIGENTLICHE ZUSAGE DER LOESCHUNG: das Journal haengt
   * NICHT an `skylanders`. Gaebe es diesen Fremdschluessel, wuerde der
   * Auditsatz die referenzfreie Loeschung selbst blockieren — genau der
   * Widerspruch, den Anforderung 16 ausschliesst.
   */
  (109, 'Grundlage', 'und es haengt NICHT an skylanders (sonst blockierte der '
                     'Auditsatz die Loeschung selbst)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.contype = 'f'
          and c.confrelid = to_regclass('public.skylanders')), '0'),

  -- ------------------------------- Die Abdruecke der zwei, die bleiben
  (111, 'Abdruecke', 'admin_merge_references — die Nachkontrolle nennt ihn wieder',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_references(text)')), null),
  (112, 'Abdruecke', 'admin_discard_draft',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_discard_draft(text)')), null),
  (113, 'Abdruecke', 'admin_set_catalog_status',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')),
      'e3c76fa571341e737c41fc2c3d6cdb8e'),
  (114, 'Abdruecke', 'admin_publish_variant_auto (0161)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'adf679deb5d42fad5dff15bd1641f318'),

  -- ------------------------------------ Die neuen Funktionen stehen noch nicht
  (121, 'Neu', 'admin_set_market_price(text,numeric) steht NOCH NICHT',
      (to_regprocedure('public.admin_set_market_price(text,numeric)') is null)::text,
      'true'),
  (122, 'Neu', 'admin_delete_figure(text) steht NOCH NICHT',
      (to_regprocedure('public.admin_delete_figure(text)') is null)::text, 'true'),
  (123, 'Neu', 'und es gibt keine andere Funktion dieser beiden Namen',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_set_market_price', 'admin_delete_figure')), '0'),
  (124, 'Neu', 'das Journal kennt market_price und deleted NOCH NICHT',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%market_price%'
                         or pg_get_constraintdef(c.oid) like '%''deleted''%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'false'),

  -- ----------------------------------------------------------- Der Einsatz
  (131, 'Einsatz', 'Zeilen ohne Marktwert („Preis offen")',
      (select count(*)::text from public.skylanders where market_price is null), null),
  (132, 'Einsatz', 'DER PREIS-ABDRUCK — 0162 darf keinen einzigen Preis anfassen',
      (select coalesce(md5(string_agg(s.sky_id || '|'
                                      || coalesce(s.market_price::text, '-') || '|'
                                      || coalesce(s.price_updated_at::text, '-'),
                                      E'\n' order by s.sky_id)), '(leer)')
         from public.skylanders s), null),
  /*
   * DAS JOURNAL LIEST DER PRUEFZUGANG NICHT (ADR-0141), und `0160` hat das
   * auf die harte Art gelernt: dort brach die ganze Datei an einem
   * `permission denied` ab. `has_table_privilege` entscheidet vorher, und
   * `KEIN-RECHT` zaehlt in Zeile 9998 statt in 9999.
   */
  (133, 'Einsatz', 'Journalzeilen insgesamt — 0162 schreibt keine',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  /*
   * ZEILE 134 IST DIE ZAHL, DIE DEN BEDIENER INTERESSIERT: wie viele Zeilen
   * sind ueberhaupt loeschbar. Gerechnet wird sie hier NUR fuer die drei
   * haeufigsten Verweise — die vollstaendige Antwort gibt
   * `admin_merge_references` je Zeile, und das waere ein Lauf ueber 870
   * Zeilen. Als Groessenordnung genuegt das.
   */
  (134, 'Einsatz', 'Entwuerfe ohne Sammlung, Favorit und Lagerzeile '
                   '(Groessenordnung der loeschbaren Zeilen)',
      case when has_table_privilege('public.favorites', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.skylanders s
                     where s.catalog_status = 'draft'
                       and not exists (select 1 from public.collection_items x
                                        where x.sky_id = s.sky_id)
                       and not exists (select 1 from public.favorites x
                                        where x.sky_id = s.sky_id)
                       and not exists (select 1 from public.shop_inventory x
                                        where x.sky_id = s.sky_id)$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  (135, 'Einsatz', 'Fremdschluessel auf skylanders.sky_id (die Loeschung zaehlt '
                   'jeden davon)',
      (select count(*)::text from pg_constraint c
        where c.contype = 'f' and c.confrelid = to_regclass('public.skylanders')),
      null),
  /*
   * ZEILE 136 IST DER GRUND FUER DIE GANZE FUNKTION. Vier Schluessel stehen
   * auf `ON DELETE CASCADE`. Ein blankes `delete from skylanders` wuerde
   * einen Warenkorb, eine Importzuordnung und eine Orderbuchzuordnung
   * STILLSCHWEIGEND mitnehmen. Deshalb prueft die Funktion vorher und nennt
   * diese Tabellen namentlich.
   */
  (136, 'Einsatz', 'davon mit ON DELETE CASCADE — sie waeren stillschweigend '
                   'mitgegangen',
      (select coalesce(string_agg(c.conrelid::regclass::text, ', '
                                  order by c.conrelid::regclass::text), '(keine)')
         from pg_constraint c
        where c.contype = 'f' and c.confrelid = to_regclass('public.skylanders')
          and c.confdeltype = 'c'), null),
  (137, 'Einsatz', 'DER STILLE VERWEIS: Bestellzeilen, deren SKY-ID kein '
                   'Fremdschluessel schuetzt',
      case when has_table_privilege('public.order_lines', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.order_lines$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  /*
   * ZEILE 138: GETEILTE BILDER. Darum fasst die Loeschung Supabase Storage
   * nicht an. Loeschte sie die Datei mit, naehme sie einer anderen Figur das
   * Bild — eine verwaiste Datei ist der harmlose Fehler.
   */
  (138, 'Einsatz', 'Bilddateien, die von mehr als einer Zeile benutzt werden',
      (select count(*)::text from (
         select s.image_file from public.skylanders s
          where s.image_file is not null
          group by s.image_file having count(*) > 1) x), null),
  (139, 'Einsatz', 'Stand der SKY-ID-Sequenz und Luecken im Nummernband '
                   '(eine Nummer kommt nie zurueck)',
      case when has_sequence_privilege('public.sky_id_seq', 'select')
           then (select coalesce((xpath('/row/c/text()', query_to_xml(
                  'select last_value::text as c from public.sky_id_seq',
                  false, true, '')))[1]::text, '?'))
                || ' / ' || (select (max(right(sky_id, 4)::int)
                                     - count(*))::text
                               from public.skylanders where sky_id ~ '^SKY-[0-9]{4}$')
           else 'KEIN-RECHT' end, null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0162 ruehrt das nicht an)',
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
