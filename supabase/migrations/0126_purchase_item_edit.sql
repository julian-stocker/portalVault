-- ===========================================================================
-- 0126 — Figuren eines Einkaufs hinzufuegen und entfernen, in EINEM Speichern
--
-- Zwei Dinge, die zusammengehoeren:
--
--   1. Ein Trigger, der `purchases.updated_at` bewegt, wenn sich eine
--      POSITION aendert. Vorher tat das keine einzige Positionsoperation —
--      damit war `updated_at` als Versionsstempel fuer den Dialog unbrauchbar.
--   2. `seller_save_purchase_edit`: Einkaufsfelder UND Positionsunterschied
--      in einer Transaktion, mit Nebenlaeufigkeitspruefung.
--
-- ---------------------------------------------------------------------------
-- WARUM DER TRIGGER NOETIG IST
--
-- Nachgesehen: `seller_add_purchase_item`, `seller_remove_purchase_item`,
-- `seller_set_purchase_item_sky` und `seller_book_purchase_item` fassen
-- `purchases.updated_at` NICHT an. `purchase_items.updated_at` hat einen
-- Default, aber keinen Trigger, bewegt sich also bei einem UPDATE auch nicht.
--
-- Ein Dialog, der `updated_at` liest und beim Speichern zurueckgibt, haette
-- damit eine Version geprueft, die von Positionsaenderungen nichts weiss:
-- zwei Betreiber haetten gleichzeitig Figuren entfernen koennen, und keiner
-- haette einen Konflikt gesehen.
--
-- Der Trigger macht `updated_at` zur Version des GANZEN Aggregats — Einkauf
-- plus seine Positionen —, und zwar unabhaengig davon, welcher Weg die
-- Position aendert, auch fuer kuenftige. Das ist der Grund, es als Trigger zu
-- bauen und nicht in der neuen Funktion zu erledigen.
--
-- WAS DER TRIGGER NICHT BEEINFLUSSEN KANN: den Fingerabdruck eines
-- Eigenbelegs. `0122` nimmt `updated_at` ausdruecklich NICHT in den Hash —
-- der Kommentar dort nennt genau diesen Grund. Ein Einbuchen bewegt ab jetzt
-- `updated_at`, aber kein Beleg wird dadurch veraltet.
--
-- WAS SICH DADURCH AENDERT: ein Einbuchen, ein Umhaengen oder ein
-- Zustandswechsel bewegt die Version. Ein Dialog, der vorher geoeffnet wurde,
-- wird beim Speichern mit `PT409` abgelehnt. Das ist richtig — die Daten, die
-- er bearbeitet hat, haben sich bewegt.
--
-- ---------------------------------------------------------------------------
-- WAS DIE NEUE FUNKTION NICHT TUT: REGELN NEU SCHREIBEN
--
-- Sie ruft `seller_update_purchase`, `seller_remove_purchase_item` und
-- `seller_add_purchase_item` — alle drei unveraendert, alle drei mit ihren
-- eigenen Pruefungen. Kein Lagerschutz wird abgeschwaecht, kein
-- Arbeitsmappen-Schutz umgangen, und die 21 Feldregeln aus `0121` stehen
-- weiter an EINER Stelle. Erlaubt ist das, weil alle vier Funktionen
-- demselben Eigentuemer gehoeren: ein `security definer`-Aufruf braucht dann
-- kein EXECUTE.
--
-- Die Reihenfolge ist Absicht: Sperre, Version, Felder, ENTFERNEN, dann
-- HINZUFUEGEN. Entfernen zuerst, damit `max(position) + 1` nicht auf eine
-- Zeile zaehlt, die im selben Speichern verschwindet.
--
-- ---------------------------------------------------------------------------
-- WAS SIE AN KOSTEN TUT: NICHTS
--
-- `purchase_items` hat keine Kostenspalte; `items_cost`, `shipping_cost`,
-- `buyer_protection_cost` und `total_cost` stehen auf `purchases` und bleiben
-- unberuehrt, solange `p_fields` sie nicht nennt. Eine Figur mehr oder
-- weniger verteilt dieselbe Summe anders — sie veraendert sie nicht.
-- Positionszahl, Marktwert und Faktor sind abgeleitet
-- (`purchase_market_value`), es gibt keinen Zaehler zu pflegen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
       || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
       || ' text, text, text, text, text, text, text, text)') is null then
    raise exception '0126 setzt 0121 voraus: seller_update_purchase fehlt oder hat eine andere Signatur';
  end if;
  if to_regprocedure('public.seller_add_purchase_item(bigint, text, text, text)') is null then
    raise exception '0126 setzt 0053 voraus: seller_add_purchase_item fehlt';
  end if;
  if to_regprocedure('public.seller_remove_purchase_item(bigint)') is null then
    raise exception '0126 setzt 0053/0064 voraus: seller_remove_purchase_item fehlt';
  end if;
  if to_regclass('public.purchase_items') is null then
    raise exception '0126 setzt 0053 voraus: purchase_items fehlt';
  end if;
  raise notice '0126: Vorbedingungen erfuellt.';
