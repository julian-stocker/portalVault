-- ========================================================================
-- PRODUCTION — DER ZUSTAND NACH 0152 (GRUPPE G2), REIN LESEND
--
-- NACH `prod-0152.sql` fahren. Vollstaendig markieren, in den SQL-Editor des
-- Production-Projekts zmiwxswrpkmizvqsgype einfuegen, ausfuehren. Sie
-- schreibt nichts; die Klammer und das `rollback` stehen schon darin.
--
-- DEN UMGEKEHRTEN STEMPEL TRAEGT SIE TROTZDEM, obwohl sie nichts schreibt.
-- Der Grund ist nicht Schaden, sondern WAHRHEIT: am 2026-10-20 liefen
-- Pruefdateien auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
--
-- ###########################################################################
-- ##  ZWEI STELLEN DARF DER BEDIENER ERSETZEN — ER MUSS NICHT MEHR.        ##
-- ##    BASIS-HIER-EINSETZEN      <- Zeile 900 des Preflights              ##
-- ##    SAMMLUNG-HIER-EINSETZEN   <- Zeile 901 des Preflights              ##
-- ###########################################################################
--
-- SEIT G1 FUEHRT DIE HUELLE DEN VERTRAGSVERGLEICH SELBST (`prod-0152.sql`,
-- A4/A5/A7 und B): sie misst vorher, misst nachher und BRICHT AB, wenn sich
-- etwas bewegt hat — dann liegt nichts. Das ist strikt mehr, als eine
-- Nachkontrolle leisten kann, denn die kann nur berichten.
--
-- Diese Datei bleibt wichtig, weil der SQL-Editor `NOTICE`-Meldungen nicht
-- anzeigt — ohne sie sehen Sie das Ergebnis der Huelle gar nicht — und weil
-- sie die STRUKTUR prueft, die die Huelle nicht prueft.
--
-- BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH: die Zeilen
-- 801 bis 804 melden „FEHLT" bzw. „keine Baseline", und in 811 bis 817 steht
-- als Erwartung `(keine gueltige Basis)` statt einer Zahl — jede dieser
-- Zeilen ist ROT und zaehlt in `9999`. Eine fehlende Baseline kann hier nicht
-- als bestandene Pruefung durchgehen.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die entscheidenden Zeilen:
--
--   101 bis 105  die Spalte steht, NOT NULL, OHNE Default, und beide CHECKs
--                stehen — darunter `(status = 'public') = catalog_visible`,
--                der beweist, dass die zwei Spalten nie auseinanderlaufen.
--   106          der Trigger ist BEFORE INSERT OR UPDATE, FOR EACH ROW.
--   111 bis 115  DER BACKFILL: jede sichtbare Zeile ist `public` und keine
--                andere, kein unbekannter Wert, **KEINE Zeile ist zum Entwurf
--                geworden**, keine ist NULL. Zeile 114 zeigt die Verteilung —
--                sie muss die Zahlen 121/122 des Preflights treffen.
--   121 bis 124  die Ruempfe: `admin_create_figure` legt `catalog_status` an
--                und es gibt weiter GENAU EINE Fassung von ihr; das Journal
--                kennt das fuenfte Feld; die Triggerfunktion steht.
--   131 bis 136  UNBERUEHRT: beide RLS-Politiken lesen weiter `is_active` und
--                `catalog_visible`, RLS ist an, der Teilindex steht,
--                `admin_set_catalog_visible` ist noch da — und Zeile 136
--                zeigt die Journalzeilen, die mit Zeile 133 des Preflights
--                uebereinstimmen muessen: `0152` schreibt keine.
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
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN, und das ist hier nicht mehr
--      nur Prosa: die HUELLE selbst misst beide Vertraege vor der Migration,
--      vergleicht sie danach und BRICHT AB, wenn sich etwas bewegt hat — die
--      Gruppe rollt dann vollstaendig zurueck. `0152` schreibt zwar in jede
--      Katalogzeile, aber keine Shop-, Lager-, Katalog- oder Sammlungszahl
--      und keine Sichtbarkeit — B5 misst das Zeile fuer Zeile.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest die
--      Shop-Seite tagweise auf.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben. Die Abdruecke fangen das ab — sie haengen an Inhalt
-- und Reihenfolge, nicht nur an der Anzahl.
--
-- WAS SIE NICHT BEANTWORTET: ob die drei bestehenden Schreibpfade
-- (`admin_set_catalog_visible`, `admin_create_figure`,
-- `seller_create_catalog_item`) im Betrieb weiterlaufen. Das ist am Rumpf
-- ablesbar und auf Staging gefahren; der Beweis am laufenden System ist eine
-- Bedienprobe im Adminbereich und gehoert nicht in eine lesende Datei.
--
-- EINGEBETTET: `supabase/checks/0152_postflight.sql`, Zeichen fuer Zeichen.
-- ========================================================================

