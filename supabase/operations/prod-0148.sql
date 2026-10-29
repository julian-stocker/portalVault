-- ========================================================================
-- PRODUCTION — EIN LAUF FUER 0148
--              (die Meldung bekommt eine Tabelle, und niemand bekommt eine)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen: jede Zeile gehoert zur selben Klammer, und
-- ein Fehler irgendwo rollt ALLES zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert (`0132` und `0133` landeten unbeabsichtigt auf Production).
-- Diese Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS SIE TUT: sie legt `public.availability_notifications` an (fuenf
-- Spalten, Primaerschluessel `(user_id, sky_id, buyable_since)`, zwei
-- Fremdschluessel — `skylanders` RESTRICT, `auth.users` CASCADE), einen
-- Index, RLS mit GENAU EINER Richtlinie (nur lesen, nur das Eigene) und
-- `claim_availability_notifications()`.
--
-- DER PRIMAERSCHLUESSEL IST DER DUPLIKATSCHUTZ. „Genau eine Meldung je
-- Nutzer, Figur und Phase" ist damit eine Eigenschaft der Datenbank und
-- keine Zusage der Anwendungslogik. Zeile 103 der Nachkontrolle misst ihn.
--
-- WAS SIE NICHT TUT: **sie legt keine Meldung an**. Die Tabelle ist nach der
-- Migration leer — Zeile 106 der Nachkontrolle misst das. Verarbeitet wird
-- erst beim Aufruf von `claim_availability_notifications()`, und dieser
-- Aufruf gehoert nicht hierher. Sie legt auch **keinen Trigger** an, weder
-- auf der neuen Tabelle noch auf `favorites` oder `offer_state`; damit kann
-- die Benachrichtigung strukturell keinen Kauf erreichen. Und sie fasst
-- keine bestehende Tabelle, Spalte, Richtlinie oder Berechtigung an.
--
-- DIE ERSTE MIGRATION DIESER KETTE, DIE EIN CLIENTRECHT VERGIBT: `grant
-- select` und `grant execute` fuer `authenticated`. Mehr nicht — kein
-- `insert`, `update` oder `delete` fuer Clients, und fuer `anon` und
-- `PUBLIC` gar nichts. Die Zeilen 111 bis 119 der Nachkontrolle messen
-- jedes Stueck davon einzeln.
--
-- SECHS RIEGEL IN DER MIGRATION SELBST: `favorites` (0145), `offer_state`
-- (0146), `offer_availability_due()` und `offer_availability_grace()`
-- (0147), `is_collector_account()` (0042) und `offer_state.buyable_since`
-- muessen stehen — fehlt eines, bricht sie mit einem Satz ab, der die
-- fehlende Migration nennt. Ein zweiter Lauf prallt an der Tabelle ab.
--
-- RUECKNAHME: `supabase/rollback/R0148_availability_notifications.sql`.
--
-- VOR DEM LAUF `prod-s-preflight-0148.sql`, DANACH
-- `prod-s-postflight-0148.sql` — die Nachkontrolle braucht die Zeilen 900
-- und 901 des Preflights.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeile der Migration, und `commit`.
-- ========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0148.sql.';
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

