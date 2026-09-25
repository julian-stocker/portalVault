# Cutover-Baseline 824 → 806, ohne Bewegung (2026-09-22)

> **Historisches Protokoll — bereits ausgeführt — nicht erneut ausführen.**
>
> Dies ist **kein Runbook und keine Anleitung.** Der Vorgang ist abgeschlossen; die Datei steht
> hier ausschließlich, damit nachlesbar bleibt, was genau passiert ist.
>
> | | |
> |---|---|
> | Ausgeführt auf Staging | 2026-09-22, unabhängig verifiziert |
> | Ausgeführt auf Production | 2026-09-22, unabhängig verifiziert |
> | Wiederholung | **ausgeschlossen** — das Verfahren ist verbraucht. Gate 1a bricht ab, sobald auch nur eine Zeile in `inventory_movements` steht — auf Production sind es heute 32 —, Gate 1j nach dem ersten erfolgreichen Lauf. **806 ist kein Sollbestand**, sondern der Stand eines Tages; jede spaetere Abweichung gehoert ins Ledger |
> | Früherer Pfad | `tools/sql/cutover-baseline-806.sql` (bis 2026-09-25 ausführbar im Repository) |
>
> Verschoben am 2026-09-25 aus `tools/sql/` hierher: die Vorgänge sind verbraucht, und eine
> Markdown-Datei lässt sich nicht versehentlich in den SQL-Editor ziehen und ausführen. **Der
> SQL-Text darunter ist unverändert** — Zeichen für Zeichen der Stand, der gelaufen ist.

## Der ausgeführte SQL-Text

