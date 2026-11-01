-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0167, REIN LESEND
--
-- Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als `postgres`, NACH
-- `supabase/operations/prod-0167.sql`. Die Baseline aus Zeile 900 des
-- Preflights in DERSELBEN TRANSAKTION setzen — im SQL-Editor heisst das:
-- `begin;` davor und `rollback;` danach, sonst gilt `set_config` nur fuer
-- seine eigene Anweisung. Fertig gebaut: `supabase/operations/prod-s-postflight-0167.sql`.
--
--     select set_config('skyisles.p0167', 'skyisles-p0167-1|…', true);
--
-- **Erwartet: Zeile 9999 = `0`.** Ohne Baseline schlagen 801-803 an — eine
-- fehlende Baseline faellt durch, statt sich zu enthalten.
--
--   201-206  Grabstein (leer), Anlage-Riegel, Funktion.
--   211-214  nur der Eigentuemer darf die Entfernungsfunktion.
--   801-804  der Bestand ist der aus dem Preflight — 0167 entfernt nichts.
-- ===========================================================================

with
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
basis as (
  select nullif(btrim(coalesce(current_setting('skyisles.p0167', true), '')), '') as roh
),
teil as (
  select roh, case when roh is null then null else string_to_array(roh, '|') end as t from basis
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (201, '0167', 'catalog_removed_sky_ids liegt',
      (to_regclass('public.catalog_removed_sky_ids') is not null)::text, 'true'),
  (202, '0167', 'und ist LEER',
      case when to_regclass('public.catalog_removed_sky_ids') is null then '(fehlt)'
           else (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.catalog_removed_sky_ids', false, true, '')))[1]::text
      end, '0'),
  (203, '0167', 'der Anlage-Riegel steht, BEFORE INSERT, aktiv',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_refuse_removed_trg' and t.tgenabled = 'O'), '1'),
  (204, '0167', 'system_remove_ovp_figure liegt genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'system_remove_ovp_figure'), '1'),
  (205, '0167', 'SECURITY DEFINER',
      coalesce((select p.prosecdef::text from pg_proc p where p.oid = to_regprocedure('public.system_remove_ovp_figure(text)')), '(fehlt)'), 'true'),
  (206, '0167', 'mit LEEREM search_path (Anfuehrungszeichen weggerechnet)',
      coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                  from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                 where p.oid = to_regprocedure('public.system_remove_ovp_figure(text)') and c like 'search\_path=%'), '(leer)'), '(leer)'),
  (211, 'Rechte', 'anon darf sie NICHT',
      coalesce(has_function_privilege('anon', to_regprocedure('public.system_remove_ovp_figure(text)'), 'execute')::text, '(fehlt)'), 'false'),
  (212, 'Rechte', 'authenticated darf sie NICHT',
      coalesce(has_function_privilege('authenticated', to_regprocedure('public.system_remove_ovp_figure(text)'), 'execute')::text, '(fehlt)'), 'false'),
  (213, 'Rechte', 'PUBLIC darf sie NICHT',
      coalesce(has_function_privilege('public', to_regprocedure('public.system_remove_ovp_figure(text)'), 'execute')::text, '(fehlt)'), 'false'),
  (214, 'Rechte', 'service_role darf sie NICHT',
      coalesce(has_function_privilege('service_role', to_regprocedure('public.system_remove_ovp_figure(text)'), 'execute')::text, '(fehlt)'), 'false'),

  (801, 'Basis', 'eine Baseline ist uebergeben worden',
      (select case when roh is null then 'FEHLT' else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-p0167-1 und zehn Felder',
      (select case when t is null then 'keine Baseline'
                   else (t[1] = 'skyisles-p0167-1' and array_length(t, 1) = 11)::text end from teil), 'true'),
  (803, 'Basis', 'die Schutzsumme stimmt',
      (select case when t is null then 'keine Baseline'
                   else (t[11] = left(md5(array_to_string(t[2:10], '|')), 12))::text end from teil), 'true'),
  (804, 'Bestand', 'Katalog, Journal, Lager, Sammlung, Favoriten, Warenkoerbe, Bestellzeilen, '
                   'Importprotokolle und Katalogabdruck wie vor dem Lauf',
      (select kern from feld),
      (select case when t is null then '(keine Baseline)' else array_to_string(t[2:10], '|') end from teil)),
  (805, 'Bestand', 'die 30 stehen noch — 0167 entfernt nichts',
      (select count(*)::text from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')), '30'),
  (809, 'Info', 'der heutige Stand als Baseline-Zeile', (select zeile from heute), null)
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
