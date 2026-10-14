-- ===========================================================================
-- 0122 — EIGENBELEGE ÜBER PRIVATANKÄUFE
--
-- Ein Eigenbeleg dokumentiert einen Ankauf von einer Privatperson, die keine
-- Rechnung ausstellt. Er wird vom Käufer selbst erstellt, trägt eine eigene
-- Nummer und muss ab der Ausstellung unveränderlich sein.
--
-- ---------------------------------------------------------------------------
-- 1. ZWEI TABELLEN, WEIL ZWEI DINGE VERSCHIEDEN ALT WERDEN
--
-- `purchase_receipts` ist das DOKUMENT und wird nie wieder angefasst.
-- `purchase_receipt_downloads` ist das PROTOKOLL der Auslieferungen und
-- wächst weiter.
--
-- Beides auf einer Zeile hiesse: eine Zeile, die teils gefroren und teils
-- fortschreibbar ist, und ein Trigger, der Spalten unterscheiden muss. Mit
-- zwei Tabellen ist die Regel einfach — BEIDE sind nur mit INSERT zu
-- beschreiben, und der Lieferstatus ist keine Spalte, sondern die Frage, ob
-- es eine Protokollzeile gibt.
--
-- ---------------------------------------------------------------------------
-- 2. ALLES WIRD KOPIERT, NICHTS GEJOINT
--
-- Käufer, Verkäufer, Herkunft, Beträge und die Positionsliste stehen als
-- eigene Spalten beziehungsweise als `jsonb` im Beleg. Der Grund steht seit
-- `0047` in `invoices`: „a document that is re-rendered from live data is not
-- a document, it is a query wearing one's clothes."
--
-- Konkret: die Bezeichnung einer Figur kommt heute aus
-- `skylanders.display_name_override` oder `skylanders.name`. Ändert ein
-- Administrator morgen einen Anzeigenamen, darf ein ausgestellter Beleg sich
-- nicht ändern. Deshalb wandert der Name in `lines` und bleibt dort.
--
-- ---------------------------------------------------------------------------
-- 3. NUR KAUFRELEVANTES, UND DESHALB KEIN BUCHUNGSZUSTAND
--
-- Eine Position reist mit `position`, `sky_id`, `name` und `condition` auf den
-- Beleg — und AUSDRUECKLICH OHNE `state`.
--
-- `state` ist der Lagerweg einer Figur: bestellt, angekommen, eingebucht,
-- beschädigt, fehlt, Vitrine, abgerechnet. Er beschreibt, was der Betrieb mit
-- der Ware tut, nicht was gekauft wurde. Ein Eigenbeleg dokumentiert den
-- Ankauf; dass eine Figur drei Tage später ins Lager gebucht wird, ändert am
-- Ankauf nichts.
--
-- Die erste Fassung hatte `state` an zwei Stellen: im Snapshot und im
-- Fingerabdruck. Das hatte zwei Folgen, beide falsch. Erstens stand auf dem
-- Dokument eine Angabe, die sich danach still ändern durfte — ein Beleg, der
-- einen veränderlichen Zustand ausweist, behauptet mehr, als er einfrieren
-- kann. Zweitens hätte jedes Einbuchen nach der Ausstellung die Warnung
-- „belegrelevante Daten geändert" ausgelöst, und zwar bei jedem Einkauf, denn
-- Einbuchen ist der Normalfall.
--
-- BESCHAEDIGTE POSITIONEN STEHEN WEITER AUF DEM BELEG. Sie wurden bezahlt und
-- gehören deshalb in die Liste; was wegfällt, ist nur die Spalte mit dem
-- operativen Zustand. Was die Ware IST — lose oder originalverpackt — bleibt
-- als `condition` erhalten, denn das ist eine Eigenschaft des Gekauften.
--
-- ---------------------------------------------------------------------------
-- 4. DIE NUMMER KOMMT AUS EINER TABELLE, NICHT AUS EINER SEQUENZ
--
-- Sequenzen sind nicht transaktional: bricht die Transaktion ab, ist der Wert
-- verbraucht und in der Nummernfolge klafft eine Lücke. Für die Kundenrechnung
-- (`0047`) ist das vertretbar — sie entsteht automatisch beim Zahlungseingang,
-- und eine Lücke erklärt sich durch eine fehlgeschlagene Zahlung. Ein SELBST
-- ausgestellter Beleg mit Lücken in der eigenen Folge lädt dagegen zu
-- Rückfragen ein.
--
-- `purchase_receipt_counters` ist eine Zeile je Jahr. Das `insert … on
-- conflict do update … returning` vergibt die nächste Nummer unter der
-- Zeilensperre: gleichzeitige Ausstellungen warten aufeinander statt dieselbe
-- Nummer zu ziehen, und ein Rollback gibt die Nummer zurück. Die erste Nummer
-- eines Jahres ist 1, weil der INSERT-Zweig mit 1 anlegt.
--
-- ---------------------------------------------------------------------------
-- 5. KORREKTUREN SIND VORBEREITET, ABER NICHT GEBAUT
--
-- Es gibt KEINE Funktion, die eine Korrektur ausstellt. Was es gibt, ist eine
-- Struktur, in der eine Korrektur später widerspruchsfrei möglich ist:
--
--   * `supersedes_id` zeigt auf den Beleg, den eine Korrektur ersetzt.
--   * Eine zusammengesetzte Fremdschlüsselbeziehung erzwingt, dass beide zum
--     SELBEN Einkauf gehören — deklarativ, ohne Trigger.
--   * Ein Teilindex lässt je Einkauf genau EINEN ursprünglichen Beleg zu.
--   * Ein zweiter lässt jeden Beleg höchstens EINMAL ersetzen; eine Kette
--     kann sich damit nicht gabeln.
--   * `revision = 1` genau dann, wenn es kein Vorgängerdokument gibt.
--
-- ---------------------------------------------------------------------------
-- 6. OFFENE FRAGEN, DIE DIESE MIGRATION NICHT LÖST
--
-- Ein Beleg trägt Name und Anschrift einer Privatperson. Technisch erbt er
-- den Schutz, den `purchases` seit `0053` hat. Nicht gelöst und ausdrücklich
-- vermerkt: die Datenschutzerklärung dieses Produkts beschreibt Kunden und
-- Bestellungen und erwähnt Ankäufe mit keinem Wort, und `docs/LEGAL.md` führt
-- die Aufbewahrungsfristen als offenen Punkt des Betreibers. Beides gehört
-- entschieden, bevor echte Absenderdaten auf echten Belegen stehen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Der Zähler
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_receipt_counters (
  year        integer primary key,
  next_number integer not null,

  constraint receipt_counter_year_sane   check (year between 2000 and 2999),
  constraint receipt_counter_number_sane check (next_number between 1 and 999999)
);

