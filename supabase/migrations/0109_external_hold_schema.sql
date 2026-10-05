-- ===========================================================================
-- 0109 — Der Hold lernt einen zweiten Eigentümer
--
-- WOFÜR DAS IST. Ein externer Verkauf (eBay, Kleinanzeigen) ist in dem Moment
-- fachlich verkauft, in dem er angelegt wird — die Figur darf ab dann nicht
-- mehr über den SkyIsles-Shop weggehen. Sie ist aber noch nicht ausgebucht:
-- sie liegt im Regal, bis das Paket raus ist. Genau diese Zwischenzeit kennt
-- die Datenbank seit `0010` schon, nur für Shop-Bestellungen:
-- `order_reservations` hält Bestand zwischen Checkout und Zahlung.
--
-- DIESE MIGRATION ÄNDERT NUR DAS SCHEMA. Keine Funktion, die Holds anlegt,
-- löst oder verbraucht — die kommen in `0110`. Keine Zeile wird geschrieben,
-- gelöscht oder umgebucht. Danach existiert die Spalte, und niemand füllt
-- sie.
--
-- WARUM DIESELBE TABELLE UND KEINE ZWEITE
--
-- Die Invarianten passen, sie sind nicht bloß ähnlich:
--
--   state        `active → released | converted` IST Hold → Freigabe →
--                Verbrauch. Drei Zustände, zwei davon terminal.
--   reserved     wird an genau drei Stellen geführt und dreimal mit
--                derselben WHERE-Klausel bewacht
--                (`reserve_for_order`, `release_order_reservations`,
--                `convert_order_reservations` / `release_expired_reservations`).
--   movement_id  ist unique und nur bei `converted` erlaubt.
--   Löschen      ist per Trigger verboten; freigegeben wird, nicht entfernt.
--
-- Eine zweite Tabelle hätte eine zweite Buchhaltung über dieselbe Zahl
-- bedeutet. `shop_inventory.reserved` bleibt die eine autoritative Menge,
-- und `public.reservation_reconciliation` (0010) prüft sie weiterhin gegen
-- die Summe ALLER aktiven Holds — ohne Filter auf `order_id`, also gilt sie
-- für externe Holds vom ersten Tag an. `npm run verify:commerce` hält
-- `drift = 0` fest.
--
-- KEIN RENAME. Die Tabelle heißt weiter `order_reservations`, obwohl sie ab
-- `0110` zwei Bedeutungen trägt: `0104` und `0105` nennen sie wörtlich, sind
-- eingefroren und auf Production angewendet. Die zweite Bedeutung steht
-- stattdessen im Tabellenkommentar.
--
-- WARUM `sale_item_id` UND NICHT `sale_id`
--
-- `sale_items` ist eine Zeile pro physischem Objekt und hat bewusst keine
-- `quantity` (0059). Ein Hold auf `(sale_id, inventory_id)` müsste eine Menge
-- führen und beim Ausbuchen EINER Position teilweise verbraucht werden — das
-- kann `convert_order_reservations` nicht, es wandelt ganze Reservierungen.
-- Mit `sale_item_id` ist es eins zu eins: eine Position, ein Hold,
-- `quantity = 1`. Das spiegelt `sale_items.movement_id`, das ohnehin unique
-- ist.
--
-- WAS BESTEHENDE CHECKOUT-HOLDS ANGEHT: NICHTS
--
-- Zwei Spalten verlieren ihr `not null`, und das ist die einzige Lockerung.
-- Jeder vorhandene Leser bleibt gültig, geprüft und nicht vermutet:
--
--   `order_id`    wird überall entweder als `where r.order_id = <id>` oder
--                 als `join public.orders o on o.id = r.order_id` gelesen.
--                 NULL erfüllt weder das eine noch das andere, ein externer
--                 Hold ist für jeden dieser Leser also unsichtbar. Geprüft
--                 in 0010, 0012, 0015, 0021, 0041, 0043, 0047, 0077, 0083,
--                 0084, 0085, 0086, 0095, 0096, 0097, 0100.
--   `expires_at`  wird überall verglichen — `> now()` beim Checkout-Limit und
--                 beim Zahlungsstart, `<= now()` im Ablauf-Sweep. NULL ist
--                 bei beiden falsch. Der Sweep
--                 `release_expired_reservations` kann einen externen Hold
--                 deshalb nicht abräumen, und ein Constraint unten macht das
--                 strukturell statt nur faktisch.
--
--   `order_reservations_one_per_position unique (order_id, inventory_id)`
--                 bleibt wortgleich. Bei `order_id is null` greift sie nicht
--                 — NULLs sind in einer UNIQUE-Constraint verschieden —, also
--                 behindert sie externe Holds nicht und schützt Bestellungen
--                 unverändert.
--
-- KEINE ACL-ÄNDERUNG. `order_reservations` ist seit `0010` für `anon` und
-- `authenticated` vollständig entzogen und hat keine Policy; eine neue Spalte
-- braucht kein Grant. `service_role` wird nirgends genannt.
--
-- RÜCKBAU.
--   drop index  if exists public.order_reservations_one_active_hold_per_item;
--   alter table public.order_reservations
--     drop constraint if exists order_reservations_sale_item_fk,
--     drop constraint if exists order_reservations_one_owner,
--     drop constraint if exists order_reservations_order_hold_expires,
--     drop constraint if exists order_reservations_sale_hold_never_expires,
--     drop constraint if exists order_reservations_sale_hold_is_one,
--     drop column     if exists sale_item_id;
--   alter table public.order_reservations
--     alter column order_id   set not null,
--     alter column expires_at set not null;
--   -- und `reservations_deny_delete()` aus 0010 unverändert erneut anwenden
-- Möglich, solange keine Zeile ein `sale_item_id` trägt — also solange 0110
-- nicht angewendet ist.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- Datenprüfungen, keine „ist das schon gelaufen"-Prüfung: die Migration ist
-- idempotent, und ein zweiter Lauf soll aus demselben Grund durchgehen wie
-- der erste.
-- ---------------------------------------------------------------------------

