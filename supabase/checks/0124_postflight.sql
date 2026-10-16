-- ===========================================================================
-- STAGING-POSTFLIGHT fuer Migration 0124  —  Datei 3 von 3
--
-- NUR LESEN. Ein einziges SELECT, dieselbe Bauform wie der Preflight. Kein
-- DO-Block, kein DDL, kein DML, kein Schema-Reload, kein Ledger-Aufruf.
--
-- ---------------------------------------------------------------------------
-- WAS ER PRUEFT
--
-- Drei Dinge, in dieser Reihenfolge der Wichtigkeit:
--
--   1. Die elf neuen Felder sind da UND es sind Wahrheitswerte, keine
--      Absenderwerte. Geprueft an der LEBENDEN Definition, nicht an der
--      Migrationsdatei.
--   2. Alle siebzehn Marker aus `0119` stehen noch im Rumpf — dieselbe Liste
--      wie Preflight 120. Das ist der Nachweis, dass die Ersetzung den Rumpf
--      uebernommen und nicht neu geschrieben hat.
--   3. Kein Bestand hat sich bewegt. Die 9xx-Zeilen muessen Zahl fuer Zahl
--      denen des Preflights entsprechen.
--
-- Der AUSGABEVERGLEICH ist nicht hier, sondern in Datei 2: dieselbe Datei
-- zweimal laufen lassen und `alt_hash` vergleichen.
--
-- ABLESEN: `ok = false` ist blockierend, `ok = null` eine Zahl zum Vergleich.
-- Die letzte Zeile (nr = 9999) muss 0 zeigen.
-- ===========================================================================

with
def as (
  select coalesce(pg_get_functiondef(to_regprocedure(
           'public.seller_orderbook_ledger(integer, integer, text, boolean, text)')), '') as d
),

/*
 * DERSELBE TEXT OHNE KOMMENTARE — UND WARUM JEDE INHALTSPRUEFUNG IHN LIEST.
 *
 * `pg_get_functiondef` liefert den Rumpf zeichengetreu, samt Kommentaren.
 * Pruefung 126 verlangt, dass der Ledger den Fingerabdruck NICHT direkt
 * ruft — und fand im Rohtext die Kommentarzeile, die erklaert, warum er ihn
 * nicht ruft. Ein Fehlalarm, derselbe, der `0124` beim ersten Versuch
 * abgebrochen hat; die Migration sucht seit der Korrektur kommentarfrei,
 * diese Datei tat es noch nicht.
 *
 * Von den 14 Stellen, die hier gegen den Rumpf pruefen, aendert genau diese
 * eine ihr Ergebnis. Umgestellt werden trotzdem alle: die Gefahr laeuft in
 * beide Richtungen, und ein Marker, der nur noch in einem Kommentar steht,
 * liesse eine Erhaltungspruefung FALSCH bestehen.
 *
 * Nicht nestend, wie in der Migration: Pruefung 103 belegt, dass kein
 * Stringliteral im Rumpf einen Kommentarstarter traegt, und damit ist das
 * einfache Entfernen tragfaehig.
 */
