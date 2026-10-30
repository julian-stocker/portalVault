-- ========================================================================
-- PRODUCTION — GRUPPE G3': EIN LAUF FUER 0159
--              (die Variante kennt ihre Basisfigur)
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
-- G3' IST EINE GRUPPE AUS EINER MIGRATION, und das ist kein Widerspruch zu
-- G2': dort mussten sieben zusammen fahren, weil ein Zwischenzustand schadet
-- (ADR-0161). Hier gibt es keinen Zwischenzustand — `0159` ist in sich
-- vollstaendig. Sie bekommt denselben Rahmen, weil der Rahmen gut ist, nicht
-- weil sie ihn braucht.
--
-- WAS 0159 FACHLICH TUT: `skylanders.base_sky_id` (text, nullbar) — welche
-- Figur ist die Variante WELCHER Basisfigur, und zwar innerhalb EINER Serie.
-- Dazu drei Riegel und ein Teilindex:
--
--   `skylanders_id_series_uniq`     UNIQUE (sky_id, series_code) — sieht
--                                   redundant aus und ist es nicht: ein
--                                   Fremdschluessel braucht eine eindeutige
--                                   Einschraenkung GENAU ueber den Spalten,
--                                   auf die er zeigt. Ohne sie gibt es die
--                                   Serienregel nicht.
--   `skylanders_base_not_self`      CHECK — keine Figur ist ihre eigene
--                                   Variante.
--   `skylanders_base_same_series`   FOREIGN KEY (base_sky_id, series_code)
--                                   -> (sky_id, series_code), ON UPDATE
--                                   RESTRICT, ON DELETE RESTRICT. Weil
--                                   `series_code` auf beiden Seiten derselbe
--                                   Wert sein muss, kann eine Variante nur
--                                   auf eine Basisfigur DERSELBEN Serie
--                                   zeigen — strukturell, nicht programmiert.
--   `skylanders_variant_base_guard_trg`  der Kettenriegel: keine Variante
--                                   einer Variante, in BEIDEN Richtungen.
--                                   BEFORE INSERT OR UPDATE **OF
--                                   base_sky_id** — bestehende Schreibpfade,
--                                   die die Spalte nicht nennen, zahlen
--                                   nichts dafuer.
--
-- Dazu der zwoelfte Journalwert (`base_sky_id`), die zwei neuen Funktionen
-- `admin_set_variant_base(text,text,boolean)` und
-- `admin_publish_with_base(text,text,boolean)` — und EINE ERSETZUNG, die der
-- eigentliche Grund fuer Sorgfalt ist:
--
-- *** admin_merge_references MUSS MIT, SONST BRICHT DAS BESTEHENDE ***
--
-- `0154` leitet die verweisenden Tabellen aus `pg_constraint` her und nimmt
-- `conkey[1]` — die erste Spalte des Fremdschluessels. Bei einem
-- MEHRSPALTIGEN weigert sie sich ausdruecklich und bricht ab. Genau so einen
-- legt `0159` an. Ohne die Ersetzung wuerden `admin_merge_draft` und
-- `admin_discard_draft` ab dem Commit bei JEDEM Aufruf scheitern — zwei
-- Funktionen, die angewendet und in Gebrauch sind. Die Ersetzung steht in
-- derselben Migration und damit in derselben Transaktion: einen Augenblick,
-- in dem der neue Fremdschluessel steht und der alte Rumpf noch, gibt es
-- fuer keine andere Sitzung. A6i/A6j pruefen vorher, dass wirklich der Rumpf
-- aus `0154` vorliegt; B11c/B11d pruefen danach, dass der neue steht.
--
-- *** WAS SIE NICHT TUT ***
--
-- Sie ordnet NICHTS zu. Kein Backfill, keine Massenverknuepfung, kein Lauf
-- ueber die 70 Paare, die die Analyse gefunden hat. Die Spalte entsteht
-- LEER; jede Zuordnung ist danach eine einzelne Entscheidung. B7 prueft das
-- und rollt zurueck, wenn eine Zeile einen Wert traegt.
--
-- Sie schreibt KEINE EINZIGE DATENZEILE: kein `insert`, kein `update`, kein
-- `delete` ausserhalb von Funktionsruempfen. `0159` ist reine Struktur.
--
-- Sie fasst nicht an: RLS (keine Politik liest `base_sky_id`), die
-- Sichtbarkeit, den Status, die Familie (`character_id`), Shop, Lager,
-- Sammlung, Bestellungen, Preise, Bilder, die Plattformsicherung.
--
-- *** DAS BLEIBT OFFEN, UND ZWAR BIS 0160 ***
--
-- `system_platform_export()` fuehrt `base_sky_id` NICHT — das tut erst
-- `0160`. Solange sie nicht angewendet ist, waere eine Zuordnung in einer
-- Sicherung nicht enthalten und bei einer Wiederherstellung verloren. Das
-- ist heute ohne Folge, weil nichts zugeordnet ist (B7). ES HEISST ABER:
-- **nach G3' im Adminbereich keine Basisfiguren zuordnen, bis 0160 liegt.**
--
-- ZWEI FRAGEN, DIE VOR DER FREIGABE GEPRUEFT WURDEN (2026-10-30)
-- ========================================================================
--
-- 1. KANN EINE VERBOTENE VARIANTENKETTE DURCH NEBENLAEUFIGKEIT ENTSTEHEN?
--
--    DER KETTENRIEGEL ALLEIN IST NICHT NEBENLAEUFIGKEITSSICHER, und das ist
--    gemessen: er prueft eine Bedingung ueber ZWEI Zeilen mit zwei
--    gewoehnlichen `select` und nimmt dabei KEINE Sperre. Unter READ
--    COMMITTED sieht ein solcher `select` den letzten committeten Stand —
--    zwei gleichzeitige Zuordnungen koennten also beide durchgehen und
--    zusammen eine Kette ergeben. Der Fremdschluessel haelt das nicht auf:
--    er sperrt die verwiesene Zeile mit `FOR KEY SHARE`, und die kollidiert
--    nach der Konfliktmatrix nur mit `FOR UPDATE`, nicht mit dem UPDATE
--    einer Nicht-Schluesselspalte.
--
--    ERREICHBAR IST DIE LUECKE TROTZDEM NICHT, und zwar aus drei Gruenden:
--    `admin_set_variant_base` sperrt die Variante UND die Basisfigur mit
--    `for update` (zweimal, gemessen); `admin_publish_with_base` und — ab
--    `0161` — `admin_publish_variant_auto` rufen sie, statt selbst zu
--    schreiben; und einen Tabellen-Schreibweg auf `skylanders` gibt es fuer
--    KEINE Clientrolle (`0033`). Uebrig bleibt eine von Hand getippte
--    Anweisung als `postgres` — und zwei davon gleichzeitig.
--
--    UND ES GIBT EINEN ZWEITEN FANGPUNKT: `0160_preflight.sql`, Zeile 133,
--    zaehlt Ketten ueber die echten Daten und erwartet `0`. Entstuende je
--    eine, haelt der naechste Rollout-Schritt an.
--
--    DIE BERICHTIGUNG IST EINE ZEILE (`for update` in Richtung 1 des
--    Riegels) und gehoert in eine eigene Migration — `0159` ist auf Staging
--    angewendet und wird nicht geaendert. Vorschlag und Begruendung:
--    ADR-0162. SIE IST NICHT TEIL VON G3'.
--
-- 2. ZAEHLT `admin_merge_references` BEIM ZWEISPALTIGEN SCHLUESSEL FALSCH
--    UND BLOCKIERT DADURCH UNNOETIG?
--
--    NEIN, und auch das ist gemessen: sie zaehlt auf `base_sky_id`, und eine
--    Zeile mit `base_sky_id = X` hat zwingend dieselbe Serie wie X — ein
--    Versuch mit abweichender Serie wird mit `23503` abgewiesen. Die
--    Zaehlung auf EINER Spalte ist fuer diesen Schluessel also exakt. Zeilen
--    mit `base_sky_id IS NULL` zaehlen nicht mit (sonst waere jede
--    Zusammenfuehrung ab dem Commit blockiert); eine Figur ohne Varianten
--    erscheint gar nicht in der Liste; eine mit zwei Varianten mit genau 2.
--
--    DIE GRENZE, ausdruecklich: bei einem KUENFTIGEN mehrspaltigen
--    Schluessel, dessen zweite Spalte abweichen darf, wuerde sie
--    ueberzaehlen. So einen Schluessel gibt es heute nicht; der Fall steht
--    als Dauertest in `src/lib/catalog/g3-base-figure.test.ts`.
--
-- WAS DIESE HUELLE HINZUFUEGT
-- ========================================================================
--
--   A0     `lock_timeout` und `statement_timeout` — siehe DIE SPERRWIRKUNG.
--   A1-A3  der umgekehrte Umgebungsstempel: sie bricht auf Staging ab.
--   A4     Shop- und Sammlungsvertrag, von der Huelle SELBST gemessen.
--   A5     der IDENTITAETS- UND ZUSTANDSABDRUCK aller Katalogzeilen:
--          sky_id, series_code, catalog_visible, catalog_status,
--          character_id — Zeile fuer Zeile.
--   A6     der Eingangszustand, den `0159` selbst nicht prueft: die Spalte
--          ist noch nicht da, die Riegel sind noch nicht da, und der
--          vorgefundene Rumpf von `admin_merge_references` ist wirklich der
--          aus `0154`.
--   A7     Trigger- und Riegelliste an `skylanders`, vorher benannt.
--   B      alles davon noch einmal, Vergleich, `raise exception` bei jeder
--          Abweichung: B3 Shop, B4 Sammlung, B5 Identitaet, B6 Zeilen- und
--          Familienzahl, B7 nichts zugeordnet, B8 genau ein Trigger mehr,
--          B9 genau drei Riegel mehr, B10 zwoelf Journalwerte, B11 die
--          Ersetzung, B12 die zwei neuen Funktionen, B13 die Rechte,
--          B14 nichts Bestehendes verschwunden, B15 keine Journalzeile.
--
-- DIE SPERRWIRKUNG
-- ========================================================================
--
--   * `skylanders` bekommt `ACCESS EXCLUSIVE`: `add column`, drei
--     `alter table ... add constraint`, `create index`, `create trigger`.
--     Gehalten bis zum `commit` — der Katalog ist so lange nicht lesbar.
--   * Die UNIQUE baut einen Index ueber 624 Zeilen; der Fremdschluessel
--     validiert die bestehenden Zeilen, und die tragen alle NULL, weil die
--     Spalte in derselben Transaktion entstanden ist. Beides ist deshalb
--     billig — nicht weil 624 wenig ist, sondern weil nichts zu pruefen ist.
--   * `catalog_admin_changes` bekommt `ACCESS EXCLUSIVE` einmal, mit
--     Validierung der bestehenden Journalzeilen (217 am 2026-10-30).
--
-- GEMESSEN, NICHT GESCHAETZT: die Zahlen stehen im Testbericht zu G3'.
--
--   `set local lock_timeout = '5s'` — wartet nicht endlos auf eine fremde
--   Sperre. Ein Abbruch hier ist kostenlos: es ist noch nichts committet.
--   `set local statement_timeout = '300s'` — die Notbremse.
--
-- VORHER: `supabase/operations/prod-s-preflight-g3.sql` (rein lesend).
-- NACHHER: `supabase/operations/prod-s-postflight-g3.sql` (rein lesend).
-- RUECKNAHME: `supabase/rollback/R0159_drop_base_sky_id.sql`.
-- ========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
--
-- `set local` gilt bis zum `commit` und ist mit ihm fort.
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
--
-- KEIN PLATZHALTER, KEIN KOPIEREN. Die Messung ist zeichengleich die aus
-- `0159_preflight.sql`; abgelegt wird transaktionslokal und mit dem `commit`
-- fort.
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
-- A5  DER IDENTITAETS- UND ZUSTANDSABDRUCK ALLER KATALOGZEILEN
--
-- `0159` legt eine UNIQUE ueber `(sky_id, series_code)` an und einen
-- Fremdschluessel, der auf dieselben zwei Spalten zeigt. Was dabei unter
-- keinen Umstaenden wandern darf, ist die IDENTITAET: die SKY-ID selbst
-- (ADR-0001), die Serie, an der die Kategoriezuordnung und die neue
-- Serienregel haengen, und der Zustand, den `0152` bis `0158` gesetzt haben.
--
-- Fuenf Felder je Zeile, Zeile fuer Zeile, Reihenfolge fest. Abschnitt B
-- rechnet den Abdruck neu und BRICHT AB, wenn sich ein Zeichen bewegt hat.
-- ---------------------------------------------------------------------------
select set_config('skyisles.ident', (
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-'),
           E'\n' order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

select set_config('skyisles.zeilen', (
  select count(*)::text from public.skylanders
), true);

select set_config('skyisles.familien', (
  select count(*)::text from public.skylanders where character_id is not null
), true);

select set_config('skyisles.journal', (
  select count(*)::text from public.catalog_admin_changes
), true);

-- ---------------------------------------------------------------------------
-- A6  DER EINGANGSZUSTAND, VORHER GEPRUEFT
--
-- `0159` traegt einen eigenen `do $vor$`-Block, und der ist gut: er verlangt
-- `character_id`, die drei Funktionen aus `0158`/`0152` und die Constraint
-- aus `0158`. Zwei Dinge prueft er NICHT, und beide gehoeren hierher:
--
--   1. Die Spalte `base_sky_id` darf noch nicht stehen. Die Migration sagt
--      `add column if not exists` und MELDET nur, wenn sie schon da ist —
--      sie laeuft dann weiter und laesst fremde Werte unberuehrt. Auf
--      Production ist das keine Beruhigung, sondern eine offene Frage.
--   2. Der vorgefundene Rumpf von `admin_merge_references`. `0159` ersetzt
--      ihn, weil der alte einen mehrspaltigen Fremdschluessel ausdruecklich
--      ABWEIST — und ab dieser Migration gibt es einen. Ohne die Ersetzung
--      braechen `admin_merge_draft` und `admin_discard_draft` bei JEDEM
--      Aufruf. Wird hier ein anderer Rumpf vorgefunden, wird er nicht blind
--      ueberschrieben.
-- ---------------------------------------------------------------------------
do $lauf_a6$
declare
  v_src text;
  v_def text;
  v_n   integer;
begin
  -- a) DIE SPALTE IST NOCH NICHT DA.
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders')
     and a.attname = 'base_sky_id' and not a.attisdropped;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6a: skylanders.base_sky_id steht schon. Entweder '
      'liegt 0159 bereits, oder hier steht etwas Fremdes — in beiden Faellen '
      'wird nichts ueberschrieben und nichts angelegt.';
  end if;

  -- b) DIE DREI RIEGEL UND DER INDEX SIND NOCH NICHT DA.
  select count(*) into v_n from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname in ('skylanders_id_series_uniq', 'skylanders_base_not_self',
                       'skylanders_base_same_series');
  if v_n <> 0 then
    raise exception 'ABBRUCH A6b: % der drei Riegel aus 0159 stehen schon '
      '(skylanders_id_series_uniq, skylanders_base_not_self, '
      'skylanders_base_same_series).', v_n;
  end if;
  select count(*) into v_n from pg_class c
   where c.relname = 'skylanders_base_sky_id_idx' and c.relkind = 'i';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6c: skylanders_base_sky_id_idx steht schon.';
  end if;
  select count(*) into v_n from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders')
     and t.tgname = 'skylanders_variant_base_guard_trg';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6d: der Kettenriegel (Trigger) steht schon.';
  end if;

  -- c) DIE ZWEI NEUEN FUNKTIONEN SIND NOCH NICHT DA.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_set_variant_base';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6e: % Fassung(en) von admin_set_variant_base '
      'liegen schon.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_publish_with_base';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6f: % Fassung(en) von admin_publish_with_base '
      'liegen schon.', v_n;
  end if;

  -- d) admin_merge_references: GENAU EINE Fassung, die Signatur aus 0154,
  --    und der Rumpf, den 0159 zu ersetzen erwartet.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_merge_references';
  if v_n <> 1 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_merge_references — '
      'erwartet genau eine. Die Ersetzung wuerde sonst eine Ueberladung.', v_n;
  end if;
  select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_references(text)');
  if v_src is null then
    raise exception 'ABBRUCH A6h: admin_merge_references gibt es nicht mit der '
      'Signatur aus 0154 (ein Parameter, text).';
  end if;
  if v_src like '%confkey%' then
    raise exception 'ABBRUCH A6i: der Rumpf von admin_merge_references leitet '
      'die Spalte schon ueber confkey her — dann liegt 0159 bereits oder hier '
      'steht eine fremde Fassung.';
  end if;
  if v_src not like '%mehrspaltigen Fremdschluessel%' then
    raise exception 'ABBRUCH A6j: der vorgefundene Rumpf von '
      'admin_merge_references ist nicht der aus 0154 — er weist einen '
      'mehrspaltigen Fremdschluessel nicht ausdruecklich ab. Er wird nicht '
      'blind ueberschrieben.';
  end if;

  -- e) DAS JOURNAL: die Constraint aus 0158, und base_sky_id noch nicht.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH A6k: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%character_id%' then
    raise exception 'ABBRUCH A6l: die Journal-Constraint kennt character_id '
      'nicht (%) — dann ist 0158 hier nicht angewendet.', v_def;
  end if;
  if v_def like '%base_sky_id%' then
    raise exception 'ABBRUCH A6m: die Journal-Constraint kennt base_sky_id '
      'schon — dann liegt 0159 bereits.';
  end if;

  -- f) DIE FUNKTIONEN, AUF DIE 0159 AUFBAUT.
  if to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null then
    raise exception 'ABBRUCH A6n: eine Funktion aus 0158 fehlt.';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception 'ABBRUCH A6o: admin_set_catalog_status fehlt (0152).';
  end if;

  -- g) DIE UNIQUE KANN ENTSTEHEN. `sky_id` ist der Primaerschluessel, also
  --    ist `(sky_id, series_code)` ohnehin eindeutig — aber gemessen ist
  --    gemessen, und eine NULL in `series_code` waere ein eigener Befund.
  select count(*) into v_n from public.skylanders where series_code is null;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6p: % Zeile(n) haben kein series_code. Die '
      'Serienregel von 0159 kann daran nicht haengen.', v_n;
  end if;
  select count(*) into v_n from (
    select s.sky_id, s.series_code from public.skylanders s
     group by s.sky_id, s.series_code having count(*) > 1) d;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6q: % Dublette(n) in (sky_id, series_code) — die '
      'UNIQUE koennte nicht entstehen.', v_n;
  end if;

  -- h) KEIN MEHRSPALTIGER FREMDSCHLUESSEL ZEIGT HEUTE AUF skylanders.
  --    Gaebe es einen, braeche admin_merge_references schon JETZT bei jedem
  --    Aufruf — das waere ein Befund von heute und nicht von 0159.
  select count(*) into v_n from pg_constraint c
   where c.contype = 'f' and c.confrelid = to_regclass('public.skylanders')
     and array_length(c.conkey, 1) > 1;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6r: % mehrspaltige(r) Fremdschluessel zeigt schon '
      'auf skylanders. Dann weist admin_merge_references bereits heute ab, und '
      'das ist zuerst zu klaeren.', v_n;
  end if;
