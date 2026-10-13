-- ===========================================================================
-- 0115 — DER EINKAUF BEKOMMT SEINE KOSTENAUFTEILUNG, SEINE PLATTFORM,
--        SEINEN TAGESPLATZ UND DIE VITRINE
--
-- ADDITIV. Sieben Spalten, ein Zustandswort, zwei Indizes, ein Trigger, ein
-- deterministischer Backfill. Keine Spalte umgedeutet, keine Zeile
-- umgeschrieben, keine Funktionssignatur geändert — die Lesefunktionen und
-- die Faktorrechnung folgen in `0116`.
--
-- ---------------------------------------------------------------------------
-- WARUM `total_cost` BLEIBT, WAS ES IST (Entscheidung D2)
--
-- `0053` nennt die Spalte „What was actually paid, in total. The one observed
-- cost fact." Daran hängt alles: `orderbook_global_factor()`,
-- `seller_orderbook_ledger()`, der Arbeitsmappen-Import, der Backup-Export.
--
-- Die naheliegende Lesart der neuen Felder wäre, `total_cost` künftig als
-- „nur die Figuren" zu verstehen und Versand daneben zu stellen. Das hätte
-- EINE Spalte mit ZWEI Bedeutungen ergeben — alte Zeilen „gesamt", neue „nur
-- Artikel" —, und genau diese Klasse Fehler hat dieses Projekt bei
-- `order_refunds.provider_refund_id` teuer gelernt: ein Zustand für zwei
-- Tatsachen.
--
-- Also bleibt `total_cost` die Autorität, und die Aufteilung kommt DANEBEN:
--
--   items_cost + shipping_cost + buyer_protection_cost = total_cost
--
-- als CHECK, aber nur WENN die Aufteilung gesetzt ist. Für die bestehenden
-- Einkäufe ist sie unbekannt, und unbekannt heisst NULL — nicht 0, und erst
-- recht nicht geraten. Ein Formular, das die Teile erfasst, rechnet die Summe
-- daraus; eine Richtung, keine zweite Wahrheit.
--
-- ---------------------------------------------------------------------------
-- WARUM ES KEINE SPALTE `purchase_day` GIBT
--
-- Beim Verkauf brauchte `0113` eine: `effective_date` war ein `case` über zwei
-- Tabellen (`sales.sold_at` oder `orders.paid_at`), und auf einen Ausdruck
-- kann man nicht eindeutig indexieren.
--
-- Ein Einkauf hat diese Zweideutigkeit nicht. `purchases.purchased_at` IST
-- der Tag, als `date`, seit `0053` — und seit `0058` nullbar für die dreizehn
-- `#REF!`-Gruppen der Arbeitsmappe. Eine zweite Spalte daneben wäre eine
-- Kopie, die auseinanderlaufen kann, und ein `purchase_day_of()` wäre eine
-- Ableitung, die nichts ableitet. Der Teilindex steht deshalb direkt auf
-- `(purchased_at, daily_index)`.
--
-- ---------------------------------------------------------------------------
-- WARUM DIE VITRINE EIN ZUSTAND IST UND KEINE LAGERZEILE (Entscheidung D1)
--
-- Eine Vitrinenfigur ist physisch da und gehört dem Inhaber — nicht dem Shop.
-- Zwei Wege waren denkbar: einbuchen und nicht listen, oder gar nicht
-- einbuchen.
--
-- Es ist der zweite. `showcase` trägt kein `movement_id`, und
-- `purchase_items_booked_has_movement` erzwingt, dass nur `booked` eines hat.
-- Damit kann eine Vitrinenfigur NICHT durch das Umlegen eines Listing-Flags
-- verkaufbar werden — es gibt keine Lagerzeile, an der das Flag hinge. Die
-- Zusicherung „keine Sonderaktion erzeugt verkaufbaren Bestand" ist damit
-- strukturell erfüllt und nicht bloss zugesagt.
--
-- Die spätere Überführung ist `seller_book_purchase_item()` selbst: aus
-- `showcase` darf eingebucht werden, aus `damaged` nicht (0116).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'total_cost') then
    raise exception '0115 setzt 0053 voraus: purchases.total_cost fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'is_test') then
    raise exception '0115 setzt 0063 voraus: purchases.is_test fehlt';
  end if;
  /* 0058 hat `purchased_at` nullbar gemacht. Wäre es das nicht, bräuchte der
     Teilindex unten keine NULL-Behandlung — und die dreizehn undatierten
     Arbeitsmappengruppen gäbe es nicht. */
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'purchases'
         and column_name = 'purchased_at') <> 'YES' then
    raise exception '0115 setzt 0058 voraus: purchases.purchased_at ist nicht nullbar';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die Kostenaufteilung, die Plattform und der Verkäufer