-- >>> EINGEBETTET: supabase/migrations/0148_availability_notifications.sql
-- ===========================================================================
-- 0148 — PERSOENLICHE VERFUEGBARKEITSMELDUNGEN (Phase 4, Schritt S3)
--
-- WAS SIE TUT: aus einem erkannten Verfuegbarkeitsereignis werden
-- persoenliche Meldungen. Je betroffener Nutzer genau eine, dauerhaft
-- gespeichert, durch RLS geschuetzt.
--
-- WAS SIE NICHT TUT: keine E-Mail, keine Push-Nachricht, kein Preisalarm,
-- kein Scheduler, keine Einstellung, keine Oberflaeche. Anzeige,
-- Ungelesen-Zaehler und „als gelesen markieren" sind S4 — deshalb hat diese
-- Tabelle KEINE `read_at`-Spalte und KEINEN Schreibweg fuer Clients. Eine
-- Spalte anzulegen, deren Mechanik noch fehlt, waere Vorbereiten, und das
-- ist in diesem Projekt kein Verfahren (ADR-0021, ADR-0136).
--
-- ===========================================================================
-- DER PRIMAERSCHLUESSEL IST DER DUPLIKATSCHUTZ
-- ===========================================================================
--
--   primary key (user_id, sky_id, buyable_since)
--
-- Damit ist „genau eine Meldung je Nutzer, Figur und Verfuegbarkeitsphase"
-- keine Zusage der Anwendungslogik, sondern eine Eigenschaft der Datenbank.
-- Zwei gleichzeitige Aufrufe koennen sie nicht verletzen, ein wiederholter
-- Seitenaufruf auch nicht, und ein spaeterer Fehler in einer Funktion
-- ebenfalls nicht.
--
-- UND GENAU DESHALB IST `buyable_since` TEIL DES SCHLUESSELS und nicht nur
-- eine Beigabe: sie IST die Phase (`0147`). Wird eine Figur wirklich wieder
-- unverfuegbar und danach erneut verfuegbar, bekommt sie eine neue
-- Phasengrenze — und damit entsteht ein neuer Schluessel und zu Recht eine
-- neue Meldung. Eine kurze Warenkorbreservierung aendert sie dagegen NICHT
-- (`0147` uebernimmt die Phase, wenn die Abwesenheit kuerzer war als
-- `reservation_ttl()`), also entsteht dort auch keine.
--
-- ===========================================================================
-- DIE VERARBEITUNG IST EINE EINZIGE ANWEISUNG
-- ===========================================================================
--
-- `claim_availability_notifications()` besteht aus EINEM `with`-Ausdruck:
--
--   faellig       `offer_availability_due()` — die Erkennung aus `0147`,
--                 samt Gegenprobe gegen `offer_state_live`. KEINE zweite
--                 Erkennung, keine zweite Definition von „kaufbar".
--   beansprucht   das `update` auf `offer_state`, das die
--                 Faelligkeitsbedingung als `where` MITTRAEGT und
--                 `announced_*` setzt.
--   gemeldet      das `insert`, das aus dem `returning` des `update` liest.
--
-- WARUM EINE ANWEISUNG UND NICHT DREI: eine Anweisung ist atomar. Es gibt
-- keinen Zustand, in dem ein Ereignis als verarbeitet gilt und die Meldungen
-- fehlen — nicht einmal fuer einen Augenblick, nicht bei einem Fehler, nicht
-- bei einem Verbindungsabbruch. Das `insert` liest aus dem `returning` des
-- `update`, kann also nur fuer Zeilen schreiben, die DIESE Anweisung
-- beansprucht hat.
--
-- WIE GLEICHZEITIGKEIT AUSGEHT. PostgreSQL nimmt fuer das `update` eine
-- Zeilensperre. Ein zweiter Aufruf wartet darauf und prueft sein `where`
-- danach gegen die NEUE Fassung der Zeile (READ COMMITTED): dort steht
-- `announced_at` auf jetzt, `buyable_since > announced_at` ist falsch, und
-- er beansprucht null Zeilen. Also schreibt er auch keine Meldung. Die
-- Bedingung IST der Riegel — deshalb steht sie an der Zeile und nicht in
-- einer Hilfsfunktion (eine `stable` Funktion im `where` saehe den
-- Schnappschuss der Anweisung und sagte nach dem Warten weiter `true`).
--
-- `on conflict do nothing` ist der Guertel zum Hosentraeger: faellt der
-- Riegel je aus, haelt der Primaerschluessel.
--
-- ===========================================================================
-- WER BENACHRICHTIGT WIRD
-- ===========================================================================
--
--   favorites.created_at < offer_state.buyable_since
--
-- Also: wer vorgemerkt hat, BEVOR die Figur kaufbar wurde. Wer eine bereits
-- kaufbare Figur vormerkt, bekommt fuer diese Phase nichts — er hat sie ja
-- kaufbar gesehen. Dass `buyable_since` dafuer verlaesslich ist, ist die
-- ganze Begruendung von `0147`: `changed_at` bewegt sich auch bei einer
-- PREISAENDERUNG und haette genau hier falsch benachrichtigt.
--
-- EXAKT DIE SKY-ID, nie eine Variante. Der Verbund laeuft ueber `sky_id`,
-- und das ist die Identitaet des Sammelobjekts (ADR-0034). Zwei Varianten
-- derselben Figur sind zwei SKY-IDs und zwei unabhaengige Vorgaenge.
--
-- ===========================================================================
-- WARUM DIE FUNKTION NICHTS UEBER ANDERE NUTZER ZURUECKGIBT
-- ===========================================================================
--
-- Sie gibt EINE Zahl zurueck: wie viele Meldungen fuer den AUFRUFER
-- entstanden sind. Nicht, wie viele insgesamt, und erst recht nicht je
-- Figur.
--
-- Der Grund ist `0145`: `favorite_demand()` ist ausdruecklich auf den
-- aktiven Verkaeuferbetrieb begrenzt, damit ein Sammler nicht erfaehrt, wie
-- viele andere eine Figur vorgemerkt haben. Gaebe diese Funktion „SKY-0001:
-- 7 Meldungen" zurueck, waere genau diese Zahl fuer jeden angemeldeten
-- Nutzer zu haben — die Begrenzung von `0145` waere umgangen, ohne dass
-- jemand eine Richtlinie angefasst haette.
--
-- `security definer` heisst hier UEBRIGENS AUCH: der Rumpf liest `favorites`
-- aller Nutzer (der Eigner umgeht RLS). Das ist notwendig und genau deshalb
-- ist die Rueckgabe so eng. `auth.uid()` bleibt dabei der Aufrufer —
-- `definer` tauscht die Rolle, nicht die Identitaet.
--
-- NICHTS AN SHOP, LAGER, BESTELLUNGEN ODER SAMMLUNG. Diese Migration legt
-- eine Tabelle und eine Funktion an und schreibt ausserdem nur in
-- `offer_state.announced_*` — die Spalten, die `0146` genau dafuer
-- vorgesehen hat. Kein Trigger, kein Scheduler.
-- ===========================================================================

