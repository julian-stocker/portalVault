-- ===========================================================================
-- 0106 — Der Zugriffsweg auf die Exporthistorie, und eine Tür, die zugeht
--
-- WOFÜR. `0105` hat `platform_export_runs` absichtlich GESCHLOSSEN
-- ausgeliefert: RLS an, keine Policy, keine Grants. Damit war die Tabelle
-- sicher und gleichzeitig unbenutzbar — es gab keinen Weg hinein. Diese
-- Migration liefert genau diesen Weg nach, als drei Funktionen, und schließt
-- zusätzlich ein Recht, das nie von uns kam.
--
-- DIE TABELLE BEKOMMT KEINE POLICY. Der Zugriff läuft ausschließlich über
-- `security definer`-Funktionen. Eine Policy wäre eine zweite, parallele
-- Regel für dieselbe Frage — und eine Historie, die ein Client direkt
-- schreiben kann, ist keine.
--
-- WAS HIER AUSDRÜCKLICH NICHT DRINSTEHT: keine Route, keine Admin-Oberfläche,
-- keine Verbindung zum ZIP-Schreiber, kein Storage-Download, kein
-- auth.users-Inventar, kein Erinnerungsmechanismus, kein Restore. `0104` und
-- `0105` werden nicht angefasst; beide sind eingefroren und auf Staging
-- (`0105`) bzw. Staging und Production (`0104`) angewendet.
--
-- DIE ZUSTANDSMASCHINE, EINMAL AUFGESCHRIEBEN
--
--            admin_record_platform_export()
--                        │
--                        ▼
--                  ┌───────────┐
--                  │ generated │  das Archiv ist gebaut und ausgeliefert
--                  └─────┬─────┘
--          sha256 stimmt │ └──────── failure_stage
--                        ▼                  ▼
--                  ┌──────────┐       ┌────────┐
--                  │ received │       │ failed │
--                  └──────────┘       └────────┘
--                     ENDE               ENDE
--
-- `generated` ist der einzige Anfang und der einzige Zustand, aus dem etwas
-- werden kann. `received` und `failed` sind endgültig: kein Weg zurück, kein
-- Weg zueinander, keine Korrektur. Ein bestätigter Lauf ist ein NACHWEIS —
-- ließe er sich nachträglich auf `failed` setzen, wäre der Nachweis wertlos.
--
-- ZWEI SCHLÖSSER, NICHT EINS. Die Übergänge stehen in
-- `admin_settle_platform_export()`, UND ein Trigger hält sie unabhängig
-- davon fest. Das ist Absicht: die Funktion schützt vor falschem Aufruf, der
-- Trigger vor einem zweiten Schreibweg, den es heute noch nicht gibt.
-- Dieselbe Form wie `order_mail_protect()` seit `0019`.
--
-- WAS 0106 NOCH NICHT KANN, UND DAS SOLL MAN WISSEN. Ein Lauf entsteht erst,
-- wenn das Archiv fertig ist. Scheitert schon das Erzeugen — `database`,
-- `storage_manifest`, `archive` —, gibt es keine Zeile, die man auf `failed`
-- setzen könnte; `admin_record_platform_export()` legt ausschließlich
-- `generated` an. Erreichbar ist `failed` daher nur über den Abschluss, in
-- der Praxis mit `failure_stage = 'confirmation'`. Die übrigen Stufen der
-- CHECK-Liste aus `0105` bleiben vorerst reserviert. Ob ein Fehlschlag VOR
-- der Zeile überhaupt festgehalten werden soll, ist eine Entscheidung für den
-- Routen-Schritt — und keine, die hier still vorwegzunehmen wäre.
--
-- WER FRAGEN DARF. `is_platform_admin()` in allen drei Funktionen.
-- `admin_platform_export_runs()` trägt den Wächter als `where`-Bedingung und
-- liefert anderen eine LEERE Menge — „nicht deins" und „nichts vorhanden"
-- sehen gleich aus, wie bei `system_platform_export()`. Die beiden
-- schreibenden Funktionen werfen `insufficient_privilege`, weil ein
-- stillschweigend verworfener Schreibvorgang schlimmer ist als ein Fehler.
--
-- KEIN BACKUP-INHALT IN DER HISTORIE. `admin_platform_export_runs()` gibt
-- genau die zwölf Spalten der Tabelle zurück. Es gibt keinen Weg, über die
-- Historie an Exportdaten zu kommen, weil dort keine liegen.
--
-- TEIL 2 — `service_role` WIRD GESCHLOSSEN
--
-- Die Rollenproben auf Staging haben gezeigt: `service_role` hatte EXECUTE
-- auf `system_platform_export()` und direkte Tabellenrechte auf
-- `platform_export_runs`, OBWOHL `0105` beides nie vergeben hat. Das kam aus
-- Supabase' Default-Privileges auf `public`. Praktisch nützte das EXECUTE
-- nichts — das service-role-JWT trägt kein `sub`, `auth.uid()` ist null, das
-- Ergebnis war `null` —, aber die Tabellenrechte hätten gereicht, um
-- Historienzeilen zu fälschen oder zu löschen. Eine Historie, die als
-- Nachweis dient, darf nur über die geprüften Funktionen entstehen.
--
-- Diese Migration ändert KEINE globalen Default-Privileges. Sie schließt
-- diese beiden Objekte und sonst nichts; alles andere wäre eine Änderung an
-- der Rechtebasis des gesamten Schemas und gehört nicht in eine Migration
-- über eine Exporthistorie.
--
-- `postgres` bleibt Eigentümer und behält den administrativen Zugang.
--
-- RÜCKBAU.
--   drop trigger if exists platform_export_runs_no_delete on public.platform_export_runs;
--   drop trigger if exists platform_export_runs_protect   on public.platform_export_runs;
--   drop function if exists public.platform_export_runs_no_delete();
--   drop function if exists public.platform_export_runs_protect();
--   drop function if exists public.admin_settle_platform_export(bigint, text, text);
--   drop function if exists public.admin_record_platform_export(integer, text, bigint, text, integer, integer, integer);
--   drop function if exists public.admin_platform_export_runs();
--   grant execute on function public.system_platform_export() to service_role;  -- nur falls gewollt
-- Es wird nichts migriert, nichts überschrieben und keine Zeile angefasst.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Historie lesen
--
-- Neueste zuerst, und zwar nach `id`, nicht nach `created_at`: die Identität
-- ist monoton und eindeutig, zwei Läufe in derselben Sekunde hätten sonst
-- keine feste Reihenfolge. Eine Liste, die sich zwischen zwei Aufrufen
-- umsortiert, ist kein Nachweis.
--
-- `stable`, ein `select`, der Wächter als `where`-Bedingung.
-- ---------------------------------------------------------------------------

