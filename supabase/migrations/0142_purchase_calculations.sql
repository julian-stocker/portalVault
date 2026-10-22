-- ===========================================================================
-- 0142 — GESPEICHERTE EINKAUFSKALKULATIONEN (Calculator V2)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Der Kalkulator bewertet Inserate. Die meisten sind uninteressant
-- und sollen nichts hinterlassen; die wenigen interessanten begleiten eine
-- Verhandlung ueber Tage und muessen wiederauffindbar sein. Diese Tabelle
-- haelt genau die zweiten — und ZWANGSLAEUFIG NUR DIE: eine Zeile entsteht
-- ausschliesslich dann, wenn jemand „Speichern" drueckt.
--
-- WAS SIE NICHT IST: der Arbeitsstand. Der liegt im Browser
-- (`localStorage`, `src/lib/calculator/draft.ts`) und kommt hier niemals an.
-- Die Trennung ist der Kern von ADR-0131: automatisch merken heisst nicht
-- automatisch anlegen.
--
-- EINE TABELLE, UND DIE POSITIONEN ALS `jsonb`
--
-- Eine Kindtabelle `purchase_calculation_items` waere relational sauberer
-- und hier trotzdem falsch:
--
--   * Die Positionen sind ein SCHNAPPSCHUSS, kein Verweis. Eine Kalkulation
--     vom Vormonat muss zeigen, womit damals gerechnet wurde — auch wenn der
--     Katalogpreis sich seitdem bewegt hat. Ein Fremdschluessel auf
--     `skylanders` wuerde ausserdem einen Katalogeintrag festhalten, den der
--     Import deaktivieren koennen muss.
--   * Die REIHENFOLGE ist fachlich (zuletzt hinzugefuegt oben, ADR-0131).
--     Ein Array hat sie; eine Kindtabelle braeuchte eine `position`-Spalte
--     und Pflege dafuer.
--   * Speichern ist EIN Vorgang. Ein `update` auf eine Zeile ist atomar;
--     „loeschen und neu einfuegen" in einer Kindtabelle ist es nur mit
--     Transaktion und Sorgfalt.
--
-- Der Preis dafuer: die Datenbank prueft die FORM der Positionen nicht
-- tief. Sie prueft, dass es ein Array ist und wie lang es hoechstens sein
-- darf; jedes Element prueft `decodeLines()` beim Lesen — wie der Warenkorb
-- es seit `ADR-0043` tut, und aus demselben Grund: eine Zeile, die eine
-- aeltere Programmfassung geschrieben hat, muss heute noch lesbar sein.
--
-- WEM EINE ZEILE GEHOERT. `user_id`, und sonst niemandem. Vier Policies,
-- genau das Muster von `collection_items` (ADR-0016): lesen, anlegen,
-- aendern, loeschen — je nur die eigenen Zeilen. KEINE Betriebsrolle:
-- eine gespeicherte Kalkulation ist eine private Notiz, kein
-- Geschaeftsvorfall. Wer den Kalkulator sieht, entscheidet die Oberflaeche
-- (Bequemlichkeit); was jemand lesen darf, entscheidet diese Richtlinie.
--
-- DER SPAETERE WEG INS ORDERBUCH, hier nur VORBEREITET (ADR-0131, Punkt 6):
-- `purchase_id` bleibt `null`, bis eine Kalkulation zu einem Einkauf wird.
-- Ein partieller Unique-Index verhindert, dass zwei Kalkulationen denselben
-- Einkauf beanspruchen, und „schon uebernommen" ist dann einfach
-- `purchase_id is not null`. **Diese Migration schreibt dort nichts und
-- legt keine Bestellung an.** Der Uebernahmeweg selbst kommt spaeter und
-- wird eine `security definer`-Funktion sein — eine Kundenrolle darf
-- `purchases` weder lesen noch anlegen.
--
-- WAS SIE NICHT TUT. Keine Bestellung, kein Einkauf, keine Bewegung, kein
-- Beleg, keine Zahlung, keine Verkaufsfreigabe. Sie fasst keine bestehende
-- Tabelle, Funktion, Richtlinie oder Berechtigung an. Rein additiv.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0142_drop_purchase_calculations.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- `auth.users` und `gen_random_uuid()` braucht die Tabelle; `purchases`
-- braucht der Fremdschluessel. Alle drei stehen seit `0001` bzw. `0053` —
-- gefragt wird trotzdem, damit ein Lauf auf einer unfertigen Datenbank laut
-- scheitert und nicht halb.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('auth.users') is null then
    raise exception '0142 setzt Supabase Auth voraus: auth.users fehlt';
  end if;
  if to_regclass('public.purchases') is null then
    raise exception '0142 setzt 0053 voraus: public.purchases fehlt';
  end if;
  if to_regclass('public.purchase_calculations') is not null then
    raise exception '0142 Abbruch: public.purchase_calculations steht schon';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Tabelle
