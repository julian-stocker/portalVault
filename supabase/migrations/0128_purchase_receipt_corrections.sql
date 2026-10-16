-- ===========================================================================
-- 0128 — KORREKTURBELEGE: eine unveraenderliche Revisionskette
--
-- `0122` hat die Struktur dafuer angelegt und im Kopf vermerkt, dass sie
-- VORBEREITET, ABER NICHT GEBAUT ist. Diese Migration baut sie: eine zweite
-- Ausstellungsfunktion, die einen NEUEN Beleg anlegt, der den bisherigen
-- ersetzt — ohne ihn anzufassen.
--
-- `0122`–`0127` BLEIBEN UNVERAENDERT. Diese Datei ergaenzt zwei Spalten und
-- zwei Funktionen; sie ersetzt keine bestehende.
--
-- ---------------------------------------------------------------------------
-- WAS SCHON DA IST UND NICHT ANGEFASST WIRD
--
--   * `revision` und `supersedes_id` auf `purchase_receipts`
--   * `receipts_supersedes_fk` auf `(supersedes_id, purchase_id)` — eine
--     Korrektur gehoert zum SELBEN Einkauf, deklarativ erzwungen
--   * `receipts_revision_matches_chain`: `revision = 1` genau dann, wenn es
--     keinen Vorgaenger gibt
--   * `purchase_receipts_origin_uniq`: je Einkauf genau EIN Ursprungsbeleg
--   * `purchase_receipts_supersedes_uniq`: jeder Beleg hoechstens EINMAL
--     ersetzt — die Kette kann sich nicht gabeln
--   * `purchase_receipts_immutable_trg`: jedes UPDATE und DELETE wird
--     abgelehnt, auch mit erhoehten Rechten
--
-- ---------------------------------------------------------------------------
-- WAS DAZUKOMMT, UND WARUM GENAU SO
--
-- 1. ZWEI SPALTEN `supersedes_number` und `supersedes_issued_at`.
--
--    Der Verweis muss SICHTBAR auf dem Dokument stehen — Nummer und Datum des
--    ersetzten Belegs. Beides wird beim Ausstellen KOPIERT und nicht ueber
--    `supersedes_id` nachgeschlagen. Grund: `seller_purchase_receipt_document`
--    ist genau EINE Zeile (`to_jsonb(r)`), und daran haengen das Zeichnen, der
--    SHA-256-Abgleich beim Abruf und der Export. Der Tabellenkommentar aus
--    `0122` sagt die Regel: „was nicht kopiert wird, kann nicht gedruckt
--    werden."
--
--    `add column` ohne Default schreibt die Tabelle nicht neu und feuert
--    keinen Zeilentrigger — dasselbe Argument, mit dem `0123` die Spalte
--    `format_version` ergaenzen konnte. Die bestehende Belegzeile wird nicht
--    angefasst.
--
-- 2. `seller_issue_purchase_receipt_correction(bigint)`.
--
--    Legt einen NEUEN Beleg an mit `revision = vorige + 1`, `supersedes_id =
--    vorige.id` und einem frischen Snapshot. Sie lehnt ab, wenn sich nichts
--    geaendert hat — verglichen wird der Fingerabdruck aus `0122` gegen den
--    gespeicherten der Kettenspitze. Damit ist „kein zusaetzlicher Beleg bei
--    unveraendertem Einkauf" SERVERSEITIG erzwungen und nicht nur in der
--    Oberflaeche.
--
-- 3. `seller_purchase_receipt_history(bigint)`.
--
--    Liest die ganze Kette, damit die Oberflaeche aktuelle und ersetzte
--    Fassungen unterscheiden kann. Nur lesend.
--
-- ---------------------------------------------------------------------------
-- NEBENLAEUFIGKEIT
--
-- Wie `0122`: zuerst `select … from purchases … for update`. Zwei gleichzeitige
-- Korrekturen laufen damit hintereinander. Die zweite liest danach die NEUE
-- Kettenspitze, bildet den Fingerabdruck neu, findet ihn gleich und wird
-- abgelehnt. Keine Doppelkorrektur — und die Ablehnung sagt die Wahrheit.
-- `purchase_receipts_supersedes_uniq` ist der Riegel darunter.
--
-- Die Nummer kommt aus demselben Zaehler wie die Erstausstellung
-- (`on conflict … do update … returning` unter der Zeilensperre). Ein Abbruch
-- gibt sie zurueck; es entsteht keine Luecke. Eine Korrektur im naechsten Jahr
-- traegt die Jahreszahl ihrer AUSSTELLUNG — die Nummer benennt den
-- Ausstellungsvorgang, nicht den Einkauf.
--
-- ---------------------------------------------------------------------------
-- WAS SIE NICHT TUT
--
-- KEIN STORNO. Es gibt danach keinen Weg, einen Beleg zurueckzunehmen — nur
-- ihn durch eine korrigierte Fassung zu ersetzen. Fuer „der Ankauf hat nicht
-- stattgefunden" ist das kein Instrument; das ist eine andere Entscheidung
-- ueber ein anderes Dokument.
--
-- Kein Aendern, kein Loeschen, keine nachtraegliche Nummer. Kein Bestand
-- bewegt sich, keine Position wird angefasst, `seller_issue_purchase_receipt`
-- bleibt wie sie ist und bleibt idempotent.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_fehlt text;
begin
  -- Die drei Tabellen aus 0122.
  if (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('purchase_receipts', 'purchase_receipt_downloads',
                            'purchase_receipt_counters')) <> 3 then
    raise exception '0128 setzt 0122 voraus: die Belegtabellen fehlen';
  end if;

  -- Die Spalte aus 0123. Ein Korrekturbeleg entsteht im aktuellen Format.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchase_receipts'
                    and column_name = 'format_version') then
    raise exception '0128 setzt 0123 voraus: purchase_receipts.format_version fehlt';
  end if;

  -- Die Kettenstruktur, Stueck fuer Stueck.
  foreach v_fehlt in array array['receipts_supersedes_fk',
                                 'receipts_revision_matches_chain',
                                 'receipts_no_self_reference',
                                 'receipts_id_purchase_uniq',
                                 'receipts_number_unique',
                                 'receipts_number_shape',
                                 'receipts_revision_sane',
                                 'receipts_lines_present'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.purchase_receipts'::regclass
                      and conname = v_fehlt) then
      raise exception '0128 Abbruch: die Zusicherung % fehlt — 0122 ist nicht vollstaendig', v_fehlt;
    end if;
  end loop;

  foreach v_fehlt in array array['purchase_receipts_origin_uniq',
                                 'purchase_receipts_supersedes_uniq'] loop
    if not exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = v_fehlt) then
      raise exception '0128 Abbruch: der Teilindex % fehlt', v_fehlt;
    end if;
  end loop;

  -- Die Unveraenderlichkeit. Ohne sie waere eine Kette sinnlos.
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('purchase_receipts_immutable_trg',
                        'purchase_receipt_downloads_immutable_trg')) <> 2 then
    raise exception '0128 Abbruch: die Unveraenderlichkeits-Trigger fehlen';
  end if;

  -- Die gerufenen Funktionen, in ihren Signaturen.
  if to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is null then
    raise exception '0128 setzt 0122 voraus: purchase_receipt_fingerprint fehlt';
  end if;
  if to_regprocedure('public.seller_purchase_receipt(bigint)') is null then
    raise exception '0128 setzt 0122 voraus: seller_purchase_receipt fehlt';
  end if;
  if to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is null then
    raise exception '0128 setzt 0122 voraus: seller_issue_purchase_receipt fehlt';
  end if;

  /*
   * UND DIE ERSTAUSSTELLUNG IST IDEMPOTENT.
   *
   * Darauf ruht die ganze Aufteilung: `seller_issue_purchase_receipt` gibt
   * einen bestehenden Beleg zurueck, statt einen zweiten anzulegen; NUR die
   * Korrekturfunktion legt eine weitere Fassung an. Waere das nicht so, waere
   * „keine zweite Erstausstellung" nicht mehr wahr.
   */
  if position('return public.seller_purchase_receipt(p_purchase_id);'
       in coalesce((select p.prosrc from pg_proc p
                     where p.pronamespace = 'public'::regnamespace
                       and p.proname = 'seller_issue_purchase_receipt'), '')) = 0 then
    raise exception '0128 Abbruch: seller_issue_purchase_receipt ist nicht mehr idempotent';
  end if;

  /*
   * DIE EIGENTUEMERKETTE.
   *
   * `0125` hat `authenticated` das EXECUTE auf `purchase_receipt_fingerprint`
   * entzogen. Die neue Funktion darf sie trotzdem rufen — aber nur, weil sie
   * `security definer` ist und derselbe Eigentuemer dahintersteht. Das wird
   * geprueft und nicht angenommen; dieselbe Vorsicht wie in `0125`.
   */
  if (select count(distinct p.proowner) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('purchase_receipt_fingerprint', 'seller_purchase_receipt',
                           'seller_issue_purchase_receipt')) <> 1 then
    raise exception '0128 Abbruch: die drei Belegfunktionen haben nicht denselben Eigentuemer';
  end if;

  -- Und die neuen Spalten sind noch nicht da (oder schon — dann Leerlauf).
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'purchase_receipts'
                and column_name = 'supersedes_number') then
    raise notice '0128: supersedes_number ist schon da — Leerlauf mit Nachpruefung.';
  end if;

  raise notice '0128: Vorbedingungen erfuellt.';
