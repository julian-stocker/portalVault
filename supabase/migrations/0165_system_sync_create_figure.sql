-- ===========================================================================
-- 0165 — DER SYSTEMWEG, UM EINE FIGUR MIT VORGEGEBENER SKY-ID ANZULEGEN
--
-- WOFUER
--
-- Der Katalogabgleich Staging <-> Production muss eine Figur im Zielprojekt
-- unter DERSELBEN SKY-ID anlegen, unter der sie in der Quelle steht. Eine
-- Figur, die auf Staging `SKY-0893` heisst, heisst auf Production auch
-- `SKY-0893` — sonst waere es keine Synchronisierung, sondern eine zweite
-- Identitaet fuer dieselbe Sache (ADR-0001, CLAUDE.md Regel 2).
--
-- DAS KANN HEUTE KEINE FUNKTION. Jede der sechs Stellen im Schema, die eine
-- Katalogzeile anlegt, zieht ihre Nummer aus `sky_id_seq`:
-- `admin_create_figure` (0033/0041/0152), `create_figure_from_template`
-- (0034), `seller_create_catalog_item` (0137), `0138`. Keine nimmt eine
-- Kennung entgegen.
--
-- UND EIN INSERT WIRD NICHT JOURNALISIERT. `skylanders_log_editorial` (0004)
-- ist `after UPDATE`. Ein Werkzeug muesste also zweimal schreiben — einmal
-- die Zeile, einmal die Journalzeile — und PostgREST haelt keine Transaktion
-- ueber zwei Anfragen. Zwischen den beiden liegt ein Fenster, in dem eine
-- angelegte Figur ohne Journaleintrag zurueckbleibt. Genau das schliesst
-- diese Funktion: BEIDE Anweisungen stehen in EINEM Rumpf, also in EINER
-- Transaktion. Entweder beide, oder keine.
--
-- DIE BAUFORM IST NICHT NEU. `system_set_image_override` (0035) ist dieselbe
-- Antwort auf dieselbe Frage, und `0035` zitiert dafuer wiederum
-- `system_record_inventory_movement` (0003): „the authorization IS the
-- EXECUTE privilege". Eine dritte Funktion derselben Art ist keine neue
-- Bauart.
--
-- ---------------------------------------------------------------------------
-- WAS SIE NICHT TUT, UND WARUM JEWEILS
-- ---------------------------------------------------------------------------
--
--   * KEIN `market_price`, kein `price_updated_at`. Der Marktwert gehoert
--     Production (ADR-0010, Betreiberentscheidung). Dass der Abgleich ihn
--     nicht schreibt, ist hier STRUKTURELL und nicht eine Zusage des
--     aufrufenden Werkzeugs: die Funktion kennt den Parameter nicht.
--   * KEIN `character_id`, kein `base_sky_id`, keine `types`, kein
--     `visible_type`. Fuer die vier gibt es seit `0158`, `0159` und `0163`
--     bereits atomare Funktionen, die ihre eigene Journalzeile schreiben.
--     Sie hier zu wiederholen hiesse, zwei Schreibwege fuer dasselbe Feld zu
--     haben — und einer davon ohne die fachlichen Riegel der anderen.
--   * KEIN `display_name_override`, kein `image_override_path`. Beide sind
--     Klasse A: ein spaeteres `update` journalisiert sie ueber den
--     vorhandenen Trigger, und `image_override_path` hat mit `0035` ohnehin
--     seinen eigenen Systemweg, der die Pfadzugehoerigkeit prueft.
--   * KEIN `nextval`, kein `setval`. Die Funktion fasst `sky_id_seq` NICHT
--     an. Sie vergibt keine Nummer, sie uebernimmt eine.
--   * KEINE Aenderung an einer bestehenden Funktion, keine neue Tabelle,
--     keine neue Spalte, kein veraendertes Recht an etwas Bestehendem.
--
-- ---------------------------------------------------------------------------
-- WARUM NICHT EINFACH EIN DIREKTES INSERT AUS DEM WERKZEUG
-- ---------------------------------------------------------------------------
--
-- Dieselbe Antwort wie in `0035`: der Service-Role-Key umgeht RLS, ein
-- Werkzeug KOENNTE die Zeile selbst schreiben. Es umginge dabei aber genau
-- die Pruefungen, die eine Anlage sicher machen — und vor allem die
-- Journalzeile, die der Anlass dieser Datei ist. Ein Werkzeug mit einem
-- Fehler ist der Aufrufer, gegen den sie gebaut ist.
--
-- ---------------------------------------------------------------------------
-- WAS DIE TRIGGER WEITER TUN, UND DAS IST ABSICHT
-- ---------------------------------------------------------------------------
--
--   `skylanders_sync_catalog_status` (0152, BEFORE INSERT) leitet
--       `catalog_visible` aus dem uebergebenen `catalog_status` ab. Genau die
--       Zusage, die `0152` gibt: „wer nur eine der beiden Spalten schreibt,
--       bekommt die andere abgeleitet". Deshalb nennt der INSERT unten NUR
--       den Status.
--   `skylanders_set_item_type` (0135, BEFORE INSERT) ersetzt den Vorgabewert
--       `figure` durch den aus der Kategorie abgeleiteten Typ. Ein
--       ausdruecklicher `portal`/`bundle`/`other` ueberlebt.
--   `skylanders_sky_id_immutable` (0001) bleibt, wie er ist: die hier
--       vergebene Kennung ist ab dem COMMIT unveraenderlich.
--
-- Ruecknahme: `supabase/rollback/R0165_drop_system_sync_create_figure.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0165 Vorbedingung: skylanders fehlt (0001).';
  end if;

  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0165 Vorbedingung: catalog_admin_changes fehlt (0004).';
  end if;

  -- `catalog_status` wird vom INSERT benannt.
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception '0165 setzt 0152 voraus: skylanders.catalog_status fehlt.';
  end if;

  -- Die Journalzeile traegt `field = 'created'`. Kennt die Audit-Constraint
  -- den Wert nicht, waere die Funktion von der ersten Zeile an unbrauchbar —
  -- und der Fehler fiele erst beim Aufruf auf.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.catalog_admin_changes')
       and c.conname  = 'catalog_admin_changes_field_known'
       and pg_get_constraintdef(c.oid) like '%''created''%'
  ) then
    raise exception '0165 Vorbedingung: catalog_admin_changes kennt den Feldwert '
      '''created'' nicht (0033).';
  end if;

  if to_regprocedure('public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)')
       is not null then
    raise exception '0165 Abbruch: system_sync_create_figure steht schon.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktion
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_create_figure(
  p_sky_id         text,
  p_name           text,
  p_slug           text,
  p_series_code    text,
  p_category_id    bigint,
  p_card_type      text,
  p_item_type      text,
  p_catalog_status text,
  p_source         text,
  p_image_file     text     default null,
  p_usk_rating     smallint default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_nr   integer;
begin
  -- Keine `is_platform_admin()`-Pruefung: die Berechtigung IST das
  -- EXECUTE-Recht, und das hat nur `service_role`. Ein Aufruf als `anon`
  -- oder `authenticated` wird von PostgreSQL abgewiesen, bevor dieser
  -- Rumpf erreicht ist. Dieselbe Begruendung wie in `0003` und `0035`.

  if p_sky_id !~ '^SKY-[0-9]{4}$' then
    raise exception '0165: % ist keine SKY-ID im Format SKY-0000', coalesce(p_sky_id, '<null>')
      using errcode = 'check_violation';
  end if;

  /*
   * DER RESERVIERTE BEREICH BLEIBT UNERREICHBAR. 9000-9999 ist System- und
   * Testbereich (ADR-0070); dort stehen die Fixtures, die Werkzeuge von Hand
   * setzen. Ein Abgleich legt dort NIE etwas an. `admin_create_figure` zieht
   * dieselbe Grenze bei 8999, und sie wird hier wiederholt statt dem
   * Aufrufer geglaubt.
   */
  v_nr := (substring(p_sky_id from 5))::integer;
  if v_nr > 8999 then
    raise exception '0165: % liegt im reservierten System- und Testbereich '
      'SKY-9000..SKY-9999 (ADR-0070); ein Abgleich legt dort nichts an', p_sky_id
      using errcode = 'check_violation';
  end if;

  if v_name is null then
    raise exception '0165: eine Figur braucht einen Namen' using errcode = 'check_violation';
  end if;
  if v_slug is null then
    raise exception '0165: eine Figur braucht einen Slug' using errcode = 'check_violation';
  end if;

  /*
   * `source` IST HERKUNFT UND NIE EIN RECHT (ADR-0070). Der Spalten-CHECK
   * aus `0033` faengt einen falschen Wert ohnehin — hier wird er mit Namen
   * abgewiesen, damit die Meldung sagt, was gemeint war.
   */
  if p_source is null or p_source not in ('import', 'admin') then
    raise exception '0165: source muss import oder admin sein, nicht %',
      coalesce(p_source, '<null>') using errcode = 'check_violation';
  end if;

  if p_catalog_status is null or p_catalog_status not in ('public', 'hidden', 'draft') then
    raise exception '0165: catalog_status muss public, hidden oder draft sein, nicht %',
      coalesce(p_catalog_status, '<null>') using errcode = 'check_violation';
  end if;

  /*
   * EINE ANLAGE IST KEINE UEBERSCHREIBUNG. Ohne diese Zeile fiele der Fall
   * auf den Primaerschluessel und erzeugte `23505` — richtig, aber ohne zu
   * sagen, dass hier jemand eine bestehende Figur anlegen wollte.
   */
  if exists (select 1 from public.skylanders s where s.sky_id = p_sky_id) then
    raise exception '0165: % steht bereits im Katalog; eine Anlage ueberschreibt nichts',
      p_sky_id using errcode = 'unique_violation';
  end if;

  /*
   * NUR DEN STATUS NENNEN. `skylanders_sync_catalog_status` (0152, BEFORE
   * INSERT) leitet `catalog_visible` daraus ab — genau die Zusage, die jene
   * Migration gibt. Beides zu schreiben waere eine zweite Quelle fuer
   * dieselbe Aussage.
   *
   * `types`, `visible_type`, `visible_type_decided`, `is_active` tragen ihre
   * Spaltenvorgaben (`'{}'`, NULL, false, true). `character_id` und
   * `base_sky_id` bleiben NULL und werden danach einzeln gesetzt.
   */
  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, item_type, catalog_status, source, image_file, usk_rating)
  values
    (p_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(nullif(btrim(coalesce(p_item_type, '')), ''), 'figure'),
     p_catalog_status, p_source,
     nullif(btrim(coalesce(p_image_file, '')), ''), p_usk_rating);

  /*
   * DIE JOURNALZEILE, IN DERSELBEN TRANSAKTION. Wort fuer Wort die, die
   * `admin_create_figure` schreibt — nur mit `changed_by = NULL`, weil hier
   * kein Mensch handelt. `0004` sieht NULL dafuer ausdruecklich vor:
   * „NULL when the change came through the service role (an import, a
   * script)".
   *
   * Scheitert sie, rollt der INSERT mit zurueck. Das ist der ganze Zweck
   * dieser Datei.
   */
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'created', null, v_name, null);

  return p_sky_id;
end;
$$;

comment on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint) is
  'Creates ONE catalogue figure under a SKY-ID the caller supplies, for the Staging<->Production catalogue sync (0165). Executable only by service_role; the EXECUTE privilege is the authorization, exactly as system_set_image_override (0035) and system_record_inventory_movement (0003). Row and created journal entry are written in ONE transaction, which is why this exists: an INSERT fires no journal trigger (0004 is AFTER UPDATE) and PostgREST holds no transaction across two requests. Refuses a malformed SKY-ID, the reserved range SKY-9000..9999 (ADR-0070), an existing SKY-ID, an unknown source or catalog_status, and a blank name or slug. It never touches market_price, character_id, base_sky_id, types or visible_type - those have their own atomic functions - and never reads or advances sky_id_seq.';

revoke all on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)
  from public, anon, authenticated;
grant  execute on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_oid oid := to_regprocedure(
    'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)');
begin
  if v_oid is null then
    raise exception '0165 Nachbedingung: die Funktion ist nicht entstanden.';
  end if;

  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: service_role darf die Funktion nicht ausfuehren.';
  end if;

  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: anon oder authenticated duerfen die Funktion '
      'ausfuehren — das Recht IST hier die Berechtigung.';
  end if;

  /*
   * UND PUBLIC ERST RECHT NICHT — und das wird ueber `has_function_privilege`
   * geprueft, nicht ueber `proacl`.
   *
   * DER UNTERSCHIED IST NICHT KOSMETISCH. Eine frisch angelegte Funktion hat
   * `proacl = NULL`, und NULL heisst nicht „niemand", sondern „der Vorgabewert"
   * — und der Vorgabewert fuer eine Funktion ist EXECUTE FUER PUBLIC. Eine
   * Pruefung ueber `aclexplode(proacl)` findet dann KEINE Zeile und meldet
   * faelschlich „PUBLIC darf nicht". Nachgemessen am 2026-10-30:
   * `aclexplode` sagte `false`, `has_function_privilege('public', …)` sagte
   * `true` — und letzteres war richtig.
   */
  if has_function_privilege('public', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: PUBLIC darf die Funktion ausfuehren. '
      'Das `revoke all … from public` hat nicht gegriffen.';
  end if;

  /*
   * SECURITY DEFINER MIT LEEREM SUCHPFAD. Ein Definer ohne festgelegten
   * `search_path` ist die klassische Rechteausweitung: wer das Schema vor
   * `public` schieben kann, laesst die Funktion seine Tabelle schreiben.
   * `set search_path = ''` erzwingt, dass jeder Name im Rumpf voll
   * qualifiziert ist — und der Rumpf ist es.
   */
  if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef) then
    raise exception '0165 Nachbedingung: die Funktion ist nicht SECURITY DEFINER.';
  end if;

  /*
   * DER WERT WIRD AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL schreibt den
   * leeren Suchpfad als `search_path=""` — mit Anfuehrungszeichen —, und
   * die Darstellung ist nicht zugesagt. Ein Vergleich gegen ein Literal
   * haette `staging-0137.sql` am 2026-10-20 abbrechen lassen, obwohl die
   * Funktion in Ordnung war; seither nagelt
   * `src/lib/admin/migration-integrity.test.ts` die richtige Form fest.
   * Also: erst pruefen, DASS eine Festlegung da ist, dann den Wert
   * auspacken und auf leer pruefen.
   */
  if not exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.oid = v_oid and c like 'search\_path=%') then
    raise exception '0165 Nachbedingung: die Funktion hat gar keine '
      'search_path-Festlegung — eine SECURITY-DEFINER-Funktion ohne festen '
      'Suchpfad ist eine Rechteausweitung.';
  end if;

  if coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                where p.oid = v_oid and c like 'search\_path=%'), '(leer)')
     <> '(leer)' then
    raise exception '0165 Nachbedingung: der search_path ist festgelegt, aber '
      'nicht LEER.';
  end if;

  -- Sie darf die Sequenz nicht anfassen. Am Quelltext gemessen, nicht am
  -- Kommentar: dasselbe Muster, mit dem `0162` seine Storage-Zusage prueft.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid
                and (p.prosrc like '%nextval%' or p.prosrc like '%setval%'
                     or p.prosrc like '%sky_id_seq%')) then
    raise exception '0165 Nachbedingung: der Rumpf nennt die Sequenz — '
      'diese Funktion vergibt keine Nummer, sie uebernimmt eine.';
  end if;

  -- Und sie darf den Marktwert nicht kennen.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid and p.prosrc like '%market_price%') then
    raise exception '0165 Nachbedingung: der Rumpf nennt market_price.';
  end if;

  raise notice '0165 ok: system_sync_create_figure steht; nur service_role darf sie '
    '(nicht anon, nicht authenticated, nicht PUBLIC); sie ist SECURITY DEFINER mit '
    'leerem search_path; und sie nennt weder sky_id_seq noch market_price.';
end
$nach$;
