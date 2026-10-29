-- ========================================================================
-- PRODUCTION — DER ZUSTAND NACH DER GRUPPE 0152 BIS 0158, REIN LESEND
--
-- NACH `supabase/operations/prod-g2-0152-0158.sql` fahren. Vollstaendig
-- markieren, in den SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype
-- einfuegen, ausfuehren. Sie schreibt nichts; die Klammer und das `rollback`
-- stehen schon darin.
--
-- ###########################################################################
-- ##  ZWEI STELLEN DARF DER BEDIENER ERSETZEN — ER MUSS NICHT MEHR.        ##
-- ##    BASIS-HIER-EINSETZEN      <- Zeile 900 des Preflights              ##
-- ##    SAMMLUNG-HIER-EINSETZEN   <- Zeile 901 des Preflights              ##
-- ###########################################################################
--
-- DIE HUELLE FUEHRT DEN VERTRAGSVERGLEICH SELBST (`prod-g2-0152-0158.sql`,
-- A4/A5/A7 und B): sie misst vorher, misst nachher und BRICHT AB, wenn sich
-- etwas bewegt hat — dann liegt nichts. Das ist strikt mehr, als eine
-- Nachkontrolle leisten kann, denn die kann nur berichten.
--
-- Diese Datei bleibt wichtig, weil der SQL-Editor `NOTICE`-Meldungen nicht
-- anzeigt — ohne sie sehen Sie das Ergebnis der Huelle gar nicht — und weil
-- sie die STRUKTUR prueft, die die Huelle nicht prueft: Rechte, Attribute,
-- Politiken, den Default, den Triggertyp.
--
-- BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH: die Zeilen
-- 801 bis 804 melden „FEHLT" bzw. „keine Baseline", und in 811 bis 817 steht
-- als Erwartung `(keine gueltige Basis)` statt einer Zahl — jede dieser
-- Zeilen ist ROT und zaehlt in `9999`. Eine fehlende Baseline kann hier nicht
-- als bestandene Pruefung durchgehen.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die entscheidenden Zeilen:
--
--   114  KEINE der 624 Zeilen ist zum Entwurf geworden.
--   116/117  die Verteilung muss die Zahlen 163/164 des Preflights treffen.
--   221-224  je Funktionsname genau so viele Fassungen wie erwartet — und
--        `admin_merge_draft` hat ZWEI, mit Absicht.
--   253  DIE ZEILE, DIE DIESE GRUPPE SCHULDET: die Journal-Constraint kennt
--        `catalog_status`. Damit ist bewiesen, dass der Zustand zwischen
--        `0152` und `0157`, in dem jeder Statuswechsel mit `23514`
--        scheitert, nie veroeffentlicht wurde.
--   264  die Formatversion der Plattformsicherung ist UNVERAENDERT 2.
--   811-817 / 831-833  Shop, Lager, Katalog und Sammlung wie vorher.
--
-- DEN UMGEKEHRTEN STEMPEL TRAEGT SIE TROTZDEM, obwohl sie nichts schreibt.
-- Der Grund ist nicht Schaden, sondern WAHRHEIT: am 2026-10-20 liefen
-- Pruefdateien auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
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
--   2. DIE GRUPPE KANN ES NICHT GEWESEN SEIN, und das ist hier nicht mehr
--      nur Prosa: die HUELLE selbst misst beide Vertraege vor der ersten
--      Migration, vergleicht sie nach der siebten und BRICHT AB, wenn sich
--      etwas bewegt hat — die Gruppe rollt dann vollstaendig zurueck. Sie
--      schreibt zwar in JEDE Katalogzeile, aber keine Shop-, Lager-,
--      Katalog- oder Sammlungszahl und keine Sichtbarkeit; B5 misst das
--      Zeile fuer Zeile.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest die
--      Shop-Seite tagweise auf.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben. Die Abdruecke fangen das ab — sie haengen an Inhalt
-- und Reihenfolge, nicht nur an der Anzahl.
--
--
-- WAS SIE NICHT BEANTWORTET: ob die Schreibpfade im Betrieb laufen. Das ist
-- am Rumpf ablesbar, in PGlite gefahren und auf Staging bewiesen; der Beweis
-- am laufenden System ist eine Bedienprobe im Adminbereich und gehoert nicht
-- in eine lesende Datei.
--
-- EINGEBETTET: `supabase/checks/g2_postflight.sql`, Zeichen fuer Zeichen.
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
-- B  DIE BEIDEN BASISZEILEN AUS DEM PREFLIGHT
--
-- Transaktionslokal (`true`), mit dem `rollback` unten fort.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', 'BASIS-HIER-EINSETZEN', true);
select set_config('skyisles.coll', 'SAMMLUNG-HIER-EINSETZEN', true);

