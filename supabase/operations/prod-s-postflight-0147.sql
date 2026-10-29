-- ========================================================================
-- PRODUCTION — DER ZUSTAND NACH 0147, REIN LESEND
--
-- NACH `prod-0147.sql` fahren. Vollstaendig markieren, in den SQL-Editor des
-- Production-Projekts zmiwxswrpkmizvqsgype einfuegen, ausfuehren. Sie
-- schreibt nichts; die Klammer und das `rollback` stehen schon darin.
--
-- DEN UMGEKEHRTEN STEMPEL TRAEGT SIE TROTZDEM, obwohl sie nichts schreibt.
-- Der Grund ist nicht Schaden, sondern WAHRHEIT: am 2026-10-20 liefen
-- Pruefdateien auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
--
-- ###########################################################################
-- ##  ZWEI STELLEN MUSS DER BEDIENER ERSETZEN:                            ##
-- ##    BASIS-HIER-EINSETZEN      <- Zeile 900 des Preflights              ##
-- ##    SAMMLUNG-HIER-EINSETZEN   <- Zeile 901 des Preflights              ##
-- ###########################################################################
--
-- BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH — und das
-- ist der Kern ihrer Schutzwirkung. Die Huelle bringt beide
-- `set_config`-Zeilen schon mit, damit niemand sie vergisst; genau deshalb
-- muss ein NICHT ersetzter Platzhalter wie eine FEHLENDE Zeile behandelt
-- werden. Die eingebettete Pruefdatei tut das: sie macht aus dem Platzhalter
-- `null` (zwei `nullif`), Zeile **801** meldet „FEHLT", die Zeilen 802 bis
-- 804 fallen auf „keine Baseline", und in den Vergleichszeilen 811 bis 817
-- steht als Erwartung der Satz `(keine gueltige Basis)` statt einer Zahl.
-- Jede dieser Zeilen ist dann ROT und zaehlt in `9999`. Eine fehlende
-- Baseline kann hier also nicht als bestandene Pruefung durchgehen.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die entscheidenden Zeilen
-- sind **105** (keine bereits gemeldete Zeile ist durch die Nachfuellung
-- faellig geworden), **107** (die faelligen sind genau die ohne gemeldeten
-- Stand — dieselbe Zahl wie Zeile 125 des Preflights), **113** bis **116**
-- (`offer_availability_due()` ist `definer` UND `stable`, beide Funktionen
-- haben genau eine leere `search_path`-Festlegung und kein Clientrecht) und
-- **121** (KEIN Trigger am Spiegel).
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- ZWEI VERTRAEGE, unveraendert die aus `0142` bis `0145`: der Basis-Vertrag
-- (Shop, Lager, Katalog) und der Sammlungs-Vertrag. Die Messbloecke sind
-- zeichengleich dieselben, also ist eine Baseline aus einem dieser Laeufe
-- hier lesbar und umgekehrt. Die Feldfolge beider steht im Kopf der
-- eingebetteten Pruefdatei.
--
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN — eine vertauschte Zeile
-- waere eine stille Fehlinformation, weil nach POSITION verglichen wird:
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
--
-- DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS, ausdruecklich.
--
-- Er sagt „zwischen den beiden Laeufen hat sich X bewegt". Er sagt NICHT,
-- WER es bewegt hat. Zwischen Preflight und Nachkontrolle kann regulaerer
-- Betrieb stattgefunden haben: ein Verkauf im Shop, ein Wareneingang, eine
-- Umpreisung — und an der Sammlung ein Sammler, der eine Figur hinzufuegt.
--
-- SO UNTERSCHEIDET MAN BEIDES:
--
--   1. ZEITFENSTER KLEIN HALTEN. Preflight, Migration und Nachkontrolle
--      hintereinander fahren.
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN — jedenfalls nicht am Shop,
--      am Lager, am Katalog oder an der Sammlung. `0147` fuegt `offer_state`
--      eine Spalte an, fuellt sie IM SPIEGEL nach, ersetzt
--      `refresh_offer_state()` und legt zwei lesende Funktionen an. Sie
--      enthaelt kein `update`, `insert` oder `delete` auf eine andere
--      Tabelle, und sie legt keinen Trigger an — Zeile 121 der Nachkontrolle
--      misst das.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest die
--      Shop-Seite tagweise auf.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben. Die Abdruecke fangen das ab — sie haengen an Inhalt
-- und Reihenfolge, nicht nur an der Anzahl.
--
-- WAS SIE NICHT BEANTWORTET: ob der Spiegel fachlich RICHTIG spiegelt, und
-- ob die Phasengrenze fachlich stimmt. Das zeigt erst ein Aufruf von
-- `refresh_offer_state()` samt Blick in die Tabelle — die Anleitung dazu
-- steht in `supabase/checks/0147_staging_run.md`.
--
-- EINGEBETTET: `supabase/checks/0147_postflight.sql`, Zeichen fuer Zeichen.
-- ========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0147.sql.';
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
-- B  DIE BEIDEN BASISZEILEN AUS DEM PREFLIGHT
--
-- Transaktionslokal (`true`), mit dem `rollback` unten fort.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', 'BASIS-HIER-EINSETZEN', true);
select set_config('skyisles.coll', 'SAMMLUNG-HIER-EINSETZEN', true);

