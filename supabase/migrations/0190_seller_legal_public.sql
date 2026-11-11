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
