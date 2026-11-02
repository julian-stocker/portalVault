-- ===========================================================================
-- STAGING — EIN LAUF FUER 0168
--            (die Variante traegt die Familie ihrer Basisfigur; leere
--             Familien lassen sich auf Staging wegraeumen — ADR-0171)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0168`, diese Datei,
-- `npm run db:migrate:staging -- 0168 --resume`.
--
-- SIE AENDERT KEINE DATEN. Nach diesem Lauf stehen dieselben Katalog-, Lager-,
-- Sammlungs- und Journalzeilen da; keine Familie ist gesetzt oder geloescht.
-- Bestehende Abweichungen bleiben, bis jemand die Basisfigur anfasst — der
-- Korrekturplan ist `supabase/checks/0168_family_audit.sql`.
--
-- NUR STAGING. Auf Production erst, wenn der angepasste Publish-Executor
-- (CAT-19) dort gelaufen ist und eine eigene Freigabe vorliegt (ADR-0171).
--
-- ERWARTET: die NOTICE-Zeilen A3 und `0168 ok`, dann `commit`.
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

  raise notice 'A3: % Katalogzeilen, % Journalzeilen, % Familien. Nach diesem Lauf '
    'muss jede dieser Zahlen gleich sein.',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select count(*) from public.characters);
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- 0168 — eine Variante traegt immer die Familie ihrer Basisfigur (CAT-19,
--        ADR-0171)
--
-- DIE REGEL. Eine Variante (`base_sky_id` gesetzt) hat genau dieselbe
-- `character_id` wie ihre Basisfigur — auch NULL, wenn die Basisfigur keine
-- hat. Gepflegt wird die Familie NUR an der Basisfigur; jede Variante folgt
-- ihr, sofort und in derselben Transaktion, egal wann die Familie gesetzt
-- wird.
--
-- WARUM EIN TRIGGER UND NICHT DIE RPCs. `character_id` hat sieben
-- Schreibwege: `admin_set_character` (0158), `admin_set_variant_base`
-- (0159), `admin_publish_variant_auto` (0161), `admin_create_variant_figure`
-- (0166, ueber 0152/0159), die Zusammenfuehrung (0156) und der kuratierte
-- Charakterimport (`tools/import-characters.mts`, direktes UPDATE). Eine
-- Regel in jeder RPC waere sieben Regeln. Ein Trigger an `skylanders` ist
-- eine — und kein kuenftiger Schreibweg kommt an ihm vorbei.
--
-- WAS SIE ANLEGT
--
--   skylanders_variant_family_follow    BEFORE INSERT/UPDATE OF base_sky_id,
--                                       character_id: eine Variante bekommt
--                                       die Familie ihrer Basisfigur; ein
--                                       ABWEICHENDER Familienwert an einer
--                                       Variante wird abgewiesen
--   skylanders_variant_family_cascade   AFTER UPDATE OF character_id: aendert
--                                       sich die Familie einer Basisfigur,
--                                       folgen ALLE ihre Varianten — mit
--                                       einer Journalzeile je Variante
--   admin_set_variant_base              neu gefasst: kein Familienkonflikt
--                                       mehr, die Variante uebernimmt die
--                                       Familie der neuen Basisfigur
--   admin_delete_empty_character        loescht eine Familie NUR, wenn keine
--                                       Figur auf sie zeigt, sie nicht
--                                       kuratiert ist und die Datenbank
--                                       Staging ist — sonst nichts
--   Journal                             Entitaet `character`, Feld
--                                       `family_deleted`
--
-- SIE ENTHAELT KEINE DATENANWEISUNG. Bestehende Abweichungen bleiben, wie sie
-- sind, bis jemand die Basisfigur oder die Variante anfasst; der Korrekturplan
-- liegt daneben (`supabase/checks/0168_family_audit.sql`). Keine Familie wird
-- angelegt, keine geloescht.
--
-- NEBENLAEUFIGKEIT. Die Variante liest die Familie ihrer Basisfigur mit
-- `for share`: aendert eine andere Transaktion sie gerade, wird gewartet und
-- danach der neue Wert gelesen — eine Variante kann nicht zwischen zwei
-- Staenden landen. Die Kaskade sperrt die Varianten in SKY-ID-Reihenfolge.
-- Bleibt trotzdem ein Deadlock (zwei Bediener, Basisfigur und Variante
-- ueberkreuz), bricht PostgreSQL EINE Transaktion vollstaendig ab — kein
-- Teilzustand, und der Bediener sieht die Ablehnung.
--
-- CATALOG-PUBLISH. Die Kaskade schreibt ueber den Executor hinaus
-- Variantenzeilen. `tools/catalog-sync-apply.mts` misst das seit CAT-19 je
-- Schritt (Familie VOR und NACH dem Schritt, fuer die Zeile und ihre
-- Varianten), erwartet die Journalzeilen dazu und uebernimmt die neuen
-- Marken nur, wenn der Wert genau der ihrer Basisfigur ist. Ohne diese
-- Anpassung darf `0168` NICHT auf Production (ADR-0171).
--
-- Ruecknahme: `supabase/rollback/R0168_drop_variant_family_inheritance.sql`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0168 Vorbedingung: admin_set_character fehlt (0158).';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null then
    raise exception '0168 Vorbedingung: admin_create_character fehlt (0158).';
  end if;
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0168 Vorbedingung: admin_set_variant_base fehlt (0159).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'base_sky_id' and not a.attisdropped) then
    raise exception '0168 Vorbedingung: skylanders.base_sky_id fehlt (0159).';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_base_guard_trg') then
    raise exception '0168 Vorbedingung: der Kettenriegel aus 0159 fehlt.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null or v_def not like '%''character_id''%' then
    raise exception '0168 Vorbedingung: das Journal kennt character_id nicht (0158).';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt die Familie als Entitaet und ihre Loeschung
--
-- ERWEITERT, NICHT NEU GESCHRIEBEN: die vorhandenen Werte werden aus der
-- lebenden Constraint gelesen und nur die fehlenden angehaengt. So geht kein
-- Wert verloren, den eine Migration nach 0163 ergaenzt hat, und ein zweiter
-- Lauf aendert nichts.
-- ---------------------------------------------------------------------------
do $journal$
declare
  v_def    text;
  v_werte  text[];
  v_liste  text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_entity_known';
  if v_def is null then
    raise exception '0168: catalog_admin_changes_entity_known fehlt.';
  end if;
  if v_def not like '%''character''%' then
    select array_agg(distinct m[1] order by m[1]) into v_werte
      from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m;
    v_werte := v_werte || array['character'];
    select string_agg(quote_literal(w), ', ' order by w) into v_liste from unnest(v_werte) w;
    execute 'alter table public.catalog_admin_changes '
            'drop constraint catalog_admin_changes_entity_known';
    execute format('alter table public.catalog_admin_changes '
                   'add constraint catalog_admin_changes_entity_known check (entity in (%s))',
                   v_liste);
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def not like '%''family_deleted''%' then
    select array_agg(distinct m[1] order by m[1]) into v_werte
      from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m;
    if array_length(v_werte, 1) < 15 then
      raise exception '0168: die Feld-Constraint kennt nur % Werte — zu wenig, '
        'hier ist etwas anderes passiert: %', array_length(v_werte, 1), v_def;
    end if;
    v_werte := v_werte || array['family_deleted'];
    select string_agg(quote_literal(w), ', ' order by w) into v_liste from unnest(v_werte) w;
    execute 'alter table public.catalog_admin_changes '
            'drop constraint catalog_admin_changes_field_known';
    execute format('alter table public.catalog_admin_changes '
                   'add constraint catalog_admin_changes_field_known check (field in (%s))',
                   v_liste);
  end if;
end
$journal$;


-- ---------------------------------------------------------------------------
-- 3. Die Variante folgt ihrer Basisfigur
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_variant_family_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis bigint;
begin
  if new.base_sky_id is null then
    return new;
  end if;

  /*
   * `for share`: eine gleichzeitige Familienaenderung an der Basisfigur wird
   * abgewartet, und danach gilt ihr neuer Wert. Ohne die Sperre koennte eine
   * neue Variante den alten Wert lesen, waehrend die Kaskade der anderen
   * Transaktion sie noch nicht sieht — und beide committen.
   */
  select s.character_id into v_basis
    from public.skylanders s
   where s.sky_id = new.base_sky_id
     for share;
  if not found then
    return new;   -- der Fremdschluessel aus 0159 weist die Zeile ab
  end if;

  /*
   * EIN ABWEICHENDER WERT AN EINER VARIANTE IST EIN FEHLER, KEINE KORREKTUR.
   * Nur wenn ausschliesslich die Familie geaendert wird (die Basisfigur
   * bleibt) — wer die Basisfigur wechselt, bekommt deren Familie.
   */
  if tg_op = 'UPDATE'
     and new.base_sky_id is not distinct from old.base_sky_id
     and new.character_id is distinct from old.character_id
     and new.character_id is distinct from v_basis then
    raise exception '0168: % ist eine Variante von % und traegt deren Familie. '
      'Die Familie wird an der Basisfigur gepflegt.', new.sky_id, new.base_sky_id
      using errcode = 'check_violation';
  end if;

  if new.character_id is distinct from v_basis then
    /*
     * Die Zeile bekommt die Familie ihrer (neuen) Basisfigur. Bei einem
     * UPDATE ist das eine Aenderung, die niemand ausdruecklich geschrieben
     * hat — also schreibt sie das Journal hier. Eine neue Zeile hat noch
     * keinen alten Wert; ihre Anlage journalt der anlegende Weg.
     */
    if tg_op = 'UPDATE' and old.character_id is distinct from v_basis then
      insert into public.catalog_admin_changes
        (entity, entity_id, field, old_value, new_value, changed_by)
      values ('skylander', new.sky_id, 'character_id',
              old.character_id::text, v_basis::text, (select auth.uid()));
    end if;
    new.character_id := v_basis;
  end if;
  return new;
end;
$$;

comment on function public.skylanders_variant_family_follow() is
  'A variant always carries its base figure''s family, NULL included (0168, ADR-0171). On insert and on a base change the row takes the base''s character_id (journaled on update); a direct change of a variant''s family to anything else is refused. Reads the base with FOR SHARE so a concurrent family change is waited for, not missed.';

drop trigger if exists skylanders_variant_family_follow_trg on public.skylanders;
create trigger skylanders_variant_family_follow_trg
  before insert or update of base_sky_id, character_id on public.skylanders
  for each row execute function public.skylanders_variant_family_follow();


-- ---------------------------------------------------------------------------
-- 4. Die Basisfigur nimmt ihre Varianten mit
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_variant_family_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.character_id is not distinct from old.character_id then
    return null;
  end if;

  /* Feste Sperrreihenfolge: weniger Gelegenheit fuer einen Deadlock. */
  perform 1 from public.skylanders v
    where v.base_sky_id = new.sky_id
    order by v.sky_id
    for update;

  /* Erst das Journal mit den ALTEN Werten, dann die Aenderung. */
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  select 'skylander', v.sky_id, 'character_id',
         v.character_id::text, new.character_id::text, (select auth.uid())
    from public.skylanders v
   where v.base_sky_id = new.sky_id
     and v.character_id is distinct from new.character_id
   order by v.sky_id;

  update public.skylanders v
     set character_id = new.character_id
   where v.base_sky_id = new.sky_id
     and v.character_id is distinct from new.character_id;

  return null;
end;
$$;

comment on function public.skylanders_variant_family_cascade() is
  'When a base figure''s character_id changes, every direct variant follows in the same transaction, NULL included, one journal row per changed variant (0168, ADR-0171). Variants are locked in sky_id order first. Variants have no variants (0159), so this never recurses further.';

drop trigger if exists skylanders_variant_family_cascade_trg on public.skylanders;
create trigger skylanders_variant_family_cascade_trg
  after update of character_id on public.skylanders
  for each row execute function public.skylanders_variant_family_cascade();


-- ---------------------------------------------------------------------------
-- 5. admin_set_variant_base — ohne Familienkonflikt
--
-- Bis 0168 brach sie ab, wenn Variante und Basisfigur verschiedene Familien
-- hatten, und uebertrug die Familie selbst. Beides erledigt jetzt der
-- Trigger: die Variante bekommt die Familie der neuen Basisfigur. Geblieben
-- ist `p_create_family` — eine Familie nach dem Namen der Basisfigur, NUR
-- auf ausdruecklichen Wunsch und nur, wenn die Basisfigur keine hat; sie
-- geht an die Basisfigur, und die Variante erbt sie.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_variant_base(
  p_sky_id        text,
  p_base_sky_id   text,
  p_create_family boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_basis     public.skylanders%rowtype;
  v_alt       text;
  v_fam_tat   text   := 'von der Basisfigur geerbt';
  v_fam_jetzt bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.base_sky_id;

  if p_base_sky_id is null then
    if v_alt is null then
      return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                                'changed', false, 'family', 'unveraendert');
    end if;
    update public.skylanders set base_sky_id = null where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, null, (select auth.uid()));
    return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                              'old_base_sky_id', v_alt, 'changed', true,
                              'family', 'unveraendert');
  end if;

  if p_base_sky_id = p_sky_id then
    raise exception '0159: eine Figur kann nicht ihre eigene Variante sein (%)',
      p_sky_id;
  end if;

  select * into v_basis from public.skylanders where sky_id = p_base_sky_id for update;
  if not found then
    raise exception '0159: die Basisfigur % gibt es nicht', p_base_sky_id;
  end if;

  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0159: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;

  if v_basis.base_sky_id is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0159: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  if v_basis.character_id is null and p_create_family then
    perform public.admin_set_character(p_base_sky_id,
                                       public.admin_create_character(v_basis.name));
    v_fam_tat := 'neu angelegt an der Basisfigur, von der Variante geerbt';
  elsif v_basis.character_id is null then
    v_fam_tat := 'keine — die Basisfigur hat keine';
  end if;

  if v_alt is distinct from p_base_sky_id then
    update public.skylanders set base_sky_id = p_base_sky_id where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, p_base_sky_id,
            (select auth.uid()));
  end if;

  select s.character_id into v_fam_jetzt from public.skylanders s where s.sky_id = p_sky_id;

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'old_base_sky_id', v_alt,
    'base_name', v_basis.name,
    'series_code', v_row.series_code,
    'character_id', v_fam_jetzt,
    'family', v_fam_tat,
    'changed', (v_alt is distinct from p_base_sky_id));
end;
$$;

comment on function public.admin_set_variant_base(text, text, boolean) is
  'Links a catalogue figure to its base figure within the same series, or detaches it with NULL (0159, family rule since 0168). Refuses a different series, a base that is itself a variant, a row that already has variants, and itself. The variant takes the base''s family through skylanders_variant_family_follow (0168) - there is no family conflict any more. With p_create_family a family named after the base is created and given to the BASE, only when the base has none. Writes base_sky_id and journals it. Platform admins only.';

revoke all on function public.admin_set_variant_base(text, text, boolean) from public, anon;
grant execute on function public.admin_set_variant_base(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Eine leere Familie loeschen — nur auf Staging, nur unkuratiert
--
-- DREI ANTWORTEN AUSSER `deleted`, und keine davon ist ein Fehler:
--   `in_use`        eine Figur zeigt noch auf sie
--   `curated`       sie traegt kuratierte Angaben (Element, Spezies, …) —
--                   aus `data/characters/characters.json`; sie bleibt
--   `not_editorial` diese Datenbank ist nicht Staging (Umgebungsstempel);
--                   Production loescht keine Familie selbst (ADR-0167)
--   `gone`          sie ist schon weg
--
-- SICHER GEGEN GLEICHZEITIGE ZUORDNUNG. Die Zeile wird `for update`
-- gesperrt. Eine Zuordnung, die in diesem Moment entsteht, braucht fuer
-- ihren Fremdschluessel eine Sperre auf genau dieser Zeile: entweder wartet
-- sie und scheitert danach am Fremdschluessel, oder diese Funktion wartet
-- und sieht die Zuordnung. Und der Fremdschluessel selbst (`on delete
-- restrict`, 0002) weist jede Loeschung ab, solange eine Figur zeigt — kein
-- CASCADE.
--
-- DER NAME BLEIBT IM JOURNAL. Das Journal fuehrt Familien als Nummer
-- (`character_id`); die Zeile `family_deleted` haelt fest, welcher Name zu
-- dieser Nummer gehoerte.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_empty_character(p_character_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.characters%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '') not like 'skyisles-staging %' then
    return 'not_editorial';
  end if;

  select * into v_c from public.characters c where c.id = p_character_id for update;
  if not found then
    return 'gone';
  end if;

  if v_c.element is not null or v_c.species is not null or v_c.role_type is not null
     or v_c.short_description is not null or v_c.source_url is not null
     or v_c.source_label is not null or v_c.verified_at is not null then
    return 'curated';
  end if;

  if exists (select 1 from public.skylanders s where s.character_id = p_character_id) then
    return 'in_use';
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('character', p_character_id::text, 'family_deleted',
          v_c.canonical_name, null, (select auth.uid()));
  delete from public.characters c where c.id = p_character_id;
  return 'deleted';
end;
$$;

comment on function public.admin_delete_empty_character(bigint) is
  'Deletes ONE figure family, only when no catalogue row references it, it carries no curated metadata, and the database is Staging by its environment stamp (0168, ADR-0171). Locks the row FOR UPDATE; the 0002 foreign key (ON DELETE RESTRICT, never cascade) refuses the delete while any figure points at it. Journals the name as family_deleted before deleting. Returns deleted, in_use, curated, not_editorial or gone. Platform admins only; the publish never calls it.';

revoke all on function public.admin_delete_empty_character(bigint) from public, anon;
grant execute on function public.admin_delete_empty_character(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_abweichend integer;
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_family_follow_trg') then
    raise exception '0168 Nachbedingung: der Folge-Trigger fehlt';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_family_cascade_trg') then
    raise exception '0168 Nachbedingung: der Kaskaden-Trigger fehlt';
  end if;
  if to_regprocedure('public.admin_delete_empty_character(bigint)') is null then
    raise exception '0168 Nachbedingung: admin_delete_empty_character fehlt';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)'))
     like '%nicht stillschweigend ueberschrieben%' then
    raise exception '0168 Nachbedingung: admin_set_variant_base ist noch die Fassung aus 0159';
  end if;

  /* AUSKUNFT, KEINE KORREKTUR: so viele Varianten weichen heute ab. */
  select count(*) into v_abweichend
    from public.skylanders v join public.skylanders b on b.sky_id = v.base_sky_id
   where v.character_id is distinct from b.character_id;
  raise notice '0168 ok: Vererbung aktiv. % Variante(n) weichen heute noch von ihrer '
    'Basisfigur ab — sie werden NICHT angefasst (Korrekturplan: '
    'supabase/checks/0168_family_audit.sql).', v_abweichend;
end
$nach$;

commit;
