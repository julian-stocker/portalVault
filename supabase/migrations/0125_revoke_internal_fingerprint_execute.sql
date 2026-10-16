-- ===========================================================================
-- 0125 — EXECUTE auf purchase_receipt_fingerprint fuer `authenticated` entziehen
--
-- EINE Rechte-Zeile. Kein DDL, kein DML, keine Funktionsaenderung, keine
-- Datenaenderung. Diese Migration ist absichtlich so klein, dass sie in einem
-- Satz zurueckgenommen werden kann.
--
-- ---------------------------------------------------------------------------
-- DER BEFUND
--
-- Der Staging-Preflight zu `0124` hat gezeigt, dass `authenticated` EXECUTE
-- auf `public.purchase_receipt_fingerprint(bigint)` besitzt. Keine Migration
-- hat dieses Recht vergeben. Es stammt aus den Default-Privileges, die
-- Supabase im Schema `public` fuer `anon`, `authenticated` und `service_role`
-- einrichtet: jede neu erzeugte Funktion bekommt EXECUTE, ohne dass ein
-- `grant` im Quelltext steht.
--
-- `0122`, Zeile 368, entzieht nur zwei der drei:
--
--     revoke all on function public.purchase_receipt_fingerprint(bigint)
--       from public, anon;
--
-- Darin steckt die Annahme „kein grant = kein Recht". Auf Supabase ist sie
-- falsch. Alle anderen Funktionen in `0122` nennen `authenticated` deshalb
-- ausdruecklich — aber mit einem `grant`, weil sie fuer den eingeloggten
-- Betreiber gedacht sind. Der Fingerabdruck ist die einzige, die es nicht
-- ist, und genau bei ihr fehlt die Zeile.
--
-- DIE HAUSREGEL STAND LAENGST FEST. `purchase_market_value(bigint)` ist
-- derselbe Typ interner Helfer, und `0053` Zeile 260 sowie `0116` Zeile 122
-- entziehen ihn `from public, anon, authenticated`. Die ACL-Abfrage auf
-- Staging bestaetigt fuer ihn genau den Zustand, den diese Migration fuer den
-- Fingerabdruck herstellt: anon false, authenticated false, service_role true.
-- `0125` bringt eine Abweichung auf die Hausregel zurueck, es erfindet keine.
--
-- ---------------------------------------------------------------------------
-- WARUM DAS EIN PROBLEM IST
--
-- Die Funktion ist `security definer` mit `search_path = ''` und hat KEIN
-- Berechtigungstor im Rumpf. Sie nimmt eine beliebige `purchase_id` und liest
-- `purchases`, `purchase_items` und `skylanders` an jeder RLS vorbei. Zurueck
-- kommt ein SHA-256 — keine Namen, keine Betraege. Aber:
--
--   * Ein nicht vorhandener Einkauf ergibt den Hash des leeren Strings, eine
--     bekannte Konstante. Damit sind Anzahl und ID-Bereich aller Einkaeufe
--     fuer jedes eingeloggte Konto abzaehlbar — interne Betriebsdaten.
--   * `pg_proc.prosrc` ist weltlesbar, die Hash-Vorlage also oeffentlich.
--     Wer die uebrigen Felder eines Einkaufs kennt, kann einen geratenen
--     Absendernamen durch Hash-Vergleich bestaetigen.
--   * Wiederholte Aufrufe zeigen, WANN sich ein Ankauf geaendert hat.
--
-- Betroffen ist jedes eingeloggte Konto, auch ein frisch selbst registriertes
-- Kundenkonto — nicht nur ein Betreiber.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE MIGRATION NICHT TUT
--
--   * Sie aendert `0122` nicht. Eine angewendete Migration wird nicht
--     umgeschrieben; der Zustand wird vorwaerts korrigiert.
--   * Sie aendert die Funktion selbst nicht — kein `create or replace`, kein
--     `alter function`. Die Nachbedingung vergleicht die Definition vor und
--     nach dem `revoke` und bricht bei jeder Abweichung ab.
--   * Sie laesst `service_role` unberuehrt. Das ist eine Entscheidung, nicht
--     ein Versehen: `service_role` ist der serverseitige Schluessel, nie aus
--     einem Browser erreichbar, und umgeht RLS ohnehin bauartbedingt. Ein
--     Entzug dort waere kosmetisch und wuerde einen Unterschied behaupten,
--     den es nicht gibt. Die Nachbedingung prueft deshalb ausdruecklich, dass
--     `service_role` das Recht BEHAELT.
--   * Sie beruehrt `public` und `anon` nicht erneut: beide sind seit `0122`
--     gesperrt, und die Nachbedingung prueft, dass sie es bleiben.
--
-- ---------------------------------------------------------------------------
-- BRICHT ETWAS?
--
-- Nein, und das ist lokal nachgewiesen, nicht gehofft:
--
--   * Kein Anwendungscode ruft die Funktion per PostgREST. `grep` ueber
--     `src/` und `tools/` findet nur Treffer in Teststrings, keinen
--     `rpc("purchase_receipt_fingerprint", …)`.
--   * Ihre drei SQL-Aufrufer — `seller_purchase_receipt(bigint)`,
--     `seller_issue_purchase_receipt(bigint)` und ab `0124`
--     `purchase_receipt_stale(bigint, text)` — sind alle `security definer`
--     und gehoeren demselben Eigentuemer (`postgres`, per ACL-Abfrage
--     bestaetigt). Ein Eigentuemer hat implizite Rechte auf seine eigenen
--     Funktionen; ein `grant` an den Aufrufer ist dafuer nicht noetig. Genau
--     dieser Mechanismus traegt den Fingerabdruck seit `0122` und ist die
--     Grundlage der Schutzhuelle in `0124`.
--   * Die Vorbedingung prueft diese Eigentuemer-Identitaet, BEVOR sie etwas
--     entzieht. Stimmt sie nicht, bricht die Migration ab, statt eine
--     funktionierende Kette zu kappen.
--
-- Idempotent: ein `revoke` auf ein bereits entzogenes Recht ist ein
-- Leerlauf, kein Fehler. Die Migration darf mehrfach laufen.
--
-- RUECKNAHME, falls sie je gebraucht wird — eine Zeile:
--     grant execute on function public.purchase_receipt_fingerprint(bigint)
--       to authenticated;
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid      oid;
  v_owner    oid;
  v_fremd    text;
  v_vorher   boolean;
