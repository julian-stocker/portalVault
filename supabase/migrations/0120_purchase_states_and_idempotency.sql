-- ===========================================================================
-- 0120 — ZUSTAND BEIM ANLEGEN, PFLICHTDATUM, UND EIN ENTWURF SPEICHERT EINMAL
--
-- Drei Dinge, die zusammengehören, weil sie alle am Anlegen eines Einkaufs
-- hängen und alle in DERSELBEN Transaktion stattfinden müssen.
--
-- ---------------------------------------------------------------------------
-- 1. DER ZUSTAND REIST MIT
--
-- `seller_create_purchase_with_items` gab je Element nur `sky_id`, `raw_name`
-- und `condition` weiter. Jede Position entstand damit auf dem Spaltendefault
-- `ordered`, und der Betreiber musste nach dem Speichern auf die Detailseite
-- gehen, um zu sagen, was er tatsächlich ausgepackt hat.
--
-- Erlaubt sind beim ANLEGEN genau fünf Zustände:
--
--   ordered    Bestellt      (Standard)
--   arrived    Angekommen
--   damaged    Beschädigt
--   missing    Fehlt
--   showcase   Vitrine
--
-- Ausdrücklich NICHT erlaubt: `booked`, `reconciled_legacy`, `settled`.
--
--   `booked` bedeutet „eine Lagerbewegung existiert". Die entsteht
--   ausschliesslich in `seller_book_purchase_item`, eine Einheit auf einmal,
--   mit `for update` auf der Position. Hier einen Zustand zu schreiben, der
--   eine Bewegung behauptet, würde eine Bewegung erfinden.
--
--   `reconciled_legacy` ist die Aussage „in der historischen Lagerzahl schon
--   enthalten". Ein eben angelegter Einkauf kann das nicht sein.
--
--   `settled` gehört dem Nicht-Katalog-Pfad aus `0069`.
--
-- ANGEKOMMEN IST NICHT EINGEBUCHT. Keiner der fünf Zustände erzeugt eine
-- Lagerbewegung, und Abschnitt 5 der Funktion prüft das nach, statt es zu
-- behaupten.
--
-- ---------------------------------------------------------------------------
-- 2. DAS KAUFDATUM IST PFLICHT — HIER, UND NUR HIER
--
-- `0058` hat `purchased_at` nullable gemacht, mit gutem Grund: dreizehn
-- `#REF!`-Gruppen der Arbeitsmappe tragen kein Datum, und ein erfundenes
-- Datum wäre schlechter als keines. Diese Entscheidung bleibt.
--
-- Was sich ändert, ist eine einzige Stelle: ein REGULÄR NEU ANGELEGTER
-- Einkauf braucht sein Datum. Es gibt dort niemanden, der es nicht wüsste.
--
-- UNANGETASTET bleiben deshalb:
--
--   public.purchases.purchased_at        bleibt NULLABLE
--   seller_create_purchase(...)          der Rumpf des Imports
--   seller_import_purchase_group(...)    der Arbeitsmappen-Import
--   seller_update_purchase(...)          der Korrekturpfad
--
-- Der eine echte undatierte Einkauf im Bestand bleibt damit erhalten, bleibt
-- über `?jahr=ohne` auffindbar und bleibt korrigierbar.
--
-- Ein Plausibilitätsfenster gehört dazu, weil ein Tippfehler wie `0202-03-14`
-- formal ein gültiges Datum ist und jede Jahresauswertung zerstören würde.
-- Untergrenze `2011-01-01`: Spyro's Adventure erschien 2011, vorher gab es
-- nichts zu kaufen. Obergrenze: heute.
--
-- ---------------------------------------------------------------------------
-- 3. EIN ENTWURF SPEICHERT EINMAL
--
-- Die Transaktion schützt gegen HALBE Anlagen — eine Funktion ist eine
-- Anweisung, und jede `exception` darin nimmt den ganzen Einkauf mit. Sie
-- schützt NICHT gegen ein zweimal abgeschicktes Formular: das sind zwei
-- vollständige, je in sich konsistente Einkäufe.
--
-- `purchases.import_fingerprint` löst genau dieses Problem seit `0055` für
-- den Arbeitsmappen-Import. Dasselbe Muster, zweite Quelle:
--
--   client_token                 der Entwurf, einmal beim Öffnen erzeugt
--   client_request_fingerprint   sha256 über das, was gesendet wurde
--
-- DIE SICHERE STRATEGIE, in dieser Reihenfolge:
--
--   a) `pg_advisory_xact_lock` auf den Token. Zwei gleichzeitige Aufrufe
--      desselben Entwurfs werden damit serialisiert, statt beide „nicht
--      gefunden" zu lesen und beide einzufügen.
--
--   b) Gibt es den Token schon, wird der Fingerabdruck VERGLICHEN:
--        gleich      → die bestehende id zurück, nichts geschrieben.
--        ungleich    → ABBRUCH. Der Entwurf wurde nach dem Speichern
--                      verändert; ihn stillschweigend als „erfolgreich"
--                      zu bestätigen würde dem Betreiber einen Einkauf
--                      zusichern, den niemand angelegt hat.
--
--   c) Der partielle UNIQUE-Index ist die letzte Linie, falls a) je umgangen
--      wird.
--
-- Ohne Token verhält sich die Funktion wie bisher — die Prüfwerkzeuge und
-- jeder bestehende Aufrufer bleiben damit funktionsfähig.
--
-- ---------------------------------------------------------------------------
-- SIGNATUR
--
-- `p_client_token` kommt als dreizehnter Parameter mit Default. Ein blosses
-- `create or replace` würde eine ZWEITE Überladung stehen lassen, und
-- PostgREST löst nach Argumentnamen auf — der alte Aufruf träfe weiter die
-- alte Fassung ohne Datumsriegel. Deshalb `drop` + `create`, wie `0116` es
-- für dieselbe Falle getan hat, und die Rechte danach ausdrücklich neu
-- gesetzt (Supabases `ALTER DEFAULT PRIVILEGES` gibt einer NEUEN Funktion
-- sonst `EXECUTE` an `anon`).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_bad bigint;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'platform') then
    raise exception '0120 setzt 0115 voraus: purchases.platform fehlt';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items';
  if v_def is null then
    raise exception '0120 Abbruch: public.seller_create_purchase_with_items fehlt';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items') <> 1 then
    raise exception '0120 Abbruch: seller_create_purchase_with_items ist mehrfach überladen';
  end if;

  -- Die beiden Funktionen, die diese Migration NICHT anfassen darf, müssen da
  -- sein: der Rumpf delegiert an die erste, und die zweite ist der Importpfad,
  -- dessen Datumsfreiheit erhalten bleibt.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_create_purchase') then
    raise exception '0120 Abbruch: public.seller_create_purchase fehlt';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_import_purchase_group') then
    raise exception '0120 Abbruch: public.seller_import_purchase_group fehlt';
  end if;

  -- Der Zustandsvorrat muss die fünf kennen, die das Formular anbietet.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'purchase_items_state_known';
  if v_def is null then
    raise exception '0120 Abbruch: der CHECK purchase_items_state_known fehlt';
  end if;
  if position('showcase' in v_def) = 0 then
    raise exception '0120 setzt 0115 voraus: showcase fehlt im Zustands-CHECK (%)', v_def;
  end if;

  -- Und die neuen Spalten dürfen nicht schon belegt sein.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'purchases'
                and column_name = 'client_token') then
    raise notice '0120: purchases.client_token existiert bereits — die Spaltenanlage ist wirkungslos und das ist in Ordnung.';
  end if;

  select count(*) into v_bad from public.purchase_items
   where state = 'booked' and movement_id is null;
  if v_bad > 0 then
    raise exception '0120 Befund vor der Migration: % gebuchte Positionen ohne Lagerbewegung', v_bad;
  end if;

  raise notice '0120: Vorbedingungen erfüllt. % Einkäufe, davon % ohne Kaufdatum (bleiben erhalten).',
    (select count(*) from public.purchases),
    (select count(*) from public.purchases where purchased_at is null);