comment on table public.purchase_receipt_counters is
  'Eine Zeile je Jahr, die die zuletzt vergebene Eigenbelegnummer haelt (0122). Transaktional und damit LUECKENLOS, anders als eine Sequenz: ein Rollback gibt die Nummer zurueck. Die Zeilensperre serialisiert gleichzeitige Ausstellungen.';

alter table public.purchase_receipt_counters enable row level security;
revoke all on table public.purchase_receipt_counters from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Der Beleg
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_receipts (
  id          bigint generated always as identity primary key,
  purchase_id bigint not null,

  receipt_number text        not null,
  issued_at      timestamptz not null default now(),
  issued_by      uuid,

  -- Korrekturkette. Heute immer 1 und NULL; siehe Abschnitt 4 oben.
  revision      integer not null default 1,
  supersedes_id bigint,

  /*
   * DER FINGERABDRUCK DER BELEGRELEVANTEN DATEN.
   *
   * Nicht `purchases.updated_at`: das ändert sich auch, wenn jemand die
   * interne Notiz anfasst oder den Tagesplatz tauscht — Dinge, die auf
   * keinem Beleg stehen. Dieser Hash wird aus GENAU den Feldern gebildet,
   * die der Beleg zeigt, und beim Lesen gegen den aktuellen Stand des
   * Einkaufs gehalten. Weicht er ab, hat sich etwas Belegrelevantes
   * geändert, und die Oberfläche kann warnen.
   */
  content_fingerprint text not null,

  -- ---- der Käufer: die Geschäftsdaten DIESES Shops, kopiert ---------------
  buyer_legal_name  text not null,
  buyer_trade_name  text,
  buyer_street      text not null,
  buyer_postal_code text not null,
  buyer_city        text not null,
  buyer_country     text not null,
  buyer_email       text,
  buyer_vat_id      text,

  -- ---- der private Verkäufer und die Herkunft, kopiert --------------------
  seller_platform    text,
  seller_handle      text,
  sender_name        text,
  sender_street      text,
  sender_postal_code text,
  sender_city        text,
  sender_country     text,
  listing_ref        text,
  listing_title      text,
  listing_url        text,
  listing_details    text,

  -- ---- der Kauf, kopiert --------------------------------------------------
  purchased_at          date           not null,
  items_cost            numeric(10,2),
  shipping_cost         numeric(10,2),
  buyer_protection_cost numeric(10,2),
  total_cost            numeric(10,2)  not null,
  currency              text           not null default 'EUR',
  payment_method        text,
  agreement_note        text,

  -- ---- die Positionen, eingefroren ---------------------------------------
  lines jsonb not null,

  constraint receipts_purchase_fk foreign key (purchase_id)
    references public.purchases (id) on update cascade on delete restrict,
  constraint receipts_issued_by_fk foreign key (issued_by)
    references auth.users (id) on delete set null,

  /*
   * EINE KORREKTUR GEHÖRT ZUM SELBEN EINKAUF — deklarativ erzwungen.
   * Der zusammengesetzte Fremdschlüssel kann nur greifen, wenn es die
   * passende eindeutige Zusicherung gibt; daher die Zeile darunter.
   */
  constraint receipts_id_purchase_uniq unique (id, purchase_id),
  constraint receipts_supersedes_fk foreign key (supersedes_id, purchase_id)
    references public.purchase_receipts (id, purchase_id) on delete restrict,

  constraint receipts_number_unique unique (receipt_number),
  constraint receipts_number_shape check (receipt_number ~ '^SI-E-[0-9]{4}-[0-9]{6}$'),
  constraint receipts_fingerprint_shape check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint receipts_revision_sane check (revision between 1 and 999),
  /* Revision 1 heisst Ursprung, alles darüber heisst Korrektur. */
  constraint receipts_revision_matches_chain
    check ((supersedes_id is null) = (revision = 1)),
  constraint receipts_no_self_reference check (supersedes_id is distinct from id),

  constraint receipts_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint receipts_amounts_sane
    check (total_cost >= 0 and total_cost <= 1000000
           and (items_cost is null or items_cost >= 0)
           and (shipping_cost is null or shipping_cost >= 0)
           and (buyer_protection_cost is null or buyer_protection_cost >= 0)),
  /* Wenn eine Aufteilung kopiert wurde, muss sie die Summe ergeben — dieselbe
     Regel wie `purchases_cost_split_adds_up` aus 0115. */
  constraint receipts_split_adds_up
    check (items_cost is null
           or total_cost = items_cost + coalesce(shipping_cost, 0)
                                      + coalesce(buyer_protection_cost, 0)),
  constraint receipts_buyer_shape
    check (length(btrim(buyer_legal_name)) > 0 and length(btrim(buyer_street)) > 0
           and length(btrim(buyer_postal_code)) > 0 and length(btrim(buyer_city)) > 0
           and length(btrim(buyer_country)) > 0),
  constraint receipts_lines_present check (jsonb_array_length(lines) > 0)
);

