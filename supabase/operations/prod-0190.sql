-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0190
--              (seller_legal_public: die oeffentliche Anbieterkennzeichnung)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen. NOCH NICHT FREIGEGEBEN.
--
-- VORHER: `supabase/checks/prod_0190_preflight.sql`, Zeile 9999 = 0, Zeile 900
-- aufheben. NACHHER: `prod_0190_postflight.sql` mit genau dieser Baseline.
-- Ablauf und Abbruchbedingungen: `supabase/checks/production_release_0190_0191.md`.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET (dieselbe Datei, die auf
-- Staging am 2026-11-12 lief). Sie legt NUR eine lesende Funktion an und setzt
-- deren Rechte.
--
-- WAS DIESE HUELLE DAZUTUT, UND NUR DAS:
--   A0-A3  der Umgebungsnachweis: kein Staging-Stempel, dazu positiv am
--          Schema — 0133 liegt, sky_id_seq traegt kein Staging-Band, der
--          Katalog traegt Zeilen (wortgleich `prod-0167.sql`).
--   A4-A5  die Rollen; 0190 liegt noch NICHT (diese Datei laeuft einmal).
--   A6     die Messung vorher: Bestellungen, Rechnungen, Bestellsnapshots,
--          Lagerpositionen und -bewegungen, Verkaeufer, Rechtsfassungen —
--          jede Zeile, jede Spalte —, Rechte und Rumpf jeder Funktion ausser
--          der neuen, Rechte jeder Tabelle, jede Policy.
--   Z0-Z1  dieselbe Messung nachher; ein bewegter Wert bricht ab.
--   Z2-Z3  Rumpf, Rechte, Form und Spalten der neuen Funktion (wortgleich
--          `staging-0190.sql`).
--   Z4     die Rechtsfassungen sind weiter viermal 2026-09-17.
--
-- REPEATABLE READ. Die ganze Transaktion sieht EINEN Stand. Bestellt ein Kunde
-- waehrend des Laufs, sieht Z1 das nicht und bricht nicht falsch ab — Z1
-- vergleicht genau, was DIESE Transaktion veraendert hat. Was andere Sitzungen
-- in der Zeit tun, vergleicht die Nachkontrolle, und nur fuer bestehende Zeilen.
--
-- SAMMLUNGEN UND FAVORITEN werden nicht gemessen: Kunden aendern sie
-- jederzeit. Ihre Rechte und Policies stehen in den Abdruecken (A6, Z1).
--
-- ERWARTET: die NOTICE `0190 ok`, dann `commit`. Jeder Abbruch: `ABBRUCH …`,
-- und nichts ist angewendet.
-- Ruecknahme: `supabase/rollback/R0190_seller_legal_public.sql`.
-- ===========================================================================

begin isolation level repeatable read;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
declare
  v_n integer;
begin
  /* A0 — NICHT Staging. Der Stempel, den nur Staging traegt (staging-agent-setup.sql). */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '') = 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A0: diese Datenbank traegt den Staging-Stempel. Diese Datei '
      'ist fuer Production (zmiwxswrpkmizvqsgype).';
  end if;

  /* A1-A3 — der Umgebungsnachweis, positiv am Schema; wortgleich aus prod-0167.sql. */
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A1a: die Triggerfunktion purchases_paid_total_is_final '
      'fehlt. Sie kommt aus 0133, und 0133 liegt NUR auf Production. Diese '
      'Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'ABBRUCH A1b: der Trigger purchases_paid_total_immutable_trg '
      'fehlt, obwohl die Funktion aus 0133 liegt. Halb angewendeter Stand — '
      'erst klaeren.';
  end if;

  select count(*) into v_n from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
     and min_value = 928 and max_value = 4999;
  if v_n > 0 then
    raise exception 'ABBRUCH A2: sky_id_seq traegt das STAGING-Band '
      '(928 .. 4999). Diese Datei ist fuer Production (zmiwxswrpkmizvqsgype) — '
      'auf Staging gehoert supabase/operations/staging-0190.sql.';
  end if;
  select count(*) into v_n from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
     and ((min_value = 1 and max_value = 9223372036854775807)
          or (min_value = 5001 and max_value = 8999));
  if v_n <> 1 then
    raise exception 'ABBRUCH A2b: sky_id_seq traegt weder den unbegrenzten '
      'Production-Stand (1 .. 9223372036854775807) noch das Production-Band '
      '(5001 .. 8999). Erst klaeren, welches Projekt das ist.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;

  /* A4 — die Rollen, an denen die Rechte haengen. */
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'ABBRUCH A4: anon, authenticated oder service_role fehlt.';
  end if;

  /* A5 — 0190 liegt NICHT, in keiner Ueberladung. */
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'seller_legal_public') then
    raise exception 'ABBRUCH A5: seller_legal_public liegt schon. Diese Datei laeuft einmal.';
  end if;
