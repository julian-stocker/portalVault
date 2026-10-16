-- ===========================================================================
-- SPERRE: Eigenbelege koennen nicht mehr ueber die API ausgestellt werden
--
-- KEINE MIGRATION. Diese Datei gehoert nicht in die Migrationskette, nicht in
-- `APPLIED.md` und nicht in die Reihenfolge eines Rollouts. Sie ist ein
-- betrieblicher Schalter und vollstaendig ruecknehmbar
-- (`unlock-receipt-issuance.sql`).
--
-- WOZU: Die Freigabe der Verwaltungsfunktionen (0126-0131) soll von der
-- Freigabe zur Ausstellung rechtlich relevanter Eigenbelege getrennt bleiben.
-- Solange die zweite Freigabe nicht erteilt ist, darf kein Weg ueber die API
-- einen Beleg erzeugen — auch nicht versehentlich, auch nicht nach einem
-- Deployment.
--
-- WAS SIE SPERRT: genau die zwei Funktionen, die einen Beleg entstehen lassen
-- koennen. Ueber alle Migrationen ausgezaehlt gibt es keinen dritten Weg:
-- kein Trigger und keine andere Funktion schreibt auf
-- `public.purchase_receipts`.
--
--   * `seller_issue_purchase_receipt(bigint)`            (0122, ersetzt in 0123)
--   * `seller_issue_purchase_receipt_correction(bigint)` (0128)
--
-- WARUM JEDE ROLLE EINZELN: `revoke ... from authenticated` allein genuegt
-- NICHT. Supabase vergibt in `public` Standardrechte auch an `service_role`,
-- und `0122` entzieht ausdruecklich nur `public` und `anon` — ueber einen
-- Service-Role-Aufruf blieb die Ausstellung also offen. Deshalb wird jede
-- API-Rolle benannt. `postgres` behaelt EXECUTE; sonst waere die Sperre nicht
-- ruecknehmbar, und der SQL-Editor ist kein API-Weg.
--
-- WAS SIE NICHT TUT: sie faesst keine Daten an. Kein `insert`, `update`,
-- `delete`, kein DDL an Tabellen, kein Trigger, keine Funktion wird
-- veraendert. Bestehende Belege bleiben, wie sie sind — und bleiben
-- abrufbar: `seller_purchase_receipt`, `..._document`,
-- `..._record_purchase_receipt_download` und `..._history` werden NICHT
-- gesperrt. Lesen, Herunterladen und der Abrufnachweis funktionieren weiter.
--
-- FOLGE FUER DIE POSTFLIGHTS: der Rechtestand weicht danach von dem ab, den
-- `0122` und `0128` hergestellt haben. Ein erneuter `0128`-Postflight meldet
-- das. Das ist gewollt und gehoert ins Protokoll — nicht stillschweigend.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert. Vorher
-- `npm run verify:sums`. Danach `supabase/checks/receipt_lock_check.sql` —
-- erst dessen `9999 = 0` ist der Nachweis, dass die Sperre haelt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Den Zustand VOR der Sperre protokollieren
--
-- Das ist kein Beiwerk: die Ruecknahme muss wissen, was vorher galt. Die
-- Ausgabe dieses Blocks gehoert in das Rollout-Protokoll, BEVOR Abschnitt 2
-- laeuft.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig  text;
  v_acl  text;
  v_rolle text;
begin
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop

    if to_regprocedure(v_sig) is null then
      raise notice 'VORHER  %: Funktion nicht vorhanden — nichts zu sperren', v_sig;
      continue;
    end if;

    select coalesce(array_to_string(p.proacl, ' '), '(Standardrechte, kein ACL-Eintrag)')
      into v_acl
      from pg_proc p where p.oid = to_regprocedure(v_sig);
    raise notice 'VORHER  %: ACL = %', v_sig, v_acl;

    /* PUBLIC ist keine Rolle in `pg_roles`; `has_function_privilege('public',
       …)` bricht ab. PUBLIC steht im ACL oben — ein Eintrag, der mit `=`
       beginnt, oder ein NULL-ACL (Standard fuer Funktionen ist EXECUTE fuer
       PUBLIC). */
    foreach v_rolle in array array['anon', 'authenticated',
                                   'service_role', 'postgres'] loop
      if exists (select 1 from pg_roles g where g.rolname = v_rolle) then
        raise notice 'VORHER  %: % darf ausfuehren = %',
          v_sig, v_rolle, has_function_privilege(v_rolle, v_sig, 'execute');
      end if;
    end loop;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Sperre
--
-- Dynamisch, weil `revoke` auf eine nicht vorhandene Funktion abbricht — und
-- vor `0128` gibt es die Korrekturfunktion nicht. Die Sperre soll in beiden
-- Zustaenden laufen.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop

    if to_regprocedure(v_sig) is null then
      raise notice 'UEBERSPRUNGEN %: nicht vorhanden', v_sig;
      continue;
    end if;

    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role',
      v_sig);
    raise notice 'GESPERRT %', v_sig;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingung — die Sperre muss halten, sonst Abbruch
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig   text;
  v_rolle text;
  v_offen integer := 0;
begin
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop

    if to_regprocedure(v_sig) is null then
      continue;
    end if;

    foreach v_rolle in array array['anon', 'authenticated', 'service_role'] loop
      if not exists (select 1 from pg_roles g where g.rolname = v_rolle) then
        continue;
      end if;
      if has_function_privilege(v_rolle, v_sig, 'execute') then
        raise warning 'OFFEN: % darf % noch ausfuehren', v_rolle, v_sig;
        v_offen := v_offen + 1;
      end if;
    end loop;

    /* PUBLIC ueber den ACL — und ein NULL-ACL ist hier NICHT harmlos: der
       Standard fuer Funktionen ist EXECUTE fuer PUBLIC. */
    if exists (select 1 from pg_proc p
                where p.oid = to_regprocedure(v_sig)
                  and (p.proacl is null
                       or exists (select 1 from unnest(p.proacl) a
                                   where a::text ~ '^='))) then
      raise warning 'OFFEN: PUBLIC darf % noch ausfuehren (ACL-Eintrag oder leeres ACL)', v_sig;
      v_offen := v_offen + 1;
    end if;

    if not has_function_privilege('postgres', v_sig, 'execute') then
      raise exception 'Sperre Abbruch: postgres hat EXECUTE auf % verloren — die Sperre waere nicht ruecknehmbar', v_sig;
    end if;
  end loop;

  if v_offen > 0 then
    raise exception 'Sperre Abbruch: % Rolle/Funktion-Paar(e) duerfen noch ausstellen', v_offen;
  end if;

  raise notice 'Sperre haelt: keine API-Rolle darf ausstellen, postgres kann sie zuruecknehmen';
end $$;
