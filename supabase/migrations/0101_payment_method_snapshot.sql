-- ===========================================================================
-- 0101 — WOMIT BEZAHLT WURDE, ALS SCHNAPPSCHUSS
--
-- WAS HEUTE GESPEICHERT IST, UND WAS FEHLT
--
-- `payment_attempts` hält die Checkout-Session (`cs_live_…`), den Betrag, die
-- Währung und die Zeitpunkte. Mehr nicht. Keine Kartenmarke, keine letzten
-- vier Ziffern, kein Wallet — und nicht einmal die PaymentIntent-ID.
--
-- WARUM DAS EVENT ALLEIN NICHT REICHT
--
-- `checkout.session.completed` trägt `payment_method_types` (bei Karte nur
-- `["card"]`, für eine Anzeige zu wenig) und die `payment_intent`-ID. Marke,
-- last4 und Wallet hängen eine Ebene tiefer: PaymentIntent → latest_charge →
-- `payment_method_details.card`. Die Session kennt sie nicht.
--
-- ZWEI WEGE, EINER DAVON OHNE SCHLÜSSEL
--
-- Man könnte die Session mit `expand` nachladen — dann bräuchte die
-- Webhook-Function einen Stripe-Secret-Key, den sie heute ausdrücklich NICHT
-- hat (`new Stripe("sk_unused_webhook_only")`): der eine Endpunkt, den das
-- offene Internet erreicht, soll nichts belasten und nichts erstatten können.
-- Dieser Vorzug bleibt.
--
-- Also der andere Weg: `charge.succeeded` mitabonnieren. Dessen Payload trägt
-- `payment_method_details.type`, `…card.brand`, `…card.last4` und
-- `…card.wallet.type` — **ohne jeden API-Aufruf**, mit derselben
-- Signaturprüfung und derselben Welt-Entscheidung wie jedes andere Ereignis.
--
-- EINMAL SCHREIBEN, DANN NIE WIEDER
--
-- Die Angaben sind ein Schnappschuss wie die Rechnung: sie beschreiben, womit
-- damals bezahlt wurde. Ein zweiter Zustellversuch darf sie nicht überschreiben
-- und eine späte Erstattung nicht verändern. `record_payment_method()` schreibt
-- deshalb nur in eine noch leere Zeile.
--
-- REIHENFOLGE IST NICHT ZUGESICHERT. Stripe stellt `charge.succeeded` auch vor
-- `checkout.session.completed` zu. Kommt die Ladung zuerst, kennt noch kein
-- Versuch die Intent-ID; die Funktion antwortet `unknown_intent`, die Function
-- gibt 500 zurück und Stripe wiederholt — dasselbe Muster, mit dem
-- `unknown_payment` seit 0012 umgeht. Nichts geht verloren.
--
-- KEINE RÜCKWIRKUNG. Für Bestellungen, die vor dieser Migration bezahlt
-- wurden, bleiben die Felder NULL, und die Anzeige sagt dann nichts. Eine
-- Kartenmarke aus einer unsicheren Quelle zu erraten wäre schlimmer als eine
-- Lücke.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Felder
-- ---------------------------------------------------------------------------
alter table public.payment_attempts
  add column if not exists provider_intent_id  text,
  add column if not exists payment_method_type text,
  add column if not exists card_brand          text,
  add column if not exists card_last4          text,
  add column if not exists wallet_type         text,
  add column if not exists method_recorded_at  timestamptz;

comment on column public.payment_attempts.provider_intent_id is
  'The PaymentIntent behind the session (0101). Read from the completed session, which names it; the charge event is matched against it.';
comment on column public.payment_attempts.payment_method_type is
  'What Stripe calls the method: card, paypal, klarna, … (0101). Snapshot, never recomputed.';
comment on column public.payment_attempts.card_brand is
  'visa, mastercard, amex … — only where the method is a card (0101).';
comment on column public.payment_attempts.card_last4 is
  'The last four digits, and nothing more of the number. Four digits are not a payment credential; a PAN would never be stored here (docs/SECURITY.md).';
comment on column public.payment_attempts.wallet_type is
  'apple_pay, google_pay, link … where the card came through a wallet (0101). NULL is the ordinary case.';
comment on column public.payment_attempts.method_recorded_at is
  'When the snapshot was taken. Also the guard: a second delivery finds it set and changes nothing.';

alter table public.payment_attempts
  drop constraint if exists payment_attempts_last4_shape;
alter table public.payment_attempts
  add constraint payment_attempts_last4_shape
    check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

alter table public.payment_attempts
  drop constraint if exists payment_attempts_method_sane;
