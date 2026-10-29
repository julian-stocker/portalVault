-- ========================================================================
-- PRODUCTION — GRUPPE G2': EIN LAUF FUER 0152 BIS 0158
--              (der redaktionelle Status, der Export, das Zusammenfuehren,
--               das Verwerfen, die Feldauswahl, die Pruefspur und die
--               Figurenfamilien — SIEBEN Migrationen, EINE Transaktion)
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
-- WARUM DIESE SIEBEN ZUSAMMEN FAHREN MUESSEN — der eigentliche Grund
-- ========================================================================
--
-- `0152` laesst den Journaltrigger das Feld `catalog_status` schreiben,
-- nimmt den Namen aber nicht in `catalog_admin_changes_field_known` auf.
-- `0157` tut es. Zwischen den beiden scheitert deshalb JEDER Statuswechsel
-- mit `23514` — und zwar nicht nur der neue Weg, sondern auch die HEUTE
-- DEPLOYTE `admin_set_catalog_visible(text,boolean)`: sie schreibt
-- `catalog_visible`, der BEFORE-Trigger leitet `catalog_status` ab, der
-- AFTER-Trigger will beides journalisieren, und die Constraint weist das
-- zweite Feld ab. Die Transaktion der Funktion rollt zurueck; der
-- Adminbereich zeigt einen Fehler.
--
-- WUERDEN wir `0152` allein fahren, waere Production genau so lange in
-- diesem Zustand, wie es bis `0157` dauert. Fuenf Migrationen und zwei
-- Pruefdurchgaenge spaeter waere das eine halbe Stunde, in der niemand eine
-- Figur verstecken oder veroeffentlichen kann — ohne dass irgendeine
-- Fehlermeldung sagt, warum. Deshalb: ein `begin`, sieben Migrationen in
-- numerischer Reihenfolge, ein `commit`. VOR dem `commit` ist die Constraint
-- erweitert (`0157`, dann `0158`), und der fehlerhafte Zwischenzustand ist
-- nie veroeffentlicht worden — nicht fuer eine Sekunde, nicht fuer eine
-- andere Sitzung. Die Nachkontrolle beweist das in ihrer Zeile 253.
--
-- DIE SIEBEN, IN DER REIHENFOLGE, IN DER SIE HIER STEHEN
-- ========================================================================
--
--   0152  `catalog_status` (text, drei Werte), Backfill aus
--         `catalog_visible` in JEDE Katalogzeile, zwei CHECKs, der
--         BEFORE-Trigger `skylanders_sync_catalog_status`,
--         `admin_set_catalog_status(text,text)`, und sie ERSETZT
--         `log_skylander_editorial_change()` und `admin_create_figure`.
--   0153  die Plattformsicherung nimmt das Feld `catalog_status` auf. Ihr
--         Tor ist der Rumpfabdruck aus `0144` (`4c4d2e7c…`) — sie
--         ueberschreibt keine fremde Fassung.
--   0154  `admin_merge_references(text)` und `admin_merge_draft(…)`: einen
--         Entwurf in eine bestehende Figur zusammenfuehren. Ein Entwurf mit
--         fremden Referenzen wird NICHT geloescht.
--   0155  `admin_discard_draft(text)`: einen Entwurf verwerfen.
--   0156  `admin_merge_plan(…)` und `admin_merge_draft(…,jsonb)`: die
--         Feldauswahl. Die dreiarmige Fassung aus `0154` BLEIBT als
--         Weiterleitung stehen — deployter Code findet sie weiter.
--   0157  die Pruefspur: die Journal-Constraint kennt drei Werte mehr
--         (`catalog_status`, `merged_from`, `discarded`), `merge_note(…)`
--         als einzige Stelle fuer die automatische Notiz.
--   0158  die Figurenfamilien: ein elfter Journalwert (`character_id`),
--         `admin_create_character`, `admin_set_character`,
--         `admin_publish_as_variant`.
--
-- JEDE DER SIEBEN BRINGT IHRE EIGENEN `do $vor$`- UND `do $nach$`-BLOECKE
-- MIT, und die wirken hier unveraendert. Scheitert einer davon — etwa
-- `0153`, weil der Exportrumpf nicht der aus `0144` ist —, rollt die GANZE
-- Gruppe zurueck. Keine der sieben traegt eine eigene
-- Transaktionsklammer; mechanisch geprueft (`staging-oneshot.test.ts`).
--
-- WAS DIESE HUELLE HINZUFUEGT, WEIL DIE SIEBEN ES NICHT TUN
-- ========================================================================
--
--   A1-A3  der umgekehrte Umgebungsstempel: sie bricht auf Staging ab.
--   A0     `lock_timeout` und `statement_timeout` — siehe DIE SPERRWIRKUNG.
--   A4     Shop- und Sammlungsvertrag, von der Huelle SELBST gemessen.
--          Kein Platzhalter, kein Kopieren, keine Prüfsumme von Hand.
--   A5     der SICHTBARKEITS-ABDRUCK aller Katalogzeilen (sky_id und
--          catalog_visible, Zeile fuer Zeile) plus die zwei Zahlen, aus
--          denen der Backfill ableitet, plus der Journalstand.
--   A6     der EINGANGSZUSTAND: die drei zu ersetzenden Ruempfe auf ihre
--          Eigenschaften geprueft, die zehn anzulegenden Funktionen auf
--          Abwesenheit, der Exportabdruck, die Constraint. Keine der sieben
--          Migrationen prueft den vorgefundenen Rumpf von
--          `log_skylander_editorial_change()` oder `admin_create_figure`.
--   A7     die Triggerliste an `skylanders`, vorher benannt.
--   B      alles davon noch einmal, Vergleich, und `raise exception` bei
--          jeder Abweichung: B3 Shop, B4 Sammlung, B5 Sichtbarkeit Zeile fuer
--          Zeile, B6/B7 der Backfill trifft genau die zwei Zahlen, B8 kein
--          Entwurf, B9 genau ein Trigger mehr, B10 jede angelegte Funktion
--          genau so oft wie erwartet, B11 `admin_create_figure` ersetzt und
--          nicht ueberladen, B12 die Constraint kennt elf Werte, B13 der
--          Exportrumpf ist der aus `0153`, B14 keine Journalzeile geschrieben.
--
-- DIE SPERRWIRKUNG, UND WAS SIE WIRKLICH KOSTET
-- ========================================================================
--
-- EINE TRANSAKTION HAELT IHRE SPERREN BIS ZUM `commit`. Das ist der Preis
-- der Atomaritaet, und er ist hier bezifferbar:
--
--   * `skylanders` bekommt `ACCESS EXCLUSIVE` (drei `alter table`, ein
--     `create trigger`) und behaelt es bis zum Ende. Lesen ist DANN NICHT
--     MEHR MOEGLICH — der Katalog, die Shopseiten und jede Sammlungsanzeige
--     warten, bis die Gruppe fertig ist.
--   * `catalog_admin_changes` bekommt `ACCESS EXCLUSIVE` zweimal (`0157`,
--     `0158`), je mit Validierung der bestehenden Zeilen.
--   * die Funktionsersetzungen sperren nur Katalogzeilen in `pg_proc`.
--
-- GEMESSEN, NICHT GESCHAETZT (PGlite, echtes PostgreSQL, Stub-Schema):
-- die Gruppe laeuft bei 624 Katalogzeilen in der Groessenordnung einiger
-- hundert Millisekunden; der Backfill selbst ist der kleinste Posten,
-- die 54 Bereiche des Exportrumpfs und die drei Constraint-Neubauten sind
-- die groesseren. Die Messwerte stehen im Testbericht zur Gruppe, mit einem
-- zweiten Lauf bei kuenstlich vervielfachter Zeilenzahl, damit die Zahl
-- nicht nur fuer 624 gilt.
--
-- DAS HEISST FUER DEN BETRIEB: ein kurzer Augenblick, in dem der Katalog
-- nicht lesbar ist. Kein Einkauf bricht ab (Stripe und die Bestelltabellen
-- sind nicht beteiligt), aber eine Seite kann in dieser Zeit laenger laden.
-- Deshalb:
--
--   `set local lock_timeout = '5s'` — WARTET NICHT ENDLOS. Haelt eine
--   andere Sitzung eine Sperre auf `skylanders` (ein langer Import, ein
--   offenes `begin` im Editor), bricht die Gruppe nach fuenf Sekunden ab,
--   statt den Katalog beliebig lange blockiert zu halten. Ein Abbruch hier
--   ist kostenlos: es ist noch nichts committet.
--
--   `set local statement_timeout = '600s'` — eine Obergrenze je Anweisung.
--   Keine der sieben braucht annaehernd so lange; die Grenze ist die
--   Notbremse gegen eine Anweisung, die aus einem unerwarteten Grund haengt.
--
-- Und die Reihenfolge ist Absicht: die Timeouts stehen VOR dem Stempel, also
-- vor dem ersten Zugriff auf `skylanders`.
--
-- WAS DIE GRUPPE NICHT ANFASST: keine RLS-Politik — `skylanders_select_anon`
-- und `skylanders_select_authenticated` lesen weiter `is_active and
-- catalog_visible`; keinen Index; keine Sicht; kein `shop_offers()`; keine
-- SKY-ID; keine Sammlungs-, Favoriten-, Lager- oder Angebotsbeziehung; keine
-- Bestellung, keinen Preis, kein Bild. `admin_set_catalog_visible(text,
-- boolean)` bleibt stehen und funktioniert nach der Gruppe wieder
-- vollstaendig — vorher auch, aber nur, weil die Constraint-Luecke nie
-- veroeffentlicht wird.
--
-- RUECKWAERTSKOMPATIBILITAET VON `admin_create_figure`: die Signatur ist
-- ZEICHENGLEICH die aus `0034` — acht Parameter, dieselben Namen, dieselbe
-- Reihenfolge, dieselben Vorgabewerte. PostgREST loest ueber Namen auf; der
-- deployte Anwendungscode ruft sie unveraendert. A6d/A6e stellen vorher
-- sicher, dass es GENAU EINE Fassung mit dieser Signatur gibt — sonst waere
-- die Ersetzung eine Ueberladung. B11 prueft es danach.
--
-- DASSELBE FUER `admin_merge_draft`: nach der Gruppe gibt es ZWEI Fassungen,
-- und das ist Absicht (`0156` laesst die dreiarmige als Weiterleitung
-- stehen). B10 erwartet deshalb bei diesem einen Namen die Zahl 2 und bei
-- allen anderen die Zahl 1.
--
-- VORHER: `supabase/operations/prod-s-preflight-g2.sql` (rein lesend).
-- NACHHER: `supabase/operations/prod-s-postflight-g2.sql` (rein lesend).
-- RUECKNAHME: die Gruppe ist nicht vorgesehen zurueckzunehmen; einzeln
-- liegen `supabase/rollback/R0152_drop_catalog_status.sql` und die
-- Gegenstuecke der uebrigen sechs.
-- ========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
--
-- `set local` gilt bis zum `commit` und ist mit ihm fort. Siehe DIE
-- SPERRWIRKUNG im Kopf.
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '600s';

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
--
-- KEIN PLATZHALTER, KEIN KOPIEREN. Die Messung ist zeichengleich die der
-- Pruefdateien; abgelegt wird transaktionslokal und mit dem `commit` fort.
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
-- A5  DER SICHTBARKEITS-ABDRUCK ALLER KATALOGZEILEN
--
-- `0152` schreibt in JEDE Katalogzeile. Was sich dabei nicht bewegen darf,
-- ist die Sichtbarkeit — an ihr haengen RLS, der Teilindex, `shop_offers()`
-- und der Fortschrittsnenner. Abschnitt B rechnet den Abdruck neu und bricht
-- ab, wenn er sich bewegt hat.
-- ---------------------------------------------------------------------------
select set_config('skyisles.sicht', (
  select coalesce(md5(string_agg(s.sky_id || '|' || s.catalog_visible::text, E'\n'
                                 order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

select set_config('skyisles.sichtbar', (
  select count(*)::text from public.skylanders where catalog_visible
), true);

select set_config('skyisles.unsichtbar', (
  select count(*)::text from public.skylanders where not catalog_visible
), true);

select set_config('skyisles.journal', (
  select count(*)::text from public.catalog_admin_changes
), true);

-- ---------------------------------------------------------------------------
-- A6  DER EINGANGSZUSTAND ALLER SIEBEN, VORHER GEPRUEFT
--
-- Die Gruppe ERSETZT drei bestehende Ruempfe und LEGT zehn Funktionen an.
-- Keine der sieben Migrationen prueft den vorgefundenen Rumpf; auf Staging
-- war das unkritisch, auf Production ist es eine Luecke. Dieser Abschnitt
-- schliesst sie — und er fragt nicht nach Abdruecken (die waeren Konstanten
-- von vorgestern), sondern nach den Eigenschaften, die die erwartete Fassung
-- haben MUSS.
-- ---------------------------------------------------------------------------
do $lauf_a6$
declare
  v_journal text;
  v_create  text;
  v_export  text;
  v_def     text;
  v_n       integer;
begin
  -- a) Das Journal aus 0004/0007/0033 — ersetzt von 0152.
  select p.prosrc into v_journal from pg_proc p
    where p.oid = to_regprocedure('public.log_skylander_editorial_change()');
  if v_journal is null then
    raise exception 'ABBRUCH A6a: log_skylander_editorial_change() fehlt (0004).';
  end if;
  if v_journal like '%catalog_status%' then
    raise exception 'ABBRUCH A6b: log_skylander_editorial_change() kennt '
      'catalog_status schon. Entweder liegt 0152 bereits, oder hier steht eine '
      'fremde Fassung — sie wird nicht ueberschrieben.';
  end if;
  if v_journal not like '%catalog_visible%'
     or v_journal not like '%display_name_override%'
     or v_journal not like '%card_type%'
     or v_journal not like '%image_override_path%' then
    raise exception 'ABBRUCH A6c: der vorgefundene Journalrumpf nennt nicht die '
      'vier erwarteten Felder (catalog_visible, display_name_override, '
      'card_type, image_override_path). Er wird nicht ueberschrieben.';
  end if;

  -- b) admin_create_figure aus 0034 — ersetzt von 0152.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_create_figure';
  if v_n <> 1 then
    raise exception 'ABBRUCH A6d: % Fassung(en) von admin_create_figure — '
      'erwartet genau eine.', v_n;
  end if;
  select p.prosrc into v_create from pg_proc p
    where p.oid = to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)');
  if v_create is null then
    raise exception 'ABBRUCH A6e: admin_create_figure gibt es nicht mit der '
      'Signatur aus 0034 (acht Parameter). Die Ersetzung wuerde eine '
      'Ueberladung anlegen statt zu ersetzen.';
  end if;
  if v_create like '%catalog_status%' then
    raise exception 'ABBRUCH A6f: admin_create_figure kennt catalog_status schon.';
  end if;

  -- c) Die zehn Funktionen, die die Gruppe ANLEGT, duerfen noch nicht liegen.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_catalog_status';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_set_catalog_status liegen schon (0152). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'skylanders_sync_catalog_status';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von skylanders_sync_catalog_status liegen schon (0152). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_references';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_merge_references liegen schon (0154). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_merge_draft liegen schon (0154/0156 — ZWEI Fassungen mit Absicht: die dreiarmige leitet weiter). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_discard_draft';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_discard_draft liegen schon (0155). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_plan';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_merge_plan liegen schon (0156). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'merge_note';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von merge_note liegen schon (0157). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_create_character';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_create_character liegen schon (0158). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_character';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_set_character liegen schon (0158). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_publish_as_variant';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_publish_as_variant liegen schon (0158). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes — in '
      'beiden Faellen wird nichts ueberschrieben.', v_n;
  end if;

  -- d) system_platform_export() — ersetzt von 0153. Ihr Tor ist der Abdruck
  --    der Fassung aus 0144, und genau den verlangt 0153 selbst.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'system_platform_export';
  if v_n <> 1 then
    raise exception 'ABBRUCH A6h: % Fassung(en) von system_platform_export — '
      'erwartet genau eine.', v_n;
  end if;
  select md5(p.prosrc) into v_export from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_export <> '4c4d2e7c81e4efa8e18cdffa06bba40a' then
    raise exception 'ABBRUCH A6i: der Exportrumpf ist % und nicht die Fassung '
      'aus 0144 (4c4d2e7c81e4efa8e18cdffa06bba40a). 0153 wuerde eine fremde '
      'Fassung ueberschreiben.', v_export;
  end if;

  -- e) Die Journal-Constraint: die sieben Werte aus 0004/0007/0033, und
  --    catalog_status noch NICHT. Genau diese Luecke schliesst 0157 — und
  --    deshalb ist sie der Grund fuer diese Gruppe.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH A6j: catalog_admin_changes_field_known fehlt (0004).';
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%' then
    raise exception 'ABBRUCH A6k: die Journal-Constraint hat einen unerwarteten '
      'Wortlaut (%). Erwartet ist die Fassung aus 0033.', v_def;
  end if;
  if v_def like '%catalog_status%' then
    raise exception 'ABBRUCH A6l: die Journal-Constraint kennt catalog_status '
      'schon — dann liegt 0157 bereits.';
  end if;
