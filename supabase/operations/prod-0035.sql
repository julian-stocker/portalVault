-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0035
--              (`system_set_image_override`, der serverseitige Weg, eine
--               Figur auf ein hochgeladenes Bild zu zeigen)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen.
--
-- *** WARUM ES SIE GIBT ***
--
-- `system_set_image_override(text, text)` fehlt auf Production — am
-- 2026-10-30 mit `prod_0159_0165_state.sql` gemessen: **0 Fassungen**. Der
-- Katalogabgleich plant 7 Bildschritte ueber diese Funktion; ohne sie haben
-- sie dort keinen Weg.
--
-- *** WAS SICH NICHT BEWEISEN LAESST, UND DAS GEHOERT HIERHER ***
--
-- Ob `0035` auf Production je gelaufen und die Funktion spaeter entfernt
-- wurde, oder ob sie nie gelaufen ist, ist AN DER DATENBANK NICHT ZU
-- UNTERSCHEIDEN. Der Grund ist einfach: `0035` legt GENAU EIN Objekt an —
-- diese Funktion. Es gibt kein zweites, an dem man die Migration erkennen
-- koennte. Keine spaetere Migration loescht, ersetzt oder benennt sie um
-- (durchsucht am 2026-10-30).
--
-- Was die Forensik hergibt, und was nicht:
--
--   * Production fuehrt 59 Journalzeilen zu `image_override_path`, davon
--     **6 mit `changed_by = NULL`**. NULL heisst „ueber die Service-Rolle
--     ODER nach dem Loeschen des Kontos" (`0004`). Ein serverseitiger Weg
--     hat dort also geschrieben — WELCHER, sagt die Zeile nicht. Ein
--     direktes `update` der Service-Rolle sieht genauso aus.
--   * Das einzige Werkzeug, das diese Funktion aufruft
--     (`tools/sync-image-overrides.mts`), ist mit
--     `SKYISLES_REQUIRE_STAGING=1` auf Staging festgenagelt.
--   * `APPLIED.md` fuehrt `0035` fuer Production nicht.
--
-- DAS FEHLEN DER FUNKTION IST SICHER. Das Fehlen der Migrationshistorie ist
-- eine offene Frage, und sie laesst sich von hier nicht schliessen. Diese
-- Datei stellt deshalb den ZUSTAND her und behauptet nichts ueber die
-- Vergangenheit.
--
-- *** SIE IST IDEMPOTENT ***
--
-- `create or replace function`, `comment on`, `revoke all`, `grant execute` —
-- jede dieser Anweisungen ist fuer sich wiederholbar. Ein zweiter Lauf
-- stellt denselben Zustand her. A5 bricht trotzdem ab, wenn die Funktion
-- schon liegt: nicht weil es schaedlich waere, sondern weil ein
-- unbeabsichtigter Zweitlauf eine Abweichung verdecken koennte. Wer bewusst
-- erneut fahren will, nimmt erst die Ruecknahme.
--
-- *** ENG BEGRENZT ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, kein Recht an
-- etwas Bestehendem. Sie ruft die Funktion auch nicht auf. B1-B5 messen,
-- dass Bestand, Nutzerdaten und Katalogabdruck unveraendert sind.
--
-- Ruecknahme: `supabase/rollback/R0035_drop_system_set_image_override.sql`
-- (loescht nur die Funktion; sie haelt keine Daten).
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- A1-A5  WAECHTER — der Umgebungsnachweis ist POSITIV und am Schema, wie in
--        `prod-0165.sql` und `production-sky-id-band.sql`. KEIN Zeilenstempel:
--        `SKY-0821`/`SKY-0822` taugen nicht mehr, seit der Abgleich
--        `SKY-0822` auf Production anlegt.
-- ---------------------------------------------------------------------------
do $lauf_a$
declare v_n integer;
begin
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A1a: die Triggerfunktion aus 0133 fehlt. 0133 liegt '
      'NUR auf Production — diese Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'ABBRUCH A1b: der Trigger aus 0133 fehlt, obwohl die Funktion '
      'liegt. Halb angewendeter Stand — erst klaeren.';
  end if;
  if exists (select 1 from pg_sequences
              where schemaname = 'public' and sequencename = 'sky_id_seq'
                and min_value = 928 and max_value = 4999) then
    raise exception 'ABBRUCH A2: sky_id_seq traegt das STAGING-Band. Diese Datei '
      'ist fuer PRODUCTION; auf Staging liegt die Funktion ohnehin.';
  end if;
  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;

  -- A4 — die Rolle, an der die Autorisierung dieser Funktion haengt.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'ABBRUCH A4: die Rolle service_role gibt es nicht. Das '
      'EXECUTE-Recht IST hier die Berechtigungsgrenze; ohne die Rolle hat es '
      'keinen Traeger.';
  end if;

  -- A5 — sie liegt noch nicht, in keiner Fassung.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_set_image_override';
  if v_n > 0 then
    raise exception 'ABBRUCH A5: system_set_image_override liegt schon (% '
      'Fassung(en)). Diese Datei laeuft einmal; wer bewusst erneut fahren '
      'will, nimmt erst die Ruecknahme.', v_n;
  end if;

  /*
   * A5b — DIE SPALTE, IN DIE SIE SCHREIBT, UND IHR RIEGEL. Ohne
   * `image_override_path` scheitert die Funktion erst beim Aufruf.
   */
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'image_override_path' and not a.attisdropped) then
    raise exception 'ABBRUCH A5b: skylanders.image_override_path fehlt.';
  end if;
  /*
   * A5c — DIE JOURNALZEILE. Der Trigger `skylanders_log_editorial` (0004)
   * schreibt sie; die CHECK muss den Feldwert zulassen.
   */
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = to_regclass('public.catalog_admin_changes')
         and c.conname = 'catalog_admin_changes_field_known')
     not like '%''image_override_path''%' then
    raise exception 'ABBRUCH A5c: die Journal-Constraint laesst den Feldwert '
      'image_override_path nicht zu. Jeder Aufruf scheiterte daran.';
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- A6  DER BESTAND, von der Huelle selbst gemessen und abgelegt
-- ---------------------------------------------------------------------------
select set_config('skyisles.b0035', (
  select (select count(*) from public.skylanders)::text || '|'
      || (select count(*) from public.catalog_admin_changes)::text || '|'
      || (select count(*) from public.shop_inventory)::text || '|'
      || (select count(*) from public.collection_items)::text || '|'
      || (select count(*) from public.skylanders where image_override_path is not null)::text || '|'
      || (select coalesce(md5(string_agg(s.sky_id || '|' || coalesce(s.image_override_path, '~'),
                                         chr(10) order by s.sky_id collate "C")), '(leer)')
            from public.skylanders s)
), true);

