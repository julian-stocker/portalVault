-- ===========================================================================
-- 0124 — Fehlerfall der Fingerabdruck-Berechnung
--        ISOLIERTE WEGWERF-DATENBANK, NICHT STAGING, NICHT PRODUCTION
-- ===========================================================================
--
-- Diese Datei ersetzt `public.purchase_receipt_fingerprint` durch eine
-- Fassung, die bewusst scheitert. Auf einer benutzten Datenbank ist das auch
-- innerhalb einer zurueckgerollten Transaktion falsch: die DDL haelt bis zum
-- `rollback` eine Sperre auf dem `pg_proc`-Eintrag, und jede gleichzeitige
-- Orderbuchabfrage haengt daran. Auf Staging arbeitet derselbe Betreiber, der
-- dort im Browser testet.
--
-- WOHIN SIE GEHOERT: eine leere PostgreSQL-Datenbank mit den Migrationen
-- 0001..0124, die danach weggeworfen wird — ein Supabase-Branch, ein lokaler
-- Stack per `supabase db reset`, ein `docker run postgres`.
--
--   NICHT AUSGEFUEHRT, UND VON HIER AUS NICHT AUSFUEHRBAR. Dieses Projekt
--   hat kein lokales PostgreSQL, keinen Docker, keine Supabase-CLI und keinen
--   Postgres-Treiber; der gesamte Werkzeugkasten spricht ausschliesslich
--   PostgREST. Was hier steht, ist statisch gegen 0053, 0122, 0123 und 0124
--   geprueft und auf keiner Datenbank gelaufen. Die Aussage „der Ledger
--   ueberlebt einen Fingerabdruck-Fehler" ist damit begruendet, nicht
--   gemessen. Die statische Entsprechung steht in
--   `src/lib/orderbook/receipt-status.test.ts`, Abschnitt 7 (18 Tests).
--
-- WAS SIE BEWEISEN WUERDE: dass eine Ausnahme in der Vergleichsberechnung
-- genau eine Zelle auf „unbekannt" setzt. Ohne `purchase_receipt_stale`
-- schlaegt der ganze Ledger-RPC fehl, `fetchLedger` faengt das ab und gibt
-- eine leere Liste zurueck — das Orderbuch wirkt dann geloescht.
--
-- WAS SIE AN BESTEHENDEN BELEGEN AENDERT: nichts. Sie stellt ueber den
-- echten RPC einen eigenen Beleg auf einen eigenen Einkauf aus und entfernt
-- beide am Ende. Bestehende Belege werden nicht gelesen, nicht verglichen und
-- nicht angefasst.
--
-- VORAUSSETZUNG, die diese Datei NICHT herstellt: ein `sellers`-Satz mit
-- vollstaendigen Geschaeftsdaten (`seller_issue_purchase_receipt` kopiert
-- `buyer_legal_name`, `buyer_street`, `buyer_postal_code`, `buyer_city`,
-- `buyer_country` — alle NOT NULL) und genau ein freigeschalteter Betreiber
-- dazu. Auf einer frisch migrierten Datenbank existiert beides nicht; es muss
-- vorher mit erkennbar fiktiven Werten angelegt werden. Schritt 0 prueft das
-- und bricht sonst ab, statt mit einer NOT-NULL-Verletzung mitten im Lauf zu
-- scheitern.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Schritt 0 — Nachweis, dass dies eine Wegwerf-Instanz ist, und dass die
--             Voraussetzungen stehen
-- ---------------------------------------------------------------------------
do $$
declare
  v_belege    bigint;
  v_kaeufe    bigint;
  v_betreiber bigint;
begin
  select count(*) into v_belege from public.purchase_receipts;
  select count(*) into v_kaeufe from public.purchases;

  -- Jede benutzte Umgebung hat Belege und mehr als eine Handvoll Einkaeufe
  -- und faellt damit durch. Konkrete Bestandszahlen stehen hier absichtlich
  -- nicht: diese Datei liegt im Repository, und Lager- und Orderzahlen
  -- gehoeren dort nicht hinein (CLAUDE.md, Regel 3).
  if v_belege > 0 or v_kaeufe > 3 then
    raise exception
      'ABBRUCH: % Belege, % Einkaeufe — das ist keine leere Wegwerf-Instanz.',
      v_belege, v_kaeufe;
  end if;

  select count(*) into v_betreiber
    from public.seller_operators o
    join public.sellers s on s.id = o.seller_id
   where s.is_active and o.is_enabled;

  if v_betreiber <> 1 then
    raise exception
      'ABBRUCH: % freigeschaltete Betreiber, genau einer wird gebraucht.',
      v_betreiber;
  end if;

  raise notice 'Wegwerf-Instanz: % Belege, % Einkaeufe, 1 Betreiber.',
    v_belege, v_kaeufe;
