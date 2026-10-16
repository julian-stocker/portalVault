-- ===========================================================================
-- 0127 — Eine Figur direkt austauschen, im selben Speichern
--
-- `seller_save_purchase_edit` aus `0126` bekommt einen sechsten Parameter
-- `p_swap`. Damit gehen Felder, Wechsel, Entfernen und Hinzufuegen in EINER
-- Transaktion — oder keines davon.
--
-- `0126` BLEIBT UNVERAENDERT. Diese Datei korrigiert den Zustand vorwaerts,
-- wie `0124` den Ledger aus `0119` ersetzt hat.
--
-- ---------------------------------------------------------------------------
-- WARUM EIN DROP UND KEIN create or replace
--
-- `create or replace` kann die Parameterzahl nicht aendern. Ein zusaetzlicher
-- Parameter mit Default erzeugt eine ZWEITE Funktion, und dann ist der
-- bestehende Aufruf mit fuenf benannten Argumenten mehrdeutig:
--
--     ERROR: function seller_save_purchase_edit(...) is not unique
--
-- Der Dialog koennte ab diesem Moment gar nicht mehr speichern. Also wird die
-- Fuenf-Parameter-Fassung geloescht und die Sechs-Parameter-Fassung angelegt.
--
-- OHNE `cascade`. Vor dem Schreiben geprueft: keine View, keine Policy, kein
-- Default und kein Trigger nennt diese Funktion — nur `0126` legt sie an. Ein
-- `cascade` koennte also nichts Sinnvolles aufraeumen, aber im Fehlerfall
-- etwas mitreissen. Taucht je eine Abhaengigkeit auf, soll das `drop`
-- SCHEITERN und nicht raeumen.
--
-- ---------------------------------------------------------------------------
-- RUECKWAERTSKOMPATIBILITAET — DER PUNKT, AN DEM ES HAENGT
--
-- Der heute auf Production deployte Dialog schickt FUENF benannte Argumente.
-- Die neue Funktion hat sechs, der sechste mit Default `'[]'`. PostgREST loest
-- einen RPC ueber die NAMEN der uebergebenen Argumente auf; ein Name, der
-- fehlt und einen Default hat, ist kein Hindernis. Der alte Client speichert
-- also weiter.
--
-- Was dabei NICHT passieren darf: die ersten fuenf Parameter umbenennen oder
-- ihre Typen aendern. Die Nachbedingung unten prueft Namen UND Typen
-- einzeln — ein vertauschter Name waere fuer PostgREST ein anderer Aufruf.
--
-- UND DIE RECHTE GEHEN BEIM DROP VERLOREN. `0126` hat
-- `revoke all … from public, anon` und `grant execute … to authenticated`
-- gesetzt; ein `drop` nimmt den ACL mit. Beides wird unten erneut gesetzt, und
-- die Nachbedingung prueft es. Ohne das waere die Funktion nach `0127`
-- entweder fuer niemanden oder — ueber die Default-Privileges von Supabase —
-- fuer `anon` erreichbar.
--
-- ---------------------------------------------------------------------------
-- WAS SIE NICHT TUT: REGELN NEU SCHREIBEN
--
-- Der Wechsel geht durch `seller_set_purchase_item_sky` (`0054`), und zwar
-- unveraendert. Deren Kommentar sagt, was sie schuetzt:
--
--     Deliberately untouched: raw_name, source_row, legacy flags, state,
--     position, condition. Classification changes; history does not.
--
-- ID und Position bleiben also, weil es ein `update` auf dieselbe Zeile ist.
-- Eine eingebuchte Position lehnt sie ab — `movement_id is not null` — und
-- damit bleibt es dabei: erst von Hand zurueckbuchen, dann aendern. Keine
-- automatische Lagerkorrektur, nicht einmal eine moegliche.
--
-- `p_remember` wird ausdruecklich `false` uebergeben: hier wird eine Zeile
-- korrigiert, keine Namensregel gelernt.
--
-- ARBEITSMAPPENZEILEN duerfen gewechselt werden und nicht entfernt. Das ist
-- keine Lockerung, sondern der Zweck von `0054`: die Zuordnung einer
-- importierten Zeile zu korrigieren. `canRemoveItem` prueft die Herkunft
-- zusaetzlich, `canRemapItem` bewusst nicht.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_alt  oid;
  v_neu  oid;
  v_acl  text;