begin;

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
-- B  DIE BEIDEN BASISZEILEN — OPTIONAL SEIT G1 (siehe Kopf)
--
-- Transaktionslokal (`true`), mit dem `rollback` unten fort.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', 'BASIS-HIER-EINSETZEN', true);
select set_config('skyisles.coll', 'SAMMLUNG-HIER-EINSETZEN', true);

-- >>> EINGEBETTET: supabase/checks/0152_postflight.sql
-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND NACH 0152, REIN LESEND
--
-- NACH `0152_catalog_status.sql` fahren, MIT der Baseline-Uebergabe aus dem
-- Preflight. **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-107  DIE SPALTE UND ALLES, WAS MIT IHR KOMMT, benannt: Typ, NOT NULL,
--            KEIN DEFAULT (Absicht — ein Default waere eine stille Antwort
--            auf eine redaktionelle Frage), die zwei CHECKs, der Trigger mit
--            Zeitpunkt und Ereignissen, die neue Funktion samt Rechten.
--   111-115  DASS DER BACKFILL GETROFFEN HAT, und zwar OHNE uebergebene
--            Zahlen: die Pruefungen rechnen die Gleichheit in sich selbst
--            nach. 'public' muss genau die sichtbaren Zeilen sein, 'hidden'
--            genau die unsichtbaren, und Entwuerfe darf es **keinen**
--            geben — `0152` erzeugt keinen.
--   121-124  DIE DREI ERSETZTEN RUEMPFE, an ihrem Inhalt erkannt, und dass
--            es von `admin_create_figure` weiter genau EINE Fassung gibt.
--   131-134  WAS 0152 NICHT ANGEFASST HABEN DARF: die zwei Lesepolitiken
--            lesen weiter `is_active and catalog_visible`, der oeffentliche
--            Katalogindex steht, RLS ist an, und `admin_set_catalog_visible`
--            ist noch da.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0151`.
--
-- WARUM KEINE EIGENE BASELINE FUER DEN KATALOGSTATUS. Weil sie nichts
-- beweisen wuerde, was 111-113 nicht besser beweisen: eine uebergebene Zahl
-- sagt „so viele waren es vorher", die Gleichheitspruefung sagt „genau diese
-- Zeilen sind es, Zeile fuer Zeile". Die zweite Aussage ist staerker und
-- braucht keinen Handgriff (ADR-0137).
--
-- DIE ZWEI BASELINES (900/901 im Preflight, 801-829 in der Nachkontrolle),
-- unveraendert aus der Familie `0142`-`0149`: `0152` schreibt EINE Spalte in
-- jede Katalogzeile, aber keinen Shop-, Lager-, Katalog- oder
-- Sammlungszaehler und keine Sichtbarkeit — die Nachkontrolle vergleicht
-- blockierend gegen genau diesen Stand.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN. Sie steht hier, weil ein
-- vertauschtes Feld eine stille Fehlinformation waere: verglichen wird nach
-- POSITION (`t[2]` … `t[8]`), nicht nach Namen.
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

  -- ------------------------------------- Die Spalte und was mit ihr kommt
  (101, 'Spalte', 'skylanders.catalog_status steht, als text',
      (select coalesce(format_type(a.atttypid, a.atttypmod), 'fehlt')
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), 'text'),
  (102, 'Spalte', 'sie ist NOT NULL',
      (select coalesce(a.attnotnull::text, 'fehlt') from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), 'true'),
  /*
   * KEIN DEFAULT, UND DAS IST ABSICHT. Ein `default 'draft'` haette den
   * Backfill ueberschrieben und jede Zeile zum Entwurf gemacht; ein
   * `default 'public'` haette versteckte Zeilen veroeffentlicht. Die Antwort
   * kommt vom Trigger, der die Absicht des Aufrufers liest.
   */
  (103, 'Spalte', 'und sie hat KEINEN Default',
      (select coalesce(a.atthasdef::text, 'fehlt') from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), 'false'),
  (104, 'CHECK', 'skylanders_catalog_status_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.contype = 'c' and c.conname = 'skylanders_catalog_status_known'), '1'),
  (105, 'CHECK', 'skylanders_catalog_status_matches_visibility steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.contype = 'c'
          and c.conname = 'skylanders_catalog_status_matches_visibility'), '1'),
  /*
   * DER TRIGGER MIT ZEITPUNKT UND EREIGNISSEN, nicht nur mit Namen. `tgtype`
   * ist eine Bitmaske: 1 = BEFORE/ROW-Anteil, 2 = ROW, 4 = INSERT,
   * 16 = UPDATE. `before insert or update ... for each row` ergibt
   * 1+2+4+16 = 23. Ein AFTER-Trigger oder ein STATEMENT-Trigger traegt eine
   * andere Zahl — und waere fachlich falsch: nach der Zeile kann man `NEW`
   * nicht mehr aendern.
   */
  (106, 'Trigger', 'skylanders_sync_catalog_status ist BEFORE INSERT OR UPDATE, FOR EACH ROW',
      (select coalesce(t.tgtype::text, 'fehlt') from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and not t.tgisinternal
          and t.tgname = 'skylanders_sync_catalog_status'), '23'),
  (107, 'Funktion', 'admin_set_catalog_status(text,text) steht',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text,
      'true'),
  (108, 'Funktion', 'security definer mit genau einer search_path-Festlegung',
      (select (p.prosecdef and (select count(*) = 1
                                  from unnest(coalesce(p.proconfig, '{}')) c
                                 where c like 'search\_path=%'))::text
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')),
      'true'),
  (109, 'Rechte', 'kein EXECUTE fuer anon oder public auf admin_set_catalog_status',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (110, 'Rechte', 'und authenticated darf sie genau einmal ausfuehren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid = to_regprocedure('public.admin_set_catalog_status(text,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),

  -- ------------------ Dass der Backfill getroffen hat, ohne uebergebene Zahl
  (111, 'Backfill', 'jede sichtbare Zeile ist public — und keine andere',
      (select count(*)::text from public.skylanders
        where catalog_visible <> (catalog_status = 'public')), '0'),
  (112, 'Backfill', 'keine Zeile steht auf einem unbekannten Wert',
      (select count(*)::text from public.skylanders
        where catalog_status not in ('public', 'hidden', 'draft')), '0'),
  (113, 'Backfill', 'KEINE Zeile ist zum Entwurf geworden',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), '0'),
  (114, 'Backfill', 'Info: public / hidden / draft',
      (select (count(*) filter (where catalog_status = 'public'))::text || ' / '
              || (count(*) filter (where catalog_status = 'hidden'))::text || ' / '
              || (count(*) filter (where catalog_status = 'draft'))::text
         from public.skylanders), null),
  (115, 'Backfill', 'und keine Zeile hat NULL',
      (select count(*)::text from public.skylanders where catalog_status is null), '0'),

  -- --------------------------------------------- Die drei ersetzten Ruempfe
  (121, 'Ruempfe', 'admin_create_figure legt catalog_status an',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'
          and p.prosrc like '%catalog_status%'), '1'),
  (122, 'Ruempfe', 'und es gibt weiter genau EINE Fassung von ihr',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'), '1'),
  (123, 'Ruempfe', 'log_skylander_editorial_change kennt das fuenfte Feld',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'log_skylander_editorial_change'
          and p.prosrc like '%catalog_status%'), '1'),
  (124, 'Ruempfe', 'skylanders_sync_catalog_status() steht als Triggerfunktion',
      (select coalesce(p.prorettype::regtype::text, 'fehlt') from pg_proc p
        where p.oid = to_regprocedure('public.skylanders_sync_catalog_status()')),
      'trigger'),

  -- ------------------------------- Was 0152 nicht angefasst haben darf
  /*
   * DIE LESEPOLITIK IST DIE SICHERHEITSGRENZE. Sie liest weiter
   * `catalog_visible` und NICHT den neuen Status — ein Entwurf ist deshalb
   * genau so unsichtbar wie eine versteckte Zeile, und zwar aus demselben
   * Grund wie vorher. Haette `0152` sie angefasst, waere das eine
   * Sichtbarkeitsaenderung, und die hat sie ausdruecklich nicht gemacht.
   */
  (131, 'Unberuehrt', 'skylanders_select_anon liest weiter is_active und catalog_visible',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'skylanders'
          and policyname = 'skylanders_select_anon'
          and qual like '%is_active%' and qual like '%catalog_visible%'
          and qual not like '%catalog_status%'), '1'),
  (132, 'Unberuehrt', 'skylanders_select_authenticated ebenso',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'skylanders'
          and policyname = 'skylanders_select_authenticated'
          and qual like '%is_active%' and qual like '%catalog_visible%'
          and qual not like '%catalog_status%'), '1'),
  (133, 'Unberuehrt', 'RLS auf skylanders ist an',
      (select relrowsecurity::text from pg_class
        where oid = to_regclass('public.skylanders')), 'true'),
  (134, 'Unberuehrt', 'skylanders_public_catalog_idx steht (0004)',
      (select count(*)::text from pg_class
        where relname = 'skylanders_public_catalog_idx' and relkind = 'i'), '1'),
  (135, 'Unberuehrt', 'admin_set_catalog_visible(text,boolean) ist noch da (0041)',
      (to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is not null)::text,
      'true'),
  /* Rechtegeschuetzt, dieselbe Huelle wie Zeile 133 des Preflights: ein
     direktes `select` auf `catalog_admin_changes` liesse die ganze Datei
     abbrechen. */
  (136, 'Unberuehrt', 'Info: Journalzeilen nach der Migration — mit 133 des Preflights vergleichen',
      case when to_regclass('public.catalog_admin_changes') is null then '(keine Tabelle)'
           when has_table_privilege('public.catalog_admin_changes', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.catalog_admin_changes',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0152 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

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
-- <<< ENDE: supabase/checks/0152_postflight.sql

rollback;
