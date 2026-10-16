-- ===========================================================================
-- PREFLIGHT fuer Migration 0125  —  Rechte am internen Fingerabdruck
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, kein Funktionsaufruf, der etwas
-- veraendert. Gibt Rollennamen, Eigentuemer und Wahrheitswerte zurueck —
-- keine Einkaufsdaten, keine Personendaten.
--
-- Laeuft auf Staging UND auf Production, weil `0122` auf beiden angewendet
-- ist und der Befund beide betrifft.
--
-- ABLESEN
--   ok = true    Bedingung erfuellt
--   ok = false   BLOCKIEREND
--   ok = null    Information, kein Urteil
--
-- Zeile 9999 muss 0 zeigen.
--
-- ---------------------------------------------------------------------------
-- ZWEI EINGANGSZUSTAENDE SIND ZULAESSIG, UND BEIDE WERDEN BENANNT
--
-- Die erste Fassung dieser Datei verlangte `authenticated = true` als
-- BLOCKIERENDE Bedingung — der unsichere Zustand war Voraussetzung. Das war
-- falsch gedacht: ein bereits sicherer Zustand ist kein Mangel, und eine
-- Pruefung, die ihn rot faerbt, erzieht dazu, rote Zeilen zu uebergehen.
--
-- Pruefung 208 benennt deshalb den gefundenen Zustand, und 207 verlangt, dass
-- er EINER DER BEIDEN BEKANNTEN ist:
--
--   UNSICHER_VOR_0125    anon false · authenticated TRUE  · service_role true
--                        -> der Ausgangsbefund. `0125` entzieht das Recht.
--                           Das ist der Zustand von PRODUCTION.
--
--   SICHER_NACH_REVOKE   anon false · authenticated FALSE · service_role true
--                        -> Zielzustand schon erreicht. `0125` laeuft als
--                           Leerlauf; ihr Wert ist dann die Nachpruefung.
--                           Das ist der Zustand von STAGING, seit das
--                           `revoke` dort am 2026-10-15 von Hand ausgefuehrt
--                           wurde.
--
--   UNERWARTET_*         alles andere. BLOCKIEREND — nicht migrieren, bis
--                        geklaert ist, warum.
--
-- Was in BEIDEN Zustaenden gelten muss, pruefen 201, 202, 204 und 205
-- blockierend: `anon` darf nicht, PUBLIC darf nicht, `service_role` darf, und
-- der ACL ist materialisiert.
-- ===========================================================================

with
/*
 * DIE FUENF RECHTETATSACHEN EINMAL LESEN.
 *
 * Nur fuer die Zustandsklassifikation in 207 und 208 — die Zeilen 201 bis 205
 * lesen weiter unabhaengig aus dem Katalog. Die Doppelung ist Absicht: wuerde
 * dieses CTE etwas falsch zusammenfassen, widersprechen sich die Zeilen, statt
 * gemeinsam zu irren.
 */
rechte as (
  select
    has_function_privilege('anon',
      'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') as anon_darf,
    has_function_privilege('authenticated',
      'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') as auth_darf,
    has_function_privilege('service_role',
      'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') as service_darf,
    exists (select 1 from pg_proc p, aclexplode(p.proacl) a
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'
               and a.privilege_type = 'EXECUTE'
               and a.grantee = 0)                               as public_darf,
    (select p.proacl is not null from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'purchase_receipt_fingerprint')          as acl_da
),

/*
 * DIE REIHENFOLGE DER FAELLE IST DIE AUSSAGE.
 *
 * Die vier UNERWARTET-Faelle stehen VOR der Unterscheidung sicher/unsicher.
 * Ein fehlender ACL oder ein EXECUTE fuer PUBLIC ist kein „noch unsicherer
 * Ausgangszustand", sondern etwas, das niemand hergestellt hat — und das
 * darf nicht als die eine oder andere Normallage durchgehen.
 */