-- =========================================================================
-- >>> EINGEBETTET: supabase/checks/g2_postflight.sql
-- ===========================================================================
-- PRODUCTION — DER ZUSTAND NACH DER GRUPPE 0152-0158, REIN LESEND
--
-- NACH `supabase/operations/prod-g2-0152-0158.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WARUM ES DIESE DATEI GIBT UND NICHT SIEBEN: siehe `g2_preflight.sql`. Die
-- sieben einzelnen Nachkontrollen bleiben gueltig und stehen weiter; sie
-- messen aber je einen Zustand, den es auf Production nie gab, weil die
-- sieben Migrationen dort EINE Transaktion sind.
--
--   101-106  DIE SPALTE: steht, NOT NULL, OHNE Default, beide CHECKs — und
--            der zweite, `(status = 'public') = catalog_visible`, beweist,
--            dass die zwei Spalten nie auseinanderlaufen koennen. 106 ist
--            der Trigger: BEFORE INSERT OR UPDATE, FOR EACH ROW.
--   111-117  DER BACKFILL: jede sichtbare Zeile ist `public` und keine
--            andere, kein unbekannter Wert, KEINE Zeile ist zum Entwurf
--            geworden, keine ist NULL. 116/117 zeigen die Verteilung — sie
--            muss die Zahlen 163/164 des Preflights treffen.
--   121-125  DIE ERSETZTEN RUEMPFE: admin_create_figure legt catalog_status
--            an und es gibt weiter GENAU EINE Fassung von ihr mit der
--            Signatur aus 0034; das Journal kennt das fuenfte Feld.
--   131-137  UNBERUEHRT: beide RLS-Politiken lesen weiter `is_active` und
--            `catalog_visible`, RLS ist an, der Teilindex steht,
--            `admin_set_catalog_visible` ist noch da, und die Journalzeilen
--            stimmen mit Zeile 2 des Preflights ueberein — keine der sieben
--            Migrationen schreibt eine.
--   201-211  DIE ELF SIGNATUREN, die die Gruppe anlegt, einzeln benannt.
--   221-224  UND KEINE ZWOELFTE: je Name genau so viele Fassungen wie
--            erwartet. `admin_merge_draft` hat ZWEI, mit Absicht — die
--            dreiarmige aus 0154 bleibt als Weiterleitung stehen (0156),
--            damit deployter Code sie weiter findet.
--   231-234  DIE RECHTE: execute fuer authenticated, und fuer anon und
--            PUBLIC nichts. Zehn Funktionen, drei Messungen.
--   241-245  DIE ATTRIBUTE: definer, volatility, und bei allen elf genau
--            eine LEERE search_path-Festlegung.
--   251-256  DAS JOURNAL KENNT ELF WERTE: die sieben aus 0033, die drei aus
--            0157 (`catalog_status`, `merged_from`, `discarded`) und den
--            elften aus 0158 (`character_id`). Zeile 253 ist der Beweis,
--            dass der Zustand zwischen 0152 und 0157 nicht veroeffentlicht
--            wurde: nach der Gruppe KENNT die Constraint `catalog_status`,
--            also scheitert kein Statuswechsel mehr an `23514`.
--   261-267  DIE EXPORTFUNKTION aus 0153: Abdruck `92c48444…`, 54 Bereiche,
--            `catalog_status` im Rumpf, Formatversion UNVERAENDERT 2.
--   801-829  DIE ZWEI VERTRAEGE gegen die Baselines aus dem Preflight.
--
-- BLEIBT EIN PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH: die Zeilen
-- 801 bis 804 melden „FEHLT" bzw. „keine Baseline", und in 811 bis 817 steht
-- als Erwartung `(keine gueltige Basis)` statt einer Zahl — jede dieser
-- Zeilen ist ROT und zaehlt in `9999`. Eine fehlende Baseline kann hier nicht
-- als bestandene Pruefung durchgehen.
--
-- WAS DIESE DATEI NICHT LEISTET: die HUELLE prueft mehr, und zwar in
-- derselben Transaktion — sie misst beide Vertraege und den
-- Sichtbarkeits-Abdruck vorher, vergleicht sie nachher und ROLLT ZURUECK,
-- wenn sich etwas bewegt hat. Eine Nachkontrolle kann nur berichten. Sie
-- bleibt wichtig, weil der SQL-Editor `NOTICE`-Meldungen nicht anzeigt.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN — eine vertauschte Zeile
-- waere eine stille Fehlinformation, weil nach POSITION verglichen wird:
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
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
neu (nr, sig, kurz, soll, rechte, definer) as (values
  (201, 'public.skylanders_sync_catalog_status()', 'skylanders_sync_catalog_status', 1, false, false),
  (202, 'public.admin_set_catalog_status(text,text)', 'admin_set_catalog_status', 1, true, true),
  (203, 'public.admin_merge_references(text)', 'admin_merge_references', 1, true, true),
  (204, 'public.admin_merge_draft(text,text,text)', 'admin_merge_draft', 2, true, true),
  (205, 'public.admin_merge_draft(text,text,text,jsonb)', 'admin_merge_draft', 2, true, true),
  (206, 'public.admin_discard_draft(text)', 'admin_discard_draft', 1, true, true),
  (207, 'public.admin_merge_plan(text,text,text)', 'admin_merge_plan', 1, true, true),
  (208, 'public.merge_note(text,text)', 'merge_note', 1, true, false),
  (209, 'public.admin_create_character(text)', 'admin_create_character', 1, true, true),
  (210, 'public.admin_set_character(text,bigint)', 'admin_set_character', 1, true, true),
  (211, 'public.admin_publish_as_variant(text,bigint)', 'admin_publish_as_variant', 1, true, true)
),
neu_mess as (
  /*
   * EINE MESSUNG, VIER FRAGEN. `to_regprocedure` loest die Signatur auf —
   * es ist also nicht nach einer getippten Typliste gesucht, sondern nach
   * genau der Funktion, die der deployte Anwendungscode ueber PostgREST
   * trifft. Fehlt sie, ist `oid` NULL und jede Folgefrage NULL; die Zeile
   * 201 bis 211 meldet das einzeln.
   */
  select n.*, to_regprocedure(n.sig) as oid,
         (select count(*) from pg_proc p
           where p.pronamespace = to_regnamespace('public')
             and p.proname = n.kurz)                               as fassungen
    from neu n
),
neu_detail as (
  select m.*,
         p.prosecdef,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                          as pfadanzahl,
         (select btrim(substring(c from 'search\_path=(.*)$'), '"')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                          as pfadwert,
         (select count(*) from aclexplode(p.proacl) a
           where a.grantee = 0 and a.privilege_type = 'EXECUTE')   as fuer_public
    from neu_mess m left join pg_proc p on p.oid = m.oid
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ----------------------------------------------------- Die Spalte selbst
  (101, 'Spalte', 'skylanders.catalog_status steht (0152)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '1'),
  (102, 'Spalte', 'sie ist text',
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), 'text'),
  (103, 'Spalte', 'sie ist NOT NULL',
      (select a.attnotnull::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), 'true'),
  /*
   * OHNE DEFAULT, UND DAS IST ABSICHT. Ein Default waere ein zweiter Ort,
   * an dem der Status entsteht — der Trigger ist der einzige.
   */
  (104, 'Spalte', 'sie hat KEINEN Default — der Trigger ist die einzige Quelle',
      (select count(*)::text from pg_attrdef d join pg_attribute a
          on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status'), '0'),
  (105, 'Spalte', 'CHECK skylanders_catalog_status_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_catalog_status_known'), '1'),
  (106, 'Spalte', 'CHECK skylanders_catalog_status_matches_visibility steht — '
                  'die zwei Spalten koennen nie auseinanderlaufen',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_catalog_status_matches_visibility'), '1'),
  (107, 'Spalte', 'der Trigger ist BEFORE INSERT OR UPDATE, FOR EACH ROW',
      (select (t.tgtype & 2 > 0)::text || '|' || (t.tgtype & 1 > 0)::text
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_sync_catalog_status'), 'true|true'),

  -- ---------------------------------------------------------- Der Backfill
  (111, 'Backfill', 'jede SICHTBARE Zeile ist public — keine Ausnahme',
      (select count(*)::text from public.skylanders
        where catalog_visible and catalog_status <> 'public'), '0'),
  (112, 'Backfill', 'jede UNSICHTBARE Zeile ist hidden — keine Ausnahme',
      (select count(*)::text from public.skylanders
        where not catalog_visible and catalog_status <> 'hidden'), '0'),
  (113, 'Backfill', 'kein unbekannter Wert',
      (select count(*)::text from public.skylanders
        where catalog_status not in ('public', 'hidden', 'draft')), '0'),
  /*
   * KEINE BESTEHENDE ZEILE WIRD ZUM ENTWURF. `draft` ist der Zustand neuer,
   * noch nicht veroeffentlichter Zeilen; eine der 624 darf ihn nicht haben.
   */
  (114, 'Backfill', 'KEINE Zeile ist zum Entwurf geworden',
      (select count(*)::text from public.skylanders where catalog_status = 'draft'), '0'),
  (115, 'Backfill', 'keine Zeile ist NULL',
      (select count(*)::text from public.skylanders where catalog_status is null), '0'),
  (116, 'Backfill', 'Info: Zeilen mit catalog_status = public (muss Zeile 163 des Preflights treffen)',
      (select count(*)::text from public.skylanders where catalog_status = 'public'), null),
  (117, 'Backfill', 'Info: Zeilen mit catalog_status = hidden (muss Zeile 164 des Preflights treffen)',
      (select count(*)::text from public.skylanders where catalog_status = 'hidden'), null),

  -- ------------------------------------------------- Die ersetzten Ruempfe
  (121, 'Ruempfe', 'admin_create_figure: weiter GENAU EINE Fassung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_create_figure'), '1'),
  (122, 'Ruempfe', 'und weiter mit der Signatur aus 0034 — der deployte Code findet sie',
      (to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)')
         is not null)::text, 'true'),
  (123, 'Ruempfe', 'ihr Rumpf setzt catalog_status',
      (select (p.prosrc like '%catalog_status%')::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)')),
      'true'),
  (124, 'Ruempfe', 'log_skylander_editorial_change() journalisiert catalog_status',
      (select (p.prosrc like '%catalog_status%')::text from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()')), 'true'),
  (125, 'Ruempfe', 'und sie nennt weiter die vier alten Felder',
      (select (p.prosrc like '%catalog_visible%' and p.prosrc like '%display_name_override%'
               and p.prosrc like '%card_type%' and p.prosrc like '%image_override_path%')::text
         from pg_proc p
        where p.oid = to_regprocedure('public.log_skylander_editorial_change()')), 'true'),

  -- ------------------------------------------------------------- Unberuehrt
  (131, 'Unberuehrt', 'RLS ist an skylanders weiter aktiv',
      (select c.relrowsecurity::text from pg_class c
        where c.oid = to_regclass('public.skylanders')), 'true'),
  (132, 'Unberuehrt', 'skylanders_select_anon liest weiter is_active und catalog_visible',
      (select (pg_get_expr(pol.polqual, pol.polrelid) like '%is_active%'
               and pg_get_expr(pol.polqual, pol.polrelid) like '%catalog_visible%')::text
         from pg_policy pol
        where pol.polrelid = to_regclass('public.skylanders')
          and pol.polname = 'skylanders_select_anon'), 'true'),
  (133, 'Unberuehrt', 'skylanders_select_authenticated ebenso',
      (select (pg_get_expr(pol.polqual, pol.polrelid) like '%is_active%'
               and pg_get_expr(pol.polqual, pol.polrelid) like '%catalog_visible%')::text
         from pg_policy pol
        where pol.polrelid = to_regclass('public.skylanders')
          and pol.polname = 'skylanders_select_authenticated'), 'true'),
  (134, 'Unberuehrt', 'keine Politik liest catalog_status — die Sichtbarkeit bleibt die alte',
      (select count(*)::text from pg_policy pol
        where pol.polrelid = to_regclass('public.skylanders')
          and pg_get_expr(pol.polqual, pol.polrelid) like '%catalog_status%'), '0'),
  (135, 'Unberuehrt', 'der Teilindex skylanders_public_catalog_idx steht (0004)',
      (select count(*)::text from pg_class c
        where c.relname = 'skylanders_public_catalog_idx' and c.relkind = 'i'), '1'),
  (136, 'Unberuehrt', 'admin_set_catalog_visible(text,boolean) ist noch da',
      (to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is not null)::text, 'true'),
  (137, 'Unberuehrt', 'Info: Journalzeilen (muss Zeile 2 des Preflights treffen — '
                      'keine der sieben schreibt eine)',
      (select count(*)::text from public.catalog_admin_changes), null),

  (201, 'Funktionen', 'public.skylanders_sync_catalog_status() steht (0152)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 201), 'steht'),
  (202, 'Funktionen', 'public.admin_set_catalog_status(text,text) steht (0152)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 202), 'steht'),
  (203, 'Funktionen', 'public.admin_merge_references(text) steht (0154)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 203), 'steht'),
  (204, 'Funktionen', 'public.admin_merge_draft(text,text,text) steht (0154, Weiterleitung seit 0156)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 204), 'steht'),
  (205, 'Funktionen', 'public.admin_merge_draft(text,text,text,jsonb) steht (0156, ersetzt in 0157)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 205), 'steht'),
  (206, 'Funktionen', 'public.admin_discard_draft(text) steht (0155)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 206), 'steht'),
  (207, 'Funktionen', 'public.admin_merge_plan(text,text,text) steht (0156, ersetzt in 0157)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 207), 'steht'),
  (208, 'Funktionen', 'public.merge_note(text,text) steht (0157)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 208), 'steht'),
  (209, 'Funktionen', 'public.admin_create_character(text) steht (0158)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 209), 'steht'),
  (210, 'Funktionen', 'public.admin_set_character(text,bigint) steht (0158)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 210), 'steht'),
  (211, 'Funktionen', 'public.admin_publish_as_variant(text,bigint) steht (0158)',
      (select case when oid is null then 'fehlt' else 'steht' end
         from neu_detail where nr = 211), 'steht'),

  -- ------------------------------------------------- Und keine zwoelfte
  /*
   * EINE ZUSAETZLICHE UEBERLADUNG WAERE EINE ZWEITE FUNKTION MIT DEMSELBEN
   * NAMEN — und PostgREST loest ueber den Namen auf. `admin_merge_draft`
   * hat deshalb ZWEI erwartete Fassungen und nicht eine: die dreiarmige aus
   * `0154` bleibt als Weiterleitung stehen (`0156`), damit deployter Code
   * sie weiter findet. Jede andere Zahl ist ein Befund.
   */
  (221, 'Ueberladung', 'je Name genau so viele Fassungen wie erwartet',
      (select count(*)::text from neu_detail where fassungen <> soll), '0'),
  (222, 'Ueberladung', 'Info: Name und Anzahl der Fassungen',
      (select string_agg(distinct kurz || '=' || fassungen::text, ', ')
         from neu_detail), null),
  (223, 'Ueberladung', 'admin_merge_draft hat GENAU ZWEI Fassungen (3-armig und 4-armig)',
      (select max(fassungen)::text from neu_detail where kurz = 'admin_merge_draft'), '2'),
  (224, 'Ueberladung', 'keine davon fehlt',
      (select count(*)::text from neu_detail where oid is null), '0'),

  -- ------------------------------------------------------------- Die Rechte
  (231, 'Rechte', 'execute fuer authenticated bei allen zehn Clientfunktionen',
      (select count(*)::text from neu_detail
        where rechte and has_function_privilege('authenticated', sig, 'execute')), '10'),
  (232, 'Rechte', 'und fuer anon bei keiner',
      (select count(*)::text from neu_detail
        where rechte and has_function_privilege('anon', sig, 'execute')), '0'),
  (233, 'Rechte', 'und fuer PUBLIC bei keiner',
      (select coalesce(sum(fuer_public), 0)::text from neu_detail where rechte), '0'),
  (234, 'Rechte', 'Info: welche Clientfunktion authenticated NICHT ausfuehren darf',
      (select coalesce(string_agg(sig, ', '), '(keine)') from neu_detail
        where rechte and not has_function_privilege('authenticated', sig, 'execute')), null),

  -- ---------------------------------------------------------- Die Attribute
  (241, 'Attribute', 'alle elf legen GENAU EINE search_path-Festlegung fest',
      (select count(*)::text from neu_detail where pfadanzahl = 1), '11'),
  (242, 'Attribute', 'und ihr Wert ist LEER',
      (select count(*)::text from neu_detail where pfadwert = ''), '11'),
  (243, 'Attribute', 'security definer bei den neun, die es sein muessen',
      (select count(*)::text from neu_detail where definer and prosecdef), '9'),
  (244, 'Attribute', 'und NICHT bei den zwei, die es nicht sein duerfen '
                     '(Triggerfunktion und merge_note)',
      (select count(*)::text from neu_detail where not definer and prosecdef), '0'),
  (245, 'Attribute', 'merge_note ist immutable — sie liest nichts und schreibt nichts',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.merge_note(text,text)')), 'i'),

  -- ------------------------------------------- Das Journal kennt elf Werte
  /*
   * ZEILE 253 IST DER BEWEIS, DEN DIESE GRUPPE SCHULDET. Nach `0152` allein
   * schreibt der Journaltrigger `catalog_status`, die Constraint kennt den
   * Namen aber nicht — jeder Statuswechsel scheitert dann mit `23514`,
   * `admin_set_catalog_visible` eingeschlossen. `0157` nimmt den Namen auf,
   * `0158` den elften. Steht Zeile 253 auf `true`, ist dieser Zwischenzustand
   * nie veroeffentlicht worden.
   */
  (251, 'Journal', 'catalog_admin_changes_field_known steht',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), '1'),
  (252, 'Journal', 'sie nennt weiter die sieben aus 0033',
      (select (pg_get_constraintdef(c.oid) like '%catalog_visible%'
               and pg_get_constraintdef(c.oid) like '%display_name_override%'
               and pg_get_constraintdef(c.oid) like '%admin_note%'
               and pg_get_constraintdef(c.oid) like '%catalog_group%'
               and pg_get_constraintdef(c.oid) like '%image_override_path%'
               and pg_get_constraintdef(c.oid) like '%card_type%'
               and pg_get_constraintdef(c.oid) like '%created%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (253, 'Journal', 'sie nennt catalog_status (0157) — kein Statuswechsel scheitert mehr an 23514',
      (select (pg_get_constraintdef(c.oid) like '%catalog_status%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (254, 'Journal', 'sie nennt merged_from und discarded (0157)',
      (select (pg_get_constraintdef(c.oid) like '%merged_from%'
               and pg_get_constraintdef(c.oid) like '%discarded%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (255, 'Journal', 'sie nennt character_id (0158) — der elfte Wert',
      (select (pg_get_constraintdef(c.oid) like '%character_id%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (256, 'Journal', 'Info: der Wortlaut der Constraint nach der Gruppe',
      (select pg_get_constraintdef(c.oid) from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), null),
  (257, 'Journal', 'keine Journalzeile traegt ein Feld, das die Constraint nicht kennt',
      (select count(*)::text from public.catalog_admin_changes
        where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                            'catalog_group', 'image_override_path', 'card_type',
                            'created', 'catalog_status', 'merged_from', 'discarded',
                            'character_id')), '0'),

  -- ------------------------------------------------- Die Exportfunktion (0153)
  (261, 'Export', 'Rumpfabdruck ist die Fassung aus 0153',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '92c48444f99b9e294f9703d0c0ddeaa8'),
  (262, 'Export', 'weiter 54 Bereiche — 0153 fuegt ein FELD hinzu, keinen Bereich',
      (select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
               / length('coalesce(('))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '54'),
  (263, 'Export', 'das Feld catalog_status steht im Rumpf',
      (select (p.prosrc like '%''catalog_status'', t.catalog_status,%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (264, 'Export', 'die Formatversion ist UNVERAENDERT 2',
      (select (p.prosrc like '%''format_version'', 2,%')::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (265, 'Export', 'security definer',
      (select p.prosecdef::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (266, 'Export', 'volatility stable',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (267, 'Export', 'genau EINE search_path-Festlegung, und ihr Wert ist LEER',
      (select (count(*) = 1 and btrim(min(substring(c from 'search\_path=(.*)$')), '"') = '')::text
         from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
        where p.oid = to_regprocedure('public.system_platform_export()')
          and c like 'search\_path=%'), 'true'),

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
-- <<< ENDE: supabase/checks/g2_postflight.sql
-- =========================================================================

rollback;