end
$$;


-- ---------------------------------------------------------------------------
-- 1. Der Trigger: eine Positionsaenderung ist eine Aenderung des Einkaufs
-- ---------------------------------------------------------------------------
create or replace function public.purchase_items_touch_purchase()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  /*
   * `coalesce(new.purchase_id, old.purchase_id)` deckt alle drei Faelle ab:
   * INSERT hat kein `old`, DELETE kein `new`, UPDATE beides. Ein UPDATE, das
   * die Position in einen anderen Einkauf umhaengt, gibt es nicht — und gaebe
   * es ihn, muesste er BEIDE bewegen; dann waere das hier zu erweitern.
   */
  update public.purchases
     set updated_at = now()
   where id = coalesce(new.purchase_id, old.purchase_id);
  return null;   -- AFTER-Trigger: der Rueckgabewert wird verworfen
end;
$$;

comment on function public.purchase_items_touch_purchase() is
  'Bewegt purchases.updated_at, wenn sich eine Position aendert (0126). Macht updated_at zur Version des ganzen Aggregats — Einkauf plus Positionen —, damit der Bearbeitungsdialog eine Nebenlaeufigkeit erkennen kann. Vorher fasste keine Positionsoperation den Zeitstempel an. Beruehrt den Beleg-Fingerabdruck nicht: 0122 nimmt updated_at ausdruecklich nicht in den Hash.';

revoke all on function public.purchase_items_touch_purchase()
  from public, anon, authenticated;

drop trigger if exists purchase_items_touch_purchase_trg on public.purchase_items;
create trigger purchase_items_touch_purchase_trg
  after insert or update or delete on public.purchase_items
  for each row execute function public.purchase_items_touch_purchase();


