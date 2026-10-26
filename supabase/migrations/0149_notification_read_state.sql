-- ===========================================================================
-- 0149 — GELESEN ODER NICHT (Phase 4, Schritt S4)
--
-- WAS SIE TUT: `availability_notifications` bekommt `read_at` und EINEN
-- Schreibweg dafuer. Damit kann die Oberflaeche zwischen „neu" und „schon
-- gesehen" unterscheiden und einen Ungelesen-Zaehler bilden.
--
-- WARUM ERST JETZT. `0148` hat die Spalte ABSICHTLICH nicht angelegt: eine
-- Spalte ohne Mechanik waere Vorbereiten, und das ist in diesem Projekt kein
-- Verfahren (ADR-0021). Jetzt kommt die Mechanik, also kommt die Spalte.
--
-- WAS SIE NICHT TUT: keine E-Mail, keine Push-Nachricht, kein Preisalarm,
-- kein Scheduler, keine Benachrichtigungseinstellung, keine zweite
-- Erkennung. Die Erkennung bleibt `0147`, die Verarbeitung bleibt `0148`.
--
-- ===========================================================================
-- KEIN `update`-RECHT AUF DER TABELLE — EINE FUNKTION STATTDESSEN
-- ===========================================================================
--
-- Der naheliegende Weg waere `grant update (read_at) … to authenticated` mit
-- einer `for update`-Richtlinie. Er wird NICHT genommen:
--
--   * Ein Tabellenrecht ist breiter als die Absicht. „Als gelesen markieren"
--     heisst `read_at = now()` fuer eigene ungelesene Zeilen — nicht „setze
--     diese Spalte auf irgendeinen Wert", und auch nicht auf einen Wert in
--     der Zukunft oder zurueck auf NULL.
--   * Es waere das ERSTE Schreibrecht eines Clients auf dieser Tabelle.
--     `0148` hat festgehalten, dass ausschliesslich
--     `claim_availability_notifications()` schreibt. Diese Zusage bleibt
--     gueltig: auch jetzt schreibt kein Client direkt, sondern eine zweite
--     Funktion mit genau einer Wirkung.
--
-- `mark_availability_notifications_read()` ist `security definer` und traegt
-- die Eigentuemerbedingung in ihrem `where`. RLS gilt fuer eine
-- Definer-Funktion nicht, also IST dieses `where` die Grenze — und es ist
-- dieselbe Bedingung wie in der `select`-Richtlinie aus `0148`, Wort fuer
-- Wort: `(select auth.uid()) = user_id and public.is_collector_account()`.
-- Wer eine Meldung nicht lesen darf, kann sie auch nicht als gelesen
-- markieren.
--
-- ===========================================================================
-- DIE ANZEIGE MARKIERT NICHTS
-- ===========================================================================
--
-- Es gibt genau einen Weg, `read_at` zu setzen: diese Funktion, aufgerufen
-- aus einer Serveraktion, die eine Nutzerhandlung beantwortet. Das Laden der
-- Seite ruft sie nicht. Lesen und Markieren sind dadurch zwei getrennte
-- Wege, und nicht zwei Wirkungen eines Weges.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. DIE SPALTE
-- ---------------------------------------------------------------------------
--
-- Nullbar und ohne Vorgabewert, und beides ist die Aussage: NULL heisst
-- ungelesen. Die 0148-Zeilen, die bis zur Migration entstanden sind, werden
-- damit zu Recht als neu gezeigt — sie sind neu; es gab bis jetzt keine
-- Oberflaeche, in der sie jemand hat sehen koennen. Ein Vorgabewert
-- `now()` wuerde sie alle auf einen Schlag als gelesen fuehren, ein
-- Backfill ebenso: beides erfaende eine Lesehandlung, die nicht
-- stattgefunden hat.
alter table public.availability_notifications
  add column read_at timestamptz;

comment on column public.availability_notifications.read_at is
  'Wann der Nutzer diese Meldung als gelesen markiert hat; NULL heisst ungelesen (0149). Gesetzt ausschliesslich von mark_availability_notifications_read() — Clients haben kein update-Recht auf dieser Tabelle, und das Anzeigen einer Meldung setzt sie nicht.';

