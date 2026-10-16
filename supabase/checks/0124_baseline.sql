-- ===========================================================================
-- STAGING-BASELINE fuer Migration 0124
--
-- NUR AUF STAGING. Diese Datei stellt die Sitzung voruebergehend auf einen
-- Betreiber um; auf Production hat sie nichts zu suchen.
--
-- ---------------------------------------------------------------------------
-- WAS SIE BEWEIST
--
-- `0124` ersetzt die Funktion, von der die ganze Orderbuchseite lebt. Dass
-- Filter, Suche, Summen, Klassifikation und Sortierung unveraendert sind,
-- behaupten die Nachbedingungen der Migration anhand von Textmarken im Rumpf.
-- Das ist eine Behauptung ueber den QUELLTEXT.
--
-- Diese Datei prueft die AUSGABE. Sie ruft den Ledger ueber alle
-- Filterkombinationen, entfernt aus jeder Zeile die elf neuen Schluessel und
-- bildet darueber einen SHA-256. Bleibt dieser Hash gleich, ist jedes alte
-- Feld jeder alten Zeile in derselben Reihenfolge noch da — bewiesen, nicht
-- behauptet. (jsonb normalisiert die Schluesselreihenfolge, deshalb ergibt
-- das Abstreifen exakt das alte Objekt.)
--
-- ---------------------------------------------------------------------------
-- SECHS LAEUFE: DREI BETREIBER x VORHER/NACHHER
--
-- Staging hat drei aktive, freigeschaltete Betreiberkonten. Statt einen
-- auszuwaehlen, wird jeder gemessen:
--
--   Lauf 1: RANG 1, vor der Migration     Lauf 4: RANG 1, nach der Migration
--   Lauf 2: RANG 2, vor der Migration     Lauf 5: RANG 2, nach der Migration
--   Lauf 3: RANG 3, vor der Migration     Lauf 6: RANG 3, nach der Migration
--
-- ZWEI GLEICHHEITEN MUESSEN GELTEN:
--   (a) QUER: Lauf 1, 2 und 3 muessen in `alt_hash`, `summe_hash`, `ids`,
--       `zeilen` und `klassen` untereinander gleich sein — ebenso 4, 5, 6.
--   (b) LAENGS: Lauf 1 gegen 4, 2 gegen 5, 3 gegen 6. Nur `mit_status`,
--       `mit_beleg`, `abweichend` und `unbekannt` duerfen sich aendern.
--
-- (a) BEWEIST, WAS SONST NUR BEHAUPTET WAERE. Der Ledger-Rumpf erwaehnt den
-- Betreiber genau einmal, als Tor:
--
--     if not public.can_operate_active_seller() then
--
-- Kein `auth.uid()`, kein `seller_id`, kein Join auf `sellers` — ueber 261
-- Rumpfzeilen. Das Orderbuch ist global. Aus der Quelle folgt also, dass die
-- Ausgabe nicht davon abhaengt, WER sie abruft; (a) misst das.
--
-- ---------------------------------------------------------------------------
-- SO STELLEN SIE DEN LAUF UM: EINE ZAHL, EINE STELLE
--
-- In Schritt 1, der ersten Anweisung nach `begin;`:
--
--     select set_config('portalvault.baseline_rang', '1', true) ...
--                                                     ^^^
--
-- Das ist die EINZIGE Stelle. Die frueheren Fassungen trugen die Rangzahl an
-- zwei Stellen — in der Claim-Einstellung und in der Pruefliste —, und ein
-- halb geaenderter Lauf haette Lauf 2 beschriftet und Lauf 1 gemessen. Jetzt
-- liegt sie in einer transaktionslokalen Einstellung, aus der beide lesen.
-- Die Wache vergleicht trotzdem weiter das tatsaechlich simulierte Konto
-- gegen den Rang (`ABBRUCH_RANG_UND_SIMULATION_UNEINIG`); diese Pruefung ist
-- jetzt eine Zusicherung ueber die Mechanik statt ein Netz unter einem
-- Abschreibfehler.
--
-- Die erwartete Betreiberzahl steht daneben, in derselben Anweisung. Sie
-- gehoert in die Datei: erscheint ein vierter Betreiber, verschieben sich die
-- Raenge, und dann darf die Baseline NICHT stillschweigend etwas anderes
-- messen.
--
-- ---------------------------------------------------------------------------
-- WIE EIN SCHLECHTER ZUSTAND AUSSIEHT — UND WARUM ER KEINE BASELINE ERGIBT
--
-- Die Wache liefert einen TEXTSTATUS, keinen absichtlichen SQL-Fehler. Die
-- Vorfassung tat das Gegenteil und war dadurch unbrauchbar: sie stand als
--
--     then 'ABBRUCH_BETREIBERZAHL_WEICHT_AB'::int
--
-- in einem `CASE`, und ein konstanter Cast von Text nach Integer wird von
-- PostgreSQL BEIM PLANEN ausgewertet — `CASE` schuetzt davor nicht (Handbuch,
-- „Conditional Expressions"). Die Abfrage brach deshalb immer ab, bei jeder
-- Betreiberzahl, mit offenem wie geschlossenem Tor, und nannte als Grund
-- schlicht den ersten dieser Casts im Quelltext. Sie hat nie gelaufen.
--
-- Jetzt gilt:
--
--   * `verdikt` steht in JEDER Ausgabezeile. Es ist `OK` oder `ABBRUCH_...`
--     mit den tatsaechlichen Zahlen darin.
--   * IST ES NICHT `OK`, WIRD DER LEDGER NICHT GERUFEN. Das ist kein
--     Reihenfolgenversprechen, sondern eine Filterbedingung: `roh` hat dann
--     keine Zeilen, und eine Funktion im Ergebnisausdruck wird nur fuer
--     ueberlebende Zeilen ausgewertet.
--   * `ids`, `alt_hash`, `summe_hash` und `klassen` tragen dann `KEINE_BASELINE`
--     statt eines Wertes. Ein Hash hat 64 Hexzeichen; `KEINE_BASELINE` ist
--     keiner und kann mit keinem verwechselt werden.
--
-- ABNAHMEREGEL — beide Bedingungen, sonst ist es keine Baseline:
--
--   1. `verdikt` = `OK` in JEDER Zeile.
--   2. `alt_hash` und `summe_hash` sind 64 Hexzeichen lang.
--
-- Trifft eines davon nicht zu, ist der Lauf zu verwerfen. Fuer den Grund ohne
-- Abbruch: `0124_baseline_guard.sql`.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI AN DER DATENBANK TUT: NICHTS DAUERHAFTES
--
-- Kein INSERT, kein UPDATE, kein DELETE, kein DDL. Drei transaktionslokale
-- Einstellungen (`portalvault.baseline_rang`,
-- `portalvault.baseline_betreiber_erwartet`, `request.jwt.claims`), damit
-- `auth.uid()` die Betreiber-ID liefert und `can_operate_active_seller()` wahr
-- wird — ohne das bricht jeder Ledger-Aufruf mit `seller operator role
-- required` ab, denn im SQL-Editor gibt es kein JWT. `set_config(..., true)`
-- ist `SET LOCAL` und endet mit der Transaktion, gleich ob sie committet oder
-- zurueckrollt.
--
-- KEINE ROLLENUMSCHALTUNG. Kein `set role`, kein `set local role`. Simuliert
-- werden die Claims, nicht die Rolle; die effektiven Rechte bleiben die der
-- Editor-Sitzung. Fuer die Baseline ist das richtig, denn gemessen wird die
-- AUSGABE des Ledgers, und der ist `security definer` und laeuft ohnehin als
-- Eigentuemer.
--
-- Jede Funktion in der Kette ist `stable` — `seller_orderbook_ledger`,
-- `can_operate_active_seller`, `purchase_market_value`, `purchase_receipt_stale`,
-- `purchase_receipt_fingerprint`, `auth.uid()`. PostgreSQL verbietet
-- datenveraenderndes SQL in einer nicht-volatilen Funktion; das ist eine
-- Durchsetzung durch den Server, keine Verabredung.
--
-- ---------------------------------------------------------------------------
-- OB DER SQL-EDITOR DAS ERGEBNIS ZEIGT: UNGEPRUEFT
--
-- Die Datei enthaelt vier Anweisungen, und die letzte ist `rollback`. Ob der
-- Supabase-Editor das Ergebnis des SELECT aus Schritt 3 dann anzeigt, ist
-- nicht verifiziert. Zwei Ausweichwege:
--
--   a) `rollback;` durch `commit;` ersetzen. Gefahrlos: es wurde nichts
--      geschrieben, und `SET LOCAL` endet mit der Transaktion ohnehin.
--   b) Die Schritte als getrennte Laeufe ausfuehren, ohne `begin`/`rollback`;
--      dann gelten die Einstellungen fuer die Sitzung, und hinterher mit
--          select set_config('request.jwt.claims', '', false),
--                 set_config('portalvault.baseline_rang', '', false);
--      zuruecksetzen.
--
-- ---------------------------------------------------------------------------
-- KEINE PERSONENBEZOGENEN DATEN IN DER AUSGABE
--
-- Ausgegeben werden `rang` (1, 2 oder 3), `betreiber_anzahl`, Zahlen,
-- Einkaufs-IDs und Hashes. Die Betreiber-UUID wird gesetzt, aber NICHT
-- ausgegeben — auch nicht gekuerzt und nicht gehasht. Namen, Anschriften und
-- Notizen stehen in den gehashten Zeilen, aber nirgends im Ergebnis.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Schritt 1: den Lauf festlegen. DIE EINZIGE STELLE, DIE SIE AENDERN.
--
-- BEIDE ZAHLEN SIND UMGEBUNGSABHAENGIG — es gibt keinen Standardwert.
--
--   Staging     3 Betreiber   -> Raenge 1, 2, 3
--   Production  1 Betreiber   -> nur Rang 1        (gemessen 2026-10-16)
--
-- Die `3` unten ist der Staging-Wert, nicht der Normalfall. Wer sie auf
-- Production stehen laesst, bekommt
--     ABBRUCH_BETREIBERZAHL_IST_1_ERWARTET_3
-- und damit einen sichtbaren Abbruch statt einer stillen Fehlmessung — die
-- Wache ist genau dafuer da. Die geltende Zahl steht in Pruefung 310 des
-- Preflights.
-- ---------------------------------------------------------------------------
select set_config('portalvault.baseline_rang',               '1', true) as rang,
       set_config('portalvault.baseline_betreiber_erwartet',  '3', true) as erwartet;


