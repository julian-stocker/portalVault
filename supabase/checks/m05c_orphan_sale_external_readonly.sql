-- ===========================================================================
-- M-05C — VERWAISTE `sale_external`-LAGERBEWEGUNGEN, REIN LESEND
--
-- EINE Anweisung, nur SELECT. Sie aendert nichts und repariert nichts.
-- Ausfuehren nur nach eigener Freigabe je Umgebung, im SQL-Editor (der
-- Editor zeigt nur das Ergebnis der letzten Anweisung — deshalb ist es eine).
-- Sie steht NICHT in `staging-suite.json`; `npm run db:check:staging` faehrt
-- sie also nicht von selbst.
--
-- WONACH SIE SUCHT. Bis `0188` zaehlt `seller_delete_sale` gebuchte Positionen
-- ohne Sperre. Eine Buchung OHNE Hold, die dazwischen committet, wird vom
-- Cascade mitgeloescht; ihre Bewegung bleibt stehen (reproduziert in
-- `src/lib/orderbook/sale-race-0188-0189.test.ts`, Fall R1). Eine solche
-- Bewegung erkennt man so: `reason = 'sale_external'`, der Vermerk
-- `Orderbuch: externer Verkauf #<id>` (so schreibt ihn
-- `seller_book_sale_item` seit 0059 wortgleich), der Verkauf <id> existiert
-- nicht mehr, und KEIN Fremdschluessel zeigt auf die Bewegung.
--
-- WER AUF EINE BEWEGUNG ZEIGEN KANN (Schema 2026-11-09, alle Fremdschluessel
-- auf `inventory_movements`): `sale_items.movement_id`, `.return_movement_id`,
-- `order_reservations.movement_id`, `.reverted_movement_id`,
-- `order_line_events.movement_id`, `.correction_movement_id`,
-- `purchase_items.movement_id`, `inventory_import_rows.movement_id`.
--
-- DIE KLASSEN (Spalte `klasse`), vom Verdacht her geordnet:
--
--   A1  Vermerk nennt einen Verkauf, der NICHT mehr existiert, und auf
--       demselben Lagerposten gibt es keine unzugeordnete Ausbuch-Ruecknahme,
--       die sie ausgleichen koennte. => RACE-KANDIDAT.
--   A2  Vermerk nennt einen VORHANDENEN Verkauf, aber keine Position zeigt auf
--       die Bewegung, und keine Ruecknahme einer seiner Positionen. => unklar,
--       einzeln ansehen.
--   B1  Verkauf fehlt, aber eine unzugeordnete Ruecknahme (`correction` +1,
--       `Orderbuch: Ausbuchen zurückgenommen, Position <id>`, Position nicht
--       mehr vorhanden) auf demselben Posten, nach der Bewegung, kann sie
--       ausgleichen. Das ist der legitime Weg „ausbuchen, zuruecknehmen,
--       loeschen". => vermutlich in Ordnung.
--   B2  Verkauf vorhanden, eine seiner Positionen wurde ausgebucht und wieder
--       zurueckgenommen (die Ruecknahme loest `movement_id`). => in Ordnung.
--   B3  nur noch eine Reservierung zeigt auf die Bewegung (`movement_id` eines
--       umgewandelten Holds), keine Position. => eine Ruecknahme nach Buchung
--       mit Hold; in Ordnung, wenn eine Ruecknahme existiert (Spalte
--       `ruecknahmen_auf_posten`).
--   C   kein Orderbuch-Vermerk. Handbuchungen aus der Zeit vor dem Orderbuch
--       (ADR „eBay in V1: eine Bewegung von Hand"), Buchungen ueber
--       `record_inventory_movement` direkt (z. B. `verify-inventory`) und
--       Pruefwerkzeug-Fixtures. => KEIN Race-Befund. Bekannt: Production
--       fuehrt seit 2026-09-19 61 solche Bewegungen (PROJECT_STATUS.md).
--   Z   belegt (ein Fremdschluessel zeigt darauf) — nur in der Uebersicht.
--
-- FALSCH POSITIV / FALSCH NEGATIV (bewusst so gebaut, hier benannt):
--   * Der Ausgleich in B1 wird nur GEZAEHLT, nicht exakt zugeordnet: die
--     Ruecknahme nennt eine Position, die Bewegung einen Verkauf, und beide
--     sind geloescht. Die k-te verwaiste Bewegung eines Postens gilt als
--     ausgeglichen, solange es mindestens k verwaiste Ruecknahmen danach auf
--     ihm gibt. Eine fremde Ruecknahme kann so einen echten Race-Fall nach B1
--     verschieben (falsch negativ); A1 bleibt dafuer frei von diesem Fall.
--   * Ein von Hand (SQL-Editor) geloeschter Verkauf mit gebuchter Position
--     faellt ebenfalls nach A1 — der Befund „Bewegung ohne Beleg" stimmt
--     dann, die Ursache ist aber nicht die Race.
--   * Ein von Hand geschriebener Vermerk im Orderbuch-Wortlaut wuerde wie
--     einer aus dem Orderbuch behandelt.
--   * Testverkaeufe (`sales.is_test`) werden nicht ausgefiltert; Spalte
--     `verkauf_test` zeigt sie fuer A2/B2.
--   * Die Notiz selbst wird NICHT ausgegeben (Freitext bei Handbuchungen).
--
-- AUSGABE: zuerst die Uebersicht (eine Zeile je Klasse, `movement_id` leer),
-- danach jede nicht belegte Bewegung einzeln. Keine Personen-, Kaeufer- oder
-- Adressdaten.
-- ===========================================================================

with ext as (
  select m.id, m.inventory_id, m.delta, m.created_at,
         substring(m.note from '^Orderbuch: externer Verkauf #([0-9]+)$')::bigint as note_sale_id
    from public.inventory_movements m
   where m.reason = 'sale_external'
),
belegt as (
  select i.movement_id as id from public.sale_items i where i.movement_id is not null
  union select i.return_movement_id from public.sale_items i where i.return_movement_id is not null
  union select r.reverted_movement_id from public.order_reservations r where r.reverted_movement_id is not null
  union select e.movement_id from public.order_line_events e where e.movement_id is not null
  union select e.correction_movement_id from public.order_line_events e where e.correction_movement_id is not null
  union select p.movement_id from public.purchase_items p where p.movement_id is not null
  union select x.movement_id from public.inventory_import_rows x where x.movement_id is not null
),
am_hold as (
  select distinct r.movement_id as id from public.order_reservations r where r.movement_id is not null
),
ruecknahme as (
  select m.id, m.inventory_id, m.created_at,
         substring(m.note from '^Orderbuch: Ausbuchen zurückgenommen, Position ([0-9]+)$')::bigint as item_id
    from public.inventory_movements m
   where m.reason = 'correction' and m.delta > 0
     and m.note ~ '^Orderbuch: Ausbuchen zurückgenommen, Position [0-9]+$'
),
ruecknahme_verwaist as (
  select r.* from ruecknahme r
   where not exists (select 1 from public.sale_items i where i.id = r.item_id)
),
offen as (
  select e.*,
         (e.id in (select id from am_hold)) as nur_hold,
         s.id is not null as verkauf_existiert,
         s.cancelled_at is not null as verkauf_storniert,
         s.is_test as verkauf_test
    from ext e
    left join public.sales s on s.id = e.note_sale_id
   where e.id not in (select id from belegt where id is not null)
),
verkauf_fehlt as (
  select o.id,
         row_number() over (partition by o.inventory_id order by o.created_at, o.id) as rang
    from offen o
   where o.note_sale_id is not null and not o.verkauf_existiert and not o.nur_hold
),
klassiert as (
  select o.*,
         (select count(*) from ruecknahme r where r.inventory_id = o.inventory_id and r.created_at >= o.created_at)
           as ruecknahmen_auf_posten,
         case
           when o.nur_hold then 'B3'
           when o.note_sale_id is null then 'C'
           when o.verkauf_existiert then
             case when exists (select 1 from ruecknahme r join public.sale_items i on i.id = r.item_id
                                where i.sale_id = o.note_sale_id and r.inventory_id = o.inventory_id
                                  and r.created_at >= o.created_at)
                  then 'B2' else 'A2' end
           when (select f.rang from verkauf_fehlt f where f.id = o.id)
                <= (select count(*) from ruecknahme_verwaist r
                     where r.inventory_id = o.inventory_id and r.created_at >= o.created_at)
             then 'B1'
           else 'A1'
         end as klasse
    from offen o
),
klassen (klasse, bedeutung, ordnung) as (values
  ('A1', 'Verkauf fehlt, kein Ausgleich: RACE-KANDIDAT', 1),
  ('A2', 'Verkauf vorhanden, Bewegung ohne Position: einzeln ansehen', 2),
  ('B1', 'Verkauf fehlt, Ruecknahme auf dem Posten gleicht aus: vermutlich in Ordnung', 3),
  ('B2', 'Ausgebucht und zurueckgenommen: in Ordnung', 4),
  ('B3', 'nur am umgewandelten Hold: Ruecknahme nach Buchung mit Hold', 5),
  ('C',  'ohne Orderbuch-Vermerk (Handbuchung, Werkzeug, Fixture): kein Race-Befund', 6),
  ('Z',  'belegt durch einen Fremdschluessel', 7))
select k.klasse, k.bedeutung,
       case when k.klasse = 'Z'
            then (select count(*) from ext e where e.id in (select id from belegt where id is not null))
            else (select count(*) from klassiert c where c.klasse = k.klasse) end as anzahl,
       case when k.klasse = 'Z'
            then (select coalesce(sum(e.delta), 0) from ext e where e.id in (select id from belegt where id is not null))
            else (select coalesce(sum(c.delta), 0) from klassiert c where c.klasse = k.klasse) end as summe_delta,
       null::bigint as movement_id, null::timestamptz as created_at, null::bigint as inventory_id, null::text as sky_id,
       null::bigint as verkauf_laut_vermerk, null::boolean as verkauf_existiert, null::boolean as verkauf_storniert,
       null::boolean as verkauf_test, null::bigint as ruecknahmen_auf_posten,
       k.ordnung, 0 as zeile
  from klassen k
union all
select c.klasse, null, null, c.delta,
       c.id, c.created_at, c.inventory_id, si.sky_id,
       c.note_sale_id, case when c.note_sale_id is null then null else c.verkauf_existiert end,
       case when c.verkauf_existiert then c.verkauf_storniert end,
       case when c.verkauf_existiert then c.verkauf_test end,
       c.ruecknahmen_auf_posten,
       k.ordnung, 1
  from klassiert c
  join klassen k on k.klasse = c.klasse
  left join public.shop_inventory si on si.id = c.inventory_id
order by ordnung, zeile, created_at nulls first, movement_id nulls first;
