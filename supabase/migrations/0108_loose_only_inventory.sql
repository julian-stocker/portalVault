-- ===========================================================================
-- 0108 — SkyIsles handelt ausschließlich mit losen Figuren
--
-- DIE ENTSCHEIDUNG. OVP/boxed ist kein operatives SkyIsles-Produkt mehr. Wer
-- originalverpackte Figuren handeln will, nutzt dafür andere Plattformen. Der
-- öffentliche Shop verkauft seit `0028`/`0029` ohnehin nur `loose`:
-- `v1_sale_condition()` liefert konstant `'loose'`, und `shop_offers()`,
-- `shop_quantity_available()` und `create_order()` filtern darauf. Was fehlte,
-- ist die andere Hälfte — der BESTAND durfte weiterhin zwei Positionen pro
-- Figur haben.
--
-- WAS DIESE MIGRATION TUT: zwei Dinge, und nur zwei.
--
--   1. Sie benennt die operative Identität: EINE Lagerzeile pro Figur,
--      als partieller Unique-Index über die losen Zeilen.
--   2. Sie schließt die beiden operativen Schreibtüren, durch die eine
--      boxed-Position entstehen konnte.
--
-- WAS SIE AUSDRÜCKLICH NICHT TUT
--
--   KEIN `check (condition = 'loose')` auf `shop_inventory`. Das wäre der
--   naheliegende Griff und er wäre falsch. `set_shop_listing` schreibt per
--   `insert … on conflict (sky_id, condition) do update` (0041), und
--   `apply_inventory_movement` öffnet die Position mit
--   `insert … on conflict do nothing` (0093) — BEIDE würden an einem solchen
--   CHECK auch dann scheitern, wenn man eine historische boxed-Zeile nur
--   korrigieren oder auslisten will. Ein CHECK fröre diese Zeilen für immer
--   ein, inklusive jeder späteren Berichtigung. Die Regel gehört deshalb in
--   die Funktionen, wo sie eine Ausnahme kennen kann — genau wie
--   `create_order()` sie seit `0028` trägt.
--
--   KEINE SPALTE WIRD ENTFERNT. `condition` bleibt in jeder Tabelle stehen.
--   Historische Werte bleiben lesbar: eine alte Verkaufsposition dokumentiert
--   weiterhin, dass sie OVP war. Das vollständige Entfernen ist ein eigener,
--   später bewusst geplanter Schritt zusammen mit einem Backup-Format V2 —
--   `0104` und `0105` nennen `t.condition` und `inv.condition` wörtlich und
--   sind eingefroren und auf Production angewendet.
--
--   KEINE ZEILE WIRD GELÖSCHT ODER UMGEBUCHT. Staging trägt acht
--   boxed-Zeilen mit zusammen 10 Stück; gemessen read-only am 2026-10-01:
--   NULL `inventory_movements`, NULL `order_reservations`, NULL
--   `order_lines` zeigen darauf. Ihre Bestandszahlen haben also keine
--   Herkunft im Journal. Eine `correction −10` wäre damit keine Korrektur
--   eines dokumentierten Vorfalls, sondern die erste künstliche Zeile ihrer
--   Geschichte. Production trägt NULL boxed-Zeilen — in `shop_inventory`,
--   `sale_items`, `purchase_items`, `order_lines`, `cart_items` und
--   `legacy_stock_events`.
--
--   LEGACY- UND IMPORTPFADE BLEIBEN UNANGETASTET.
--   `system_record_inventory_movement`, `system_add_legacy_purchase_item`,
--   `system_add_legacy_sale_item`, `system_sync_legacy_purchase_item`,
--   `seller_apply_import` und `legacy_stock_events` verarbeiten bewusst
--   historische Daten und müssen boxed weiterhin lesen und schreiben können.
--   Sie sind `service_role`-only oder lesen ihre Condition aus einer
--   Importzeile; aus dem Browser ist keiner von ihnen mit einem frei
--   gewählten `boxed` erreichbar.
--
-- WARUM DAS PRÄDIKAT `'loose'` HEISST UND NICHT `v1_sale_condition()`
--
-- PostgreSQL erlaubt die Funktion im Index-Prädikat — sie ist `immutable`.
-- Trotzdem steht hier das Literal, aus einem Grund, der schwerer wiegt als
-- die Vermeidung einer Dopplung: ein Index-Prädikat wird beim SCHREIBEN
-- ausgewertet und das Ergebnis gespeichert. Änderte jemand später die
-- Funktion, würden bestehende Indexeinträge NICHT neu bewertet — der Index
-- wiche stillschweigend von seiner eigenen Bedingung ab, und `reindex`
-- könnte ihn auf einen anderen Stand bringen als das Schreiben ihn gebaut
-- hat. Ein Index verlangt die Zusage „diese Funktion ändert sich nie"; genau
-- diese Zusage kann eine Funktion nicht geben, deren ganzer Zweck es ist,
-- der eine Ort zu sein, an dem sich die Regel ändern könnte. Dazu kommt die
-- Wiederherstellbarkeit: ein `pg_dump` muss die Funktion vor dem Index
-- anlegen, und ein Prädikat ohne fremde Abhängigkeit ist eine Sorge weniger.
--
-- Die FUNKTIONEN fragen dagegen weiterhin `v1_sale_condition()` — dort ist
-- sie richtig, weil sie bei jedem Aufruf neu ausgewertet wird.
--
-- WAS BLEIBT: `shop_inventory_sky_condition_key (sky_id, condition)` aus
-- `0003`. Sie ist die strukturelle Garantie, dass es pro Figur höchstens EINE
-- lose Zeile gibt; der neue Index ist die Benennung dieser Tatsache als
-- operative Identität. Redundant in der Wirkung, nicht in der Aussage.
--
-- RÜCKBAU.
--   drop index if exists public.shop_inventory_loose_sky_key;
--   -- und die beiden Funktionen aus 0041 unverändert erneut anwenden
-- Es wird nichts migriert, keine Zeile geändert, keine Spalte entfernt.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingung: der Index ist nur anlegbar, wenn er schon wahr ist
--
-- Ein `create unique index` würde ohnehin scheitern, aber mit einer Meldung
-- über einen Schlüsselwert. Diese Prüfung sagt stattdessen, WAS zu tun ist —
-- und sie nennt die Figuren, nicht nur ihre Zahl.
-- ---------------------------------------------------------------------------