-- ---------------------------------------------------------------------------
create table public.purchase_calculations (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null,

  -- Der Name, den der Betreiber vergibt: „Willhaben - Sammlung 35 Figuren".
  -- Roh, nur aussen beschnitten (CLAUDE.md Regel 4) — die Oberflaeche
  -- schneidet nichts im Inneren und korrigiert nichts.
  name       text        not null,

  -- Wo die Verhandlung steht. Vier Werte, und mehr soll es nicht geben:
  -- ein Statusfeld, das zur Projektverwaltung wird, ueberlaedt den
  -- Kalkulator (ADR-0131).
  status     text        not null default 'review',

  -- Die Positionen als Schnappschuss: `{"version": 1, "lines": [...]}`.
  -- Form und Elemente: `src/lib/calculator/saved.ts`.
  lines      jsonb       not null default '{"version": 1, "lines": []}'::jsonb,

  -- Der Kalkulationsfaktor dieser Kalkulation, in ganzen Prozent.
  factor_percent smallint not null,

  /*
   * DREI ABGELEITETE ZAHLEN, UND WARUM SIE TROTZDEM IN SPALTEN STEHEN.
   *
   * Die Liste unter dem Kalkulator zeigt Name, Positionen und Gesamtwert.
   * Sie aus `lines` zu rechnen hiesse, bei jedem Aufschlagen der Liste
   * jedes Element jeder Zeile zu lesen — oder die Rechnung in SQL zu
   * wiederholen, die in `calculation.ts` steht. Beides ist schlechter als
   * drei Spalten, die beim Speichern mitgeschrieben werden.
   *
   * Sie sind ABLEITUNG, nicht Wahrheit: wer rechnet, rechnet aus `lines`.
   * Ein CHECK haelt sie plausibel (nicht negativ, Positionen <= Stueck),
   * mehr kann die Datenbank hier nicht leisten, ohne die Rechnung ein
   * zweites Mal zu kennen.
   */
  total_cents integer    not null default 0,
  positions   integer    not null default 0,
  units       integer    not null default 0,

  /*
   * DER SPAETERE EINKAUF. `null` heisst „noch nicht uebernommen".
   *
   * `on delete set null`: wird ein Einkauf geloescht, ist die Kalkulation
   * wieder uebernehmbar — und nicht still mit ihm fort.
   */
  purchase_id bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ein Konto loeschen nimmt seine Kalkulationen mit (DSGVO), wie bei
  -- `collection_items`.
  constraint purchase_calculations_user_fk foreign key (user_id)
    references auth.users (id) on update cascade on delete cascade,

  constraint purchase_calculations_purchase_fk foreign key (purchase_id)
    references public.purchases (id) on update cascade on delete set null,

  -- Ein Name ist Pflicht und hat eine Obergrenze; leer ist kein Name.
  constraint purchase_calculations_name_shape
    check (length(btrim(name)) between 1 and 120),

  constraint purchase_calculations_status_known
    check (status in ('review', 'negotiating', 'bought', 'rejected')),

  -- Der Faktor ist derselbe Bereich wie im Eingabefeld (`clampFactor`).
  constraint purchase_calculations_factor_range
    check (factor_percent between 0 and 100),

  /*
   * DIE FORM DER POSITIONEN, soweit ein CHECK sie sehen kann.
   *
   * Ein Objekt mit `version` und einem Array `lines`, und das Array hat
   * hoechstens 200 Elemente — dieselbe Decke wie
   * `seller_create_purchase_with_items` (0064), damit eine Kalkulation
   * uebernehmbar bleibt, ohne dort anzustossen.
   */
  constraint purchase_calculations_lines_shape
    check (jsonb_typeof(lines) = 'object'
           and jsonb_typeof(lines -> 'lines') = 'array'
           and jsonb_array_length(lines -> 'lines') <= 200),

  constraint purchase_calculations_counts_sane
    check (total_cents >= 0 and positions >= 0 and units >= 0
           and positions <= units and units <= 20000)
);

