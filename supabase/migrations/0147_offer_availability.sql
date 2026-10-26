-- ===========================================================================
-- 0147 — VERFUEGBARKEITSERKENNUNG (Phase 4, Schritt S2)
--
-- WAS SIE TUT: sie macht aus dem Angebotsspiegel eine KANTE. `0146` weiss,
-- ob eine Figur jetzt kaufbar ist; diese Migration weiss, ob sie es WIEDER
-- geworden ist, seit wann ununterbrochen, und ob darueber schon berichtet
-- wurde.
--
-- WAS SIE NICHT TUT: sie schreibt keine Benachrichtigung, legt keine Tabelle
-- dafuer an, und sie VERBRAUCHT KEIN EREIGNIS. `offer_availability_due()`
-- ist rein lesend. Das ist Absicht: S3 soll ein erkanntes Ereignis in
-- DERSELBEN Transaktion uebernehmen, in der es die Meldungen anlegt — waere
-- es hier schon als erledigt vermerkt, waere es verloren, sobald S3 dabei
-- scheitert.
--
-- ===========================================================================
-- DIE LUECKE IM DATENMODELL VON 0146, UND DIE KLEINSTE BEHEBUNG
-- ===========================================================================
--
-- `0146` haelt EINEN Zeitstempel fuer den fachlichen Zustand: `changed_at`,
-- „die letzte ECHTE Aenderung von buyable ODER cheapest_cents". Fuer S2
-- reicht das an zwei Stellen nicht:
--
--   1. EINE PREISAENDERUNG SETZT IHN ZURUECK. Eine Figur, die durchgehend
--      kaufbar ist und nach 10 Minuten billiger wird, hat `changed_at =
--      jetzt` — die Karenzzeit beginnt von vorn. Das verzoegert nur, aber es
--      macht `changed_at` zu einer FALSCHEN Auskunft darueber, wann die
--      Kaufbarkeit begann. Und genau die braucht S3: benachrichtigt werden
--      soll, wer VOR dieser Kaufbarkeit vorgemerkt hat. Mit dem
--      zurueckgesetzten Zeitstempel bekaeme auch jemand eine Meldung, der
--      waehrend der laufenden Kaufbarkeit vorgemerkt hat — also genau der
--      Fall, den Anforderung 1 ausschliesst.
--
--   2. EINE KURZE ABWESENHEIT IST HINTERHER NICHT VON EINER ECHTEN ZU
--      UNTERSCHEIDEN. Eine Warenkorbreservierung macht `available_quantity`
--      null, also `buyable = false`, also `changed_at = jetzt`. Gibt der
--      Warenkorb wieder frei, sieht das aus wie ein neuer
--      Verfuegbarkeitszyklus — und 30 Minuten spaeter waere eine zweite
--      Meldung fuer dasselbe Angebot faellig. Gespeichert ist nur der
--      BEGINN der laufenden Phase, nicht die Dauer der vorigen; nach dem
--      Uebergang ist die Unterscheidung unwiederbringlich fort.
--
-- EINE SPALTE BEHEBT BEIDES: `buyable_since`.
--
--   * Sie bewegt sich NUR bei einem Uebergang „nicht kaufbar → kaufbar",
--     nie bei einer Preisaenderung. Damit ist sie die Phasengrenze, gegen
--     die sowohl die Karenzzeit als auch S3 rechnen darf.
--   * Und sie bewegt sich nur, wenn die vorige Abwesenheit MINDESTENS
--     `reservation_ttl()` gedauert hat. War sie kuerzer, galt sie als
--     dieselbe Phase: eine Warenkorbreservierung unterbricht nichts.
--
-- WARUM NICHT `changed_at` UMDEUTEN: die Spalte ist angewendet, ihr
-- Kommentar steht, und die Preisaenderung ist das Signal fuer die spaetere
-- Preissenkungsmeldung (D-4, standardmaessig aus). Zwei Fragen, zwei
-- Spalten.
--
-- WARUM KEINE EREIGNISTABELLE: ein Ereignis ist hier vollstaendig ABLEITBAR
-- aus (`buyable`, `buyable_since`, `announced_at`). Eine Tabelle daneben
-- waere eine zweite Wahrheit, die mit der ersten auseinanderlaufen kann —
-- und sie muesste aufgeraeumt werden. S3 legt an, was S3 braucht.
--
-- ===========================================================================
-- WAS `offer_availability_due()` ENTSCHEIDET
-- ===========================================================================
--
--   kaufbar                       `buyable` im Spiegel
--   stabil seit mindestens 30 min `now() - buyable_since >= grace()`
--   darueber noch nicht berichtet `announced_at is null or
--                                  buyable_since > announced_at`
--   und JETZT wirklich kaufbar    innerer Verbund auf `offer_state_live`
--
-- DIE LETZTE ZEILE IST DIE GEGENPROBE, die `0146` ausdruecklich verlangt:
-- der Spiegel sagt, WAS SICH GEAENDERT HAT, die Sicht sagt, WAS JETZT GILT.
-- `offer_state_live` liest ausschliesslich `shop_offers()` — also dieselbe
-- Projektion, die den Shop speist. Ein Spiegel, der zu alt ist, kann damit
-- nur noch ein Ereignis VERPASSEN, nie eines erfinden.
--
-- `mirror_checked_at` kommt mit zurueck, damit der Aufrufer das Alter des
-- Spiegels selbst beurteilen kann. Es ist KEINE Frischegarantie (siehe den
-- Spaltenkommentar in `0146`) — es ist die Angabe, die eine Frischepruefung
-- erst moeglich macht.
--
-- KEIN DUPLIKAT, OHNE EINE ZEILE ZU SCHREIBEN. Dass dasselbe Ereignis nicht
-- zweimal freigegeben wird, haengt an `announced_at` — und das setzt S3,
-- wenn es die Meldungen anlegt. Bis dahin liefert diese Funktion dasselbe
-- Ereignis bei jedem Aufruf, und das ist richtig: es ist ja noch faellig.
-- Gleichzeitige Aufrufe sind damit unkritisch; die Serialisierung gehoert an
-- die Stelle, die SCHREIBT (S3, `for update skip locked` auf `offer_state`).
--
-- EIN SPAETERER ZYKLUS geht wieder: eine echte Abwesenheit (mindestens
-- `reservation_ttl()`) setzt beim naechsten Mal `buyable_since` neu, und
-- dann ist `buyable_since > announced_at` wieder wahr.
--
-- ===========================================================================
-- DER VERTRAG FUER S3: SO UEBERNIMMT ES EIN EREIGNIS, ATOMAR UND
-- KONKURRIERUNGSSICHER
-- ===========================================================================
--
-- S3 legt die Meldungen an und vermerkt den gemeldeten Stand IN DERSELBEN
-- TRANSAKTION. Der Vermerk ist dabei kein blosses `set`, sondern traegt die
-- FAELLIGKEITSBEDINGUNG als `where` mit:
--
--   update public.offer_state s
--      set announced_buyable = true,
--          announced_cents   = s.cheapest_cents,
--          announced_at      = now()
--    where s.sky_id = <sky_id>
--      and s.buyable
--      and s.buyable_since is not null
--      and now() - s.buyable_since >= public.offer_availability_grace()
--      and (s.announced_at is null or s.buyable_since > s.announced_at)
--   returning s.sky_id;
--
-- KOMMT KEINE ZEILE ZURUECK, IST DAS EREIGNIS SCHON UEBERNOMMEN — und dann
-- darf S3 keine Meldung schreiben. Kommt eine zurueck, gehoert sie dieser
-- Transaktion.
--
-- WARUM DAS OHNE SPERRE UND OHNE EINE WEITERE FUNKTION REICHT. PostgreSQL
-- nimmt fuer ein `update` eine Zeilensperre. Laeuft ein zweiter Aufruf
-- gleichzeitig, wartet er darauf und prueft sein `where` danach gegen die
-- NEUE Fassung der Zeile (READ COMMITTED) — dort steht dann `announced_at`
-- auf jetzt und `buyable_since > announced_at` ist falsch. Er bekommt null
-- Zeilen. Die Bedingung IST der Riegel.
--
-- UND DESHALB STEHT SIE AN DER ZEILE, nicht in einer Hilfsfunktion. Eine
-- `stable` Funktion im `where` eines `update` sieht den Schnappschuss der
-- Anweisung und nicht die neu gelesene Zeile; sie wuerde nach dem Warten
-- WEITER `true` sagen, und genau dann entstuende das Duplikat, das sie
-- verhindern soll. Die drei Bedingungen hier sind dieselben, die
-- `offer_availability_due()` fragt — `availability.test.ts` prueft, dass sie
-- nicht auseinanderlaufen.
--
-- WAS S3 AUSSERDEM BRAUCHT, und was es NICHT von hier bekommt: die Konten.
-- Benachrichtigt wird, wer VOR dieser Kaufbarkeit vorgemerkt hat, also
-- `favorites.created_at < buyable_since`. Dafuer gibt
-- `offer_availability_due()` die Phasengrenze mit zurueck.
-- ===========================================================================
--
-- NICHTS AN SHOP, LAGER ODER SAMMLUNG. Diese Migration liest
-- `shop_offers()` ueber die bestehende Sicht und schreibt ausschliesslich in
-- `offer_state`. Kein Trigger, kein Scheduler, keine neue Tabelle, keine
-- neue Berechtigung.
-- ===========================================================================