begin
  v_oid := to_regprocedure('public.purchase_receipt_fingerprint(bigint)');
  if v_oid is null then
    raise exception '0125 Abbruch: purchase_receipt_fingerprint(bigint) existiert nicht';
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'purchase_receipt_fingerprint') <> 1 then
    raise exception '0125 Abbruch: purchase_receipt_fingerprint ist mehrfach ueberladen';
  end if;

  /*
   * DER EIGENTUEMER IST DIE EIGENTLICHE VORBEDINGUNG.
   *
   * Nach dem `revoke` erreichen die Belegfunktionen den Fingerabdruck NUR
   * noch ueber implizite Eigentuemerrechte. Gehoerte eine von ihnen einer
   * anderen Rolle, wuerde dieser Entzug sie kappen. Hier wird das geprueft,
   * bevor etwas passiert — nicht danach.
   */
  select p.proowner into v_owner from pg_proc p where p.oid = v_oid;

  select string_agg(p.proname || ' (' || pg_get_userbyid(p.proowner) || ')', ', '
                    order by p.proname)
    into v_fremd
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('seller_purchase_receipt', 'seller_issue_purchase_receipt',
                       'purchase_receipt_stale')
     and p.proowner <> v_owner;

  if v_fremd is not null then
    raise exception
      '0125 Abbruch: % gehoert nicht dem Eigentuemer des Fingerabdrucks (%) — der Entzug wuerde die Aufrufkette kappen',
      v_fremd, pg_get_userbyid(v_owner);
  end if;

  -- Beide Belegfunktionen muessen ueberhaupt da sein; ohne sie ist dies die
  -- falsche Datenbank.
  if to_regprocedure('public.seller_purchase_receipt(bigint)') is null
     or to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is null then
    raise exception '0125 Abbruch: die Belegfunktionen aus 0122/0123 fehlen';
  end if;

  -- Und sie sind beide security definer — sonst traegt die Kette nicht.
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('seller_purchase_receipt',
                                  'seller_issue_purchase_receipt')
                and not p.prosecdef) then
    raise exception '0125 Abbruch: eine Belegfunktion ist nicht security definer';
  end if;

  v_vorher := has_function_privilege('authenticated',
                'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE');
  if v_vorher then
    raise notice '0125: authenticated hat EXECUTE — wird entzogen.';
  else
    raise notice '0125: authenticated hat bereits kein EXECUTE — Leerlauf.';
  end if;

  /*
   * DIE DEFINITION WIRD FUER DEN SPAETEREN VERGLEICH WEGGELEGT.
   *
   * In einer Sitzungsvariablen, nicht in einer temporaeren Tabelle: der
   * SQL-Editor fuehrt die Datei als eine implizite Transaktion aus, aber wer
   * sie blockweise ausfuehrt, haette mit `on commit drop` nach dem ersten
   * Block nichts mehr in der Hand. `set_config(..., false)` gilt fuer die
   * Sitzung und ueberlebt beides. Abgeraeumt wird am Ende.
   */
  perform set_config('portalvault.fp_def_0125', pg_get_functiondef(v_oid), false);