-- ---------------------------------------------------------------------------
-- Schritt 2: die Sitzung fuer DIESE Transaktion auf den Betreiber mit diesem
--            Rang stellen. Der Rang kommt aus Schritt 1, nicht aus dem Text.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- Schritt 3: die Baseline. Ein einziges SELECT.
-- ---------------------------------------------------------------------------
with
/*
 * DER LAUF, GELESEN STATT GESCHRIEBEN.
 *
 * `current_setting(..., true)` ist die nachsichtige Form: fehlt die
 * Einstellung, kommt NULL statt eines Fehlers. Die Wache macht daraus
 * `ABBRUCH_LAUF_NICHT_GESETZT` — das ist die Lage, wenn jemand Schritt 3
 * allein ausfuehrt, und sie soll sich erklaeren und nicht nur scheitern.
 */
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
),

/*
 * DIE WACHE — EIN TEXTSTATUS, KEIN ABSICHTLICHER FEHLER.
 *
 * Die Reihenfolge der Faelle ist die Aussage: fehlt der Lauf, ist alles
 * andere bedeutungslos; stimmt die Betreiberzahl nicht, sind die Raenge
 * verschoben; erst danach lohnt die Frage nach Tor und Simulation.
 *
 * Keine konstanten Casts. Jeder Zweig baut nur Text.
 */
