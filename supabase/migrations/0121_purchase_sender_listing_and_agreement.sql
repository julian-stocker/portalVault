-- ===========================================================================
-- 0121 — ABSENDER, INSERAT UND DIE KAUFVEREINBARUNG IN WORTEN
--
-- Vorbereitung für den Eigenbeleg über einen Privatankauf. Dieser Schritt
-- legt NUR die Felder an und macht sie bearbeitbar; Belegnummern, Belege und
-- ihre Archivierung sind ausdrücklich nicht Teil davon.
--
-- ---------------------------------------------------------------------------
-- WARUM DIESE NUMMER
--
-- `0121` war für andere Arbeiten vorgemerkt, und diese Migration entstand
-- zunächst als `0122`. Die Suite hat das zurückgewiesen: `create-order
-- .test.ts`, `payment-bootstrap.test.ts` und `payment.test.ts` sichern alle
-- drei `numbers === [1 … n]` zu — die Migrationsnummern dieses Projekts sind
-- LÜCKENLOS, und eine freigelassene `0121` ist keine Reservierung, sondern
-- ein Fehler.
--
-- Die nächste zulässige Nummer war damit `0121` und keine andere. Der
-- Betreiber hat sie für diese Arbeit freigegeben; die bisher vorgemerkte
-- Arbeit rückt auf `0122`.
--
-- ---------------------------------------------------------------------------
-- 1. DREI GRUPPEN, NEUN SPALTEN, ALLE OPTIONAL
--
-- ABSENDER. Der Name auf dem Paket, und er ist NICHT `seller_name`. Der dort
-- gespeicherte Wert ist ein Marktplatz-Benutzername — eine Zuordnungshilfe,
-- keine Identität. Der echte Absender steht meist erst nach dem Wareneingang
-- fest, oft Wochen nach dem Anlegen des Einkaufs. Deshalb nullbar, deshalb
-- ohne Default, und deshalb kein Pflichtfeld irgendwo.
--
-- INSERAT. `platform` und `external_ref` (die Inserats-ID) gibt es seit
-- `0115` und sie bleiben, was sie sind. Dazu kommen Titel, URL und ein Feld
-- für alles Übrige. Diese Angaben sind REFERENZ und niemals Beleggrundlage:
-- ein Inserat über vierzig Figuren, aus dem fünf gekauft wurden, darf den
-- Beleg nicht über vierzig ausstellen. Was gekauft wurde, steht in
-- `purchase_items`, und nur dort.
--
-- VEREINBARUNG. `agreement_note` ist der Satz, der erklärt, warum der Inhalt
-- des Einkaufs vom Inserat abweicht. Es ist AUSDRÜCKLICH NICHT `note`:
-- `note` ist die interne Notiz des Betreibers, einzeilig, und sie gehört auf
-- keinen Beleg. Zwei Felder, zwei Zwecke; ein gemeinsames Feld würde interne
-- Bemerkungen auf ein Steuerdokument drucken.
--
-- ---------------------------------------------------------------------------
-- 2. PERSONENBEZOGENE DATEN EINES DRITTEN
--
-- Name und Anschrift einer Privatperson, die nie mit SkyIsles zu tun hatte.
-- Technisch erbt das den Schutz, den `purchases` seit `0053` hat: RLS an,
-- sämtliche Tabellenrechte für `public`, `anon` und `authenticated`
-- entzogen, jeder Zugriff nur über `security definer`-Funktionen hinter
-- `can_operate_active_seller()`. Diese Migration weicht davon nichts auf und
-- legt keine neue Tabelle und keine neue Rolle an.
--
-- NICHT TECHNISCH GELÖST und hier ausdrücklich vermerkt: die
-- Datenschutzerklärung dieses Produkts beschreibt Kunden und Bestellungen und
-- erwähnt Einkäufe, Lieferanten oder Ankäufe mit keinem Wort, und
-- `docs/LEGAL.md` führt die Aufbewahrungsfristen als offenen Punkt des
-- Betreibers. Beides gehört entschieden, bevor echte Absenderdaten erfasst
-- werden.
--
-- ---------------------------------------------------------------------------
-- 3. LEEREN IST EIN LEERSTRING, NICHT NULL
--
-- Die Hausregel steht seit `0053` in dieser Funktion: `NULL` heisst
-- „unverändert lassen". Ein Feld zu LEEREN kann NULL deshalb nicht
-- ausdrücken — das erledigt `nullif(btrim(p_x), '')`: wer einen Leerstring
-- schickt, bekommt NULL in die Spalte. Je Feld, ohne Nebenwirkung auf die
-- anderen. Dieselbe Mechanik, die `note`, `platform`, `seller_name`,
-- `payment_method` und `external_ref` seit `0116` benutzen; es wird hier
-- also nichts Neues erfunden, nur fortgesetzt.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Spalten
-- ---------------------------------------------------------------------------
alter table public.purchases
  add column if not exists sender_name        text,
  add column if not exists sender_street      text,
  add column if not exists sender_postal_code text,
  add column if not exists sender_city        text,
  add column if not exists sender_country     text,
  add column if not exists listing_title      text,
  add column if not exists listing_url        text,
  add column if not exists listing_details    text,
  add column if not exists agreement_note     text;

