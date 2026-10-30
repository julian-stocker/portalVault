-- ========================================================================
-- PRODUCTION — GRUPPE G5': EIN LAUF FUER 0163 UND 0164
--              (der Type ist eine Menge, das Banner eine Auswahl — und das
--               Archiv fuehrt beides)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen.
--
-- DIES IST DIE ZWEITE GRUPPE, DIE IN JEDE KATALOGZEILE SCHREIBT (nach
-- `0152`). `0163` legt drei Spalten an und belegt sie in VIER Anweisungen
-- erstmalig; `0164` nimmt sie in die Plattformsicherung auf. Zusammen, weil
-- ein Archiv ohne die drei Felder jede Menge und jedes Banner verlieren
-- wuerde — und weil der Zwischenzustand niemandem nuetzt.
--
-- *** DIE ZAHL, DIE NICHT FEST CODIERT IST ***
--
-- Auf Staging wurden 21 LightCore-Figuren belegt, auf Production werden es
-- 20. Das ist kein Fehler und keine Abweichung, sondern Rechnen: `0163`
-- traegt eine KURATIERTE Liste von 21 SKY-IDs, und `SKY-0854` existiert auf
-- Production nicht — sie gehoert zu den Staging-Katalogarbeiten (Nachweis:
-- `resources/analysis/prod-ab-0821.csv`, drei Zeilen ab SKY-0821, keine
-- davon SKY-0854). Die Migration belegt mit `= any (liste)` und trifft
-- deshalb genau die vorhandenen.
--
-- DIESE HUELLE RECHNET DIE ZAHL SELBST: A5b zaehlt VOR der Migration, wie
-- viele der kuratierten IDs dieser Katalog hat, und B6c verlangt danach
-- GENAU DIESE Zahl an belegten LightCore-Zeilen. Eine Beziehung, keine
-- Konstante — auf beiden Umgebungen exakt.
--
-- WAS DIE GRUPPE TUT
--
--   0163  `types text[] not null default '{}'`, `visible_type text`,
--         `visible_type_decided boolean not null default false`; drei
--         CHECKs (bekannter Wert · das Banner ist MITGLIED seiner Menge ·
--         ein gesetztes Banner ist entschieden); der BEFORE-Trigger
--         `skylanders_canonical_types`, der jede Menge sortiert und
--         doppelte Werte entfernt; die Erstbelegung in VIER Anweisungen;
--         `admin_set_figure_types(text,text[])` und
--         `admin_set_visible_type(text,text)`; und sie ERSETZT
--         `admin_merge_plan` und `admin_merge_draft(…,jsonb)`, damit die
--         Zusammenfuehrung die Menge mitnimmt. Das Journal kennt danach
--         SECHZEHN Werte.
--   0164  ersetzt `system_platform_export()`: drei Felder mehr, 54 Bereiche
--         unveraendert, Formatversion unveraendert 2. Ihr Tor ist der
--         Abdruck der Fassung aus `0160` (`ff4f38e6…`).
--
-- *** WAS SIE NICHT ANFASST, UND DAS IST DER KERN ***
--
-- DIE KARTENKUNST BLEIBT. `card_type` ist eine EIGENE Spalte und wird nicht
-- aus der Menge abgeleitet (ADR-0160); `cat10_projection_proof.sql` hat
-- gegen 701 Zeilen bewiesen, dass die Projektion nicht verlustfrei ist. A5c
-- legt den Abdruck von `card_type` ab, B5b vergleicht ihn, und bei einer
-- Abweichung rollt die Gruppe zurueck.
--
-- Ebenso unberuehrt: Sichtbarkeit, Status, Familie, Basisfigur, SKY-ID,
-- Serie, Shop, Lager, Sammlung, Bestellungen, Preise, Bilder. Kein Banner
-- wird geraten: die Erstbelegung setzt `visible_type` nur dort, wo
-- `card_type` wirklich Mitglied der Menge ist.
--
-- WAS DIESE HUELLE HINZUFUEGT
--
--   A0     `lock_timeout` und `statement_timeout`.
--   A1-A3  der umgekehrte Umgebungsstempel.
--   A4     Shop- und Sammlungsvertrag, selbst gemessen.
--   A5     der IDENTITAETS- UND ZUSTANDSABDRUCK (sechs Felder: sky_id,
--          series_code, catalog_visible, catalog_status, character_id,
--          base_sky_id) — `card_type` steht getrennt in A5c, damit die
--          Fehlermeldung sagt, WAS sich bewegt hat.
--   A5b    die LightCore-Zahl, aus der kuratierten Liste GERECHNET.
--   A5c    der Abdruck der Kartenkunst.
--   A6     der Eingangszustand: die drei Spalten fehlen, die Riegel fehlen,
--          der Trigger fehlt, die zwei Funktionen fehlen, die zwei
--          Merge-Ruempfe tragen die Abdruecke aus `0157`, der Exportrumpf
--          ist der aus `0160`, das Journal kennt vierzehn Werte.
--   A7     Trigger- und Riegelliste, vorher benannt.
--   B      alles noch einmal: B3 Shop, B4 Sammlung, B5 Identitaet, B5b
--          KARTENKUNST, B6 Zeilenzahl, B6b jede Zeile hat eine Menge, B6c
--          die LightCore-Beziehung, B6d jede Menge kanonisch, B6e jedes
--          Banner Mitglied, B7 ein Trigger mehr, B8 drei Riegel mehr, B9
--          sechzehn Journalwerte, B10 die vier Funktionen, B11 der Export,
--          B12 nichts Bestehendes verschwunden, B13 keine Journalzeile.
--
-- DIE SPERRWIRKUNG
--
-- `skylanders` bekommt `ACCESS EXCLUSIVE` (drei `add column`, drei
-- `add constraint`, ein `create trigger`) und behaelt es bis zum `commit`;
-- der Katalog ist so lange nicht lesbar. Die Erstbelegung schreibt in jede
-- Zeile — bei 624 Zeilen ist das der kleinere Posten, die Messabschnitte
-- dieser Huelle sind der groessere. Zahlen im Testbericht zu G5'.
--
--   `set local lock_timeout = '5s'` · `set local statement_timeout = '300s'`
--
-- VORHER: `supabase/operations/prod-s-preflight-g5.sql` (rein lesend).
-- NACHHER: `supabase/operations/prod-s-postflight-g5.sql` (rein lesend).
-- RUECKNAHME: `supabase/rollback/R0163…` und `R0164…` einzeln.
-- ========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0152.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;
-- ---------------------------------------------------------------------------
-- A4  DIE BEIDEN VERTRAEGE, VON DER HUELLE SELBST GEMESSEN
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', (
with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
select zeile from basis_zeile
), true);

select set_config('skyisles.coll', (
with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
select zeile from coll_zeile
), true);

-- ---------------------------------------------------------------------------
-- A5  IDENTITAET UND ZUSTAND — und die Kartenkunst GETRENNT
-- ---------------------------------------------------------------------------
select set_config('skyisles.ident', (
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-')
           || '|' || coalesce(s.base_sky_id, '-'),
           E'\n' order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

-- A5b  DIE LIGHTCORE-ZAHL, AUS DER KURATIERTEN LISTE GERECHNET.
--      Dieselbe Liste, die `0163` traegt. Auf Staging trifft sie 21 Zeilen,
--      auf Production 20 — die Huelle schreibt keine der beiden Zahlen auf,
--      sie zaehlt sie.
select set_config('skyisles.lightcore', (
  select count(*)::text from public.skylanders s
   where s.sky_id = any (array[
    'SKY-0129', 'SKY-0130', 'SKY-0140', 'SKY-0143', 'SKY-0146',
    'SKY-0157', 'SKY-0159', 'SKY-0166', 'SKY-0171', 'SKY-0172',
    'SKY-0243', 'SKY-0246', 'SKY-0251', 'SKY-0252', 'SKY-0263',
    'SKY-0265', 'SKY-0266', 'SKY-0294', 'SKY-0295', 'SKY-0296',
    'SKY-0854'])
), true);

-- A5c  DER ABDRUCK DER KARTENKUNST. Getrennt, damit die Fehlermeldung sagt,
--      WAS sich bewegt hat (ADR-0160: `card_type` bleibt eine eigene Spalte).
select set_config('skyisles.karte', (
  select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type,
                                E'\n' order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

select set_config('skyisles.zeilen', (
  select count(*)::text from public.skylanders), true);
select set_config('skyisles.journal', (
  select count(*)::text from public.catalog_admin_changes), true);

-- ---------------------------------------------------------------------------
-- A6  DER EINGANGSZUSTAND, VORHER GEPRUEFT
-- ---------------------------------------------------------------------------
do $lauf_a6$
declare
  v_def text;
  v_src text;
  v_n   integer;
begin
  -- a) DIE DREI SPALTEN FEHLEN NOCH.
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders')
     and a.attname in ('types', 'visible_type', 'visible_type_decided')
     and not a.attisdropped;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6a: % der drei Spalten aus 0163 stehen schon. '
      '`add column if not exists` wuerde weiterlaufen und fremde Werte '
      'unberuehrt lassen — das ist auf Production keine Beruhigung.', v_n;
  end if;

  -- b) DIE RIEGEL UND DER TRIGGER FEHLEN NOCH.
  select count(*) into v_n from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname in ('skylanders_types_known', 'skylanders_visible_type_member',
                       'skylanders_visible_type_decided');
  if v_n <> 0 then
    raise exception 'ABBRUCH A6b: % der drei Riegel aus 0163 stehen schon.', v_n;
  end if;
  select count(*) into v_n from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders')
     and t.tgname = 'skylanders_canonical_types';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6c: der Trigger skylanders_canonical_types steht schon.';
  end if;

  -- c) DIE ZWEI NEUEN FUNKTIONEN FEHLEN NOCH.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname in ('admin_set_figure_types', 'admin_set_visible_type');
  if v_n <> 0 then
    raise exception 'ABBRUCH A6d: % der zwei Funktionen aus 0163 liegen schon.', v_n;
  end if;

  -- d) DIE ZWEI RUEMPFE, DIE 0163 ERSETZT, SIND DIE AUS 0157.
  select md5(p.prosrc) into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)');
  if v_src is distinct from 'ef512e9ea093ae36926d3f0333bd0622' then
    raise exception 'ABBRUCH A6e: admin_merge_plan traegt den Abdruck % und '
      'nicht den aus 0157 (ef512e9ea093ae36926d3f0333bd0622). Eine fremde '
      'Fassung wird nicht ueberschrieben.', coalesce(v_src, '(keine)');
  end if;
  select md5(p.prosrc) into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)');
  if v_src is distinct from '0b724dff0bb0fe535e3e5b9ec3573298' then
    raise exception 'ABBRUCH A6f: admin_merge_draft(…,jsonb) traegt den Abdruck '
      '% und nicht den aus 0157 (0b724dff0bb0fe535e3e5b9ec3573298).',
      coalesce(v_src, '(keine)');
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft';
  if v_n <> 2 then
    raise exception 'ABBRUCH A6g: admin_merge_draft liegt % mal vor, erwartet '
      'zwei (die dreiarmige Weiterleitung und die vierarmige).', v_n;
  end if;

  -- e) DER EXPORTRUMPF IST DER AUS 0160.
  select md5(p.prosrc) into v_src from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_src is distinct from 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception 'ABBRUCH A6h: der Exportrumpf ist % und nicht die Fassung '
      'aus 0160 (ff4f38e61cbd4e5857ea914d6be68d44). Fehlt 0160, gehoert G4 '
      'zuerst gefahren.', coalesce(v_src, '(keiner)');
  end if;

  -- f) DIE GRUNDLAGE: card_type, catalog_group, catalog_status, base_sky_id.
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders')
     and a.attname in ('card_type', 'catalog_status', 'base_sky_id')
     and not a.attisdropped;
  if v_n <> 3 then
    raise exception 'ABBRUCH A6i: eine der drei Spalten card_type, '
      'catalog_status, base_sky_id fehlt (gefunden: %).', v_n;
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.categories')
                    and a.attname = 'catalog_group' and not a.attisdropped) then
    raise exception 'ABBRUCH A6j: categories.catalog_group fehlt (0040) — 0163 '
      'leitet die Erstbelegung daraus ab.';
  end if;

  -- g) DAS JOURNAL: vierzehn Werte, types und visible_type noch nicht.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH A6k: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%market_price%' or v_def not like '%deleted%' then
    raise exception 'ABBRUCH A6l: die Journal-Constraint kennt market_price oder '
      'deleted nicht (%) — dann ist 0162 hier nicht angewendet.', v_def;
  end if;
  if v_def like '%visible_type%' then
    raise exception 'ABBRUCH A6m: die Journal-Constraint kennt visible_type '
      'schon — dann liegt 0163 bereits.';
  end if;
  select count(*) into v_n from public.catalog_admin_changes
   where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                       'catalog_group', 'image_override_path', 'card_type',
                       'created', 'catalog_status', 'merged_from', 'discarded',
                       'character_id', 'base_sky_id', 'market_price', 'deleted',
                       'types', 'visible_type');
  if v_n <> 0 then
    raise exception 'ABBRUCH A6n: % Journalzeile(n) tragen ein Feld ausserhalb '
      'der sechzehn. 0163 baut die Constraint ohne not valid neu.', v_n;
  end if;
