-- ========================================================================
-- PRODUCTION — DER ZUSTAND VOR DER GRUPPE 0152 BIS 0158, REIN LESEND
--
-- VOR `supabase/operations/prod-g2-0152-0158.sql` fahren. Vollstaendig
-- markieren, in den SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype
-- einfuegen, ausfuehren. Sie schreibt nichts; die Klammer und das `rollback`
-- stehen schon darin.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT — UND ZEILE 901 DAZU.     ##
-- ##  KOPIEREN MUESSEN SIE SIE NUR FUER DIE NACHKONTROLLE:                 ##
-- ##  `prod-g2-0152-0158.sql` misst beide Vertraege selbst und vergleicht  ##
-- ##  sie in derselben Transaktion.                                        ##
-- ###########################################################################
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Zeigt sie etwas anderes,
-- wird die Gruppe NICHT gefahren — jede rote Zeile nennt sich selbst.
--
-- WARUM EINE EIGENE PRUEFDATEI UND NICHT DIE SIEBEN EINZELNEN. Auf
-- Production laufen `0152` bis `0158` als EINE Transaktion, also gibt es die
-- sechs Zwischenzustaende dort nie. `0153_preflight.sql` verlangt
-- `skylanders.catalog_status`, die es vor der Gruppe nicht gibt;
-- `0158_preflight.sql` verlangt die Constraint aus `0157`. Sechs der sieben
-- Dateien WUERDEN HIER ROT MELDEN, voellig zu Recht — sie messen einen
-- Zustand, den diese Datenbank nicht durchlaeuft. `g2_preflight.sql` misst
-- stattdessen den Zustand vor der ganzen Gruppe: was alle sieben zusammen
-- voraussetzen, und was von allem, was sie anlegen, noch nicht da sein darf.
-- Die sieben einzelnen Dateien bleiben unveraendert stehen; auf Staging sind
-- sie genau richtig gelaufen.
--
-- DIE BEIDEN WICHTIGSTEN ZEILEN DIESES LAUFS:
--
--   144  die Journal-Constraint nennt `catalog_status` NOCH NICHT. Das ist
--        die Luecke, wegen der die sieben zusammen fahren: nach `0152`
--        allein scheitert jeder Statuswechsel mit `23514`.
--   147  keine bestehende Journalzeile traegt ein Feld ausserhalb der elf.
--        `0157` und `0158` bauen die Constraint mit `add constraint` OHNE
--        `not valid` neu — die bestehenden Zeilen werden mitgeprueft. Eine
--        unbekannte Zeile liesse die Gruppe mitten in `0157` scheitern.
--
--   151  der Exportrumpf ist der aus `0144`. `0153` traegt dieses Tor selbst
--        und bricht ab, wenn es nicht stimmt — hier faellt es VOR der
--        Transaktion auf, und das ist billiger.
--
--   900/901  DIE ZWEI BASELINES. Vollstaendig kopieren und in die
--        Nachkontrolle einsetzen. Die HUELLE braucht sie nicht: sie misst
--        beide Vertraege selbst, vorher und nachher, und rollt zurueck, wenn
--        sich etwas bewegt hat (A4, B3, B4). Diese zwei Zeilen sind fuer die
--        lesende Nachkontrolle, die nur berichten kann.
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
-- EINGEBETTET: `supabase/checks/g2_preflight.sql`, Zeichen fuer Zeichen.
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
-- =========================================================================
-- >>> EINGEBETTET: supabase/checks/g2_preflight.sql
-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR DER GRUPPE 0152-0158, REIN LESEND
--
-- VOR `supabase/operations/prod-g2-0152-0158.sql` fahren.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WARUM ES DIESE DATEI GIBT UND NICHT SIEBEN. Die sieben Pruefdateien
-- `0152_preflight.sql` bis `0158_preflight.sql` sind richtig und bleiben
-- stehen — sie messen den Zustand VOR JEWEILS EINER Migration. Auf Production
-- laufen die sieben aber als EINE Transaktion (ADR-0141 und die Akte zur
-- Gruppe G2'), und dann gibt es diese sechs Zwischenzustaende gar nicht:
-- `0153_preflight.sql` verlangt `skylanders.catalog_status`, die es vor der
-- Gruppe nicht gibt, und `0158_preflight.sql` verlangt die Constraint aus
-- `0157`. Sechs der sieben Dateien WUERDEN HIER ROT MELDEN, voellig zu Recht.
--
-- Diese Datei misst deshalb den Zustand vor der GANZEN Gruppe: was alle
-- sieben zusammen voraussetzen, und was von allem, was sie anlegen, noch
-- nicht da sein darf.
--
--   101-116  DIE GRUNDLAGE, benannt und nicht gezaehlt. `0147` brach ab,
--            weil eine Pruefung Trigger ZAEHLTE und null erwartete, waehrend
--            sechs legitime standen. Jedes Objekt steht hier einzeln.
--   121-134  DIE VIERZEHN ABWESENHEITEN: die Spalte, zwei CHECKs, der
--            Trigger und die zehn Funktionen, die die Gruppe anlegt. Steht
--            eine davon schon, ist ein Teil der Gruppe hier angewendet und
--            der Lauf gehoert angehalten — die Huelle bricht dann auch ab
--            (ABBRUCH A6g).
--   141-146  DAS JOURNAL VOR DER GRUPPE: die Constraint aus `0033` mit ihren
--            sieben Werten, und `catalog_status` ist NICHT darunter. Genau
--            diese Luecke ist der Grund, warum `0152` und `0157` zusammen
--            fahren: nach `0152` allein scheitert jeder Statuswechsel mit
--            `23514`, weil der Journaltrigger ein Feld schreibt, das die
--            Constraint nicht kennt.
--   151-155  DIE EXPORTFUNKTION, wie `0153` sie vorfinden MUSS: der Rumpf
--            aus `0144` (Abdruck `4c4d2e7c…`), 54 Bereiche, definer, stable,
--            genau eine leere search_path-Festlegung.
--   161-167  DIE AUSGANGSVERTEILUNG und das Triggerinventar, als Auskunft.
--            Die Zahlen 163/164 muessen in der Nachkontrolle als 'public'
--            und 'hidden' genau wieder auftauchen; die Huelle rechnet das
--            selbst nach und bricht ab, wenn es nicht stimmt (B5-B7).
--   171-173  DIE RECHTE, die die Gruppe nicht anfassen darf.
--   900/901  DIE ZWEI BASELINES fuer die Nachkontrolle. Die HUELLE braucht
--            sie nicht — sie misst selbst (A4/B3/B4). Diese zwei Zeilen sind
--            fuer die lesende Nachkontrolle, die nur berichten kann.
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
coll_mess as (
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
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),
  (2, 'Umgebung', 'Info: Journalzeilen in catalog_admin_changes',
      (select count(*)::text from public.catalog_admin_changes), null),

  -- ------------------------------- Die Grundlage, benannt und nicht gezaehlt
  (101, 'Grundlage', 'skylanders steht (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'skylanders.catalog_visible steht (0004) — 0152 leitet daraus ab',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_visible' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'skylanders.character_id steht (0002) — 0158 setzt sie voraus',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'character_id' and not a.attisdropped), '1'),
  (104, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (105, 'Grundlage', 'log_skylander_editorial_change() steht (0004) — 0152 ersetzt ihren Rumpf',
      (to_regprocedure('public.log_skylander_editorial_change()') is not null)::text, 'true'),
  /*
   * NACH DER PARAMETERZAHL, NICHT NACH EINER GETIPPTEN TYPLISTE: GENAU EINE
   * Fassung von admin_create_figure, und sie hat die Signatur aus 0034.
   * Gaebe es zwei, waere die Ersetzung in 0152 eine Ueberladung — der
   * deployte Anwendungscode wuerde dann zufaellig die alte treffen.
   */
  (106, 'Grundlage', 'admin_create_figure: genau EINE Fassung',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_create_figure'), '1'),
  (107, 'Grundlage', 'und sie hat die Signatur aus 0034 (acht Parameter)',
      (to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)')
         is not null)::text, 'true'),
  (108, 'Grundlage', 'admin_set_catalog_visible(text,boolean) steht (0039) — bleibt stehen',
      (to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is not null)::text, 'true'),
  (109, 'Grundlage', 'catalog_admin_changes steht (0004)',
      (to_regclass('public.catalog_admin_changes') is not null)::text, 'true'),
  (110, 'Grundlage', 'catalog_editorial steht (0041) — 0154 bis 0157 schreiben hinein',
      (to_regclass('public.catalog_editorial') is not null)::text, 'true'),
  (111, 'Grundlage', 'characters steht (0002) — 0158 legt Familien an',
      (to_regclass('public.characters') is not null)::text, 'true'),
  (112, 'Grundlage', 'characters_canonical_name_key steht (0002) — der Dublettenschutz',
      (select count(*)::text from pg_class c
        where c.relname = 'characters_canonical_name_key' and c.relkind = 'i'), '1'),
  (113, 'Grundlage', 'system_platform_export(): genau EINE Fassung (0105/0144)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'system_platform_export'), '1'),
  (114, 'Grundlage', 'non_collectible_categories() steht — der Fortschrittsnenner',
      (to_regprocedure('public.non_collectible_categories()') is not null)::text, 'true'),
  (115, 'Grundlage', 'shop_offers() steht — der Basis-Vertrag liest sie',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  (116, 'Grundlage', 'is_shop_eligible(text) steht — der Basis-Vertrag liest sie',
      (to_regprocedure('public.is_shop_eligible(text)') is not null)::text, 'true'),
  -- ------------------------------------------- Die vierzehn Abwesenheiten
  (121, 'Noch nicht da', 'skylanders.catalog_status fehlt noch (0152)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '0'),
  (122, 'Noch nicht da', 'CHECK catalog_status_known fehlt noch (0152)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_catalog_status_known'), '0'),
  (123, 'Noch nicht da', 'CHECK catalog_status_matches_visibility fehlt noch (0152)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_catalog_status_matches_visibility'), '0'),
  (124, 'Noch nicht da', 'Trigger skylanders_sync_catalog_status fehlt noch (0152)',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and t.tgname = 'skylanders_sync_catalog_status'), '0'),
  (125, 'Noch nicht da', 'skylanders_sync_catalog_status fehlt noch (0152)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'skylanders_sync_catalog_status'), '0'),
  (126, 'Noch nicht da', 'admin_set_catalog_status fehlt noch (0152)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_set_catalog_status'), '0'),
  (127, 'Noch nicht da', 'admin_merge_references fehlt noch (0154)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_merge_references'), '0'),
  (128, 'Noch nicht da', 'admin_merge_draft fehlt noch (0154 und 0156)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_merge_draft'), '0'),
  (129, 'Noch nicht da', 'admin_discard_draft fehlt noch (0155)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_discard_draft'), '0'),
  (130, 'Noch nicht da', 'admin_merge_plan fehlt noch (0156, ersetzt in 0157)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_merge_plan'), '0'),
  (131, 'Noch nicht da', 'merge_note fehlt noch (0157)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'merge_note'), '0'),
  (132, 'Noch nicht da', 'admin_create_character fehlt noch (0158)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_create_character'), '0'),
  (133, 'Noch nicht da', 'admin_set_character fehlt noch (0158)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_set_character'), '0'),
  (134, 'Noch nicht da', 'admin_publish_as_variant fehlt noch (0158)',
      (select count(*)::text from pg_proc p
        where p.pronamespace = to_regnamespace('public')
          and p.proname = 'admin_publish_as_variant'), '0'),

  -- ----------------------------------------- Das Journal VOR der Gruppe
  /*
   * ZEILE 144 IST DER GRUND DIESER GRUPPE. `0152` laesst den Journaltrigger
   * `catalog_status` schreiben, nimmt den Namen aber nicht in die Constraint
   * auf; `0157` tut es, `0158` fuegt den elften Wert hinzu. Zwischen `0152`
   * und `0157` scheitert deshalb JEDER Statuswechsel mit `23514` — auch der
   * der heute deployten `admin_set_catalog_visible`. Deshalb fahren die
   * sieben zusammen, und deshalb darf Zeile 144 hier `0` zeigen und in der
   * Nachkontrolle `1`.
   */
  (141, 'Journal', 'catalog_admin_changes_field_known steht (0004/0007/0033)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), '1'),
  (142, 'Journal', 'sie nennt created (0033)',
      (select coalesce(bool_or(pg_get_constraintdef(c.oid) like '%created%'), false)::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (143, 'Journal', 'sie nennt catalog_group (0033)',
      (select coalesce(bool_or(pg_get_constraintdef(c.oid) like '%catalog_group%'), false)::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (144, 'Journal', 'sie nennt catalog_status NOCH NICHT — die Luecke, die 0157 schliesst',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%catalog_status%'), '0'),
  (145, 'Journal', 'sie nennt character_id NOCH NICHT (0158)',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'
          and pg_get_constraintdef(c.oid) like '%character_id%'), '0'),
  /*
   * DIE BEIDEN ZEILEN, DIE EIN STILLES HINDERNIS SICHTBAR MACHEN. `0157`
   * und `0158` bauen die Constraint mit `drop` und `add` neu, und `add`
   * OHNE `not valid` prueft die bestehenden Zeilen mit. Traegt heute eine
   * Journalzeile ein Feld, das die neue Liste nicht kennt, scheitert die
   * Gruppe mitten in `0157` — und rollt dann die sechs Migrationen davor
   * mit zurueck. Das ist sicher, aber teuer; hier faellt es vorher auf.
   */
  (147, 'Journal', 'keine bestehende Journalzeile traegt ein Feld ausserhalb der elf',
      (select count(*)::text from public.catalog_admin_changes
        where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                            'catalog_group', 'image_override_path', 'card_type',
                            'created', 'catalog_status', 'merged_from', 'discarded',
                            'character_id')), '0'),
  (148, 'Journal', 'Info: welche Feldnamen im Journal wirklich vorkommen',
      (select coalesce(string_agg(distinct field, ', ' order by field), '(keine Zeilen)')
         from public.catalog_admin_changes), null),
  (146, 'Journal', 'Info: der heutige Wortlaut der Constraint',
      (select pg_get_constraintdef(c.oid) from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), null),

  -- -------------------------- Die Exportfunktion, wie 0153 sie vorfinden MUSS
  /*
   * `0153` TRAEGT DIESES TOR SELBST und bricht ab, wenn der Rumpf nicht der
   * aus `0144` ist. Hier steht es noch einmal, weil ein Abbruch mitten in
   * der Gruppe teurer ist als eine rote Zeile davor: die Transaktion rollt
   * dann alles zurueck, und der Bediener weiss erst hinterher, warum.
   */
  (151, 'Export', 'Rumpfabdruck ist die Fassung aus 0144',
      (select md5(p.prosrc) from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')),
      '4c4d2e7c81e4efa8e18cdffa06bba40a'),
  (152, 'Export', '54 Bereiche (coalesce(( gezaehlt) — 0153 fuegt ein FELD hinzu, keinen Bereich',
      (select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
               / length('coalesce(('))::text
         from pg_proc p where p.oid = to_regprocedure('public.system_platform_export()')),
      '54'),
  (153, 'Export', 'security definer',
      (select p.prosecdef::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 'true'),
  (154, 'Export', 'volatility stable',
      (select p.provolatile::text from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()')), 's'),
  (155, 'Export', 'genau EINE search_path-Festlegung, und ihr Wert ist LEER',
      (select (count(*) = 1 and btrim(min(substring(c from 'search\_path=(.*)$')), '"') = '')::text
         from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
        where p.oid = to_regprocedure('public.system_platform_export()')
          and c like 'search\_path=%'), 'true'),

  -- ------------------------------ Die Ausgangsverteilung und das Triggerinventar
  /*
   * DIE ZAHLEN 163 UND 164 SIND DER MASSSTAB DES BACKFILLS. `0152` leitet
   * den Status aus `catalog_visible` ab; in der Nachkontrolle muessen genau
   * diese beiden Zahlen als 'public' und 'hidden' wieder auftauchen. Die
   * Huelle rechnet das in derselben Transaktion nach (B5 bis B7) und rollt
   * zurueck, wenn eine Zeile abweicht — eine Nachkontrolle koennte es nur
   * berichten.
   */
  (161, 'Daten', 'Info: Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders), null),
  (162, 'Daten', 'Info: Trigger an skylanders, benannt',
      (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(keine)')
         from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), null),
  (163, 'Daten', 'Info: sichtbare Katalogzeilen — werden zu catalog_status = public',
      (select count(*)::text from public.skylanders where catalog_visible), null),
  (164, 'Daten', 'Info: unsichtbare Katalogzeilen — werden zu catalog_status = hidden',
      (select count(*)::text from public.skylanders where not catalog_visible), null),
  (165, 'Daten', 'RLS ist an skylanders aktiv',
      (select c.relrowsecurity::text from pg_class c
        where c.oid = to_regclass('public.skylanders')), 'true'),
  (166, 'Daten', 'der Teilindex skylanders_public_catalog_idx steht (0004)',
      (select count(*)::text from pg_class c
        where c.relname = 'skylanders_public_catalog_idx' and c.relkind = 'i'), '1'),
  (167, 'Daten', 'Info: Zeilen in catalog_editorial',
      (select count(*)::text from public.catalog_editorial), null),

  -- ------------------------------------------------------------- Die Rechte
  (171, 'Rechte', 'anon hat kein execute auf admin_create_figure',
      has_function_privilege('anon',
        'public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)',
        'execute')::text, 'false'),
  (172, 'Rechte', 'authenticated hat execute auf admin_create_figure',
      has_function_privilege('authenticated',
        'public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)',
        'execute')::text, 'true'),
  (173, 'Rechte', 'anon hat kein execute auf admin_set_catalog_visible',
      has_function_privilege('anon', 'public.admin_set_catalog_visible(text,boolean)',
        'execute')::text, 'false'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
-- <<< ENDE: supabase/checks/g2_preflight.sql
-- =========================================================================

rollback;