end
$$;

-- ---------------------------------------------------------------------------
-- Schritt 1 — ein eigener Einkauf und ein Beleg darauf, ueber den ECHTEN RPC
--
-- Nicht per Hand in `purchase_receipts` schreiben. Der RPC aus `0122`/`0123`
-- kennt den Zaehler, die Geschaeftsdaten, die Formatversion und den
-- Fingerabdruck; eine nachgebaute Einfuegung waere eine zweite Wahrheit, die
-- genau dann auseinanderlaeuft, wenn man sich auf sie verlaesst.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select o.user_id::text
              from public.seller_operators o
              join public.sellers s on s.id = o.seller_id
             where s.is_active and o.is_enabled),
    'role', 'authenticated')::text,
  true) is not null as claims_gesetzt;

insert into public.purchases (purchased_at, total_cost, currency, source, note)
values (date '2026-01-02', 10.00, 'EUR', 'manual', 'FEHLERFALL-TEST 0124');

select public.seller_issue_purchase_receipt(
         (select id from public.purchases where note = 'FEHLERFALL-TEST 0124')
       ) as beleg;

commit;

-- ---------------------------------------------------------------------------
-- Schritt 2 — Zustand VOR dem Fehler: der Vergleich liefert `false`
--
-- `false` heisst „stimmt ueberein". Das ist der Normalfall, und er muss
-- stehen, bevor der Fehler etwas beweisen kann.
-- ---------------------------------------------------------------------------
select
  'vorher' as phase,
  p.id,
  r.receipt_number,
  public.purchase_receipt_stale(p.id, r.content_fingerprint) as receipt_stale
from public.purchases p
join public.purchase_receipts r on r.purchase_id = p.id
where p.note = 'FEHLERFALL-TEST 0124';
-- ERWARTET: receipt_stale = false

-- ---------------------------------------------------------------------------
-- Schritt 3 — die Fingerabdruck-Funktion bewusst zum Scheitern bringen
--
-- Der echte Rumpf wird vorher weggesichert, damit Schritt 6 ihn exakt
-- zuruecklegt und nicht eine nachgebaute Fassung.
-- ---------------------------------------------------------------------------
create table if not exists pg_temp.fp_backup as
select pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'purchase_receipt_fingerprint';

select case when count(*) = 1 then 'Rumpf gesichert'
            else 'ABBRUCH: Rumpf nicht eindeutig gesichert' end as sicherung
from pg_temp.fp_backup;

create or replace function public.purchase_receipt_fingerprint(p_purchase_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fp$
begin
  -- Vier Faelle, einer pro Lauf freigeschaltet. Sie unterscheiden sich darin,
  -- WIE PL/pgSQL sie weitergibt — und `when others` faengt nicht jeden.
  raise exception 'FEHLERFALL-TEST: Fingerabdruck absichtlich gescheitert';  -- (a) P0001
  -- return (1 / 0)::text;                                                   -- (b) division_by_zero
  -- return null;                                                            -- (c) kein Fehler
  -- assert false, 'FEHLERFALL-TEST assert';                                 -- (d) assert_failure
end
$fp$;

-- ---------------------------------------------------------------------------
-- Schritt 4 — der Vergleich liefert jetzt NULL und scheitert nicht
-- ---------------------------------------------------------------------------
select
  'nachher' as phase,
  p.id,
  r.receipt_number,
  public.purchase_receipt_stale(p.id, r.content_fingerprint) as receipt_stale,
  public.purchase_receipt_stale(p.id, r.content_fingerprint) is null as ist_unbekannt
from public.purchases p
join public.purchase_receipts r on r.purchase_id = p.id
where p.note = 'FEHLERFALL-TEST 0124';
--
-- ERWARTET bei (a) und (b): receipt_stale = NULL, ist_unbekannt = true
-- ERWARTET bei (c):         receipt_stale = TRUE. Kein Fehler, sondern eine
--                           echte Abweichung: NULL `is distinct from` dem
--                           gespeicherten Hash. Richtig so — ein leerer
--                           Fingerabdruck ist nicht derselbe Beleg.
-- ERWARTET bei (d):         die Abfrage SCHEITERT. `assert_failure` wird von
--                           `when others` nicht gefangen, ebenso wenig
--                           `query_canceled`. Das ist bekannt und hingenommen:
--                           die echte Fingerabdruck-Funktion enthaelt kein
--                           `assert`, und ein abgebrochener Statement-Timeout
--                           soll auch nicht als „unbekannt" durchgehen.

-- ---------------------------------------------------------------------------
-- Schritt 5 — DER EIGENTLICHE TEST: der Ledger liefert weiter Zeilen
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select o.user_id::text
              from public.seller_operators o
              join public.sellers s on s.id = o.seller_id
             where s.is_active and o.is_enabled),
    'role', 'authenticated')::text,
  true) is not null as claims_gesetzt;

