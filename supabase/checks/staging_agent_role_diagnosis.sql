-- ===========================================================================
-- DIAGNOSE: der Abbruch von `staging-agent-setup.sql` (2026-10-19)
--
-- DER ABBRUCH
--   ERROR P0001: ABBRUCH: eine andere Rolle ist Mitglied von skyisles_agent
--   CONTEXT: PL/pgSQL inline_code_block line 59
--
-- WAS DIESE DATEI KLAEREN SOLL
--   1. Wie weit ist das Setup gekommen? Die Datei laeuft im SQL-Editor als
--      EINE Anweisungsfolge, also als EINE implizite Transaktion — dann hat
--      der Abbruch alles zurueckgerollt und es gibt weder Rolle noch Policy
--      noch Stempel. Liefen die Anweisungen einzeln, steht alles bis auf die
--      Nachbedingung. Zeile 301 bis 306 sagen, welcher Fall vorliegt.
--   2. Welche Mitgliedschaft gibt es, in welcher RICHTUNG, und was bringt sie?
--      Zeile 201 bis 211.
--   3. Ist die Belegsperre unveraendert dicht? Zeile 401 bis 404. Das ist die
--      einzige Frage, die unabhaengig vom Ausgang beantwortet sein MUSS.
--
-- RICHTUNG IST HIER ALLES — und `pg_auth_members` benennt sie nicht von
-- selbst:
--
--     m.member  = die Rolle, DIE Mitglied ist (sie gewinnt Rechte)
--     m.roleid  = die Rolle, IN DER sie Mitglied ist (ihre Rechte werden
--                 gewonnen)
--
--   „skyisles_agent ist Mitglied von X"  →  member = skyisles_agent
--                                           Der Zugang gewinnt fremde Rechte.
--                                           GEFAEHRLICH. Zeile 201 muss 0 sein.
--   „X ist Mitglied von skyisles_agent"  →  roleid = skyisles_agent
--                                           X gewinnt die Rechte des Zugangs.
--                                           Zeile 203 zaehlt sie auf.
--
-- NUR LESEN. Ein einziges SELECT ueber `pg_roles`, `pg_auth_members`,
-- `pg_proc`, `pg_policies`, `pg_database` und `information_schema`. Kein
-- DO-Block, kein DDL, kein DML, keine Rechteaenderung, kein Funktionsaufruf
-- der Geschaeftslogik. Es werden keine Geschaeftsdaten und keine
-- personenbezogenen Daten gelesen.
--
-- Zeile 9999 zaehlt nur die SICHERHEITSRELEVANTEN Abweichungen (201, 211,
-- 401 bis 404). Alles andere ist Messung ohne Sollwert: ein vollstaendiges
-- Zurueckrollen ist ein gueltiger Ausgang und kein Fehler.
-- ===========================================================================

with rolle as (
  select r.* from pg_roles r where r.rolname = 'skyisles_agent'
),
/*
 * Mitgliedschaften, in beiden Richtungen und mit allen Optionen.
 *
 * `inherit_option` und `set_option` gibt es erst ab PostgreSQL 16. Gelesen
 * wird deshalb ueber `to_jsonb(m)`: fehlt eine Spalte, ist der Wert NULL
 * statt eines Abbruchs mit 42703. Dieselbe Datei laeuft damit auf 15 und 16+.
 */