begin
  v_alt := to_regprocedure('public.seller_save_purchase_edit('
             || 'bigint, jsonb, jsonb, bigint[], timestamptz)');
  v_neu := to_regprocedure('public.seller_save_purchase_edit('
             || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)');

  if v_alt is null and v_neu is null then
    raise exception '0127 setzt 0126 voraus: seller_save_purchase_edit fehlt in beiden Fassungen';
  end if;
  if v_alt is not null then
    raise notice '0127: die Fuenf-Parameter-Fassung ist da und wird ersetzt.';
  else
    raise notice '0127: die Sechs-Parameter-Fassung ist schon da — Leerlauf mit Nachpruefung.';
  end if;

  -- Die drei gerufenen Funktionen muessen in ihren Signaturen vorliegen.
  if to_regprocedure('public.seller_set_purchase_item_sky(bigint, text, boolean)') is null then
    raise exception '0127 setzt 0054 voraus: seller_set_purchase_item_sky fehlt';
  end if;
  if to_regprocedure('public.seller_add_purchase_item(bigint, text, text, text)') is null then
    raise exception '0127 setzt 0053 voraus: seller_add_purchase_item fehlt';
  end if;
  if to_regprocedure('public.seller_remove_purchase_item(bigint)') is null then
    raise exception '0127 setzt 0053/0064 voraus: seller_remove_purchase_item fehlt';
  end if;
  if to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
       || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
       || ' text, text, text, text, text, text, text, text)') is null then
    raise exception '0127 setzt 0121 voraus: seller_update_purchase hat eine andere Signatur';
  end if;

  /*
   * UND DIE SCHUTZREGELN STEHEN NOCH IM RUMPF.
   *
   * `0127` lockert nichts — aber nur, solange die gerufenen Funktionen ihre
   * Pruefungen tragen. Waere eine davon verschwunden, waere der Wechsel durch
   * diese Datei eine Lockerung, und das soll sie nicht sein.
   */
  if position('this item is in inventory' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_set_purchase_item_sky'), '')) = 0 then
    raise exception '0127 Abbruch: der Lagerschutz in seller_set_purchase_item_sky ist verschwunden';
  end if;
  if position('this item is already in inventory' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_remove_purchase_item'), '')) = 0 then
    raise exception '0127 Abbruch: der Lagerschutz in seller_remove_purchase_item ist verschwunden';
  end if;

  -- Der Trigger aus 0126 traegt die Version. Ohne ihn ist p_expected sinnlos.
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgname = 'purchase_items_touch_purchase_trg'
                    and t.tgrelid = 'public.purchase_items'::regclass) then
    raise exception '0127 setzt 0126 voraus: der Trigger purchase_items_touch_purchase_trg fehlt';
  end if;

  /*
   * DEN ACL WEGLEGEN, BEVOR DAS DROP IHN MITNIMMT.
   *
   * Nur zum Vergleich in der Nachbedingung — wiederhergestellt wird er nicht
   * aus diesem Wert, sondern aus den ausdruecklichen Zeilen unten. Ein
   * zurueckgespielter ACL waere eine Kopie ohne Aussage; zwei Zeilen Quelltext
   * sagen, was gelten soll.
   */
  if v_alt is not null then
    select coalesce(array_to_string(p.proacl, ','), '(kein ACL)')
      into v_acl from pg_proc p where p.oid = v_alt;
    raise notice '0127: ACL vor dem drop: %', v_acl;
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- 1. Die alte Fassung weg — ohne cascade
-- ---------------------------------------------------------------------------
drop function if exists public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz);


