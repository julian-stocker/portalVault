-- ===========================================================================
-- STAGING — EIN LAUF FUER 0156
--            (die Zusammenfuehrung uebernimmt nur die ausgewaehlten Felder)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- *** SIE LEGT FUNKTIONEN AN UND SCHREIBT KEINE ZEILE ***
--
-- `admin_merge_plan()` entsteht, `admin_merge_draft()` bekommt eine vierte
-- Fassung mit Feldauswahl, und die Dreiparameterfassung aus `0154` wird zur
-- Weiterleitung. Zusammengefuehrt wird dadurch nichts — das geschieht erst,
-- wenn jemand im Adminbereich einen Entwurf auswaehlt und bestaetigt. Der
-- Katalog sieht nach diesem Lauf aus wie vorher.
--
-- *** SIE SETZT 0154 VORAUS ***
--
-- `0156` ersetzt dessen Dreiparameterfassung und benutzt dessen
-- Referenzzaehlung. Auf einer Datenbank ohne `0154` waere das keine
-- Erweiterung, sondern eine halbe Einfuehrung — Waechter A2 faengt das ab.
--
-- *** 0154 UND 0155 WERDEN NICHT VERAENDERT ***
--
-- Beide sind angewendet und bleiben, wie sie sind. `0156` legt daneben und
-- ersetzt nur EINEN Funktionsrumpf — den der Dreiparameterfassung, und zwar
-- durch eine Weiterleitung auf die neue Fassung, damit es die
-- Uebernahmelogik genau einmal gibt.
--
-- ERWARTET: die NOTICE-Zeile der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null
     or to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception 'ABBRUCH A2: 0154 ist hier nicht angewendet. 0156 ersetzt '
      'dessen Dreiparameterfassung und benutzt dessen Referenzzaehlung.';
  end if;

  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception 'ABBRUCH A3: skylanders.catalog_status fehlt (0152).';
  end if;

  if to_regclass('public.catalog_editorial') is null then
    raise exception 'ABBRUCH A4: catalog_editorial fehlt (0041) — die Notiz '
      'wird dort angehaengt.';
  end if;

  /*
   * A5: GENAU EINE FASSUNG. `create or replace` trifft eine Signatur. Stuenden
   * heute schon zwei Fassungen von `admin_merge_draft`, ersetzte dieser Lauf
   * nur eine davon, und die andere liefe mit der alten Logik weiter — eine
   * zweite Uebernahmeregel, von der niemand weiss.
   */
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_merge_draft') <> 1 then
    raise exception 'ABBRUCH A5: es stehen % Fassungen von admin_merge_draft. '
      'Erwartet ist genau EINE (die aus 0154). Erst klaeren, welche gilt.',
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_merge_draft');
  end if;

  if to_regprocedure('public.admin_merge_plan(text,text,text)') is not null then
    raise notice 'A6: admin_merge_plan steht schon — dieser Lauf ersetzt sie '
      'durch dieselbe Fassung.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0156_merge_selected_fields.sql