do $$
declare
  v_wer text := '0148 ABBRUCH';
  v_n   integer;
begin
  -- ---------------------------------------------------- Vorbedingungen
  if to_regclass('public.favorites') is null then
    raise exception '%: 0148 setzt 0145 voraus — public.favorites fehlt', v_wer;
  end if;
  if to_regclass('public.offer_state') is null then
    raise exception '%: 0148 setzt 0146 voraus — public.offer_state fehlt', v_wer;
  end if;
  if to_regprocedure('public.offer_availability_due()') is null then
    raise exception '%: 0148 setzt 0147 voraus — offer_availability_due() fehlt', v_wer;
  end if;
  if to_regprocedure('public.offer_availability_grace()') is null then
    raise exception '%: 0148 setzt 0147 voraus — offer_availability_grace() fehlt', v_wer;
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception '%: public.is_collector_account() fehlt (0042)', v_wer;
  end if;

  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.offer_state')
     and a.attname = 'buyable_since'
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 1 then
    raise exception '%: offer_state.buyable_since fehlt — 0147 ist nicht '
      'angewendet', v_wer;
  end if;

  if to_regclass('public.availability_notifications') is not null then
    raise exception '%: public.availability_notifications steht schon', v_wer;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. Die Tabelle
--
-- EINE ZEILE JE NUTZER, FIGUR UND PHASE. Mehr Zustand gibt es nicht: was
-- gemeldet wurde, steht hier; ob es gelesen wurde, ist S4.
--
-- `cheapest_cents` ist `not null`: eine Meldung entsteht nur fuer eine
-- kaufbare Figur, und kaufbar heisst nach `0146` „es gibt einen Preis".
-- ---------------------------------------------------------------------------
create table public.availability_notifications (
  user_id uuid not null,
  sky_id  text not null,

  -- WELCHE PHASE gemeldet wurde. Teil des Schluessels, nicht Beigabe.
  buyable_since timestamptz not null,

  -- Was zum Zeitpunkt der Meldung galt, in CENT.
  cheapest_cents integer not null,

  created_at timestamptz not null default now(),

  constraint availability_notifications_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  /*
   * `restrict` wie bei `favorites` (0145) und `collection_items` (0001): eine
   * Katalogzeile darf nicht unter einer Meldung wegbrechen. Der Import
   * deaktiviert ueber `is_active`, statt zu loeschen.
   */
  constraint availability_notifications_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete restrict,

  /*
   * DER DUPLIKATSCHUTZ, als Eigenschaft der Datenbank.
   *
   * Genau eine Meldung je Nutzer, Figur und Phase. Zwei gleichzeitige
   * Aufrufe koennen das nicht verletzen, ein wiederholter Seitenaufruf
   * nicht, und ein kuenftiger Fehler in einer Funktion auch nicht.
   */
  constraint availability_notifications_pk
    primary key (user_id, sky_id, buyable_since),

  constraint availability_notifications_price_sane
    check (cheapest_cents >= 0)
);

