-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZU 0167, REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer die
-- Nachkontrolle `prod_0167_postflight.sql` — vollstaendig kopieren.
--
--   101-105  DIE UMGEBUNG, POSITIV UND AM SCHEMA (wortgleich `prod_0165_preflight.sql`).
--   111-116  0167 liegt NICHT; was sie braucht, liegt; die 30 und die 16
--            regulaeren Figuren stehen.
--   121-129  KEIN VERWEIS AUF DIE 30 — die Zahlen, die die Entfernung spaeter
--            braucht (am 2026-11-01 ueber den Service-Schluessel gemessen: 0).
--   131      die Sequenz, als Auskunft.
-- ===========================================================================

with
seq as (
  select min_value, max_value, cycle from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
mess as (
  select
    (select count(*)::text from public.skylanders)                 as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)      as journalzeilen,
    (select count(*)::text from public.shop_inventory)             as lagerzeilen,
    (select count(*)::text from public.collection_items)           as sammlungszeilen,
    (select count(*)::text from public.favorites)                  as favoriten,
    (select count(*)::text from public.cart_items)                 as warenkoerbe,
    (select count(*)::text from public.order_lines)                as bestellpositionen,
    (select count(*)::text from public.inventory_import_rows)      as importprotokolle,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                   as katalogabdruck
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || sammlungszeilen || '|' || favoriten || '|' || warenkoerbe || '|'
      || bestellpositionen || '|' || importprotokolle || '|' || katalogabdruck as kern, m.* from mess m
),
heute as (
  select 'skyisles-p0167-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Umgebung', 'purchases_paid_total_is_final() liegt — 0133, und 0133 liegt '
                    'NUR auf Production',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', 'und ihr Trigger purchases_paid_total_immutable_trg auch — '
                    'zwei Objekte, damit ein halber Stand auffaellt',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band 928..4999',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),
  (104, 'Umgebung', 'sondern den unbegrenzten Stand ODER das Production-Band 5001..8999',
      (select (count(*) = 1)::text from seq
        where (min_value = 1 and max_value = 9223372036854775807)
           or (min_value = 5001 and max_value = 8999)),
      'true'),
  (105, 'Umgebung', 'der Katalog traegt Zeilen (mindestens 100)',
      (select (count(*) >= 100)::text from public.skylanders), 'true'),

  (111, '0167', 'catalog_removed_sky_ids liegt NICHT',
      (to_regclass('public.catalog_removed_sky_ids') is null)::text, 'true'),
  (112, '0167', 'system_remove_ovp_figure liegt NICHT',
      (to_regprocedure('public.system_remove_ovp_figure(text)') is null)::text, 'true'),
  (113, 'Vorbedingung', 'die Journal-Constraint laesst den Feldwert deleted zu (0162)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%''deleted''%'), '1'),
  (114, 'Vorbedingung', 'inventory_import_rows, order_lines, shop_inventory liegen',
      ((to_regclass('public.inventory_import_rows') is not null)
       and (to_regclass('public.order_lines') is not null)
       and (to_regclass('public.shop_inventory') is not null))::text, 'true'),
  (115, 'Bestand', 'die 30 OVP-Duplikate stehen im Katalog',
      (select count(*)::text from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '30'),
  (116, 'Bestand', 'die 16 regulaeren Figuren stehen, oeffentlich',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0011', 'SKY-0017', 'SKY-0022', 'SKY-0030', 'SKY-0035', 'SKY-0040', 'SKY-0049', 'SKY-0056', 'SKY-0060', 'SKY-0066', 'SKY-0071', 'SKY-0075', 'SKY-0083', 'SKY-0089', 'SKY-0563', 'SKY-0590') and catalog_status = 'public'), '16'),

  (121, 'Verweise', 'Sammlungen auf die 30',
      (select count(*)::text from public.collection_items where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (122, 'Verweise', 'Favoriten auf die 30',
      (select count(*)::text from public.favorites where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (123, 'Verweise', 'Warenkoerbe auf die 30',
      (select count(*)::text from public.cart_items where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (124, 'Verweise', 'Bestellzeilen auf die 30',
      (select count(*)::text from public.order_lines where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (125, 'Verweise', 'Einkauf und Verkauf auf die 30',
      ((select count(*) from public.purchase_items where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591'))
       + (select count(*) from public.sale_items where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')))::text, '0'),
  (126, 'Verweise', 'Lagerpositionen der 30',
      (select count(*)::text from public.shop_inventory where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (127, 'Verweise', 'Importprotokolle der 30',
      (select count(*)::text from public.inventory_import_rows where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (128, 'Verweise', 'Varianten auf die 30',
      (select count(*)::text from public.skylanders where base_sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),

  (131, 'Sequenz', 'Stand sky_id_seq (Auskunft)',
      case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select last_value::text || ''|'' || is_called::text as c from public.sky_id_seq',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  (900, 'BASIS', 'Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from heute), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
