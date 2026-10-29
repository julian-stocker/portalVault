-- ---------------------------------------------------------------------------
-- 0159 — die Variante kennt ihre Basisfigur
--
-- CAT-07. `0158` hat die Figurenfamilie administrativ bedienbar gemacht:
-- `character_id` verbindet denselben Charakter SERIENUEBERGREIFEND. Was
-- fehlte, ist die zweite, engere Beziehung — welche Figur ist die Variante
-- WELCHER Basisfigur, und zwar innerhalb EINER Serie.
--
-- *** DREI EBENEN, DREI SPALTEN, KEINE VERMISCHUNG ***
--
--   Figurenfamilie   `character_id`   serienuebergreifend   (`0002`)
--   Basisfigur       `base_sky_id`    innerhalb einer Serie (hier)
--   Katalogeintrag   `sky_id`         die Sache selbst      (`0001`)
--
-- Warum beides noetig ist, zeigt Eon's Elite: `Elite Boomer` und `Boomer`
-- stehen in VERSCHIEDENEN Serien. Sie sind derselbe Charakter — das sagt
-- `character_id` — aber keine Variante voneinander, denn Eon's Elite ist
-- eine Produktlinie (`0032`). Eine Ebene allein koennte das nicht
-- unterscheiden. Gemessen am 2026-10-28: 4 solche Faelle.
--
-- *** DIE SERIENREGEL IST STRUKTURELL, NICHT PROGRAMMIERT ***
--
-- `(base_sky_id, series_code)` zeigt auf `(sky_id, series_code)`. Weil
-- `series_code` auf BEIDEN Seiten derselbe Wert sein muss, kann eine
-- Variante nur auf eine Basisfigur DERSELBEN Serie zeigen — ohne Trigger,
-- ohne Anwendungslogik, und auch fuer einen Zugriff, der die Oberflaeche
-- umgeht. Dasselbe Muster traegt seit `0001` die Kategoriezuordnung:
--
--     foreign key (category_id, series_code) references categories (id, series_code)
--
-- `ON UPDATE RESTRICT` und nicht `CASCADE` — Entscheidung des Betreibers,
-- CAT-07. Ein `CASCADE` haette eine Serienaenderung an der Basisfigur
-- stillschweigend auf alle ihre Varianten durchgeschrieben: eine
-- Massenaenderung an Katalogdaten, die niemand angeordnet hat. Jetzt wird
-- die Aenderung abgewiesen, und der Betreiber loest zuerst die Varianten.
-- Das ist unbequemer und nachvollziehbar.
--
-- *** WAS EIN FREMDSCHLUESSEL NICHT KANN ***
--
-- „Die Basisfigur darf selbst keine Variante sein." Das braucht einen Blick
-- in eine ANDERE Zeile, und das kann ein CHECK nicht. Ein Trigger prueft es
-- in BEIDEN Richtungen: beim Zuordnen (die genannte Basisfigur ist frei) und
-- beim Verwandeln (eine Zeile, auf die Varianten zeigen, wird selbst keine
-- Variante). Es gaebe eine rein strukturelle Loesung mit einer generierten
-- Spalte und einem dreispaltigen Schluessel; sie ist klueger und schlechter
-- zu lesen, und ein Riegel, den niemand versteht, ist kein Riegel.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie ordnet NICHTS zu. Kein Backfill, keine Massenverknuepfung, keine
-- Umbenennung, kein Lauf ueber die 70 Paare, die die Analyse gefunden hat.
-- Die Spalte entsteht leer, und jede Zuordnung ist danach eine einzelne
-- Entscheidung. `0154`-`0158` bleiben unveraendert; die vorhandenen 107
-- Familienzuordnungen bleiben, wo sie sind.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0159 Vorbedingung: skylanders fehlt (0001).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'character_id' and not a.attisdropped) then
    raise exception '0159 Vorbedingung: skylanders.character_id fehlt (0002).';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0159 Vorbedingung: admin_set_character fehlt (0158) — 0159 '
      'benutzt sie, damit die Familienzuordnung EINEN Schreibweg hat.';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null then
    raise exception '0159 Vorbedingung: admin_create_character fehlt (0158).';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0159 Vorbedingung: admin_set_catalog_status fehlt (0152).';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0159 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%character_id%' then
    raise exception '0159 Vorbedingung: die Constraint ist nicht die aus 0158 '
      '(%). 0158 muss zuerst angewendet sein.', v_def;
  end if;

  if exists (select 1 from pg_attribute a
              where a.attrelid = to_regclass('public.skylanders')
                and a.attname = 'base_sky_id' and not a.attisdropped) then
    raise notice '0159: skylanders.base_sky_id steht schon — dieser Lauf laesst '
      'die Spalte und ihre Werte unberuehrt.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte, und die Riegel, die sie tragen
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists base_sky_id text;