-- ---------------------------------------------------------------------------
-- 0156 — die Zusammenführung übernimmt nur die ausgewählten Felder
--
-- CAT-05F. `0154` hat die Zusammenführung gebracht, mit einer einzigen Regel:
-- was der Entwurf hat, geht über. Das ist richtig und meistens auch
-- gewünscht — aber nicht immer. Der häufigste Fall ist das Bild: der Name aus
-- dem Import ist genauer, das bestehende Foto ist besser. Bisher ging beides
-- oder keines.
--
-- *** EINE ÄNDERUNGSTABELLE MIT KÄSTCHEN, UND SIE WIRKT WIRKLICH ***
--
-- Der Dialog zeigt jede anstehende Änderung als eigene Zeile und lässt sie
-- einzeln abwählen. Diese Migration ist die Serverseite davon. Ein Kästchen,
-- das nur die Anzeige ändert, wäre eine Behauptung — hier entscheidet die
-- Auswahl, was wirklich geschrieben wird.
--
-- *** EINE REGEL, EINE STELLE: `admin_merge_plan()` ***
--
-- Vorschau und Übernahme dürfen nicht zwei Rechnungen sein. `0154` trug die
-- Regel im Rumpf der schreibenden Funktion; die Oberfläche spiegelte sie in
-- TypeScript. Zwei Fassungen derselben Regel, und die Oberfläche hätte
-- irgendwann etwas anderes versprochen als geschieht.
--
-- Jetzt rechnet `admin_merge_plan()` den Änderungsplan EINMAL, rein lesend.
-- Die schreibende Funktion ruft genau sie auf und wendet an, was ausgewählt
-- ist. `src/lib/admin/merge-candidates.ts` spiegelt sie weiterhin für die
-- Anzeige — aber der Server glaubt dieser Spiegelung nicht:
--
-- *** DIE WERTE DES AUFRUFERS SIND EINE BEHAUPTUNG, KEINE ANWEISUNG ***
--
-- `p_selection` nennt je Feld den Wert, den der Bediener in der Tabelle
-- GESEHEN hat (`old`/`new`). Der Server vergleicht ihn mit dem, was der Plan
-- JETZT rechnet, und bricht bei jeder Abweichung ab. Geschrieben wird
-- ausschliesslich der Wert aus der Zeile des Entwurfs — niemals der aus dem
-- Aufruf. Hat sich zwischen Anzeige und Klick etwas geändert, entsteht
-- deshalb kein stiller Fremdwert, sondern ein Abbruch mit Feldnamen.
--
-- *** DIE ALLOWLIST STEHT HIER, NICHT IM BROWSER ***
--
-- Neun Felder, namentlich. Alles andere wird abgewiesen, und zwar bevor
-- irgendetwas geschrieben ist: `sky_id`, `slug`, `catalog_status`,
-- `catalog_visible`, `market_price`, `price_updated_at`, `image_file`,
-- `source`, `is_active` — und alles, was an der SKY-ID hängt (Sammlungen,
-- Favoriten, Lager, Angebote, Bestellungen). Diese Funktion schreibt
-- ausschliesslich benannte Spalten; es gibt kein dynamisches SQL.
--
-- *** SERIE UND KATEGORIE SIND EIN FELD ***
--
-- `(series_code, category_id)` ist EIN zusammengesetzter Fremdschlüssel. Die
-- Auswahl muss beide nennen oder keinen; eine halbe Auswahl ist ein Abbruch,
-- kein stilles Zurechtbiegen. Die Oberfläche zeigt sie deshalb als eine
-- Tabellenzeile.
--
-- *** ABWÄRTSKOMPATIBEL ***
--
-- `admin_merge_draft(text, text, text)` aus `0154` bleibt und tut genau
-- dasselbe wie vorher — sie ruft jetzt nur die neue Fassung mit
-- `p_selection = NULL` auf, und NULL heisst „alles, was der Plan hergibt".
-- Es gibt dadurch EINE Übernahmelogik und nicht zwei. Die Oberfläche benutzt
-- sie nicht mehr; eine ältere Bereitstellung, die noch läuft, funktioniert
-- unverändert weiter.
--
-- *** WAS DIESE MIGRATION NICHT ANFASST ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie,
-- kein Index. `admin_merge_references(text)` aus `0154` und
-- `admin_discard_draft(text)` aus `0155` bleiben unverändert — die
-- Referenzprüfung soll es genau einmal geben.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0156 Vorbedingung: admin_merge_draft(text,text,text) fehlt '
      '— 0154 ist hier nicht angewendet.';
  end if;
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0156 Vorbedingung: admin_merge_references(text) fehlt (0154).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception '0156 Vorbedingung: skylanders.catalog_status fehlt (0152).';
  end if;
  if to_regclass('public.catalog_editorial') is null then
    raise exception '0156 Vorbedingung: catalog_editorial fehlt (0041).';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Änderungsplan — rein lesend, und die EINZIGE Stelle, an der die