end;
$$;


-- ---------------------------------------------------------------------------
-- 1. Die zwei Spalten des Entwurfs
--
-- Beide nullable, beide ohne Default: jeder der 88 bestehenden Einkäufe hat
-- keinen Entwurf gehabt, und NULL ist dafür die wahre Antwort. `add
-- constraint … check` prüft die bestehenden Zeilen sofort — für NULL sind
-- alle drei CHECKs wahr, bevor sie geschrieben werden.
-- ---------------------------------------------------------------------------
alter table public.purchases add column if not exists client_token text;
alter table public.purchases add column if not exists client_request_fingerprint text;

alter table public.purchases drop constraint if exists purchases_client_token_format;
alter table public.purchases
  add constraint purchases_client_token_format
  check (client_token is null
         or client_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.purchases drop constraint if exists purchases_client_fingerprint_format;
alter table public.purchases
  add constraint purchases_client_fingerprint_format
  check (client_request_fingerprint is null or client_request_fingerprint ~ '^[0-9a-f]{64}$');

/*
 * BEIDES ODER KEINES.
 *
 * Ein Token ohne Fingerabdruck könnte eine Wiedergabe nicht prüfen und müsste
 * sie entweder blind bestätigen oder blind ablehnen. Ein Fingerabdruck ohne
 * Token findet nie wieder jemand. Der CHECK schliesst beide Hälften aus.
 */
alter table public.purchases drop constraint if exists purchases_client_token_has_fingerprint;
alter table public.purchases
  add constraint purchases_client_token_has_fingerprint
  check ((client_token is null) = (client_request_fingerprint is null));

create unique index if not exists purchases_client_token_uniq
  on public.purchases (client_token) where client_token is not null;

comment on column public.purchases.client_token is
  'The browser draft this purchase came from (0120), one UUID generated once when the form opens — NOT per submit. A repeated call with the same token returns this same purchase instead of creating a second one; a repeated call with DIFFERENT content under the same token is refused outright. NULL for every purchase recorded before the field existed and for every path that has no draft, such as the workbook import, which has `import_fingerprint` for the same job.';

comment on column public.purchases.client_request_fingerprint is
  'sha256 over the creation request that carried `client_token` (0120). Exists so a replay can be told apart from a changed draft: equal means "the same save, sent twice" and returns the existing id, different means the form was edited after saving and the call is refused rather than silently confirmed. Never a security boundary — the client supplies both halves — only a correctness one.';


-- ---------------------------------------------------------------------------
-- 2. Anlegen: Zustand, Pflichtdatum, Idempotenz
--
-- Rumpf aus `0116`. Was dazugekommen ist, und NUR das:
--
--   1. der Datumsriegel samt Plausibilitätsfenster
--   2. `state` je Element, gegen fünf erlaubte Werte geprüft
--   3. Token, Fingerabdruck, Sperre, Wiedergabe
--   4. zwei Nachbedingungen in derselben Transaktion
--
-- Die 200er-Obergrenze, die Delegation an `seller_add_purchase_item`, das
-- Nachtragen der Kopffelder und `purchases_cost_split_adds_up` sind Zeile für
-- Zeile unverändert.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text);

