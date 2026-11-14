-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZU 0191 (create_order mit den angezeigten
--              Rechtsfassungen, neben der bisherigen), REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`, NACH der bestandenen
-- Nachkontrolle von 0190 und UNMITTELBAR vor `supabase/operations/prod-0191.sql`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer
-- `prod_0191_postflight.sql` — vollstaendig kopieren. Sie wird HIER neu
-- erhoben, nicht aus dem Preflight zu 0190 uebernommen.
--
--   101-106  DIE UMGEBUNG (wie `prod_0190_preflight.sql`).
--   111-120  0190 liegt, 0191 NICHT; die Sechser ist der Rumpf aus 0139 mit
--            SECURITY DEFINER und leerem search_path; wer sie ausfuehren darf;
--            Fassungstabelle und Snapshot-Trigger stehen.
--   121-128  die Verkaeuferidentitaet (wie 0190).
--   131-132  die Rechtsfassungen: viermal 2026-09-17.
--   141-146  AUSKUNFT: Bestellungen, Rechnungen, Snapshots, Lager.
--   900      die Baseline.
--
--   Die Baseline (Zeile 900) hat 17 Teile: die Marke, 15 Felder, die
--   Schutzsumme. Felder: je fuer Bestellungen, Rechnungen, Bestellsnapshots,
--   Lagerpositionen und Lagerbewegungen der GROESSTE SCHLUESSEL und der
--   Abdruck aller Zeilen bis zu ihm; dann Verkaeufer, Rechtsfassungen, die
--   Funktionen in public (Rechte, SECURITY DEFINER, search_path, Rumpf —
--   ohne die neuen), die Rechte und RLS-Schalter aller Tabellen und alle
--   Policies. Die Nachkontrolle vergleicht NUR Zeilen bis zum groessten
--   Schluessel: eine Bestellung, die ein Kunde nach dem Preflight anlegt,
--   bricht sie nicht — eine VERAENDERTE bestehende schon.
--
--   SAMMLUNGEN UND FAVORITEN STEHEN NICHT IN DER BASELINE. Kunden aendern sie
--   jederzeit; ein Abdruck davon waere nach Minuten falsch. Ihre Rechte und
--   Policies stehen in den Feldern 13-15 — das ist es, was eine Migration
--   an ihnen veraendern koennte.
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
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)'), 0) and p.oid <> coalesce(to_regprocedure('public.legal_versions_public()'), 0)) as funktionen_fp,
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
  select 'skyisles-p0191-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
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
  (106, 'Umgebung', 'die Datenbank traegt NICHT den Staging-Stempel',
      (select (coalesce(shobj_description(d.oid, 'pg_database'), '') <> 'skyisles-staging qqxcpesbwfxzgytkdsac')::text
         from pg_database d where d.datname = current_database()),
      'true'),

  (111, 'Vorbedingung', '0190 liegt: seller_legal_public() mit dem Rumpf aus 0190',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_legal_public()')), '(fehlt)'),
      '147b403e834f4e525bad11d3494ea083'),
  (112, '0191', 'create_order gibt es genau einmal — die Achter liegt NICHT (ein zweiter Lauf zeigt sich hier)',
      (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order'), '1'),
  (113, 'Vorbedingung', 'create_order (sechs Parameter) ist der Rumpf aus 0139 — 0191 bricht sonst selbst ab',
      coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')), '(fehlt)'),
      'c233337c0ca0555756f21e1abe173593'),
  (114, 'Vorbedingung', 'die Sechser: SECURITY DEFINER, genau ein leerer search_path — die Achter uebernimmt diese Form',
      (select count(*)::text from pg_proc p
        where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')), '1'),
  (115, 'Rechte', 'anon und authenticated duerfen die Sechser ausfuehren (der laufende Checkout)',
      coalesce((has_function_privilege('anon', to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'), 'execute')
                and has_function_privilege('authenticated', to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'), 'execute'))::text, '(fehlt)'), 'true'),
  (116, 'Auskunft', 'wer die Sechser ausfuehren darf — die Achter erhaelt genau diese Empfaenger',
      coalesce((select 'anon=' || has_function_privilege('anon', p.oid, 'execute')::text
                     || ',authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
                     || ',service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
                     || ',PUBLIC=' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                               where a.privilege_type = 'EXECUTE' and a.grantee = 0)::text
                  from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')), '(fehlt)'), null),
  (117, '0191', 'legal_versions_public liegt NICHT, in keiner Ueberladung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'legal_versions_public'), '0'),
  (118, 'Vorbedingung', 'legal_document_versions liegt (0047) und traegt genau die vier Dokumente',
      (select count(*)::text from public.legal_document_versions v
        where v.slug in ('agb', 'widerruf', 'datenschutz', 'impressum')), '4'),
  (119, 'Vorbedingung', 'der Snapshot-Trigger orders_snapshot_legal_trg (0047) liegt und ist aktiv',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.orders') and t.tgname = 'orders_snapshot_legal_trg'
          and t.tgenabled = 'O' and not t.tgisinternal), '1'),
  (120, 'Rechte', 'die Rollen anon, authenticated und service_role gibt es',
      (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role')), '3'),

  (121, 'Verkaeufer', 'genau ein aktiver Verkaeufer',
      (select count(*)::text from public.sellers s where s.is_active), '1'),
  (122, 'Verkaeufer', 'Shopname des aktiven Verkaeufers ist skyisles.shop (ADR-0184)',
      (select coalesce(string_agg((s.display_name = 'skyisles.shop')::text, ','), '(kein aktiver)')
         from public.sellers s where s.is_active), 'true'),
  (123, 'Verkaeufer', 'Rechtsform Einzelunternehmen — die Annahme der Rechtstexte',
      (select coalesce(string_agg((s.legal_form = 'Einzelunternehmen')::text, ','), '(kein aktiver)')
         from public.sellers s where s.is_active), 'true'),
  (124, 'Verkaeufer', 'Kleinunternehmer nach § 19 UStG — die Annahme der Rechtstexte',
      (select coalesce(string_agg(s.small_business_19::text, ','), '(kein aktiver)')
         from public.sellers s where s.is_active), 'true'),
  (125, 'Verkaeufer', 'keine Teilnahme an Streitbeilegung — die Annahme der Rechtstexte',
      (select coalesce(string_agg(s.dispute_participation::text, ','), '(kein aktiver)')
         from public.sellers s where s.is_active), 'false'),
  (126, 'Verkaeufer', 'Ruecksendekosten traegt der Kunde — die Annahme der Rechtstexte',
      (select coalesce(string_agg(s.return_postage_borne_by, ','), '(kein aktiver)')
         from public.sellers s where s.is_active), 'customer'),
  (127, 'Verkaeufer', 'Pflichtangaben gefuellt: Name, Strasse, PLZ, Ort, Land, E-Mail (Anzahl leerer)',
      (select coalesce(sum((case when nullif(btrim(s.legal_name), '') is null then 1 else 0 end)
                         + (case when nullif(btrim(s.street), '') is null then 1 else 0 end)
                         + (case when nullif(btrim(s.postal_code), '') is null then 1 else 0 end)
                         + (case when nullif(btrim(s.city), '') is null then 1 else 0 end)
                         + (case when nullif(btrim(s.country_code), '') is null then 1 else 0 end)
                         + (case when nullif(btrim(s.contact_email), '') is null then 1 else 0 end)), 6)::text
         from public.sellers s where s.is_active), '0'),
  (128, 'Auskunft', 'leere optionale Angaben des aktiven Verkaeufers (nur die Namen, keine Werte)',
      (select coalesce(nullif(concat_ws(',',
                case when nullif(btrim(s.direct_contact), '') is null then 'direct_contact' end,
                case when nullif(btrim(s.phone), '') is null then 'phone' end,
                case when nullif(btrim(s.dispute_body), '') is null then 'dispute_body' end,
                case when nullif(btrim(s.vat_id), '') is null then 'vat_id' end,
                case when nullif(btrim(s.w_id), '') is null then 'w_id' end), ''), '(keine)')
         from public.sellers s where s.is_active limit 1), null),

  (131, 'Rechtsfassung', 'die vier aktiven Fassungen sind 2026-09-17 (0192 ist NICHT angewendet)',
      (select coalesce(string_agg(v.slug || '=' || v.version, ',' order by v.slug), '(keine)') from public.legal_document_versions v),
      'agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17'),
  (132, 'Rechtsfassung', 'legal_document_versions bleibt fuer anon und authenticated gesperrt',
      (not has_table_privilege('anon', 'public.legal_document_versions', 'select')
       and not has_table_privilege('authenticated', 'public.legal_document_versions', 'select'))::text, 'true'),

  (141, 'Auskunft', 'Bestellungen: Anzahl|groesster Schluessel',
      (select count(*)::text || '|' || coalesce(max(t.id), 0)::text from public.orders t), null),
  (142, 'Auskunft', 'Rechnungen: Anzahl|groesster Schluessel',
      (select count(*)::text || '|' || coalesce(max(t.id), 0)::text from public.invoices t), null),
  (143, 'Auskunft', 'Bestellsnapshots: Anzahl|groesster Schluessel',
      (select count(*)::text || '|' || coalesce(max(t.order_id), 0)::text from public.order_legal_snapshots t), null),
  (144, 'Auskunft', 'Lagerpositionen: Anzahl|groesster Schluessel',
      (select count(*)::text || '|' || coalesce(max(t.id), 0)::text from public.shop_inventory t), null),
  (145, 'Auskunft', 'Lagerbewegungen: Anzahl|groesster Schluessel',
      (select count(*)::text || '|' || coalesce(max(t.id), 0)::text from public.inventory_movements t), null),
  (146, 'Auskunft', 'Bestellungen ohne Rechtssnapshot (aeltere als 0047 haben keinen)',
      (select count(*)::text from public.orders o
        where not exists (select 1 from public.order_legal_snapshots s where s.order_id = o.id)), null),

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