end
$lauf_a$;

/* A6 — Daten, Rechte und Ruempfe, vorher gemessen. */
create temporary table prod_0190_vorher on commit drop as
select
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as order_legal_snapshots,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t) as legal_document_versions,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.seller_legal_public()'), 0)) as funktionen,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- >>> EINGEBETTET: supabase/migrations/0190_seller_legal_public.sql
-- ===========================================================================
-- 0190 — seller_legal_public(): die öffentliche Anbieterkennzeichnung, lesend
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Each environment only after a separate approval by the operator.     ##
-- ###########################################################################
--
-- WARUM (ADR-0184, AP4, 2026-11-11)
--
-- Impressum, AGB, Widerrufsbelehrung, Datenschutz, Footer und Serviceseiten
-- lesen die Verkäuferangaben heute aus einer Konstante im Code
-- (`SELLER_IDENTITY`) und nennen dort noch „yulez.collectibles“. Sie sollen
-- künftig (AP5) dieselbe Quelle lesen wie Rechnungen und Mails: die aktive
-- Zeile in `public.sellers`. Diese Seiten sind öffentlich; `sellers` ist für
-- anon und authenticated gesperrt (`0026`: RLS ohne Policy, `revoke all`).
-- Den einzigen Weg dorthin gibt es bisher nur für Name und ID
-- (`seller_public()`, `0027`).
--
-- WAS DIESE DATEI TUT — GENAU DAS:
--
--   eine neue Funktion `public.seller_legal_public()`, `stable`,
--   `security definer`, `search_path = ''`, die die AKTIVE Verkäuferzeile als
--   ausdrückliche Spaltenliste liefert — nur Angaben, die für die
--   Anbieterkennzeichnung bestimmt sind (§ 5 DDG, § 312d/Art. 246a EGBGB,
--   § 36 VSBG, § 34a UStDV) und die das Schema dafür angelegt hat (`0040`).
--
--   EXECUTE  PUBLIC, service_role  entzogen
--   EXECUTE  anon, authenticated   erteilt — die Rechtsseiten sind öffentlich
--
-- WAS SIE NICHT LIEFERT (ausdrücklich, ADR-0059: nie `select s.*`):
--   transactional_reply_to   interne Antwortadresse der Mails
--   phone                    optional; ob eine Nummer veröffentlicht wird, ist
--                            offen (heute: keine). Gehört erst nach eigener
--                            Entscheidung in diese Liste.
--   trading_name             abgelöst (ADR-0184); liest kein Kundendokument
--   dispatch_statement, free_shipping_threshold
--                            Shopangaben, haben eigene Lesewege
--   id, is_active, created_at, updated_at, updated_by
--                            Verwaltung
--
-- LEERES IST LEER. Jede Textspalte wird `nullif(btrim(…), '')` geliefert: eine
-- fehlende Angabe ist NULL, nie ein Platzhalter. Ohne aktiven Verkäufer
-- liefert die Funktion KEINE Zeile; AP5 zeigt dann einen Fehlerzustand statt
-- erfundener Angaben. Die Kontakte für Widerruf und Beschwerden werden wie in
-- `admin_shop_profile()` auf `contact_email` zurückgeführt.
--
-- WAS SICH NICHT ÄNDERT: keine Tabelle, keine Zeile, kein bestehender
-- Funktionskörper, keine bestehenden Rechte. Rechnungen, Bestellungen und
-- Snapshots bleiben unberührt; das Steuermodell auch (`small_business_19`
-- wird gelesen, wie es gespeichert ist). Diese Datei SCHREIBT NICHTS.
--
-- DIE VERSIONEN DER RECHTSTEXTE STEIGEN NICHT HIER. Ein neuer Eintrag in
-- `legal_document_versions` gehört in dieselbe Freigabe wie der neue Text
-- (AP5) — sonst trügen Bestellungen eine Version, deren Text es nicht gibt.
--
-- ANWENDBAR AUF BEIDE STÄNDE. Vorausgesetzt werden nur `sellers` mit den
-- Spalten aus `0026`/`0040`; beide Umgebungen tragen sie. Die Datei bricht ab,
-- statt zu raten, wenn eine Spalte fehlt oder die Funktion schon in einer
-- anderen Form existiert.
--
-- IDEMPOTENT. Ein zweiter Lauf legt dieselbe Funktion an und setzt dieselben
-- Rechte; die Nachbedingungen gelten danach genauso.
--
-- RÜCKNAHME: `supabase/rollback/R0190_seller_legal_public.sql`.
-- ===========================================================================