do $$
declare
  v_wer text := '0147 ABBRUCH';
  v_n   integer;
begin
  -- ---------------------------------------------------- Vorbedingungen
  if to_regclass('public.offer_state') is null then
    raise exception '%: 0147 setzt 0146 voraus — public.offer_state fehlt', v_wer;
  end if;
  if to_regclass('public.offer_state_live') is null then
    raise exception '%: public.offer_state_live fehlt', v_wer;
  end if;
  if to_regprocedure('public.reservation_ttl()') is null then
    raise exception '%: public.reservation_ttl() fehlt (0010)', v_wer;
  end if;
  if to_regprocedure('public.offer_state_window()') is null then
    raise exception '%: public.offer_state_window() fehlt (0146)', v_wer;
  end if;

  select count(*) into v_n from pg_attribute a
   where a.attrelid = 'public.offer_state'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 8 then
    raise exception '%: offer_state hat % Spalten, erwartet werden die 8 aus '
      '0146 — eine andere Fassung als gedacht', v_wer, v_n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. `buyable_since` — die Phasengrenze
--
-- NULLABLE, und nicht nachtraeglich `not null`: eine Figur, die noch nie
-- kaufbar war, hat keine Phase. Dass eine KAUFBARE Zeile sie hat, haelt der
-- CHECK fest.
--
-- SIE BLEIBT STEHEN, wenn die Figur nicht mehr kaufbar ist. Das ist die
-- Phase, die geendet hat — und genau die braucht die Uebernahmeregel fuer
-- eine kurze Abwesenheit.
-- ---------------------------------------------------------------------------
alter table public.offer_state
  add column buyable_since timestamptz;

