-- ===========================================================================
-- 0143 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0143_purchase_from_calculation.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- WAS SIE BEANTWORTET
--
--   * Steht die Funktion, mit vierzehn Argumenten in der richtigen Folge,
--     `security definer`, leerem `search_path`, und nur fuer `authenticated`?
--   * RUFT SIE DIE BESTEHENDE EINKAUFSFUNKTION AUF, statt sie nachzubauen?
--     Das ist die eigentliche Frage dieser Datei: es darf keinen zweiten Weg
--     geben, einen Einkauf anzulegen.
--   * Stehen die drei Riegel im Rumpf — Betriebsrolle, Besitz der
--     Kalkulation, Einmaligkeit mit `for update`?
--   * Liest sie aus der Kalkulation KEINE Zahl?
--   * Und ist ringsherum nichts verrutscht: `seller_create_purchase_with_items`
--     unveraendert, `purchase_calculations` unveraendert, die BELEGSPERRE
--     unveraendert?
--
-- WAS SIE NICHT BEANTWORTET: ob ein Einkauf dabei wirklich entsteht und die
-- Verknuepfung sitzt. Das faehrt Probelauf **P49** an echtem PostgreSQL nach
-- (ohne Rolle abgewiesen, fremde Kalkulation „not found", guter Fall ein
-- Einkauf mit zwei Positionen und gesetzter `purchase_id`, derselbe Entwurf
-- noch einmal ohne zweiten Einkauf, neuer Entwurf abgewiesen ohne Waise) —
-- und am laufenden System der Lauf durch das Formular.
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
-- NUR LESEN. Ein einziges SELECT. Sie ruft die Funktion NICHT auf.
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
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl, p.pronargs,
         p.proargnames, p.proargtypes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'seller_create_purchase_from_calculation'
),
nachbar as (
  select p.proname, md5(p.prosrc) as md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_create_purchase_with_items', 'seller_create_purchase')
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------- Die Funktion
  (101, 'Neu', 'seller_create_purchase_from_calculation steht, genau einmal',
      (select count(*)::text from fn), '1'),
  (102, 'Neu', 'vierzehn Argumente, in dieser Folge',
      coalesce((select array_to_string(f.proargnames, ',') from fn f), '(keine)'),
      'p_calculation_id,p_purchased_at,p_total_cost,p_note,p_is_test,p_items,'
      || 'p_platform,p_seller_name,p_items_cost,p_shipping_cost,'
      || 'p_buyer_protection_cost,p_payment_method,p_external_ref,p_client_token'),
  (103, 'Neu', 'und mit diesen Typen',
      coalesce((select array_to_string(array(
                 select t::regtype::text from unnest(f.proargtypes) t), ',')
                 from fn f), '(keine)'),
      'uuid,date,numeric,text,boolean,jsonb,text,text,numeric,numeric,numeric,'
      || 'text,text,text'),
  (104, 'Neu', 'Rueckgabetyp bigint',
      coalesce((select p.prorettype::regtype::text from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname = 'seller_create_purchase_from_calculation'),
               '(keine)'), 'bigint'),
  (105, 'Neu', 'security definer',
      coalesce((select f.prosecdef::text from fn f), '(keine)'), 'true'),
  (106, 'Neu', 'es gibt eine search_path-Festlegung, und sie ist leer',
      coalesce((select coalesce(
                 (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                    from unnest(coalesce(f.proconfig, '{}'::text[])) c
                   where c like 'search\_path=%'),
                 '(leer)') from fn f), '(keine)'), '(leer)'),

  -- ----------------------------- SIE LEGT DEN EINKAUF NICHT SELBST AN
  (201, 'Ein Weg', 'sie ruft seller_create_purchase_with_items auf',
      coalesce((select (position('public.seller_create_purchase_with_items('
                                in f.prosrc) > 0)::text from fn f), '(keine)'), 'true'),
  (202, 'Ein Weg', 'und fuegt selbst nichts in purchases ein',
      coalesce((select (f.prosrc ~* '\minsert\s+into\s+public\.purchases\m')::text
                  from fn f), '(keine)'), 'false'),
  (203, 'Ein Weg', 'auch nichts in purchase_items',
      coalesce((select (f.prosrc ~* '\minsert\s+into\s+public\.purchase_items\m')::text
                  from fn f), '(keine)'), 'false'),
  /*
   * DIE VERKETTUNG BRAUCHT KLAMMERN, und das ist keine Stilfrage.
   *
   * `x ~* 'A' || 'B'` liest PostgreSQL als `(x ~* 'A') || 'B'` — beide
   * Operatoren haben dieselbe Vorrangstufe und binden nach links. Das
   * Muster war damit abgeschnitten, seine Klammern unbalanciert, und der
   * Probelauf brach mit „parentheses () not balanced" ab. Gefunden hat es
   * `npm run verify:check-sql`, bevor die Datei jemand gefahren hat.
   */
  (204, 'Ein Weg', 'und sie bucht nichts ein (keine Bewegung, kein Bestand)',
      coalesce((select (f.prosrc ~* ('\m(inventory_movements|shop_inventory|'
                        || 'seller_book_purchase_item)\m'))::text
                  from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------- Die drei Riegel
  (301, 'Riegel', '1. sie fragt die Betriebsrolle',
      coalesce((select (position('can_operate_active_seller' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (302, 'Riegel', '2. sie prueft den Besitz der Kalkulation ausdruecklich',
      coalesce((select (position('c.user_id = (select auth.uid())' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (303, 'Riegel', '3. sie sperrt die Kalkulationszeile (for update)',
      coalesce((select (position('for update' in f.prosrc) > 0)::text from fn f),
               '(keine)'), 'true'),
  (304, 'Riegel', 'und weist eine zweite Uebernahme ab',
      coalesce((select (position('already handed over' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (305, 'Riegel', 'dieselbe Antwort fuer "gibt es nicht" und "gehoert jemand anderem"',
      coalesce((select (position('calculation not found' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),

  -- --------------------------------------------- Keine Zahl aus der Kalkulation
  (401, 'Kein Geld', 'sie liest aus der Kalkulation nur purchase_id',
      coalesce((select (position('select c.purchase_id into v_vorher' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (402, 'Kein Geld', 'und keinen Betrag, keinen Faktor, keine Positionen',
      coalesce((select (f.prosrc ~* '\m(total_cents|factor_percent|c\.lines)\m')::text
                  from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------------- Die Rechte
  (501, 'Rechte', 'materialisierter ACL (NULL waere PUBLIC)',
      coalesce((select (f.proacl is not null)::text from fn f), '(keine)'), 'true'),
  (502, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      coalesce((select count(*)::text from fn f, aclexplode(f.proacl) a
                 where a.privilege_type = 'EXECUTE'
                   and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '(keine)'),
      '0'),
  (503, 'Rechte', 'authenticated darf ausfuehren',
      has_function_privilege('authenticated',
        'public.seller_create_purchase_from_calculation(uuid, date, numeric, text, '
        || 'boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text)',
        'execute')::text, 'true'),

  -- -------------------------------------------- Ringsherum ist nichts verrutscht
  (601, 'Unberuehrt', 'seller_create_purchase_with_items steht, genau einmal',
      (select count(*)::text from nachbar
        where proname = 'seller_create_purchase_with_items'), '1'),
  (602, 'Unberuehrt', 'seller_create_purchase steht, genau einmal',
      (select count(*)::text from nachbar where proname = 'seller_create_purchase'), '1'),
  (603, 'Unberuehrt', 'purchase_calculations hat weiter vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (604, 'Unberuehrt', 'und keine davon gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and 'anon' = any (roles)), '0'),
  (605, 'Unberuehrt', 'der partielle Unique-Index auf purchase_id steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'), '1'),

  -- --------------------------------------------------------- DIE BELEGSPERRE
  (701, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and (a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (702, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),
  (703, 'Belege', 'und 0143 nennt die Belegausstellung nirgends',
      coalesce((select (f.prosrc ~* ('\m(platform_receipt|issue_platform|'
                        || 'correct_platform)\m'))::text from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------------------- Infos
  (901, 'Info', 'Einkaeufe insgesamt (0143 legt keinen an)',
      (select count(*)::text from public.purchases), null),
  (902, 'Info', 'gespeicherte Kalkulationen, davon verknuepft',
      (select count(*)::text from public.purchase_calculations) || ' / ' ||
      (select count(*)::text from public.purchase_calculations
        where purchase_id is not null), null),

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