do $p0190$
declare
  v_missing text;
begin
  /* VORBEDINGUNGEN — kein Raten. */
  if to_regclass('public.sellers') is null then
    raise exception '0190 precondition: public.sellers does not exist';
  end if;
  select string_agg(c, ', ') into v_missing
    from unnest(array[
      'is_active', 'display_name', 'legal_name', 'legal_form', 'street', 'postal_code', 'city',
      'country_code', 'contact_email', 'direct_contact', 'vat_id', 'w_id', 'register_court',
      'register_number', 'small_business_19', 'dispute_participation', 'dispute_body',
      'withdrawal_contact_email', 'complaints_contact_email', 'return_postage_borne_by'
    ]) c
   where not exists (
     select 1 from information_schema.columns k
      where k.table_schema = 'public' and k.table_name = 'sellers' and k.column_name = c);
  if v_missing is not null then
    raise exception '0190 precondition: public.sellers lacks %', v_missing;
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.proname = 'seller_legal_public'
                and p.oid <> coalesce(to_regprocedure('public.seller_legal_public()'), 0)) then
    raise exception '0190 precondition: seller_legal_public exists with another signature';
  end if;
end
$p0190$;

create or replace function public.seller_legal_public()
returns table (
  display_name             text,
  legal_name               text,
  legal_form               text,
  street                   text,
  postal_code              text,
  city                     text,
  country_code             text,
  contact_email            text,
  direct_contact           text,
  vat_id                   text,
  w_id                     text,
  register_court           text,
  register_number          text,
  small_business_19        boolean,
  dispute_participation    boolean,
  dispute_body             text,
  withdrawal_contact_email text,
  complaints_contact_email text,
  return_postage_borne_by  text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The active seller only (at most one, `sellers_one_active`). The column
  -- list is written out: a column added to `sellers` later stays invisible
  -- here until somebody names it on purpose (ADR-0059).
  select nullif(btrim(s.display_name), ''),
         nullif(btrim(s.legal_name), ''),
         nullif(btrim(s.legal_form), ''),
         nullif(btrim(s.street), ''),
         nullif(btrim(s.postal_code), ''),
         nullif(btrim(s.city), ''),
         nullif(btrim(s.country_code), ''),
         nullif(btrim(s.contact_email), ''),
         nullif(btrim(s.direct_contact), ''),
         nullif(btrim(s.vat_id), ''),
         nullif(btrim(s.w_id), ''),
         nullif(btrim(s.register_court), ''),
         nullif(btrim(s.register_number), ''),
         s.small_business_19,
         s.dispute_participation,
         nullif(btrim(s.dispute_body), ''),
         coalesce(nullif(btrim(s.withdrawal_contact_email), ''), nullif(btrim(s.contact_email), '')),
         coalesce(nullif(btrim(s.complaints_contact_email), ''), nullif(btrim(s.contact_email), '')),
         s.return_postage_borne_by
    from public.sellers s
   where s.is_active
   limit 1
$$;

comment on function public.seller_legal_public() is
  'The public provider identification of the ACTIVE seller, for Impressum, AGB, Widerruf, Datenschutz, footer and service pages (ADR-0184): shop name, legal name and form, address, contact, second contact channel, VAT and W-IdNr., register, tax and dispute statements, withdrawal and complaints contacts, return postage. An allow-list that names its columns; empty values are NULL; no active seller means no row. NOT returned: transactional_reply_to, phone, trading_name, dispatch_statement, free_shipping_threshold, id and the administrative columns. Read-only.';

revoke all on function public.seller_legal_public() from public, anon, authenticated, service_role;
grant execute on function public.seller_legal_public() to anon, authenticated;

do $q0190$
declare
  v_sig constant text := 'public.seller_legal_public()';
  v_oid oid := to_regprocedure(v_sig);
begin
  /* NACHBEDINGUNGEN — gemessen, nicht angenommen. */
  if v_oid is null then
    raise exception '0190 postcondition: % was not created', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid)
     or (select p.provolatile from pg_proc p where p.oid = v_oid) <> 's'
     or (select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
          where p.oid = v_oid and c like 'search\_path=%') <> 1
     or (select btrim(substring(c from 'search_path=(.*)$'), '"')
           from pg_proc p, unnest(p.proconfig) c
          where p.oid = v_oid and c like 'search\_path=%') is distinct from '' then
    raise exception '0190 postcondition: % is not a stable security definer with an empty search_path', v_sig;
  end if;
  if not has_function_privilege('anon', v_sig, 'execute')
     or not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '0190 postcondition: anon or authenticated cannot execute %', v_sig;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0190 postcondition: PUBLIC can execute %', v_sig;
  end if;
  if has_table_privilege('anon', 'public.sellers', 'select') then
    raise exception '0190 postcondition: anon can read public.sellers directly';
  end if;