comment on column public.offer_state.buyable_since is
  'Seit wann die Figur ununterbrochen kaufbar ist (0147, Phase 4 S2). Bewegt sich NUR bei einem Uebergang nicht kaufbar -> kaufbar, und auch dann nur, wenn die vorige Abwesenheit mindestens reservation_ttl() gedauert hat — eine Warenkorbreservierung unterbricht die Phase also nicht. Anders als changed_at setzt eine PREISAENDERUNG sie nicht zurueck: changed_at ist das Signal fuer eine spaetere Preissenkungsmeldung, buyable_since die Phasengrenze fuer die Verfuegbarkeitsmeldung. Bleibt stehen, wenn die Figur nicht mehr kaufbar ist — das ist die Phase, die geendet hat.';

/*
 * DIE NACHFUELLUNG, und sie darf keine Neuigkeit erfinden.
 *
 * `changed_at` ist das Beste, was ueber den Beginn der Kaufbarkeit bekannt
 * ist — aber es ist NICHT sicher. `changed_at` bewegt sich auch bei einer
 * PREISAENDERUNG (genau die Luecke, die diese Migration behebt). Hat sich
 * seit der Erstbefuellung bei einer Figur der Preis geaendert, steht
 * `changed_at` HINTER `announced_at` — und ein blosses
 * `buyable_since = changed_at` haette sie damit faellig gemacht. Eine
 * Meldung „wieder verfuegbar" fuer eine Figur, die durchgehend kaufbar war.
 *
 * DESHALB `least(...)`: ueber eine bereits gemeldete Zeile wurde berichtet,
 * WAEHREND sie kaufbar war. Die Phase begann also spaetestens damals, und
 * der frueheste der beiden bekannten Zeitpunkte ist die sichere Annahme.
 * Fuer eine noch nicht gemeldete Zeile bleibt `changed_at` — sie ist zu
 * Recht eine Neuigkeit, so wie `0146` sie angelegt hat.
 *
 * Die Zusicherung wird unten GEMESSEN, nicht angenommen.
 */
update public.offer_state
   set buyable_since = case
         when announced_at is not null then least(changed_at, announced_at)
         else changed_at
       end
 where buyable;

alter table public.offer_state
  add constraint offer_state_buyable_since_present
  check (not buyable or buyable_since is not null);


