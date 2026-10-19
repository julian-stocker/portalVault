-- ===========================================================================
-- PHASE A — DER LESENDE STAGING-PRUEFZUGANG (Vorschlag, NICHT ANGEWENDET)
--
-- ###########################################################################
-- ##  NUR STAGING — qqxcpesbwfxzgytkdsac.                                  ##
-- ##  Auf Production (zmiwxswrpkmizvqsgype) darf diese Datei NIEMALS       ##
-- ##  laufen. Abschnitt 0 bricht dort ab, bevor etwas entsteht.            ##
-- ###########################################################################
--
-- KEINE MIGRATION. Betrieblicher Einrichtungsschritt wie
-- `lock-receipt-issuance.sql` — nicht in der Migrationskette, nicht in
-- `APPLIED.md`, nicht in der Reihenfolge eines Rollouts.
--
-- BERICHTIGT AM 2026-10-19, nach einem Abbruch beim ersten Lauf:
--   * Die Nachbedingung verbot JEDE Mitgliedschaft AN der Rolle. PostgreSQL
--     erzeugt aber selbst eine, sobald ein CREATEROLE-Nutzer ohne
--     Superuser-Recht die Rolle anlegt — mit `admin`, aber OHNE `inherit`
--     und OHNE `set`. Das ist ein Verwaltungsgriff, kein Rechteweg. Geprueft
--     wird jetzt genau das Gefaehrliche: fremde Mitglieder und
--     Mitgliedschaften mit `inherit`/`set`.
--   * Abschnitt 2 ist wiederholbar: besteht die Rolle schon, werden
--     Attribute und Passwort gesetzt statt abzubrechen.
--   Diagnose des Vorfalls: `supabase/checks/staging_agent_role_diagnosis.sql`.
--
-- WAS SIE ANLEGT
--
--   1. Einen UMGEBUNGSSTEMPEL als Datenbankkommentar. Production bekommt ihn
--      nie. Die Werkzeugkette liest ihn als ERSTE Anweisung jeder Sitzung und
--      beendet die Verbindung, wenn er fehlt oder anders lautet.
--
--   2. Die Rolle `skyisles_agent` — der Zugang fuer Phase A. Sie darf
--      LESEN, und zwar genau die 12 Tabellen und 3 Funktionen, die die
--      Pruefdateien der Staging-Suite wirklich anfassen. Ausgezaehlt mit
--      einem echten PostgreSQL-Parser, nicht geschaetzt:
--      `python3 tools/lib/grant-plan.py`.
--
--   3. Je Tabelle eine SELECT-Policy fuer GENAU DIESE Rolle. Sie ersetzt
--      `bypassrls` (siehe unten) und beruehrt keine bestehende Policy.
--
-- WAS SIE AUSDRUECKLICH NICHT TUT
--
--   * Sie VERAENDERT DIE BELEGSPERRE NICHT. Kein `grant`, kein `revoke` auf
--     `seller_issue_purchase_receipt` oder `…_correction`. Abschnitt 3 prueft
--     die Sperre REIN LESEND und bricht ab, wenn sie nicht mehr dicht ist.
--     Der Grund, warum hier kein `revoke` fuer die neue Rolle noetig ist: die
--     Sperre hat PUBLIC das EXECUTE schon entzogen, und `skyisles_agent`
--     bekommt es nirgends erteilt.
--   * Sie erteilt KEIN `pg_read_all_data`, KEIN `bypassrls`, kein CREATE,
--     kein INSERT, kein UPDATE, kein DELETE — auf keiner Tabelle.
--   * Sie faesst keine Geschaeftszeile an, kein Schema, keinen Trigger, keine
--     bestehende Policy und KEINE bestehende Rolle oder deren Rechte. Kein
--     `alter role` ausser fuer `skyisles_agent`, kein `grant` an `anon`,
--     `authenticated`, `service_role` oder `postgres`.
--
-- RUECKBAU, falls der Zugang nicht mehr gebraucht wird:
--
--   do $$ declare t text; begin
--     foreach t in array array['categories','collection_items',
--       'inventory_movements','purchase_items','purchase_receipt_counters',
--       'purchase_receipt_downloads','purchase_receipts','purchases',
--       'sale_items','series','shop_inventory','skylanders'] loop
--       execute format('drop policy if exists agent_read_%s on public.%s', t, t);
--     end loop; end $$;
--   reassign owned by skyisles_agent to postgres;  -- vorsorglich, sie besitzt nichts
--   drop owned by skyisles_agent;
--   drop role skyisles_agent;
--   comment on database postgres is 'default administrative connection database';
--
-- Der letzte Satz stellt den URSPRUENGLICHEN Kommentar wieder her, nicht NULL:
-- `initdb` legt die Datenbank `postgres` mit genau diesem Text an. Welcher Text
-- dort heute wirklich steht, zeigt Zeile 301 von
-- `supabase/checks/staging_agent_role_diagnosis.sql` — den vor der Einrichtung
-- notieren, falls er abweicht.
--
-- KEIN `bypassrls` — NACHGEMESSEN, NICHT BEHAUPTET
--
-- Ein erster Entwurf gab der Rolle `bypassrls`. Begruendung war: ALLE zwoelf
-- Tabellen fuehren Row Level Security, und jede vorhandene Policy ist
-- `to anon, authenticated` gebunden — eine neue Rolle passt auf keine davon
-- und saehe deshalb NULL Zeilen. Eine Pruefung, die 0 statt 84 zaehlt, meldet
-- kein Problem, sondern ein falsches Ergebnis.
--
-- Die Frage „ist `bypassrls` dafuer wirklich erforderlich" ist nachgemessen
-- worden, in PostgreSQL 18.6 mit demselben Aufbau (RLS an, Policy
-- `to anon, authenticated`, neue Rolle mit SELECT):
--
--   ohne Policy, ohne bypassrls   →  0 Zeilen von 2 bzw. 0 von 3
--   mit Policy `to <rolle>`       →  2 von 2 und 3 von 3, OHNE bypassrls
--   Schreiben und DDL             →  weiterhin 42501, trotz Policy
--   fuer `anon` aendert sich      →  nichts; sie sieht genau ihre Policy
--
-- `bypassrls` ist also NICHT erforderlich. Die Rolle bekommt stattdessen je
-- Tabelle eine eigene SELECT-Policy — eng, benannt, einzeln ruecknehmbar, und
-- ohne jede Wirkung auf bestehende Rollen und deren Policies.
--
-- Der Preis ist Pflege: liest eine neue Pruefdatei eine neue Tabelle, braucht
-- sie Grant UND Policy. `tools/lib/grant-plan.py` zaehlt beides aus, und
-- `src/lib/admin/staging-access.test.ts` faellt, bis die Datei hier stimmt.
--
-- ---------------------------------------------------------------------------
-- VOR DER AUSFUEHRUNG: DAS PASSWORT
--
-- Unten `HIER-EIN-NEUES-LANGES-PASSWORT-EINSETZEN` ersetzen (>= 32 Zeichen,
-- zufaellig, NICHT das des Dashboard-Nutzers). Danach:
--
--   * Das Passwort gehoert in genau eine Datei, und die liegt AUSSERHALB
--     dieses Repositorys: `~/.skyisles/staging-db.env`, `chmod 600`.
--   * Nicht in diese Datei, nicht in einen Commit, nicht in eine Doku, nicht
--     in eine Chatnachricht, nicht in ein Protokoll.
--   * Diese Datei mit eingesetztem Passwort NICHT speichern — im SQL-Editor
--     ausfuehren und das Fenster schliessen.
--
-- Vergessen ist kein Problem: `alter role skyisles_agent password '…'`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingung — bin ich wirklich auf Staging? (rein lesend)
--
-- Ohne Projektkennung in SQL bleibt der Datenbestand. `SKY-0821` und
-- `SKY-0822` sind Charakterimport-Fixturen, die laut `PROJECT_STATUS.md`
-- **bewusst nie nach Production uebernommen** wurden („Production haelt
-- bewusst kein SKY-0821", „SKY-0822 wurde nicht uebernommen"). Fehlt eine von
-- beiden, ist dies nicht Staging — oder die Annahme ist neu zu pruefen. In
-- beiden Faellen: nicht weitermachen.
-- ---------------------------------------------------------------------------
do $$
declare
  v_stempel integer;