-- ---------------------------------------------------------------------------
alter table public.purchases
  add column if not exists items_cost            numeric(10,2),
  add column if not exists shipping_cost         numeric(10,2),
  add column if not exists buyer_protection_cost numeric(10,2),
  add column if not exists platform              text,
  add column if not exists seller_name           text,
  add column if not exists payment_method        text,
  add column if not exists daily_index           integer;

comment on column public.purchases.items_cost is
  'What the FIGURES cost, without shipping and without buyer protection (0115). NULL for every purchase created before 0115: the split was never recorded and is not guessed. `total_cost` stays the authority on what was actually paid.';
comment on column public.purchases.shipping_cost is
  'Shipping paid to the seller or the platform (0115). NULL means unknown, 0 means there was none.';
comment on column public.purchases.buyer_protection_cost is
  'The platform''s buyer-protection fee (0115) — Kleinanzeigen and Willhaben both charge one. NULL means unknown, 0 means there was none.';
comment on column public.purchases.platform is
  'WHERE the parcel was bought (0115): kleinanzeigen, willhaben, or manual for anything else. NOT the seller — that is `seller_name`, and confusing the two would turn a marketplace into a person.';
comment on column public.purchases.seller_name is
  'WHO sold it, as the operator wrote it (0115). Free text, stored raw (rule 4): a marketplace nickname is not a typo. Never used to match or group anything — it is there so a row is recognisable.';
comment on column public.purchases.payment_method is
  'How it was paid (0115). `card` is the default a new purchase gets from the form, never from this column — a default here would rewrite the meaning of every existing row, which carries no answer at all.';
comment on column public.purchases.daily_index is
  'This purchase''s place within its day, 1…n (0115) — the same idea `sales.daily_index` has since 0113, and for the same reason: of two purchases on one day the ledger otherwise shows the one with the higher id on top, which is the order they were typed in and not an order anybody chose. NULL exactly when `purchased_at` is NULL. Assigned by trigger, exchanged only by `seller_swap_purchase_daily_index()`.';


-- ---------------------------------------------------------------------------
-- 2. Was die neuen Felder dürfen
-- ---------------------------------------------------------------------------

/*
 * DIE AUFTEILUNG MUSS AUFGEHEN — WENN ES EINE GIBT.
 *
 * `items_cost is null` heisst „nicht erfasst", und dann sagt dieser CHECK
 * nichts. Ist sie erfasst, muss sie `total_cost` ergeben: sonst stünde eine
 * Aufteilung da, die ihre eigene Summe nicht trifft, und niemand wüsste,
 * welche der beiden Zahlen gilt.
 *
 * `coalesce` auf Versand und Käuferschutz, weil eine erfasste Aufteilung ohne
 * Versandzeile „kein Versand" heisst und nicht „unbekannt".
 */
alter table public.purchases drop constraint if exists purchases_cost_split_adds_up;
alter table public.purchases
  add constraint purchases_cost_split_adds_up
  check (items_cost is null
         or round(items_cost + coalesce(shipping_cost, 0)
                  + coalesce(buyer_protection_cost, 0), 2) = round(total_cost, 2));

-- Kein Kostenbestandteil ist negativ, und keiner ist absurd gross.
alter table public.purchases drop constraint if exists purchases_cost_parts_sane;
alter table public.purchases
  add constraint purchases_cost_parts_sane
  check ((items_cost            is null or (items_cost            >= 0 and items_cost            <= 1000000))
     and (shipping_cost         is null or (shipping_cost         >= 0 and shipping_cost         <= 1000000))
     and (buyer_protection_cost is null or (buyer_protection_cost >= 0 and buyer_protection_cost <= 1000000)));

/*
 * EINE AUFTEILUNG OHNE ARTIKELPREIS IST KEINE AUFTEILUNG.
 *
 * Versand ohne `items_cost` wäre ein Bruchteil ohne Ganzes: die Summe liesse
 * sich nicht prüfen, und `total_cost` stünde ohne Bezug daneben.
 */
