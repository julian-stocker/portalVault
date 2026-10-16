-- ===========================================================================
-- POSTFLIGHT fuer Migration 0125  —  nach dem Rechteentzug
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config.
--
-- Zeile 9999 muss 0 zeigen.
--
-- DER ZIELZUSTAND IN EINER ZEILE:
--   anon false · authenticated FALSE · service_role true · PUBLIC kein Recht
--   Eigentuemer unveraendert · Funktionsdefinition unveraendert
--
-- WAS SICH GEGENUEBER DEM PREFLIGHT AENDERN DARF: genau eine Zeile — 203
-- (authenticated) kippt von true auf false. Alles andere muss gleich sein,
-- einschliesslich der Fingerabdruck-Werte aus 921-923.
-- ===========================================================================

with
/*
 * DERSELBE ZUSTANDSBEGRIFF WIE IM PREFLIGHT — HIER ABER MIT EINEM EINZIGEN
 * ZULAESSIGEN WERT.
 *
 * Der Preflight laesst `UNSICHER_VOR_0125` und `SICHER_NACH_REVOKE` zu, weil
 * beides ein verstandener Eingangszustand ist. Der Postflight laesst genau
 * einen zu. Das ist die Arbeitsteilung: vorher einordnen, nachher fordern.
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
  -- 1xx  Das Ziel
  -- =====================================================================
  (101, 'Rechte', 'authenticated darf NICHT mehr ausfuehren',
        (has_function_privilege('authenticated',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'false'),
  (102, 'Rechte', 'anon darf weiterhin nicht',
        (has_function_privilege('anon',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'false'),
  /*
   * PUBLIC WIRD UEBER DEN ACL GEPRUEFT.
   *
   * `has_function_privilege('public', ...)` bricht mit `role "public" does
   * not exist` ab — `public` ist ein Pseudo-Empfaenger (grantee = 0), keine
   * Zeile in `pg_roles`.
   */
  (103, 'Rechte', 'PUBLIC hat kein EXECUTE',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'purchase_receipt_fingerprint'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee = 0))::text, 'true'),
  (104, 'Rechte', 'service_role hat EXECUTE BEHALTEN — ausdruecklich gewollt',
        (has_function_privilege('service_role',
          'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE'))::text, 'true'),
  /*
   * UND DER ACL IST NICHT LEER GEWORDEN.
   *
   * Ein NULL-ACL hiesse `Standardrechte` — fuer eine Funktion also EXECUTE
   * fuer PUBLIC. Ein zu breiter Entzug koennte den ACL theoretisch nicht
   * entfernen, aber die Pruefung kostet nichts und schliesst die gefaehrlichste
   * Verwechslung aus.
   */
  (105, 'Rechte', 'der ACL ist materialisiert',
        (coalesce((select (p.proacl is not null)::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  (106, 'Rechte', 'EXECUTE nur noch an Eigentuemer und service_role',
        (not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname = 'purchase_receipt_fingerprint'
                        and a.privilege_type = 'EXECUTE'
                        and a.grantee <> p.proowner
                        and (a.grantee = 0
                             or a.grantee::regrole::text <> 'service_role')))::text,
        'true'),
  (107, 'Rechte', 'Info: alle EXECUTE-Empfaenger im Klartext',
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
   * DIE STRENGE FASSUNG: GENAU EIN ZULAESSIGER ZUSTAND.
   *
   * Diese Zeile ist die Zusammenfassung von 101 bis 106 in einem Wort. Sie
   * steht zusaetzlich und nicht statt der Einzelzeilen: faellt sie, sagen die
   * Einzelzeilen, woran.
   */
  (108, 'Zustand', 'der Rechtezustand ist GENAU der sichere',
        ((select z.klasse from zustand z))::text, 'SICHER_NACH_REVOKE'),
  (109, 'Zustand', 'und EXECUTE hat genau ZWEI Empfaenger: Eigentuemer + service_role',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'purchase_receipt_fingerprint'
             and a.privilege_type = 'EXECUTE'))::text, '2'),

  -- =====================================================================
  -- 2xx  Die Funktion selbst ist unveraendert
  -- =====================================================================
  (201, 'Fingerprint', 'immer noch genau eine Overload',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'purchase_receipt_fingerprint'))::text, '1'),
  /*
   * TYPBASIERT, NICHT TEXTBASIERT — DIE VIERTE INSTANZ DESSELBEN FEHLERS.
   *
   * Hier stand `(p.proargtypes::oid[]::regtype[])::text` gegen '{bigint}'.
   * `proargtypes` ist ein `oidvector`, und der ist NULLBASIERT. Der Cast nach
   * `oid[]` behaelt die untere Grenze 0, und PostgreSQL stellt ein Array,
   * dessen untere Grenze nicht 1 ist, MIT expliziten Dimensionsgrenzen dar:
   *
   *     [0:0]={bigint}        statt      {bigint}
   *
   * Der Typ war die ganze Zeit richtig; verglichen wurde seine Darstellung.
   * Dasselbe Muster wie bei `pg_get_function_identity_arguments` (Befund 102)
   * und beim zitierten leeren search_path (Befunde 106 und 204).
   *
   * Jetzt wird nichts mehr formatiert. `pronargs` ist eine Zahl, und
   * `proargtypes[0]::regtype = 'bigint'::regtype` vergleicht OID gegen OID —
   * `oidvector` ist nullbasiert, deshalb der Index 0. Beide Haelften zusammen
   * sagen genau das Geforderte: EIN Argument, und das ist bigint.
   *
   * Randfaelle: bei null Argumenten ist `pronargs = 1` falsch und die
   * Verknuepfung damit `false` (nicht NULL); fehlt die Funktion, greift
   * `coalesce` auf '(fehlt)'. Beides blockiert.
   */
  (202, 'Fingerprint', 'genau EIN Argument, und das ist bigint (typbasiert)',
        (coalesce((select (p.pronargs = 1
                           and p.proargtypes[0]::regtype = 'bigint'::regtype)::text
                     from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  (203, 'Fingerprint', 'Rueckgabetyp text',
        (coalesce(pg_get_function_result(
          to_regprocedure('public.purchase_receipt_fingerprint(bigint)')), '(fehlt)'))::text,
        'text'),
  (204, 'Fingerprint', 'stable',
        (coalesce((select p.provolatile::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text, 's'),
  (205, 'Fingerprint', 'security definer',
        (coalesce((select p.prosecdef::text from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'true'),
  (206, 'Fingerprint', 'hat eine search_path-Festlegung',
        (exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'purchase_receipt_fingerprint'
                    and c like 'search\_path=%'))::text, 'true'),
  (207, 'Fingerprint', 'und sie ist LEER',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from pg_proc p,
                          unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'
                      and c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (208, 'Fingerprint', 'language sql, wie in 0122 angelegt',
        (coalesce((select l.lanname from pg_proc p
                     join pg_language l on l.oid = p.prolang
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        'sql'),
  (209, 'Fingerprint', 'der Rumpf bildet weiter sha256 ueber die Belegfelder',
        ((select count(*) from (values ('sha256('), ('''sender_name'''),
            ('''listing_title'''), ('''agreement_note'''), ('''lines''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '5'),
  (210, 'Fingerprint', 'und schliesst state, note, is_test weiter aus',
        ((select count(*) from (values ('''state'''), ('''note'''), ('''is_test''')) t(k)
           where position(t.k in coalesce((select p.prosrc from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname = 'purchase_receipt_fingerprint'), '')) > 0))::text, '0'),

  -- =====================================================================
  -- 3xx  Eigentuemer und Kette unveraendert
  -- =====================================================================
  (301, 'Kette', 'alle vier Funktionen haben weiterhin EINEN Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('purchase_receipt_fingerprint',
                                'seller_purchase_receipt',
                                'seller_issue_purchase_receipt',
                                'seller_orderbook_ledger')))::text, '1'),
  (302, 'Kette', 'Info: wer ist dieser Eigentuemer (Preflight 302 vergleichen)',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'purchase_receipt_fingerprint'), '(fehlt)'))::text,
        null),
  (303, 'Kette', 'beide Belegfunktionen weiterhin security definer',
        ((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seller_purchase_receipt', 'seller_issue_purchase_receipt')
              and p.prosecdef))::text, '2'),
  (304, 'Kette', 'seller_purchase_receipt bleibt fuer authenticated erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_purchase_receipt(bigint)', 'EXECUTE'))::text, 'true'),
  (305, 'Kette', 'seller_issue_purchase_receipt bleibt fuer authenticated erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_issue_purchase_receipt(bigint)', 'EXECUTE'))::text, 'true'),
  (306, 'Kette', 'seller_purchase_receipt_document bleibt erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_purchase_receipt_document(bigint)', 'EXECUTE'))::text, 'true'),
  (307, 'Kette', 'seller_record_purchase_receipt_download bleibt erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_record_purchase_receipt_download(bigint, integer)',
          'EXECUTE'))::text, 'true'),
  (308, 'Kette', 'der Ledger bleibt fuer authenticated erreichbar',
        (has_function_privilege('authenticated',
          'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
          'EXECUTE'))::text, 'true'),

  -- =====================================================================
  -- 4xx  Das Vorbild hat sich nicht bewegt
  -- =====================================================================
  (401, 'Vorbild', 'purchase_market_value: anon false',
        (has_function_privilege('anon',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'false'),
  (402, 'Vorbild', 'purchase_market_value: authenticated false',
        (has_function_privilege('authenticated',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'false'),
  (403, 'Vorbild', 'purchase_market_value: service_role true',
        (has_function_privilege('service_role',
          'public.purchase_market_value(bigint)', 'EXECUTE'))::text, 'true'),

  -- =====================================================================
  -- 9xx  Nichts an den Daten hat sich bewegt
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe (Preflight 902 vergleichen)',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Eigenbelege (Preflight 903 vergleichen)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (904, 'Bestand', 'Abrufe (Preflight 904 vergleichen)',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  /*
   * DER FUNKTIONALE NACHWEIS: DIE FUNKTION RECHNET DASSELBE WIE VORHER.
   *
   * `0125` aendert, WER rufen darf — nicht, WAS zurueckkommt. Stimmen 921
   * bis 923 mit dem Preflight ueberein, ist das bewiesen und nicht vermutet.
   * Weicht 923 ab, hat sich ein Einkauf zwischen den beiden Laeufen geaendert
   * oder die Funktion ist nicht mehr dieselbe — beides gehoert untersucht,
   * bevor weitergearbeitet wird.
   */
  (921, 'Funktion', 'Fingerabdruecke ueber alle Belege rechenbar',
        ((select count(*) from public.purchase_receipts r
           where public.purchase_receipt_fingerprint(r.purchase_id) is not null))::text,
        null),
  (922, 'Funktion', 'davon stimmig mit dem gespeicherten Wert',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (923, 'Funktion', 'die ersten 16 Zeichen je Beleg — MUSS mit Preflight 923 gleich sein',
        (coalesce((select string_agg(
                     r.purchase_id::text || ':' ||
                     left(public.purchase_receipt_fingerprint(r.purchase_id), 16),
                     ' | ' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (924, 'Funktion', 'die Belegtabellen bleiben fuer alle Rollen gesperrt',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'INSERT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'UPDATE')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'DELETE')))::text, '0')
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
