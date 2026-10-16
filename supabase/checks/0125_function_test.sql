-- ===========================================================================
-- FUNKTIONSTEST 0125 — traegt die Eigentuemerkette nach dem Entzug?
--
--   >>> NICHT FREIGEGEBEN. NICHT AUSFUEHREN. <<<
--
--   Diese Datei braucht `set local role authenticated` — das einzige Mittel
--   in diesem Ordner, das die effektive Datenbankrolle wechselt, und das
--   einzige, fuer das keine Freigabe vorliegt. Begruendung im Abschnitt
--   „DAS IST EIN NEUES MITTEL" weiter unten.
--
-- NUR AUF STAGING. NUR LESEND. KEIN NEUER EIGENBELEG.
--
-- ---------------------------------------------------------------------------
-- ERST EINE KORREKTUR AN MIR SELBST
--
-- Im Testplan (`0125_test_plan.md`, Stufe 5) stand ein Test, der nichts
-- bewiesen haette. Er setzte `request.jwt.claims` und rief dann die
-- Funktionen auf — aber `request.jwt.claims` ist eine GUC, die `auth.uid()`
-- liest. SIE AENDERT DIE DATENBANKROLLE NICHT. Der SQL-Editor laeuft als
-- Eigentuemer (`postgres`), und ein Eigentuemer darf seine eigenen Funktionen
-- ohnehin ausfuehren — mit und ohne `revoke`.
--
-- Beide Teile waeren also trivial gruen gewesen: der Direktaufruf haette
-- funktioniert (statt zu scheitern) und der Umweg ebenfalls. Der Test haette
-- „Kette traegt" gemeldet, ohne die Kette angefasst zu haben.
--
-- WAS ES WIRKLICH BRAUCHT: `set local role authenticated`. Erst damit gelten
-- die Rechte der Rolle, um die es geht. Zusammen mit der Claim-Einstellung
-- ergibt das die vollstaendige Simulation — Rolle fuer die Rechte, `sub` fuer
-- das Betreibertor.
--
-- ---------------------------------------------------------------------------
-- DAS IST EIN NEUES MITTEL UND BRAUCHT IHRE FREIGABE
--
-- `set local role` kommt in diesem Projekt nirgends vor; `npm run
-- verify:rls:staging` arbeitet stattdessen mit echten Auth-Nutzern ueber
-- PostgREST. Was `set local role` tut und was nicht:
--
--   * Es wechselt die effektive Rolle BIS ZUM ENDE DER TRANSAKTION. `rollback`
--     und `commit` stellen beide die Sitzungsrolle wieder her.
--   * Es ist kein Schreibvorgang. Es vergibt keine Rechte und aendert keine.
--   * Es kann die Rechte nur VERKLEINERN: `authenticated` kann weniger als
--     `postgres`. Als `authenticated` greift zudem RLS auf allem, was gelesen
--     wird — strenger, nicht laxer.
--   * Es setzt voraus, dass die Sitzungsrolle Mitglied von `authenticated`
--     ist. Auf Supabase ist sie das ueblicherweise; NACHGEPRUEFT HABE ICH DAS
--     NICHT. Schritt 0 prueft es und bricht sonst ab, bevor etwas laeuft.
--
-- Wenn Sie dieses Mittel nicht einsetzen wollen: dann bleibt der Entzug
-- durch den Postflight belegt (ACL, `has_function_privilege`) und durch die
-- Oberflaeche (Stufe 6 des Testplans) — aber nicht durch einen tatsaechlichen
-- Aufruf unter der Rolle. Das waere eine kleinere Zusicherung, und sie waere
-- ehrlich benannt.
--
-- ---------------------------------------------------------------------------
-- WAS HIER NICHT PASSIERT
--
-- Kein INSERT, kein UPDATE, kein DELETE, kein DDL, kein `grant`, kein
-- `revoke`. `seller_issue_purchase_receipt` wird NICHT aufgerufen — es
-- entsteht kein Beleg. Gelesen wird der EINE bestehende Beleg.
-- `seller_record_purchase_receipt_download` wird ebenfalls nicht aufgerufen;
-- der Abrufzaehler bleibt unberuehrt.
--
-- DREI GETRENNTE LAEUFE. Schritt 2 scheitert absichtlich und bricht damit
-- seine Transaktion ab — deshalb steht er allein.
-- ===========================================================================


-- ###########################################################################
-- Schritt 0 — darf ich die Rolle ueberhaupt annehmen? (reines Lesen)
-- ###########################################################################
select
  current_user                                            as sitzungsrolle,
  pg_has_role(current_user, 'authenticated', 'MEMBER')    as darf_authenticated_werden,
  pg_has_role(current_user, 'authenticated', 'USAGE')     as darf_sie_nutzen,
  (select count(*) from public.purchase_receipts)         as belege,
  (select count(*) from public.seller_operators o
     join public.sellers s on s.id = o.seller_id
    where s.is_active and o.is_enabled)                   as betreiber;
--
-- ERWARTET: darf_authenticated_werden = true, belege = 1, betreiber = 3.
--
-- Ist `darf_authenticated_werden` false, sind Schritt 1 und 2 nicht
-- durchfuehrbar. Dann NICHT auf eine andere Methode ausweichen — berichten.


-- ###########################################################################
-- Schritt 1 — DER POSITIVE TEST: die Belegfunktion traegt den Fingerabdruck
--             durch, obwohl die Rolle ihn nicht direkt rufen darf.
-- ###########################################################################
begin;

