-- ===========================================================================
-- 0124 — DIE ÜBERSICHT SAGT, OB EIN EIGENBELEG MÖGLICH IST UND OB ER STIMMT
--
-- Zwei Fragen, die der Betreiber heute nur beantworten kann, indem er jeden
-- Einkauf einzeln aufklappt:
--
--   1. Reichen die Daten für einen Eigenbeleg?
--   2. Gibt es einen, und passt er noch zu den aktuellen Daten?
--
-- Beide gehören in die Zeile. Diese Migration erweitert dafür
-- `seller_orderbook_ledger` um elf Felder je Zeile — bei UNVERÄNDERTER
-- Signatur, also `create or replace` ohne `drop`, ohne zweite Overload und
-- ohne neue Rechtevergabe.
--
-- ---------------------------------------------------------------------------
-- WARUM NICHT EINE ZWEITE FUNKTION
--
-- `seller_purchase_receipt(bigint)` beantwortet Frage 2 bereits — für EINEN
-- Einkauf. Die Übersicht hat achtundachtzig, und achtundachtzig RPC-Fahrten
-- für zwei Punkte in einer Zeile wären der Preis dafür, die Antwort an der
-- falschen Stelle zu holen. Der Ledger ist die Stelle, an der diese Seite
-- ihre abgeleiteten Zeilenfakten schon hält: `is_open`, `is_incomplete` und
-- die fünf Zustandszähler entstehen seit `0066` genau hier.
--
-- ---------------------------------------------------------------------------
-- WAS PROJIZIERT WIRD — UND WAS AUSDRÜCKLICH NICHT
--
-- Elf Felder, davon sechs Wahrheitswerte über das VORHANDENSEIN von Daten und
-- vier Belegmetadaten. **Kein Absendername, keine Straße, keine Postleitzahl,
-- kein Ort.** Eine Übersichtsseite, die für achtundachtzig Einkäufe Name und
-- Anschrift einer Privatperson an den Browser schickt, wäre eine deutlich
-- breitere Offenlegung als der (i)-Dialog, der einen Einkauf zeigt — und das
-- bei offenen Datenschutzfragen (`docs/LEGAL.md` Abschnitt 9,
-- `docs/SECURITY.md`). Die Übersicht braucht nur, OB etwas da ist.
--
-- `content_fingerprint` und die Beleg-ID reisen durch die CTEs und landen
-- NICHT im Ergebnis: sie dienen allein dem Vergleich.
--
-- ---------------------------------------------------------------------------
-- DAS URTEIL FÄLLT NICHT HIER
--
-- Grau, orange, grün und „unbekannt" entstehen in
-- `src/lib/orderbook/receipt-status.ts` aus diesen Fakten. Eine Farbregel in
-- SQL ist eine Farbregel ohne Test; eine reine Funktion in TypeScript lässt
-- sich über alle Kombinationen prüfen, einschließlich der Nullwerte.
--
-- ---------------------------------------------------------------------------
-- `status_known` — WARUM EIN MARKER NÖTIG IST
--
-- Gegen eine Datenbank auf `0123` liefert der Ledger diese Felder nicht. Ein
-- fehlendes `receipt_number` darf dann NICHT als „kein Beleg ausgestellt"
-- gelesen werden — die Datenbank hat die Frage nicht beantwortet, sie wurde
-- nicht gestellt. `status_known` ist immer `true` und damit das Zeichen, dass
-- diese Migration angewendet ist. Fehlt es, zeigt die Oberfläche einen
-- neutralen Unbekannt-Zustand. Ein vorhandener Beleg, der als nicht vorhanden
-- dargestellt wird, wäre die irreführendste Antwort von allen.
--
-- ---------------------------------------------------------------------------
-- WAS UNVERÄNDERT BLEIBT
--
-- Der Rumpf stammt Zeile für Zeile aus `0119`. Geändert sind genau drei
-- Zeilen: ein Komma am Ende der `is_open`-Spalte, das letzte Schlüsselpaar des
-- Seitenobjekts, und der Funktionskommentar. Filter, Suche, Summen,
-- Klassifikationszähler, Sortierung, `purchase_market_value` und jede
-- Lagerangabe sind nicht angefasst — die Nachbedingungen unten prüfen das
-- einzeln nach.
--
-- KEINE TABELLE, KEINE SPALTE, KEINE ZEILE. Diese Migration ist reines
-- Funktionsersetzen; sie schreibt keine Daten und fasst keinen ausgestellten
-- Beleg an. Das könnte sie auch nicht: `purchase_receipts` hat RLS an, keine
-- Policy, keine Tabellenrechte und einen Trigger gegen UPDATE und DELETE.
--
-- ---------------------------------------------------------------------------
-- DIE ZUSATZLAST, BENANNT
--
-- `purchase_receipt_fingerprint(id)` baut ein `jsonb` über den Einkauf und
-- aggregiert seine Positionen. Der Vergleich steht deshalb im `page`-Block,
-- nach allen Filtern, und in einem `case`, das die Funktion nur für Zeilen
-- MIT Beleg ruft. Heute gibt es auf Production keinen einzigen Beleg, die
-- Zusatzlast ist also null. Sie wächst mit der Zahl ausgestellter Belege im
-- gefilterten Zeitraum, nicht mit der Zahl der Einkäufe.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if to_regclass('public.purchase_receipts') is null then
    raise exception '0124 setzt 0122 voraus: public.purchase_receipts fehlt';
  end if;
  if to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is null then
    raise exception '0124 setzt 0122 voraus: purchase_receipt_fingerprint(bigint) fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'sender_name') then
    raise exception '0124 setzt 0121 voraus: purchases.sender_name fehlt';
  end if;

  -- Der Rumpf stammt aus `0119`. Liegt dort etwas anderes, ersetzt diese
  -- Migration eine Fassung, die niemand geprüft hat.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'seller_orderbook_ledger';
  if v_def is null then
    raise exception '0124 Abbruch: public.seller_orderbook_ledger fehlt';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_orderbook_ledger') <> 1 then
    raise exception '0124 Abbruch: seller_orderbook_ledger ist mehrfach überladen';
  end if;
  if position('coalesce(s.display_name_override, s.name,' in v_def) = 0 then
    raise exception '0124 Abbruch: seller_orderbook_ledger liegt nicht in der 0119-Fassung vor';
  end if;
  if position('status_known' in v_def) > 0 then
    raise notice '0124: der Ledger trägt die Belegfelder schon — die Ersetzung ist wirkungslos und das ist in Ordnung.';
  end if;

  raise notice '0124: Vorbedingungen erfüllt. % Einkäufe, % ausgestellte Belege.',
    (select count(*) from public.purchases),
    (select count(*) from public.purchase_receipts);
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die Schutzhuelle um den Vergleich
--
-- WARUM SIE UEBERHAUPT EXISTIERT.
--
-- `purchase_receipt_fingerprint` ist `language sql`. Jeder Pfad darin ist
-- durchgesehen und keiner wirft: `sha256` wirft nicht, `convert_to(..., 'utf8')`
-- in einer UTF-8-Datenbank wirft nicht, `jsonb_build_object` wirft nicht, die
-- Unterabfrage laeuft auf den Primaerschluessel und liefert hoechstens eine
-- Zeile, und `coalesce` faengt die fehlende Zeile ab.
--
-- WUERDE SIE ABER DOCH WERFEN, waere die Wirkung nicht „zwei Spalten
-- unbekannt", sondern „Orderbuch leer". Die Ausnahme propagiert aus dem
-- Ledger heraus, der RPC schlaegt fehl, und `fetchLedger` macht daraus
-- `return empty` — keine Zeilen, keine Summen, keine Filter. Eine
-- Fehlerwirkung, die groesser ist als das Feature, das sie einfuehrt.
--
-- Diese Huelle begrenzt sie auf die Zelle, fuer die der vierte Zustand
-- gebaut ist: aus „kaputt" wird NULL, und NULL ist im Frontend `unknown`.
--
-- ---------------------------------------------------------------------------
-- DIE BESTEHENDE FINGERABDRUCK-LOGIK WIRD NICHT ANGEFASST.
--
-- Diese Funktion RUFT `purchase_receipt_fingerprint` und ersetzt sie nicht.
-- Es gibt weiterhin genau eine Stelle, die den Hash bildet — zwei wuerden
-- auseinanderlaufen und danach entweder falsch warnen oder falsch schweigen.
--
-- ---------------------------------------------------------------------------
-- WARUM `stable`, UND WAS DAS KOSTET.
--
-- `seller_orderbook_ledger` ist `stable`; eine `volatile` Funktion darf von
-- dort nicht gerufen werden. `stable` ist hier auch richtig: die Funktion
-- liest und schreibt nichts.
--
-- Ein `exception`-Block macht aus jedem Aufruf eine Untertransaktion, also
-- einen Sicherungspunkt je Zeile. Deshalb steht im Ledger ein `case` davor,
-- das die Funktion nur fuer Zeilen MIT Beleg ruft. Ohne Beleg entsteht kein
-- Sicherungspunkt.
--
-- ---------------------------------------------------------------------------
-- `when others` FAENGT NICHT ALLES, UND DAS IST GEWOLLT.
--
-- PL/pgSQL nimmt `query_canceled` und `assert_failure` ausdruecklich aus.
-- Ein Abbruch durch den Benutzer oder ein Zeitlimit propagiert also weiter,
-- statt sich als „unbekannter Belegzustand" zu verkleiden.
--
-- ---------------------------------------------------------------------------
-- RECHTE: KEINE. FUER NIEMANDEN.
--
-- Weder `public` noch `anon` noch `authenticated` bekommen `EXECUTE`. Der
-- Ledger kann sie trotzdem rufen, weil er `security definer` ist und damit
-- als sein EIGENTUEMER laeuft — und der Eigentuemer hat auf seine eigenen
-- Funktionen implizit jedes Recht. Genau dieselbe Konstruktion traegt
-- `purchase_receipt_fingerprint` seit `0122`.
--
-- Das `revoke` nennt `authenticated` ausdruecklich mit, obwohl dort nie ein
-- `grant` stand: Supabases `ALTER DEFAULT PRIVILEGES` gibt einer NEUEN
-- Funktion sonst `EXECUTE` an `anon` und `authenticated`, und ein `revoke`
-- auf ein nicht vergebenes Recht ist folgenlos. Lieber folgenlos als
-- vergessen.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_receipt_stale(
  p_purchase_id bigint,
  p_stored      text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return p_stored is distinct from public.purchase_receipt_fingerprint(p_purchase_id);
exception
  /*
   * AUS „KAPUTT" WIRD „UNBEKANNT", NICHT „STIMMT UEBEREIN".
   *
   * NULL ist der einzige richtige Rueckgabewert hier. `true` waere eine
   * Abweichungsmeldung ohne Grundlage, `false` eine Unbedenklichkeits-
   * bescheinigung ohne Grundlage — und die zweite waere die schlimmere.
   */
  when others then
    return null;
end;
$$;

comment on function public.purchase_receipt_stale(bigint, text) is
  'Vergleicht den gespeicherten Fingerabdruck eines Eigenbelegs mit dem aktuellen Stand des Einkaufs (0124). Ruft dafuer `purchase_receipt_fingerprint` aus `0122` und ersetzt sie nicht. Gibt NULL zurueck, wenn der Vergleich scheitert — das Frontend zeigt dann den neutralen Zustand `unbekannt`, statt dass die ganze Orderbuchabfrage fehlschlaegt. Keine EXECUTE-Rechte fuer public, anon oder authenticated: erreichbar nur aus einer `security definer`-Funktion desselben Eigentuemers.';

revoke all on function public.purchase_receipt_stale(bigint, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Der Ledger, um elf Felder erweitert
--
-- `create or replace`: Signatur und Rückgabetyp bleiben, damit bleiben auch
-- die Rechte aus `0119`. Die `revoke`/`grant`-Zeilen unten wiederholen den
-- Zustand ausdrücklich, statt sich auf ihn zu verlassen — dieselbe Haltung
-- wie in `0119`.
-- ---------------------------------------------------------------------------
create or replace function public.seller_orderbook_ledger(
  p_year    integer default null,
  p_month   integer default null,
  p_search  text    default null,
  p_undated boolean default false,
  p_status  text    default 'normal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text;
  v_num    text;
  v_status text;
  v_rows   jsonb;
  v_sum    jsonb;
  v_class  jsonb;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'normal');
  if v_status not in ('normal', 'incomplete', 'open', 'test', 'any') then
    raise exception 'unknown orderbook status filter' using errcode = 'check_violation';
  end if;

  v_q := nullif(btrim(coalesce(p_search, '')), '');
  /*
   * German decimals. The owner types `67,02`; the column holds `67.02`. Only
   * the separator is translated — no rounding, no tolerance, no nearest-match.
   */
  v_num := replace(coalesce(v_q, ''), ',', '.');

  with filtered as (
    select p.*, v.known_value, v.known_items, v.total_items, v.booked_items,
           /*
            * DIE DREI ENDEN, DIE 0115/0116 UNTERSCHEIDBAR MACHEN.
            *
            * `showcase` ist physisch da und zählt voll in den Wert (D3);
            * `damaged` und `missing` zählen 0 EUR (D4) und sind damit im
            * Nennwert gar nicht mehr sichtbar — als ZAHL müssen sie es
            * bleiben, sonst sieht der Betrieb nicht, warum sein Faktor
            * gestiegen ist.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'damaged')::integer as damaged_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'missing')::integer as missing_items,
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.state = 'showcase')::integer as showcase_items,
           /*
            * OFFEN ALS ZAHL, NICHT ALS REST.
            *
            * Hier stand `total_items - booked_items - settled_items` in der
            * Projektion, und das war seit `0069` falsch: eine beschädigte
            * oder fehlende Position ist weder gebucht noch `settled`, also
            * zählte sie als offen — während `is_open` daneben sie korrekt
            * ausschloss. Zahl und Wahrheitswert widersprachen sich. Jetzt
            * fragen beide dasselbe.
            */
           (select count(*) from public.purchase_items d
             where d.purchase_id = p.id and d.movement_id is null
               and d.state in ('ordered', 'arrived'))::integer as open_items,
           /*
            * SETTLED, counted here and not in `purchase_market_value` (0070).
            *
            * That function returns a typed row, and widening it would mean
            * dropping and recreating it plus everything that reads it. This
            * is one scalar subquery over the same rows, needed by one caller.
            *
            * It is NOT added to `booked_items`. A settled portal owns no
            * movement, and `Eingebucht` means a movement exists — that is the
            * whole rule this release was written to restore.
            */
           (select count(*) from public.purchase_items s
             where s.purchase_id = p.id and s.state = 'settled')::integer as settled_items,
           case when v.known_value > 0 then round(p.total_cost / v.known_value, 4) end as factor,
           /*
            * UNVOLLSTÄNDIG, derived here and stored nowhere.
            *
            * A missing date, for every source — that is the thirteen `#REF!`
            * groups and anything the owner enters without an invoice to hand.
            * And a hand-made purchase with nothing in it: money recorded,
            * contents not, which is unfinished work rather than a parcel.
            *
            * The item rule is `manual` only. An imported group's contents are
            * the workbook's; nothing here can add to them, so listing one as
            * work outstanding would be listing something nobody can finish.
            */
           (p.purchased_at is null
            or (p.source = 'manual' and v.total_items = 0)) as is_incomplete,
           /*
            * OFFEN — an action is outstanding, not a fact. Derived too.
            *
            * A `reconciled_legacy` row is NOT outstanding: the historical
            * stock figure already contains those units, and the booking
            * function refuses that state outright. That is why a workbook
            * line the owner never ticked is absent here — and why 0067 moved
            * the five undelivered parcels to `ordered` rather than widening
            * this test to reach them.
            *
            * WHAT CHANGED IN 0068: `sky_id is not null` is gone.
            *
            * It was here because this expression mirrored
            * `seller_book_purchase_item` exactly, and that function needs a
            * catalog figure. But "can this be booked into figure inventory"
            * and "is there anything left to do with this" are two questions,
            * and a trophy and two portals in an undelivered parcel are where
            * they come apart: nobody can book them, and they are plainly not
            * dealt with either.
            *
            * Hiding them let a parcel report itself finished while three of
            * its items were still in the post — the false "nothing to do"
            * this axis exists to prevent.
            *
            * The BUTTON is a separate decision and is unchanged: `canCheckIn`
            * still requires a `sky_id`, so nothing offers an `Einbuchen` the
            * database would refuse.
            *
            * Independent of `Unvollständig`: a purchase can be fully recorded
            * and still have a parcel on the desk, and an incomplete one can
            * have nothing left to book.
            */
           exists (select 1
                     from public.purchase_items i
                    where i.purchase_id = p.id
                      and i.movement_id is null
                      and i.state in ('ordered', 'arrived')) as is_open,
           /*
            * 0124 — DER AKTUELLE BELEG, MITGEFUEHRT UND NICHT PROJIZIERT.
            *
            * Vier Werte reisen durch die CTEs, drei davon landen im Ergebnis.
            * `receipt_fingerprint` und `receipt_id` landen NICHT dort: der
            * eine ist ein Hash, den die Oberflaeche nicht braucht, der andere
            * nur die Frage „gibt es einen". Beide dienen allein dem Vergleich
            * unten im `page`-Block.
            */
           rc.id                  as receipt_id,
           rc.receipt_number      as receipt_number,
           rc.issued_at           as receipt_issued_at,
           rc.revision            as receipt_revision,
           rc.content_fingerprint as receipt_fingerprint
      from public.purchases p
      cross join lateral public.purchase_market_value(p.id) v
      /*
       * DER BELEG AM ENDE DER KORREKTURKETTE — derselbe Ausdruck, den
       * `seller_purchase_receipt` benutzt: der, den niemand ersetzt hat.
       * `left join`, weil die ueberwaeltigende Mehrheit der Einkaeufe keinen
       * Beleg hat und eine Zeile ohne Beleg eine Zeile bleiben muss.
       */
      left join lateral (
        select r.id, r.receipt_number, r.issued_at, r.revision, r.content_fingerprint
          from public.purchase_receipts r
         where r.purchase_id = p.id
           and not exists (select 1 from public.purchase_receipts s
                            where s.supersedes_id = r.id)
         order by r.revision desc
         limit 1
      ) rc on true
     where (case when coalesce(p_undated, false)
                 then p.purchased_at is null
                 else (p_year  is null or extract(year  from p.purchased_at) = p_year)
                  and (p_month is null or extract(month from p.purchased_at) = p_month)
            end)
  ),
  hits as (
    select f.*,
           (select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'position', i.position,
                     'name', coalesce(s.display_name_override, s.name,
                                      i.raw_name, i.sky_id))
                   order by i.position)
              from public.purchase_items i
              left join public.skylanders s on s.sky_id = i.sky_id
              left join public.series se on se.code = s.series_code
             where i.purchase_id = f.id
               and v_q is not null
               and (i.raw_name ilike '%' || v_q || '%'
                 or s.name     ilike '%' || v_q || '%'
                 or s.display_name_override ilike '%' || v_q || '%'
                 or i.sky_id   ilike '%' || v_q || '%'
                 or se.label   ilike '%' || v_q || '%')) as match_items
      from filtered f
  ),
  searched as (
    select h.*
      from hits h
     where v_q is null
        or h.match_items is not null
        -- Every date comparison yields NULL for an undated purchase, which is
        -- not true, so it simply does not match on date — and still matches on
        -- cost, note, source or any item inside it.
        or to_char(h.purchased_at, 'DD.MM.YYYY') ilike '%' || v_q  || '%'
        or h.purchased_at::text                  ilike '%' || v_q  || '%'
        or h.total_cost::text                    ilike '%' || v_num || '%'
        or round(h.known_value, 2)::text         ilike '%' || v_num || '%'
        or coalesce(round(h.factor, 2)::text, '') ilike '%' || v_num || '%'
        or coalesce(h.note, '')                  ilike '%' || v_q  || '%'
        or h.source                              ilike '%' || v_q  || '%'
  ),
  /*
   * The classification filter, and the LAST one applied — which is what makes
   * the counts below meaningful. They are taken from `searched`, i.e. after
   * the year, month and search filters and before this one, so `Test 1` means
   * "one test purchase in the view you are looking at" rather than "one in the
   * database".
   */
  matched as (
    select r.* from searched r
     where case v_status
             when 'normal'     then not r.is_test
             when 'incomplete' then not r.is_test and r.is_incomplete
             when 'open'       then not r.is_test and r.is_open
             when 'test'       then r.is_test
             else true
           end
  ),
  /*
   * ONE STATEMENT, because a `with` clause belongs to the statement it is
   * attached to. The page and the counts are two aggregates over two
   * different CTEs of the same query, joined because each yields exactly one
   * row — not two queries, which would be two chances to disagree about the
   * filter.
   */
  page as (
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'purchased_at', m.purchased_at, 'total_cost', m.total_cost,
      'currency', m.currency, 'source', m.source, 'note', m.note,
      /* 0115: der Tagesplatz, die Kostenaufteilung, Plattform und Verkäufer. */
      'daily_index', m.daily_index,
      'items_cost', m.items_cost, 'shipping_cost', m.shipping_cost,
      'buyer_protection_cost', m.buyer_protection_cost,
      'platform', m.platform, 'seller_name', m.seller_name,
      'payment_method', m.payment_method,
      'external_ref', m.external_ref, 'updated_at', m.updated_at,
      'item_count', m.total_items, 'booked_count', m.booked_items,
      'settled_count', m.settled_items,
      'damaged_count', m.damaged_items, 'missing_count', m.missing_items,
      'showcase_count', m.showcase_items,
      /* Gezählt, nicht gerechnet — siehe `open_items` oben. */
      'open_count', m.open_items,
      'known_value', m.known_value, 'known_items', m.known_items,
      'factor', m.factor, 'match_items', m.match_items,
      'is_test', m.is_test, 'is_incomplete', m.is_incomplete, 'is_open', m.is_open,
      /*
       * 0124 — ZWEI ZUSTAENDE FUER DIE UEBERSICHT, ALS FAKTEN STATT ALS URTEIL.
       *
       * `status_known` ist der Marker, an dem der Anwendungscode erkennt,
       * dass diese Migration angewendet ist. Ohne ihn — also gegen eine
       * Datenbank auf `0123` — darf die Oberflaeche NICHT „kein Beleg"
       * anzeigen, denn sie weiss es nicht; sie zeigt „unbekannt". Ein
       * fehlendes Feld und eine beantwortete Frage sind zwei verschiedene
       * Dinge, und ein Beleg, der als nicht vorhanden dargestellt wird, waere
       * die irreführendste Antwort von allen.
       *
       * WARUM WAHRHEITSWERTE UND KEINE TEXTE. Name und Anschrift einer
       * Privatperson gehoeren nicht in die Nutzlast einer Liste ueber
       * achtundachtzig Einkaeufe. Die Uebersicht braucht nur, OB etwas da
       * ist; WAS da steht, zeigt der (i)-Dialog fuer einen Einkauf.
       *
       * Das Urteil daraus — grau, orange, gruen — faellt NICHT hier, sondern
       * in `src/lib/orderbook/receipt-status.ts`. Eine Regel in SQL ist eine
       * Regel ohne Test.
       */
      'status_known', true,
      'has_sender_name',
        nullif(btrim(coalesce(m.sender_name, '')), '') is not null,
      'has_sender_street',
        nullif(btrim(coalesce(m.sender_street, '')), '') is not null,
      'has_sender_postal_code',
        nullif(btrim(coalesce(m.sender_postal_code, '')), '') is not null,
      'has_sender_city',
        nullif(btrim(coalesce(m.sender_city, '')), '') is not null,
      /* Herkunft: eine von vier Angaben genuegt. Nur fuer den Tooltip. */
      'has_origin',
        nullif(btrim(coalesce(m.listing_url, '')), '') is not null
        or nullif(btrim(coalesce(m.listing_title, '')), '') is not null
        or nullif(btrim(coalesce(m.external_ref, '')), '') is not null
        or nullif(btrim(coalesce(m.platform, '')), '') is not null,
      'has_agreement',
        nullif(btrim(coalesce(m.agreement_note, '')), '') is not null,
      'receipt_number', m.receipt_number,
      'receipt_issued_at', m.receipt_issued_at,
      'receipt_revision', m.receipt_revision,
      /*
       * DER VERGLEICH, HIER UND NICHT IN `filtered`.
       *
       * `purchase_receipt_fingerprint` baut ein jsonb ueber den Einkauf UND
       * aggregiert seine Positionen. In `filtered` liefe das fuer jede
       * gefilterte Zeile, auch fuer die, die Suche und Klassifikation danach
       * wegwerfen. Hier laeuft es nur fuer die Zeilen, die wirklich auf den
       * Schirm kommen — und per CASE nur fuer die mit Beleg. Ohne Beleg wird
       * die Funktion nicht gerufen.
       *
       * `is distinct from` und nicht `<>`: waere ein Fingerabdruck NULL,
       * ergaebe `<>` NULL, und NULL wuerde unten zu „unbekannt" statt zu
       * „weicht ab". Beide Werte sind per CHECK 64 Hexzeichen, der Fall ist
       * also unerreichbar — aber die Form soll nicht davon abhaengen.
       */
      'receipt_stale', case when m.receipt_id is null then null
                            else public.purchase_receipt_stale(m.id, m.receipt_fingerprint)
                       end)
      /*
        HÖCHSTER TAGESPLATZ OBEN (0116) — dieselbe Ordnung, die das
        Verkaufsbuch seit `0113` hat. `id` bleibt der letzte Ausweg: ein
        undatierter Einkauf hat keinen Platz, und zwei davon brauchen
        trotzdem eine feste Reihenfolge.
      */
      order by m.purchased_at desc nulls last,
               m.daily_index desc nulls last,
               m.id desc), '[]'::jsonb) as page_rows,
    jsonb_build_object(
      'purchase_count', count(*),
      'item_count',     coalesce(sum(m.total_items), 0),
      'total_cost',     coalesce(sum(m.total_cost), 0),
      'known_value',    coalesce(sum(m.known_value), 0),
      'known_items',    coalesce(sum(m.known_items), 0),
      /* Die drei Enden auch in der Summe: der Betrieb soll sehen, wie viele
         Positionen seinen Faktor belasten, ohne jede Zeile zu öffnen. */
      'damaged_count',  coalesce(sum(m.damaged_items), 0),
      'missing_count',  coalesce(sum(m.missing_items), 0),
      'showcase_count', coalesce(sum(m.showcase_items), 0),
      'open_count',     coalesce(sum(m.open_items), 0),
      -- SUM over SUM. Never avg(factor).
      'factor', case when coalesce(sum(m.known_value), 0) > 0
                     then round(sum(m.total_cost) / sum(m.known_value), 4) end,
      'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0)) as page_summary
  from matched m
  ),
  counts as (
    select jsonb_build_object(
             'normal',     count(*) filter (where not r.is_test),
             'incomplete', count(*) filter (where not r.is_test and r.is_incomplete),
             'open',       count(*) filter (where not r.is_test and r.is_open),
             'test',       count(*) filter (where r.is_test)) as classification
      from searched r
  )
  select page.page_rows, page.page_summary, counts.classification
    into v_rows, v_sum, v_class
    from page cross join counts;

  return jsonb_build_object('purchases', v_rows, 'summary', v_sum,
                            'classification', v_class);
