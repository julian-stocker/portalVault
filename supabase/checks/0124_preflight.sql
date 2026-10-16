-- ===========================================================================
-- STAGING-PREFLIGHT fuer Migration 0124
--
-- NUR LESEN. Ein einziges SELECT. Keine DO-Bloecke, kein DDL, kein DML, kein
-- Schema-Reload, KEIN Aufruf von seller_orderbook_ledger. Das Statement liest
-- Systemkataloge und bildet Aggregate; es gibt Zahlen und Wahrheitswerte
-- zurueck, keine Namen, keine Anschriften, keine Notizen.
--
-- ---------------------------------------------------------------------------
-- WARUM DER LEDGER HIER NICHT AUFGERUFEN WIRD
--
-- `seller_orderbook_ledger` fragt als erste Anweisung
-- `can_operate_active_seller()`, und das ist
-- `exists(... where o.user_id = (select auth.uid()) ...)`. Im SQL-Editor gibt
-- es kein JWT, `auth.uid()` ist NULL, das Tor ist zu — der Aufruf wuerde mit
-- `seller operator role required` abbrechen.
--
-- Die Ausgabe des Ledgers nimmt deshalb `0124_baseline.sql` auf. Sie stellt
-- die Sitzung dafuer in EINER Transaktion auf den Betreiber und rollt sie
-- zurueck.
--
-- ---------------------------------------------------------------------------
-- ABLESEN
--
--   ok = true    Bedingung erfuellt
--   ok = false   BLOCKIEREND. Nicht migrieren, bis geklaert ist, warum.
--   ok = null    Zahl zum Vergleich, kein Urteil
--
-- Die letzte Zeile (nr = 9999) muss 0 zeigen.
--
-- REIHENFOLGE: `0125` ZUERST, DANN `0124`.
--
-- Pruefung 206 verlangt, dass `authenticated` den internen Fingerabdruck
-- nicht ausfuehren darf. Das wird erst mit `0125` wahr. Laeuft dieser
-- Preflight vorher, bleibt 206 rot — zu Recht.
--
-- DIE 9xx-ZEILEN SIND DIE EINGANGSSEITIGE BASELINE. Der Postflight (`0124_postflight.sql`)
-- vergleicht gegen genau diese Zahlen; `0124` darf keine davon bewegen.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  seller_orderbook_ledger — Signatur, Rechte, Definition
  -- =====================================================================
  (101, 'Ledger', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_orderbook_ledger'))::text, '1'),
  /*
   * DIE SIGNATUR WIRD AUFGELOEST, NICHT ALS TEXT VERGLICHEN.
   *
   * Hier stand `pg_get_function_identity_arguments` gegen
   * 'integer, integer, text, boolean, text'. Diese Funktion druckt aber die
   * PARAMETERNAMEN mit — ihre Ausgabe soll in `ALTER FUNCTION` einsetzbar
   * sein, und dort sind Namen erlaubt. Auf Staging kam deshalb
   * 'p_year integer, p_month integer, ...' zurueck, und die Pruefung schlug
   * fehl, obwohl die Signatur stimmte.
   *
   * `to_regprocedure` loest nur auf, wenn eine Funktion mit GENAU diesen
   * Argumenttypen existiert; zusammen mit 101 ("genau eine Overload") ist die
   * Signatur damit festgenagelt, ohne eine Zeichenkette aus dem Katalog zu
   * vergleichen. 115 nennt die Typen zusaetzlich als Array — auch das ohne
   * jede Formatierungsannahme.
   */
  (102, 'Ledger', 'genau diese Signatur ist aufloesbar',
        (to_regprocedure('public.seller_orderbook_ledger('
          || 'integer, integer, text, boolean, text)') is not null)::text, 'true'),
  (103, 'Ledger', 'Rueckgabetyp jsonb',
        (coalesce(pg_get_function_result(
          to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '(fehlt)'))::text, 'jsonb'),
  (104, 'Ledger', 'stable — und bleibt es',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 's'),
  (105, 'Ledger', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, 'true'),
  /*
   * SEARCH_PATH: PRAEFIX FUER DIE EXISTENZ, WERT FUER DIE LEERHEIT.
   *
   * Hier stand ein exakter Vergleich gegen 'search_path='. Falsch: PostgreSQL
   * legt den leeren search_path als ZITIERTES Listenelement ab, also
   * `search_path=""`. Auf Staging war das Befund 106 — der search_path IST
   * leer und wirksam, nur der Vergleichsstring war falsch.
   *
   * `0112` und `0113` machen es seit langem richtig, mit einem
   * Praefixvergleich. Der allein wuerde allerdings auch `search_path=public`
   * durchlassen, deshalb zwei Zeilen: 106 prueft, DASS eine Festlegung da
   * ist, 117 prueft, dass ihr Wert leer ist.
   */
  (106, 'Ledger', 'hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'seller_orderbook_ledger'
                    and c like 'search\_path=%'))::text, 'true'),
  (107, 'Ledger', 'alle fuenf Argumente haben Standardwerte',
        (coalesce((select p.pronargdefaults::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text, '5'),
  (108, 'Ledger', 'anon darf NICHT ausfuehren',
        (has_function_privilege('anon',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'false'),
  (109, 'Ledger', 'authenticated darf ausfuehren',
        (has_function_privilege('authenticated',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'true'),
  (110, 'Ledger', 'liegt in der 0119-Fassung vor (Anzeigename aufgeloest)',
        (position('coalesce(s.display_name_override, s.name,' in coalesce(
          pg_get_functiondef(to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '')) > 0)::text, 'true'),
  (111, 'Ledger', '0124 noch NICHT angewendet (status_known fehlt)',
        (position('status_known' in coalesce(
          pg_get_functiondef(to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '')) = 0)::text, 'true'),
  (112, 'Ledger', 'und traegt noch kein receipt_stale',
        (position('receipt_stale' in coalesce(
          pg_get_functiondef(to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '')) = 0)::text, 'true'),
  (113, 'Ledger', 'und ruft den Fingerabdruck noch nicht',
        (position('purchase_receipt_fingerprint' in coalesce(
          pg_get_functiondef(to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '')) = 0)::text, 'true'),
  /*
   * DIE SCHUTZHUELLE GIBT ES NOCH NICHT — `0124` legt sie an.
   *
   * Steht sie schon da, ist `0124` ganz oder teilweise gelaufen, und dann ist
   * die Baseline aus Datei 2 keine Baseline mehr, sondern eine Messung des
   * Nachzustands.
   */
  (114, 'Huelle', 'purchase_receipt_stale existiert noch NICHT',
        (to_regprocedure('public.purchase_receipt_stale(bigint, text)') is null)::text, 'true'),

  /*
   * TYPBASIERT, NICHT TEXTBASIERT.
   *
   * Hier stand `(p.proargtypes::oid[]::regtype[])::text` gegen
   * '{integer,integer,text,boolean,text}'. Auf Staging kam
   *
   *     [0:4]={integer,integer,text,boolean,text}
   *
   * zurueck: `proargtypes` ist ein `oidvector` und NULLBASIERT, der Cast nach
   * `oid[]` behaelt die untere Grenze 0, und PostgreSQL stellt ein Array mit
   * einer unteren Grenze ungleich 1 MIT expliziten Dimensionsgrenzen dar. Der
   * Postflight zu `0125` ist mit demselben Ausdruck gescheitert (Pruefung
   * 202, `[0:0]={bigint}`).
   *
   * Es ist die vierte Instanz derselben Fehlerklasse — nach
   * `pg_get_function_identity_arguments` (102) und dem zitierten leeren
   * search_path (106, 204): ein Vergleich gegen eine Darstellung statt gegen
   * die Sache.
   *
   * Jetzt wird nichts formatiert. `pronargs` ist eine Zahl; jede Position
   * wird einzeln als OID gegen OID geprueft, mit Index 0 bis 4, weil
   * `oidvector` nullbasiert ist. Damit sind Anzahl UND Reihenfolge
   * festgenagelt, und jede Position steht lesbar da.
   *
   * Randfall: hat die Funktion weniger als fuenf Argumente, ist `pronargs = 5`
   * falsch, und `false and ...` ist `false` — nicht NULL. Fehlt sie ganz,
   * greift `coalesce` auf '(fehlt)'. Beides blockiert.
   */
  (115, 'Ledger', 'genau FUENF Argumente, in dieser Reihenfolge (typbasiert)',
        (coalesce((select (p.pronargs = 5
                           and p.proargtypes[0]::regtype = 'integer'::regtype
                           and p.proargtypes[1]::regtype = 'integer'::regtype
                           and p.proargtypes[2]::regtype = 'text'::regtype
                           and p.proargtypes[3]::regtype = 'boolean'::regtype
                           and p.proargtypes[4]::regtype = 'text'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'), '(fehlt)'))::text,
        'true'),
  (116, 'Ledger', 'Info: die Signatur im Klartext, mit Parameternamen',
        (coalesce(pg_get_function_arguments(
          to_regprocedure('public.seller_orderbook_ledger('
            || 'integer, integer, text, boolean, text)')), '(fehlt)'))::text, null),
  (117, 'Ledger', 'und der search_path ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_orderbook_ledger'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),

  /*
   * DIE MARKER, DIE 0124 NICHT VERLIEREN DARF.
   *
   * Jeder davon steht heute im Rumpf. Der Postflight prueft dieselbe Liste
   * noch einmal — das ist der Nachweis, dass die Ersetzung den Rumpf aus
   * `0119` uebernommen und nicht neu geschrieben hat.
   */
  (120, 'Ledger', 'Marker im Rumpf, die erhalten bleiben muessen',
        ((select count(*) from (values
            ('p_undated'), ('unknown orderbook status filter'),
            ('v_num := replace('), ('as damaged_items'), ('as missing_items'),
            ('as showcase_items'), ('as open_items'), ('as settled_items'),
            ('as is_incomplete'), ('as is_open'),
            ('public.purchase_market_value(p.id) v'),
            /*
             * 'i.raw_name ilike' OHNE das fuehrende 'or '.
             *
             * Hier stand 'or i.raw_name ilike' — und genau das war Befund 120
             * auf Staging: 16 von 17. Der Rohnamen-Vergleich ist das ERSTE
             * Glied der Oder-Kette und hat deshalb kein 'or ' davor
             * (`0119`, Rumpfzeile 153: `and (i.raw_name ilike '%' || v_q`).
             * `0119` wusste das und prueft eine Disjunktion; ich hatte nur
             * deren erste Haelfte in eine flache Liste kopiert und damit aus
             * einem Oder ein Und gemacht. Die kurze Form trifft beide
             * Schreibweisen.
             */
            ('s.display_name_override ilike'), ('i.raw_name ilike'),
            ('order by m.purchased_at desc nulls last'),
            ('m.daily_index desc nulls last'),
            ('count(*) filter (where not r.is_test)'),
            ('round(sum(m.total_cost) / sum(m.known_value), 4)')
          ) t(marker)
          where position(t.marker in coalesce(
            pg_get_functiondef(to_regprocedure('public.seller_orderbook_ledger('
              || 'integer, integer, text, boolean, text)')), '')) > 0))::text, '17'),

  -- =====================================================================
  -- 2xx  purchase_receipt_fingerprint — die Voraussetzung des Vergleichs
  -- =====================================================================
  (201, 'Fingerprint', 'purchase_receipt_fingerprint(bigint) vorhanden',
        (to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is not null)::text,
        'true'),
  (202, 'Fingerprint', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_fingerprint'))::text, '1'),
  (203, 'Fingerprint', 'stable — sonst duerfte der stable Ledger sie nicht rufen',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text, 's'),
  (204, 'Fingerprint', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  (205, 'Fingerprint', 'anon darf sie NICHT ausfuehren',
        (has_function_privilege('anon', 'public.purchase_receipt_fingerprint(bigint)',
          'EXECUTE'))::text, 'false'),
  /*
   * DIESE ZEILE SETZT `0125` VORAUS.
   *
   * Beim ersten Staging-Preflight stand hier `true`, und das war der Befund,
   * aus dem `0125` entstanden ist: `0122` entzieht nur `public, anon`, waehrend
   * Supabase Default-Privileges fuer `anon`, `authenticated` und
   * `service_role` einrichtet. `authenticated` ist also durchgerutscht.
   *
   * `0125` entzieht genau dieses eine Recht. Steht hier noch `true`, ist
   * `0125` nicht angewendet — dann zuerst `0125`, dann dieser Preflight.
   * REIHENFOLGE: 0125 vor 0124.
   */
  (206, 'Fingerprint', 'authenticated darf sie NICHT ausfuehren (setzt 0125 voraus)',
        (has_function_privilege('authenticated', 'public.purchase_receipt_fingerprint(bigint)',
          'EXECUTE'))::text, 'false'),
  (207, 'Fingerprint', 'sie bildet den Hash mit dem eingebauten sha256',
        (position('sha256(' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) > 0)::text, 'true'),
  (208, 'Fingerprint', 'und schliesst den Buchungszustand state ausdruecklich aus',
        (position('''state''' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'purchase_receipt_fingerprint'), '')) = 0)::text, 'true'),
  (209, 'Fingerprint', 'ebenso note, is_test, source, daily_index, client_token',
        ((select count(*) from (values ('''note'''), ('''is_test'''), ('''source'''),
                                       ('''daily_index'''), ('''client_token''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '0'),
  (210, 'Fingerprint', 'und enthaelt die neun Felder aus 0121',
        ((select count(*) from (values ('''sender_name'''), ('''sender_street'''),
            ('''sender_postal_code'''), ('''sender_city'''), ('''sender_country'''),
            ('''listing_title'''), ('''listing_url'''), ('''listing_details'''),
            ('''agreement_note''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '9'),
  (211, 'Fingerprint', 'Serverversion traegt sha256 eingebaut (>= PG 11)',
        (current_setting('server_version_num')::int >= 110000)::text, 'true'),
  (212, 'Fingerprint', 'hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'purchase_receipt_fingerprint'
                    and c like 'search\_path=%'))::text, 'true'),
  (213, 'Fingerprint', 'und sie ist LEER',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (214, 'Fingerprint', 'service_role darf sie ausfuehren — gewollt, 0125 laesst das so',
        (has_function_privilege('service_role', 'public.purchase_receipt_fingerprint(bigint)',
          'EXECUTE'))::text, 'true'),
  /*
   * UND SIE HAT KEIN EXECUTE FUER NIEMANDEN AUS DER ANWENDUNG.
   *
   * `0122` entzieht `public` und `anon` und vergibt bewusst KEIN `grant` an
   * `authenticated`: sie ist ein interner Helfer. Dass der Ledger sie trotzdem
   * rufen kann, liegt an `security definer` — er laeuft als Eigentuemer, nicht
   * als Aufrufer. `0124` braucht deshalb keine neue Rechtevergabe, und das ist
   * genau die Eigenschaft, die hier festgehalten wird.
   */

  -- =====================================================================
  -- 3xx  Was 0124 sonst braucht
  -- =====================================================================
  (301, '0122', 'purchase_receipts vorhanden',
        (to_regclass('public.purchase_receipts') is not null)::text, 'true'),
  (302, '0122', 'purchase_receipt_counters vorhanden',
        (to_regclass('public.purchase_receipt_counters') is not null)::text, 'true'),
  (303, '0122', 'purchase_receipt_downloads vorhanden',
        (to_regclass('public.purchase_receipt_downloads') is not null)::text, 'true'),
  (304, '0122', 'der Teilindex gegen zwei Urspruengsbelege je Einkauf',
        (exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'purchase_receipts_origin_uniq'))::text, 'true'),
  (305, '0122', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger t
           where not t.tgisinternal
             and t.tgname in ('purchase_receipts_immutable_trg',
                              'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (306, '0121', 'alle neun Absender- und Inseratsspalten auf purchases',
        ((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'purchases'
             and column_name in ('sender_name', 'sender_street', 'sender_postal_code',
                                 'sender_city', 'sender_country', 'listing_title',
                                 'listing_url', 'listing_details', 'agreement_note')))::text,
        '9'),
  (307, '0123', 'purchase_receipts.format_version vorhanden',
        (exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchase_receipts'
                    and column_name = 'format_version'))::text, 'true'),
  (308, 'Tor',   'can_operate_active_seller() vorhanden',
        (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  /*
   * DAS TOR IST IM SQL-EDITOR ZU, UND DAS IST RICHTIG.
   *
   * `auth.uid()` ist hier NULL. Diese Zeile ist deshalb kein Mangel, sondern
   * die Begruendung dafuer, warum Datei 2 die Sitzung umstellen muss.
   */
  (309, 'Tor',   'Info: ist das Betreiber-Tor in DIESER Sitzung offen?',
        (public.can_operate_active_seller())::text, null),
  (310, 'Tor',   'Info: aktive, freigeschaltete Betreiberkonten',
        ((select count(*) from public.seller_operators o
            join public.sellers s on s.id = o.seller_id
           where s.is_active and o.is_enabled))::text, null),

  -- =====================================================================
  -- 9xx  Eingangsseitige Baseline — der Postflight vergleicht dagegen
  -- =====================================================================
  (900, 'Umgebung', 'Info: Serverversion (Ursache der 106/204-Befunde)',
        (current_setting('server_version'))::text, null),
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
  (906, 'Bestand', 'Summe total_cost (Cent-genau, als Text)',
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
   * UND DER FINGERABDRUCK JEDES AUSGESTELLTEN BELEGS, GEGEN DEN AKTUELLEN
   * STAND — die Zahl, die `0124` nachher als `receipt_stale` zeigen wird.
   *
   * Hier gerechnet, damit der Postflight die Spalte gegen eine VORHER
   * erhobene Wahrheit haelt und nicht gegen sich selbst.
   */
  (921, 'Beleg', 'Belege, deren Fingerabdruck ABWEICHT (kuenftig orange)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 is distinct from public.purchase_receipt_fingerprint(r.purchase_id)))::text,
        null),
  (922, 'Beleg', 'Belege, deren Fingerabdruck STIMMT (kuenftig gruen)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (923, 'Beleg', 'Belege, fuer die der Vergleich NULL ergibt (kuenftig unbekannt)',
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