create or replace function public.seller_create_purchase_with_items(
  p_purchased_at date,
  p_total_cost   numeric,
  p_note         text    default null,
  p_is_test      boolean default false,
  p_items        jsonb   default '[]'::jsonb,
  p_platform     text    default null,
  p_seller_name  text    default null,
  p_items_cost   numeric default null,
  p_shipping_cost numeric default null,
  p_buyer_protection_cost numeric default null,
  p_payment_method text   default null,
  p_external_ref   text   default null,
  p_client_token   text   default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id       bigint;
  v_items    jsonb;
  v_element  jsonb;
  v_state    text;
  v_item_id  bigint;
  v_token    text;
  v_fp       text;
  v_prior_id bigint;
  v_prior_fp text;
  v_bad      bigint;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * DAS KAUFDATUM, ZUERST GEPRÜFT.
   *
   * Vor jeder anderen Arbeit, damit die Ablehnung nicht erst nach der
   * Validierung von zweihundert Positionen kommt. `purchased_at` bleibt in
   * der Tabelle nullable — dieser Riegel gilt dem Anlegen und niemandem
   * sonst.
   */
  if p_purchased_at is null then
    raise exception 'a purchase needs its date'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_purchased_at > current_date or p_purchased_at < date '2011-01-01' then
    raise exception 'a purchase date outside 2011-01-01 … today is a typo, not a date: %', p_purchased_at
      using errcode = 'invalid_parameter_value';
  end if;

  -- A missing list is an empty one: a purchase with no items is legitimate
  -- and becomes `Unvollständig` (0063), which is a state the owner may want
  -- on purpose when only the date and the amount are known yet.
  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'the item list must be a json array'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * A ceiling, not a business rule. The largest real parcel in the workbook
   * is 65 units; 200 is far above anything anybody enters by hand and far
   * below the point where one request becomes a problem.
   */
  if jsonb_array_length(v_items) > 200 then
    raise exception 'a purchase may be created with at most 200 items at once'
      using errcode = 'program_limit_exceeded';
  end if;

  /*
   * JEDER ZUSTAND VORAB GEPRÜFT, BEVOR EINE ZEILE ENTSTEHT.
   *
   * Der CHECK der Tabelle kennt acht Werte; beim Anlegen sind fünf davon
   * erlaubt. Ein `settled` drei Elemente weiter unten würde sonst erst beim
   * Einfügen auffallen — die Transaktion fiele korrekt zurück, aber die
   * Meldung spräche von einem Constraint statt von der Sache.
   */
  for v_element in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'every item must be a json object'
        using errcode = 'invalid_parameter_value';
    end if;
    v_state := coalesce(nullif(btrim(coalesce(v_element->>'state', '')), ''), 'ordered');
    if v_state not in ('ordered', 'arrived', 'damaged', 'missing', 'showcase') then
      raise exception '% is not a state a new purchase item may start in', v_state
        using errcode = 'check_violation';
    end if;
  end loop;

  /*
   * DER ENTWURF, falls das Formular einen genannt hat.
   *
   * Der Fingerabdruck entsteht über `jsonb`, und das ist der Grund, warum er
   * stabil ist: `jsonb` sortiert seine Schlüssel und entfernt Dubletten, die
   * Textdarstellung ist damit kanonisch. `round(…, 2)` nimmt der Summe die
   * Skalenfreiheit, sonst wären `10` und `10.00` zwei Fingerabdrücke für
   * denselben Einkauf.
   */
  v_token := lower(nullif(btrim(coalesce(p_client_token, '')), ''));
  if v_token is not null then
    if v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'a draft token must be a uuid'
        using errcode = 'invalid_parameter_value';
    end if;

    v_fp := encode(sha256(convert_to(jsonb_build_object(
      'purchased_at', p_purchased_at,
      'total_cost',   round(p_total_cost, 2),
      'note',         nullif(btrim(coalesce(p_note, '')), ''),
      'is_test',      coalesce(p_is_test, false),
      'items',        v_items,
      'platform',     nullif(btrim(coalesce(p_platform, '')), ''),
      'seller_name',  nullif(btrim(coalesce(p_seller_name, '')), ''),
      'items_cost',   p_items_cost,
      'shipping_cost', p_shipping_cost,
      'buyer_protection_cost', p_buyer_protection_cost,
      'payment_method', nullif(btrim(coalesce(p_payment_method, '')), ''),
      'external_ref',   nullif(btrim(coalesce(p_external_ref, '')), '')
    )::text, 'utf8')), 'hex');

    /*
     * SERIALISIEREN, NICHT HOFFEN.
     *
     * Zwei gleichzeitige Aufrufe desselben Entwurfs lesen ohne diese Sperre
     * beide „kein Einkauf mit diesem Token" und fügen beide ein; der UNIQUE
     * Index weist dann einen ab, aber mit einem Constraintnamen statt mit
     * einer Erklärung. Die Sperre gilt bis zum Ende der Transaktion und
     * braucht kein Aufräumen.
     */
    perform pg_advisory_xact_lock(hashtext('seller_create_purchase_with_items'),
                                  hashtext(v_token));

    select p.id, p.client_request_fingerprint into v_prior_id, v_prior_fp
      from public.purchases p where p.client_token = v_token;
    if v_prior_id is not null then
      if v_prior_fp is distinct from v_fp then
        raise exception 'this draft was already saved as purchase % with different content', v_prior_id
          using errcode = 'unique_violation';
      end if;
      -- Wortgleiche Wiederholung: dieselbe Antwort, kein zweiter Einkauf.
      return v_prior_id;
    end if;
  end if;

  v_id := public.seller_create_purchase(p_purchased_at, p_total_cost, p_note, p_is_test);

  /*
   * DIE NEUEN FELDER IN EINEM ZWEITEN SCHRITT, UND DAS IST ABSICHT.
   *
   * `seller_create_purchase()` bedient auch den Arbeitsmappen-Import und
   * bleibt deshalb unverändert — eine zweite geänderte Signatur für
   * Felder, die kein Importeur kennt, wäre Aufwand ohne Nutzen. Dieselbe
   * Transaktion, also entsteht kein Zwischenzustand, den jemand sehen könnte.
   *
   * `purchases_cost_split_adds_up` prüft hier: ergibt die Aufteilung nicht
   * `total_cost`, bricht der ganze Einkauf ab, statt halb erfasst zu werden.
   */
  update public.purchases
     set platform              = nullif(btrim(coalesce(p_platform, '')), ''),
         seller_name           = nullif(btrim(coalesce(p_seller_name, '')), ''),
         items_cost            = p_items_cost,
         shipping_cost         = p_shipping_cost,
         buyer_protection_cost = p_buyer_protection_cost,
         payment_method        = nullif(btrim(coalesce(p_payment_method, '')), ''),
         external_ref          = coalesce(nullif(btrim(coalesce(p_external_ref, '')), ''),
                                          external_ref),
         client_token               = v_token,
         client_request_fingerprint = case when v_token is null then null else v_fp end
   where id = v_id;

  for v_element in select * from jsonb_array_elements(v_items) loop
    /*
     * Delegated on purpose. `seller_add_purchase_item` assigns the position,
     * rejects an element that is neither a catalog figure nor a name, and
     * lets the foreign key reject a sky_id that is not in the catalog. All of
     * that happens inside this transaction, so a bad element three rows down
     * takes the purchase with it.
     */
    v_item_id := public.seller_add_purchase_item(
      v_id,
      nullif(btrim(coalesce(v_element->>'sky_id', '')), ''),
      nullif(btrim(coalesce(v_element->>'raw_name', '')), ''),
      coalesce(nullif(btrim(coalesce(v_element->>'condition', '')), ''), 'loose')
    );

    /*
     * DER ZUSTAND DANACH, UND NUR WENN ER ABWEICHT.
     *
     * `seller_add_purchase_item` behält seine Signatur: sie wird vom
     * Detailbildschirm gerufen, und ein sechster Parameter dort wäre eine
     * zweite Überladung für einen Wert, den dieser Aufrufer nicht kennt.
     * Eine Zuweisung in derselben Transaktion ist dasselbe Ergebnis mit
     * einer Signatur weniger.
     */
    v_state := coalesce(nullif(btrim(coalesce(v_element->>'state', '')), ''), 'ordered');
    if v_state <> 'ordered' then
      update public.purchase_items set state = v_state, updated_at = now()
       where id = v_item_id;
    end if;
  end loop;

  /*
   * ZWEI NACHBEDINGUNGEN, IN DERSELBEN TRANSAKTION.
   *
   * Beide sind heute unerreichbar — die fünf erlaubten Zustände buchen
   * nichts, und der Vorrat ist oben geprüft. Sie stehen da, damit ein
   * späteres Erweitern der Liste um `booked` nicht stillschweigend eine
   * Teilbuchung erzeugt: entweder jede als gebucht markierte Position hat
   * ihre Bewegung, oder dieser Einkauf existiert nicht.
   */
  select count(*) into v_bad from public.purchase_items
   where purchase_id = v_id and movement_id is not null;
  if v_bad > 0 then
    raise exception 'creating a purchase must not move stock, but % items own a movement', v_bad
      using errcode = 'check_violation';
  end if;

  select count(*) into v_bad from public.purchase_items
   where purchase_id = v_id
     and state not in ('ordered', 'arrived', 'damaged', 'missing', 'showcase');
  if v_bad > 0 then
    raise exception 'a new purchase left % items in a state it may not create', v_bad
      using errcode = 'check_violation';
  end if;

  return v_id;
end;
$$;

comment on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text) is
  'Creates one purchase with its platform, seller, cost breakdown and items in ONE transaction (0064, fields added in 0116, item state + mandatory date + draft idempotency in 0120). The date is REQUIRED here and nowhere else: `purchases.purchased_at` stays nullable, and the import and correction paths keep their freedom to omit it. Each item may start in ordered, arrived, damaged, missing or showcase — never booked, reconciled_legacy or settled, because none of those five moves stock and `booked` means a movement exists. Passing `p_client_token` makes the call idempotent per browser draft: the same content returns the same purchase, different content under the same token is refused rather than silently confirmed. Creating items moves no stock — that is `seller_book_purchase_item`, one unit at a time.';

