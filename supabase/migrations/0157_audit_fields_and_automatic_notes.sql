-- ---------------------------------------------------------------------------
-- 0157 — das Journal kennt drei Felder mehr, und die interne Notiz wird
--        nicht mehr ausgewaehlt
--
-- CAT-05I. Zwei Dinge, die zusammengehoeren: beide drehen sich darum, was
-- eine Zusammenfuehrung ins Journal und in die interne Notiz schreibt.
--
-- =========================================================================
-- TEIL 1 — DER FEHLER 23514, UND ER TRIFFT NICHT NUR DEN MERGE
-- =========================================================================
--
-- Der erste echte Merge-Versuch scheiterte am 2026-10-28 mit
-- `SQLSTATE 23514`, Constraint `catalog_admin_changes_field_known`, an der
-- Zeile `field = 'merged_from'`. Der ganze Vorgang wurde zurueckgerollt —
-- richtig so, es ist EINE Transaktion, und genau deshalb sind SKY-0103 und
-- SKY-0824 unveraendert.
--
-- Die Constraint stammt aus `0004`, erweitert in `0007` und `0033`. Auf
-- Staging gemessen kennt sie SIEBEN Werte:
--
--   catalog_visible · display_name_override · admin_note · catalog_group
--   image_override_path · card_type · created
--
-- DREI SCHREIBSTELLEN NENNEN WERTE, DIE DARIN FEHLEN:
--
--   `catalog_status`  `0152` hat `log_skylander_editorial_change` ERSETZT,
--                     damit der Trigger auch den neuen Status journalisiert
--                     — und die Constraint nicht erweitert. **Das trifft
--                     schon heute jeden Statuswechsel**, ganz ohne
--                     Zusammenfuehrung. Dass `0152` selbst durchlief, ist
--                     kein Widerspruch: ihr Backfill steht in Abschnitt 2,
--                     die Triggerersetzung erst in Abschnitt 5 — die 626
--                     Backfill-Zeilen haben den neuen Trigger nie gesehen.
--   `merged_from`     `admin_merge_draft` (`0154`, `0156`)
--   `discarded`       `admin_discard_draft` (`0155`)
--
-- WARUM DER PROBELAUF DAS NIE GEFUNDEN HAT: das Stub-Schema von
-- `tools/validate-check-sql.mts` traegt **keine CHECK-Constraints**. P60 war
-- gruen, obwohl `0152` denselben Fehler ausloest. Der Probelauf **P64** legt
-- die Constraint deshalb WORTGETREU an und faehrt die Faelle gegen sie —
-- erst den Fehlschlag, dann diese Migration, dann den Erfolg.
--
-- DREI WERTE MEHR, UND KEINER ZU VIEL. Die Constraint bleibt eine Liste und
-- wird nicht entfernt: sie ist der Grund, warum ein vertippter Feldname
-- auffaellt statt still im Journal zu landen. Aufgenommen wird genau, was
-- heute wirklich geschrieben wird — nachgewiesen aus den Funktionsruempfen
-- der laufenden Datenbank, nicht aus einer Vermutung.
--
-- =========================================================================
-- TEIL 2 — DIE INTERNE NOTIZ IST KEIN AUSWAEHLBARES FELD MEHR
-- =========================================================================
--
-- `0156` hat `admin_note` als neuntes Feld in die Allowlist aufgenommen, und
-- die Oberflaeche zeigte dafuer eine Kaestchenzeile. Das war falsch gedacht:
-- eine interne Notiz ist keine fachliche Katalogangabe, ueber die der
-- Bediener Fall fuer Fall entscheidet — sie ist Buchhaltung.
--
-- AB HIER GILT EINE REGEL, UND ZWAR IMMER:
--
--   1. Die Notiz der ZIELFIGUR bleibt erhalten. Immer. Sie ist Arbeit, die
--      jemand geleistet hat.
--   2. Aus der Notiz des Entwurfs wird das uebernommen, was fachlich
--      bleibt — die Herkunft: CAT-01-Kandidat, Quelle in der externen
--      Checkliste, Abschnitt.
--   3. **VERALTETE HINWEISE WANDERN NICHT MIT.** Alle 105 Importnotizen
--      endeten auf „Kein Bild uebernommen; externe Bildrechte ungeklaert." —
--      und beides ist ueberholt: CAT-05B hat 102 Bilder uebernommen, und der
--      Betreiber hat die Verwendung der Bilder fuer SkyIsles ausdruecklich
--      freigegeben (CAT-05, `docs/LEGAL.md`). Ein Satz, der eine geklaerte
--      Frage als offen beschreibt, ist schlechter als keiner.
--   4. Doppeltes wird nicht doppelt. Steht die Herkunft schon an der
--      Zielfigur, passiert nichts.
--   5. Bleibt nach dem Aufraeumen nichts uebrig, passiert nichts. Eine leere
--      Zeile in `catalog_editorial` ist kein Gewinn.
--   6. **Die Notiz haengt an keinem Kaestchen.** Sie wird verarbeitet, weil
--      zusammengefuehrt wird, nicht weil jemand sie ausgewaehlt hat.
--
-- WARUM DIE NOTIZ UEBERHAUPT MITWANDERT, obwohl das Journal den Vorgang
-- schon festhaelt: die Journalzeile sagt `merged_from: SKY-0824`, also DASS
-- zusammengefuehrt wurde. Sie sagt nicht, aus welcher Zelle der externen
-- Checkliste die Angaben stammen — und das ist die eine Information, die
-- spaeter noch jemand braucht. Mehr wird nicht erzeugt: es gibt keine
-- automatisch geschriebene „zusammengefuehrt am"-Notiz, denn die stuende
-- schon im Journal.
--
-- `public.merge_note(text, text)` ist diese Regel, als eine Funktion, an
-- einer Stelle, `immutable` und ohne jeden Seiteneffekt — damit sie sich
-- pruefen laesst, ohne etwas zu schreiben.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie aendert KEINE Notiz an bestehenden Zeilen. Keine Massenaenderung, kein
-- Backfill, kein `update` auf `catalog_editorial`. Die Regel greift beim
-- naechsten Zusammenfuehren; die 105 Entwuerfe behalten ihre Notiz, solange
-- sie Entwuerfe sind. `0154`, `0155` und `0156` bleiben unveraendert.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0157 Vorbedingung: catalog_admin_changes fehlt (0004).';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null then
    raise exception '0157 Vorbedingung: admin_merge_draft(…,jsonb) fehlt — 0156 '
      'ist hier nicht angewendet.';
  end if;
  if to_regprocedure('public.admin_merge_plan(text,text,text)') is null then
    raise exception '0157 Vorbedingung: admin_merge_plan fehlt (0156).';
  end if;

  -- DIE CONSTRAINT MUSS DIE SEIN, DIE WIR MEINEN. Steht dort eine fremde
  -- Fassung, wird sie nicht stillschweigend ersetzt.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0157 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%' then
    raise exception '0157 Vorbedingung: catalog_admin_changes_field_known hat '
      'einen unerwarteten Wortlaut (%). Erwartet ist die Fassung aus 0033. '
      'Erst klaeren, welche gilt.', v_def;
  end if;
  if v_def like '%merged_from%' then
    raise notice '0157: die Constraint kennt merged_from schon — dieser Lauf '
      'ersetzt sie durch dieselbe Fassung.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt drei Felder mehr
