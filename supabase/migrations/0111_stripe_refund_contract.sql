-- ===========================================================================
-- 0111 — EINE RÜCKERSTATTUNG IST ERST ERSTATTET, WENN DER ZAHLUNGSDIENST
--        SIE BESTÄTIGT HAT
--
-- ADDITIV. Keine Spalte entfernt, keine Zeile gelöscht, keine Stornierung
-- zurückgenommen, keine Lagerbewegung angefasst. `order_refunds` bleibt die
-- Tabelle, die sie seit `0047` ist, und bekommt einen Provider-Zustand.
--
-- ---------------------------------------------------------------------------
-- DAS PROBLEM, AN EINEM ECHTEN FALL
--
-- SI-2026-001009: Stripe hat 7,85 € belastet, in SkyIsles wurde eine Position
-- über 0,76 € storniert und `seller_record_refund()` gerufen. Danach stand die
-- Bestellung auf `partially_refunded`, die Kundenansicht zeigte „−0,76 €", der
-- Nachrichtenkanal „Rückerstattung abgeschlossen" — und bei Stripe war nichts
-- erstattet. Die Buchung WAR die Behauptung.
--
-- Der Grund war kein Fehler im Code, sondern eine Lücke im Vertrag:
-- `provider_refund_id` war optional, nullable und von nichts geprüft. Damit
-- gab es genau einen Zustand für zwei völlig verschiedene Tatsachen —
-- „jemand hat es eingetragen" und „der Zahlungsdienst hat gezahlt".
--
-- ---------------------------------------------------------------------------
-- DIE TRENNUNG, DIE DIESE MIGRATION EINFÜHRT
--
--   `order_refunds`          die BUCHUNG. Entsteht wie bisher, atomar, mit
--                            ihrer Aufteilung. Sie sagt, was erstattet werden
--                            SOLL.
--   `provider_status`        der GELDFLUSS. `none` → `pending` → `succeeded`
--                            oder `failed`. Nur `succeeded` ist Geld.
--
-- Alles, was nach außen geht — `orders.payment_status`, die Kundenansicht,
-- der Nachrichtentext, die Erstattungsmail — hängt ab jetzt am ZWEITEN.
-- Die Betreibersicht sieht beide, benannt.
--
-- KEINE LEGACY-SONDERREGEL. Die eine bestehende Erstattung bekommt
-- `provider_status = 'none'` wie jede andere nicht ausgelöste Buchung. Die
-- Bestellung gilt damit bis zur echten Stripe-Erstattung wieder als bezahlt,
-- und das ist die Wahrheit, nicht ein Rückschritt.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE MIGRATION NICHT TUT
--
--   * Sie ruft Stripe nicht. Das kann keine Datenbankfunktion und soll sie
--     nicht können — der Aufruf lebt in der Edge Function `refund-payment`,
--     die den Restricted Key hält (ADR-0051).
--   * Sie fasst das Orderbuch nicht an. `sale_refunds` und
--     `seller_add_sale_refund()` bleiben Zeile für Zeile unverändert: eBay
--     erstattet außerhalb von SkyIsles, dort IST die Buchung die Wahrheit.
--   * Sie fasst Bestand, Reservierungen, Stornierungen und Retouren nicht an.
--     `seller_cancel_order_line()` und alles aus `0095`/`0097`/`0100` bleiben
--     unverändert; eine Erstattung war nie und ist nie eine Lagerbewegung.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'order_refunds') then
    raise exception '0111 setzt 0047 voraus: public.order_refunds fehlt';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'order_refund_allocations') then
    raise exception '0111 setzt 0095 voraus: public.order_refund_allocations fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payment_attempts'
                    and column_name = 'provider_intent_id') then
    raise exception '0111 setzt 0101 voraus: payment_attempts.provider_intent_id fehlt';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_refunds'
                and column_name = 'provider_status') then
    raise notice '0111 scheint bereits angewendet zu sein — die Schritte sind idempotent';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die Felder
--
-- `provider` ist bewusst nullable: eine Erstattung, die nie an einen
-- Zahlungsdienst ging, hat keinen. `provider_status` ist es nicht — jede
-- Zeile hat einen Geldfluss-Zustand, und der Vorgabewert ist der ehrliche.
-- ---------------------------------------------------------------------------
alter table public.order_refunds
  add column if not exists provider              text,
  add column if not exists provider_status       text not null default 'none',
  add column if not exists provider_payment_ref  text,
  add column if not exists provider_confirmed_by text,
  add column if not exists idempotency_key       text,
  add column if not exists provider_attempts     integer not null default 0,
  add column if not exists requested_at          timestamptz,
  add column if not exists settled_at            timestamptz,
  add column if not exists failure_code          text;

comment on column public.order_refunds.provider_status is
  'The MONEY, as distinct from the booking: none (booked, never sent to a provider) · pending (sent, no confirmation yet) · succeeded (the provider confirmed) · failed (the provider refused). Only succeeded counts as refunded — orders.payment_status, the customer view, the conversation line and the refund mail all derive from it (0111).';
comment on column public.order_refunds.provider_refund_id is
  'The provider''s own refund id (re_… at Stripe). Unique, write-once, never overwritten: it is the proof the money moved (0047, made binding by 0111).';
comment on column public.order_refunds.idempotency_key is
  'The key the provider call carries, derived from this row and its attempt number — skyisles-refund-<id> for the first attempt, …-r2 for the next (0111). Stable across retries of the SAME attempt, which is what makes a lost response harmless: the provider replays its first answer instead of refunding twice.';
comment on column public.order_refunds.provider_payment_ref is
  'What the refund went against — a Stripe PaymentIntent (pi_…) or charge (ch_…). Stored so a webhook with no metadata can still be matched to this refund (0111).';
comment on column public.order_refunds.provider_confirmed_by is
  'Who said it succeeded: api (our own call''s answer), webhook (the provider told us afterwards), operator (a human pasted an id for a refund made outside SkyIsles). A fact about the evidence, not about the money (0111).';
comment on column public.order_refunds.provider_attempts is
  'How many times a provider call was started for this refund. Only ever grows, and it is what makes a retry after a CONFIRMED failure use a new idempotency key while a retry of an unfinished attempt reuses the old one (0111).';


-- ---------------------------------------------------------------------------
-- 2. Was die Spalten dürfen
--
-- Jede Zusicherung hier verhindert genau einen Weg, auf dem die Lücke von
-- SI-2026-001009 wiederkommen könnte.
-- ---------------------------------------------------------------------------

-- Der Schlüssel existiert für jede Zeile, auch für die bestehende. Abgeleitet,
-- nicht geraten: die Zeilen-ID ist unveränderlich, also ist der Schlüssel es.
update public.order_refunds
   set idempotency_key = 'skyisles-refund-' || id::text
 where idempotency_key is null;

-- Eine Zeile, die schon eine Provider-ID trug, ist durch einen Menschen
-- belegt — nicht durch unseren Aufruf. Genau das sagt `operator`.
update public.order_refunds
   set provider_status       = 'succeeded',
       provider              = coalesce(provider, 'stripe'),
       provider_confirmed_by = coalesce(provider_confirmed_by, 'operator'),
       settled_at            = coalesce(settled_at, occurred_at)
 where provider_refund_id is not null
   and provider_status = 'none';

