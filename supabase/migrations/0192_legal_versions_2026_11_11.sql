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