end
$lauf_a6$;

-- ---------------------------------------------------------------------------
-- A7  TRIGGER UND RIEGEL, VORHER BENANNT
-- ---------------------------------------------------------------------------
select set_config('skyisles.trigger', (
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), true);
/*
 * NUR AUSDRUECKLICHE RIEGEL, UND DAS IST KEIN SCHOENHEITSWUNSCH.
 *
 * Seit PostgreSQL 17 stehen NOT-NULL-Bedingungen als eigene Zeilen in
 * `pg_constraint` (`contype = 'n'`). `0163` legt zwei Spalten mit NOT NULL
 * an, also waechst die Liste dort um FUENF Namen und auf aelteren Fassungen
 * um DREI. Eine Erwartung, die die drei aufzaehlt, haenge damit an der
 * Serverfassung — und die kennt diese Datei nicht.
 *
 * Gezaehlt werden deshalb `c` (CHECK), `f` (Fremdschluessel), `u` (UNIQUE)
 * und `p` (Primaerschluessel). Die NOT-NULL-Zusagen der drei neuen Spalten
 * prueft die Nachkontrolle einzeln (Zeilen 102 und 104), wo sie hingehoeren.
 * Gefunden am 2026-10-30 in PGlite 0.5.10 = PostgreSQL 18.6.
 */
