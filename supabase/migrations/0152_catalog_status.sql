-- ===========================================================================
-- 0152 — KATALOGSTATUS: OEFFENTLICH · VERSTECKT · ENTWURF (ADR-0151, CAT-02B)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Der Katalog kennt heute zwei redaktionelle Zustaende:
-- `catalog_visible` true oder false. Der Betrieb braucht einen dritten —
-- „Entwurf" —, damit ein neu angelegter oder spaeter importierter Eintrag
-- sagen kann „noch nicht fertig" statt „zurueckgezogen". Beide sind nicht
-- oeffentlich; sie unterscheiden sich in der ABSICHT, nicht im Verhalten.
--
-- WAS DIESE MIGRATION NICHT ANFASST, und das ist ihr Zuschnitt:
--
--   * keine RLS-Politik. `skylanders_select_anon` und
--     `skylanders_select_authenticated` lesen weiter `is_active and
--     catalog_visible`, und `catalog_visible` behaelt genau seine Bedeutung.
--   * keinen Index. `skylanders_public_catalog_idx` bleibt.
--   * keine Sicht, kein `shop_offers()`.
--   * keine SKY-ID, keine Sammlungs-, Favoriten-, Lager- oder
--     Angebotsbeziehung.
--
-- Nach dieser Migration hat jede der bestehenden Zeilen genau den Status, den
-- ihr `catalog_visible` heute schon bedeutet. **Kein bestehender Eintrag wird
-- zum Entwurf.**
--
-- ---------------------------------------------------------------------------
-- WARUM EIN TRIGGER UND NICHT NUR EIN CHECK
-- ---------------------------------------------------------------------------
--
-- Der naheliegende Entwurf waere eine Spalte plus
--
--     check ((catalog_status = 'public') = catalog_visible)
--
-- und er haette DREI bestehende Schreibpfade zerbrochen — nachgezaehlt, nicht
-- vermutet:
--
--   admin_set_catalog_visible    `update … set catalog_visible = p_visible`
--                                schreibt den Status nicht mit → CHECK verletzt
--   admin_create_figure          `insert … catalog_visible = false` ohne Status
--                                → Vorgabewert waere 'public' → CHECK verletzt
--   seller_create_catalog_item   dasselbe, aus dem Einkaufsbuch (0137)
--
-- Der Trigger dreht das um: **wer nur eine der beiden Spalten schreibt,
-- bekommt die andere abgeleitet.** Damit funktioniert jeder bestehende
-- Schreibpfad unveraendert weiter, und der CHECK ist trotzdem da — als
-- Beweis, dass die beiden nie auseinanderlaufen koennen. Erst der Trigger
-- macht die Zusage einhaltbar, erst der CHECK macht sie nachweisbar.
--
-- DAS MUSTER IST NICHT NEU. `0135` leitet `skylanders.item_type` mit einem
-- BEFORE-Trigger aus der Kategorie ab, und `0001` schuetzt die SKY-ID mit
-- einem. Ein dritter Trigger derselben Art ist keine neue Bauart.
--
-- REIHENFOLGE DER TRIGGER: der neue ist BEFORE, das Journal
-- (`skylanders_log_editorial`, 0004) ist AFTER. Das Journal sieht also die
-- bereits korrigierten Werte, und ein Statuswechsel steht mit seinem
-- richtigen alten und neuen Wert darin.
--
-- KEINE SPALTENVORGABE, UND DAS IST ABSICHT. `catalog_status` hat **keinen**
-- DEFAULT: NULL beim INSERT ist das Signal „der Aufrufer hat nichts gesagt",
-- und genau dann leitet der Trigger aus `catalog_visible` ab. Ein Vorgabewert
-- 'public' wuerde `seller_create_catalog_item` widersprechen, das
-- ausdruecklich `catalog_visible = false` schreibt.
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER, und das ist die Hausform dieses
-- Projekts (wie `0150` und `0151`): die Klammer setzt die Einfuege-Huelle
-- `supabase/operations/staging-0152.sql`, weil ihre Umgebungs- und
-- Zustandswaechter MIT in dieselbe Transaktion gehoeren. Eine Klammer hier
-- waere eine zweite — das innere `commit` wuerde die aeussere Transaktion
-- vorzeitig abschliessen und die Waechter wirkungslos machen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Spalte, noch ohne Zwang
--
-- Nullable und ohne Vorgabewert, damit der Backfill und der Trigger darunter
-- arbeiten koennen. `set not null` folgt in Abschnitt 3 — BEFORE-Trigger
-- laufen vor der Constraint-Pruefung, ein INSERT ohne Status bleibt also auch
-- danach gueltig.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column catalog_status text;

comment on column public.skylanders.catalog_status is
  'Editorial status (CAT-02B, ADR-0151): public, hidden or draft. public and hidden mean exactly what catalog_visible meant; draft is the third state for an entry that has never been released. hidden and draft are behaviourally identical - neither is public - and differ in intent only. Admin-owned: no import writes it. catalog_visible stays the machine-readable visibility that RLS, the partial index and shop_offers() read; a trigger keeps the two in step and a CHECK proves they are.';