--    Übernahmeregeln stehen.
--
-- Rückgabe: ein jsonb-Array in fester Reihenfolge, je Eintrag
--   { "field": …, "old": …, "new": … }
-- `old` und `new` sind Text oder jsonb-null. Die Reihenfolge ist Teil der
-- Zusage, damit die Tabelle in der Oberfläche stabil bleibt.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_plan(
  p_draft      text,
  p_target     text,
  -- Der Pfad, unter dem der Aufrufer das Bild bei der ZIELFIGUR anlegen
  -- WIRD. NULL heisst „das Bild bleibt, wie es ist".
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
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  -- DIE GENERISCHEN VORGABEWERTE. Ein Wert, der nur dasteht, weil es einen
  -- Vorgabewert gibt, ist keine Angabe — er darf eine echte nicht ersetzen.
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_draft from public.skylanders where sky_id = p_draft;
  if not found then
    raise exception '0156: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target;
  if not found then
    raise exception '0156: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0156: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
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

  -- SERIE UND KATEGORIE IMMER GEMEINSAM: ein zusammengesetzter Fremdschlüssel
  -- lässt sich nicht halb setzen.
  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_plan := v_plan || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
  end if;

  -- EIN PLATZHALTER ERSETZT KEINE ANGABE.
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

  -- DAS BILD. Der Pfad muss der ZIELFIGUR gehören — sonst zeigte die
  -- bestehende Karte in den Ordner eines Entwurfs, den der Lauf gleich
  -- löscht. Der Plan weist das schon in der Vorschau ab und nicht erst beim
  -- Schreiben.
  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0156: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_plan := v_plan || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
    end if;
  end if;

  -- DIE NOTIZ WIRD ANGEHÄNGT, NICHT ERSETZT.
  select e.admin_note into v_note from public.catalog_editorial e where e.sky_id = p_draft;
  if btrim(coalesce(v_note, '')) <> '' then
    select e.admin_note into v_zielnote from public.catalog_editorial e where e.sky_id = p_target;
    v_neuenote := case
      when btrim(coalesce(v_zielnote, '')) = '' then v_note
      when position(v_note in v_zielnote) > 0   then v_zielnote
      else v_zielnote || E'\n' || v_note
    end;
    if v_neuenote is distinct from v_zielnote then
      v_plan := v_plan || jsonb_build_object('field', 'admin_note',
        'old', v_zielnote, 'new', v_neuenote);
    end if;
  end if;

  return v_plan;
end;
$$;

comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge (0156, CAT-05F): what admin_merge_draft WOULD write, as a jsonb array of {field, old, new}, in a fixed order. Read-only. This is the single place the merge rules live - the writing function calls it, so preview and application cannot diverge. Platform admins only.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Die Übernahme — nur die ausgewählten Felder
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text,
  -- DIE AUSWAHL. Ein Objekt, dessen Schlüssel die zu übernehmenden Felder
  -- sind, und dessen Werte nennen, was der Bediener GESEHEN hat:
  --   {"name": {"old": "Pirate Ship", "new": "Pirate Seas"}, …}
  -- NULL heisst „alles, was der Plan hergibt" — das ist das Verhalten von
  -- `0154` und der Weg der alten Dreiparameterfassung.
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
  r          record;
  -- DIE ALLOWLIST. Neun Felder, namentlich. Sie steht hier und nicht im
  -- Browser, weil ein Aufruf nicht aus dem Browser kommen muss.
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path',
    'admin_note'];
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- ---- Die beiden Zeilen, gesperrt, damit niemand dazwischenfunkt.
  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0156: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0156: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0156: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  -- ---- NUR EIN ENTWURF DARF VERSCHWINDEN.
  if v_draft.catalog_status <> 'draft' then
    raise exception '0156: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0156: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  -- ---- Fremde Referenzen auf den Entwurf blockieren.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0156: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- DIE AUSWAHL PRÜFEN — vollständig, BEVOR irgendetwas geschrieben ist.
  -- ======================================================================
  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object' then
      raise exception '0156: die Auswahl muss ein Objekt sein, nicht %',
        jsonb_typeof(p_selection);
    end if;

    -- Eine leere Auswahl ist kein Grund, einen Entwurf zu löschen.
    if p_selection = '{}'::jsonb then
      raise exception '0156: es ist kein Feld zur Übernahme ausgewählt — ohne '
        'Auswahl wird nichts zusammengeführt und nichts geloescht';
    end if;

    -- 1. ALLOWLIST. Jeder Schlüssel muss ein erlaubtes Feld sein.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      if not (v_feld = any (c_allow)) then
        raise exception '0156: % ist kein uebernehmbares Feld. Erlaubt sind: %',
          v_feld, array_to_string(c_allow, ', ');
      end if;
    end loop;

    -- 2. SERIE UND KATEGORIE SIND EIN FELD.
    if (p_selection ? 'series_code') <> (p_selection ? 'category_id') then
      raise exception '0156: series_code und category_id sind ein '
        'zusammengesetzter Fremdschluessel — beide auswaehlen oder keinen';
    end if;

    -- 3. DAS BILD: Auswahl und Pfad müssen zusammenpassen. Ohne ausgewähltes
    --    Bild darf kein Pfad hereinkommen, und umgekehrt.
    if (p_selection ? 'image_override_path')
       and (p_image_path is null or btrim(p_image_path) = '') then
      raise exception '0156: das Bild ist ausgewaehlt, aber es kommt kein '
        'Bildpfad mit';
    end if;
    if not (p_selection ? 'image_override_path')
       and p_image_path is not null and btrim(p_image_path) <> '' then
      raise exception '0156: es kommt ein Bildpfad mit, aber das Bild ist '
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
    -- 4. VERALTETE VORSCHAU. Jedes ausgewählte Feld muss im Plan stehen, und
    --    zwar mit genau den Werten, die der Bediener gesehen hat.
    for v_feld in select k.feld from jsonb_object_keys(p_selection) as k(feld) loop
      v_eintrag := null;
      select e.wert into v_eintrag
        from jsonb_array_elements(v_plan) as e(wert)
       where e.wert ->> 'field' = v_feld;
      if v_eintrag is null then
        raise exception '0156: % steht nicht (mehr) zur Uebernahme — die '
          'Vorschau ist veraltet. Bitte neu laden.', v_feld;
      end if;
      -- DIE WERTE MUESSEN ZEICHENGLEICH SEIN. Der Aufrufer schickt beide
      -- Schluessel immer mit, auch als `null`; ein fehlender Schluessel ist
      -- SQL-NULL und damit verschieden von jsonb-null — also auch ein
      -- Abbruch, und das ist richtig.
      if (p_selection -> v_feld -> 'old') is distinct from (v_eintrag -> 'old')
         or (p_selection -> v_feld -> 'new') is distinct from (v_eintrag -> 'new') then
        raise exception '0156: % hat sich seit der Vorschau geaendert '
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
  -- DIE ÜBERNAHME. Der Plan sagt OB, die Zeile des Entwurfs sagt WAS — der
  -- Aufruf sagt beides nicht. Nur `admin_note` und `image_override_path`
  -- nehmen ihren Wert aus dem Plan, weil er dort erst entsteht (angehängte
  -- Notiz, umgezogener Pfad).
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
      -- Mit `series_code` schon geschrieben. Die Zeile steht im Plan, damit
      -- die Tabelle beide Werte zeigen kann.
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
    elsif v_feld = 'admin_note' then
      insert into public.catalog_editorial (sky_id, admin_note, updated_at)
        values (p_target, v_eintrag ->> 'new', now())
        on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                           updated_at = now();
    else
      -- Unerreichbar: der Plan erzeugt nur die neun Felder der Allowlist. Ein
      -- zehntes waere ein Fehler in dieser Datei und kein Eingabefehler.
      raise exception '0156: unbekanntes Planfeld % — das ist ein Fehler in '
        '0156 und nicht in der Eingabe', v_feld;
    end if;

    v_changed := v_changed || v_eintrag;
  end loop;

  -- ---- Der Vorgang ins Journal, zusätzlich zu den Feldzeilen des Triggers
  --      aus `0152`.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_target, 'merged_from', p_draft,
          jsonb_array_length(v_changed)::text || ' Feld(er)', (select auth.uid()));

  -- ---- Und erst jetzt der Entwurf. Er verschwindet auch dann, wenn nur ein
  --      Feld ausgewählt war: die Zusammenführung ist die Entscheidung, dass
  --      diese beiden Zeilen dasselbe Objekt beschreiben.
  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'draft', p_draft, 'target', p_target,
    'changed', v_changed,
    'selected', case when p_selection is null then null
                     else to_jsonb(array(select k.feld
                                           from jsonb_object_keys(p_selection) as k(feld))) end,
    'draft_deleted', true);