end
$$;


-- ---------------------------------------------------------------------------
-- 2. Die eine Zeile, um die es geht
-- ---------------------------------------------------------------------------
revoke execute on function public.purchase_receipt_fingerprint(bigint)
  from authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid        oid;
  v_vorher_def text;
begin
  v_oid := to_regprocedure('public.purchase_receipt_fingerprint(bigint)');

  -- ---- das Ziel ---------------------------------------------------------
  if has_function_privilege('authenticated',
       'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') then
    raise exception '0125 Abbruch: authenticated darf den Fingerabdruck weiterhin ausfuehren';
  end if;
  if has_function_privilege('anon',
       'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') then
    raise exception '0125 Abbruch: anon darf den Fingerabdruck ausfuehren';
  end if;

  /*
   * PUBLIC WIRD UEBER DEN ACL GEPRUEFT, NICHT UEBER has_function_privilege.
   *
   * `has_function_privilege('public', ...)` bricht mit `role "public" does
   * not exist` ab: `public` ist ein Pseudo-Empfaenger im ACL (grantee = 0),
   * kein Eintrag in `pg_roles`.
   *
   * Und ein NULL-ACL heisst nicht „keine Rechte", sondern „Standardrechte" —
   * fuer eine Funktion also EXECUTE fuer PUBLIC. Nach `0122` und `0125` ist
   * der ACL materialisiert; waere er NULL, waere das Gegenteil des Gewollten
   * erreicht.
   */
  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception '0125 Abbruch: der Fingerabdruck hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid
                and a.privilege_type = 'EXECUTE'
                and a.grantee = 0) then
    raise exception '0125 Abbruch: PUBLIC hat EXECUTE auf den Fingerabdruck';
  end if;

  /*
   * UND service_role BEHAELT ES — ausdrueckliche Entscheidung, siehe Kopf.
   *
   * Diese Pruefung steht hier, damit ein spaeterer, breiter formulierter
   * Entzug auffaellt, statt unbemerkt mehr zu tun als beabsichtigt.
   */
  if not has_function_privilege('service_role',
       'public.purchase_receipt_fingerprint(bigint)', 'EXECUTE') then
    raise exception '0125 Abbruch: service_role hat EXECUTE verloren — diese Migration sollte es behalten';
  end if;

  -- Genau diese drei Empfaenger, keiner mehr: Eigentuemer und service_role.
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid
                and a.privilege_type = 'EXECUTE'
                and a.grantee <> p.proowner
                and (a.grantee = 0 or a.grantee::regrole::text <> 'service_role')) then
    raise exception '0125 Abbruch: auf dem Fingerabdruck liegt ein unerwartetes EXECUTE-Recht';
  end if;

  -- ---- und nichts anderes hat sich bewegt --------------------------------
  /*
   * Fehlt der weggelegte Wert, wurde die Vorbedingung in einer anderen
   * Sitzung ausgefuehrt. Dann wird der Vergleich UEBERSPRUNGEN und das
   * ausdruecklich gesagt — eine uebersprungene Pruefung ist hinnehmbar, eine
   * bestandene, die nicht gelaufen ist, waere es nicht.
   */
  v_vorher_def := nullif(coalesce(current_setting('portalvault.fp_def_0125', true), ''), '');
  if v_vorher_def is null then
    raise notice '0125: Definitionsvergleich uebersprungen — Vorbedingung lief in einer anderen Sitzung.';
  elsif v_vorher_def is distinct from pg_get_functiondef(v_oid) then
    raise exception '0125 Abbruch: die Funktionsdefinition hat sich geaendert — diese Migration darf nur Rechte anfassen';
  end if;

  -- Die Belegfunktionen bleiben fuer den Betreiber erreichbar.
  if not has_function_privilege('authenticated',
       'public.seller_purchase_receipt(bigint)', 'EXECUTE') then
    raise exception '0125 Abbruch: seller_purchase_receipt ist fuer authenticated nicht mehr erreichbar';
  end if;
  if not has_function_privilege('authenticated',
       'public.seller_issue_purchase_receipt(bigint)', 'EXECUTE') then
    raise exception '0125 Abbruch: seller_issue_purchase_receipt ist fuer authenticated nicht mehr erreichbar';
  end if;

  perform set_config('portalvault.fp_def_0125', '', false);
  raise notice '0125 ok: Fingerabdruck nur noch ueber die Eigentuemerkette erreichbar; Belegfunktionen unveraendert.';
end
$$;