end
$lauf_a6$;

-- ---------------------------------------------------------------------------
-- A7  DIE TRIGGER UND DIE RIEGEL AN `skylanders`, VORHER BENANNT
--
-- `0159` legt GENAU EINEN neuen Trigger an. Die fuenf vorhandenen heissen
-- `skylanders_item_type_from_category`, `skylanders_log_editorial`,
-- `skylanders_set_updated_at`, `skylanders_sky_id_immutable` und
-- `skylanders_sync_catalog_status`; der neue sortiert sich als
-- `skylanders_variant_base_guard_trg` ALPHABETISCH HINTER sie, und
-- PostgreSQL feuert BEFORE-Zeilentrigger in dieser Reihenfolge. Der
-- Kettenriegel sieht die Zeile also, wie sie geschrieben wird — nachdem
-- `skylanders_sync_catalog_status` den Status abgeleitet hat.
-- ---------------------------------------------------------------------------
select set_config('skyisles.trigger', (
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal
), true);

select set_config('skyisles.riegel', (
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
), true);

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0159_variant_base_figure.sql
-- ---------------------------------------------------------------------------
-- 0159 — die Variante kennt ihre Basisfigur
--
-- CAT-07. `0158` hat die Figurenfamilie administrativ bedienbar gemacht:
-- `character_id` verbindet denselben Charakter SERIENUEBERGREIFEND. Was
-- fehlte, ist die zweite, engere Beziehung — welche Figur ist die Variante
-- WELCHER Basisfigur, und zwar innerhalb EINER Serie.
--
-- *** DREI EBENEN, DREI SPALTEN, KEINE VERMISCHUNG ***
--
--   Figurenfamilie   `character_id`   serienuebergreifend   (`0002`)
--   Basisfigur       `base_sky_id`    innerhalb einer Serie (hier)
--   Katalogeintrag   `sky_id`         die Sache selbst      (`0001`)
--
-- Warum beides noetig ist, zeigt Eon's Elite: `Elite Boomer` und `Boomer`
-- stehen in VERSCHIEDENEN Serien. Sie sind derselbe Charakter — das sagt
-- `character_id` — aber keine Variante voneinander, denn Eon's Elite ist
-- eine Produktlinie (`0032`). Eine Ebene allein koennte das nicht
-- unterscheiden. Gemessen am 2026-10-28: 4 solche Faelle.
--
-- *** DIE SERIENREGEL IST STRUKTURELL, NICHT PROGRAMMIERT ***
--
-- `(base_sky_id, series_code)` zeigt auf `(sky_id, series_code)`. Weil
-- `series_code` auf BEIDEN Seiten derselbe Wert sein muss, kann eine
-- Variante nur auf eine Basisfigur DERSELBEN Serie zeigen — ohne Trigger,
-- ohne Anwendungslogik, und auch fuer einen Zugriff, der die Oberflaeche
-- umgeht. Dasselbe Muster traegt seit `0001` die Kategoriezuordnung:
--
--     foreign key (category_id, series_code) references categories (id, series_code)
--
-- `ON UPDATE RESTRICT` und nicht `CASCADE` — Entscheidung des Betreibers,
-- CAT-07. Ein `CASCADE` haette eine Serienaenderung an der Basisfigur
-- stillschweigend auf alle ihre Varianten durchgeschrieben: eine
-- Massenaenderung an Katalogdaten, die niemand angeordnet hat. Jetzt wird
-- die Aenderung abgewiesen, und der Betreiber loest zuerst die Varianten.
-- Das ist unbequemer und nachvollziehbar.
--
-- *** WAS EIN FREMDSCHLUESSEL NICHT KANN ***
--
-- „Die Basisfigur darf selbst keine Variante sein." Das braucht einen Blick
-- in eine ANDERE Zeile, und das kann ein CHECK nicht. Ein Trigger prueft es
-- in BEIDEN Richtungen: beim Zuordnen (die genannte Basisfigur ist frei) und
-- beim Verwandeln (eine Zeile, auf die Varianten zeigen, wird selbst keine
-- Variante). Es gaebe eine rein strukturelle Loesung mit einer generierten
-- Spalte und einem dreispaltigen Schluessel; sie ist klueger und schlechter
-- zu lesen, und ein Riegel, den niemand versteht, ist kein Riegel.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie ordnet NICHTS zu. Kein Backfill, keine Massenverknuepfung, keine
-- Umbenennung, kein Lauf ueber die 70 Paare, die die Analyse gefunden hat.
-- Die Spalte entsteht leer, und jede Zuordnung ist danach eine einzelne
-- Entscheidung. `0154`-`0158` bleiben unveraendert; die vorhandenen 107
-- Familienzuordnungen bleiben, wo sie sind.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0159 Vorbedingung: skylanders fehlt (0001).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'character_id' and not a.attisdropped) then
    raise exception '0159 Vorbedingung: skylanders.character_id fehlt (0002).';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0159 Vorbedingung: admin_set_character fehlt (0158) — 0159 '
      'benutzt sie, damit die Familienzuordnung EINEN Schreibweg hat.';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null then
    raise exception '0159 Vorbedingung: admin_create_character fehlt (0158).';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0159 Vorbedingung: admin_set_catalog_status fehlt (0152).';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0159 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%character_id%' then
    raise exception '0159 Vorbedingung: die Constraint ist nicht die aus 0158 '
      '(%). 0158 muss zuerst angewendet sein.', v_def;
  end if;

  if exists (select 1 from pg_attribute a
              where a.attrelid = to_regclass('public.skylanders')
                and a.attname = 'base_sky_id' and not a.attisdropped) then
    raise notice '0159: skylanders.base_sky_id steht schon — dieser Lauf laesst '
      'die Spalte und ihre Werte unberuehrt.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte, und die Riegel, die sie tragen
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists base_sky_id text;

