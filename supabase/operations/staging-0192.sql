-- ===========================================================================
-- STAGING — EIN LAUF FUER 0192
--            (die Umschaltung: Fassung 2026-11-11 und nur noch die gekoppelte Bestellung)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0192`, diese Datei,
-- `npm run db:migrate:staging -- 0192 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe,
-- NACH dem Deployment, das die Fassung aus der Datenbank liest, und nach der
-- Browser- und PostgREST-Pruefung der Vorschau gegen Staging (ADR-0184, AP5).
-- Sie IST die Umschaltung: mit ihrem Commit zeigen Seiten und Checkout 2026-11-11.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie aendert vier Zeilen in
-- `legal_document_versions`, entfernt die Sechser-Ueberladung von
-- create_order und setzt den Tabellenkommentar; bricht sie ab, ist nichts
-- angewendet.
--
-- SIE AENDERT SONST NICHTS. A2 misst vorher Bestellsnapshots, Bestellungen,
-- Rechnungen, Verkaeufer, Lager und Sammlung, dazu Rechte und Rumpf jeder
-- Funktion ausser create_order, die Rechte jeder Tabelle und jede Policy. Z1
-- misst nachher dasselbe und bricht ab, wenn sich auch nur ein Wert bewegt
-- hat. Z2-Z6 pruefen Kennungen, Standmarke, Snapshot-Funktion, die eine
-- verbleibende create_order und was legal_versions_public() nennt.
--
-- NUR STAGING. ERWARTET: die NOTICE `0192 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — Daten, Rechte und Ruempfe, vorher gemessen. */
create temporary table lauf_0192_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as snapshots,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'create_order') as funktionen,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- >>> EINGEBETTET: supabase/migrations/0192_legal_versions_2026_11_11.sql
-- ===========================================================================
-- 0192 — die Umschaltung: Fassung 2026-11-11 wird die aktuelle, und es gibt
--        nur noch die gekoppelte Bestellung (Phase 2 von 2)
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Each environment only after a separate approval by the operator,     ##
-- ##  AFTER the deployment whose pages and checkout render the version     ##
-- ##  `legal_versions_public()` names (ADR-0184). Not tied to the minute   ##
-- ##  of that deployment: until this file runs, it shows 2026-09-17.       ##
-- ###########################################################################
--
-- WARUM (ADR-0184, AP5, 2026-11-11)
--
-- Impressum, AGB, Widerrufsbelehrung und Datenschutzerklärung nennen den
-- Verkäufer ab AP5 aus `seller_legal_public()` statt aus der Konstante mit
-- „yulez.collectibles“. Alle vier Texte ändern sich damit, und alle vier
-- tragen ab dann die Kennung `2026-11-11` (`LEGAL_VERSIONS` in
-- `src/lib/legal/documents.ts`). Die bisherigen Texte (`2026-09-17`) liegen
-- unverändert in `src/lib/legal/archive/2026-09-17.ts` und unter
-- `/rechtstexte/<slug>/2026-09-17`.
--
-- WAS DIESE DATEI TUT — GENAU DAS, IN EINER TRANSAKTION:
--
--   1. `legal_document_versions`: für agb, widerruf, datenschutz, impressum
--      `version` 2026-09-17 → 2026-11-11, `effective_from` = Tag der
--      Anwendung, `updated_at` = jetzt. NUR Zeilen, die noch 2026-09-17
--      tragen; eine andere Kennung bricht ab, statt sie zu überschreiben.
--   2. `create_order(text, text, jsonb, jsonb, text, text)` — die
--      Sechser-Überladung OHNE Kennungen — entfernen. Ab hier gibt es nur
--      die gekoppelte aus 0191: keine Bestellung ohne angezeigte Fassung,
--      keine NULL-Umgehung.
--   3. Den Tabellenkommentar um die Standmarke `[aktuell: 2026-11-11]`
--      ergänzen — damit der lesende Prüfzugang, der die Tabelle bewusst nicht
--      lesen darf, feststellen kann, ob diese Datei angewendet ist
--      (`migration-plans.json`). Gesetzt erst NACH den Nachbedingungen.
--
-- WARUM BEIDES ZUSAMMEN. Solange die Sechser besteht, kann ein Checkout aus
-- einem älteren Deployment (offener Tab, Skew Protection) ohne Abgleich
-- bestellen; der Trigger schriebe dann die NEUE Kennung zu einem ALTEN
-- angezeigten Text. Zusammen in einer Transaktion gibt es keinen Moment, in
-- dem das geht: davor speichert die Sechser die alte Kennung zum alten Text,
-- danach gibt es sie nicht mehr.
--
-- WAS SICH NICHT ÄNDERT: keine Bestellung, kein Bestellsnapshot
-- (`order_legal_snapshots` ist gegen jede Änderung geschützt, 0047), keine
-- Rechnung, keine Tabelle, keine Spalte, kein Recht der gekoppelten
-- Bestellung, kein anderer Funktionsrumpf. Bestehende Bestellungen behalten
-- 2026-09-17; der Trigger aus 0047 liest die neue Kennung nur für
-- Bestellungen, die NACH dieser Datei angelegt werden.
--
-- ÜBERSCHREIBT DIE ZEILE. `legal_document_versions` hat EINE Zeile je
-- Dokument (`slug` ist der Primärschlüssel) — sie hält die aktuelle Kennung,
-- keine Historie. Die bisherige Kennung bleibt erhalten in jedem
-- Bestellsnapshot, der sie trägt, im Archiv des Codes und in 0047.
--
-- DIE UMSCHALTUNG IST DIESE TRANSAKTION. Der Code aus AP5 enthält beide
-- Fassungen und rendert die, die `legal_versions_public()` nennt: bis zum
-- Commit dieser Datei 2026-09-17, danach 2026-11-11 — auf /agb, /widerruf,
-- /impressum, /datenschutz und im Checkout zugleich. Eine Seite, die vor dem
-- Commit gerendert wurde, sendet 2026-09-17 und erhält LV002; nach dem
-- Neuladen zeigt und sendet sie 2026-11-11.
--
-- VORAUSSETZUNG: 0191 (die gekoppelte Bestellung und `legal_versions_public()`
-- stehen, mit ihren Rümpfen) und das Deployment, das sie liest.
--
-- IDEMPOTENT. Ein zweiter Lauf findet keine Zeile mit 2026-09-17 und keine
-- Sechser mehr, ändert nichts und bestätigt dieselben Nachbedingungen.
--
-- RÜCKNAHME: `supabase/rollback/R0192_legal_versions_2026_11_11.sql`.
-- ===========================================================================

do $p0192$
declare
  v_slugs text;
  v_unknown text;
begin
  /* VORBEDINGUNGEN — kein Raten. */
  if to_regclass('public.legal_document_versions') is null then
    raise exception '0192 precondition: public.legal_document_versions does not exist';
  end if;
  select string_agg(v.slug, ',' order by v.slug) into v_slugs from public.legal_document_versions v;
  if v_slugs is distinct from 'agb,datenschutz,impressum,widerruf' then
    raise exception '0192 precondition: expected exactly agb, datenschutz, impressum, widerruf; found %', coalesce(v_slugs, '(none)');
  end if;
  select string_agg(v.slug || '=' || v.version, ', ' order by v.slug) into v_unknown
    from public.legal_document_versions v
   where v.version not in ('2026-09-17', '2026-11-11');
  if v_unknown is not null then
    raise exception '0192 precondition: refusing to overwrite an unexpected version: %', v_unknown;
  end if;
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)'))
     is distinct from '75fbeaea7b193035717eeb37c0995127' then
    raise exception '0192 precondition: the coupled create_order of 0191 is missing or has another body';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.legal_versions_public()'))
     is distinct from '5e9daa01284d9b06b1b7d8fb053cff36' then
    raise exception '0192 precondition: legal_versions_public() of 0191 is missing or has another body';
  end if;
end
$p0192$;

update public.legal_document_versions
   set version = '2026-11-11',
       effective_from = current_date,
       updated_at = now()
 where slug in ('agb', 'widerruf', 'datenschutz', 'impressum')
   and version = '2026-09-17';

drop function if exists public.create_order(text, text, jsonb, jsonb, text, text);

do $q0192$
begin
  /* NACHBEDINGUNGEN — gemessen, nicht angenommen. */
  if (select count(*) from public.legal_document_versions v
       where v.slug in ('agb', 'widerruf', 'datenschutz', 'impressum') and v.version = '2026-11-11') <> 4
     or (select count(*) from public.legal_document_versions) <> 4 then
    raise exception '0192 postcondition: not every legal document carries 2026-11-11';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order') <> 1
     or to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)') is null then
    raise exception '0192 postcondition: create_order must exist exactly once, with the terms versions';
  end if;
  if (select l.agb || '|' || l.widerruf || '|' || l.datenschutz || '|' || l.impressum
        from public.legal_versions_public() l) is distinct from '2026-11-11|2026-11-11|2026-11-11|2026-11-11' then
    raise exception '0192 postcondition: legal_versions_public() does not name 2026-11-11 for all four';
  end if;
end
$q0192$;

comment on table public.legal_document_versions is
  'Which version of each legal text is current. The TEXT lives in src/lib/legal/; this holds only the identifier, so a trigger can snapshot it onto an order without a second round trip (ADR-0086). Earlier texts are archived unchanged in src/lib/legal/archive/ (ADR-0184). [aktuell: 2026-11-11]';

-- PostgREST vergisst die entfernte Signatur; Supabase lädt nach DDL von
-- selbst neu, das hier ist nur die ausdrückliche Bitte.
notify pgrst, 'reload schema';
-- <<< ENDE: supabase/migrations/0192_legal_versions_2026_11_11.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table lauf_0192_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.order_id)), '-') from public.order_legal_snapshots t) as snapshots,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.orders t) as orders,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.invoices t) as invoices,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname <> 'create_order') as funktionen,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt: keine Bestellung, kein Snapshot, keine Rechnung, kein anderes Recht, kein anderer Rumpf. */
  if exists (select 1 from pg_temp.lauf_0192_vorher v, pg_temp.lauf_0192_nachher n
              where (v.snapshots, v.orders, v.invoices, v.sellers, v.shop_inventory, v.collection_items, v.funktionen, v.tabellenrechte, v.policies)
                    is distinct from (n.snapshots, n.orders, n.invoices, n.sellers, n.shop_inventory, n.collection_items, n.funktionen, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Bestellungen, Snapshots, Rechnungen, Daten, andere Rechte oder Ruempfe bewegt — nichts wird angewendet';
  end if;

  /* Z2 — die Kennungen. */
  if (select string_agg(v.slug || '=' || v.version, '|' order by v.slug) from public.legal_document_versions v)
     is distinct from 'agb=2026-11-11|datenschutz=2026-11-11|impressum=2026-11-11|widerruf=2026-11-11' then
    raise exception 'ABBRUCH Z2: die Kennungen stehen nicht auf 2026-11-11';
  end if;

  /* Z3 — die Standmarke, die der lesende Pruefzugang liest. */
  if coalesce(obj_description(to_regclass('public.legal_document_versions'), 'pg_class'), '') not like '%[aktuell: 2026-11-11]%' then
    raise exception 'ABBRUCH Z3: die Standmarke fehlt im Tabellenkommentar';
  end if;

  /* Z4 — die Snapshot-Funktion, die die Kennung fuer neue Bestellungen liest, behaelt genau einen leeren search_path. */
  if (select count(*) from pg_proc p
       where p.oid = to_regprocedure('public.orders_snapshot_legal()')
         and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
         and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                from unnest(p.proconfig) c where c like 'search\_path=%')) <> 1 then
    raise exception 'ABBRUCH Z4: orders_snapshot_legal() hat nicht genau einen leeren search_path';
  end if;

  /* Z5 — create_order gibt es genau einmal: die gekoppelte aus 0191, Rumpf unveraendert, mit genau einem leeren search_path. */
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_order') <> 1
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')) is distinct from '75fbeaea7b193035717eeb37c0995127'
     or (select count(*) from pg_proc p
       where p.oid = to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text, text, text)')
         and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
         and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                from unnest(p.proconfig) c where c like 'search\_path=%')) <> 1 then
    raise exception 'ABBRUCH Z5: create_order steht nicht als einzige, gekoppelte Ueberladung';
  end if;

  /* Z6 — was die Seiten lesen: legal_versions_public() nennt 2026-11-11 fuer alle vier. */
  if (select l.agb || '|' || l.widerruf || '|' || l.datenschutz || '|' || l.impressum from public.legal_versions_public() l)
     is distinct from '2026-11-11|2026-11-11|2026-11-11|2026-11-11' then
    raise exception 'ABBRUCH Z6: legal_versions_public() nennt nicht 2026-11-11';
  end if;

  raise notice '0192 ok: vier Kennungen auf 2026-11-11, nur noch die gekoppelte create_order; keine Bestellung, kein Snapshot, keine Rechnung bewegt.';
end
$lauf_z$;

commit;