select set_config('skyisles.riegel', (
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.contype in ('c', 'f', 'u', 'p')), true);

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0163_catalog_types.sql
-- ---------------------------------------------------------------------------
-- 0163 — DER TYPE: eine Menge je Artikel, hoechstens ein Banner (CAT-10)
--
-- WAS SIE ANLEGT:
--
--   `skylanders.types`                 text[]  — die vollstaendige Menge
--   `skylanders.visible_type`          text    — der EINE, der als Banner erscheint
--   `skylanders.visible_type_decided`  boolean — hat ein Mensch entschieden?
--
--   `admin_set_figure_types(text, text[])`   schreibt die Menge
--   `admin_set_visible_type(text, text)`     schreibt das Banner
--
-- Dazu zwei Journalwerte, ein normalisierender Trigger, und die zwei
-- Zusammenfuehrungsfunktionen aus `0157` mit je einem Block mehr.
--
-- ===========================================================================
-- WARUM `card_type` BLEIBT, WAS ES IST — DIE FRAGE DES BETREIBERS
-- ===========================================================================
--
-- Naheliegend waere, `card_type` aus der neuen Menge ABZULEITEN: „die
-- Kartenkunst ist der staerkste Variantentype". Der Betreiber hat verlangt,
-- das sorgfaeltig zu pruefen, und die Pruefung faellt dagegen aus.
-- `supabase/checks/cat10_projection_proof.sql` rechnet sie gegen den GANZEN
-- Katalog; zweimal gefahren am 2026-10-29, und die zweite Messung ist die
-- jetzt gueltige:
--
--   1. ES VERLIEREN ZEILEN IHRE KARTENKUNST — und zwischen den zwei
--      Messungen wurden es MEHR.
--
--      Um 11:12 (701 Katalogzeilen) war es EINE: SKY-0854 „White Flocked
--      LightCore Prism Break", damals `card_type = 'standard'`, projiziert
--      `special`. Abdruck `4d6bbb026b37449cc0d2def77949d095`, projiziert
--      `ece2af88f8f9ecaeb985ccfcea5f6b12`.
--
--      Um 13:11 (694 Zeilen, nachdem der Betreiber Varianten uebernommen und
--      zugeordnet und Katalogzeilen bereinigt hat) sind es ZWEI: SKY-0172
--      „Employee Edition LightCore Prism Break" und SKY-0854, beide
--      inzwischen `chase`, beide projiziert `special`. Abdruck
--      `4b81b91886b911d6f9dcbbca0d381be3`, projiziert
--      `5d324fcb766e650b46c7a3c0d15e397b`.
--
--      DIE ZAHL BEWEGT SICH, DER BEFUND NICHT — und genau darum steht in
--      dieser Migration KEIN eingefrorener Abdruck als Riegel, sondern ein
--      Vergleich vor und nach der Erstbelegung (Abschnitt 6). Eine
--      Migration, die eine Kartenkunst veraendert, ist eine Migration, die
--      ein Bild veraendert.
--
--   2. ES GIBT KEINE EINDEUTIGE REIHENFOLGE. `EDITION_RANK` gibt `standard`,
--      `chase` und `elite` denselben Rang 0 — `chase` absichtlich (eine
--      andere Ausfuehrung, keine staerkere Ausgabe), `elite` absichtlich
--      (eine Produktlinie). Eine Menge mit Chase UND Elite hat damit keine
--      fachliche Antwort, sondern nur eine Reihenfolge im Quelltext. Heute
--      kann das nicht vorkommen (eine Spalte); 56 bzw. 42 Zeilen koennten
--      morgen beides tragen.
--
--   3. JEDE TYPAENDERUNG BEWEGTE DIE KARTENKUNST. 488 Zeilen tragen (Stand
--      13:11) keinen Variantentype; bei ihnen aenderte das Hinzufuegen eines
--      Types das Artwork. 206 tragen einen; bei ihnen das Entfernen. 39
--      davon sind im Shop gelistet, 4 stehen in Sammlungen.
--
-- ALSO ZWEI EIGENSCHAFTEN, ZWEI SPALTEN. `card_type` steuert weiter die
-- Kartenkunst (`card-template.ts`, sieben PNG-Dateien), `types` die
-- fachliche Klassifikation, `visible_type` das Banner. Das ist keine zweite
-- Wahrheit, sondern eine zweite FRAGE — dieselbe Trennung, die `0135`
-- zwischen Artikeltyp, Sammelbarkeit, Sichtbarkeit und Shopfaehigkeit zieht.
-- Der Dialog fuehrt beide getrennt und benennt sie getrennt: „Types" und
-- „Kartenkunst".
--
-- ===========================================================================
-- DIE ERSTBELEGUNG — WOHER JEDER TYPE KOMMT
-- ===========================================================================
--
-- Aus STRUKTURIERTEN Daten, nie aus einem Figurennamen (ADR-0034):
--
--   giant · swapper · master · sensei      <- categories.catalog_group
--   item · trap · vehicle · crystal        <- categories.catalog_group
--   mini                                   <- catalog_group 'mini' UND
--                                             Kategorie „Minis"
--   sidekick                               <- catalog_group 'mini' UND
--                                             Kategorie „Sidekicks"
--   special · elite · dark · legendary ·   <- skylanders.card_type
--   chase · prestige
--   lightcore                              <- EINE KURATIERTE LISTE von 21
--                                             SKY-IDs, unten namentlich
--
-- WARUM MINI UND SIDEKICK AN DER KATEGORIE HAENGEN UND NICHT AN DER GRUPPE:
-- „Sidekicks" traegt heute die Gruppe `mini` — 27 Zeilen sind Minis 19 plus
-- Sidekicks 8. Die Gruppe kann die beiden nicht trennen, der KATEGORIENAME
-- kann es. Das ist keine Namensheuristik auf einer Figur, sondern eine
-- kuratierte Kategorie, die der Betreiber selbst angelegt hat.
--
-- WARUM LIGHTCORE EINE LISTE IST UND KEIN MUSTER (Entscheidung D2): es gibt
-- keine strukturierte Quelle dafuer. Im Bestand ist LightCore nur am NAMEN
-- erkennbar, und daraus eine Eigenschaft abzuleiten ist genau das, was
-- ADR-0034 verbietet. Deshalb dieselbe Bauform wie `0032` fuer die 42
-- Eon's-Elite-Zeilen: eine ausgeschriebene, nachlesbare Liste, EINMAL
-- angewendet, danach Handarbeit des Administrators.
--
-- WAS D3 BEDEUTET, UND ES IST DIE EINZIGE GEWOLLTE AENDERUNG AM BILDSCHIRM:
-- eine LightCore bekommt NICHT zusaetzlich den Type `special`, denn `special`
-- war dort nur die Kartenkunst. Folge: die LightCore-Zeilen mit dem
-- Kartentyp `special` zeigen danach LIGHTCORE statt SPECIAL — Stand
-- 2026-10-29 um 13:11 sind das 17 von 21. Ihre KARTENKUNST bleibt `special`
-- und damit unveraendert. Jede andere Varianteneigenschaft wandert mit: die
-- zwei Legendary-LightCores behalten `legendary`, und die zwei, die
-- inzwischen `chase` tragen, behalten `chase`.
--
-- DIE ZAHL STEHT HIER ALS AUSKUNFT UND NICHT ALS RIEGEL. Verschiebt der
-- Betreiber vorher noch eine LightCore von `special` auf `chase`, sind es
-- sechzehn — und das ist richtig so. Die Huelle
-- `supabase/operations/staging-0163.sql` MISST die Zahl vor dem Lauf und
-- vergleicht sie danach; eingefroren ist sie nirgends.
--
-- WAS DIE MIGRATION AM BANNER SONST TUT: `visible_type` wird mit dem
-- vorhandenen `card_type` belegt, wo er zur neuen Menge gehoert (Stand
-- 13:11: 189 Zeilen), und `visible_type_decided` auf `true` gesetzt — damit
-- der Vorschlag diese Entscheidung nie ueberschreibt. Die Zeilen, die nur
-- eine Gruppe tragen (Stand 13:11: 273, davon 251 oeffentlich), bekommen
-- KEIN Banner: sonst erschienen auf einen Schlag neue Banner, und das ist
-- eine Produktentscheidung und keine Nebenwirkung einer Migration
-- (Entscheidung D4).
--
-- ===========================================================================
-- DREI ZUSTAENDE, UND DIE DATENBANK KENNT ALLE DREI
-- ===========================================================================
--
--   visible_type NULL,  decided false   niemand hat entschieden
--   visible_type NULL,  decided true    ausdruecklich „kein Banner"
--   visible_type gesetzt (dann immer decided true)   dieses Banner
--
-- Die Mitgliedschaft — „der sichtbare Type gehoert zur Menge" — ist eine
-- ZEILEN-CHECK und kein Trigger und kein Anwendungsversprechen. Das ist der
-- Grund, warum die Menge als `text[]` auf derselben Zeile steht und nicht in
-- einer Zuordnungstabelle: dort braeuchte dieselbe Regel einen
-- zusammengesetzten Fremdschluessel oder einen Trigger, der Katalogexport
-- einen eigenen Bereich, und `admin_merge_references` wuerde einen neuen
-- Fremdschluessel zaehlen und damit jede Figurenloeschung blockieren.
--
-- WAS SIE NICHT ANFASST: `base_sky_id`, `character_id`, `card_type`, Name,
-- Slug, Serie, Kategorie, Preis, Bild, Sichtbarkeit, Status, Lager,
-- Angebote, Sammlungen, Bestellungen. Gemessen: 178 Zeilen tragen einen
-- Kartentyp ohne Basisfigur — ein Type ist keine Variantenbeziehung
-- (Entscheidung D7).
--
-- REIHENFOLGE: `0162` MUSS VORHER LIEGEN. Beide Migrationen schreiben die
-- Audit-Constraint neu; `0162` nennt ihre vierzehn Werte fest, diese hier
-- baut die Liste aus dem VORGEFUNDENEN Stand plus den eigenen zwei. Laeufe
-- in dieser Reihenfolge verlieren nichts; umgekehrt wuerde `0162` die zwei
-- neuen Werte wieder herauswerfen. Die Vorbedingung unten erzwingt es.
--
-- Ruecknahme: `supabase/rollback/R0163_drop_catalog_types.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.categories') is null
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.categories')
            and a.attname = 'catalog_group' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0040 voraus: categories.catalog_group fehlt — '
      'ohne sie gibt es keine Quelle fuer die Figuren- und Zubehoertypen';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'card_type' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0030 voraus: skylanders.card_type fehlt';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'catalog_status' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0152 voraus: skylanders.catalog_status fehlt';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0163 setzt 0026 voraus: is_platform_admin() fehlt';
  end if;

  /*
   * ZUERST: STEHT SIE SCHON? Diese Frage gehoert VOR die Abdruckpruefung
   * darunter — nach einem Lauf tragen die zwei Zusammenfuehrungsruempfe die
   * Fassung aus `0163`, und ein zweiter Lauf wuerde dann „admin_merge_plan
   * ist nicht die Fassung aus 0157" melden. Richtig, aber irrefuehrend: er
   * prallt ab, weil die Migration schon liegt. Gefunden von Probelauf P72.
   */
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 0 then
    raise exception '0163 Abbruch: eine der drei Spalten steht schon. Diese '
      'Migration ist hier bereits angewendet.';
  end if;

  /*
   * DIE ZWEI RUEMPFE, DIE DIESE MIGRATION ERSETZT. Sie werden nicht blind
   * ueberschrieben: steht hier eine fremde Fassung, gelten die Zusagen
   * nicht, auf die der neue Block aufsetzt (die Allowlist, die
   * Vorschaupruefung, die Reihenfolge der Uebernahme).
   */
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
     is distinct from 'ef512e9ea093ae36926d3f0333bd0622' then
    raise exception '0163 Abbruch: admin_merge_plan ist nicht die Fassung aus '
      '0157. Erst klaeren, dann erweitern.';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     is distinct from '0b724dff0bb0fe535e3e5b9ec3573298' then
    raise exception '0163 Abbruch: admin_merge_draft ist nicht die Fassung aus '
      '0157. Erst klaeren, dann erweitern.';
  end if;

  /*
   * DIE REIHENFOLGE, ALS RIEGEL. `0162` nennt ihre vierzehn Journalwerte
   * fest; lief sie nach dieser Migration, wuerfe sie `types` und
   * `visible_type` wieder heraus, und der erste Typwechsel liefe in `23514`.
   */
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0163: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%''market_price''%' or v_def not like '%''deleted''%' then
    raise exception '0163 setzt 0162 voraus: die Audit-Constraint kennt '
      'market_price und deleted nicht. 0162 zuerst anwenden — sonst wirft sie '
      'die zwei neuen Werte spaeter wieder heraus.';
  end if;

end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die drei Spalten
--
-- `types` ist NOT NULL mit leerem Array als Vorgabe: „kein Type" ist eine
-- Menge und keine Abwesenheit, und `null` waere ein vierter Zustand, den
-- niemand braucht. `visible_type` ist nullbar, weil „kein Banner" genau das
-- ist.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists types                text[]  not null default '{}',
  add column if not exists visible_type         text,
  add column if not exists visible_type_decided boolean not null default false;

comment on column public.skylanders.types is
  'The complete set of TYPES this catalogue article has (0163, CAT-10). An article may be a Giant AND a Legendary; before CAT-10 one column had to choose, and for 192 of 701 rows it chose wrong by omission. Seeded from categories.catalog_group, the category name (Minis vs Sidekicks) and card_type, plus a curated list of 21 LightCore SKY-IDs - never from a figure name (ADR-0034). This is NOT the card artwork: card_type keeps that job, because the projection was measured and is not lossless (see the head of 0163).';

comment on column public.skylanders.visible_type is
  'The ONE type shown as a banner on the tile, or NULL for no banner (0163). Guaranteed by a row CHECK to be a member of types. Never derived at read time: the priority order in src/lib/catalog/catalog-type.ts is a PROPOSAL for the dropdown only, because deriving it would silently put new banners on 248 public tiles.';

comment on column public.skylanders.visible_type_decided is
  'Whether a human has decided about the banner (0163). It separates "nobody has chosen yet" from "explicitly no banner" - two states a single nullable text column cannot tell apart, and the operator asked for both. Setting a banner implies a decision (CHECK); clearing one to an explicit dash keeps this true.';


-- ---------------------------------------------------------------------------
-- 3. Die drei Regeln, als Constraint
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add constraint skylanders_types_known
    check (types <@ array['giant', 'swapper', 'master', 'sensei', 'mini',
                          'sidekick',
                          'item', 'trap', 'vehicle', 'crystal',
                          'lightcore', 'special', 'dark', 'legendary', 'elite',
                          'chase', 'prestige']);

-- DIE MITGLIEDSCHAFT. Eine Zeilen-CHECK, kein Trigger, kein Versprechen der
-- Anwendung: der sichtbare Type MUSS in der Menge stehen.
alter table public.skylanders
  add constraint skylanders_visible_type_member
    check (visible_type is null or visible_type = any (types));

-- UND EIN BANNER HEISST: ENTSCHIEDEN. Ohne diese Zeile waere der Zustand
-- „ein Banner gesetzt, aber niemand hat entschieden" darstellbar, und der
-- Vorschlag duerfte ihn ueberschreiben.
alter table public.skylanders
  add constraint skylanders_visible_type_decided
    check (visible_type is null or visible_type_decided);


-- ---------------------------------------------------------------------------
-- 4. Die Menge ist kanonisch — sortiert und ohne Doppel
--
-- WARUM EIN TRIGGER UND KEINE CONSTRAINT: „keine Doppel" braeuchte eine
-- Unterabfrage, und die sind in einer CHECK nicht erlaubt. Der Trigger
-- macht die Spalte stattdessen kanonisch — sortiert, jeder Wert einmal —,
-- und zwar fuer JEDEN Schreibweg, auch fuer einen Service-Role-Lauf, der die
-- RPC nicht benutzt. Er ist idempotent und kostet bei hoechstens siebzehn
-- Werten nichts.
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_canonical_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.types := coalesce(
    (select array_agg(t order by t) from (select distinct unnest(new.types) as t) x),
    '{}'::text[]);
  return new;
end;
$$;

create trigger skylanders_canonical_types
  before insert or update of types on public.skylanders
  for each row execute function public.skylanders_canonical_types();

comment on function public.skylanders_canonical_types() is
  'Keeps skylanders.types canonical - sorted, each value once - on every write path (0163). A CHECK cannot do it: "no duplicates" needs a subquery. Idempotent, and it never adds or removes a value.';


-- ---------------------------------------------------------------------------
-- 5. Das Journal kennt zwei weitere Werte — ADDITIV, aus dem Vorgefundenen
--
-- Dieselbe Lehre zum fuenften Mal, und diesmal geloest statt wiederholt:
-- `0152` hat einen Wert vergessen, `0157`, `0158`, `0159` und `0162` haben
-- die Liste jeweils neu getippt. Hier wird sie aus dem GEFUNDENEN Stand
-- gebaut — jeder Wert des bekannten Universums, der heute drinsteht, bleibt
-- drin — plus die eigenen zwei. Verlieren kann sie damit keinen.
-- ---------------------------------------------------------------------------
do $journal$
declare
  v_alt    text;
  v_wert   text;
  v_werte  text;
  v_liste  text[] := '{}';
  c_alle   text[] := array[
    'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
    'image_override_path', 'card_type', 'created', 'catalog_status',
    'merged_from', 'discarded', 'character_id', 'base_sky_id',
    'market_price', 'deleted'];
begin
  select pg_get_constraintdef(c.oid) into v_alt
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';

  /*
   * GESUCHT WIRD DER WERT IN ANFUEHRUNGSZEICHEN und nicht als Teilwort:
   * `card_type` steht auch in `visible_type` nicht, aber die Regel soll
   * nicht davon abhaengen, welche Namen zufaellig keine Teilworte sind.
   */
  foreach v_wert in array c_alle loop
    if v_alt like '%''' || v_wert || '''%' then
      v_liste := v_liste || v_wert;
    end if;
  end loop;
  /*
   * ALS ARRAY ANGEHAENGT UND NICHT ALS ZWEI LITERALE. `text[] || 'types'`
   * ist zweideutig: PostgreSQL kennt `anyarray || anyelement` UND
   * `anyarray || anyarray`, und bei einem Literal ohne Typ waehlt es das
   * zweite — „malformed array literal: types". Gefunden von Probelauf P72,
   * und zwar beim ersten Lauf.
   */
  v_liste := v_liste || array['types', 'visible_type'];

  if array_length(v_liste, 1) < 15 then
    raise exception '0163: die vorgefundene Audit-Constraint kennt nur % '
      'bekannte Werte — das ist zu wenig, hier ist etwas anderes passiert: %',
      array_length(v_liste, 1) - 2, v_alt;
  end if;

  select string_agg(quote_literal(w), ', ' order by w) into v_werte
    from unnest(v_liste) as w;

  execute 'alter table public.catalog_admin_changes '
          'drop constraint if exists catalog_admin_changes_field_known';
  execute format(
    'alter table public.catalog_admin_changes '
    'add constraint catalog_admin_changes_field_known check (field in (%s))',
    v_werte);

  raise notice '0163: das Journal kennt jetzt % Werte: %',
    array_length(v_liste, 1), array_to_string(v_liste, ', ');
end
$journal$;


-- ---------------------------------------------------------------------------
-- 6. DIE ERSTBELEGUNG — eine Anweisung, und sie fasst nur die drei neuen
--    Spalten an
--
-- Die kuratierte LightCore-Liste steht hier ausgeschrieben. Erhoben am
-- 2026-10-29 mit `supabase/checks/cat10_projection_proof.sql`, Zeile 103 —
-- dort steht zu jeder SKY-ID der Name und die heutige Kartenkunst, damit die
-- Liste nachlesbar ist und nicht geglaubt werden muss.
-- ---------------------------------------------------------------------------
do $belegung$
declare
  c_lightcore text[] := array[
    'SKY-0129',  -- Chill Light Core
    'SKY-0130',  -- Legendary LightCore Chill            [legendary bleibt]
    'SKY-0140',  -- Jet-Vac Light Core
    'SKY-0143',  -- Pop Fizz Light Core
    'SKY-0146',  -- Shroomboom Light Core
    'SKY-0157',  -- Drobot Light Core
    'SKY-0159',  -- Eruptor Light Core
    'SKY-0166',  -- Hex Light Core
    'SKY-0171',  -- Prism Break Light Core
    'SKY-0172',  -- Employee Edition LightCore Prism Break [Kartenkunst bleibt]
    'SKY-0243',  -- Bumble Blast - Lightcore
    'SKY-0246',  -- Countdown - Lightcore
    'SKY-0251',  -- Grim Creeper - Lightcore
    'SKY-0252',  -- Legendary LightCore Grim Creeper     [legendary bleibt]
    'SKY-0263',  -- Smolderdash LightCore
    'SKY-0265',  -- Star Strike - Lightcore
    'SKY-0266',  -- Enchanted LightCore Star Strike
    'SKY-0294',  -- Flashwing - Lightcore
    'SKY-0295',  -- Warnado - Lightcore
    'SKY-0296',  -- Wham Shell - Lightcore
    'SKY-0854'   -- White Flocked LightCore Prism Break  [Kartenkunst bleibt]
  ];
  v_zeilen   integer;
  v_banner   integer;
  v_kunst    text;
begin
  -- Der Abdruck der Kartenkunst VOR der Belegung. Er muss danach gleich sein.
  select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type, E'\n'
                                 order by s.sky_id)), '(leer)')
    into v_kunst from public.skylanders s;

  update public.skylanders s
     set types = array_remove(array[
           case when c.catalog_group = 'giant'            then 'giant' end,
           case when c.catalog_group = 'swapper'          then 'swapper' end,
           case when c.catalog_group = 'trap_master'      then 'master' end,
           case when c.catalog_group = 'sensei'           then 'sensei' end,
           case when c.catalog_group = 'mini'
                 and c.name = 'Minis'                     then 'mini' end,
           case when c.catalog_group = 'mini'
                 and c.name = 'Sidekicks'                 then 'sidekick' end,
           case when c.catalog_group = 'item'             then 'item' end,
           case when c.catalog_group = 'trap'             then 'trap' end,
           case when c.catalog_group = 'vehicle'          then 'vehicle' end,
           case when c.catalog_group = 'creation_crystal' then 'crystal' end,
           case when s.sky_id = any (c_lightcore)         then 'lightcore' end,
           /*
            * D3: `special` wandert NICHT mit, wenn die Zeile eine LightCore
            * ist — dort war es nur die Kartenkunst. JEDE andere
            * Varianteneigenschaft wandert mit.
            */
           case when s.card_type = 'special'
                 and not (s.sky_id = any (c_lightcore))   then 'special' end,
           case when s.card_type = 'elite'                then 'elite' end,
           case when s.card_type = 'dark'                 then 'dark' end,
           case when s.card_type = 'legendary'            then 'legendary' end,
           case when s.card_type = 'chase'                then 'chase' end,
           case when s.card_type = 'prestige'             then 'prestige' end
         ], null)
    from public.categories c
   where c.id = s.category_id;

  /*
   * ZEILEN OHNE KATEGORIE bekommen nur die Variantentypen. `update … from`
   * laesst sie aus, weil der Verbund sie nicht trifft — deshalb hier noch
   * einmal, ohne Kategorie. (Gemessen gibt es sie heute nicht; eine
   * Belegung, die eine Zeile stillschweigend ueberspringt, waere trotzdem
   * ein Loch.)
   */
  update public.skylanders s
     set types = array_remove(array[
           case when s.sky_id = any (c_lightcore)       then 'lightcore' end,
           case when s.card_type = 'special'
                 and not (s.sky_id = any (c_lightcore)) then 'special' end,
           case when s.card_type = 'elite'              then 'elite' end,
           case when s.card_type = 'dark'               then 'dark' end,
           case when s.card_type = 'legendary'          then 'legendary' end,
           case when s.card_type = 'chase'              then 'chase' end,
           case when s.card_type = 'prestige'           then 'prestige' end
         ], null)
   where s.category_id is null;

  /*
   * DAS BANNER: der heutige Kartentyp, wo er zur neuen Menge gehoert.
   *
   * Die 17 LightCore-Zeilen mit `card_type = 'special'` treffen das NICHT —
   * `special` steht bei ihnen nach D3 nicht in der Menge. Sie bekommen
   * `lightcore` als Banner, und genau das sind die 17 gewollten Wechsel von
   * SPECIAL auf LIGHTCORE.
   */
  update public.skylanders s
     set visible_type = s.card_type, visible_type_decided = true
   where s.card_type <> 'standard' and s.card_type = any (s.types);

  update public.skylanders s
     set visible_type = 'lightcore', visible_type_decided = true
   where s.card_type = 'special' and 'lightcore' = any (s.types);

  select count(*) into v_zeilen from public.skylanders where cardinality(types) > 0;
  select count(*) into v_banner from public.skylanders where visible_type is not null;

  -- UND DIE KARTENKUNST IST UNVERAENDERT. Keine Behauptung, eine Messung.
  if (select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type, E'\n'
                                     order by s.sky_id)), '(leer)')
        from public.skylanders s) is distinct from v_kunst then
    raise exception '0163: die Erstbelegung hat eine Kartenkunst veraendert. '
      'Das darf nicht geschehen — Transaktion abbrechen.';
  end if;

  raise notice '0163: % Zeilen tragen jetzt mindestens einen Type, % tragen ein '
    'Banner. Die Kartenkunst ist unveraendert (%).', v_zeilen, v_banner, v_kunst;
end
$belegung$;


-- ---------------------------------------------------------------------------
-- 7. Die Menge schreiben
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_figure_types(
  p_sky_id text,
  p_types  text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.skylanders%rowtype;
  v_neu   text[];
  v_alt   text[];
  v_wert  text;
  v_sicht text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0163: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := coalesce(v_row.types, '{}');

  /*
   * EINE NULL-MENGE IST DIE LEERE MENGE und kein Fehler: „alle Haekchen
   * abgewaehlt" ist eine gueltige Angabe und heisst Standard.
   */
  v_neu := coalesce(
    (select array_agg(t order by t)
       from (select distinct unnest(coalesce(p_types, '{}'::text[])) as t) x),
    '{}'::text[]);

  /*
   * JEDER WERT WIRD BENANNT ABGEWIESEN. Die CHECK faengt es auch, aber mit
   * einer Meldung, in der der falsche Wert nicht vorkommt.
   */
  foreach v_wert in array v_neu loop
    if not (v_wert = any (array['giant', 'swapper', 'master', 'sensei', 'mini',
                                'sidekick', 'item', 'trap', 'vehicle', 'crystal',
                                'lightcore', 'special', 'dark', 'legendary',
                                'elite', 'chase', 'prestige'])) then
      raise exception '0163: „%" ist kein Type. Erlaubt sind die siebzehn aus '
        'src/lib/catalog/catalog-type.ts.', v_wert;
    end if;
  end loop;

  if v_alt = v_neu then
    return jsonb_build_object('sky_id', p_sky_id, 'types', v_neu,
                              'visible_type', v_row.visible_type,
                              'changed', false);
  end if;

  /*
   * FAELLT DER SICHTBARE TYPE AUS DER MENGE, wird er auf AUSDRUECKLICHES „–"
   * zurueckgesetzt — die Regel, die der Betreiber gewaehlt hat. Nicht auf
   * „unentschieden": sonst schluege der Vorschlag beim naechsten Oeffnen
   * einen anderen vor, und das waere eine Auswahl hinter dem Ruecken des
   * Bedieners.
   */
  v_sicht := case when v_row.visible_type = any (v_neu) then v_row.visible_type
                  else null end;

  update public.skylanders
     set types = v_neu,
         visible_type = v_sicht,
         /*
          * NUR EIN WIRKLICH ENTFERNTES BANNER GILT ALS ENTSCHEIDUNG — siehe
          * dieselbe Stelle in `admin_merge_draft`. Hatte die Zeile kein
          * Banner, bleibt sie unentschieden.
          */
         visible_type_decided = case
           when v_row.visible_type is not null and v_sicht is null then true
           else visible_type_decided end
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'types',
          array_to_string(v_alt, ','), array_to_string(v_neu, ','),
          (select auth.uid()));

  if v_sicht is distinct from v_row.visible_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'visible_type',
            v_row.visible_type, v_sicht, (select auth.uid()));
  end if;

  return jsonb_build_object('sky_id', p_sky_id, 'types', v_neu,
                            'old_types', v_alt,
                            'visible_type', v_sicht,
                            'banner_cleared', (v_sicht is null
                                           and v_row.visible_type is not null),
                            'changed', true);
end;
$$;

comment on function public.admin_set_figure_types(text, text[]) is
  'Replaces the TYPE set of one catalogue row (0163, CAT-10). The set is canonical - sorted, each value once - and every unknown value is refused by name before the CHECK would refuse it anonymously. If the currently visible type falls out of the set, the banner is reset to an EXPLICIT dash (visible_type NULL, decided true), never to "undecided": otherwise the next proposal would pick a different banner behind the operator''s back. It writes three columns and nothing else - no name, no slug, no card_type, no base_sky_id, no character_id - and journals types and, when it moves, visible_type. Platform admins only.';

revoke all on function public.admin_set_figure_types(text, text[]) from public, anon;
grant execute on function public.admin_set_figure_types(text, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Das Banner schreiben
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_visible_type(
  p_sky_id text,
  p_type   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.skylanders%rowtype;
  v_neu text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0163: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- Ein leerer String ist dasselbe wie NULL: „–", kein Banner.
  v_neu := nullif(btrim(coalesce(p_type, '')), '');

  /*
   * NUR EIN HINTERLEGTER TYPE DARF SICHTBAR WERDEN. Die CHECK faengt es
   * auch; diese Meldung sagt, WARUM, und nennt, was zur Wahl stand.
   */
  if v_neu is not null and not (v_neu = any (coalesce(v_row.types, '{}'))) then
    raise exception '0163: „%" ist % nicht zugeordnet. Zur Wahl stehen: %. '
      'Ein Type wird im Bearbeiten-Dialog zugeordnet, nicht hier.',
      v_neu, p_sky_id,
      coalesce(nullif(array_to_string(coalesce(v_row.types, '{}'), ', '), ''),
               '(keiner)');
  end if;

  if v_row.visible_type is not distinct from v_neu and v_row.visible_type_decided then
    return jsonb_build_object('sky_id', p_sky_id, 'visible_type', v_neu,
                              'changed', false);
  end if;

  /*
   * EINE SPALTE UND IHR KENNZEICHEN. `visible_type_decided` wird IMMER
   * `true` — auch und gerade bei „–": das ist der Unterschied zwischen
   * „ausdruecklich kein Banner" und „noch nicht entschieden", und ohne ihn
   * waere die Wahl „–" beim naechsten Oeffnen wieder fort.
   *
   * KEINE ANDERE SPALTE. Kein Type wird hinzugefuegt oder entfernt, keine
   * Kartenkunst bewegt sich, kein Name, kein Status.
   */
  update public.skylanders
     set visible_type = v_neu, visible_type_decided = true
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'visible_type',
          v_row.visible_type, v_neu, (select auth.uid()));

  return jsonb_build_object('sky_id', p_sky_id,
                            'visible_type', v_neu,
                            'old_visible_type', v_row.visible_type,
                            'types', coalesce(v_row.types, '{}'),
                            'changed', true);
end;
$$;

comment on function public.admin_set_visible_type(text, text) is
  'Sets which ONE of a row''s types is shown as its banner, or clears it to an explicit dash (0163, CAT-10). It refuses a type the row does not carry, naming the ones it does - the dropdown offers only those, and assigning a type is the edit dialog''s job. It always sets visible_type_decided, including for the dash: that is what separates "explicitly no banner" from "nobody has chosen", and without it the choice would be gone on the next read. It writes TWO columns and nothing else: no type is added or removed, and card_type - the card artwork - never moves. Platform admins only.';

revoke all on function public.admin_set_visible_type(text, text) from public, anon;
grant execute on function public.admin_set_visible_type(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Die Zusammenfuehrung kennt die Typmenge
--
-- Beide Ruempfe sind die aus `0157`, Zeichen fuer Zeichen, mit JE EINEM
-- Block mehr. Die Vorbedingung oben hat ihre Abdruecke geprueft, bevor hier
-- etwas ersetzt wurde (`ef512e9e…` und `0b724dff…`).
--
-- WARUM DIE MENGE UEBERHAUPT MITMUSS: ein Entwurf aus dem Import traegt
-- keine Types, und dann aendert sich nichts — die Menge des Ziels bleibt
-- unberuehrt, weil der Plan sie nicht nennt. Hat ein Bediener dem Entwurf
-- aber Types gegeben, waeren sie beim Zusammenfuehren still verschwunden.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_plan(
  p_draft      text,
  p_target     text,
  p_image_path text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_plan     jsonb := '[]'::jsonb;
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft;
  if not found then
    raise exception '0157: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target;
  if not found then
    raise exception '0157: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0157: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  if btrim(coalesce(v_draft.name, '')) <> ''
     and v_draft.name is distinct from v_target.name then
    v_plan := v_plan || jsonb_build_object('field', 'name',
      'old', v_target.name, 'new', v_draft.name);
  end if;

  if btrim(coalesce(v_draft.display_name_override, '')) <> ''
     and v_draft.display_name_override is distinct from v_target.display_name_override then
    v_plan := v_plan || jsonb_build_object('field', 'display_name_override',
      'old', v_target.display_name_override, 'new', v_draft.display_name_override);
  end if;

  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_plan := v_plan || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
  end if;

  if v_draft.card_type is not null
     and v_draft.card_type is distinct from v_target.card_type
     and (v_draft.card_type <> c_generisch_card or v_target.card_type = c_generisch_card) then
    v_plan := v_plan || jsonb_build_object('field', 'card_type',
      'old', v_target.card_type, 'new', v_draft.card_type);
  end if;

  if v_draft.item_type is not null
     and v_draft.item_type is distinct from v_target.item_type
     and (v_draft.item_type <> c_generisch_item or v_target.item_type = c_generisch_item) then
    v_plan := v_plan || jsonb_build_object('field', 'item_type',
      'old', v_target.item_type, 'new', v_draft.item_type);
  end if;

  if v_draft.character_id is not null
     and v_draft.character_id is distinct from v_target.character_id then
    v_plan := v_plan || jsonb_build_object('field', 'character_id',
      'old', v_target.character_id::text, 'new', v_draft.character_id::text);
  end if;

  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0157: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_plan := v_plan || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
    end if;
  end if;

  /*
   * DIE NOTIZ STEHT HIER NICHT MEHR (0157).
   *
   * Sie war in `0156` der neunte Planeintrag und bekam eine Kaestchenzeile.
   * Jetzt ist sie keine auswaehlbare Aenderung mehr: die schreibende
   * Funktion verarbeitet sie IMMER, ueber `public.merge_note()`. Ein Plan,
   * der sie weiter nennte, boete der Oberflaeche wieder ein Kaestchen an —
   * und `admin_merge_draft` wuerde eine Auswahl mit `admin_note` jetzt
   * abweisen.
   */

  /*
   * DIE TYPMENGE, ALS NEUNTES FELD (0163).
   *
   * Angeboten wird sie nur, wenn der Entwurf ueberhaupt Types traegt — der
   * Import setzt keine, also ist das der Fall, in dem ein Bediener sie dem
   * Entwurf selbst gegeben hat. Eine LEERE Entwurfsmenge loescht die des
   * Ziels NICHT: dasselbe Muster wie bei `name` und `card_type`, wo eine
   * leere oder generische Angabe des Entwurfs nicht gewinnt.
   *
   * `old` und `new` sind die sortierten Listen als TEXT. Die Auswahl wird
   * ueber genau diese beiden Werte gegengeprueft (Zeile „hat sich seit der
   * Vorschau geaendert"), und ein Array in jsonb waere dort zwei
   * Darstellungen derselben Sache.
   */
  if coalesce(cardinality(v_draft.types), 0) > 0
     and array(select unnest(v_draft.types) order by 1)
         is distinct from array(select unnest(coalesce(v_target.types, '{}'::text[]))
                                 order by 1) then
    v_plan := v_plan || jsonb_build_object('field', 'types',
      'old', array_to_string(array(select unnest(coalesce(v_target.types, '{}'::text[]))
                                    order by 1), ','),
      'new', array_to_string(array(select unnest(v_draft.types) order by 1), ','));
  end if;

  return v_plan;
end;
$$;create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text,
  p_selection  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_plan     jsonb;
  v_eintrag  jsonb;
  v_changed  jsonb   := '[]'::jsonb;
  v_refs     integer := 0;
  v_liste    text    := '';
  v_feld     text;
  v_bild     text    := null;
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  r          record;
  -- DIE ALLOWLIST: ACHT FELDER. `admin_note` ist seit `0157` NICHT mehr
  -- darunter — sie ist keine fachliche Katalogangabe, ueber die der Bediener
  -- Fall fuer Fall entscheidet, und wird unten IMMER verarbeitet.
  -- `types` ist seit `0163` das NEUNTE. `card_type` bleibt daneben stehen:
  -- es ist die Kartenkunst und keine Typmenge (Kopf von `0163`).
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path',
    'types'];
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0157: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0157: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0157: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  if v_draft.catalog_status <> 'draft' then
    raise exception '0157: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0157: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0157: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- DIE AUSWAHL PRÜFEN — vollständig, BEVOR irgendetwas geschrieben ist.
  -- ======================================================================
  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object' then
      raise exception '0157: die Auswahl muss ein Objekt sein, nicht %',
        jsonb_typeof(p_selection);
    end if;

    if p_selection = '{}'::jsonb then
      raise exception '0157: es ist kein Feld zur Übernahme ausgewählt — ohne '
        'Auswahl wird nichts zusammengeführt und nichts geloescht';
    end if;

    -- 1. ALLOWLIST. `admin_note` faellt hier jetzt durch, und das ist der
    --    Riegel gegen eine veraenderte Anfrage: das Entfernen des Kaestchens
    --    ist keine blosse Anzeigeaenderung.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      if not (v_feld = any (c_allow)) then
        raise exception '0157: % ist kein uebernehmbares Feld. Erlaubt sind: %',
          v_feld, array_to_string(c_allow, ', ');
      end if;
    end loop;

    -- 2. SERIE UND KATEGORIE SIND EIN FELD.
    if (p_selection ? 'series_code') <> (p_selection ? 'category_id') then
      raise exception '0157: series_code und category_id sind ein '
        'zusammengesetzter Fremdschluessel — beide auswaehlen oder keinen';
    end if;

    -- 3. DAS BILD: Auswahl und Pfad müssen zusammenpassen.
    if (p_selection ? 'image_override_path')
       and (p_image_path is null or btrim(p_image_path) = '') then
      raise exception '0157: das Bild ist ausgewaehlt, aber es kommt kein '
        'Bildpfad mit';
    end if;
    if not (p_selection ? 'image_override_path')
       and p_image_path is not null and btrim(p_image_path) <> '' then
      raise exception '0157: es kommt ein Bildpfad mit, aber das Bild ist '
        'nicht ausgewaehlt — das bisherige Bild bleibt stehen';
    end if;
  end if;

  -- ======================================================================
  -- DER PLAN. Eine Rechnung, und nicht die des Aufrufers.
  -- ======================================================================
  v_bild := case when p_selection is null then p_image_path
                 when p_selection ? 'image_override_path' then p_image_path
                 else null end;
  v_plan := public.admin_merge_plan(p_draft, p_target, v_bild);

  if p_selection is not null then
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      v_eintrag := null;
      select e.wert into v_eintrag
        from jsonb_array_elements(v_plan) as e(wert)
       where e.wert ->> 'field' = v_feld;
      if v_eintrag is null then
        raise exception '0157: % steht nicht (mehr) zur Uebernahme — die '
          'Vorschau ist veraltet. Bitte neu laden.', v_feld;
      end if;
      if (p_selection -> v_feld -> 'old') is distinct from (v_eintrag -> 'old')
         or (p_selection -> v_feld -> 'new') is distinct from (v_eintrag -> 'new') then
        raise exception '0157: % hat sich seit der Vorschau geaendert '
          '(angezeigt % → %, jetzt % → %). Es wird nichts uebernommen; '
          'bitte neu laden.', v_feld,
          coalesce(p_selection -> v_feld ->> 'old', '—'),
          coalesce(p_selection -> v_feld ->> 'new', '—'),
          coalesce(v_eintrag ->> 'old', '—'),
          coalesce(v_eintrag ->> 'new', '—');
      end if;
    end loop;
  end if;

  -- ======================================================================
  -- DIE ÜBERNAHME.
  -- ======================================================================
  for v_eintrag in select e.wert from jsonb_array_elements(v_plan) as e(wert) loop
    v_feld := v_eintrag ->> 'field';
    if p_selection is not null and not (p_selection ? v_feld) then
      continue;
    end if;

    if v_feld = 'name' then
      update public.skylanders set name = v_draft.name where sky_id = p_target;
    elsif v_feld = 'display_name_override' then
      update public.skylanders set display_name_override = v_draft.display_name_override
       where sky_id = p_target;
    elsif v_feld = 'series_code' then
      update public.skylanders
         set series_code = v_draft.series_code, category_id = v_draft.category_id
       where sky_id = p_target;
    elsif v_feld = 'category_id' then
      null;
    elsif v_feld = 'card_type' then
      update public.skylanders set card_type = v_draft.card_type where sky_id = p_target;
    elsif v_feld = 'item_type' then
      update public.skylanders set item_type = v_draft.item_type where sky_id = p_target;
    elsif v_feld = 'character_id' then
      update public.skylanders set character_id = v_draft.character_id where sky_id = p_target;
    elsif v_feld = 'image_override_path' then
      update public.skylanders set image_override_path = v_eintrag ->> 'new'
       where sky_id = p_target;
    elsif v_feld = 'types' then
      /*
       * DIE MENGE WIRD ERSETZT, NICHT VEREINIGT — und die Vorschau sagt
       * genau das („alt -> neu"). Eine stille Vereinigung waere eine
       * Uebernahme, die der Bediener nicht gesehen hat.
       *
       * UND DER SICHTBARE TYPE ZIEHT MIT. Faellt er aus der neuen Menge,
       * setzt diese Zeile ihn auf ausdrueckliches „–" zurueck; sonst
       * verweigerte die Mitgliedschafts-CHECK das Update, und die
       * Zusammenfuehrung braeche an einer Stelle ab, an der der Bediener
       * nichts falsch gemacht hat.
       */
      update public.skylanders
         set types = v_draft.types,
             visible_type = case when visible_type = any (v_draft.types)
                                 then visible_type else null end,
             /*
              * NUR EIN WIRKLICH ENTFERNTES BANNER GILT ALS ENTSCHEIDUNG. Eine
              * Zeile, die vorher kein Banner hatte, bleibt unentschieden —
              * sonst waere der Vorschlag nach einer Zusammenfuehrung fuer
              * immer stillgelegt, und niemand haette etwas gewaehlt.
              */
             visible_type_decided = case
               when visible_type is null then visible_type_decided
               when visible_type = any (v_draft.types) then visible_type_decided
               else true end
       where sky_id = p_target;
    else
      raise exception '0157: unbekanntes Planfeld % — das ist ein Fehler in '
        '0157 und nicht in der Eingabe', v_feld;
    end if;

    v_changed := v_changed || v_eintrag;
  end loop;

  -- ======================================================================
  -- DIE INTERNE NOTIZ, IMMER UND OHNE KAESTCHEN (0157).
  --
  -- `merge_note()` ist die ganze Regel: Zielnotiz bleibt, veraltete
  -- Importhinweise fallen weg, der Rest wird einmal angehaengt, Leeres
  -- bleibt leer. Sie zaehlt NICHT als Aenderung in `v_changed` — der
  -- Knopf in der Oberflaeche zaehlt nur fachliche Katalogaenderungen.
  -- ======================================================================
  select e.admin_note into v_note from public.catalog_editorial e where e.sky_id = p_draft;
  select e.admin_note into v_zielnote from public.catalog_editorial e where e.sky_id = p_target;
  v_neuenote := public.merge_note(v_zielnote, v_note);
  if v_neuenote is distinct from v_zielnote and btrim(coalesce(v_neuenote, '')) <> '' then
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
      values (p_target, v_neuenote, now())
      on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                         updated_at = now();
  end if;

  -- ---- Der Vorgang ins Journal. `merged_from` ist seit Teil 1 erlaubt.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_target, 'merged_from', p_draft,
          jsonb_array_length(v_changed)::text || ' Feld(er)', (select auth.uid()));

  -- ---- Und erst jetzt der Entwurf.
  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'draft', p_draft, 'target', p_target,
    'changed', v_changed,
    'note_changed', (v_neuenote is distinct from v_zielnote),
    'selected', case when p_selection is null then null
                     else to_jsonb(array(select k.feld
                                           from jsonb_object_keys(p_selection) as k(feld))) end,
    'draft_deleted', true);
end;
$$;
comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge, read-only (0156, narrowed in 0157, extended in 0163). NINE fields now: the eight business fields plus `types`, the TYPE set from CAT-10. A draft with an empty set changes nothing - the plan simply does not name it, and the target keeps its own. card_type stays a separate field beside it, because it is the card artwork and not a type set.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, narrowed in 0157, extended in 0163). NINE selectable business fields - `types` is the ninth; admin_note is still not one of them and is always processed through merge_note(). When the set is taken over it REPLACES the target set rather than uniting with it, exactly as the preview says, and the visible type moves with it: a banner that falls out of the new set is reset to an explicit dash instead of making the CHECK refuse the whole merge. p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch. Values written come from the draft row, never from the call. The TARGET keeps its SKY-ID, slug, status, visibility, price, card artwork and every reference hanging off it. One transaction.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
  v_n     integer;
begin
  -- ---- Die drei Spalten stehen, mit den drei Regeln.
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 3 then
    raise exception '0163 Nachbedingung: eine der drei Spalten fehlt';
  end if;
  for v_def in select unnest(array['skylanders_types_known',
                                   'skylanders_visible_type_member',
                                   'skylanders_visible_type_decided'])
  loop
    if not exists (select 1 from pg_constraint c
                    where c.conrelid = to_regclass('public.skylanders')
                      and c.conname = v_def) then
      raise exception '0163 Nachbedingung: die Constraint % fehlt', v_def;
    end if;
  end loop;

  -- ---- DIE MITGLIEDSCHAFT HAELT IM GANZEN BESTAND.
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not (visible_type = any (types));
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen ein Banner, das nicht '
      'in ihrer Menge steht', v_n;
  end if;
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not visible_type_decided;
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen ein Banner ohne '
      'Entscheidung', v_n;
  end if;

  -- ---- UND DIE MENGE IST KANONISCH.
  select count(*) into v_n from public.skylanders s
   where s.types is distinct from coalesce(
           (select array_agg(t order by t)
              from (select distinct unnest(s.types) as t) x), '{}'::text[]);
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen eine unsortierte oder '
      'doppelte Menge', v_n;
  end if;

  -- ---- Die zwei neuen Funktionen, mit den Attributen.
  for v_def in select unnest(array['public.admin_set_figure_types(text,text[])',
                                   'public.admin_set_visible_type(text,text)'])
  loop
    if to_regprocedure(v_def) is null then
      raise exception '0163 Nachbedingung: % steht nicht', v_def;
    end if;
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_def)
                      and p.prosecdef and p.provolatile = 'v'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0163 Nachbedingung: % hat die Attribute nicht', v_def;
    end if;
    select count(*) into v_offen
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = to_regprocedure(v_def)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
    if v_offen <> 0 then
      raise exception '0163 Nachbedingung: % offene EXECUTE-Rechte auf %',
        v_offen, v_def;
    end if;
  end loop;

  -- ---- Der Trigger steht.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_canonical_types'
                    and not t.tgisinternal) then
    raise exception '0163 Nachbedingung: der Trigger skylanders_canonical_types fehlt';
  end if;

  -- ---- Das Journal kennt types UND visible_type UND alles von vorher.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0163 Nachbedingung: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%''types''%' or v_def not like '%''visible_type''%' then
    raise exception '0163 Nachbedingung: das Journal kennt die zwei neuen Werte '
      'nicht: %', v_def;
  end if;
  foreach v_def in array array['catalog_visible', 'display_name_override',
      'admin_note', 'catalog_group', 'image_override_path', 'card_type',
      'created', 'catalog_status', 'merged_from', 'discarded', 'character_id',
      'base_sky_id', 'market_price', 'deleted']::text[]
  loop
    if (select pg_get_constraintdef(c.oid) from pg_constraint c
         where c.conrelid = to_regclass('public.catalog_admin_changes')
           and c.conname = 'catalog_admin_changes_field_known')
       not like '%''' || v_def || '''%' then
      raise exception '0163 Nachbedingung: der Journalwert % ist verloren', v_def;
    end if;
  end loop;

  -- ---- DIE KARTENKUNST IST UNVERAENDERT, und ihr CHECK auch.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname = 'skylanders_card_type_known';
  if v_def is null or v_def not like '%prestige%' or v_def not like '%elite%' then
    raise exception '0163 Nachbedingung: der CHECK auf card_type ist veraendert: %',
      v_def;
  end if;

  -- ---- UND DIE VARIANTENBEZIEHUNG IST UNBERUEHRT (Entscheidung D7).
  select count(*) into v_n from public.skylanders where base_sky_id is not null;
  raise notice '0163: % Variantenbeziehungen stehen unveraendert', v_n;

  raise notice '0163: types, visible_type und visible_type_decided stehen; die '
    'Mitgliedschaft ist eine CHECK, die Menge ist kanonisch, das Journal kennt '
    'sechzehn Werte, und die Kartenkunst ist nicht angefasst.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0163_catalog_types.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0164_platform_export_types.sql
-- ---------------------------------------------------------------------------
-- 0164 — der TYPE kommt in die Plattformsicherung
--
-- DIESELBE BAUFORM WIE `0153` UND `0160`, zum dritten Mal: EIN Funktionsrumpf
-- wird ersetzt, und am Inhalt sind es genau DREI Zeilen mehr im Bereich
-- `skylanders`:
--
--     'base_sky_id',  t.base_sky_id,
--   + 'types',                t.types,                   <- neu
--   + 'visible_type',         t.visible_type,            <- neu
--   + 'visible_type_decided', t.visible_type_decided,    <- neu
--
-- WARUM ALLE DREI UND NICHT NUR DIE MENGE. `types` allein waere eine halbe
-- Sicherung: nach einer Wiederherstellung stuende die Menge wieder da, aber
-- JEDE Kachel haette ihr Banner verloren — Stand 2026-10-29 tragen 189
-- Zeilen eines (die Zahl folgt dem Katalog), und
-- welches es ist, ist eine redaktionelle Entscheidung und aus nichts
-- ableitbar. `visible_type_decided` muss ebenfalls mit: ohne das Kennzeichen
-- waere „ausdruecklich kein Banner" nach der Wiederherstellung wieder
-- „unentschieden", und der Vorschlag wuerde beim naechsten Oeffnen etwas
-- anderes anbieten. Drei Spalten, drei Aussagen, drei Felder.
--
-- WAS SIE NICHT TUT:
--
--   * **Die Bereichszahl bleibt 54.** Die drei sind FELDER eines bestehenden
--     Bereichs, keine Bereiche. Deshalb bleibt `format_version` bei **2**,
--     und ein Archiv von vorher bleibt lesbar — es traegt die drei Felder
--     einfach nicht, und ein Leser, der sie nicht findet, liest einen Katalog
--     ohne Types. Genau die Zusage, die `0153` und `0160` schon gegeben
--     haben.
--   * **Keine Tabelle, keine Spalte, kein Recht, keine Zeile.** Der Rumpf
--     ist der aus `0160`, Zeichen fuer Zeichen, plus drei Zeilen.
--   * **Die Betriebssicherung bleibt unberuehrt.** `system_business_export()`
--     fuehrt den Katalog als Schnappschuss fuer den VERKAEUFER; ein Type ist
--     eine redaktionelle Angabe der Plattform (ADR-0039) und gehoert nicht in
--     das Archiv des Betriebs. Dieselbe Begruendung, mit der `catalog_status`
--     und `base_sky_id` dort fehlen.
--
-- DREI RIEGEL, wie bei `0153`/`0160`:
--
--   1. `0163` muss liegen — sonst gaebe es die drei Spalten nicht.
--   2. Der vorhandene Rumpf MUSS der aus `0160` sein (`md5`
--      **ff4f38e61cbd4e5857ea914d6be68d44**). Eine fremde Fassung wird nicht
--      blind ueberschrieben.
--   3. Ein zweiter Lauf prallt an Riegel 2 ab, weil der Abdruck danach
--      **7e9e58e2d84a9f8a7c660262aa21926b** ist.
--
-- Ruecknahme: `supabase/rollback/R0164_platform_export_back_to_0160.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_abdruck text;
begin
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0164 setzt 0105 voraus: system_platform_export() fehlt';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 3 then
    raise exception '0164 setzt 0163 voraus: eine der drei Spalten fehlt — '
      'types, visible_type, visible_type_decided';
  end if;

  select md5(p.prosrc) into v_abdruck from pg_proc p
   where p.oid = to_regprocedure('public.system_platform_export()');

  if v_abdruck = '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0164 Abbruch: der Rumpf traegt schon den Abdruck dieser '
      'Migration. Sie ist hier bereits angewendet.';
  end if;
  if v_abdruck is distinct from 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception '0164 Abbruch: der vorhandene Rumpf ist nicht der aus 0160 '
      '(gefunden %). Er wird nicht blind ueberschrieben — erst klaeren.',
      coalesce(v_abdruck, '(keiner)');
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Rumpf aus `0160`, plus drei Zeilen
-- ---------------------------------------------------------------------------
create or replace function public.system_platform_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else jsonb_build_object(

    /* ---- Was nur die Datenbank weiß --------------------------------- */
    'format',         'skyisles-platform-backup',
    'format_version', 2,
    'created_at',     now(),
    'commerce_mode',  (select s.mode from public.commerce_settings s limit 1),
    'snapshot_txid',  pg_current_snapshot()::text,

    /* ---- Die Bereiche, in sechs Gruppen wegen FUNC_MAX_ARGS ---------- */
    'data', (
      /* ---- Katalog — 6 Bereiche, 12 Argumente ---- */
      jsonb_build_object(
        'skylanders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'name', t.name,
            'slug', t.slug,
            'series_code', t.series_code,
            'category_id', t.category_id,
            'market_price', t.market_price::text,
            'price_updated_at', t.price_updated_at,
            'image_file', t.image_file,
            'image_override_path', t.image_override_path,
            'is_active', t.is_active,
            'catalog_visible', t.catalog_visible,
            'catalog_status', t.catalog_status,
            'display_name_override', t.display_name_override,
            'card_type', t.card_type,
            'source', t.source,
            'character_id', t.character_id,
            'base_sky_id', t.base_sky_id,
            'types', t.types,
            'visible_type', t.visible_type,
            'visible_type_decided', t.visible_type_decided,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.skylanders t
        ), '[]'::jsonb),

        'series', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'label', t.label,
            'release_year', t.release_year,
            'position', t.position,
            'created_at', t.created_at
          ) order by t.code)
            from public.series t
        ), '[]'::jsonb),

        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'series_code', t.series_code,
            'position', t.position,
            'name', t.name,
            'catalog_group', t.catalog_group,
            'created_at', t.created_at
          ) order by t.id)
            from public.categories t
        ), '[]'::jsonb),

        'characters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'canonical_name', t.canonical_name,
            'element', t.element,
            'species', t.species,
            'role_type', t.role_type,
            'short_description', t.short_description,
            'source_url', t.source_url,
            'source_label', t.source_label,
            'verified_at', t.verified_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.characters t
        ), '[]'::jsonb),

        'catalog_editorial', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'admin_note', t.admin_note,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.catalog_editorial t
        ), '[]'::jsonb),

        'catalog_admin_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'entity', t.entity,
            'entity_id', t.entity_id,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.catalog_admin_changes t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Nutzer und Sammlung — 2 Bereiche, 4 Argumente ---- */
      jsonb_build_object(
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'username', t.username,
            'display_name', t.display_name,
            'country', t.country,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.profiles t
        ), '[]'::jsonb),

        'collection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'sky_id', t.sky_id,
            'quantity', t.quantity,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.collection_items t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Seller und Shop — 10 Bereiche, 20 Argumente ---- */
      jsonb_build_object(
        'sellers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'display_name', t.display_name,
            'legal_name', t.legal_name,
            'trading_name', t.trading_name,
            'legal_form', t.legal_form,
            'street', t.street,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'direct_contact', t.direct_contact,
            'register_court', t.register_court,
            'register_number', t.register_number,
            'vat_id', t.vat_id,
            'w_id', t.w_id,
            'contact_email', t.contact_email,
            'transactional_reply_to', t.transactional_reply_to,
            'withdrawal_contact_email', t.withdrawal_contact_email,
            'complaints_contact_email', t.complaints_contact_email,
            'small_business_19', t.small_business_19,
            'dispute_participation', t.dispute_participation,
            'dispute_body', t.dispute_body,
            'return_postage_borne_by', t.return_postage_borne_by,
            'dispatch_statement', t.dispatch_statement,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'is_active', t.is_active,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sellers t
        ), '[]'::jsonb),

        'seller_operators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'seller_id', t.seller_id,
            'user_id', t.user_id,
            'is_enabled', t.is_enabled,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.seller_operators t
        ), '[]'::jsonb),

        'shop_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'granted_at', t.granted_at,
            'note', t.note
          ) order by t.user_id)
            from public.shop_admins t
        ), '[]'::jsonb),

        'platform_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'created_at', t.created_at,
            'note', t.note
          ) order by t.user_id)
            from public.platform_admins t
        ), '[]'::jsonb),

        'shop_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'price_percentage', t.price_percentage::text,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_settings t
        ), '[]'::jsonb),

        'platform_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'contact_email', t.contact_email,
            'support_email', t.support_email,
            'catalog_market_boost_percent', t.catalog_market_boost_percent::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.platform_settings t
        ), '[]'::jsonb),

        'commerce_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'mode', t.mode,
            'max_open_checkouts', t.max_open_checkouts,
            'max_reserved_units', t.max_reserved_units,
            'max_orders_per_hour', t.max_orders_per_hour,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.commerce_settings t
        ), '[]'::jsonb),

        'shipping_methods', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'name', t.name,
            'base_price', t.base_price::text,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.code)
            from public.shipping_methods t
        ), '[]'::jsonb),

        'shipping_countries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'country_code', t.country_code,
            'label', t.label,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.country_code)
            from public.shipping_countries t
        ), '[]'::jsonb),

        'legal_document_versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'version', t.version,
            'effective_from', t.effective_from,
            'updated_at', t.updated_at
          ) order by t.slug)
            from public.legal_document_versions t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */
      jsonb_build_object(
        'shop_inventory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'reserved', t.reserved,
            'available_quantity', t.available_quantity,
            'sale_price', t.sale_price::text,
            'is_listed', t.is_listed,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_inventory t
        ), '[]'::jsonb),

        'inventory_movements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'inventory_id', t.inventory_id,
            'delta', t.delta,
            'reason', t.reason,
            'unit_cost', t.unit_cost::text,
            'currency', t.currency,
            'note', t.note,
            'created_at', t.created_at,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchased_at', t.purchased_at,
            'total_cost', t.total_cost::text,
            'currency', t.currency,
            'source', t.source,
            'external_ref', t.external_ref,
            'note', t.note,
            'is_test', t.is_test,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchases t
        ), '[]'::jsonb),

        'purchase_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchase_id', t.purchase_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'raw_name', t.raw_name,
            'state', t.state,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'market_price_source', t.market_price_source,
            'movement_id', t.movement_id,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_items t
        ), '[]'::jsonb),

        'sales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'order_id', t.order_id,
            'sold_at', t.sold_at,
            'shipped_at', t.shipped_at,
            'destination_country_code', t.destination_country_code,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_charged', t.shipping_charged::text,
            'discount_amount', t.discount_amount::text,
            'reported_payout_amount', t.reported_payout_amount::text,
            'reported_payout_ref', t.reported_payout_ref,
            'reported_payout_at', t.reported_payout_at,
            'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
            'external_order_ref', t.external_order_ref,
            'buyer_ref', t.buyer_ref,
            'note', t.note,
            'source', t.source,
            'is_test', t.is_test,
            'cancelled_at', t.cancelled_at,
            'stock_released_at', t.stock_released_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sales t
        ), '[]'::jsonb),

        'sale_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'raw_name', t.raw_name,
            'condition', t.condition,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'movement_id', t.movement_id,
            'returned_at', t.returned_at,
            'return_movement_id', t.return_movement_id,
            'settled_at', t.settled_at,
            'not_shipped_at', t.not_shipped_at,
            'return_announced_at', t.return_announced_at,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sale_items t
        ), '[]'::jsonb),

        'sale_fees', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'kind', t.kind,
            'label', t.label,
            'amount', t.amount::text,
            'settled_by', t.settled_by,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_fees t
        ), '[]'::jsonb),

        'sale_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'amount', t.amount::text,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_refunds t
        ), '[]'::jsonb),

        'settlement_adjustments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'channel', t.channel,
            'amount', t.amount::text,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'occurred_at', t.occurred_at,
            'source', t.source,
            'created_at', t.created_at
          ) order by t.id)
            from public.settlement_adjustments t
        ), '[]'::jsonb),

        'orderbook_name_mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'normalised_name', t.normalised_name,
            'sky_id', t.sky_id,
            'not_a_figure', t.not_a_figure,
            'sample_raw_name', t.sample_raw_name,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.orderbook_name_mappings t
        ), '[]'::jsonb),

        'orderbook_audit', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'action', t.action,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.orderbook_audit t
        ), '[]'::jsonb),

        'seller_monthly_reports', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'period_year', t.period_year,
            'period_month', t.period_month,
            'commerce_mode', t.commerce_mode,
            'finalized_at', t.finalized_at,
            'order_count', t.order_count,
            'order_value', t.order_value::text,
            'merchandise_amount', t.merchandise_amount::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'currency', t.currency,
            'paid_count', t.paid_count,
            'unpaid_count', t.unpaid_count,
            'tax_regime', t.tax_regime,
            'included_orders', t.included_orders
          ) order by t.id)
            from public.seller_monthly_reports t
        ), '[]'::jsonb),

        'purchase_calculations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'name', t.name,
            'status', t.status,
            'lines', t.lines,
            'factor_percent', t.factor_percent,
            'total_cents', t.total_cents,
            'positions', t.positions,
            'units', t.units,
            'purchase_id', t.purchase_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_calculations t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Bestellungen — 18 Bereiche, 36 Argumente ---- */
      jsonb_build_object(
        'orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_number', t.order_number,
            'user_id', t.user_id,
            'customer_email', t.customer_email,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'payment_status', t.payment_status,
            'fulfillment_status', t.fulfillment_status,
            'needs_resolution', t.needs_resolution,
            'placed_at', t.placed_at,
            'paid_at', t.paid_at,
            'shipped_at', t.shipped_at,
            'completed_at', t.completed_at,
            'cancelled_at', t.cancelled_at,
            'updated_at', t.updated_at,
            'tax_regime', t.tax_regime,
            'shipping_method_code', t.shipping_method_code,
            'shipping_method_name', t.shipping_method_name,
            'tracking_number', t.tracking_number,
            'commerce_mode', t.commerce_mode
          ) order by t.id)
            from public.orders t
        ), '[]'::jsonb),

        'order_lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'name_snapshot', t.name_snapshot,
            'image_snapshot', t.image_snapshot,
            'series_snapshot', t.series_snapshot,
            'unit_price', t.unit_price::text,
            'discount_amount', t.discount_amount::text,
            'line_total', t.line_total::text,
            'inventory_id', t.inventory_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_lines t
        ), '[]'::jsonb),

        'order_addresses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'kind', t.kind,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_addresses t
        ), '[]'::jsonb),

        'order_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'event_type', t.event_type,
            'actor_kind', t.actor_kind,
            'payload', t.payload,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_events t
        ), '[]'::jsonb),

        'order_line_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'order_line_id', t.order_line_id,
            'kind', t.kind,
            'quantity', t.quantity,
            'stock_outcome', t.stock_outcome,
            'movement_id', t.movement_id,
            'correction_movement_id', t.correction_movement_id,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'reason_code', t.reason_code,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_line_events t
        ), '[]'::jsonb),

        'order_reservations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'inventory_id', t.inventory_id,
            'quantity', t.quantity,
            'state', t.state,
            'reserved_at', t.reserved_at,
            'expires_at', t.expires_at,
            'released_at', t.released_at,
            'converted_at', t.converted_at,
            'movement_id', t.movement_id,
            'reverted_movement_id', t.reverted_movement_id,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'order_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'amount', t.amount::text,
            'currency', t.currency,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'withdrawal_request_id', t.withdrawal_request_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_refunds t
        ), '[]'::jsonb),

        'order_refund_allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'refund_id', t.refund_id,
            'order_line_id', t.order_line_id,
            'quantity', t.quantity,
            'amount', t.amount::text,
            'allocation_type', t.allocation_type
          ) order by t.id)
            from public.order_refund_allocations t
        ), '[]'::jsonb),

        'order_legal_snapshots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'agb_version', t.agb_version,
            'widerruf_version', t.widerruf_version,
            'seller_name', t.seller_name,
            'seller_legal_name', t.seller_legal_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country_code', t.seller_country_code,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'created_at', t.created_at
          ) order by t.order_id)
            from public.order_legal_snapshots t
        ), '[]'::jsonb),

        'order_messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'author_kind', t.author_kind,
            'body', t.body,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_messages t
        ), '[]'::jsonb),

        'order_conversation_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_conversation_reads t
        ), '[]'::jsonb),

        'order_attention_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_attention_reads t
        ), '[]'::jsonb),

        'order_mail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'kind', t.kind,
            'ref', t.ref,
            'state', t.state,
            'claimed_at', t.claimed_at,
            'sent_at', t.sent_at,
            'attempts', t.attempts,
            'last_error', t.last_error,
            'updated_at', t.updated_at
          ) order by t.order_id, t.kind, coalesce(t.ref, ''))
            from public.order_mail t
        ), '[]'::jsonb),

        'invoices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'invoice_number', t.invoice_number,
            'issued_at', t.issued_at,
            'seller_legal_name', t.seller_legal_name,
            'seller_trade_name', t.seller_trade_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country', t.seller_country,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'customer_name', t.customer_name,
            'customer_company', t.customer_company,
            'customer_street', t.customer_street,
            'customer_postal_code', t.customer_postal_code,
            'customer_city', t.customer_city,
            'customer_country', t.customer_country,
            'customer_email', t.customer_email,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'currency', t.currency,
            'tax_regime', t.tax_regime,
            'lines', t.lines
          ) order by t.id)
            from public.invoices t
        ), '[]'::jsonb),

        'customer_contacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'email', t.email,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.customer_contacts t
        ), '[]'::jsonb),

        'payment_attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'provider', t.provider,
            'status', t.status,
            'amount', t.amount::text,
            'currency', t.currency,
            'created_at', t.created_at,
            'updated_at', t.updated_at,
            'paid_at', t.paid_at,
            'failed_at', t.failed_at
          ) order by t.id)
            from public.payment_attempts t
        ), '[]'::jsonb),

        'payment_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'provider', t.provider,
            'event_type', t.event_type,
            'payment_attempt_id', t.payment_attempt_id,
            'order_id', t.order_id,
            'received_at', t.received_at,
            'processed_at', t.processed_at,
            'outcome', t.outcome
          ) order by t.id)
            from public.payment_events t
        ), '[]'::jsonb),

        'withdrawal_requests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'consumer_name', t.consumer_name,
            'contact_email', t.contact_email,
            'declaration', t.declaration,
            'received_at', t.received_at,
            'receipt_state', t.receipt_state,
            'receipt_sent_at', t.receipt_sent_at,
            'handled_at', t.handled_at,
            'receipt_attempt_at', t.receipt_attempt_at
          ) order by t.id)
            from public.withdrawal_requests t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Tester — 5 Bereiche, 10 Argumente ---- */
      jsonb_build_object(
        'testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.user_id)
            from public.testers t
        ), '[]'::jsonb),

        'tester_permissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'permission', t.permission,
            'granted_at', t.granted_at
          ) order by t.user_id, t.permission)
            from public.tester_permissions t
        ), '[]'::jsonb),

        'tester_features', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', t.key,
            'label', t.label,
            'description', t.description,
            'position', t.position
          ) order by t.key)
            from public.tester_features t
        ), '[]'::jsonb),

        'tester_permission_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'permission', t.permission,
            'action', t.action,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.tester_permission_changes t
        ), '[]'::jsonb),

        'commerce_testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'granted_at', t.granted_at
          ) order by t.user_id)
            from public.commerce_testers t
        ), '[]'::jsonb)
      )
    )
  ) end;