comment on column public.skylanders.base_sky_id is
  'The base figure this row is a variant OF, within the SAME game series (0159, CAT-07). NULL means "this is a base figure, or stands on its own" - never "unknown". Not a family: character_id links the same character across series (0002), this links a variant to one specific figure inside one series. At most one, enforced by being one column; never a variant of a variant, enforced by a trigger; always the same series, enforced structurally by the composite foreign key below.';

/*
 * DIE EINDEUTIGKEIT, DIE DEN ZUSAMMENGESETZTEN SCHLUESSEL ERST MOEGLICH
 * MACHT. Sie sieht redundant aus — `sky_id` ist der Primaerschluessel, also
 * ist `(sky_id, series_code)` trivial eindeutig. Sie ist es nicht: ein
 * Fremdschluessel braucht eine eindeutige Einschraenkung GENAU ueber den
 * Spalten, auf die er zeigt. Ohne sie gibt es die Serienregel nicht.
 *
 * Wer sie fuer Ballast haelt und entfernt, nimmt den Riegel mit.
 */
alter table public.skylanders
  drop constraint if exists skylanders_id_series_uniq;
alter table public.skylanders
  add constraint skylanders_id_series_uniq unique (sky_id, series_code);

-- KEINE FIGUR IST IHRE EIGENE VARIANTE. Das geht als CHECK, weil es nur die
-- eigene Zeile braucht.
alter table public.skylanders
  drop constraint if exists skylanders_base_not_self;