do $a6$
begin
  raise notice 'A6: Bestand abgelegt — %', current_setting('skyisles.b0035', true);
end
$a6$;


-- >>> EINGEBETTET: supabase/migrations/0035_system_set_image_override.sql
-- ===========================================================================
-- 0035 - the system path for image overrides
--
-- WHY
--
-- `admin_set_image_override()` (0007) asks `public.is_shop_admin()`, which
-- reads `auth.uid()`. Controlled server tooling runs as the service role and
-- has no `auth.uid()` at all, so that function refuses it — correctly, and
-- unhelpfully: restoring a backed-up picture into an environment is exactly
-- the kind of work a script does and a browser cannot.
--
-- 0003 already met this and answered it. `record_inventory_movement()` is for
-- administrators and checks `is_shop_admin()`; `system_record_inventory_movement()`
-- is for tooling and is executable only by `service_role`, with the comment
-- that says why: "the authorization IS the EXECUTE privilege". This file is
-- the same shape for the same reason.
--
-- WHAT IT DOES NOT CHANGE
--
-- Not the admin path: `admin_set_image_override()` is untouched, still the
-- only way a browser session can move a picture, still behind
-- `is_shop_admin()`. Not `image_file`, which belongs to the catalogue import
-- (ADR-0046). Not the journal: the UPDATE below fires
-- `skylanders_log_editorial_change` exactly as the admin path does, and
-- records `changed_by = NULL`, which `catalog_admin_changes` already documents
-- as "the change came through the service role (an import, a script)".
--
-- WHY NOT A DIRECT UPDATE FROM THE TOOL
--
-- The service role bypasses RLS, so a tool could write the column itself. It
-- would also bypass the one check that makes an override safe: that the path
-- belongs to the figure it is being attached to. That check is repeated here
-- rather than trusted to the caller, because a tool with a bug is exactly the
-- caller it is meant to protect against.
-- ===========================================================================

create or replace function public.system_set_image_override(
  p_sky_id text,
  p_path   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_path, '')), '');