alter table public.order_refunds
  alter column idempotency_key set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_refunds_provider_status_known') then
    alter table public.order_refunds
      add constraint order_refunds_provider_status_known
        check (provider_status in ('none', 'pending', 'succeeded', 'failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_refunds_provider_known') then
    alter table public.order_refunds
      add constraint order_refunds_provider_known
        check (provider is null or provider in ('stripe'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_refunds_confirmed_by_known') then
    alter table public.order_refunds
      add constraint order_refunds_confirmed_by_known
        check (provider_confirmed_by is null
               or provider_confirmed_by in ('api', 'webhook', 'operator'));
  end if;

  /*
   * DIE WICHTIGSTE: `succeeded` OHNE BEWEIS IST UNMÖGLICH.
   *
   * Genau das hätte den Vorfall verhindert. Eine Zeile darf nicht behaupten,
   * das Geld sei zurück, ohne die Kennung zu nennen, unter der es zurückging.
   */
  if not exists (select 1 from pg_constraint where conname = 'order_refunds_settled_needs_proof') then
    alter table public.order_refunds
      add constraint order_refunds_settled_needs_proof
        check (provider_status <> 'succeeded'
               or (provider_refund_id is not null
                   and provider is not null
                   and provider_confirmed_by is not null
                   and settled_at is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_refunds_pending_needs_request') then
    alter table public.order_refunds
      add constraint order_refunds_pending_needs_request
        check (provider_status <> 'pending'
               or (requested_at is not null and provider is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_refunds_failed_needs_code') then
    alter table public.order_refunds
      add constraint order_refunds_failed_needs_code
        check (provider_status <> 'failed' or failure_code is not null);
  end if;

  -- Eine nie ausgelöste Buchung trägt keine Spuren eines Aufrufs.
  if not exists (select 1 from pg_constraint where conname = 'order_refunds_none_is_clean') then
    alter table public.order_refunds
      add constraint order_refunds_none_is_clean
        check (provider_status <> 'none'
               or (provider_refund_id is null and settled_at is null
                   and failure_code is null));
  end if;
end;
$$;

-- Eine Provider-Erstattung gehört genau einer Buchung. Ohne das könnte ein
-- einziger Stripe-Refund zwei interne Zeilen belegen.
create unique index if not exists order_refunds_provider_refund_unique
  on public.order_refunds (provider_refund_id)
  where provider_refund_id is not null;

create unique index if not exists order_refunds_idempotency_unique
  on public.order_refunds (idempotency_key);

create index if not exists order_refunds_provider_status_idx
  on public.order_refunds (provider_status)
  where provider_status in ('pending', 'none');

create index if not exists order_refunds_payment_ref_idx
  on public.order_refunds (provider_payment_ref)
  where provider_payment_ref is not null;


-- ---------------------------------------------------------------------------
-- 2b. Was niemand mehr ändern darf
--
-- `idempotency_key` und `provider_refund_id` sind Beweisstücke. Ein UPDATE,
-- das den Schlüssel verschiebt, macht aus einer Wiederholung eine zweite
-- Erstattung; ein UPDATE, das die Refund-ID ersetzt, macht aus einem Beweis
-- eine Behauptung. Beides geht ab hier nicht mehr — auch nicht aus einem
-- Reparaturskript, und das ist der Zweck.
-- ---------------------------------------------------------------------------
create or replace function public.order_refunds_guard_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * Einmal geschrieben, nie wieder — mit genau einer Ausnahme, und die ist
   * nicht Bequemlichkeit: der endgültige Schlüssel enthält die Zeilen-ID, und
   * die gibt es erst NACH dem INSERT. `seller_record_refund()` setzt deshalb
   * zuerst einen eindeutigen Platzhalter (`pending-<uuid>`, damit der
   * Unique-Index auch dazwischen hält) und ersetzt ihn im selben Aufruf durch
   * `skyisles-refund-<id>`. Danach ist der Schlüssel unveränderlich, und ein
   * Platzhalter kann nie zurückkehren.
   */
  if new.idempotency_key is distinct from old.idempotency_key
     and not (old.idempotency_key like 'pending-%'
              and new.idempotency_key not like 'pending-%') then
    raise exception 'an idempotency key is written once (refund %)', old.id
      using errcode = 'restrict_violation';
  end if;

  if old.provider_refund_id is not null
     and new.provider_refund_id is distinct from old.provider_refund_id then
    raise exception 'a provider refund id is written once (refund %)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- Ein bestätigter Geldfluss wird nicht zurückgedreht. Scheitert eine
  -- Erstattung NACH der Bestätigung — eine Bank weist sie zurück —, ist das
  -- `failed` über `reconcile_order_refund()`, und `provider_refund_id` bleibt
  -- stehen: die Kennung hat es gegeben, das Geld nicht.
  if old.provider_status = 'succeeded' and new.provider_status not in ('succeeded', 'failed') then
    raise exception 'a settled refund does not become % (refund %)', new.provider_status, old.id
      using errcode = 'restrict_violation';
  end if;

  if new.amount is distinct from old.amount and old.provider_status <> 'none' then
    raise exception 'the amount of a refund already sent to a provider may not change (refund %)', old.id
      using errcode = 'restrict_violation';
  end if;

  if new.provider_attempts < old.provider_attempts then
    raise exception 'the attempt counter only grows (refund %)', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function public.order_refunds_guard_proof() is
  'Keeps the two proofs on a refund write-once — the idempotency key and the provider refund id — and keeps a settled refund from being talked back into an unsettled one (0111).';

drop trigger if exists order_refunds_guard_proof on public.order_refunds;
create trigger order_refunds_guard_proof
  before update on public.order_refunds
  for each row execute function public.order_refunds_guard_proof();


-- ---------------------------------------------------------------------------
-- 3. Die zwei Summen, und warum es zwei sind
--
--   `order_refunded_total`        was ERSTATTET ist. Nur `succeeded`. Das ist
--                                 die Zahl für jede Außenwirkung.
--   `order_refunds_booked_total`  was GEBUCHT ist, gleich welchen Zustands.
--                                 Das ist die Obergrenze: zweimal 7,85 € zu
--                                 buchen muss unmöglich bleiben, auch wenn
--                                 noch keine der beiden ausgelöst wurde.
--
-- Beide abgeleitet, nichts gespeichert (ADR-0083).
-- ---------------------------------------------------------------------------
create or replace function public.order_refunded_total(p_order_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount), 0)
    from public.order_refunds r
   where r.order_id = p_order_id
     and r.provider_status = 'succeeded';
$$;

comment on function public.order_refunded_total(bigint) is
  'What has actually been refunded for an order: the sum of refunds the provider confirmed (0111). The number every customer-facing figure and orders.payment_status derive from.';

create or replace function public.order_refunds_booked_total(p_order_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount), 0)
    from public.order_refunds r
   where r.order_id = p_order_id;
$$;

comment on function public.order_refunds_booked_total(bigint) is
  'Every refund booked against an order, settled or not (0111). The ceiling check uses this one: booking twice what was paid must stay impossible even while nothing has been sent to the provider yet.';


-- ---------------------------------------------------------------------------
-- 4. Der Status ist eine Spiegelung, und ab jetzt eine ehrliche
--
-- `orders.payment_status` bleibt eine gespiegelte Bequemlichkeit für Listen
-- und Filter — das war seit `0047` so. Neu ist, WORAUS gespiegelt wird:
-- aus bestätigten Erstattungen, nie aus Buchungen.
--
-- Eine Bestellung, deren Erstattungen alle noch `none` sind, steht wieder auf
-- `paid`. Das ist kein Rückschritt, sondern die Behebung einer falschen
-- Aussage.
--
-- `cancelled`, `failed`, `expired` und `pending` werden NICHT angefasst: eine
-- Erstattung setzt keinen Zahlungszustand, sie verringert einen bezahlten.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_order_payment_status(p_order_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_settled numeric;
  v_target  text;
begin
  select o.id, o.total_amount, o.payment_status into v_order
    from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'no such order %', p_order_id using errcode = 'invalid_parameter_value';
  end if;

  -- Nur die drei Zustände, die eine Erstattung überhaupt betreffen kann.
  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    return v_order.payment_status;
  end if;

  v_settled := public.order_refunded_total(p_order_id);

  v_target := case
                when v_settled <= 0 then 'paid'
                when v_settled >= v_order.total_amount then 'refunded'
                else 'partially_refunded'
              end;

  if v_target <> v_order.payment_status then
    update public.orders set payment_status = v_target where id = p_order_id;
  end if;

  return v_target;
end;
$$;

comment on function public.refresh_order_payment_status(bigint) is
  'Mirrors orders.payment_status from the refunds the provider has CONFIRMED (0111): paid when nothing is settled, refunded when all of it is, partially_refunded in between. Touches no other payment status — a refund lowers a paid order, it never revives a cancelled or failed one. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 5. Die Buchung — fast unverändert, mit zwei Unterschieden
--
-- Signatur, Prüfungen, Aufteilungen und Widerrufsabschluss bleiben Zeile für
-- Zeile die aus `0095`. Geändert ist genau zweierlei:
--
--   1. Der Status wird nicht mehr direkt gesetzt, sondern gespiegelt. Eine
--      frische Buchung ist `none`, also bleibt eine bezahlte Bestellung
--      bezahlt, bis Stripe erstattet hat.
--   2. `p_provider_refund_id` ist weiterhin erlaubt — für eine Erstattung,
--      die außerhalb von SkyIsles stattfand — und macht die Zeile dann sofort
--      `succeeded`, bestätigt `operator`. Ohne ID: `none`.
--
-- Die Obergrenze zählt GEBUCHTES, nicht Bestätigtes. Sonst ließe sich der
-- ganze Betrag zweimal buchen, solange noch keine der Buchungen ausgelöst ist.
-- ---------------------------------------------------------------------------
create or replace function public.seller_record_refund(
  p_order_number text,
  p_amount       numeric,
  p_reason       text default null,
  p_withdrawal_id bigint default null,
  p_provider_refund_id text default null,
  -- [{type, order_line_id, quantity, amount}, …]. Leer oder NULL ist erlaubt.
  p_allocations jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_paid   numeric;
  v_so_far numeric;
  v_id     bigint;
  v_alloc  jsonb;
  v_sum    numeric := 0;
  v_type   text;
  v_line   bigint;
  v_qty    integer;
  v_amount numeric;
  v_proof  text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
  v_status text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'no such order' using errcode = 'invalid_parameter_value';
  end if;

  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'only a paid order can be refunded'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a refund needs a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  v_paid   := v_order.total_amount;
  v_so_far := public.order_refunds_booked_total(v_order.id);

  if v_so_far + p_amount > v_paid then
    raise exception 'that is more than was paid for this order'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DIE TEILE MÜSSEN DAS GANZE ERGEBEN — oder es gibt keine Teile.
   *
   * Geprüft BEVOR irgendetwas geschrieben wird, damit eine unvollständige
   * Aufteilung nie neben einer vollständigen Erstattung steht.
   */
  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
      v_type   := v_alloc ->> 'type';
      v_line   := nullif(v_alloc ->> 'order_line_id', '')::bigint;
      v_qty    := nullif(v_alloc ->> 'quantity', '')::integer;
      v_amount := (v_alloc ->> 'amount')::numeric;

      if v_type is null or v_type not in ('line', 'shipping', 'goodwill', 'other') then
        raise exception 'unknown allocation type %', coalesce(v_type, '(null)')
          using errcode = 'invalid_parameter_value';
      end if;
      if v_amount is null or v_amount <= 0 then
        raise exception 'an allocation needs a positive amount'
          using errcode = 'invalid_parameter_value';
      end if;
      if (v_type = 'line') <> (v_line is not null) then
        raise exception 'only a line allocation names a position'
          using errcode = 'invalid_parameter_value';
      end if;
      if v_line is not null and not exists (
        select 1 from public.order_lines l
         where l.id = v_line and l.order_id = v_order.id
      ) then
        raise exception 'that position does not belong to order %', v_order.order_number
          using errcode = 'invalid_parameter_value';
      end if;

      v_sum := v_sum + v_amount;
    end loop;

    if round(v_sum, 2) <> round(p_amount, 2) then
      raise exception 'the parts come to % but the refund is %', v_sum, p_amount
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_status := case when v_proof is null then 'none' else 'succeeded' end;

  insert into public.order_refunds (
    order_id, amount, currency, reason, withdrawal_request_id,
    provider_refund_id, created_by,
    provider, provider_status, provider_confirmed_by, settled_at, idempotency_key
  ) values (
    v_order.id, p_amount, v_order.currency, p_reason, p_withdrawal_id,
    v_proof, auth.uid(),
    case when v_proof is null then null else 'stripe' end,
    v_status,
    case when v_proof is null then null else 'operator' end,
    case when v_proof is null then null else now() end,
    -- Platzhalter; der echte Schlüssel braucht die ID, die es erst nach dem
    -- INSERT gibt. Eindeutig, damit der Unique-Index auch dazwischen hält.
    'pending-' || gen_random_uuid()::text
  ) returning id into v_id;

  update public.order_refunds
     set idempotency_key = 'skyisles-refund-' || v_id::text
   where id = v_id;

  if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then
    insert into public.order_refund_allocations
      (refund_id, order_line_id, quantity, amount, allocation_type)
    select
      v_id,
      nullif(a ->> 'order_line_id', '')::bigint,
      nullif(a ->> 'quantity', '')::integer,
      (a ->> 'amount')::numeric,
      a ->> 'type'
      from jsonb_array_elements(p_allocations) a;
  end if;

  -- Gespiegelt, nicht gesetzt (0111). Eine Buchung ohne Beweis ändert nichts.
  perform public.refresh_order_payment_status(v_order.id);

  /*
   * ZWEI EREIGNISSE, UND DAS IST DER GANZE UNTERSCHIED (0111).
   *
   * `refund_booked`    die Buchung. Nur für das Protokoll und die
   *                    Betreibersicht. Bewusst NICHT `refund_recorded`:
   *                    `order_conversation()` (0098) und die
   *                    Aufmerksamkeitszähler (0099) lesen `refund_recorded`
   *                    und zeigen der Kundschaft „Rückerstattung über X
   *                    abgeschlossen". Genau dieser Satz war bei
   *                    SI-2026-001009 falsch.
   * `refund_recorded`  der Geldfluss. Geschrieben von
   *                    `attach_order_refund()`, wenn der Zahlungsdienst
   *                    bestätigt hat — oder hier, wenn der Betreiber eine
   *                    fremde Erstattung mit ihrer Kennung einträgt.
   *
   * Dadurch bleiben 0098 und 0099 Zeile für Zeile unverändert: dieselbe
   * Ereignisart, derselbe Text, nur ein anderer — wahrer — Anlass.
   */
  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_order.id,
          case when v_status = 'succeeded' then 'refund_recorded' else 'refund_booked' end,
          'admin',
          jsonb_build_object('refund_id', v_id, 'amount', p_amount::text,
                             'provider_status', v_status));

  if p_withdrawal_id is not null then
    update public.withdrawal_requests w
       set handled_at = coalesce(w.handled_at, now()), handled_by = auth.uid()
     where w.id = p_withdrawal_id and w.order_id = v_order.id;
  end if;

  return jsonb_build_object(
    'refund_id',       v_id,
    'provider_status', v_status,
    -- Was erstattet IST, nicht was gebucht ist. Der Aufrufer entscheidet
    -- daran, ob eine Mail hinausgeht.
    'refunded_total',  public.order_refunded_total(v_order.id),
    'booked_total',    public.order_refunds_booked_total(v_order.id));
end;
$$;

comment on function public.seller_record_refund(text, numeric, text, bigint, text, jsonb) is
  'BOOKS a repayment (0047, allocations 0095, provider state 0111). Moves no money and touches no stock. Since 0111 it no longer claims the money moved: without a provider refund id the row is provider_status = none and orders.payment_status stays paid. Pass a provider refund id for a repayment made outside SkyIsles and the row is settled, confirmed by operator. The amount ceiling counts BOOKED refunds, the status mirror counts CONFIRMED ones.';


-- ---------------------------------------------------------------------------
-- 5b. Dieselbe Berechtigung, für einen genannten Menschen
--
-- `can_operate_active_seller()` liest `auth.uid()` — in einer Edge Function,
-- die mit dem Service-Role-Schlüssel spricht, ist das NULL. `send-order-mail`
-- löst dasselbe Problem seit `0019` mit `is_shop_admin_for(uuid)`; dies ist
-- das Gegenstück für den Verkäuferbetrieb.
--
-- WARUM ES ÜBERHAUPT GEBRAUCHT WIRD. Die Erstattungsfunction wird von einer
-- Server Action aufgerufen, die den Benutzertoken mitschickt — kein geteiltes
-- Geheimnis, denn ein solches müsste im Web-Deployment liegen, und dort liegt
-- nichts Privilegiertes (ADR-0051, `docs/DEPLOYMENT.md`). Die Function prüft
-- den Token selbst und fragt dann hier nach der Rolle. Die Buchung war schon
-- hinter derselben Prüfung; dies ist die zweite Tür am selben Weg.
--
-- Wortgleich mit `0041`, nur mit genanntem Benutzer statt `auth.uid()`.
-- ---------------------------------------------------------------------------
create or replace function public.can_operate_seller_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.sellers s
      join public.seller_operators o on o.seller_id = s.id
     where s.is_active
       and o.user_id = p_user_id
       and o.is_enabled
  );
$$;

comment on function public.can_operate_seller_for(uuid) is
  'Whether the NAMED account may run the shop (0111) — the uuid-parameter twin of can_operate_active_seller() from 0041, for an Edge Function that holds a verified user id rather than a request. Says nothing about the platform. Internal: no client role holds EXECUTE.';

revoke all on function public.can_operate_seller_for(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Was die Edge Function wissen muss, und nichts darüber hinaus
--
-- Kein Zugriff auf `orders`, keine Kundendaten, keine Adresse, keine Mail.
-- Betrag, Währung, Welt, Zahlungskennungen, Schlüssel — das ist alles, was ein
-- Erstattungsaufruf braucht.
--
-- `amount_cents` wird HIER gerechnet, nicht in TypeScript: `numeric(10,2)` auf
-- Cent zu bringen ist eine exakte Operation in SQL und eine Gleitkommafrage in
-- JavaScript. Stripe nimmt Minor Units, und 0.76 * 100 ist in JavaScript
-- 76.00000000000001.
-- ---------------------------------------------------------------------------
create or replace function public.order_refund_submission(p_refund_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refund  record;
  v_order   record;
  v_attempt record;
begin
  select r.* into v_refund from public.order_refunds r where r.id = p_refund_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_refund');
  end if;

  select o.* into v_order from public.orders o where o.id = v_refund.order_id;

  -- Der jüngste erfolgreiche Zahlungsversuch. Eine Erstattung geht gegen das
  -- Geld, das angekommen ist, nie gegen einen abgebrochenen Versuch.
  select a.* into v_attempt
    from public.payment_attempts a
   where a.order_id = v_refund.order_id
     and a.status = 'succeeded'
   order by a.paid_at desc nulls last, a.id desc
   limit 1;

  return jsonb_build_object(
    'ok',              true,
    'refund_id',       v_refund.id,
    'order_id',        v_order.id,
    'order_number',    v_order.order_number,
    'amount',          v_refund.amount::text,
    'amount_cents',    (round(v_refund.amount * 100))::bigint,
    'currency',        lower(v_refund.currency),
    'mode',            v_order.commerce_mode,
    'provider_status', v_refund.provider_status,
    'provider_refund_id', v_refund.provider_refund_id,
    'idempotency_key', v_refund.idempotency_key,
    'attempts',        v_refund.provider_attempts,
    'session_id',      v_attempt.provider_payment_id,
    'intent_id',       v_attempt.provider_intent_id,
    'paid_amount',     v_attempt.amount::text,
    'settled_total',   public.order_refunded_total(v_order.id)::text,
    'booked_total',    public.order_refunds_booked_total(v_order.id)::text);
end;
$$;

comment on function public.order_refund_submission(bigint) is
  'Everything a provider refund call needs and nothing else (0111): amount in minor units computed in SQL, currency, the order''s world, the checkout session and PaymentIntent of the successful attempt, and the idempotency key. No customer data. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 7. Den Anspruch nehmen — die erste Idempotenzschicht
--
-- Unter Zeilensperre, damit zwei gleichzeitige Klicks nicht beide
-- durchkommen. Die zweite kommt mit `already_pending` zurück und ruft
-- Stripe nicht.
--
-- WARUM DER SCHLÜSSEL BEIM VERSUCH HÄNGT UND NICHT AM AUFRUF. Ein
-- Wiederholungsaufruf DESSELBEN Versuchs — Function abgestürzt, Antwort
-- verloren — muss denselben Schlüssel tragen, damit Stripe seine erste
-- Antwort wiederholt statt ein zweites Mal zu erstatten. Ein NEUER Versuch
-- nach einem BESTÄTIGTEN Fehlschlag muss einen neuen Schlüssel tragen, weil
-- Stripe sonst den gespeicherten Fehler wiederholt. Deshalb zählt
-- `provider_attempts`, und der Schlüssel trägt die Nummer ab dem zweiten.
--
-- `resume_order_refund()` ist der Weg für den ersten Fall und steht in 7b.
-- ---------------------------------------------------------------------------
create or replace function public.submit_order_refund(p_refund_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund record;
  v_order  record;
  v_key    text;
  v_next   integer;
begin
  select r.* into v_refund
    from public.order_refunds r
   where r.id = p_refund_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_refund');
  end if;

  if v_refund.provider_status = 'succeeded' then
    return jsonb_build_object('ok', false, 'reason', 'already_settled',
                              'provider_refund_id', v_refund.provider_refund_id);
  end if;
  if v_refund.provider_status = 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_pending',
                              'idempotency_key', v_refund.idempotency_key);
  end if;

  /*
   * EIN NACHTRÄGLICH GESCHEITERTER REFUND WIRD NICHT AUF DERSELBEN ZEILE
   * WIEDERHOLT.
   *
   * Der Fall: Stripe hat die Erstattung angenommen (`re_…` steht an der
   * Zeile), und eine Bank hat die Gutschrift Tage später zurückgewiesen —
   * `reconcile` hat die Zeile auf `failed` gesetzt, die Kennung aber behalten,
   * weil es sie gegeben hat.
   *
   * Ein zweiter Versuch darauf wäre eine SECHSTE Erstattung mit einer fremden
   * Kennung daneben: `attach_order_refund()` würde sie zurückweisen, und das
   * Geld wäre unterwegs, ohne dass etwas davon weiß. Der richtige Weg ist eine
   * NEUE Buchung — eigene Zeile, eigener Schlüssel, eigene Aufteilung.
   */
  if v_refund.provider_refund_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_has_provider_refund',
                              'provider_refund_id', v_refund.provider_refund_id,
                              'provider_status', v_refund.provider_status);
  end if;

  select o.* into v_order from public.orders o where o.id = v_refund.order_id;
  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_not_payable',
                              'payment_status', v_order.payment_status);
  end if;
  if v_order.commerce_mode not in ('live', 'sandbox') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_world',
                              'mode', v_order.commerce_mode);
  end if;

  /*
   * NIE MEHR ERSTATTEN ALS BEZAHLT WURDE, auch nicht über mehrere Zeilen.
   * Gezählt wird das BESTÄTIGTE plus dieses — eine andere gebuchte, noch
   * nicht ausgelöste Zeile darf diese hier nicht blockieren.
   */
  if public.order_refunded_total(v_refund.order_id) + v_refund.amount
     > v_order.total_amount then
    return jsonb_build_object('ok', false, 'reason', 'exceeds_payment');
  end if;

  v_next := v_refund.provider_attempts + 1;
  v_key  := 'skyisles-refund-' || v_refund.id::text
            || case when v_next = 1 then '' else '-r' || v_next::text end;

  update public.order_refunds
     set provider          = 'stripe',
         provider_status   = 'pending',
         provider_attempts = v_next,
         idempotency_key   = v_key,
         requested_at      = now(),
         failure_code      = null
   where id = v_refund.id;

  return jsonb_build_object('ok', true, 'reason', 'claimed')
         || public.order_refund_submission(v_refund.id);
end;
$$;

comment on function public.submit_order_refund(bigint) is
  'Claims a booked refund for one provider call (0111). Under a row lock, so two clicks cannot both proceed: the second gets already_pending and calls nothing. Raises the attempt counter and derives the idempotency key from it — a retry of an UNFINISHED attempt reuses the key (see resume_order_refund), a new attempt after a confirmed failure gets a new one. Refuses a settled refund, an unpayable order, an unknown world and anything exceeding what was paid. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 7b. Einen offenen Versuch fortsetzen
--
-- Der Zustand `pending` ist kein Fehler, sondern eine Aufgabe: irgendwo
-- zwischen unserem POST und unserem Schreiben ist etwas abgerissen. Diese
-- Funktion gibt denselben Schlüssel zurück, mit dem der Versuch begann —
-- damit der Aufrufer beim Zahlungsdienst NACHSEHEN und, erst wenn dort
-- nichts liegt, mit DEMSELBEN Schlüssel wiederholen kann.
--
-- Sie ändert nichts. Das ist Absicht: Fortsetzen ist eine Leseoperation.
-- ---------------------------------------------------------------------------
create or replace function public.resume_order_refund(p_refund_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select provider_status into v_status from public.order_refunds where id = p_refund_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_refund');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'provider_status', v_status);
  end if;
  return jsonb_build_object('ok', true, 'reason', 'resumed')
         || public.order_refund_submission(p_refund_id);
end;
$$;

comment on function public.resume_order_refund(bigint) is
  'Hands back the unfinished attempt of a pending refund — same idempotency key, same amount — so the caller can look at the provider first and only repeat the call if nothing is there (0111). Writes nothing. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 8. Den Beweis anheften, oder den Fehlschlag festhalten
--
-- `attach_order_refund` ist die vierte Idempotenzschicht: dieselbe Kennung
-- erneut ist `already_attached`, eine ANDERE Kennung ist ein Fehler. Damit
-- kann weder eine doppelt gelieferte Antwort noch ein gleichzeitiger Webhook
-- etwas verschieben.
-- ---------------------------------------------------------------------------
create or replace function public.attach_order_refund(
  p_refund_id          bigint,
  p_provider_refund_id text,
  p_payment_ref        text default null,
  p_confirmed_by       text default 'api'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund record;
  v_proof  text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
begin
  if v_proof is null then
    raise exception 'a settled refund needs the provider''s own id'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_confirmed_by not in ('api', 'webhook', 'operator') then
    raise exception 'unknown confirmation source %', p_confirmed_by
      using errcode = 'invalid_parameter_value';
  end if;

  select r.* into v_refund
    from public.order_refunds r where r.id = p_refund_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_refund');
  end if;

  if v_refund.provider_refund_id is not null then
    if v_refund.provider_refund_id = v_proof then
      return jsonb_build_object('ok', true, 'reason', 'already_attached',
                                'provider_status', v_refund.provider_status);
    end if;
    raise exception 'refund % already carries a different provider id', p_refund_id
      using errcode = 'restrict_violation';
  end if;

  update public.order_refunds
     set provider              = 'stripe',
         provider_refund_id    = v_proof,
         provider_status       = 'succeeded',
         provider_confirmed_by = p_confirmed_by,
         provider_payment_ref  = coalesce(nullif(btrim(coalesce(p_payment_ref, '')), ''),
                                          provider_payment_ref),
         settled_at            = coalesce(settled_at, now()),
         failure_code          = null
   where id = p_refund_id;

  perform public.refresh_order_payment_status(v_refund.order_id);

  /*
   * ERST HIER WIRD ES EIN EREIGNIS FÜR DIE KUNDSCHAFT.
   *
   * `order_conversation()` (0098) und die Aufmerksamkeitszähler (0099) lesen
   * `refund_recorded` und zeigen „Rückerstattung über X abgeschlossen". Ab
   * 0111 gibt es für diese Ereignisart genau einen Anlass: bestätigtes Geld.
   * Die Buchung schreibt `refund_booked` und erreicht die Kundschaft nicht.
   * Beide Funktionen bleiben dadurch unverändert — der Satz wird wahr, ohne
   * dass ihn jemand umschreiben muss.
   */
  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_refund.order_id, 'refund_recorded', 'provider',
          jsonb_build_object('refund_id', p_refund_id,
                             'amount', v_refund.amount::text,
                             'confirmed_by', p_confirmed_by));

  return jsonb_build_object(
    'ok', true, 'reason', 'attached',
    'refunded_total', public.order_refunded_total(v_refund.order_id),
    'payment_status', (select payment_status from public.orders
                        where id = v_refund.order_id));
end;
$$;

comment on function public.attach_order_refund(bigint, text, text, text) is
  'Writes the provider''s proof onto a refund and makes it settled (0111). Idempotent: the same id again is already_attached, a DIFFERENT id is refused rather than written. Mirrors orders.payment_status and records refund_settled — the one event that means money actually went back. Internal: no client role holds EXECUTE.';


create or replace function public.fail_order_refund(
  p_refund_id bigint,
  p_code      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund record;
  v_code   text := coalesce(nullif(btrim(coalesce(p_code, '')), ''), 'unknown');
begin
  select r.* into v_refund
    from public.order_refunds r where r.id = p_refund_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_refund');
  end if;

  -- Ein bestätigter Refund, den der Zahlungsdienst später zurückweist, behält
  -- seine Kennung: die hat es gegeben, das Geld nicht.
  update public.order_refunds
     set provider_status = 'failed',
         failure_code    = v_code,
         settled_at      = null
   where id = p_refund_id;

  perform public.refresh_order_payment_status(v_refund.order_id);

  insert into public.order_events (order_id, event_type, actor_kind, payload)
  values (v_refund.order_id, 'refund_provider_failed', 'provider',
          jsonb_build_object('refund_id', p_refund_id, 'code', v_code));

  return jsonb_build_object('ok', true, 'reason', 'failed', 'code', v_code);
end;
$$;

comment on function public.fail_order_refund(bigint, text) is
  'Records that the provider refused or reversed a refund (0111). The booking stays, the money does not: provider_status = failed, settled_at cleared, the order''s status mirrored again. A new attempt is allowed and will carry a NEW idempotency key. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 9. Der Webhook: bestätigen, nicht erstatten
--
-- Dieselbe Entprellung wie seit `0012`: der Eindeutigkeitsindex auf
-- `(provider, provider_event_id)` IST die Sperre. Wer den INSERT gewinnt,
-- verarbeitet; alle anderen finden die Zeile vor und hören auf. Ein doppelt
-- geliefertes Ereignis schreibt deshalb nichts zweimal.
--
-- ZUORDNUNG, IN DIESER REIHENFOLGE:
--
--   1. `p_refund_id` aus `metadata.order_refund_id` — gesetzt von unserem
--      eigenen Aufruf. Exakt, und der Normalfall.
--   2. `p_provider_refund_id` gegen eine Zeile, die die Kennung schon trägt.
--      Das ist die Wiederholung.
--   3. `p_payment_ref` (pi_… / ch_…) gegen den Zahlungsversuch der Bestellung,
--      und von dort auf eine noch offene Buchung MIT GLEICHEM BETRAG. Das ist
--      der Fall „jemand hat im Dashboard erstattet".
--
-- Bleibt alles drei erfolglos, wird das Ereignis als `unmatched_refund`
-- festgehalten statt verworfen. Eine Erstattung, die wir nicht zuordnen
-- können, ist ein Befund und kein Nichts.
-- ---------------------------------------------------------------------------
create or replace function public.record_refund_event(
  p_provider            text,
  p_provider_event_id   text,
  p_event_type          text,
  p_provider_refund_id  text,
  p_status              text,            -- succeeded | failed | pending
  p_amount_cents        bigint default null,
  p_payment_ref         text    default null,
  p_refund_id           bigint  default null,
  p_failure_code        text    default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_proof    text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
  v_ref      text := nullif(btrim(coalesce(p_payment_ref, '')), '');
  /*
   * ZEILENTYP, NICHT `record`. Ein nicht zugewiesenes `record` lässt sich
   * nicht auf `.id is null` prüfen — PL/pgSQL wirft dort. Eine Variable des
   * Tabellentyps ist NULL und ihre Felder sind es auch, und genau darauf
   * beruhen die drei Zuordnungsversuche unten.
   */
  v_refund   public.order_refunds;
  v_order    bigint;
  v_outcome  text;
  v_result   text;
begin
  if p_provider <> 'stripe' then
    return 'unknown_provider';
  end if;

  insert into public.payment_events (provider, provider_event_id, event_type)
  values (p_provider, p_provider_event_id, p_event_type)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  -- Schon gesehen UND schon verarbeitet: nichts zu tun.
  if v_event_id is null then
    select e.id into v_event_id
      from public.payment_events e
     where e.provider = p_provider
       and e.provider_event_id = p_provider_event_id
       and e.processed_at is null
     for update;
    if v_event_id is null then
      return 'duplicate_event';
    end if;
  end if;

  -- 1. über unsere eigene Metadaten-Kennung
  if p_refund_id is not null then
    select r.* into v_refund from public.order_refunds r where r.id = p_refund_id;
  end if;

  -- 2. über die Provider-Kennung
  if v_refund.id is null and v_proof is not null then
    select r.* into v_refund from public.order_refunds r
     where r.provider_refund_id = v_proof;
  end if;

  -- 3. über die Zahlung, auf eine offene Buchung gleichen Betrags
  if v_refund.id is null and v_ref is not null and p_amount_cents is not null then
    select o.id into v_order
      from public.orders o
      join public.payment_attempts a on a.order_id = o.id
     where a.provider_intent_id = v_ref or a.provider_payment_id = v_ref
     order by a.id desc
     limit 1;

    if v_order is not null then
      select r.* into v_refund
        from public.order_refunds r
       where r.order_id = v_order
         and r.provider_refund_id is null
         and r.provider_status in ('none', 'pending')
         and (round(r.amount * 100))::bigint = p_amount_cents
       order by r.provider_status = 'pending' desc, r.id asc
       limit 1;
    end if;
  end if;

  if v_refund.id is null then
    update public.payment_events
       set processed_at = now(), outcome = 'unmatched_refund',
           order_id = v_order
     where id = v_event_id;
    return 'unmatched_refund';
  end if;

  if p_status = 'succeeded' then
    if v_refund.provider_status = 'succeeded'
       and v_refund.provider_refund_id = coalesce(v_proof, v_refund.provider_refund_id) then
      v_result  := 'already_settled';
      v_outcome := 'already_confirmed';
    else
      perform public.attach_order_refund(v_refund.id, v_proof, v_ref, 'webhook');
      v_result  := 'settled';
      v_outcome := 'confirmed';
    end if;
  elsif p_status = 'failed' then
    if v_refund.provider_status = 'failed' then
      v_result  := 'already_failed';
      v_outcome := 'refund_failed';
    else
      perform public.fail_order_refund(v_refund.id,
                coalesce(nullif(btrim(coalesce(p_failure_code, '')), ''), 'provider_failed'));
      v_result  := 'provider_failed';
      v_outcome := 'refund_failed';
    end if;
  else
    -- Ein Zwischenstand (`pending`) wird vermerkt und ändert nichts.
    v_result  := 'noted';
    v_outcome := 'confirmed';
  end if;

  update public.payment_events
     set processed_at = now(), outcome = v_outcome,
         order_id = v_refund.order_id,
         payment_attempt_id = (
           select a.id from public.payment_attempts a
            where a.order_id = v_refund.order_id and a.status = 'succeeded'
            order by a.paid_at desc nulls last, a.id desc limit 1)
   where id = v_event_id;

  return v_result;
end;
$$;

comment on function public.record_refund_event(text, text, text, text, text, bigint, text, bigint, text) is
  'What a Stripe refund webhook does to our records (0111): deduplicated by the unique index on (provider, provider_event_id) exactly as 0012 does it, then matched to a refund by our own metadata id, by the provider refund id, or by the payment plus an equal open amount. Confirms or fails that refund; an unmatchable refund is recorded as unmatched_refund rather than dropped. Calls Stripe never. Internal: no client role holds EXECUTE.';


-- ---------------------------------------------------------------------------
-- 9b. `payment_events.outcome` kennt zwei Ausgänge mehr
--
-- Der CHECK aus `0012` listet die Ausgänge der ZAHLUNG. Eine Erstattung hat
-- zwei weitere, und ohne sie würde `record_refund_event()` am CHECK scheitern.
-- Erweitert, nicht geöffnet: die Liste bleibt geschlossen.
-- ---------------------------------------------------------------------------
alter table public.payment_events
  drop constraint if exists payment_events_outcome_known;

alter table public.payment_events
  add constraint payment_events_outcome_known
    check (outcome is null or outcome in (
      'confirmed',
      'already_confirmed',
      'amount_mismatch',
      'late_payment_unresolved',
      'attempt_failed',
      'unknown_payment',
      -- 0111: eine Erstattung, die zu keiner Buchung passt. Ein Befund.
      'unmatched_refund',
      -- 0111: der Zahlungsdienst hat die Erstattung abgelehnt oder zurückgezogen.
      'refund_failed'
    ));


-- ---------------------------------------------------------------------------
-- 10. Die Kundenansicht zeigt nur bestätigtes Geld
--
-- Unverändert übernommen aus `0102`, mit genau zwei Änderungen: die beiden
-- Summen und der Erstattungsanteil einer Position lesen `succeeded` statt
-- „alles". Jede andere Zeile ist die aus 0102.
-- ---------------------------------------------------------------------------
create or replace function public.my_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
   where o.order_number = p_order_number
     and o.user_id = (select auth.uid());

  if not found then
    -- Unknown and not-yours answer the same, as everywhere else.
    return null;
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'currency',           v_order.currency,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      -- The code as well as the label: a tracking link is built from the
      -- carrier the catalogue keys on, never from a display name somebody
      -- may rename to "DHL Paket" (ADR-0062).
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'commerce_mode',      v_order.commerce_mode,
      /*
       * WAS SEITHER GESCHAH, auf Bestellebene (0102, präzisiert 0111).
       *
       * `refunded_total` ist die Summe der Erstattungen, die der
       * Zahlungsdienst BESTÄTIGT hat, `remaining_total` die Differenz zum
       * ursprünglichen Betrag. Beide abgeleitet, nichts gespeichert:
       * `total_amount` bleibt, was vereinbart war.
       *
       * BIS 0111 WAR ES DIE SUMME ALLER BUCHUNGEN. Damit sah die Kundschaft
       * bei SI-2026-001009 „−0,76 €", während bei Stripe nichts erstattet
       * war. Eine Buchung ohne Geldfluss ist eine Absicht des Betriebs und
       * keine Tatsache über das Konto der Kundschaft; sie hat hier nichts zu
       * suchen und steht nur in der Betreibersicht.
       */
      'refunded_total',  public.order_refunded_total(v_order.id),
      'remaining_total', v_order.total_amount - public.order_refunded_total(v_order.id),
      /*
       * WOMIT BEZAHLT WURDE (0101). Aus dem jüngsten erfolgreichen Versuch,
       * und nur, wenn der Schnappschuss existiert — vor 0101 bezahlte
       * Bestellungen tragen hier NULL, und die Anzeige sagt dann nichts.
       */
      'payment_method', (
        select jsonb_build_object(
                 'type',   a.payment_method_type,
                 'brand',  a.card_brand,
                 'last4',  a.card_last4,
                 'wallet', a.wallet_type)
          from public.payment_attempts a
         where a.order_id = v_order.id
           and a.status = 'succeeded'
           and a.method_recorded_at is not null
         order by a.paid_at desc nulls last, a.id desc
         limit 1
      )
    ),
    -- The address as it was agreed, not as the account holds it today. This
    -- is the whole point of the snapshot (ADR-0049).
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id and a.kind = 'shipping'
       limit 1
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total,
               /*
                * DIESELBEN MENGEN, DIE DER BETRIEB SIEHT (0095, über
                * `admin_order()` seit 0096). Kein zweiter Rechenweg: wo zwei
                * Seiten dieselbe Bestellung ansehen, dürfen sie nicht zwei
                * Antworten bekommen.
                */
               'cancelled', q.cancelled,
               'returned', q.returned,
               'fulfillable', q.fulfillable,
               'outstanding', q.outstanding,
               /*
                * Was dieser Position zugeordnet erstattet wurde. Die
                * Versandzeile einer Erstattung (`allocation_type` <> 'line')
                * gehört keiner Position und erscheint deshalb nur oben in
                * `refunded_total`.
                */
               'refunded', coalesce((
                 select sum(al.amount)
                   from public.order_refund_allocations al
                   join public.order_refunds r on r.id = al.refund_id
                  where al.order_line_id = l.id
                    and al.allocation_type = 'line'
                    -- Dieselbe Regel wie oben (0111): nur bestätigtes Geld.
                    and r.provider_status = 'succeeded'
               ), 0))
               order by l.id)
        from public.order_lines l
        cross join lateral public.order_line_quantities(l.id) q
       where l.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.my_order(text) is
  'One order as its buyer may see it (0039, extended by 0102, corrected by 0111). refunded_total and remaining_total — and every line''s refunded share — count only refunds the payment provider CONFIRMED: a booking without a money movement is the seller''s intention, not a fact about the buyer''s account. Everything else is unchanged: the ordered quantity and the line total stay exactly as they were agreed, the line quantities come from the same helpers admin_order() uses, and the payment method snapshot appears where 0101 recorded one.';


-- ---------------------------------------------------------------------------
-- 11. Die Betreibersicht zeigt beides, benannt
--
-- Unverändert übernommen aus `0096`, mit zwei Änderungen: jede Erstattung
-- trägt ihren Provider-Zustand, und die Bestellung trägt beide Summen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_order(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_result jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select o.* into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',       v_order.order_number,
      'placed_at',          v_order.placed_at,
      'paid_at',            v_order.paid_at,
      'shipped_at',         v_order.shipped_at,
      'cancelled_at',       v_order.cancelled_at,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'needs_resolution',   v_order.needs_resolution,
      'customer_email',     v_order.customer_email,
      'items_subtotal',     v_order.items_subtotal,
      'shipping_amount',    v_order.shipping_amount,
      'discount_amount',    v_order.discount_amount,
      'total_amount',       v_order.total_amount,
      'shipping_method',    v_order.shipping_method_name,
      'shipping_method_code', v_order.shipping_method_code,
      'tracking_number',    v_order.tracking_number,
      'is_guest',           v_order.user_id is null,
      'commerce_mode',      v_order.commerce_mode,
      'stock_reverted',     exists (
                              select 1 from public.order_events se
                               where se.order_id = v_order.id
                                 and se.event_type = 'sandbox_stock_reverted')
    ),
    'address', (
      select jsonb_build_object(
               'first_name', a.first_name, 'last_name', a.last_name,
               'company', a.company, 'street', a.street,
               'house_number', a.house_number, 'address_line_2', a.address_line_2,
               'postal_code', a.postal_code, 'city', a.city,
               'country_code', a.country_code, 'phone', a.phone)
        from public.order_addresses a
       where a.order_id = v_order.id
       limit 1
    ),
    -- `image` and `series` come from the LINE, never from `skylanders`: the
    -- order says what was sold, not what it is called today. Since 0095 the
    -- line also carries its id — the two new RPCs address a position, not an
    -- article — and the quantities derived from `order_line_events`.
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'sky_id', l.sky_id, 'condition', l.condition,
               'name', l.name_snapshot, 'image', l.image_snapshot,
               'series', l.series_snapshot, 'quantity', l.quantity,
               'unit_price', l.unit_price, 'line_total', l.line_total,
               'cancelled', q.cancelled, 'returned', q.returned,
               'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
               'cancellable', q.cancellable, 'returnable', q.returnable,
               -- Die technische Tatsache, aus der der Server den Bestandsausgang
               -- bestimmt. Die Oberfläche zeigt sie nicht als Auswahl an.
               'was_booked_out', exists (
                 select 1 from public.order_reservations r
                  where r.order_id = l.order_id
                    and r.inventory_id = l.inventory_id
                    and r.movement_id is not null))
               order by l.id)
        from public.order_lines l
        cross join lateral public.order_line_quantities(l.id) q
       where l.order_id = v_order.id
    ), '[]'::jsonb),
    'line_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_line_id', ev.order_line_id, 'kind', ev.kind,
               'quantity', ev.quantity, 'stock_outcome', ev.stock_outcome,
               'occurred_at', ev.occurred_at, 'reason', ev.reason)
               order by ev.id)
        from public.order_line_events ev
       where ev.order_id = v_order.id
    ), '[]'::jsonb),
    'withdrawal', (
      select jsonb_build_object('id', w.id, 'received_at', w.received_at,
                                'handled_at', w.handled_at,
                                'consumer_name', w.consumer_name)
        from public.withdrawal_requests w
       where w.order_id = v_order.id
       order by w.received_at asc
       limit 1
    ),
    /*
     * JEDE Erstattung, mit ihrem Geldfluss-Zustand (0111).
     *
     * Die Betreibersicht ist die eine Stelle, die BEIDES sehen muss: was
     * gebucht ist und was tatsächlich zurückging. Deshalb filtert diese Liste
     * nicht — sie benennt. `provider_status` ist das Feld, an dem die
     * Oberfläche „gebucht", „beim Zahlungsdienst", „erstattet" und
     * „fehlgeschlagen" auseinanderhält.
     */
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'amount', r.amount, 'occurred_at', r.occurred_at,
               'reason', r.reason, 'provider_refund_id', r.provider_refund_id,
               'provider', r.provider,
               'provider_status', r.provider_status,
               'provider_confirmed_by', r.provider_confirmed_by,
               'provider_attempts', r.provider_attempts,
               'requested_at', r.requested_at,
               'settled_at', r.settled_at,
               'failure_code', r.failure_code,
               'allocations', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'type', al.allocation_type, 'order_line_id', al.order_line_id,
                          'quantity', al.quantity, 'amount', al.amount) order by al.id)
                   from public.order_refund_allocations al
                  where al.refund_id = r.id), '[]'::jsonb))
               order by r.id)
        from public.order_refunds r
       where r.order_id = v_order.id
    ), '[]'::jsonb),
    -- Zwei Summen, nicht eine (0111): was erstattet IST und was gebucht ist.
    'refunded_total', public.order_refunded_total(v_order.id),
    'refunds_booked_total', public.order_refunds_booked_total(v_order.id),
    'fulfillable_total', public.order_fulfillable_total(v_order.id),
    -- Was der Verkauf gekostet hat (0096). Zwei Summen aus `sale_fees`, dem
    -- Modell, das das Orderbuch seit 0059 benutzt — nichts Geschaetztes und
    -- nichts Erfundenes. Ohne einen erfassten Posten sind beide 0.
    'costs', (select jsonb_build_object('fees', c.fees, 'shipping_label', c.shipping_label)
                from public.order_sale_costs(v_order.id) c),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type, 'actor_kind', e.actor_kind,
               'created_at', e.created_at, 'payload', e.payload)
               order by e.id)
        from public.order_events e
       where e.order_id = v_order.id
    ), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', m.kind,
               'state', public.order_mail_effective_state(m.state, m.claimed_at),
               'sent_at', m.sent_at,
               'attempts', m.attempts,
               'last_error', m.last_error,
               'updated_at', m.updated_at)
               order by m.kind)
        from public.order_mail m
       where m.order_id = v_order.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order(text) is
  'One order for the seller''s screen (0095, extended by 0096, provider state 0111): header, address, lines with the quantities derived from order_line_events, the line events themselves, withdrawal, refunds WITH their provider state and allocations, both refund totals — confirmed and booked — the fulfillable total, the sale costs from sale_fees, the event log and the mail state. Read-only.';