comment on table public.purchase_calculations is
  'Deliberately saved purchase calculations, one row per calculation, owned by the user who saved it (0142, ADR-0131). The working draft of the calculator is NOT here - it lives in the browser. `lines` is a snapshot, not a reference: an old calculation must still show what it was calculated with. `purchase_id` prepares the later handover into the orderbook and is null until then; this migration creates no purchase and touches no existing object.';

comment on column public.purchase_calculations.lines is
  'Snapshot of the calculation lines: {"version": 1, "lines": [{sky_id, name, series, image, suggested_cents, unit_cents, quantity, manual}]}. Order is meaningful - most recently added first. Element shape is validated on read (src/lib/calculator/saved.ts), not by a CHECK.';

comment on column public.purchase_calculations.purchase_id is
  'The purchase this calculation became, once it was handed over to the orderbook. Null means not handed over - which is what prevents a second handover. Set only by the future handover path, never by the client.';


-- ---------------------------------------------------------------------------
-- 3. Zugriffswege
--
-- Die Liste wird nach letzter Aenderung sortiert und immer je Konto gelesen
-- — ein zusammengesetzter Index trifft genau diese Abfrage.
-- ---------------------------------------------------------------------------
create index purchase_calculations_user_updated_idx
  on public.purchase_calculations (user_id, updated_at desc);

/*
 * EIN EINKAUF, HOECHSTENS EINE KALKULATION.
 *
 * Partiell, weil `null` der Normalfall ist und beliebig oft vorkommen
 * muss. Dieser Index ist die halbe Antwort auf „nicht zweimal uebernehmen":
 * die andere Haelfte ist, dass die Uebernahme nur laeuft, wenn
 * `purchase_id is null` ist.
 */
create unique index purchase_calculations_purchase_uniq
  on public.purchase_calculations (purchase_id) where purchase_id is not null;


-- ---------------------------------------------------------------------------
-- 4. `updated_at` pflegt die Datenbank
--
-- Nicht der Client: „letzte Aenderung" ist genau der Zeitpunkt, an dem die
-- Zeile geschrieben wurde, und den kennt nur die Datenbank. Dieselbe
-- Hilfsfunktion, die `0001` fuer `skylanders`, `profiles` und
-- `collection_items` benutzt — eine zweite waere eine zweite Wahrheit
-- darueber, was „geaendert" heisst.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '0142 setzt 0001 voraus: set_updated_at() fehlt';
  end if;
end $$;

create trigger purchase_calculations_set_updated_at
  before update on public.purchase_calculations
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 5. Row Level Security — vier Policies, das Muster von `collection_items`
--
-- `(select auth.uid()) = user_id`, und bei `update` BEIDE Haelften: `using`
-- entscheidet, welche Zeilen geaendert werden duerfen, `with check`, was sie
-- werden duerfen. Ohne `with check` koennte jemand seine eigene Zeile einem
-- anderen Konto zuschieben (derselbe Kommentar steht in `0001`).
--
-- Kein `anon`: eine Kalkulation ohne Konto gibt es nicht. Der Arbeitsstand
-- im Browser braucht keines — das ist der Unterschied.
-- ---------------------------------------------------------------------------
alter table public.purchase_calculations enable row level security;

create policy purchase_calculations_select_own on public.purchase_calculations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy purchase_calculations_insert_own on public.purchase_calculations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy purchase_calculations_update_own on public.purchase_calculations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy purchase_calculations_delete_own on public.purchase_calculations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

