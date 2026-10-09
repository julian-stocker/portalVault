-- ===========================================================================
-- 0113 — DIE TAGESREIHENFOLGE EINES VERKAUFS, UND WER SCHON EINMAL GEKAUFT HAT
--
-- Zwei Dinge, eine Migration, weil das zweite das erste BRAUCHT: ob ein
-- Käufer wiederkommt, entscheidet sich an der Reihenfolge der Verkäufe — und
-- bei mehreren Verkäufen am selben Tag ist das Datum allein keine Reihenfolge.
--
-- ---------------------------------------------------------------------------
-- TEIL D — `sale_day` UND `daily_index`
--
-- Das Verkaufsbuch sortierte bisher `effective_date desc nulls last, id desc`.
-- Für zwei Verkäufe am selben Tag heißt das: der mit der höheren `id` steht
-- oben — also der, der zufällig später angelegt wurde. Das ist keine
-- Reihenfolge, die der Betrieb bestimmt, sondern eine, die aus der
-- Eingabereihenfolge fällt. Ein Verkauf, der nachgetragen wird, landet oben,
-- obwohl er der erste des Tages war.
--
--   `sale_day`     der Geschäftstag, materialisiert. Für einen externen
--                  Verkauf `sold_at`, für einen internen `orders.paid_at`
--                  als Datum — genau die Ableitung, die `seller_sales()`
--                  seit `0059` im Kopf hatte, jetzt als Spalte und als EINE
--                  Funktion (`sale_day_of`), die Trigger und Nachbedingung
--                  teilen.
--   `daily_index`  der Platz INNERHALB des Tages, 1 … n. Höchster oben
--                  (Entscheidung D-1), also ist `n` der jüngste Verkauf des
--                  Tages. `UNIQUE (sale_day, daily_index)` — zwei Verkäufe
--                  können nicht denselben Platz haben.
--
-- NULL HEISST: DIESER VERKAUF HAT KEINEN TAG. Fünf historische Gruppen
-- tragen einen Tippfehler, wo ihr Datum stehen sollte (`0058`), und eine
-- interne Bestellung vor der Zahlung hat noch keinen. Sie bekommen keinen
-- Platz in einem Tag, den sie nicht haben: `daily_index` bleibt NULL, und
-- der Teilindex lässt sie aus.
--
-- WARUM EIN SENTINEL-TAUSCH UND KEIN EINZELNES UPDATE. PostgreSQL prüft eine
-- Unique-Bedingung je Zeile, nicht je Anweisung: ein `update … set
-- daily_index = case when id = a then b else a end` scheitert auf halbem Weg.
-- `seller_swap_sale_daily_index()` parkt deshalb den einen Platz auf einem
-- negativen Wert — der mit keinem echten Platz kollidieren kann — und setzt
-- dann beide. Drei Anweisungen, eine Transaktion.
--
-- Deshalb gibt es auch KEINEN CHECK `daily_index > 0`: er würde genau diesen
-- Tausch verbieten. Der negative Wert existiert ausschließlich innerhalb
-- dieser einen Transaktion.
--
-- ---------------------------------------------------------------------------
-- TEIL B — WIEDERHOLUNGSKÄUFER
--
-- Grün heißt: DIESER KÄUFER HAT HIER SCHON EINMAL GEKAUFT. Die Frage ist,
-- woran man „derselbe Käufer" erkennt, und die Antwort ist bewusst eng:
--
--   intern   `'skyisles:' || orders.user_id`. Die SkyIsles-Konto-ID, sonst
--            nichts. Kein Name, keine E-Mail-Adresse. Ein Gastkauf hat keine
--            `user_id` und ist deshalb NIE ein Wiederholungskauf und macht
--            auch keinen anderen zu einem. Das ist keine Lücke, sondern die
--            Aussage: wir wissen es nicht.
--   extern   `channel || ':' || lower(btrim(buyer_ref))`. Die Quelle UND der
--            Benutzername. `ebay:sammler42` und `manual:sammler42` sind
--            zwei verschiedene Käufer, bis jemand das Gegenteil weiß —
--            Quellen werden nicht automatisch verknüpft (Entscheidung B-3),
--            und ein gleicher Name auf zwei Marktplätzen ist kein Beweis.
--
-- WAS NICHT MITZÄHLT. Eine stornierte Bestellung ist kein vorheriger Kauf
-- (B-2) — es ist nichts gekauft worden. Ein Testverkauf ist kein Kauf (B-3).
-- Beide fallen vollständig aus dem Fenster: sie markieren niemanden und
-- werden selbst nicht markiert.
--
-- WORAN SICH DIE REIHENFOLGE ENTSCHEIDET: `(sale_day, daily_index, id)`,
-- aufsteigend — also genau die Reihenfolge, die der Bildschirm zeigt, nur
-- umgekehrt gelesen. Ein undatierter Verkauf steht aufsteigend ZUERST, weil
-- er im absteigend sortierten Verkaufsbuch unten steht: dieselbe Liste, zwei
-- Richtungen, keine zweite Meinung.
--
-- UND DAS FENSTER LÄUFT ÜBER ALLE VERKÄUFE, NICHT ÜBER DIE SEITE. Ein
-- Käufer, dessen erster Kauf im Januar liegt, ist im Oktober ein
-- Wiederholungskäufer — auch wenn der Januar gerade nicht gefiltert ist.
-- Ein Fenster über die gefilterte Seite hätte „neu" behauptet, sobald man
-- den Monat wechselt.
--
-- ---------------------------------------------------------------------------
-- ZUSÄTZLICH: DER KÄUFERNAME EINER INTERNEN BESTELLUNG (B-1)
--
-- Die Spalte `Käufer` war für interne Verkäufe leer — `buyer_ref` gehört dem
-- externen Verkauf, und `orders_register_sale()` schreibt dort nichts hinein.
-- Sie bekommt jetzt `buyer_label`: extern `buyer_ref`, intern der Name aus
-- der Lieferadresse, wie sie beim Kauf eingefroren wurde.
--
-- `buyer_ref` BLEIBT UNVERÄNDERT, daneben. Es ist die externe Referenz, mit
-- der der Betrieb auf dem Marktplatz nachsieht, und kein Anzeigename — zwei
-- Bedeutungen in einem Feld wären der Anfang vom Ende beider.
--
-- Der Name wird NICHT zum Abgleichen benutzt. Er steht da, damit der
-- Betreiber die Zeile wiedererkennt; verknüpft wird ausschließlich über
-- `orders.user_id` (Entscheidung B-1).
--
-- ---------------------------------------------------------------------------
-- WAS DIESE MIGRATION NICHT TUT
--
--   keine Bestandsänderung · keine Lagerbewegung · kein Hold · nichts an
--   `order_refunds`, `payment_events` oder irgendeiner Commerce-Tabelle ·
--   keine Zeile gelöscht · kein Betrag berechnet · keine Rechnung berührt
--
-- Geschrieben wird an Daten genau zweimal, beides Backfill zweier neuer
-- Spalten: `sale_day` und `daily_index`. `updated_at` bleibt dabei stehen —
-- ein Backfill ist keine Korrektur des Betreibers.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(n, ', ') into v_missing
    from unnest(array['seller_sales', 'seller_sale', 'sale_is_test',
                      'sale_item_is_closed', 'sale_expected_payout',
                      'can_operate_active_seller']) as n
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and p.proname = n);
  if v_missing is not null then
    raise exception '0113 setzt frühere Migrationen voraus; es fehlen: %', v_missing;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'cancelled_at') then
    raise exception '0113 setzt 0071 voraus: sales.cancelled_at fehlt';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die zwei Spalten
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists sale_day    date,
  add column if not exists daily_index integer;