-- ---------------------------------------------------------------------------
-- 2. Ein Speichern, eine Transaktion
-- ---------------------------------------------------------------------------
create or replace function public.seller_save_purchase_edit(
  p_id                  bigint,
  p_fields              jsonb       default '{}'::jsonb,
  p_add                 jsonb       default '[]'::jsonb,
  p_remove              bigint[]    default '{}'::bigint[],
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actual  timestamptz;
  v_item    jsonb;
  v_rid     bigint;
  v_new_ids bigint[] := '{}';
  v_removed integer  := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * SPERRE UND VERSION, BEVOR IRGENDETWAS GESCHRIEBEN WIRD.
   *
   * `for update` haelt die Einkaufszeile fuer die Dauer der Transaktion. Ein
   * zweiter Betreiber, der gleichzeitig speichert, wartet hier und sieht
   * danach eine bewegte Version — nicht eine halb angewandte Aenderung.
   */
  select p.updated_at into v_actual
    from public.purchases p where p.id = p_id for update;
  if not found then
    raise exception 'no such purchase' using errcode = 'no_data_found';
  end if;

  if p_expected_updated_at is not null
     and v_actual is distinct from p_expected_updated_at then
    /*
     * `PT409`, nicht `serialization_failure` — dieselbe Entscheidung wie in
     * `orderbook_guard_stale` (0062): 40001 heisst „versuch es nochmal", und
     * das Gateway tut das, bis es in einen Timeout laeuft. Eine veraltete
     * Bearbeitung ist aber nicht fluechtig. PostgREST liest die Klasse `PT`
     * als HTTP-Status, das wird ein saubererer 409.
     */
    raise exception 'this purchase changed while you were editing it'
      using errcode = 'PT409';
  end if;

  -- ---- Felder: eine Stelle, 21 Regeln, unveraendert aus 0121 ------------
  /*
   * Jeder Schluessel, der in `p_fields` FEHLT, kommt als NULL an — und NULL
   * heisst dort „nicht anfassen". Genau diese Semantik hat
   * `seller_update_purchase` schon; sie wird hier nicht nachgebaut, sondern
   * benutzt. Einzige Ausnahme: `clear_cost_split` ist ein Schalter und
   * braucht `false` statt NULL.
   */
  if p_fields is not null and p_fields <> '{}'::jsonb then
    perform public.seller_update_purchase(
      p_id,
      (p_fields ->> 'purchased_at')::date,
      (p_fields ->> 'total_cost')::numeric,
       p_fields ->> 'note',
       p_fields ->> 'platform',
       p_fields ->> 'seller_name',
      (p_fields ->> 'items_cost')::numeric,
      (p_fields ->> 'shipping_cost')::numeric,
      (p_fields ->> 'buyer_protection_cost')::numeric,
       p_fields ->> 'payment_method',
       p_fields ->> 'external_ref',
      coalesce((p_fields ->> 'clear_cost_split')::boolean, false),
       p_fields ->> 'sender_name',
       p_fields ->> 'sender_street',
       p_fields ->> 'sender_postal_code',
       p_fields ->> 'sender_city',
       p_fields ->> 'sender_country',
       p_fields ->> 'listing_title',
       p_fields ->> 'listing_url',
       p_fields ->> 'listing_details',
       p_fields ->> 'agreement_note');
  end if;

  -- ---- Entfernen: ZUERST, und mit den Regeln aus 0064 -------------------
  /*
   * `seller_remove_purchase_item` lehnt ab, was abzulehnen ist: eine Position
   * mit Lagerbewegung, eine Zeile aus der Arbeitsmappe, `reconciled_legacy`.
   * Hier wird nichts davon wiederholt und nichts gelockert — der Aufruf
   * traegt die Regel.
   *
   * Zusaetzlich: die Position muss zu DIESEM Einkauf gehoeren. Sonst koennte
   * ein manipulierter Aufruf eine fremde Zeile entfernen, deren Einkauf nie
   * gesperrt und nie versionsgeprueft wurde.
   */
  if p_remove is not null then
    foreach v_rid in array p_remove loop
      if not exists (select 1 from public.purchase_items i
                      where i.id = v_rid and i.purchase_id = p_id) then
        raise exception 'item % does not belong to purchase %', v_rid, p_id
          using errcode = 'check_violation';
      end if;
      perform public.seller_remove_purchase_item(v_rid);
      v_removed := v_removed + 1;
    end loop;
  end if;

  -- ---- Hinzufuegen: DANACH, damit max(position) nicht auf Entferntes zaehlt
  /*
   * `seller_add_purchase_item` setzt `state` nicht und laesst damit den
   * Tabellendefault `ordered` stehen; `movement_id` bleibt NULL. Eine neue
   * Figur ist also NICHT eingebucht — und das soll sie auch nicht sein.
   */
  if p_add is not null then
    for v_item in select * from jsonb_array_elements(p_add) loop
      v_new_ids := v_new_ids || public.seller_add_purchase_item(
        p_id,
        nullif(btrim(coalesce(v_item ->> 'sky_id', '')), ''),
        nullif(btrim(coalesce(v_item ->> 'raw_name', '')), ''),
        coalesce(nullif(btrim(coalesce(v_item ->> 'condition', '')), ''), 'loose'));
    end loop;
  end if;

  /*
   * DIE NEUE VERSION ZURUECKGEBEN.
   *
   * Der Dialog bleibt nach dem Speichern offen. Ohne den neuen Zeitstempel
   * wuerde sein naechstes Speichern gegen den alten pruefen und mit `PT409`
   * scheitern — an einer Aenderung, die er selbst gemacht hat.
   */
  select p.updated_at into v_actual from public.purchases p where p.id = p_id;

  return jsonb_build_object(
    'updated_at', v_actual,
    'added',      coalesce(to_jsonb(v_new_ids), '[]'::jsonb),
    'removed',    v_removed);
end;
$$;

comment on function public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz) is
  'Ein Speichern des Bearbeitungsdialogs: Einkaufsfelder und Positionsunterschied in EINER Transaktion (0126). Ruft seller_update_purchase (0121), seller_remove_purchase_item (0064) und seller_add_purchase_item (0053) unveraendert — kein Lager- und kein Arbeitsmappenschutz wird abgeschwaecht. Prueft purchases.updated_at als Version des ganzen Aggregats und lehnt eine veraltete Bearbeitung mit PT409 ab. Gibt die neue Version und die angelegten IDs zurueck. Kosten bleiben unberuehrt, solange p_fields sie nicht nennt.';

revoke all on function public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)
  from public, anon;
grant execute on function public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_def  text;
  v_code text;
  v_key  text;
