-- ===========================================================================
-- RUECKNAHME von 0126 — das Sammelspeichern des Dialogs wieder entfernen
--
-- NICHT TEIL DER MIGRATIONSKETTE. Nur nach ausdruecklicher Entscheidung.
--
-- WAS 0126 GETAN HAT: drei NEUE Dinge angelegt —
--   * `seller_save_purchase_edit(...)`  (fuenf Parameter; es gab sie vorher
--     nicht, 0126 ist ihre erste Definition),
--   * `purchase_items_touch_purchase()` (Triggerfunktion, ebenfalls neu),
--   * den Trigger `purchase_items_touch_purchase_trg` auf `purchase_items`.
--
-- WAS DIESE DATEI TUT: sie entfernt genau diese drei. Weil alle drei NEU
-- waren, ist die Ruecknahme ein `drop` und kein Zuruecksetzen auf eine
-- Vorgaengerfassung — es gibt keine.
--
-- WAS SIE NICHT TUT: sie faesst keine Daten an. Kein `insert`, `update`,
-- `delete`, kein `drop` an einer Tabelle oder Spalte. Was ueber
-- `seller_save_purchase_edit` gespeichert wurde, bleibt gespeichert.
--
-- WAS SIE KOSTET:
--   * Der Bearbeitungsdialog kann nicht mehr in EINER Transaktion speichern.
--     Der Weg davor war `seller_update_purchase` aus `0121` plus die
--     Positionsfunktionen aus `0053` — die bleiben alle unberuehrt.
--   * `purchases.updated_at` wird nicht mehr automatisch nachgezogen, wenn
--     sich eine Position aendert. Das ist ein Komfortverlust, kein
--     Datenverlust: bestehende Zeitstempel bleiben stehen.
--
-- REIHENFOLGE: `R0127` MUSS vorher gelaufen sein. Laeuft diese Datei zuerst,
-- bricht sie ab — die Sechs-Parameter-Fassung aus `0127` wuerde sonst
-- zurueckbleiben und auf eine geloeschte Triggerfunktion zeigen.
--
-- VORBEDINGUNG: `seller_save_purchase_edit` existiert mit FUENF Parametern
--   (also nach `R0127`), und `0121`/`0053` stehen.
-- NACHBEDINGUNG: alle drei Objekte sind weg, `0121` und `0053` sind
--   unberuehrt, und `purchase_items` hat dieselbe Zeilenzahl wie vorher.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert. Vorher `npm run verify:sums`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_args      integer;
  v_fassungen integer;
  v_zeilen    bigint;
begin
  select count(*) into v_fassungen
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';

  if v_fassungen = 0 then
    raise exception 'R0126 Abbruch: seller_save_purchase_edit fehlt — 0126 ist hier nicht angewendet';
  end if;
  if v_fassungen > 1 then
    raise exception 'R0126 Abbruch: % Fassungen von seller_save_purchase_edit — erst den Stand klaeren', v_fassungen;
  end if;

  select p.pronargs into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';

  if v_args = 6 then
    raise exception 'R0126 Abbruch: die Funktion hat sechs Parameter — erst R0127 ausfuehren, sonst bleibt 0127 zurueck';
  end if;
  if v_args <> 5 then
    raise exception 'R0126 Abbruch: die Funktion hat % Parameter, erwartet 5', v_args;
  end if;

  /* Die Grundlagen, die STEHEN BLEIBEN muessen — Signaturen wortgleich wie
     in der Vorbedingung von 0126 selbst. */
  if to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
       || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
       || ' text, text, text, text, text, text, text, text)') is null then
    raise exception 'R0126 Abbruch: seller_update_purchase aus 0121 fehlt — dann gaebe es nach der Ruecknahme KEINEN Weg mehr, einen Einkauf zu aendern';
  end if;

  select count(*) into v_zeilen from public.purchase_items;
  raise notice 'R0126: % Einkaufspositionen vor der Ruecknahme (muessen danach gleich viele sein)', v_zeilen;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Trigger, Triggerfunktion, Sammelspeichern
--
-- Reihenfolge: erst der Trigger, dann seine Funktion — ein `drop function`
-- auf eine noch benutzte Triggerfunktion wuerde abhaengig abgelehnt.
-- ---------------------------------------------------------------------------
drop trigger if exists purchase_items_touch_purchase_trg on public.purchase_items;

drop function if exists public.purchase_items_touch_purchase();

drop function if exists public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz);


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_weg integer;
begin
  select count(*) into v_weg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_save_purchase_edit', 'purchase_items_touch_purchase');
  if v_weg <> 0 then
    raise exception 'R0126 Abbruch: % Funktion(en) stehen noch', v_weg;
  end if;

  if exists (select 1 from pg_trigger
              where not tgisinternal
                and tgname = 'purchase_items_touch_purchase_trg') then
    raise exception 'R0126 Abbruch: der Trigger steht noch';
  end if;

  /* Was unberuehrt bleiben musste. */
  if to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
       || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
       || ' text, text, text, text, text, text, text, text)') is null then
    raise exception 'R0126 Abbruch: seller_update_purchase aus 0121 ist verschwunden';
  end if;
  /* Signaturen wortgleich wie in der Vorbedingung von 0126 selbst. */
  if to_regprocedure('public.seller_add_purchase_item(bigint, text, text, text)') is null then
    raise exception 'R0126 Abbruch: seller_add_purchase_item aus 0053 ist verschwunden';
  end if;
  if to_regclass('public.purchase_items') is null then
    raise exception 'R0126 Abbruch: purchase_items ist verschwunden';
  end if;

  raise notice 'R0126: Sammelspeichern, Triggerfunktion und Trigger entfernt; 0121 und 0053 unberuehrt';
end $$;