comment on column public.sales.sale_day is
  'The business day of this sale, materialised (0113). For an external sale `sold_at`; for an internal one `orders.paid_at::date` — exactly what `sale_day_of()` derives, kept by trigger on both tables. NULL means the day is not known: a workbook group whose date is a typo, or an order that is not paid yet.';
comment on column public.sales.daily_index is
  'This sale''s place within its day, 1…n (0113). Highest first on screen, so n is the day''s most recent sale. NULL exactly when `sale_day` is NULL — a sale without a day has no place in one. Assigned by trigger, exchanged only by `seller_swap_sale_daily_index()`; a negative value exists solely inside that function''s transaction, as the parking spot of the swap.';


-- ---------------------------------------------------------------------------
-- 2. Der Platz ist eindeutig
--
-- Teilindex, weil ein Verkauf ohne Tag keinen Platz hat: NULL-Werte gehören
-- nicht in einen Index, der Eindeutigkeit behauptet, die für sie nicht gilt.
-- ---------------------------------------------------------------------------
create unique index if not exists sales_daily_index_uniq
  on public.sales (sale_day, daily_index)
  where sale_day is not null and daily_index is not null;

-- Für `seller_sales()`: sortieren und zählen je Tag.
create index if not exists sales_sale_day_idx
  on public.sales (sale_day desc nulls last, daily_index desc nulls last, id desc);