alter table public.skylanders
  add constraint skylanders_base_not_self
    check (base_sky_id is distinct from sky_id);

/*
 * DIE SERIENREGEL. `series_code` steht auf beiden Seiten des Schluessels,
 * muss also derselbe Wert sein — eine Variante kann nur auf eine Basisfigur
 * derselben Serie zeigen, und keine Anwendung, kein Skript und kein
 * PostgREST-Aufruf kommt daran vorbei.
 *
 * `on update restrict`: eine Serienaenderung an der Basisfigur wird
 * ABGEWIESEN, solange Varianten an ihr haengen (CAT-07, Entscheidung des
 * Betreibers). `on delete restrict`: eine Basisfigur mit Varianten wird
 * nicht geloescht.
 */
alter table public.skylanders
  drop constraint if exists skylanders_base_same_series;
alter table public.skylanders
  add constraint skylanders_base_same_series
    foreign key (base_sky_id, series_code)
    references public.skylanders (sky_id, series_code)
    on update restrict on delete restrict;

-- Gesucht wird „alle Varianten dieser Basisfigur". Teilindex, weil heute
-- keine Zeile einen Wert traegt und die meisten nie einen bekommen.
create index if not exists skylanders_base_sky_id_idx
  on public.skylanders (base_sky_id)
  where base_sky_id is not null;


-- ---------------------------------------------------------------------------
-- 3. Keine Variante einer Variante — in beiden Richtungen
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_variant_base_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis_basis text;
  v_varianten   integer;
begin
  if new.base_sky_id is null then
    return new;
  end if;

  -- RICHTUNG 1: die genannte Basisfigur darf selbst keine Variante sein.
  select s.base_sky_id into v_basis_basis
    from public.skylanders s where s.sky_id = new.base_sky_id;
  if v_basis_basis is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Varianten von '
      'Varianten gibt es nicht — die Basisfigur muss eine Basisfigur sein.',
      new.base_sky_id, v_basis_basis
      using errcode = 'check_violation';
  end if;

  /*
   * RICHTUNG 2: eine Zeile, auf die Varianten zeigen, wird selbst keine
   * Variante. Ohne diese Haelfte entstuende die Kette von unten statt von
   * oben — dieselbe verbotene Form, nur anders herum erreicht.
   */
  select count(*) into v_varianten
    from public.skylanders s where s.base_sky_id = new.sky_id;
  if v_varianten > 0 then
    raise exception '0159: auf % zeigen % Variante(n). Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', new.sky_id, v_varianten
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.skylanders_variant_base_guard() is
  'Keeps the variant relation one level deep (0159, CAT-07). A foreign key cannot look at another row, so this does: the named base figure must itself be a base figure, and a row that already has variants cannot become one. Both directions, because the forbidden chain can be built from either end. The same-series rule is NOT here - that one is structural, in skylanders_base_same_series.';