end
$lauf_a6$;

-- ---------------------------------------------------------------------------
-- A7  DIE TRIGGER AN `skylanders`, VORHER BENANNT
--
-- Die ganze Gruppe legt GENAU EINEN neuen Trigger an (0152). B prueft, dass
-- es genau einer mehr ist und dass kein bestehender verschwand.
-- ---------------------------------------------------------------------------
select set_config('skyisles.trigger', (
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal
), true);

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0152_catalog_status.sql
-- ===========================================================================
-- 0152 — KATALOGSTATUS: OEFFENTLICH · VERSTECKT · ENTWURF (ADR-0151, CAT-02B)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Der Katalog kennt heute zwei redaktionelle Zustaende:
-- `catalog_visible` true oder false. Der Betrieb braucht einen dritten —
-- „Entwurf" —, damit ein neu angelegter oder spaeter importierter Eintrag
-- sagen kann „noch nicht fertig" statt „zurueckgezogen". Beide sind nicht
-- oeffentlich; sie unterscheiden sich in der ABSICHT, nicht im Verhalten.
--
-- WAS DIESE MIGRATION NICHT ANFASST, und das ist ihr Zuschnitt:
--
--   * keine RLS-Politik. `skylanders_select_anon` und
--     `skylanders_select_authenticated` lesen weiter `is_active and
--     catalog_visible`, und `catalog_visible` behaelt genau seine Bedeutung.
--   * keinen Index. `skylanders_public_catalog_idx` bleibt.
--   * keine Sicht, kein `shop_offers()`.
--   * keine SKY-ID, keine Sammlungs-, Favoriten-, Lager- oder
--     Angebotsbeziehung.
--
-- Nach dieser Migration hat jede der bestehenden Zeilen genau den Status, den
-- ihr `catalog_visible` heute schon bedeutet. **Kein bestehender Eintrag wird
-- zum Entwurf.**
--
-- ---------------------------------------------------------------------------
-- WARUM EIN TRIGGER UND NICHT NUR EIN CHECK
-- ---------------------------------------------------------------------------
--
-- Der naheliegende Entwurf waere eine Spalte plus
--
--     check ((catalog_status = 'public') = catalog_visible)
--
-- und er haette DREI bestehende Schreibpfade zerbrochen — nachgezaehlt, nicht
-- vermutet:
--
--   admin_set_catalog_visible    `update … set catalog_visible = p_visible`
--                                schreibt den Status nicht mit → CHECK verletzt
--   admin_create_figure          `insert … catalog_visible = false` ohne Status
--                                → Vorgabewert waere 'public' → CHECK verletzt
--   seller_create_catalog_item   dasselbe, aus dem Einkaufsbuch (0137)
--
-- Der Trigger dreht das um: **wer nur eine der beiden Spalten schreibt,
-- bekommt die andere abgeleitet.** Damit funktioniert jeder bestehende
-- Schreibpfad unveraendert weiter, und der CHECK ist trotzdem da — als
-- Beweis, dass die beiden nie auseinanderlaufen koennen. Erst der Trigger
-- macht die Zusage einhaltbar, erst der CHECK macht sie nachweisbar.
--
-- DAS MUSTER IST NICHT NEU. `0135` leitet `skylanders.item_type` mit einem
-- BEFORE-Trigger aus der Kategorie ab, und `0001` schuetzt die SKY-ID mit
-- einem. Ein dritter Trigger derselben Art ist keine neue Bauart.
--
-- REIHENFOLGE DER TRIGGER: der neue ist BEFORE, das Journal
-- (`skylanders_log_editorial`, 0004) ist AFTER. Das Journal sieht also die
-- bereits korrigierten Werte, und ein Statuswechsel steht mit seinem
-- richtigen alten und neuen Wert darin.
--
-- KEINE SPALTENVORGABE, UND DAS IST ABSICHT. `catalog_status` hat **keinen**
-- DEFAULT: NULL beim INSERT ist das Signal „der Aufrufer hat nichts gesagt",
-- und genau dann leitet der Trigger aus `catalog_visible` ab. Ein Vorgabewert
-- 'public' wuerde `seller_create_catalog_item` widersprechen, das
-- ausdruecklich `catalog_visible = false` schreibt.
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER, und das ist die Hausform dieses
-- Projekts (wie `0150` und `0151`): die Klammer setzt die Einfuege-Huelle
-- `supabase/operations/staging-0152.sql`, weil ihre Umgebungs- und
-- Zustandswaechter MIT in dieselbe Transaktion gehoeren. Eine Klammer hier
-- waere eine zweite — das innere `commit` wuerde die aeussere Transaktion
-- vorzeitig abschliessen und die Waechter wirkungslos machen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Spalte, noch ohne Zwang
--
-- Nullable und ohne Vorgabewert, damit der Backfill und der Trigger darunter
-- arbeiten koennen. `set not null` folgt in Abschnitt 3 — BEFORE-Trigger
-- laufen vor der Constraint-Pruefung, ein INSERT ohne Status bleibt also auch
-- danach gueltig.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column catalog_status text;

comment on column public.skylanders.catalog_status is
  'Editorial status (CAT-02B, ADR-0151): public, hidden or draft. public and hidden mean exactly what catalog_visible meant; draft is the third state for an entry that has never been released. hidden and draft are behaviourally identical - neither is public - and differ in intent only. Admin-owned: no import writes it. catalog_visible stays the machine-readable visibility that RLS, the partial index and shop_offers() read; a trigger keeps the two in step and a CHECK proves they are.';


-- ---------------------------------------------------------------------------
-- 2. Backfill — kein Eintrag wird zum Entwurf
-- ---------------------------------------------------------------------------
update public.skylanders
   set catalog_status = case when catalog_visible then 'public' else 'hidden' end;


-- ---------------------------------------------------------------------------
-- 3. Der Zwang: bekannter Wert, und nie im Widerspruch zur Sichtbarkeit
-- ---------------------------------------------------------------------------
alter table public.skylanders
  alter column catalog_status set not null;

alter table public.skylanders
  add constraint skylanders_catalog_status_known
    check (catalog_status in ('public', 'hidden', 'draft')),
  add constraint skylanders_catalog_status_matches_visibility
    check ((catalog_status = 'public') = catalog_visible);


-- ---------------------------------------------------------------------------
-- 4. Der Trigger, der jeden bestehenden Schreibpfad weiterleben laesst
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_sync_catalog_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.catalog_status is null then
      -- Der Aufrufer hat nichts gesagt: die Sichtbarkeit entscheidet.
      new.catalog_status := case when new.catalog_visible then 'public' else 'hidden' end;
    else
      -- Der Aufrufer hat den Status gesagt: er entscheidet die Sichtbarkeit.
      new.catalog_visible := (new.catalog_status = 'public');
    end if;
    return new;
  end if;

  if new.catalog_status is distinct from old.catalog_status then
    new.catalog_visible := (new.catalog_status = 'public');
  elsif new.catalog_visible is distinct from old.catalog_visible then
    /*
     * DER ALTE SCHREIBPFAD, UND DIE EINE FEINHEIT DARIN.
     *
     * `admin_set_catalog_visible(sky_id, false)` auf einem ENTWURF soll ihn
     * nicht stillschweigend zu „versteckt" umbenennen: beide sind nicht
     * oeffentlich, und die Absicht gehoert dem, der sie gesetzt hat. Nur ein
     * Wechsel nach sichtbar ist eindeutig — das ist 'public'.
     */
    new.catalog_status := case
      when new.catalog_visible          then 'public'
      when old.catalog_status = 'draft' then 'draft'
      else                                   'hidden'
    end;
  end if;
  return new;
end;
$$;

comment on function public.skylanders_sync_catalog_status() is
  'Keeps skylanders.catalog_status and catalog_visible in step (0152). Whichever column a write names, the other is derived - which is what lets admin_set_catalog_visible, admin_create_figure and seller_create_catalog_item keep working unchanged. Hiding a draft leaves it a draft: both are non-public, and the intent belongs to whoever set it. BEFORE, so the CHECK constraints and the AFTER journal trigger both see the corrected row.';

create trigger skylanders_sync_catalog_status
  before insert or update on public.skylanders
  for each row execute function public.skylanders_sync_catalog_status();


-- ---------------------------------------------------------------------------
-- 5. Das Journal kennt ein Feld mehr
--
-- `log_skylander_editorial_change` journalisiert vier redaktionelle Felder
-- (0004, erweitert in 0007 und 0033). `create or replace` ersetzt den ganzen
-- Rumpf, also stehen alle vier hier noch einmal — unveraendert — plus
-- `catalog_status`.
--
-- `catalog_visible` BLEIBT ebenfalls journalisiert. Ein Statuswechsel
-- erzeugt damit zwei Zeilen, und das ist richtig: der alte Schreibpfad
-- schreibt weiterhin nur die eine Spalte, und ein Journal, das die
-- Sichtbarkeit nicht mehr nennt, haette eine Luecke genau dort.
-- ---------------------------------------------------------------------------
create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_status is distinct from old.catalog_status then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_status',
            old.catalog_status, new.catalog_status,
            (select auth.uid()));
  end if;
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;
  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;
  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;
  if new.card_type is distinct from old.card_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'card_type',
            old.card_type, new.card_type,
            (select auth.uid()));
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Der Schreibweg des Admins
--
-- Ein UPDATE fuer beide Spalten, damit der CHECK nicht einmal
-- zwischenzeitlich verletzt ist. Der Trigger wuerde es auch alleine richten;
-- beides zu schreiben macht die Absicht an der Aufrufstelle lesbar.
--
-- `is_platform_admin()` ist das Tor, nicht `is_shop_admin()`: seit ADR-0077
-- sind Plattformadmin und Verkaeuferbetrieb getrennt, und der Katalog gehoert
-- der Plattform. Dieselbe Pruefung, die `admin_set_catalog_visible` seit 0041
-- benutzt.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_catalog_status(
  p_sky_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_status is null or p_status not in ('public', 'hidden', 'draft') then
    raise exception 'unknown catalog status %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;

  update public.skylanders
     set catalog_status  = p_status,
         catalog_visible = (p_status = 'public')
   where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_set_catalog_status(text, text) is
  'Sets the editorial status of one catalogue figure (0152, CAT-02B). Platform administrators only. Writes status and visibility in ONE update, so the CHECK is never transiently violated. Rejects any value outside public/hidden/draft. The change is journalled by skylanders_log_editorial; there is no approval step and no second actor.';

revoke all on function public.admin_set_catalog_status(text, text) from public, anon;
grant execute on function public.admin_set_catalog_status(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. `admin_set_catalog_visible` BLEIBT, unveraendert
--
-- Sie wird nicht geloescht und nicht umgeschrieben. Drei Gruende:
--
--   * Rueckwaertskompatibilitaet: jeder Aufrufer, der sie heute benutzt,
--     benutzt sie weiter, und der Trigger setzt den Status mit.
--   * Sie bleibt die richtige Antwort auf die ZWEI-Zustands-Frage „oeffentlich
--     oder nicht", die es in Zubehoer- und Betriebsflaechen weiterhin gibt.
--   * Eine Funktion zu entfernen, die noch aufgerufen wird, waere eine
--     Aenderung mit Reichweite — und diese Migration soll keine haben.
--
-- Die Adminoberfläche ruft ab CAT-02B `admin_set_catalog_status` auf. Beide
-- Wege fuehren zu einem gueltigen Zustand.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 8. Eine neu angelegte Figur ist ein Entwurf
--
-- Wortgleich die Fassung aus 0041, mit GENAU einer fachlichen Aenderung: der
-- INSERT nennt `catalog_status`. Die Signatur bleibt identisch — ein
-- zusaetzlicher Parameter waere eine Ueberladung und keine Ersetzung, und
-- dann gaebe es zwei Funktionen mit demselben Namen.
--
-- `seller_create_catalog_item` (0137) wird NICHT angefasst: sie legt Zubehoer
-- aus dem Einkaufsbuch an, bekommt vom Trigger 'hidden' und funktioniert
-- unveraendert. Ob dort 'draft' die richtigere Beschriftung waere, ist eine
-- eigene Entscheidung und keine dieser Migration.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null,
  p_template_sky_id       text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text   := btrim(coalesce(p_name, ''));
  v_next      bigint;
  v_sky_id    text;
  v_slug      text;
  v_override  text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note      text   := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_template  text   := nullif(btrim(coalesce(p_template_sky_id, '')), '');
  v_character bigint := null;
  v_found     boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  /*
   * The template, read from the catalogue rather than believed.
   *
   * A SKY-ID that does not exist is refused instead of silently ignored: the
   * operator picked something, and a create that quietly dropped the
   * relationship would produce a figure that looks derived and is not.
   *
   * `v_character` may still be NULL afterwards - that is a template without a
   * curated character, and it is a normal answer.
   */
  if v_template is not null then
    select s.character_id, true
      into v_character, v_found
      from public.skylanders s
     where s.sky_id = v_template;

    if not coalesce(v_found, false) then
      raise exception 'unknown template figure %', v_template
        using errcode = 'no_data_found';
    end if;
  end if;

  v_next := nextval('public.sky_id_seq');

  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, catalog_status, display_name_override,
     character_id, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false),
     -- DIE EINE FACHLICHE AENDERUNG (CAT-02B, Teil F): eine neu angelegte
     -- Figur ist ein ENTWURF, nicht ein verstecktes Objekt. Beides ist
     -- nicht oeffentlich, aber nur eines sagt „noch nicht fertig".
     -- Wer ausdruecklich sichtbar anlegt, bekommt weiter 'public'.
     case when coalesce(p_catalog_visible, false) then 'public' else 'draft' end,
     v_override, v_character, 'admin', true);

  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;