-- Reihenfolge: zuerst die Claims, dann die Rolle. Nach dem Rollenwechsel ist
-- `set_config` auf eine `request.*`-GUC weiterhin erlaubt, aber die
-- umgekehrte Reihenfolge ist die unkompliziertere.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select x.user_id::text
              from (select o.user_id,
                           row_number() over (order by o.user_id, o.seller_id) as rang
                      from public.seller_operators o
                      join public.sellers s on s.id = o.seller_id
                     where s.is_active and o.is_enabled) x
             where x.rang = 1),      -- Rang 1 von 3, deterministisch, kein LIMIT
    'role', 'authenticated')::text,
  true) is not null as claims_gesetzt;

/*
 * DIE EINKAUFS-ID MUSS VOR DEM ROLLENWECHSEL FESTSTEHEN.
 *
 * `0122` Zeile 246 entzieht `public.purchase_receipts` ALLE Tabellenrechte
 * fuer `public, anon, authenticated`. Eine Unterabfrage auf diese Tabelle
 * NACH `set local role authenticated` wuerde mit `permission denied for table
 * purchase_receipts` scheitern — und zwar aus dem falschen Grund. Der Test
 * wuerde rot, ohne etwas ueber den Fingerabdruck zu sagen.
 *
 * Deshalb: hier als Eigentuemer ermitteln, transaktionslokal ablegen, nach
 * dem Rollenwechsel nur noch die Zahl verwenden. Ohne `limit` — bei mehr als
 * einem Beleg scheitert es sichtbar.
 */
select set_config(
  'portalvault.test_purchase_id',
  (select r.purchase_id::text from public.purchase_receipts r),
  true) as einkauf_id;

set local role authenticated;

-- Jetzt gelten die Rechte von `authenticated`, und das Betreibertor ist offen.
select
  current_user                                as rolle_im_test,
  public.can_operate_active_seller()          as tor_offen,
  (public.seller_purchase_receipt(
     current_setting('portalvault.test_purchase_id')::bigint)
   -> 'receipt' ->> 'receipt_number')         as belegnummer,
  (public.seller_purchase_receipt(
     current_setting('portalvault.test_purchase_id')::bigint)
   -> 'receipt' ->> 'stale')                  as stale;

rollback;
--
-- ERWARTET: rolle_im_test = authenticated
--           tor_offen     = true
--           belegnummer   = SI-E-2026-000001   (STAGING-TESTREFERENZ:
--                           der einzige auf Staging ausgestellte Eigenbeleg;
--                           keine Production-Belegnummer)
--           stale         = false
--
-- DAS IST DER BEWEIS, UM DEN ES GEHT. Die Rolle `authenticated` darf den
-- Fingerabdruck nicht direkt rufen (Schritt 2), kommt aber ueber die
-- `security definer`-Funktion desselben Eigentuemers an das Ergebnis — genau
-- die Kette, auf der auch die Schutzhuelle aus `0124` ruht.
--
-- SCHEITERT ES MIT `permission denied for function
-- purchase_receipt_fingerprint`, ist `0125` zu breit geraten und
-- zurueckzunehmen:
--     grant execute on function public.purchase_receipt_fingerprint(bigint)
--       to authenticated;
--
-- Die Unterabfrage ohne `limit` in der `set_config`-Zeile ist Absicht: bei
-- mehr als einem Beleg scheitert sie mit `more than one row returned by a
-- subquery used as an expression`, statt einen beliebigen zu nehmen. Heute
-- gibt es genau einen (Preflight 903 = 1).
--
-- Ob der SQL-Editor das Ergebnis eines SELECT vor einem `rollback` anzeigt,
-- ist ungeprueft — dieselbe Einschraenkung wie bei der 0124-Baseline, mit
-- demselben Ausweichweg (`commit` statt `rollback`; es wurde nichts
-- geschrieben, und `SET LOCAL` endet mit der Transaktion ohnehin).


-- ###########################################################################
-- Schritt 2 — DER NEGATIVE TEST. Allein ausfuehren: er scheitert absichtlich.
-- ###########################################################################
begin;

-- Wieder zuerst als Eigentuemer: die Tabelle ist fuer `authenticated` gesperrt.
select set_config(
  'portalvault.test_purchase_id',
  (select r.purchase_id::text from public.purchase_receipts r),
  true) as einkauf_id;

set local role authenticated;

select public.purchase_receipt_fingerprint(
         current_setting('portalvault.test_purchase_id')::bigint)
       as darf_ich_das;

rollback;
--
-- ERWARTET: die Abfrage SCHEITERT mit
--
--     ERROR: permission denied for function purchase_receipt_fingerprint
--
-- DAS IST DER ERFOLGSFALL. Kommt stattdessen ein Hash zurueck, hat `0125`
-- sein Ziel NICHT erreicht — dann stoppen und den ACL erneut lesen.
--
-- Der Fehler bricht die Transaktion ab; das `rollback` darunter laeuft dann
-- ins Leere und stellt die Sitzungsrolle wieder her. Falls der Editor in
-- einem Fehlerzustand verharrt, genuegt ein `rollback;` als eigener Lauf.
--
-- Zur Sicherheit danach einmal gegenpruefen, dass die Sitzung wieder die
-- eigene Rolle hat:
--     select current_user;