/* Je Einkauf genau EIN ursprünglicher Beleg. Korrekturen tragen
   `supersedes_id` und fallen aus dem Teilindex heraus. */
create unique index if not exists purchase_receipts_origin_uniq
  on public.purchase_receipts (purchase_id) where supersedes_id is null;

/* Und jeder Beleg wird höchstens EINMAL ersetzt — die Kette gabelt nicht. */
create unique index if not exists purchase_receipts_supersedes_uniq
  on public.purchase_receipts (supersedes_id) where supersedes_id is not null;

create index if not exists purchase_receipts_purchase_idx
  on public.purchase_receipts (purchase_id, revision desc);

comment on table public.purchase_receipts is
  'Ein ausgestellter Eigenbeleg ueber einen Privatankauf (0122). Kaeufer, Verkaeufer, Herkunft, Betraege und Positionen sind beim Ausstellen KOPIERT, damit eine spaetere Aenderung an Einkauf, Absender oder Katalogname ein ausgestelltes Dokument nicht umschreibt. Nur INSERT: ein Trigger lehnt UPDATE und DELETE ab. Keine Umsatzsteuer, kein Marktwert, kein Faktor — was nicht kopiert wird, kann nicht gedruckt werden.';

comment on column public.purchase_receipts.content_fingerprint is
  'SHA-256 ueber GENAU die belegrelevanten Felder des Einkaufs zum Zeitpunkt der Ausstellung (0122). Dient dem Vergleich mit dem aktuellen Stand; `purchases.updated_at` taugt dafuer nicht, weil es sich auch bei internen Aenderungen bewegt.';