-- ---------------------------------------------------------------------------
-- 2. Und neu, mit p_swap
-- ---------------------------------------------------------------------------
create or replace function public.seller_save_purchase_edit(
  p_id                  bigint,
  p_fields              jsonb       default '{}'::jsonb,
  p_add                 jsonb       default '[]'::jsonb,
  p_remove              bigint[]    default '{}'::bigint[],
  p_expected_updated_at timestamptz default null,
  p_swap                jsonb       default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actual   timestamptz;
  v_item     jsonb;
  v_rid      bigint;
  v_sid      bigint;
  v_sky      text;
  v_current  text;
  v_new_ids  bigint[] := '{}';
  v_removed  integer  := 0;
  v_swapped  integer  := 0;
  v_skipped  integer  := 0;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  /*
   * SPERRE UND VERSION, BEVOR IRGENDETWAS GESCHRIEBEN WIRD — wie in `0126`.
   */
  select p.updated_at into v_actual
    from public.purchases p where p.id = p_id for update;
  if not found then
    raise exception 'no such purchase' using errcode = 'no_data_found';
  end if;

  if p_expected_updated_at is not null
     and v_actual is distinct from p_expected_updated_at then
    raise exception 'this purchase changed while you were editing it'
      using errcode = 'PT409';
  end if;

  /*
   * WIDERSPRUECHLICHE AUFTRAEGE WERDEN ABGELEHNT, NICHT SORTIERT.
   *
   * Eine Position gleichzeitig wechseln und entfernen zu wollen ist kein
   * Auftrag, sondern ein Fehler im Aufrufer. Ihn in eine Reihenfolge zu
   * bringen hiesse, eine der beiden Absichten stillschweigend zu verwerfen.
   */
  if p_swap is not null and p_remove is not null then
    if exists (select 1 from jsonb_array_elements(p_swap) s
                where (s ->> 'item_id')::bigint = any (p_remove)) then
      raise exception 'an item cannot be swapped and removed in the same save'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ---- Felder --------------------------------------------------------
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

  -- ---- Wechseln: zuerst, auf Zeilen, die sicher noch da sind ----------
  /*
   * `seller_set_purchase_item_sky` traegt die Regeln: Betreibertor, `for
   * update`, die Ablehnung einer eingebuchten Position und die Sperre gegen
   * „namenlos werden". Hier wird keine davon wiederholt.
   *
   * `p_remember` ist FALSE: eine Zeile wird korrigiert, keine Namensregel
   * gelernt. Eine gelernte Regel wuerde kuenftige Importe beeinflussen, und
   * das ist eine andere Entscheidung als diese.
   */
  if p_swap is not null then
    for v_item in select * from jsonb_array_elements(p_swap) loop
      v_sid := (v_item ->> 'item_id')::bigint;
      v_sky := nullif(btrim(coalesce(v_item ->> 'sky_id', '')), '');

      select i.sky_id into v_current
        from public.purchase_items i
       where i.id = v_sid and i.purchase_id = p_id;
      if not found then
        raise exception 'item % does not belong to purchase %', v_sid, p_id
          using errcode = 'check_violation';
      end if;

      /*
       * EIN WECHSEL AUF DIESELBE FIGUR SCHREIBT NICHT.
       *
       * Sonst bewegte er `updated_at` — ueber den Trigger aus `0126` sogar
       * den Versionsstempel des ganzen Einkaufs — und liesse jede andere
       * offene Bearbeitung mit `PT409` scheitern. Ein Leerauftrag darf keinen
       * Konflikt erzeugen.
       */
      if v_current is distinct from v_sky then
        perform public.seller_set_purchase_item_sky(v_sid, v_sky, false);
        v_swapped := v_swapped + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end if;

  -- ---- Entfernen: mit den Regeln aus 0064 ----------------------------
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

  -- ---- Hinzufuegen: zuletzt, damit max(position) stimmt --------------
  if p_add is not null then
    for v_item in select * from jsonb_array_elements(p_add) loop
      v_new_ids := v_new_ids || public.seller_add_purchase_item(
        p_id,
        nullif(btrim(coalesce(v_item ->> 'sky_id', '')), ''),
        nullif(btrim(coalesce(v_item ->> 'raw_name', '')), ''),
        coalesce(nullif(btrim(coalesce(v_item ->> 'condition', '')), ''), 'loose'));
    end loop;
  end if;

  select p.updated_at into v_actual from public.purchases p where p.id = p_id;

  return jsonb_build_object(
    'updated_at', v_actual,
    'added',      coalesce(to_jsonb(v_new_ids), '[]'::jsonb),
    'removed',    v_removed,
    'swapped',    v_swapped,
    'unchanged',  v_skipped);
end;
$$;

comment on function public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz, jsonb) is
  'Ein Speichern des Bearbeitungsdialogs: Einkaufsfelder, Figurenwechsel, Entfernen und Hinzufuegen in EINER Transaktion (0126, um p_swap erweitert in 0127). Ruft seller_update_purchase (0121), seller_set_purchase_item_sky (0054), seller_remove_purchase_item (0064) und seller_add_purchase_item (0053) unveraendert — kein Lager-, Herkunfts- oder Belegschutz wird abgeschwaecht, und p_remember ist beim Wechsel immer false. Ein Wechsel auf dieselbe SKY-ID schreibt nicht. Prueft purchases.updated_at als Version des ganzen Aggregats und lehnt eine veraltete Bearbeitung mit PT409 ab. Kosten bleiben unberuehrt, solange p_fields sie nicht nennt.';