comment on column public.purchases.sender_name is
  'WER das Paket geschickt hat, wie es auf der Sendung stand (0121). NICHT `seller_name`: das ist der Marktplatz-Benutzername. Roh gespeichert (Regel 4), nie zum Zuordnen oder Gruppieren benutzt, keine Verkäufer-ID. NULL heisst unbekannt und ist der Normalfall, bis die Ware da ist.';
comment on column public.purchases.sender_street is
  'Strasse und Hausnummer des Absenders (0121). Personenbezogene Daten eines Dritten; nur über die Betreiber-Funktionen erreichbar.';
comment on column public.purchases.sender_postal_code is
  'Postleitzahl des Absenders (0121). Text und nicht numerisch: fuehrende Nullen gehoeren dazu, und nicht jedes Land schreibt Ziffern.';
comment on column public.purchases.sender_city is
  'Ort des Absenders (0121).';
comment on column public.purchases.sender_country is
  'Land des Absenders (0121), als Wort und nicht als ISO-Code. Auf einem Paketaufkleber steht „Deutschland" oder „Oesterreich"; den Betreiber einen Code nachschlagen zu lassen waere eine Huerde fuer eine Angabe, die ohnehin optional ist.';
comment on column public.purchases.listing_title is
  'Die Ueberschrift des Inserats (0121). REFERENZ, nicht Beleggrundlage: was tatsaechlich gekauft wurde, steht in `purchase_items`.';
comment on column public.purchases.listing_url is
  'Die Adresse des Inserats (0121), http oder https und sonst nichts. Inserate werden geaendert, deaktiviert und geloescht — die URL ist ein Hinweis auf eine Quelle, kein Beweis ueber ihren Inhalt.';
comment on column public.purchases.listing_details is
  'Was sonst noch am Inserat festzuhalten war (0121). Freitext.';
comment on column public.purchases.agreement_note is
  'Die Kaufvereinbarung in Worten (0121) — etwa, dass aus einem Inserat ueber vierzig Figuren fuenf gekauft und der Preis im Chat vereinbart wurde. AUSDRUECKLICH NICHT `note`: das ist die interne Notiz und gehoert auf keinen Beleg. Dieses Feld ist fuer den spaeteren Eigenbeleg vorgesehen und ersetzt die strukturierten Kaufdaten nicht.';


-- ---------------------------------------------------------------------------
-- 2. Was die Felder duerfen
--
-- Dieselbe Form wie `purchases_seller_name_shape` aus `0115`: NULL ist
-- erlaubt, ein Wert muss nach dem Trimmen mindestens ein Zeichen haben. Ein
-- Feld aus lauter Leerzeichen gibt es damit nicht — es ist entweder leer
-- (NULL) oder es steht etwas darin.
-- ---------------------------------------------------------------------------
alter table public.purchases drop constraint if exists purchases_sender_name_shape;
alter table public.purchases
  add constraint purchases_sender_name_shape
  check (sender_name is null or length(btrim(sender_name)) between 1 and 120);

alter table public.purchases drop constraint if exists purchases_sender_street_shape;
alter table public.purchases
  add constraint purchases_sender_street_shape
  check (sender_street is null or length(btrim(sender_street)) between 1 and 120);

alter table public.purchases drop constraint if exists purchases_sender_postal_shape;
alter table public.purchases
  add constraint purchases_sender_postal_shape
  check (sender_postal_code is null or length(btrim(sender_postal_code)) between 1 and 20);

alter table public.purchases drop constraint if exists purchases_sender_city_shape;
alter table public.purchases
  add constraint purchases_sender_city_shape
  check (sender_city is null or length(btrim(sender_city)) between 1 and 80);

alter table public.purchases drop constraint if exists purchases_sender_country_shape;
alter table public.purchases
  add constraint purchases_sender_country_shape
  check (sender_country is null or length(btrim(sender_country)) between 1 and 60);

alter table public.purchases drop constraint if exists purchases_listing_title_shape;
alter table public.purchases
  add constraint purchases_listing_title_shape
  check (listing_title is null or length(btrim(listing_title)) between 1 and 200);