mitglied as (            -- skyisles_agent IST Mitglied von …
  select g.rolname as gegenueber,
         to_jsonb(m) ->> 'admin_option'   as admin_option,
         to_jsonb(m) ->> 'inherit_option' as inherit_option,
         to_jsonb(m) ->> 'set_option'     as set_option
    from pg_auth_members m
    join pg_roles k on k.oid = m.member
    join pg_roles g on g.oid = m.roleid
   where k.rolname = 'skyisles_agent'
),
gruppe as (              -- … ist Mitglied VON skyisles_agent
  select k.rolname as gegenueber,
         coalesce(gr.rolname, '(unbekannt)') as grantor,
         to_jsonb(m) ->> 'admin_option'   as admin_option,
         to_jsonb(m) ->> 'inherit_option' as inherit_option,
         to_jsonb(m) ->> 'set_option'     as set_option
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles k on k.oid = m.member
    left join pg_roles gr on gr.oid = m.grantor
   where g.rolname = 'skyisles_agent'
),
beleg (sig) as (values
  ('public.seller_issue_purchase_receipt(bigint)'),
  ('public.seller_issue_purchase_receipt_correction(bigint)')
),
belegrecht as (
  select b.sig,
         to_regprocedure(b.sig) is not null as vorhanden,
         (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(b.sig))
           as acl_null,
         exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                  where p.oid = to_regprocedure(b.sig)
                    and a.privilege_type = 'EXECUTE' and a.grantee = 0) as public_darf,
         (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(n)
           where to_regprocedure(b.sig) is not null
             and has_function_privilege(r.n, b.sig, 'execute')) as api_rollen
    from beleg b
),
DIE_12 (tab) as (values
  ('categories'), ('collection_items'), ('inventory_movements'), ('purchase_items'),
  ('purchase_receipt_counters'), ('purchase_receipt_downloads'),
  ('purchase_receipts'), ('purchases'), ('sale_items'), ('series'),
  ('shop_inventory'), ('skylanders')
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------------- Umgebung
  (101, 'Umgebung', 'PostgreSQL-Fassung', (select version()), null),
  (102, 'Umgebung', 'wer fragt: current_user / session_user',
      current_user::text || ' / ' || session_user::text, null),
  (103, 'Umgebung', 'Stempel: SKY-0821 und SKY-0822 vorhanden (nur Staging)',
      (select (count(*) = 2)::text from public.skylanders
        where sky_id in ('SKY-0821', 'SKY-0822')), null),

  -- ------------------------------------------- Die Rolle und ihre Rechte
  (111, 'Rolle', 'skyisles_agent existiert',
      (select (count(*) = 1)::text from rolle), null),
  (112, 'Rolle', 'Attribute: login / inherit / super / createdb / createrole / bypassrls',
      coalesce((select r.rolcanlogin::text || ' / ' || r.rolinherit::text || ' / '
                    || r.rolsuper::text || ' / ' || r.rolcreatedb::text || ' / '
                    || r.rolcreaterole::text || ' / ' || r.rolbypassrls::text
                 from rolle r), '(Rolle fehlt)'), null),
  (113, 'Rolle', 'Verbindungslimit / rolconfig',
      coalesce((select r.rolconnlimit::text || ' / '
                    || coalesce(array_to_string(r.rolconfig, ', '), '(leer)')
                 from rolle r), '(Rolle fehlt)'), null),

  -- --------------------------------------------- Mitgliedschaften, gerichtet
  (201, 'Mitgliedschaft', 'GEFAEHRLICHE RICHTUNG: skyisles_agent ist Mitglied von … (muss 0 sein)',
      (select count(*)::text from mitglied), '0'),
  (202, 'Mitgliedschaft', 'und zwar von',
      coalesce((select string_agg(m.gegenueber, ', ' order by m.gegenueber) from mitglied m),
               '(keine)'), null),
  (203, 'Mitgliedschaft', 'ANDERE RICHTUNG: Mitglieder VON skyisles_agent (Anzahl)',
      (select count(*)::text from gruppe), null),
  (204, 'Mitgliedschaft', 'und zwar',
      coalesce((select string_agg(g.gegenueber || ' (grantor ' || g.grantor
                                  || ', admin=' || coalesce(g.admin_option, '?')
                                  || ', inherit=' || coalesce(g.inherit_option, '?')
                                  || ', set=' || coalesce(g.set_option, '?') || ')',
                                  '; ' order by g.gegenueber) from gruppe g),
               '(keine)'), null),
  (205, 'Mitgliedschaft', 'Mitglieder VON skyisles_agent ausser dem Ersteller',
      (select count(*)::text from gruppe g where g.gegenueber <> current_user::text), null),
  /*
   * DIE EINE BLOCKIERENDE FRAGE ZU DIESER RICHTUNG.
   *
   * Eine Mitgliedschaft mit `inherit` oder `set` gaebe dem Mitglied die
   * Rechte des Zugangs — ueber Vererbung oder ueber `set role`. Die
   * Mitgliedschaft, die PostgreSQL beim Anlegen durch einen CREATEROLE-Nutzer
   * selbst erzeugt, traegt `admin=true, inherit=false, set=false`: ein
   * Verwaltungsgriff, kein Rechteweg. Auf PostgreSQL 15 gibt es die beiden
   * Spalten nicht; dort ist der Befund `(vor 16)` und die Zeile eine Messung.
   */
  (211, 'Mitgliedschaft', 'jede Mitgliedschaft AN der Rolle ist ohne inherit und ohne set',
      coalesce((select case
                 when count(*) = 0 then 'ja'
                 when count(*) filter (where g.inherit_option is null) > 0 then '(vor 16)'
                 when count(*) filter (where g.inherit_option = 'true'
                                          or g.set_option = 'true') = 0 then 'ja'
                 else 'NEIN' end
               from gruppe g), 'ja'),
      null),
  (212, 'Mitgliedschaft', 'blockierend: keine Mitgliedschaft mit inherit oder set',
      coalesce((select (count(*) filter (where g.inherit_option = 'true'
                                            or g.set_option = 'true') = 0)::text
                  from gruppe g), 'true'), 'true'),

  -- ------------------------------------- Wie weit ist das Setup gekommen?
  (301, 'Stand', 'Umgebungsstempel auf der Datenbank',
      coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                 where d.datname = current_database()), '(keiner)'), null),
  (302, 'Stand', 'SELECT-Rechte von skyisles_agent auf den 12 Tabellen (von 12)',
      (select count(*)::text from DIE_12 t
        where exists (select 1 from rolle)
          and has_table_privilege('skyisles_agent', 'public.' || t.tab, 'select')), null),
  (303, 'Stand', 'Policies agent_read_* (von 12)',
      (select count(*)::text from pg_policies p
        where p.schemaname = 'public' and p.policyname like 'agent\_read\_%'), null),
  (304, 'Stand', 'EXECUTE auf den 3 lesenden Funktionen (von 3)',
      (select count(*)::text from (values
          ('public.is_shop_eligible(text)'),
          ('public.non_collectible_categories()'),
          ('public.shop_offers()')) f(sig)
        where exists (select 1 from rolle)
          and to_regprocedure(f.sig) is not null
          and has_function_privilege('skyisles_agent', f.sig, 'execute')), null),
  (305, 'Stand', 'CREATE auf dem Schema public',
      coalesce((select has_schema_privilege('skyisles_agent', 'public', 'create')::text
                 from rolle), '(Rolle fehlt)'), null),
  /*
   * DER STEMPEL IST NICHT „LEER ODER GESETZT".
   *
   * Eine frisch angelegte PostgreSQL-Datenbank traegt schon einen Kommentar:
   * `postgres` heisst von `initdb` her „default administrative connection
   * database". Ein Zurueckrollen stellt also DIESEN Text wieder her, nicht
   * NULL. Die Deutung vergleicht deshalb mit dem ERWARTETEN Stempel, nicht
   * mit der Leere — sonst meldete sie nach einem saubereren Zurueckrollen
   * „gemischt" und schickte jemanden auf die Suche nach Resten, die es nicht
   * gibt. (Genau das tat die erste Fassung dieser Zeile.)
   */
  (306, 'Stand', 'Deutung',
      (select case
         when not exists (select 1 from rolle)
              and coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                             where d.datname = current_database()), '')
                  <> 'skyisles-staging qqxcpesbwfxzgytkdsac'
           then 'ZURUECKGEROLLT — nichts angewendet, auch kein Stempel'
         when exists (select 1 from rolle)
           then 'TEILWEISE ANGEWENDET — Rolle steht, Nachbedingung abgebrochen'
         else 'GEMISCHT — Stempel steht, Rolle fehlt' end), null),

  -- ---------------------------------------------------- Die Belegsperre
  (401, 'Belegsperre', 'blockierend: keine API-Rolle darf ausstellen oder korrigieren',
      (select (coalesce(sum(b.api_rollen), 0) = 0)::text from belegrecht b), 'true'),
  (402, 'Belegsperre', 'blockierend: PUBLIC darf nicht',
      (select (count(*) filter (where b.public_darf) = 0)::text from belegrecht b), 'true'),
  (403, 'Belegsperre', 'blockierend: kein NULL-ACL (das waere EXECUTE fuer PUBLIC)',
      (select (count(*) filter (where b.vorhanden and b.acl_null) = 0)::text
         from belegrecht b), 'true'),
  (404, 'Belegsperre', 'blockierend: skyisles_agent darf nicht',
      (select (count(*) filter (where b.vorhanden
                                  and has_function_privilege('skyisles_agent', b.sig, 'execute')) = 0)::text
         from belegrecht b where exists (select 1 from rolle)), 'true'),
  (405, 'Belegsperre', 'Info: beide Funktionen vorhanden',
      (select count(*)::text from belegrecht b where b.vorhanden), null)
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
