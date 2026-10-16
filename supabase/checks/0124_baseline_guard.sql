-- ===========================================================================
-- DIAGNOSE zur 0124-Baseline — warum sagt die Wache nicht `OK`?
--
-- NUR AUF STAGING. NUR LESEND. KEIN absichtlicher Fehler, kein Abbruch:
-- diese Datei nennt den Grund und laeuft dabei durch.
--
-- WANN SIE SIE BRAUCHEN: `0124_baseline.sql` zeigt in `verdikt` etwas anderes
-- als `OK`, und die Hashspalten tragen `KEINE_BASELINE`. Dann sagt diese
-- Datei, welche der fuenf Bedingungen gekippt ist — jede als eigene Spalte,
-- damit nicht nur der erste Grund sichtbar ist, sondern alle.
--
-- DEN RANG HIER GENAUSO SETZEN wie in `0124_baseline.sql`, Schritt 1.
--
-- ---------------------------------------------------------------------------
-- WAS SIE AN DER DATENBANK TUT: NICHTS DAUERHAFTES
--
-- Kein INSERT, kein UPDATE, kein DELETE, kein DDL, keine Rollenumschaltung.
-- Drei transaktionslokale Einstellungen, `rollback` am Ende. Ausgegeben werden
-- Zahlen und Wahrheitswerte — keine Betreiber-UUID, keine Personendaten.
-- ===========================================================================

begin;

-- Dieselben zwei Zahlen wie in der Baseline — und ebenso
-- umgebungsabhaengig: Staging 3, Production 1 (gemessen 2026-10-16).
-- Die geltende Zahl steht in Pruefung 310 des Preflights.
select set_config('portalvault.baseline_rang',               '1', true) as rang,
       set_config('portalvault.baseline_betreiber_erwartet',  '3', true) as erwartet;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select x.user_id::text
              from (select o.user_id,
                           row_number() over (order by o.user_id, o.seller_id) as rang
                      from public.seller_operators o
                      join public.sellers s on s.id = o.seller_id
                     where s.is_active and o.is_enabled) x
             where x.rang = current_setting('portalvault.baseline_rang')::int),
    'role', 'authenticated')::text,
  true) is not null as claims_gesetzt;

with
lauf (rang, anzahl_erwartet) as (
  values (nullif(current_setting('portalvault.baseline_rang', true), '')::int,
          nullif(current_setting('portalvault.baseline_betreiber_erwartet', true), '')::int)
),
betreiber as (
  select o.user_id,
         row_number() over (order by o.user_id, o.seller_id) as rang
    from public.seller_operators o
    join public.sellers s on s.id = o.seller_id
   where s.is_active and o.is_enabled
)
select
  (select p.rang from lauf p)                            as rang,
  (select p.anzahl_erwartet from lauf p)                 as anzahl_erwartet,
  (select count(*) from betreiber)                       as betreiber_anzahl,
  (select count(*) from betreiber b, lauf p
    where b.rang = p.rang)                               as konten_mit_diesem_rang,
  public.can_operate_active_seller()                     as tor_offen,
  (select count(*) from betreiber b, lauf p
    where b.rang = p.rang
      and b.user_id = (select auth.uid()))               as rang_und_simulation_einig,
  /* Ist ueberhaupt ein Claim gesetzt? NULL hiesse: Schritt 2 hat nicht gewirkt. */
  ((select auth.uid()) is not null)                      as claim_gesetzt,
  /* Und dasselbe Verdikt, das die Baseline bildet — zum direkten Abgleich. */
  case
    when (select p.rang from lauf p) is null
      or (select p.anzahl_erwartet from lauf p) is null
      then 'ABBRUCH_LAUF_NICHT_GESETZT_SCHRITT_1_FEHLT'
    when (select count(*) from betreiber)
         <> (select p.anzahl_erwartet from lauf p)
      then 'ABBRUCH_BETREIBERZAHL_IST_'
           || (select count(*) from betreiber)::text
           || '_ERWARTET_' || (select p.anzahl_erwartet from lauf p)::text
    when (select count(*) from betreiber b, lauf p where b.rang = p.rang) <> 1
      then 'ABBRUCH_RANG_' || (select p.rang from lauf p)::text
           || '_NICHT_EINDEUTIG_VON_' || (select count(*) from betreiber)::text
    when not public.can_operate_active_seller()
      then 'ABBRUCH_TOR_GESCHLOSSEN_BEI_'
           || (select count(*) from betreiber)::text || '_BETREIBERN'
    when (select count(*) from betreiber b, lauf p
           where b.rang = p.rang
             and b.user_id = (select auth.uid())) <> 1
      then 'ABBRUCH_RANG_UND_SIMULATION_UNEINIG_RANG_'
           || (select p.rang from lauf p)::text
    else 'OK'
  end                                                    as verdikt;

rollback;
--
-- ERWARTET auf Staging, Rang 1 bis 3:
--   rang = 1|2|3 · anzahl_erwartet = 3 · betreiber_anzahl = 3
--   konten_mit_diesem_rang = 1 · tor_offen = true
--   rang_und_simulation_einig = 1 · claim_gesetzt = true · verdikt = OK
--
-- WAS WELCHE SPALTE BEDEUTET, WENN SIE KIPPT:
--
--   betreiber_anzahl <> 3        Ein Betreiberkonto ist hinzugekommen oder
--                                weggefallen. Die Raenge haben sich dadurch
--                                verschoben — die Baseline ist NEU zu erheben,
--                                nicht gegen eine aeltere zu vergleichen.
--   konten_mit_diesem_rang <> 1  Der eingestellte Rang liegt ausserhalb
--                                1..betreiber_anzahl.
--   claim_gesetzt = false        Schritt 2 hat nicht gewirkt: entweder wurde er
--                                uebersprungen, oder er lief in einer anderen
--                                Transaktion als dieser Block.
--   tor_offen = false            Der Claim ist gesetzt, passt aber zu keinem
--                                freigeschalteten Betreiber eines aktiven
--                                Verkaeufers. Pruefen, ob `sellers.is_active`
--                                oder `seller_operators.is_enabled` gekippt ist.
--   rang_und_simulation_einig <> 1  Schritt 2 und die Pruefliste meinen
--                                verschiedene Konten. Seit der Rang nur noch an
--                                EINER Stelle steht, sollte das nicht mehr
--                                vorkommen; tritt es auf, ist an der Mechanik
--                                etwas anders als gedacht — dann STOPPEN.
