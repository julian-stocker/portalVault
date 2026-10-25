-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0143, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- VOR `prod-0143.sql` und NACH `prod-0142.sql` fahren. `0143` legt EINE neue Funktion an.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT.                         ##
-- ##  Sie vollstaendig kopieren und in prod-s-postflight-0143.sql an die  ##
-- ##  Stelle BASIS-HIER-EINSETZEN setzen. Ohne sie laeuft die             ##
-- ##  Nachkontrolle nicht durch.                                          ##
-- ###########################################################################
--
-- ERFOLGSKRITERIEN — Zeile `9999` muss `0` zeigen
--
--   101-105  `0142` steht vollstaendig: Tabelle, RLS, vier Richtlinien,
--            `anon` ohne Tabellenrecht, der PARTIELLE Unique-Index
--   111-115  der EINE bestehende Weg in einen Einkauf, je genau einmal
--   120-121  `seller_create_purchase_from_calculation` **fehlt noch**
--   311-312  **nichts freigegeben**: 0 Freigaben, 0 Zubehoerangebote
--   401-402  die Belegsperre
--
-- KEINE FESTEN GESCHAEFTSZAHLEN MEHR (berichtigt am 2026-10-25). Hier standen
-- sieben Sollwerte aus der Nachkontrolle zu `0141` vom 2026-10-21, und sie
-- blockierten. Am 2026-10-25 hat genau das den Lauf angehalten: der Betrieb
-- hatte 31 Lagerzeilen eingebucht und 20 Angebote mehr — nachgewiesen
-- gewoehnlicher Geschaeftsbetrieb
-- (`supabase/checks/production_baseline_0142_finding.md`).
--
-- Der Fehler war nicht die Zahl, sondern die ART der Erwartung: keine der
-- sieben ist eine Voraussetzung dieser Migration. Sie sind jetzt MESSUNGEN
-- und wandern als EINE ZEILE zur Nachkontrolle, die sie BLOCKIEREND gegen
-- das tatsaechliche Vorher vergleicht.
--
-- ZEILEN OHNE SOLLWERT (`ok` ist NULL): 1, 301-307, 321-324, 900. Das sind Messungen —
-- nichts davon blockiert, und nichts davon muss abgeschrieben werden: Zeile
-- 900 traegt sie alle.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- EINGEBETTET: `supabase/checks/0143_preflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den schreibenden Dateien. Ein lesender
-- Lauf im falschen Fenster richtet keinen Schaden an, liefert aber einen
-- falschen Befund — und genau das ist am 2026-10-20 passiert: Pruefdateien
-- liefen auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/0143_preflight.sql mit einer eigenen Baseline..';
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

-- >>> EINGEBETTET: supabase/checks/0143_preflight.sql
-- ===========================================================================
-- 0143 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0143` legt EINE neue Funktion an:
-- `seller_create_purchase_from_calculation(uuid, …13)`. Sie legt den Einkauf
-- NICHT selbst an, sondern ruft `seller_create_purchase_with_items`
-- unveraendert auf und schreibt in derselben Transaktion `purchase_id` in
-- die Kalkulation. Rein additiv — keine Tabelle, keine Spalte, kein
-- bestehender Rumpf, kein bestehendes Recht.
--
-- Diese Datei haelt fest: `0142` steht und ist unveraendert, der EINE
-- bestehende Weg in einen Einkauf steht genau einmal, die Funktion ist noch
-- nicht da, und mit welchen Zahlen der Betrieb in den Lauf geht.
--
-- SIE SETZT 0142 VORAUS. Zeile 101 ist der Grund, warum die Reihenfolge
-- nicht beliebig ist.
--
-- KEINE FESTEN GESCHAEFTSZAHLEN MEHR (berichtigt am 2026-10-25).
--
-- Hier standen sieben Sollwerte aus der Nachkontrolle zu `0141` vom
-- 2026-10-21, und sie waren BLOCKIEREND. Am 2026-10-25 hat genau das den
-- Lauf angehalten: der Betrieb hatte 31 Lagerzeilen eingebucht und 20
-- Angebote mehr, also wich alles ab, was sich an einem arbeitenden Shop
-- bewegt — nachgewiesen gewoehnlicher Geschaeftsbetrieb
-- (`production_baseline_0142_finding.md`).
--
-- DER FEHLER WAR NICHT DIE ZAHL, SONDERN DIE ART DER ERWARTUNG. Keine der
-- sieben ist eine Voraussetzung dieser Migration; sie stehen hier, damit die
-- NACHKONTROLLE ein Vorher hat. Die Invariante heisst also nicht „gleich
-- 287", sondern „nach der Migration dasselbe wie vorher" — und das kann eine
-- Konstante vom 21. Oktober nicht ausdruecken.
--
-- Deshalb sind sie jetzt MESSUNGEN (`ok` ist NULL) und wandern als EINE
-- ZEILE zur Nachkontrolle. Was blockiert, ist unveraendert: Struktur,
-- Rechte, Richtlinien, Freigaben, Belegsperre.
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
-- WOFUER DAS NEUNTE FELD. Es faengt ab, was ein Mensch beim Kopieren
-- anrichtet: eine abgeschnittene Zeile, zwei vertauschte Felder, eine
-- verlorene Stelle in einer Zahl. Es ist KEIN Schutz gegen Absicht — wer die
-- Werte von Hand neu setzen und die Summe neu rechnen will, kann das. Dagegen
-- schuetzt kein SQL, sondern nur die Reihenfolge der Schritte: die Basis
-- entsteht VOR der Migration und wird danach nicht mehr erhoben.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen. ZEILE 900 IST
-- DAS ERGEBNIS, DAS WEITERGEHT — sie gehoert in die Nachkontrolle.
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
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------- 0142 steht, vollstaendig
  (101, 'Grundlage', 'purchase_calculations steht (0142) — ohne sie laeuft 0143 nicht',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),
  (102, 'Grundlage', 'Row Level Security ist dort eingeschaltet',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.purchase_calculations')),
               '(keine Tabelle)'), 'true'),
  (103, 'Grundlage', 'und sie traegt ihre vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (104, 'Grundlage', 'anon hat dort KEIN Tabellenrecht',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.purchase_calculations'))
          and (a.grantee::regrole::text in ('anon'))), '0'),
  (105, 'Grundlage', 'der PARTIELLE Unique-Index auf purchase_id steht — '
        'die zweite Haelfte der Doppelsperre',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'
          and indexdef like '%WHERE (purchase_id IS NOT NULL)%'), '1'),

  -- ------------------------------------ Der EINE bestehende Weg in einen Einkauf
  /*
   * ES GIBT GENAU EINEN, UND DAS IST DER PUNKT. `0143` ruft ihn auf, statt
   * ihn nachzubauen. Stuende hier eine zweite Signatur aus einer frueheren
   * Fassung, waere nicht mehr entscheidbar, welche die neue Funktion
   * erwischt — PostgreSQL wuerde nach Typen aufloesen, und zwei
   * Ueberladungen sind genau die Sorte Unterschied, die spaeter niemand
   * findet.
   */
  (111, 'Ein Weg', 'seller_create_purchase_with_items steht, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items'), '1'),
  (112, 'Ein Weg', 'und zwar mit den dreizehn Parametern aus 0064/0115/0116/0120',
      (to_regprocedure('public.seller_create_purchase_with_items(date, numeric, text, '
                       'boolean, jsonb, text, text, numeric, numeric, numeric, text, '
                       'text, text)') is not null)::text, 'true'),
  (113, 'Ein Weg', 'seller_create_purchase steht, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'seller_create_purchase'), '1'),
  (114, 'Ein Weg', 'can_operate_active_seller() steht (0041) — der erste Riegel',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (115, 'Ein Weg', 'purchases.client_token steht (0120) — die Idempotenz',
      (select (count(*) = 1)::text from pg_attribute a
        where a.attrelid = to_regclass('public.purchases')
          and a.attname = 'client_token'
          and a.attnum > 0 and not a.attisdropped), 'true'),

  -- ------------------------------------------- Und 0143 ist noch nicht da
  (120, 'Neu', 'seller_create_purchase_from_calculation fehlt NOCH — '
        'sonst bricht 0143 ab',
      (to_regprocedure('public.seller_create_purchase_from_calculation(uuid, date, '
                       'numeric, text, boolean, jsonb, text, text, numeric, numeric, '
                       'numeric, text, text, text)') is null)::text, 'true'),
  (121, 'Neu', 'und auch nicht unter einer anderen Signatur',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'seller_create_purchase_from_calculation'), '0'),

  -- --------------------------- Die Zahlen, die Nutzer kennen (Z0-Vertrag)
  (301, 'Unberuehrt', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      null),
  (302, 'Unberuehrt', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      null),
  (303, 'Unberuehrt', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      null),
  (304, 'Unberuehrt', 'sammelbare Katalogzeilen (Fortschrittsnenner)',
      (select count(*)::text from sammelbar),
      null),
  (305, 'Unberuehrt', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      null),
  (306, 'Unberuehrt', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      null),
  (307, 'Unberuehrt', 'Abdruck ueber Listung, Preis und Freigabe jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-') || '|'
                                      || i.sale_released::text,
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i),
      null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0143 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- ------------------------------- Was der Postflight hinterher vergleicht
  (321, 'Vorher', 'Info: Einkaeufe insgesamt (0143 legt keinen an)',
      (select count(*)::text from public.purchases), null),
  (322, 'Vorher', 'Info: Einkaufspositionen insgesamt',
      (select count(*)::text from public.purchase_items), null),
  (323, 'Vorher', 'Info: gespeicherte Kalkulationen, davon verknuepft',
      (select count(*)::text || ' / '
              || count(*) filter (where purchase_id is not null)::text
         from public.purchase_calculations), null),
  (324, 'Vorher', 'Info: Lagerbewegungen (eine Uebernahme bucht nichts ein)',
      (select count(*)::text from public.inventory_movements), null),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and (a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (402, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

  -- ===================== Die Basis, die weitergeht
  /*
   * EINE ZEILE, SIEBEN WERTE, UND EINE SCHUTZSUMME.
   *
   * Sie vollstaendig kopieren und in der Nachkontrolle oben einsetzen:
   *
   *   select set_config('skyisles.base', '<diese Zeile>', true);
   *
   * Die Nachkontrolle vergleicht dann BLOCKIEREND gegen genau diesen Stand.
   * Fehlt die Zeile dort, ist das eine blockierende Abweichung — ein
   * stillschweigendes Durchlaufen ohne Vorher gibt es nicht.
   */
  (900, 'BASIS', 'die Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null)
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
-- <<< ENDE: supabase/checks/0143_preflight.sql

rollback;