alter table public.purchases drop constraint if exists purchases_cost_split_is_whole;
alter table public.purchases
  add constraint purchases_cost_split_is_whole
  check (items_cost is not null
         or (shipping_cost is null and buyer_protection_cost is null));

alter table public.purchases drop constraint if exists purchases_platform_known;
alter table public.purchases
  add constraint purchases_platform_known
  check (platform is null or platform in ('kleinanzeigen', 'willhaben', 'manual'));

/*
 * DIE FÜNF ZAHLUNGSWEGE (Entscheidung D8).
 *
 * `platform` als Zahlungsweg ist der plattforminterne Bezahlvorgang —
 * Kleinanzeigen und Willhaben haben beide einen. Er ist NICHT dasselbe wie
 * `purchases.platform`: dort steht, wo gekauft wurde, hier, wie bezahlt.
 */
alter table public.purchases drop constraint if exists purchases_payment_method_known;
alter table public.purchases
  add constraint purchases_payment_method_known
  check (payment_method is null
         or payment_method in ('card', 'paypal', 'transfer', 'cash', 'platform'));

alter table public.purchases drop constraint if exists purchases_seller_name_shape;
alter table public.purchases
  add constraint purchases_seller_name_shape
  check (seller_name is null or length(btrim(seller_name)) between 1 and 120);

-- ---------------------------------------------------------------------------
-- 3. Der Platz ist eindeutig
--
-- Teilindex, weil ein Einkauf ohne Tag keinen Platz hat. KEIN CHECK
-- `daily_index > 0`: der Sentinel-Tausch in `0116` parkt einen Platz auf
-- einem negativen Wert, und ein Positivitäts-CHECK würde genau diese
-- Transaktion verbieten. Dieselbe Entscheidung wie in `0113`.
-- ---------------------------------------------------------------------------
create unique index if not exists purchases_daily_index_uniq
  on public.purchases (purchased_at, daily_index)
  where purchased_at is not null and daily_index is not null;

create index if not exists purchases_day_order_idx
  on public.purchases (purchased_at desc nulls last, daily_index desc nulls last, id desc);


-- ---------------------------------------------------------------------------
-- 4. Der Backfill — VOR dem Trigger, und deterministisch
--
-- Liefe der Trigger schon, bekäme jede Zeile ihren Platz in der Reihenfolge,
-- in der PostgreSQL sie zufällig aktualisiert; zwei Umgebungen hätten für
-- dieselben Daten verschiedene Tagesreihenfolgen. Tie-Breaker ist `id` und
-- nicht `created_at`: zwei importierte Gruppen derselben Arbeitsmappe tragen
-- denselben Zeitstempel.
--
-- `updated_at` bleibt stehen. Ein Backfill ist keine Korrektur des Betreibers.
-- ---------------------------------------------------------------------------
with gap as (
  select p.id, p.purchased_at,
         row_number() over (partition by p.purchased_at order by p.id) as place
    from public.purchases p
   where p.purchased_at is not null and p.daily_index is null
),
taken as (
  select p.purchased_at, coalesce(max(p.daily_index), 0) as top
    from public.purchases p
   where p.purchased_at is not null and p.daily_index is not null
   group by p.purchased_at
)
update public.purchases p
   set daily_index = g.place + coalesce(t.top, 0)
  from gap g left join taken t on t.purchased_at = g.purchased_at
 where p.id = g.id;

-- Und ein Einkauf ohne Tag trägt keinen Platz.
update public.purchases set daily_index = null
 where purchased_at is null and daily_index is not null;


/*
 * KEIN TAG, KEIN PLATZ — und umgekehrt.
 *
 * Dieselbe Äquivalenz wie bei `sales`, aber hier als CHECK und nicht nur im
 * Trigger: `purchased_at` ist die einzige Quelle, kein `case` liegt dazwischen.
 *
 * UND DESHALB STEHT ER HIER UND NICHT OBEN BEI DEN ANDEREN. Ein `add
 * constraint` prüft die BESTEHENDEN Zeilen sofort — und vor dem Backfill
 * tragen alle datierten Einkäufe noch `daily_index IS NULL`. Oben hätte
 * dieser CHECK die ganze Migration auf der ersten vorhandenen Zeile
 * abgebrochen. Nach dem Backfill ist er erfüllt und bleibt es: der Trigger
 * unten hält beide Spalten im Gleichschritt.
 */
