-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0143
--              (eine Kalkulation wird ein Einkauf, in einer Transaktion)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des PRODUCTION-Projekts einfuegen, ausfuehren. Nichts in Teilen:
-- jede Zeile gehoert zur selben Klammer, und ein Fehler irgendwo rollt ALLES
-- zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert — `0132` und `0133` landeten unbeabsichtigt auf
-- Production (`docs/history/2026-10-18-production-0132-0133.md`). Diese
-- Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: bin ich wirklich auf Production?
--   B   Migration 0143, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0143_purchase_from_calculation.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE ANLEGT
--
--   * genau eine Funktion:
--     `seller_create_purchase_from_calculation(uuid, …13)`,
--     `security definer`, `set search_path = ''`, `execute` nur fuer
--     `authenticated`
--
-- SIE LEGT DEN EINKAUF NICHT SELBST AN. Sie ruft
-- `seller_create_purchase_with_items` mit allen dreizehn Parametern
-- unveraendert auf und schreibt in DERSELBEN Transaktion `purchase_id` in
-- die Kalkulation. Datumspruefung, Mengendecke, Zustandsliste,
-- Kostenaufteilung und die Idempotenz aus `0120` bleiben dadurch an genau
-- einer Stelle (ADR-0132).
--
-- WAS SIE NICHT TUT
--
--   * Sie legt keine Tabelle, keine Spalte, keinen Index an.
--   * Sie ersetzt keinen bestehenden Funktionsrumpf — `create function`,
--     nicht `create or replace`.
--   * Sie bucht nichts ein: keine Bewegung, kein Bestand.
--   * Sie liest aus der Kalkulation GENAU EINE Spalte: `purchase_id`. Kein
--     Betrag, kein Faktor, keine Position.
--   * Sie fasst die Belegsperre nicht an und nennt sie nirgends.
--
-- SIE SETZT `0142` VORAUS (die Tabelle) sowie `0041`, `0064/0115/0116` und
-- `0120` (die bestehende Einkaufserstellung und `client_token`). Die
-- Reihenfolge 0142 → 0143 ist nicht beliebig; sie ist in
-- `supabase/checks/production_release_0142_0143.md` begruendet.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck. Weil der SQL-Editor
-- `NOTICE` nicht anzeigt, danach `prod-s-postflight-0143.sql` fahren.
--
-- RUECKNAHME: `supabase/rollback/R0143_drop_purchase_from_calculation.sql` —
-- sie nimmt die Funktion fort und LAESST BESTEHENDE VERKNUEPFUNGEN STEHEN.
-- REIHENFOLGE UND STOPP-KRITERIEN:
-- `supabase/checks/production_release_0142_0143.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- Dieselben drei Bedingungen wie in den sieben Laeufen des Releases
-- 0135-0141, Zeichen fuer Zeichen. Ein Riegel, der in einer Datei abweicht,
-- ist in dieser Datei kein Riegel.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0143.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0143_purchase_from_calculation.sql
-- ===========================================================================
-- 0143 — EIN EINKAUF AUS EINER KALKULATION, IN EINER TRANSAKTION
--         (Calculator V3, ADR-0132)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Setzt `0142` voraus. Braucht eine eigene Freigabe.                   ##
-- ###########################################################################
--
-- WOFUER. Nach dem Speichern eines Einkaufs soll die Kalkulation, aus der er
-- entstand, mit ihm VERKNUEPFT sein — ohne einen zweiten Knopf, ohne eine
-- zweite Bestaetigung und ohne einen Zwischenzustand, in dem der Einkauf
-- steht und die Verknuepfung fehlt.
--
-- WARUM DAS NICHT IN ZWEI SCHRITTEN GEHT
--
-- Zwei Aufrufe — erst anlegen, dann verknuepfen — sind zwei Transaktionen.
-- Scheitert der zweite (Netz, Timeout, ein Fehler dazwischen), steht ein
-- Einkauf da, von dem niemand weiss, dass er aus dieser Kalkulation kam, und
-- die Kalkulation bietet weiter „Einkauf erstellen" an. Beim naechsten Druck
-- entsteht ein zweiter Einkauf. Genau dieser Teilzustand ist der Grund fuer
-- diese Datei.
--
-- WAS SIE NICHT TUT: SIE LEGT KEINEN EINKAUF AN.
--
-- Das tut weiter `seller_create_purchase_with_items` (`0064`, erweitert in
-- `0115`/`0116`/`0120`), und diese Funktion RUFT sie auf — mit allen
-- dreizehn Parametern, unveraendert. Es gibt also keinen zweiten Weg, einen
-- Einkauf anzulegen, keine zweite Pruefung des Kaufdatums, keine zweite
-- Mengendecke, keine zweite Idempotenz. Was hier dazukommt, sind drei
-- Zeilen: die Kalkulation sperren, pruefen, verknuepfen.
--
-- DREI RIEGEL, UND JEDER HAT EINEN GRUND
--
--   1. `can_operate_active_seller()` — ein Einkauf ist ein
--      Geschaeftsvorfall. Dieselbe Pruefung, mit der jede andere
--      Verkaeuferfunktion beginnt.
--   2. `user_id = auth.uid()` — AUSDRUECKLICH, weil diese Funktion
--      `security definer` ist und RLS damit NICHT greift. Eine fremde oder
--      erfundene Kalkulations-ID findet keine Zeile, und die Antwort ist
--      fuer beide Faelle dieselbe: „gibt es nicht". Wer nichts sehen darf,
--      soll auch nicht erfahren, dass es existiert.
--   3. `purchase_id is null` — eine Kalkulation wird EINMAL uebernommen.
--      Die Ausnahme ist die wortgleiche Wiederholung desselben
--      Browser-Entwurfs: dann traegt der bereits verknuepfte Einkauf genau
--      diesen `client_token`, `seller_create_purchase_with_items` gibt ihn
--      unveraendert zurueck, und diese Funktion verknuepft nichts neu. Ein
--      zweiter Druck auf „Speichern" ist damit folgenlos — ein zweiter
--      Einkauf aus derselben Kalkulation unmoeglich.
--
-- UND SIE UEBERNIMMT KEINE PREISE. Marktwerte, Kalkulationsfaktor und
-- maximaler Einkaufspreis sind Bewertung, keine Kosten (ADR-0132). Was
-- `p_total_cost`, `p_items_cost`, `p_shipping_cost` und
-- `p_buyer_protection_cost` enthalten, tippt der Betreiber im bestehenden
-- Formular — diese Datei liest die Kalkulation nur fuer die VERKNUEPFUNG,
-- nicht fuer eine Zahl.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0143_drop_purchase_from_calculation.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.purchase_calculations') is null then
    raise exception '0143 setzt 0142 voraus: public.purchase_calculations fehlt';
  end if;
  if to_regprocedure('public.seller_create_purchase_with_items(date, numeric, text, '
                     'boolean, jsonb, text, text, numeric, numeric, numeric, text, '
                     'text, text)') is null then
    raise exception '0143 setzt 0064/0115/0116/0120 voraus: '
      'seller_create_purchase_with_items mit dreizehn Parametern fehlt';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0143 setzt 0041 voraus: can_operate_active_seller fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchases'
                    and column_name = 'client_token') then
    raise exception '0143 setzt 0120 voraus: purchases.client_token fehlt';
  end if;
  if to_regprocedure('public.seller_create_purchase_from_calculation(uuid, date, '
                     'numeric, text, boolean, jsonb, text, text, numeric, numeric, '
                     'numeric, text, text, text)') is not null then
    raise exception '0143 Abbruch: seller_create_purchase_from_calculation steht schon';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktion
--
-- Die Parameter sind die dreizehn von `seller_create_purchase_with_items`,
-- mit der Kalkulations-ID davor. Dieselbe Reihenfolge, dieselben Namen,
-- dieselben Vorgaben — damit beim Lesen sofort sichtbar ist, dass hier
-- nichts umgedeutet wird.
-- ---------------------------------------------------------------------------
create function public.seller_create_purchase_from_calculation(
  p_calculation_id uuid,
  p_purchased_at   date,
  p_total_cost     numeric,
  p_note           text    default null,
  p_is_test        boolean default false,
  p_items          jsonb   default '[]'::jsonb,
  p_platform       text    default null,
  p_seller_name    text    default null,
  p_items_cost     numeric default null,
  p_shipping_cost  numeric default null,
  p_buyer_protection_cost numeric default null,
  p_payment_method text    default null,
  p_external_ref   text    default null,
  p_client_token   text    default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token   text;
  v_vorher  bigint;
  v_id      bigint;
begin
  /* Riegel 1: ein Einkauf ist ein Geschaeftsvorfall. */
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  v_token := lower(nullif(btrim(coalesce(p_client_token, '')), ''));

  /*
   * Riegel 2: die Kalkulation muss dem Aufrufer gehoeren.
   *
   * `security definer` heisst: RLS greift hier NICHT. Die Bedingung
   * `user_id = (select auth.uid())` ist deshalb die einzige Grenze, und sie
   * steht ausdruecklich da. `for update` sperrt die Zeile bis zum Ende der
   * Transaktion — zwei gleichzeitige Druecke auf „Speichern" lesen sonst
   * beide „noch nicht uebernommen".
   */
  select c.purchase_id into v_vorher
    from public.purchase_calculations c
   where c.id = p_calculation_id
     and c.user_id = (select auth.uid())
   for update;

  if not found then
    /* Dieselbe Antwort fuer „gibt es nicht" und „gehoert jemand anderem". */
    raise exception 'calculation not found'
      using errcode = 'no_data_found';
  end if;

  /*
   * Riegel 3: einmal, und nur einmal.
   *
   * Die Ausnahme ist die wortgleiche Wiederholung desselben Entwurfs: dann
   * traegt der verknuepfte Einkauf genau diesen Token. Alles andere wird
   * abgewiesen, BEVOR ein Einkauf entsteht — ein abgewiesener zweiter
   * Versuch darf keinen Einkauf zuruecklassen.
   */
  if v_vorher is not null then
    if v_token is null
       or not exists (select 1 from public.purchases p
                       where p.id = v_vorher and p.client_token = v_token) then
      raise exception 'calculation % was already handed over as purchase %',
        p_calculation_id, v_vorher
        using errcode = 'unique_violation';
    end if;
  end if;

  /*
   * DER EINKAUF — angelegt von der bestehenden Funktion, nicht hier.
   *
   * Alle dreizehn Parameter unveraendert weiter. Kaufdatum, Mengendecke,
   * Zustandsliste, Kostenaufteilung und Idempotenz gelten damit genau
   * einmal und an einer Stelle.
   */
  v_id := public.seller_create_purchase_with_items(
    p_purchased_at, p_total_cost, p_note, p_is_test, p_items,
    p_platform, p_seller_name, p_items_cost, p_shipping_cost,
    p_buyer_protection_cost, p_payment_method, p_external_ref, p_client_token);

  if v_vorher is null then
    update public.purchase_calculations
       set purchase_id = v_id
     where id = p_calculation_id;
  elsif v_vorher <> v_id then
    /*
     * Kann mit Riegel 3 nicht eintreten — steht trotzdem da. Wuerde die
     * Idempotenz je anders antworten, bricht hier alles ab, statt eine
     * Kalkulation still auf einen anderen Einkauf zu zeigen.
     */
    raise exception 'calculation % is linked to purchase %, not %',
      p_calculation_id, v_vorher, v_id
      using errcode = 'unique_violation';
  end if;

  return v_id;
end;
$$;

comment on function public.seller_create_purchase_from_calculation(uuid, date, numeric,
  text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text) is
  'Creates a purchase from a saved calculation and links the two in ONE transaction (0143, ADR-0132). It does NOT create the purchase itself: it calls seller_create_purchase_with_items with all thirteen parameters unchanged, so date validation, the unit ceiling, the cost split and the draft idempotency live in exactly one place. Three guards: the business role, the calculation must belong to the caller (checked explicitly, because SECURITY DEFINER bypasses RLS), and purchase_id must be null - except for a word-for-word repeat of the same browser draft, where the linked purchase already carries that client_token. Takes no price from the calculation: market values and the calculation factor are an assessment, not a cost.';

revoke all on function public.seller_create_purchase_from_calculation(uuid, date, numeric,
  text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text)
  from public, anon;
grant execute on function public.seller_create_purchase_from_calculation(uuid, date, numeric,
  text, boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer  text := '0143 Befund';
  v_src  text;
  v_sig  text := 'uuid, date, numeric, text, boolean, jsonb, text, text, numeric, '
                 || 'numeric, numeric, text, text, text';
begin
  if to_regprocedure('public.seller_create_purchase_from_calculation(' || v_sig || ')')
     is null then
    raise exception '%: die Funktion fehlt', v_wer;
  end if;

  select p.prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_purchase_from_calculation';

  /* Sie ruft die bestehende Funktion auf, statt sie nachzubauen. */
  if position('public.seller_create_purchase_with_items(' in v_src) = 0 then
    raise exception '%: sie ruft seller_create_purchase_with_items nicht auf', v_wer;
  end if;
  /* Und sie legt selbst keinen Einkauf an. */
  if v_src ~* '\minsert\s+into\s+public\.purchases\m' then
    raise exception '%: sie fuegt selbst in purchases ein', v_wer;
  end if;
  /* Die drei Riegel stehen. */
  if position('can_operate_active_seller' in v_src) = 0 then
    raise exception '%: die Betriebsrolle wird nicht geprueft', v_wer;
  end if;
  if position('c.user_id = (select auth.uid())' in v_src) = 0 then
    raise exception '%: der Besitz der Kalkulation wird nicht geprueft', v_wer;
  end if;
  if position('for update' in v_src) = 0 then
    raise exception '%: die Kalkulation wird nicht gesperrt', v_wer;
  end if;
  /* Und kein Preis aus der Kalkulation. */
  if v_src ~* '\m(total_cents|factor_percent|lines)\m' then
    raise exception '%: sie liest einen Wert aus der Kalkulation, der eine Zahl ist', v_wer;
  end if;

  if not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                  where p.oid = to_regprocedure(
                          'public.seller_create_purchase_from_calculation(' || v_sig || ')')
                    and a.privilege_type = 'EXECUTE'
                    and a.grantee::regrole::text = 'authenticated') then
    raise exception '%: authenticated darf sie nicht ausfuehren', v_wer;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = to_regprocedure(
                      'public.seller_create_purchase_from_calculation(' || v_sig || ')')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '%: PUBLIC oder anon darf sie ausfuehren', v_wer;
  end if;

  raise notice '0143 ok: seller_create_purchase_from_calculation steht, ruft '
    'seller_create_purchase_with_items auf, prueft Betriebsrolle, Besitz und '
    'Einmaligkeit, legt selbst keinen Einkauf an, nur fuer authenticated.';
end $$;
-- <<< ENDE: supabase/migrations/0143_purchase_from_calculation.sql

commit;