-- ---------------------------------------------------------------------------
-- 2. DER INDEX FUER DEN ZAEHLER
-- ---------------------------------------------------------------------------
--
-- Die Marke in der Navigationsleiste fragt bei JEDEM Aufruf einer
-- geschuetzten Seite „wie viele ungelesene habe ich". Das ist die haeufigste
-- Abfrage dieser Tabelle und sie soll nicht die ganze Zeilenmenge eines
-- Nutzers lesen muessen.
--
-- TEILINDEX, nicht voller Index: gelesene Meldungen bleiben liegen und
-- werden mit der Zeit die Mehrheit. Der Index soll nur so gross sein wie die
-- Frage, die er beantwortet.
create index availability_notifications_unread_idx
  on public.availability_notifications (user_id)
  where read_at is null;

comment on index public.availability_notifications_unread_idx is
  'Teilindex fuer den Ungelesen-Zaehler der Navigationsleiste (0149). Nur ungelesene Zeilen: gelesene werden mit der Zeit die Mehrheit und beantworten diese Frage nicht.';

-- ---------------------------------------------------------------------------
-- 3. DER EINE SCHREIBWEG
-- ---------------------------------------------------------------------------

create or replace function public.mark_availability_notifications_read(
  p_sky_ids text[] default null
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with markiert as (
    update public.availability_notifications n
       set read_at = now()
     where (select auth.uid()) = n.user_id
       and public.is_collector_account()
       and n.read_at is null
       /*
        * OHNE LISTE ALLES, MIT LISTE GENAU DIESE. Die Oberflaeche braucht
        * beides: „diese eine habe ich gesehen" am Klick und „alle gesehen"
        * am Kopf des Abschnitts. Zwei Funktionen dafuer waeren zwei Stellen,
        * an denen die Eigentuemerbedingung richtig sein muss.
        */
       and (p_sky_ids is null or n.sky_id = any (p_sky_ids))
    returning 1
  )
  select count(*)::integer from markiert;
$$;

comment on function public.mark_availability_notifications_read(text[]) is
  'Markiert eigene ungelesene Verfuegbarkeitsmeldungen als gelesen und gibt deren Anzahl zurueck (0149, Phase 4 S4). Ohne p_sky_ids alle, mit p_sky_ids nur diese Figuren. security definer: das where traegt dieselbe Eigentuemerbedingung wie die select-Richtlinie aus 0148, und weil RLS fuer eine Definer-Funktion nicht gilt, IST dieses where die Grenze. Es gibt keinen anderen Weg, read_at zu setzen — insbesondere setzt das Anzeigen einer Meldung sie nicht.';

/*
 * DIE RECHTE, in derselben Reihenfolge wie in `0148`: erst alles entziehen,
 * dann genau eines geben. `anon` bekommt nichts — eine Meldung gehoert einem
 * Konto, und ohne Konto gibt es keine.
 */
revoke all on function public.mark_availability_notifications_read(text[]) from public;
revoke all on function public.mark_availability_notifications_read(text[]) from anon;
grant execute on function public.mark_availability_notifications_read(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. NACHWEIS
-- ---------------------------------------------------------------------------
--
-- Dieselbe Bauform wie in `0142`–`0148`: die Migration prueft ihr eigenes
-- Ergebnis und bricht ab, statt einen halben Zustand stehen zu lassen.
do $$
declare
  v_wer   text := '0149 ABBRUCH';
  v_n     integer;
  v_t     text;
begin
  -- 4.1 Die Spalte, und sie ist nullbar und ohne Vorgabewert.
  select count(*) into v_n
    from pg_attribute a
   where a.attrelid = to_regclass('public.availability_notifications')
     and a.attname = 'read_at'
     and a.attnum > 0
     and not a.attisdropped
     and a.atttypid = 'timestamptz'::regtype
     and not a.attnotnull
     and not a.atthasdef;
  if v_n <> 1 then
    raise exception '%: read_at fehlt oder ist nicht nullbares timestamptz '
      'ohne Vorgabewert (NULL heisst ungelesen)', v_wer;
  end if;

  -- 4.2 Die Tabelle hat jetzt SECHS Spalten, und keine mehr.
  select count(*) into v_n
    from pg_attribute a
   where a.attrelid = to_regclass('public.availability_notifications')
     and a.attnum > 0 and not a.attisdropped;
  if v_n <> 6 then
    raise exception '%: % Spalten statt 6', v_wer, v_n;
  end if;

  /*
   * 4.3 KEINE ZEILE WURDE ALS GELESEN ERFUNDEN. Die Spalte kommt leer, und
   * zwar ueberall — das ist der Unterschied zwischen „neu" und „nachtraeglich
   * als gesehen gefuehrt".
   */
  select count(*) into v_n
    from public.availability_notifications
   where read_at is not null;
  if v_n <> 0 then
    raise exception '%: % Meldung(en) tragen schon ein read_at — die '
      'Migration setzt keines', v_wer, v_n;
  end if;

  -- 4.4 Der Teilindex, und er ist der TEILindex.
  select count(*) into v_n
    from pg_index i
   where i.indexrelid = to_regclass('public.availability_notifications_unread_idx')
     and i.indrelid = to_regclass('public.availability_notifications')
     and i.indpred is not null;
  if v_n <> 1 then
    raise exception '%: availability_notifications_unread_idx fehlt oder ist '
      'kein Teilindex', v_wer;
  end if;

  -- 4.5 Die Funktion: definer, volatile, mit Festlegung des search_path.
  select count(*) into v_n
    from pg_proc p
   where p.oid = to_regprocedure(
           'public.mark_availability_notifications_read(text[])')
     and p.prosecdef
     and p.provolatile = 'v'
     /*
      * `like 'search\_path=%'` UND NICHT `= 'search_path='`.
      *
      * PostgreSQL speichert `set search_path = ''` je nach Fassung als
      * `search_path=` oder als `search_path=""` — ein exakter Vergleich gegen
      * das eine Literal hat am 2026-10-20 einen Lauf abgebrochen, obwohl die
      * Festlegung da war. Geprueft wird deshalb, DASS eine Festlegung
      * existiert, nicht wie sie geschrieben steht.
      */
     and (select count(*) from unnest(coalesce(p.proconfig, '{}')) x
           where x like 'search\_path=%') = 1;
  if v_n <> 1 then
    raise exception '%: mark_availability_notifications_read(text[]) ist '
      'nicht definer+volatile mit search_path-Festlegung', v_wer;
  end if;

  /*
   * 4.6 SIE IST EINE EINZIGE ANWEISUNG — dieselbe Zusage wie bei
   * `claim_availability_notifications()`. Ein `update` und ein `select`
   * darauf, in einem `with`-Ausdruck: kein Zustand dazwischen.
   */
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure(
           'public.mark_availability_notifications_read(text[])');
  if (length(v_t) - length(replace(v_t, ';', ''))) > 1 then
    raise exception '%: der Rumpf enthaelt mehr als eine Anweisung', v_wer;
  end if;

  /*
   * 4.7 DIE EIGENTUEMERBEDINGUNG STEHT IM RUMPF, und sie ist Wort fuer Wort
   * die der `select`-Richtlinie aus `0148`. Faellt sie weg, schreibt die
   * Funktion fremde Zeilen — fuer eine Definer-Funktion gibt es keine
   * zweite Absicherung dahinter.
   */
  if position('(select auth.uid()) = n.user_id' in v_t) = 0 then
    raise exception '%: der Rumpf traegt die Eigentuemerbedingung nicht — '
      'RLS gilt fuer eine Definer-Funktion nicht, dieses where IST die '
      'Grenze', v_wer;
  end if;
  if position('public.is_collector_account()' in v_t) = 0 then
    raise exception '%: der Rumpf prueft is_collector_account() nicht — wer '
      'eine Meldung nicht lesen darf, markiert sie auch nicht', v_wer;
  end if;
  if position('n.read_at is null' in v_t) = 0 then
    raise exception '%: der Rumpf beschraenkt sich nicht auf ungelesene '
      'Zeilen — ein zweiter Aufruf wuerde den Lesezeitpunkt verschieben',
      v_wer;
  end if;

  -- 4.8 Nichts fuer anon, nichts fuer PUBLIC.
  select count(*) into v_n
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure(
           'public.mark_availability_notifications_read(text[])')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
  if v_n <> 0 then
    raise exception '%: % EXECUTE fuer anon oder PUBLIC', v_wer, v_n;
  end if;

  /*
   * 4.9 KEIN CLIENT SCHREIBT DIREKT. Die Zusage aus `0148` gilt weiter:
   * `authenticated` hat genau `SELECT` und sonst nichts, `anon` nichts.
   * Haette die Migration hier ein `update`-Recht gegeben, waere es die
   * breitere Loesung gewesen — sie gibt keines.
   */
  select coalesce(string_agg(distinct a.privilege_type, ', ' order by a.privilege_type),
                  '(nichts)')
    into v_t
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = to_regclass('public.availability_notifications')
     and a.grantee::regrole::text = 'authenticated'
     and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                              'REFERENCES','TRIGGER');
  if v_t <> 'SELECT' then
    raise exception '%: authenticated hat "%" auf availability_notifications '
      '— erwartet wird genau SELECT', v_wer, v_t;
  end if;

  select count(*) into v_n
    from pg_class c, aclexplode(c.relacl) a
   where c.oid = to_regclass('public.availability_notifications')
     and (a.grantee = 0 or a.grantee::regrole::text = 'anon');
  if v_n <> 0 then
    raise exception '%: % Recht(e) fuer anon oder PUBLIC auf '
      'availability_notifications', v_wer, v_n;
  end if;

  -- 4.10 RLS bleibt an, und es bleibt bei EINER Richtlinie (der aus 0148).
  select count(*) into v_n
    from pg_class c
   where c.oid = to_regclass('public.availability_notifications')
     and c.relrowsecurity;
  if v_n <> 1 then
    raise exception '%: RLS ist nicht an', v_wer;
  end if;

  select coalesce(string_agg(pol.polname::text, ', ' order by pol.polname), '(keine)')
    into v_t
    from pg_policy pol
   where pol.polrelid = to_regclass('public.availability_notifications');
  if v_t <> 'availability_notifications_select_own' then
    raise exception '%: die Richtlinien lauten "%" — erwartet wird genau '
      'availability_notifications_select_own aus 0148. Diese Migration legt '
      'keine Schreibrichtlinie an; geschrieben wird durch eine Funktion',
      v_wer, v_t;
  end if;

  /*
   * 4.11 `claim_availability_notifications()` IST UNANGETASTET. Sie schreibt
   * `read_at` nicht — eine Meldung entsteht ungelesen, und sie entsteht
   * nicht als gelesen.
   */
  select prosrc into v_t from pg_proc
   where oid = to_regprocedure('public.claim_availability_notifications()');
  if v_t is null then
    raise exception '%: claim_availability_notifications() fehlt', v_wer;
  end if;
  if position('read_at' in v_t) > 0 then
    raise exception '%: claim_availability_notifications() nennt read_at — '
      'eine neue Meldung ist ungelesen, und das entscheidet die fehlende '
      'Spaltenangabe im insert, nicht ein Wert', v_wer;
  end if;

  -- 4.12 Kein Trigger, nirgends — wie in 0147 und 0148.
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

  raise notice '0149 ok: read_at steht (nullbar, ohne Vorgabewert, 0 Zeilen '
    'als gelesen gefuehrt), Teilindex fuer den Zaehler, '
    'mark_availability_notifications_read(text[]) definer+volatile als EINE '
    'Anweisung nur fuer authenticated, kein update-Recht fuer Clients, RLS '
    'an mit EINER Richtlinie aus 0148, kein Trigger. Keine E-Mail, kein '
    'Push, kein Preisalarm, kein Scheduler.';
end $$;
