-- ---------------------------------------------------------------------------
-- 0154 — einen importierten Entwurf mit einer bestehenden Figur zusammenführen
--
-- CAT-05. Der einmalige Excel-Import hat 105 Entwürfe angelegt. Einige davon
-- beschreiben Objekte, die der Katalog schon führt — unter einem anderen oder
-- historisch ungenaueren Namen. Für diese Fälle braucht der Adminbereich eine
-- Zusammenführung: der BESTEHENDE Eintrag bleibt, er übernimmt ausgewählte
-- Felder des Entwurfs, und der Entwurf verschwindet.
--
-- *** DIE BESTEHENDE SKY-ID BLEIBT, UND ZWAR IMMER ***
--
-- Daran hängen Sammlungen, Favoriten, Lager, Angebote, Bestellungen und das
-- Orderbuch. Eine Zusammenführung, die eine SKY-ID verschiebt, ist kein
-- Zusammenführen, sondern Datenverlust. Diese Funktion ändert `sky_id` nicht
-- und könnte es auch nicht: sie schreibt nur benannte Spalten.
--
-- *** DIE ÜBERNAHMEREGEL: WAS DER ENTWURF HAT, GEWINNT ***
--
-- Kein Feld-für-Feld-Auswählen. Jedes fachliche Feld, das der Entwurf
-- wirklich trägt, geht auf die bestehende Figur über; was im Entwurf leer
-- ist, lässt den bisherigen Wert stehen. `NULL` heißt „keine Information"
-- und nicht „leeren".
--
-- ZWEI AUSNAHMEN, UND BEIDE SIND EINE REGEL ÜBER PLATZHALTER:
--
--   `card_type` und `item_type` haben einen GENERISCHEN Vorgabewert
--   (`standard`, `figure`). Die CAT-03-Aufbereitung hat ihn bei 51 von 105
--   Entwürfen gesetzt, weil sich die Edition nicht belegen liess — das ist
--   ein Platzhalter und keine Angabe. **Ein unspezifischer Wert überschreibt
--   deshalb nie einen spezifischen.** Umgekehrt schon: wer `chase` mitbringt,
--   darf ein `standard` ersetzen.
--
--   `admin_note` wird ANGEHÄNGT statt ersetzt. Die Notiz der bestehenden
--   Figur ist Arbeit, die jemand geleistet hat; die Herkunftszeile des
--   Imports ist eine zweite Information und keine bessere.
--
-- *** WAS DIE BESTEHENDE FIGUR IN JEDEM FALL BEHÄLT ***
--
-- `sky_id` · `slug` · `catalog_status` · `catalog_visible` · `market_price`
-- und `price_updated_at` · `image_file` · `source` · und alles, was an der
-- SKY-ID hängt: Lager, Angebote, Sammlungen, Favoriten, Bestellungen. Diese
-- Funktion nennt sie nicht einmal.
--
-- *** DAS BILD LIEGT DANACH UNTER DER SKY-ID DER ZIELFIGUR ***
--
-- Der Aufrufer kopiert das Objekt vorher dorthin und reicht den Pfad als
-- dritten Parameter herein; die Funktion prüft, dass er wirklich der
-- Zielfigur gehört. Sie selbst fasst den Speicher nicht an — SQL erreicht
-- ihn nicht, und ein Vorgang über zwei Systeme wäre keine Transaktion mehr.
--
-- *** WELCHE TABELLEN AUF EINE SKY-ID ZEIGEN, WIRD HERGELEITET ***
--
-- Vierzehn Fremdschlüssel verweisen heute auf `skylanders`. Eine getippte
-- Liste davon wäre beim fünfzehnten falsch, ohne dass es auffiele — genau der
-- Fehlgrund, an dem die Sicherungsmanifeste zweimal vorbeigelaufen sind
-- (ADR-0134). `admin_merge_references()` liest sie deshalb aus `pg_catalog`.
--
-- *** EIN ENTWURF MIT REFERENZEN WIRD NICHT GELÖSCHT ***
--
-- Hat jemand ihn in seine Sammlung gelegt, auf die Wunschliste gesetzt oder
-- eingelagert, bricht die Zusammenführung ab. Die Entscheidung, was dann
-- geschieht, gehört einem Menschen.
--
-- WAS SIE NICHT ANFASST: `catalog_status` und `catalog_visible` der Zielfigur
-- (eine Zusammenführung veröffentlicht nichts und versteckt nichts), `slug`
-- (reine Navigation, ADR-0011 — eine geänderte Adresse wäre ein eigener
-- Vorgang), `market_price`, `price_updated_at`, `image_file` (gehören dem
-- Import), `source` und natürlich `sky_id`.
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER — die setzt die Einfüge-Hülle, wie bei
-- `0150`–`0153`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Wer zeigt auf diese SKY-ID?
--
-- `catalog_editorial` zählt NICHT mit: diese Zeile gehört dem Entwurf selbst
-- (seine interne Notiz) und verschwindet mit ihm. Alles andere ist eine
-- fremde Referenz und blockiert.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_references(p_sky_id text)
returns table (tabelle text, spalte text, zeilen bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  for r in
    select c.conrelid::regclass::text as tab,
           a.attname::text            as sp,
           array_length(c.conkey, 1)  as spalten
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.catalog_editorial'::regclass
     order by 1
  loop
    -- EIN MEHRSPALTIGER FREMDSCHLUESSEL WUERDE HIER FALSCH GEZAEHLT. Heute
    -- gibt es keinen; käme einer, soll es auffallen und nicht durchrutschen.
    if r.spalten <> 1 then
      raise exception '0154: % hat einen mehrspaltigen Fremdschluessel auf '
        'skylanders — diese Funktion kann ihn nicht zaehlen', r.tab;
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
  'Every row in any table that references this SKY-ID, derived from pg_catalog rather than a typed list (0154). catalog_editorial is excluded: that row belongs to the figure itself. Platform admins only; reads nothing else.';

revoke all on function public.admin_merge_references(text) from public, anon;
grant execute on function public.admin_merge_references(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Die Zusammenführung selbst
--
-- Ohne Feldliste: was der Entwurf hat, geht über; was er nicht hat, lässt
-- den bisherigen Wert stehen. Der Rückgabewert nennt jede Änderung, damit
-- die Oberfläche dieselbe Vorschau zeigen kann, die hier wirklich geschieht.
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_draft(
  p_draft      text,
  p_target     text,
  -- Der Bildpfad, den der Aufrufer VORHER im Speicher angelegt hat. NULL
  -- heisst „kein Bild umhaengen"; dann bleibt das Bild der Zielfigur stehen.
  p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft    public.skylanders%rowtype;
  v_target   public.skylanders%rowtype;
  v_note     text;
  v_zielnote text;
  v_neuenote text;
  v_refs     integer := 0;
  v_liste    text    := '';
  v_changed  jsonb   := '[]'::jsonb;
  r          record;
  -- DIE GENERISCHEN VORGABEWERTE. Ein Wert, der nur dasteht, weil es einen
  -- Vorgabewert gibt, ist keine Angabe — er darf eine echte nicht ersetzen.
  c_generisch_card text := 'standard';
  c_generisch_item text := 'figure';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- ---- Die beiden Zeilen, gesperrt, damit niemand dazwischenfunkt.
  select * into v_draft from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0154: Entwurf % gibt es nicht', p_draft;
  end if;
  select * into v_target from public.skylanders where sky_id = p_target for update;
  if not found then
    raise exception '0154: Zielfigur % gibt es nicht', p_target;
  end if;
  if p_draft = p_target then
    raise exception '0154: Entwurf und Ziel sind dieselbe Zeile (%)', p_draft;
  end if;

  -- ---- NUR EIN ENTWURF DARF VERSCHWINDEN, und nur ein importierter.
  if v_draft.catalog_status <> 'draft' then
    raise exception '0154: % ist kein Entwurf (Status %) — nur Entwürfe werden '
      'zusammengeführt', p_draft, v_draft.catalog_status;
  end if;
  if v_target.catalog_status = 'draft' then
    raise exception '0154: Ziel % ist selbst ein Entwurf — das wäre kein '
      'Zusammenführen, sondern ein Tausch', p_target;
  end if;

  -- ---- Fremde Referenzen auf den Entwurf blockieren.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0154: auf den Entwurf % zeigen noch Daten: % — er wird '
      'nicht geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ======================================================================
  -- Die Übernahme. Jede Zeile hier folgt derselben Form: hat der Entwurf
  -- etwas, und ist es etwas anderes, dann geht es über.
  -- ======================================================================

  if btrim(coalesce(v_draft.name, '')) <> ''
     and v_draft.name is distinct from v_target.name then
    v_changed := v_changed || jsonb_build_object('field', 'name',
      'old', v_target.name, 'new', v_draft.name);
    update public.skylanders set name = v_draft.name where sky_id = p_target;
  end if;

  if btrim(coalesce(v_draft.display_name_override, '')) <> ''
     and v_draft.display_name_override is distinct from v_target.display_name_override then
    v_changed := v_changed || jsonb_build_object('field', 'display_name_override',
      'old', v_target.display_name_override, 'new', v_draft.display_name_override);
    update public.skylanders set display_name_override = v_draft.display_name_override
     where sky_id = p_target;
  end if;

  -- SERIE UND KATEGORIE IMMER GEMEINSAM: `(series_code, category_id)` ist EIN
  -- zusammengesetzter Fremdschlüssel. Nur eine Hälfte zu setzen verletzt ihn
  -- oder legt die Figur in eine Kategorie einer anderen Serie.
  if v_draft.series_code is not null and v_draft.category_id is not null
     and (v_draft.series_code is distinct from v_target.series_code
          or v_draft.category_id is distinct from v_target.category_id) then
    v_changed := v_changed || jsonb_build_object('field', 'series_code',
      'old', v_target.series_code, 'new', v_draft.series_code)
      || jsonb_build_object('field', 'category_id',
      'old', v_target.category_id::text, 'new', v_draft.category_id::text);
    update public.skylanders
       set series_code = v_draft.series_code, category_id = v_draft.category_id
     where sky_id = p_target;
  end if;

  -- EIN PLATZHALTER ERSETZT KEINE ANGABE. `standard` ist der Vorgabewert von
  -- `card_type`; bei 51 der 105 Entwürfe steht er nur dort, weil sich die
  -- Edition nicht belegen liess. Er geht deshalb NUR über, wenn das Ziel
  -- selbst nichts Spezifischeres trägt.
  if v_draft.card_type is not null
     and v_draft.card_type is distinct from v_target.card_type
     and (v_draft.card_type <> c_generisch_card or v_target.card_type = c_generisch_card) then
    v_changed := v_changed || jsonb_build_object('field', 'card_type',
      'old', v_target.card_type, 'new', v_draft.card_type);
    update public.skylanders set card_type = v_draft.card_type where sky_id = p_target;
  end if;

  if v_draft.item_type is not null
     and v_draft.item_type is distinct from v_target.item_type
     and (v_draft.item_type <> c_generisch_item or v_target.item_type = c_generisch_item) then
    v_changed := v_changed || jsonb_build_object('field', 'item_type',
      'old', v_target.item_type, 'new', v_draft.item_type);
    update public.skylanders set item_type = v_draft.item_type where sky_id = p_target;
  end if;

  if v_draft.character_id is not null
     and v_draft.character_id is distinct from v_target.character_id then
    v_changed := v_changed || jsonb_build_object('field', 'character_id',
      'old', v_target.character_id::text, 'new', v_draft.character_id::text);
    update public.skylanders set character_id = v_draft.character_id where sky_id = p_target;
  end if;

  -- ======================================================================
  -- DAS BILD, und das ist die einzige Stelle, an der zwei Systeme beteiligt
  -- sind.
  --
  -- Der Aufrufer legt das Objekt VORHER unter der SKY-ID der ZIELFIGUR an —
  -- inhaltsadressiert, also derselbe Hash und damit eine folgenlose
  -- Wiederholung — und reicht den fertigen Pfad hier herein. Diese Funktion
  -- prueft ihn und setzt ihn; sie kopiert nichts und loescht nichts.
  --
  -- WARUM DIESE REIHENFOLGE. PostgreSQL und der Speicher teilen keine
  -- Transaktion. Kopieren-dann-schreiben kann nur zwei Zustaende
  -- hinterlassen: alles fertig, oder ein verwaistes Objekt ohne
  -- Datenbankaenderung. Der zweite kostet ein paar Kilobyte. Umgekehrt —
  -- erst schreiben, dann kopieren — koennte eine Figur auf ein Objekt
  -- zeigen, das es nicht gibt, und das ist ein fehlendes Bild.
  --
  -- DER PFAD MUSS DER ZIELFIGUR GEHOEREN. Sonst zeigte die bestehende Karte
  -- in den Ordner eines Entwurfs, den dieser Lauf gleich loescht — technisch
  -- erreichbar, aber eine Spur ins Nichts.
  -- ======================================================================
  if p_image_path is not null and btrim(p_image_path) <> '' then
    if p_image_path !~ ('^' || p_target || '/[0-9a-f]{16}\.(webp|png|jpg)$') then
      raise exception '0154: der Bildpfad % gehoert nicht zu % — er muss die '
        'SKY-ID der Zielfigur tragen', p_image_path, p_target;
    end if;
    if p_image_path is distinct from v_target.image_override_path then
      v_changed := v_changed || jsonb_build_object('field', 'image_override_path',
        'old', v_target.image_override_path, 'new', p_image_path);
      update public.skylanders set image_override_path = p_image_path
       where sky_id = p_target;
    end if;
  end if;

  -- DIE NOTIZ WIRD ANGEHÄNGT, NICHT ERSETZT. Was an der bestehenden Figur
  -- steht, hat jemand geschrieben; die Herkunftszeile des Imports ist eine
  -- zweite Information und keine bessere.
  select admin_note into v_note from public.catalog_editorial where sky_id = p_draft;
  if btrim(coalesce(v_note, '')) <> '' then
    select admin_note into v_zielnote from public.catalog_editorial where sky_id = p_target;
    v_neuenote := case
      when btrim(coalesce(v_zielnote, '')) = '' then v_note
      when position(v_note in v_zielnote) > 0   then v_zielnote
      else v_zielnote || E'\n' || v_note
    end;
    if v_neuenote is distinct from v_zielnote then
      v_changed := v_changed || jsonb_build_object('field', 'admin_note',
        'old', v_zielnote, 'new', v_neuenote);
      insert into public.catalog_editorial (sky_id, admin_note, updated_at)
        values (p_target, v_neuenote, now())
        on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                           updated_at = now();
    end if;
  end if;

  -- ---- Der Vorgang selbst ins Journal, zusätzlich zu den Feldzeilen des
  --      Triggers aus `0152`.
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
    'draft_deleted', true);
end;
$$;

comment on function public.admin_merge_draft(text, text, text) is
  'Merges an imported draft into an existing catalogue row (0154, CAT-05/CAT-05D). No field list: every business field the draft actually carries moves over, an empty one leaves the current value alone. Two placeholder rules — a generic card_type/item_type never replaces a specific one, and admin_note is appended rather than replaced. The TARGET keeps its SKY-ID, slug, status, visibility, price, imported image and every reference hanging off it; series_code and category_id always move together because they are one composite foreign key. Refuses when anything references the draft (admin_merge_references) or when either row is the wrong kind. Platform admins only. One transaction: a failure leaves no half-merged state.';

revoke all on function public.admin_merge_draft(text, text, text) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0154 Nachbedingung: admin_merge_references fehlt';
  end if;
  if to_regprocedure('public.admin_merge_draft(text,text,text)') is null then
    raise exception '0154 Nachbedingung: admin_merge_draft fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_merge_references(text)'),
                   to_regprocedure('public.admin_merge_draft(text,text,text)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0154 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0154: admin_merge_references und admin_merge_draft stehen, '
    'nur fuer authenticated, Adminpruefung im Rumpf.';
end
$nach$;
