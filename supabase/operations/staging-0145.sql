-- ===========================================================================
-- STAGING — EIN LAUF FUER 0145
--            (die Favoriten: Wunschliste eines Sammlers)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Nichts in Teilen: jede Zeile gehoert zur selben Klammer, und ein Fehler
-- irgendwo rollt ALLES zurueck.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: laeuft das hier wirklich auf Staging?
--   B   Migration 0145, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0145_favorites.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- WAS SIE TUT: sie legt `public.favorites` an (drei Spalten, Primaerschluessel
-- `(user_id, sky_id)`, RLS, drei Richtlinien, ein Index) und
-- `public.favorite_demand()` — eine Aggregatfunktion, die dem Betrieb Zahlen
-- gibt und niemals Zeilen.
--
-- WAS SIE NICHT TUT: keine bestehende Tabelle, Spalte, Richtlinie, Funktion
-- oder Berechtigung. Sie liest keine Zeile und schreibt keine. Sie fasst
-- Sammlung, Shop, Lager, Bestellungen, Belegsperre und Verkaufsfreigaben
-- nicht an. Keine Benachrichtigung, keine E-Mail, kein `seller_id` — ADR-0021
-- gilt unveraendert (ADR-0136).
--
-- DREI RIEGEL IN DER MIGRATION SELBST: `0042` und `0041` muessen stehen, die
-- Tabelle darf noch nicht da sein, und ein zweiter Lauf prallt ab. Probelauf
-- **P52** fährt alle drei an echtem PostgreSQL nach.
--
-- RUECKNAHME: `supabase/rollback/R0145_drop_favorites.sql` — sie bricht ab,
-- solange Zeilen stehen, und nimmt die Funktion mit der Tabelle fort.
--
-- VOR DEM LAUF `staging-s-preflight-0145.sql` fahren, DANACH
-- `staging-s-postflight-0145.sql` — der SQL-Editor zeigt `NOTICE`-Meldungen
-- nicht an, und die Zeilen 900 und 901 des Preflights gehoeren in die
-- Nachkontrolle.
--
-- NACH DEM LAUF: `npm run verify:rls:staging`. Eine Richtlinie, die DA steht,
-- ist nicht dasselbe wie eine, die GREIFT — und ob ein fremdes Konto eine
-- fremde Wunschliste sieht, beantwortet nur ein Lauf mit zwei echten Konten.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeile der Migration, und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0145_favorites.sql
-- ===========================================================================
-- 0145 — FAVORITEN (Wunschliste eines Sammlers)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Ein Sammler will vormerken, was ihm fehlt — unabhaengig davon, ob
-- es heute kaufbar ist und unabhaengig davon, was er schon besitzt. Genau
-- das ist eine Sammlerfunktion und nichts weiter.
--
-- WAS SIE AUSDRUECKLICH NICHT IST (ADR-0136). Kein Marketplace-Baustein.
-- ADR-0021 fuehrt `wishlist_items` in der Liste dessen, was „dokumentiert,
-- aber nicht gebaut" ist, und dieser Stopp gilt unveraendert. Deshalb heisst
-- diese Tabelle `favorites`: der dort beschriebene Andockpunkt bleibt frei,
-- samt seiner `priority`-Spalte, die hier fehlt und fehlen soll. Keine
-- Angebote, kein Tausch, kein Handel, kein `seller_id`.
--
-- WAS SIE NICHT IST: der Gesammelt-Status. Favorit und Besitz sind zwei
-- unabhaengige Aussagen ueber dieselbe Figur, und ADR-0027 hat das schon
-- 2026-09 so entschieden („keine Wunschlisten-Semantik" am Owned-Toggle).
-- Beide Tabellen stehen nebeneinander; keine liest die andere.
--
-- DREI ABWEICHUNGEN VON `collection_items`, JEDE MIT GRUND
--
--   1. KEIN SURROGATSCHLUESSEL. `collection_items` traegt eine `id uuid`,
--      weil dort spaeter mehrere Zeilen je Konto und Figur stehen koennen
--      (Zustand je Exemplar, `docs/DATABASE.md` Abschnitt 7). Ein Favorit
--      kennt diesen Fall nicht: es gibt ihn oder es gibt ihn nicht. Der
--      Primaerschluessel IST deshalb `(user_id, sky_id)`. Die geforderte
--      Eindeutigkeit ist damit die Struktur selbst und nicht eine
--      Nebenbedingung, die jemand spaeter loesen koennte.
--
--   2. KEIN `updated_at` UND KEIN TRIGGER. Eine Zeile hat kein Feld, das
--      sich aendern kann. Ein Zeitstempel fuer „zuletzt geaendert" waere
--      immer gleich `created_at`.
--
--   3. KEINE `update`-RICHTLINIE UND KEIN `update`-RECHT. Aus demselben
--      Grund: es gibt nichts zu aendern. Favorisieren ist ein `insert`,
--      Entfavorisieren ein `delete`. Ein Weg, den niemand braucht, wird
--      nicht eroeffnet — das ist die engere und damit die richtige Fassung
--      von „keine fremden Favoriten aendern".
--
-- WEM EINE ZEILE GEHOERT. `user_id`, und sonst niemandem. Das Muster von
-- `collection_items` NACH `0042`: `(select auth.uid()) = user_id` UND
-- `public.is_collector_account()`. Die zweite Haelfte ist kein Beiwerk —
-- ein Betriebs- oder Adminkonto sammelt nicht im eigenen Katalog, und was
-- fuer die Sammlung gilt, gilt fuer die Wunschliste. Wird ein Konto spaeter
-- zum Betrieb, verschwinden seine Favoriten aus der Sicht und bleiben in der
-- Tabelle; wird die Rolle zurueckgenommen, sind sie wieder da. Genau wie
-- die Sammlung (0042).
--
-- DIE NACHFRAGEZAHL. `favorite_demand()` beantwortet dem Betrieb „wie viele
-- Konten haben diese Figur vorgemerkt" — und nur das. `security definer`,
-- weil RLS dem Betrieb hier zu Recht KEINE Zeile zeigt; die Funktion ist der
-- einzige Weg, und sie gibt ausschliesslich `(sky_id, users)` zurueck. Keine
-- Kennung, keine Adresse, kein Zeitpunkt, keine Zeile. Dasselbe Prinzip, das
-- interne Notizen in `catalog_editorial` haelt: ein Tabellenrecht kennt
-- keine Spalten, eine Funktion schon.
--
-- WAS SIE NICHT TUT. Keine Bestellung, kein Einkauf, keine Bewegung, kein
-- Beleg, keine Zahlung, keine Verkaufsfreigabe, keine Benachrichtigung. Sie
-- fasst keine bestehende Tabelle, Funktion, Richtlinie oder Berechtigung an.
-- Rein additiv.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0145_drop_favorites.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- `auth.users` traegt den Besitzer, `skylanders` die Figur, und
-- `is_collector_account()` entscheidet in jeder Richtlinie mit. Alle drei
-- stehen seit `0001` bzw. `0042` — gefragt wird trotzdem, damit ein Lauf auf
-- einer unfertigen Datenbank laut scheitert und nicht halb.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('auth.users') is null then
    raise exception '0145 setzt Supabase Auth voraus: auth.users fehlt';
  end if;
  if to_regclass('public.skylanders') is null then
    raise exception '0145 setzt 0001 voraus: public.skylanders fehlt';
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception '0145 setzt 0042 voraus: is_collector_account() fehlt';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0145 setzt 0041 voraus: can_operate_active_seller() fehlt';
  end if;
  if to_regclass('public.favorites') is not null then
    raise exception '0145 Abbruch: public.favorites steht schon';
  end if;
  if to_regprocedure('public.favorite_demand(text[])') is not null then
    raise exception '0145 Abbruch: favorite_demand(text[]) steht schon';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Tabelle
-- ---------------------------------------------------------------------------
create table public.favorites (
  user_id    uuid        not null,
  sky_id     text        not null,

  -- Wann vorgemerkt. Die Wunschliste sortiert danach, und spaeter ist es die
  -- Antwort auf „seit wann wartet jemand darauf".
  created_at timestamptz not null default now(),

  -- Das Konto loeschen heisst die Wunschliste mitloeschen (DSGVO), genau wie
  -- bei `collection_items`.
  constraint favorites_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  -- RESTRICT, nicht CASCADE: eine Katalogzeile darf nicht unter einer
  -- Wunschliste wegbrechen. Der Import deaktiviert ueber `is_active` statt zu
  -- loeschen — derselbe Kommentar steht an `collection_items` in `0001`.
  constraint favorites_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete restrict,

  -- EIN KONTO, EINE FIGUR, HOECHSTENS EIN FAVORIT.
  --
  -- Der Primaerschluessel selbst, nicht ein zusaetzlicher Unique-Index:
  -- „doppelter Favorit" ist damit kein Zustand, den die Datenbank
  -- ueberhaupt kennt. Varianten sind ueber ihre eigene SKY-ID getrennte
  -- Zeilen — eine Legendary ist eine andere Figur als ihre Basisfigur, und
  -- der Schluessel sagt das, ohne es zu wissen (ADR-0002, ADR-0034).
  constraint favorites_pk primary key (user_id, sky_id)
);

comment on table public.favorites is
  'Vorgemerkte Figuren eines Sammlers (0145, ADR-0136). Privat, Besitzer allein. Unabhaengig von collection_items: Favorit und Besitz sind zwei Aussagen. Kein Marketplace-Baustein - ADR-0021 gilt, und der dort beschriebene Andockpunkt wishlist_items bleibt frei.';

comment on column public.favorites.sky_id is
  'Die Figur. Varianten sind getrennte SKY-IDs und damit getrennte Favoriten (ADR-0002).';


-- ---------------------------------------------------------------------------
-- 3. Zugriffswege
--
-- Der Primaerschluessel indiziert `(user_id, sky_id)` mit `user_id` vorn —
-- das deckt „die Wunschliste dieses Kontos" und „ist diese Figur vorgemerkt"
-- bereits ab. Was fehlt, ist die andere Richtung.
-- ---------------------------------------------------------------------------

/*
 * DIE NACHFRAGE-RICHTUNG.
 *
 * `favorite_demand()` gruppiert nach `sky_id` ueber die ganze Tabelle. Ohne
 * diesen Index waere das bei jeder Lagerseite ein Seq Scan. Derselbe Grund,
 * aus dem `collection_items` seit `0001` einen Index auf `sky_id` hat.
 */
create index favorites_sky_id_idx
  on public.favorites (sky_id);


-- ---------------------------------------------------------------------------
-- 4. Row Level Security — drei Richtlinien
--
-- Nicht vier: es gibt kein `update`, weil es nichts zu aendern gibt (siehe
-- Kopf, Abweichung 3). Wo `collection_items` `using` und `with check`
-- braucht, um zu verhindern, dass jemand seine Zeile einem fremden Konto
-- zuschiebt, gibt es diesen Weg hier gar nicht.
--
-- Kein `anon`: einen Favoriten ohne Konto gibt es nicht.
-- ---------------------------------------------------------------------------
alter table public.favorites enable row level security;

create policy favorites_select_own on public.favorites
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_collector_account());