-- ---------------------------------------------------------------------------
-- 2. `offer_availability_grace()` — die Karenzzeit, an EINER Stelle
--
-- 30 Minuten, und zwar nicht als Zahl: `reservation_ttl()` (20 Minuten,
-- `0010`) plus 10 Minuten Luft. So steht die Beziehung zur
-- Reservierungsdauer im Code und nicht in einem Kommentar — wird die TTL je
-- geaendert, wandert die Karenzzeit mit.
-- ---------------------------------------------------------------------------
create or replace function public.offer_availability_grace()
returns interval
language sql
immutable
set search_path = ''
as $$
  select public.reservation_ttl() + interval '10 minutes';
$$;

comment on function public.offer_availability_grace() is
  'Die Stabilisierungszeit fuer eine Verfuegbarkeitsmeldung (0147, Phase 4 S2): reservation_ttl() + 10 Minuten, heute 30 Minuten. Keine Zahl im Code — wird die Reservierungsdauer geaendert, wandert die Karenzzeit mit.';

revoke all on function public.offer_availability_grace() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. `refresh_offer_state()` — dieselbe Funktion, eine Spalte mehr
--
-- GEAENDERT WIRD GENAU EINES: sie pflegt jetzt `buyable_since`. Drosselung,
-- Schloss, Erstbefuellung, die drei unterscheidbaren Antworten und die
-- Regel „`changed_at` nur bei echter Aenderung" bleiben Wort fuer Wort wie
-- in `0146`.
--
-- DIE UEBERNAHMEREGEL, in Worten:
--
--   war schon kaufbar            → Phase laeuft weiter, Wert bleibt
--   Abwesenheit kuerzer als TTL  → dieselbe Phase, Wert bleibt
--   sonst                        → neue Phase, Wert = jetzt
--
-- `s.changed_at` ist dabei der ALTE Wert: in einem `UPDATE` sehen alle
-- rechten Seiten die Zeile VOR der Aenderung. Waehrend einer Abwesenheit
-- bewegt sich `changed_at` nicht (der Preis ist null), also ist
-- `now() - s.changed_at` genau die Dauer der Abwesenheit.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_offer_state()
returns table (ran boolean, reason text, rows_checked integer, rows_changed integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_letzte  timestamptz;
  v_erst    boolean;
  v_geprueft integer := 0;
  v_geaendert integer := 0;
begin
  /* 1. Drosselung vor dem Schloss — die billigste Abweisung. */
  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  /* 2. Das Schloss: ein Lauf je Transaktion, sonst `locked`. */
  if not pg_try_advisory_xact_lock(146, 1) then
    return query select false, 'locked'::text, 0, 0;
    return;
  end if;

  /* 3. Drosselung erneut, jetzt unter dem Schloss. */
  select max(s.checked_at) into v_letzte from public.offer_state s;
  if v_letzte is not null and now() - v_letzte < public.offer_state_window() then
    return query select false, 'throttled'::text, 0, 0;
    return;
  end if;

  v_erst := not exists (select 1 from public.offer_state);

  /* 4. Wie viele weichen ab — gezaehlt VOR dem Schreiben. */
  select count(*) into v_geaendert
    from (
      select l.sky_id, true as buyable, l.cheapest_cents
        from public.offer_state_live l
      union all
      select s.sky_id, false, null::integer
        from public.offer_state s
       where not exists (select 1 from public.offer_state_live l
                          where l.sky_id = s.sky_id)
    ) soll
    left join public.offer_state alt on alt.sky_id = soll.sky_id
   where alt.sky_id is null
      or alt.buyable is distinct from soll.buyable
      or alt.cheapest_cents is distinct from soll.cheapest_cents;

  /* 5. Die kaufbaren: anlegen oder nachziehen. */
  insert into public.offer_state as s
    (sky_id, buyable, cheapest_cents, changed_at, checked_at, buyable_since,
     announced_buyable, announced_cents, announced_at)
  select
    l.sky_id, true, l.cheapest_cents, now(), now(), now(),
    case when v_erst then true end,
    case when v_erst then l.cheapest_cents end,
    case when v_erst then now() end
  from public.offer_state_live l
  on conflict (sky_id) do update
     set buyable        = true,
         cheapest_cents = excluded.cheapest_cents,
         changed_at     = case
                            when s.buyable is distinct from true
                              or s.cheapest_cents is distinct from excluded.cheapest_cents
                            then now()
                            else s.changed_at
                          end,
         /*
          * DIE PHASENGRENZE. Eine Preisaenderung kommt hier nicht vor —
          * deshalb ueberlebt sie, was `changed_at` nicht ueberlebt.
          */
         buyable_since  = case
                            when s.buyable and s.buyable_since is not null
                              then s.buyable_since
                            when s.buyable_since is not null
                             and now() - s.changed_at < public.reservation_ttl()
                              then s.buyable_since
                            else now()
                          end,
         checked_at     = now();

  /*
   * 6. Die nicht mehr kaufbaren: zurueckstellen.
   *
   * `buyable_since` BLEIBT STEHEN. Es ist die Phase, die geendet hat, und
   * Schritt 5 braucht sie, um eine kurze Abwesenheit als dieselbe Phase zu
   * erkennen.
   */
  update public.offer_state s
     set buyable        = false,
         cheapest_cents = null,
         changed_at     = case when s.buyable then now() else s.changed_at end,
         checked_at     = now()
   where not exists (select 1 from public.offer_state_live l
                      where l.sky_id = s.sky_id);

  select count(*) into v_geprueft from public.offer_state;
  return query select true, 'ran'::text, v_geprueft, v_geaendert;
end;
$$;

comment on function public.refresh_offer_state() is
  'Zieht den Angebotsspiegel gegen offer_state_live nach (0146, erweitert in 0147 um buyable_since). Gedrosselt auf offer_state_window(), ein Lauf je Transaktion ueber pg_try_advisory_xact_lock(146, 1), drei unterscheidbare Antworten: ran / throttled / locked. Der Aufrufer darf locked NIEMALS als eigenen Erfolg lesen. changed_at bewegt sich nur bei echter Aenderung von buyable oder cheapest_cents; buyable_since nur bei einem echten Uebergang nach kaufbar (Abwesenheit mindestens reservation_ttl()). Erzeugt KEINE Benachrichtigung und schreibt announced_* nur bei der Erstbefuellung. BEWEIST KEINE FRISCHE — wer eine Meldung darauf stuetzt, muss gegen offer_state_live gegenpruefen.';


-- ---------------------------------------------------------------------------
-- 4. `offer_availability_due()` — die Entscheidung, rein lesend
--
-- `stable` und nicht `volatile`: sie schreibt nichts, und sie soll nichts
-- schreiben koennen. Ein Ereignis gilt erst als uebernommen, wenn S3
-- `announced_*` setzt — in derselben Transaktion, in der es die Meldungen
-- anlegt.
--
-- `security definer`, weil `offer_state` bewusst kein Clientrecht hat; der
-- Rumpf laeuft als Eigner. Clientrechte auf die Funktion: keine. S3 erteilt,
-- was S3 braucht, wenn es einen Aufrufer hat.
-- ---------------------------------------------------------------------------
create or replace function public.offer_availability_due()
returns table (sky_id text, buyable_since timestamptz, cheapest_cents integer,
               mirror_checked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.sky_id, s.buyable_since, s.cheapest_cents, s.checked_at
    from public.offer_state s
    join public.offer_state_live l on l.sky_id = s.sky_id
   where s.buyable
     and s.buyable_since is not null
     and now() - s.buyable_since >= public.offer_availability_grace()
     and (s.announced_at is null or s.buyable_since > s.announced_at)
   order by s.buyable_since, s.sky_id;
$$;

comment on function public.offer_availability_due() is
  'Welche Figuren jetzt fuer eine Verfuegbarkeitsmeldung faellig sind (0147, Phase 4 S2): kaufbar, seit mindestens offer_availability_grace() ununterbrochen, darueber noch nicht berichtet (announced_at is null oder buyable_since > announced_at) — UND im inneren Verbund mit offer_state_live, also jetzt wirklich kaufbar nach shop_offers(). REIN LESEND: sie verbraucht kein Ereignis und setzt announced_* nicht. Dasselbe Ereignis kommt bei jedem Aufruf wieder, solange es faellig ist; die Serialisierung gehoert an die Stelle, die schreibt (S3). mirror_checked_at ist das Alter des Spiegels und KEINE Frischegarantie — es macht eine Frischepruefung moeglich. Nennt keine Nutzer: wer vorgemerkt hat und wer eine Meldung bekommt, entscheidet S3 ueber favorites.created_at < buyable_since. Wie S3 ein Ereignis atomar und konkurrierungssicher uebernimmt, steht im Kopf von 0147: ein update, das die Faelligkeitsbedingung als where mittraegt — kommt keine Zeile zurueck, war ein anderer Aufruf schneller.';

revoke all on function public.offer_availability_due() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachweis statt Absicht
-- ---------------------------------------------------------------------------
do $$
declare
  v_wer text := '0147 ABBRUCH';
  v_n   integer;
  v_t   text;
begin
  select count(*) into v_n from pg_attribute a
   where a.attrelid = 'public.offer_state'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 9 then
    raise exception '%: offer_state hat % Spalten, erwartet 9', v_wer, v_n;
  end if;

  select string_agg(a.attname::text, ',' order by a.attnum) into v_t
    from pg_attribute a
   where a.attrelid = 'public.offer_state'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_t <> 'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
            'announced_buyable,announced_cents,announced_at,buyable_since' then
    raise exception '%: die Spaltenfolge ist %', v_wer, v_t;
  end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.offer_state'::regclass and contype = 'c';
  if v_n <> 6 then
    raise exception '%: % CHECKs, erwartet 6 (5 aus 0146 plus '
      'offer_state_buyable_since_present)', v_wer, v_n;
  end if;

  /* Jede kaufbare Zeile hat eine Phasengrenze. */
  select count(*) into v_n from public.offer_state
   where buyable and buyable_since is null;
  if v_n <> 0 then
    raise exception '%: % kaufbare Zeile(n) ohne buyable_since', v_wer, v_n;
  end if;

  /*
   * DIE NACHFUELLUNG DARF KEINE FAELLIGKEIT ERFINDEN — und das ist enger
   * gefasst, als es zuerst dastand.
   *
   * Eine Zeile mit `announced_at is null` ist ZU RECHT faellig: `0146` legt
   * jede NACH der Erstbefuellung entstehende Zeile so an, weil eine Figur,
   * die neu kaufbar wird, eine Neuigkeit ist. Ein `count(... or announced_at
   * is null) <> 0` haette diese Migration also abgebrochen, sobald seit der
   * Erstbefuellung eine einzige Figur dazugekommen ist — ein Abbruch ohne
   * Mangel.
   *
   * Die wirkliche Zusage: fuer eine Zeile, ueber die SCHON BERICHTET wurde,
   * darf die Nachfuellung `buyable_since` nicht hinter `announced_at`
   * setzen. Genau das wird gemessen.
   */
  select count(*) into v_n from public.offer_state
   where buyable and buyable_since is not null
     and announced_at is not null and buyable_since > announced_at;
  if v_n <> 0 then
    raise exception '%: % bereits gemeldete Zeile(n) waeren nach der '
      'Nachfuellung wieder faellig — die Erstbefuellung traegt '
      'announced_at = changed_at, also darf das nicht vorkommen', v_wer, v_n;
  end if;

  if (select prosecdef from pg_proc
       where oid = to_regprocedure('public.offer_availability_due()')) then
    null;
  else
    raise exception '%: offer_availability_due() ist nicht security definer', v_wer;
  end if;

  select provolatile::text into v_t from pg_proc
   where oid = to_regprocedure('public.offer_availability_due()');
  if v_t <> 's' then
    raise exception '%: offer_availability_due() ist nicht stable (%) — eine '
      'Entscheidung, die schreiben kann, verbraucht Ereignisse vor S3',
      v_wer, v_t;
  end if;

  /* Keine Clientrechte auf die zwei neuen Funktionen. */
  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.offer_availability_due()'),
                   to_regprocedure('public.offer_availability_grace()'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  if v_n <> 0 then
    raise exception '%: % Clientrecht(e) auf die neuen Funktionen', v_wer, v_n;
  end if;

  /* Kein Trigger, keine neue Tabelle. */
  select count(*) into v_n from pg_trigger t
   where t.tgrelid in ('public.shop_inventory'::regclass,
                       'public.skylanders'::regclass,
                       'public.shop_settings'::regclass,
                       'public.offer_state'::regclass)
     and not t.tgisinternal;
  if v_n <> 0 then
    raise exception '%: % Trigger an den Quellen oder am Spiegel', v_wer, v_n;
  end if;

  raise notice '0147 ok: offer_state hat 9 Spalten (buyable_since zuletzt), '
    '6 CHECKs, jede kaufbare Zeile mit Phasengrenze, keine bereits '
    'gemeldete Zeile wieder faellig; '
    'offer_availability_grace() immutable und offer_availability_due() '
    'definer+stable, beide ohne Clientrecht; refresh_offer_state() pflegt '
    'buyable_since; kein Trigger, keine neue Tabelle, keine Benachrichtigung.';
end $$;
