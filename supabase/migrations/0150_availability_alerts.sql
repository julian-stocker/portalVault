-- ===========================================================================
-- 0150 — VERFUEGBARKEITSALARME (Fire and forget, ADR-0147)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Ein Sammler sieht eine Figur, die er kaufen WUERDE, und sie ist
-- nicht zu haben. Er drueckt eine Glocke. Wird sie wieder kaufbar, bekommt er
-- GENAU EINE Meldung. Danach ist der Alarm erledigt, bis er ihn ausdruecklich
-- bestaetigt — und erst dann darf er einen neuen setzen, und nur wenn die
-- Figur wieder nicht kaufbar ist. Das ist das ganze Vorhaben.
--
-- WAS SIE AUSDRUECKLICH NICHT VERSPRICHT (ADR-0147). Dass die Figur beim
-- Oeffnen der Meldung noch da ist. Kauft sie jemand dazwischen, ist das der
-- Lauf der Dinge; die Oberflaeche sagt dann „inzwischen vergriffen" und zeigt
-- den Preis, der ZUM ZEITPUNKT DER MELDUNG galt. Aus genau dieser
-- gestrichenen Zusage folgt alles Weitere: es gibt KEINE Karenzzeit, KEINE
-- Verfuegbarkeitsphasen und KEINE Historie je Figur.
--
-- DIE ZENTRALE ENTSCHEIDUNG: DIE ALARMZEILE IST IHRE EIGENE GRUNDLINIE.
--
-- Die Bauform aus `0146`–`0149` brauchte einen Spiegel mit
-- `buyable_since` und `announced_*`, weil dort JEDER FAVORIT ein stehendes
-- Abonnement war: das System musste von sich aus fuer den ganzen Katalog
-- dauerhaft Phasen fuehren und entscheiden, ob eine Abwesenheit „echt" war.
-- Ein Alarm entsteht dagegen in EINEM Augenblick, durch einen Klick, unter
-- der Bedingung „jetzt nicht kaufbar". Damit steht die Vorgeschichte, die
-- eine Meldung braucht, vollstaendig IN DER ZEILE — und es gibt keine
-- zweite Historie zu fuehren.
--
-- WAS SIE NICHT IST: der Gesammelt-Status und NICHT die Wunschliste.
-- `favorites` (`0145`) bleibt, was sie ist, und wird von dieser Migration
-- weder gelesen noch genannt. Herz und Glocke sind vollstaendig unabhaengig
-- (ADR-0147); ein Favorit loest nichts aus, und ein Alarm sagt nichts
-- darueber, ob jemand die Figur sammelt.
--
-- WAS SIE NICHT ANFASST. Keine bestehende Tabelle, keine bestehende Spalte,
-- keine bestehende Funktion, keine bestehende Richtlinie, kein bestehendes
-- Recht, keinen Trigger. Rein additiv — auch neben `0146`–`0149`, die
-- unberuehrt weiterstehen und bis zu einer eigenen Freigabe nicht
-- zurueckgebaut werden.
--
-- *** DIE EINE ABHAENGIGKEIT: `0151` ***
--
-- Diese Migration liest `public.offer_state_live` — eine SICHT, nicht eine
-- Tabelle. Sie ist die einzige zustandsfreie Definition von „was ist JETZT
-- kaufbar, zu welchem guenstigsten Preis", sie liest ausschliesslich
-- `shop_offers()` und rechnet keinen Preis nach. Eine zweite Definition von
-- „kaufbar" waere der schwerere Fehler (`docs/SECURITY.md` und
-- `src/lib/shop/offer.ts`: es gibt genau eine).
--
-- BEREITGESTELLT WIRD SIE VON `0151_offer_state_live.sql`. Die fachliche
-- Reihenfolge ist also **`0151` vor `0150`**, und zwar in jeder Umgebung.
-- Auf Production legt `0151` die Sicht an; auf Staging steht sie seit `0146`
-- und `0151` prueft sie nur. Die verbindliche Fassung der Definition bleibt
-- die aus `0146` (Entscheidung E-3) — `0151` uebernimmt sie zeichengleich
-- und stellt kein zweites Mal auf.
--
--   WAS DAMIT ERLEDIGT IST: `0150` braucht von der alten Bauform NICHTS
--   mehr. Production bekommt die Sicht und diese Tabelle — keinen Spiegel,
--   keine `refresh_offer_state()`, kein `offer_state_window()`. Was wieder
--   verschwinden soll, kommt dort nie an (ADR-0147, Entscheidung E-1).
--
-- WAS SIE NICHT MITBRINGT. Keinen Scheduler, keinen Trigger, keine
-- E-Mail, keine Push-Nachricht, keinen Preisalarm, keine Einstellung, keine
-- Oberflaeche und keinen Aufrufer. `fire_availability_alerts()` steht da und
-- wird von niemandem gerufen — das ist M4 und eine eigene Freigabe. Dass ein
-- Mechanismus ohne Aufrufer vollstaendig stumm bleibt, ist die Lehre aus
-- ADR-0145 und hier ABSICHT: dieser Schritt soll beobachtbar sein, bevor er
-- etwas ausloest.
--
-- AUSFUEHRUNG: im SQL-Editor, in `begin` / `commit` geklammert.
-- Ruecknahme: `supabase/rollback/R0150_drop_availability_alerts.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
--
-- Gefragt wird alles, was der Rumpf dieser Migration anfasst, damit ein Lauf
-- auf einer unfertigen Datenbank LAUT scheitert und nicht halb.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0150 ABBRUCH';
begin
  if to_regclass('auth.users') is null then
    raise exception '%: 0150 setzt Supabase Auth voraus — auth.users fehlt', v_wer;
  end if;
  if to_regclass('public.skylanders') is null then
    raise exception '%: 0150 setzt 0001 voraus — public.skylanders fehlt', v_wer;
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception '%: 0150 setzt 0042 voraus — is_collector_account() fehlt', v_wer;
  end if;

  /*
   * DIE SICHT, UND ZWAR DIE SICHT. Eine Tabelle `offer_state` braucht diese
   * Migration NICHT und nennt sie nirgends — gefragt wird genau das Objekt,
   * das gelesen wird.
   */
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: 0150 setzt 0151 voraus — die Sicht '
      'public.offer_state_live fehlt. Erst 0151_offer_state_live.sql '
      'anwenden (auf Staging steht sie historisch schon aus 0146). Sie ist '
      'die einzige Definition von "jetzt kaufbar"; eine zweite aufzustellen '
      'ist ausgeschlossen', v_wer;
  end if;

  -- Ein zweiter Lauf prallt ab, und zwar vor der ersten Aenderung.
  if to_regclass('public.availability_alerts') is not null then
    raise exception '%: public.availability_alerts steht schon', v_wer;
  end if;
  if to_regprocedure('public.watch_availability(text)') is not null then
    raise exception '%: watch_availability(text) steht schon', v_wer;
  end if;
  if to_regprocedure('public.unwatch_availability(text)') is not null then
    raise exception '%: unwatch_availability(text) steht schon', v_wer;
  end if;
  if to_regprocedure('public.fire_availability_alerts()') is not null then
    raise exception '%: fire_availability_alerts() steht schon', v_wer;
  end if;
  if to_regprocedure('public.acknowledge_availability_alerts(bigint[])') is not null then
    raise exception '%: acknowledge_availability_alerts(bigint[]) steht schon', v_wer;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Tabelle — Vormerkung UND Meldung in einer Zeile
--
-- WARUM EINE UND NICHT ZWEI. Ein Alarm feuert genau einmal; „gemeldet" ist
-- also eine EIGENSCHAFT der Vormerkung und kein eigener Gegenstand. Zwei
-- Tabellen brauchten einen Fremdschluessel, ein zweites Schreiben beim
-- Feuern und eine Regel darueber, was gilt, wenn das eine ohne das andere
-- dasteht. Mit einer Zeile kann dieser Zustand nicht entstehen.
--
-- DREI ZUSTAENDE, und die Zeile wird NIE gelöscht:
--
--   scharf         notified_at is null                 wartet
--   ausgeloest     notified_at gesetzt, read_at null   Meldung steht, ungelesen
--   abgeschlossen  read_at gesetzt                     bleibt als Historie
-- ---------------------------------------------------------------------------
create table public.availability_alerts (
  /*
   * DER SURROGATSCHLUESSEL IST HIER RICHTIG, anders als bei `favorites`.
   *
   * „Gesehen" muss das KONKRETE EREIGNIS treffen und nicht eine SKY-ID
   * (ADR-0147). Ein Konto kann zu derselben Figur ueber die Zeit mehrere
   * abgeschlossene Alarme haben; eine Bestaetigung, die nur die Figur nennt,
   * koennte einen zweiten, gerade entstandenen Alarm mitnehmen, den niemand
   * gesehen hat. Mit einer `id` ist die Bestaetigung ein Skalar und der
   * Client muss keinen Zeitstempel zurueckschicken.
   */
  id             bigint      generated always as identity,

  user_id        uuid        not null,
  sky_id         text        not null,

  -- Wann scharf gestellt. Zugleich die Sortierung der Verwaltung.
  created_at     timestamptz not null default now(),

  -- Wann ausgeloest. NULL heisst: wartet noch. Gesetzt wird es ausschliesslich
  -- von fire_availability_alerts().
  notified_at    timestamptz,

  -- Der guenstigste kaufbare Preis in Cent ZUM ZEITPUNKT DER AUSLOESUNG.
  -- Historie, kein Verweis: der Shop bewegt sich weiter, die Meldung nicht.
  notified_cents integer,

  -- Wann der Nutzer bestaetigt hat. NULL heisst ungelesen UND offen.
  -- Gesetzt wird es ausschliesslich von acknowledge_availability_alerts().
  read_at        timestamptz,

  constraint availability_alerts_pk primary key (id),

  -- Das Konto loeschen heisst die Alarme mitloeschen (DSGVO), wie bei
  -- `favorites` und `collection_items`.
  constraint availability_alerts_user_fk foreign key (user_id)
    references auth.users (id)
    on update cascade
    on delete cascade,

  /*
   * RESTRICT, nicht CASCADE: eine Katalogzeile darf nicht unter einem Alarm
   * wegbrechen. Der Import deaktiviert ueber `is_active` statt zu loeschen.
   * Dieser Fremdschluessel ist zugleich die Garantie, dass das ZIEL einer
   * Meldung existiert — eine freie Textspalte koennte das nicht.
   */
  constraint availability_alerts_sky_fk foreign key (sky_id)
    references public.skylanders (sky_id)
    on update cascade
    on delete restrict,

  -- Ausgeloest heisst: mit Preis. Beides zusammen oder keines von beiden.
  constraint availability_alerts_notified_price
    check ((notified_at is null) = (notified_cents is null)),

  -- Bestaetigen kann man nur, was ausgeloest hat. Ein `read_at` auf einem
  -- scharfen Alarm waere ein Zustand ohne Bedeutung.
  constraint availability_alerts_read_after_notified
    check (read_at is null or notified_at is not null),

  -- `shop_price()` rundet auf zwei Dezimalstellen, und bei einem sehr
  -- kleinen Marktwert kann daraus 0.00 werden. Deshalb >= 0 und nicht > 0:
  -- ein Lauf, der an echten Daten scheitert, ist schlechter als eine Null.
  constraint availability_alerts_price_sane
    check (notified_cents is null or notified_cents >= 0)
);

comment on table public.availability_alerts is
  'Verfuegbarkeitsalarme eines Sammlers (0150, ADR-0147). Eine Zeile traegt Vormerkung UND Meldung: scharf (notified_at null), ausgeloest (notified_at gesetzt, read_at null) oder abgeschlossen (read_at gesetzt). Zeilen werden nie geloescht, ausser beim Zurueckziehen eines noch nicht ausgeloesten Alarms. Vollstaendig unabhaengig von favorites und von offer_state - gelesen wird nur die Sicht offer_state_live. Keine Karenzzeit, keine Verfuegbarkeitsphasen, keine Historie je Figur: die Alarmzeile ist ihre eigene Grundlinie.';

comment on column public.availability_alerts.id is
  'Die Ereigniskennung. "Gesehen" bestaetigt DIESEN Alarm und nicht eine SKY-ID (ADR-0147).';
comment on column public.availability_alerts.notified_at is
  'Wann der Alarm ausgeloest hat; NULL heisst, er wartet noch. Gesetzt ausschliesslich von fire_availability_alerts(), und nur solange er NULL ist - deshalb kann derselbe Alarm nicht zweimal melden.';
comment on column public.availability_alerts.notified_cents is
  'Der guenstigste kaufbare Preis in Cent zum Zeitpunkt der Auslösung. Festgehalten, weil eine Meldung sagt, was DAMALS galt.';
comment on column public.availability_alerts.read_at is
  'Wann der Nutzer bestaetigt hat. NULL heisst ungelesen UND offen - der Teilindex availability_alerts_open_uniq macht daraus die Regel, dass es hoechstens einen offenen Alarm je Konto und Figur gibt.';


-- ---------------------------------------------------------------------------
-- 3. Drei Indizes, und der erste IST eine Fachregel
-- ---------------------------------------------------------------------------

/*
 * HOECHSTENS EIN OFFENER ALARM JE KONTO UND FIGUR.
 *
 * Das ist die Regel „eine erneute Vormerkung erst nach der Bestaetigung",
 * und sie steht hier als STRUKTUR und nicht als Anwendungslogik. „Zwei
 * offene Alarme" ist damit kein Zustand, den diese Datenbank darstellen
 * kann — dasselbe Prinzip, mit dem `0145` den doppelten Favoriten und `0148`
 * die doppelte Meldung ausgeschlossen hat (ADR-0143), nur mit einem
 * partiellen Unique-Index als Traeger statt mit dem Primaerschluessel.
 *
 * „Offen" heisst `read_at is null` und umfasst damit BEIDE Vorzustaende:
 * scharf und ausgeloest-aber-unbestaetigt. Genau so verlangt es der Auftrag.
 */
create unique index availability_alerts_open_uniq
  on public.availability_alerts (user_id, sky_id)
  where read_at is null;

/*
 * DER UNGELESEN-ZAEHLER DER KOPFZEILE.
 *
 * Die haeufigste Abfrage dieser Tabelle: sie laeuft bei jedem Aufruf einer
 * Seite im angemeldeten Bereich. Nur ausgeloeste und unbestaetigte Zeilen —
 * scharfe Alarme sind keine Meldung, und abgeschlossene werden mit der Zeit
 * die Mehrheit und beantworten diese Frage nicht.
 */
create index availability_alerts_unread_idx
  on public.availability_alerts (user_id)
  where notified_at is not null and read_at is null;

/*
 * DER ABGLEICH: welche Figuren werden ueberhaupt beobachtet?
 *
 * Nach `sky_id`, weil der Abgleich darueber gegen `offer_state_live`
 * verbindet. `read_at is null` steht hier NICHT im Praedikat und soll es
 * nicht: der CHECK `availability_alerts_read_after_notified` sagt schon,
 * dass ein `notified_at is null` ein `read_at is null` erzwingt. Zwei
 * Formulierungen derselben Wahrheit koennten auseinanderlaufen.
 */
create index availability_alerts_pending_idx
  on public.availability_alerts (sky_id)
  where notified_at is null;


-- ---------------------------------------------------------------------------
-- 4. Row Level Security und Rechte
--
-- EINE RICHTLINIE, UND ZWAR NUR LESEN — das Muster von `0148`, nicht das von
-- `0145`. Begruendung: auf `favorites` schreibt der Client selbst (Herz an,
-- Herz aus), hier nicht. Jeder Schreibweg prueft eine Bedingung, die eine
-- Richtlinie nicht ausdruecken kann („die Figur darf jetzt nicht kaufbar
-- sein", „nur ausgeloeste und noch nicht bestaetigte Zeilen"), und liegt
-- deshalb in einer Definer-Funktion. Ein Tabellenrecht waere breiter als die
-- Absicht.
-- ---------------------------------------------------------------------------
alter table public.availability_alerts enable row level security;

create policy availability_alerts_select_own
  on public.availability_alerts
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_collector_account());

/*
 * DIE ZWEITE SCHICHT: RECHTE DURCH ENTZIEHEN.
 *
 * Supabase setzt `ALTER DEFAULT PRIVILEGES` auf das Schema `public`: `anon`,
 * `authenticated` und `service_role` bekommen bei JEDEM `create table`
 * automatisch `ALL`. `grant` ist additiv und entzieht nichts
 * (`docs/SECURITY.md`, zweite Schicht).
 */
revoke all on public.availability_alerts from anon;
revoke all on public.availability_alerts from authenticated;
grant select on public.availability_alerts to authenticated;

/*
 * UND DIE SEQUENZ DER IDENTITAETSSPALTE.
 *
 * Ohne `insert`-Recht ist sie unerreichbar, und `generated always` verbietet
 * einen eigenen Wert ohnehin — aber ein Vorgaberecht, das niemand braucht,
 * wird entzogen und nicht uebersehen. Derselbe Handgriff wie in `0033` fuer
 * `sky_id_seq`. Der Name wird ERFRAGT und nicht geraten.
 */
do $$
declare
  v_seq text := pg_get_serial_sequence('public.availability_alerts', 'id');
begin
  if v_seq is null then
    raise exception '0150 ABBRUCH: die Identitaetssequenz von availability_alerts.id '
      'ist nicht auffindbar';
  end if;
  execute format('revoke all on sequence %s from public, anon, authenticated', v_seq);
end $$;


-- ---------------------------------------------------------------------------
-- 5a. watch_availability() — scharf stellen
--
-- GEPRUEFT WIRD DIE GEGENWART, NICHT EIN SPIEGEL. `offer_state_live` liest
-- `shop_offers()` live; ein Spiegel koennte veraltet sein und einen Alarm auf
-- eine Figur zulassen, die laengst kaufbar ist. Genau dafuer hat `0146` diese
-- Sicht angelegt.
--
-- DREI UNTERSCHEIDBARE ANTWORTEN, nicht ein Wahrheitswert — dasselbe Muster
-- wie `refresh_offer_state()` mit `ran` / `throttled` / `locked`. Die
-- Oberflaeche soll „schon vorgemerkt" von „ist gerade kaufbar" unterscheiden
-- koennen, ohne eine zweite Abfrage zu stellen.
--
--   armed         ein neuer Alarm steht scharf
--   already_open  es gab schon einen offenen — der Wunsch gilt bereits
--   buyable       die Figur ist JETZT kaufbar, ein Alarm waere sinnlos
-- ---------------------------------------------------------------------------
create or replace function public.watch_availability(p_sky_id text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  /*
   * DIE EIGENTUEMERBEDINGUNG IST DIESE PRUEFUNG. RLS gilt fuer eine
   * Definer-Funktion nicht, und es gibt keinen Parameter fuer das Konto —
   * eine Funktion, die ein fremdes Konto annehmen kann, ist eine Funktion,
   * die man missbrauchen kann.
   */
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  /* Ein Betriebs- oder Adminkonto sammelt nicht im eigenen Katalog
     (ADR-0042) und hat deshalb auch keine Alarme — dieselbe Grenze wie bei
     favorites und availability_notifications. */
  if not public.is_collector_account() then
    raise exception 'collector account required'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.offer_state_live l where l.sky_id = p_sky_id) then
    return 'buyable';
  end if;

  /*
   * ON CONFLICT AUF DEN TEILINDEX, nicht ein vorheriges `exists`.
   *
   * Ein Blick davor und ein Insert danach waeren zwei Schritte, und zwei
   * gleichzeitige Klicks kaemen beide durch den Blick. Der Index entscheidet,
   * und er entscheidet richtig, egal wie oft gleichzeitig geklickt wird.
   */
  insert into public.availability_alerts (user_id, sky_id)
  values (v_uid, p_sky_id)
  on conflict (user_id, sky_id) where read_at is null do nothing;

  if found then
    return 'armed';
  end if;
  return 'already_open';
end;
$$;

comment on function public.watch_availability(text) is
  'Stellt einen Verfuegbarkeitsalarm scharf (0150, ADR-0147). Drei unterscheidbare Antworten: armed (neu scharf), already_open (es gab schon einen offenen), buyable (die Figur ist JETZT kaufbar, ein Alarm waere sinnlos). Geprueft wird gegen die Sicht offer_state_live, also gegen shop_offers() live und nicht gegen einen Spiegel. Das Konto kommt aus auth.uid() und niemals aus einem Parameter; ein Betriebs- oder Adminkonto wird abgewiesen. Hoechstens ein offener Alarm je Konto und Figur - das entscheidet der Teilindex und nicht diese Funktion. Liest favorites nicht.';

revoke all on function public.watch_availability(text) from public, anon;
grant execute on function public.watch_availability(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5b. unwatch_availability() — zurueckziehen, solange nichts gefeuert hat
--
-- NUR EINEN SCHARFEN ALARM. Ein ausgeloester traegt eine Meldung, die der
-- Nutzer gesehen haben soll; ihn zu loeschen wuerde Historie verwerfen. Er
-- wird BESTAETIGT, nicht zurueckgezogen — das sind zwei verschiedene
-- Handlungen und zwei verschiedene Funktionen.
-- ---------------------------------------------------------------------------
create or replace function public.unwatch_availability(p_sky_id text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with zurueckgezogen as (
    delete from public.availability_alerts a
     where (select auth.uid()) = a.user_id
       and public.is_collector_account()
       and a.sky_id = p_sky_id
       and a.notified_at is null
    returning 1
  )
  select count(*)::integer from zurueckgezogen;
$$;

comment on function public.unwatch_availability(text) is
  'Zieht einen noch nicht ausgeloesten Verfuegbarkeitsalarm zurueck und gibt die Anzahl zurueck (0150). EINE Anweisung. Ein ausgeloester Alarm wird NICHT geloescht - er traegt eine Meldung und wird mit acknowledge_availability_alerts() abgeschlossen. security definer: das where traegt dieselbe Eigentuemerbedingung wie die select-Richtlinie, und weil RLS fuer eine Definer-Funktion nicht gilt, IST dieses where die Grenze.';

revoke all on function public.unwatch_availability(text) from public, anon;
grant execute on function public.unwatch_availability(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5c. fire_availability_alerts() — DER ABGLEICH
--
-- EINE ANWEISUNG, UND DAS IST DIE ATOMARITAET SELBST. Es gibt keinen
-- zweiten Schreibvorgang, also auch keinen Zustand „Alarm ausgeloest, Meldung
-- fehlt" — anders als bei `0148`, wo ein `update` und ein `insert` ueber ein
-- `returning` zusammengehalten werden mussten (ADR-0143).
--
-- IDEMPOTENT durch `notified_at is null`. Ein zweiter Lauf trifft null
-- Zeilen; ein abgebrochener Lauf hinterlaesst nichts; ein Wiederanlauf holt
-- genau nach, was offen ist.
--
-- PARALLELE LAEUFE brauchen KEIN Schloss. Zwei gleichzeitige Aufrufe sperren
-- dieselben Zeilen; der zweite wartet, liest die geaenderte Zeile und prueft
-- sein `where` dagegen — `notified_at` ist dann gesetzt, die Zeile faellt
-- heraus. Ein `pg_try_advisory_xact_lock` wuerde nur Leerlauf sparen und
-- waere ein Bauteil, das die Richtigkeit nicht braucht. `0146` hat eines,
-- weil es dort ~290 Zeilen je Lauf neu schrieb; hier sind es die offenen
-- Alarme, und das sind einstellige bis niedrig dreistellige Zahlen.
--
-- *** SIE BRAUCHT KEINEN NUTZERKONTEXT, UND DAS IST ABSICHT ***
--
-- Der Abgleich ist GLOBAL: er feuert fuer jeden Abonnenten jeder faelligen
-- Figur. `auth.uid()` steht ausschliesslich in der ZAEHLUNG am Ende, nicht
-- im `update`. Unter einem Scheduler (`pg_cron`, ADR-0147) ist `auth.uid()`
-- NULL, der Vergleich `user_id = NULL` ergibt NULL, die Funktion gibt 0
-- zurueck — UND DIE AUSLOESUNG LAEUFT TROTZDEM VOLLSTAENDIG. Sie scheitert
-- nicht und sie ueberspringt nichts.
--
-- WARUM SIE NUR DIE EIGENE ZAHL ZURUECKGIBT. Eine Zahl je Figur waere die
-- NACHFRAGE, und die ist nach `0145` dem Verkaeuferbetrieb vorbehalten
-- (`favorite_demand()` hinter `can_operate_active_seller()`). Diese Grenze
-- darf eine Komfortfunktion nicht aufweichen — auch nicht als Nebenprodukt.
-- ---------------------------------------------------------------------------
create or replace function public.fire_availability_alerts()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with gefeuert as (
    update public.availability_alerts a
       set notified_at    = now(),
           notified_cents = l.cheapest_cents
      from public.offer_state_live l
     where l.sky_id = a.sky_id
       and a.notified_at is null
    returning a.user_id
  )
  select count(*)::integer
    from gefeuert g
   where g.user_id = (select auth.uid());
$$;

comment on function public.fire_availability_alerts() is
  'Loest alle faelligen Verfuegbarkeitsalarme aus (0150, ADR-0147): jeder scharfe Alarm, dessen Figur JETZT in offer_state_live steht, bekommt notified_at und den guenstigsten Preis in Cent. EINE Anweisung, also atomar durch Bauart - es gibt keinen Zustand mit ausgeloestem Alarm ohne Meldung, weil beides dieselbe Zeile ist. Idempotent durch notified_at is null; parallele Laeufe serialisieren ueber Zeilensperren, ein Schloss ist nicht nötig. KEIN Nutzerkontext erforderlich: das update benutzt auth.uid() nicht, nur die Zaehlung am Ende - unter einem Scheduler ist sie 0 und die Ausloesung laeuft vollstaendig. Keine Karenzzeit, kein Spiegelzustand, kein Blick auf favorites. Erzeugt keine E-Mail und keine Push-Nachricht.';

revoke all on function public.fire_availability_alerts() from public, anon;
grant execute on function public.fire_availability_alerts() to authenticated;


-- ---------------------------------------------------------------------------
-- 5d. acknowledge_availability_alerts() — „Gesehen"
--
-- EREIGNISGENAU UEBER DIE `id`. Der Auftrag verlangt ausdruecklich, dass eine
-- Bestaetigung das konkrete Ereignis trifft und nicht lediglich eine SKY-ID —
-- und dass dabei historische Meldungen nicht mitveraendert werden. Beides
-- steht im `where`: `a.id = any (p_ids)` und `a.read_at is null`.
--
-- SIE SCHLIESST DEN ALARM UND MARKIERT DIE MELDUNG IN EINEM, weil es
-- dieselbe Zeile ist. Das eine kann nicht ohne das andere gelten.
--
-- LEERE LISTE IST NICHT `null`. `null` heisst „alle eigenen ausgeloesten und
-- unbestaetigten" — das ist der Knopf am Kopf des Posteingangs. Eine leere
-- Liste markiert NICHTS (`id = any('{}')` ist falsch), sonst wuerde aus
-- „bestaetige diese null Karten" stillschweigend „bestaetige alles". Dieselbe
-- Unterscheidung wie in `0149`.
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_availability_alerts(
  p_ids bigint[] default null
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with bestaetigt as (
    update public.availability_alerts a
       set read_at = now()
     where (select auth.uid()) = a.user_id
       and public.is_collector_account()
       and a.notified_at is not null
       and a.read_at is null
       and (p_ids is null or a.id = any (p_ids))
    returning 1
  )
  select count(*)::integer from bestaetigt;
$$;

comment on function public.acknowledge_availability_alerts(bigint[]) is
  'Bestaetigt eigene ausgeloeste Verfuegbarkeitsalarme und gibt deren Anzahl zurueck (0150, ADR-0147). EREIGNISGENAU: p_ids nennt Alarme, nicht Figuren - eine SKY-ID koennte einen zweiten, gerade entstandenen Alarm mitnehmen. Ohne p_ids alle eigenen ausgeloesten und unbestaetigten; eine LEERE Liste bestaetigt nichts. read_at is null im where haelt historische Meldungen unberuehrt und macht einen zweiten Klick folgenlos. Mit dem read_at ist der Alarm abgeschlossen, und der Teilindex gibt die Figur fuer eine neue Vormerkung frei - sofern sie dann nicht kaufbar ist. EINE Anweisung; das where IST die Grenze, weil RLS fuer eine Definer-Funktion nicht gilt.';

revoke all on function public.acknowledge_availability_alerts(bigint[]) from public, anon;
grant execute on function public.acknowledge_availability_alerts(bigint[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
--
-- Die Migration prueft sich selbst, wie `0145` bis `0149`: Tabelle, Spalten,
-- Schluessel, Fremdschluessel, CHECKs, RLS, die EINE Richtlinie, die drei
-- Indizes samt ihrer Praedikate, die Rechte, die vier Funktionen samt
-- Eigenschaften — und dass keine Zeile entstanden ist und nichts Fremdes
-- angefasst wurde.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0150 Befund';
  v_n   integer;
  v_t   text;
begin
  if to_regclass('public.availability_alerts') is null then
    raise exception '%: die Tabelle fehlt', v_wer;
  end if;

  select string_agg(a.attname::text, ',' order by a.attnum) into v_t
    from pg_attribute a
   where a.attrelid = 'public.availability_alerts'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_t <> 'id,user_id,sky_id,created_at,notified_at,notified_cents,read_at' then
    raise exception '%: die Spaltenfolge ist "%"', v_wer, v_t;
  end if;

  -- `id` ist GENERATED ALWAYS, nicht BY DEFAULT: niemand schiebt einen Wert unter.
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.availability_alerts'::regclass
                    and attname = 'id' and attidentity = 'a') then
    raise exception '%: id ist nicht GENERATED ALWAYS AS IDENTITY', v_wer;
  end if;

  select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
    into v_t
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.availability_alerts'::regclass and c.contype = 'p';
  if coalesce(v_t, '(keiner)') <> 'id' then
    raise exception '%: der Primaerschluessel ist "%"', v_wer, coalesce(v_t, '(keiner)');
  end if;

  -- Die Katalogzeile darf nicht unter einem Alarm wegbrechen.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.availability_alerts'::regclass
                    and conname = 'availability_alerts_sky_fk' and confdeltype = 'r') then
    raise exception '%: availability_alerts_sky_fk ist nicht ON DELETE RESTRICT', v_wer;
  end if;
  -- Das Konto loeschen loescht die Alarme mit.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.availability_alerts'::regclass
                    and conname = 'availability_alerts_user_fk' and confdeltype = 'c') then
    raise exception '%: availability_alerts_user_fk ist nicht ON DELETE CASCADE', v_wer;
  end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.availability_alerts'::regclass and contype = 'c'
     and conname in ('availability_alerts_notified_price',
                     'availability_alerts_read_after_notified',
                     'availability_alerts_price_sane');
  if v_n <> 3 then
    raise exception '%: nur % von 3 CHECKs stehen', v_wer, v_n;
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.availability_alerts'::regclass) then
    raise exception '%: RLS ist nicht eingeschaltet', v_wer;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'availability_alerts';
  if v_n <> 1 then
    raise exception '%: % Richtlinien, erwartet genau eine (nur lesen)', v_wer, v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'availability_alerts'
     and 'anon' = any (roles);
  if v_n <> 0 then
    raise exception '%: % Richtlinie(n) gelten fuer anon', v_wer, v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'availability_alerts'
     and coalesce(qual, with_check) like '%is_collector_account()%'
     and coalesce(qual, with_check) like '%auth.uid()%';
  if v_n <> 1 then
    raise exception '%: die Richtlinie fragt nicht Konto UND Rolle', v_wer;
  end if;

  /*
   * DIE DREI INDIZES, UND ZWAR MIT IHREN PRAEDIKATEN. Ein Teilindex ohne
   * Praedikat waere ein anderer Index — und der erste von ihnen IST die
   * Fachregel, also wird gemessen, dass er partiell und eindeutig ist.
   */
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('public.availability_alerts_open_uniq')
                    and i.indisunique and i.indpred is not null) then
    raise exception '%: availability_alerts_open_uniq fehlt, ist nicht eindeutig '
      'oder kein Teilindex — und genau er ist die Regel "ein offener Alarm"', v_wer;
  end if;
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('public.availability_alerts_unread_idx')
                    and i.indpred is not null) then
    raise exception '%: availability_alerts_unread_idx fehlt oder ist kein Teilindex', v_wer;
  end if;
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('public.availability_alerts_pending_idx')
                    and i.indpred is not null) then
    raise exception '%: availability_alerts_pending_idx fehlt oder ist kein Teilindex', v_wer;
  end if;

  -- `authenticated` hat GENAU `SELECT`. Kein insert, kein update, kein delete.
  select coalesce(string_agg(distinct a.privilege_type, ',' order by a.privilege_type),
                  '(keine)')
    into v_t
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.availability_alerts'::regclass
     and a.grantee::regrole::text = 'authenticated'
     and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                              'REFERENCES', 'TRIGGER');
  if v_t <> 'SELECT' then
    raise exception '%: authenticated hat "%" — erwartet nur SELECT', v_wer, v_t;
  end if;
  select count(*) into v_n
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.availability_alerts'::regclass
     and a.grantee::regrole::text = 'anon';
  if v_n <> 0 then
    raise exception '%: anon hat % Tabellenrecht(e)', v_wer, v_n;
  end if;

  -- Die vier Funktionen: da, definer, volatile, genau eine search_path-Festlegung.
  for v_t in
    select x from unnest(array['public.watch_availability(text)',
                               'public.unwatch_availability(text)',
                               'public.fire_availability_alerts()',
                               'public.acknowledge_availability_alerts(bigint[])']) x
  loop
    if to_regprocedure(v_t) is null then
      raise exception '%: % fehlt', v_wer, v_t;
    end if;
    select count(*) into v_n from pg_proc p
     where p.oid = to_regprocedure(v_t)
       and p.prosecdef and p.provolatile = 'v'
       and (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
             where c like 'search\_path=%') = 1;
    if v_n <> 1 then
      raise exception '%: % ist nicht definer+volatile mit genau einer '
        'search_path-Festlegung', v_wer, v_t;
    end if;
    -- Kein EXECUTE fuer PUBLIC oder anon.
    select count(*) into v_n
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = to_regprocedure(v_t)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
    if v_n <> 0 then
      raise exception '%: % ist fuer PUBLIC oder anon ausfuehrbar', v_wer, v_t;
    end if;
  end loop;

  /*
   * DER ABGLEICH BENUTZT `auth.uid()` NICHT IM `update` — das ist die Zusage
   * an den spaeteren Scheduler, und sie wird GEMESSEN und nicht behauptet.
   * Geprueft am Rumpf: `auth.uid()` kommt genau einmal vor, und zwar in der
   * Zaehlung hinter dem `returning`.
   */
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure('public.fire_availability_alerts()');
  if (length(v_t) - length(replace(v_t, ';', ''))) > 1 then
    raise exception '%: der Rumpf von fire_availability_alerts() enthaelt mehr '
      'als eine Anweisung — die Atomaritaet haengt daran', v_wer;
  end if;
  if (select count(*) from regexp_matches(v_t, 'auth\.uid\(\)', 'g')) <> 1 then
    raise exception '%: fire_availability_alerts() nennt auth.uid() nicht genau '
      'einmal — es gehoert ausschliesslich in die Zaehlung, damit ein '
      'Scheduler ohne Nutzerkontext vollstaendig ausloest', v_wer;
  end if;
  if position('offer_state_live' in v_t) = 0 then
    raise exception '%: fire_availability_alerts() liest offer_state_live nicht', v_wer;
  end if;
  if position('notified_at is null' in v_t) = 0 then
    raise exception '%: fire_availability_alerts() beschraenkt sich nicht auf '
      'noch nicht ausgeloeste Alarme — ein zweiter Lauf wuerde erneut melden', v_wer;
  end if;
  if position('favorites' in v_t) > 0 then
    raise exception '%: fire_availability_alerts() nennt favorites — Herz und '
      'Glocke sind unabhaengig (ADR-0147)', v_wer;
  end if;
  if position('offer_state ' in v_t) > 0 or position('offer_state.' in v_t) > 0 then
    raise exception '%: fire_availability_alerts() nennt die Spiegeltabelle', v_wer;
  end if;

  -- „Gesehen" ist eine Anweisung, trifft die id und schont die Historie.
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure('public.acknowledge_availability_alerts(bigint[])');
  if (length(v_t) - length(replace(v_t, ';', ''))) > 1 then
    raise exception '%: acknowledge_availability_alerts() ist nicht eine Anweisung', v_wer;
  end if;
  if position('(select auth.uid()) = a.user_id' in v_t) = 0 then
    raise exception '%: acknowledge_availability_alerts() traegt die '
      'Eigentuemerbedingung nicht — RLS gilt fuer eine Definer-Funktion nicht, '
      'dieses where IST die Grenze', v_wer;
  end if;
  if position('a.read_at is null' in v_t) = 0 then
    raise exception '%: acknowledge_availability_alerts() schont historische '
      'Meldungen nicht (read_at is null fehlt)', v_wer;
  end if;
  if position('a.id = any (p_ids)' in v_t) = 0 then
    raise exception '%: acknowledge_availability_alerts() bestaetigt nicht '
      'ereignisgenau ueber die id', v_wer;
  end if;

  -- Scharf stellen prueft die Gegenwart und nennt kein fremdes Konto.
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure('public.watch_availability(text)');
  if position('offer_state_live' in v_t) = 0 then
    raise exception '%: watch_availability() prueft die Kaufbarkeit nicht gegen '
      'offer_state_live', v_wer;
  end if;
  if position('is_collector_account()' in v_t) = 0 then
    raise exception '%: watch_availability() prueft is_collector_account() nicht', v_wer;
  end if;

  -- KEIN TRIGGER. Nirgends, und schon gar nicht an den Shopquellen.
  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal
     and t.tgrelid in (to_regclass('public.availability_alerts'),
                       to_regclass('public.shop_inventory'),
                       to_regclass('public.skylanders'),
                       to_regclass('public.shop_settings'))
     and t.tgname like '%availability_alert%';
  if v_n <> 0 then
    raise exception '%: % Trigger mit availability_alert im Namen — 0150 legt '
      'keinen an, und ein Fehler im Abgleich darf keinen Kauf erreichen', v_wer, v_n;
  end if;

  -- Keine Zeile. Die Migration legt keinen Alarm an.
  select count(*) into v_n from public.availability_alerts;
  if v_n <> 0 then
    raise exception '%: die Migration hat % Alarm(e) angelegt', v_wer, v_n;
  end if;

  /*
   * UND WAS BLEIBEN MUSS, STEHT NOCH. Der wichtigere Teil: eine additive
   * Migration, die etwas Fremdes mitnimmt, ist nicht additiv.
   *
   * GEPRUEFT WIRD NUR, WAS DIESE MIGRATION WIRKLICH VORAUSSETZT — und das
   * ist eine Lehre, die beim Schreiben der Nachbedingung entstanden ist:
   * hier standen zuerst auch `favorites`, `offer_state` und
   * `availability_notifications`. Keine dieser drei liegt auf Production,
   * und eine Nachbedingung, die sie verlangt, haette `0150` dort
   * UNANWENDBAR gemacht — eine Umgebungsannahme als Zusage verkleidet.
   *
   * Dass die alte Bauform unberuehrt bleibt, ist deshalb Sache der
   * NACHKONTROLLE: sie vergleicht denselben Vertrag vor und nach dem Lauf
   * und sieht damit auch, was diese Migration gar nicht nennt.
   */
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: offer_state_live wurde angefasst — 0150 liest sie', v_wer;
  end if;
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '%: shop_offers() wurde angefasst', v_wer;
  end if;
  if to_regclass('public.shop_inventory') is null then
    raise exception '%: shop_inventory wurde angefasst', v_wer;
  end if;
  if to_regclass('public.skylanders') is null then
    raise exception '%: skylanders wurde angefasst', v_wer;
  end if;
  if to_regprocedure('public.is_collector_account()') is null then
    raise exception '%: is_collector_account() wurde angefasst — sie gehoert '
      '0042 und jeder Sammlungsrichtlinie', v_wer;
  end if;

  raise notice '0150 ok: availability_alerts steht, 7 Spalten, PK (id), RLS an, '
    '1 Richtlinie (nur lesen, ohne anon), 3 Teilindizes (einer eindeutig und '
    'damit die Regel "ein offener Alarm je Konto und Figur"), Recht genau '
    'SELECT fuer authenticated und nichts fuer anon, 4 Definer-Funktionen mit '
    'leerem search_path, der Abgleich als EINE Anweisung ohne Nutzerkontext, '
    '0 Zeilen. offer_state_live, shop_offers, shop_inventory, skylanders '
    'und is_collector_account unberuehrt. Kein Trigger, kein Scheduler, '
    'kein Aufrufer.';
end $$;