begin
  select count(*) into v_stempel from public.skylanders
   where sky_id in ('SKY-0821', 'SKY-0822');

  if v_stempel <> 2 then
    raise exception 'ABBRUCH: Umgebungsstempel nicht gefunden (% von 2). '
      'Diese Datei laeuft nur auf Staging qqxcpesbwfxzgytkdsac.', v_stempel;
  end if;

  if to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is null then
    raise exception 'ABBRUCH: seller_issue_purchase_receipt fehlt — '
      'die Belegsperre kann nicht geprueft werden, was es nicht gibt';
  end if;

  raise notice 'Vorbedingung erfuellt: Umgebungsstempel 2/2.';
end $$;


-- ---------------------------------------------------------------------------
-- 1. Der Umgebungsstempel
--
-- Ein Kommentar auf der Datenbank. Keine Tabelle, keine Zeile, kein Schema —
-- und auf Production existiert er nicht. ER ERSETZT EINEN BESTEHENDEN TEXT:
-- `initdb` legt `postgres` mit „default administrative connection database" an.
-- Das ist die einzige Stelle, an der diese Datei etwas Bestehendes ueberschreibt;
-- sie ist rein beschreibend, und das Rueckbaurezept oben stellt sie wieder her.
-- Gelesen wird der Stempel mit
--
--   select shobj_description(d.oid, 'pg_database')
--     from pg_database d where d.datname = current_database();
--
-- Bricht diese Anweisung mit `42501 must be owner of database` ab, gehoert
-- die Datenbank nicht dem Dashboard-Nutzer. Dann diesen Abschnitt
-- UEBERSPRINGEN und es im Bericht vermerken: der Riegel ruht dann auf der
-- Zugangsbindung und dem Datenstempel aus Abschnitt 0.
-- ---------------------------------------------------------------------------
comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac';