end;
$$;

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, CAT-05F). p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch, so a stale preview can never apply a different value. Values written come from the draft row, never from the call. Server-side allowlist of nine business fields; series_code and category_id must be selected together; an image path is accepted only when the image is selected. NULL selection means "everything the plan yields" (the 0154 behaviour). The TARGET keeps its SKY-ID, slug, status, visibility, price, imported image and every reference hanging off it. One transaction.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Die Dreiparameterfassung aus `0154` bleibt — als Weiterleitung
--
-- ABWÄRTSKOMPATIBEL UND TROTZDEM EINE LOGIK. Sie tut genau dasselbe wie
-- vorher (alles übernehmen, was der Plan hergibt), aber sie rechnet es nicht
-- mehr selbst. Eine zweite Fassung derselben Regel wäre bei einer Löschung
-- die teuerste Sorte Fehler.
--
-- Die Signatur ist unverändert, Rechte und Kommentar bleiben; `0154` muss
-- dafür nicht angefasst werden.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  p_image_path text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_merge_draft(p_draft, p_target, p_image_path, null::jsonb);
$$;

comment on function public.admin_merge_draft(text, text, text) is
  'Merges an imported draft into an existing catalogue row, taking over every field the draft carries (0154, kept for backward compatibility by 0156). Delegates to admin_merge_draft(text, text, text, jsonb) with a NULL selection, so there is exactly one merge implementation. New callers pass a selection instead. Platform admins only.';

revoke all on function public.admin_merge_draft(text, text, text) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_plan(text,text,text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_plan fehlt';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null then
    raise exception '0156 Nachbedingung: admin_merge_draft(…,jsonb) fehlt';
  end if;
  -- DIE ALTE FASSUNG MUSS STEHEN BLEIBEN. Sie ist die Abwärtskompatibilität.
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_draft(text,text,text) ist '
      'verschwunden — die Abwaertskompatibilitaet ist dahin';
  end if;
  -- UND 0154/0155 BLEIBEN UNBERÜHRT.
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0156 Nachbedingung: admin_merge_references fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_merge_plan(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0156 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0156: admin_merge_plan und admin_merge_draft(…,jsonb) stehen, '
    'die Dreiparameterfassung leitet weiter, nur fuer authenticated.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0156_merge_selected_fields.sql

commit;
