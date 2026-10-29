-- ========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0152 (GRUPPE G2), REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Production-Projekts zmiwxswrpkmizvqsgype einfuegen, ausfuehren. Die Klammer
-- und das `rollback` stehen schon darin. Sie schreibt nichts.
--
-- VOR `prod-0152.sql` fahren.
--
-- DEN UMGEKEHRTEN STEMPEL TRAEGT SIE TROTZDEM, obwohl sie nichts schreibt.
-- Der Grund ist nicht Schaden, sondern WAHRHEIT: am 2026-10-20 liefen
-- Pruefdateien auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT — UND ZEILE 901 DAZU.     ##
-- ##  Seit G1 KOPIEREN MUESSEN SIE SIE NICHT: `prod-0152.sql` misst beide  ##
-- ##  Vertraege selbst und vergleicht sie in derselben Transaktion.        ##
-- ###########################################################################
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen.
--
-- DIE ENTSCHEIDENDEN ZEILEN DIESES BLATTES:
--
--   104, 105, 106  die drei Objekte, die `0152` ERSETZT oder voraussetzt:
--                  `log_skylander_editorial_change()` (0004) steht,
--                  `admin_create_figure` steht mit ACHT Parametern — und
--                  zwar genau EINE Fassung. Gaebe es zwei, waere die
--                  Ersetzung eine Ueberladung.
--   107            `admin_set_catalog_visible(text,boolean)` steht und bleibt.
--   111 bis 115    nichts von `0152` ist schon da — auch der Rumpf von
--                  `admin_create_figure` nennt `catalog_status` noch nicht.
--   121 bis 124    DIE AUSGANGSLAGE DES BACKFILLS: wie viele Zeilen sichtbar
--                  sind (werden `public`), wie viele unsichtbar (werden
--                  `hidden`), dass die Summe die Katalogzeilen trifft und
--                  dass KEINE Zeile `catalog_visible NULL` hat. Erwartung auf
--                  Production: die Summe ist 624.
--   132            der Journaltrigger wird BENANNT, nicht gezaehlt.
--
-- DIESE ZAHLEN SIND DIE ERWARTUNG FUER DIE NACHKONTROLLE: nach `0152` muss
-- `public` genau die Zahl aus 121 treffen und `hidden` die aus 122. Die
-- Huelle prueft dasselbe selbst (A5/B6/B7) und kann dabei zurueckrollen.
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
-- EINGEBETTET: `supabase/checks/0152_preflight.sql`, Zeichen fuer Zeichen.
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

