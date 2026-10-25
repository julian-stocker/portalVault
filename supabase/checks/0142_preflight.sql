-- ===========================================================================
-- 0142 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0142` legt EINE neue Tabelle an: `purchase_calculations`, mit RLS, vier
-- Richtlinien, zwei Indizes und dem `updated_at`-Trigger aus `0001`. Rein
-- additiv — keine bestehende Tabelle, keine bestehende Spalte, kein
-- bestehender Funktionsrumpf, kein bestehendes Recht.
--
-- Diese Datei haelt vier Dinge fest: dass die Voraussetzungen stehen, dass
-- die Tabelle NOCH NICHT da ist, dass unter ihrem Namen auch kein Rest
-- herumliegt, und mit welchen Zahlen der Betrieb in den Lauf geht.
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

  -- ---------------------------------------------------- Was 0142 voraussetzt
  (101, 'Grundlage', 'auth.users steht (Supabase Auth)',
      (to_regclass('auth.users') is not null)::text, 'true'),
  (102, 'Grundlage', 'public.purchases steht (0053) — der Fremdschluessel braucht sie',
      (to_regclass('public.purchases') is not null)::text, 'true'),
  (103, 'Grundlage', 'set_updated_at() steht (0001) — der Trigger haengt daran',
      (to_regprocedure('public.set_updated_at()') is not null)::text, 'true'),
  (104, 'Grundlage', 'gen_random_uuid() steht — die Vorgabe des Schluessels',
      (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
       or to_regprocedure('public.gen_random_uuid()') is not null)::text, 'true'),
  (105, 'Grundlage', 'non_collectible_categories() steht (0135/0137) — fuer Zeile 304',
      (to_regprocedure('public.non_collectible_categories()') is not null)::text, 'true'),

  -- ------------------------------------------- Und 0142 ist noch nicht da
  (110, 'Neu', 'purchase_calculations fehlt NOCH — sonst bricht 0142 ab',
      (to_regclass('public.purchase_calculations') is null)::text, 'true'),
  /*
   * KEIN REST UNTER DIESEM NAMEN.
   *
   * `0142` legt Index, Trigger und Richtlinien unter festen Namen an. Lag
   * dort noch ein Rest aus einem abgebrochenen Versuch, scheiterte die
   * Migration mitten im Lauf — sie laeuft in EINER Transaktion, also bleibt
   * nichts zurueck, aber der Lauf waere umsonst. Billiger, vorher zu fragen.
   */
  (111, 'Neu', 'kein Index dieses Namens liegt herum',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname in ('purchase_calculations_user_updated_idx',
                            'purchase_calculations_purchase_uniq')), '0'),
  (112, 'Neu', 'und keine Richtlinie dieses Namens',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '0'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0142 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------- Die Nachbartabelle, die der Postflight mitzaehlt
  /*
   * WARUM `collection_items` HIER STEHT. Der Postflight zu `0142` fragt in
   * Zeile 502, ob die VIER eigenen Richtlinien dieser Tabelle noch stehen —
   * die Probe darauf, dass eine neue Tabelle mit demselben Muster der alten
   * nichts weggenommen hat. Damit „noch" eine Bedeutung hat, muss das
   * Vorher dastehen.
   */
  (321, 'Nachbar', 'die vier eigenen Richtlinien von collection_items stehen, '
        'fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (322, 'Nachbar', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),
  (323, 'Nachbar', 'Info: Einkaeufe (0142 legt keinen an)',
      (select count(*)::text from public.purchases), null),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
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