-- ---------------------------------------------------------------------------
-- 2. Die Rolle
--
-- `noinherit`: selbst wenn der Rolle spaeter eine Mitgliedschaft erteilt
-- wuerde, gelten deren Rechte erst nach einem ausdruecklichen `set role`.
-- `connection limit 5`: ein Werkzeug, das Verbindungen leckt, legt die
-- Datenbank nicht lahm.
-- ---------------------------------------------------------------------------
/*
 * WIEDERHOLBAR, WEIL DER ERSTE LAUF ABBRECHEN KANN.
 *
 * Hier stand `if exists (…) then raise exception` — ein Abbruch, sobald die
 * Rolle schon besteht. Das war falsch gedacht: der Lauf vom 2026-10-19 ist in
 * der NACHBEDINGUNG gescheitert (zu strenge Mitgliedschaftspruefung, siehe
 * Abschnitt 3), und je nachdem, ob der SQL-Editor die Datei als EINE
 * Transaktion ausfuehrt, steht die Rolle danach oder nicht. Eine
 * Einrichtungsdatei, die im zweiten Versuch abbricht, zwingt zu
 * Handgriffen — und Handgriffe sind das, was diese Datei vermeiden soll.
 *
 * Also beide Faelle, ein Ergebnis: die Rolle existiert danach mit genau
 * diesen Attributen und diesem Passwort. `alter role` trifft ausschliesslich
 * `skyisles_agent`; keine bestehende Rolle wird angefasst.
 *
 * Das Passwort steht an EINER Stelle — in `v_passwort`.
 */
do $$
declare
  v_passwort text := 'HIER-EIN-NEUES-LANGES-PASSWORT-EINSETZEN';
  v_attribute text := 'login noinherit nosuperuser nocreatedb nocreaterole '
                      || 'noreplication nobypassrls connection limit 5';