/*
 * DIE ZWEITE SCHICHT: TABELLENRECHTE — UND ZWAR DURCH ENTZIEHEN.
 *
 * Supabase setzt `ALTER DEFAULT PRIVILEGES` auf das Schema `public`: `anon`,
 * `authenticated` und `service_role` bekommen bei JEDEM `create table`
 * automatisch `ALL`. **`grant` ist additiv und entzieht nichts** — die
 * gewuenschten Rechte zu vergeben genuegt also nicht, alles Unerwuenschte
 * muss ausdruecklich entzogen werden (`docs/SECURITY.md`, zweite Schicht).
 *
 * Fuer diese Tabelle heisst das:
 *
 *   * `anon` bekommt GAR NICHTS. Eine Kalkulation ohne Konto gibt es nicht,
 *     und die Richtlinien wuerden ihn ohnehin abweisen — aber ein Recht,
 *     das niemand braucht, gehoert entzogen und nicht uebersehen.
 *   * `authenticated` bekommt die vier, die die Oberflaeche braucht, und
 *     NICHT `truncate`: dafuer gilt RLS nicht. Das Recht ist das Einzige,
 *     was zwischen einem Client und einer geleerten Tabelle steht. Auch
 *     `references` und `trigger` haben hier keinen Zweck.
 *
 * Dieselbe Folge wie bei `profiles` und `collection_items` in `0001`.
 */
revoke all on public.purchase_calculations from anon;

grant select, insert, update, delete on public.purchase_calculations to authenticated;
revoke truncate, references, trigger on public.purchase_calculations from authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
--
-- Die Migration prueft sich selbst, wie `0135` bis `0141`: Tabelle, Spalten,
-- vier Policies, RLS an, zwei Indizes, der Trigger, die Rechte — und dass
-- keine Zeile entstanden ist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer     text := '0142 Befund';
  v_n       integer;
  v_spalten text;
begin
  if to_regclass('public.purchase_calculations') is null then
    raise exception '%: die Tabelle fehlt', v_wer;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
    into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'purchase_calculations';
  if v_spalten <> 'id,user_id,name,status,lines,factor_percent,total_cents,'
                 || 'positions,units,purchase_id,created_at,updated_at' then
    raise exception '%: die Spalten sind "%"', v_wer, v_spalten;
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.purchase_calculations'::regclass) then
    raise exception '%: RLS ist nicht eingeschaltet', v_wer;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'purchase_calculations';
  if v_n <> 4 then
    raise exception '%: % Policies statt 4', v_wer, v_n;
  end if;

  -- Keine Policy darf `anon` einschliessen.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'purchase_calculations'
     and 'anon' = any (roles);
  if v_n <> 0 then
    raise exception '%: % Policy(s) gelten fuer anon', v_wer, v_n;
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'purchase_calculations_purchase_uniq') then
    raise exception '%: der Unique-Index auf purchase_id fehlt', v_wer;
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.purchase_calculations'::regclass
                    and tgname = 'purchase_calculations_set_updated_at') then
    raise exception '%: der updated_at-Trigger fehlt', v_wer;
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public'
                and table_name = 'purchase_calculations'
                and grantee = 'anon') then
    raise exception '%: anon hat ein Tabellenrecht', v_wer;
  end if;

  /*
   * Und `authenticated` hat genau die vier — insbesondere KEIN `truncate`:
   * dafuer gilt RLS nicht, das Recht ist dort die einzige Schicht.
   */
  select string_agg(distinct privilege_type, ',' order by privilege_type)
    into v_spalten
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'purchase_calculations'
     and grantee = 'authenticated';
  if coalesce(v_spalten, '') <> 'DELETE,INSERT,SELECT,UPDATE' then
    raise exception '%: authenticated hat die Rechte "%"', v_wer,
      coalesce(v_spalten, '(keine)');
  end if;

  select count(*) into v_n from public.purchase_calculations;
  if v_n <> 0 then
    raise exception '%: die Migration hat % Zeile(n) angelegt', v_wer, v_n;
  end if;

  raise notice '0142 ok: purchase_calculations steht, 12 Spalten, RLS an, '
    '4 Policies (ohne anon), 2 Indizes, updated_at-Trigger, 0 Zeilen. '
    'Kein Einkauf, keine Bestellung, keine bestehende Funktion beruehrt.';
end $$;