alter table public.purchases drop constraint if exists purchases_listing_details_shape;
alter table public.purchases
  add constraint purchases_listing_details_shape
  check (listing_details is null or length(btrim(listing_details)) between 1 and 2000);

alter table public.purchases drop constraint if exists purchases_agreement_note_shape;
alter table public.purchases
  add constraint purchases_agreement_note_shape
  check (agreement_note is null or length(btrim(agreement_note)) between 1 and 4000);

/*
 * DIE URL IST EIN SCHEMA UND EINE LAENGE, SONST NICHTS.
 *
 * Geprueft wird, dass dort `http://` oder `https://` steht, danach etwas
 * folgt und kein Leerraum vorkommt. Das ist keine Pruefung, ob das Inserat
 * existiert — die kann es nicht geben, Inserate werden geloescht —, sondern
 * ein Riegel gegen alles, was KEINE Webadresse ist: `javascript:`, `data:`,
 * `file:` und was sonst noch in ein Textfeld passt und in einem `href`
 * gefaehrlich wird. Die Oberflaeche prueft dieselbe Form noch einmal, bevor
 * sie daraus einen Link macht.
 */
alter table public.purchases drop constraint if exists purchases_listing_url_shape;
alter table public.purchases
  add constraint purchases_listing_url_shape
  check (listing_url is null
         or (listing_url ~ '^https?://[^[:space:]]+$'
             and length(listing_url) between 11 and 500));


-- ---------------------------------------------------------------------------
-- 3. Die Kopfdaten-Funktion lernt neun Felder
--
-- `create or replace` kann die Parameterliste nicht aendern; eine Funktion
-- mit anderen Parametern waere eine ZWEITE Ueberladung, und PostgREST loest
-- ueber Argumentnamen auf — zwei passende Kandidaten sind dort ein Fehler,
-- kein Zufall. Also drop + create, dasselbe Vorgehen wie in `0116` und
-- `0120`. `create or replace` bleibt die Form der Neuanlage, damit
-- `latestFunction()` in `src/test-support/migrations.ts` sie findet.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean);