/*
 * DIE RECHTE NEU SETZEN — das `drop` hat den ACL mitgenommen.
 *
 * Ohne diese zwei Zeilen waere die Funktion entweder fuer niemanden
 * erreichbar oder, ueber die Default-Privileges von Supabase im Schema
 * `public`, fuer `anon` und `authenticated` zugleich. Dieselbe Lehre wie
 * `0125`: ein fehlendes `grant` ist hier kein fehlendes Recht.
 */
revoke all on function public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz, jsonb) from public, anon;
grant execute on function public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid  oid;
  v_def  text;
  v_code text;
  v_key  text;
  v_names text[];
begin
  v_oid := to_regprocedure('public.seller_save_purchase_edit('
             || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)');
  if v_oid is null then
    raise exception '0127 unvollstaendig: die Sechs-Parameter-Fassung fehlt';
  end if;

  -- Genau eine Fassung. Zwei waeren der Mehrdeutigkeitsfehler.
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_save_purchase_edit') <> 1 then
    raise exception '0127 Abbruch: seller_save_purchase_edit ist mehrfach ueberladen — ein Aufruf mit fuenf Argumenten waere mehrdeutig';
  end if;
  if to_regprocedure('public.seller_save_purchase_edit('
       || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null then
    raise exception '0127 Abbruch: die Fuenf-Parameter-Fassung existiert noch';
  end if;

  /*
   * RUECKWAERTSKOMPATIBILITAET, SO WEIT SIE PRUEFBAR IST.
   *
   * PostgREST loest ueber Namen auf. Ein Aufruf mit den ersten fuenf Namen
   * geht durch, wenn (a) die Namen und Typen unveraendert sind und (b) der
   * sechste einen Default hat. Beides steht hier.
   */
  select p.proargnames into v_names from pg_proc p where p.oid = v_oid;
  if v_names is distinct from array['p_id', 'p_fields', 'p_add', 'p_remove',
                                    'p_expected_updated_at', 'p_swap'] then
    raise exception '0127 Abbruch: die Parameternamen sind nicht die erwarteten (%)',
      array_to_string(v_names, ', ');
  end if;
  if (select p.pronargs from pg_proc p where p.oid = v_oid) <> 6 then
    raise exception '0127 Abbruch: die Funktion hat nicht sechs Parameter';
  end if;
  /* Fuenf Defaults: alles ausser `p_id`. Damit ist auch ein Aufruf mit nur
     `p_id` gueltig — und einer mit den ersten fuenf Namen erst recht. */
  if (select p.pronargdefaults from pg_proc p where p.oid = v_oid) <> 5 then
    raise exception '0127 Abbruch: nicht fuenf der sechs Parameter haben einen Default';
  end if;
  /*
   * DIE TYPEN NACH POSITION — NICHT ALS GANZES ARRAY.
   *
   * HIER IST DER ERSTE ANWENDUNGSVERSUCH VON `0127` GESCHEITERT. Dort wurde
   * der GANZE Vektor nach `oid[]` gecastet und mit einem `array[...]`-Literal
   * verglichen — mit `is distinct from`, in einer Anweisung.
   *
   * Das kann NIE bestehen, bei keiner Signatur: `proargtypes` ist ein
   * `oidvector` und nullbasiert, der Cast nach `oid[]` ist binaerkompatibel
   * und behaelt die untere Grenze 0 — `[0:5]={...}` —, waehrend ein
   * `array[...]`-Literal bei 1 beginnt. Die Array-Gleichheit in PostgreSQL
   * vergleicht Dimensionen UND Grenzen, also sind beide Seiten bei gleichen
   * Elementen trotzdem verschieden. Belegt in
   * `supabase/checks/0127_signature_diagnosis.sql`, Pruefungen 303 bis 308.
   *
   * Dieselbe Lehre hatte `0125` Postflight 202 schon gekostet. Verglichen wird
   * deshalb Position fuer Position, OID gegen OID — die Form, die der
   * Postflight von `0126` auf Staging bestanden hat. `proargtypes[0]` ist das
   * ERSTE Argument, nicht `[1]`.
   *
   * Der Waechter in `fingerprint-rights.test.ts` verbietet die falsche Form in
   * jeder Migration und jeder Pruefdatei. Er steigt nicht in Funktionsruempfe
   * hinab und kann einen Kommentar dort nicht von Code unterscheiden — deshalb
   * ist das Muster oben beschrieben und nicht ausgeschrieben.
   */
  if not coalesce((select p.pronargs = 6
                          and p.proargtypes[0]::regtype = 'bigint'::regtype
                          and p.proargtypes[1]::regtype = 'jsonb'::regtype
                          and p.proargtypes[2]::regtype = 'jsonb'::regtype
                          and p.proargtypes[3]::regtype = 'bigint[]'::regtype
                          and p.proargtypes[4]::regtype = 'timestamptz'::regtype
                          and p.proargtypes[5]::regtype = 'jsonb'::regtype
                     from pg_proc p where p.oid = v_oid), false) then
    raise exception '0127 Abbruch: die Argumenttypen sind nicht die erwarteten (%)',
      coalesce(pg_get_function_arguments(v_oid), '(keine Signatur)');
  end if;

  -- ---- Rechte, nach dem drop neu gesetzt -----------------------------
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception '0127 Abbruch: anon darf seller_save_purchase_edit ausfuehren';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception '0127 Abbruch: authenticated kann seller_save_purchase_edit nicht ausfuehren — das drop hat den ACL mitgenommen';
  end if;
  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception '0127 Abbruch: die Funktion hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid
                and a.privilege_type = 'EXECUTE'
                and a.grantee = 0) then
    raise exception '0127 Abbruch: PUBLIC hat EXECUTE';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception '0127 Abbruch: die Funktion ist nicht security definer';
  end if;

  -- ---- der Rumpf: kommentarfrei geprueft -----------------------------
  v_def := pg_get_functiondef(v_oid);
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '0127 Abbruch: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter';
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  foreach v_key in array array['public.seller_update_purchase(',
                               'public.seller_set_purchase_item_sky(',
                               'public.seller_remove_purchase_item(',
                               'public.seller_add_purchase_item(',
                               'for update',
                               'PT409',
                               'can_operate_active_seller()',
                               'i.purchase_id = p_id',
                               'v_current is distinct from v_sky',
                               'swapped and removed in the same save'] loop
    if position(v_key in v_code) = 0 then
      raise exception '0127 Abbruch: der Rumpf fuehrt % nicht', v_key;
    end if;
  end loop;

  /* `p_remember` beim Wechsel immer false — sonst wuerde eine Namensregel
     gelernt, und das ist eine andere Entscheidung. */
  if position('v_sid, v_sky, false' in v_code) = 0 then
    raise exception '0127 Abbruch: der Wechsel uebergibt p_remember nicht als false';
  end if;
  if position('v_sid, v_sky, true' in v_code) > 0 then
    raise exception '0127 Abbruch: der Wechsel lernt eine Namensregel';
  end if;

  foreach v_key in array array['inventory_movements', 'shop_inventory',
                               'purchase_receipts', 'delete from',
                               'orderbook_name_mappings'] loop
    if position(v_key in v_code) > 0 then
      raise exception '0127 Abbruch: der Rumpf beruehrt % direkt', v_key;
    end if;
  end loop;

  -- ---- und die gerufenen Funktionen sind unveraendert ----------------
  if (select count(distinct p.proowner) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('seller_save_purchase_edit', 'seller_update_purchase',
                           'seller_set_purchase_item_sky', 'seller_add_purchase_item',
                           'seller_remove_purchase_item', 'purchase_items_touch_purchase')) <> 1
  then
    raise exception '0127 Abbruch: die sechs Funktionen haben nicht denselben Eigentuemer';
  end if;
  if position('Deliberately untouched' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_set_purchase_item_sky'), '')) = 0 then
    raise exception '0127 Abbruch: der Erhaltungskommentar in seller_set_purchase_item_sky ist weg — Position und Herkunft sind nicht mehr zugesichert';
  end if;
  if position('this item is in inventory' in coalesce((select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'seller_set_purchase_item_sky'), '')) = 0 then
    raise exception '0127 Abbruch: der Lagerschutz in seller_set_purchase_item_sky ist verschwunden';
  end if;

  raise notice '0127 ok: p_swap ergaenzt, Rechte neu gesetzt, Regeln unveraendert.';
end
$$;
