-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZU 0166, REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer
-- `prod-s-postflight-0166.sql` — vollstaendig kopieren.
--
--   101-105  DIE UMGEBUNG, positiv und am Schema (wortgleich `prod_0165_preflight.sql`).
--   110      0166 liegt NICHT.
--   111-115  die vier Schreibwege, die 0166 aufruft, und is_platform_admin.
--   121-124  die Spalten, Riegel und Journalwerte, an denen sie haengen.
--   131-133  Rechte: heute darf niemand 0166 (sie liegt nicht); authenticated
--            darf die vier Schreibwege, anon nicht.
--   141-145  Auskunft: Bestand und Nutzerdaten — nur Sammlungen und Favoriten
--            NICHT in der Baseline (laufender Betrieb, 0166 beruehrt sie nicht).
--
-- Die Baseline (900) vergleicht nur, was 0166 beruehren KOENNTE: Katalog,
-- Journal, Lager, Bestellzeilen, und einen Katalogabdruck MIT
-- Variantenbeziehung, Types und Banner.
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
    (select count(*)::text from public.order_lines)                as bestellzeilen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug || '|'
                                    || coalesce(s.base_sky_id, '~') || '|'
                                    || array_to_string(s.types, '+') || '|'
                                    || coalesce(s.visible_type, '~'),
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                   as katalogabdruck,
    (select count(*)::text from public.collection_items)           as sammlungszeilen,
    (select count(*)::text from public.favorites)                  as favoriten
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || bestellzeilen || '|' || katalogabdruck as kern, m.* from mess m
),
heute as (
  select 'skyisles-p0166-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
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

  (110, '0166', 'admin_create_variant_figure liegt NICHT',
      (to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is null)::text, 'true'),
  (111, 'Vorbedingung', 'admin_create_figure liegt (0152)',
      (to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)') is not null)::text, 'true'),
  (112, 'Vorbedingung', 'admin_set_variant_base liegt (0159)',
      (to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null)::text, 'true'),
  (113, 'Vorbedingung', 'admin_set_figure_types liegt (0163)',
      (to_regprocedure('public.admin_set_figure_types(text,text[])') is not null)::text, 'true'),
  (114, 'Vorbedingung', 'admin_set_visible_type liegt (0163)',
      (to_regprocedure('public.admin_set_visible_type(text,text)') is not null)::text, 'true'),
  (115, 'Vorbedingung', 'is_platform_admin liegt (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (121, 'Vorbedingung', 'die fuenf Spalten aus 0152/0159/0163',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped
          and a.attname in ('base_sky_id', 'types', 'visible_type', 'visible_type_decided', 'catalog_status')), '5'),
  (122, 'Vorbedingung', 'der Serienschluessel skylanders_base_same_series (0159)',
      (select count(*)::text from pg_constraint where conname = 'skylanders_base_same_series'), '1'),
  (123, 'Vorbedingung', 'der Kettenriegel skylanders_variant_base_guard_trg (0159)',
      (select count(*)::text from pg_trigger where tgname = 'skylanders_variant_base_guard_trg' and not tgisinternal), '1'),
  (124, 'Vorbedingung', 'das Journal kennt created, base_sky_id, types und visible_type',
      (select (pg_get_constraintdef(c.oid) like '%''created''%'
               and pg_get_constraintdef(c.oid) like '%''base_sky_id''%'
               and pg_get_constraintdef(c.oid) like '%''types''%'
               and pg_get_constraintdef(c.oid) like '%''visible_type''%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (131, 'Rechte', 'authenticated darf admin_create_figure — sonst liefe 0166 ins Leere',
      coalesce(has_function_privilege('authenticated',
        to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)'), 'execute')::text, '(fehlt)'), 'true'),
  (132, 'Rechte', 'anon darf admin_set_variant_base NICHT',
      coalesce(has_function_privilege('anon',
        to_regprocedure('public.admin_set_variant_base(text,text,boolean)'), 'execute')::text, '(fehlt)'), 'false'),
  (133, 'Rechte', 'die Rolle authenticated gibt es',
      (select count(*)::text from pg_roles where rolname = 'authenticated'), '1'),
  (141, 'Auskunft', 'Katalog · Journal · Lager · Bestellzeilen',
      (select katalogzeilen || ' · ' || journalzeilen || ' · ' || lagerzeilen || ' · ' || bestellzeilen from mess), null),
  (142, 'Auskunft', 'Variantenbeziehungen heute',
      (select count(*)::text from public.skylanders where base_sky_id is not null), null),
  (143, 'Auskunft', 'Sammlungen · Favoriten (nicht in der Baseline)',
      (select sammlungszeilen || ' · ' || favoriten from mess), null),
  (144, 'Auskunft', 'Stand sky_id_seq',
      case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select last_value::text || ''|'' || is_called::text as c from public.sky_id_seq',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (145, 'Auskunft', 'Plattformadmins (shop_admins)',
      case when has_table_privilege('public.shop_admins', 'select')
           then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.shop_admins', false, true, '')))[1]::text
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