--
-- `drop` und `add` in EINER Transaktion: zwischen beiden gibt es keinen
-- Augenblick, in dem die Tabelle ohne Constraint dasteht, weil die
-- Einfuege-Huelle alles klammert. `add constraint` ohne `not valid` prueft
-- die bestehenden Zeilen mit — und das soll es: stuende dort heute ein
-- unbekanntes Feld, waere das ein Befund und kein Hindernis.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- Die sieben aus `0004`/`0007`/`0033`, unveraendert:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- und die drei, die seit `0152`/`0154`/`0155` wirklich geschrieben werden:
      'catalog_status',   -- der Journaltrigger, ersetzt in 0152
      'merged_from',      -- admin_merge_draft (0154, 0156)
      'discarded'         -- admin_discard_draft (0155)
    ));


-- ---------------------------------------------------------------------------
-- 3. Die Regel fuer die interne Notiz — eine Funktion, eine Stelle
--
-- `immutable`: sie liest nichts und schreibt nichts, sie rechnet nur. Damit
-- laesst sie sich in einer Pruefdatei aufrufen, ohne dass etwas geschieht.
-- ---------------------------------------------------------------------------
create or replace function public.merge_note(
  -- Die Notiz der Zielfigur, wie sie heute dasteht. NULL heisst „keine".
  p_target_note text,
  -- Die Notiz des Entwurfs.
  p_draft_note  text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rest text;
begin
  if btrim(coalesce(p_draft_note, '')) = '' then
    -- Nichts mitzubringen: die Zielnotiz bleibt, wie sie ist.
    return p_target_note;
  end if;

  /*
   * VERALTETE HINWEISE ENTFERNEN.
   *
   * Alle 105 Importnotizen enden auf „Kein Bild uebernommen; externe
   * Bildrechte ungeklaert." Beides ist ueberholt — CAT-05B hat 102 Bilder
   * uebernommen, und die Verwendung ist freigegeben. Entfernt wird der GANZE
   * SATZ, in dem der Hinweis steht, und nicht nur das Stichwort: ein
   * halbierter Satz waere schlechter als beides.
   *
   * Zwei Schreibweisen, weil die Notiz von Hand bearbeitet worden sein kann:
   * mit und ohne Umlaut.
   */
  v_rest := p_draft_note;
  v_rest := regexp_replace(v_rest, '[^.]*Bildrechte[[:space:]]+(ungeklaert|ungeklärt)[^.]*\.',
                           '', 'gi');
  v_rest := regexp_replace(v_rest, 'Kein Bild (uebernommen|übernommen)[^.]*\.', '', 'gi');
  -- Doppelte Leerzeichen und Reste wie „ ." aufraeumen.
  v_rest := btrim(regexp_replace(v_rest, '[[:space:]]+', ' ', 'g'));
  v_rest := btrim(regexp_replace(v_rest, '[[:space:]]*;[[:space:]]*$', '', 'g'));

  if v_rest = '' then
    -- Es stand nur der veraltete Hinweis drin.
    return p_target_note;
  end if;

  if btrim(coalesce(p_target_note, '')) = '' then
    return v_rest;
  end if;

  -- DOPPELTES NICHT DOPPELT.
  if position(v_rest in p_target_note) > 0 then
    return p_target_note;
  end if;

  return p_target_note || E'\n' || v_rest;
end;
$$;

comment on function public.merge_note(text, text) is
  'The one rule for the internal note when a draft is merged (0157, CAT-05I). The target keeps its note; whatever the draft contributes is appended once. Obsolete import hints are dropped - every one of the 105 import notes ended in "Kein Bild uebernommen; externe Bildrechte ungeklaert", and both halves are out of date since CAT-05B adopted 102 images and the operator released their use. Nothing is appended twice, an empty result appends nothing, and no note is generated for its own sake: that a merge happened is already in catalog_admin_changes. Pure and immutable - it reads nothing and writes nothing.';

revoke all on function public.merge_note(text, text) from public, anon;
grant execute on function public.merge_note(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Der Plan nennt die Notiz nicht mehr
--
-- Der Rumpf ist der aus `0156`, MINUS dem Abschnitt `admin_note`. Alles
-- andere steht Zeichen fuer Zeichen gleich; `src/lib/admin/merge-candidates.ts`
-- spiegelt es weiterhin, und `merge-candidates.test.ts` liest beide Seiten.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_plan(
  p_draft      text,
  p_target     text,
  p_image_path text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_plan     jsonb := '[]'::jsonb;
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft;
  if not found then
    raise exception '0157: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target;
  if not found then
    raise exception '0157: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0157: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  if btrim(coalesce(v_draft.name, '')) <> ''
     and v_draft.name is distinct from v_target.name then
    v_plan := v_plan || jsonb_build_object('field', 'name',
      'old', v_target.name, 'new', v_draft.name);
  end if;

  if btrim(coalesce(v_draft.display_name_override, '')) <> ''
     and v_draft.display_name_override is distinct from v_target.display_name_override then
    v_plan := v_plan || jsonb_build_object('field', 'display_name_override',
      'old', v_target.display_name_override, 'new', v_draft.display_name_override);
  end if;

  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_plan := v_plan || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
  end if;

  if v_draft.card_type is not null
     and v_draft.card_type is distinct from v_target.card_type
     and (v_draft.card_type <> c_generisch_card or v_target.card_type = c_generisch_card) then
    v_plan := v_plan || jsonb_build_object('field', 'card_type',
      'old', v_target.card_type, 'new', v_draft.card_type);
  end if;

  if v_draft.item_type is not null
     and v_draft.item_type is distinct from v_target.item_type
     and (v_draft.item_type <> c_generisch_item or v_target.item_type = c_generisch_item) then
    v_plan := v_plan || jsonb_build_object('field', 'item_type',
      'old', v_target.item_type, 'new', v_draft.item_type);
  end if;

  if v_draft.character_id is not null
     and v_draft.character_id is distinct from v_target.character_id then
    v_plan := v_plan || jsonb_build_object('field', 'character_id',
      'old', v_target.character_id::text, 'new', v_draft.character_id::text);
  end if;

  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0157: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_plan := v_plan || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
    end if;
  end if;

  /*
   * DIE NOTIZ STEHT HIER NICHT MEHR (0157).
   *
   * Sie war in `0156` der neunte Planeintrag und bekam eine Kaestchenzeile.
   * Jetzt ist sie keine auswaehlbare Aenderung mehr: die schreibende
   * Funktion verarbeitet sie IMMER, ueber `public.merge_note()`. Ein Plan,
   * der sie weiter nennte, boete der Oberflaeche wieder ein Kaestchen an —
   * und `admin_merge_draft` wuerde eine Auswahl mit `admin_note` jetzt
   * abweisen.
   */

  return v_plan;
end;
$$;

comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge (0156, narrowed in 0157): what admin_merge_draft WOULD write, as a jsonb array of {field, old, new}, in a fixed order. Eight business fields; admin_note is NOT among them since 0157 - the note is no longer selectable and is handled unconditionally by merge_note(). Read-only. This is the single place the merge rules live, so preview and application cannot diverge. Platform admins only.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Uebernahme: acht auswaehlbare Felder, und die Notiz laeuft immer
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text,
  p_selection  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_plan     jsonb;
  v_eintrag  jsonb;
  v_changed  jsonb   := '[]'::jsonb;
  v_refs     integer := 0;
  v_liste    text    := '';
  v_feld     text;
  v_bild     text    := null;
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  r          record;
  -- DIE ALLOWLIST: ACHT FELDER. `admin_note` ist seit `0157` NICHT mehr
  -- darunter — sie ist keine fachliche Katalogangabe, ueber die der Bediener
  -- Fall fuer Fall entscheidet, und wird unten IMMER verarbeitet.
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path'];
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0157: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0157: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0157: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  if v_draft.catalog_status <> 'draft' then
    raise exception '0157: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0157: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0157: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- DIE AUSWAHL PRÜFEN — vollständig, BEVOR irgendetwas geschrieben ist.
  -- ======================================================================
  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object' then
      raise exception '0157: die Auswahl muss ein Objekt sein, nicht %',
        jsonb_typeof(p_selection);
    end if;

    if p_selection = '{}'::jsonb then
      raise exception '0157: es ist kein Feld zur Übernahme ausgewählt — ohne '
        'Auswahl wird nichts zusammengeführt und nichts geloescht';
    end if;

    -- 1. ALLOWLIST. `admin_note` faellt hier jetzt durch, und das ist der
    --    Riegel gegen eine veraenderte Anfrage: das Entfernen des Kaestchens
    --    ist keine blosse Anzeigeaenderung.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      if not (v_feld = any (c_allow)) then
        raise exception '0157: % ist kein uebernehmbares Feld. Erlaubt sind: %',
          v_feld, array_to_string(c_allow, ', ');
      end if;
    end loop;

    -- 2. SERIE UND KATEGORIE SIND EIN FELD.
    if (p_selection ? 'series_code') <> (p_selection ? 'category_id') then
      raise exception '0157: series_code und category_id sind ein '
        'zusammengesetzter Fremdschluessel — beide auswaehlen oder keinen';
    end if;

    -- 3. DAS BILD: Auswahl und Pfad müssen zusammenpassen.
    if (p_selection ? 'image_override_path')
       and (p_image_path is null or btrim(p_image_path) = '') then
      raise exception '0157: das Bild ist ausgewaehlt, aber es kommt kein '
        'Bildpfad mit';
    end if;
    if not (p_selection ? 'image_override_path')
       and p_image_path is not null and btrim(p_image_path) <> '' then
      raise exception '0157: es kommt ein Bildpfad mit, aber das Bild ist '
        'nicht ausgewaehlt — das bisherige Bild bleibt stehen';
    end if;
  end if;

  -- ======================================================================
  -- DER PLAN. Eine Rechnung, und nicht die des Aufrufers.
  -- ======================================================================
  v_bild := case when p_selection is null then p_image_path
                 when p_selection ? 'image_override_path' then p_image_path
                 else null end;
  v_plan := public.admin_merge_plan(p_draft, p_target, v_bild);

  if p_selection is not null then
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      v_eintrag := null;
      select e.wert into v_eintrag
        from jsonb_array_elements(v_plan) as e(wert)
       where e.wert ->> 'field' = v_feld;
      if v_eintrag is null then
        raise exception '0157: % steht nicht (mehr) zur Uebernahme — die '
          'Vorschau ist veraltet. Bitte neu laden.', v_feld;
      end if;
      if (p_selection -> v_feld -> 'old') is distinct from (v_eintrag -> 'old')
         or (p_selection -> v_feld -> 'new') is distinct from (v_eintrag -> 'new') then
        raise exception '0157: % hat sich seit der Vorschau geaendert '
          '(angezeigt % → %, jetzt % → %). Es wird nichts uebernommen; '
          'bitte neu laden.', v_feld,
          coalesce(p_selection -> v_feld ->> 'old', '—'),
          coalesce(p_selection -> v_feld ->> 'new', '—'),
          coalesce(v_eintrag ->> 'old', '—'),
          coalesce(v_eintrag ->> 'new', '—');
      end if;
    end loop;
  end if;

  -- ======================================================================
  -- DIE ÜBERNAHME.
  -- ======================================================================
  for v_eintrag in select e.wert from jsonb_array_elements(v_plan) as e(wert) loop
    v_feld := v_eintrag ->> 'field';
    if p_selection is not null and not (p_selection ? v_feld) then
      continue;
    end if;

    if v_feld = 'name' then
      update public.skylanders set name = v_draft.name where sky_id = p_target;
    elsif v_feld = 'display_name_override' then
      update public.skylanders set display_name_override = v_draft.display_name_override
       where sky_id = p_target;
    elsif v_feld = 'series_code' then
      update public.skylanders
         set series_code = v_draft.series_code, category_id = v_draft.category_id
       where sky_id = p_target;
    elsif v_feld = 'category_id' then
      null;
    elsif v_feld = 'card_type' then
      update public.skylanders set card_type = v_draft.card_type where sky_id = p_target;
    elsif v_feld = 'item_type' then
      update public.skylanders set item_type = v_draft.item_type where sky_id = p_target;
    elsif v_feld = 'character_id' then
      update public.skylanders set character_id = v_draft.character_id where sky_id = p_target;
    elsif v_feld = 'image_override_path' then
      update public.skylanders set image_override_path = v_eintrag ->> 'new'
       where sky_id = p_target;
    else
      raise exception '0157: unbekanntes Planfeld % — das ist ein Fehler in '
        '0157 und nicht in der Eingabe', v_feld;
    end if;

    v_changed := v_changed || v_eintrag;
  end loop;

  -- ======================================================================
  -- DIE INTERNE NOTIZ, IMMER UND OHNE KAESTCHEN (0157).
  --
  -- `merge_note()` ist die ganze Regel: Zielnotiz bleibt, veraltete
  -- Importhinweise fallen weg, der Rest wird einmal angehaengt, Leeres
  -- bleibt leer. Sie zaehlt NICHT als Aenderung in `v_changed` — der
  -- Knopf in der Oberflaeche zaehlt nur fachliche Katalogaenderungen.
  -- ======================================================================
  select e.admin_note into v_note from public.catalog_editorial e where e.sky_id = p_draft;
  select e.admin_note into v_zielnote from public.catalog_editorial e where e.sky_id = p_target;
  v_neuenote := public.merge_note(v_zielnote, v_note);
  if v_neuenote is distinct from v_zielnote and btrim(coalesce(v_neuenote, '')) <> '' then
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
      values (p_target, v_neuenote, now())
      on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                         updated_at = now();
  end if;

  -- ---- Der Vorgang ins Journal. `merged_from` ist seit Teil 1 erlaubt.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_target, 'merged_from', p_draft,
          jsonb_array_length(v_changed)::text || ' Feld(er)', (select auth.uid()));

  -- ---- Und erst jetzt der Entwurf.
  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'draft', p_draft, 'target', p_target,
    'changed', v_changed,
    'note_changed', (v_neuenote is distinct from v_zielnote),
    'selected', case when p_selection is null then null
                     else to_jsonb(array(select k.feld
                                           from jsonb_object_keys(p_selection) as k(feld))) end,
    'draft_deleted', true);
end;
$$;

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, narrowed in 0157). Eight selectable business fields; admin_note is NOT one of them - the internal note is always processed through merge_note(), which keeps the target note, drops obsolete import hints and appends the rest once. p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch. Values written come from the draft row, never from the call. NULL selection means "everything the plan yields". The TARGET keeps its SKY-ID, slug, status, visibility, price and every reference hanging off it. One transaction - the journal row and the merge commit together or not at all.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0157 Nachbedingung: die Constraint ist verschwunden';
  end if;
  if v_def not like '%merged_from%' or v_def not like '%discarded%'
     or v_def not like '%catalog_status%' then
    raise exception '0157 Nachbedingung: die Constraint kennt die drei neuen '
      'Felder nicht: %', v_def;
  end if;
  if v_def not like '%created%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' then
    raise exception '0157 Nachbedingung: ein alter Wert ist verloren gegangen: %', v_def;
  end if;

  if to_regprocedure('public.merge_note(text,text)') is null then
    raise exception '0157 Nachbedingung: merge_note fehlt';
  end if;
  -- DIE NOTIZ IST KEIN AUSWAEHLBARES FELD MEHR.
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
      like '%''admin_note''%' then
    raise exception '0157 Nachbedingung: admin_note steht noch in der Allowlist';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
      like '%''admin_note''%' then
    raise exception '0157 Nachbedingung: der Plan nennt admin_note noch';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.merge_note(text,text)'),
                   to_regprocedure('public.admin_merge_plan(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0157 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0157: das Journal kennt catalog_status, merged_from und '
    'discarded; merge_note steht; admin_note ist kein auswaehlbares Feld mehr.';
end
$nach$;