comment on column public.purchase_receipts.lines is
  'Die gekauften Positionen, eingefroren: position, sky_id, name, condition. OHNE `state`: der Buchungszustand ist der Lagerweg einer Figur und nicht Teil des Ankaufs — ein spaeteres Einbuchen aendert am gekauften Los nichts. Beschaedigte und fehlende Positionen stehen mit darauf, denn bezahlt wurde das Los; nur ihr operativer Zustand steht nicht mehr dabei.';

alter table public.purchase_receipts enable row level security;
revoke all on table public.purchase_receipts from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Das Lieferprotokoll
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_receipt_downloads (
  id         bigint generated always as identity primary key,
  receipt_id bigint not null,

  delivered_at timestamptz not null default now(),
  delivered_by uuid,
  byte_count   integer not null,

  constraint receipt_downloads_receipt_fk foreign key (receipt_id)
    references public.purchase_receipts (id) on update cascade on delete restrict,
  constraint receipt_downloads_by_fk foreign key (delivered_by)
    references auth.users (id) on delete set null,
  constraint receipt_downloads_bytes_sane check (byte_count between 1 and 100000000)
);

create index if not exists purchase_receipt_downloads_receipt_idx
  on public.purchase_receipt_downloads (receipt_id, delivered_at);

comment on table public.purchase_receipt_downloads is
  'Eine Zeile je vollstaendig abgerufenem Eigenbeleg-PDF (0122). Geschrieben wird sie erst, wenn der Browser den SHA-256 der empfangenen Bytes vorgelegt hat und er mit dem neu gerenderten Dokument uebereinstimmt — der Beweis, dass die GANZEN Bytes ankamen. Mehr sagt sie nicht: ob das Betriebssystem die Datei behalten hat, weiss HTTP nicht.';

alter table public.purchase_receipt_downloads enable row level security;
revoke all on table public.purchase_receipt_downloads from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Unveränderlichkeit, mit einem Riegel statt mit einer Verabredung
-- ---------------------------------------------------------------------------
create or replace function public.purchase_receipt_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'an issued receipt cannot be changed or removed (%)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.purchase_receipt_is_immutable() is
  'Lehnt jedes UPDATE und DELETE auf den Eigenbeleg-Tabellen ab (0122). Die Tabellenrechte sind ohnehin entzogen; dies ist der Riegel darunter, damit auch ein Weg mit erhoehten Rechten ein ausgestelltes Dokument nicht umschreibt.';