-- >>> EINGEBETTET: supabase/checks/0147_postflight.sql
-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0147, REIN LESEND
--
-- NACH `0147_offer_availability.sql` fahren. Vollstaendig markieren, in den
-- SQL-Editor einfuegen, ausfuehren.
--
-- **Erwartet: Zeile 9999 = `0`.**
--
-- DIE DREI ZUSAGEN VON `0147`, als Messung:
--
--   101-107  die Spalte steht, jede kaufbare Zeile hat eine Phasengrenze,
--            und — die wichtigste Zeile dieses Blattes — **keine bereits
--            gemeldete Zeile ist faellig geworden**. Zeile 107 misst die
--            Zusage in ihrer scharfen Form: faellig ist genau, worueber noch
--            nie berichtet wurde.
--   111-117  die zwei neuen Funktionen in der richtigen Art (`immutable`
--            bzw. **`stable`**), ohne Clientrecht, mit leerem `search_path`
--            — und `refresh_offer_state()` pflegt die Phasengrenze, ohne
--            dass eine Preisaenderung sie beruehrt.
--   121-122  kein Trigger, nichts an Shop, Lager oder Sammlung.
--
-- WARUM `stable` EINE EIGENE ZEILE BEKOMMT (113): waere
-- `offer_availability_due()` `volatile`, koennte sie ein Ereignis
-- verbrauchen, bevor S3 es uebernehmen kann — und dann waere es nach einem
-- Fehlschlag von S3 verloren. Die Art der Funktion IST die Zusage.
--
-- DIE ZWEI BASELINES (801-833) kommen aus dem Preflight und werden
-- BLOCKIEREND verglichen: `0147` fasst weder Shop noch Lager noch Sammlung
-- an.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN. Sie steht hier, weil ein
-- vertauschtes Feld eine stille Fehlinformation waere: die Nachkontrolle
-- vergleicht nach POSITION (`t[2]` … `t[8]`), nicht nach Namen.
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang hat auf `offer_state`
-- kein `select` und auf die neuen Funktionen kein `execute` (sie erteilen
-- keines). Diese Zeilen melden ihm `KEIN-RECHT`, zaehlen in Zeile 9998 und
-- sind damit OFFEN — nicht bestanden, nicht abgewichen, sondern nicht
-- durchgefuehrt. **Die Abnahme von `0147` braucht deshalb den Lauf als
-- `postgres`**, wo 9998 = 0 ist; der Runner schreibt die Datei dafuer.
--
-- Strukturen und Rechte kommen aus `pg_catalog`, nie aus
-- `information_schema` (ADR-0141).
-- ===========================================================================

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
),
basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile.
   */
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.base', true), '')), ''),
                'BASIS-HIER-EINSETZEN') as roh
),
basis_teil as (
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as t
    from basis_roh
),
basis as (
  select roh, t,
         (t is not null and array_length(t, 1) = 9)                 as neun,
         (t is not null and t[1] = 'skyisles-base-1')               as marke,
         case when t is not null and array_length(t, 1) = 9
              then t[9] = left(md5(array_to_string(t[2:8], '|')), 12)
         end                                                        as schutz_ok,
         (t is not null and array_length(t, 1) = 9
          and t[1] = 'skyisles-base-1'
          and t[9] = left(md5(array_to_string(t[2:8], '|')), 12))   as gueltig
    from basis_teil
),
coll_mess as (
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
),
coll_roh as (
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.coll', true), '')), ''),
                'SAMMLUNG-HIER-EINSETZEN') as roh
),
coll_teil as (
  /*
   * `k` UND NICHT `t`, UND DAS IST KEIN SCHOENHEITSWUNSCH.
   *
   * Der Basis-Vertrag oben legt seine Felder in `t` ab und entscheidet mit
   * `gueltig`. `staging-oneshot.test.ts` haelt fuer die ganze Familie fest,
   * dass GENAU SIEBEN Vergleiche ihren Sollwert aus `when gueltig then t[…]`
   * holen — so faellt auf, wenn einer davon heimlich aus der Messung kaeme.
   * Haette der zweite Vertrag dieselben Namen, waeren es zehn Treffer, und
   * der Waechter koennte die beiden nicht mehr trennen. Er schlug beim
   * ersten Lauf dieser Datei genau deshalb an und hatte recht damit.
   *
   * Zwei Vertraege, zwei Namen: `t`/`gueltig` fuer den Shop,
   * `k`/`coll_gueltig` fuer die Sammlung.
   */
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as k
    from coll_roh
),
coll as (
  select roh, k,
         (k is not null and k[1] = 'skyisles-coll-1')               as marke,
         case when k is not null and array_length(k, 1) = 5
              then k[5] = left(md5(array_to_string(k[2:4], '|')), 12)
         end                                                        as schutz_ok,
         (k is not null and array_length(k, 1) = 5
          and k[1] = 'skyisles-coll-1'
          and k[5] = left(md5(array_to_string(k[2:4], '|')), 12))   as coll_gueltig
    from coll_teil
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proacl, p.proname,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab. Ein
          * Vergleich gegen ein Literal waere ein Fehlalarm in Wartestellung
          * — `src/lib/admin/migration-integrity.test.ts` haelt diese Regel
          * fuer jede Pruefdatei fest, die `proconfig` liest.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadanzahl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refresh_offer_state'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------- Die Spalte und ihr Sinn
  (101, 'Spalte', 'neun Spalten, buyable_since als letzte',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.offer_state')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
      || 'announced_buyable,announced_cents,announced_at,buyable_since'),
  (102, 'Spalte', 'und sechs CHECKs — die fuenf aus 0146 plus einer',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state') and contype = 'c'), '6'),
  (103, 'Spalte', 'der neue heisst offer_state_buyable_since_present',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state')
          and conname = 'offer_state_buyable_since_present'), '1'),
  (104, 'Spalte', 'jede kaufbare Zeile traegt eine Phasengrenze',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state '
               'where buyable and buyable_since is null',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  /*
   * ------------------------------------------------- DIE WICHTIGSTE ZEILE
   *
   * Die Nachfuellung darf keine Neuigkeit erfinden. `0147` setzt
   * `buyable_since = least(changed_at, announced_at)` fuer gemeldete Zeilen,
   * und genau deshalb kann keine von ihnen faellig werden — auch dann
   * nicht, wenn sich seit der Erstbefuellung ein PREIS geaendert hat und
   * `changed_at` damit hinter `announced_at` steht.
   *
   * Zeile 107 sagt es scharf: faellig ist GENAU, worueber noch nie
   * berichtet wurde. Nicht mehr und nicht weniger.
   */
  (105, 'Nachfuellung', 'KEINE bereits gemeldete Zeile ist faellig geworden',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state '
               'where buyable and buyable_since is not null '
               'and announced_at is not null and buyable_since > announced_at',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),
  (106, 'Nachfuellung', 'Info: wie viele Figuren jetzt faellig sind',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_availability_due()',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (107, 'Nachfuellung', 'und das sind genau die ohne gemeldeten Stand',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
            and has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select ((select count(*) from public.offer_availability_due()) '
               '= (select count(*) from public.offer_state '
               'where buyable and announced_at is null)) as c',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, 'true'),

  -- ------------------------------------------------- Die zwei neuen Funktionen
  (111, 'Funktion', 'offer_availability_grace() steht, immutable',
      coalesce((select (provolatile = 'i')::text from pg_proc
                 where oid = to_regprocedure('public.offer_availability_grace()')),
               '(keine Funktion)'), 'true'),
  (112, 'Funktion', 'und ihr Wert ist reservation_ttl() + 10 Minuten',
      case when has_function_privilege('public.offer_availability_grace()', 'execute')
            and has_function_privilege('public.reservation_ttl()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select (public.offer_availability_grace() '
               '= public.reservation_ttl() + interval ''10 minutes'') as c',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, 'true'),
  (113, 'Funktion', 'offer_availability_due() ist definer UND STABLE — sie darf kein '
        'Ereignis verbrauchen',
      coalesce((select (prosecdef and provolatile = 's')::text from pg_proc
                 where oid = to_regprocedure('public.offer_availability_due()')),
               '(keine Funktion)'), 'true'),
  /*
   * AUSGEPACKT, NICHT VERGLICHEN. `proconfig = array['search_path=']` ist
   * der naive Vergleich: PostgreSQL legt die Festlegung nicht garantiert so
   * ab, und ein `staging-0137.sql` hat daran am 2026-10-20 schon einmal
   * einen Lauf abgebrochen, obwohl die Funktion in Ordnung war. Deshalb
   * dasselbe Vorgehen wie in `0146`, Zeilen 134/135: die Festlegung ueber
   * ein LIKE-Praefix finden und ihren Wert auspacken.
   */
  (114, 'Funktion', 'beide haben GENAU EINE search_path-Festlegung',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.offer_availability_due()'),
                        to_regprocedure('public.offer_availability_grace()'))
          and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%') = 1), '2'),
  (115, 'Funktion', 'und beide Werte sind LEER (ausgepackt, nicht verglichen)',
      (select coalesce(string_agg(distinct w, ','), '(keine)')
         from pg_proc p,
              lateral (select substring(c from 'search_path=(.*)$') as w
                         from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search\_path=%') u
        where p.oid in (to_regprocedure('public.offer_availability_due()'),
                        to_regprocedure('public.offer_availability_grace()'))),
      '""'),
  (116, 'Funktion', 'und ohne jedes Clientrecht',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.offer_availability_due()'),
                        to_regprocedure('public.offer_availability_grace()'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (117, 'Funktion', 'refresh_offer_state() pflegt buyable_since und rechnet gegen '
        'reservation_ttl()',
      coalesce((select (prosrc like '%buyable_since%'
                        and prosrc like '%reservation_ttl()%')::text
                  from pg_proc
                 where oid = to_regprocedure('public.refresh_offer_state()')),
               '(keine Funktion)'), 'true'),
  (118, 'Funktion', 'und ist weiterhin definer und volatile',
      coalesce((select (prosecdef and provolatile = 'v')::text
                  from pg_proc
                 where oid = to_regprocedure('public.refresh_offer_state()')),
               '(keine Funktion)'), 'true'),

  -- ---------------------------------------------- Kein Trigger, nichts sonst
  /*
   * TRIGGER: BENANNTE ERWARTUNG, KEINE ZAEHLUNG.
   *
   * Eine Zeile „`count(*) = 0` an den Quellen" hat den Staging-Lauf von
   * `0147` am 2026-10-26 abgebrochen — mit sechs voellig legitimen Triggern
   * als Grund. Die Quellen HABEN Trigger (Zeitstempel, Unveraenderlichkeit,
   * Redaktionsprotokoll, Artikeltyp), und sie sollen sie haben. Dieselbe
   * Sorte Fehler wie die Richtlinienzahl in `0142`.
   *
   * Jetzt drei Zeilen: am Spiegel KEINER, an den Quellen nur die sechs
   * bekannten (jeder beim Namen), und die sechs sind noch da. Die Liste ist
   * in Migration, Preflight, Nachkontrolle und Huelle dieselbe —
   * `availability.test.ts` prueft, dass sie nicht auseinanderlaufen.
   */
  (121, 'Trigger', 'KEIN Trigger am Spiegel — die zentrale Zusage der Phase 4',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.offer_state')
          and not t.tgisinternal), '0'),
  (122, 'Trigger', 'und an den Quellen nur die sechs bekannten',
      (select coalesce(string_agg(c.relname::text || '.' || t.tgname::text, ', '
                                  order by c.relname, t.tgname), '(keine)')
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where c.oid in (to_regclass('public.shop_inventory'),
                        to_regclass('public.skylanders'),
                        to_regclass('public.shop_settings'),
                        to_regclass('public.offer_state'))
          and not t.tgisinternal
          and (c.relname::text || '.' || t.tgname::text) <> all (array[
             'shop_inventory.shop_inventory_identity_immutable',
             'shop_inventory.shop_inventory_set_updated_at',
             'skylanders.skylanders_item_type_from_category',
             'skylanders.skylanders_log_editorial',
             'skylanders.skylanders_set_updated_at',
             'skylanders.skylanders_sky_id_immutable'])),
      '(keine)'),
  (123, 'Trigger', 'die sechs bestehenden sind noch da (0001, 0003, 0004, 0135)',
      (select count(*)::text
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal
          and (c.relname::text || '.' || t.tgname::text) = any (array[
             'shop_inventory.shop_inventory_identity_immutable',
             'shop_inventory.shop_inventory_set_updated_at',
             'skylanders.skylanders_item_type_from_category',
             'skylanders.skylanders_log_editorial',
             'skylanders.skylanders_set_updated_at',
             'skylanders.skylanders_sky_id_immutable'])), '6'),
  (124, 'Spiegel', 'Info: Zeilen im Spiegel (unveraendert gegenueber Zeile 121 des '
        'Preflights)',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (125, 'Spiegel', 'Info: davon kaufbar',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state where buyable',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0147 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      case when has_function_privilege('public.shop_offers()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.shop_offers() o '
               'join public.skylanders s on s.sky_id = o.sky_id '
               'where s.item_type <> ''figure''',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  -- ================================== Die Shop-Baseline aus dem Preflight
  (801, 'Basis', 'eine Shop-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 900 des '
                        || 'Preflights in set_config(''skyisles.base'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-base-1',
      (select coalesce(marke::text, 'keine Baseline') from basis), 'true'),
  (803, 'Basis', 'sie hat neun Felder',
      (select case when t is null then 'keine Baseline'
                   else array_length(t, 1)::text end from basis), '9'),
  (804, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from basis), 'true'),

  (811, 'Shop', 'oeffentliche Angebote wie vor der Migration',
      (select angebote from basis_mess),
      (select case when gueltig then t[2] else '(keine gueltige Basis)' end from basis)),
  (812, 'Shop', 'Angebots-Abdruck wie vor der Migration',
      (select angebote_md5 from basis_mess),
      (select case when gueltig then t[3] else '(keine gueltige Basis)' end from basis)),
  (813, 'Shop', 'shopfaehige Katalogzeilen wie vor der Migration',
      (select shopfaehig from basis_mess),
      (select case when gueltig then t[4] else '(keine gueltige Basis)' end from basis)),
  (814, 'Shop', 'sammelbare Katalogzeilen wie vor der Migration',
      (select sammelbar from basis_mess),
      (select case when gueltig then t[5] else '(keine gueltige Basis)' end from basis)),
  (815, 'Shop', 'Lagerzeilen wie vor der Migration',
      (select lagerzeilen from basis_mess),
      (select case when gueltig then t[6] else '(keine gueltige Basis)' end from basis)),
  (816, 'Shop', 'Katalogzeilen wie vor der Migration',
      (select katalogzeilen from basis_mess),
      (select case when gueltig then t[7] else '(keine gueltige Basis)' end from basis)),
  (817, 'Shop', 'Lager-Abdruck wie vor der Migration',
      (select lager_md5 from basis_mess),
      (select case when gueltig then t[8] else '(keine gueltige Basis)' end from basis)),

  -- ============================ Die Sammlungs-Baseline aus dem Preflight
  /*
   * DIE ZUSAGE, DIE 0145 GIBT: die Wunschliste kommt DANEBEN, die Sammlung
   * bleibt, wie sie war. Diese sechs Zeilen sind die Messung dazu.
   */
  (821, 'Sammlung', 'eine Sammlungs-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 901 des '
                        || 'Preflights in set_config(''skyisles.coll'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from coll), 'ja'),
  (822, 'Sammlung', 'sie traegt die Marke skyisles-coll-1',
      (select coalesce(marke::text, 'keine Baseline') from coll), 'true'),
  (823, 'Sammlung', 'sie hat fuenf Felder',
      (select case when k is null then 'keine Baseline'
                   else array_length(k, 1)::text end from coll), '5'),
  (824, 'Sammlung', 'die Schutzsumme stimmt',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from coll), 'true'),

  (831, 'Sammlung', 'Sammlungszeilen wie vor der Migration',
      (select zeilen from coll_mess),
      (select case when coll_gueltig then k[2]
                   else '(keine gueltige Basis)' end from coll)),
  (832, 'Sammlung', 'Konten mit Sammlung wie vor der Migration',
      (select konten from coll_mess),
      (select case when coll_gueltig then k[3]
                   else '(keine gueltige Basis)' end from coll)),
  (833, 'Sammlung', 'Sammlungs-Abdruck wie vor der Migration — Inhalt UND Reihenfolge',
      (select sammlung_md5 from coll_mess),
      (select case when coll_gueltig then k[4]
                   else '(keine gueltige Basis)' end from coll)),

  -- ------------------------------------------------------------ Zum Nachlesen
  /*
   * DIE NUMMERN 818 UND 819 SIND DIE DER FAMILIE. `0142` bis `0144` fuehren
   * den heutigen Stand unter 819, und `staging-oneshot.test.ts` prueft das
   * fuer jede Datei des Basis-Vertrags. Eine eigene Nummerierung hier waere
   * eine zweite Ordnung fuer dieselbe Sache.
   */
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
      (select zeile from basis_zeile), null),
  (828, 'Sammlung', 'Info: die uebergebene Sammlungs-Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from coll), null),
  (829, 'Sammlung', 'Info: der heutige Sammlungsstand als Baseline-Zeile',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI.
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile liest ein Objekt, auf das die
   * aufrufende Rolle kein `select` hat. Das ist KEINE Abweichung — es ist
   * eine nicht durchgefuehrte Pruefung, und als solche wird sie in Zeile
   * 9998 GEZAEHLT UND GEMELDET. Sie als bestanden zu buchen waere die
   * stille Ignorierung, die es hier nicht gibt.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
/*
 * ZEILE 9998 — WAS DIESE ROLLE NICHT PRUEFEN KONNTE.
 *
 * Der lesende Pruefzugang `skyisles_agent` hat `select` auf zwoelf Tabellen;
 * `offer_state` und `offer_state_live` gehoeren bewusst nicht dazu (0146
 * erteilt gar kein Clientrecht darauf). Fuer ihn bleiben die beiden
 * Datenzeilen offen — die ~100 Katalogzeilen laufen trotzdem durch, und das
 * ist der Punkt: EIN fehlendes Recht darf nicht hundert gute Pruefungen
 * mitnehmen.
 *
 * Im SQL-Editor (als `postgres`) ist die Zahl 0 und jede Zeile gemessen.
 */
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
-- <<< ENDE: supabase/checks/0147_postflight.sql

rollback;
