-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0190 (seller_legal_public), REIN LESEND
--
-- Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als `postgres`, NACH
-- `supabase/operations/prod-0190.sql`. Die Baseline aus Zeile 900 des
-- Preflights in DERSELBEN TRANSAKTION setzen — im SQL-Editor: `begin;`
-- davor, `rollback;` danach, sonst gilt `set_config` nur fuer seine eigene
-- Anweisung. Gebaut wird dafuer, wie bei 0167, eine Huelle
-- `supabase/operations/prod-s-postflight-0190.sql` mit der GEMELDETEN Zeile —
-- erst nach dem Preflight, nie mit einer Zahl von heute:
--
--     select set_config('skyisles.p0190', 'skyisles-p0190-1|…', true);
--
-- **Erwartet: Zeile 9999 = `0`.** Ohne Baseline schlagen 801-803 und jede
-- Vergleichszeile an — eine fehlende Baseline faellt durch.
--
--   101-106  die Umgebung (wie der Preflight).
--   201-207  seller_legal_public: Rumpf, Form, Rechte, Spalten, eine Zeile.
--   221-222  sellers bleibt gesperrt; die Verkaeuferzeile ist unveraendert.
--   231-232  die Rechtsfassungen sind weiter viermal 2026-09-17.
--   801-803  die Baseline: da, richtige Marke, 17 Teile, Schutzsumme.
--   811-823  WAS SICH NICHT BEWEGT HAT: bestehende Bestellungen, Rechnungen,
--            Snapshots, Lagerpositionen und -bewegungen (bis zum groessten
--            Schluessel der Baseline), Verkaeufer, Rechtsfassungen, jede
--            andere Funktion, jedes Tabellenrecht, jede Policy.
--   891-899  AUSKUNFT: was seit der Baseline dazukam; der heutige Stand.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with
seq as (
  select min_value, max_value, cycle from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
mess as (
  select
    (select coalesce(max(t.id), 0)::text from public.orders t) as orders_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders_fp,
    (select coalesce(max(t.id), 0)::text from public.invoices t) as invoices_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices_fp,
    (select coalesce(max(t.order_id), 0)::text from public.order_legal_snapshots t) as order_legal_snapshots_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as order_legal_snapshots_fp,
    (select coalesce(max(t.id), 0)::text from public.shop_inventory t) as shop_inventory_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory_fp,
    (select coalesce(max(t.id), 0)::text from public.inventory_movements t) as inventory_movements_max,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements_fp,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers_fp,
    (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t) as ldv_fp,
    (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.seller_legal_public()'), 0)) as funktionen_fp,
    (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte_fp,
    (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies_fp
),
feld as (
  select orders_max || '|' || orders_fp || '|' || invoices_max || '|' || invoices_fp || '|' || order_legal_snapshots_max || '|' || order_legal_snapshots_fp || '|' || shop_inventory_max || '|' || shop_inventory_fp || '|' || inventory_movements_max || '|' || inventory_movements_fp || '|' || sellers_fp || '|' || ldv_fp || '|' || funktionen_fp || '|' || tabellenrechte_fp || '|' || policies_fp as kern, m.* from mess m
),
heute as (
  select 'skyisles-p0190-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
basis as (
  select nullif(btrim(coalesce(current_setting('skyisles.p0190', true), '')), '') as roh
),
teil as (
  select roh, case when roh is null then null else string_to_array(roh, '|') end as t from basis
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
  (106, 'Umgebung', 'die Datenbank traegt NICHT den Staging-Stempel',
      (select (coalesce(shobj_description(d.oid, 'pg_database'), '') <> 'skyisles-staging qqxcpesbwfxzgytkdsac')::text
         from pg_database d where d.datname = current_database()),
      'true'),

  (201, 'Rumpf', 'seller_legal_public() ist die Fassung aus 0190 (md5 des Rumpfs)',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_legal_public()')), '(fehlt)'), '147b403e834f4e525bad11d3494ea083'),
  (202, 'Rumpf', 'STABLE, SECURITY DEFINER, genau ein leerer search_path',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.seller_legal_public()') and p.prosecdef and p.provolatile = 's'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (203, 'Rechte', 'anon und authenticated duerfen; service_role und PUBLIC nicht',
      coalesce((has_function_privilege('anon', to_regprocedure('public.seller_legal_public()'), 'execute')
                and has_function_privilege('authenticated', to_regprocedure('public.seller_legal_public()'), 'execute')
                and not has_function_privilege('service_role', to_regprocedure('public.seller_legal_public()'), 'execute')
                and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where p.oid = to_regprocedure('public.seller_legal_public()') and a.privilege_type = 'EXECUTE' and a.grantee = 0))::text,
               '(fehlt)'), 'true'),
  (204, 'Rechte', 'seller_legal_public existiert in genau einer Ueberladung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'seller_legal_public'), '1'),
  (205, 'Spalten', 'genau die zugesagten Spalten, in dieser Reihenfolge',
      coalesce(pg_get_function_result(to_regprocedure('public.seller_legal_public()')), '(fehlt)'),
      'TABLE(display_name text, legal_name text, legal_form text, street text, postal_code text, city text, country_code text, contact_email text, direct_contact text, vat_id text, w_id text, register_court text, register_number text, small_business_19 boolean, dispute_participation boolean, dispute_body text, withdrawal_contact_email text, complaints_contact_email text, return_postage_borne_by text)'),
  (206, 'Ausgabe', 'sie liefert genau eine Zeile (den aktiven Verkaeufer)',
      case when to_regprocedure('public.seller_legal_public()') is null then '(fehlt)'
           else (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.seller_legal_public()', false, true, '')))[1]::text end, '1'),
  (207, 'Ausgabe', 'und darin den Shopnamen skyisles.shop',
      case when to_regprocedure('public.seller_legal_public()') is null then '(fehlt)'
           else coalesce((xpath('/row/c/text()', query_to_xml(
                  'select display_name as c from public.seller_legal_public()', false, true, '')))[1]::text, '(leer)') end,
      'skyisles.shop'),

  (221, 'Unberuehrt', 'public.sellers: RLS an, anon und authenticated duerfen weiter nicht lesen',
      (select (c.relrowsecurity
               and not has_table_privilege('anon', 'public.sellers', 'select')
               and not has_table_privilege('authenticated', 'public.sellers', 'select'))::text
         from pg_class c where c.oid = to_regclass('public.sellers')), 'true'),
  (222, 'Unberuehrt', 'genau ein aktiver Verkaeufer, weiter',
      (select count(*)::text from public.sellers s where s.is_active), '1'),

  (232, 'Rechtsfassung', 'die Tabelle traegt viermal 2026-09-17 (0192 ist NICHT angewendet)',
      (select coalesce(string_agg(v.slug || '=' || v.version, ',' order by v.slug), '(keine)') from public.legal_document_versions v),
      'agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17'),

  (801, 'Basis', 'eine Baseline ist uebergeben worden',
      (select case when roh is null then 'FEHLT' else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-p0190-1 und 17 Teile',
      (select case when t is null then 'keine Baseline'
                   else (t[1] = 'skyisles-p0190-1' and array_length(t, 1) = 17)::text end from teil), 'true'),
  (803, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select case when t is null then 'keine Baseline'
                   else (t[17] = left(md5(array_to_string(t[2:16], '|')), 12))::text end from teil), 'true'),

  (811, 'Unveraendert', 'bestehende Bestellungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t where t.id <= (select t[2]::bigint from teil)),
      (select coalesce(t[3], '(keine Baseline)') from teil)),
  (812, 'Unveraendert', 'bestehende Rechnungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t where t.id <= (select t[4]::bigint from teil)),
      (select coalesce(t[5], '(keine Baseline)') from teil)),
  (813, 'Unveraendert', 'bestehende Bestellsnapshots (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t where t.order_id <= (select t[6]::bigint from teil)),
      (select coalesce(t[7], '(keine Baseline)') from teil)),
  (814, 'Unveraendert', 'bestehende Lagerpositionen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t where t.id <= (select t[8]::bigint from teil)),
      (select coalesce(t[9], '(keine Baseline)') from teil)),
  (815, 'Unveraendert', 'bestehende Lagerbewegungen (bis zum groessten Schluessel der Baseline): Abdruck',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t where t.id <= (select t[10]::bigint from teil)),
      (select coalesce(t[11], '(keine Baseline)') from teil)),
  (816, 'Unveraendert', 'Verkaeufer: jede Zeile, jede Spalte',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t),
      (select coalesce(t[12], '(keine Baseline)') from teil)),
  (817, 'Unveraendert', 'Rechtsfassungen: jede Zeile',
      (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t),
      (select coalesce(t[13], '(keine Baseline)') from teil)),
  (821, 'Unveraendert', 'jede Funktion in public ausser seller_legal_public(): Rechte, Form, Rumpf',
      (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.seller_legal_public()'), 0)),
      (select coalesce(t[14], '(keine Baseline)') from teil)),
  (822, 'Unveraendert', 'Rechte und RLS-Schalter jeder Tabelle, Sicht und Sequenz in public',
      (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')),
      (select coalesce(t[15], '(keine Baseline)') from teil)),
  (823, 'Unveraendert', 'jede Policy in public',
      (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public'),
      (select coalesce(t[16], '(keine Baseline)') from teil)),

  (891, 'Auskunft', 'Bestellungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.orders x where x.id > (select t[2]::bigint from teil)), null),
  (892, 'Auskunft', 'Rechnungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.invoices x where x.id > (select t[4]::bigint from teil)), null),
  (893, 'Auskunft', 'Bestellsnapshots, die seit der Baseline dazukamen',
      (select count(*)::text from public.order_legal_snapshots x where x.order_id > (select t[6]::bigint from teil)), null),
  (894, 'Auskunft', 'Lagerpositionen, die seit der Baseline dazukamen',
      (select count(*)::text from public.shop_inventory x where x.id > (select t[8]::bigint from teil)), null),
  (895, 'Auskunft', 'Lagerbewegungen, die seit der Baseline dazukamen',
      (select count(*)::text from public.inventory_movements x where x.id > (select t[10]::bigint from teil)), null),
  (898, 'Basis', 'die uebergebene Baseline, wie sie gelesen wurde', (select coalesce(roh, '(keine)') from basis), null),
  (899, 'Basis', 'der heutige Stand als Baseline-Zeile', (select zeile from heute), null)
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