-- >>> EINGEBETTET: supabase/checks/0152_preflight.sql
-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0152, REIN LESEND
--
-- VOR `0152_catalog_status.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
--   101-108  DIE GRUNDLAGE, die `0152` voraussetzt — und zwar BENANNT und
--            nicht gezaehlt. `0147` brach ab, weil eine Pruefung Trigger
--            ZAEHLTE und null erwartete, waehrend sechs legitime standen
--            (ADR-0141 und die Akte zu `0147`). Diese Datei nennt deshalb
--            jedes Objekt, das sie erwartet, einzeln.
--   111-115  DASS DIE SPALTE NOCH FEHLT, und alles, was mit ihr kommt: kein
--            `catalog_status`, kein CHECK, kein Trigger, keine
--            `admin_set_catalog_status`. Vier Abwesenheiten, vier Zeilen —
--            steht eine davon schon, ist `0152` hier angewendet und der Lauf
--            gehoert angehalten.
--   121-124  DIE AUSGANGSVERTEILUNG, als Auskunft. Der Backfill von `0152`
--            leitet den Status aus `catalog_visible` ab, also muessen die
--            Zahlen 121 und 122 nach der Migration genau als 'public' und
--            'hidden' wieder auftauchen. Die Nachkontrolle rechnet das
--            selbst nach und braucht die Zahlen nicht uebergeben — sie
--            stehen hier, damit der Bediener sie SIEHT.
--   131-133  DAS JOURNAL und seine Ausloeser, benannt. `0152` ersetzt den
--            Rumpf von `log_skylander_editorial_change()`; welche Trigger
--            ihn rufen, aendert sie NICHT.
--
-- EINE RECHTEGESCHUETZTE ZEILE: 133 liest `catalog_admin_changes`, und das
-- darf der lesende Pruefzugang nicht. Sie meldet ihm `KEIN-RECHT`, zaehlt in
-- Zeile 9998 und blockiert NICHT; die Abnahme braucht dafuer den Lauf als
-- `postgres` (ADR-0139, ADR-0141). Alles Uebrige liest `pg_catalog` oder
-- `public.skylanders` — beides darf er, und `information_schema` kommt hier
-- bewusst nicht vor, weil es rechtegefiltert ist (ADR-0141).
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

  -- ------------------------------- Die Grundlage, benannt und nicht gezaehlt
  (101, 'Grundlage', 'skylanders steht (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'skylanders.catalog_visible steht (0004)',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_visible' and not a.attisdropped), '1'),
  (103, 'Grundlage', 'is_platform_admin() steht (0026/0077)',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (104, 'Grundlage', 'log_skylander_editorial_change() steht (0004) — 0152 ersetzt ihren Rumpf',
      (to_regprocedure('public.log_skylander_editorial_change()') is not null)::text, 'true'),
  /*
   * NACH DER PARAMETERZAHL, NICHT NACH EINER GETIPPTEN TYPLISTE.
   *
   * HIER STAND EINE AUSGESCHRIEBENE SIGNATUR — und sie war falsch:
   * `numeric` an fuenfter Stelle, wo `boolean` steht (`p_catalog_visible`).
   * Der Preflight meldete am 2026-10-27 darauf eine Abweichung, die keine
   * war: die Funktion steht sehr wohl, nur unter der richtigen Typliste.
   * `to_regprocedure` sagt bei einer falsch getippten Signatur NULL und
   * nicht „so eine gibt es nicht" — die beiden Faelle sehen gleich aus.
   *
   * Eine Signatur von Hand zu wiederholen ist genau die Sorte Handarbeit,
   * die dieses Projekt abgeschafft hat. Zusammen mit Zeile 106 (es gibt
   * GENAU EINE Fassung) ist die Parameterzahl der staerkere Nachweis, und
   * Zeile 108 schreibt die tatsaechliche Signatur ins Protokoll, damit
   * niemand sie erraten muss.
   */
  (105, 'Grundlage', 'admin_create_figure steht mit acht Parametern (0034/0041)',
      (select coalesce(max(p.pronargs), 0)::text from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'), '8'),
  /*
   * UND ZWAR GENAU EINE FASSUNG. `0033` legte eine Funktion mit sieben
   * Parametern an, `0034` eine mit acht und loescht die alte. Steht die alte
   * noch, ist ein Aufruf mit drei Argumenten mehrdeutig (`42725`) — der
   * Fehler, der im Probelauf P60 zuerst auftrat, weil das Stub-Schema
   * `drop function` ignoriert.
   */
  (106, 'Grundlage', 'und zwar genau EINE Fassung von admin_create_figure',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'), '1'),
  (107, 'Grundlage', 'admin_set_catalog_visible(text,boolean) steht (0041) — 0152 LAESST sie',
      (to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is not null)::text,
      'true'),
  (108, 'Grundlage', 'Info: die tatsaechliche Signatur von admin_create_figure',
      (select coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ' | '),
                       '(keine)')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'), null),

  -- ------------------------------------- Vier Abwesenheiten, vier Zeilen
  (111, 'Noch nicht da', 'skylanders.catalog_status fehlt',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'catalog_status' and not a.attisdropped), '0'),
  (112, 'Noch nicht da', 'kein CHECK mit catalog_status im Namen',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.contype = 'c' and c.conname like '%catalog_status%'), '0'),
  (113, 'Noch nicht da', 'kein Trigger skylanders_sync_catalog_status',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and not t.tgisinternal and t.tgname = 'skylanders_sync_catalog_status'), '0'),
  (114, 'Noch nicht da', 'admin_set_catalog_status(text,text) gibt es nicht',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is null)::text, 'true'),
  (115, 'Noch nicht da', 'und der Rumpf von admin_create_figure nennt catalog_status nicht',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_figure'
          and p.prosrc like '%catalog_status%'), '0'),

  -- ------------------- Die Ausgangsverteilung, Auskunft ohne Erwartung
  /*
   * DIESE DREI ZAHLEN SIND DIE PROBE AUF DEN BACKFILL. Er setzt
   * `case when catalog_visible then 'public' else 'hidden' end` — also muss
   * 121 nachher die Zahl der 'public' und 122 die der 'hidden' sein, und
   * 123 muss NULL bleiben, weil `0152` keinen Entwurf erzeugt. Die
   * Nachkontrolle rechnet die Gleichheit selbst nach (Zeilen 111-113); hier
   * stehen die Zahlen, damit der Bediener sie vorher gesehen hat.
   */
  (121, 'Ausgangslage', 'Info: sichtbare Katalogzeilen (werden public)',
      (select count(*)::text from public.skylanders where catalog_visible), null),
  (122, 'Ausgangslage', 'Info: unsichtbare Katalogzeilen (werden hidden)',
      (select count(*)::text from public.skylanders where not catalog_visible), null),
  (123, 'Ausgangslage', 'Info: Summe beider Zahlen — muss die Katalogzeilen treffen',
      (select (count(*) filter (where catalog_visible)
               + count(*) filter (where not catalog_visible))::text
         from public.skylanders), null),
  (124, 'Ausgangslage', 'keine Zeile hat catalog_visible NULL — der Backfill braucht das',
      (select count(*)::text from public.skylanders where catalog_visible is null), '0'),

  -- --------------------------------------- Das Journal und seine Ausloeser
  (131, 'Journal', 'catalog_admin_changes steht (0004)',
      (to_regclass('public.catalog_admin_changes') is not null)::text, 'true'),
  (132, 'Journal', 'der Trigger skylanders_log_editorial steht — BENANNT, nicht gezaehlt',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.skylanders')
          and not t.tgisinternal and t.tgname = 'skylanders_log_editorial'), '1'),
  /*
   * RECHTEGESCHUETZT, und das ist keine Feinheit: `catalog_admin_changes`
   * darf der lesende Pruefzugang NICHT lesen. Ein direktes `select` darauf
   * laesst die GANZE Datei mit `permission denied` abbrechen — statt einer
   * Zeile verliert man dann alle. Dieselbe Huelle wie bei `offer_state` in
   * `0151_preflight.sql`: `has_table_privilege` fragt vorher, `query_to_xml`
   * haelt die Abfrage vom Planer fern, und die Zeile meldet `KEIN-RECHT`,
   * zaehlt in 9998 und blockiert nicht (ADR-0139, ADR-0141).
   */
  (133, 'Journal', 'Info: Journalzeilen vor der Migration (0152 schreibt keine)',
      case when to_regclass('public.catalog_admin_changes') is null then '(keine Tabelle)'
           when has_table_privilege('public.catalog_admin_changes', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.catalog_admin_changes',
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0152 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

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
-- <<< ENDE: supabase/checks/0152_preflight.sql

rollback;