create policy favorites_delete_own on public.favorites
  for delete to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

/*
 * DIE ZWEITE SCHICHT: TABELLENRECHTE — UND ZWAR DURCH ENTZIEHEN.
 *
 * Supabase setzt `ALTER DEFAULT PRIVILEGES` auf das Schema `public`: `anon`,
 * `authenticated` und `service_role` bekommen bei JEDEM `create table`
 * automatisch `ALL`. **`grant` ist additiv und entzieht nichts**
 * (`docs/SECURITY.md`, zweite Schicht).
 *
 *   * `anon` bekommt GAR NICHTS.
 *   * `authenticated` bekommt die DREI, die die Oberflaeche braucht — und
 *     weder `update` (es gibt nichts zu aendern) noch `truncate` (dafuer
 *     gilt RLS nicht; das Recht ist das Einzige, was zwischen einem Client
 *     und einer geleerten Tabelle steht) noch `references` oder `trigger`.
 */
revoke all on public.favorites from anon;

grant select, insert, delete on public.favorites to authenticated;
revoke update, truncate, references, trigger on public.favorites from authenticated;


-- ---------------------------------------------------------------------------
-- 5. favorite_demand() — Zahlen fuer den Betrieb, niemals Zeilen
--
-- WARUM `security definer`. Die Richtlinien oben zeigen einem Betriebskonto
-- bewusst KEINE Zeile. Das ist richtig so und soll so bleiben — der Betrieb
-- hat kein Recht, fremde Wunschlisten zu lesen. Was er braucht, ist eine
-- ZAHL: wie viele Konten warten auf diese Figur. Eine Funktion kann genau
-- das geben, ein Tabellenrecht nicht: ein Grant kennt keine Spalten.
--
-- WAS SIE PREISGIBT. `(sky_id, users)`. Keine Kennung, keine Adresse, kein
-- Zeitpunkt, keine Zeile, keine Sortierung nach Konto. Aus dem Ergebnis
-- laesst sich nicht sagen, WER vorgemerkt hat — nur WIE VIELE.
--
-- WER SIE AUFRUFEN DARF. `can_operate_active_seller()` — dasselbe Tor, das
-- jede andere `seller_*`-Funktion fragt und das die `/business`-Route vor dem
-- Rendern fragt. Ein Plattformadministrator ist bewusst NICHT zugelassen
-- (0042): er betreibt die Plattform, nicht den Einkauf.
--
-- NULLEN FEHLEN, UND DAS IST ABSICHT. Figuren ohne einen einzigen Favoriten
-- kommen nicht vor. Der Aufrufer setzt fehlende auf 0 — das ist eine Zeile
-- Code und spart bei 820 Katalogzeilen den groessten Teil der Antwort.
-- ---------------------------------------------------------------------------
create or replace function public.favorite_demand(p_sky_ids text[] default null)
returns table (sky_id text, users integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Eine Decke gegen den Unfall, nicht gegen den Angreifer: wer die Funktion
   * aufrufen darf, ist der Betrieb. Sie faengt eine Schleife ab, die einmal
   * zu oft anhaengt. Der Katalog hat gut 820 Zeilen.
   */
  if p_sky_ids is not null and array_length(p_sky_ids, 1) > 2000 then
    raise exception 'favorite_demand: % SKY-IDs sind zu viele (max 2000)',
      array_length(p_sky_ids, 1);
  end if;

  return query
    select f.sky_id, count(*)::integer as users
      from public.favorites f
     where p_sky_ids is null or f.sky_id = any (p_sky_ids)
     group by f.sky_id
     order by f.sky_id;
end;
$$;

comment on function public.favorite_demand(text[]) is
  'Wie viele Konten eine Figur vorgemerkt haben (0145). Nur aggregiert - niemals eine Zeile, eine Kennung oder ein Zeitpunkt. Nur fuer ein aktives Betriebskonto; ein Plattformadministrator ist nicht zugelassen (0042). Figuren ohne Favorit fehlen im Ergebnis.';

revoke all on function public.favorite_demand(text[]) from public, anon;
grant execute on function public.favorite_demand(text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
--
-- Die Migration prueft sich selbst, wie `0135` bis `0144`: Tabelle, Spalten,
-- Primaerschluessel, Fremdschluessel, drei Richtlinien, RLS an, der Index,
-- die Rechte, die Funktion samt Tor — und dass keine Zeile entstanden ist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer     text := '0145 Befund';
  v_n       integer;
  v_spalten text;
begin
  if to_regclass('public.favorites') is null then
    raise exception '%: die Tabelle fehlt', v_wer;
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
    into v_spalten
    from information_schema.columns
   where table_schema = 'public' and table_name = 'favorites';
  if v_spalten <> 'user_id,sky_id,created_at' then
    raise exception '%: die Spalten sind "%"', v_wer, v_spalten;
  end if;

  -- Der Primaerschluessel IST die Eindeutigkeit, und zwar ueber beide Spalten
  -- in dieser Reihenfolge.
  select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
    into v_spalten
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.favorites'::regclass and c.contype = 'p';
  if coalesce(v_spalten, '(keiner)') <> 'user_id,sky_id' then
    raise exception '%: der Primaerschluessel ist "%"', v_wer,
      coalesce(v_spalten, '(keiner)');
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.favorites'::regclass) then
    raise exception '%: RLS ist nicht eingeschaltet', v_wer;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'favorites';
  if v_n <> 3 then
    raise exception '%: % Richtlinien statt 3', v_wer, v_n;
  end if;

  -- Keine Richtlinie darf `anon` einschliessen.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'favorites'
     and 'anon' = any (roles);
  if v_n <> 0 then
    raise exception '%: % Richtlinie(n) gelten fuer anon', v_wer, v_n;
  end if;

  -- Und jede der drei fragt BEIDE Haelften: das eigene Konto und die Rolle.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'favorites'
     and coalesce(qual, with_check) like '%is_collector_account()%'
     and coalesce(qual, with_check) like '%auth.uid()%';
  if v_n <> 3 then
    raise exception '%: nur % von 3 Richtlinien fragen Konto UND Rolle', v_wer, v_n;
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'favorites_sky_id_idx') then
    raise exception '%: der Index auf sky_id fehlt', v_wer;
  end if;

  -- Die Katalogzeile darf nicht unter einer Wunschliste wegbrechen.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.favorites'::regclass
                    and conname = 'favorites_sky_fk' and confdeltype = 'r') then
    raise exception '%: favorites_sky_fk ist nicht ON DELETE RESTRICT', v_wer;
  end if;

  -- Das Konto loeschen loescht die Wunschliste mit.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.favorites'::regclass
                    and conname = 'favorites_user_fk' and confdeltype = 'c') then
    raise exception '%: favorites_user_fk ist nicht ON DELETE CASCADE', v_wer;
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'favorites'
                and grantee = 'anon') then
    raise exception '%: anon hat ein Tabellenrecht', v_wer;
  end if;

  -- `authenticated` hat genau die drei. Kein `update`, kein `truncate`.
  select string_agg(distinct privilege_type, ',' order by privilege_type)
    into v_spalten
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'favorites'
     and grantee = 'authenticated';
  if coalesce(v_spalten, '') <> 'DELETE,INSERT,SELECT' then
    raise exception '%: authenticated hat die Rechte "%"', v_wer,
      coalesce(v_spalten, '(keine)');
  end if;

  -- Die Funktion: da, definer, stable, genau eine leere search_path-Festlegung.
  if to_regprocedure('public.favorite_demand(text[])') is null then
    raise exception '%: favorite_demand(text[]) fehlt', v_wer;
  end if;

  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'favorite_demand'
     and p.prosecdef and p.provolatile = 's';
  if v_n <> 1 then
    raise exception '%: favorite_demand ist nicht genau einmal definer+stable', v_wer;
  end if;

  /*
   * Ausgepackt, nicht verglichen: PostgreSQL legt `set search_path = ''` als
   * `search_path=""` ab. Ein Textvergleich gegen ein Literal waere ein
   * Fehlalarm in Wartestellung (`migration-integrity.test.ts`).
   */
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, '{}')) c
   where n.nspname = 'public' and p.proname = 'favorite_demand'
     and c like 'search\_path=%';
  if v_n <> 1 then
    raise exception '%: favorite_demand hat % search_path-Festlegungen statt 1',
      v_wer, v_n;
  end if;

  -- Und sie fragt das Betriebs-Tor, bevor sie etwas zaehlt.
  if not exists (select 1 from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'favorite_demand'
                   and p.prosrc like '%can_operate_active_seller()%') then
    raise exception '%: favorite_demand fragt can_operate_active_seller() nicht', v_wer;
  end if;

  -- Kein EXECUTE fuer PUBLIC oder anon.
  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.favorite_demand(text[])')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_n <> 0 then
    raise exception '%: favorite_demand ist fuer PUBLIC oder anon ausfuehrbar', v_wer;
  end if;

  select count(*) into v_n from public.favorites;
  if v_n <> 0 then
    raise exception '%: die Migration hat % Zeile(n) angelegt', v_wer, v_n;
  end if;

  raise notice '0145 ok: favorites steht, 3 Spalten, PK (user_id, sky_id), '
    'RLS an, 3 Richtlinien (ohne anon, alle mit Rollenpruefung), Index auf '
    'sky_id, Rechte SELECT/INSERT/DELETE, favorite_demand() definer+stable '
    'hinter can_operate_active_seller(), 0 Zeilen. Keine bestehende Tabelle, '
    'Funktion, Richtlinie oder Berechtigung beruehrt.';
end $$;
-- <<< ENDE: supabase/migrations/0145_favorites.sql

commit;