do $$
declare
  v_duplicates integer;
  v_names      text;
begin
  select count(*), string_agg(sky_id, ', ' order by sky_id)
    into v_duplicates, v_names
    from (
      select sky_id
        from public.shop_inventory
       where condition = 'loose'
       group by sky_id
      having count(*) > 1
    ) d;

  if v_duplicates > 0 then
    raise exception
      'Diese Figuren haben mehr als eine lose Lagerzeile und müssen zuerst zusammengeführt werden: %',
      v_names
      using errcode = 'check_violation';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die operative Identität: eine lose Lagerzeile pro Figur
--
-- Partiell über `condition = 'loose'`, damit historische boxed-Zeilen
-- daneben bestehen bleiben können — das ist der ganze Unterschied zu einem
-- vollen `unique (sky_id)`, der sie verboten hätte.
-- ---------------------------------------------------------------------------

create unique index if not exists shop_inventory_loose_sky_key
  on public.shop_inventory (sky_id)
  where condition = 'loose';

comment on index public.shop_inventory_loose_sky_key is
  'The operative identity of a stock position since 0108: one row per figure. SkyIsles trades loose figures only, so the operative position is the loose one and a hold or a movement needs no condition to find it. Partial on purpose: historical boxed rows may stay beside it — a full unique (sky_id) would have forbidden them. shop_inventory_sky_condition_key (0003) remains the structural guarantee; this index names what it already guarantees.';


-- ---------------------------------------------------------------------------
-- 3. record_inventory_movement — derselbe Vertrag, eine Tür zu
--
-- SIGNATUR UNVERÄNDERT: (text, text, integer, text, numeric, text, text),
-- `returns bigint`, `language plpgsql`, `security definer`,
-- `set search_path = ''`, volatile (der Standard, wie in 0003/0041 auch).
-- Dieselben sieben Parameter in derselben Reihenfolge mit denselben Defaults
-- — ein `create or replace` ersetzt damit die vorhandene Funktion und legt
-- KEINE zweite Overload an.
--
-- Der Rumpf ist der aus `0041`, mit genau einer zusätzlichen Bedingung
-- davor. Alles andere bleibt: der Wächter, die Weitergabe an
-- `apply_inventory_movement`, `auth.uid()` als Akteur.
-- ---------------------------------------------------------------------------