revoke all on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_def       text;
  v_args      text;
  v_conname   text;
  v_oid       oid;
  v_overloads integer;
  v_tokened   bigint;
  v_unbooked  bigint;
  v_notnull   boolean;
begin
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items';
  if v_overloads <> 1 then
    raise exception '0120 Abbruch: seller_create_purchase_with_items existiert % mal, erwartet genau einmal', v_overloads;
  end if;

  select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items';

  if position('a purchase needs its date' in v_def) = 0 then
    raise exception '0120 unvollständig: der Datumsriegel fehlt';
  end if;
  if position('a purchase date outside' in v_def) = 0 then
    raise exception '0120 unvollständig: das Plausibilitätsfenster fehlt';
  end if;
  if position('p_client_token' in v_def) = 0 then
    raise exception '0120 unvollständig: der Entwurfstoken fehlt';
  end if;
  if position('pg_advisory_xact_lock' in v_def) = 0 then
    raise exception '0120 unvollständig: die Sperre auf den Token fehlt';
  end if;
  if position('with different content' in v_def) = 0 then
    raise exception '0120 unvollständig: der Fingerabdruckvergleich fehlt';
  end if;
  if position('must not move stock' in v_def) = 0 then
    raise exception '0120 unvollständig: die Nachbedingung gegen Lagerbewegungen fehlt';
  end if;
  if position('is not a state a new purchase item may start in' in v_def) = 0 then
    raise exception '0120 unvollständig: die Zustandsprüfung fehlt';
  end if;

  -- Berechtigungen: anon darf nicht, authenticated muss.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception '0120 Abbruch: anon darf seller_create_purchase_with_items ausführen';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception '0120 Abbruch: authenticated darf seller_create_purchase_with_items NICHT ausführen';
  end if;

  /*
   * DIE PFADE, DIE UNANGETASTET BLEIBEN MUSSTEN.
   *
   * `seller_create_purchase` ist der Rumpf, an den delegiert wird, und
   * gleichzeitig der Weg des Arbeitsmappen-Imports. Hätte diese Migration ihn
   * mitgeändert, wären die dreizehn undatierten Gruppen nicht mehr
   * importierbar.
   */
  select pg_get_function_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_purchase';
  if v_args is null then
    raise exception '0120 Abbruch: seller_create_purchase ist verschwunden';
  end if;
  if position('p_purchased_at date' in v_args) = 0 then
    raise exception '0120 Abbruch: seller_create_purchase hat sich verändert (%)', v_args;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_import_purchase_group') then
    raise exception '0120 Abbruch: seller_import_purchase_group ist verschwunden';
  end if;

  /*
   * UND DIE SPALTE BLEIBT NULLABLE.
   *
   * Ausdrücklich geprüft und nicht angenommen: ein `not null` hier hätte den
   * einen echten undatierten Einkauf unrettbar gemacht.
   */
  select a.attnotnull into v_notnull
    from pg_attribute a
   where a.attrelid = 'public.purchases'::regclass and a.attname = 'purchased_at';
  if v_notnull is null then
    raise exception '0120 Abbruch: purchases.purchased_at nicht gefunden';
  end if;
  if v_notnull then
    raise exception '0120 Abbruch: purchases.purchased_at ist NOT NULL geworden — der Bestand wäre verloren';
  end if;

  -- Die neuen Spalten, ihre drei CHECKs und der Index.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'client_token' and data_type = 'text') then
    raise exception '0120 unvollständig: purchases.client_token fehlt oder ist nicht text';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'client_request_fingerprint' and data_type = 'text') then
    raise exception '0120 unvollständig: purchases.client_request_fingerprint fehlt oder ist nicht text';
  end if;
  foreach v_conname in array array['purchases_client_token_format',
                                   'purchases_client_fingerprint_format',
                                   'purchases_client_token_has_fingerprint'] loop
    if not exists (select 1 from pg_constraint
                    where conname = v_conname
                      and conrelid = 'public.purchases'::regclass) then
      raise exception '0120 unvollständig: der CHECK % fehlt', v_conname;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'purchases_client_token_uniq') then
    raise exception '0120 unvollständig: der UNIQUE-Index auf client_token fehlt';
  end if;

  /*
   * UND KEINE ZEILE HAT SICH BEWEGT.
   *
   * Diese Migration legt Spalten an und ersetzt eine Funktion. Sie schreibt
   * keine Daten: jeder bestehende Einkauf behält sein Datum, seinen Zustand
   * und seine Positionen, und keiner bekommt einen Token.
   */
  select count(*) into v_tokened from public.purchases where client_token is not null;
  if v_tokened > 0 then
    raise exception '0120 Abbruch: % bestehende Einkäufe tragen plötzlich einen Entwurfstoken', v_tokened;
  end if;
  select count(*) into v_unbooked from public.purchase_items
   where state = 'booked' and movement_id is null;
  if v_unbooked > 0 then
    raise exception '0120 Befund: % gebuchte Positionen ohne Lagerbewegung', v_unbooked;
  end if;

  raise notice '0120: fertig. % Einkäufe, davon % ohne Kaufdatum — unverändert erhalten. Neue Einkäufe brauchen ein Datum.',
    (select count(*) from public.purchases),
    (select count(*) from public.purchases where purchased_at is null);
end;
$$;
