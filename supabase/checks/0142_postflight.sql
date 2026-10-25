-- ===========================================================================
-- 0142 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0142_purchase_calculations.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- WAS SIE BEANTWORTET: steht die Tabelle mit ihren zwoelf Spalten, ist RLS
-- an, gelten vier Richtlinien, sind die Rechte so eng wie vorgesehen, stehen
-- die zwei Indizes und der Trigger — und ist die Tabelle LEER.
--
-- WAS SIE NICHT BEANTWORTET: ob die Richtlinien WIRKEN. Das zeigt nur ein
-- Lauf mit zwei echten Sitzungen: `npm run verify:calculations:staging`.
-- Eine Richtlinie, die richtig konfiguriert ist, und eine, die greift, sind
-- zwei verschiedene Aussagen (dieselbe Lehre wie `verify-rls.mts`).
--
--
-- UND SIE VERGLEICHT DEN SHOP MIT DEM VORHER (neu am 2026-10-25).
--
-- Die sieben Geschaeftszahlen standen bis hierher als feste Sollwerte im
-- PREFLIGHT und blockierten dort — am 2026-10-25 hat genau das den Lauf
-- angehalten, weil der Betrieb Ware eingebucht hatte
-- (`production_baseline_0142_finding.md`). Jetzt messen sie im Preflight und
-- werden HIER verglichen: nicht gegen eine Konstante, sondern gegen den
-- Stand unmittelbar vor der Migration.
--
-- SO UEBERGIBST DU SIE. Zeile 900 des Preflights gibt eine Zeile aus. Sie
-- vollstaendig kopieren und VOR diesem SELECT ausfuehren:
--
--   select set_config('skyisles.base', 'skyisles-base-1|…', true);
--
-- Beides zusammen markieren und ausfuehren — `set_config(…, true)` gilt nur
-- in DERSELBEN Transaktion. Die Huelle
-- `supabase/operations/prod-s-postflight-0142.sql` hat die Zeile schon drin,
-- dort ist nur die Baseline einzusetzen.
--
-- OHNE BASELINE LAEUFT HIER NICHTS DURCH. Zeile 801 ist dann rot, und die
-- sieben Vergleiche sind es ebenfalls — ein stillschweigendes Durchlaufen
-- ohne Vorher gibt es nicht, und die aktuellen Werte werden NIEMALS als
-- Sollwert eingesetzt.
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
-- DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS, ausdruecklich.
--
-- Er sagt „zwischen den beiden Laeufen hat sich X bewegt". Er sagt NICHT,
-- WER es bewegt hat. Zwischen Preflight und Nachkontrolle kann regulaerer
-- Betrieb stattgefunden haben: ein Verkauf im Shop, ein eingebuchter
-- Wareneingang, eine Umpreisung in `/business/inventory`.
--
-- SO UNTERSCHEIDET MAN BEIDES:
--
--   1. ZEITFENSTER KLEIN HALTEN. Preflight, Migration und Nachkontrolle
--      hintereinander fahren, nicht ueber eine Nacht verteilt. Dann bleibt
--      fuer Betrieb kaum Raum, und jede Abweichung ist erklaerungsbeduerftig.
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN. `0142` legt eine Tabelle
--      an, `0143` eine Funktion. Keine der beiden enthaelt ein `update`,
--      `insert` oder `delete` auf `shop_inventory`, `shop_offers`,
--      `skylanders` oder `categories` — und beide laufen in EINER
--      Transaktion, die bei jeder Abweichung ihrer eigenen Nachbedingungen
--      abbricht. Eine Abweichung hier ist deshalb fast immer Betrieb.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest es
--      auf. Sie fragt tagweise, welche Lagerzeilen und Bewegungen wann
--      entstanden sind, und ob jede neue Zeile eine Buchung hat. Ein
--      Wareneingang sieht dort anders aus als ein Schemaeingriff.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben (eine Zeile fort, eine dazu). Die Abdruecke fangen
-- das ab — sie haengen an Inhalt und Reihenfolge, nicht nur an der Anzahl.
--
-- NUR LESEN. Ein einziges SELECT.
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
),basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile. Sonst waere die Bequemlichkeit der Huelle die
   * Luecke im Riegel.
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
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ---------------------------------------------------------- Die Tabelle
  (101, 'Tabelle', 'public.purchase_calculations steht',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),
  (102, 'Tabelle', 'zwoelf Spalten, in dieser Folge',
      coalesce((select string_agg(a.attname, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.purchase_calculations')
                   and a.attnum > 0 and not a.attisdropped), '(keine)'),
      'id,user_id,name,status,lines,factor_percent,total_cents,positions,units,'
      || 'purchase_id,created_at,updated_at'),
  (103, 'Tabelle', 'und die Typen, die sie tragen muessen',
      /* `format_type` liefert fuer diese fuenf Spalten dieselbe Zeichenkette
         wie `data_type` — an Staging nachgemessen. */
      /* `attname::text`: die Katalogspalte hat den Typ `name`, und an einer
         Verkettung endet das sonst in `42725` (unbestimmter Operator). */
      coalesce((select string_agg(a.attname::text || ':'
                                    || format_type(a.atttypid, a.atttypmod),
                                  ',' order by a.attname)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.purchase_calculations')
                   and a.attname in ('id', 'user_id', 'lines', 'factor_percent',
                                     'purchase_id')
                   and a.attnum > 0 and not a.attisdropped), '(keine)'),
      'factor_percent:smallint,id:uuid,lines:jsonb,purchase_id:bigint,user_id:uuid'),
  /*
   * BERICHTIGT AM 2026-10-22: AUCH HIER STAND EINE ZAHL, DIE VERFAELLT.
   *
   * Die Zeile verlangte `0` — richtig in der Minute nach der Migration und
   * falsch, sobald jemand eine Kalkulation gespeichert hat. Genau das ist
   * auf Staging passiert: eine Browserprobe hat eine Zeile angelegt, und
   * ein zweiter Lauf dieser Datei haette sie als Abweichung gemeldet.
   *
   * „Die Migration legt keine Zeile an" ist ohnehin keine Frage an die
   * Nachkontrolle, sondern an die Migration: `0142` prueft es in ihrer
   * EIGENEN Transaktion (`die Migration hat % Zeile(n) angelegt`), und dort
   * ist es beweisbar. Hier bleibt eine Messung — die Zahl, die der Betrieb
   * gerade fuehrt.
   */
  (104, 'Tabelle', 'Info: gespeicherte Kalkulationen (nach der Migration 0, '
        'danach alles, was gespeichert wurde)',
      (select count(*)::text from public.purchase_calculations), null),

  -- -------------------------------------------------------------- Die CHECKs
  (111, 'Form', 'die fuenf CHECK-Bedingungen stehen',
      (select count(*)::text from pg_constraint
        where conrelid = 'public.purchase_calculations'::regclass and contype = 'c'), '5'),
  (112, 'Form', 'der Status kennt genau vier Werte',
      (select (position('''rejected''' in pg_get_constraintdef(oid)) > 0
               and position('''review''' in pg_get_constraintdef(oid)) > 0)::text
         from pg_constraint where conname = 'purchase_calculations_status_known'), 'true'),
  (113, 'Form', 'die Positionen sind auf 200 gedeckelt (wie 0064)',
      (select (position('<= 200' in pg_get_constraintdef(oid)) > 0)::text
         from pg_constraint where conname = 'purchase_calculations_lines_shape'), 'true'),

  -- ------------------------------------------------------------------- RLS
  (201, 'RLS', 'Row Level Security ist eingeschaltet',
      (select relrowsecurity::text from pg_class
        where oid = 'public.purchase_calculations'::regclass), 'true'),
  (202, 'RLS', 'vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (203, 'RLS', 'und zwar je eine fuer select, insert, update, delete',
      coalesce((select string_agg(distinct cmd, ',' order by cmd) from pg_policies
                 where schemaname = 'public'
                   and tablename = 'purchase_calculations'), '(keine)'),
      'DELETE,INSERT,SELECT,UPDATE'),
  (204, 'RLS', 'keine Richtlinie gilt fuer anon',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and 'anon' = any (roles)), '0'),
  (205, 'RLS', 'die Aenderung prueft BEIDE Haelften (using und with check)',
      (select (qual is not null and with_check is not null)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and policyname = 'purchase_calculations_update_own'), 'true'),
  (206, 'RLS', 'und jede Richtlinie haengt an auth.uid() = user_id',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and coalesce(qual, with_check) like '%uid()%'
          and coalesce(qual, with_check) like '%user_id%'), '4'),

  -- ---------------------------------------------------------------- Rechte
  (301, 'Rechte', 'anon hat KEIN Tabellenrecht',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.purchase_calculations'))
          and (a.grantee::regrole::text in ('anon'))), '0'),
  (302, 'Rechte', 'authenticated hat genau die vier — kein truncate',
      /*
       * NUR DIE STANDARDRECHTE. `aclexplode` nennt auch `MAINTAIN`
       * (PostgreSQL 17+, in `favorites` als `m` wirklich erteilt), und das
       * kennt `information_schema` nicht, weil es nicht im SQL-Standard
       * steht. Die Beschraenkung haelt die Erwartung ueber
       * PostgreSQL-Fassungen stabil, ohne etwas zu verbergen: ein
       * `TRUNCATE` oder `UPDATE` stuende weiter in der Liste.
       */
      coalesce((select string_agg(distinct a.privilege_type, ',' order by a.privilege_type)
                  from pg_class c, aclexplode(c.relacl) a
                 where c.oid = to_regclass('public.purchase_calculations')
                   and a.grantee::regrole::text = 'authenticated'
                   and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                            'TRUNCATE', 'REFERENCES', 'TRIGGER')),
               '(keine)'),
      'DELETE,INSERT,SELECT,UPDATE'),

  -- --------------------------------------------------- Indizes und Trigger
  (401, 'Zugriff', 'der Index je Konto und Aenderungszeit steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_user_updated_idx'), '1'),
  (402, 'Zugriff', 'der PARTIELLE Unique-Index auf purchase_id steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'
          and indexdef like '%WHERE (purchase_id IS NOT NULL)%'), '1'),
  (403, 'Zugriff', 'der updated_at-Trigger aus 0001 haengt daran',
      (select count(*)::text from pg_trigger
        where tgrelid = 'public.purchase_calculations'::regclass
          and tgname = 'purchase_calculations_set_updated_at'), '1'),

  -- ------------------------------------------- Was NICHT dazugekommen ist
  (501, 'Unberuehrt', 'keine zweite Tabelle fuer den Arbeitsstand',
      (select count(*)::text from pg_class c
        where c.relnamespace = 'public'::regnamespace
          and c.relkind in ('r', 'v', 'm', 'p')
          and (c.relname like '%calculator%' or c.relname like '%draft%')), '0'),
  /*
   * BERICHTIGT AM 2026-10-22: HIER STAND EINE ZAHL, UND DIE WAR FALSCH.
   *
   * Die Zeile verlangte „genau vier Richtlinien" auf `collection_items`.
   * Auf Staging sind es FUENF, und das ist richtig: `staging-agent-setup.sql`
   * legt je Tabelle eine eigene Lesepolicy `agent_read_<tabelle>` fuer die
   * Rolle `skyisles_agent` an — fuer zwoelf Tabellen, `collection_items`
   * darunter (`docs/SECURITY.md`, 4b). Sie ist auf diese Rolle und auf
   * `select` begrenzt und stand dort lange vor `0142`.
   *
   * Eine ZAHL war also die falsche Formulierung: sie bricht, sobald jemand
   * eine berechtigte Diagnosepolicy anlegt, und sie sagt nichts darueber,
   * ob die vier, auf die es ankommt, noch da sind. Gepruefft wird deshalb
   * die EIGENSCHAFT: die vier eigenen Richtlinien stehen, sie gelten fuer
   * `authenticated`, und keine Richtlinie dieser Tabelle gibt `anon` etwas.
   *
   * Zeile 505 nennt zusaetzlich alle Richtlinien beim Namen — damit eine
   * kuenftige Abweichung nicht als Zahl erscheint, sondern als Auskunft.
   */
  (502, 'Unberuehrt', 'die vier eigenen Richtlinien von collection_items stehen, fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (505, 'Unberuehrt', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),
  (506, 'Unberuehrt', 'und keine davon gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and 'anon' = any (roles)), '0'),
  (503, 'Unberuehrt', 'die Belegsperre haelt unveraendert',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and (a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (504, 'Unberuehrt', 'Info: Einkaeufe (0142 legt keinen an)',
      (select count(*)::text from public.purchases), null),

  -- ================================== Die Baseline aus dem Preflight
  /*
   * VIER FRAGEN AN DIE UEBERGEBENE ZEILE, bevor eine einzige Zahl
   * verglichen wird. Sie fangen ab, was beim Kopieren passiert: vergessen,
   * abgeschnitten, vertauscht, eine Stelle verloren.
   *
   * Sie fangen NICHT ab, dass jemand die Werte absichtlich neu setzt und
   * die Schutzsumme neu rechnet. Dagegen schuetzt kein SELECT, sondern die
   * Reihenfolge der Schritte — die Basis entsteht VOR der Migration.
   */
  (801, 'Basis', 'eine Baseline ist uebergeben worden',
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

  -- --------------- Die sieben Werte: heute gegen das Vorher, BLOCKIEREND
  /*
   * Eine Abweichung hier heisst: zwischen Preflight und Nachkontrolle hat
   * sich am Shop etwas bewegt. Das muss diese Migration nicht gewesen sein —
   * sie fasst Angebote und Lager nicht an. Was es sonst sein kann und wie
   * man es unterscheidet, steht im Kopf dieser Datei unter DIE GRENZE.
   */
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
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
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
