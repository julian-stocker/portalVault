-- ===========================================================================
-- RUECKNAHME ZU 0035 — `system_set_image_override` loeschen
--
-- Zu `supabase/operations/prod-0035.sql`. Als `postgres` im SQL-Editor.
--
-- *** SIE VERWIRFT KEINE DATEN ***
--
-- Die Funktion haelt nichts. Jeder Bildverweis, den sie je gesetzt hat,
-- steht in `skylanders.image_override_path` und bleibt dort; jede
-- Journalzeile bleibt ebenso. Nach dieser Ruecknahme gibt es nur den
-- serverseitigen WEG nicht mehr — der Adminweg
-- `admin_set_image_override` ist davon unberuehrt.
--
-- *** WAS DANACH NICHT MEHR GEHT ***
--
-- Die sieben Bildschritte des Katalogabgleichs nach Production. Wer sie noch
-- vor sich hat, nimmt diese Datei nicht.
--
-- *** WANN SIE LAUFEN DARF ***
--
--   A1  Die Umgebung ist Production — positiv und am Schema, wie ueberall:
--       `0133` mit beiden Objekten, und die Sequenz traegt nicht das
--       Staging-Band. KEIN Zeilenstempel.
--   A2  Die Funktion liegt ueberhaupt.
--   A3  Es haengt nichts davon ab: keine andere Funktion nennt sie im Rumpf.
--
-- Ein Abbruch laesst nichts zurueck — eine Transaktion, eine wirksame
-- Anweisung.
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $w$
declare v_n integer;
begin
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'A1a ABBRUCH: die Triggerfunktion aus 0133 fehlt — diese '
      'Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'A1b ABBRUCH: der Trigger aus 0133 fehlt.';
  end if;
  if exists (select 1 from pg_sequences
              where schemaname = 'public' and sequencename = 'sky_id_seq'
                and min_value = 928 and max_value = 4999) then
    raise exception 'A1c ABBRUCH: sky_id_seq traegt das STAGING-Band. Auf '
      'Staging wird diese Funktion gebraucht; dort nicht loeschen.';
  end if;

  if to_regprocedure('public.system_set_image_override(text,text)') is null then
    raise exception 'A2 ABBRUCH: die Funktion liegt nicht. Es gibt nichts '
      'zurueckzunehmen.';
  end if;

  /*
   * A3 — HAENGT ETWAS DARAN? Eine andere Funktion, die sie im Rumpf nennt,
   * zerbraeche. `pg_depend` fuehrt auf einen Funktionsrumpf keine
   * Abhaengigkeit, deshalb wird im Quelltext gesucht — dasselbe Muster, mit
   * dem `R0151` seine Sicht schuetzt.
   */
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'system_set_image_override'
     and position('system_set_image_override' in p.prosrc) > 0;
  if v_n > 0 then
    raise exception 'A3 ABBRUCH: % andere Funktion(en) nennen '
      'system_set_image_override im Rumpf. Erst klaeren.', v_n;
  end if;

  raise notice 'A4: % Zeilen tragen einen Bildverweis. Sie bleiben alle — '
    'diese Datei loescht nur den WEG, nicht die Daten.',
    (select count(*) from public.skylanders where image_override_path is not null);
end
$w$;

drop function public.system_set_image_override(text, text);

do $n$
begin
  if to_regprocedure('public.system_set_image_override(text,text)') is not null then
    raise exception 'Nachbedingung: die Funktion liegt noch.';
  end if;
  raise notice 'ok: system_set_image_override ist fort. % Zeilen tragen '
    'weiterhin einen Bildverweis, und admin_set_image_override ist unberuehrt.',
    (select count(*) from public.skylanders where image_override_path is not null);
end
$n$;

commit;