do $$
declare
  v_drift bigint;
begin
  /*
   * DAS REGAL UND DAS HOLD-JOURNAL MÜSSEN SICH EINIG SEIN, bevor das Journal
   * einen zweiten Eigentümer bekommt. `reservation_reconciliation` (0010)
   * vergleicht `shop_inventory.reserved` mit der Summe ALLER aktiven
   * Reservierungen — ohne Filter auf `order_id`, weshalb dieselbe Sicht ab
   * `0110` auch externe Holds abdeckt. `verify:commerce` hält `drift = 0`
   * ohnehin fest. Wer hier schon driftet, würde die Abweichung in das neue
   * Modell mitnehmen.
   *
   * Das ist die EINZIGE Vorbedingung, die diese Datei selbst prüfen muss. Die
   * übrigen Invarianten — genau ein Eigentümer, ein Checkout mit Ablauf, ein
   * externer Hold ohne — stehen unten als CHECK-Constraints und prüfen sich
   * beim Anlegen selbst: eine Zeile, die sie verletzt, lässt `add constraint`
   * scheitern und nennt sich dabei. Sie hier zusätzlich abzufragen wäre eine
   * zweite Formulierung derselben Regel, und `sale_item_id` existiert an
   * dieser Stelle noch nicht einmal.
   */
  select count(*) into v_drift
    from public.reservation_reconciliation
   where drift <> 0;
  if v_drift > 0 then
    raise exception
      'reserved und die aktiven Reservierungen stimmen auf % Lagerposition(en) nicht überein; erst abgleichen (npm run verify:commerce)',
      v_drift
      using errcode = 'data_corrupted';
  end if;

  /*
   * `reverted_movement_id` kommt aus `0083` und wird vom Löschschutz in
   * Abschnitt 7 gelesen. Fehlte die Spalte, scheiterte der Trigger erst beim
   * ersten Löschversuch — Monate später und an einer Stelle, die nichts
   * davon ahnt.
   */
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.order_reservations'::regclass
       and a.attname = 'reverted_movement_id'
       and not a.attisdropped
  ) then
    raise exception 'order_reservations.reverted_movement_id fehlt; 0083 ist nicht angewendet'
      using errcode = 'undefined_column';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte
--
-- Nullable und leer. Gefüllt wird sie erst von `0110`.
-- ---------------------------------------------------------------------------

alter table public.order_reservations
  add column if not exists sale_item_id bigint;

