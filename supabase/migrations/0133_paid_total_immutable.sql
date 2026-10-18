-- ===========================================================================
-- 0133 — Die bezahlte Summe eines importierten Einkaufs, auch gegen ein
--        direktes UPDATE
--
-- NICHT FREIGEGEBEN. Vorbereitet, nirgends angewendet. `0132` bleibt
-- unberührt — sie ist in ihrer freigegebenen Fassung.
--
-- ---------------------------------------------------------------------------
-- WARUM ES DIESE MIGRATION GIBT
-- ---------------------------------------------------------------------------
--
-- `0132` setzt den Riegel in `seller_update_purchase`. Das deckt jeden Weg
-- ab, den die Anwendung nimmt — die Oberfläche ruft nur diese Funktion, und
-- `seller_save_purchase_edit` delegiert an sie.
--
-- Es deckt NICHT den SQL-Editor ab. Ein `update public.purchases set
-- total_cost = … ` als `postgres` geht an der Funktion vorbei; der einzige
-- Tabellenzwang ist `purchases_cost_split_adds_up`, und der prüft nur, dass
-- die Aufteilung zur Summe passt — nicht, dass die Summe bleibt.
--
-- Die Anforderung lautet „weder direkt noch indirekt". Dafür ist eine
-- Funktion der falsche Ort: unveränderlich wird in diesem Projekt mit einem
-- TRIGGER gemacht — `purchase_receipts_immutable_trg` (0122) und
-- `inventory_movements_append_only` (0003) tun es genauso.
--
-- ---------------------------------------------------------------------------
-- WAS SIE KOSTET, UND WARUM DAS EINE ENTSCHEIDUNG IST
-- ---------------------------------------------------------------------------
--
-- Danach lässt sich ein ECHTER Erfassungsfehler in einer historischen Summe
-- nicht mehr korrigieren — auch nicht vom Betreiber im SQL-Editor, auch nicht
-- mit guter Begründung. Der einzige Weg wäre, den Trigger für die Dauer der
-- Korrektur abzuschalten (`alter table … disable trigger`), und das ist ein
-- bewusster, protokollierbarer Vorgang statt eines unbemerkten `update`.
--
-- Genau deshalb steht diese Migration getrennt und braucht eine eigene
-- Freigabe: `0132` macht das Nachtragen möglich, `0133` macht die Zahlung
-- hart. Das zweite ist mehr Schutz und weniger Spielraum.
--
-- WAS SIE NICHT TUT: keine Datenanweisung, kein DDL an einer Spalte, keine
-- Lagerbewegung, kein Beleg. Sie legt eine Triggerfunktion und einen Trigger
-- an. Bestehende Zeilen bleiben unberührt — ein Trigger wirkt erst beim
-- nächsten UPDATE.
--
-- Rücknahme: `supabase/rollback/R0133_drop_paid_total_trigger.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.purchases') is null then
    raise exception '0133 setzt 0053 voraus: purchases fehlt';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'purchases_cost_split_adds_up') then
    raise exception '0133 setzt 0115 voraus: purchases_cost_split_adds_up fehlt';
  end if;
  /* 0132 ist die Funktionssperre; 0133 ist die Tabellensperre daneben.
     Ohne 0132 waere die Oberflaeche weiter in der Lage, es zu versuchen —
     sie bekaeme dann eine Triggermeldung statt eines erklaerenden Satzes. */
  if position('the paid total of an imported purchase is final' in
        coalesce((select p.prosrc from pg_proc p
                   where p.oid = to_regprocedure(
                     'public.seller_update_purchase(bigint, date, numeric, text,'
                     || ' text, text, numeric, numeric, numeric, text, text,'
                     || ' boolean, text, text, text, text, text, text, text,'
                     || ' text, text)')), '')) = 0 then
    raise exception '0133 setzt 0132 voraus: der Riegel in seller_update_purchase fehlt';
  end if;
  if exists (select 1 from pg_trigger
              where not tgisinternal and tgname = 'purchases_paid_total_immutable_trg') then
    raise exception '0133 Abbruch: der Trigger steht schon';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Triggerfunktion
--
-- Nur `total_cost`, nur bei `source <> 'manual'`. Alles andere laeuft durch:
-- Datum, Plattform, Verkaeufer, Zahlungsart, Absender, Inserat, Notiz — und
-- die AUFTEILUNG, die ohnehin auf die Summe festgenagelt ist.
--
-- Auch `source` selbst wird festgehalten: liesse man sie von
-- `excel_order_2026` auf `manual` aendern, waere die Sperre mit einem
-- `update` umgangen.
-- ---------------------------------------------------------------------------
create or replace function public.purchases_paid_total_is_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source = 'manual' then
    return new;
  end if;

  if round(new.total_cost, 2) is distinct from round(old.total_cost, 2) then
    raise exception 'the paid total of an imported purchase is final and cannot be changed'
      using errcode = 'restrict_violation',
            detail  = format('purchase %s, source %s: %s -> %s',
                             old.id, old.source, old.total_cost, new.total_cost),
            hint    = 'Die Aufteilung laesst sich nachtragen, die bezahlte Summe nicht.';
  end if;

  if new.source is distinct from old.source then
    raise exception 'the origin of an imported purchase is final and cannot be changed'
      using errcode = 'restrict_violation',
            detail  = format('purchase %s: %s -> %s', old.id, old.source, new.source);
  end if;

  if new.currency is distinct from old.currency then
    raise exception 'the currency of an imported purchase is final and cannot be changed'
      using errcode = 'restrict_violation',
            detail  = format('purchase %s: %s -> %s', old.id, old.currency, new.currency);
  end if;

  return new;
end;
$$;

comment on function public.purchases_paid_total_is_final() is
  'Holds the paid total of an imported purchase (0133). Refuses a change to total_cost, currency or source when the row did not come from `manual` — the three facts that make up a concluded payment. Everything else passes: date, platform, seller, payment method, sender, listing, note, and the cost SPLIT, which purchases_cost_split_adds_up (0115) already nails to the unchanged total. Same shape as purchase_receipt_is_immutable() (0122) and prevent_inventory_movement_change() (0003): immutability belongs in a trigger, not in a function the caller may bypass. A genuine entry error can only be corrected by disabling this trigger deliberately — which is the point (ADR-0126).';

create trigger purchases_paid_total_immutable_trg
  before update on public.purchases
  for each row execute function public.purchases_paid_total_is_final();


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_code text;
  v_name text;
begin
  if not exists (select 1 from pg_trigger t
                  join pg_class c on c.oid = t.tgrelid
                 where not t.tgisinternal
                   and c.relname = 'purchases'
                   and t.tgname = 'purchases_paid_total_immutable_trg') then
    raise exception '0133 Abbruch: der Trigger fehlt';
  end if;

  /* BEFORE UPDATE, je Zeile — nicht AFTER und nicht je Anweisung. */
  if not exists (select 1 from pg_trigger t
                  join pg_class c on c.oid = t.tgrelid
                 where c.relname = 'purchases'
                   and t.tgname = 'purchases_paid_total_immutable_trg'
                   and t.tgtype::integer & 2 = 2      -- BEFORE
                   and t.tgtype::integer & 16 = 16    -- UPDATE
                   and t.tgtype::integer & 1 = 1) then -- ROW
    raise exception '0133 Abbruch: der Trigger hat nicht die Form BEFORE UPDATE FOR EACH ROW';
  end if;
  /* Und er feuert NICHT bei insert oder delete: ein neuer Einkauf entsteht,
     ein alter wird nicht geloescht — das regeln andere Stellen. */
  if exists (select 1 from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
             where c.relname = 'purchases'
               and t.tgname = 'purchases_paid_total_immutable_trg'
               and (t.tgtype::integer & 4 = 4 or t.tgtype::integer & 8 = 8)) then
    raise exception '0133 Abbruch: der Trigger feuert auch bei insert oder delete';
  end if;

  select p.prosrc into v_code from pg_proc p
    where p.oid = to_regprocedure('public.purchases_paid_total_is_final()');
  if position('old.source = ''manual''' in v_code) = 0 then
    raise exception '0133 Abbruch: die Ausnahme fuer manuelle Einkaeufe fehlt';
  end if;
  foreach v_name in array array['total_cost', 'currency', 'source'] loop
    if position(v_name in v_code) = 0 then
      raise exception '0133 Abbruch: % wird nicht festgehalten', v_name;
    end if;
  end loop;

  /* Die Aufteilung und alles Beschreibende duerfen NICHT im Riegel stehen —
     sie bleiben nachtragbar. Ein Riegel, der zu viel haelt, ist so falsch
     wie einer, der zu wenig haelt. */
  foreach v_name in array array['items_cost', 'shipping_cost',
                                'buyer_protection_cost', 'purchased_at',
                                'sender_name', 'listing_url', 'note'] loop
    if position(v_name in v_code) > 0 then
      raise exception '0133 Abbruch: % wird festgehalten, soll aber nachtragbar bleiben', v_name;
    end if;
  end loop;

  raise notice '0133: die bezahlte Summe importierter Einkaeufe ist auch gegen ein direktes update gesperrt';
end $$;
