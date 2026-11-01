-- ===========================================================================
-- OVP-ENTFERNUNG — DIE NACHKONTROLLE, REIN LESEND (Staging UND Production)
--
-- NACH `staging-ovp-removal.sql` bzw. `prod-ovp-removal.sql`. Eine Anweisung,
-- kein `begin`, kein `set_config`. Im SQL-Editor als `postgres` sind alle
-- Zeilen messbar (9998 = 0); mit dem lesenden Pruefzugang bleiben die Zeilen
-- offen, deren Objekt er nicht lesen darf.
-- **Erwartet: Zeile 9999 = `0`.**
--
--   101-108  die 30 sind fort, die 30 Grabsteine und Journalzeilen stehen,
--            der Anlage-Riegel ist aktiv, die 16 regulaeren Figuren stehen.
--   201      der SKY-ID-Zaehler — als Auskunft. Erwartet auf Staging
--            `929|true`; auf Production der Wert aus dem dortigen Preflight.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Katalog', 'keines der 30 OVP-Duplikate steht noch im Katalog',
      (select count(*)::text from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (102, 'Grabstein', 'jedes der 30 hat einen Grabstein',
      case when has_table_privilege('public.catalog_removed_sky_ids', 'select')
           then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.catalog_removed_sky_ids where sky_id in (''SKY-0012'', ''SKY-0013'', ''SKY-0018'', ''SKY-0019'', ''SKY-0023'', ''SKY-0024'', ''SKY-0031'', ''SKY-0032'', ''SKY-0036'', ''SKY-0037'', ''SKY-0041'', ''SKY-0042'', ''SKY-0050'', ''SKY-0051'', ''SKY-0057'', ''SKY-0058'', ''SKY-0061'', ''SKY-0062'', ''SKY-0067'', ''SKY-0068'', ''SKY-0072'', ''SKY-0073'', ''SKY-0076'', ''SKY-0077'', ''SKY-0084'', ''SKY-0085'', ''SKY-0090'', ''SKY-0091'', ''SKY-0564'', ''SKY-0591'')', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '30'),
  (103, 'Grabstein', 'und es gibt keinen weiteren',
      case when has_table_privilege('public.catalog_removed_sky_ids', 'select')
           then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.catalog_removed_sky_ids', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '30'),
  (104, 'Grabstein', 'der Anlage-Riegel ist aktiv',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_refuse_removed_trg' and t.tgenabled = 'O'), '1'),
  (105, 'Journal', 'je eine Journalzeile deleted fuer die 30',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
           then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.catalog_admin_changes where field = ''deleted'' and entity_id in (''SKY-0012'', ''SKY-0013'', ''SKY-0018'', ''SKY-0019'', ''SKY-0023'', ''SKY-0024'', ''SKY-0031'', ''SKY-0032'', ''SKY-0036'', ''SKY-0037'', ''SKY-0041'', ''SKY-0042'', ''SKY-0050'', ''SKY-0051'', ''SKY-0057'', ''SKY-0058'', ''SKY-0061'', ''SKY-0062'', ''SKY-0067'', ''SKY-0068'', ''SKY-0072'', ''SKY-0073'', ''SKY-0076'', ''SKY-0077'', ''SKY-0084'', ''SKY-0085'', ''SKY-0090'', ''SKY-0091'', ''SKY-0564'', ''SKY-0591'')', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '30'),
  (106, 'Regulaer', 'die 16 regulaeren Figuren stehen, oeffentlich',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0011', 'SKY-0017', 'SKY-0022', 'SKY-0030', 'SKY-0035', 'SKY-0040', 'SKY-0049', 'SKY-0056', 'SKY-0060', 'SKY-0066', 'SKY-0071', 'SKY-0075', 'SKY-0083', 'SKY-0089', 'SKY-0563', 'SKY-0590') and catalog_status = 'public' and catalog_visible), '16'),
  (107, 'Verweise', 'kein Importprotokoll mehr an den 30',
      case when has_table_privilege('public.inventory_import_rows', 'select')
           then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.inventory_import_rows where sky_id in (''SKY-0012'', ''SKY-0013'', ''SKY-0018'', ''SKY-0019'', ''SKY-0023'', ''SKY-0024'', ''SKY-0031'', ''SKY-0032'', ''SKY-0036'', ''SKY-0037'', ''SKY-0041'', ''SKY-0042'', ''SKY-0050'', ''SKY-0051'', ''SKY-0057'', ''SKY-0058'', ''SKY-0061'', ''SKY-0062'', ''SKY-0067'', ''SKY-0068'', ''SKY-0072'', ''SKY-0073'', ''SKY-0076'', ''SKY-0077'', ''SKY-0084'', ''SKY-0085'', ''SKY-0090'', ''SKY-0091'', ''SKY-0564'', ''SKY-0591'')', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),
  (108, 'Verweise', 'keine Lagerposition mehr an den 30',
      (select count(*)::text from public.shop_inventory where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '0'),
  (201, 'Sequenz', 'Auskunft: sky_id_seq (last_value|is_called)',
      case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select last_value::text || ''|'' || is_called::text as c from public.sky_id_seq',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null)
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