comment on column public.skylanders.base_sky_id is
  'The base figure this row is a variant OF, within the SAME game series (0159, CAT-07). NULL means "this is a base figure, or stands on its own" - never "unknown". Not a family: character_id links the same character across series (0002), this links a variant to one specific figure inside one series. At most one, enforced by being one column; never a variant of a variant, enforced by a trigger; always the same series, enforced structurally by the composite foreign key below.';

/*
 * DIE EINDEUTIGKEIT, DIE DEN ZUSAMMENGESETZTEN SCHLUESSEL ERST MOEGLICH
 * MACHT. Sie sieht redundant aus — `sky_id` ist der Primaerschluessel, also
 * ist `(sky_id, series_code)` trivial eindeutig. Sie ist es nicht: ein
 * Fremdschluessel braucht eine eindeutige Einschraenkung GENAU ueber den
 * Spalten, auf die er zeigt. Ohne sie gibt es die Serienregel nicht.
 *
 * Wer sie fuer Ballast haelt und entfernt, nimmt den Riegel mit.
 */
alter table public.skylanders
  drop constraint if exists skylanders_id_series_uniq;
alter table public.skylanders
  add constraint skylanders_id_series_uniq unique (sky_id, series_code);

-- KEINE FIGUR IST IHRE EIGENE VARIANTE. Das geht als CHECK, weil es nur die
-- eigene Zeile braucht.
alter table public.skylanders
  drop constraint if exists skylanders_base_not_self;
alter table public.skylanders
  add constraint skylanders_base_not_self
    check (base_sky_id is distinct from sky_id);

/*
 * DIE SERIENREGEL. `series_code` steht auf beiden Seiten des Schluessels,
 * muss also derselbe Wert sein — eine Variante kann nur auf eine Basisfigur
 * derselben Serie zeigen, und keine Anwendung, kein Skript und kein
 * PostgREST-Aufruf kommt daran vorbei.
 *
 * `on update restrict`: eine Serienaenderung an der Basisfigur wird
 * ABGEWIESEN, solange Varianten an ihr haengen (CAT-07, Entscheidung des
 * Betreibers). `on delete restrict`: eine Basisfigur mit Varianten wird
 * nicht geloescht.
 */
alter table public.skylanders
  drop constraint if exists skylanders_base_same_series;
alter table public.skylanders
  add constraint skylanders_base_same_series
    foreign key (base_sky_id, series_code)
    references public.skylanders (sky_id, series_code)
    on update restrict on delete restrict;

-- Gesucht wird „alle Varianten dieser Basisfigur". Teilindex, weil heute
-- keine Zeile einen Wert traegt und die meisten nie einen bekommen.
create index if not exists skylanders_base_sky_id_idx
  on public.skylanders (base_sky_id)
  where base_sky_id is not null;


-- ---------------------------------------------------------------------------
-- 3. Keine Variante einer Variante — in beiden Richtungen
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_variant_base_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis_basis text;
  v_varianten   integer;
begin
  if new.base_sky_id is null then
    return new;
  end if;

  -- RICHTUNG 1: die genannte Basisfigur darf selbst keine Variante sein.
  select s.base_sky_id into v_basis_basis
    from public.skylanders s where s.sky_id = new.base_sky_id;
  if v_basis_basis is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Varianten von '
      'Varianten gibt es nicht — die Basisfigur muss eine Basisfigur sein.',
      new.base_sky_id, v_basis_basis
      using errcode = 'check_violation';
  end if;

  /*
   * RICHTUNG 2: eine Zeile, auf die Varianten zeigen, wird selbst keine
   * Variante. Ohne diese Haelfte entstuende die Kette von unten statt von
   * oben — dieselbe verbotene Form, nur anders herum erreicht.
   */
  select count(*) into v_varianten
    from public.skylanders s where s.base_sky_id = new.sky_id;
  if v_varianten > 0 then
    raise exception '0159: auf % zeigen % Variante(n). Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', new.sky_id, v_varianten
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.skylanders_variant_base_guard() is
  'Keeps the variant relation one level deep (0159, CAT-07). A foreign key cannot look at another row, so this does: the named base figure must itself be a base figure, and a row that already has variants cannot become one. Both directions, because the forbidden chain can be built from either end. The same-series rule is NOT here - that one is structural, in skylanders_base_same_series.';