comment on table public.availability_notifications is
  'Persoenliche Verfuegbarkeitsmeldungen (0148, Phase 4 S3): je Nutzer, Figur und Verfuegbarkeitsphase genau eine. Der Primaerschluessel (user_id, sky_id, buyable_since) IST der Duplikatschutz — nicht die Anwendungslogik. Geschrieben wird ausschliesslich von claim_availability_notifications(); Clients haben nur SELECT auf ihre eigenen Zeilen. Keine read_at-Spalte: Anzeige und „als gelesen markieren" sind S4.';

comment on column public.availability_notifications.buyable_since is
  'Die Phasengrenze aus offer_state (0147), zu der gemeldet wurde. Teil des Primaerschluessels: ein ECHTER spaeterer Verfuegbarkeitszyklus hat eine neue Phasengrenze und darf deshalb eine neue Meldung erzeugen, eine kurze Warenkorbreservierung behaelt die alte und erzeugt keine.';

comment on column public.availability_notifications.cheapest_cents is
  'Der guenstigste kaufbare Preis in Cent zum Zeitpunkt der Meldung. Festgehalten, weil eine Meldung sagt, was DAMALS galt — der Shop bewegt sich weiter.';

/* Die Leserichtung der Oberflaeche: meine Meldungen, neueste zuerst. */
create index availability_notifications_user_created_idx
  on public.availability_notifications (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 2. Sicherheit: lesen darf jeder nur das Eigene, schreiben niemand
--
-- DIESELBE FORM WIE `favorites` (0145): RLS an, Richtlinie je Vorgang, und
-- die Rechte zusaetzlich ENTZOGEN. Supabase setzt `ALTER DEFAULT
-- PRIVILEGES` auf `public`, also bekommen `anon`, `authenticated` und
-- `service_role` bei jedem `create table` automatisch `ALL`; `grant` ist
-- additiv und entzieht nichts.
--
-- NUR `select`, und das ist der Unterschied zu `favorites`: eine Meldung
-- legt der Nutzer nicht an und loescht sie nicht. Geschrieben wird
-- ausschliesslich von `claim_availability_notifications()` (`definer`).
-- Kein `update`-Weg — S4 bringt ihn mit, wenn es `read_at` braucht.
-- ---------------------------------------------------------------------------
alter table public.availability_notifications enable row level security;

create policy availability_notifications_select_own
  on public.availability_notifications
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

revoke all on public.availability_notifications from anon;
revoke all on public.availability_notifications from authenticated;
grant select on public.availability_notifications to authenticated;


-- ---------------------------------------------------------------------------
-- 3. `claim_availability_notifications()` — eine Anweisung, atomar
--
-- Die ganze Begruendung steht im Kopf dieser Datei. In Kurzform:
--
--   * `offer_availability_due()` ist die Erkennung aus `0147`, samt
--     Gegenprobe gegen `offer_state_live`. Keine zweite Erkennung.
--   * das `update` traegt die Faelligkeitsbedingung als `where` mit und
--     setzt `announced_*` — es ist das Beanspruchen.
--   * das `insert` liest aus dem `returning` des `update`, kann also nur
--     fuer beanspruchte Zeilen schreiben.
--   * zurueck kommt EINE Zahl: die Meldungen fuer den Aufrufer.
-- ---------------------------------------------------------------------------
create or replace function public.claim_availability_notifications()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with faellig as (
    select d.sky_id, d.buyable_since, d.cheapest_cents
      from public.offer_availability_due() d
  ),
  beansprucht as (
    update public.offer_state s
       set announced_buyable = true,
           announced_cents   = s.cheapest_cents,
           announced_at       = now()
     where s.sky_id in (select f.sky_id from faellig f)
       and s.buyable
       and s.buyable_since is not null
       and now() - s.buyable_since >= public.offer_availability_grace()
       and (s.announced_at is null or s.buyable_since > s.announced_at)
    returning s.sky_id, s.buyable_since, s.cheapest_cents
  ),
  gemeldet as (
    insert into public.availability_notifications
      (user_id, sky_id, buyable_since, cheapest_cents)
    select v.user_id, b.sky_id, b.buyable_since, b.cheapest_cents
      from beansprucht b
      join public.favorites v on v.sky_id = b.sky_id
     where v.created_at < b.buyable_since
    on conflict do nothing
    returning user_id
  )
  select count(*)::integer
    from gemeldet
   where user_id = (select auth.uid());
$$;

comment on function public.claim_availability_notifications() is
  'Verarbeitet faellige Verfuegbarkeitsereignisse (0148, Phase 4 S3): beansprucht sie in offer_state.announced_* und legt im SELBEN STATEMENT je betroffenem Nutzer eine Meldung an. Betroffen ist, wer die Figur VOR der Phasengrenze vorgemerkt hat (favorites.created_at < buyable_since). Atomar durch Bauart — das insert liest aus dem returning des update, es gibt also keinen Zustand mit beanspruchtem Ereignis und fehlenden Meldungen. Gleichzeitige Aufrufe: der zweite wartet auf die Zeilensperre und prueft sein where gegen die neue Zeile, beansprucht null und schreibt nichts; der Primaerschluessel (user_id, sky_id, buyable_since) haelt zusaetzlich. Gibt NUR die Zahl der Meldungen fuer den Aufrufer zurueck — eine Zahl je Figur waere die Nachfrage, und die ist nach 0145 dem Verkaeuferbetrieb vorbehalten. Erzeugt keine E-Mail, keine Push-Nachricht, keinen Preisalarm.';

revoke all on function public.claim_availability_notifications() from public, anon;
grant execute on function public.claim_availability_notifications() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachweis statt Absicht
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0148 ABBRUCH';
  v_n   integer;
  v_t   text;
begin
  select string_agg(a.attname::text, ',' order by a.attnum) into v_t
    from pg_attribute a
   where a.attrelid = 'public.availability_notifications'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_t <> 'user_id,sky_id,buyable_since,cheapest_cents,created_at' then
    raise exception '%: die Spaltenfolge ist %', v_wer, v_t;
  end if;

  select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
    into v_t
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.availability_notifications'::regclass
     and c.contype = 'p';
  if v_t <> 'user_id,sky_id,buyable_since' then
    raise exception '%: der Primaerschluessel ist (%) — erwartet '
      '(user_id, sky_id, buyable_since), denn ER ist der Duplikatschutz',
      v_wer, v_t;
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.availability_notifications'::regclass) then
    raise exception '%: RLS ist nicht an', v_wer;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'availability_notifications';
  if v_n <> 1 then
    raise exception '%: % Richtlinien, erwartet genau eine (nur lesen)', v_wer, v_n;
  end if;

  /* Clientrechte: genau `select` fuer `authenticated`, nichts fuer `anon`. */
  select coalesce(string_agg(distinct a.privilege_type, ',' order by a.privilege_type),
                  '(keine)')
    into v_t
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.availability_notifications'::regclass
     and a.grantee::regrole::text = 'authenticated'
     and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                              'REFERENCES', 'TRIGGER');
  if v_t <> 'SELECT' then
    raise exception '%: authenticated hat % — erwartet nur SELECT', v_wer, v_t;
  end if;

  select count(*) into v_n
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.availability_notifications'::regclass
     and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
  if v_n <> 0 then
    raise exception '%: % Recht(e) fuer anon oder PUBLIC', v_wer, v_n;
  end if;

  /* Die Funktion: definer, volatile, leerer Pfad, nur fuer authenticated. */
  select count(*) into v_n from pg_proc p
   where p.oid = to_regprocedure('public.claim_availability_notifications()')
     and p.prosecdef
     and p.provolatile = 'v'
     and (select count(*) from unnest(coalesce(p.proconfig, '{}')) x
           where x like 'search\_path=%') = 1;
  if v_n <> 1 then
    raise exception '%: claim_availability_notifications() ist nicht '
      'definer+volatile mit search_path-Festlegung', v_wer;
  end if;

  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.claim_availability_notifications()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
  if v_n <> 0 then
    raise exception '%: % EXECUTE fuer anon oder PUBLIC', v_wer, v_n;
  end if;

  /*
   * SIE IST EINE EINZIGE ANWEISUNG, und das ist die Atomaritaetszusage.
   * `language sql` mit einem `with`-Ausdruck: kein `begin`, kein Semikolon
   * mitten im Rumpf, also auch kein Zustand zwischen Beanspruchen und
   * Melden.
   */
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure('public.claim_availability_notifications()');
  if (length(v_t) - length(replace(v_t, ';', ''))) > 1 then
    raise exception '%: der Rumpf enthaelt mehr als eine Anweisung — die '
      'Atomaritaet haengt daran, dass es genau eine ist', v_wer;
  end if;
  if position('offer_availability_due()' in v_t) = 0 then
    raise exception '%: der Rumpf benutzt offer_availability_due() nicht — '
      'eine zweite Erkennung ist nicht vorgesehen', v_wer;
  end if;
  if position('create_at' in v_t) > 0 then
    raise exception '%: Tippfehler create_at im Rumpf', v_wer;
  end if;

  /* Kein Trigger, nirgends. */
  select coalesce(string_agg(cl.relname::text || '.' || t.tgname::text, ', '
                             order by cl.relname, t.tgname), '(keine)')
    into v_t
    from pg_trigger t
    join pg_class cl on cl.oid = t.tgrelid
   where cl.oid in (to_regclass('public.availability_notifications'),
                    to_regclass('public.offer_state'),
                    to_regclass('public.favorites'))
     and not t.tgisinternal;
  if v_t <> '(keine)' then
    raise exception '%: unerwartete Trigger: %', v_wer, v_t;
  end if;

  select count(*) into v_n from public.availability_notifications;
  if v_n <> 0 then
    raise exception '%: die Migration hat % Meldung(en) angelegt — sie legt '
      'keine an', v_wer, v_n;
  end if;

  raise notice '0148 ok: availability_notifications steht (5 Spalten, PK '
    '(user_id, sky_id, buyable_since) als Duplikatschutz, RLS an, EINE '
    'Richtlinie, authenticated nur SELECT, nichts fuer anon), '
    'claim_availability_notifications() definer+volatile als EINE Anweisung '
    'nur fuer authenticated, kein Trigger, 0 Meldungen. Keine E-Mail, kein '
    'Push, kein Preisalarm, kein Scheduler, keine read_at-Spalte.';
end $$;
-- <<< ENDE: supabase/migrations/0148_availability_notifications.sql

commit;