comment on column public.order_reservations.sale_item_id is
  'The external sale position this hold belongs to (0109). Exactly one of order_id and sale_item_id is set: a checkout holds for an order, an external sale holds for one physical object. NULL on every row a shop checkout created. ON DELETE CASCADE, because a position being removed takes a hold that never became a movement with it — see reservations_deny_delete().';


-- ---------------------------------------------------------------------------
-- 3. Die zwei Lockerungen
--
-- `order_id` kann NULL sein, weil ein externer Hold keiner Bestellung gehört.
-- `expires_at` kann NULL sein, weil ein externer Hold NICHT abläuft: er endet,
-- wenn die Position ausgebucht, storniert oder entfernt wird, und nicht nach
-- `reservation_ttl()`. Ein Checkout-Hold behält beides — erzwungen in
-- Abschnitt 4, nicht nur beabsichtigt.
-- ---------------------------------------------------------------------------

alter table public.order_reservations
  alter column order_id   drop not null,
  alter column expires_at drop not null;


-- ---------------------------------------------------------------------------
-- 4. Die vier Constraints
--
-- Idempotent gesetzt — `drop constraint if exists` davor —, dasselbe Muster,
-- das `0071` für `sale_items` benutzt. Ein `add constraint` allein wäre beim
-- zweiten Lauf ein Fehler.
-- ---------------------------------------------------------------------------

/*
 * GENAU EIN EIGENTÜMER.
 *
 * Nicht „mindestens einer": eine Zeile mit beidem wäre ein Hold, der zwei
 * Vorgängen gleichzeitig gehört, und dann entscheidet die Reihenfolge der
 * Freigaben, wem der Bestand zufällt. `<>` auf zwei booleschen Ausdrücken ist
 * das exklusive Oder, und beide Seiten sind nie NULL — `x is null` liefert
 * immer true oder false.
 */
alter table public.order_reservations
  drop constraint if exists order_reservations_one_owner;
alter table public.order_reservations
  add constraint order_reservations_one_owner
  check ((order_id is null) <> (sale_item_id is null));

/*
 * EIN CHECKOUT LÄUFT AB.
 *
 * Ohne diesen Satz wäre ein Bestell-Hold ohne `expires_at` möglich, und der
 * Sweep könnte ihn nie abräumen: ein Leck, das niemand bemerkt, weil die
 * Zeile `active` bleibt und `reserved` oben hält.
 */
alter table public.order_reservations
  drop constraint if exists order_reservations_order_hold_expires;
alter table public.order_reservations
  add constraint order_reservations_order_hold_expires
  check (order_id is null or expires_at is not null);

/*
 * EIN EXTERNER HOLD LÄUFT NIE AB.
 *
 * Stärker als sich auf den Filter in `release_expired_reservations` zu
 * verlassen. Der liest `expires_at <= now()`, und NULL erfüllt das nicht —
 * aber das ist eine Eigenschaft des Vergleichs, die eine spätere Änderung
 * dieser Funktion aufheben könnte. Hier steht sie als Zusage der Tabelle:
 * ein externer Hold HAT kein Ablaufdatum, also kann kein Sweep eines finden.
 */
alter table public.order_reservations
  drop constraint if exists order_reservations_sale_hold_never_expires;
alter table public.order_reservations
  add constraint order_reservations_sale_hold_never_expires
  check (sale_item_id is null or expires_at is null);

/*
 * EINE POSITION IST EIN OBJEKT.
 *
 * `sale_items` führt keine Menge; eine Zeile IST ein physisches Stück (0059).
 * Ein externer Hold über zwei wäre also eine Menge, die es nicht gibt.
 */
alter table public.order_reservations
  drop constraint if exists order_reservations_sale_hold_is_one;
alter table public.order_reservations
  add constraint order_reservations_sale_hold_is_one
  check (sale_item_id is null or quantity = 1);


-- ---------------------------------------------------------------------------
-- 5. Der Fremdschlüssel
--
-- `on delete cascade`, und das ist eine bewusste Entscheidung mit einem
-- Gegenstück in Abschnitt 7.
--
-- WARUM NICHT `restrict`. `seller_remove_sale_item` löscht Positionen, und
-- `seller_delete_sale` löscht Verkäufe (Cascade auf `sale_items`). Mit
-- `restrict` würde jede Zeile, die je einen Hold getragen hat, das Löschen
-- für immer blockieren — auch wenn der Hold längst freigegeben ist.
--
-- WARUM NICHT `set null`. Das verletzt `order_reservations_one_owner`:
-- beide Eigentümer wären NULL.
--
-- `cascade` allein genügt aber nicht: ein Cascade-Delete feuert
-- `order_reservations_no_delete` genauso wie ein direktes. Deshalb lernt der
-- Trigger in Abschnitt 7 die eine Ausnahme, die sicher ist.
-- ---------------------------------------------------------------------------