drop trigger if exists purchase_receipts_immutable_trg on public.purchase_receipts;
create trigger purchase_receipts_immutable_trg
  before update or delete on public.purchase_receipts
  for each row execute function public.purchase_receipt_is_immutable();

drop trigger if exists purchase_receipt_downloads_immutable_trg
  on public.purchase_receipt_downloads;
create trigger purchase_receipt_downloads_immutable_trg
  before update or delete on public.purchase_receipt_downloads
  for each row execute function public.purchase_receipt_is_immutable();


-- ---------------------------------------------------------------------------
-- 5. Der Fingerabdruck der belegrelevanten Daten
--
-- EINE Funktion, zwei Verwendungen: beim Ausstellen wird sie gespeichert,
-- beim Lesen neu gerechnet und verglichen. Zwei getrennte Implementierungen
-- wuerden frueher oder spaeter auseinanderlaufen und dann entweder falsch
-- warnen oder falsch schweigen.
--
-- Was eingeht, ist genau das, was auf dem Beleg steht. Was NICHT eingeht:
-- `note`, `is_test`, `source`, `daily_index`, `updated_at`, `client_token`.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_receipt_fingerprint(p_purchase_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(
    coalesce(
      (select jsonb_build_object(
                'purchased_at', p.purchased_at,
                'items_cost', p.items_cost,
                'shipping_cost', p.shipping_cost,
                'buyer_protection_cost', p.buyer_protection_cost,
                'total_cost', p.total_cost,
                'currency', p.currency,
                'payment_method', p.payment_method,
                'platform', p.platform,
                'seller_name', p.seller_name,
                'external_ref', p.external_ref,
                'sender_name', p.sender_name,
                'sender_street', p.sender_street,
                'sender_postal_code', p.sender_postal_code,
                'sender_city', p.sender_city,
                'sender_country', p.sender_country,
                'listing_title', p.listing_title,
                'listing_url', p.listing_url,
                'listing_details', p.listing_details,
                'agreement_note', p.agreement_note,
                'lines', coalesce(
                  (select jsonb_agg(jsonb_build_object(
                            'position', i.position,
                            'sky_id', i.sky_id,
                            'name', coalesce(s.display_name_override, s.name, i.raw_name),
                            'condition', i.condition)
                          order by i.position, i.id)
                     from public.purchase_items i
                     left join public.skylanders s on s.sky_id = i.sky_id
                    where i.purchase_id = p.id),
                  '[]'::jsonb)
              )::text
         from public.purchases p
        where p.id = p_purchase_id),
      ''),
    'utf8')), 'hex');
$$;

comment on function public.purchase_receipt_fingerprint(bigint) is
  'SHA-256 ueber die KAUFRELEVANTEN Felder eines Einkaufs (0122) — Datum, Betraege, Zahlungsart, Herkunft, Absender, Inserat, Vereinbarung und die Positionen mit Nummer, SKY-ID, Namen und Ausfuehrung. NICHT enthalten: der Buchungszustand einer Position (`state`), denn Einbuchen und Umbuchen sind operative Vorgaenge und veraendern den Ankauf nicht — sonst loeste jedes Einbuchen nach der Ausstellung eine Aenderungswarnung aus. Ebenfalls draussen: interne Notiz, Testkennzeichen, Quelle, Tagesplatz, Zeitstempel. Dieselbe Funktion bildet den gespeicherten und den aktuellen Wert, damit beide vergleichbar bleiben.';

revoke all on function public.purchase_receipt_fingerprint(bigint) from public, anon;


