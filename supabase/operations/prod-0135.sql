-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0135
--              (der Katalog sagt, was ein Artikel ist)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des PRODUCTION-Projekts einfuegen, ausfuehren. Nichts in Teilen:
-- jede Zeile gehoert zur selben Klammer, und ein Fehler irgendwo rollt ALLES
-- zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert — `0132` und `0133` landeten unbeabsichtigt auf
-- Production (`docs/history/2026-10-18-production-0132-0133.md`). Diese
-- Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: bin ich wirklich auf Production?
--   B   Migration 0135, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0135_catalog_item_type.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINEN Artikel an und loescht keinen.
--   * Sie aendert KEIN Angebot: die Zahl der shopfaehigen Zeilen, die Zahl
--     der Angebote und der Abdruck ueber die Angebotsliste muessen danach
--     identisch sein — die Migration prueft das selbst und bricht sonst ab.
--   * Keine Lagerzeile, keine Bewegung, kein Beleg, kein Einkauf.
--   * Nichts an der Belegausstellung.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck.
--
-- RUECKNAHME: `supabase/rollback/R0135_drop_item_type.sql`.
-- REIHENFOLGE UND STOPP-KRITERIEN: `supabase/checks/production_release_0135_0141.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- ZWEI BEDINGUNGEN, UND BEIDE MUESSEN GELTEN. Eine negative allein waere
-- schwach: „kein Staging" stimmt auch fuer eine leere Datenbank.
--
--   A1  Der STAGING-Stempel fehlt. `SKY-0821` und `SKY-0822` gibt es auf
--       Staging und auf Production bewusst NICHT
--       (`supabase/checks/staging_pending_migrations.sql`, Zeile 101).
--   A2  `0133` ist angewendet. Sie liegt seit dem 2026-10-18 auf Production
--       und fehlt auf Staging — dieselbe Akte, dieselbe Zeile 211. Das ist
--       der POSITIVE Teil: er unterscheidet Production von einer beliebigen
--       anderen Datenbank, die nur den Staging-Stempel nicht hat.
--   A3  Und es ist kein leeres Projekt: der Katalog traegt Zeilen.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 0 then
    raise exception 'ABBRUCH A1: der STAGING-Stempel ist da. Diese Datei ist fuer '
      'Production (zmiwxswrpkmizvqsgype) — auf Staging gehoert die Datei '
      'supabase/operations/staging-0135.sql.';
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
-- B. Die Migration, unveraendert
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0135_catalog_item_type.sql
-- ===========================================================================
-- 0135 — DER KATALOG SAGT, WAS EIN ARTIKEL IST
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Entwurf nach ADR-0128, Schritt Z1. Braucht eine eigene Freigabe.     ##
-- ###########################################################################
--
-- WAS SIE TUT, UND NUR DAS
--
--   1. `skylanders.item_type` — eine Spalte mit Vorgabewert `figure` und
--      gesicherter Wertemenge.
--   2. Backfill: die Zeilen der Kategorie `Spiele` werden `game`. AUS DER
--      KATEGORIE, aus keinem Namen. 39 Zeilen auf Staging.
--   3. Eine Ableitungsregel samt Trigger, damit eine NEUE Zeile den
--      richtigen Artikeltyp bekommt — Positivliste, keine Heuristik.
--   4. `is_shop_eligible()` verlangt zusaetzlich `item_type = 'figure'`.
--
-- WARUM DIE DRITTE AENDERUNG DER EIGENTLICHE GRUND IST
--
-- `is_shop_eligible()` schliesst heute allein die KATEGORIE `'Spiele'` aus.
-- Kommen Portale als neue Kategorie dazu (Z3), waeren sie damit
-- AUTOMATISCH shopfaehig — `shop_offers()` wuerde sie anbieten, ohne dass
-- jemand eine Entscheidung getroffen haette. Die Eignung gehoert deshalb an
-- den ARTIKELTYP, nicht an einen Kategorienamen.
--
-- DIE ERGEBNISMENGE AENDERT SICH DABEI NICHT, UND DAS BEWEIST DIESE MIGRATION
-- SELBST. Figuren sind `figure`, Spiele sind ueber die Kategorie ohnehin
-- ausgeschlossen. Abschnitt 1 nimmt deshalb VOR der Aenderung drei Abdruecke
-- — die Zahl der shopfaehigen Zeilen, die Zahl der Angebote und ein `md5`
-- ueber die vollstaendige Angebotsliste (sky_id, condition, price) — und
-- Abschnitt 5 vergleicht sie danach. Weicht einer ab, bricht die Migration ab
-- und die Transaktion rollt alles zurueck, die Spalte eingeschlossen.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINEN Katalogartikel an und loescht keinen. Kein Portal, kein
--     Spiel, keine SKY-ID — Z3 ist ein eigener Schritt mit eigener Freigabe.
--   * Sie fasst KEINEN `display_name_override` an. Abschnitt 1 nimmt auch
--     darueber einen Abdruck, Abschnitt 5 prueft ihn.
--   * Sie aendert `non_collectible_categories()` NICHT. Die Kategorieregel
--     bleibt, wo sie ist; `item_type` tritt daneben. Damit bleibt die Paritaet
--     zwischen SQL und `src/lib/catalog/collectible.ts` unberuehrt, die
--     `verify:shop` prueft.
--   * Sie aendert KEINE Anwendungsschicht. Die TypeScript-Seite rechnet
--     Sammelbarkeit weiter ueber die Kategorie — unveraendertes Verhalten,
--     weil es noch kein Portal gibt. Der Umstieg gehoert zu Z3.
--   * Keine Lagerzeile, keine Bewegung, kein Beleg, kein Einkauf.
--
-- REIHENFOLGE UND ABHAENGIGKEITEN
--
-- Diese Migration haengt an `0001` (Tabelle) und `0008` (`is_shop_eligible`,
-- `non_collectible_categories`). An `0133` und `0134` haengt sie NICHT:
--
--   `0133`  Trigger und Funktion an `purchases` — kein gemeinsames Objekt.
--   `0134`  Funktion `seller_purchase(bigint)` — liest `skylanders`, nennt
--           seine Spalten aber einzeln; eine zusaetzliche Spalte ist fuer sie
--           unsichtbar. Keine Reihenfolgebedingung in beide Richtungen.
--
-- Auf Staging fehlen `0133` und `0134` am 2026-10-19. `0135` darf trotzdem
-- vorher laufen; die Luecke ist in `supabase/migrations/APPLIED.md` benannt
-- („Die Nummer ist eine Reihenfolge, keine Kette") samt der Tabelle, welche
-- Migration welche Objekte aendert.
--
-- NACHFOLGER: `0136_business_backup_item_type.sql` nimmt `item_type` in die
-- Betriebssicherung auf. Sie SETZT DIESE MIGRATION VORAUS und laeuft als
-- eigene Transaktion danach — nicht in derselben, damit der Beweis dieser
-- Datei („nichts hat sich geaendert") lesbar bleibt und beide Ruecknahmen
-- unabhaengig bleiben.
--
-- EINE TRANSAKTION, UND SIE PRUEFT SICH SELBST
--
-- Abschnitt 1 legt eine temporaere Tabelle mit `on commit drop` an und bricht
-- ab, wenn sie unmittelbar danach schon wieder fort ist — genau das passiert,
-- wenn die Datei ohne Klammer laeuft (jede Anweisung waere ihre eigene
-- Transaktion). Es gibt deshalb keinen Weg, diese Migration halb anzuwenden:
-- entweder sie laeuft als EINE Transaktion, oder sie laeuft nicht. Nach einem
-- Abbruch bleibt nichts zurueck — keine Spalte, kein CHECK, kein Kommentar,
-- kein Backfill, keine Hilfstabelle.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher `0135_preflight.sql`, danach `0135_postflight.sql`.
-- Ruecknahme: `supabase/rollback/R0135_drop_item_type.sql` — und zwar erst
-- NACH `R0136_back_to_0131.sql`, falls `0136` schon lief: die Sicherung liest
-- dann `item_type`, und PostgreSQL vermerkt dafuer keine Abhaengigkeit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen und die Abdruecke, gegen die am Ende geprueft wird
--
-- Die Abdruecke liegen in einer TEMPORAEREN Tabelle: sie lebt nur in dieser
-- Sitzung, verschwindet mit ihr und kann keine Geschaeftszeile beruehren.
-- ---------------------------------------------------------------------------
create temporary table z1_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_spiele integer;
begin
  /*
   * DER KLAMMERGRIFF — die Transaktion prueft sich selbst.
   *
   * Die Tabelle oben traegt `on commit drop`: sie verschwindet am Ende dieser
   * Transaktion, ob mit `commit` oder mit `rollback`. Laeuft die Datei NICHT
   * in einer Klammer, ist jede Anweisung ihre eigene Transaktion — dann ist
   * die Tabelle unmittelbar nach ihrer Erzeugung wieder weg, und dieser Block
   * bricht ab, BEVOR die Spalte entsteht. Es gibt damit keinen Weg, diese
   * Migration halb anzuwenden: entweder sie laeuft als eine Transaktion, oder
   * sie laeuft ueberhaupt nicht.
   *
   * `create temporary table` ohne `if not exists`: eine Tabelle dieses Namens
   * aus einem frueheren Versuch waere ein Befund, kein Grund zum Weitermachen
   * mit ALTEN Abdruecken.
   */
  if to_regclass('pg_temp.z1_abdruck') is null then
    raise exception '0135 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  /*
   * EIN ZEITLIMIT AUF DIE SPERRE, transaktionslokal.
   *
   * `alter table ... add column` nimmt ACCESS EXCLUSIVE auf `skylanders` —
   * die weltlesbare Katalogtabelle. Steht gerade eine lange lesende Abfrage,
   * stellte sich die Migration hinter sie, und JEDER weitere Katalogzugriff
   * stellte sich hinter die Migration: der Shop stuende, solange die Kette
   * laeuft. Mit fuenf Sekunden Grenze bricht stattdessen die Migration ab,
   * rollt zurueck und laesst sich wiederholen. Ein Vorgabewert ohne
   * Volatilitaet schreibt die Tabelle seit PostgreSQL 11 nicht um, der
   * Sperrzeitraum ist also kurz — aber nicht null.
   */
  perform set_config('lock_timeout', '5s', true);

  if to_regclass('public.skylanders') is null then
    raise exception '0135 setzt 0001 voraus: skylanders fehlt';
  end if;
  if to_regprocedure('public.is_shop_eligible(text)') is null then
    raise exception '0135 setzt 0008 voraus: is_shop_eligible fehlt';
  end if;
  if to_regprocedure('public.non_collectible_categories()') is null then
    raise exception '0135 setzt 0008 voraus: non_collectible_categories fehlt';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'item_type') then
    raise exception '0135 Abbruch: die Spalte item_type steht schon';
  end if;

  /* Die Kategorie, auf der der Backfill ruht, muss es geben — und zwar
     genau unter diesem Namen, denselben, den `non_collectible_categories()`
     nennt. Ohne sie waere der Backfill lautlos leer. */
  select count(*) into v_spiele from public.categories where name = 'Spiele';
  if v_spiele = 0 then
    raise exception '0135 Abbruch: keine Kategorie "Spiele" — der Backfill haette nichts zu tun';
  end if;

  insert into z1_abdruck (schluessel, wert) values
    ('shopfaehig', (select count(*)::text from public.skylanders s
                     where public.is_shop_eligible(s.sky_id))),
    ('angebote',   (select count(*)::text from public.shop_offers())),
    ('angebote_md5',
       (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                       || coalesce(o.price::text, ''),
                                       ';' order by o.sky_id, o.condition), ''))
          from public.shop_offers() o)),
    ('sammelbar',  (select count(*)::text from public.skylanders s
                      join public.categories c on c.id = s.category_id
                     where s.is_active and s.catalog_visible
                       and not (c.name = any (public.non_collectible_categories())))),
    ('sammelbar_je_serie',
       (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
          from (select s.series_code, count(*) as n
                  from public.skylanders s
                  join public.categories c on c.id = s.category_id
                 where s.is_active and s.catalog_visible
                   and not (c.name = any (public.non_collectible_categories()))
                 group by s.series_code) x)),
    ('override_md5',
       (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s where s.display_name_override is not null)),
    ('zeilen',     (select count(*)::text from public.skylanders)),
    ('spiele_zeilen',
       (select count(*)::text from public.skylanders s
          join public.categories c on c.id = s.category_id
         where c.name = 'Spiele'));

  raise notice '0135 Abdruck: % shopfaehig, % Angebote, md5 %, % sammelbar',
    (select wert from z1_abdruck where schluessel = 'shopfaehig'),
    (select wert from z1_abdruck where schluessel = 'angebote'),
    (select wert from z1_abdruck where schluessel = 'angebote_md5'),
    (select wert from z1_abdruck where schluessel = 'sammelbar');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte
--
-- `not null default 'figure'` — jede der vorhandenen Zeilen ist eine Figur,
-- bis der Backfill etwas anderes sagt. Ein Vorgabewert statt NULL, weil
-- „unbekannter Artikeltyp" kein Zustand ist, den eine Abfrage behandeln
-- muesste; jede Zeile hat einen.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column item_type text not null default 'figure';

/*
 * Die Wertemenge. `bundle` und `other` stehen schon drin, obwohl noch kein
 * solcher Artikel existiert: die Starter Packs und die beiden Taschen aus dem
 * Blatt `ZB` sind ein spaeterer, eigener Schritt (ADR-0128, Punkt 9), und ein
 * CHECK nachtraeglich zu erweitern hiesse, ihn zu ersetzen — eine Aenderung
 * mehr an einer Tabelle, die 605 Zeilen traegt.
 */
alter table public.skylanders
  add constraint skylanders_item_type_known
    check (item_type in ('figure', 'game', 'portal', 'bundle', 'other'));

comment on column public.skylanders.item_type is
  'Was dieser Katalogartikel IST (0135, ADR-0128): figure | game | portal | bundle | other. Vorgabewert figure. Entscheidet die Shop-Eignung (is_shop_eligible) und spaeter die Sammelbarkeit — statt eines Kategorienamens, denn eine neue Kategorie waere sonst automatisch shopfaehig. Die Kategorie bleibt daneben bestehen und wird nicht ersetzt.';


-- ---------------------------------------------------------------------------
-- 3. Der Backfill — aus der Kategorie, aus keinem Namen
--
-- `0117` hat gezeigt, wohin Namensheuristik fuehrt: „Wii U Spiel" ist der
-- Name von drei verschiedenen Spielen. Die Kategorie `Spiele` ist dagegen
-- eine redaktionelle Zuordnung, sie ist je Serie eindeutig, und
-- `non_collectible_categories()` nennt genau sie.
-- ---------------------------------------------------------------------------
update public.skylanders s
   set item_type = 'game'
 where exists (select 1 from public.categories c
                where c.id = s.category_id and c.name = 'Spiele');


-- ---------------------------------------------------------------------------
-- 3a. DAMIT EINE NEUE ZEILE NICHT WIEDER FALSCH ANFAENGT
--
-- Der Backfill oben trifft die 605 Zeilen von heute. Eine Zeile, die MORGEN
-- entsteht, trifft er nicht — und der Katalogimport nennt `item_type` nicht:
-- er schreibt genau neun Spalten, und das ist richtig so (`card_type` und
-- `source` stehen aus demselben Grund nicht im Payload, siehe
-- `src/lib/catalog/import-payload.test.ts`). Ein neu importiertes Spiel
-- bekaeme damit `figure` aus dem Vorgabewert.
--
-- WARUM NICHT IM IMPORTER. Wer `item_type` in den Payload nimmt, schreibt ihn
-- bei JEDEM Lauf — und ueberschreibt damit irgendwann eine Entscheidung, die
-- jemand von Hand getroffen hat. Genau diese Falle ist bei `card_type`
-- schriftlich festgehalten: „a heuristic that runs on every import is a
-- heuristic that eventually overwrites a decision somebody made."
--
-- WARUM EIN TRIGGER. Er greift auf JEDEM Schreibweg — Import, Adminbereich,
-- SQL-Editor, kuenftiges Werkzeug — und nicht nur auf dem, an den jemand
-- gedacht hat.
--
-- DIE REGEL IST EINE POSITIVLISTE, KEINE HEURISTIK.
-- `catalog_item_type_for_category()` ist die EINE Stelle, an der eine
-- Kategorie einen Artikeltyp bekommt:
--
--     'Spiele'  ->  'game'
--     alles andere  ->  'figure'
--
-- Ein UNBEKANNTER Kategoriename wird also NIE zum Spiel. Z3 erweitert diese
-- Funktion um 'Portale' -> 'portal' — zusammen mit den Zeilen, die dann
-- entstehen, und mit einer eigenen Freigabe. Bis dahin gibt es kein Portal,
-- also auch keine Ableitung dafuer.
--
-- UND ER UEBERSCHREIBT KEINE ENTSCHEIDUNG. Der Trigger setzt nur, wenn die
-- Zeile den VORGABEWERT traegt. Wer ausdruecklich 'portal', 'bundle' oder
-- 'other' schreibt, behaelt es.
-- ---------------------------------------------------------------------------
create or replace function public.catalog_item_type_for_category(p_category_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Positivliste. Kein `else 'game'`, nirgends: ein unbekannter Name ist eine
  -- Figur, kein Spiel.
  select case p_category_name
           when 'Spiele' then 'game'
           else 'figure'
         end;
$$;

comment on function public.catalog_item_type_for_category(text) is
  'The one place a category name maps to an item type (0135, ADR-0128): Spiele -> game, everything else -> figure. A POSITIVE list: an unknown category is a figure, never a game. Z3 extends it with Portale -> portal, together with the rows that need it. Pure, immutable, reads nothing.';

revoke all on function public.catalog_item_type_for_category(text) from public, anon, authenticated, service_role;

create or replace function public.skylanders_set_item_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abgeleitet text;
begin
  select public.catalog_item_type_for_category(c.name) into v_abgeleitet
    from public.categories c where c.id = new.category_id;

  /*
   * NUR DEN VORGABEWERT ERSETZEN.
   *
   * `item_type = 'figure'` heisst „niemand hat etwas anderes gesagt" — der
   * Vorgabewert der Spalte. Steht dort 'portal', 'bundle' oder 'other', hat
   * jemand ausdruecklich entschieden, und das bleibt stehen.
   *
   * `security definer`: der Trigger liest `categories`, und die Tabelle
   * fuehrt RLS. Ein Schreibweg, der die Kategorie nicht lesen darf, soll
   * trotzdem den richtigen Artikeltyp bekommen.
   */
  if new.item_type = 'figure'
     and v_abgeleitet is not null
     and v_abgeleitet <> 'figure' then
    new.item_type := v_abgeleitet;
  end if;

  return new;
end;
$$;

comment on function public.skylanders_set_item_type() is
  'Derives skylanders.item_type from the row category on insert, and when the category changes (0135). Only replaces the column default: an explicit portal/bundle/other survives. The mapping lives in catalog_item_type_for_category() and is a positive list - an unknown category stays figure.';

/*
 * `insert or update of category_id`, nicht `update` ohne Spalte: der Backfill
 * oben schreibt `item_type` selbst, und ein Trigger, der dabei feuert, waere
 * ein Kreis. Die Kategorieaenderung ist dagegen genau der Fall, in dem eine
 * Berichtigung den Artikeltyp mitnehmen soll — eine Figur, die nach `Spiele`
 * umgehaengt wird, IST ein Spiel.
 */
create trigger skylanders_item_type_from_category
  before insert or update of category_id on public.skylanders
  for each row execute function public.skylanders_set_item_type();


-- ---------------------------------------------------------------------------
-- 4. Die Shop-Eignung haengt am Artikeltyp
--
-- Der Rumpf ist der aus `0008`, Zeichen fuer Zeichen, mit genau einer Zeile
-- mehr. Die Kategoriebedingung bleibt ausdruecklich stehen: zwei Riegel sind
-- hier kein Widerspruch, sondern Gurt und Hosentraeger — und sie halten die
-- Parität zu `src/lib/catalog/collectible.ts`, die `verify:shop` prueft.
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_eligible(p_sky_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.skylanders s
      join public.categories c on c.id = s.category_id
     where s.sky_id = p_sky_id
       and s.is_active
       and s.catalog_visible
       and s.item_type = 'figure'
       and not (c.name = any (public.non_collectible_categories()))
  );
$$;

comment on function public.is_shop_eligible(text) is
  'Whether a figure may be offered in the shop at all: active, editorially visible, item_type = figure, and a collectible rather than software (ADR-0048, ADR-0128). The item_type clause came with 0135 and is what keeps a NEW category — portals, bundles — out of the storefront by construction instead of by somebody remembering to extend non_collectible_categories(). Says nothing about stock or price.';

revoke all on function public.is_shop_eligible(text) from public;
grant execute on function public.is_shop_eligible(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen — und der Beweis, dass kein Angebot sich geaendert hat
-- ---------------------------------------------------------------------------
do $$
declare
  v_soll text;
  v_ist  text;
  v_n    integer;
begin
  -- 5a. Die Spalte, der CHECK, die Wertemenge
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type' and is_nullable = 'NO'
                    and column_default like '%figure%') then
    raise exception '0135 Abbruch: item_type fehlt, ist nullable oder hat nicht den Vorgabewert figure';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'skylanders_item_type_known') then
    raise exception '0135 Abbruch: der CHECK auf item_type fehlt';
  end if;

  -- 5b. Der Backfill trifft genau die Spiele-Zeilen
  select count(*) into v_n from public.skylanders where item_type = 'game';
  v_soll := (select wert from z1_abdruck where schluessel = 'spiele_zeilen');
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Zeilen sind game, erwartet % (Kategorie Spiele)', v_n, v_soll;
  end if;
  if exists (select 1 from public.skylanders s
              where s.item_type = 'game'
                and not exists (select 1 from public.categories c
                                 where c.id = s.category_id and c.name = 'Spiele')) then
    raise exception '0135 Abbruch: eine game-Zeile liegt nicht in der Kategorie Spiele';
  end if;
  if exists (select 1 from public.skylanders s
              join public.categories c on c.id = s.category_id
             where c.name = 'Spiele' and s.item_type <> 'game') then
    raise exception '0135 Abbruch: eine Zeile der Kategorie Spiele ist nicht game';
  end if;
  if exists (select 1 from public.skylanders
              where item_type not in ('figure', 'game')) then
    raise exception '0135 Abbruch: es gibt bereits einen anderen Artikeltyp als figure/game';
  end if;

  -- 5c. Zeilenzahl unveraendert — es wurde nichts angelegt und nichts geloescht
  v_soll := (select wert from z1_abdruck where schluessel = 'zeilen');
  select count(*) into v_n from public.skylanders;
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Katalogzeilen, vorher % — es wurde angelegt oder geloescht',
      v_n, v_soll;
  end if;

  -- 5d. DIE ANGEBOTE. Identitaet, Zustand und Preis, als ein Abdruck.
  v_soll := (select wert from z1_abdruck where schluessel = 'angebote_md5');
  select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                  || coalesce(o.price::text, ''),
                                  ';' order by o.sky_id, o.condition), ''))
    into v_ist from public.shop_offers() o;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: die Angebotsliste hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'angebote');
  select count(*) into v_n from public.shop_offers();
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Angebote, vorher %', v_n, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'shopfaehig');
  select count(*) into v_n from public.skylanders s
   where public.is_shop_eligible(s.sky_id);
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % shopfaehige Zeilen, vorher %', v_n, v_soll;
  end if;

  -- 5e. Der Fortschritts-Nenner, gesamt und je Serie
  v_soll := (select wert from z1_abdruck where schluessel = 'sammelbar');
  select count(*) into v_n from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()));
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % sammelbare Artikel, vorher %', v_n, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'sammelbar_je_serie');
  select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
    into v_ist
    from (select s.series_code, count(*) as n
            from public.skylanders s
            join public.categories c on c.id = s.category_id
           where s.is_active and s.catalog_visible
             and not (c.name = any (public.non_collectible_categories()))
           group by s.series_code) x;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: der Nenner je Serie hat sich geaendert (% statt %)',
      v_ist, v_soll;
  end if;

  -- 5f. Kein display_name_override angefasst
  v_soll := (select wert from z1_abdruck where schluessel = 'override_md5');
  select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                 ';' order by s.sky_id), ''))
    into v_ist from public.skylanders s where s.display_name_override is not null;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: ein display_name_override hat sich geaendert';
  end if;

  -- 5f2. Die Ableitungsregel steht, und sie ist eine Positivliste
  if to_regprocedure('public.catalog_item_type_for_category(text)') is null then
    raise exception '0135 Abbruch: catalog_item_type_for_category fehlt';
  end if;
  if public.catalog_item_type_for_category('Spiele') <> 'game' then
    raise exception '0135 Abbruch: die Kategorie Spiele ergibt nicht game';
  end if;
  /* KEINE pauschale Einordnung: was die Regel nicht kennt, ist eine Figur. */
  foreach v_soll in array array['Portale', 'Bundles', 'Taschen', '', 'Unbekannt'] loop
    if public.catalog_item_type_for_category(v_soll) <> 'figure' then
      raise exception '0135 Abbruch: der unbekannte Kategoriename "%" ergibt % statt figure',
        v_soll, public.catalog_item_type_for_category(v_soll);
    end if;
  end loop;
  if public.catalog_item_type_for_category(null) is distinct from 'figure' then
    raise exception '0135 Abbruch: eine Zeile ohne Kategorie ergibt nicht figure';
  end if;

  -- 5f3. Der Trigger steht, auf insert UND auf die Kategorieaenderung
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_item_type_from_category') then
    raise exception '0135 Abbruch: der Trigger skylanders_item_type_from_category fehlt';
  end if;
  if (select t.tgtype & 4 from pg_trigger t                       -- BEFORE INSERT
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category') = 0 then
    raise exception '0135 Abbruch: der Trigger feuert nicht bei INSERT';
  end if;
  if (select t.tgtype & 16 from pg_trigger t                      -- BEFORE UPDATE
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category') = 0 then
    raise exception '0135 Abbruch: der Trigger feuert nicht bei UPDATE';
  end if;
  if (select count(*) from pg_trigger t, unnest(t.tgattr) a
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category'
          and a = (select attnum from pg_attribute
                    where attrelid = 'public.skylanders'::regclass
                      and attname = 'category_id')) <> 1 then
    raise exception '0135 Abbruch: der UPDATE-Trigger haengt nicht an category_id';
  end if;

  -- 5f4. Regel und Sammelbarkeit widersprechen sich nicht
  /*
   * Eine Kategorie, die `game` ergibt, MUSS nicht sammelbar sein — sonst
   * zaehlte der Fortschritt Spiele mit, und die Ableitung haette eine
   * Nebenwirkung, die niemand entschieden hat.
   */
  if exists (select 1 from public.categories c
              where public.catalog_item_type_for_category(c.name) = 'game'
                and not (c.name = any (public.non_collectible_categories()))) then
    raise exception '0135 Abbruch: eine Kategorie ergibt game, ist aber sammelbar';
  end if;

  -- 5g. Die Kategorieregel ist unberuehrt — die Paritaet zur Anwendung haelt
  if (select array_to_string(public.non_collectible_categories(), ',')) <> 'Spiele' then
    raise exception '0135 Abbruch: non_collectible_categories() wurde veraendert';
  end if;

  -- 5h. Der neue Riegel steht wirklich im Rumpf
  if position('s.item_type = ''figure''' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) = 0 then
    raise exception '0135 Abbruch: is_shop_eligible prueft item_type nicht';
  end if;
  if position('non_collectible_categories' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) = 0 then
    raise exception '0135 Abbruch: is_shop_eligible hat die Kategoriebedingung verloren';
  end if;

  -- 5i. Die Rechte sind die von 0008
  if (select p.proacl is null from pg_proc p
       where p.oid = to_regprocedure('public.is_shop_eligible(text)')) then
    raise exception '0135 Abbruch: is_shop_eligible hat keinen ACL — der Standard waere PUBLIC';
  end if;
  if not (has_function_privilege('anon', 'public.is_shop_eligible(text)', 'execute')
          and has_function_privilege('authenticated', 'public.is_shop_eligible(text)', 'execute')) then
    raise exception '0135 Abbruch: anon oder authenticated darf is_shop_eligible nicht ausfuehren';
  end if;

  raise notice '0135: item_type steht, % Spiele markiert, Angebote unveraendert (md5 %)',
    (select wert from z1_abdruck where schluessel = 'spiele_zeilen'),
    (select wert from z1_abdruck where schluessel = 'angebote_md5');
end $$;

/*
 * KEIN `drop table` AM ENDE, UND DAS IST DER PUNKT.
 *
 * Hier stand `drop table if exists z1_abdruck;`. Das raeumte nur den
 * ERFOLGSFALL auf: bricht die Migration in Abschnitt 5 ab und ist sie nicht
 * geklammert, waeren die vier Anweisungen davor bereits bestaetigt und die
 * Temporaertabelle lebte mit veralteten Abdruecken weiter. `on commit drop`
 * raeumt beide Faelle auf — `commit` und `rollback` — und braucht keine
 * Anweisung dafuer. Damit bleibt nach einem Abbruch nichts zurueck: keine
 * Spalte, kein CHECK, kein Kommentar, kein Backfill, keine Hilfstabelle.
 */
-- <<< ENDE: supabase/migrations/0135_catalog_item_type.sql

commit;