-- Fuenf Parameter: p_year, p_month, p_search, p_undated, p_status (`0124`,
-- Zeilen 233-237). Der Schluessel heisst `purchases`, nicht `rows`.
select
  jsonb_array_length(e -> 'purchases')                   as zeilen,
  jsonb_exists(e -> 'purchases' -> 0, 'receipt_stale')   as schluessel_da,
  (e -> 'purchases' -> 0 -> 'receipt_stale') = 'null'::jsonb as wert_ist_null,
  e -> 'purchases' -> 0 -> 'status_known'                as status_known,
  e -> 'purchases' -> 0 ->> 'receipt_number'             as beleg
from public.seller_orderbook_ledger(null, null, null, false, 'normal') as e;

rollback;
--
-- ERWARTET: zeilen >= 1   ← das ist der Beweis.
--           schluessel_da = true
--           wert_ist_null = true
--           status_known  = true
--           beleg         = die Belegnummer aus Schritt 1
--
-- SCHEITERT DIE ABFRAGE STATTDESSEN, ist die Schutzhuelle unwirksam und
-- `0124` darf nicht auf Staging laufen. Dann STOPPEN — nicht nachbessern,
-- nicht die Spalte anpassen.
--
-- Ob der SQL-Editor das Ergebnis eines SELECT vor einem `rollback` anzeigt,
-- ist ungeprueft; dieselbe Einschraenkung wie in `0124_baseline.sql`,
-- mit denselben zwei Ausweichwegen (`commit` statt `rollback`, oder zwei
-- getrennte Laeufe).

-- ---------------------------------------------------------------------------
-- Schritt 6 — die echte Funktion zuruecklegen und die Testdaten entfernen
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select def into strict v_def from pg_temp.fp_backup;
  execute v_def;
  raise notice 'Fingerabdruck-Funktion aus der Sicherung wiederhergestellt.';
end
$$;

-- Gegenprobe: wirklich die alte Fassung, nicht eine aehnliche.
select case
         when pg_get_functiondef(p.oid) = (select def from pg_temp.fp_backup)
           then 'identisch wiederhergestellt'
         else 'ABWEICHUNG — stimmt nicht mit der Sicherung ueberein'
       end as wiederherstellung
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'purchase_receipt_fingerprint';

-- ---------------------------------------------------------------------------
-- Schritt 7 — NICHT aufraeumen, sondern wegwerfen
--
-- Ein `delete from public.purchase_receipts` IST NICHT MOEGLICH, und das ist
-- Absicht: `purchase_receipts_immutable_trg` (`0122`, Zeile 296) feuert
-- `before update or delete` und wirft bedingungslos
--
--     ERROR: an issued receipt cannot be changed or removed (purchase_receipts)
--     SQLSTATE: 2F000 (restrict_violation)
--
-- Ein ausgestellter Beleg hat keinen Rueckweg — auch nicht auf einer
-- Testinstanz, auch nicht als Eigentuemer der Tabelle. Deshalb endet diese
-- Datei nicht mit einem Aufraeumschritt, sondern mit dem Satz:
--
--   DIE INSTANZ WIRD WEGGEWORFEN, NICHT GEPUTZT.
--
-- Genau darum darf sie nie Staging oder Production sein, und genau darum
-- steht Schritt 0 am Anfang.
--
-- Als letzte Pruefung ist dieser Riegel selbst eine Zusicherung wert — sie
-- MUSS scheitern:
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    delete from public.purchase_receipts
     where purchase_id in (select id from public.purchases
                            where note = 'FEHLERFALL-TEST 0124');
    raise exception
      'ABBRUCH: der Beleg liess sich loeschen — der Unveraenderlichkeits-Riegel aus 0122 ist unwirksam.';
  exception
    when restrict_violation then
      raise notice 'Riegel wirkt: der ausgestellte Beleg laesst sich nicht loeschen.';
  end;
end
$$;