create or replace function public.seller_update_purchase(
  p_id           bigint,
  p_purchased_at date    default null,
  p_total_cost   numeric default null,
  p_note         text    default null,
  p_platform     text    default null,
  p_seller_name  text    default null,
  p_items_cost   numeric default null,
  p_shipping_cost numeric default null,
  p_buyer_protection_cost numeric default null,
  p_payment_method text   default null,
  p_external_ref   text   default null,
  p_clear_cost_split boolean default false,
  p_sender_name        text default null,
  p_sender_street      text default null,
  p_sender_postal_code text default null,
  p_sender_city        text default null,
  p_sender_country     text default null,
  p_listing_title      text default null,
  p_listing_url        text default null,
  p_listing_details    text default null,
  p_agreement_note     text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * EINE AUFTEILUNG GANZ ODER GAR NICHT.
   *
   * `purchases_cost_split_is_whole` verlangt `items_cost`, sobald Versand
   * oder Käuferschutz gesetzt sind. Ein Aufruf, der nur den Versand ändert
   * und `items_cost` nirgends hat, würde daran scheitern — mit einer Meldung
   * über einen CHECK statt über die Sache. Deshalb dieser Satz.
   */
  if p_items_cost is null
     and (p_shipping_cost is not null or p_buyer_protection_cost is not null)
     and not exists (select 1 from public.purchases
                      where id = p_id and items_cost is not null) then
    raise exception 'a cost split needs the price of the figures; send it along'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DIE URL, BEVOR DER CHECK SIE ABLEHNT.
   *
   * Der CHECK ist die Grenze; dieser Satz ist die Erklärung. Ein Leerstring
   * bedeutet „löschen" und ist deshalb ausdrücklich erlaubt.
   */
  if p_listing_url is not null and btrim(p_listing_url) <> ''
     and btrim(p_listing_url) !~ '^https?://[^[:space:]]+$' then
    raise exception 'a listing address has to start with http:// or https:// and contain no spaces'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.purchases p set
    purchased_at = coalesce(p_purchased_at, p.purchased_at),
    total_cost   = coalesce(p_total_cost, p.total_cost),
    note         = case when p_note is null then p.note
                        else nullif(btrim(p_note), '') end,
    /*
     * `p_clear_cost_split` räumt die Aufteilung weg und lässt `total_cost`
     * stehen — der Zustand, in dem jeder Einkauf von vor `0115` ist: bezahlt
     * wurde etwas, wie es sich aufteilt weiss niemand.
     */
    items_cost   = case when p_clear_cost_split then null
                        else coalesce(p_items_cost, p.items_cost) end,
    shipping_cost = case when p_clear_cost_split then null
                         else coalesce(p_shipping_cost, p.shipping_cost) end,
    buyer_protection_cost = case when p_clear_cost_split then null
                                 else coalesce(p_buyer_protection_cost,
                                               p.buyer_protection_cost) end,
    platform     = case when p_platform is null then p.platform
                        else nullif(btrim(p_platform), '') end,
    seller_name  = case when p_seller_name is null then p.seller_name
                        else nullif(btrim(p_seller_name), '') end,
    payment_method = case when p_payment_method is null then p.payment_method
                          else nullif(btrim(p_payment_method), '') end,
    external_ref = case when p_external_ref is null then p.external_ref
                        else nullif(btrim(p_external_ref), '') end,
    /*
     * DIE NEUN NEUEN, nach derselben Regel wie die fünf darüber: NULL lässt
     * stehen, ein Leerstring löscht, alles andere wird geschrieben. Jedes
     * Feld für sich — ein Aufruf, der nur die Postleitzahl leert, lässt
     * Name, Strasse und Ort unberührt.
     */
    sender_name        = case when p_sender_name is null then p.sender_name
                              else nullif(btrim(p_sender_name), '') end,
    sender_street      = case when p_sender_street is null then p.sender_street
                              else nullif(btrim(p_sender_street), '') end,
    sender_postal_code = case when p_sender_postal_code is null then p.sender_postal_code
                              else nullif(btrim(p_sender_postal_code), '') end,
    sender_city        = case when p_sender_city is null then p.sender_city
                              else nullif(btrim(p_sender_city), '') end,
    sender_country     = case when p_sender_country is null then p.sender_country
                              else nullif(btrim(p_sender_country), '') end,
    listing_title      = case when p_listing_title is null then p.listing_title
                              else nullif(btrim(p_listing_title), '') end,
    listing_url        = case when p_listing_url is null then p.listing_url
                              else nullif(btrim(p_listing_url), '') end,
    listing_details    = case when p_listing_details is null then p.listing_details
                              else nullif(btrim(p_listing_details), '') end,
    agreement_note     = case when p_agreement_note is null then p.agreement_note
                              else nullif(btrim(p_agreement_note), '') end,
    updated_at   = now(),
    updated_by   = (select auth.uid())
  where p.id = p_id;
end;
$$;

comment on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) is
  'Edits one purchase own fields (0053, extended in 0116 and 0121): date, total, note, platform, seller, cost split, payment method, reference — and since 0121 the parcel sender, the listing reference and the agreement note. NULL means leave alone, as everywhere in this schema; an EMPTY STRING clears that one field and touches no other. p_clear_cost_split stays the one exception, because the split is three columns that only make sense together. The listing address is checked for http/https shape here and by constraint; nothing is fetched. Touches no item and no stock.';

revoke all on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.seller_update_purchase(bigint, date, numeric, text, text, text, numeric, numeric, numeric, text, text, boolean, text, text, text, text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
--
-- Reines Lesen aus dem Katalog. Schlägt eine Zusicherung fehl, bricht die
-- Migration ab, statt halb angewendet liegen zu bleiben.
-- ---------------------------------------------------------------------------
do $$
declare
  v_columns integer;
  v_checks  integer;
  v_args    integer;
begin
  select count(*) into v_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = 'purchases'
     and column_name in ('sender_name', 'sender_street', 'sender_postal_code',
                         'sender_city', 'sender_country', 'listing_title',
                         'listing_url', 'listing_details', 'agreement_note');
  if v_columns <> 9 then
    raise exception '0121: expected 9 new columns on purchases, found %', v_columns;
  end if;

  select count(*) into v_checks
    from pg_constraint
   where conrelid = 'public.purchases'::regclass
     and contype = 'c'
     and conname in ('purchases_sender_name_shape', 'purchases_sender_street_shape',
                     'purchases_sender_postal_shape', 'purchases_sender_city_shape',
                     'purchases_sender_country_shape', 'purchases_listing_title_shape',
                     'purchases_listing_url_shape', 'purchases_listing_details_shape',
                     'purchases_agreement_note_shape');
  if v_checks <> 9 then
    raise exception '0121: expected 9 new check constraints, found %', v_checks;
  end if;

  -- Genau EINE Überladung, und sie hat 21 Parameter.
  select count(*) into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'seller_update_purchase';
  if v_args <> 1 then
    raise exception '0121: expected exactly one seller_update_purchase, found %', v_args;
  end if;

  select pronargs into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'seller_update_purchase';
  if v_args <> 21 then
    raise exception '0121: seller_update_purchase should take 21 arguments, takes %', v_args;
  end if;
end;
$$;
