-- ===========================================================================
-- RUECKNAHME von 0127 — stellt die Fassung aus 0126 wieder her
--
-- NICHT TEIL DER MIGRATIONSKETTE. Nur nach ausdruecklicher Entscheidung.
--
-- WAS 0127 GETAN HAT: sie hat die FUENF-Parameter-Fassung von
-- `seller_save_purchase_edit` geloescht und eine SECHS-Parameter-Fassung
-- angelegt — der sechste Parameter `p_swap jsonb` traegt den direkten
-- Figurenwechsel und hat einen Standardwert.
--
-- WAS DIESE DATEI TUT: sie legt die Fuenf-Parameter-Fassung aus `0126`
-- wieder an und loescht die Sechs-Parameter-Fassung. Danach gibt es GENAU
-- EINE Fassung — das ist wichtig, weil PostgREST einen RPC ueber die NAMEN
-- der uebergebenen Argumente auflöst und zwei Fassungen den Aufruf
-- mehrdeutig machen wuerden.
--
-- WAS SIE NICHT TUT: sie faesst keine Daten an. Kein `insert`, `update`,
-- `delete`, kein `drop` an einer Tabelle oder Spalte. Bereits gespeicherte
-- Figurenwechsel bleiben, wie sie sind — sie stehen in `purchase_items` und
-- `inventory_movements`, nicht in der Funktion.
--
-- WAS SIE KOSTET: der Figurenwechsel im Dialog funktioniert danach nicht
-- mehr. Ein ausgelieferter Client, der `p_swap` mitschickt, bekommt
-- PostgREST-Fehler 404 (keine passende Funktion) — deshalb gehoert diese
-- Ruecknahme mit dem Zurueckrollen des Anwendungsstands zusammen.
--
-- REIHENFOLGE: erst `R0128`, dann `R0127`, dann `R0126`. Umgekehrt zur
-- Anwendung.
--
-- VORBEDINGUNG: es gibt genau eine Fassung, und sie hat sechs Parameter.
-- NACHBEDINGUNG: es gibt genau eine Fassung, sie hat fuenf Parameter, die
--   Rechte stehen wie in `0126` (PUBLIC und anon ohne EXECUTE, authenticated
--   mit EXECUTE), und `seller_update_purchase` aus `0121` ist unberuehrt.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert. Vorher `npm run verify:sums`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_fassungen integer;
  v_args      integer;
begin
  select count(*) into v_fassungen
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';

  if v_fassungen = 0 then
    raise exception 'R0127 Abbruch: seller_save_purchase_edit fehlt — 0126/0127 sind hier nicht angewendet';
  end if;
  if v_fassungen > 1 then
    raise exception 'R0127 Abbruch: % Fassungen von seller_save_purchase_edit — erst den Stand klaeren', v_fassungen;
  end if;

  select p.pronargs into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';

  if v_args = 5 then
    raise exception 'R0127 Abbruch: die Funktion hat SCHON fuenf Parameter — 0127 ist hier nicht angewendet';
  end if;
  if v_args <> 6 then
    raise exception 'R0127 Abbruch: die Funktion hat % Parameter, erwartet 6', v_args;
  end if;

  /* 0121 ist die Grundlage, auf die 0126 aufsetzt — sie muss stehen.
     Signatur wortgleich wie in der Vorbedingung von 0126 selbst. */
  if to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
       || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
       || ' text, text, text, text, text, text, text, text)') is null then
    raise exception 'R0127 Abbruch: seller_update_purchase aus 0121 fehlt oder hat eine andere Signatur';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Sechs-Parameter-Fassung weg
--
-- `drop` nimmt den ACL mit — die Rechte werden in Abschnitt 4 neu gesetzt,
-- genau wie `0126` sie gesetzt hat.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz, jsonb);


-- ---------------------------------------------------------------------------
-- 3. Die Fassung aus 0126, unveraendert uebernommen
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


-- ---------------------------------------------------------------------------
-- 4. Rechte wie in 0126
-- ---------------------------------------------------------------------------
revoke all on function public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz)
  from public, anon;

grant execute on function public.seller_save_purchase_edit(
  bigint, jsonb, jsonb, bigint[], timestamptz)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_fassungen integer;
  v_args      integer;
  v_oid       oid;
begin
  select count(*) into v_fassungen
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';
  if v_fassungen <> 1 then
    raise exception 'R0127 Abbruch: % Fassungen statt genau einer — PostgREST wuerde den Aufruf nicht mehr eindeutig auflösen', v_fassungen;
  end if;

  select p.oid, p.pronargs into v_oid, v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_save_purchase_edit';
  if v_args <> 5 then
    raise exception 'R0127 Abbruch: % Parameter statt 5', v_args;
  end if;

  /* Argumenttypen nach POSITION — `proargtypes` ist ein NULLBASIERTER
     oidvector, und ein Ganzarray-Vergleich gegen ein `array[...]`-Literal
     scheitert an Dimension und Grenzen. Genau daran brach 0127 beim ersten
     Versuch auf Staging ab. */
  if not coalesce((select p.proargtypes[0]::regtype = 'bigint'::regtype
                      and p.proargtypes[1]::regtype = 'jsonb'::regtype
                      and p.proargtypes[2]::regtype = 'jsonb'::regtype
                      and p.proargtypes[3]::regtype = 'bigint[]'::regtype
                      and p.proargtypes[4]::regtype = 'timestamptz'::regtype
                     from pg_proc p where p.oid = v_oid), false) then
    raise exception 'R0127 Abbruch: die Argumenttypen sind nicht die erwarteten';
  end if;

  /*
   * PUBLIC UEBER DEN ACL, NICHT UEBER has_function_privilege.
   *
   * `has_function_privilege('public', ...)` bricht mit `role "public" does
   * not exist` ab — `public` ist ein Pseudo-Empfaenger im ACL (grantee = 0),
   * kein Eintrag in `pg_roles`. Dieselbe Lehre steht in `0124` und `0125`.
   *
   * Und ein NULL-ACL heisst nicht „keine Rechte", sondern „Standardrechte" —
   * fuer eine Funktion also EXECUTE fuer PUBLIC. Ein fehlender ACL ist hier
   * genau der Zustand, den die Pruefung verhindern soll.
   */
  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception 'R0127 Abbruch: die Funktion hat keinen ACL — der Standard waere EXECUTE fuer PUBLIC';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception 'R0127 Abbruch: PUBLIC oder anon hat EXECUTE';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'R0127 Abbruch: authenticated hat kein EXECUTE';
  end if;

  raise notice 'R0127: zurueck auf die Fuenf-Parameter-Fassung aus 0126';
end $$;