alter table public.payment_attempts
  add constraint payment_attempts_method_sane
    check (
      (payment_method_type is null or btrim(payment_method_type) <> '')
      and (card_brand is null or btrim(card_brand) <> '')
      and (wallet_type is null or btrim(wallet_type) <> '')
      -- Eine Marke ohne Karte wäre Unsinn: sie hängt am Typ.
      and (card_brand is null or payment_method_type = 'card')
      and (card_last4 is null or payment_method_type = 'card')
    );

create index if not exists payment_attempts_intent_idx
  on public.payment_attempts (provider_intent_id)
  where provider_intent_id is not null;


-- ---------------------------------------------------------------------------
-- 2. Die Intent-ID aus der bestätigten Session festhalten
--
-- Getrennt von `confirm_order_payment()`, absichtlich: dessen Vertrag ist die
-- Zahlung, und diese Zeile ist Beiwerk. Sie darf keinen Zahlungspfad brechen,
-- also läuft sie nebenher und ist idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.attach_payment_intent(
  p_provider_payment_id text,
  p_provider_intent_id  text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intent text := nullif(btrim(coalesce(p_provider_intent_id, '')), '');
begin
  if v_intent is null then
    return 'no_intent';
  end if;

  update public.payment_attempts
     set provider_intent_id = v_intent
   where provider_payment_id = p_provider_payment_id
     and provider_intent_id is null;

  if found then
    return 'attached';
  end if;

  if exists (select 1 from public.payment_attempts
              where provider_payment_id = p_provider_payment_id
                and provider_intent_id = v_intent) then
    return 'already_attached';
  end if;

  return 'unknown_session';
end;
$$;

comment on function public.attach_payment_intent(text, text) is
  'Records which PaymentIntent a checkout session became (0101). Idempotent; never overwrites a different intent. Internal: no client role holds EXECUTE.';

revoke all on function public.attach_payment_intent(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Den Schnappschuss schreiben
--
-- Fail-soft nach oben: fehlt eine Angabe, wird sie NULL, und die Anzeige
-- schweigt darüber. Fail-closed nach innen: ist der Intent unbekannt, wird
-- nichts geschrieben und der Aufrufer erfährt es, damit Stripe wiederholen
-- kann.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_method(
  p_provider_intent_id text,
  p_method_type        text,
  p_card_brand         text default null,
  p_card_last4         text default null,
  p_wallet_type        text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intent text := nullif(btrim(coalesce(p_provider_intent_id, '')), '');
  v_type   text := nullif(btrim(coalesce(p_method_type, '')), '');
  v_brand  text := nullif(btrim(coalesce(p_card_brand, '')), '');
  v_last4  text := nullif(btrim(coalesce(p_card_last4, '')), '');
  v_wallet text := nullif(btrim(coalesce(p_wallet_type, '')), '');
begin
  if v_intent is null or v_type is null then
    return 'incomplete';
  end if;

  -- Was nicht zur Karte gehört, wird nicht als Karte gespeichert. Der CHECK
  -- oben würde es ablehnen; hier wird es still verworfen, weil eine
  -- Nebensächlichkeit keine Zustellung scheitern lassen darf.
  if v_type <> 'card' then
    v_brand := null;
    v_last4 := null;
  end if;
  if v_last4 is not null and v_last4 !~ '^[0-9]{4}$' then
    v_last4 := null;
  end if;

  update public.payment_attempts
     set payment_method_type = v_type,
         card_brand         = v_brand,
         card_last4         = v_last4,
         wallet_type        = v_wallet,
         method_recorded_at = now()
   where provider_intent_id = v_intent
     -- Einmal, dann nie wieder: ein zweiter Zustellversuch ändert nichts.
     and method_recorded_at is null;

  if found then
    return 'recorded';
  end if;

  if exists (select 1 from public.payment_attempts
              where provider_intent_id = v_intent
                and method_recorded_at is not null) then
    return 'already_recorded';
  end if;

  -- Der Intent ist uns unbekannt. Das ist der Normalfall, wenn die Ladung vor
  -- der Session zugestellt wird — der Aufrufer antwortet Stripe mit 500 und
  -- die Wiederholung findet ihn.
  return 'unknown_intent';
end;
$$;

comment on function public.record_payment_method(text, text, text, text, text) is
  'Takes the snapshot of how one payment was made (0101), from the charge event and without any Stripe API call. Write-once: `method_recorded_at` is the guard, so a redelivery answers already_recorded. `unknown_intent` means the charge arrived before the session — the caller lets Stripe retry. Internal: no client role holds EXECUTE.';

revoke all on function public.record_payment_method(text, text, text, text, text) from public, anon, authenticated;