-- ---------------------------------------------------------------------------
-- 12. Wer was darf
--
-- DIE REGEL: alles Neue ist intern. Kein Clientrole hält EXECUTE auf einer
-- Funktion, die einen Geldfluss bestätigt — `attach_order_refund`,
-- `fail_order_refund`, `record_refund_event` und `refresh_order_payment_status`
-- erreichen nur `service_role`, also die Edge Functions.
--
-- Der Operator ruft `submit_order_refund` und `resume_order_refund` NICHT
-- selbst: die Server Action reicht die Erstattungs-ID an `refund-payment`
-- weiter, und die Function spricht mit der Datenbank als `service_role`.
-- Damit gibt es keinen Weg, von einem Browser aus einen Anspruch zu nehmen,
-- ohne die Function zu durchlaufen — und die Function kann nur erstatten, was
-- ein berechtigter Operator über `seller_record_refund()` gebucht hat.
-- ---------------------------------------------------------------------------
revoke all on function public.order_refunded_total(bigint)            from public, anon, authenticated;
revoke all on function public.order_refunds_booked_total(bigint)      from public, anon, authenticated;
revoke all on function public.refresh_order_payment_status(bigint)    from public, anon, authenticated;
revoke all on function public.order_refund_submission(bigint)         from public, anon, authenticated;
revoke all on function public.submit_order_refund(bigint)             from public, anon, authenticated;
revoke all on function public.resume_order_refund(bigint)             from public, anon, authenticated;
revoke all on function public.attach_order_refund(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_order_refund(bigint, text)         from public, anon, authenticated;
revoke all on function public.order_refunds_guard_proof()             from public, anon, authenticated;
revoke all on function public.record_refund_event(text, text, text, text, text, bigint, text, bigint, text)
  from public, anon, authenticated;

/*
 * `my_order` und `admin_order` behalten die Rechte, die sie hatten. Beide
 * wurden mit `create or replace` ersetzt, und das erhält Eigentümer und ACL —
 * es gibt hier deshalb bewusst KEIN erneutes `grant`: ein wiederholtes Recht
 * ist eine Gelegenheit, versehentlich ein anderes zu vergeben.
 *
 * `seller_record_refund` ebenso: die Signatur ist byteweise die aus 0095, also
 * ist es dieselbe Funktion mit demselben EXECUTE für `authenticated`.
 */


-- ---------------------------------------------------------------------------
-- 13. Nachbedingungen — am Katalog geprüft, nicht gehofft
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_count   integer;
begin
  -- Alle neun Spalten da?
  select string_agg(c, ', ') into v_missing
    from unnest(array['provider', 'provider_status', 'provider_payment_ref',
                      'provider_confirmed_by', 'idempotency_key', 'provider_attempts',
                      'requested_at', 'settled_at', 'failure_code']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'order_refunds'
                        and column_name = c);
  if v_missing is not null then
    raise exception '0111 unvollständig: Spalten fehlen: %', v_missing;
  end if;

  -- Jede Zeile hat einen Schlüssel, und keiner ist ein Platzhalter.
  select count(*) into v_count from public.order_refunds
   where idempotency_key is null or idempotency_key like 'pending-%';
  if v_count > 0 then
    raise exception '0111 unvollständig: % Erstattungen ohne endgültigen Idempotenzschlüssel', v_count;
  end if;

  -- Kein `succeeded` ohne Beweis.
  select count(*) into v_count from public.order_refunds
   where provider_status = 'succeeded' and provider_refund_id is null;
  if v_count > 0 then
    raise exception '0111 verletzt: % bestätigte Erstattungen ohne Provider-Kennung', v_count;
  end if;

  -- Alle sechs neuen Funktionen da?
  select string_agg(f, ', ') into v_missing
    from unnest(array['order_refunded_total', 'order_refunds_booked_total',
                      'refresh_order_payment_status', 'order_refund_submission',
                      'submit_order_refund', 'resume_order_refund',
                      'attach_order_refund', 'fail_order_refund',
                      'record_refund_event', 'order_refunds_guard_proof',
                      'can_operate_seller_for']) f
   where not exists (select 1 from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = f);
  if v_missing is not null then
    raise exception '0111 unvollständig: Funktionen fehlen: %', v_missing;
  end if;

  -- Der Schutz der Beweisstücke hängt.
  if not exists (select 1 from pg_trigger
                  where tgname = 'order_refunds_guard_proof' and not tgisinternal) then
    raise exception '0111 unvollständig: Trigger order_refunds_guard_proof fehlt';
  end if;

  -- Und die Statusspiegelung ist für jede betroffene Bestellung konsistent.
  select count(*) into v_count
    from public.orders o
   where o.payment_status in ('paid', 'partially_refunded', 'refunded')
     and o.payment_status <> case
           when public.order_refunded_total(o.id) <= 0 then 'paid'
           when public.order_refunded_total(o.id) >= o.total_amount then 'refunded'
           else 'partially_refunded' end;
  if v_count > 0 then
    raise notice '0111: % Bestellungen tragen noch den alten Status — Abschnitt 14 spiegelt sie', v_count;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 14. Die bestehenden Bestellungen einmal ehrlich spiegeln
--
-- EINMALIG, und ausdrücklich ohne Sonderregel für alte Erstattungen. Jede
-- Bestellung, deren Status auf Buchungen beruhte, wird auf das gespiegelt, was
-- der Zahlungsdienst bestätigt hat.
--
-- Für Production heißt das genau eine Zeile: SI-2026-001009 geht von
-- `partially_refunded` zurück auf `paid`, weil die 0,76 € nie erstattet
-- wurden. Das ist der Zweck dieser Migration und kein Nebeneffekt. Nach dem
-- echten Stripe-Refund spiegelt `attach_order_refund()` sie von selbst zurück.
--
-- `cancelled`, `failed`, `expired` und `pending` bleiben unberührt.
-- ---------------------------------------------------------------------------
do $$
declare v_order record; v_before text; v_after text; v_changed integer := 0;
begin
  for v_order in
    select id, order_number, payment_status from public.orders
     where payment_status in ('paid', 'partially_refunded', 'refunded')
     order by id
  loop
    v_before := v_order.payment_status;
    v_after  := public.refresh_order_payment_status(v_order.id);
    if v_after <> v_before then
      v_changed := v_changed + 1;
      raise notice '0111 spiegelt %: % -> %', v_order.order_number, v_before, v_after;
    end if;
  end loop;
  raise notice '0111 fertig: % Bestellungen gespiegelt', v_changed;
end;
$$;