-- ---------------------------------------------------------------------------
-- 6. Lesen: der Zustand für den Dialog
-- ---------------------------------------------------------------------------
create or replace function public.seller_purchase_receipt(p_purchase_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_downloads integer;
  v_first timestamptz;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select r.* into v_receipt
    from public.purchase_receipts r
   where r.purchase_id = p_purchase_id
     and not exists (select 1 from public.purchase_receipts s where s.supersedes_id = r.id)
   order by r.revision desc
   limit 1;

  if not found then
    return jsonb_build_object('receipt', null);
  end if;

  select count(*)::integer, min(d.delivered_at)
    into v_downloads, v_first
    from public.purchase_receipt_downloads d
   where d.receipt_id = v_receipt.id;

  return jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', v_receipt.id,
      'receipt_number', v_receipt.receipt_number,
      'issued_at', v_receipt.issued_at,
      'revision', v_receipt.revision,
      'download_count', v_downloads,
      'first_delivered_at', v_first,
      /*
       * DIE WARNUNG AUS M5. Der gespeicherte Fingerabdruck gegen den
       * aktuellen — nicht `updated_at`, das sich auch bei einer internen
       * Notiz bewegt.
       */
      'stale', v_receipt.content_fingerprint
               is distinct from public.purchase_receipt_fingerprint(p_purchase_id)
    ));
end;
$$;

comment on function public.seller_purchase_receipt(bigint) is
  'Der aktuelle Eigenbeleg eines Einkaufs mit Nummer, Ausstellungsdatum, Abrufzahl und dem Hinweis `stale` (0122). `stale` vergleicht den gespeicherten Fingerabdruck der belegrelevanten Daten mit dem aktuellen Stand — nicht `updated_at`. Gibt `{"receipt": null}` zurueck, wenn noch keiner ausgestellt ist. Liest nur.';