create or replace function public.record_inventory_movement(
  p_sky_id    text,
  p_condition text,
  p_delta     integer,
  p_reason    text,
  p_unit_cost numeric default null,
  p_currency  text    default null,
  p_note      text    default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Before anything else. EXECUTE is granted to `authenticated` as a whole,
  -- so this check — not the grant — is the authorization.
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * SKYISLES FÜHRT NUR LOSE FIGUREN (0108).
   *
   * Gefragt, nicht behauptet: `v1_sale_condition()` ist dieselbe Funktion,
   * die `shop_offers()`, `shop_quantity_available()` und `create_order()`
   * seit 0028/0029 fragen. Ein Wort, ein Ort, jetzt vier Türen.
   *
   * `check_violation` wie bei einer unzulässigen Menge — die Anwendung
   * bildet denselben Code schon auf dieselbe Antwort ab. Der historische
   * Pfad für Altdaten bleibt `system_record_inventory_movement()`, das kein
   * Browser erreicht.
   */
  if p_condition is distinct from public.v1_sale_condition() then
    raise exception
      'SkyIsles führt nur lose Figuren; % ist keine operative Lagerposition',
      coalesce(p_condition, '(null)')
      using errcode = 'check_violation';
  end if;

  -- The actor is read from the request, never accepted as an argument.
  return public.apply_inventory_movement(
    p_sky_id, p_condition, p_delta, p_reason,
    p_unit_cost, p_currency, p_note, (select auth.uid())
  );
end;
$$;

comment on function public.record_inventory_movement(text, text, integer, text, numeric, text, text) is
  'Books a stock movement for a signed-in shop administrator. Records auth.uid() as the actor. Since 0108 it refuses any condition other than v1_sale_condition(): SkyIsles trades loose figures only, and the operative stock knows one position per figure. Historical data still moves through system_record_inventory_movement(), which no browser can reach.';

/*
 * Die Rechte überleben ein `create or replace` — sie werden hier trotzdem
 * erneut gesetzt, damit die Datei allein sagt, wer die Funktion ausführen
 * darf. Identisch zu `0003`.
 */
revoke all on function public.record_inventory_movement(text, text, integer, text, numeric, text, text)
  from public, anon;
grant execute on function public.record_inventory_movement(text, text, integer, text, numeric, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 4. set_shop_listing — dieselbe Tür, dieselbe Behandlung
--
-- SIGNATUR UNVERÄNDERT: (text, text, numeric, boolean, text),
-- `returns bigint`, `language plpgsql`, `security definer`,
-- `set search_path = ''`, volatile. Rumpf aus `0041`, eine Bedingung mehr.
--
-- WICHTIG FÜR DIE REIHENFOLGE: diese Funktion ist der einzige Weg, eine
-- bestehende boxed-Zeile auszulisten (`is_listed = false`). Nach dieser
-- Migration geht das nicht mehr über sie. Wer die acht Staging-Zeilen
-- auslisten will, muss das VOR 0108 tun — oder danach über einen
-- ausdrücklich dafür gebauten Pfad. Genau deshalb steht kein CHECK auf der
-- Tabelle: ein Guard in der Funktion lässt sich später um eine benannte
-- Ausnahme erweitern, ein CHECK nicht.
-- ---------------------------------------------------------------------------

create or replace function public.set_shop_listing(
  p_sky_id     text,
  p_condition  text,
  p_sale_price numeric,
  p_is_listed  boolean,
  p_note       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory_id bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- The figure still has to exist. Everything else about it — active,
  -- visible, collectible, priced, in stock — is the projection's question.
  if not exists (select 1 from public.skylanders where sky_id = p_sky_id) then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  -- SkyIsles führt nur lose Figuren (0108). Siehe den Kopf von Abschnitt 3.
  if p_condition is distinct from public.v1_sale_condition() then
    raise exception
      'SkyIsles führt nur lose Figuren; % ist keine operative Lagerposition',
      coalesce(p_condition, '(null)')
      using errcode = 'check_violation';
  end if;

  insert into public.shop_inventory (sky_id, condition, sale_price, is_listed, note)
  values (p_sky_id, p_condition, p_sale_price, coalesce(p_is_listed, true), p_note)
  on conflict (sky_id, condition) do update
     set sale_price = excluded.sale_price,
         is_listed  = excluded.is_listed,
         note       = excluded.note
  returning id into v_inventory_id;

  return v_inventory_id;
end;
$$;

comment on function public.set_shop_listing(text, text, numeric, boolean, text) is
  'Sets price, listing flag and internal note for a stock position, creating it at quantity 0 if needed. Never changes quantity or reserved. Since 0108 it refuses any condition other than v1_sale_condition(): SkyIsles trades loose figures only. A historical boxed row can therefore no longer be re-listed or de-listed through this function — that was the price of closing the door, and it is why no CHECK sits on the table.';

revoke all on function public.set_shop_listing(text, text, numeric, boolean, text)
  from public, anon;
grant execute on function public.set_shop_listing(text, text, numeric, boolean, text)
  to authenticated;