$$;

comment on function public.system_platform_export() is
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153, 0160 and 0164) - the archive file database.json. 54 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and simply carry 53 sections. 0153 added skylanders.catalog_status (0152), 0160 added skylanders.base_sky_id (0159), and 0164 adds the CAT-10 type system - types, visible_type and visible_type_decided (0163). All of those are FIELDS, not sections, so format_version stays 2 and older version-2 archives without them stay readable. Each one would be a real loss: without catalog_status a draft could not be told from a hidden row, without base_sky_id every variant would come back as a figure of its own, and without the three type fields a restored catalogue would keep its sets but lose every banner - which is editorial and derivable from nothing. There is still no restore - format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_abdruck text;
  v_laenge  integer;
  v_offen   integer;
begin
  select md5(p.prosrc), length(p.prosrc) into v_abdruck, v_laenge
    from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()');

  if v_abdruck is distinct from '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception '0164 Nachbedingung: der Rumpf traegt den Abdruck % statt '
      '7e9e58e2d84a9f8a7c660262aa21926b', coalesce(v_abdruck, '(keiner)');
  end if;
  if v_laenge <> 31248 then
    raise exception '0164 Nachbedingung: der Rumpf ist % Zeichen lang, erwartet '
      'sind 31248', v_laenge;
  end if;

  -- DIE DREI FELDER STEHEN DRIN, jedes einzeln nachgewiesen.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''types'', t.types,%') then
    raise exception '0164 Nachbedingung: das Feld types fehlt im Rumpf';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''visible_type'', t.visible_type,%') then
    raise exception '0164 Nachbedingung: das Feld visible_type fehlt im Rumpf';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like
                        '%''visible_type_decided'', t.visible_type_decided,%') then
    raise exception '0164 Nachbedingung: das Feld visible_type_decided fehlt '
      'im Rumpf';
  end if;

  -- UND DIE FELDER AUS 0153 UND 0160 STEHEN NOCH.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''base_sky_id'', t.base_sky_id,%'
                    and p.prosrc like '%''catalog_status'', t.catalog_status,%') then
    raise exception '0164 Nachbedingung: ein Feld aus 0153 oder 0160 ist verloren';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosrc like '%''format_version'', 2,%') then
    raise exception '0164 Nachbedingung: format_version ist nicht mehr 2';
  end if;

  -- Die Attribute und die Rechte, unveraendert.
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure('public.system_platform_export()')
                    and p.prosecdef
                    and (select count(*) = 1
                           from unnest(coalesce(p.proconfig, '{}')) c
                          where c like 'search\_path=%')) then
    raise exception '0164 Nachbedingung: die Attribute der Funktion stimmen nicht';
  end if;
  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public',
                                                        'service_role'));
  if v_offen <> 0 then
    raise exception '0164 Nachbedingung: % offene EXECUTE-Rechte auf dem Export',
      v_offen;
  end if;

  raise notice '0164: Rumpf %, 54 Bereiche, format_version 2, drei Felder mehr, '
    'keine Zeile angefasst.', v_abdruck;