-- ---------------------------------------------------------------------------
-- 3. Der Geschäftstag, EINMAL abgeleitet
--
-- Diese Funktion ist die ganze Definition. Trigger, Backfill und
-- Nachbedingung rufen sie; keiner schreibt den `case` noch einmal hin. Genau
-- dort lag der Keim des Problems — `seller_sales()` trug die Ableitung seit
-- 0059 im Rumpf, und niemand konnte prüfen, ob eine zweite Stelle dasselbe
-- meint.
-- ---------------------------------------------------------------------------
create or replace function public.sale_day_of(p_order_id bigint, p_sold_at date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_order_id is null then p_sold_at
              else (select o.paid_at::date from public.orders o where o.id = p_order_id)
         end;
$$;

comment on function public.sale_day_of(bigint, date) is
  'The business day of a sale (0113): `sold_at` for an external one, `orders.paid_at::date` for an internal one. The single definition — the trigger that fills `sales.sale_day`, this migration''s backfill and its postcondition all call it, so the column and the rule cannot drift apart.';

revoke all on function public.sale_day_of(bigint, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Der Backfill — VOR den Triggern, und deterministisch
--
-- WARUM IN DIESER REIHENFOLGE. Liefe der Zuweisungstrigger schon, bekäme
-- jede Zeile ihren Platz in der Reihenfolge, in der PostgreSQL sie
-- aktualisiert — und die ist nicht festgelegt. Zwei Umgebungen hätten
-- verschiedene Tagesreihenfolgen für dieselben Daten. Also erst der
-- Backfill, dann die Trigger.
--
-- DER TIE-BREAKER IST `id` (Entscheidung D-2). Nicht `created_at`: zwei
-- importierte Zeilen derselben Arbeitsmappe tragen denselben Zeitstempel,
-- und dann wäre die Reihenfolge wieder offen. `id` ist total geordnet und
-- in jeder Umgebung dieselbe.
-- ---------------------------------------------------------------------------
update public.sales s
   set sale_day = public.sale_day_of(s.order_id, s.sold_at)
 where s.sale_day is distinct from public.sale_day_of(s.order_id, s.sold_at);

/*
 * NUR WAS NOCH KEINEN PLATZ HAT.
 *
 * Beim ersten Anwenden ist das jede Zeile mit einem Tag, und die Zuweisung
 * ist lückenlos 1…n je Tag. Ein zweites Anwenden findet nichts und schreibt
 * nichts — es gibt also keinen Lauf, der eine bestehende, von Hand getauschte
 * Reihenfolge wieder platt macht.
 */
with gap as (
  select s.id, s.sale_day,
         row_number() over (partition by s.sale_day order by s.id) as place
    from public.sales s
   where s.sale_day is not null and s.daily_index is null
),
taken as (
  select s.sale_day, coalesce(max(s.daily_index), 0) as top
    from public.sales s
   where s.sale_day is not null and s.daily_index is not null
   group by s.sale_day
)
update public.sales s
   set daily_index = g.place + coalesce(t.top, 0)
  from gap g left join taken t on t.sale_day = g.sale_day
 where s.id = g.id;

-- Und ein Verkauf ohne Tag trägt keinen Platz.
update public.sales set daily_index = null
 where sale_day is null and daily_index is not null;


-- ---------------------------------------------------------------------------
-- 5. Der Tag und der Platz halten sich selbst in Ordnung
--
-- EIN BEFORE-TRIGGER UND KEINE ANWENDUNGSLOGIK. Der Platz darf nicht davon
-- abhängen, über welchen Weg eine Zeile entsteht: `seller_create_sale_with_details`,
-- `orders_register_sale`, der Arbeitsmappen-Import und jede künftige Stelle
-- schreiben in dieselbe Tabelle. Eine Zuweisung in einer von ihnen wäre eine
-- Zuweisung, die die anderen vergessen.
-- ---------------------------------------------------------------------------
create or replace function public.sales_set_day_and_index()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date; v_next integer;
begin
  v_day := public.sale_day_of(new.order_id, new.sold_at);
  new.sale_day := v_day;

  -- Kein Tag, kein Platz.
  if v_day is null then
    new.daily_index := null;
    return new;
  end if;

  /*
   * EIN BESTEHENDER PLATZ AM UNVERÄNDERTEN TAG BLEIBT STEHEN.
   *
   * Das ist die Tür, durch die `seller_swap_sale_daily_index()` geht: sie
   * setzt `daily_index` ausdrücklich, ohne den Tag anzufassen, und dieser
   * Zweig lässt den Wert durch. Er ist auch der Grund, warum jedes andere
   * UPDATE auf `sales` — Notiz, Auszahlung, Storno — die Reihenfolge NICHT
   * durcheinanderbringt.
   */
  if tg_op = 'UPDATE'
     and old.sale_day is not distinct from v_day
     and new.daily_index is not null then
    return new;
  end if;

  /*
   * SONST: HINTEN ANSTELLEN.
   *
   * `max + 1`, und deshalb die Vorratssperre: zwei gleichzeitige Verkäufe am
   * selben Tag würden sonst beide dieselbe Zahl lesen und einer am
   * Unique-Index scheitern. Die Sperre gilt je TAG und nur bis zum Ende der
   * Transaktion — zwei Verkäufe an zwei Tagen behindern sich nicht.
   *
   * `daily_index > 0` lässt den geparkten Negativwert eines gerade laufenden
   * Tauschs aus. Er ist kein belegter Platz.
   */
  perform pg_advisory_xact_lock(hashtext('sales_daily_index:' || v_day::text)::bigint);
  select coalesce(max(s.daily_index), 0) + 1 into v_next
    from public.sales s
   where s.sale_day = v_day and s.daily_index > 0;
  new.daily_index := v_next;
  return new;
end;
$$;

comment on function public.sales_set_day_and_index() is
  'Keeps `sales.sale_day` and `sales.daily_index` true on every write (0113). The day is always re-derived from `sale_day_of()`, never taken from the caller. The place is assigned as max+1 within the day under a per-day advisory lock, EXCEPT when an update leaves the day alone and names a place itself — that door is what `seller_swap_sale_daily_index()` goes through, and it is why an ordinary edit does not reshuffle the day.';

drop trigger if exists sales_set_day_and_index_trg on public.sales;
create trigger sales_set_day_and_index_trg
  before insert or update on public.sales
  for each row execute function public.sales_set_day_and_index();


/*
 * UND WENN SICH DER ZAHLUNGSZEITPUNKT EINER BESTELLUNG ÄNDERT.
 *
 * `orders_register_sale()` legt die Verkaufszeile an, sobald eine Bestellung
 * bezahlt ist — unter Umständen in derselben Anweisung, in der `paid_at`
 * gesetzt wird, unter Umständen davor. Im zweiten Fall hätte der Verkauf für
 * immer `sale_day = NULL`, weil nichts ihn mehr anfasst.
 *
 * Also stößt eine Änderung von `paid_at` die Verkaufszeile an. Der Wert hier
 * ist nur der Anstoß: der BEFORE-Trigger oben leitet den Tag ohnehin selbst
 * aus `orders` ab, und weil der Tag sich dabei ändert, bekommt der Verkauf
 * seinen Platz am NEUEN Tag — was richtig ist, er fand dort statt.
 */
create or replace function public.orders_restate_sale_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paid_at is not distinct from old.paid_at then
    return new;
  end if;
  update public.sales set sale_day = new.paid_at::date where order_id = new.id;
  return new;
end;
$$;

comment on function public.orders_restate_sale_day() is
  'Nudges the Orderbuch sale of an order whose `paid_at` changed (0113), so its `sale_day` and `daily_index` follow. The value written here is only the nudge — `sales_set_day_and_index()` re-derives the day from the order itself.';

drop trigger if exists orders_restate_sale_day_trg on public.orders;
create trigger orders_restate_sale_day_trg
  after update of paid_at on public.orders
  for each row execute function public.orders_restate_sale_day();


-- ---------------------------------------------------------------------------
-- 6. Zwei Verkäufe tauschen ihren Platz
--
-- Das ist die einzige Stelle, die `daily_index` bewusst verändert. Sie
-- TAUSCHT und verschiebt nicht: ein Verkauf nach oben heißt, der darüber geht
-- nach unten. Damit bleibt die Menge der Plätze eines Tages dieselbe, und
-- keine Lücke entsteht.
-- ---------------------------------------------------------------------------
create or replace function public.seller_swap_sale_daily_index(
  p_id bigint,
  p_with_index integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_day date; v_a public.sales; v_b public.sales; v_from integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_with_index is null or p_with_index < 1 then
    raise exception 'a place in a day starts at one' using errcode = 'invalid_parameter_value';
  end if;

  select sale_day into v_day from public.sales where id = p_id;
  if not found then
    raise exception 'no such sale' using errcode = 'no_data_found';
  end if;
  if v_day is null then
    raise exception 'a sale without a day has no place to swap'
      using errcode = 'restrict_violation';
  end if;

  /*
   * DIE SPERRE GILT DEM TAG, NICHT DEN ZWEI ZEILEN.
   *
   * Zwei gleichzeitige Tauschvorgänge am selben Tag, die ihre Zeilen in
   * verschiedener Reihenfolge sperren, verklemmen sich. Dieselbe Sperre, die
   * der Zuweisungstrigger nimmt, macht aus beiden eine Schlange — und sie
   * wird VOR dem ersten `for update` genommen, sonst wäre die Reihenfolge
   * wieder offen.
   */
  perform pg_advisory_xact_lock(hashtext('sales_daily_index:' || v_day::text)::bigint);

  select * into v_a from public.sales where id = p_id for update;
  if v_a.sale_day is distinct from v_day then
    raise exception 'this sale changed its day concurrently' using errcode = 'serialization_failure';
  end if;

  -- Schon dort. Kein Schreibvorgang, keine Ablehnung.
  if v_a.daily_index = p_with_index then
    return jsonb_build_object('ok', true, 'moved', false,
                              'daily_index', v_a.daily_index);
  end if;

  select * into v_b from public.sales
   where sale_day = v_day and daily_index = p_with_index and id <> v_a.id
   for update;
  if not found then
    raise exception 'no sale holds that place in the day' using errcode = 'no_data_found';
  end if;

  /*
   * DREI ANWEISUNGEN, WEIL ZWEI NICHT GEHEN.
   *
   * PostgreSQL prüft `sales_daily_index_uniq` je Zeile. Ein einzelnes UPDATE
   * über beide Zeilen scheitert deshalb an der ersten, lange bevor die
   * zweite ihren Platz freigegeben hat. Also wird einer geparkt.
   *
   * DER PARKPLATZ IST `-p_with_index`. Negativ, also kollidiert er mit keinem
   * echten Platz; und weil die Tagessperre oben jeden zweiten Tausch UND
   * jede Vergabe an diesem Tag anstehen lässt, kann kein zweiter Wagen
   * gleichzeitig dort stehen. Er verlässt diese Transaktion nicht.
   */
  v_from := v_a.daily_index;
  update public.sales set daily_index = -p_with_index where id = v_a.id;
  update public.sales set daily_index = v_from, updated_at = now(),
                          updated_by = (select auth.uid())
   where id = v_b.id;
  update public.sales set daily_index = p_with_index, updated_at = now(),
                          updated_by = (select auth.uid())
   where id = v_a.id;

  return jsonb_build_object('ok', true, 'moved', true,
                            'daily_index', p_with_index,
                            'swapped_with', v_b.id,
                            'swapped_from', v_from);
end;
$$;

comment on function public.seller_swap_sale_daily_index(bigint, integer) is
  'Exchanges two sales'' places within their day (0113). A swap, not a move: the set of places on a day never changes, so no gap appears. Atomic — three statements in one transaction, with one parked on a negative index because a unique index is checked per row and a two-row swap in a single UPDATE would trip on itself. Refuses a sale without a day and a place no sale holds. Already there is not an error: it writes nothing and says `moved: false`.';

revoke all on function public.seller_swap_sale_daily_index(bigint, integer) from public, anon;
grant execute on function public.seller_swap_sale_daily_index(bigint, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Das Verkaufsbuch
--
-- Rumpf aus `0075`. Was sich geändert hat, und NUR das:
--
--   1. `effective_date` ist jetzt die Spalte `s.sale_day` statt derselben
--      Ableitung im Rumpf. Eine Wahrheit, und `sale_day_of()` ist ihr Ort.
--   2. `daily_index` wird mitgeliefert und sortiert mit: `effective_date
--      desc, daily_index desc, id desc`. Höchster Platz oben (D-1).
--   3. `buyer_label` — extern `buyer_ref`, intern der Name aus der
--      Lieferadresse (B-1).
--   4. `buyer_repeat` — hat dieser Käufer hier schon einmal gekauft (B).
--   5. Die Suche findet auch den internen Käufernamen.
--
-- Zählungen, Filter, Summen, `is_open`, `is_incomplete` und jede
-- Geldableitung sind Zeile für Zeile unverändert.
-- ---------------------------------------------------------------------------
create or replace function public.seller_sales(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_scope   text    default 'all',      -- 'all' | 'internal' | 'external'
  p_open_payout boolean default false,
  p_status  text    default 'normal'    -- 'normal' | 'incomplete' | 'test' | 'any'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text; v_num text; v_status text; v_rows jsonb; v_sum jsonb; v_class jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  v_num := replace(coalesce(v_q, ''), ',', '.');   -- German decimals, nothing else

  with base as (
    select s.*,
           -- The customer-facing side, from whichever system owns it.
           case when s.order_id is not null then o.items_subtotal   else s.items_subtotal   end as c_subtotal,
           case when s.order_id is not null then o.shipping_amount  else s.shipping_charged end as c_shipping,
           case when s.order_id is not null then o.discount_amount  else s.discount_amount  end as c_discount,
           -- 0113. Die Spalte, nicht die Ableitung: `sale_day_of()` ist der
           -- eine Ort, an dem der Geschäftstag entsteht, und der Trigger
           -- hält die Spalte daran.
           s.sale_day as effective_date,
           o.order_number, o.payment_status, o.fulfillment_status,
           /*
            * WER GEKAUFT HAT — ZWEI FELDER, ZWEI BEDEUTUNGEN (0113).
            *
            * `buyer_user_id` ist das Einzige, womit interne Bestellungen
            * abgeglichen werden: die SkyIsles-Konto-ID. Ein Gastkauf hat
            * keine, und das bleibt so — ein Abgleich über Namen oder
            * E-Mail-Adresse wäre eine Vermutung mit Folgen.
            *
            * `buyer_label` ist reine Anzeige. Für einen externen Verkauf die
            * Referenz, die der Betreiber auf dem Marktplatz nachsieht; für
            * eine Bestellung der Name, an den das Paket ging, eingefroren
            * beim Kauf. Er wird NIE zum Abgleichen benutzt.
            */
           o.user_id as buyer_user_id,
           case when s.order_id is not null
                then nullif(btrim(coalesce(a.first_name, '') || ' '
                                  || coalesce(a.last_name, '')), '')
                else nullif(btrim(coalesce(s.buyer_ref, '')), '')
           end as buyer_label,
           coalesce(a.country_code, s.destination_country_code) as country,
           case when s.order_id is not null
                then (select count(*) from public.order_lines l where l.order_id = s.order_id)
                else (select count(*) from public.sale_items i where i.sale_id = s.id) end as item_count,
           case when s.order_id is not null
                then coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = s.order_id), 0)
                else coalesce((select sum(r.amount) from public.sale_refunds r where r.sale_id = s.id), 0) end as refunded,
           -- 0062. Disjoint halves of the same fee table: a shipping
           -- label is in exactly one of them, so no amount is counted twice.
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind <> 'shipping_label'), 0) as fees_total,
           coalesce((select sum(f.amount) from public.sale_fees f
                      where f.sale_id = s.id and f.kind = 'shipping_label'), 0) as label_total,
           public.sale_expected_payout(s.id) as expected_payout,
           -- 0063. The one definition, called rather than repeated.
           public.sale_is_test(s.id) as classified_test
      from public.sales s
      left join public.orders o on o.id = s.order_id
      left join public.order_addresses a on a.order_id = s.order_id and a.kind = 'shipping'
  ),
  /*
   * WER DERSELBE KÄUFER IST (0113, Entscheidung B).
   *
   * Eng und ausdrücklich: die Konto-ID für eine Bestellung, Quelle PLUS
   * Benutzername für einen externen Verkauf. Kein Name, keine E-Mail, keine
   * Adresse, und keine Verknüpfung zweier Quellen.
   *
   * `buyer_key IS NULL` heißt „nicht zuordenbar" und nicht „neu": ein
   * Gastkauf ohne Konto und ein externer Verkauf ohne Benutzernamen fallen
   * aus dem Fenster, statt einander zu Wiederholungskäufern zu machen.
   *
   * STORNIERT UND TEST FALLEN GANZ HERAUS (B-2, B-3). Nicht nur als
   * „vorheriger Kauf": sie werden auch selbst nie markiert. Ein stornierter
   * Verkauf ist kein Kauf, in keiner Richtung.
   */
  buyers as (
    select b.id, b.sale_day, b.daily_index,
           case when b.order_id is not null
                then case when b.buyer_user_id is null then null
                          else 'skyisles:' || b.buyer_user_id::text end
                else case when nullif(btrim(coalesce(b.buyer_ref, '')), '') is null then null
                          else b.channel || ':' || lower(btrim(b.buyer_ref)) end
           end as buyer_key
      from base b
     where b.cancelled_at is null
       and not b.classified_test
  ),
  /*
   * DIE REIHENFOLGE IST DIE DES BILDSCHIRMS, RÜCKWÄRTS GELESEN.
   *
   * `(sale_day, daily_index, id)` aufsteigend, mit NULLS FIRST — weil das
   * Verkaufsbuch absteigend mit NULLS LAST sortiert und ein undatierter
   * Verkauf dort unten steht. Eine Liste, zwei Richtungen; wäre es hier
   * anders, stünde ein grünes Häkchen über dem Kauf, der es erzeugt hat.
   *
   * Das Fenster läuft über ALLE Verkäufe, nicht über die gefilterte Seite:
   * der erste Kauf im Januar macht den im Oktober zum Wiederholungskauf,
   * auch wenn nur Oktober angezeigt wird.
   */
  repeats as (
    select b.id,
           row_number() over (partition by b.buyer_key
                              order by b.sale_day asc nulls first,
                                       b.daily_index asc nulls first,
                                       b.id asc) > 1 as buyer_repeat
      from buyers b
     where b.buyer_key is not null
  ),
  marked as (
    select b.*,
           coalesce(r.buyer_repeat, false) as buyer_repeat,
           /*
            * UNVOLLSTÄNDIG, and the two halves of the ledger answer it
            * differently because different systems own their facts.
            *
            * INTERNAL. Commerce owns everything that matters, so the only
            * thing this can report is a projection that disagrees with it: a
            * sale registered for an order that is not paid, one whose order
            * has no payment time to date it by, or one whose order has no
            * lines. An ordinary paid sandbox or live order is COMPLETE — the
            * Orderbuch's own optional extras being absent says nothing.
            *
            * EXTERNAL. A missing date, always. Plus, for a hand-made sale
            * only, two states that mean "this was started and not finished":
            * no items, and money still sitting at the 0/0 that
            * `seller_create_sale` writes as a placeholder. An imported sale is
            * held to neither, for the same reason as a purchase: its contents
            * and its amounts came from the workbook and cannot be completed
            * from this screen.
            *
            * A missing REPORTED PAYOUT is not here and must not be: the
            * marketplace pays late by design, and `Auszahlung offen` is its
            * own filter.
            */
           (case when b.order_id is not null
                 then b.payment_status is distinct from 'paid'
                   or b.effective_date is null
                   or b.item_count = 0
                 else b.effective_date is null
                   or (b.source = 'manual'
                       and (b.item_count = 0
                            or (coalesce(b.items_subtotal, 0) = 0
                                and coalesce(b.shipping_charged, 0) = 0)))
            end) as is_incomplete,
           /*
            * OFFEN — what is still to be DONE, which is not the same as what
            * can be BOOKED (0072).
            *
            * An internal sale is never open: commerce moved the stock when
            * the order was paid. A cancelled order is never open: nothing
            * left the shelf and nothing has to. A workbook sale is open only
            * if 0071 released it — the other 271 stay frozen, which is the
            * same refusal `seller_book_sale_item` makes.
            *
            * The item test asks for neither a movement NOR a `settled_at`,
            * and no longer asks for a `sky_id`. A portal in a shipped parcel
            * cannot be booked and is plainly not dealt with either; it
            * becomes dealt with by being settled. Same reasoning as 0068 on
            * the Einkauf side.
            */
           (b.cancelled_at is null
            and b.order_id is null
            and (b.source <> 'excel_order_2026' or b.stock_released_at is not null)
            and exists (select 1
                          from public.sale_items i
                         where i.sale_id = b.id
                           and not public.sale_item_is_closed(i))) as is_open,
           /*
            * THREE COUNTS, AND THEY ARE THREE (0072).
            *
            *   outbooked  a real `sale_external` movement exists. This and
            *              only this is `Ausgebucht`.
            *   settled    finished WITHOUT a movement: a non-catalog article,
            *              or a line the workbook marked `L = "-"` — shipped,
            *              deliberately not taken from the shelf.
            *   open       item_count minus both.
            *
            * `settled` is never added to `outbooked`. A settled position did
            * not leave figure inventory, and the tick in the ledger means
            * exactly that it did.
            */
           (select count(*) from public.sale_items i
             where i.sale_id = b.id
               and i.movement_id is not null and i.return_movement_id is null
               and i.return_announced_at is null and i.returned_at is null)::integer
             as outbooked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.return_movement_id is not null)::integer
             as restocked_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.settled_at is not null)::integer as settled_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and i.not_shipped_at is not null)::integer
             as not_shipped_count,
           (select count(*) from public.sale_items i
             where i.sale_id = b.id and public.sale_item_is_closed(i))::integer as closed_count
      from base b
      left join repeats r on r.id = b.id
  ),
  filtered as (
    select b.* from marked b
     where (case when coalesce(p_undated, false)
                 then b.effective_date is null
                 else (p_year  is null or extract(year  from b.effective_date) = p_year)
                  and (p_month is null or extract(month from b.effective_date) = p_month)
            end)
       and (p_scope = 'all'
            or (p_scope = 'internal' and b.order_id is not null)
            or (p_scope = 'external' and b.order_id is null))
       and (not coalesce(p_open_payout, false) or b.reported_payout_amount is null)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position,
                     'name', coalesce(k.name, i.raw_name, i.sky_id)) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              left join public.series se on se.code = k.series_code
             where i.sale_id = f.id and v_q is not null
               and (i.raw_name ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                 or i.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')) as match_items
      from filtered f
  ),
  searched as (
    select h.* from hits h
     where v_q is null
        or h.match_items is not null
        -- An internal sale matches on its own order lines, too.
        or (h.order_id is not null and exists (
              select 1 from public.order_lines l
               left join public.skylanders k on k.sky_id = l.sky_id
               left join public.series se on se.code = k.series_code
              where l.order_id = h.order_id
                and (l.name_snapshot ilike '%'||v_q||'%' or k.name ilike '%'||v_q||'%'
                  or l.sky_id ilike '%'||v_q||'%' or se.label ilike '%'||v_q||'%')))
        or to_char(h.effective_date, 'DD.MM.YYYY') ilike '%'||v_q||'%'
        or h.effective_date::text        ilike '%'||v_q||'%'
        or coalesce(h.c_subtotal, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.expected_payout, 0)::text ilike '%'||v_num||'%'
        or coalesce(h.order_number, '')  ilike '%'||v_q||'%'
        or coalesce(h.external_order_ref, '') ilike '%'||v_q||'%'
        or coalesce(h.buyer_ref, '')     ilike '%'||v_q||'%'
        -- 0113. Auch der Käufername einer Bestellung ist auffindbar; bisher
        -- war die Zeile über ihren Käufer gar nicht zu suchen.
        or coalesce(h.buyer_label, '')   ilike '%'||v_q||'%'
        or coalesce(h.note, '')          ilike '%'||v_q||'%'
        or h.channel                     ilike '%'||v_q||'%'
  ),
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.classified_test
             when 'incomplete' then not r.classified_test and r.is_incomplete
             when 'open'       then not r.classified_test and r.is_open
             when 'test'       then r.classified_test
             else true
           end
  ),
  -- One statement, for the same reason the Einkauf ledger is one: the page and
  -- the counts are two aggregates over two CTEs of the same query.
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'channel', m.channel, 'order_id', m.order_id, 'order_number', m.order_number,
      'sold_at', m.effective_date, 'shipped_at', m.shipped_at,
      -- 0113. Der Platz im Tag, und wie viele Verkäufe dieser Tag hat.
      'daily_index', m.daily_index,
      'payment_status', m.payment_status, 'fulfillment_status', m.fulfillment_status,
      'country', m.country, 'item_count', m.item_count,
      'items_subtotal', m.c_subtotal, 'shipping_charged', m.c_shipping,
      'discount_amount', m.c_discount, 'refunded', m.refunded,
      'expected_payout', m.expected_payout,
      'reported_payout', m.reported_payout_amount,
      'payout_difference', case when m.reported_payout_amount is null then null
                                else round(m.reported_payout_amount - m.expected_payout, 2) end,
      'buyer_ref', m.buyer_ref, 'external_order_ref', m.external_order_ref,
      -- 0113. Anzeige und Wiederkehr — beides nie zum Abgleichen benutzt.
      'buyer_label', m.buyer_label, 'buyer_repeat', m.buyer_repeat,
      'fees_total', m.fees_total, 'label_total', m.label_total,
      'source', m.source, 'note', m.note,
      -- The concurrency token an editor reads and sends back (0062).
      'updated_at', m.updated_at,
      'is_test', m.classified_test, 'is_incomplete', m.is_incomplete,
      'is_open', m.is_open,
      'cancelled_at', m.cancelled_at,
      'stock_released_at', m.stock_released_at,
      'outbooked_count', m.outbooked_count,
      'restocked_count', m.restocked_count,
      'settled_count', m.settled_count,
      'not_shipped_count', m.not_shipped_count,
      'closed_count', m.closed_count,
      'open_count', m.item_count - m.closed_count,
      'match_items', m.match_items)
      -- 0113. Höchster Platz oben (D-1). `id` bleibt der letzte Ausweg: ein
      -- undatierter Verkauf hat keinen Platz, und zwei davon brauchen
      -- trotzdem eine feste Reihenfolge.
      order by m.effective_date desc nulls last,
               m.daily_index desc nulls last,
               m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'sale_count', count(*),
      'item_count', coalesce(sum(m.item_count), 0),
      'gross',      coalesce(sum(coalesce(m.c_subtotal,0) + coalesce(m.c_shipping,0) - coalesce(m.c_discount,0)), 0),
      'refunded',   coalesce(sum(m.refunded), 0),
      'fees_total',   coalesce(sum(m.fees_total), 0),
      'label_total',  coalesce(sum(m.label_total), 0),
      'expected_payout', coalesce(sum(m.expected_payout), 0),
      'reported_payout', coalesce(sum(m.reported_payout_amount), 0),
      'open_payouts', count(*) filter (where m.reported_payout_amount is null),
      'mismatched',   count(*) filter (where m.reported_payout_amount is not null
                                         and round(m.reported_payout_amount - m.expected_payout, 2) <> 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.classified_test),
             'incomplete', count(*) filter (where not r.classified_test and r.is_incomplete),
             'open',       count(*) filter (where not r.classified_test and r.is_open),
             'test',       count(*) filter (where r.classified_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('sales', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Ein Verkauf
--
-- Rumpf aus `0110`. `to_jsonb(v_sale)` bringt `sale_day` und `daily_index`
-- von selbst mit, sobald die Spalten existieren. Dazu kommen drei Felder,
-- die der Bildschirm braucht und die kein Client ausrechnen soll:
--
--   `buyer_label`        derselbe Anzeigename wie im Verkaufsbuch (B-1)
--   `daily_index_count`  wie viele Verkäufe dieser Tag hat
--   `day_order`          die Plätze des Tages, absteigend — die Liste, aus
--                        der die Oberfläche einen Tauschpartner wählt
--
-- Alles andere ist unverändert.
-- ---------------------------------------------------------------------------
create or replace function public.seller_sale(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sale record; v_out jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_sale from public.sales where id = p_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'is_test', public.sale_is_test(p_id),
    'expected_payout', public.sale_expected_payout(p_id),
    'buy_in', public.sale_buy_in(p_id),
    /*
     * DER KÄUFERNAME, AUS DERSELBEN QUELLE WIE IM VERKAUFSBUCH (0113).
     *
     * Extern die Referenz, intern der Name aus der eingefrorenen
     * Lieferadresse. Reine Anzeige — abgeglichen wird nie darüber.
     */
    'buyer_label', case when v_sale.order_id is not null
      then (select nullif(btrim(coalesce(a.first_name, '') || ' '
                                || coalesce(a.last_name, '')), '')
              from public.order_addresses a
             where a.order_id = v_sale.order_id and a.kind = 'shipping' limit 1)
      else nullif(btrim(coalesce(v_sale.buyer_ref, '')), '') end,
    /*
     * DER TAG, ALS LISTE (0113).
     *
     * Die Oberfläche soll „nach oben" nicht raten müssen: `day_order` nennt
     * jeden belegten Platz des Tages mit der Verkaufs-ID dahinter, absteigend
     * wie auf dem Bildschirm. Lücken — ein Verkauf, der seinen Tag gewechselt
     * hat — sind damit sichtbar statt erschlossen.
     */
    'daily_index_count', case when v_sale.sale_day is null then 0 else (
      select count(*) from public.sales d where d.sale_day = v_sale.sale_day) end,
    'day_order', case when v_sale.sale_day is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'daily_index', d.daily_index)
                       order by d.daily_index desc)
        from public.sales d
       where d.sale_day = v_sale.sale_day and d.daily_index is not null), '[]'::jsonb) end,
    'order', case when v_sale.order_id is null then null else (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number,
        'paid_at', o.paid_at, 'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status, 'shipped_at', o.shipped_at,
        'items_subtotal', o.items_subtotal, 'shipping_amount', o.shipping_amount,
        'discount_amount', o.discount_amount, 'total_amount', o.total_amount,
        'currency', o.currency,
        'commerce_mode', o.commerce_mode,
        'country', (select a.country_code from public.order_addresses a
                     where a.order_id = o.id and a.kind = 'shipping' limit 1),
        'refunded', coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = o.id), 0),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'sky_id', l.sky_id, 'name', coalesce(k.name, l.name_snapshot),
                    'series_code', k.series_code, 'condition', l.condition,
                    'quantity', l.quantity, 'unit_price', l.unit_price,
                    'line_total', l.line_total,
                    'cancelled', q.cancelled, 'returned', q.returned,
                    'fulfillable', q.fulfillable, 'outstanding', q.outstanding,
                    'market_price', k.market_price) order by l.id)
                  from public.order_lines l
                  cross join lateral public.order_line_quantities(l.id) q
                  left join public.skylanders k on k.sky_id = l.sky_id
                  where l.order_id = o.id), '[]'::jsonb))
      from public.orders o where o.id = v_sale.order_id) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'position', i.position, 'sky_id', i.sky_id,
                'name', coalesce(k.name, i.raw_name, i.sky_id), 'raw_name', i.raw_name,
                'series_code', k.series_code, 'condition', i.condition,
                'market_price', coalesce(i.market_price_snapshot, k.market_price),
                'price_is_frozen', i.market_price_snapshot is not null,
                'movement_id', i.movement_id, 'returned_at', i.returned_at,
                'return_movement_id', i.return_movement_id,
                'return_announced_at', i.return_announced_at,
                'settled_at', i.settled_at,
                'not_shipped_at', i.not_shipped_at,
                -- Der External Hold (0110), als zwei Tatsachen.
                'held', exists (select 1 from public.order_reservations h
                                 where h.sale_item_id = i.id and h.state = 'active'),
                'stock_available', (select v.available_quantity
                                      from public.shop_inventory v
                                     where v.sky_id = i.sky_id
                                       and v.condition = public.v1_sale_condition()),
                'legacy_stock_flag', i.legacy_stock_flag,
                'legacy_shipped_flag', i.legacy_shipped_flag,
                'source_row', i.source_row) order by i.position)
              from public.sale_items i
              left join public.skylanders k on k.sky_id = i.sky_id
              where i.sale_id = p_id), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.sale_fees f where f.sale_id = p_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sale_refunds r where r.sale_id = p_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.settlement_adjustments a where a.sale_id = p_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Nachbedingungen