begin
  -- No is_shop_admin() check: the authorization IS the EXECUTE privilege,
  -- which only service_role holds. A request running as anon or authenticated
  -- is rejected by Postgres before this body is reached.

  -- The same guarantee `admin_set_image_override()` gives. The CHECK on the
  -- column accepts any well-formed path; only this rejects a well-formed path
  -- that belongs to a different figure.
  if v_clean is not null and split_part(v_clean, '/', 1) <> p_sky_id then
    raise exception 'image path % does not belong to %', v_clean, p_sky_id
      using errcode = 'check_violation';
  end if;

  update public.skylanders set image_override_path = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.system_set_image_override(text, text) is
  'Points a figure at an uploaded image from controlled server tooling - the backup restore and the staging sync. Executable only by service_role; the EXECUTE privilege is the authorization, exactly as system_record_inventory_movement() (0003). Validates that the path belongs to the figure, never touches image_file (ADR-0046), and journals through the existing editorial trigger with changed_by NULL.';

revoke all on function public.system_set_image_override(text, text)
  from public, anon, authenticated;
grant  execute on function public.system_set_image_override(text, text)
  to service_role;
-- <<< ENDE: supabase/migrations/0035_system_set_image_override.sql


-- ---------------------------------------------------------------------------
-- B  NACHBEDINGUNGEN — noch in derselben Transaktion
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_soll text := current_setting('skyisles.b0035', true);
  v_t    text[];
  v_ist  text;
  v_oid  oid := to_regprocedure('public.system_set_image_override(text,text)');
begin
  if v_soll is null then
    raise exception 'ABBRUCH B0: die Ablage aus A6 fehlt.';
  end if;
  v_t := string_to_array(v_soll, '|');

  -- B1-B5 — nichts hat sich bewegt. Diese Datei legt eine Funktion an.
  v_ist := (select count(*) from public.skylanders)::text;
  if v_ist <> v_t[1] then
    raise exception 'ABBRUCH B1: Katalogzeilen % statt %.', v_ist, v_t[1];
  end if;
  v_ist := (select count(*) from public.catalog_admin_changes)::text;
  if v_ist <> v_t[2] then
    raise exception 'ABBRUCH B2: Journalzeilen % statt %. Diese Datei ruft die '
      'Funktion nicht auf.', v_ist, v_t[2];
  end if;
  if (select count(*) from public.shop_inventory)::text <> v_t[3]
     or (select count(*) from public.collection_items)::text <> v_t[4] then
    raise exception 'ABBRUCH B3: Lager- oder Sammlungszeilen haben sich bewegt.';
  end if;
  v_ist := (select count(*) from public.skylanders where image_override_path is not null)::text;
  if v_ist <> v_t[5] then
    raise exception 'ABBRUCH B4: % Zeilen mit Bildverweis statt %. Diese Datei '
      'setzt keinen.', v_ist, v_t[5];
  end if;
  v_ist := (select coalesce(md5(string_agg(s.sky_id || '|' || coalesce(s.image_override_path, '~'),
                                           chr(10) order by s.sky_id collate "C")), '(leer)')
              from public.skylanders s);
  if v_ist <> v_t[6] then
    raise exception 'ABBRUCH B5: der Abdruck ueber die Bildverweise hat sich '
      'bewegt (% statt %).', v_ist, v_t[6];
  end if;

  -- B6-B9 — und die Funktion ist die zugesagte.
  if v_oid is null then
    raise exception 'ABBRUCH B6: die Funktion liegt nicht.';
  end if;
  if not (select prosecdef from pg_proc where oid = v_oid) then
    raise exception 'ABBRUCH B7: sie ist nicht SECURITY DEFINER.';
  end if;
  if coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                where p.oid = v_oid and c like 'search\_path=%'), '(leer)') <> '(leer)' then
    raise exception 'ABBRUCH B8: der search_path ist nicht leer.';
  end if;
  if not has_function_privilege('service_role',
        'public.system_set_image_override(text,text)', 'execute')
     or has_function_privilege('public',
        'public.system_set_image_override(text,text)', 'execute')
     or has_function_privilege('anon',
        'public.system_set_image_override(text,text)', 'execute')
     or has_function_privilege('authenticated',
        'public.system_set_image_override(text,text)', 'execute') then
    raise exception 'ABBRUCH B9: die Rechte stimmen nicht. Erwartet: EXECUTE nur '
      'fuer service_role, nicht fuer PUBLIC, anon oder authenticated.';
  end if;

  raise notice 'ok: system_set_image_override liegt, SECURITY DEFINER, leerer '
    'search_path, EXECUTE nur fuer service_role. Bestand unveraendert — % '
    'Katalogzeilen, % Journalzeilen, % Zeilen mit Bildverweis.',
    v_t[1], v_t[2], v_t[5];
end
$lauf_b$;

commit;