end
$nach$;
-- <<< ENDE: supabase/migrations/0164_platform_export_types.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- B  DERSELBE MASSSTAB, NOCH EINMAL — UND DER VERGLEICH, DER ZURUECKROLLT
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_vor_base  text := current_setting('skyisles.base', true);
  v_vor_coll  text := current_setting('skyisles.coll', true);
  v_vor_ident text := current_setting('skyisles.ident', true);
  v_vor_lc    text := current_setting('skyisles.lightcore', true);
  v_vor_karte text := current_setting('skyisles.karte', true);
  v_vor_zeil  text := current_setting('skyisles.zeilen', true);
  v_vor_jour  text := current_setting('skyisles.journal', true);
  v_vor_trig  text := current_setting('skyisles.trigger', true);
  v_vor_rieg  text := current_setting('skyisles.riegel', true);
  v_nach_base text;
  v_nach_coll text;
  v_nach      text;
  v_def       text;
  v_n         integer;
begin
  if v_vor_base is null or btrim(v_vor_base) = '' then
    raise exception 'ABBRUCH B1: die Shop-Baseline fehlt (A4 hat sie nicht gesetzt).';
  end if;
  if v_vor_coll is null or btrim(v_vor_coll) = '' then
    raise exception 'ABBRUCH B2: die Sammlungs-Baseline fehlt (siehe B1).';
  end if;
  if v_vor_ident is null or v_vor_lc is null or v_vor_karte is null
     or v_vor_zeil is null or v_vor_jour is null or v_vor_trig is null
     or v_vor_rieg is null then
    raise exception 'ABBRUCH B2b: eine Ablage aus A5/A5b/A5c/A7 fehlt.';
  end if;

  with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
  select zeile into v_nach_base from basis_zeile;
  if v_nach_base is distinct from v_vor_base then
    raise exception 'ABBRUCH B3: Shop, Lager oder Katalog haben sich veraendert. '
      'VORHER % — NACHHER %.', v_vor_base, v_nach_base;
  end if;

  with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
  select zeile into v_nach_coll from coll_zeile;
  if v_nach_coll is distinct from v_vor_coll then
    raise exception 'ABBRUCH B4: die Sammlung hat sich veraendert. VORHER % — '
      'NACHHER %.', v_vor_coll, v_nach_coll;
  end if;

  -- B5  IDENTITAET UND ZUSTAND unveraendert.
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-')
           || '|' || coalesce(s.base_sky_id, '-'),
           E'\n' order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_ident then
    raise exception 'ABBRUCH B5: SKY-ID, Serie, Sichtbarkeit, Status, Familie '
      'oder Basisfigur einer Katalogzeile haben sich veraendert. Abdruck vorher '
      '%, nachher %.', v_vor_ident, v_nach;
  end if;

  -- B5b  DIE KARTENKUNST IST ZEICHENGLEICH. Das ist die Zusage aus ADR-0160:
  --      der Type ist eine MENGE, `card_type` bleibt eine eigene Spalte.
  select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type,
                                E'\n' order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_karte then
    raise exception 'ABBRUCH B5b: die KARTENKUNST hat sich bewegt — vorher %, '
      'nachher %. 0163 darf card_type nicht anfassen; die Projektion aus der '
      'Menge ist nicht verlustfrei (ADR-0160).', v_vor_karte, v_nach;
  end if;

  select count(*) into v_n from public.skylanders;
  if v_n::text is distinct from v_vor_zeil then
    raise exception 'ABBRUCH B6: der Katalog hat jetzt % Zeilen, vorher %.', v_n, v_vor_zeil;
  end if;

  -- B6b  JEDE ZEILE HAT EINE MENGE, und keine ist NULL.
  select count(*) into v_n from public.skylanders where types is null;
  if v_n <> 0 then
    raise exception 'ABBRUCH B6b: % Zeile(n) haben keine Menge.', v_n;
  end if;

  -- B6c  DIE LIGHTCORE-BEZIEHUNG. Keine Konstante: A5b hat gezaehlt, wie
  --      viele der kuratierten IDs dieser Katalog hat; genau so viele muessen
  --      jetzt `lightcore` in ihrer Menge tragen. Auf Staging 21, auf
  --      Production 20 — und die Pruefung ist auf beiden exakt.
  select count(*) into v_n from public.skylanders where 'lightcore' = any (types);
  if v_n::text is distinct from v_vor_lc then
    raise exception 'ABBRUCH B6c: % Zeilen tragen lightcore, erwartet % — so '
      'viele IDs der kuratierten Liste hat dieser Katalog. Eine Abweichung '
      'heisst, dass die Erstbelegung etwas anderes getroffen hat als die '
      'Liste.', v_n, v_vor_lc;
  end if;
  select count(*) into v_n from public.skylanders s
   where 'lightcore' = any (s.types)
     and not (s.sky_id = any (array[
    'SKY-0129', 'SKY-0130', 'SKY-0140', 'SKY-0143', 'SKY-0146',
    'SKY-0157', 'SKY-0159', 'SKY-0166', 'SKY-0171', 'SKY-0172',
    'SKY-0243', 'SKY-0246', 'SKY-0251', 'SKY-0252', 'SKY-0263',
    'SKY-0265', 'SKY-0266', 'SKY-0294', 'SKY-0295', 'SKY-0296',
    'SKY-0854']));
  if v_n <> 0 then
    raise exception 'ABBRUCH B6d: % Zeile(n) tragen lightcore, ohne in der '
      'kuratierten Liste zu stehen.', v_n;
  end if;

  -- B6e  JEDE MENGE IST KANONISCH, und jedes Banner ist Mitglied.
  select count(*) into v_n from public.skylanders s
   where s.types is distinct from coalesce(
           (select array_agg(t order by t) from (select distinct unnest(s.types) as t) x),
           '{}'::text[]);
  if v_n <> 0 then
    raise exception 'ABBRUCH B6e: % Menge(n) sind nicht kanonisch (sortiert, '
      'ohne Doppelte).', v_n;
  end if;
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not (visible_type = any (types));
  if v_n <> 0 then
    raise exception 'ABBRUCH B6f: % Banner sind nicht Mitglied ihrer Menge.', v_n;
  end if;
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not visible_type_decided;
  if v_n <> 0 then
    raise exception 'ABBRUCH B6g: % Zeile(n) haben ein Banner, ohne entschieden '
      'zu sein.', v_n;
  end if;

  -- B7  GENAU EIN TRIGGER MEHR.
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    into v_nach from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal;
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(case when v_vor_trig = '(keine)' then array[]::text[]
                         else string_to_array(v_vor_trig, ',') end
                    || array['skylanders_canonical_types']) as x) then
    raise exception 'ABBRUCH B7: die Triggerliste ist % — erwartet die '
      'vorgefundene plus skylanders_canonical_types. VORHER: %', v_nach, v_vor_trig;
  end if;

  -- B8  GENAU DREI RIEGEL MEHR.
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    into v_nach from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.contype in ('c', 'f', 'u', 'p');
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(case when v_vor_rieg = '(keine)' then array[]::text[]
                         else string_to_array(v_vor_rieg, ',') end
                    || array['skylanders_types_known',
                             'skylanders_visible_type_member',
                             'skylanders_visible_type_decided']) as x) then
    raise exception 'ABBRUCH B8: die Riegelliste ist % — erwartet die '
      'vorgefundene plus die drei aus 0163. VORHER: %', v_nach, v_vor_rieg;
  end if;

  -- B9  DAS JOURNAL KENNT SECHZEHN WERTE.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH B9: die Journal-Constraint ist verschwunden.';
  end if;
  if v_def not like '%visible_type%' or v_def not like '%types%' then
    raise exception 'ABBRUCH B9b: die Journal-Constraint kennt types oder '
      'visible_type nicht (%). Dann scheitert jede Typaenderung mit 23514.', v_def;
  end if;
  if v_def not like '%market_price%' or v_def not like '%deleted%'
     or v_def not like '%base_sky_id%' or v_def not like '%character_id%'
     or v_def not like '%catalog_status%' or v_def not like '%created%' then
    raise exception 'ABBRUCH B9c: ein alter Journalwert ist verloren (%).', v_def;
  end if;

  -- B10  DIE VIER FUNKTIONEN.
  if to_regprocedure('public.admin_set_figure_types(text,text[])') is null then
    raise exception 'ABBRUCH B10: admin_set_figure_types fehlt.';
  end if;
  if to_regprocedure('public.admin_set_visible_type(text,text)') is null then
    raise exception 'ABBRUCH B10b: admin_set_visible_type fehlt.';
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname in ('admin_set_figure_types', 'admin_set_visible_type');
  if v_n <> 2 then
    raise exception 'ABBRUCH B10c: % Fassungen der zwei neuen Funktionen, '
      'erwartet zwei — eine Ueberladung waere eine zweite Funktion mit '
      'demselben Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft';
  if v_n <> 2 then
    raise exception 'ABBRUCH B10d: admin_merge_draft liegt % mal vor, erwartet '
      'zwei — 0163 ERSETZT die vierarmige, sie ueberlaedt nicht.', v_n;
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
     not like '%types%' then
    raise exception 'ABBRUCH B10e: admin_merge_plan nennt types nicht — dann '
      'nimmt die Zusammenfuehrung die Menge nicht mit.';
  end if;
  select count(*) into v_n from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_set_figure_types(text,text[])'),
                   to_regprocedure('public.admin_set_visible_type(text,text)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_n <> 0 then
    raise exception 'ABBRUCH B10f: % offene EXECUTE-Recht(e) auf den zwei neuen '
      'Funktionen.', v_n;
  end if;

  -- B11  DER EXPORT FUEHRT DIE DREI FELDER.
  select md5(p.prosrc) into v_nach from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_nach <> '7e9e58e2d84a9f8a7c660262aa21926b' then
    raise exception 'ABBRUCH B11: der Exportrumpf ist % und nicht die Fassung '
      'aus 0164 (7e9e58e2d84a9f8a7c660262aa21926b).', v_nach;
  end if;
  select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
          / length('coalesce((')) into v_n from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_n <> 54 then
    raise exception 'ABBRUCH B11b: % Bereiche statt 54.', v_n;
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.system_platform_export()'))
     not like '%''format_version'', 2,%' then
    raise exception 'ABBRUCH B11c: die Formatversion ist nicht mehr 2.';
  end if;

  -- B12  NICHTS BESTEHENDES IST VERSCHWUNDEN.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_variant_auto(text,text)') is null
     or to_regprocedure('public.admin_set_market_price(text,numeric)') is null
     or to_regprocedure('public.admin_delete_figure(text)') is null
     or to_regprocedure('public.admin_merge_references(text)') is null
     or to_regprocedure('public.admin_discard_draft(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_set_catalog_status(text,text)') is null
     or to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is null then
    raise exception 'ABBRUCH B12: eine bestehende Adminfunktion ist verschwunden.';
  end if;

  -- B13  KEINE JOURNALZEILE GESCHRIEBEN. Die Erstbelegung ist keine
  --      redaktionelle Aenderung, sondern die Einfuehrung der Spalte.
  select count(*) into v_n from public.catalog_admin_changes;
  if v_n::text is distinct from v_vor_jour then
    raise exception 'ABBRUCH B13: das Journal hat jetzt % Zeilen, vorher %.', v_n, v_vor_jour;
  end if;

  raise notice '0163-0164 auf Production: jede der % Katalogzeilen hat eine '
    'Menge, % tragen lightcore (so viele IDs hat die kuratierte Liste hier), '
    'die Kartenkunst ist zeichengleich, das Journal kennt sechzehn Werte, der '
    'Export fuehrt types und visible_type.', v_vor_zeil, v_vor_lc;
end
$lauf_b$;

commit;