begin
  -- ---- der Trigger steht und feuert fuer alle drei Ereignisse ----------
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgname = 'purchase_items_touch_purchase_trg'
                    and t.tgrelid = 'public.purchase_items'::regclass) then
    raise exception '0126 unvollstaendig: der Trigger purchase_items_touch_purchase_trg fehlt';
  end if;
  /*
   * `tgtype` Bit 0 ist ROW, Bit 1 BEFORE; die Ereignisbits sind
   * 4 = INSERT, 8 = DELETE, 16 = UPDATE. Erwartet: ROW, AFTER, alle drei.
   */
  if (select t.tgtype from pg_trigger t
       where t.tgname = 'purchase_items_touch_purchase_trg'
         and t.tgrelid = 'public.purchase_items'::regclass) <> (1 + 4 + 8 + 16) then
    raise exception '0126 Abbruch: der Trigger hat nicht die erwartete Form (ROW, AFTER, insert/update/delete)';
  end if;

  -- ---- die neue Funktion, Eigenschaften und Rechte ---------------------
  if to_regprocedure('public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)') is null then
    raise exception '0126 unvollstaendig: seller_save_purchase_edit fehlt';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_save_purchase_edit') <> 1 then
    raise exception '0126 Abbruch: seller_save_purchase_edit ist mehrfach ueberladen';
  end if;
  if not (select p.prosecdef from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'seller_save_purchase_edit') then
    raise exception '0126 Abbruch: seller_save_purchase_edit ist nicht security definer';
  end if;
  if has_function_privilege('anon',
       'public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)',
       'EXECUTE') then
    raise exception '0126 Abbruch: anon darf seller_save_purchase_edit ausfuehren';
  end if;
  if not has_function_privilege('authenticated',
       'public.seller_save_purchase_edit(bigint, jsonb, jsonb, bigint[], timestamptz)',
       'EXECUTE') then
    raise exception '0126 Abbruch: authenticated kann seller_save_purchase_edit nicht ausfuehren';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'purchase_items_touch_purchase'
                and a.privilege_type = 'EXECUTE'
                and a.grantee <> p.proowner
                and (a.grantee = 0
                     or a.grantee::regrole::text <> 'service_role')) then
    raise exception '0126 Abbruch: auf der Triggerfunktion liegt ein unerwartetes EXECUTE-Recht';
  end if;

  -- ---- und sie schreibt die Regeln nicht neu ---------------------------
  /*
   * Kommentare raus, bevor gesucht wird — `0124` ist daran zweimal
   * gescheitert, einmal an genau dieser Pruefungsform.
   */
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'seller_save_purchase_edit';
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  foreach v_key in array array['public.seller_update_purchase(',
                               'public.seller_remove_purchase_item(',
                               'public.seller_add_purchase_item(',
                               'for update',
                               'PT409',
                               'can_operate_active_seller()'] loop
    if position(v_key in v_code) = 0 then
      raise exception '0126 Abbruch: seller_save_purchase_edit ruft % nicht', v_key;
    end if;
  end loop;

  /*
   * UND SIE FASST WEDER LAGER NOCH BELEG AN.
   *
   * Kein `inventory_movements`, kein `shop_inventory`, kein
   * `purchase_receipts`, kein `delete from public.purchase_items` an der
   * Regel vorbei. Entfernt wird ausschliesslich ueber `0064`.
   */
  foreach v_key in array array['inventory_movements', 'shop_inventory',
                               'purchase_receipts', 'delete from'] loop
    if position(v_key in v_code) > 0 then
      raise exception '0126 Abbruch: seller_save_purchase_edit beruehrt % direkt', v_key;
    end if;
  end loop;

  -- ---- die drei gerufenen Funktionen sind unveraendert -----------------
  if (select count(distinct p.proowner) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('seller_save_purchase_edit', 'seller_update_purchase',
                           'seller_add_purchase_item', 'seller_remove_purchase_item',
                           'purchase_items_touch_purchase')) <> 1 then
    raise exception '0126 Abbruch: die fuenf Funktionen haben nicht denselben Eigentuemer';
  end if;
  if position('this item is already in inventory' in coalesce(
       (select p.prosrc from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname = 'seller_remove_purchase_item'), '')) = 0 then
    raise exception '0126 Abbruch: der Lagerschutz in seller_remove_purchase_item ist verschwunden';
  end if;

  raise notice '0126 ok: Trigger steht, Speichern laeuft in einer Transaktion, Regeln unveraendert.';
end
$$;
