-- ===========================================================================
-- 0123 — DAS BELEGFORMAT WIRD VERSIONIERT
--
-- Ein Eigenbeleg wird nicht als Datei gespeichert. Er entsteht bei jedem
-- Download neu aus dem eingefrorenen Snapshot in `purchase_receipts`. Das ist
-- die richtige Entscheidung — es gibt keine Datei, die in einem Ablageeimer
-- liegen bleiben koennte, und der einzige Eimer dieses Projekts ist seit
-- `0007` oeffentlich.
--
-- Es hat aber eine Folge, die man leicht uebersieht: WER DEN RENDERER
-- AENDERT, AENDERT JEDEN BEREITS AUSGESTELLTEN BELEG MIT. Die Daten bleiben,
-- das Dokument nicht. Der Betreiber haette ein PDF abgelegt und bekaeme beim
-- erneuten Herunterladen ein anderes — bei einem Beleg, der zehn Jahre
-- aufbewahrt wird, ist das kein Schoenheitsfehler.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE MIGRATION TUT
--
-- 1. Eine Spalte `format_version` auf `purchase_receipts`, NOT NULL mit
--    Default 1. Der Default ist die Aussage ueber die BESTEHENDEN Zeilen:
--    `SI-E-2026-000001` wurde in Format 1 gezeichnet und bleibt dabei.
--
-- 2. `seller_issue_purchase_receipt` schreibt fuer NEUE Belege die 2. Das ist
--    eine andere Aussage als der Default und steht deshalb an einer anderen
--    Stelle — als Literal im INSERT.
--
-- Mehr nicht. Keine bestehende Zeile wird angefasst, keine Nummer neu
-- vergeben, kein Downloadstatus beruehrt.
--
-- ---------------------------------------------------------------------------
-- WARUM DER UNVERAENDERLICHKEITS-TRIGGER HIER NICHT IM WEG STEHT
--
-- `purchase_receipts_immutable_trg` ist ein ZEILENTRIGGER auf UPDATE und
-- DELETE. `alter table … add column … default …` ist DDL: es feuert keine
-- Zeilentrigger und schreibt seit PostgreSQL 11 nicht einmal die Tabelle neu.
-- Die bestehende Belegzeile wird also nicht angefasst — sie bekommt ein Feld,
-- das sie vorher nicht hatte, mit dem Wert, den sie immer schon bedeutete.
--
-- ---------------------------------------------------------------------------
-- DIE GRENZE, EHRLICH BENANNT
--
-- Die Zeichner besitzen ihre Beschriftungen selbst, aber nicht `PdfPage` —
-- Zeichensatz, Geometrie und Seitenumbruch teilen sie mit der Kundenrechnung.
-- Eine Aenderung dort kann ein altes Dokument sehr wohl verschieben.
-- Verhindern laesst sich das nur durch dreifaches Kopieren der Engine;
-- aufdecken laesst es sich: `receipt-format.test.ts` haelt Byte-Zahl und
-- SHA-256 des echten Belegs `SI-E-2026-000001` fest. Die Zusicherung lautet
-- nicht „kann sich nicht aendern", sondern „kann sich nicht STILL aendern".
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- Diese Migration baut auf `0122` auf. Laeuft sie gegen eine Datenbank, in
-- der `0122` fehlt, soll sie das SAGEN und nicht an einer Folgefehlermeldung
-- scheitern.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.purchase_receipts') is null then
    raise exception '0123 needs 0122: the table public.purchase_receipts does not exist';
  end if;
  if not exists (select 1 from pg_proc
                  where pronamespace = 'public'::regnamespace
                    and proname = 'seller_issue_purchase_receipt') then
    raise exception '0123 needs 0122: seller_issue_purchase_receipt does not exist';
  end if;
  if not exists (select 1 from pg_trigger
                  where not tgisinternal
                    and tgname = 'purchase_receipts_immutable_trg') then
    raise exception '0123 needs 0122: the immutability trigger is missing';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte
-- ---------------------------------------------------------------------------
alter table public.purchase_receipts
  add column if not exists format_version integer not null default 1;

alter table public.purchase_receipts drop constraint if exists receipts_format_known;
alter table public.purchase_receipts
  add constraint receipts_format_known check (format_version between 1 and 99);