begin
  /*
   * DREI PRUEFUNGEN AM PASSWORT, UND DIE ERSTE IST EIN PRAEFIX.
   *
   * Nicht der ganze Platzhalter: wer die Datei mit „suchen und ersetzen"
   * bearbeitet, trifft sonst AUCH diesen Vergleich, und die Pruefung schlaegt
   * trotz eingesetztem Passwort an. (Genau das ist beim ersten Probelauf
   * passiert.) Ein Praefix bleibt stehen und prueft weiter.
   *
   * Die Zeichenmenge ist nicht Geschmack: das Passwort landet in einer
   * Verbindungs-URL, und ein `#` darin wird von URL-Parser und Treiber
   * VERSCHIEDEN gelesen (`tools/lib/staging-db.mts`, Riegel 1). Hier wird es
   * an der Quelle verhindert.
   */
  if v_passwort like 'HIER-EIN-NEUES-%' then
    raise exception 'ABBRUCH: das Passwort ist noch der Platzhalter. '
      'Oben in v_passwort ein erzeugtes Passwort einsetzen.';
  end if;
  if length(v_passwort) < 32 then
    raise exception 'ABBRUCH: das Passwort hat % Zeichen, erwartet werden mindestens 32',
      length(v_passwort);
  end if;
  if v_passwort !~ '^[A-Za-z0-9]+$' then
    raise exception 'ABBRUCH: das Passwort enthaelt ein Zeichen ausser Buchstaben und '
      'Ziffern. In einer Verbindungs-URL lesen Parser und Treiber solche Zeichen '
      'verschieden — bitte ein rein alphanumerisches Passwort erzeugen.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'skyisles_agent') then
    raise notice 'skyisles_agent besteht schon — Attribute und Passwort werden gesetzt.';
    execute format('alter role skyisles_agent with %s password %L',
                   v_attribute, v_passwort);
  else
    execute format('create role skyisles_agent with %s password %L',
                   v_attribute, v_passwort);
    raise notice 'skyisles_agent angelegt.';
  end if;
end $$;

comment on role skyisles_agent is
  'Phase A: lesender Pruefzugang der Werkzeugkette, nur Staging (qqxcpesbwfxzgytkdsac). SELECT auf die 12 Tabellen und EXECUTE auf die 3 Funktionen der Staging-Suite, je Tabelle eine eigene SELECT-Policy statt bypassrls. Kein DDL, kein Schreibrecht, kein Eigenbeleg, keine Rollenmitgliedschaft. Rechteliste ausgezaehlt mit tools/lib/grant-plan.py; Plan: supabase/checks/staging_agent_access_plan.md.';

/*
 * DER DRITTE RIEGEL: DIE SITZUNG IST SCHREIBGESCHUETZT, AN DER ROLLE.
 *
 * `default_transaction_read_only` gilt fuer JEDE Sitzung dieser Rolle — egal
 * welches Werkzeug sie oeffnet, egal was es vorhat. Ein Schreibversuch endet
 * mit `25006 cannot execute … in a read-only transaction`, noch vor jeder
 * Rechtepruefung. Die Rolle hat ohnehin kein Schreibrecht; dies ist die
 * Schranke davor, und sie wirkt auch gegen einen Fehler im Werkzeug.
 *
 * Lesende Pruefungen sind davon unberuehrt: `select`, `set_config(…, true)`
 * und `begin … rollback` sind keine Schreibvorgaenge.
 */
alter role skyisles_agent set default_transaction_read_only = on;

-- Das Schema sehen, aber nichts darin anlegen.
grant usage on schema public to skyisles_agent;
revoke create on schema public from skyisles_agent;

-- ---- Die 12 Tabellen, je SELECT -------------------------------------------
-- Ausgezaehlt aus den 9 Dateien der Staging-Suite
-- (`supabase/checks/staging-suite.json`) mit `tools/lib/grant-plan.py`.
-- `src/lib/admin/staging-access.test.ts` rechnet die Liste bei jedem
-- Testlauf nach: waechst die Suite, faellt der Test, bis die Liste stimmt.
grant select on table public.categories                 to skyisles_agent;
grant select on table public.collection_items           to skyisles_agent;
grant select on table public.inventory_movements        to skyisles_agent;
grant select on table public.purchase_items             to skyisles_agent;
grant select on table public.purchase_receipt_counters  to skyisles_agent;
grant select on table public.purchase_receipt_downloads to skyisles_agent;
grant select on table public.purchase_receipts          to skyisles_agent;
grant select on table public.purchases                  to skyisles_agent;
grant select on table public.sale_items                 to skyisles_agent;
grant select on table public.series                     to skyisles_agent;
grant select on table public.shop_inventory             to skyisles_agent;
grant select on table public.skylanders                 to skyisles_agent;