drop trigger if exists skylanders_variant_base_guard_trg on public.skylanders;
create trigger skylanders_variant_base_guard_trg
  before insert or update of base_sky_id on public.skylanders
  for each row execute function public.skylanders_variant_base_guard();


-- ---------------------------------------------------------------------------
-- 4. Das Journal kennt einen zwoelften Wert
--
-- Dieselbe Lehre zum dritten Mal: wer eine Spalte journalisiert, muss ihren
-- Namen in die Liste aufnehmen. `0152` hat es vergessen und jeder
-- Statuswechsel lief in `23514`; `0158` hat es fuer `character_id`
-- nachgezogen. Hier kommt `base_sky_id` dazu, und die elf bleiben.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- der elfte aus `0158`:
      'character_id',
      -- und der zwoelfte, aus dieser Migration:
      'base_sky_id'
    ));


-- ---------------------------------------------------------------------------
-- 4b. `admin_merge_references` muss einen ZWEISPALTIGEN Schluessel zaehlen
--
-- DAS IST EIN BEFUND DES PROBELAUFS, und er haette wehgetan. `0154` leitet
-- die verweisenden Tabellen aus `pg_constraint` her (ADR-0134) und nimmt
-- dabei blind `conkey[1]` — die ERSTE Spalte des Fremdschluessels. Bei einem
-- einspaltigen Schluessel ist das richtig. Bei einem mehrspaltigen weigert
-- sie sich ausdruecklich:
--
--     if r.spalten <> 1 then
--       raise exception '0154: % hat einen mehrspaltigen Fremdschluessel …'
--
-- Das war 2026-10-28 richtig gedacht und ist ab dieser Migration falsch:
-- `skylanders_base_same_series` ist zweispaltig, und ohne diese Korrektur
-- wuerde `admin_merge_references` bei JEDEM Aufruf abbrechen. Damit braechen
-- `admin_merge_draft` und `admin_discard_draft` — zwei Funktionen, die
-- angewendet und in Gebrauch sind.
--
-- DIE KORREKTUR MACHT SIE GENAUER, NICHT NACHSICHTIGER. Statt die erste
-- Spalte zu nehmen, sucht sie die Spalte, die WIRKLICH auf `sky_id` zeigt —
-- ueber die Stelle von `sky_id` in `confkey`. Das ist bei einem
-- einspaltigen Schluessel dieselbe Antwort wie vorher und bei einem
-- mehrspaltigen die richtige.
--
-- DER LAUTE FEHLSCHLAG BLEIBT. Zeigt ein Fremdschluessel auf `skylanders`,
-- aber nicht auf `sky_id` (etwa auf `slug`, der ebenfalls eindeutig ist),
-- kann diese Funktion ihn nicht zaehlen — und bricht ab, statt zu wenig zu
-- melden. Zu wenig zu melden hiesse: die Loeschung laeuft los und scheitert
-- mitten im Vorgang an einem `23503`. Heute gibt es keinen solchen
-- Schluessel; kaeme einer, soll er auffallen.
--
-- `0154` selbst wird NICHT angefasst — die Datei bleibt, wie sie gelaufen
-- ist. Ersetzt wird der Funktionsrumpf, wie `0156` es mit dem Rumpf aus
-- `0154` gemacht hat und `0157` mit dem aus `0156`.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_references(p_sky_id text)
returns table (tabelle text, spalte text, zeilen bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  for r in
    select c.conrelid::regclass::text              as tab,
           c.conname::text                          as name,
           array_length(c.conkey, 1)                as spalten,
           /*
            * DIE STELLE, AN DER `sky_id` IM SCHLUESSEL STEHT. `confkey` fuehrt
            * die Spalten der ZIELtabelle in derselben Reihenfolge wie
            * `conkey` die der Quelltabelle. Wer die Stelle von `sky_id` in
            * `confkey` kennt, kennt die zugehoerige Quellspalte.
            */
           (select a.attname::text
              from generate_subscripts(c.confkey, 1) as g(i)
              join pg_attribute a
                on a.attrelid = c.conrelid and a.attnum = c.conkey[g.i]
             where c.confkey[g.i] = (select a2.attnum from pg_attribute a2
                                      where a2.attrelid = c.confrelid
                                        and a2.attname = 'sky_id'
                                        and not a2.attisdropped)) as sp
      from pg_constraint c
     where c.contype = 'f'
       and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.catalog_editorial'::regclass
     order by 1, 2
  loop
    -- EIN SCHLUESSEL, DER NICHT AUF `sky_id` ZEIGT, IST NICHT ZAEHLBAR.
    -- Lieber laut abbrechen als zu wenig melden: zu wenig hiesse, die
    -- Loeschung laeuft los und scheitert mitten im Vorgang.
    if r.sp is null then
      raise exception '0159: % (%) zeigt auf skylanders, aber nicht auf sky_id — '
        'diese Funktion kann ihn nicht zaehlen', r.tab, r.name;
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
  'Counts what still points at a SKY-ID, derived from pg_catalog rather than a typed list (0154, corrected in 0159). Finds the referencing column through the position of sky_id in confkey, so a MULTI-column foreign key is counted correctly - 0159 adds one, (base_sky_id, series_code), and the original body refused those outright, which would have broken admin_merge_draft and admin_discard_draft on every call. catalog_editorial is excluded on purpose: that row belongs to the figure itself. A foreign key that points at skylanders by something other than sky_id still aborts loudly rather than under-reporting. Platform admins only.';

revoke all on function public.admin_merge_references(text) from public, anon;
grant execute on function public.admin_merge_references(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Basisfigur setzen, aendern oder loesen
--
-- SIE GILT FUER JEDE FIGUR, nicht nur fuer Entwuerfe (CAT-07): eine
-- Zuordnung wird falsch, wird nachgeholt, wird zurueckgenommen, und das muss
-- an einer laengst veroeffentlichten Figur genauso gehen.
--
-- DIE FAMILIE KOMMT AUS DER BASISFIGUR, ABER NIE GEGEN EINE VORHANDENE.
-- Vier Lagen, und nur in einer wird geschrieben:
--
--   Basisfigur hat F, Variante keine      -> F wird uebernommen
--   Basisfigur hat F, Variante hat F      -> nichts zu tun
--   Basisfigur hat F, Variante hat G <> F -> ABBRUCH, beide genannt
--   beide keine                           -> nur mit `p_create_family`
--
-- Geschrieben wird dabei ueber `admin_set_character` aus `0158`: EIN
-- Schreibweg fuer die Familie, und das Journal kommt umsonst mit.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_variant_base(
  p_sky_id        text,
  p_base_sky_id   text,
  -- Nur wirksam, wenn WEDER Variante NOCH Basisfigur eine Familie haben.
  -- Dann entsteht eine neue, benannt nach der Basisfigur, und beide bekommen
  -- sie. Ohne dieses Kennzeichen bleibt die Familie leer — eine Zuordnung
  -- ohne Familie ist vollstaendig gueltig.
  p_create_family boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_basis     public.skylanders%rowtype;
  v_alt       text;
  v_fam_neu   bigint := null;
  v_fam_tat   text   := 'unveraendert';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.base_sky_id;

  -- ---- LOESEN. Der Rueckweg ist kein Sonderfall, sondern die Haelfte.
  if p_base_sky_id is null then
    if v_alt is null then
      return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                                'changed', false, 'family', 'unveraendert');
    end if;
    update public.skylanders set base_sky_id = null where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, null, (select auth.uid()));
    return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                              'old_base_sky_id', v_alt, 'changed', true,
                              'family', 'unveraendert');
  end if;

  if p_base_sky_id = p_sky_id then
    raise exception '0159: eine Figur kann nicht ihre eigene Variante sein (%)',
      p_sky_id;
  end if;

  select * into v_basis from public.skylanders where sky_id = p_base_sky_id for update;
  if not found then
    raise exception '0159: die Basisfigur % gibt es nicht', p_base_sky_id;
  end if;

  -- DIESELBE SERIE. Der Fremdschluessel faengt es auch, aber mit einer
  -- Meldung, die niemand lesen will.
  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0159: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;

  -- KEINE KETTEN. Der Trigger faengt es auch; hier steht der lesbare Satz.
  if v_basis.base_sky_id is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0159: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  -- ======================================================================
  -- DIE FAMILIE, und sie wird NIE gegen eine vorhandene geschrieben.
  -- ======================================================================
  if v_basis.character_id is not null then
    if v_row.character_id is null then
      perform public.admin_set_character(p_sky_id, v_basis.character_id);
      v_fam_neu := v_basis.character_id;
      v_fam_tat := 'aus der Basisfigur uebernommen';
    elsif v_row.character_id = v_basis.character_id then
      v_fam_neu := v_row.character_id;
      v_fam_tat := 'war schon dieselbe';
    else
      raise exception '0159: % gehoert zur Familie %, die Basisfigur % zur '
        'Familie %. Das wird nicht stillschweigend ueberschrieben — erst '
        'klaeren, welche gilt.',
        p_sky_id, v_row.character_id, p_base_sky_id, v_basis.character_id;
    end if;
  elsif v_row.character_id is not null then
    -- Die Variante hat eine, die Basisfigur nicht. Die Basisfigur wird NICHT
    -- angefasst: eine Familienzuordnung nach OBEN zu schreiben waere eine
    -- Entscheidung ueber eine fremde Zeile.
    v_fam_neu := v_row.character_id;
    v_fam_tat := 'nur die Variante hat eine — die Basisfigur bleibt unberuehrt';
  elsif p_create_family then
    -- Beide ohne Familie, und der Bediener hat es ausdruecklich bestaetigt.
    v_fam_neu := public.admin_create_character(v_basis.name);
    perform public.admin_set_character(p_base_sky_id, v_fam_neu);
    perform public.admin_set_character(p_sky_id, v_fam_neu);
    v_fam_tat := 'neu angelegt und beiden zugeordnet';
  else
    v_fam_tat := 'beide ohne Familie — keine angelegt';
  end if;

  -- ---- Und jetzt die Zuordnung selbst.
  if v_alt is distinct from p_base_sky_id then
    update public.skylanders set base_sky_id = p_base_sky_id where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, p_base_sky_id,
            (select auth.uid()));
  end if;

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'old_base_sky_id', v_alt,
    'base_name', v_basis.name,
    'series_code', v_row.series_code,
    'character_id', v_fam_neu,
    'family', v_fam_tat,
    'changed', (v_alt is distinct from p_base_sky_id));