zustand as (
  select case
           when not coalesce(r.acl_da, false) then 'UNERWARTET_KEIN_ACL'
           when r.public_darf                 then 'UNERWARTET_PUBLIC_DARF'
           when r.anon_darf                   then 'UNERWARTET_ANON_DARF'
           when not r.service_darf            then 'UNERWARTET_SERVICE_ROLE_FEHLT'
           when r.auth_darf                   then 'UNSICHER_VOR_0125'
           else                                    'SICHER_NACH_REVOKE'
         end as klasse
    from rechte r
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die Funktion selbst — sie wird NICHT angefasst
  -- =====================================================================
  (101, 'Fingerprint', 'purchase_receipt_fingerprint(bigint) vorhanden',
        (to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is not null)::text,
        'true'),
  (102, 'Fingerprint', 'genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_fingerprint'))::text, '1'),
  (103, 'Fingerprint', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  /*
   * SEARCH_PATH: PRAEFIX FUER DIE EXISTENZ, WERT FUER DIE LEERHEIT.
   *
   * Ein exakter Vergleich gegen 'search_path=' ist falsch — PostgreSQL legt
   * den leeren search_path als ZITIERTES Listenelement ab, also
   * `search_path=""`. Das hat der 0124-Preflight auf Staging gezeigt
   * (Befunde 106 und 204). `0112` und `0113` machen es seit langem richtig
   * mit einem Praefixvergleich; hier dieselbe Form, ergaenzt um die Pruefung,
   * dass der Wert tatsaechlich leer ist und nicht etwa `public`.
   */
  (104, 'Fingerprint', 'hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'purchase_receipt_fingerprint'
                    and c like 'search\_path=%'))::text, 'true'),
  (105, 'Fingerprint', 'und sie ist LEER (Anfuehrungszeichen weggerechnet)',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (106, 'Fingerprint', 'sie hat KEIN Berechtigungstor im Rumpf (der Befund)',
        (coalesce((select (position('can_operate' in p.prosrc) > 0
                           or position('is_admin' in p.prosrc) > 0)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'false'),

  -- =====================================================================
  -- 2xx  Der Eingangszustand der Rechte
  -- =====================================================================
  (201, 'Rechte', 'anon darf NICHT ausfuehren (seit 0122)',
        (has_function_privilege('anon',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'false'),
  (202, 'Rechte', 'PUBLIC hat kein EXECUTE',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'purchase_receipt_fingerprint'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee = 0))::text, 'true'),
  /*
   * 203 IST EINE INFORMATION, KEIN URTEIL — UND DAS IST DER UNTERSCHIED.
   *
   * `true`  = der Ausgangsbefund; `0125` entzieht das Recht.
   * `false` = der Zielzustand ist erreicht; `0125` laeuft als Leerlauf.
   *
   * Hier stand `erwartet = 'true'`, also war der UNSICHERE Zustand
   * Freigabebedingung. Nachdem das `revoke` auf Staging von Hand lief, meldete
   * diese Zeile einen Mangel, wo keiner war. Das Urteil gehoert in 207.
   */
  (203, 'Rechte', 'Info: darf authenticated heute ausfuehren? (true = vor 0125)',
        (has_function_privilege('authenticated',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, null),
  (204, 'Rechte', 'service_role darf ausfuehren und soll es behalten',
        (has_function_privilege('service_role',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'true'),
  (205, 'Rechte', 'der ACL ist materialisiert (NULL waere EXECUTE fuer PUBLIC)',
        (coalesce((select (p.proacl is not null)::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  (206, 'Rechte', 'Info: alle EXECUTE-Empfaenger im Klartext',
        (coalesce((select string_agg(
                     case when a.grantee = 0 then 'PUBLIC'
                          else a.grantee::regrole::text end, ', '
                     order by case when a.grantee = 0 then 'PUBLIC'
                                   else a.grantee::regrole::text end)
                     from pg_proc p, aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'
                      and a.privilege_type = 'EXECUTE'), '(keine)'))::text, null),
  /*
   * DIE EINZIGE BLOCKIERENDE AUSSAGE UEBER DEN RECHTEZUSTAND.
   *
   * Sie laesst beide Normallagen zu und faengt alles andere. Damit ist diese
   * Datei vor UND nach dem Entzug dieselbe Datei — und ein gruener Preflight
   * heisst nicht mehr „der Mangel ist noch da", sondern „der Zustand ist
   * einer, den wir verstehen".
   */
  (207, 'Zustand', 'der Rechtezustand ist einer der beiden bekannten',
        ((select z.klasse from zustand z)
           in ('UNSICHER_VOR_0125', 'SICHER_NACH_REVOKE'))::text, 'true'),
  (208, 'Zustand', 'Info: welcher der beiden — und damit, was 0125 noch tut',
        ((select z.klasse from zustand z))::text, null),
  (209, 'Zustand', 'Info: EXECUTE-Empfaenger gezaehlt (erwartet 2: Eigentuemer + service_role)',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_receipt_fingerprint'
             and a.privilege_type = 'EXECUTE'))::text, null),

  -- =====================================================================
  -- 3xx  Die Eigentuemerkette — sie traegt den Zugriff nach dem Entzug
  -- =====================================================================
  /*
   * NACH `0125` ERREICHEN DIE BELEGFUNKTIONEN DEN FINGERABDRUCK NUR NOCH
   * UEBER IMPLIZITE EIGENTUEMERRECHTE. Gehoerte eine von ihnen einer anderen
   * Rolle, wuerde der Entzug sie kappen. Diese vier Zeilen sind deshalb die
   * eigentliche Freigabebedingung, nicht die Rechtezeilen oben.
   */
  (301, 'Kette', 'alle vier Funktionen haben EINEN Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('purchase_receipt_fingerprint',
                                'seller_purchase_receipt',
                                'seller_issue_purchase_receipt',
                                'seller_orderbook_ledger')))::text, '1'),
  (302, 'Kette', 'Info: wer ist dieser Eigentuemer',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        null),
  (303, 'Kette', 'beide Belegfunktionen sind security definer',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seller_purchase_receipt', 'seller_issue_purchase_receipt')
              and p.prosecdef))::text, '2'),
  (304, 'Kette', 'seller_purchase_receipt ruft den Fingerabdruck',
        (position('purchase_receipt_fingerprint' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_purchase_receipt'), '')) > 0)::text, 'true'),
  (305, 'Kette', 'seller_issue_purchase_receipt ruft den Fingerabdruck',
        (position('purchase_receipt_fingerprint' in coalesce((select p.prosrc from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),
  (306, 'Kette', 'seller_purchase_receipt bleibt fuer authenticated erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_purchase_receipt(bigint)', 'EXECUTE'))::text, 'true'),
  (307, 'Kette', 'seller_issue_purchase_receipt bleibt fuer authenticated erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_issue_purchase_receipt(bigint)', 'EXECUTE'))::text, 'true'),
  (308, 'Kette', 'Info: existiert die 0124-Schutzhuelle schon?',
        (to_regprocedure('public.purchase_receipt_stale(bigint, text)') is not null)::text,
        null),
  (309, 'Kette', 'falls ja, gehoert sie demselben Eigentuemer',
        (coalesce((select (count(distinct p.proowner) = 1)::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('purchase_receipt_fingerprint',
                                        'purchase_receipt_stale')
                   having count(*) = 2), 'true'))::text, 'true'),

  -- =====================================================================
  -- 4xx  Die Hausregel, an die 0125 zurueckfuehrt
  -- =====================================================================
  /*
   * `purchase_market_value(bigint)` ist derselbe Typ interner Helfer und
   * wird in `0053` und `0116` `from public, anon, authenticated` entzogen.
   * Diese drei Zeilen sind der Zielzustand, den `0125` fuer den Fingerabdruck
   * herstellt — gemessen an einer Funktion, die ihn schon hat.
   */
  (401, 'Vorbild', 'purchase_market_value: anon darf nicht',
        (has_function_privilege('anon',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'false'),
  (402, 'Vorbild', 'purchase_market_value: authenticated darf nicht',
        (has_function_privilege('authenticated',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'false'),
  (403, 'Vorbild', 'purchase_market_value: service_role darf',
        (has_function_privilege('service_role',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'true'),

  -- =====================================================================
  -- 9xx  Umgebung und Bestand — 0125 darf keine Zahl bewegen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Eigenbelege',
        ((select count(*) from public.purchase_receipts))::text, null),
  (904, 'Bestand', 'Abrufe von Eigenbelegen',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  /*
   * UND DER FUNKTIONALE NACHWEIS, DASS DIE KETTE HEUTE TRAEGT.
   *
   * Als Eigentuemer der Sitzung (der SQL-Editor laeuft nicht als
   * `authenticated`) ist der Fingerabdruck aufrufbar. Dass dieser Aufruf
   * einen Hash liefert, ist der Vorzustand, gegen den der Postflight prueft:
   * nach `0125` muss er denselben Wert liefern — der Entzug betrifft `wer
   * darf rufen`, nicht `was kommt zurueck`.
   */
  (921, 'Funktion', 'Fingerabdruecke ueber alle Belege rechenbar (keine Ausnahme)',
        ((select count(*) from public.purchase_receipts r
           where public.purchase_receipt_fingerprint(r.purchase_id) is not null))::text,
        null),
  (922, 'Funktion', 'davon stimmig mit dem gespeicherten Wert',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (923, 'Funktion', 'die ersten 16 Zeichen je Beleg — Postflight vergleicht exakt',
        (coalesce((select string_agg(
                     r.purchase_id::text || ':' ||
                     left(public.purchase_receipt_fingerprint(r.purchase_id), 16),
                     ' | ' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null)
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