```sql
-- ###########################################################################
-- ##                                                                       ##
-- ##   ONE-TIME PRE-GO-LIVE BASELINE · EXECUTED ON PRODUCTION              ##
-- ##   DO NOT RUN AGAIN                                                     ##
-- ##                                                                       ##
-- ##   Staging     2026-09-22  ausgeführt und unabhängig verifiziert       ##
-- ##   Production  2026-09-22  ausgeführt und unabhängig verifiziert       ##
-- ##                                                                       ##
-- ##   ERGEBNIS AUF PRODUCTION: 279 lose Realpositionen, Summe 806 —       ##
-- ##   27 UPDATE, 6 INSERT, netto −18, und `inventory_movements` blieb     ##
-- ##   dabei bei NULL. Legacy-Historie und verfügbarer Bestand stehen      ##
-- ##   seither beide auf 806.                                              ##
-- ##                                                                       ##
-- ##   AB HIER GILT AUSSCHLIESSLICH DER REGULÄRE WEG: jede reale           ##
-- ##   Bestandsänderung entsteht über die operativen SkyIsles-Movement-    ##
-- ##   Pfade (`apply_inventory_movement`), niemals wieder über dieses      ##
-- ##   oder ein ähnliches Skript.                                          ##
-- ##                                                                       ##
-- ##   DIESE DATEI IST KEIN SYNCHRONISATIONSWERKZEUG. Sie gleicht den      ##
-- ##   Bestand nicht „wieder ab", wenn die Arbeitsmappe sich erneut        ##
-- ##   ändert — dafür gibt es ab Go-Live Korrekturbewegungen im Ledger.    ##
-- ##   Gate 1j bricht ab, sobald der Zielzustand bereits erreicht ist.     ##
-- ##                                                                       ##
-- ##   Setzt die Cutover-Baseline des verfügbaren Bestands von 824 auf     ##
-- ##   806 — den Stand der aktualisierten Arbeitsmappe. OHNE eine einzige  ##
-- ##   inventory_movement.                                                 ##
-- ##                                                                       ##
-- ##   NACH DEM ERSTEN ECHTEN VERKAUF IST DIESE TÜR ZU. Ab dann ist jede   ##
-- ##   Bestandsabweichung ein Geschäftsvorgang und gehört als Bewegung     ##
-- ##   ins Ledger, nicht in ein Skript. Gate 1 unten hält das durch: es    ##
-- ##   bricht ab, sobald auch nur eine Bewegung existiert.                 ##
-- ##                                                                       ##
-- ###########################################################################
--
-- ===========================================================================
-- WARUM EINE BASELINE-AKTUALISIERUNG UND KEINE 33 KORREKTURBUCHUNGEN
--
-- Die 18 Stück Differenz sind kein Geschäftsvorgang. Sie entstehen daraus,
-- dass die Legacy-Source-of-Truth vor dem Go-Live noch einmal aktualisiert
-- wurde: 27 Positionen wurden zwischenzeitlich verkauft, 6 kamen hinzu.
-- Nichts davon ist in SkyIsles passiert.
--
-- Die Invariante „Bestand wird bewegt, nicht gesetzt" (ADR-0044, ADR-0048
-- Entscheidung 5) gilt für den laufenden Betrieb — und sie wurde vom Cutover
-- bereits einmal bewusst ausgesetzt: ADR-0103 hat alle 720 Bewegungen
-- gelöscht und `shop_inventory.quantity` stehen lassen. SEITHER TRÄGT JEDE
-- LOSE POSITION EINEN BESTAND, HINTER DEM NULL BEWEGUNGEN STEHEN. Das
-- Ledger erklärt den heutigen Bestand ohnehin nicht; das tun die
-- legacy_stock_events.
--
-- 33 `correction`-Bewegungen zu buchen hieße, die allerersten Einträge des
-- frischen Ledgers mit etwas zu füllen, das SkyIsles nie getan hat — und
-- genau das sollte der Cutover beseitigen.
--
-- WAS DIESES SKRIPT TUT
--
--   27 UPDATE auf bestehende Positionen  (quantity := Excel F)
--    6 INSERT für Positionen, die es noch nicht gibt
--      unverändert: je Umgebung verschieden, siehe unten
--
-- DIE ZAHL DER UNBERÜHRTEN POSITIONEN WAR UMGEBUNGSABHÄNGIG.
--
--   Staging      270 bestehende lose Realpositionen → 27 / 6 / 243 unchanged
--   Production   273 bestehende → 27 / 6 / 246 unchanged, unmittelbar vor
--                dem Lauf read-only gemessen und bestätigt, nicht
--                vorausgesetzt.
--
-- Der Unterschied sind ausschließlich Zeilen mit `quantity = 0`: zehn
-- Positionen führt nur Production, sieben nur Staging, und keine einzige
-- gemeinsame Position trägt eine abweichende Menge. Beide Umgebungen stehen
-- auf Σ 824. Die Bestandswirkung ist in beiden Fällen dieselbe: −18 auf 806.
--
-- KEIN GATE HÄNGT AN DIESER ZAHL. Geprüft wird, was zählt: Σ _target = 806,
-- Endsumme 806, keine bestehende Position ohne Zielwert, null Bewegungen.
-- Die Aufteilung in UPDATE und INSERT ergibt sich daraus, sie steuert nichts.
--
-- WAS ES NICHT TUT
--
--   keine inventory_movement · keine Bewegung gelöscht · kein reserved
--   angefasst · keine Position gelöscht · keine Fixture angelegt · keine
--   legacy_stock_events berührt · kein Preis, kein Listing, keine Notiz
--
-- REIHENFOLGE. Dieses Skript läuft UNMITTELBAR NACH dem Neuaufbau der
-- legacy_stock_events (Phase C). Zwischen beiden ist die Datenbank kurz
-- inkonsistent — Rekonstruktion 806, Bestand 824 —, und das ist erwartet.
-- Gate 6 prüft deshalb, dass die Rekonstruktion bereits auf 806 steht.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Die Zielwerte. EINE Zeile je Position, aus der Arbeitsmappe erzeugt.
--
--    Diese Tabelle wird vom Preview-Werkzeug befüllt und hier eingesetzt;
--    sie ist der einzige Teil, der sich zwischen Staging und Production
--    unterscheidet. `on commit drop`: kein Rückstand, auch nicht bei Abbruch.
-- ---------------------------------------------------------------------------
create temporary table _target (
  sky_id   text    primary key,
  quantity integer not null check (quantity >= 0)
) on commit drop;

/*
 * Der Zustand, für den die Zielwerte gerechnet wurden.
 *
 * Ein Zielwert ist nur so gut wie der Bestand, gegen den er ermittelt wurde.
 * Hat sich zwischen Erzeugung und Lauf etwas bewegt, sind die 27 UPDATE und
 * 6 INSERT nicht mehr dieselbe Änderung — dann lieber abbrechen als eine
 * Zahl setzen, die niemand mehr nachgerechnet hat. Der Preview liefert
 * beides mit; Gate 1k vergleicht.
 */
create temporary table _expect_before (
  loose_rows integer not null,
  loose_sum  integer not null
) on commit drop;

-- >>> HIER DIE VOM PREVIEW ERZEUGTEN ZEILEN EINSETZEN <<<
-- insert into _target (sky_id, quantity) values
--   ('SKY-XXXX', N), … ;
-- insert into _expect_before (loose_rows, loose_sum) values (<Zeilen>, <Summe>);
--
-- DIESE ZEILEN STEHEN NICHT IM REPOSITORY UND KOMMEN AUCH NICHT HINEIN.
-- Es sind Lagerzahlen je Figur (docs/SECURITY.md). Die ausführungsfertige
-- Fassung entsteht ausserhalb des Arbeitsverzeichnisses, wird einmal
-- ausgeführt und danach verworfen; hier bleibt der Rahmen ohne Zahlen.

-- ---------------------------------------------------------------------------
-- 1. ABBRUCHKRITERIEN.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_sum integer;
begin
  -- 1a. DIE TÜR. Sobald eine einzige operative Bewegung existiert, ist der
  --     Betrieb aufgenommen und dieses Skript nicht mehr zulässig.
  select count(*) into v_n from public.inventory_movements;
  if v_n <> 0 then
    raise exception 'ABBRUCH: % inventory_movement(s) vorhanden — der Betrieb hat begonnen, '
      'eine Bestandsabweichung ist ab jetzt eine Korrekturbuchung und kein Baseline-Skript', v_n;
  end if;

  -- 1b. Nichts darf reserviert sein: eine Kürzung unter `reserved` würde
  --     eine Zusage brechen, die jemand einem Checkout gegeben hat.
  select coalesce(sum(reserved), 0) into v_n from public.shop_inventory;
  if v_n <> 0 then raise exception 'ABBRUCH: reserved = %, erwartet 0', v_n; end if;

  -- 1c. Keine Bestellung, kein Verkauf im Fluss.
  select count(*) into v_n from public.orders;
  if v_n <> 0 then raise exception 'ABBRUCH: % Bestellung(en) vorhanden', v_n; end if;

  -- 1d. Die Fixtures sind seit dem Cutover weg und bleiben es.
  select count(*) into v_n from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000;
  if v_n <> 0 then raise exception 'ABBRUCH: % Fixture-Position(en) vorhanden', v_n; end if;

  -- 1e. Die Zielwerte müssen da sein und plausibel summieren.
  select count(*), coalesce(sum(quantity), 0) into v_n, v_sum from _target;
  if v_n = 0 then raise exception 'ABBRUCH: _target ist leer — Zielwerte nicht eingesetzt'; end if;
  if v_sum <> 806 then raise exception 'ABBRUCH: Σ _target = %, erwartet 806', v_sum; end if;

  -- 1f. Kein Ziel darf eine Fixture sein.
  select count(*) into v_n from _target
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000;
  if v_n <> 0 then raise exception 'ABBRUCH: % Fixture(s) unter den Zielwerten', v_n; end if;

  -- 1g. Jede Ziel-SKY-ID muss im Katalog stehen. Eine Position anzulegen,
  --     die es nicht gibt, wäre schlimmer als eine fehlende Zeile.
  select count(*) into v_n from _target t
   where not exists (select 1 from public.skylanders k where k.sky_id = t.sky_id);
  if v_n <> 0 then raise exception 'ABBRUCH: % Ziel-SKY-ID(s) ohne Katalogeintrag', v_n; end if;

  -- 1h. PHASE C MUSS GELAUFEN SEIN. Die Rekonstruktion ist die Begründung
  --     für diese Zahlen; steht sie noch auf 824, ist die Reihenfolge falsch.
  select coalesce(sum(quantity), 0) into v_n from public.legacy_stock_events;
  if v_n <> 806 then
    raise exception 'ABBRUCH: Σ legacy_stock_events = %, erwartet 806 — Phase C fehlt', v_n;
  end if;

  -- 1i. Keine bestehende reale Position darf im Ziel fehlen. Sonst bliebe
  --     ein Bestand stehen, den die Arbeitsmappe nicht mehr kennt.
  select count(*) into v_n from public.shop_inventory i
   where i.condition = 'loose'
     and (regexp_replace(i.sky_id, '^SKY-', ''))::bigint < 9000
     and not exists (select 1 from _target t where t.sky_id = i.sky_id);
  if v_n <> 0 then raise exception 'ABBRUCH: % Lagerposition(en) ohne Zielwert', v_n; end if;

  -- 1j. BEREITS AUSGEFÜHRT? Dann ist hier nichts mehr zu tun, und ein
  --     zweiter Lauf wäre kein Cutover, sondern eine Gewohnheit. Das
  --     Skript beendet sich mit einem Fehler statt mit einem stillen
  --     „0 Zeilen geändert" — eine Wiederholung soll auffallen.
  select count(*) into v_n
    from _target t
    left join public.shop_inventory i
      on i.sky_id = t.sky_id and i.condition = 'loose'
   where coalesce(i.quantity, 0) is distinct from t.quantity;
  if v_n = 0 then
    raise exception 'ABBRUCH: jede Zielposition traegt bereits ihren Zielwert — '
      'dieses ONE-TIME-Skript wurde auf diesem Bestand offenbar schon ausgefuehrt';
  end if;

  -- 1k. DER VORZUSTAND. Gegen ihn wurden die Zielwerte gerechnet.
  select count(*) into v_n from _expect_before;
  if v_n <> 1 then
    raise exception 'ABBRUCH: _expect_before braucht genau eine Zeile, hat %', v_n;
  end if;

  select count(*), coalesce(sum(quantity), 0) into v_n, v_sum
    from public.shop_inventory
   where condition = 'loose'
     and (regexp_replace(sky_id, '^SKY-', ''))::bigint < 9000;
  if v_n <> (select loose_rows from _expect_before)
     or v_sum <> (select loose_sum from _expect_before) then
    raise exception 'ABBRUCH: loser Realbestand ist %/% Stueck, erwartet %/%',
      v_n, v_sum, (select loose_rows from _expect_before), (select loose_sum from _expect_before);
  end if;

  -- 1l. Keine fremde condition. Dieses Skript kennt nur `loose`.
  select count(*) into v_n from public.shop_inventory where condition <> 'loose';
  if v_n <> 0 then
    raise exception 'ABBRUCH: % Lagerzeile(n) mit anderer condition als loose', v_n;
  end if;

  raise notice 'Gates bestanden. Zielsumme %, % Positionen.', v_sum, (select count(*) from _target);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Das Protokoll VOR der Änderung. Diese Ausgabe gehört gesichert — sie
--    ist der einzige Beleg dafür, was vorher stand.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select t.sky_id, i.quantity as vorher, t.quantity as nachher
      from _target t
      left join public.shop_inventory i
        on i.sky_id = t.sky_id and i.condition = 'loose'
     where i.quantity is distinct from t.quantity
     order by t.sky_id
  loop
    raise notice 'BASELINE % : % -> %', rpad(r.sky_id, 10),
      coalesce(r.vorher::text, '(keine Zeile)'), r.nachher;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Die bestehenden Positionen auf Excel F.
--
--    Nur `quantity`. Preis, Listing, Notiz und `reserved` bleiben, wie sie
--    sind; `updated_at` setzt der vorhandene Trigger.
-- ---------------------------------------------------------------------------
update public.shop_inventory i
   set quantity = t.quantity
  from _target t
 where i.sky_id = t.sky_id
   and i.condition = 'loose'
   and i.quantity is distinct from t.quantity;

-- ---------------------------------------------------------------------------
-- 4. Die Positionen, die es noch nicht gibt.
--
--    Nur mit Bestand: eine Zeile mit quantity 0 anzulegen, für eine Figur
--    die nie im Regal stand, wäre Rauschen. Nicht gelistet und ohne Preis —
--    beides entscheidet der Betreiber, nicht dieses Skript.
-- ---------------------------------------------------------------------------
insert into public.shop_inventory (sky_id, condition, quantity, is_listed)
select t.sky_id, 'loose', t.quantity, false
  from _target t
 where t.quantity > 0
   and not exists (
     select 1 from public.shop_inventory i
      where i.sky_id = t.sky_id and i.condition = 'loose');

-- ---------------------------------------------------------------------------
-- 5. Sollzustand. Eine Abweichung rollt alles zurück.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  -- 5a. Jede Position trägt exakt ihren Zielwert.
  select count(*) into v_n
    from _target t
    left join public.shop_inventory i
      on i.sky_id = t.sky_id and i.condition = 'loose'
   where coalesce(i.quantity, 0) is distinct from t.quantity;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % Position(en) weichen vom Ziel ab', v_n; end if;

  -- 5b. Die Summe.
  select coalesce(sum(i.quantity), 0) into v_n
    from public.shop_inventory i
   where i.condition = 'loose'
     and (regexp_replace(i.sky_id, '^SKY-', ''))::bigint < 9000;
  if v_n <> 806 then raise exception 'SOLL VERFEHLT: loser Realbestand = %, erwartet 806', v_n; end if;

  -- 5c. DAS WICHTIGSTE: keine einzige Bewegung ist dabei entstanden.
  select count(*) into v_n from public.inventory_movements;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % inventory_movement(s) entstanden', v_n; end if;

  -- 5d. Und nichts anderes hat sich bewegt.
  select coalesce(sum(reserved), 0) into v_n from public.shop_inventory;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: reserved = %', v_n; end if;

  select count(*) into v_n from public.shop_inventory
   where (regexp_replace(sky_id, '^SKY-', ''))::bigint >= 9000;
  if v_n <> 0 then raise exception 'SOLL VERFEHLT: % Fixture(s)', v_n; end if;

  select coalesce(sum(quantity), 0) into v_n from public.legacy_stock_events;
  if v_n <> 806 then raise exception 'SOLL VERFEHLT: Σ legacy_stock_events = %', v_n; end if;

  select count(*) into v_n from public.shop_inventory where condition = 'boxed' and quantity > 0;
  raise notice 'Sollzustand erreicht. Boxed-Positionen mit Bestand: %.', v_n;
end;
$$;

-- Erst nach dieser Zeile ist etwas passiert.
commit;
```
