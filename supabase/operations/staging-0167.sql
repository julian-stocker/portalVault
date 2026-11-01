-- ===========================================================================
-- STAGING — EIN LAUF FUER 0167
--            (Grabstein, Anlage-Riegel und Entfernungsfunktion fuer die 30
--             OVP-Duplikate — die Entfernung selbst ist ein eigener Vorgang)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0167`, diese Datei,
-- `npm run db:migrate:staging -- 0167 --resume`.
--
-- SIE ENTFERNT NICHTS. Nach diesem Lauf stehen dieselben Katalog-, Lager-,
-- Sammlungs- und Journalzeilen da; `sky_id_seq` ist unberuehrt.
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0167 ok`, dann `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel (Datenbankkommentar, wie beim Pruefzugang). */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  raise notice 'A3: % Katalogzeilen, % Journalzeilen, sky_id_seq bei % '
    '(is_called %). Nach diesem Lauf muss jede dieser Zahlen gleich sein.',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select last_value from public.sky_id_seq),
    (select is_called from public.sky_id_seq);
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- 0167 — die 30 OVP-Katalogduplikate dauerhaft entfernen koennen (CAT-12)
--
-- BETREIBERENTSCHEIDUNG 2026-10-31 (ADR-0166): die 30 eigenstaendigen
-- OVP-Eintraege — 28 Eon's-Elite-Schachteln, `Kaos in OVP`, `Dark Pyramid -
-- OVP` — verschwinden aus `skylanders`, auf Staging UND Production. OVP
-- bleibt als Bestandszustand an der regulaeren Figur erlaubt
-- (`shop_inventory.condition = 'boxed'`, ADR-0037 §5a).
--
-- WAS DIESE MIGRATION ANLEGT — UND WAS SIE NICHT TUT
--
--   `catalog_removed_sky_ids`         der Grabstein: welche SKY-ID entfernt
--                                     wurde, mit Serie und Name
--   `skylanders_refuse_removed`       BEFORE INSERT: eine SKY-ID mit Grabstein
--                                     wird nie wieder angelegt — von keinem
--                                     Weg: Import, Publish, Bootstrap, SQL
--   `system_remove_ovp_figure(text)`  entfernt EINE der 30, sonst keine
--
-- Sie LOESCHT NICHTS. Die Entfernung selbst ist ein eigener Betriebsvorgang
-- mit eigener Freigabe je Umgebung (`staging-ovp-removal.sql`,
-- `prod-ovp-removal.sql` unter `supabase/operations/`).
--
-- *** DIE ALLGEMEINEN LOESCHSPERREN BLEIBEN, WIE SIE SIND ***
--
-- `admin_delete_figure` (0162) und `admin_discard_draft` (0155) werden nicht
-- angefasst. Diese Funktion ist ENGER als beide: sie kennt genau 30 SKY-IDs,
-- als Konstante im Rumpf, jede mit Serie, Rohname und Kartenkunst — eine
-- Zeile, die nicht EXAKT so aussieht, wird abgewiesen. Eine Liste in einer
-- Tabelle liesse sich erweitern; eine Konstante nur durch eine neue Migration.
--
-- *** WAS SIE MITENTFERNT, UND NUR DAS ***
--
--   `inventory_import_rows`   die Protokollzeilen der Legacy-Lagerimporte zu
--                             DIESER SKY-ID — nur wenn keine eine
--                             Lagerbewegung traegt (`movement_id`)
--   `shop_inventory`          eine Position zu DIESER SKY-ID nur, wenn sie
--                             leer ist (Menge 0, nichts reserviert) und
--                             NICHTS auf sie zeigt — keine Bewegung, keine
--                             Bestellzeile, keine Reservierung, kein Verweis
--                             gleich welcher Art (aus `pg_constraint`)
--   `catalog_editorial`       die interne Notiz der Zeile
--
-- JEDER ANDERE VERWEIS BRICHT AB: Sammlungen, Favoriten, Warenkoerbe,
-- Einkauf, Verkauf, Bestellzeilen (auch `order_lines.sky_id` ohne
-- Fremdschluessel), Angebotsstatus, Benachrichtigungen, Zuordnungen,
-- Altbestand, Varianten — und jede kuenftige Tabelle, die auf `skylanders`
-- zeigt, denn die Pfade kommen aus `pg_constraint` und nicht aus einer Liste.
-- Nichts wird umgehaengt.
--
-- Der Marktwert geht mit der Zeile. Bilder werden NICHT angefasst: jede der
-- 28 Bilddateien wird auch von der regulaeren Figur benutzt (gemessen
-- 2026-10-31, beide Umgebungen), und Storage-Objekte gibt es keine.
--
-- Recht: NUR der Eigentuemer (`postgres`, SQL-Editor). Kein `anon`, kein
-- `authenticated`, kein `service_role` — kein Werkzeug kann sie rufen.
--
-- Ruecknahme: `supabase/rollback/R0167_drop_ovp_removal.sql` — entfernt
-- Funktion und Trigger; den Grabstein nur, solange er leer ist.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0167 Vorbedingung: skylanders fehlt (0001).';
  end if;
  if to_regclass('public.inventory_import_rows') is null then
    raise exception '0167 Vorbedingung: inventory_import_rows fehlt (0048).';
  end if;
  if to_regclass('public.order_lines') is null then
    raise exception '0167 Vorbedingung: order_lines fehlt (0010).';
  end if;
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null or v_def not like '%''deleted''%' then
    raise exception '0167 Vorbedingung: das Journal kennt den Feldwert deleted nicht '
      '(0162 muss zuerst angewendet sein).';
  end if;
  if to_regclass('public.catalog_removed_sky_ids') is not null then
    raise exception '0167 Abbruch: catalog_removed_sky_ids steht schon.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Grabstein
-- ---------------------------------------------------------------------------
create table public.catalog_removed_sky_ids (
  sky_id      text primary key,
  series_code text not null,
  name        text not null,
  removed_at  timestamptz not null default now(),
  reason      text not null,
  constraint catalog_removed_sky_ids_format check (sky_id ~ '^SKY-[0-9]{4}$')
);

comment on table public.catalog_removed_sky_ids is
  'SKY-IDs that were removed from the catalogue for good (0167, ADR-0166). A row here means: this identity existed, was deliberately removed, and must never be created again - the BEFORE INSERT trigger on skylanders refuses it on every path. The journal (catalog_admin_changes, field deleted) keeps the history; this table keeps the promise.';

alter table public.catalog_removed_sky_ids enable row level security;
revoke all on table public.catalog_removed_sky_ids from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nie wieder anlegen
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_refuse_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.catalog_removed_sky_ids r where r.sky_id = new.sky_id) then
    raise exception '0167: % wurde dauerhaft aus dem Katalog entfernt und wird nie wieder '
      'angelegt (ADR-0001, ADR-0166).', new.sky_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.skylanders_refuse_removed() is
  'Refuses to insert a catalogue row whose SKY-ID is in catalog_removed_sky_ids (0167). It sits on the table, so no path gets past it - not the legacy import (upsert), not the catalogue publish (system_sync_create_figure), not a bootstrap, not plain SQL.';

revoke all on function public.skylanders_refuse_removed() from public, anon, authenticated;

create trigger skylanders_refuse_removed_trg
  before insert on public.skylanders
  for each row execute function public.skylanders_refuse_removed();


-- ---------------------------------------------------------------------------
-- 4. Eine der 30 entfernen
-- ---------------------------------------------------------------------------
create or replace function public.system_remove_ovp_figure(p_sky_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- DIE 30, wortgleich mit data/catalog/ovp-removal.json (ein Test haelt beide gleich).
  v_liste constant text[][] := array[
    array['SKY-0012', 'SA', 'Elite Boomer', 'elite'],
    array['SKY-0013', 'SA', 'Elite Boomer (2)', 'elite'],
    array['SKY-0018', 'SA', 'Elite Chop Chop', 'elite'],
    array['SKY-0019', 'SA', 'Elite Chop Chop (2)', 'elite'],
    array['SKY-0023', 'SA', 'Elite Dino Rang', 'elite'],
    array['SKY-0024', 'SA', 'Elite Dino Rang (2)', 'elite'],
    array['SKY-0031', 'SA', 'Elite Eruptor', 'elite'],
    array['SKY-0032', 'SA', 'Elite Eruptor (2)', 'elite'],
    array['SKY-0036', 'SA', 'Elite Ghost Roaster', 'elite'],
    array['SKY-0037', 'SA', 'Elite Ghost Roaster (2)', 'elite'],
    array['SKY-0041', 'SA', 'Elite Gill Grunt', 'elite'],
    array['SKY-0042', 'SA', 'Elite Gill Grunt (2)', 'elite'],
    array['SKY-0050', 'SA', 'Elite Slam Bam', 'elite'],
    array['SKY-0051', 'SA', 'Elite Slam Bam (2)', 'elite'],
    array['SKY-0057', 'SA', 'Elite Spyro', 'elite'],
    array['SKY-0058', 'SA', 'Elite Spyro (2)', 'elite'],
    array['SKY-0061', 'SA', 'Elite Stealth Elf', 'elite'],
    array['SKY-0062', 'SA', 'Elite Stealth Elf (2)', 'elite'],
    array['SKY-0067', 'SA', 'Elite Terrafin', 'elite'],
    array['SKY-0068', 'SA', 'Elite Terrafin (2)', 'elite'],
    array['SKY-0072', 'SA', 'Elite Trigger Happy', 'elite'],
    array['SKY-0073', 'SA', 'Elite Trigger Happy (2)', 'elite'],
    array['SKY-0076', 'SA', 'Elite Voodood', 'elite'],
    array['SKY-0077', 'SA', 'Elite Voodood (2)', 'elite'],
    array['SKY-0084', 'SA', 'Elite Whirlwind', 'elite'],
    array['SKY-0085', 'SA', 'Elite Whirlwind (2)', 'elite'],
    array['SKY-0090', 'SA', 'Elite Zook', 'elite'],
    array['SKY-0091', 'SA', 'Elite Zook (2)', 'elite'],
    array['SKY-0564', 'I', 'Kaos in OVP', 'standard'],
    array['SKY-0591', 'I', 'Dark Pyramid - OVP', 'standard']
  ];
  v_i          integer;
  v_serie      text;
  v_name       text;
  v_karte      text;
  v_row        public.skylanders%rowtype;
  r            record;
  v_n          bigint;
  v_fremd      text := '';
  v_importe    bigint := 0;
  v_lager      bigint := 0;
begin
  -- ---- 1. Steht sie auf der Liste?
  for v_i in 1 .. array_length(v_liste, 1) loop
    if v_liste[v_i][1] = p_sky_id then
      v_serie := v_liste[v_i][2]; v_name := v_liste[v_i][3]; v_karte := v_liste[v_i][4];
    end if;
  end loop;
  if v_name is null then
    raise exception '0167: % steht nicht auf der Liste der 30 OVP-Duplikate. Diese '
      'Funktion entfernt nichts anderes.', coalesce(p_sky_id, '<null>')
      using errcode = 'check_violation';
  end if;

  -- ---- 2. Schon entfernt? Dann ist ein zweiter Aufruf ein Nichtstun.
  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    if exists (select 1 from public.catalog_removed_sky_ids where sky_id = p_sky_id) then
      return jsonb_build_object('sky_id', p_sky_id, 'status', 'schon entfernt');
    end if;
    raise exception '0167: % gibt es nicht, und einen Grabstein auch nicht. Ein '
      'unerwarteter Zustand — nichts wird geschrieben.', p_sky_id;
  end if;

  -- ---- 3. Ist es WIRKLICH diese Zeile?
  if v_row.series_code is distinct from v_serie or v_row.name is distinct from v_name
     or v_row.card_type is distinct from v_karte then
    raise exception '0167: % ist nicht die erwartete Zeile (erwartet %/%/%, '
      'vorgefunden %/%/%). Abbruch.', p_sky_id, v_serie, v_name, v_karte,
      v_row.series_code, v_row.name, v_row.card_type
      using errcode = 'check_violation';
  end if;
  if v_row.catalog_status = 'public' or v_row.catalog_visible then
    raise exception '0167: % ist oeffentlich sichtbar. Eine oeffentliche Zeile wird hier '
      'nicht entfernt — erst ausblenden.', p_sky_id
      using errcode = 'check_violation';
  end if;
  if v_row.base_sky_id is not null
     or exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0167: % steht in einer Variantenbeziehung. Abbruch.', p_sky_id
      using errcode = 'check_violation';
  end if;

  -- ---- 4. Die Volkszaehlung der Verweise, aus pg_constraint.
  for r in
    select c.conrelid::regclass::text as tabelle, a.attname::text as spalte
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid
                         and a.attnum = c.conkey[array_position(c.confkey,
                               (select x.attnum from pg_attribute x
                                 where x.attrelid = c.confrelid and x.attname = 'sky_id'))]
     where c.contype = 'f' and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.skylanders'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tabelle, r.spalte)
      into v_n using p_sky_id;
    if v_n = 0 then continue; end if;
    if r.tabelle in ('inventory_import_rows', 'public.inventory_import_rows') then
      v_importe := v_n;
    elsif r.tabelle in ('shop_inventory', 'public.shop_inventory') then
      v_lager := v_n;
    elsif r.tabelle in ('catalog_editorial', 'public.catalog_editorial') then
      null;   -- die interne Notiz geht mit der Zeile
    else
      v_fremd := v_fremd || case when v_fremd = '' then '' else ', ' end
                 || r.tabelle || '.' || r.spalte || '=' || v_n;
    end if;
  end loop;

  -- Der stille Verweis: eine Bestellzeile traegt die SKY-ID als Text.
  select count(*) into v_n from public.order_lines ol where ol.sky_id = p_sky_id;
  if v_n > 0 then
    v_fremd := v_fremd || case when v_fremd = '' then '' else ', ' end
               || 'order_lines.sky_id=' || v_n;
  end if;

  if v_fremd <> '' then
    raise exception '0167: auf % zeigen geschuetzte Daten: %. Nichts wird entfernt, '
      'nichts umgehaengt.', p_sky_id, v_fremd
      using errcode = 'foreign_key_violation';
  end if;

  -- Importprotokolle: keines darf eine Lagerbewegung tragen.
  if exists (select 1 from public.inventory_import_rows i
              where i.sky_id = p_sky_id and i.movement_id is not null) then
    raise exception '0167: ein Importprotokoll zu % traegt eine Lagerbewegung. Abbruch.',
      p_sky_id using errcode = 'foreign_key_violation';
  end if;

  -- Lagerpositionen: nur leere, auf die NICHTS zeigt.
  if v_lager > 0 then
    if exists (select 1 from public.shop_inventory i
                where i.sky_id = p_sky_id and (i.quantity <> 0 or i.reserved <> 0)) then
      raise exception '0167: % hat eine Lagerposition mit Bestand oder Reservierung. Abbruch.',
        p_sky_id using errcode = 'foreign_key_violation';
    end if;
    for r in
      select c.conrelid::regclass::text as tabelle, a.attname::text as spalte
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.shop_inventory'::regclass
    loop
      execute format('select count(*) from %s t where t.%I in '
                     '(select i.id from public.shop_inventory i where i.sky_id = $1)',
                     r.tabelle, r.spalte)
        into v_n using p_sky_id;
      if v_n > 0 then
        raise exception '0167: auf die Lagerposition von % zeigt %.% (% Zeile(n)). Abbruch.',
          p_sky_id, r.tabelle, r.spalte, v_n using errcode = 'foreign_key_violation';
      end if;
    end loop;
  end if;

  -- ---- 5. Das Journal ZUERST — es ueberlebt die Zeile (wie 0162).
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'deleted',
          v_row.name || ' | ' || v_row.series_code || ' | ' || v_row.catalog_status
            || ' | ' || v_row.source || coalesce(' | ' || v_row.market_price::text, '')
            || ' | OVP-Duplikat (0167)',
          null, (select auth.uid()));

  -- ---- 6. Die freigegebenen Mitlaeufer, dann die Zeile, dann der Grabstein.
  delete from public.inventory_import_rows where sky_id = p_sky_id;
  delete from public.shop_inventory where sky_id = p_sky_id;
  delete from public.catalog_editorial where sky_id = p_sky_id;
  delete from public.skylanders where sky_id = p_sky_id;
  insert into public.catalog_removed_sky_ids (sky_id, series_code, name, reason)
  values (p_sky_id, v_row.series_code, v_row.name, 'OVP-Duplikat (ADR-0166)');

  return jsonb_build_object('sky_id', p_sky_id, 'status', 'entfernt',
                            'importprotokolle', v_importe, 'lagerpositionen', v_lager);
end;
$$;

comment on function public.system_remove_ovp_figure(text) is
  'Removes ONE of the 30 standalone OVP catalogue duplicates named as a constant in its body (0167, ADR-0166) - nothing else. Verifies series, raw name and card art, refuses a public row and any variant relation, and counts every reference from pg_constraint plus order_lines.sky_id: only legacy import log rows (without a stock movement), an EMPTY inventory position nothing points at, and the internal note go with it; anything else aborts, nothing is re-pointed. Journals deleted before deleting, writes the tombstone after. A second call on a removed id is a no-op. Owner only - no client role and no service role may call it.';

revoke all on function public.system_remove_ovp_figure(text) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_oid oid := to_regprocedure('public.system_remove_ovp_figure(text)');
begin
  if v_oid is null then
    raise exception '0167 Nachbedingung: system_remove_ovp_figure steht nicht.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('public', v_oid, 'execute')
     or (exists (select 1 from pg_roles where rolname = 'service_role')
         and has_function_privilege('service_role', v_oid, 'execute')) then
    raise exception '0167 Nachbedingung: eine Client- oder Dienstrolle darf die '
      'Entfernungsfunktion ausfuehren.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_refuse_removed_trg') then
    raise exception '0167 Nachbedingung: der Anlage-Riegel fehlt.';
  end if;
  if (select count(*) from public.catalog_removed_sky_ids) <> 0 then
    raise exception '0167 Nachbedingung: der Grabstein ist nicht leer.';
  end if;
  raise notice '0167 ok: Grabstein leer, Anlage-Riegel steht, system_remove_ovp_figure '
    'nur fuer den Eigentuemer. Es wurde NICHTS entfernt.';
end
$nach$;

commit;