end;
$$;

comment on function public.admin_set_variant_base(text, text, boolean) is
  'Links a catalogue figure to its base figure within the same series, or detaches it with NULL (0159, CAT-07). Works on any figure, not just drafts - an assignment is an editorial correction. Refuses a different series, a base that is itself a variant, a row that already has variants, and itself. Carries the family over FROM the base figure when the variant has none, does nothing when both already agree, and ABORTS when they disagree - a conflicting character_id is never silently overwritten. With p_create_family it creates one named after the base figure, but only when neither side has one. Writes base_sky_id and journals it; the family goes through admin_set_character from 0158, so there is one write path for it. Platform admins only.';

revoke all on function public.admin_set_variant_base(text, text, boolean) from public, anon;
grant execute on function public.admin_set_variant_base(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Weg B: einen Entwurf als Variante einer Basisfigur veroeffentlichen
--
-- ZWEI SCHRITTE, EINE TRANSAKTION, und keiner davon ist neu: zuordnen macht
-- Abschnitt 5, veroeffentlichen macht `admin_set_catalog_status` aus `0152`.
-- Es gibt weiterhin EINEN Veroeffentlichungsweg.
--
-- `admin_publish_as_variant(text, bigint)` aus `0158` BLEIBT unveraendert.
-- Sie veroeffentlicht mit einer FAMILIE und ohne Basisfigur — das ist etwas
-- anderes und bleibt gueltig. Diese hier ist die engere Fassung.
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_with_base(
  p_sky_id        text,
  p_base_sky_id   text,
  p_create_family boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.skylanders%rowtype;
  v_zuordnung jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_base_sky_id is null then
    raise exception '0159: Weg B braucht eine Basisfigur. Ohne Basisfigur ist es '
      'Weg C — dafuer gibt es admin_set_catalog_status.';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  if v_row.catalog_status <> 'draft' then
    raise exception '0159: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_variant_base.',
      p_sky_id, v_row.catalog_status;
  end if;

  v_zuordnung := public.admin_set_variant_base(p_sky_id, p_base_sky_id, p_create_family);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'assignment', v_zuordnung,
    'published', true);
end;
$$;

comment on function public.admin_publish_with_base(text, text, boolean) is
  'Path B of the three import paths, narrowed to a base figure (0159, CAT-07): publishes a draft as a figure in its own right AND links it to a base figure of the same series, in one transaction. Drafts only. Reuses admin_set_variant_base and admin_set_catalog_status rather than inventing a second publish path. admin_publish_as_variant(text, bigint) from 0158 stays valid - it publishes with a FAMILY and no base figure, which is a different thing. The draft keeps its SKY-ID, slug, name, image, edition and price.';

revoke all on function public.admin_publish_with_base(text, text, boolean) from public, anon;
grant execute on function public.admin_publish_with_base(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'base_sky_id' and not a.attisdropped) then
    raise exception '0159 Nachbedingung: base_sky_id fehlt';
  end if;
  -- DIE DREI RIEGEL AN DER TABELLE.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_base_same_series'
                    and c.contype = 'f') then
    raise exception '0159 Nachbedingung: der Serienriegel fehlt';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_id_series_uniq'
                    and c.contype = 'u') then
    raise exception '0159 Nachbedingung: skylanders_id_series_uniq fehlt — ohne '
      'sie kann der Serienriegel nicht zeigen';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_base_not_self'
                    and c.contype = 'c') then
    raise exception '0159 Nachbedingung: skylanders_base_not_self fehlt';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_base_guard_trg'
                    and not t.tgisinternal) then
    raise exception '0159 Nachbedingung: der Kettenriegel fehlt';
  end if;

  -- DER SERIENRIEGEL MUSS BEIDE SPALTEN NENNEN. Ein einspaltiger
  -- Fremdschluessel auf `sky_id` allein saehe gleich aus und liesse jede
  -- Serie zu.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname = 'skylanders_base_same_series';
  if v_def not like '%base_sky_id%series_code%' or v_def not like '%ON UPDATE RESTRICT%' then
    raise exception '0159 Nachbedingung: der Serienriegel lautet % — erwartet sind '
      'beide Spalten und ON UPDATE RESTRICT', v_def;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def not like '%base_sky_id%' then
    raise exception '0159 Nachbedingung: das Journal kennt base_sky_id nicht: %', v_def;
  end if;
  if v_def not like '%character_id%' or v_def not like '%merged_from%'
     or v_def not like '%discarded%' or v_def not like '%catalog_status%'
     or v_def not like '%created%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' or v_def not like '%card_type%'
     or v_def not like '%image_override_path%' or v_def not like '%catalog_visible%'
     or v_def not like '%display_name_override%' then
    raise exception '0159 Nachbedingung: ein alter Journalwert ist verloren: %', v_def;
  end if;

  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0159 Nachbedingung: admin_set_variant_base fehlt';
  end if;
  if to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null then
    raise exception '0159 Nachbedingung: admin_publish_with_base fehlt';
  end if;
  -- DER ERSETZTE RUMPF VON admin_merge_references ZAEHLT MEHRSPALTIG.
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0159 Nachbedingung: admin_merge_references fehlt';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_references(text)'))
      like '%mehrspaltigen Fremdschluessel%' then
    raise exception '0159 Nachbedingung: admin_merge_references weist einen '
      'mehrspaltigen Fremdschluessel noch ab — dann bricht jede '
      'Zusammenfuehrung ab, sobald base_sky_id steht';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_references(text)'))
      not like '%confkey%' then
    raise exception '0159 Nachbedingung: admin_merge_references leitet die '
      'Spalte nicht ueber confkey her';
  end if;

  -- DIE 0158-FUNKTIONEN BLEIBEN.
  if to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null then
    raise exception '0159 Nachbedingung: eine Funktion aus 0158 ist verschwunden';
  end if;

  -- KEINE DER NEUEN FASST EINEN NAMEN ODER SLUG AN.
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                       to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
         and (p.prosrc like '%set name%' or p.prosrc like '%set slug%')) <> 0 then
    raise exception '0159 Nachbedingung: eine der Funktionen schreibt einen Namen '
      'oder einen Slug';
  end if;

  -- UND ES IST NICHTS ZUGEORDNET.
  if (select count(*) from public.skylanders where base_sky_id is not null) <> 0 then
    raise exception '0159 Nachbedingung: % Zeile(n) tragen schon eine Basisfigur. '
      'Diese Migration ordnet nichts zu.',
      (select count(*) from public.skylanders where base_sky_id is not null);
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                   to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0159 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0159: skylanders.base_sky_id steht mit Serienriegel, '
    'Selbstbezugsriegel und Kettenriegel; das Journal kennt base_sky_id; '
    'admin_set_variant_base und admin_publish_with_base stehen. Keine Zeile '
    'wurde zugeordnet.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0159_variant_base_figure.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- B  DERSELBE MASSSTAB, NOCH EINMAL — UND DER VERGLEICH, DER ZURUECKROLLT
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_vor_base  text := current_setting('skyisles.base', true);
  v_vor_coll  text := current_setting('skyisles.coll', true);
  v_vor_ident text := current_setting('skyisles.ident', true);
  v_vor_zeil  text := current_setting('skyisles.zeilen', true);
  v_vor_fam   text := current_setting('skyisles.familien', true);
  v_vor_jour  text := current_setting('skyisles.journal', true);
  v_vor_trig  text := current_setting('skyisles.trigger', true);
  v_vor_rieg  text := current_setting('skyisles.riegel', true);
  v_nach_base text;
  v_nach_coll text;
  v_nach      text;
  v_def       text;
  v_src       text;
  v_n         integer;