code as (
  select regexp_replace(
           regexp_replace(d.d, '/\*.*?\*/', '', 'g'),
           '--.*', '', 'gn') as d
    from def d
),
pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die elf neuen Felder
  -- =====================================================================
  (101, '0124', 'alle elf neuen Schluessel stehen im Seitenobjekt',
        ((select count(*) from (values
            ('''status_known'''), ('''has_sender_name'''), ('''has_sender_street'''),
            ('''has_sender_postal_code'''), ('''has_sender_city'''), ('''has_origin'''),
            ('''has_agreement'''), ('''receipt_number'''), ('''receipt_issued_at'''),
            ('''receipt_revision'''), ('''receipt_stale''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '11'),
  (102, '0124', 'status_known ist fest true — der Marker, nicht eine Spalte',
        (position('''status_known'', true' in (select d from code)) > 0)::text, 'true'),

  /*
   * DIE WACHE UNTER DEM KOMMENTAR-STRIPPEN.
   *
   * Das einfache Entfernen ist nur tragfaehig, solange kein Stringliteral im
   * Rumpf einen Kommentarstarter traegt — sonst reisst es echten Code mit,
   * und zwar in beide Richtungen. Die Migration prueft das vor dem Strippen
   * und bricht sonst ab; hier ist es eine Pruefzeile mit derselben Aussage.
   */
  (103, '0124', 'kein Stringliteral im Rumpf traegt einen Kommentarstarter',
        ((select count(*) from def d, regexp_matches(d.d, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
           where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%'))::text, '0'),
  /*
   * DIE WICHTIGSTE ZEILE DIESES POSTFLIGHTS.
   *
   * Geprueft wird die Form, in der ein WERT projiziert wuerde: Schluessel in
   * Anfuehrungszeichen, Komma, `m.`. `'has_sender_name',` trifft dieses
   * Muster nicht, `'sender_name', m.sender_name` schon.
   */
  (110, '0124', 'KEIN Absenderwert und keine Anschrift in der Uebersicht',
        ((select count(*) from (values
            ('''sender_name'', m.'), ('''sender_street'', m.'),
            ('''sender_postal_code'', m.'), ('''sender_city'', m.'),
            ('''sender_country'', m.'), ('''agreement_note'', m.'),
            ('''listing_details'', m.')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),
  (111, '0124', 'und der Fingerabdruck selbst landet nicht im Ergebnis',
        ((select count(*) from (values ('''content_fingerprint'''),
                                       ('''receipt_fingerprint''')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '0'),

  /*
   * DER VERGLEICH LAEUFT UEBER DIE SCHUTZHUELLE, NICHT DIREKT.
   *
   * Das ist der Unterschied zwischen „zwei Spalten unbekannt" und „Orderbuch
   * leer": wirft der Fingerabdruck, faengt die Huelle es und gibt NULL
   * zurueck. Ein direkter Aufruf wuerde die Ausnahme durch den Ledger
   * durchlassen, der RPC schluege fehl, und `fetchLedger` machte daraus eine
   * leere Seite.
   */
  (120, '0124', 'der Vergleich ruft die Schutzhuelle purchase_receipt_stale',
        (position('public.purchase_receipt_stale(m.id, m.receipt_fingerprint)'
          in (select d from code)) > 0)::text, 'true'),
  (121, '0124', 'und laeuft nur fuer Zeilen MIT Beleg',
        (position('case when m.receipt_id is null then null' in (select d from code)) > 0)::text,
        'true'),
  (122, '0124', 'der Beleg ist der am Ende der Korrekturkette',
        (position('where s.supersedes_id = r.id' in (select d from code)) > 0)::text, 'true'),
  (123, '0124', 'und wird per left join geholt — eine Zeile ohne Beleg bleibt eine Zeile',
        (position('left join lateral' in (select d from code)) > 0)::text, 'true'),
  (124, '0124', 'der Ledger legt KEINE eigene Hashfunktion an',
        (position('sha256(' in (select d from code)) = 0)::text, 'true'),
  (126, '0124', 'und ruft den Fingerabdruck NICHT direkt (kommentarfrei geprueft)',
        (position('purchase_receipt_fingerprint' in (select d from code)) = 0)::text, 'true'),

  -- =====================================================================
  -- 13x  Die Schutzhuelle purchase_receipt_stale
  -- =====================================================================
  (130, 'Huelle', 'purchase_receipt_stale(bigint, text) vorhanden',
        (to_regprocedure('public.purchase_receipt_stale(bigint, text)') is not null)::text,
        'true'),
  (131, 'Huelle', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_stale'))::text, '1'),
  (132, 'Huelle', 'stable — sonst duerfte der stable Ledger sie nicht rufen',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_stale'), '(fehlt)'))::text, 's'),
  /*
   * SEARCH_PATH: PRAEFIX FUER DIE EXISTENZ, WERT FUER DIE LEERHEIT.
   *
   * Hier stand ein exakter Vergleich gegen 'true / search_path='. Falsch:
   * PostgreSQL legt den leeren search_path als ZITIERTES Listenelement ab,
   * also `search_path=""` (Staging-Befunde 106 und 204 zum 0124-Preflight).
   * `0112` und `0113` machen es seit langem mit einem Praefixvergleich
   * richtig. Der allein liesse `search_path=public` durch, deshalb drei
   * Zeilen statt einer.
   */
  (133, 'Huelle', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_stale'), '(fehlt)'))::text,
        'true'),
  (134, 'Huelle', 'Rueckgabetyp boolean — damit NULL moeglich ist',
        (coalesce(pg_get_function_result(
          to_regprocedure('public.purchase_receipt_stale(bigint, text)')), '(fehlt)'))::text,
        'boolean'),
  (135, 'Huelle', 'sie hat einen Ausnahmezweig',
        (position('when others then' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_stale'), '')) > 0)::text, 'true'),
  (136, 'Huelle', 'und gibt darin NULL zurueck, nicht true und nicht false',
        ((select count(*) from (values ('return null'), ('return true'), ('return false')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_stale'), '')) > 0))::text, '1'),
  (137, 'Huelle', 'sie RUFT den Fingerabdruck und ersetzt ihn nicht',
        (position('public.purchase_receipt_fingerprint(p_purchase_id)'
          in coalesce((select p.prosrc from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_stale'), '')) > 0)::text, 'true'),
  (138, 'Huelle', 'und bildet keinen eigenen Hash',
        (position('sha256' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_stale'), '')) = 0)::text, 'true'),
  /*
   * RECHTE: KEINE, FUER NIEMANDEN — UND `public` IST KEINE ROLLE.
   *
   * `has_function_privilege('public', ...)` wuerde mit
   * `role "public" does not exist` abbrechen: `public` ist ein
   * Pseudo-Empfaenger im ACL (`grantee = 0`), kein Eintrag in `pg_roles`.
   *
   * Und ein NULL-ACL heisst NICHT „keine Rechte", sondern „Standardrechte" —
   * und der Standard fuer eine Funktion ist EXECUTE fuer PUBLIC. Erst das
   * `revoke` materialisiert den ACL. Ein fehlender ACL ist also genau der
   * Zustand, den diese Pruefung verhindern soll.
   */
  (139, 'Huelle', 'sie hat einen materialisierten ACL (NULL waere PUBLIC)',
        ((select (p.proacl is not null)::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_receipt_stale'))::text, 'true'),
  /*
   * EIGENTUEMER UND service_role SIND ERLAUBT, ALLES ANDERE NICHT.
   *
   * Hier stand `a.grantee <> p.proowner` allein, erwartet 0 — und der Lauf
   * fand 1. Das war KEIN Rechtefehler: Supabase richtet im Schema `public`
   * Default-Privileges fuer `anon`, `authenticated` und `service_role` ein,
   * das `revoke` in `0124` nimmt die ersten beiden zurueck, und
   * `service_role` BLEIBT — ausdrueckliche Entscheidung (ADR-0125), dieselbe
   * wie bei `purchase_market_value` und beim Fingerabdruck. Die Migration
   * toleriert das in ihrer eigenen Nachbedingung; diese Datei war strenger
   * als die Migration, die sie pruefen soll.
   *
   * ABGESCHWAECHT WIRD DAMIT NICHTS. `a.grantee = 0` ist PUBLIC und bleibt in
   * jedem Fall ein Verstoss; 141 und 142 pruefen `anon` und `authenticated`
   * einzeln weiter; 151 nennt die Empfaenger im Klartext, damit die Annahme
   * „die 1 war service_role" am Datum haengt und nicht am Vertrauen; und 152
   * nagelt die Anzahl auf zwei fest. Verglichen wird der Rollenname, nicht
   * die OID, damit die Pruefung auch auf einer Datenbank ohne `service_role`
   * laeuft.
   */
  (140, 'Huelle', 'EXECUTE nur an Eigentuemer und service_role',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_receipt_stale'
             and a.privilege_type = 'EXECUTE'
             and a.grantee <> p.proowner
             and (a.grantee = 0
                  or a.grantee::regrole::text <> 'service_role')))::text, '0'),
  (141, 'Huelle', 'anon darf sie NICHT ausfuehren',
        (has_function_privilege('anon', 'public.purchase_receipt_stale(bigint, text)',
          'EXECUTE'))::text, 'false'),
  (142, 'Huelle', 'authenticated darf sie NICHT ausfuehren',
        (has_function_privilege('authenticated', 'public.purchase_receipt_stale(bigint, text)',
          'EXECUTE'))::text, 'false'),
  /*
   * DER EIGENTUEMERKONTEXT, UND WARUM ER HIER ZAEHLT.
   *
   * Eine `security definer`-Kette traegt nur, solange der Rufer Eigentuemer
   * des Gerufenen ist — ein Eigentuemer hat auf seine eigenen Funktionen
   * implizit jedes Recht, und genau darauf ruht es, dass die Huelle ohne ein
   * einziges `grant` erreichbar ist. Haetten Ledger und Huelle verschiedene
   * Eigentuemer, braeuchte es ein ausdrueckliches EXECUTE, und das soll es
   * nicht geben.
   */
  (143, 'Huelle', 'Ledger, Huelle und Fingerabdruck haben EINEN Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_orderbook_ledger', 'purchase_receipt_stale',
                               'purchase_receipt_fingerprint')))::text, '1'),
  (144, 'Huelle', 'Info: wer ist dieser Eigentuemer',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_stale'), '(fehlt)'))::text, null),

  -- =====================================================================
  -- 2xx  Signatur, Rechte, Eigenschaften — alles wie vorher
  -- =====================================================================
  (145, 'Huelle', 'sie hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'purchase_receipt_stale'
                    and c like 'search\_path=%'))::text, 'true'),
  (146, 'Huelle', 'und der search_path ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_stale'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (149, 'Huelle', 'PUBLIC hat kein EXECUTE',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'purchase_receipt_stale'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee = 0))::text, 'true'),
  (150, 'Huelle', 'service_role darf sie ausfuehren — gewollt, siehe ADR-0125',
        (has_function_privilege('service_role',
          'public.purchase_receipt_stale(bigint, text)', 'EXECUTE'))::text, 'true'),
  (151, 'Huelle', 'Info: alle EXECUTE-Empfaenger im Klartext',
        (coalesce((select string_agg(
                     case when a.grantee = 0 then 'PUBLIC'
                          else a.grantee::regrole::text end, ', '
                     order by case when a.grantee = 0 then 'PUBLIC'
                                   else a.grantee::regrole::text end)
                     from pg_proc p, aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_stale'
                      and a.privilege_type = 'EXECUTE'), '(keine)'))::text, null),
  (152, 'Huelle', 'und es sind genau ZWEI: Eigentuemer + service_role',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_receipt_stale'
             and a.privilege_type = 'EXECUTE'))::text, '2'),
  (201, 'Ledger', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_orderbook_ledger'))::text, '1'),
  /*
   * TYPBASIERT, NICHT TEXTBASIERT.
   *
   * Hier stand `pg_get_function_identity_arguments` gegen
   * 'integer, integer, text, boolean, text'. Diese Funktion druckt aber die
   * PARAMETERNAMEN mit — ihre Ausgabe soll in `ALTER FUNCTION` einsetzbar
   * sein, und dort sind Namen erlaubt. Der Lauf meldete deshalb
   * 'p_year integer, p_month integer, ...', obwohl die Typen stimmten;
   * derselbe Befund wie 102 im Preflight.
   *
   * Auch kein Array-Text: `proargtypes` ist ein nullbasierter `oidvector`,
   * und `::oid[]::regtype[]::text` liefert '[0:4]={...}' mit expliziten
   * Dimensionsgrenzen (so ist der 0125-Postflight gescheitert). Jetzt wird
   * jede Position als OID gegen OID geprueft — Anzahl UND Reihenfolge
   * festgenagelt, ohne jede Formatierungsannahme.
   */
  (202, 'Ledger', 'genau FUENF Argumente, in dieser Reihenfolge (typbasiert)',
        (coalesce((select (p.pronargs = 5
                           and p.proargtypes[0]::regtype = 'integer'::regtype
                           and p.proargtypes[1]::regtype = 'integer'::regtype
                           and p.proargtypes[2]::regtype = 'text'::regtype
                           and p.proargtypes[3]::regtype = 'boolean'::regtype
                           and p.proargtypes[4]::regtype = 'text'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 'true'),
  (203, 'Ledger', 'Rueckgabetyp unveraendert',
        (coalesce(pg_get_function_result(to_regprocedure(
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)')),
          '(fehlt)'))::text, 'jsonb'),
  (204, 'Ledger', 'weiterhin stable — und damit lesend',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 's'),
  (205, 'Ledger', 'weiterhin security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text,
        'true'),
  (206, 'Ledger', 'alle fuenf Argumente haben weiterhin Standardwerte',
        (coalesce((select p.pronargdefaults::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, '5'),
  (207, 'Ledger', 'anon darf NICHT ausfuehren',
        (has_function_privilege('anon',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'false'),
  (208, 'Ledger', 'authenticated darf ausfuehren',
        (has_function_privilege('authenticated',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'true'),
  (209, 'Ledger', 'das Betreiber-Tor steht als erste Anweisung im Rumpf',
        (position('can_operate_active_seller()' in (select d from code)) > 0)::text, 'true'),
  (215, 'Ledger', 'Info: die Signatur im Klartext, mit Parameternamen',
        (coalesce(pg_get_function_identity_arguments(to_regprocedure(
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)')),
          '(fehlt)'))::text, null),
  (219, 'Ledger', 'er hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'seller_orderbook_ledger'
                    and c like 'search\_path=%'))::text, 'true'),
  (220, 'Ledger', 'und der search_path ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),

  -- =====================================================================
  -- 3xx  Der Rumpf aus 0119 — dieselben siebzehn Marker wie Preflight 120
  -- =====================================================================
  /*
   * `i.raw_name ilike` OHNE fuehrendes `or `: der Rohnamen-Vergleich ist das
   * ERSTE Glied der Oder-Kette und hat deshalb kein `or ` davor (`0119`,
   * Rumpfzeile 153). Die lange Form war Staging-Befund 120 im Preflight.
   *
   * Der Hinweis stand bis hierher INNERHALB des VALUES-Tupels, zwischen
   * Klammer und Literal. Legal, aber keine Maschine liest die Liste dann
   * noch als Liste — mein eigener Pruefskript zaehlte 16 statt 17.
   */
  (301, 'Rumpf', 'alle siebzehn Marker aus 0119 stehen noch da',
        ((select count(*) from (values
            ('p_undated'), ('unknown orderbook status filter'),
            ('v_num := replace('), ('as damaged_items'), ('as missing_items'),
            ('as showcase_items'), ('as open_items'), ('as settled_items'),
            ('as is_incomplete'), ('as is_open'),
            ('public.purchase_market_value(p.id) v'),
            ('s.display_name_override ilike'), ('i.raw_name ilike'),
            ('order by m.purchased_at desc nulls last'),
            ('m.daily_index desc nulls last'),
            ('count(*) filter (where not r.is_test)'),
            ('round(sum(m.total_cost) / sum(m.known_value), 4)')
          ) t(marker)
          where position(t.marker in (select d from code)) > 0))::text, '17'),
  (302, 'Rumpf', 'und die alte coalesce-Kette ist NICHT zurueckgekehrt',
        (position('coalesce(s.name, i.raw_name, i.sky_id)' in (select d from code)) = 0)::text,
        'true'),
  (303, 'Rumpf', 'die vier Suchzweige der Positionssuche sind vollstaendig',
        ((select count(*) from (values ('i.raw_name ilike'), ('s.name     ilike'),
            ('s.display_name_override ilike'), ('i.sky_id   ilike'),
            ('se.label   ilike')) t(k)
           where position(t.k in (select d from code)) > 0))::text, '5'),

  -- =====================================================================
  -- 4xx  Die Fingerabdruck-Funktion ist NICHT angefasst worden
  -- =====================================================================
  (401, 'Fingerprint', 'weiterhin genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_fingerprint'))::text, '1'),
  (402, 'Fingerprint', 'weiterhin stable',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text, 's'),
  (403, 'Fingerprint', 'anon darf sie weiterhin NICHT ausfuehren',
        (has_function_privilege('anon', 'public.purchase_receipt_fingerprint(bigint)',
          'EXECUTE'))::text, 'false'),
  (404, 'Fingerprint', 'authenticated auch nicht — 0124 vergibt kein neues Recht',
        (has_function_privilege('authenticated', 'public.purchase_receipt_fingerprint(bigint)',
          'EXECUTE'))::text, 'false'),
  (405, 'Fingerprint', 'schliesst state weiterhin aus',
        (position('''state''' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (406, 'Fingerprint', 'und enthaelt weiterhin die neun Felder aus 0121',
        ((select count(*) from (values ('''sender_name'''), ('''sender_street'''),
            ('''sender_postal_code'''), ('''sender_city'''), ('''sender_country'''),
            ('''listing_title'''), ('''listing_url'''), ('''listing_details'''),
            ('''agreement_note''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '9'),

  -- =====================================================================
  -- 5xx  Die Belegtabellen sind unberuehrt
  -- =====================================================================
  (501, '0122', 'alle drei Belegtabellen da',
        ((select count(*) from (values ('purchase_receipts'), ('purchase_receipt_counters'),
                                       ('purchase_receipt_downloads')) t(n)
           where to_regclass('public.' || t.n) is not null))::text, '3'),
  (502, '0122', 'RLS auf allen drei weiterhin an',
        ((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relrowsecurity
             and c.relname in ('purchase_receipts', 'purchase_receipt_counters',
                               'purchase_receipt_downloads')))::text, '3'),
  (503, '0122', 'beide Unveraenderlichkeits-Trigger weiterhin da',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (504, '0122', 'authenticated hat auf keiner der drei ein Tabellenrecht',
        ((select count(*) from (values ('purchase_receipts'), ('purchase_receipt_counters'),
                                       ('purchase_receipt_downloads')) t(n)
           where has_table_privilege('authenticated', 'public.' || t.n, 'SELECT')
              or has_table_privilege('authenticated', 'public.' || t.n, 'INSERT')
              or has_table_privilege('authenticated', 'public.' || t.n, 'UPDATE')
              or has_table_privilege('authenticated', 'public.' || t.n, 'DELETE')))::text, '0'),

  -- =====================================================================
  -- 9xx  Bestand: Zahl fuer Zahl gegen den Preflight halten
  -- =====================================================================
  (901, 'Bestand', 'Einkaeufe (purchases)',
        ((select count(*) from public.purchases))::text, null),
  (902, 'Bestand', 'Einkaufspositionen (purchase_items)',
        ((select count(*) from public.purchase_items))::text, null),
  (903, 'Bestand', 'davon mit Kaufdatum',
        ((select count(*) from public.purchases where purchased_at is not null))::text, null),
  (904, 'Bestand', 'davon ohne Kaufdatum (bleiben erhalten)',
        ((select count(*) from public.purchases where purchased_at is null))::text, null),
  (905, 'Bestand', 'Testeinkaeufe',
        ((select count(*) from public.purchases where is_test))::text, null),
  (906, 'Bestand', 'Summe total_cost',
        (coalesce((select sum(total_cost) from public.purchases), 0))::text, null),
  (907, 'Bestand', 'ausgestellte Eigenbelege',
        ((select count(*) from public.purchase_receipts))::text, null),
  (908, 'Bestand', 'davon in Format 1 / Format 2',
        ((select (count(*) filter (where format_version = 1))::text || ' / '
                 || (count(*) filter (where format_version = 2))::text
            from public.purchase_receipts))::text, null),
  (909, 'Bestand', 'Einkaeufe MIT Absendername',
        ((select count(*) from public.purchases
           where nullif(btrim(coalesce(sender_name, '')), '') is not null))::text, null),
  (910, 'Bestand', 'Einkaeufe mit vollstaendiger Absenderanschrift',
        ((select count(*) from public.purchases
           where nullif(btrim(coalesce(sender_street, '')), '') is not null
             and nullif(btrim(coalesce(sender_postal_code, '')), '') is not null
             and nullif(btrim(coalesce(sender_city, '')), '') is not null))::text, null),
  (911, 'Bestand', 'Positionen je Zustand: booked / nicht booked',
        ((select (count(*) filter (where state = 'booked'))::text || ' / '
                 || (count(*) filter (where state <> 'booked'))::text
            from public.purchase_items))::text, null),
  (912, 'Bestand', 'Lagerbewegungen',
        ((select count(*) from public.inventory_movements))::text, null),
  (913, 'Bestand', 'Lagerzeilen / Summe Menge',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),

  /*
   * UND DIESELBE FINGERABDRUCK-RECHNUNG WIE IM PREFLIGHT.
   *
   * Sie muss dasselbe Ergebnis liefern — `0124` aendert weder einen Beleg noch
   * einen Einkauf. Weicht sie ab, hat zwischen den beiden Laeufen jemand an
   * belegrelevanten Daten gearbeitet, und DAS ist zu klaeren, bevor die
   * Spalte gedeutet wird.
   */
  (921, 'Beleg', 'Belege, deren Fingerabdruck ABWEICHT (zeigt orange)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 is distinct from public.purchase_receipt_fingerprint(r.purchase_id)))::text,
        null),
  (922, 'Beleg', 'Belege, deren Fingerabdruck STIMMT (zeigt gruen)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (923, 'Beleg', 'Belege, fuer die der Vergleich NULL ergibt (zeigt unbekannt)',
        ((select count(*) from public.purchase_receipts r
           where public.purchase_receipt_fingerprint(r.purchase_id) is null))::text, '0'),
  (924, 'Beleg', 'Einkaufs-IDs mit Beleg, aufsteigend',
        (coalesce((select string_agg(r.purchase_id::text, ',' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (992, 'Invariante', 'Positionen mit Sonderzustand UND Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state in ('damaged', 'missing', 'showcase', 'settled')
             and movement_id is not null))::text, '0'),
  (993, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0')
),

ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)

select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
order by nr;