alter table public.purchases drop constraint if exists purchases_day_and_index_agree;
alter table public.purchases
  add constraint purchases_day_and_index_agree
  check ((purchased_at is null) = (daily_index is null));


-- ---------------------------------------------------------------------------
-- 5. Der Platz hält sich selbst in Ordnung
--
-- Ein BEFORE-Trigger und keine Anwendungslogik: `seller_create_purchase`,
-- `seller_create_purchase_with_items`, `seller_import_purchase_group` und
-- jede künftige Stelle schreiben in dieselbe Tabelle. Eine Vergabe in einer
-- von ihnen wäre eine Vergabe, die die anderen vergessen — und keine ihrer
-- Signaturen muss sich dafür ändern.
-- ---------------------------------------------------------------------------
create or replace function public.purchases_set_daily_index()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_next integer;
begin
  -- Kein Tag, kein Platz. Der CHECK aus Abschnitt 2 verlangt genau das.
  if new.purchased_at is null then
    new.daily_index := null;
    return new;
  end if;

  /*
   * EIN BESTEHENDER PLATZ AM UNVERÄNDERTEN TAG BLEIBT STEHEN.
   *
   * Das ist die Tür, durch die `seller_swap_purchase_daily_index()` geht: sie
   * setzt `daily_index` ausdrücklich, ohne den Tag anzufassen, und dieser
   * Zweig lässt den Wert durch. Er ist auch der Grund, warum jedes andere
   * UPDATE auf `purchases` — Notiz, Kosten, Plattform, Testflag — die
   * Tagesreihenfolge NICHT durcheinanderbringt.
   */
  if tg_op = 'UPDATE'
     and old.purchased_at is not distinct from new.purchased_at
     and new.daily_index is not null then
    return new;
  end if;

  /*
   * SONST: HINTEN ANSTELLEN.
   *
   * `max + 1` unter einer Vorratssperre je Tag — zwei gleichzeitige Einkäufe
   * am selben Tag würden sonst beide dieselbe Zahl lesen und einer am
   * Unique-Index scheitern. Die Sperre gilt nur bis zum Ende der Transaktion,
   * und zwei verschiedene Tage behindern sich nicht.
   *
   * `daily_index > 0` lässt den geparkten Negativwert eines gerade laufenden
   * Tauschs aus. Er ist kein belegter Platz.
   */
  perform pg_advisory_xact_lock(
    hashtext('purchases_daily_index:' || new.purchased_at::text)::bigint);
  select coalesce(max(p.daily_index), 0) + 1 into v_next
    from public.purchases p
   where p.purchased_at = new.purchased_at and p.daily_index > 0;
  new.daily_index := v_next;
  return new;
end;
$$;

comment on function public.purchases_set_daily_index() is
  'Keeps `purchases.daily_index` true on every write (0115). Assigned as max+1 within the day under a per-day advisory lock, EXCEPT when an update leaves the day alone and names a place itself — that door is what `seller_swap_purchase_daily_index()` goes through, and it is why an ordinary edit does not reshuffle the day. A purchase with no date gets no place, which `purchases_day_and_index_agree` also enforces.';

drop trigger if exists purchases_set_daily_index_trg on public.purchases;
create trigger purchases_set_daily_index_trg
  before insert or update on public.purchases
  for each row execute function public.purchases_set_daily_index();


-- ---------------------------------------------------------------------------
-- 6. Die Vitrine, als Wort
--
-- Nur das Vokabular. Setzen kann sie erst `0116` — `seller_set_purchase_item_state`
-- aus `0069` lässt bis dahin ausschliesslich ordered/arrived/damaged/missing/settled
-- zu, und das ist ein zulässiger Zwischenzustand: das Wort existiert, niemand
-- kann es schreiben.
-- ---------------------------------------------------------------------------
alter table public.purchase_items drop constraint if exists purchase_items_state_known;
alter table public.purchase_items
  add constraint purchase_items_state_known
  check (state in ('ordered', 'arrived', 'damaged', 'missing', 'booked',
                   'reconciled_legacy', 'settled', 'showcase'));