begin
  if v_vor_base is null or btrim(v_vor_base) = '' then
    raise exception 'ABBRUCH B1: die Shop-Baseline fehlt. Abschnitt A4 dieser '
      'Huelle hat sie nicht gesetzt — ohne Vergleich wird nichts committet.';
  end if;
  if v_vor_coll is null or btrim(v_vor_coll) = '' then
    raise exception 'ABBRUCH B2: die Sammlungs-Baseline fehlt (siehe B1).';
  end if;
  if v_vor_ident is null or btrim(v_vor_ident) = '' or v_vor_zeil is null
     or v_vor_fam is null or v_vor_jour is null or v_vor_trig is null
     or v_vor_rieg is null then
    raise exception 'ABBRUCH B2b: Identitaetsabdruck, Zeilenzahl, '
      'Familienzahl, Journalstand, Triggerliste oder Riegelliste fehlen — '
      'A5/A7 hat sie nicht gesetzt.';
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
      'dieser Migration veraendert. VORHER % — NACHHER %. Sie rollt zurueck; '
      'nichts davon liegt.', v_vor_base, v_nach_base;
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
    raise exception 'ABBRUCH B4: die Sammlung hat sich waehrend dieser '
      'Migration veraendert. VORHER % — NACHHER %.', v_vor_coll, v_nach_coll;
  end if;

  -- B5  DIE IDENTITAET HAT SICH NICHT BEWEGT — Zeile fuer Zeile.
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-'),
           E'\n' order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_ident then
    raise exception 'ABBRUCH B5: SKY-ID, Serie, Sichtbarkeit, Status oder '
      'Familie einer Katalogzeile haben sich veraendert. Abdruck vorher %, '
      'nachher %. 0159 darf keine davon anfassen.', v_vor_ident, v_nach;
  end if;

  select count(*) into v_n from public.skylanders;
  if v_n::text is distinct from v_vor_zeil then
    raise exception 'ABBRUCH B6: der Katalog hat jetzt % Zeilen, vorher %.',
      v_n, v_vor_zeil;
  end if;
  select count(*) into v_n from public.skylanders where character_id is not null;
  if v_n::text is distinct from v_vor_fam then
    raise exception 'ABBRUCH B6b: % Zeilen tragen eine Familie, vorher %. '
      '0159 ordnet keine zu.', v_n, v_vor_fam;
  end if;

  -- B7  UND SIE HAT NICHTS ZUGEORDNET. Das ist die Kernzusage: die Spalte
  --     entsteht LEER, jede Zuordnung ist danach eine einzelne Entscheidung.
  select count(*) into v_n from public.skylanders where base_sky_id is not null;
  if v_n <> 0 then
    raise exception 'ABBRUCH B7: % Zeile(n) tragen eine Basisfigur. Diese '
      'Migration ordnet nichts zu — kein Backfill, keine Massenverknuepfung.',
      v_n;
  end if;

  -- B8  GENAU EIN TRIGGER MEHR, UND KEINER VERSCHWUNDEN.
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    into v_nach from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal;
  /*
   * DAS PLATZHALTERWORT DARF NICHT MITWANDERN. Traegt die Tabelle vorher
   * keinen Trigger, steht in `v_vor_trig` das Wort `(keine)` — und ohne
   * diese Fallunterscheidung wuerde daraus die Erwartung
   * „(keine),skylanders_variant_base_guard_trg", die nie eintreten kann.
   * Auf Production stehen fuenf Trigger, der Fall tritt dort also nicht ein;
   * ein Riegel, der in einem Randfall falsch abbricht, ist trotzdem kaputt.
   * Gefunden am 2026-10-30 von `src/lib/catalog/g3-base-figure.test.ts`,
   * dessen Aufbau bewusst ohne Trigger startet.
   */
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(case when v_vor_trig = '(keine)' then array[]::text[]
                         else string_to_array(v_vor_trig, ',') end
                    || array['skylanders_variant_base_guard_trg']) as x) then
    raise exception 'ABBRUCH B8: die Triggerliste an skylanders ist % — '
      'erwartet die vorgefundene plus skylanders_variant_base_guard_trg. '
      'VORHER: %', v_nach, v_vor_trig;
  end if;

  -- B9  DREI RIEGEL MEHR, UND KEINER VERSCHWUNDEN.
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    into v_nach from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders');
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(case when v_vor_rieg = '(keine)' then array[]::text[]
                         else string_to_array(v_vor_rieg, ',') end
                    || array['skylanders_id_series_uniq',
                             'skylanders_base_not_self',
                             'skylanders_base_same_series']) as x) then
    raise exception 'ABBRUCH B9: die Riegelliste an skylanders ist % — erwartet '
      'die vorgefundene plus die drei aus 0159. VORHER: %', v_nach, v_vor_rieg;
  end if;

  -- B9b  DER SERIENRIEGEL NENNT BEIDE SPALTEN UND RESTRICT. Ein einspaltiger
  --      Fremdschluessel auf sky_id allein saehe gleich aus und liesse jede
  --      Serie zu — das ist der Unterschied zwischen Riegel und Anschein.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname = 'skylanders_base_same_series';
  if v_def is null then
    raise exception 'ABBRUCH B9c: der Serienriegel fehlt.';
  end if;
  if v_def not like '%base_sky_id%series_code%'
     or v_def not like '%ON UPDATE RESTRICT%'
     or v_def not like '%ON DELETE RESTRICT%' then
    raise exception 'ABBRUCH B9d: der Serienriegel lautet % — erwartet sind '
      'beide Spalten, ON UPDATE RESTRICT und ON DELETE RESTRICT.', v_def;
  end if;
  select count(*) into v_n from pg_class c
   where c.relname = 'skylanders_base_sky_id_idx' and c.relkind = 'i';
  if v_n <> 1 then
    raise exception 'ABBRUCH B9e: der Teilindex auf base_sky_id fehlt.';
  end if;

  -- B10  DAS JOURNAL KENNT ZWOELF WERTE.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH B10: die Journal-Constraint ist verschwunden.';
  end if;
  if v_def not like '%base_sky_id%' then
    raise exception 'ABBRUCH B10b: die Journal-Constraint kennt base_sky_id '
      'nicht (%). Dann scheitert jede Zuordnung einer Basisfigur mit 23514 — '
      'genau die Luecke, die 0152 schon einmal gekostet hat.', v_def;
  end if;
  if v_def not like '%character_id%' or v_def not like '%catalog_status%'
     or v_def not like '%merged_from%' or v_def not like '%discarded%'
     or v_def not like '%created%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' or v_def not like '%card_type%'
     or v_def not like '%image_override_path%' or v_def not like '%catalog_visible%'
     or v_def not like '%display_name_override%' then
    raise exception 'ABBRUCH B10c: ein alter Journalwert ist verloren (%).', v_def;
  end if;

  -- B11  admin_merge_references IST ERSETZT, NICHT UEBERLADEN — und sie
  --      zaehlt jetzt mehrspaltig. Ohne das braeche jede Zusammenfuehrung.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_merge_references';
  if v_n <> 1 then
    raise exception 'ABBRUCH B11: admin_merge_references liegt % mal vor, '
      'erwartet eine.', v_n;
  end if;
  select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_references(text)');
  if v_src is null then
    raise exception 'ABBRUCH B11b: die Signatur aus 0154 ist fort — der '
      'deployte Anwendungscode wuerde sie nicht mehr finden.';
  end if;
  if v_src not like '%confkey%' then
    raise exception 'ABBRUCH B11c: der Rumpf leitet die Spalte nicht ueber '
      'confkey her.';
  end if;
  if v_src like '%mehrspaltigen Fremdschluessel%' then
    raise exception 'ABBRUCH B11d: der Rumpf weist einen mehrspaltigen '
      'Fremdschluessel noch ab. Ab jetzt gibt es einen — jede '
      'Zusammenfuehrung und jedes Verwerfen braeche.';
  end if;

  -- B12  DIE ZWEI NEUEN FUNKTIONEN, JE GENAU EINMAL UND MIT IHRER SIGNATUR.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_set_variant_base';
  if v_n <> 1 or to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception 'ABBRUCH B12: admin_set_variant_base liegt % mal vor und '
      'nicht genau einmal mit (text,text,boolean).', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public')
     and p.proname = 'admin_publish_with_base';
  if v_n <> 1 or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null then
    raise exception 'ABBRUCH B12b: admin_publish_with_base liegt % mal vor und '
      'nicht genau einmal mit (text,text,boolean).', v_n;
  end if;

  -- B13  DIE RECHTE: authenticated ja, anon und PUBLIC nein.
  select count(*) into v_n from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                   to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_n <> 0 then
    raise exception 'ABBRUCH B13: % offene EXECUTE-Recht(e) auf den zwei neuen '
      'Funktionen.', v_n;
  end if;
  if not has_function_privilege('authenticated',
         'public.admin_set_variant_base(text,text,boolean)', 'execute')
     or not has_function_privilege('authenticated',
         'public.admin_publish_with_base(text,text,boolean)', 'execute') then
    raise exception 'ABBRUCH B13b: authenticated darf eine der zwei neuen '
      'Funktionen nicht ausfuehren — dann findet der Adminbereich sie nicht.';
  end if;

  -- B14  DIE FUNKTIONEN AUS 0152 UND 0158 STEHEN NOCH.
  if to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null
     or to_regprocedure('public.admin_set_catalog_status(text,text)') is null
     or to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is null
     or to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null
     or to_regprocedure('public.admin_discard_draft(text)') is null then
    raise exception 'ABBRUCH B14: eine bestehende Adminfunktion ist '
      'verschwunden.';
  end if;

  -- B15  KEINE JOURNALZEILE GESCHRIEBEN.
  select count(*) into v_n from public.catalog_admin_changes;
  if v_n::text is distinct from v_vor_jour then
    raise exception 'ABBRUCH B15: das Journal hat jetzt % Zeilen, vorher %. '
      '0159 schreibt keine.', v_n, v_vor_jour;
  end if;

  raise notice '0159 auf Production: base_sky_id steht leer, mit Serienriegel, '
    'Selbstbezugsriegel, Kettenriegel und Teilindex; das Journal kennt zwoelf '
    'Werte; admin_merge_references zaehlt mehrspaltig; admin_set_variant_base '
    'und admin_publish_with_base stehen. % Katalogzeilen unveraendert, % mit '
    'Familie, keine mit Basisfigur.', v_vor_zeil, v_vor_fam;
end
$lauf_b$;

commit;