comment on column public.purchase_receipts.format_version is
  'Mit welchem Zeichner dieser Beleg entstanden ist (0123). Der Download rendert ihn in GENAU diesem Format neu, damit ein bereits ausgestelltes Dokument sich nicht aendert, wenn das Format weiterentwickelt wird. 1 = die erste Fassung (Stand `SI-E-2026-000001`), 2 = die kompakte Fassung fuer grosse Ankaeufe. Der Default 1 gilt fuer die Zeilen, die es vor dieser Migration schon gab; was NEU entsteht, traegt die Nummer, die `seller_issue_purchase_receipt` schreibt.';


-- ---------------------------------------------------------------------------
-- 3. Neue Belege entstehen in Format 2
--
-- `create or replace` reicht: die Signatur bleibt `(bigint)`, nur der Rumpf
-- aendert sich. Kein drop, keine neuen Rechte, keine zweite Ueberladung.
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
    purchase_id, receipt_number, issued_by, content_fingerprint, format_version,
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
    /*
     * DAS FORMAT, IN DEM DIESER BELEG ENTSTEHT.
     *
     * Hier als Literal und nicht als Spaltendefault: der Default gilt fuer
     * BESTEHENDE Zeilen und sagt „Format 1, so wie sie gezeichnet wurden".
     * Was NEU entsteht, entsteht in Format 2. Beides sind verschiedene
     * Aussagen, und sie gehoeren an verschiedene Stellen.
     */
    2,
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
  'Stellt den Eigenbeleg zu einem Einkauf aus (0122, Formatnummer in 0123) — Nummer, Snapshot, Fingerabdruck und Formatversion in EINER Transaktion. IDEMPOTENT: existiert bereits ein Beleg am Ende der Korrekturkette, wird er unveraendert zurueckgegeben. Neue Belege entstehen in Format 2; bestehende behalten das Format, in dem sie gezeichnet wurden. Verweigert bei Testvorgaengen, fehlendem Kaufdatum, leerer Positionsliste und unvollstaendigen Geschaeftsdaten des Shops. Bewegt keinen Bestand.';


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_column integer;
  v_check  integer;
  v_old    integer;
  v_body    text;
  v_default text;
begin
  select count(*) into v_column
    from information_schema.columns
   where table_schema = 'public' and table_name = 'purchase_receipts'
     and column_name = 'format_version';
  if v_column <> 1 then
    raise exception '0123: expected the format_version column, found %', v_column;
  end if;

  select count(*) into v_check
    from pg_constraint
   where conrelid = 'public.purchase_receipts'::regclass
     and conname = 'receipts_format_known';
  if v_check <> 1 then
    raise exception '0123: expected the format check constraint, found %', v_check;
  end if;

  /*
   * JEDER BESTEHENDE BELEG HAT EINE 1 BEKOMMEN — geprueft am DEFAULT, nicht
   * an einer Zeilenzaehlung.
   *
   * Eine Zaehlung „keine Zeile ausser 1" waere beim ERSTEN Lauf richtig und
   * bei jedem spaeteren falsch: sobald ein Beleg in Format 2 ausgestellt ist,
   * schluege sie fehl, obwohl nichts verkehrt ist. Derselbe Fehler steckte in
   * einer frueheren Fassung von `0122` und ist dort schon einmal entfernt
   * worden.
   *
   * Der Spaltendefault ist die haltbare Aussage: er ist es, der die Zeilen
   * gefuellt hat, die es vor dieser Migration gab. Dass der KONKRETE Beleg
   * `SI-E-2026-000001` eine 1 traegt, prueft der Postflight.
   */
  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.purchase_receipts'::regclass
     and a.attname = 'format_version';
  if v_default is distinct from '1' then
    raise exception '0123: the format_version default should be 1, is %',
      coalesce(v_default, 'missing');
  end if;

  select count(*) into v_old
    from public.purchase_receipts where format_version not between 1 and 99;
  if v_old <> 0 then
    raise exception '0123: % receipts carry an impossible format version', v_old;
  end if;

  -- Und die Ausstellung schreibt ab jetzt die 2.
  select prosrc into v_body
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'seller_issue_purchase_receipt';
  if v_body not like '%format_version%' then
    raise exception '0123: seller_issue_purchase_receipt does not write a format version';
  end if;
end;
$$;