end
$$;


-- ---------------------------------------------------------------------------
-- 1. Der sichtbare Verweis, eingefroren
-- ---------------------------------------------------------------------------
alter table public.purchase_receipts
  add column if not exists supersedes_number    text,
  add column if not exists supersedes_issued_at timestamptz;

comment on column public.purchase_receipts.supersedes_number is
  'Die Belegnummer des ersetzten Belegs, beim Ausstellen KOPIERT (0128). Sie steht sichtbar auf dem Korrekturdokument. Kopiert und nicht ueber supersedes_id nachgeschlagen, weil ein Belegdokument genau EINE Zeile ist — daran haengen Zeichnen, Hash-Abgleich und Export.';

comment on column public.purchase_receipts.supersedes_issued_at is
  'Das Ausstellungsdatum des ersetzten Belegs, beim Ausstellen kopiert (0128). Siehe supersedes_number.';

/*
 * DIE DREI VERWEISFELDER GEHOEREN ZUSAMMEN.
 *
 * Entweder ist dies ein Ursprungsbeleg — dann sind alle drei NULL —, oder eine
 * Korrektur, dann sind alle drei gesetzt. Ein halb gefuellter Verweis waere ein
 * Dokument, das auf etwas zeigt, das es nicht nennt.
 *
 * `not valid` kommt hier NICHT infrage: die Zusicherung soll auch fuer die
 * bestehende Zeile gelten, und sie gilt dort trivial (alle drei NULL).
 */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.purchase_receipts'::regclass
                    and conname = 'receipts_supersedes_ref_complete') then
    alter table public.purchase_receipts
      add constraint receipts_supersedes_ref_complete
      check ((supersedes_id is null) = (supersedes_number is null)
             and (supersedes_id is null) = (supersedes_issued_at is null));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.purchase_receipts'::regclass
                    and conname = 'receipts_supersedes_number_shape') then
    alter table public.purchase_receipts
      add constraint receipts_supersedes_number_shape
      check (supersedes_number is null
             or supersedes_number ~ '^SI-E-[0-9]{4}-[0-9]{6}$');
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- 2. Die Korrektur ausstellen
-- ---------------------------------------------------------------------------
create or replace function public.seller_issue_purchase_receipt_correction(
  p_purchase_id bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_seller   public.sellers%rowtype;
  v_tip      public.purchase_receipts%rowtype;
  v_lines    jsonb;
  v_now      text;
  v_number   integer;
  v_year     integer;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * SPERRE ZUERST — wie bei der Erstausstellung in `0122`.
   *
   * Zwei gleichzeitige Korrekturen laufen damit hintereinander. Die zweite
   * liest danach die NEUE Kettenspitze und wird am Fingerabdrucktor unten
   * abgelehnt, weil sich seit ihr nichts geaendert hat.
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
   * DIE SPITZE DER KETTE — der Beleg, den niemand ersetzt hat.
   */
  select r.* into v_tip
    from public.purchase_receipts r
   where r.purchase_id = p_purchase_id
     and not exists (select 1 from public.purchase_receipts s where s.supersedes_id = r.id)
   order by r.revision desc
   limit 1;
  if not found then
    raise exception 'there is no receipt to correct; issue the original first'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * ==================================================================
   * DAS TOR: NUR BEI TATSAECHLICHER ABWEICHUNG.
   *
   * Verglichen wird der Fingerabdruck der heutigen belegrelevanten Daten
   * gegen den, der in der Kettenspitze eingefroren ist. Sind sie gleich, gibt
   * es nichts zu korrigieren — und ein zweiter Beleg ueber denselben Inhalt
   * waere ein zweites Dokument ueber dieselbe Ausgabe. Das hier ist die
   * verbindliche Stelle; die Oberflaeche zeigt die Aktion nur zusaetzlich
   * nicht an.
   * ==================================================================
   */
  v_now := public.purchase_receipt_fingerprint(p_purchase_id);
  if v_tip.content_fingerprint = v_now then
    raise exception 'nothing changed since the last receipt; no correction needed'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * DIE GESCHAEFTSDATEN DIESES SHOPS — wie bei der Erstausstellung aus
   * `public.sellers`. Fehlt eine Pflichtangabe, entsteht KEIN Beleg mit
   * erfundenen Daten.
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

  /*
   * DIE POSITIONEN, FRISCH — mit derselben Anweisung wie `0122`/`0123`.
   *
   * Woertlich dieselbe, damit Ursprung und Korrektur denselben Feldern folgen.
   * Liefe sie hier anders, waere der Unterschied zwischen zwei Fassungen zum
   * Teil ein Unterschied der Abfrage und nicht des Einkaufs.
   */
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

  -- Dieselbe Nummernvergabe wie die Erstausstellung, derselbe Zaehler.
  v_year := extract(year from (now() at time zone 'Europe/Berlin'))::integer;
  insert into public.purchase_receipt_counters as c (year, next_number)
       values (v_year, 1)
  on conflict (year) do update
      set next_number = c.next_number + 1
    returning c.next_number into v_number;

  insert into public.purchase_receipts (
    purchase_id, receipt_number, issued_by, content_fingerprint, format_version,
    revision, supersedes_id, supersedes_number, supersedes_issued_at,
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
    v_now,
    /* Das aktuelle Format — wie `0123` es fuer neue Belege setzt. Der ersetzte
       Beleg behaelt das Format, in dem er gezeichnet wurde. */
    2,
    v_tip.revision + 1,
    v_tip.id,
    v_tip.receipt_number,
    v_tip.issued_at,
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

comment on function public.seller_issue_purchase_receipt_correction(bigint) is
  'Stellt einen KORREKTURBELEG zu einem Einkauf aus (0128): neue Nummer aus demselben fortlaufenden Kreis, revision = vorige + 1, supersedes_id auf die bisherige Kettenspitze und ein frischer Snapshot — in EINER Transaktion. Der ersetzte Beleg wird nicht angefasst; sein Snapshot und seine Abrufnachweise bleiben. NICHT idempotent und das mit Absicht: sie verlangt eine tatsaechliche Abweichung und lehnt sonst ab (nothing changed since the last receipt). Mehrere Korrekturen hintereinander sind moeglich, solange sich jeweils etwas geaendert hat. Verweigert ausserdem bei Testvorgaengen, fehlendem Kaufdatum, fehlendem Ursprungsbeleg, leerer Positionsliste und unvollstaendigen Geschaeftsdaten. Bewegt keinen Bestand und aendert keine Position.';

revoke all on function public.seller_issue_purchase_receipt_correction(bigint)
  from public, anon;
grant execute on function public.seller_issue_purchase_receipt_correction(bigint)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Die ganze Kette lesen
-- ---------------------------------------------------------------------------
/*
 * WARUM EINE EIGENE FUNKTION UND KEINE ERWEITERUNG VON
 * `seller_purchase_receipt`.
 *
 * Die bestehende Lesefunktion ist der Rueckgabewert von zwei Schreibfunktionen
 * aus `0122`/`0123`. Sie unangetastet zu lassen haelt den Eingriff klein. Die
 * Oberflaeche holt die Historie ohnehin nur, wenn sie sie zeigt.
 *
 * `is_current` wird NICHT aus `revision` geraten, sondern danach bestimmt, ob
 * jemand diesen Beleg ersetzt — das ist dieselbe Bedingung, mit der `0122`,
 * `0123` und `0124` die Spitze suchen.
 */
create or replace function public.seller_purchase_receipt_history(p_purchase_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_now := public.purchase_receipt_fingerprint(p_purchase_id);

  return jsonb_build_object(
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'receipt_number', r.receipt_number,
               'issued_at', r.issued_at,
               'revision', r.revision,
               'format_version', r.format_version,
               'supersedes_id', r.supersedes_id,
               'supersedes_number', r.supersedes_number,
               'supersedes_issued_at', r.supersedes_issued_at,
               'line_count', jsonb_array_length(r.lines),
               'total_cost', r.total_cost::text,
               'download_count', (select count(*) from public.purchase_receipt_downloads d
                                   where d.receipt_id = r.id),
               'first_delivered_at', (select min(d.delivered_at)
                                        from public.purchase_receipt_downloads d
                                       where d.receipt_id = r.id),
               'is_current', not exists (select 1 from public.purchase_receipts s
                                          where s.supersedes_id = r.id),
               /* Nur die Spitze kann veraltet sein; eine ersetzte Fassung ist
                  nicht „veraltet", sondern ersetzt. */
               'stale', (not exists (select 1 from public.purchase_receipts s
                                      where s.supersedes_id = r.id))
                        and r.content_fingerprint is distinct from v_now)
             order by r.revision, r.id)
        from public.purchase_receipts r
       where r.purchase_id = p_purchase_id), '[]'::jsonb),
    /* Ob eine Korrektur ueberhaupt in Frage kommt — dieselbe Bedingung wie das
       Tor in der Ausstellungsfunktion, damit die Oberflaeche nichts anbietet,
       was der Server ablehnen wuerde. */
    'correctable', exists (
      select 1 from public.purchase_receipts r
       where r.purchase_id = p_purchase_id
         and not exists (select 1 from public.purchase_receipts s
                          where s.supersedes_id = r.id)
         and r.content_fingerprint is distinct from v_now));