end
$q0190$;
-- <<< ENDE: supabase/migrations/0190_seller_legal_public.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table prod_0190_nachher on commit drop as
select
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as order_legal_snapshots,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.inventory_movements t) as inventory_movements,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.slug)), '-') from public.legal_document_versions t) as legal_document_versions,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid <> coalesce(to_regprocedure('public.seller_legal_public()'), 0)) as funktionen,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt: keine Bestellung, keine Rechnung, kein Snapshot, kein Lager, kein
     Verkaeufer, keine Rechtsfassung, kein anderes Recht, kein anderer Rumpf, keine Policy. */
  if exists (select 1 from pg_temp.prod_0190_vorher v, pg_temp.prod_0190_nachher n
              where (v.orders, v.invoices, v.order_legal_snapshots, v.shop_inventory, v.inventory_movements, v.sellers, v.legal_document_versions, v.funktionen, v.tabellenrechte, v.policies)
                    is distinct from (n.orders, n.invoices, n.order_legal_snapshots, n.shop_inventory, n.inventory_movements, n.sellers, n.legal_document_versions, n.funktionen, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, andere Rechte, Ruempfe oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — der Rumpf ist der aus der Migrationsdatei. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.seller_legal_public()')) is distinct from '147b403e834f4e525bad11d3494ea083' then
    raise exception 'ABBRUCH Z2: der Rumpf von seller_legal_public ist nicht der aus 0190';
  end if;

  /* Z3 — Rechte und Form: anon und authenticated, nie service_role oder PUBLIC; STABLE, SECURITY DEFINER, leerer search_path. */
  if not (has_function_privilege('anon', to_regprocedure('public.seller_legal_public()'), 'execute')
          and has_function_privilege('authenticated', to_regprocedure('public.seller_legal_public()'), 'execute')
          and not has_function_privilege('service_role', to_regprocedure('public.seller_legal_public()'), 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           where p.oid = to_regprocedure('public.seller_legal_public()') and a.privilege_type = 'EXECUTE' and a.grantee = 0))
     or (select count(*) from pg_proc p
          where p.oid = to_regprocedure('public.seller_legal_public()') and p.prosecdef and p.provolatile = 's'
            and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
            and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                   from unnest(p.proconfig) c where c like 'search\_path=%')) <> 1
     or pg_get_function_result(to_regprocedure('public.seller_legal_public()')) is distinct from 'TABLE(display_name text, legal_name text, legal_form text, street text, postal_code text, city text, country_code text, contact_email text, direct_contact text, vat_id text, w_id text, register_court text, register_number text, small_business_19 boolean, dispute_participation boolean, dispute_body text, withdrawal_contact_email text, complaints_contact_email text, return_postage_borne_by text)' then
    raise exception 'ABBRUCH Z3: ein Recht, die Form oder die Spalten von seller_legal_public stehen nicht wie zugesagt';
  end if;

  /* Z4 — die Rechtsfassungen sind weiter die vom 2026-09-17. */
  if (select coalesce(string_agg(v.slug || '=' || v.version, ',' order by v.slug), '(keine)') from public.legal_document_versions v) is distinct from 'agb=2026-09-17,datenschutz=2026-09-17,impressum=2026-09-17,widerruf=2026-09-17' then
    raise exception 'ABBRUCH Z4: die Rechtsfassungen sind nicht viermal 2026-09-17';
  end if;

  raise notice '0190 ok: seller_legal_public steht, nur fuer anon und authenticated; keine Zeile, kein anderes Recht, kein anderer Rumpf bewegt.';
end
$lauf_z$;

commit;