revoke all on function public.seller_purchase_receipt(bigint) from public, anon;
grant execute on function public.seller_purchase_receipt(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Ausstellen
-- ---------------------------------------------------------------------------
create or replace function public.seller_issue_purchase_receipt(p_purchase_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_seller   public.sellers%rowtype;
  v_existing public.purchase_receipts%rowtype;
  v_lines    jsonb;
  v_number   integer;
  v_year     integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * DIE ZEILE WIRD GESPERRT, BEVOR IRGENDETWAS GELESEN WIRD.
   *
   * Zwei gleichzeitige Klicks auf „Eigenbeleg erstellen" wuerden sonst beide
   * keinen bestehenden Beleg finden und beide einen anlegen. Der Teilindex
   * `purchase_receipts_origin_uniq` faenge den zweiten ab — aber mit einem
   * Constraint-Fehler statt mit dem Beleg, den der Betreiber erwartet.
   */
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'this purchase does not exist' using errcode = 'no_data_found';
  end if;

  if v_purchase.is_test then
    raise exception 'a test purchase gets no receipt'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_purchase.purchased_at is null then
    raise exception 'a receipt needs the purchase date; add it first'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * SCHON AUSGESTELLT? DANN DENSELBEN ZURUECK.
   *
   * Dieselbe Haltung wie `seller_book_purchase_item`: ein zweiter Aufruf
   * macht nichts Neues, sondern antwortet mit dem, was es gibt. Gesucht wird
   * der Beleg am ENDE der Kette — der, den niemand ersetzt hat.
   */
  select r.* into v_existing
    from public.purchase_receipts r
   where r.purchase_id = p_purchase_id
     and not exists (select 1 from public.purchase_receipts s where s.supersedes_id = r.id)
   order by r.revision desc
   limit 1;
  if found then
    return public.seller_purchase_receipt(p_purchase_id);
  end if;

  /*
   * DIE GESCHAEFTSDATEN DIESES SHOPS — aus `public.sellers`, nicht aus einer
   * Konstante im Anwendungscode. Fehlt eine Pflichtangabe, entsteht KEIN
   * Beleg mit erfundenen Daten.
   */
  select * into v_seller from public.sellers where is_active limit 1;
  if not found
     or nullif(btrim(coalesce(v_seller.legal_name, '')), '') is null
     or nullif(btrim(coalesce(v_seller.street, '')), '') is null
     or nullif(btrim(coalesce(v_seller.postal_code, '')), '') is null
     or nullif(btrim(coalesce(v_seller.city, '')), '') is null then
    raise exception 'the shop has no complete business address; fill in legal name, street, postal code and city before issuing a receipt'
      using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_agg(jsonb_build_object(
           'position', i.position,
           'sky_id', i.sky_id,
           'name', coalesce(s.display_name_override, s.name, i.raw_name),
           'condition', i.condition)
         order by i.position, i.id)
    into v_lines
    from public.purchase_items i
    left join public.skylanders s on s.sky_id = i.sky_id
   where i.purchase_id = p_purchase_id;

  if v_lines is null then
    raise exception 'this purchase has no item to put on a receipt'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DIE NUMMER, TRANSAKTIONAL.
   *
   * Der INSERT-Zweig legt das Jahr mit 1 an — die erste Nummer eines Jahres
   * ist damit 000001. Der UPDATE-Zweig zaehlt unter der Zeilensperre hoch.
   * Bricht die Transaktion ab, ist nichts verbraucht.
   */
  v_year := extract(year from (now() at time zone 'Europe/Berlin'))::integer;
  insert into public.purchase_receipt_counters as c (year, next_number)
       values (v_year, 1)
  on conflict (year) do update
      set next_number = c.next_number + 1
    returning c.next_number into v_number;

  insert into public.purchase_receipts (
    purchase_id, receipt_number, issued_by, content_fingerprint,
    buyer_legal_name, buyer_trade_name, buyer_street, buyer_postal_code,
    buyer_city, buyer_country, buyer_email, buyer_vat_id,
    seller_platform, seller_handle,
    sender_name, sender_street, sender_postal_code, sender_city, sender_country,
    listing_ref, listing_title, listing_url, listing_details,
    purchased_at, items_cost, shipping_cost, buyer_protection_cost,
    total_cost, currency, payment_method, agreement_note, lines
  ) values (
    p_purchase_id,
    'SI-E-' || v_year::text || '-' || lpad(v_number::text, 6, '0'),
    (select auth.uid()),
    public.purchase_receipt_fingerprint(p_purchase_id),
    btrim(v_seller.legal_name),
    nullif(btrim(coalesce(v_seller.display_name, '')), ''),
    btrim(v_seller.street),
    btrim(v_seller.postal_code),
    btrim(v_seller.city),
    case coalesce(v_seller.country_code, 'DE')
      when 'DE' then 'Deutschland' else v_seller.country_code end,
    nullif(btrim(coalesce(v_seller.contact_email, '')), ''),
    nullif(btrim(coalesce(v_seller.vat_id, '')), ''),
    v_purchase.platform,
    v_purchase.seller_name,
    v_purchase.sender_name,
    v_purchase.sender_street,
    v_purchase.sender_postal_code,
    v_purchase.sender_city,
    v_purchase.sender_country,
    v_purchase.external_ref,
    v_purchase.listing_title,
    v_purchase.listing_url,
    v_purchase.listing_details,
    v_purchase.purchased_at,
    v_purchase.items_cost,
    v_purchase.shipping_cost,
    v_purchase.buyer_protection_cost,
    v_purchase.total_cost,
    v_purchase.currency,
    v_purchase.payment_method,
    v_purchase.agreement_note,
    v_lines
  );

  return public.seller_purchase_receipt(p_purchase_id);
end;
$$;

comment on function public.seller_issue_purchase_receipt(bigint) is
  'Stellt den Eigenbeleg zu einem Einkauf aus (0122) — Nummer, Snapshot und Fingerabdruck in EINER Transaktion. IDEMPOTENT: existiert bereits ein Beleg am Ende der Korrekturkette, wird er unveraendert zurueckgegeben statt ein zweiter angelegt. Verweigert bei Testvorgaengen, bei fehlendem Kaufdatum, bei leerer Positionsliste und bei unvollstaendigen Geschaeftsdaten des Shops. Bewegt keinen Bestand.';

revoke all on function public.seller_issue_purchase_receipt(bigint) from public, anon;
grant execute on function public.seller_issue_purchase_receipt(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Lesen: das Dokument zum Rendern
-- ---------------------------------------------------------------------------
create or replace function public.seller_purchase_receipt_document(p_receipt_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * `issued_by` bleibt draussen: wer den Beleg ausgestellt hat, ist eine
   * Betriebsangabe und keine des Dokuments. Alles Uebrige IST das Dokument.
   */
  select to_jsonb(r) - 'issued_by' - 'content_fingerprint'
    into v
    from public.purchase_receipts r
   where r.id = p_receipt_id;

  if v is null then
    return null;
  end if;
  return v;
end;
$$;

comment on function public.seller_purchase_receipt_document(bigint) is
  'Der eingefrorene Inhalt eines Eigenbelegs, zum Rendern des PDF (0122). Liest nur und gibt NULL zurueck, wenn es den Beleg nicht gibt — der Aufrufer antwortet damit 404 statt 403.';

revoke all on function public.seller_purchase_receipt_document(bigint) from public, anon;
grant execute on function public.seller_purchase_receipt_document(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Schreiben: eine bestätigte Auslieferung
-- ---------------------------------------------------------------------------
create or replace function public.seller_record_purchase_receipt_download(
  p_receipt_id bigint,
  p_bytes      integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  select r.purchase_id into v_purchase
    from public.purchase_receipts r where r.id = p_receipt_id;
  if not found then
    raise exception 'this receipt does not exist' using errcode = 'no_data_found';
  end if;

  insert into public.purchase_receipt_downloads (receipt_id, delivered_by, byte_count)
       values (p_receipt_id, (select auth.uid()), p_bytes);

  return public.seller_purchase_receipt(v_purchase);
end;
$$;

comment on function public.seller_record_purchase_receipt_download(bigint, integer) is
  'Haelt EINEN vollstaendig abgerufenen Eigenbeleg fest (0122). Aufgerufen wird sie erst, wenn der Server den SHA-256 der vom Browser empfangenen Bytes gegen das neu gerenderte Dokument geprueft hat. Sie behauptet damit, dass die ganzen Bytes im Browser ankamen — nicht, dass das Betriebssystem die Datei behalten hat.';

revoke all on function public.seller_record_purchase_receipt_download(bigint, integer) from public, anon;
grant execute on function public.seller_record_purchase_receipt_download(bigint, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables   integer;
  v_triggers integer;
  v_funcs    integer;
  v_indexes  integer;
begin
  select count(*) into v_tables
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('purchase_receipts', 'purchase_receipt_downloads',
                        'purchase_receipt_counters');
  if v_tables <> 3 then
    raise exception '0122: expected 3 new tables, found %', v_tables;
  end if;

  select count(*) into v_triggers
    from pg_trigger
   where not tgisinternal
     and tgname in ('purchase_receipts_immutable_trg',
                    'purchase_receipt_downloads_immutable_trg');
  if v_triggers <> 2 then
    raise exception '0122: expected 2 immutability triggers, found %', v_triggers;
  end if;

  select count(*) into v_funcs
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('seller_issue_purchase_receipt', 'seller_purchase_receipt',
                     'seller_purchase_receipt_document',
                     'seller_record_purchase_receipt_download',
                     'purchase_receipt_fingerprint', 'purchase_receipt_is_immutable');
  if v_funcs <> 6 then
    raise exception '0122: expected 6 functions, found %', v_funcs;
  end if;

  select count(*) into v_indexes
    from pg_indexes
   where schemaname = 'public'
     and indexname in ('purchase_receipts_origin_uniq', 'purchase_receipts_supersedes_uniq');
  if v_indexes <> 2 then
    raise exception '0122: expected 2 partial unique indexes, found %', v_indexes;
  end if;

  /*
   * KEINE ZUSICHERUNG AUF EINE LEERE TABELLE. Sie stand hier und waere bei
   * einem zweiten Lauf fehlgeschlagen, obwohl nichts falsch ist — die
   * Migration ist mit `if not exists` wiederholbar gebaut, und eine Pruefung,
   * die das zunichtemacht, ist keine Sicherung, sondern eine Falle.
   */
end;
$$;