wache (verdikt) as (
  select case
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
                  || '_NICHT_EINDEUTIG_VON_'
                  || (select count(*) from betreiber)::text
           when not public.can_operate_active_seller()
             then 'ABBRUCH_TOR_GESCHLOSSEN_BEI_'
                  || (select count(*) from betreiber)::text || '_BETREIBERN'
           when (select count(*) from betreiber b, lauf p
                  where b.rang = p.rang
                    and b.user_id = (select auth.uid())) <> 1
             then 'ABBRUCH_RANG_UND_SIMULATION_UNEINIG_RANG_'
                  || (select p.rang from lauf p)::text
           else 'OK'
         end
),

/*
 * DIE FILTERKOMBINATIONEN.
 *
 * Zwoelf feste plus je eine fuer jedes Jahr und jeden Monat, die in den Daten
 * wirklich vorkommen — abgeleitet statt eingetragen, damit die Abdeckung mit
 * den Daten mitwaechst und nicht an einer Jahreszahl im Quelltext haengt.
 */
fest (nr, label, y, m, q, u, s) as (
  values
    ( 1, 'alles · any',              null::int, null::int, null::text, false, 'any'),
    ( 2, 'alles · normal',           null, null, null, false, 'normal'),
    ( 3, 'alles · incomplete',       null, null, null, false, 'incomplete'),
    ( 4, 'alles · open',             null, null, null, false, 'open'),
    ( 5, 'alles · test',             null, null, null, false, 'test'),
    ( 6, 'undatiert · any',          null, null, null, true,  'any'),
    ( 7, 'undatiert · normal',       null, null, null, true,  'normal'),
    ( 8, 'Suche Text',               null, null, 'spyro', false, 'any'),
    ( 9, 'Suche Zahl deutsch',       null, null, '67,02', false, 'any'),
    (10, 'Suche Zahl englisch',      null, null, '67.02', false, 'any'),
    (11, 'Suche SKY-ID',             null, null, 'SKY-0001', false, 'any'),
    (12, 'Suche ohne Treffer',       null, null, 'zzzqqqxxx', false, 'any')
),
jahre (nr, label, y, m, q, u, s) as (
  select 100 + row_number() over (order by j)::int,
         'Jahr ' || j::text, j, null::int, null::text, false, 'any'
    from (select distinct extract(year from purchased_at)::int as j
            from public.purchases where purchased_at is not null) x
),
monate (nr, label, y, m, q, u, s) as (
  select 200 + row_number() over (order by j, mo)::int,
         'Monat ' || j::text || '-' || lpad(mo::text, 2, '0'), j, mo, null::text, false, 'any'
    from (select distinct extract(year  from purchased_at)::int as j,
                 extract(month from purchased_at)::int as mo
            from public.purchases where purchased_at is not null) x
),
combos as (
  select * from fest union all select * from jahre union all select * from monate
),