-- ===========================================================================
-- WAS DANACH GILT
--
--   * 594 Zeilen tragen einen Status, kein einziger ist 'draft'.
--   * `catalog_visible` ist unveraendert die Spalte, die RLS, der Teilindex
--     und `shop_offers()` lesen. Keine Sichtbarkeit hat sich geaendert.
--   * Jeder bestehende Schreibpfad funktioniert: der Trigger leitet ab, was
--     der Aufrufer nicht nennt.
--   * Eine neu angelegte Figur ist ein Entwurf.
--
-- WAS DIESE MIGRATION NICHT TUT
--
--   * Sie erweitert die Lesepolitik NICHT um Favoriten. Wer ein Objekt
--     vorgemerkt, aber nicht besessen hat, verliert es weiterhin aus seiner
--     Wunschliste, sobald es nicht oeffentlich ist — das gilt heute schon fuer
--     `hidden` und ist eine eigene Entscheidung (CAT-02A, P7).
--   * Sie fasst `seller_create_catalog_item` nicht an.
--   * Sie legt keine Figur an und vergibt keine SKY-ID.
-- ===========================================================================
-- <<< ENDE: supabase/migrations/0152_catalog_status.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0153_platform_export_catalog_status.sql
-- ---------------------------------------------------------------------------
-- 0153 — `catalog_status` kommt in die Plattformsicherung
--
-- CAT-02C, Teil B. `0152` gibt dem Katalog einen redaktionellen Status mit
-- drei Werten. Die Plattformsicherung fuehrt ihn nicht: ihre Spaltenliste
-- steht im Rumpf von `system_platform_export()`, und der ist aelter.
--
-- DIE FRAGE, DIE DIESE DATEI BEANTWORTET: bleibt ein Entwurf nach einer
-- Wiederherstellung ein Entwurf? Ohne sie lautet die Antwort NEIN fuer das
-- JSON-Archiv — `database.json` fuehrt nur `catalog_visible`, und daraus
-- laesst sich 'hidden' von 'draft' nicht mehr unterscheiden. Jede Zeile,
-- die zum Zeitpunkt der Sicherung Entwurf war, kaeme als 'hidden' zurueck.
--
-- (Fuer die logische Sicherung mit `pg_dump` — Stufe 2 nach
-- `supabase/checks/backup_architecture_two_tier.md` — gilt das NICHT: die
-- kopiert die Spalte von sich aus, und der Trigger aus `0152` leitet beim
-- Einspielen genau den Wert ab, der schon dasteht. Probelauf **P60** faehrt
-- diesen Einspielweg fuer alle drei Werte. Diese Migration schliesst also
-- die Luecke von Stufe 1, nicht die von Stufe 2.)
--
-- DIE EINE AENDERUNG, und es ist wirklich nur eine Zeile:
--
--     'catalog_visible', t.catalog_visible,
--   + 'catalog_status',  t.catalog_status,          <- neu, im Bereich `skylanders`
--
-- Alles andere ist Zeichen fuer Zeichen der Rumpf aus `0144`. 31 072 Zeichen
-- gehen unveraendert durch; `src/lib/backup/platform-export-0153.test.ts`
-- rechnet die Umkehrprobe bei jedem Testlauf nach — neuer Rumpf MINUS die
-- eine Zeile ist der alte.
--
-- WAS SICH NICHT AENDERT, und das ist der Grund, warum diese Migration klein
-- bleiben darf:
--
--   * **Die Bereichszahl bleibt 54.** `catalog_status` ist ein FELD eines
--     bestehenden Bereichs, kein Bereich. Deshalb bleibt `format_version`
--     bei **2**, `SECTIONS_BY_FORMAT_VERSION` unveraendert, und Archive der
--     Version 2 ohne dieses Feld bleiben lesbar.
--   * Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine
--     Richtlinie, kein Index, kein Recht. Nur ein Funktionsrumpf.
--   * `seller_business_backup()` wird NICHT angefasst: `catalog_status` ist
--     redaktioneller Plattformzustand und gehoert nicht in einen
--     Haendlerexport (`src/lib/backup/manifest.ts` fuehrt ihn als Ausschluss
--     mit Begruendung).
--
-- VORBEDINGUNG, UND SIE IST EINE REIHENFOLGE: diese Datei ist aus dem Rumpf
-- von `0144` gerechnet und ersetzt nur genau diesen. Auf Staging liegt er
-- seit dem 2026-10-25. **Auf Production liegt er nicht** — dort steht weiter
-- der Rumpf aus `0105` (2e2da90e…), und diese Migration bricht dort
-- kontrolliert ab, statt eine fremde Fassung blind zu ueberschreiben. Das
-- ist dieselbe Reihenfolge-Not, die `favorites` und `offer_state` aus der
-- Sicherung draussen haelt (`supabase/checks/platform_export_gap.md`); wer
-- sie aufloest, nimmt `0144` nach Production und kann danach diese Datei
-- dort fahren.
--
-- OFFEN BLEIBEN DIE VIER SPALTEN von `platform_export_gap.md`
-- (`skylanders.item_type`, `skylanders.usk_rating`,
-- `shop_inventory.sale_released`, `shop_inventory.delivery_scope`) und die
-- beiden Tabellen `favorites` und `offer_state`. Sie sind eigene
-- Entscheidungen mit eigener Freigabe. Entscheidet der Betreiber, sie
-- zusammen zu nehmen, ersetzt EINE Migration diese Datei — dann ist sie
-- hinfaellig, nicht falsch.
--
-- Abdruck vorher:  4c4d2e7c81e4efa8e18cdffa06bba40a  (der Rumpf aus `0144`, 54 Bereiche)
-- Abdruck nachher: 92c48444f99b9e294f9703d0c0ddeaa8  (54 Bereiche, ein Feld mehr)
--
-- Ruecknahme: `supabase/rollback/R0153_platform_export_back_to_0144.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_abdruck text;
begin
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0153 setzt 0105 voraus: system_platform_export() fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'catalog_status') then
    raise exception '0153 setzt 0152 voraus: skylanders.catalog_status fehlt';
  end if;

  select md5(p.prosrc) into v_abdruck
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_platform_export';

  if v_abdruck = '92c48444f99b9e294f9703d0c0ddeaa8' then
    raise exception '0153 Abbruch: der Rumpf ist schon der neue (%). Diese '
      'Migration ist hier bereits angewendet.', v_abdruck;
  end if;
  if v_abdruck = '2e2da90e976a1e73ca00aba7cd830fae' then
    raise exception '0153 Abbruch: hier steht der Rumpf aus 0105 (%), nicht der '
      'aus 0144. Diese Migration ist aus der 0144-Fassung gerechnet — erst 0144 '
      'anwenden, dann diese.', v_abdruck;
  end if;
  if v_abdruck <> '4c4d2e7c81e4efa8e18cdffa06bba40a' then
    raise exception '0153 Abbruch: der vorhandene Rumpf ist % und nicht der aus '
      '0144 (4c4d2e7c81e4efa8e18cdffa06bba40a). Eine unbekannte Fassung wird nicht '
      'blind ueberschrieben.', v_abdruck;
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Exportfunktion, mit einem Feld mehr
--
-- Zeichen fuer Zeichen die Fassung aus `0144`, mit der einen Zeile aus dem
-- Kopf. Eine zweite Aenderung faellt im Test auf, bevor jemand die Datei
-- ausfuehrt.
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
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144 and 0153) — the archive file database.json. 54 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and simply carry 53 sections. 0153 added skylanders.catalog_status (0152) — a FIELD, not a section, so format_version stays 2 and version-2 archives without it stay readable; without it a draft could not be told from a hidden row after a restore. There is still no restore — format_version is the contract that keeps one possible, and the limits are written down in supabase/checks/0144_restore_limits.md.';

-- ---------------------------------------------------------------------------
-- 3. Die Rechte, ausdruecklich festgeschrieben
--
-- `create or replace function` ERHAELT den bestehenden ACL — diese zwei
-- Zeilen aendern also nichts. Sie stehen hier, weil eine Datei, die eine
-- `security definer`-Funktion schreibt, ihre Rechte nennen soll.
-- ---------------------------------------------------------------------------
revoke all on function public.system_platform_export() from public, anon;
grant execute on function public.system_platform_export() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_abdruck   text;
  v_bereiche  integer;
  v_definer   boolean;
  v_volatil   "char";
  v_pfad      boolean;
  v_offen     integer;
  v_auth      integer;
begin
  select md5(p.prosrc),
         (length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', ''))) / length('coalesce(('),
         p.prosecdef, p.provolatile,
         /* Ausgepackt, nicht verglichen — `search_path=""` liegt quotiert ab,
            und `_` ist in `like` ein Platzhalter. Siehe `0144`. */
         (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')
    into v_abdruck, v_bereiche, v_definer, v_volatil, v_pfad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_platform_export';

  if v_abdruck <> '92c48444f99b9e294f9703d0c0ddeaa8' then
    raise exception '0153 Nachbedingung: Rumpfabdruck ist % und nicht %',
      v_abdruck, '92c48444f99b9e294f9703d0c0ddeaa8';
  end if;
  -- EIN FELD, KEIN BEREICH: die Zahl darf sich nicht bewegt haben.
  if v_bereiche <> 54 then
    raise exception '0153 Nachbedingung: % Bereiche statt 54 — diese Migration '
      'fuegt ein Feld hinzu, keinen Bereich', v_bereiche;
  end if;
  if not v_definer or v_volatil <> 's' or not v_pfad then
    raise exception '0153 Nachbedingung: Attribute verloren — definer %, '
      'volatility %, genau eine search_path-Festlegung %',
      v_definer, v_volatil, v_pfad;
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'system_platform_export'
                    and p.prosrc like '%''catalog_status'', t.catalog_status,%') then
    raise exception '0153 Nachbedingung: das Feld catalog_status fehlt im Rumpf';
  end if;
  -- Und die Formatversion ist NICHT gestiegen.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'system_platform_export'
                    and p.prosrc like '%''format_version'', 2,%') then
    raise exception '0153 Nachbedingung: format_version ist nicht mehr 2';
  end if;

  -- Die Rechte: niemand ausser `authenticated`.
  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0153 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;
  select count(*) into v_auth
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and a.grantee::regrole::text = 'authenticated';
  if v_auth <> 1 then
    raise exception '0153 Nachbedingung: authenticated darf nicht ausfuehren';
  end if;

  raise notice '0153: Rumpf %, 54 Bereiche, format_version 2, ein Feld mehr, '
    'Rechte unveraendert', v_abdruck;
end
$nach$;
-- <<< ENDE: supabase/migrations/0153_platform_export_catalog_status.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0154_merge_draft_into_figure.sql
-- ---------------------------------------------------------------------------
-- 0154 — einen importierten Entwurf mit einer bestehenden Figur zusammenführen
--
-- CAT-05. Der einmalige Excel-Import hat 105 Entwürfe angelegt. Einige davon
-- beschreiben Objekte, die der Katalog schon führt — unter einem anderen oder
-- historisch ungenaueren Namen. Für diese Fälle braucht der Adminbereich eine
-- Zusammenführung: der BESTEHENDE Eintrag bleibt, er übernimmt ausgewählte
-- Felder des Entwurfs, und der Entwurf verschwindet.
--
-- *** DIE BESTEHENDE SKY-ID BLEIBT, UND ZWAR IMMER ***
--
-- Daran hängen Sammlungen, Favoriten, Lager, Angebote, Bestellungen und das
-- Orderbuch. Eine Zusammenführung, die eine SKY-ID verschiebt, ist kein
-- Zusammenführen, sondern Datenverlust. Diese Funktion ändert `sky_id` nicht
-- und könnte es auch nicht: sie schreibt nur benannte Spalten.
--
-- *** DIE ÜBERNAHMEREGEL: WAS DER ENTWURF HAT, GEWINNT ***
--
-- Kein Feld-für-Feld-Auswählen. Jedes fachliche Feld, das der Entwurf
-- wirklich trägt, geht auf die bestehende Figur über; was im Entwurf leer
-- ist, lässt den bisherigen Wert stehen. `NULL` heißt „keine Information"
-- und nicht „leeren".
--
-- ZWEI AUSNAHMEN, UND BEIDE SIND EINE REGEL ÜBER PLATZHALTER:
--
--   `card_type` und `item_type` haben einen GENERISCHEN Vorgabewert
--   (`standard`, `figure`). Die CAT-03-Aufbereitung hat ihn bei 51 von 105
--   Entwürfen gesetzt, weil sich die Edition nicht belegen liess — das ist
--   ein Platzhalter und keine Angabe. **Ein unspezifischer Wert überschreibt
--   deshalb nie einen spezifischen.** Umgekehrt schon: wer `chase` mitbringt,
--   darf ein `standard` ersetzen.
--
--   `admin_note` wird ANGEHÄNGT statt ersetzt. Die Notiz der bestehenden
--   Figur ist Arbeit, die jemand geleistet hat; die Herkunftszeile des
--   Imports ist eine zweite Information und keine bessere.
--
-- *** WAS DIE BESTEHENDE FIGUR IN JEDEM FALL BEHÄLT ***
--
-- `sky_id` · `slug` · `catalog_status` · `catalog_visible` · `market_price`
-- und `price_updated_at` · `image_file` · `source` · und alles, was an der
-- SKY-ID hängt: Lager, Angebote, Sammlungen, Favoriten, Bestellungen. Diese
-- Funktion nennt sie nicht einmal.
--
-- *** DAS BILD LIEGT DANACH UNTER DER SKY-ID DER ZIELFIGUR ***
--
-- Der Aufrufer kopiert das Objekt vorher dorthin und reicht den Pfad als
-- dritten Parameter herein; die Funktion prüft, dass er wirklich der
-- Zielfigur gehört. Sie selbst fasst den Speicher nicht an — SQL erreicht
-- ihn nicht, und ein Vorgang über zwei Systeme wäre keine Transaktion mehr.
--
-- *** WELCHE TABELLEN AUF EINE SKY-ID ZEIGEN, WIRD HERGELEITET ***
--
-- Vierzehn Fremdschlüssel verweisen heute auf `skylanders`. Eine getippte
-- Liste davon wäre beim fünfzehnten falsch, ohne dass es auffiele — genau der
-- Fehlgrund, an dem die Sicherungsmanifeste zweimal vorbeigelaufen sind
-- (ADR-0134). `admin_merge_references()` liest sie deshalb aus `pg_catalog`.
--
-- *** EIN ENTWURF MIT REFERENZEN WIRD NICHT GELÖSCHT ***
--
-- Hat jemand ihn in seine Sammlung gelegt, auf die Wunschliste gesetzt oder
-- eingelagert, bricht die Zusammenführung ab. Die Entscheidung, was dann
-- geschieht, gehört einem Menschen.
--
-- WAS SIE NICHT ANFASST: `catalog_status` und `catalog_visible` der Zielfigur
-- (eine Zusammenführung veröffentlicht nichts und versteckt nichts), `slug`
-- (reine Navigation, ADR-0011 — eine geänderte Adresse wäre ein eigener
-- Vorgang), `market_price`, `price_updated_at`, `image_file` (gehören dem
-- Import), `source` und natürlich `sky_id`.
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER — die setzt die Einfüge-Hülle, wie bei
-- `0150`–`0153`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Wer zeigt auf diese SKY-ID?
--
-- `catalog_editorial` zählt NICHT mit: diese Zeile gehört dem Entwurf selbst
-- (seine interne Notiz) und verschwindet mit ihm. Alles andere ist eine
-- fremde Referenz und blockiert.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_references(p_sky_id text)
returns table (tabelle text, spalte text, zeilen bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  for r in
    select c.conrelid::regclass::text as tab,
           a.attname::text            as sp,
           array_length(c.conkey, 1)  as spalten
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.catalog_editorial'::regclass
     order by 1
  loop
    -- EIN MEHRSPALTIGER FREMDSCHLUESSEL WUERDE HIER FALSCH GEZAEHLT. Heute
    -- gibt es keinen; käme einer, soll es auffallen und nicht durchrutschen.
    if r.spalten <> 1 then
      raise exception '0154: % hat einen mehrspaltigen Fremdschluessel auf '
        'skylanders — diese Funktion kann ihn nicht zaehlen', r.tab;
    end if;
    execute format('select count(*) from %s where %I = $1', r.tab, r.sp)
      into v_n using p_sky_id;
    if v_n > 0 then
      tabelle := r.tab; spalte := r.sp; zeilen := v_n;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.admin_merge_references(text) is
  'Every row in any table that references this SKY-ID, derived from pg_catalog rather than a typed list (0154). catalog_editorial is excluded: that row belongs to the figure itself. Platform admins only; reads nothing else.';

revoke all on function public.admin_merge_references(text) from public, anon;
grant execute on function public.admin_merge_references(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Die Zusammenführung selbst
--
-- Ohne Feldliste: was der Entwurf hat, geht über; was er nicht hat, lässt
-- den bisherigen Wert stehen. Der Rückgabewert nennt jede Änderung, damit
-- die Oberfläche dieselbe Vorschau zeigen kann, die hier wirklich geschieht.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  -- Der Bildpfad, den der Aufrufer VORHER im Speicher angelegt hat. NULL
  -- heisst „kein Bild umhaengen"; dann bleibt das Bild der Zielfigur stehen.
  p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  v_refs     integer := 0;
  v_liste    text    := '';
  v_changed  jsonb   := '[]'::jsonb;
  r          record;
  -- DIE GENERISCHEN VORGABEWERTE. Ein Wert, der nur dasteht, weil es einen
  -- Vorgabewert gibt, ist keine Angabe — er darf eine echte nicht ersetzen.
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- ---- Die beiden Zeilen, gesperrt, damit niemand dazwischenfunkt.
  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0154: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0154: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0154: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  -- ---- NUR EIN ENTWURF DARF VERSCHWINDEN, und nur ein importierter.
  if v_draft.catalog_status <> 'draft' then
    raise exception '0154: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0154: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  -- ---- Fremde Referenzen auf den Entwurf blockieren.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0154: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- Die Übernahme. Jede Zeile hier folgt derselben Form: hat der Entwurf
  -- etwas, und ist es etwas anderes, dann geht es über.
  -- ======================================================================

  if btrim(coalesce(v_draft.name, '')) <> ''
     and v_draft.name is distinct from v_target.name then
    v_changed := v_changed || jsonb_build_object('field', 'name',
      'old', v_target.name, 'new', v_draft.name);
    update public.skylanders set name = v_draft.name where sky_id = p_target;
  end if;

  if btrim(coalesce(v_draft.display_name_override, '')) <> ''
     and v_draft.display_name_override is distinct from v_target.display_name_override then
    v_changed := v_changed || jsonb_build_object('field', 'display_name_override',
      'old', v_target.display_name_override, 'new', v_draft.display_name_override);
    update public.skylanders set display_name_override = v_draft.display_name_override
     where sky_id = p_target;
  end if;

  -- SERIE UND KATEGORIE IMMER GEMEINSAM: `(series_code, category_id)` ist EIN
  -- zusammengesetzter Fremdschlüssel. Nur eine Hälfte zu setzen verletzt ihn
  -- oder legt die Figur in eine Kategorie einer anderen Serie.
  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_changed := v_changed || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
    update public.skylanders
       set series_code = v_draft.series_code, category_id = v_draft.category_id
     where sky_id = p_target;
  end if;

  -- EIN PLATZHALTER ERSETZT KEINE ANGABE. `standard` ist der Vorgabewert von
  -- `card_type`; bei 51 der 105 Entwürfe steht er nur dort, weil sich die
  -- Edition nicht belegen liess. Er geht deshalb NUR über, wenn das Ziel
  -- selbst nichts Spezifischeres trägt.
  if v_draft.card_type is not null
     and v_draft.card_type is distinct from v_target.card_type
     and (v_draft.card_type <> c_generisch_card or v_target.card_type = c_generisch_card) then
    v_changed := v_changed || jsonb_build_object('field', 'card_type',
      'old', v_target.card_type, 'new', v_draft.card_type);
    update public.skylanders set card_type = v_draft.card_type where sky_id = p_target;
  end if;

  if v_draft.item_type is not null
     and v_draft.item_type is distinct from v_target.item_type
     and (v_draft.item_type <> c_generisch_item or v_target.item_type = c_generisch_item) then
    v_changed := v_changed || jsonb_build_object('field', 'item_type',
      'old', v_target.item_type, 'new', v_draft.item_type);
    update public.skylanders set item_type = v_draft.item_type where sky_id = p_target;
  end if;

  if v_draft.character_id is not null
     and v_draft.character_id is distinct from v_target.character_id then
    v_changed := v_changed || jsonb_build_object('field', 'character_id',
      'old', v_target.character_id::text, 'new', v_draft.character_id::text);
    update public.skylanders set character_id = v_draft.character_id where sky_id = p_target;
  end if;

  -- ======================================================================
  -- DAS BILD, und das ist die einzige Stelle, an der zwei Systeme beteiligt
  -- sind.
  --
  -- Der Aufrufer legt das Objekt VORHER unter der SKY-ID der ZIELFIGUR an —
  -- inhaltsadressiert, also derselbe Hash und damit eine folgenlose
  -- Wiederholung — und reicht den fertigen Pfad hier herein. Diese Funktion
  -- prueft ihn und setzt ihn; sie kopiert nichts und loescht nichts.
  --
  -- WARUM DIESE REIHENFOLGE. PostgreSQL und der Speicher teilen keine
  -- Transaktion. Kopieren-dann-schreiben kann nur zwei Zustaende
  -- hinterlassen: alles fertig, oder ein verwaistes Objekt ohne
  -- Datenbankaenderung. Der zweite kostet ein paar Kilobyte. Umgekehrt —
  -- erst schreiben, dann kopieren — koennte eine Figur auf ein Objekt
  -- zeigen, das es nicht gibt, und das ist ein fehlendes Bild.
  --
  -- DER PFAD MUSS DER ZIELFIGUR GEHOEREN. Sonst zeigte die bestehende Karte
  -- in den Ordner eines Entwurfs, den dieser Lauf gleich loescht — technisch
  -- erreichbar, aber eine Spur ins Nichts.
  -- ======================================================================
  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0154: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_changed := v_changed || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
      update public.skylanders set image_override_path = p_image_path
       where sky_id = p_target;
    end if;
  end if;

  -- DIE NOTIZ WIRD ANGEHÄNGT, NICHT ERSETZT. Was an der bestehenden Figur
  -- steht, hat jemand geschrieben; die Herkunftszeile des Imports ist eine
  -- zweite Information und keine bessere.
  select admin_note into v_note from public.catalog_editorial where sky_id = p_draft;
  if btrim(coalesce(v_note, '')) <> '' then
    select admin_note into v_zielnote from public.catalog_editorial where sky_id = p_target;
    v_neuenote := case
      when btrim(coalesce(v_zielnote, '')) = '' then v_note
      when position(v_note in v_zielnote) > 0   then v_zielnote
      else v_zielnote || E'\n' || v_note
    end;
    if v_neuenote is distinct from v_zielnote then
      v_changed := v_changed || jsonb_build_object('field', 'admin_note',
        'old', v_zielnote, 'new', v_neuenote);
      insert into public.catalog_editorial (sky_id, admin_note, updated_at)
        values (p_target, v_neuenote, now())
        on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                           updated_at = now();
    end if;
  end if;

  -- ---- Der Vorgang selbst ins Journal, zusätzlich zu den Feldzeilen des
  --      Triggers aus `0152`.
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
    'draft_deleted', true);
end;
$$;

comment on function public.admin_merge_draft(text, text, text) is
  'Merges an imported draft into an existing catalogue row (0154, CAT-05/CAT-05D). No field list: every business field the draft actually carries moves over, an empty one leaves the current value alone. Two placeholder rules — a generic card_type/item_type never replaces a specific one, and admin_note is appended rather than replaced. The TARGET keeps its SKY-ID, slug, status, visibility, price, imported image and every reference hanging off it; series_code and category_id always move together because they are one composite foreign key. Refuses when anything references the draft (admin_merge_references) or when either row is the wrong kind. Platform admins only. One transaction: a failure leaves no half-merged state.';

revoke all on function public.admin_merge_draft(text, text, text) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0154 Nachbedingung: admin_merge_references fehlt';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0154 Nachbedingung: admin_merge_draft fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_merge_references(text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0154 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0154: admin_merge_references und admin_merge_draft stehen, '
    'nur fuer authenticated, Adminpruefung im Rumpf.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0154_merge_draft_into_figure.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0155_discard_draft.sql
-- ---------------------------------------------------------------------------
-- 0155 — einen importierten Entwurf verwerfen
--
-- CAT-05D. Der Adminbereich bekommt drei Handlungen je Zeile: zusammenführen,
-- bearbeiten, **verwerfen**. Die ersten beiden gibt es; diese Datei liefert
-- die dritte.
--
-- *** NUR EIN IMPORTIERTER ENTWURF, UND NUR OHNE VERWEISE ***
--
-- Sie löscht eine Zeile, und das ist die einzige Stelle im Produkt, an der
-- ein Katalogeintrag wirklich verschwindet — der Import deaktiviert sonst
-- über `is_active`, statt zu löschen (`0001`). Deshalb drei Riegel:
--
--   1. `catalog_status = 'draft'` — eine öffentliche oder versteckte Figur
--      wird NIE gelöscht, auch nicht auf ausdrückliche Anweisung.
--   2. `source = 'admin'` — nur selbst angelegte Zeilen. Was der
--      Katalogimport besitzt, gehört ihm.
--   3. sie stand nie öffentlich — das Journal aus `0152` weiß es. Eine
--      Zeile, die einmal live war, wird versteckt und nicht vernichtet.
--   4. keine Verweise — `admin_merge_references()` aus `0154` zählt sie,
--      hergeleitet aus `pg_catalog` statt aus einer getippten Liste.
--
-- *** WAS DIESE VIER ZUSAMMEN BEDEUTEN ***
--
-- Am 2026-10-28 auf Staging gemessen: 128 Zeilen tragen `source = admin`,
-- davon sind **105 Entwürfe — genau die importierten** —, und die übrigen 23
-- sind öffentlich. Die Funktion trifft heute also exakt den Import. Sie ist
-- trotzdem nicht darauf festgeschrieben: eine später von Hand angelegte
-- Figur, die niemand benutzt und die nie öffentlich war, darf ebenso
-- verschwinden. Das ist die Regel — „ein Entwurf, auf den nichts zeigt und
-- der nie live war" —, und sie ist nachprüfbar, während eine Festlegung auf
-- die 105 an einer bearbeitbaren Notiz hinge.
--
-- *** SIE SETZT `0154` VORAUS ***
--
-- Nicht aus Bequemlichkeit: die Referenzprüfung soll es GENAU EINMAL geben.
-- Eine zweite Fassung derselben Regel wäre eine zweite Wahrheit, und bei
-- einer Löschung ist das die teuerste Sorte Fehler.
--
-- *** DAS BILD BLEIBT LIEGEN, UND DAS IST ABSICHT ***
--
-- Hat der Entwurf ein `image_override_path`, zeigt es auf ein Objekt im
-- Bucket `catalog`. Diese Funktion löscht es NICHT: SQL erreicht den Storage
-- nicht, und ein Löschen über zwei Systeme wäre nicht mehr eine Transaktion.
-- Das verwaiste Objekt kostet ein paar Kilobyte und schadet niemandem; es
-- still zu entfernen wäre der größere Eingriff. Der Rückgabewert NENNT den
-- Pfad, damit ein Mensch entscheiden kann.
--
-- DIE SKY-ID WIRD NICHT WIEDERVERWENDET. `sky_id_seq` läuft weiter; eine
-- gelöschte Zeile hinterlässt eine Lücke, und das ist ausdrücklich so
-- gewollt (ADR-0070).
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER — die setzt die Einfüge-Hülle.
-- ---------------------------------------------------------------------------

create or replace function public.admin_discard_draft(p_draft text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.skylanders%rowtype;
  v_refs  integer := 0;
  v_liste text    := '';
  r       record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0155: % gibt es nicht', p_draft;
  end if;

  -- ---- Riegel 1: nur Entwürfe.
  if v_row.catalog_status <> 'draft' then
    raise exception '0155: % ist kein Entwurf (Status %) — oeffentliche und '
      'versteckte Figuren werden nicht geloescht', p_draft, v_row.catalog_status;
  end if;

  -- ---- Riegel 2: nur selbst angelegte Zeilen.
  if v_row.source <> 'admin' then
    raise exception '0155: % traegt source=% — was der Katalogimport besitzt, '
      'wird ueber is_active deaktiviert und nicht geloescht', p_draft, v_row.source;
  end if;

  -- ---- Riegel 3: war die Zeile schon einmal öffentlich?
  --
  -- WARUM DAS EIN EIGENER RIEGEL IST. Die ersten beiden fragen, WAS die
  -- Zeile heute ist; dieser fragt, was sie einmal WAR. Eine Figur, die
  -- öffentlich stand, kann verlinkt, zwischengespeichert oder in einer
  -- Bestellung aufgetaucht sein — auch wenn heute nichts mehr auf sie zeigt.
  -- Wer sie wieder auf `draft` gesetzt hat, wollte sie verbergen und nicht
  -- vernichten.
  --
  -- Das Journal weiß es: `0152` schreibt jeden Statuswechsel mit. Die 105
  -- importierten Entwürfe entstanden ALS Entwurf und haben keine solche
  -- Zeile — für sie ändert dieser Riegel nichts.
  if exists (select 1 from public.catalog_admin_changes c
              where c.entity = 'skylander' and c.entity_id = p_draft
                and c.field = 'catalog_status' and c.old_value = 'public') then
    raise exception '0155: % stand schon einmal oeffentlich — eine Zeile mit '
      'Vergangenheit wird nicht geloescht, sondern versteckt', p_draft;
  end if;

  -- ---- Riegel 4: keine Verweise. Dieselbe Zählung wie bei der Zusammenführung.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0155: auf % zeigen noch Daten: % — der Entwurf wird nicht '
      'geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ---- Erst ins Journal, dann weg. Die Zeile ueberlebt die Figur.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_draft, 'discarded', v_row.name, null, (select auth.uid()));

  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'sky_id', p_draft,
    'name', v_row.name,
    'deleted', true,
    -- DER VERWAISTE PFAD, benannt statt still gelassen.
    'orphaned_image', v_row.image_override_path);
end;
$$;

comment on function public.admin_discard_draft(text) is
  'Deletes ONE imported draft (0155, CAT-05D). Four locks: catalog_status must be draft, source must be admin, the row must never have been public (the 0152 journal knows), and nothing may reference it (admin_merge_references from 0154, derived from pg_catalog). Writes a journal row before deleting, so the act outlives the figure. Does NOT touch storage: the image object stays and is named in the result, because SQL cannot reach the bucket and a two-system delete would stop being one transaction. The SKY-ID is never reused (ADR-0070). Platform admins only.';

revoke all on function public.admin_discard_draft(text) from public, anon;
grant execute on function public.admin_discard_draft(text) to authenticated;


-- ---------------------------------------------------------------------------
-- Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0155 setzt 0154 voraus: admin_merge_references() fehlt';
  end if;
  if to_regprocedure('public.admin_discard_draft(text)') is null then
    raise exception '0155 Nachbedingung: admin_discard_draft fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_discard_draft(text)')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0155 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0155: admin_discard_draft steht, nur fuer authenticated, '
    'vier Riegel im Rumpf, Storage unberuehrt.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0155_discard_draft.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0156_merge_selected_fields.sql
-- ---------------------------------------------------------------------------
-- 0156 — die Zusammenführung übernimmt nur die ausgewählten Felder
--
-- CAT-05F. `0154` hat die Zusammenführung gebracht, mit einer einzigen Regel:
-- was der Entwurf hat, geht über. Das ist richtig und meistens auch
-- gewünscht — aber nicht immer. Der häufigste Fall ist das Bild: der Name aus
-- dem Import ist genauer, das bestehende Foto ist besser. Bisher ging beides
-- oder keines.
--
-- *** EINE ÄNDERUNGSTABELLE MIT KÄSTCHEN, UND SIE WIRKT WIRKLICH ***
--
-- Der Dialog zeigt jede anstehende Änderung als eigene Zeile und lässt sie
-- einzeln abwählen. Diese Migration ist die Serverseite davon. Ein Kästchen,
-- das nur die Anzeige ändert, wäre eine Behauptung — hier entscheidet die
-- Auswahl, was wirklich geschrieben wird.
--
-- *** EINE REGEL, EINE STELLE: `admin_merge_plan()` ***
--
-- Vorschau und Übernahme dürfen nicht zwei Rechnungen sein. `0154` trug die
-- Regel im Rumpf der schreibenden Funktion; die Oberfläche spiegelte sie in
-- TypeScript. Zwei Fassungen derselben Regel, und die Oberfläche hätte
-- irgendwann etwas anderes versprochen als geschieht.
--
-- Jetzt rechnet `admin_merge_plan()` den Änderungsplan EINMAL, rein lesend.
-- Die schreibende Funktion ruft genau sie auf und wendet an, was ausgewählt
-- ist. `src/lib/admin/merge-candidates.ts` spiegelt sie weiterhin für die
-- Anzeige — aber der Server glaubt dieser Spiegelung nicht:
--
-- *** DIE WERTE DES AUFRUFERS SIND EINE BEHAUPTUNG, KEINE ANWEISUNG ***
--
-- `p_selection` nennt je Feld den Wert, den der Bediener in der Tabelle
-- GESEHEN hat (`old`/`new`). Der Server vergleicht ihn mit dem, was der Plan
-- JETZT rechnet, und bricht bei jeder Abweichung ab. Geschrieben wird
-- ausschliesslich der Wert aus der Zeile des Entwurfs — niemals der aus dem
-- Aufruf. Hat sich zwischen Anzeige und Klick etwas geändert, entsteht
-- deshalb kein stiller Fremdwert, sondern ein Abbruch mit Feldnamen.
--
-- *** DIE ALLOWLIST STEHT HIER, NICHT IM BROWSER ***
--
-- Neun Felder, namentlich. Alles andere wird abgewiesen, und zwar bevor
-- irgendetwas geschrieben ist: `sky_id`, `slug`, `catalog_status`,
-- `catalog_visible`, `market_price`, `price_updated_at`, `image_file`,
-- `source`, `is_active` — und alles, was an der SKY-ID hängt (Sammlungen,
-- Favoriten, Lager, Angebote, Bestellungen). Diese Funktion schreibt
-- ausschliesslich benannte Spalten; es gibt kein dynamisches SQL.
--
-- *** SERIE UND KATEGORIE SIND EIN FELD ***
--
-- `(series_code, category_id)` ist EIN zusammengesetzter Fremdschlüssel. Die
-- Auswahl muss beide nennen oder keinen; eine halbe Auswahl ist ein Abbruch,
-- kein stilles Zurechtbiegen. Die Oberfläche zeigt sie deshalb als eine
-- Tabellenzeile.
--
-- *** ABWÄRTSKOMPATIBEL ***
--
-- `admin_merge_draft(text, text, text)` aus `0154` bleibt und tut genau
-- dasselbe wie vorher — sie ruft jetzt nur die neue Fassung mit
-- `p_selection = NULL` auf, und NULL heisst „alles, was der Plan hergibt".
-- Es gibt dadurch EINE Übernahmelogik und nicht zwei. Die Oberfläche benutzt
-- sie nicht mehr; eine ältere Bereitstellung, die noch läuft, funktioniert
-- unverändert weiter.
--
-- *** WAS DIESE MIGRATION NICHT ANFASST ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie,
-- kein Index. `admin_merge_references(text)` aus `0154` und
-- `admin_discard_draft(text)` aus `0155` bleiben unverändert — die
-- Referenzprüfung soll es genau einmal geben.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0156 Vorbedingung: admin_merge_draft(text,text,text) fehlt '
      '— 0154 ist hier nicht angewendet.';
  end if;
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0156 Vorbedingung: admin_merge_references(text) fehlt (0154).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception '0156 Vorbedingung: skylanders.catalog_status fehlt (0152).';
  end if;
  if to_regclass('public.catalog_editorial') is null then
    raise exception '0156 Vorbedingung: catalog_editorial fehlt (0041).';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Änderungsplan — rein lesend, und die EINZIGE Stelle, an der die
--    Übernahmeregeln stehen.
--
-- Rückgabe: ein jsonb-Array in fester Reihenfolge, je Eintrag
--   { "field": …, "old": …, "new": … }
-- `old` und `new` sind Text oder jsonb-null. Die Reihenfolge ist Teil der
-- Zusage, damit die Tabelle in der Oberfläche stabil bleibt.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_plan(
  p_draft      text,
  p_target     text,
  -- Der Pfad, unter dem der Aufrufer das Bild bei der ZIELFIGUR anlegen
  -- WIRD. NULL heisst „das Bild bleibt, wie es ist".
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
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  -- DIE GENERISCHEN VORGABEWERTE. Ein Wert, der nur dasteht, weil es einen
  -- Vorgabewert gibt, ist keine Angabe — er darf eine echte nicht ersetzen.
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft;
  if not found then
    raise exception '0156: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target;
  if not found then
    raise exception '0156: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0156: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
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

  -- SERIE UND KATEGORIE IMMER GEMEINSAM: ein zusammengesetzter Fremdschlüssel
  -- lässt sich nicht halb setzen.
  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_plan := v_plan || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
  end if;

  -- EIN PLATZHALTER ERSETZT KEINE ANGABE.
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

  -- DAS BILD. Der Pfad muss der ZIELFIGUR gehören — sonst zeigte die
  -- bestehende Karte in den Ordner eines Entwurfs, den der Lauf gleich
  -- löscht. Der Plan weist das schon in der Vorschau ab und nicht erst beim
  -- Schreiben.
  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0156: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_plan := v_plan || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
    end if;
  end if;

  -- DIE NOTIZ WIRD ANGEHÄNGT, NICHT ERSETZT.
  select e.admin_note into v_note from public.catalog_editorial e where e.sky_id = p_draft;
  if btrim(coalesce(v_note, '')) <> '' then
    select e.admin_note into v_zielnote from public.catalog_editorial e where e.sky_id = p_target;
    v_neuenote := case
      when btrim(coalesce(v_zielnote, '')) = '' then v_note
      when position(v_note in v_zielnote) > 0   then v_zielnote
      else v_zielnote || E'\n' || v_note
    end;
    if v_neuenote is distinct from v_zielnote then
      v_plan := v_plan || jsonb_build_object('field', 'admin_note',
        'old', v_zielnote, 'new', v_neuenote);
    end if;
  end if;

  return v_plan;
end;
$$;

comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge (0156, CAT-05F): what admin_merge_draft WOULD write, as a jsonb array of {field, old, new}, in a fixed order. Read-only. This is the single place the merge rules live - the writing function calls it, so preview and application cannot diverge. Platform admins only.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Die Übernahme — nur die ausgewählten Felder
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text,
  -- DIE AUSWAHL. Ein Objekt, dessen Schlüssel die zu übernehmenden Felder
  -- sind, und dessen Werte nennen, was der Bediener GESEHEN hat:
  --   {"name": {"old": "Pirate Ship", "new": "Pirate Seas"}, …}
  -- NULL heisst „alles, was der Plan hergibt" — das ist das Verhalten von
  -- `0154` und der Weg der alten Dreiparameterfassung.
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
  r          record;
  -- DIE ALLOWLIST. Neun Felder, namentlich. Sie steht hier und nicht im
  -- Browser, weil ein Aufruf nicht aus dem Browser kommen muss.
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path',
    'admin_note'];
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- ---- Die beiden Zeilen, gesperrt, damit niemand dazwischenfunkt.
  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0156: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0156: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0156: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  -- ---- NUR EIN ENTWURF DARF VERSCHWINDEN.
  if v_draft.catalog_status <> 'draft' then
    raise exception '0156: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0156: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  -- ---- Fremde Referenzen auf den Entwurf blockieren.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0156: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- DIE AUSWAHL PRÜFEN — vollständig, BEVOR irgendetwas geschrieben ist.
  -- ======================================================================
  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object' then
      raise exception '0156: die Auswahl muss ein Objekt sein, nicht %',
        jsonb_typeof(p_selection);
    end if;

    -- Eine leere Auswahl ist kein Grund, einen Entwurf zu löschen.
    if p_selection = '{}'::jsonb then
      raise exception '0156: es ist kein Feld zur Übernahme ausgewählt — ohne '
        'Auswahl wird nichts zusammengeführt und nichts geloescht';
    end if;

    -- 1. ALLOWLIST. Jeder Schlüssel muss ein erlaubtes Feld sein.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      if not (v_feld = any (c_allow)) then
        raise exception '0156: % ist kein uebernehmbares Feld. Erlaubt sind: %',
          v_feld, array_to_string(c_allow, ', ');
      end if;
    end loop;

    -- 2. SERIE UND KATEGORIE SIND EIN FELD.
    if (p_selection ? 'series_code') <> (p_selection ? 'category_id') then
      raise exception '0156: series_code und category_id sind ein '
        'zusammengesetzter Fremdschluessel — beide auswaehlen oder keinen';
    end if;

    -- 3. DAS BILD: Auswahl und Pfad müssen zusammenpassen. Ohne ausgewähltes
    --    Bild darf kein Pfad hereinkommen, und umgekehrt.
    if (p_selection ? 'image_override_path')
       and (p_image_path is null or btrim(p_image_path) = '') then
      raise exception '0156: das Bild ist ausgewaehlt, aber es kommt kein '
        'Bildpfad mit';
    end if;
    if not (p_selection ? 'image_override_path')
       and p_image_path is not null and btrim(p_image_path) <> '' then
      raise exception '0156: es kommt ein Bildpfad mit, aber das Bild ist '
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
    -- 4. VERALTETE VORSCHAU. Jedes ausgewählte Feld muss im Plan stehen, und
    --    zwar mit genau den Werten, die der Bediener gesehen hat.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      v_eintrag := null;
      select e.wert into v_eintrag
        from jsonb_array_elements(v_plan) as e(wert)
       where e.wert ->> 'field' = v_feld;
      if v_eintrag is null then
        raise exception '0156: % steht nicht (mehr) zur Uebernahme — die '
          'Vorschau ist veraltet. Bitte neu laden.', v_feld;
      end if;
      -- DIE WERTE MUESSEN ZEICHENGLEICH SEIN. Der Aufrufer schickt beide
      -- Schluessel immer mit, auch als `null`; ein fehlender Schluessel ist
      -- SQL-NULL und damit verschieden von jsonb-null — also auch ein
      -- Abbruch, und das ist richtig.
      if (p_selection -> v_feld -> 'old') is distinct from (v_eintrag -> 'old')
         or (p_selection -> v_feld -> 'new') is distinct from (v_eintrag -> 'new') then
        raise exception '0156: % hat sich seit der Vorschau geaendert '
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
  -- DIE ÜBERNAHME. Der Plan sagt OB, die Zeile des Entwurfs sagt WAS — der
  -- Aufruf sagt beides nicht. Nur `admin_note` und `image_override_path`
  -- nehmen ihren Wert aus dem Plan, weil er dort erst entsteht (angehängte
  -- Notiz, umgezogener Pfad).
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
      -- Mit `series_code` schon geschrieben. Die Zeile steht im Plan, damit
      -- die Tabelle beide Werte zeigen kann.
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
    elsif v_feld = 'admin_note' then
      insert into public.catalog_editorial (sky_id, admin_note, updated_at)
        values (p_target, v_eintrag ->> 'new', now())
        on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                           updated_at = now();
    else
      -- Unerreichbar: der Plan erzeugt nur die neun Felder der Allowlist. Ein
      -- zehntes waere ein Fehler in dieser Datei und kein Eingabefehler.
      raise exception '0156: unbekanntes Planfeld % — das ist ein Fehler in '
        '0156 und nicht in der Eingabe', v_feld;
    end if;

    v_changed := v_changed || v_eintrag;
  end loop;

  -- ---- Der Vorgang ins Journal, zusätzlich zu den Feldzeilen des Triggers
  --      aus `0152`.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_target, 'merged_from', p_draft,
          jsonb_array_length(v_changed)::text || ' Feld(er)', (select auth.uid()));

  -- ---- Und erst jetzt der Entwurf. Er verschwindet auch dann, wenn nur ein
  --      Feld ausgewählt war: die Zusammenführung ist die Entscheidung, dass
  --      diese beiden Zeilen dasselbe Objekt beschreiben.
  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'draft', p_draft, 'target', p_target,
    'changed', v_changed,
    'selected', case when p_selection is null then null
                     else to_jsonb(array(select k.feld
                                           from jsonb_object_keys(p_selection) as k(feld))) end,
    'draft_deleted', true);
end;
$$;

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, CAT-05F). p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch, so a stale preview can never apply a different value. Values written come from the draft row, never from the call. Server-side allowlist of nine business fields; series_code and category_id must be selected together; an image path is accepted only when the image is selected. NULL selection means "everything the plan yields" (the 0154 behaviour). The TARGET keeps its SKY-ID, slug, status, visibility, price, imported image and every reference hanging off it. One transaction.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Die Dreiparameterfassung aus `0154` bleibt — als Weiterleitung
--
-- ABWÄRTSKOMPATIBEL UND TROTZDEM EINE LOGIK. Sie tut genau dasselbe wie
-- vorher (alles übernehmen, was der Plan hergibt), aber sie rechnet es nicht
-- mehr selbst. Eine zweite Fassung derselben Regel wäre bei einer Löschung
-- die teuerste Sorte Fehler.
--
-- Die Signatur ist unverändert, Rechte und Kommentar bleiben; `0154` muss
-- dafür nicht angefasst werden.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_merge_draft(p_draft, p_target, p_image_path, null::jsonb);
$$;

comment on function public.admin_merge_draft(text, text, text) is
  'Merges an imported draft into an existing catalogue row, taking over every field the draft carries (0154, kept for backward compatibility by 0156). Delegates to admin_merge_draft(text, text, text, jsonb) with a NULL selection, so there is exactly one merge implementation. New callers pass a selection instead. Platform admins only.';

revoke all on function public.admin_merge_draft(text, text, text) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_plan(text,text,text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_plan fehlt';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null then
    raise exception '0156 Nachbedingung: admin_merge_draft(…,jsonb) fehlt';
  end if;
  -- DIE ALTE FASSUNG MUSS STEHEN BLEIBEN. Sie ist die Abwärtskompatibilität.
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_draft(text,text,text) ist '
      'verschwunden — die Abwaertskompatibilitaet ist dahin';
  end if;
  -- UND 0154/0155 BLEIBEN UNBERÜHRT.
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_references fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0156 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0156: admin_merge_plan und admin_merge_draft(…,jsonb) stehen, '
    'die Dreiparameterfassung leitet weiter, nur fuer authenticated.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0156_merge_selected_fields.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0157_audit_fields_and_automatic_notes.sql
-- ---------------------------------------------------------------------------
-- 0157 — das Journal kennt drei Felder mehr, und die interne Notiz wird
--        nicht mehr ausgewaehlt
--
-- CAT-05I. Zwei Dinge, die zusammengehoeren: beide drehen sich darum, was
-- eine Zusammenfuehrung ins Journal und in die interne Notiz schreibt.
--
-- =========================================================================
-- TEIL 1 — DER FEHLER 23514, UND ER TRIFFT NICHT NUR DEN MERGE
-- =========================================================================
--
-- Der erste echte Merge-Versuch scheiterte am 2026-10-28 mit
-- `SQLSTATE 23514`, Constraint `catalog_admin_changes_field_known`, an der
-- Zeile `field = 'merged_from'`. Der ganze Vorgang wurde zurueckgerollt —
-- richtig so, es ist EINE Transaktion, und genau deshalb sind SKY-0103 und
-- SKY-0824 unveraendert.
--
-- Die Constraint stammt aus `0004`, erweitert in `0007` und `0033`. Auf
-- Staging gemessen kennt sie SIEBEN Werte:
--
--   catalog_visible · display_name_override · admin_note · catalog_group
--   image_override_path · card_type · created
--
-- DREI SCHREIBSTELLEN NENNEN WERTE, DIE DARIN FEHLEN:
--
--   `catalog_status`  `0152` hat `log_skylander_editorial_change` ERSETZT,
--                     damit der Trigger auch den neuen Status journalisiert
--                     — und die Constraint nicht erweitert. **Das trifft
--                     schon heute jeden Statuswechsel**, ganz ohne
--                     Zusammenfuehrung. Dass `0152` selbst durchlief, ist
--                     kein Widerspruch: ihr Backfill steht in Abschnitt 2,
--                     die Triggerersetzung erst in Abschnitt 5 — die 626
--                     Backfill-Zeilen haben den neuen Trigger nie gesehen.
--   `merged_from`     `admin_merge_draft` (`0154`, `0156`)
--   `discarded`       `admin_discard_draft` (`0155`)
--
-- WARUM DER PROBELAUF DAS NIE GEFUNDEN HAT: das Stub-Schema von
-- `tools/validate-check-sql.mts` traegt **keine CHECK-Constraints**. P60 war
-- gruen, obwohl `0152` denselben Fehler ausloest. Der Probelauf **P64** legt
-- die Constraint deshalb WORTGETREU an und faehrt die Faelle gegen sie —
-- erst den Fehlschlag, dann diese Migration, dann den Erfolg.
--
-- DREI WERTE MEHR, UND KEINER ZU VIEL. Die Constraint bleibt eine Liste und
-- wird nicht entfernt: sie ist der Grund, warum ein vertippter Feldname
-- auffaellt statt still im Journal zu landen. Aufgenommen wird genau, was
-- heute wirklich geschrieben wird — nachgewiesen aus den Funktionsruempfen
-- der laufenden Datenbank, nicht aus einer Vermutung.
--
-- =========================================================================
-- TEIL 2 — DIE INTERNE NOTIZ IST KEIN AUSWAEHLBARES FELD MEHR
-- =========================================================================
--
-- `0156` hat `admin_note` als neuntes Feld in die Allowlist aufgenommen, und
-- die Oberflaeche zeigte dafuer eine Kaestchenzeile. Das war falsch gedacht:
-- eine interne Notiz ist keine fachliche Katalogangabe, ueber die der
-- Bediener Fall fuer Fall entscheidet — sie ist Buchhaltung.
--
-- AB HIER GILT EINE REGEL, UND ZWAR IMMER:
--
--   1. Die Notiz der ZIELFIGUR bleibt erhalten. Immer. Sie ist Arbeit, die
--      jemand geleistet hat.
--   2. Aus der Notiz des Entwurfs wird das uebernommen, was fachlich
--      bleibt — die Herkunft: CAT-01-Kandidat, Quelle in der externen
--      Checkliste, Abschnitt.
--   3. **VERALTETE HINWEISE WANDERN NICHT MIT.** Alle 105 Importnotizen
--      endeten auf „Kein Bild uebernommen; externe Bildrechte ungeklaert." —
--      und beides ist ueberholt: CAT-05B hat 102 Bilder uebernommen, und der
--      Betreiber hat die Verwendung der Bilder fuer SkyIsles ausdruecklich
--      freigegeben (CAT-05, `docs/LEGAL.md`). Ein Satz, der eine geklaerte
--      Frage als offen beschreibt, ist schlechter als keiner.
--   4. Doppeltes wird nicht doppelt. Steht die Herkunft schon an der
--      Zielfigur, passiert nichts.
--   5. Bleibt nach dem Aufraeumen nichts uebrig, passiert nichts. Eine leere
--      Zeile in `catalog_editorial` ist kein Gewinn.
--   6. **Die Notiz haengt an keinem Kaestchen.** Sie wird verarbeitet, weil
--      zusammengefuehrt wird, nicht weil jemand sie ausgewaehlt hat.
--
-- WARUM DIE NOTIZ UEBERHAUPT MITWANDERT, obwohl das Journal den Vorgang
-- schon festhaelt: die Journalzeile sagt `merged_from: SKY-0824`, also DASS
-- zusammengefuehrt wurde. Sie sagt nicht, aus welcher Zelle der externen
-- Checkliste die Angaben stammen — und das ist die eine Information, die
-- spaeter noch jemand braucht. Mehr wird nicht erzeugt: es gibt keine
-- automatisch geschriebene „zusammengefuehrt am"-Notiz, denn die stuende
-- schon im Journal.
--
-- `public.merge_note(text, text)` ist diese Regel, als eine Funktion, an
-- einer Stelle, `immutable` und ohne jeden Seiteneffekt — damit sie sich
-- pruefen laesst, ohne etwas zu schreiben.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie aendert KEINE Notiz an bestehenden Zeilen. Keine Massenaenderung, kein
-- Backfill, kein `update` auf `catalog_editorial`. Die Regel greift beim
-- naechsten Zusammenfuehren; die 105 Entwuerfe behalten ihre Notiz, solange
-- sie Entwuerfe sind. `0154`, `0155` und `0156` bleiben unveraendert.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0157 Vorbedingung: catalog_admin_changes fehlt (0004).';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null then
    raise exception '0157 Vorbedingung: admin_merge_draft(…,jsonb) fehlt — 0156 '
      'ist hier nicht angewendet.';
  end if;
  if to_regprocedure('public.admin_merge_plan(text,text,text)') is null then
    raise exception '0157 Vorbedingung: admin_merge_plan fehlt (0156).';
  end if;

  -- DIE CONSTRAINT MUSS DIE SEIN, DIE WIR MEINEN. Steht dort eine fremde
  -- Fassung, wird sie nicht stillschweigend ersetzt.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0157 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%' then
    raise exception '0157 Vorbedingung: catalog_admin_changes_field_known hat '
      'einen unerwarteten Wortlaut (%). Erwartet ist die Fassung aus 0033. '
      'Erst klaeren, welche gilt.', v_def;
  end if;
  if v_def like '%merged_from%' then
    raise notice '0157: die Constraint kennt merged_from schon — dieser Lauf '
      'ersetzt sie durch dieselbe Fassung.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt drei Felder mehr
--
-- `drop` und `add` in EINER Transaktion: zwischen beiden gibt es keinen
-- Augenblick, in dem die Tabelle ohne Constraint dasteht, weil die
-- Einfuege-Huelle alles klammert. `add constraint` ohne `not valid` prueft
-- die bestehenden Zeilen mit — und das soll es: stuende dort heute ein
-- unbekanntes Feld, waere das ein Befund und kein Hindernis.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- Die sieben aus `0004`/`0007`/`0033`, unveraendert:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- und die drei, die seit `0152`/`0154`/`0155` wirklich geschrieben werden:
      'catalog_status',   -- der Journaltrigger, ersetzt in 0152
      'merged_from',      -- admin_merge_draft (0154, 0156)
      'discarded'         -- admin_discard_draft (0155)
    ));


-- ---------------------------------------------------------------------------
-- 3. Die Regel fuer die interne Notiz — eine Funktion, eine Stelle
--
-- `immutable`: sie liest nichts und schreibt nichts, sie rechnet nur. Damit
-- laesst sie sich in einer Pruefdatei aufrufen, ohne dass etwas geschieht.
-- ---------------------------------------------------------------------------
create or replace function public.merge_note(
  -- Die Notiz der Zielfigur, wie sie heute dasteht. NULL heisst „keine".
  p_target_note text,
  -- Die Notiz des Entwurfs.
  p_draft_note  text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rest text;
begin
  if btrim(coalesce(p_draft_note, '')) = '' then
    -- Nichts mitzubringen: die Zielnotiz bleibt, wie sie ist.
    return p_target_note;
  end if;

  /*
   * VERALTETE HINWEISE ENTFERNEN.
   *
   * Alle 105 Importnotizen enden auf „Kein Bild uebernommen; externe
   * Bildrechte ungeklaert." Beides ist ueberholt — CAT-05B hat 102 Bilder
   * uebernommen, und die Verwendung ist freigegeben. Entfernt wird der GANZE
   * SATZ, in dem der Hinweis steht, und nicht nur das Stichwort: ein
   * halbierter Satz waere schlechter als beides.
   *
   * Zwei Schreibweisen, weil die Notiz von Hand bearbeitet worden sein kann:
   * mit und ohne Umlaut.
   */
  v_rest := p_draft_note;
  v_rest := regexp_replace(v_rest, '[^.]*Bildrechte[[:space:]]+(ungeklaert|ungeklärt)[^.]*\.',
                           '', 'gi');
  v_rest := regexp_replace(v_rest, 'Kein Bild (uebernommen|übernommen)[^.]*\.', '', 'gi');
  -- Doppelte Leerzeichen und Reste wie „ ." aufraeumen.
  v_rest := btrim(regexp_replace(v_rest, '[[:space:]]+', ' ', 'g'));
  v_rest := btrim(regexp_replace(v_rest, '[[:space:]]*;[[:space:]]*$', '', 'g'));

  if v_rest = '' then
    -- Es stand nur der veraltete Hinweis drin.
    return p_target_note;
  end if;

  if btrim(coalesce(p_target_note, '')) = '' then
    return v_rest;
  end if;

  -- DOPPELTES NICHT DOPPELT.
  if position(v_rest in p_target_note) > 0 then
    return p_target_note;
  end if;

  return p_target_note || E'\n' || v_rest;
end;
$$;

comment on function public.merge_note(text, text) is
  'The one rule for the internal note when a draft is merged (0157, CAT-05I). The target keeps its note; whatever the draft contributes is appended once. Obsolete import hints are dropped - every one of the 105 import notes ended in "Kein Bild uebernommen; externe Bildrechte ungeklaert", and both halves are out of date since CAT-05B adopted 102 images and the operator released their use. Nothing is appended twice, an empty result appends nothing, and no note is generated for its own sake: that a merge happened is already in catalog_admin_changes. Pure and immutable - it reads nothing and writes nothing.';

revoke all on function public.merge_note(text, text) from public, anon;
grant execute on function public.merge_note(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Der Plan nennt die Notiz nicht mehr
--
-- Der Rumpf ist der aus `0156`, MINUS dem Abschnitt `admin_note`. Alles
-- andere steht Zeichen fuer Zeichen gleich; `src/lib/admin/merge-candidates.ts`
-- spiegelt es weiterhin, und `merge-candidates.test.ts` liest beide Seiten.
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

  return v_plan;
end;
$$;

comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge (0156, narrowed in 0157): what admin_merge_draft WOULD write, as a jsonb array of {field, old, new}, in a fixed order. Eight business fields; admin_note is NOT among them since 0157 - the note is no longer selectable and is handled unconditionally by merge_note(). Read-only. This is the single place the merge rules live, so preview and application cannot diverge. Platform admins only.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Uebernahme: acht auswaehlbare Felder, und die Notiz laeuft immer
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
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
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path'];
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

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, narrowed in 0157). Eight selectable business fields; admin_note is NOT one of them - the internal note is always processed through merge_note(), which keeps the target note, drops obsolete import hints and appends the rest once. p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch. Values written come from the draft row, never from the call. NULL selection means "everything the plan yields". The TARGET keeps its SKY-ID, slug, status, visibility, price and every reference hanging off it. One transaction - the journal row and the merge commit together or not at all.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0157 Nachbedingung: die Constraint ist verschwunden';
  end if;
  if v_def not like '%merged_from%' or v_def not like '%discarded%'
     or v_def not like '%catalog_status%' then
    raise exception '0157 Nachbedingung: die Constraint kennt die drei neuen '
      'Felder nicht: %', v_def;
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' then
    raise exception '0157 Nachbedingung: ein alter Wert ist verloren gegangen: %', v_def;
  end if;

  if to_regprocedure('public.merge_note(text,text)') is null then
    raise exception '0157 Nachbedingung: merge_note fehlt';
  end if;
  -- DIE NOTIZ IST KEIN AUSWAEHLBARES FELD MEHR.
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
      like '%''admin_note''%' then
    raise exception '0157 Nachbedingung: admin_note steht noch in der Allowlist';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
      like '%''admin_note''%' then
    raise exception '0157 Nachbedingung: der Plan nennt admin_note noch';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.merge_note(text,text)'),
                   to_regprocedure('public.admin_merge_plan(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0157 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0157: das Journal kennt catalog_status, merged_from und '
    'discarded; merge_note steht; admin_note ist kein auswaehlbares Feld mehr.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0157_audit_fields_and_automatic_notes.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0158_figure_families.sql
-- ---------------------------------------------------------------------------
-- 0158 — Figurenfamilien administrativ verwalten, und der dritte Importweg
--
-- CAT-06 Phase 2. Drei Funktionen und ein elfter Journalwert. Sie bauen
-- ausschliesslich auf dem vorhandenen Modell auf:
--
--     skylanders.character_id -> characters.id          (`0002`)
--
-- *** KEINE ZWEITE VARIANTENLOGIK ***
--
-- Diese Beziehung IST die Figurenfamilie, und sie war es von Anfang an: eine
-- stabile ID (kein Name, ADR-0011/ADR-0016), kuratiert, `on delete restrict`,
-- EINE Spalte — zwei widersprechende Familien sind damit strukturell
-- unmoeglich —, und nullable, weil NULL „nicht zuverlaessig bekannt" heisst
-- und nicht „keine" (ADR-0010). Der Spaltenkommentar aus `0002` nennt genau
-- den Anwendungsfall: „other figures of this character".
--
-- Was gefehlt hat, war kein Modell, sondern ein SCHREIBWEG. Gesetzt wurde
-- `character_id` bisher nur von `tools/import-characters.mts` (aus
-- `data/characters/characters.json`, lokal, mit Service-Role-Key) und
-- beilaeufig von der Zusammenfuehrung. `admin_create_figure` laesst sie
-- ausdruecklich NULL. In der Oberflaeche war sie nicht korrigierbar.
--
-- *** VIER BEGRIFFE, DIE NICHT VERMISCHT WERDEN ***
--
--   Figurenfamilie   `character_id`   wer das ist
--   Spielserie       `series_code`    wo es herkommt
--   Edition          `card_type`      auf welcher Karte es gedruckt ist
--   Katalogeintrag   `sky_id`         welches Sammelobjekt es ist
--
-- Jeder ist unabhaengig von den anderen. Eine Familie darf Figuren in
-- mehreren Serien haben (heute 13 von 20), eine Edition sagt nichts ueber
-- die Familie, und ein Name sagt ueber keines von beidem etwas Verbindliches.
--
-- *** DER NAME IST EIN EIGENSTAENDIGES REDAKTIONELLES ATTRIBUT ***
--
-- Keine dieser Funktionen liest, schreibt oder leitet einen Namen ab. Die
-- Familienzuordnung geschieht ueber die ID, nicht ueber ein Praefix — eine
-- Figur wird NIE allein wegen „Chrome " einer Familie zugeschlagen. Und
-- keine erzeugt einen Namen im Format `Grundfigur (Variante)`: die
-- Klammerschreibweise wird abgeschafft (CAT-06), und was hier entsteht,
-- entsteht ohne sie.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie aendert KEINE Zeile: kein `update` auf Bestandsdaten, kein Backfill,
-- keine Massenverknuepfung, keine Umbenennung. Die 561 sammelbaren Zeilen
-- ohne Familie bleiben ohne Familie, bis jemand einzeln entscheidet.
-- `0154`-`0157` bleiben unveraendert.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.characters') is null then
    raise exception '0158 Vorbedingung: characters fehlt (0002).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'character_id' and not a.attisdropped) then
    raise exception '0158 Vorbedingung: skylanders.character_id fehlt (0002).';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0158 Vorbedingung: admin_set_catalog_status fehlt (0152) '
      '— Weg B benutzt sie, damit es EINEN Veroeffentlichungsweg gibt.';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0158 Vorbedingung: is_platform_admin fehlt (0026/0077).';
  end if;

  -- DIE CONSTRAINT MUSS DIE AUS `0157` SEIN. Steht dort eine fremde Fassung,
  -- wird sie nicht stillschweigend ersetzt.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0158 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%merged_from%' or v_def not like '%discarded%'
     or v_def not like '%catalog_status%' then
    raise exception '0158 Vorbedingung: die Constraint ist nicht die aus 0157 '
      '(%). 0157 muss zuerst angewendet sein.', v_def;
  end if;
  -- Der eindeutige Index auf dem gefalteten Namen ist der Dublettenschutz.
  if not exists (select 1 from pg_class c
                  where c.relname = 'characters_canonical_name_key'
                    and c.relkind = 'i') then
    raise exception '0158 Vorbedingung: characters_canonical_name_key fehlt '
      '(0002) — ohne ihn gibt es keinen Dublettenschutz fuer Familien.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt einen elften Wert
--
-- Dieselbe Lehre wie in `0157`, und sie hat dort einen Tag gekostet: wer eine
-- Spalte journalisiert, muss ihren Namen in die Liste aufnehmen. `0152` hat
-- das vergessen, und jeder Statuswechsel lief danach in `23514`.
--
-- ZEHN BLEIBEN, EINER KOMMT. `drop` und `add` in derselben Transaktion, ohne
-- `not valid` — die bestehenden Zeilen werden mitgeprueft.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- Die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- und der elfte, aus dieser Migration:
      'character_id'
    ));


-- ---------------------------------------------------------------------------
-- 3. Eine Familie anlegen
--
-- NUR DER NAME. Element, Spezies, Rolle, Beschreibung und Quelle bleiben
-- NULL: das ist kuratierte Arbeit und gehoert in
-- `data/characters/characters.json`, nicht in ein Adminformular, das sie
-- raten muesste. NULL heisst „nicht zuverlaessig bekannt" (ADR-0010), und
-- das ist hier die Wahrheit.
--
-- DER DUBLETTENSCHUTZ IST DER VORHANDENE INDEX. `characters_canonical_name_key`
-- liegt auf `lower(canonical_name)` (`0002`); diese Funktion faengt den
-- Konflikt ab und nennt die bestehende Familie, statt eine zweite anzulegen.
-- Eine zweite „Spyro"-Familie waere genau die Art Fehler, nach der niemand
-- sucht, weil beide Zeilen plausibel aussehen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_character(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   bigint;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception '0158: eine Familie braucht einen Namen';
  end if;
  if length(v_name) > 120 then
    raise exception '0158: der Familienname ist zu lang (% Zeichen, hoechstens 120)',
      length(v_name);
  end if;

  -- GIBT ES SIE SCHON? Dann wird sie genannt und nicht verdoppelt.
  select c.id into v_id from public.characters c
   where lower(c.canonical_name) = lower(v_name);
  if v_id is not null then
    raise exception '0158: die Familie "%" gibt es schon (id %). Sie auswaehlen, '
      'statt eine zweite anzulegen.', v_name, v_id;
  end if;

  insert into public.characters (canonical_name) values (v_name)
    returning id into v_id;

  return v_id;
end;
$$;

comment on function public.admin_create_character(text) is
  'Creates a figure family with nothing but its name (0158, CAT-06). Element, species, role, description and source stay NULL - that is curated work and belongs in data/characters/characters.json, not in a form that would have to guess. Refuses a name that already exists (case-insensitively, via characters_canonical_name_key from 0002) and names the existing family instead of adding a second one. Platform admins only.';

revoke all on function public.admin_create_character(text) from public, anon;
grant execute on function public.admin_create_character(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Eine Figur einer Familie zuordnen — oder die Zuordnung entfernen
--
-- SIE GILT FUER JEDE FIGUR, nicht nur fuer Entwuerfe: eine Zuordnung ist eine
-- redaktionelle Korrektur und muss auch an einer laengst veroeffentlichten
-- Figur moeglich sein (CAT-06 §7).
--
-- SIE SCHREIBT EINE SPALTE UND SONST NICHTS. Kein Name, kein Status, keine
-- Sichtbarkeit, kein Preis, kein Bild, keine Serie, keine Kategorie, kein
-- `card_type`. Eine Familienzuordnung aendert, WOMIT eine Figur zusammen
-- angezeigt wird — nicht, was sie ist. Angebote, Sammlungen, Lager,
-- Favoriten und Bestellungen haengen an der SKY-ID und sind davon
-- unberuehrt.
--
-- `p_character_id = NULL` ENTFERNT die Zuordnung. Das ist kein Sonderfall,
-- sondern der Rueckweg: eine falsche Familie muss sich zuruecknehmen lassen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_character(
  p_sky_id       text,
  p_character_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alt      bigint;
  v_altname  text;
  v_neuname  text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select s.character_id into v_alt from public.skylanders s
   where s.sky_id = p_sky_id for update;
  if not found then
    raise exception '0158: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- DIE FAMILIE MUSS ES GEBEN. Der Fremdschluessel faenge das auch, aber mit
  -- einer Meldung, die niemand lesen will.
  if p_character_id is not null then
    select c.canonical_name into v_neuname from public.characters c
     where c.id = p_character_id;
    if not found then
      raise exception '0158: die Familie mit der id % gibt es nicht', p_character_id;
    end if;
  end if;

  if v_alt is not distinct from p_character_id then
    -- Nichts zu tun, und kein Journaleintrag fuer eine Nichtaenderung.
    return jsonb_build_object('sky_id', p_sky_id, 'character_id', p_character_id,
                              'changed', false);
  end if;

  if v_alt is not null then
    select c.canonical_name into v_altname from public.characters c where c.id = v_alt;
  end if;

  update public.skylanders set character_id = p_character_id where sky_id = p_sky_id;

  -- DAS JOURNAL. `character_id` ist seit Abschnitt 2 erlaubt. Es haelt die
  -- IDs fest und nicht die Namen: eine Umbenennung der Familie soll die
  -- Historie nicht umschreiben.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'character_id',
          v_alt::text, p_character_id::text, (select auth.uid()));

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'character_id', p_character_id,
    'old_character_id', v_alt,
    'old_name', v_altname,
    'new_name', v_neuname,
    'changed', true);
end;
$$;

comment on function public.admin_set_character(text, bigint) is
  'Assigns a catalogue figure to a figure family, or removes the assignment with NULL (0158, CAT-06). Works on any figure, not just drafts - an assignment is an editorial correction and must stay possible after publication. Writes ONE column: no name, status, visibility, price, image, series, category or card_type, so offers, collections, stock, favourites and orders are untouched. Journals the change as field = character_id with the IDs, not the names, so renaming a family does not rewrite history. A no-op writes no journal row. Platform admins only.';

revoke all on function public.admin_set_character(text, bigint) from public, anon;
grant execute on function public.admin_set_character(text, bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Weg B: einen Entwurf als Variante veroeffentlichen — in EINER Transaktion
--
-- ZWEI SCHRITTE, EINE TRANSAKTION. Zuordnen und veroeffentlichen gehoeren
-- zusammen: eine veroeffentlichte Figur ohne Familie stuende sichtbar an der
-- falschen Stelle im Katalog, und eine zugeordnete unveroeffentlichte waere
-- ein halber Vorgang, von dem niemand weiss. plpgsql gibt die Transaktion
-- umsonst — ein Fehler in der zweiten Haelfte nimmt die erste mit.
--
-- SIE ERFINDET KEINEN ZWEITEN VEROEFFENTLICHUNGSWEG. Der Status wird von
-- `admin_set_catalog_status` aus `0152` gesetzt, derselben Funktion, die das
-- Auswahlfeld in der Katalogliste benutzt. Zwei Wege, einen Katalogeintrag
-- oeffentlich zu machen, waeren zwei Stellen, an denen eine kuenftige Regel
-- vergessen wird.
--
-- DIE GRUNDFIGUR WIRD NICHT ANGEFASST. Kein Feld von ihr wird gelesen,
-- kopiert oder ueberschrieben; die Familie ist eine Zuordnung, kein
-- Datensatz, aus dem abgeschrieben wird. Der Entwurf behaelt seine SKY-ID,
-- seinen Slug, seinen Namen, sein Bild, seine Edition und seinen Preis —
-- „Chrome Spyro" bleibt „Chrome Spyro" und wird nicht zu „Spyro (Chrome)".
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_as_variant(
  p_sky_id       text,
  p_character_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.skylanders%rowtype;
  v_gesetzt jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_character_id is null then
    raise exception '0158: Weg B braucht eine Familie. Ohne Familie ist es Weg C '
      '— dafuer gibt es admin_set_catalog_status.';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0158: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- NUR EIN ENTWURF WIRD VEROEFFENTLICHT. Eine schon oeffentliche Figur einer
  -- Familie zuzuordnen ist Abschnitt 4 und nicht dieser Weg; sie hier
  -- durchzulassen hiesse, einen Statuswechsel zu verstecken.
  if v_row.catalog_status <> 'draft' then
    raise exception '0158: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_character.',
      p_sky_id, v_row.catalog_status;
  end if;

  -- ERST ZUORDNEN (prueft die Familie und journalisiert), DANN
  -- VEROEFFENTLICHEN. Die Reihenfolge entscheidet nichts fachlich — beides
  -- liegt in einer Transaktion —, aber so steht die Familie schon, wenn der
  -- Statustrigger laeuft.
  v_gesetzt := public.admin_set_character(p_sky_id, p_character_id);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'character_id', p_character_id,
    'family_changed', v_gesetzt -> 'changed',
    'published', true);
end;
$$;

comment on function public.admin_publish_as_variant(text, bigint) is
  'Path B of the three import paths (0158, CAT-06): publishes a draft as a figure in its own right AND links it to a figure family, in one transaction. Drafts only. Reuses admin_set_character and admin_set_catalog_status rather than inventing a second publish path. The family is an assignment, not a record to copy from: no field of the base figure is read or written, and the draft keeps its SKY-ID, slug, name, image, edition and price - "Chrome Spyro" stays "Chrome Spyro". Platform admins only.';

revoke all on function public.admin_publish_as_variant(text, bigint) from public, anon;
grant execute on function public.admin_publish_as_variant(text, bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0158 Nachbedingung: die Constraint ist verschwunden';
  end if;
  if v_def not like '%character_id%' then
    raise exception '0158 Nachbedingung: die Constraint kennt character_id nicht: %', v_def;
  end if;
  -- UND KEINER DER ZEHN IST VERLOREN.
  if v_def not like '%catalog_visible%' or v_def not like '%display_name_override%'
     or v_def not like '%admin_note%' or v_def not like '%catalog_group%'
     or v_def not like '%image_override_path%' or v_def not like '%card_type%'
     or v_def not like '%created%' or v_def not like '%catalog_status%'
     or v_def not like '%merged_from%' or v_def not like '%discarded%' then
    raise exception '0158 Nachbedingung: ein alter Wert ist verloren gegangen: %', v_def;
  end if;

  if to_regprocedure('public.admin_create_character(text)') is null then
    raise exception '0158 Nachbedingung: admin_create_character fehlt';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0158 Nachbedingung: admin_set_character fehlt';
  end if;
  if to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null then
    raise exception '0158 Nachbedingung: admin_publish_as_variant fehlt';
  end if;

  -- KEINE DER DREI FASST EINEN NAMEN AN. Das ist die Zusage aus CAT-06 §1,
  -- und sie laesst sich am Rumpf nachrechnen.
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.admin_set_character(text,bigint)'),
                       to_regprocedure('public.admin_publish_as_variant(text,bigint)'))
         and (p.prosrc like '%set name%' or p.prosrc like '%set slug%')) <> 0 then
    raise exception '0158 Nachbedingung: eine der Funktionen schreibt einen Namen '
      'oder einen Slug — das darf keine von ihnen';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_create_character(text)'),
                   to_regprocedure('public.admin_set_character(text,bigint)'),
                   to_regprocedure('public.admin_publish_as_variant(text,bigint)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0158 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0158: das Journal kennt character_id; admin_create_character, '
    'admin_set_character und admin_publish_as_variant stehen, nur fuer '
    'authenticated. Keine Zeile wurde geaendert.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0158_figure_families.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- B  DERSELBE MASSSTAB, NOCH EINMAL — UND DER VERGLEICH, DER ZURUECKROLLT
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_vor_base  text := current_setting('skyisles.base', true);
  v_vor_coll  text := current_setting('skyisles.coll', true);
  v_vor_sicht text := current_setting('skyisles.sicht', true);
  v_vor_ja    text := current_setting('skyisles.sichtbar', true);
  v_vor_nein  text := current_setting('skyisles.unsichtbar', true);
  v_vor_trig  text := current_setting('skyisles.trigger', true);
  v_vor_jour  text := current_setting('skyisles.journal', true);
  v_nach_base text;
  v_nach_coll text;
  v_nach      text;
  v_def       text;
  v_n         integer;
begin
  if v_vor_base is null or btrim(v_vor_base) = '' then
    raise exception 'ABBRUCH B1: die Shop-Baseline fehlt. Abschnitt A4 dieser '
      'Huelle hat sie nicht gesetzt — ohne Vergleich wird nichts committet.';
  end if;
  if v_vor_coll is null or btrim(v_vor_coll) = '' then
    raise exception 'ABBRUCH B2: die Sammlungs-Baseline fehlt (siehe B1).';
  end if;
  if v_vor_sicht is null or btrim(v_vor_sicht) = '' or v_vor_ja is null
     or v_vor_nein is null or v_vor_trig is null or v_vor_jour is null then
    raise exception 'ABBRUCH B2b: Sichtbarkeits-Abdruck, Backfill-Zahlen, '
      'Triggerliste oder Journalstand fehlen — A5/A7 hat sie nicht gesetzt.';
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
    raise exception 'ABBRUCH B3: Shop, Lager oder Katalog haben sich waehrend '
      'dieser Gruppe veraendert. VORHER % — NACHHER %. Die Gruppe rollt '
      'zurueck; nichts davon liegt.', v_vor_base, v_nach_base;
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
    raise exception 'ABBRUCH B4: die Sammlung hat sich waehrend dieser Gruppe '
      'veraendert. VORHER % — NACHHER %.', v_vor_coll, v_nach_coll;
  end if;

  -- B5  KEINE SICHTBARKEIT HAT SICH BEWEGT — Zeile fuer Zeile.
  select coalesce(md5(string_agg(s.sky_id || '|' || s.catalog_visible::text, E'\n'
                                 order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_sicht then
    raise exception 'ABBRUCH B5: die SICHTBARKEIT einer Katalogzeile hat sich '
      'veraendert. Abdruck vorher %, nachher %.', v_vor_sicht, v_nach;
  end if;

  -- B6/B7  DER BACKFILL TRIFFT GENAU DIE ZWEI ZAHLEN AUS A5.
  select count(*) into v_n from public.skylanders
   where catalog_status = 'public' and catalog_visible;
  if v_n::text is distinct from v_vor_ja then
    raise exception 'ABBRUCH B6: % Zeilen sind public UND sichtbar, erwartet %.',
      v_n, v_vor_ja;
  end if;
  select count(*) into v_n from public.skylanders
   where catalog_status = 'hidden' and not catalog_visible;
  if v_n::text is distinct from v_vor_nein then
    raise exception 'ABBRUCH B7: % Zeilen sind hidden UND unsichtbar, erwartet %.',
      v_n, v_vor_nein;
  end if;

  -- B8  KEINE ZEILE IST ZUM ENTWURF GEWORDEN.
  select count(*) into v_n from public.skylanders where catalog_status = 'draft';
  if v_n <> 0 then
    raise exception 'ABBRUCH B8: % Zeile(n) stehen auf draft. Keine bestehende '
      'Zeile wird zum Entwurf.', v_n;
  end if;

  -- B9  GENAU EIN TRIGGER MEHR, UND KEINER VERSCHWUNDEN.
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    into v_nach from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal;
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(string_to_array(v_vor_trig, ',')
                    || array['skylanders_sync_catalog_status']) as x) then
    raise exception 'ABBRUCH B9: die Triggerliste an skylanders ist % — erwartet '
      'die vorgefundene plus skylanders_sync_catalog_status. VORHER: %',
      v_nach, v_vor_trig;
  end if;

  -- B10  JEDE ANGELEGTE FUNKTION GENAU EINMAL — KEINE UEBERLADUNG.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_catalog_status';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_set_catalog_status liegt % mal vor, erwartet 1 (0152). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'skylanders_sync_catalog_status';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: skylanders_sync_catalog_status liegt % mal vor, erwartet 1 (0152). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_references';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_merge_references liegt % mal vor, erwartet 1 (0154). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft';
  if v_n <> 2 then
    raise exception 'ABBRUCH B10: admin_merge_draft liegt % mal vor, erwartet 2 (0154/0156 — ZWEI Fassungen mit Absicht: die dreiarmige leitet weiter). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_discard_draft';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_discard_draft liegt % mal vor, erwartet 1 (0155). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_plan';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_merge_plan liegt % mal vor, erwartet 1 (0156). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'merge_note';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: merge_note liegt % mal vor, erwartet 1 (0157). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_create_character';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_create_character liegt % mal vor, erwartet 1 (0158). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_character';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_set_character liegt % mal vor, erwartet 1 (0158). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_publish_as_variant';
  if v_n <> 1 then
    raise exception 'ABBRUCH B10: admin_publish_as_variant liegt % mal vor, erwartet 1 (0158). '
      'Eine zusaetzliche Ueberladung waere eine zweite Funktion mit demselben '
      'Namen.', v_n;
  end if;

  -- B11  admin_create_figure ist ERSETZT, nicht ueberladen.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_create_figure';
  if v_n <> 1 then
    raise exception 'ABBRUCH B11: admin_create_figure liegt % mal vor, erwartet '
      'eine. Die Ersetzung ist zur Ueberladung geworden.', v_n;
  end if;
  if to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)') is null then
    raise exception 'ABBRUCH B11b: die Signatur aus 0034 ist fort — der '
      'deployte Anwendungscode wuerde sie nicht mehr finden.';
  end if;

  -- B12  DIE JOURNAL-CONSTRAINT KENNT catalog_status — DER GRUND DIESER GRUPPE.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH B12: die Journal-Constraint ist verschwunden.';
  end if;
  if v_def not like '%catalog_status%' or v_def not like '%merged_from%'
     or v_def not like '%discarded%' then
    raise exception 'ABBRUCH B12b: die Journal-Constraint kennt nicht alle drei '
      'Werte aus 0157 (%). Ohne catalog_status scheitert jeder Statuswechsel '
      'mit 23514 — genau dieser Zwischenzustand darf nie committet werden.', v_def;
  end if;
  if v_def not like '%character_id%' then
    raise exception 'ABBRUCH B12d: die Journal-Constraint kennt den elften Wert '
      'character_id aus 0158 nicht (%). Dann ist 0158 nicht gelaufen.', v_def;
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%' then
    raise exception 'ABBRUCH B12c: die Journal-Constraint hat die alten Werte '
      'verloren (%).', v_def;
  end if;

  -- B13  DER EXPORTRUMPF IST DER AUS 0153.
  select md5(p.prosrc) into v_nach from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_nach <> '92c48444f99b9e294f9703d0c0ddeaa8' then
    raise exception 'ABBRUCH B13: der Exportrumpf ist % und nicht die Fassung '
      'aus 0153 (92c48444f99b9e294f9703d0c0ddeaa8).', v_nach;
  end if;

  -- B14  DIE GRUPPE HAT KEINE JOURNALZEILE GESCHRIEBEN.
  select count(*) into v_n from public.catalog_admin_changes;
  if v_n::text is distinct from v_vor_jour then
    raise exception 'ABBRUCH B14: das Journal hat jetzt % Zeilen, vorher %. '
      'Keine der sieben Migrationen schreibt eine.', v_n, v_vor_jour;
  end if;

  raise notice '0152-0158 auf Production: catalog_status steht, Sichtbarkeit '
    'unveraendert (% sichtbar / % unsichtbar), kein Entwurf, Journal-Constraint '
    'kennt catalog_status, Export auf 0153, beide Vertraege unveraendert.',
    v_vor_ja, v_vor_nein;
end
$lauf_b$;

commit;
