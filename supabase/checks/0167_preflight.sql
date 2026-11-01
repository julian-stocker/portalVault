-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0167, REIN LESEND
--
-- VOR `0167_ovp_removal.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS 0167 TUT. Sie legt den Grabstein `catalog_removed_sky_ids`, den
-- Anlage-Riegel `skylanders_refuse_removed_trg` und die Funktion
-- `system_remove_ovp_figure(text)` an. Sie ENTFERNT NICHTS — das ist ein
-- eigener Betriebsvorgang (`supabase/operations/staging-ovp-removal.sql`).
--
--   101-104  DIE GRUNDLAGE: die Tabellen, die die Funktion liest, und der
--            Journalwert `deleted` (0162).
--   111-113  SIE STEHT NOCH NICHT, und die 30 stehen noch im Katalog.
--   131-135  WAS SICH NICHT BEWEGEN DARF.
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
  (101, 'Grundlage', 'inventory_import_rows steht (0048)',
      (to_regclass('public.inventory_import_rows') is not null)::text, 'true'),
  (102, 'Grundlage', 'order_lines steht (0010)',
      (to_regclass('public.order_lines') is not null)::text, 'true'),
  (103, 'Grundlage', 'das Journal kennt den Feldwert deleted (0162)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%''deleted''%'), '1'),
  (104, 'Grundlage', 'shop_inventory steht (0003)',
      (to_regclass('public.shop_inventory') is not null)::text, 'true'),

  -- ------------------------------------------------- Sie steht noch nicht
  (111, 'Luecke', 'catalog_removed_sky_ids steht NOCH NICHT',
      (to_regclass('public.catalog_removed_sky_ids') is null)::text, 'true'),
  (112, 'Luecke', 'system_remove_ovp_figure steht NOCH NICHT',
      (to_regprocedure('public.system_remove_ovp_figure(text)') is null)::text, 'true'),
  (113, 'Luecke', 'Auskunft: von den 30 OVP-Duplikaten stehen im Katalog',
      (select count(*)::text from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), null),

  -- --------------------------------- Was sich durch 0167 NICHT bewegen darf
  (131, 'Unveraendert', 'Katalogzeilen — die Nachkontrolle nennt sie wieder',
      (select count(*)::text from public.skylanders), null),
  (133, 'Unveraendert', 'hoechste regulaere SKY-ID in der Tabelle',
      (select coalesce(max(sky_id), '(leer)') from public.skylanders
        where sky_id ~ '^SKY-[0-8][0-9]{3}$'), null),
  /*
   * ZEILE 134 — DER SEQUENZSTAND. `0167` fasst `sky_id_seq` nicht an; ihre
   * eigene Nachbedingung misst das am Funktionsrumpf. Diese Zeile misst es
   * an der Sequenz. `is_called` gehoert dazu: ohne sie liesse sich der
   * naechste Wert nicht vergleichen.
   */
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
   * Hier gilt die zweite Moeglichkeit, und sie kostet nichts: `0167` enthaelt
   * keine einzige Datenanweisung. Dass die Journalzeilen unveraendert
   * bleiben, steht deshalb nicht in dieser Datei, sondern an zwei besseren
   * Stellen — in der NOTICE von `staging-0167.sql` (Waechter A3, laeuft als
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
  (134, 'Unveraendert', 'Sequenzstand sky_id_seq (last_value|is_called)',
      case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select last_value::text || ''|'' || is_called::text as c '
                  'from public.sky_id_seq', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (135, 'Unveraendert', 'Abdruck des freigegebenen Katalogs (Bereich 1 aus S3)',
      (select coalesce(md5(string_agg(x.z, chr(10) order by x.z)), '(leer)') from (
         select s.sky_id || '|' || s.name || '|' || s.slug || '|' || s.catalog_status
                || '|' || s.source as z
           from public.skylanders s
          where s.series_code not in ('TEST', 'SMOK')
            and s.sky_id < 'SKY-9000' and s.catalog_status <> 'draft') x), null),
  /*
   * ZEILE 141 IST DAS GEGENSTUECK ZU POSTFLIGHT 243 und entstand aus einem
   * Fehler: die erste Fassung der Nachkontrolle behauptete, `service_role`
   * habe auf diesen Tabellen KEIN TRUNCATE/REFERENCES/TRIGGER — und sie hat
   * es, auf 68 von 69 Tabellen des Schemas, als Supabase-Projektvorgabe.
   * Eine Nachkontrolle kann „nichts hat sich geaendert" nur sagen, wenn der
   * Preflight denselben Wert gemessen hat. Deshalb steht er hier, als
   * AUSKUNFT und ohne Erwartung.
   */
  (141, 'Unveraendert', 'Auskunft: Tabellenrechte von service_role auf skylanders '
                        'und catalog_admin_changes',
      (select count(*)::text from pg_class cl, aclexplode(cl.relacl) a
        where cl.oid in (to_regclass('public.skylanders'),
                         to_regclass('public.catalog_admin_changes'))
          and a.grantee::regrole::text = 'service_role'), null),
  (142, 'Unveraendert', 'anon und authenticated haben auf catalog_admin_changes '
                        'KEIN Recht',
      (select count(*)::text from pg_class cl, aclexplode(cl.relacl) a
        where cl.oid = to_regclass('public.catalog_admin_changes')
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0164 ruehrt das nicht an)',
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
