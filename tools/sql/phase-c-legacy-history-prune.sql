-- ###########################################################################
-- ##                                                                       ##
-- ##   EINMALIG JE UMGEBUNG · ONE-TIME · EXECUTED · DO NOT RUN AGAIN       ##
-- ##                                                                       ##
-- ##   Staging     2026-09-22  ausgeführt und unabhängig verifiziert       ##
-- ##   Production  2026-09-22  ausgeführt und unabhängig verifiziert       ##
-- ##                                                                       ##
-- ##   Auf beiden Umgebungen wurden neun Zeilen entfernt (2671 → 2662),    ##
-- ##   danach ergänzte der reguläre Importer 79 Zeilen auf 2741 / Σ 806.   ##
-- ##                                                                       ##
-- ##   Dieses Skript ist KEIN Betriebsprozess, KEIN Werkzeug zur Pflege     ##
-- ##   der Historie und KEINE Schemaänderung. Es steht bewusst nicht        ##
-- ##   unter supabase/migrations/. Wer es ein zweites Mal auf derselben     ##
-- ##   Umgebung laufen lässt, findet die Zeilen nicht mehr und bricht am    ##
-- ##   Gate ab.                                                             ##
-- ##                                                                       ##
-- ###########################################################################
--
-- ===========================================================================
-- WARUM ES ÜBERHAUPT EIN SKRIPT BRAUCHT
--
-- `legacy_stock_events` ist append-only (0079): der Trigger
-- `legacy_stock_events_no_update` verweigert UPDATE und DELETE. Das ist
-- richtig so und bleibt so. Die Tabelle ist eine Rekonstruktion, und eine
-- Rekonstruktion, die sich unbemerkt ändern kann, ist keine.
--
-- Phase C baut diese Rekonstruktion aus der aktualisierten Arbeitsmappe neu
-- auf. Der Verkäufer hat Verkaufszeilen von `x` auf `-` korrigiert — sie
-- waren nie Verkäufe. Damit fallen `sale`-Ereignisse weg, und weil der
-- Startbestand rückwärts gerechnet wird (`Excel F − Einkäufe + Verkäufe`),
-- ändern sich einzelne `opening_balance`-Werte; einer entfällt ganz.
--
-- Der Importer kann das nicht allein: sein technischer Abdruck ist
-- `(Art, Figur, Zustand)` und enthält keine Menge, ein geänderter
-- Startbestand sähe für ihn aus wie „schon da". Er ERKENNT die betroffenen
-- Zeilen — `npm run legacy:history:<env>` listet sie einzeln auf —, darf sie
-- aber nicht entfernen. Genau dafür ist dieses Skript da, und nur dafür.
--
-- WAS ES TUT
--
-- Es entfernt exakt die Zeilen des eingesetzten Blocks, in einer
-- Transaktion, jede einzeln über Id UND Inhalt geprüft. Danach fügt der
-- Importer mit `--apply` die fehlenden Zeilen ein.
--
-- WAS ES NICHT TUT
--
-- Es fasst keine andere Tabelle an: kein `inventory_movements`, kein
-- `shop_inventory`, kein Verkauf, kein Einkauf. Es ändert keine Zeile — es
-- entfernt die benannten und sonst nichts. Der Append-only-Trigger wird für
-- die Dauer dieser einen Transaktion abgeschaltet und in derselben
-- Transaktion wieder eingeschaltet; bricht irgendein Gate, rollt alles
-- zurück, der Trigger eingeschlossen.
--
-- STAGING-LAUF 2026-09-22, ZUR AKTE
--
--   9 Zeilen entfernt: 5 × `opening_balance` (4 davon vom Importer mit
--   neuer Menge wieder eingefügt, 1 ersatzlos) und 4 × `sale` zu vier
--   Arbeitsmappen-Zeilen, die kein `x` mehr tragen.
--   legacy_stock_events 2671 → 2662, danach durch den Importer → 2741.
--
-- Die Zeilen selbst stehen NICHT hier. Es sind Mengen je Figur
-- (`docs/SECURITY.md`), und sie sind ohnehin umgebungsspezifisch: die Ids
-- sind auf Production andere. Der Block wird vor jedem Lauf aus dem
-- Importer-Preview erzeugt, einmal ausgeführt und danach verworfen.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Was entfernt werden soll, und was dabei herauskommen muss.
--
--    Beides kommt aus dem Preview von `tools/import-legacy-history.mts`
--    (Abschnitt „── Rows ──": die mit `~` und `-` gelisteten Zeilen, sowie
--    `in the database` vorher und dieselbe Zahl minus deren Anzahl nachher).
-- ---------------------------------------------------------------------------
create temporary table phase_c_prune (
  id bigint primary key, event_type text, sky_id text, quantity integer, source_row integer
) on commit drop;

create temporary table phase_c_expect (
  rows_before integer not null, rows_after integer not null
) on commit drop;

-- >>> HIER DEN VOM PREVIEW ERZEUGTEN BLOCK EINSETZEN <<<
-- insert into phase_c_prune (id, event_type, sky_id, quantity, source_row) values
--   (<id>, '<event_type>', '<sky_id>', <quantity>, <source_row|null>), … ;
-- insert into phase_c_expect (rows_before, rows_after) values (<vorher>, <nachher>);
--
-- DIESE ZEILEN KOMMEN NICHT INS REPOSITORY. Sie tragen Mengen je Figur und
-- gelten nur für eine Umgebung und einen Zeitpunkt.