/*
 * DER AUFRUF — NUR WENN DIE WACHE `OK` SAGT.
 *
 * Die Filterbedingung ist der Grund, warum kein Reihenfolgenversprechen
 * noetig ist: ist `verdikt` nicht `OK`, hat `roh` keine Zeilen, und eine
 * Funktion im Ergebnisausdruck wird nur fuer ueberlebende Zeilen ausgewertet.
 * Der Ledger wird dann nicht gerufen.
 */
roh as (
  select c.nr,
         public.seller_orderbook_ledger(c.y, c.m, c.q, c.u, c.s) as out
    from combos c
   where (select w.verdikt from wache w) = 'OK'
),

/*
 * DIE ELF NEUEN SCHLUESSEL AUS JEDER ZEILE ENTFERNEN.
 *
 * Vor der Migration ist das ein Leerlauf — die Schluessel sind nicht da, und
 * `jsonb - 'k'` auf einen fehlenden Schluessel ist der unveraenderte Wert.
 * Nach der Migration entfernt es genau das Neue. Dieselbe Datei, dieselbe
 * Frage, beide Male — und deshalb ist ein gleicher Hash ein Beweis.
 */
alt as (
  select r.nr, r.out,
         coalesce((
           select jsonb_agg(
                    e - 'status_known' - 'has_sender_name' - 'has_sender_street'
                      - 'has_sender_postal_code' - 'has_sender_city' - 'has_origin'
                      - 'has_agreement' - 'receipt_number' - 'receipt_issued_at'
                      - 'receipt_revision' - 'receipt_stale'
                    order by ord)
             from jsonb_array_elements(r.out -> 'purchases') with ordinality as x(e, ord)
         ), '[]'::jsonb) as zeilen_alt
    from roh r
)