alter table public.order_reservations
  drop constraint if exists order_reservations_sale_item_fk;
alter table public.order_reservations
  add constraint order_reservations_sale_item_fk
    foreign key (sale_item_id)
    references public.sale_items (id)
    on update cascade
    on delete cascade;


-- ---------------------------------------------------------------------------
-- 6. Höchstens ein aktiver Hold pro Position
--
-- PARTIELL AUF `state = 'active'`, und genau das ist der Punkt. Eine
-- Rückbuchung reaktiviert den gewandelten Hold nicht, sondern legt einen
-- NEUEN an; der alte bleibt mit seiner `movement_id` als Historie stehen.
-- Eine Position kann deshalb beliebig viele `released`- und
-- `converted`-Holds angesammelt haben — aber nie zwei, die gleichzeitig
-- Bestand halten.
--
-- `order_reservations_one_per_position unique (order_id, inventory_id)` aus
-- `0010` bleibt daneben unverändert und gilt weiter nur für Bestellungen.
--
-- Nicht mitgeändert: `order_reservations_due_idx on (expires_at) where state
-- = 'active'`. Externe Holds landen mit einem NULL-Schlüssel darin. Das ist
-- harmlos — der Sweep findet sie über den Vergleich ohnehin nicht —, und das
-- Prädikat eines bestehenden Index zu verengen gehört nicht in eine
-- Migration, die das Schema erweitert.
-- ---------------------------------------------------------------------------

create unique index if not exists order_reservations_one_active_hold_per_item
  on public.order_reservations (sale_item_id)
  where sale_item_id is not null and state = 'active';

comment on index public.order_reservations_one_active_hold_per_item is
  'At most one ACTIVE hold per external sale position (0109). Partial on purpose: released and converted holds may pile up, because unbooking a position creates a NEW hold instead of reviving the converted one — the old row keeps its movement_id as history. Two rows holding stock for one physical object would be stock that does not exist.';


-- ---------------------------------------------------------------------------
-- 7. Der Löschschutz lernt genau eine Ausnahme
--
-- `0010` sagt: „a reservation is released, never deleted". Das gilt
-- unverändert für alles, was je eine Bewegung geworden ist oder noch Bestand
-- hält. Ein EXTERNER Hold, der seinen Bestand schon zurückgegeben hat und nie
-- zu einer Bewegung wurde, hat nichts zu bewahren — er verschwindet mit der
-- Position, zu der er gehört.
--
-- WARUM DIE DREI BEDINGUNGEN ZUSAMMEN SICHER SIND
--
--   sale_item_id is not null   Bestell-Reservierungen fallen immer in den
--                              `raise`-Zweig. Für den Shop ändert sich nichts.
--   state = 'released'         `reserved` wurde bereits gesenkt. Ein `active`
--                              Hold ist nicht löschbar, also kann `reserved`
--                              nicht zu hoch zurückbleiben.
--   movement_id is null        die Zeile ist nie Teil des Journals geworden.
--   (und reverted_movement_id) dasselbe für die Rückbuchung aus `0083`.
--
-- `seller_remove_sale_item` lehnt gebuchte Positionen ohnehin ab, eine
-- entfernbare Position kann also nur `active`- oder `released`-Holds haben.
-- `0110` gibt den aktiven zuerst frei und löscht dann — der Cascade nimmt die
-- freigegebene Zeile mit.
--
-- Signatur, Sprache, `search_path` und das Fehlen von `security definer`
-- bleiben wortgleich mit `0010`: `create or replace` ersetzt dieselbe
-- Funktion und legt keine zweite an.
-- ---------------------------------------------------------------------------