-- ---------------------------------------------------------------------------
-- 1. Der Zustand, für den die Freigabe gilt. Weicht er ab, war es eine
--    andere Datenbank oder ein anderer Zeitpunkt — dann lieber nichts tun.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n bigint;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_n from phase_c_prune;
  if v_n = 0 then
    raise exception 'ABBRUCH: phase_c_prune ist leer — der Preview-Block wurde nicht eingesetzt';
  end if;

  select count(*) into v_n from phase_c_expect;
  if v_n <> 1 then
    raise exception 'ABBRUCH: phase_c_expect braucht genau eine Zeile, hat %', v_n;
  end if;
  select rows_before, rows_after into v_before, v_after from phase_c_expect;

  select count(*) into v_n from phase_c_prune;
  if v_before - v_n <> v_after then
    raise exception 'ABBRUCH: % Zeilen sollen entfernt werden, aber % − % geht nicht auf',
      v_n, v_before, v_after;
  end if;

  select count(*) into v_n from public.legacy_stock_events;
  if v_n <> v_before then
    raise exception 'ABBRUCH: legacy_stock_events = %, erwartet %', v_n, v_before;
  end if;

  -- Der Betrieb darf noch nicht begonnen haben: sonst ist die Historie
  -- nicht mehr das Einzige, was den Bestand erklärt.
  select count(*) into v_n from public.inventory_movements;
  if v_n <> 0 then
    raise exception 'ABBRUCH: inventory_movements = %, erwartet 0', v_n;
  end if;

  -- Jede benannte Zeile muss in Id UND Inhalt stimmen. Eine Id allein wäre
  -- eine Zahl; hier muss auch stimmen, was in der Zeile steht.
  select count(*) into v_n
    from phase_c_prune p
    join public.legacy_stock_events e
      on e.id = p.id
     and e.event_type = p.event_type
     and e.sky_id = p.sky_id
     and e.quantity = p.quantity
     and e.source_row is not distinct from p.source_row
     and e.condition = 'loose';
  if v_n <> (select count(*) from phase_c_prune) then
    raise exception 'ABBRUCH: nur % der benannten Zeilen stimmen in Id UND Inhalt', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Den Bestand vor der Änderung festhalten. Dieses Skript darf ihn nicht
--    anfassen, und Gate 4 weist das nach, ohne eine Zahl vorauszusetzen.
-- ---------------------------------------------------------------------------
create temporary table phase_c_stock_before on commit drop as
  select sky_id, condition, quantity, reserved from public.shop_inventory;

-- ---------------------------------------------------------------------------
-- 3. Append-only kurz aussetzen, die benannten Zeilen entfernen, sofort
--    wieder schließen. Die WHERE-Klausel wiederholt die Inhaltsprüfung:
--    selbst wenn die temporäre Tabelle falsch wäre, träfe das DELETE nichts
--    anderes.
-- ---------------------------------------------------------------------------
alter table public.legacy_stock_events disable trigger legacy_stock_events_no_update;

delete from public.legacy_stock_events e
 using phase_c_prune p
 where e.id = p.id
   and e.event_type = p.event_type
   and e.sky_id = p.sky_id
   and e.quantity = p.quantity
   and e.source_row is not distinct from p.source_row;

alter table public.legacy_stock_events enable trigger legacy_stock_events_no_update;

-- ---------------------------------------------------------------------------
-- 4. Nachzählen, bevor die Transaktion steht.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n bigint;
  v_after integer;
begin
  select rows_after into v_after from phase_c_expect;

  select count(*) into v_n from public.legacy_stock_events;
  if v_n <> v_after then
    raise exception 'ABBRUCH: legacy_stock_events = %, erwartet %', v_n, v_after;
  end if;

  select count(*) into v_n
    from public.legacy_stock_events e join phase_c_prune p on p.id = e.id;
  if v_n <> 0 then
    raise exception 'ABBRUCH: % der benannten Zeilen stehen noch', v_n;
  end if;

  select count(*) into v_n from public.inventory_movements;
  if v_n <> 0 then
    raise exception 'ABBRUCH: inventory_movements = %, erwartet 0', v_n;
  end if;

  -- Kein Bestand darf sich bewegt haben — keine Zeile, kein Stück, keine
  -- Reservierung. Verglichen wird gegen den eigenen Vorher-Stand.
  select count(*) into v_n
    from (
      select sky_id, condition, quantity, reserved from public.shop_inventory
      except all
      select sky_id, condition, quantity, reserved from phase_c_stock_before
    ) x;
  if v_n <> 0 then
    raise exception 'ABBRUCH: % shop_inventory-Zeile(n) haben sich veraendert', v_n;
  end if;

  raise notice 'Phase C: % Zeile(n) entfernt, legacy_stock_events = %.',
    (select count(*) from phase_c_prune), v_after;
  raise notice 'Naechster Schritt: npm run legacy:history:<env> -- --apply';
end $$;

commit;