comment on column public.purchase_items.state is
  'Where this physical unit stands. `ordered` / `arrived` are outstanding; `booked` owns an inventory movement and is the only state that does; `showcase` (0115) is physically present but the owner''s, NOT the shop''s — it owns no movement, so no listing flag can make it sellable, and `seller_book_purchase_item` is the one way out of it; `damaged` and `missing` are endings for a figure that never made it into stock and count 0 EUR towards the buy-in factor (0116); `settled` (0069) is the ending for something that is not a catalog figure at all; `reconciled_legacy` is a workbook line whose stock was reconciled separately and is frozen.';


-- ---------------------------------------------------------------------------
-- 7. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_missing text; v_count integer;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['items_cost', 'shipping_cost', 'buyer_protection_cost',
                      'platform', 'seller_name', 'payment_method', 'daily_index']) as c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'purchases'
                        and column_name = c);
  if v_missing is not null then
    raise exception '0115 unvollständig: purchases fehlen Spalten: %', v_missing;
  end if;

  select string_agg(c, ', ') into v_missing
    from unnest(array['purchases_cost_split_adds_up', 'purchases_cost_parts_sane',
                      'purchases_cost_split_is_whole', 'purchases_platform_known',
                      'purchases_payment_method_known', 'purchases_seller_name_shape',
                      'purchases_day_and_index_agree']) as c
   where not exists (select 1 from pg_constraint where conname = c);
  if v_missing is not null then
    raise exception '0115 unvollständig: Constraints fehlen: %', v_missing;
  end if;

  -- Der Teilindex, und dass er ein TEILindex ist.
  select count(*) into v_count
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'purchases_daily_index_uniq'
     and i.indisunique and i.indpred is not null;
  if v_count <> 1 then
    raise exception '0115 unvollständig: purchases_daily_index_uniq ist kein eindeutiger Teilindex';
  end if;
  if not exists (select 1 from pg_class where relname = 'purchases_day_order_idx') then
    raise exception '0115 unvollständig: purchases_day_order_idx fehlt';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'purchases_set_daily_index_trg' and not tgisinternal) then
    raise exception '0115 unvollständig: purchases_set_daily_index_trg fehlt';
  end if;

  -- Das Wort ist da.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'purchase_items_state_known') not like '%showcase%' then
    raise exception '0115 unvollständig: showcase fehlt im Zustands-CHECK';
  end if;

  /*
   * UND DIE DATEN SIND KONSISTENT.
   *
   * Jeder datierte Einkauf hat einen Platz, jeder undatierte keinen, kein Tag
   * trägt einen doppelt, und nach dem Backfill trägt jeder Tag lückenlos
   * 1..n. Später darf ein Datumswechsel eine Lücke hinterlassen — hier und
   * jetzt wäre sie ein Befund.
   */
  select count(*) into v_count from public.purchases
   where (purchased_at is null) <> (daily_index is null);
  if v_count > 0 then
    raise exception '0115 Befund: % Einkäufe mit Tag ohne Platz oder umgekehrt', v_count;
  end if;
  select count(*) into v_count from public.purchases where daily_index <= 0;
  if v_count > 0 then
    raise exception '0115 Befund: % Einkäufe mit einem Platz <= 0', v_count;
  end if;
  select count(*) into v_count from (
    select p.purchased_at
      from public.purchases p
     where p.purchased_at is not null
     group by p.purchased_at
    having min(p.daily_index) <> 1 or max(p.daily_index) <> count(*)) x;
  if v_count > 0 then
    raise exception '0115 Befund: % Tage ohne lückenlose Plätze 1..n', v_count;
  end if;

  /*
   * UND KEIN BESTEHENDER EINKAUF HAT EINE KOSTENAUFTEILUNG BEKOMMEN.
   *
   * Die sieben Spalten sind nullbar und ohne Standardwert; diese Migration
   * schreibt in keine von ihnen ausser `daily_index`. Geprüft, weil „additiv"
   * eine Behauptung ist, solange sie nicht nachgesehen wurde.
   */
  select count(*) into v_count from public.purchases
   where items_cost is not null or shipping_cost is not null
      or buyer_protection_cost is not null or platform is not null
      or seller_name is not null or payment_method is not null;
  if v_count > 0 then
    raise exception '0115 Befund: % Einkäufe tragen plötzlich neue Kostenfelder', v_count;
  end if;
end;
$$;