-- ---- Die 3 Funktionen, je EXECUTE -----------------------------------------
-- Alle drei sind `stable` und lesen nur. Sie brauchen ein ausdrueckliches
-- Recht, weil ihre Migrationen PUBLIC das EXECUTE entzogen haben.
grant execute on function public.is_shop_eligible(text)        to skyisles_agent;
grant execute on function public.non_collectible_categories()  to skyisles_agent;
grant execute on function public.shop_offers()                 to skyisles_agent;

-- ---- Je Tabelle eine SELECT-Policy fuer GENAU DIESE Rolle ----------------
/*
 * WARUM DAS NOETIG IST UND WARUM ES NICHTS KAPUTT MACHT.
 *
 * Alle zwoelf Tabellen fuehren RLS. Jede VORHANDENE Policy ist
 * `to anon, authenticated` gebunden — eine neue Rolle passt auf keine davon
 * und saehe mit SELECT-Recht trotzdem null Zeilen (nachgemessen, siehe Kopf).
 *
 * Eine Policy, die `to skyisles_agent` gebunden ist, wird fuer keine andere
 * Rolle ausgewertet: bestehende Policies, bestehende Rollen und die
 * Sichtbarkeit fuer `anon` und `authenticated` bleiben unberuehrt. Und sie
 * erlaubt NUR `select` — Schreiben scheitert weiter am fehlenden Recht.
 *
 * Dynamisch, damit die Liste genau einmal im Code steht und ein zweiter Lauf
 * nicht an einer bestehenden Policy abbricht.
 */
do $$
declare
  v_tab text;
begin
  foreach v_tab in array array[
    'categories', 'collection_items', 'inventory_movements', 'purchase_items',
    'purchase_receipt_counters', 'purchase_receipt_downloads',
    'purchase_receipts', 'purchases', 'sale_items', 'series',
    'shop_inventory', 'skylanders'] loop

    if to_regclass('public.' || v_tab) is null then
      raise exception 'ABBRUCH: Tabelle public.% fehlt', v_tab;
    end if;
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = v_tab
                  and policyname = 'agent_read_' || v_tab) then
      raise notice 'UEBERSPRUNGEN: Policy agent_read_% steht schon', v_tab;
      continue;
    end if;

    execute format(
      'create policy %I on public.%I for select to skyisles_agent using (true)',
      'agent_read_' || v_tab, v_tab);
    raise notice 'Policy agent_read_% angelegt', v_tab;
  end loop;
end $$;


/*
 * WAS MIT ALLEN ANDEREN FUNKTIONEN IST — ehrlich benannt.
 *
 * PostgreSQL vergibt EXECUTE auf eine neue Funktion standardmaessig an
 * PUBLIC, und jede Rolle ist in PUBLIC enthalten. Wo eine Migration PUBLIC
 * nicht ausdruecklich entzogen hat, kann `skyisles_agent` die Funktion also
 * aufrufen — das ist PostgreSQLs Standard, nicht etwas, das diese Datei
 * hinzufuegt, und per Rolle nicht abschaltbar.
 *
 * Fuer die SCHREIBENDEN Verkaeuferfunktionen ist das belanglos: jede beginnt
 * mit `can_operate_active_seller()`, und in einer reinen Datenbanksitzung ist
 * `auth.uid()` NULL. Jeder Aufruf endet mit „seller operator role required" —
 * nachgewiesen und dokumentiert in `supabase/checks/0132_test_plan.md`.
 *
 * Fuer die zwei Belegfunktionen ist es ebenfalls belanglos: dort hat
 * `lock-receipt-issuance.sql` PUBLIC das EXECUTE entzogen. Abschnitt 3 prueft
 * genau das nach.
 */


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen — rein lesend, und ueber die EFFEKTIVEN Rechte
--
-- `has_table_privilege` und `has_function_privilege` rechnen das Recht
-- vollstaendig aus: eigene Grants, Grants an PUBLIC und jede
-- Rollenmitgliedschaft. Genau deshalb wird hier damit geprueft und nicht in
-- `information_schema.role_table_grants` nachgesehen — dort steht nur, was
-- ausdruecklich erteilt wurde.
-- ---------------------------------------------------------------------------
do $$
declare
  r         record;
  v_sig     text;
  v_tab     text;
  v_recht   text;
  v_zahl    integer;
  v_liste   text;
  DIE_12    text[] := array[
    'categories', 'collection_items', 'inventory_movements', 'purchase_items',
    'purchase_receipt_counters', 'purchase_receipt_downloads',
    'purchase_receipts', 'purchases', 'sale_items', 'series',
    'shop_inventory', 'skylanders'];
  /* Was diese Rolle unter keinen Umstaenden ausfuehren darf. Jede dieser
     Funktionen hat PUBLIC ausdruecklich entzogen bekommen; hier wird
     nachgesehen, dass das noch gilt und auch fuer die neue Rolle. */
  SENSIBEL  text[] := array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)',
    'public.seller_business_backup()',
    'public.system_platform_export()',
    'public.purchase_receipt_fingerprint(bigint)'];