/*
 * LEFT JOIN, damit auch ein abgebrochener Lauf ZEILEN liefert.
 *
 * Eine leere Ergebnistabelle waere der gefaehrlichste Ausgang: zwei leere
 * Laeufe „stimmen ueberein". Hier steht in jeder Zeile, warum es keine
 * Baseline ist.
 */
select
  c.nr,
  c.label,
  (select w.verdikt from wache w)              as verdikt,
  (select p.rang from lauf p)                  as rang,
  (select count(*) from betreiber)             as betreiber_anzahl,
  public.can_operate_active_seller()           as tor_offen,
  jsonb_array_length(a.out -> 'purchases')     as zeilen,
  /* Die IDs in der Reihenfolge, die die Datenbank geliefert hat. */
  case when (select w.verdikt from wache w) <> 'OK' then 'KEINE_BASELINE'
       else coalesce((select string_agg(e ->> 'id', ',' order by ord)
                        from jsonb_array_elements(a.out -> 'purchases')
                             with ordinality as x(e, ord)), '')
  end as ids,
  /* Der Beweis: alle alten Felder aller Zeilen, in Reihenfolge, als ein Hash. */
  case when (select w.verdikt from wache w) <> 'OK' then 'KEINE_BASELINE'
       else encode(sha256(convert_to(a.zeilen_alt::text, 'utf8')), 'hex')
  end as alt_hash,
  case when (select w.verdikt from wache w) <> 'OK' then 'KEINE_BASELINE'
       else encode(sha256(convert_to((a.out -> 'summary')::text, 'utf8')), 'hex')
  end as summe_hash,
  /* Klein genug, um sie im Klartext zu vergleichen. */
  case when (select w.verdikt from wache w) <> 'OK' then 'KEINE_BASELINE'
       else (a.out -> 'classification')::text
  end as klassen,
  /* Zwei Zahlen zum Mitlesen, damit ein Mensch den Hash plausibilisieren kann. */
  (a.out -> 'summary' ->> 'total_cost') as summe_ausgaben,
  (a.out -> 'summary' ->> 'item_count') as summe_artikel,
  /* ---- und die vier Spalten, die sich AENDERN DUERFEN ------------------ */
  /* `jsonb_exists(e, 'k')` statt `e ? 'k'`: das Fragezeichen wird von
     manchen Treibern als Parameter-Platzhalter gelesen, und dann kommt beim
     Server eine Abfrage an, die niemand geschrieben hat. */
  (select count(*) from jsonb_array_elements(a.out -> 'purchases') e
    where jsonb_exists(e, 'status_known')) as mit_status,
  (select count(*) from jsonb_array_elements(a.out -> 'purchases') e
    where e ->> 'receipt_number' is not null) as mit_beleg,
  (select count(*) from jsonb_array_elements(a.out -> 'purchases') e
    where (e ->> 'receipt_stale') = 'true') as abweichend,
  /*
   * UND DIE ZEILEN, DEREN BELEGZUSTAND UNBEKANNT IST.
   *
   * Nach der Migration muss diese Spalte 0 sein. Ist sie es nicht, hat die
   * Schutzhuelle fuer eine Zeile mit Beleg NULL geliefert — also einen
   * Vergleichsfehler gefangen. Das wird nicht erwartet und gehoert dann
   * untersucht, nicht wegsortiert.
   */
  (select count(*) from jsonb_array_elements(a.out -> 'purchases') e
    where e ->> 'receipt_number' is not null
      and e ->> 'receipt_stale' is null) as unbekannt
from combos c
left join alt a on a.nr = c.nr
order by c.nr;

rollback;