--
-- Was hier scheitert, scheitert in derselben Transaktion wie der Backfill:
-- entweder die Spalten stimmen oder diese Migration ist nicht angewendet.
-- ---------------------------------------------------------------------------
do $$
declare v_count integer; v_name text;
begin
  -- Die Spalten.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'sale_day') then
    raise exception '0113 unvollständig: sales.sale_day fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sales'
                    and column_name = 'daily_index') then
    raise exception '0113 unvollständig: sales.daily_index fehlt';
  end if;

  -- Der Teilindex, und dass er ein TEILindex ist.
  select count(*) into v_count
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'sales_daily_index_uniq' and i.indisunique and i.indpred is not null;
  if v_count <> 1 then
    raise exception '0113 unvollständig: sales_daily_index_uniq ist nicht als Teilindex eindeutig';
  end if;

  -- Die zwei Trigger.
  for v_name in select unnest(array['sales_set_day_and_index_trg', 'orders_restate_sale_day_trg']) loop
    if not exists (select 1 from pg_trigger t where t.tgname = v_name and not t.tgisinternal) then
      raise exception '0113 unvollständig: Trigger % fehlt', v_name;
    end if;
  end loop;

  -- Die Tauschfunktion, definer und mit gesetztem search_path.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_swap_sale_daily_index'
     and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as c
                  where c like 'search\_path=%');
  if v_count <> 1 then
    raise exception '0113 unvollständig: seller_swap_sale_daily_index() fehlt oder ist nicht abgesichert';
  end if;

  /*
   * DER TAG IST DIE ABLEITUNG. Keine Zeile darf etwas anderes sagen als
   * `sale_day_of()` — wäre es anders, hätte die Spalte eine zweite Meinung,
   * und der Bildschirm zeigte sie.
   */
  select count(*) into v_count from public.sales s
   where s.sale_day is distinct from public.sale_day_of(s.order_id, s.sold_at);
  if v_count > 0 then
    raise exception '0113 Befund: % Verkäufe mit abweichendem sale_day', v_count;
  end if;

  -- Kein Tag heißt kein Platz, und umgekehrt.
  select count(*) into v_count from public.sales s
   where (s.sale_day is null) <> (s.daily_index is null);
  if v_count > 0 then
    raise exception '0113 Befund: % Verkäufe mit Tag ohne Platz oder umgekehrt', v_count;
  end if;

  -- Und kein geparkter Negativwert ist liegengeblieben.
  select count(*) into v_count from public.sales where daily_index <= 0;
  if v_count > 0 then
    raise exception '0113 Befund: % Verkäufe mit einem Platz <= 0', v_count;
  end if;

  /*
   * JEDER TAG TRÄGT GENAU 1…n.
   *
   * Nach dem Backfill muss das gelten, und es ist die scharfste Aussage über
   * ihn: deterministisch, lückenlos, und keine Zeile doppelt. Später darf ein
   * Tageswechsel eine Lücke hinterlassen — das ist kein Fehler, nur hier und
   * jetzt wäre es einer.
   */
  select count(*) into v_count from (
    select s.sale_day
      from public.sales s
     where s.sale_day is not null
     group by s.sale_day
    having min(s.daily_index) <> 1 or max(s.daily_index) <> count(*)) x;
  if v_count > 0 then
    raise exception '0113 Befund: % Tage ohne lückenlose Plätze 1..n', v_count;
  end if;

  -- Und die zwei ersetzten Leser sind da.
  for v_name in select unnest(array['seller_sales', 'seller_sale']) loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_name) then
      raise exception '0113 unvollständig: %() fehlt', v_name;
    end if;
  end loop;
end;
$$;