create or replace function public.reservations_deny_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sale_item_id is not null
     and old.state = 'released'
     and old.movement_id is null
     and old.reverted_movement_id is null then
    return old;
  end if;

  raise exception 'a reservation is released, never deleted'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.reservations_deny_delete() is
  'Refuses to delete a reservation (0010), with the one exception 0109 added: an EXTERNAL hold that is already released and never became a movement goes with the sale position it belongs to. Everything else is released, never deleted — an order reservation always, and any hold that still holds stock or carries a movement id.';


-- ---------------------------------------------------------------------------
-- 8. Die Tabelle sagt jetzt, was sie ist
-- ---------------------------------------------------------------------------

comment on table public.order_reservations is
  'Stock held for one order between checkout and payment, or for one position of an external sale between entry and dispatch (0010, second owner since 0109). The ledger behind shop_inventory.reserved, which stays the authoritative number and is kept in step in the same transaction. Exactly one of order_id and sale_item_id is set. A checkout hold expires after reservation_ttl(); an external hold has no expiry and ends by being converted, released or removed with its position. Expired rows are released, never deleted: what was held and when is auditable.';


-- ---------------------------------------------------------------------------
-- 9. Nachprüfung
--
-- Was hier steht, ist nicht Dekoration: diese Migration wird von Hand im SQL
-- Editor angewendet, und ein stillschweigend halb angekommenes Schema wäre
-- die eine Art Fehler, die man erst in `0110` bemerkt. Jede Zusage wird
-- gegen den Katalog gelesen, nicht gegen die Absicht.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := '{}';
  v_filled  bigint;
  v_name    text;
begin
  -- Die Spalte, und sie muss nullable sein.
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.order_reservations'::regclass
       and a.attname = 'sale_item_id' and not a.attisdropped and not a.attnotnull
  ) then
    v_missing := v_missing || 'sale_item_id (nullable)';
  end if;

  -- Die zwei Lockerungen.
  foreach v_name in array array['order_id', 'expires_at'] loop
    if exists (
      select 1 from pg_attribute a
       where a.attrelid = 'public.order_reservations'::regclass
         and a.attname = v_name and a.attnotnull
    ) then
      v_missing := v_missing || (v_name || ' ist noch not null');
    end if;
  end loop;

  -- Die fünf Constraints dieser Migration, und die drei aus 0010/0083, die
  -- bleiben mussten.
  foreach v_name in array array[
    'order_reservations_one_owner',
    'order_reservations_order_hold_expires',
    'order_reservations_sale_hold_never_expires',
    'order_reservations_sale_hold_is_one',
    'order_reservations_sale_item_fk',
    'order_reservations_one_per_position',
    'order_reservations_movement_unique',
    'order_reservations_movement_only_when_converted'
  ] loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = 'public.order_reservations'::regclass
         and c.conname = v_name
    ) then
      v_missing := v_missing || ('constraint ' || v_name);
    end if;
  end loop;

  -- Der neue Index und der aus 0010, der daneben bestehen bleibt.
  foreach v_name in array array[
    'order_reservations_one_active_hold_per_item',
    'order_reservations_due_idx',
    'order_reservations_order_idx'
  ] loop
    if not exists (
      select 1 from pg_class i
        join pg_namespace n on n.oid = i.relnamespace
       where n.nspname = 'public' and i.relname = v_name
    ) then
      v_missing := v_missing || ('index ' || v_name);
    end if;
  end loop;

  -- Der Löschschutz hängt noch.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.order_reservations'::regclass
       and t.tgname = 'order_reservations_no_delete'
       and not t.tgisinternal
  ) then
    v_missing := v_missing || 'trigger order_reservations_no_delete';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0109 unvollständig: %', array_to_string(v_missing, ', ')
      using errcode = 'data_corrupted';
  end if;

  /*
   * UND NIEMAND HAT DIE SPALTE GEFÜLLT. Diese Migration legt keinen Hold an;
   * das tut `0110`. Stünde hier eine Zahl, hätte etwas geschrieben, was nicht
   * schreiben sollte.
   */
  select count(*) into v_filled
    from public.order_reservations where sale_item_id is not null;
  if v_filled > 0 then
    raise exception '0109 hat % Hold(s) mit sale_item_id vorgefunden; 0109 schreibt keine', v_filled
      using errcode = 'data_corrupted';
  end if;

  raise notice '0109 vollständig: Spalte, 5 Constraints, 1 Index, Trigger — und 0 externe Holds';
end $$;