end;
$$;

comment on function public.seller_purchase_receipt_history(bigint) is
  'Die vollstaendige Belegkette eines Einkaufs (0128), aufsteigend nach Revision: Nummer, Datum, Formatversion, Verweis auf den ersetzten Beleg, Positionszahl, Betrag, Abrufzahl und erster bestaetigter Abruf. is_current sagt, welche Fassung niemand ersetzt hat; stale gilt nur fuer sie. correctable beantwortet dieselbe Frage wie das Tor in seller_issue_purchase_receipt_correction. Liest nur.';

revoke all on function public.seller_purchase_receipt_history(bigint) from public, anon;
grant execute on function public.seller_purchase_receipt_history(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid  oid;
  v_def  text;
  v_code text;
  v_key  text;
begin
  -- ---- die zwei Spalten und ihre Zusicherungen -----------------------
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'purchase_receipts'
         and column_name in ('supersedes_number', 'supersedes_issued_at')) <> 2 then
    raise exception '0128 unvollstaendig: die zwei Verweisspalten fehlen';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.purchase_receipts'::regclass
         and conname in ('receipts_supersedes_ref_complete',
                         'receipts_supersedes_number_shape')) <> 2 then
    raise exception '0128 unvollstaendig: die zwei Verweis-Zusicherungen fehlen';
  end if;
  /* Beide muessen GEPRUEFT sein — `not valid` waere eine Zusicherung, die fuer
     bestehende Zeilen nichts sagt. */
  if exists (select 1 from pg_constraint
              where conrelid = 'public.purchase_receipts'::regclass
                and conname in ('receipts_supersedes_ref_complete',
                                'receipts_supersedes_number_shape')
                and not convalidated) then
    raise exception '0128 Abbruch: eine Verweis-Zusicherung ist nicht validiert';
  end if;

  -- ---- kein bestehender Beleg wurde angefasst ------------------------
  /*
   * `add column` ohne Default schreibt die Tabelle nicht neu. Hier wird das
   * nachgeprueft und nicht behauptet: ein Ursprungsbeleg hat alle drei
   * Verweisfelder NULL, und seine Revision ist 1.
   */
  if exists (select 1 from public.purchase_receipts
              where supersedes_id is null
                and (supersedes_number is not null or supersedes_issued_at is not null
                     or revision <> 1)) then
    raise exception '0128 Abbruch: ein bestehender Ursprungsbeleg traegt jetzt einen Verweis';
  end if;

  -- ---- die zwei neuen Funktionen -------------------------------------
  v_oid := to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)');
  if v_oid is null then
    raise exception '0128 unvollstaendig: seller_issue_purchase_receipt_correction fehlt';
  end if;
  if to_regprocedure('public.seller_purchase_receipt_history(bigint)') is null then
    raise exception '0128 unvollstaendig: seller_purchase_receipt_history fehlt';
  end if;

  -- Genau eine Fassung je Name — zwei waeren bei einem Aufruf mehrdeutig.
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('seller_issue_purchase_receipt_correction',
                           'seller_purchase_receipt_history')) <> 2 then
    raise exception '0128 Abbruch: eine der neuen Funktionen ist mehrfach ueberladen';
  end if;

  -- Typ und Zahl der Argumente, positionsweise (nullbasierter oidvector).
  if not coalesce((select p.pronargs = 1
                          and p.proargtypes[0]::regtype = 'bigint'::regtype
                     from pg_proc p where p.oid = v_oid), false) then
    raise exception '0128 Abbruch: die Argumente sind nicht die erwarteten (%)',
      coalesce(pg_get_function_arguments(v_oid), '(keine Signatur)');
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception '0128 Abbruch: die Korrekturfunktion ist nicht security definer';
  end if;
  if (select p.provolatile from pg_proc p where p.oid = v_oid) <> 'v' then
    raise exception '0128 Abbruch: die Korrekturfunktion muss volatile sein';
  end if;
  if (select p.provolatile from pg_proc p
       where p.oid = to_regprocedure('public.seller_purchase_receipt_history(bigint)'))
     <> 's' then
    raise exception '0128 Abbruch: die Historienfunktion muss stable sein — sie liest nur';
  end if;

  -- Leerer search_path, beide. Er wird QUOTIERT abgelegt: search_path=""
  if (select count(*) from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('seller_issue_purchase_receipt_correction',
                           'seller_purchase_receipt_history')
         and c like 'search\_path=%'
         and nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '') is null) <> 2 then
    raise exception '0128 Abbruch: eine der neuen Funktionen hat keinen leeren search_path';
  end if;

  -- ---- die Rechte ----------------------------------------------------
  foreach v_key in array array['seller_issue_purchase_receipt_correction',
                               'seller_purchase_receipt_history'] loop
    if (select p.proacl from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = v_key) is null then
      raise exception '0128 Abbruch: % hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC', v_key;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.pronamespace = 'public'::regnamespace and p.proname = v_key
                  and a.privilege_type = 'EXECUTE'
                  and a.grantee = 0) then
      raise exception '0128 Abbruch: PUBLIC hat EXECUTE auf %', v_key;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.pronamespace = 'public'::regnamespace and p.proname = v_key
                  and a.privilege_type = 'EXECUTE'
                  and a.grantee <> 0
                  and a.grantee::regrole::text = 'anon') then
      raise exception '0128 Abbruch: anon darf % ausfuehren', v_key;
    end if;
    if not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                    where p.pronamespace = 'public'::regnamespace and p.proname = v_key
                      and a.privilege_type = 'EXECUTE'
                      and a.grantee <> 0
                      and a.grantee::regrole::text = 'authenticated') then
      raise exception '0128 Abbruch: authenticated kann % nicht ausfuehren', v_key;
    end if;
  end loop;

  -- ---- der Rumpf der Korrektur, kommentarfrei geprueft ---------------
  v_def := pg_get_functiondef(v_oid);
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '0128 Abbruch: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter';
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  foreach v_key in array array['can_operate_active_seller()',
                               'for update',
                               'public.purchase_receipt_fingerprint(p_purchase_id)',
                               'nothing changed since the last receipt',
                               'there is no receipt to correct',
                               'v_tip.revision + 1',
                               'v_tip.id',
                               'v_tip.receipt_number',
                               'v_tip.issued_at',
                               'purchase_receipt_counters',
                               'public.seller_purchase_receipt(p_purchase_id)'] loop
    if position(v_key in v_code) = 0 then
      raise exception '0128 Abbruch: der Rumpf der Korrektur fuehrt % nicht', v_key;
    end if;
  end loop;

  /*
   * UND DAS TOR STEHT VOR DEM SCHREIBEN.
   *
   * Waere die Nummer schon gezogen, bevor der Fingerabdruck verglichen wird,
   * verbrauchte eine abgelehnte Korrektur eine Nummer. Die Transaktion gaebe
   * sie zwar zurueck — aber die Reihenfolge soll stimmen und nicht nur das
   * Ergebnis.
   */
  if position('nothing changed since the last receipt' in v_code)
     > position('purchase_receipt_counters' in v_code) then
    raise exception '0128 Abbruch: die Nummer wird gezogen, bevor die Abweichung geprueft ist';
  end if;
  if position('can_operate_active_seller()' in v_code)
     > position('for update' in v_code) then
    raise exception '0128 Abbruch: das Betreibertor steht nicht vor der Sperre';
  end if;

  /*
   * SIE AENDERT UND LOESCHT NICHTS.
   *
   * Ein `update` oder `delete` auf `purchase_receipts` wuerde am Trigger
   * scheitern — aber es soll gar nicht dastehen. `update` auf
   * `purchase_receipt_counters` ist erlaubt und steht als `on conflict`
   * ausdruecklich da; gesucht wird deshalb nach den Tabellen, nicht nach dem
   * Wort.
   */
  foreach v_key in array array['update public.purchase_receipts',
                               'delete from public.purchase_receipts',
                               'delete from public.purchase_receipt_downloads',
                               'update public.purchase_items',
                               'delete from public.purchase_items',
                               'inventory_movements',
                               'shop_inventory',
                               'update public.purchases'] loop
    if position(v_key in v_code) > 0 then
      raise exception '0128 Abbruch: der Rumpf beruehrt % — das darf er nicht', v_key;
    end if;
  end loop;

  -- ---- und die Historie liest wirklich nur ---------------------------
  v_code := pg_get_functiondef(to_regprocedure('public.seller_purchase_receipt_history(bigint)'));
  foreach v_key in array array['insert into', 'update public.', 'delete from'] loop
    if position(v_key in v_code) > 0 then
      raise exception '0128 Abbruch: die Historienfunktion schreibt (%)', v_key;
    end if;
  end loop;

  -- ---- die bestehende Welt ist unveraendert --------------------------
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('purchase_receipts_immutable_trg',
                        'purchase_receipt_downloads_immutable_trg')) <> 2 then
    raise exception '0128 Abbruch: die Unveraenderlichkeits-Trigger sind nicht mehr vollstaendig';
  end if;
  if (select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname in ('purchase_receipts_origin_uniq',
                           'purchase_receipts_supersedes_uniq')) <> 2 then
    raise exception '0128 Abbruch: die zwei Teilindizes sind nicht mehr vollstaendig';
  end if;
  if position('return public.seller_purchase_receipt(p_purchase_id);'
       in coalesce((select p.prosrc from pg_proc p
                     where p.pronamespace = 'public'::regnamespace
                       and p.proname = 'seller_issue_purchase_receipt'), '')) = 0 then
    raise exception '0128 Abbruch: seller_issue_purchase_receipt wurde veraendert';
  end if;
  /* Und `authenticated` darf den Fingerabdruck weiterhin nicht selbst rufen (0125). */
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0
                     or a.grantee::regrole::text in ('anon', 'authenticated'))) then
    raise exception '0128 Abbruch: der interne Fingerabdruck ist wieder erreichbar — 0125 ist aufgehoben';
  end if;

  raise notice '0128 ok: Korrekturkette gebaut, bestehende Belege unberuehrt.';
end
$$;