-- ---------------------------------------------------------------------------
-- 2. Backfill — kein Eintrag wird zum Entwurf
-- ---------------------------------------------------------------------------
update public.skylanders
   set catalog_status = case when catalog_visible then 'public' else 'hidden' end;


-- ---------------------------------------------------------------------------
-- 3. Der Zwang: bekannter Wert, und nie im Widerspruch zur Sichtbarkeit
-- ---------------------------------------------------------------------------
alter table public.skylanders
  alter column catalog_status set not null;

alter table public.skylanders
  add constraint skylanders_catalog_status_known
    check (catalog_status in ('public', 'hidden', 'draft')),
  add constraint skylanders_catalog_status_matches_visibility
    check ((catalog_status = 'public') = catalog_visible);


-- ---------------------------------------------------------------------------
-- 4. Der Trigger, der jeden bestehenden Schreibpfad weiterleben laesst
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_sync_catalog_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.catalog_status is null then
      -- Der Aufrufer hat nichts gesagt: die Sichtbarkeit entscheidet.
      new.catalog_status := case when new.catalog_visible then 'public' else 'hidden' end;
    else
      -- Der Aufrufer hat den Status gesagt: er entscheidet die Sichtbarkeit.
      new.catalog_visible := (new.catalog_status = 'public');
    end if;
    return new;
  end if;

  if new.catalog_status is distinct from old.catalog_status then
    new.catalog_visible := (new.catalog_status = 'public');
  elsif new.catalog_visible is distinct from old.catalog_visible then
    /*
     * DER ALTE SCHREIBPFAD, UND DIE EINE FEINHEIT DARIN.
     *
     * `admin_set_catalog_visible(sky_id, false)` auf einem ENTWURF soll ihn
     * nicht stillschweigend zu „versteckt" umbenennen: beide sind nicht
     * oeffentlich, und die Absicht gehoert dem, der sie gesetzt hat. Nur ein
     * Wechsel nach sichtbar ist eindeutig — das ist 'public'.
     */
    new.catalog_status := case
      when new.catalog_visible          then 'public'
      when old.catalog_status = 'draft' then 'draft'
      else                                   'hidden'
    end;
  end if;
  return new;
end;
$$;

comment on function public.skylanders_sync_catalog_status() is
  'Keeps skylanders.catalog_status and catalog_visible in step (0152). Whichever column a write names, the other is derived - which is what lets admin_set_catalog_visible, admin_create_figure and seller_create_catalog_item keep working unchanged. Hiding a draft leaves it a draft: both are non-public, and the intent belongs to whoever set it. BEFORE, so the CHECK constraints and the AFTER journal trigger both see the corrected row.';

create trigger skylanders_sync_catalog_status
  before insert or update on public.skylanders
  for each row execute function public.skylanders_sync_catalog_status();