drop trigger if exists skylanders_variant_base_guard_trg on public.skylanders;
create trigger skylanders_variant_base_guard_trg
  before insert or update of base_sky_id on public.skylanders
  for each row execute function public.skylanders_variant_base_guard();


-- ---------------------------------------------------------------------------
-- 4. Das Journal kennt einen zwoelften Wert
--
-- Dieselbe Lehre zum dritten Mal: wer eine Spalte journalisiert, muss ihren
-- Namen in die Liste aufnehmen. `0152` hat es vergessen und jeder
-- Statuswechsel lief in `23514`; `0158` hat es fuer `character_id`
-- nachgezogen. Hier kommt `base_sky_id` dazu, und die elf bleiben.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- der elfte aus `0158`:
      'character_id',
      -- und der zwoelfte, aus dieser Migration:
      'base_sky_id'
    ));


-- ---------------------------------------------------------------------------
-- 4b. `admin_merge_references` muss einen ZWEISPALTIGEN Schluessel zaehlen
--
-- DAS IST EIN BEFUND DES PROBELAUFS, und er haette wehgetan. `0154` leitet
-- die verweisenden Tabellen aus `pg_constraint` her (ADR-0134) und nimmt
-- dabei blind `conkey[1]` — die ERSTE Spalte des Fremdschluessels. Bei einem
-- einspaltigen Schluessel ist das richtig. Bei einem mehrspaltigen weigert
-- sie sich ausdruecklich:
--
--     if r.spalten <> 1 then
--       raise exception '0154: % hat einen mehrspaltigen Fremdschluessel …'
--
-- Das war 2026-10-28 richtig gedacht und ist ab dieser Migration falsch:
-- `skylanders_base_same_series` ist zweispaltig, und ohne diese Korrektur
-- wuerde `admin_merge_references` bei JEDEM Aufruf abbrechen. Damit braechen
-- `admin_merge_draft` und `admin_discard_draft` — zwei Funktionen, die
-- angewendet und in Gebrauch sind.
--
-- DIE KORREKTUR MACHT SIE GENAUER, NICHT NACHSICHTIGER. Statt die erste
-- Spalte zu nehmen, sucht sie die Spalte, die WIRKLICH auf `sky_id` zeigt —
-- ueber die Stelle von `sky_id` in `confkey`. Das ist bei einem
-- einspaltigen Schluessel dieselbe Antwort wie vorher und bei einem
-- mehrspaltigen die richtige.
--
-- DER LAUTE FEHLSCHLAG BLEIBT. Zeigt ein Fremdschluessel auf `skylanders`,
-- aber nicht auf `sky_id` (etwa auf `slug`, der ebenfalls eindeutig ist),
-- kann diese Funktion ihn nicht zaehlen — und bricht ab, statt zu wenig zu
-- melden. Zu wenig zu melden hiesse: die Loeschung laeuft los und scheitert
-- mitten im Vorgang an einem `23503`. Heute gibt es keinen solchen
-- Schluessel; kaeme einer, soll er auffallen.
--
-- `0154` selbst wird NICHT angefasst — die Datei bleibt, wie sie gelaufen
-- ist. Ersetzt wird der Funktionsrumpf, wie `0156` es mit dem Rumpf aus
-- `0154` gemacht hat und `0157` mit dem aus `0156`.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_references(p_sky_id text)
returns table (tabelle text, spalte text, zeilen bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  for r in
    select c.conrelid::regclass::text              as tab,
           c.conname::text                          as name,
           array_length(c.conkey, 1)                as spalten,
           /*
            * DIE STELLE, AN DER `sky_id` IM SCHLUESSEL STEHT. `confkey` fuehrt
            * die Spalten der ZIELtabelle in derselben Reihenfolge wie
            * `conkey` die der Quelltabelle. Wer die Stelle von `sky_id` in
            * `confkey` kennt, kennt die zugehoerige Quellspalte.
            */
           (select a.attname::text
              from generate_subscripts(c.confkey, 1) as g(i)
              join pg_attribute a
                on a.attrelid = c.conrelid and a.attnum = c.conkey[g.i]
             where c.confkey[g.i] = (select a2.attnum from pg_attribute a2
                                      where a2.attrelid = c.confrelid
                                        and a2.attname = 'sky_id'
                                        and not a2.attisdropped)) as sp
      from pg_constraint c
     where c.contype = 'f'
       and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.catalog_editorial'::regclass
     order by 1, 2
  loop
    -- EIN SCHLUESSEL, DER NICHT AUF `sky_id` ZEIGT, IST NICHT ZAEHLBAR.
    -- Lieber laut abbrechen als zu wenig melden: zu wenig hiesse, die
    -- Loeschung laeuft los und scheitert mitten im Vorgang.
    if r.sp is null then
      raise exception '0159: % (%) zeigt auf skylanders, aber nicht auf sky_id — '
        'diese Funktion kann ihn nicht zaehlen', r.tab, r.name;
    end if;
    execute format('select count(*) from %s where %I = $1', r.tab, r.sp)
      into v_n using p_sky_id;
    if v_n > 0 then
      tabelle := r.tab; spalte := r.sp; zeilen := v_n;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.admin_merge_references(text) is
  'Counts what still points at a SKY-ID, derived from pg_catalog rather than a typed list (0154, corrected in 0159). Finds the referencing column through the position of sky_id in confkey, so a MULTI-column foreign key is counted correctly - 0159 adds one, (base_sky_id, series_code), and the original body refused those outright, which would have broken admin_merge_draft and admin_discard_draft on every call. catalog_editorial is excluded on purpose: that row belongs to the figure itself. A foreign key that points at skylanders by something other than sky_id still aborts loudly rather than under-reporting. Platform admins only.';

revoke all on function public.admin_merge_references(text) from public, anon;
grant execute on function public.admin_merge_references(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Basisfigur setzen, aendern oder loesen
--
-- SIE GILT FUER JEDE FIGUR, nicht nur fuer Entwuerfe (CAT-07): eine
-- Zuordnung wird falsch, wird nachgeholt, wird zurueckgenommen, und das muss
-- an einer laengst veroeffentlichten Figur genauso gehen.
--
-- DIE FAMILIE KOMMT AUS DER BASISFIGUR, ABER NIE GEGEN EINE VORHANDENE.
-- Vier Lagen, und nur in einer wird geschrieben:
--
--   Basisfigur hat F, Variante keine      -> F wird uebernommen
--   Basisfigur hat F, Variante hat F      -> nichts zu tun
--   Basisfigur hat F, Variante hat G <> F -> ABBRUCH, beide genannt
--   beide keine                           -> nur mit `p_create_family`
--
-- Geschrieben wird dabei ueber `admin_set_character` aus `0158`: EIN
-- Schreibweg fuer die Familie, und das Journal kommt umsonst mit.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_variant_base(
  p_sky_id        text,
  p_base_sky_id   text,
  -- Nur wirksam, wenn WEDER Variante NOCH Basisfigur eine Familie haben.
  -- Dann entsteht eine neue, benannt nach der Basisfigur, und beide bekommen
  -- sie. Ohne dieses Kennzeichen bleibt die Familie leer — eine Zuordnung
  -- ohne Familie ist vollstaendig gueltig.
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
  v_fam_neu   bigint := null;
  v_fam_tat   text   := 'unveraendert';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.base_sky_id;

  -- ---- LOESEN. Der Rueckweg ist kein Sonderfall, sondern die Haelfte.
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

  -- DIESELBE SERIE. Der Fremdschluessel faengt es auch, aber mit einer
  -- Meldung, die niemand lesen will.
  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0159: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;

  -- KEINE KETTEN. Der Trigger faengt es auch; hier steht der lesbare Satz.
  if v_basis.base_sky_id is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0159: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  -- ======================================================================
  -- DIE FAMILIE, und sie wird NIE gegen eine vorhandene geschrieben.
  -- ======================================================================
  if v_basis.character_id is not null then
    if v_row.character_id is null then
      perform public.admin_set_character(p_sky_id, v_basis.character_id);
      v_fam_neu := v_basis.character_id;
      v_fam_tat := 'aus der Basisfigur uebernommen';
    elsif v_row.character_id = v_basis.character_id then
      v_fam_neu := v_row.character_id;
      v_fam_tat := 'war schon dieselbe';
    else
      raise exception '0159: % gehoert zur Familie %, die Basisfigur % zur '
        'Familie %. Das wird nicht stillschweigend ueberschrieben — erst '
        'klaeren, welche gilt.',
        p_sky_id, v_row.character_id, p_base_sky_id, v_basis.character_id;
    end if;
  elsif v_row.character_id is not null then
    -- Die Variante hat eine, die Basisfigur nicht. Die Basisfigur wird NICHT
    -- angefasst: eine Familienzuordnung nach OBEN zu schreiben waere eine
    -- Entscheidung ueber eine fremde Zeile.
    v_fam_neu := v_row.character_id;
    v_fam_tat := 'nur die Variante hat eine — die Basisfigur bleibt unberuehrt';
  elsif p_create_family then
    -- Beide ohne Familie, und der Bediener hat es ausdruecklich bestaetigt.
    v_fam_neu := public.admin_create_character(v_basis.name);
    perform public.admin_set_character(p_base_sky_id, v_fam_neu);
    perform public.admin_set_character(p_sky_id, v_fam_neu);
    v_fam_tat := 'neu angelegt und beiden zugeordnet';
  else
    v_fam_tat := 'beide ohne Familie — keine angelegt';
  end if;

  -- ---- Und jetzt die Zuordnung selbst.
  if v_alt is distinct from p_base_sky_id then
    update public.skylanders set base_sky_id = p_base_sky_id where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, p_base_sky_id,
            (select auth.uid()));
  end if;

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'old_base_sky_id', v_alt,
    'base_name', v_basis.name,
    'series_code', v_row.series_code,
    'character_id', v_fam_neu,
    'family', v_fam_tat,
    'changed', (v_alt is distinct from p_base_sky_id));
end;
$$;

comment on function public.admin_set_variant_base(text, text, boolean) is
  'Links a catalogue figure to its base figure within the same series, or detaches it with NULL (0159, CAT-07). Works on any figure, not just drafts - an assignment is an editorial correction. Refuses a different series, a base that is itself a variant, a row that already has variants, and itself. Carries the family over FROM the base figure when the variant has none, does nothing when both already agree, and ABORTS when they disagree - a conflicting character_id is never silently overwritten. With p_create_family it creates one named after the base figure, but only when neither side has one. Writes base_sky_id and journals it; the family goes through admin_set_character from 0158, so there is one write path for it. Platform admins only.';

revoke all on function public.admin_set_variant_base(text, text, boolean) from public, anon;
grant execute on function public.admin_set_variant_base(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Weg B: einen Entwurf als Variante einer Basisfigur veroeffentlichen
--
-- ZWEI SCHRITTE, EINE TRANSAKTION, und keiner davon ist neu: zuordnen macht
-- Abschnitt 5, veroeffentlichen macht `admin_set_catalog_status` aus `0152`.
-- Es gibt weiterhin EINEN Veroeffentlichungsweg.
--
-- `admin_publish_as_variant(text, bigint)` aus `0158` BLEIBT unveraendert.
-- Sie veroeffentlicht mit einer FAMILIE und ohne Basisfigur — das ist etwas
-- anderes und bleibt gueltig. Diese hier ist die engere Fassung.
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_with_base(
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
  v_row      public.skylanders%rowtype;
  v_zuordnung jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_base_sky_id is null then
    raise exception '0159: Weg B braucht eine Basisfigur. Ohne Basisfigur ist es '
      'Weg C — dafuer gibt es admin_set_catalog_status.';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  if v_row.catalog_status <> 'draft' then
    raise exception '0159: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_variant_base.',
      p_sky_id, v_row.catalog_status;
  end if;

  v_zuordnung := public.admin_set_variant_base(p_sky_id, p_base_sky_id, p_create_family);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'assignment', v_zuordnung,
    'published', true);
end;
$$;

comment on function public.admin_publish_with_base(text, text, boolean) is
  'Path B of the three import paths, narrowed to a base figure (0159, CAT-07): publishes a draft as a figure in its own right AND links it to a base figure of the same series, in one transaction. Drafts only. Reuses admin_set_variant_base and admin_set_catalog_status rather than inventing a second publish path. admin_publish_as_variant(text, bigint) from 0158 stays valid - it publishes with a FAMILY and no base figure, which is a different thing. The draft keeps its SKY-ID, slug, name, image, edition and price.';

revoke all on function public.admin_publish_with_base(text, text, boolean) from public, anon;
grant execute on function public.admin_publish_with_base(text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'base_sky_id' and not a.attisdropped) then
    raise exception '0159 Nachbedingung: base_sky_id fehlt';
  end if;
  -- DIE DREI RIEGEL AN DER TABELLE.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_base_same_series'
                    and c.contype = 'f') then
    raise exception '0159 Nachbedingung: der Serienriegel fehlt';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_id_series_uniq'
                    and c.contype = 'u') then
    raise exception '0159 Nachbedingung: skylanders_id_series_uniq fehlt — ohne '
      'sie kann der Serienriegel nicht zeigen';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.skylanders')
                    and c.conname = 'skylanders_base_not_self'
                    and c.contype = 'c') then
    raise exception '0159 Nachbedingung: skylanders_base_not_self fehlt';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_base_guard_trg'
                    and not t.tgisinternal) then
    raise exception '0159 Nachbedingung: der Kettenriegel fehlt';
  end if;

  -- DER SERIENRIEGEL MUSS BEIDE SPALTEN NENNEN. Ein einspaltiger
  -- Fremdschluessel auf `sky_id` allein saehe gleich aus und liesse jede
  -- Serie zu.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname = 'skylanders_base_same_series';
  if v_def not like '%base_sky_id%series_code%' or v_def not like '%ON UPDATE RESTRICT%' then
    raise exception '0159 Nachbedingung: der Serienriegel lautet % — erwartet sind '
      'beide Spalten und ON UPDATE RESTRICT', v_def;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def not like '%base_sky_id%' then
    raise exception '0159 Nachbedingung: das Journal kennt base_sky_id nicht: %', v_def;
  end if;
  if v_def not like '%character_id%' or v_def not like '%merged_from%'
     or v_def not like '%discarded%' or v_def not like '%catalog_status%'
     or v_def not like '%created%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' or v_def not like '%card_type%'
     or v_def not like '%image_override_path%' or v_def not like '%catalog_visible%'
     or v_def not like '%display_name_override%' then
    raise exception '0159 Nachbedingung: ein alter Journalwert ist verloren: %', v_def;
  end if;

  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0159 Nachbedingung: admin_set_variant_base fehlt';
  end if;
  if to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null then
    raise exception '0159 Nachbedingung: admin_publish_with_base fehlt';
  end if;
  -- DER ERSETZTE RUMPF VON admin_merge_references ZAEHLT MEHRSPALTIG.
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0159 Nachbedingung: admin_merge_references fehlt';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_references(text)'))
      like '%mehrspaltigen Fremdschluessel%' then
    raise exception '0159 Nachbedingung: admin_merge_references weist einen '
      'mehrspaltigen Fremdschluessel noch ab — dann bricht jede '
      'Zusammenfuehrung ab, sobald base_sky_id steht';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_references(text)'))
      not like '%confkey%' then
    raise exception '0159 Nachbedingung: admin_merge_references leitet die '
      'Spalte nicht ueber confkey her';
  end if;

  -- DIE 0158-FUNKTIONEN BLEIBEN.
  if to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null then
    raise exception '0159 Nachbedingung: eine Funktion aus 0158 ist verschwunden';
  end if;

  -- KEINE DER NEUEN FASST EINEN NAMEN ODER SLUG AN.
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                       to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
         and (p.prosrc like '%set name%' or p.prosrc like '%set slug%')) <> 0 then
    raise exception '0159 Nachbedingung: eine der Funktionen schreibt einen Namen '
      'oder einen Slug';
  end if;

  -- UND ES IST NICHTS ZUGEORDNET.
  if (select count(*) from public.skylanders where base_sky_id is not null) <> 0 then
    raise exception '0159 Nachbedingung: % Zeile(n) tragen schon eine Basisfigur. '
      'Diese Migration ordnet nichts zu.',
      (select count(*) from public.skylanders where base_sky_id is not null);
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_set_variant_base(text,text,boolean)'),
                   to_regprocedure('public.admin_publish_with_base(text,text,boolean)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0159 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0159: skylanders.base_sky_id steht mit Serienriegel, '
    'Selbstbezugsriegel und Kettenriegel; das Journal kennt base_sky_id; '
    'admin_set_variant_base und admin_publish_with_base stehen. Keine Zeile '
    'wurde zugeordnet.';
end
$nach$;