begin
  select * into r from pg_roles where rolname = 'skyisles_agent';
  if not found then raise exception 'ABBRUCH: die Rolle wurde nicht angelegt'; end if;

  -- ---- Rollenattribute: genau das, was sie koennen soll ----------------
  if not r.rolcanlogin  then raise exception 'ABBRUCH: Rolle kann sich nicht anmelden'; end if;
  if r.rolinherit       then raise exception 'ABBRUCH: Rolle ist nicht NOINHERIT'; end if;
  if r.rolsuper         then raise exception 'ABBRUCH: Rolle ist Superuser'; end if;
  if r.rolcreatedb      then raise exception 'ABBRUCH: Rolle darf Datenbanken anlegen'; end if;
  if r.rolcreaterole    then raise exception 'ABBRUCH: Rolle darf Rollen anlegen'; end if;
  if r.rolreplication   then raise exception 'ABBRUCH: Rolle darf replizieren'; end if;
  if r.rolbypassrls     then raise exception 'ABBRUCH: Rolle hat bypassrls — nicht erforderlich'; end if;
  if r.rolconnlimit <> 5 then raise exception 'ABBRUCH: Verbindungslimit ist % statt 5', r.rolconnlimit; end if;

  -- ---- und ihre Sitzungen sind schreibgeschuetzt -----------------------
  if not exists (select 1 from unnest(coalesce(r.rolconfig, '{}'::text[])) c
                  where c = 'default_transaction_read_only=on') then
    raise exception 'ABBRUCH: default_transaction_read_only=on fehlt an der Rolle (rolconfig %)',
      coalesce(array_to_string(r.rolconfig, ', '), '(leer)');
  end if;

  -- ---- Rollenmitgliedschaften — und die RICHTUNG entscheidet -----------
  /*
   * `pg_auth_members` benennt die Richtung nicht von selbst:
   *
   *     m.member = die Rolle, DIE Mitglied ist (sie gewinnt Rechte)
   *     m.roleid = die Rolle, IN DER sie Mitglied ist (ihre Rechte werden
   *                gewonnen)
   *
   * RICHTUNG 1 — `skyisles_agent` ist Mitglied von X: der Zugang gewinnt
   * fremde Rechte. Bei NOINHERIT erst nach `set role`, aber vorhanden. Das
   * bleibt ein Abbruch.
   */
  select count(*), coalesce(string_agg(g.rolname, ', '), '')
    into v_zahl, v_liste
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles k on k.oid = m.member
   where k.rolname = 'skyisles_agent';
  if v_zahl <> 0 then
    raise exception 'ABBRUCH: skyisles_agent ist Mitglied von % Rolle(n): %',
      v_zahl, v_liste;
  end if;

  /*
   * RICHTUNG 2 — X ist Mitglied von `skyisles_agent`: X gewinnt die Rechte
   * des Zugangs.
   *
   * HIER STAND EIN ABBRUCH, UND ER WAR FALSCH. Der Lauf vom 2026-10-19 ist
   * genau daran gescheitert. Ursache: **PostgreSQL erzeugt diese
   * Mitgliedschaft selbst.** Ab Version 16 wird eine Rolle, die ein
   * CREATEROLE-Nutzer OHNE Superuser-Recht anlegt, automatisch dem Ersteller
   * zugeteilt — nachgemessen in 18.6:
   *
   *     als Superuser erzeugt      →  keine Mitgliedschaft
   *     als CREATEROLE erzeugt     →  admin_option = true
   *                                   inherit_option = false
   *                                   set_option = false
   *
   * Das ist ein VERWALTUNGSGRIFF, kein Rechteweg: ohne `inherit` erbt der
   * Ersteller nichts, ohne `set` kann er die Rolle nicht einmal annehmen
   * (nachgemessen: `set role` scheitert mit 42501 in BEIDE Richtungen). Ohne
   * diese Zeile koennte der Dashboard-Nutzer die von ihm erzeugte Rolle
   * spaeter nicht einmal aendern oder loeschen.
   *
   * Geprueft wird deshalb, was wirklich gefaehrlich waere: eine
   * Mitgliedschaft MIT `inherit` oder `set`, und ein Mitglied, das nicht der
   * Ersteller ist. `to_jsonb(m)` liest die beiden Spalten vertraeglich —
   * vor PostgreSQL 16 gibt es sie nicht, dann ist der Wert NULL und die
   * Pruefung faellt auf die Mitgliederliste zurueck.
   */
  select count(*),
         coalesce(string_agg(k.rolname || ' (admin='
                             || coalesce(to_jsonb(m) ->> 'admin_option', '?')
                             || ', inherit='
                             || coalesce(to_jsonb(m) ->> 'inherit_option', 'vor16')
                             || ', set='
                             || coalesce(to_jsonb(m) ->> 'set_option', 'vor16') || ')',
                             '; '), '')
    into v_zahl, v_liste
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles k on k.oid = m.member
   where g.rolname = 'skyisles_agent';
  if v_zahl > 0 then
    raise notice 'HINWEIS: % Mitglied(er) von skyisles_agent: %', v_zahl, v_liste;
  end if;

  -- Ein Mitglied, das nicht der Ersteller ist, waere ein Befund.
  select count(*), coalesce(string_agg(k.rolname, ', '), '')
    into v_zahl, v_liste
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles k on k.oid = m.member
   where g.rolname = 'skyisles_agent'
     and k.rolname <> current_user;
  if v_zahl <> 0 then
    raise exception 'ABBRUCH: % fremde Rolle(n) sind Mitglied von skyisles_agent: % '
      '(erwartet waere hoechstens der Ersteller %)', v_zahl, v_liste, current_user;
  end if;

  -- Und keine Mitgliedschaft, die Rechte wirklich weitergibt.
  select count(*) into v_zahl
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
   where g.rolname = 'skyisles_agent'
     and (to_jsonb(m) ->> 'inherit_option' = 'true'
       or to_jsonb(m) ->> 'set_option' = 'true');
  if v_zahl <> 0 then
    raise exception 'ABBRUCH: % Mitgliedschaft(en) an skyisles_agent tragen inherit '
      'oder set — das gaebe die Rechte des Zugangs weiter', v_zahl;
  end if;

  -- ---- kein CREATE im Schema -------------------------------------------
  if has_schema_privilege('skyisles_agent', 'public', 'create') then
    raise exception 'ABBRUCH: Rolle darf in public anlegen';
  end if;
  if not has_schema_privilege('skyisles_agent', 'public', 'usage') then
    raise exception 'ABBRUCH: Rolle darf das Schema public nicht benutzen';
  end if;

  -- ---- KEIN Schreibrecht auf IRGENDEINER Tabelle in public -------------
  /* Nicht nur auf den zwoelf: eine Standardberechtigung oder ein Grant an
     PUBLIC koennte der Rolle Schreibrecht auf einer ganz anderen Tabelle
     geben, und genau das soll hier auffallen. */
  v_zahl := 0;
  v_liste := '';
  for v_tab in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     order by c.relname
  loop
    foreach v_recht in array array['insert', 'update', 'delete', 'truncate',
                                   'references', 'trigger'] loop
      if has_table_privilege('skyisles_agent', 'public.' || quote_ident(v_tab), v_recht) then
        v_zahl := v_zahl + 1;
        v_liste := v_liste || v_tab || '.' || v_recht || ' ';
      end if;
    end loop;
  end loop;
  if v_zahl <> 0 then
    raise exception 'ABBRUCH: skyisles_agent hat % Schreibrecht(e): %', v_zahl, v_liste;
  end if;

  -- ---- SELECT auf den zwoelf, und Policy dazu --------------------------
  foreach v_tab in array DIE_12 loop
    if not has_table_privilege('skyisles_agent', 'public.' || v_tab, 'select') then
      raise exception 'ABBRUCH: skyisles_agent darf % nicht lesen', v_tab;
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = v_tab
                      and policyname = 'agent_read_' || v_tab) then
      raise exception 'ABBRUCH: Policy agent_read_% fehlt — ohne sie liest die '
        'Rolle null Zeilen, und die Pruefung meldete ein falsches Ergebnis', v_tab;
    end if;
    /* Und die Policy gilt NUR dieser Rolle und NUR fuer select. */
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = v_tab
                  and policyname = 'agent_read_' || v_tab
                  and (cmd <> 'SELECT' or roles <> '{skyisles_agent}'::name[])) then
      raise exception 'ABBRUCH: Policy agent_read_% ist nicht auf select/skyisles_agent begrenzt',
        v_tab;
    end if;
  end loop;

  -- ---- Information: Lesbares ausserhalb der zwoelf ---------------------
  /* Ein Grant an PUBLIC auf einer anderen Tabelle waere BESTEHEND und nicht
     von dieser Datei gesetzt. Deshalb ein Hinweis, kein Abbruch — aber er
     steht im Protokoll. */
  select count(*), coalesce(string_agg(x.relname, ', ' order by x.relname), '(keine)')
    into v_zahl, v_liste
    from (select c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
             and has_table_privilege('skyisles_agent', c.oid, 'select')
             and c.relname <> all (DIE_12)) x;
  if v_zahl > 0 then
    raise notice 'HINWEIS: % weitere Relation(en) sind lesbar (bestehende Rechte, '
      'nicht von dieser Datei): %', v_zahl, v_liste;
  else
    raise notice 'Lesbar sind genau die 12 Tabellen der Suite.';
  end if;

  -- ---- KEIN EXECUTE auf einer sensiblen Funktion -----------------------
  foreach v_sig in array SENSIBEL loop
    if to_regprocedure(v_sig) is null then
      raise notice 'HINWEIS %: nicht vorhanden, nichts zu pruefen', v_sig;
      continue;
    end if;
    if has_function_privilege('skyisles_agent', v_sig, 'execute') then
      raise exception 'ABBRUCH: skyisles_agent darf % ausfuehren', v_sig;
    end if;
  end loop;

  -- ---- EXECUTE auf genau den drei lesenden Funktionen ------------------
  foreach v_sig in array array[
    'public.is_shop_eligible(text)',
    'public.non_collectible_categories()',
    'public.shop_offers()'] loop
    if not has_function_privilege('skyisles_agent', v_sig, 'execute') then
      raise exception 'ABBRUCH: skyisles_agent darf % nicht ausfuehren', v_sig;
    end if;
  end loop;

  -- ---- die Belegsperre: UNVERAENDERT und dicht, nur gelesen -------------
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop
    if to_regprocedure(v_sig) is null then
      raise notice 'HINWEIS %: nicht vorhanden', v_sig;
      continue;
    end if;
    foreach v_recht in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_recht, v_sig, 'execute') then
        raise exception 'ABBRUCH: die bestehende Belegsperre ist nicht dicht (% darf %)',
          v_recht, v_sig;
      end if;
    end loop;
    /* Und PUBLIC — ueber den ACL gelesen, denn `has_function_privilege`
       kennt keine Pseudorolle „public". Ein NULL-ACL waere EXECUTE fuer
       PUBLIC; genau diese Falle steht in `receipt_lock_check.sql`. */
    if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(v_sig)) then
      raise exception 'ABBRUCH: % hat einen NULL-ACL — das ist EXECUTE fuer PUBLIC', v_sig;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.oid = to_regprocedure(v_sig)
                  and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
      raise exception 'ABBRUCH: PUBLIC darf % ausfuehren', v_sig;
    end if;
  end loop;

  raise notice 'OK: skyisles_agent angelegt — SELECT auf 12 Tabellen mit je eigener '
    'Policy, EXECUTE auf 3 lesende Funktionen, kein bypassrls, kein Schreibrecht '
    'auf irgendeiner Tabelle, keine Mitgliedschaft, Sitzung schreibgeschuetzt. '
    'Die Belegsperre ist unveraendert und dicht.';
end $$;
