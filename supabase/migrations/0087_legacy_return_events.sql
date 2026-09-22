-- ===========================================================================
-- 0087 — eine Retoure ist zwei Ereignisse, nicht keines (ADR-0102)
--
-- WAS DIE ARBEITSMAPPE SAGT UND WAS WIR DARAUS MACHTEN
--
-- Spalte L des Blatts `Order 2026` kennt vier Ausgänge, und der Verkäufer hat
-- sie inzwischen verbindlich benannt:
--
--   x   verschickt und ausgetragen                        Lagerwirkung −1
--   -   nicht verschickt, nicht ausgetragen               Lagerwirkung  0
--   l   verschickt, ausgetragen, auf dem Weg verloren     Lagerwirkung −1
--   r   verschickt, ausgetragen, als Retoure zurück       −1 und +1, netto 0
--
-- Der Import kannte davon bis heute genau einen: `stockFlag !== 'x'` schloss
-- alles andere als `not_stock_relevant` aus. Für `-` ist das richtig. Für `l`
-- und `r` ist es falsch — und zwar auf eine Art, die niemandem auffällt: der
-- Startbestand wird rückwärts aus `Excel F − Einkäufe + Verkäufe` gerechnet,
-- also saugt er jeden fehlenden Verkauf auf und die Endsumme stimmt trotzdem.
-- DIE SUMME WAR IMMER RICHTIG, DIE GESCHICHTE NICHT.
--
-- WAS DIESE MIGRATION TUT
--
-- Sie erlaubt einen sechsten Ereignistyp `return` mit positiver Menge. Mehr
-- nicht: keine Tabelle, keine Spalte, keine Policy, keine Funktion. Die
-- Ereignisse selbst schreibt der Importer beim nächsten Neuaufbau.
--
-- WARUM `return` UND NICHT `correction`
--
-- `correction` heißt in diesem Schema „Nachzählung" und ist bewusst der eine
-- Typ ohne feste Richtung. Eine Retoure ist keine Nachzählung — sie ist ein
-- belegter Vorgang mit Datum, Quellzeile und Gegenstück. Sie unter
-- `correction` zu buchen hieße, zwei verschiedene Dinge unter einem Namen zu
-- führen, und der erste Leser, der die Korrekturen zählt, bekäme eine falsche
-- Antwort.
--
-- WARUM `l` KEINEN EIGENEN TYP BEKOMMT
--
-- Weil das Lager es nicht unterscheiden kann. Verloren heißt: die Ware hat das
-- Regal verlassen und kommt nicht zurück — lagerseitig exakt ein Verkauf. Der
-- Unterschied ist kaufmännisch und steht bereits strukturiert in
-- `sale_items.legacy_stock_flag`. Ein Lagertyp `lost` würde dieselbe Zahl ein
-- zweites Mal behaupten.
--
-- WAS UNVERÄNDERT BLEIBT
--
-- Append-only-Trigger, RLS ohne Policy, die beiden Leserfunktionen, die
-- partiellen Unique-Indizes auf die technischen Typen, der Cut auf
-- 2026-01-01, und die Regel, dass ein Arbeitsmappen-Ereignis seine Quellzeile
-- nennen muss. `return` ist ein Arbeitsmappen-Ereignis und fällt damit unter
-- dieselbe Pflicht.
--
-- NETTO NULL, UND DAS IST DER PUNKT
--
-- `sale −1` plus `return +1` ist dieselbe Bestandswirkung wie bisher gar kein
-- Ereignis. Die rekonstruierte Endsumme ändert sich durch diese Migration
-- nicht um ein Stück; sichtbar wird nur, dass die Figur draußen war.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der sechste Typ.
-- ---------------------------------------------------------------------------
alter table public.legacy_stock_events
  drop constraint if exists legacy_stock_events_type_known;
alter table public.legacy_stock_events
  add constraint legacy_stock_events_type_known
  check (event_type in
    ('opening_balance', 'purchase', 'sale', 'return', 'correction', 'legacy_adjustment'));

-- ---------------------------------------------------------------------------
-- 2. Seine Richtung. Eine Retoure bringt Ware zurück, also positiv.
--
--    `correction` bleibt als einziger Typ ohne feste Richtung — aus demselben
--    Grund wie in 0079: die Arbeitsmappe zeigt dort nur eine Richtung, der
--    Begriff trägt aber beide.
-- ---------------------------------------------------------------------------
alter table public.legacy_stock_events
  drop constraint if exists legacy_stock_events_direction;
alter table public.legacy_stock_events
  add constraint legacy_stock_events_direction
  check (
    case event_type
      when 'purchase'        then quantity > 0
      when 'sale'            then quantity < 0
      when 'return'          then quantity > 0
      when 'opening_balance' then quantity > 0
      else true
    end
  );

comment on column public.legacy_stock_events.event_type is
  'opening_balance and legacy_adjustment are technical reconstruction values at the business start. purchase, sale, correction and return are documented workbook events and each names its source row. return (0087) is the incoming half of a workbook return, column L = r: the sale stays −1 and the return adds +1, so the position nets to zero and the timeline still shows that the figure was gone. A lost shipment (column L = l) is a sale and nothing else — the stock cannot tell lost from sold, and the distinction lives in sale_items.legacy_stock_flag.';