-- ---------------------------------------------------------------------------
-- 5. Das Journal kennt ein Feld mehr
--
-- `log_skylander_editorial_change` journalisiert vier redaktionelle Felder
-- (0004, erweitert in 0007 und 0033). `create or replace` ersetzt den ganzen
-- Rumpf, also stehen alle vier hier noch einmal — unveraendert — plus
-- `catalog_status`.
--
-- `catalog_visible` BLEIBT ebenfalls journalisiert. Ein Statuswechsel
-- erzeugt damit zwei Zeilen, und das ist richtig: der alte Schreibpfad
-- schreibt weiterhin nur die eine Spalte, und ein Journal, das die
-- Sichtbarkeit nicht mehr nennt, haette eine Luecke genau dort.
-- ---------------------------------------------------------------------------
create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_status is distinct from old.catalog_status then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_status',
            old.catalog_status, new.catalog_status,
            (select auth.uid()));
  end if;
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;
  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;
  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;
  if new.card_type is distinct from old.card_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'card_type',
            old.card_type, new.card_type,
            (select auth.uid()));
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Der Schreibweg des Admins
--
-- Ein UPDATE fuer beide Spalten, damit der CHECK nicht einmal
-- zwischenzeitlich verletzt ist. Der Trigger wuerde es auch alleine richten;
-- beides zu schreiben macht die Absicht an der Aufrufstelle lesbar.
--
-- `is_platform_admin()` ist das Tor, nicht `is_shop_admin()`: seit ADR-0077
-- sind Plattformadmin und Verkaeuferbetrieb getrennt, und der Katalog gehoert
-- der Plattform. Dieselbe Pruefung, die `admin_set_catalog_visible` seit 0041
-- benutzt.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_catalog_status(
  p_sky_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_status is null or p_status not in ('public', 'hidden', 'draft') then
    raise exception 'unknown catalog status %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;

  update public.skylanders
     set catalog_status  = p_status,
         catalog_visible = (p_status = 'public')
   where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_set_catalog_status(text, text) is
  'Sets the editorial status of one catalogue figure (0152, CAT-02B). Platform administrators only. Writes status and visibility in ONE update, so the CHECK is never transiently violated. Rejects any value outside public/hidden/draft. The change is journalled by skylanders_log_editorial; there is no approval step and no second actor.';

revoke all on function public.admin_set_catalog_status(text, text) from public, anon;
grant execute on function public.admin_set_catalog_status(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. `admin_set_catalog_visible` BLEIBT, unveraendert
--
-- Sie wird nicht geloescht und nicht umgeschrieben. Drei Gruende:
--
--   * Rueckwaertskompatibilitaet: jeder Aufrufer, der sie heute benutzt,
--     benutzt sie weiter, und der Trigger setzt den Status mit.
--   * Sie bleibt die richtige Antwort auf die ZWEI-Zustands-Frage „oeffentlich
--     oder nicht", die es in Zubehoer- und Betriebsflaechen weiterhin gibt.
--   * Eine Funktion zu entfernen, die noch aufgerufen wird, waere eine
--     Aenderung mit Reichweite — und diese Migration soll keine haben.
--
-- Die Adminoberfläche ruft ab CAT-02B `admin_set_catalog_status` auf. Beide
-- Wege fuehren zu einem gueltigen Zustand.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 8. Eine neu angelegte Figur ist ein Entwurf
--
-- Wortgleich die Fassung aus 0041, mit GENAU einer fachlichen Aenderung: der
-- INSERT nennt `catalog_status`. Die Signatur bleibt identisch — ein
-- zusaetzlicher Parameter waere eine Ueberladung und keine Ersetzung, und
-- dann gaebe es zwei Funktionen mit demselben Namen.
--
-- `seller_create_catalog_item` (0137) wird NICHT angefasst: sie legt Zubehoer
-- aus dem Einkaufsbuch an, bekommt vom Trigger 'hidden' und funktioniert
-- unveraendert. Ob dort 'draft' die richtigere Beschriftung waere, ist eine
-- eigene Entscheidung und keine dieser Migration.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null,
  p_template_sky_id       text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text   := btrim(coalesce(p_name, ''));
  v_next      bigint;
  v_sky_id    text;
  v_slug      text;
  v_override  text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note      text   := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_template  text   := nullif(btrim(coalesce(p_template_sky_id, '')), '');
  v_character bigint := null;
  v_found     boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  /*
   * The template, read from the catalogue rather than believed.
   *
   * A SKY-ID that does not exist is refused instead of silently ignored: the
   * operator picked something, and a create that quietly dropped the
   * relationship would produce a figure that looks derived and is not.
   *
   * `v_character` may still be NULL afterwards - that is a template without a
   * curated character, and it is a normal answer.
   */
  if v_template is not null then
    select s.character_id, true
      into v_character, v_found
      from public.skylanders s
     where s.sky_id = v_template;

    if not coalesce(v_found, false) then
      raise exception 'unknown template figure %', v_template
        using errcode = 'no_data_found';
    end if;
  end if;

  v_next := nextval('public.sky_id_seq');

  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, catalog_status, display_name_override,
     character_id, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false),
     -- DIE EINE FACHLICHE AENDERUNG (CAT-02B, Teil F): eine neu angelegte
     -- Figur ist ein ENTWURF, nicht ein verstecktes Objekt. Beides ist
     -- nicht oeffentlich, aber nur eines sagt „noch nicht fertig".
     -- Wer ausdruecklich sichtbar anlegt, bekommt weiter 'public'.
     case when coalesce(p_catalog_visible, false) then 'public' else 'draft' end,
     v_override, v_character, 'admin', true);

  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;


-- ===========================================================================
-- WAS DANACH GILT
--
--   * 594 Zeilen tragen einen Status, kein einziger ist 'draft'.
--   * `catalog_visible` ist unveraendert die Spalte, die RLS, der Teilindex
--     und `shop_offers()` lesen. Keine Sichtbarkeit hat sich geaendert.
--   * Jeder bestehende Schreibpfad funktioniert: der Trigger leitet ab, was
--     der Aufrufer nicht nennt.
--   * Eine neu angelegte Figur ist ein Entwurf.
--
-- WAS DIESE MIGRATION NICHT TUT
--
--   * Sie erweitert die Lesepolitik NICHT um Favoriten. Wer ein Objekt
--     vorgemerkt, aber nicht besessen hat, verliert es weiterhin aus seiner
--     Wunschliste, sobald es nicht oeffentlich ist — das gilt heute schon fuer
--     `hidden` und ist eine eigene Entscheidung (CAT-02A, P7).
--   * Sie fasst `seller_create_catalog_item` nicht an.
--   * Sie legt keine Figur an und vergibt keine SKY-ID.
-- ===========================================================================