end;
$$;

revoke all on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) from public, anon;
grant execute on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) to authenticated;

comment on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) is
  'The orderbook page and its summary over the same CTE (0056, extended through 0116, display name in 0119, receipt status in 0124). Item names resolve display_name_override → skylanders.name → raw_name → sky_id, and the item search matches the display name AND the historical raw name, so the operator finds what the screen shows and what the workbook called it. Reads only.';


-- ---------------------------------------------------------------------------
-- 2. Nachbedingungen
--
-- Zwei Gruppen. Die erste prüft, dass die elf Felder da sind. Die zweite
-- prüft, dass ALLES ANDERE unverändert ist — das ist bei einer Migration, die
-- 266 Zeilen kopiert und drei ändert, die wichtigere Hälfte.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def    text;
  v_code   text;
  v_key    text;
  v_role   text;
  v_vol    "char";
  v_secdef boolean;
  v_cfg    text;
  v_rows   bigint;
  v_items  bigint;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'seller_orderbook_ledger';
  if v_def is null then
    raise exception '0124 unvollständig: seller_orderbook_ledger ist verschwunden';
  end if;

  /*
   * ================================================================
   * KOMMENTARE RAUS, BEVOR IRGENDETWAS GESUCHT WIRD
   * ================================================================
   *
   * `pg_get_functiondef` liefert den Rumpf ZEICHENGETREU — samt Kommentaren.
   * Beim ersten Staging-Versuch hat `0124` genau daran abgebrochen: die
   * Prüfung „ruft der Ledger den Fingerabdruck direkt?" suchte
   * `purchase_receipt_fingerprint` im Rohtext und fand die ERKLÄRUNG, warum
   * er ihn nicht direkt ruft. Eine Zeile Prosa, als Aufruf gelesen.
   *
   * Von den 44 Suchbegriffen dieser Nachbedingung war genau dieser eine
   * kommentarabhängig. Umgestellt werden trotzdem alle, denn die Gefahr
   * läuft in beide Richtungen: ein Marker, der nur noch in einem Kommentar
   * steht, ließe die Prüfung „der Rumpf hat nichts verloren" FALSCH
   * bestehen — und das wäre das Schlimmere.
   *
   * ---- Warum das Strippen hier tragfähig ist --------------------------
   *
   * Ein naives Entfernen von Kommentaren ist unsicher, sobald ein
   * STRINGLITERAL einen Kommentarstarter enthält — zwei Minuszeichen,
   * Schrägstrich-Stern oder Stern-Schrägstrich. Dann würde das Strippen
   * echten Code mitreißen. Statt das zu hoffen, prüft der Block unten es
   * nach und bricht ab, wenn es je zutrifft. Heute enthält keines der 137
   * Literale im Rumpf einen davon.
   *
   * ---- WARUM DIESER KOMMENTAR DIE ZEICHEN NICHT AUSSCHREIBT -----------
   *
   * Weil er es einmal getan hat und `0124` daran gescheitert ist, mit
   *
   *     ERROR 42601: unterminated dollar-quoted string
   *
   * POSTGRESQL-BLOCKKOMMENTARE NESTEN. Hier stand `'` Schrägstrich Stern `'`
   * als Beispiel, und das öffnete einen zweiten Kommentar, der sein eigenes
   * Ende brauchte. Das nächste Stern-Schrägstrich schloss nur den inneren;
   * der äußere lief weiter, verschlang die Wache und den ersten
   * `regexp_replace` und endete erst mitten in deren Regex — genau an dem
   * Stern-Schrägstrich darin. Was danach kam, war ein `$re$` ohne Partner.
   *
   * Im CODE sind beide Zeichenfolgen unbedenklich: in einem Stringliteral
   * und in einem Dollar-Quote sind sie Daten, keine Kommentarzeichen. Nur in
   * der Prosa dürfen sie nicht stehen.
   *
   * In PostgreSQLs Regex trifft `.` auch Zeilenumbrüche (newline-sensitive
   * matching ist standardmäßig AUS), deshalb genügt für Blockkommentare ein
   * nicht-greediges Muster ohne weitere Flags. Für Zeilenkommentare wird das
   * Flag `n` gesetzt — siehe dort.
   *
   * Verändert wird nichts an der Funktion — nur die Kopie, in der gesucht
   * wird. `v_def` behält genau eine Aufgabe: die Existenzprüfung oben.
   */
  if exists (select 1
               from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%'
                 or lit[1] like '%/*%'
                 or lit[1] like '%*/%') then
    raise exception '0124 Abbruch: ein Stringliteral im Ledger-Rumpf enthaelt einen Kommentarstarter — das Entfernen der Kommentare waere unzuverlaessig';
  end if;

  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  /*
   * Zeilenkommentare mit dem Flag `n`: es schaltet newline-sensitive
   * matching EIN, dann trifft `.` keinen Zeilenumbruch mehr und `--.*`
   * endet am Zeilenende. Das vermeidet die Frage, ob `\n` in einer
   * Zeichenklasse zuverlaessig als Umbruch gelesen wird.
   */
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  -- Und das Strippen hat den Rumpf nicht zerlegt.
  if v_code is null
     or position('seller_orderbook_ledger' in v_code) = 0
     or position('return jsonb_build_object' in v_code) = 0 then
    raise exception '0124 Abbruch: nach dem Entfernen der Kommentare ist der Rumpf unbrauchbar';
  end if;

  -- Die elf neuen Schlüssel, jeder einzeln.
  foreach v_key in array array['status_known', 'has_sender_name', 'has_sender_street',
                               'has_sender_postal_code', 'has_sender_city',
                               'has_origin', 'has_agreement',
                               'receipt_number', 'receipt_issued_at',
                               'receipt_revision', 'receipt_stale'] loop
    if position('''' || v_key || '''' in v_code) = 0 then
      raise exception '0124 unvollständig: das Feld % fehlt im Seitenobjekt', v_key;
    end if;
  end loop;

  -- Der Vergleich laeuft ueber die Schutzhuelle, nicht direkt.
  if position('public.purchase_receipt_stale(m.id, m.receipt_fingerprint)' in v_code) = 0 then
    raise exception '0124 unvollständig: der Vergleich ruft purchase_receipt_stale nicht';
  end if;
  if position('purchase_receipt_fingerprint' in v_code) > 0 then
    raise exception '0124 Abbruch: der Ledger ruft den Fingerabdruck direkt — ein Fehler darin wuerde die ganze Abfrage scheitern lassen';
  end if;

  /*
   * DIE SCHUTZHUELLE SELBST — Eigenschaften, Eigentuemer, Rechte.
   *
   * Der Eigentuemervergleich ist kein Zierrat: eine `security definer`-Kette
   * traegt nur, solange der Rufer Eigentuemer des Gerufenen ist. Haette die
   * Huelle einen anderen Eigentuemer, braeuchte der Ledger ein ausdrueckliches
   * EXECUTE — und genau das soll es nicht geben.
   */
  if to_regprocedure('public.purchase_receipt_stale(bigint, text)') is null then
    raise exception '0124 unvollständig: purchase_receipt_stale(bigint, text) fehlt';
  end if;
  select p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',')
    into v_vol, v_secdef, v_cfg
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'purchase_receipt_stale';
  if v_vol <> 's' then
    raise exception '0124 Abbruch: purchase_receipt_stale ist nicht stable (%)', v_vol;
  end if;
  if not v_secdef then
    raise exception '0124 Abbruch: purchase_receipt_stale ist nicht security definer';
  end if;
  /*
   * EIN EXAKTER VERGLEICH WAERE HIER FALSCH — UND WAR ES.
   *
   * PostgreSQL legt den leeren `search_path` als ZITIERTES Listenelement ab:
   * `search_path=""`, nicht `search_path=`. Der Staging-Preflight hat das
   * gezeigt (Befunde 106 und 204). Genau an dieser Stelle stand ein
   * `is distinct from 'search_path='` — die Migration haette die Huelle
   * angelegt und sich danach selbst abgebrochen.
   *
   * `0112` und `0113` machen es seit langem richtig: Praefix fuer die
   * Existenz. Ergaenzt um die Pruefung, dass der Wert wirklich leer ist und
   * nicht etwa `public` — der Praefix allein wuerde das durchlassen.
   */
  if v_cfg is null or v_cfg not like 'search\_path=%' then
    raise exception '0124 Abbruch: purchase_receipt_stale hat keine search_path-Festlegung (%)',
      coalesce(v_cfg, 'NULL');
  end if;
  if nullif(btrim(substring(v_cfg from 'search_path=(.*)$'), '"'), '') is not null then
    raise exception '0124 Abbruch: purchase_receipt_stale hat keinen LEEREN search_path (%)',
      v_cfg;
  end if;
  if position('when others then' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'purchase_receipt_stale'), '')) = 0 then
    raise exception '0124 Abbruch: purchase_receipt_stale hat keinen Ausnahmezweig';
  end if;
  if position('return null' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'purchase_receipt_stale'), '')) = 0 then
    raise exception '0124 Abbruch: purchase_receipt_stale gibt im Fehlerfall nicht NULL zurueck';
  end if;
  /*
   * RECHTE: KEINE, FUER NIEMANDEN — UND `public` IST KEINE ROLLE.
   *
   * Hier stand `has_function_privilege('public', ...)` in einer Schleife ueber
   * drei Rollennamen. Das waere auf Staging mit `role "public" does not exist`
   * abgebrochen: `public` ist ein Pseudo-Empfaenger im ACL, kein Eintrag in
   * `pg_roles`.
   *
   * Noch wichtiger ist die zweite Haelfte: ein NULL-ACL heisst NICHT „keine
   * Rechte", sondern „Standardrechte" — und der Standard fuer eine Funktion
   * ist EXECUTE fuer PUBLIC. Erst das `revoke` materialisiert den ACL. Ein
   * fehlender ACL waere also genau der Zustand, den diese Pruefung verhindern
   * soll, und `has_function_privilege` allein haette ihn nicht gezeigt.
   */
  if (select p.proacl from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'purchase_receipt_stale') is null then
    raise exception '0124 Abbruch: purchase_receipt_stale hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  /*
   * EIGENTUEMER UND service_role SIND ERLAUBT, ALLES ANDERE NICHT.
   *
   * Hier stand `a.grantee <> p.proowner` allein. Das haette auf Staging
   * abgebrochen: Supabase richtet im Schema `public` Default-Privileges fuer
   * `anon`, `authenticated` und `service_role` ein, jede neu erzeugte
   * Funktion bekommt also EXECUTE fuer alle drei. Das `revoke` oben nimmt
   * zwei davon zurueck; `service_role` BLEIBT — ausdrueckliche Entscheidung,
   * dieselbe wie bei `purchase_market_value` (`0053`, `0116`) und bei
   * `purchase_receipt_fingerprint` nach `0125`. `service_role` ist der
   * serverseitige Schluessel, nie aus einem Browser erreichbar, und umgeht
   * RLS bauartbedingt — ein Entzug dort waere kosmetisch.
   *
   * `a.grantee = 0` ist PUBLIC und bleibt in jedem Fall ein Verstoss.
   * Der Rollenname wird verglichen, nicht die OID, damit die Pruefung auch
   * auf einer Datenbank ohne `service_role` laeuft (`'x'::regrole` wuerde
   * dort werfen).
   */
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'purchase_receipt_stale'
                and a.privilege_type = 'EXECUTE'
                and a.grantee <> p.proowner
                and (a.grantee = 0
                     or a.grantee::regrole::text <> 'service_role')) then
    raise exception '0124 Abbruch: auf purchase_receipt_stale liegt ein unerwartetes EXECUTE-Recht';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.purchase_receipt_stale(bigint, text)',
                              'EXECUTE') then
      raise exception '0124 Abbruch: % darf purchase_receipt_stale ausfuehren', v_role;
    end if;
  end loop;
  /* Und derselbe Eigentuemer wie Ledger und Fingerabdruck. */
  if (select count(distinct p.proowner) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('seller_orderbook_ledger', 'purchase_receipt_stale',
                           'purchase_receipt_fingerprint')) <> 1 then
    raise exception '0124 Abbruch: Ledger, Schutzhuelle und Fingerabdruck haben nicht denselben Eigentuemer';
  end if;
  -- Und er läuft nur für Zeilen mit Beleg.
  if position('case when m.receipt_id is null then null' in v_code) = 0 then
    raise exception '0124 unvollständig: der Vergleich läuft auch ohne Beleg';
  end if;

  /*
   * UND KEIN ABSENDERWERT WIRD PROJIZIERT.
   *
   * Die Spalten reisen über `p.*` durch die CTEs — das lässt sich nicht
   * vermeiden und ist harmlos, solange sie nicht als Schlüssel im
   * Seitenobjekt landen. Geprüft wird genau das: `'sender_name',` mit
   * Anführungszeichen und Komma ist die Form, in der ein Wert projiziert
   * würde. `'has_sender_name',` trifft dieses Muster nicht.
   */
  foreach v_key in array array['sender_name', 'sender_street', 'sender_postal_code',
                               'sender_city', 'sender_country', 'agreement_note',
                               'listing_details'] loop
    if position('''' || v_key || ''', m.' in v_code) > 0 then
      raise exception '0124 Abbruch: % wird als Wert in die Übersicht projiziert', v_key;
    end if;
  end loop;
  if position('''content_fingerprint''' in v_code) > 0
     or position('''receipt_fingerprint''' in v_code) > 0 then
    raise exception '0124 Abbruch: der Fingerabdruck landet im Ergebnis';
  end if;

  /*
   * ALLES ANDERE UNVERÄNDERT — die Stellen, an denen diese Seite ihre
   * Wahrheit hat. Jede davon stand vor `0124` im Rumpf und muss danach noch
   * darin stehen.
   */
  foreach v_key in array array[
    -- Filter und Suche
    'p_undated', 'extract(year  from p.purchased_at) = p_year',
    'unknown orderbook status filter', 'v_num := replace(',
    'coalesce(s.display_name_override, s.name,', 's.display_name_override ilike',
    'i.raw_name ilike',
    -- Zähler und Summen
    'as damaged_items', 'as missing_items', 'as showcase_items', 'as open_items',
    'as settled_items', 'as is_incomplete', 'as is_open',
    'round(sum(m.total_cost) / sum(m.known_value), 4)',
    'public.purchase_market_value(p.id) v',
    -- Sortierung und Klassifikation
    'order by m.purchased_at desc nulls last', 'm.daily_index desc nulls last',
    'count(*) filter (where not r.is_test)'
  ] loop
    if position(v_key in v_code) = 0 then
      raise exception '0124 Abbruch: der Rumpf hat % verloren', v_key;
    end if;
  end loop;

  -- Lesend, eine Signatur, Rechte wie vorher.
  if (select p.provolatile from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_orderbook_ledger') <> 's' then
    raise exception '0124 Abbruch: seller_orderbook_ledger ist nicht mehr stable';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_orderbook_ledger') <> 1 then
    raise exception '0124 Abbruch: seller_orderbook_ledger ist mehrfach überladen';
  end if;
  if has_function_privilege('anon',
       'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
       'EXECUTE') then
    raise exception '0124 Abbruch: anon darf den Ledger ausführen';
  end if;
  if not has_function_privilege('authenticated',
       'public.seller_orderbook_ledger(integer, integer, text, boolean, text)',
       'EXECUTE') then
    raise exception '0124 Abbruch: authenticated darf den Ledger NICHT ausführen';
  end if;

  /*
   * UND KEINE ZEILE HAT SICH BEWEGT — am wenigsten ein Beleg.
   */
  select count(*) into v_rows  from public.purchases;
  select count(*) into v_items from public.purchase_items;
  if exists (select 1 from public.purchase_items
              where state = 'booked' and movement_id is null) then
    raise exception '0124 Befund: gebuchte Position ohne Lagerbewegung';
  end if;
  raise notice '0124: fertig. % Einkäufe, % Positionen, % Belege — unverändert.',
    v_rows, v_items, (select count(*) from public.purchase_receipts);
end;
$$;