create or replace function public.admin_platform_export_runs()
returns table (
  id                    bigint,
  status                text,
  created_at            timestamptz,
  received_at           timestamptz,
  format_version        integer,
  source_project        text,
  size_bytes            bigint,
  sha256                text,
  section_count         integer,
  storage_file_count    integer,
  storage_missing_count integer,
  failure_stage         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.status, r.created_at, r.received_at,
         r.format_version, r.source_project, r.size_bytes, r.sha256,
         r.section_count, r.storage_file_count, r.storage_missing_count,
         r.failure_stage
    from public.platform_export_runs r
   where public.is_platform_admin()
   order by r.id desc;
$$;

comment on function public.admin_platform_export_runs() is
  'The manual platform export history, newest first (0106). Ordered by id, not created_at: identity is monotone and unique, and a list that reorders itself between two calls is not a record. Returns exactly the twelve columns of platform_export_runs — there is no path from the history to backup content, because none is stored there. A caller who is not a platform admin gets an empty set, not an error: "not yours" and "nothing there" look the same.';

revoke all on function public.admin_platform_export_runs() from public, anon;
grant execute on function public.admin_platform_export_runs() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Einen Lauf festhalten
--
-- Der EINZIGE Weg, auf dem eine Zeile entsteht, und sie entsteht immer als
-- `generated`. Der Status ist kein Parameter: eine Funktion, die ihn
-- annähme, könnte einen Lauf als bestätigt anlegen, ohne dass ihn jemand
-- bestätigt hat.
--
-- KEINE ZWEITE VALIDIERUNG. Form von Hash und Projektreferenz, Vorzeichen
-- der Zählwerte und die Vollständigkeit der Kennzahlen prüfen die
-- CHECK-Constraints aus `0105`. Sie hier zu wiederholen hieße, dieselbe
-- Regel an zwei Stellen zu pflegen — und irgendwann laufen die zwei
-- auseinander.
-- ---------------------------------------------------------------------------

create or replace function public.admin_record_platform_export(
  p_format_version        integer,
  p_source_project        text,
  p_size_bytes            bigint,
  p_sha256                text,
  p_section_count         integer,
  p_storage_file_count    integer,
  p_storage_missing_count integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin role required'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.platform_export_runs (
    status, format_version, source_project, size_bytes, sha256,
    section_count, storage_file_count, storage_missing_count)
  values (
    'generated', p_format_version, p_source_project, p_size_bytes, p_sha256,
    p_section_count, p_storage_file_count, p_storage_missing_count)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.admin_record_platform_export(integer, text, bigint, text, integer, integer, integer) is
  'Records one built platform export archive and returns its id (0106). The only way a row enters platform_export_runs, and it always enters as generated — status is deliberately not a parameter, or a caller could record a run as confirmed that nobody confirmed. Shape and sanity of the values are checked by the CHECK constraints from 0105 rather than repeated here.';

revoke all on function public.admin_record_platform_export(integer, text, bigint, text, integer, integer, integer) from public, anon;
grant execute on function public.admin_record_platform_export(integer, text, bigint, text, integer, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Einen Lauf abschließen
--
-- Genau eine der beiden Absichten pro Aufruf: entweder eine Prüfsumme
-- (→ `received`) oder eine Fehlerstufe (→ `failed`). Beides oder keines von
-- beidem ist keine Absicht, sondern ein Fehler im Aufrufer.
--
-- `for update` sperrt die Zeile. Zwei gleichzeitige Abschlüsse desselben
-- Laufs sollen nicht beide gewinnen.
--
-- DIE PRÜFSUMME WIRD VERGLICHEN, NICHT ÜBERNOMMEN. `received` heißt: die
-- Datei, die ankam, ist die Datei, die ging. Eine Funktion, die den Hash
-- einfach überschriebe, würde genau die Frage nicht beantworten, für die sie
-- existiert. Die Fehlermeldung nennt den gespeicherten Hash NICHT — sie sagt
-- nur, dass er nicht passt.
-- ---------------------------------------------------------------------------

create or replace function public.admin_settle_platform_export(
  p_id            bigint,
  p_sha256        text default null,
  p_failure_stage text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_sha256 text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Genau eine Absicht.
  if (p_sha256 is null) = (p_failure_stage is null) then
    raise exception 'settling takes either a sha256 (received) or a failure_stage (failed)'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.status, r.sha256 into v_status, v_sha256
    from public.platform_export_runs r
   where r.id = p_id
     for update;

  -- Eine unbekannte Kennung wird nicht still hingenommen.
  if not found then
    raise exception 'unknown platform export run'
      using errcode = 'no_data_found';
  end if;

  -- `received` und `failed` sind endgültig.
  if v_status <> 'generated' then
    raise exception 'a % run is final and cannot be settled again', v_status
      using errcode = 'check_violation';
  end if;

  if p_failure_stage is not null then
    update public.platform_export_runs
       set status = 'failed',
           failure_stage = p_failure_stage
     where id = p_id;
    return 'failed';
  end if;

  if v_sha256 is distinct from p_sha256 then
    raise exception 'the confirmed checksum does not match the recorded one'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.platform_export_runs
     set status = 'received',
         received_at = now()
   where id = p_id;
  return 'received';
end;
$$;

comment on function public.admin_settle_platform_export(bigint, text, text) is
  'Settles one platform export run and returns the status it reached (0106). Takes either a sha256 (→ received) or a failure_stage (→ failed), never both and never neither. generated is the only state that can be settled: received and failed are final, so a confirmed run can never be rewritten or turned into a failure — a record that can be edited afterwards is not a record. The checksum is COMPARED, not stored: received means the file that arrived is the file that left. An unknown id raises no_data_found rather than doing nothing quietly.';

revoke all on function public.admin_settle_platform_export(bigint, text, text) from public, anon;
grant execute on function public.admin_settle_platform_export(bigint, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Dasselbe noch einmal, unabhängig von der Funktion
--
-- Der Trigger kennt die Zustandsmaschine ein zweites Mal. Nicht aus
-- Misstrauen gegen `admin_settle_platform_export()`, sondern gegen jeden
-- zweiten Schreibweg, den es heute noch nicht gibt — eine spätere Migration,
-- ein Eingriff über das Dashboard, ein Werkzeug. Dieselbe Form wie
-- `order_mail_protect()` seit `0019`.
-- ---------------------------------------------------------------------------

create or replace function public.platform_export_runs_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nur ein erzeugter Lauf ist offen.
  if old.status <> 'generated' then
    raise exception 'a % run is final', old.status
      using errcode = 'restrict_violation';
  end if;

  -- Und er wird nur abgeschlossen, nicht umgeschrieben.
  if new.status not in ('received', 'failed') then
    raise exception 'a run settles to received or failed, not to %', new.status
      using errcode = 'restrict_violation';
  end if;

  -- Die gemessenen Tatsachen werden einmal geschrieben. Ein Backup, dessen
  -- Größe oder Prüfsumme sich nachträglich ändern lässt, belegt nichts.
  if new.id                    is distinct from old.id
  or new.created_at            is distinct from old.created_at
  or new.format_version        is distinct from old.format_version
  or new.source_project        is distinct from old.source_project
  or new.size_bytes            is distinct from old.size_bytes
  or new.sha256                is distinct from old.sha256
  or new.section_count         is distinct from old.section_count
  or new.storage_file_count    is distinct from old.storage_file_count
  or new.storage_missing_count is distinct from old.storage_missing_count then
    raise exception 'the measured facts of a run are written once'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

comment on function public.platform_export_runs_protect() is
  'Holds the export history''s state machine independently of admin_settle_platform_export() (0106): only a generated run is open, it settles to received or failed, and the measured facts — size, checksum, counts, origin, creation time — are written once. Same shape as order_mail_protect() since 0019.';

drop trigger if exists platform_export_runs_protect on public.platform_export_runs;
create trigger platform_export_runs_protect
  before update on public.platform_export_runs
  for each row execute function public.platform_export_runs_protect();


create or replace function public.platform_export_runs_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform export history is a record and is not deleted'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.platform_export_runs_no_delete() is
  'The export history is only ever added to (0106). Same shape as order_mail_no_delete() since 0019.';

drop trigger if exists platform_export_runs_no_delete on public.platform_export_runs;
create trigger platform_export_runs_no_delete
  before delete on public.platform_export_runs
  for each row execute function public.platform_export_runs_no_delete();


-- Niemand ruft die beiden Triggerfunktionen von Hand auf. Ein Trigger
-- braucht dafür kein EXECUTE — das wird beim `create trigger` geprüft, nicht
-- beim Feuern —, deshalb stehen die Revokes hinter der Anlage.
revoke all on function public.platform_export_runs_protect()   from public, anon, authenticated;
revoke all on function public.platform_export_runs_no_delete() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Teil 2 — die Tür, die zugeht
--
-- Beide Rechte kamen aus Supabase' Default-Privileges, nicht aus `0105`.
-- Gemessen auf Staging: `service_role` stand in der ACL von
-- `system_platform_export()` und hatte SELECT/INSERT/UPDATE/DELETE auf
-- `platform_export_runs`.
--
-- Das EXECUTE war praktisch wirkungslos (kein `sub` im service-role-JWT,
-- also `auth.uid() is null`, also `null` als Ergebnis) — aber ein Recht, das
-- nur deshalb harmlos ist, weil eine zweite Bedingung gerade nicht zutrifft,
-- ist kein Schutz. Die Tabellenrechte hätten gereicht, um Nachweise zu
-- fälschen.
--
-- Keine der drei Edge Functions (`create-payment`, `stripe-webhook`,
-- `send-order-mail`) berührt diese Objekte, und die spätere Export-Route
-- läuft in der Sitzung des Plattformadmins. Es geht also nichts verloren.
-- ---------------------------------------------------------------------------

revoke all on table public.platform_export_runs from service_role;
revoke execute on function public.system_platform_export() from service_role;

-- Die neuen Funktionen bekommen dieselbe Behandlung von Anfang an: sie sollen
-- nicht über den Default-Weg an eine Rolle geraten, die sie nicht braucht.
revoke execute on function public.admin_platform_export_runs() from service_role;
revoke execute on function public.admin_record_platform_export(integer, text, bigint, text, integer, integer, integer) from service_role;
revoke execute on function public.admin_settle_platform_export(bigint, text, text) from service_role;
revoke execute on function public.platform_export_runs_protect()   from service_role;
revoke execute on function public.platform_export_runs_no_delete() from service_role;
