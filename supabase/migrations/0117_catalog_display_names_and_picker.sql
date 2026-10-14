-- ===========================================================================
-- 0117 — DER KATALOG SAGT ÜBERALL DASSELBE
--
-- Zwei Dinge, ein Zweck: die Einkaufsmaske zeigt künftig genau die Artikel,
-- die der Katalog anbietet, und sie nennt sie so, wie der Katalog sie nennt.
--
-- ---------------------------------------------------------------------------
-- WAS DAS PROBLEM WAR
--
-- `seller_import_catalog()` aus `0052` liefert `s.name` und filtert nichts:
--
--     select s.sky_id, s.name, s.series_code, coalesce(c.name, '')
--       from public.skylanders s
--       left join public.categories c on c.id = s.category_id;
--
-- Die Figurenauswahl des Einkaufsbuchs bekommt damit JEDE Katalogzeile —
-- auch die redaktionell ausgeblendeten und die technisch abgeschalteten —
-- und zeigt den ROHNAMEN. Die Katalogansicht macht beides richtig
-- (`src/lib/catalog/queries.ts`: `display_name_override ?? name`, und
-- `where is_active and catalog_visible` wie überall sonst). Zwei Orte, zwei
-- Wahrheiten, und sichtbar wurde das an Eon's Elite: „Elite Spyro",
-- „Elite Spyro - ohne OVP" und „Elite Spyro (2)" standen alle drei zur Wahl,
-- obwohl zwei davon seit Langem ausgeblendet sind.
--
-- Wie viele Zeilen das in einer gegebenen Umgebung sind, steht hier
-- ABSICHTLICH nicht: Staging und Production unterscheiden sich darin, und
-- eine Zahl im Kommentar wäre in einer der beiden falsch. Die Mengen nennt
-- der Preflight, die Migration prüft Eigenschaften.
--
-- ---------------------------------------------------------------------------
-- WARUM `name` ROH BLEIBT — UND DIE SPALTE DANEBEN KOMMT
--
-- Dieselbe Funktion bedient den Arbeitsmappen-Import: `classifyRow()` matcht
-- auf `name`, und die Mappe enthält die Rohnamen („Elite Spyro - ohne OVP").
-- Würde `name` durch den Anzeigenamen ersetzt, bräche das Matching für
-- jede Zeile, die einen Override trägt — lautlos, denn ein nicht gefundener
-- Name ist im Import kein Fehler, sondern eine unzugeordnete Zeile.
--
-- Also kommt `display_name` DANEBEN, und `catalog_visible`/`is_active`
-- kommen mit, damit die Oberfläche filtern kann und der Importeur nicht.
-- Eine Funktion, zwei Leser, jeder nimmt die Spalte, die ihn angeht.
--
-- UND ZWAR ANGEHÄNGT, NICHT EINGESCHOBEN. Die vier Spalten aus `0052`
-- behalten die Positionen 1 bis 4, die drei neuen bekommen 5 bis 7. Beide
-- Aufrufer lesen über den Feldnamen, PostgREST liefert ohnehin JSON-Objekte
-- — aber ein künftiges `select * into record` würde positional zuweisen, und
-- eine verschobene Spalte wäre dort ein Fehler, den niemand sieht.
--
-- ---------------------------------------------------------------------------
-- DIE 53 ANZEIGENAMEN (Regel 2 und Regel 4 bleiben unberührt)
--
-- Keine SKY-ID wird geändert, zusammengeführt, gelöscht oder neu vergeben.
-- Kein `name` wird angefasst. Kein `slug` wird angefasst. Keine Lagerzeile,
-- keine Bewegung, kein Einkauf, kein Verkauf, kein Preis.
--
-- Geschrieben wird AUSSCHLIESSLICH `display_name_override` — die
-- redaktionelle Spalte aus `0004`, die dem Plattformadmin gehört und genau
-- dafür existiert. Der Trigger `skylanders_log_editorial` protokolliert
-- jede dieser 53 Änderungen in `catalog_admin_changes`, mit
-- `changed_by = NULL`: der dokumentierte Fall „Änderung über die
-- Service-Rolle (ein Import, ein Skript)".
--
--   14 × Eon's Elite    „Elite Spyro - ohne OVP"  →  „Elite Spyro"
--                       Die 28 OVP- und (2)-Varianten bleiben ausgeblendet
--                       und unangetastet; sie tragen über alle elf
--                       referenzierenden Tabellen null Referenzen.
--
--   39 × Spiele         „Wii U Spiel"  →  „Skylanders Giants – Wii U"
--                       Sechs Zeilen heissen „Wii U Spiel", sechs „Game
--                       (Xbox 360)", sechs „Spiel für Sony Playstation 3
--                       PS3" — die Generation steckt in der Kategorie und
--                       war in einer flachen Liste nicht zu sehen. Die
--                       Zuordnung ist nachgeprüft: jede Spiele-Kategorie
--                       gehört zu genau einer Serie, und keine Plattform
--                       kommt innerhalb einer Serie zweimal vor. Die
--                       Kategorie-IDs sind je Umgebung andere und stehen
--                       deshalb nicht in dieser Liste — zugeordnet wird
--                       ausschliesslich über die SKY-ID.
--
-- JEDE ZUWEISUNG IST GEGEN DEN ERWARTETEN ROHNAMEN ABGESICHERT. Stimmt er
-- nicht zeichengenau, wird die Zeile nicht angefasst, der Zähler weicht ab
-- und die Migration bricht ab — statt einen Namen auf die falsche Figur zu
-- schreiben.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen, die 53 Anzeigenamen, und die Prüfung in einem Zug
--
-- Alles in EINEM Block, damit die Liste genau einmal im Quelltext steht:
-- eine zweite Kopie für die Nachprüfung wäre eine zweite Wahrheit.
-- ---------------------------------------------------------------------------
do $$
declare
  /*
   * JEDE ZAHL EINE EIGENE VARIABLE.
   *
   * Hier stand ein wiederverwendetes `v_count` für drei verschiedene
   * Zählungen, und die Schlussmeldung griff auf die LETZTE davon zu — sie
   * nannte die Zahl der ausgeblendeten Elite-Zeilen mit Anzeigenamen (null,
   * wie es sein muss) als „Overrides gesamt". Die Prüfungen waren richtig,
   * die Meldung log. Eine Erfolgsmeldung, die etwas anderes sagt als sie
   * geprüft hat, ist schlimmer als keine.
   */
  v_count     integer;   -- nur für kurzlebige Zwischenprüfungen
  v_missing   text;
  v_elite     integer;   -- Eon's-Elite-Anzeigenamen, gesetzt
  v_games     integer;   -- Spiel-Anzeigenamen, gesetzt
  v_before    integer;   -- Overrides VOR dem UPDATE
  v_touched   integer;   -- Zeilen, die das UPDATE angefasst hat
  v_after     integer;   -- Overrides NACH dem UPDATE
  v_hidden    integer;   -- ausgeblendete Elite-Zeilen MIT Anzeigenamen
  v_invisible integer;   -- ausgeblendete Katalogzeilen insgesamt
begin
  -- Die redaktionelle Spalte und ihr Journal müssen da sein.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'display_name_override') then
    raise exception '0117 setzt 0004 voraus: skylanders.display_name_override fehlt';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'skylanders' and t.tgname = 'skylanders_log_editorial'
                    and not t.tgisinternal) then
    raise exception '0117 setzt 0004 voraus: der Trigger skylanders_log_editorial fehlt — ohne ihn bliebe diese Änderung unprotokolliert';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_import_catalog') then
    raise exception '0117 setzt 0052 voraus: seller_import_catalog() fehlt';
  end if;

  /*
   * DIE LISTE. Drei Spalten: Identität, erwarteter Rohname, Anzeigename.
   *
   * Der erwartete Rohname ist die Sicherung. Er wird nicht geschrieben, nur
   * verglichen — und wenn er nicht passt, passiert für diese Zeile nichts.
   */
  create temporary table _names_0117 (
    sky_id  text primary key,
    expect  text not null,
    want    text not null,
    kind    text not null
  ) on commit drop;

  insert into _names_0117 (sky_id, expect, want, kind) values
    -- ── Eon's Elite: der Loose-Eintrag bekommt den normalen Namen ──
    ('SKY-0011', 'Elite Boomer - ohne OVP',        'Elite Boomer',        'elite'),
    ('SKY-0017', 'Elite Chop Chop - ohne OVP',     'Elite Chop Chop',     'elite'),
    ('SKY-0022', 'Elite Dino Rang - ohne OVP',     'Elite Dino Rang',     'elite'),
    ('SKY-0030', 'Elite Eruptor - ohne OVP',       'Elite Eruptor',       'elite'),
    ('SKY-0035', 'Elite Ghost Roaster - ohne OVP', 'Elite Ghost Roaster', 'elite'),
    ('SKY-0040', 'Elite Gill Grunt - ohne OVP',    'Elite Gill Grunt',    'elite'),
    ('SKY-0049', 'Elite Slam Bam - ohne OVP',      'Elite Slam Bam',      'elite'),
    ('SKY-0056', 'Elite Spyro - ohne OVP',         'Elite Spyro',         'elite'),
    ('SKY-0060', 'Elite Stealth Elf - ohne OVP',   'Elite Stealth Elf',   'elite'),
    ('SKY-0066', 'Elite Terrafin - ohne OVP',      'Elite Terrafin',      'elite'),
    ('SKY-0071', 'Elite Trigger Happy - ohne OVP', 'Elite Trigger Happy', 'elite'),
    -- Rohname OHNE Leerzeichen vor dem Bindestrich. Regel 4: nicht
    -- korrigieren — der Anzeigename erledigt es, die Quelle bleibt.
    ('SKY-0075', 'Elite Voodood- ohne OVP',        'Elite Voodood',       'elite'),
    ('SKY-0083', 'Elite Whirlwind - ohne OVP',     'Elite Whirlwind',     'elite'),
    ('SKY-0089', 'Elite Zook - ohne OVP',          'Elite Zook',          'elite'),

    -- ── Spiele, Serie für Serie ──
    -- Spyro's Adventure (Kategorie 2, Serie SA)
    ('SKY-0001', 'Game (PC)',                              'Skylanders Spyro''s Adventure – PC',             'game'),
    ('SKY-0002', 'Game (Xbox 360)',                        'Skylanders Spyro''s Adventure – Xbox 360',       'game'),
    ('SKY-0003', 'Spiel für Sony Playstation 3 PS3',       'Skylanders Spyro''s Adventure – PS3',            'game'),
    ('SKY-0004', 'Skylanders Spyro''s Adventure Wii Spiel','Skylanders Spyro''s Adventure – Wii',            'game'),
    ('SKY-0005', 'Game (Nintendo 3DS)',                    'Skylanders Spyro''s Adventure – Nintendo 3DS',   'game'),
    ('SKY-0006', 'Wii U Spiel',                            'Skylanders Spyro''s Adventure – Wii U',          'game'),
    -- Giants (6, G)
    ('SKY-0109', 'Game (Xbox 360)',                        'Skylanders Giants – Xbox 360',                   'game'),
    ('SKY-0110', 'Spiel für Sony Playstation 3 PS3',       'Skylanders Giants – PS3',                        'game'),
    ('SKY-0111', 'Wii Spiel',                              'Skylanders Giants – Wii',                        'game'),
    ('SKY-0112', 'Game (Nintendo 3DS)',                    'Skylanders Giants – Nintendo 3DS',               'game'),
    ('SKY-0113', 'Wii U Spiel',                            'Skylanders Giants – Wii U',                      'game'),
    -- Swap Force (12, SF)
    ('SKY-0196', 'Game (Xbox 360)',                        'Skylanders Swap Force – Xbox 360',               'game'),
    ('SKY-0197', 'Spiel für Xbox One',                     'Skylanders Swap Force – Xbox One',               'game'),
    ('SKY-0198', 'Spiel für Sony Playstation 3 PS3',       'Skylanders Swap Force – PS3',                    'game'),
    ('SKY-0199', 'Spiel für Sony Playstation 4 PS4',       'Skylanders Swap Force – PS4',                    'game'),
    ('SKY-0200', 'Wii Spiel',                              'Skylanders Swap Force – Wii',                    'game'),
    ('SKY-0201', 'Game (Nintendo 3DS)',                    'Skylanders Swap Force – Nintendo 3DS',           'game'),
    ('SKY-0202', 'Wii U Spiel',                            'Skylanders Swap Force – Wii U',                  'game'),
    -- Trap Team (17, T) — die (EN)-Zeile bleibt eine eigene Ausgabe
    ('SKY-0305', 'Game (Xbox 360)',                        'Skylanders Trap Team – Xbox 360',                'game'),
    ('SKY-0306', 'Spiel für Xbox One',                     'Skylanders Trap Team – Xbox One',                'game'),
    ('SKY-0307', 'Spiel für Xbox One (EN)',                'Skylanders Trap Team – Xbox One (EN)',           'game'),
    ('SKY-0308', 'Spiel für Sony Playstation 3 PS3',       'Skylanders Trap Team – PS3',                     'game'),
    ('SKY-0309', 'Spiel für Sony Playstation 4 PS4',       'Skylanders Trap Team – PS4',                     'game'),
    ('SKY-0310', 'Wii Spiel',                              'Skylanders Trap Team – Wii',                     'game'),
    ('SKY-0311', 'Game (Nintendo 3DS)',                    'Skylanders Trap Team – Nintendo 3DS',            'game'),
    ('SKY-0312', 'Wii U Spiel',                            'Skylanders Trap Team – Wii U',                   'game'),
    -- SuperChargers (24, SC)
    ('SKY-0454', 'Game (Xbox 360)',                        'Skylanders SuperChargers – Xbox 360',            'game'),
    ('SKY-0455', 'Spiel für Xbox One',                     'Skylanders SuperChargers – Xbox One',            'game'),
    ('SKY-0456', 'Spiel für Sony Playstation 3 PS3',       'Skylanders SuperChargers – PS3',                 'game'),
    ('SKY-0457', 'Spiel für Sony Playstation 4 PS4',       'Skylanders SuperChargers – PS4',                 'game'),
    ('SKY-0458', 'Wii Spiel',                              'Skylanders SuperChargers – Wii',                 'game'),
    ('SKY-0459', 'Game (Nintendo 3DS)',                    'Skylanders SuperChargers – Nintendo 3DS',        'game'),
    ('SKY-0460', 'Wii U Spiel',                            'Skylanders SuperChargers – Wii U',               'game'),
    -- Imaginators (28, I)
    ('SKY-0530', 'Game (Xbox 360)',                        'Skylanders Imaginators – Xbox 360',              'game'),
    ('SKY-0531', 'Spiel für Xbox One',                     'Skylanders Imaginators – Xbox One',              'game'),
    ('SKY-0532', 'Spiel für Sony Playstation 3 PS3',       'Skylanders Imaginators – PS3',                   'game'),
    ('SKY-0533', 'Spiel für Sony Playstation 4 PS4',       'Skylanders Imaginators – PS4',                   'game'),
    ('SKY-0534', 'Wii U Spiel',                            'Skylanders Imaginators – Wii U',                 'game'),
    ('SKY-0535', 'Game (Nintendo Switch)',                 'Skylanders Imaginators – Nintendo Switch',       'game');

  select count(*) into v_count from _names_0117;
  if v_count <> 53 then
    raise exception '0117 Befund: die Liste hat % Einträge, erwartet 53', v_count;
  end if;

  /*
   * JEDE ZEILE MUSS EXISTIEREN UND DEN ERWARTETEN ROHNAMEN TRAGEN.
   *
   * Vor dem Schreiben geprüft, nicht danach: eine Abweichung heisst, dass
   * der Katalog nicht der ist, für den diese Liste geschrieben wurde.
   */
  select string_agg(n.sky_id || ' (' || n.expect || ')', ', ' order by n.sky_id)
    into v_missing
    from _names_0117 n
    left join public.skylanders s on s.sky_id = n.sky_id and s.name = n.expect
   where s.sky_id is null;
  if v_missing is not null then
    raise exception '0117 Abbruch: diese Zeilen fehlen oder tragen einen anderen Rohnamen: %', v_missing;
  end if;

  /*
   * UND KEINE TRÄGT SCHON EINEN *ABWEICHENDEN* ANZEIGENAMEN.
   *
   * Trägt eine Zeile bereits genau den vorgesehenen Namen, ist das kein
   * Befund, sondern ein zweiter Lauf — die Bedingung unten lässt ihn durch.
   * Trägt sie einen ANDEREN, ist das eine redaktionelle Entscheidung des
   * Betreibers, die diese Migration nicht überschreiben darf, und der Lauf
   * bricht ab.
   *
   * In beiden Umgebungen gibt es Zeilen mit Anzeigenamen ausserhalb dieser
   * Liste; wie viele, ist je Umgebung verschieden und wird hier nicht
   * erwartet.
   */
  select string_agg(s.sky_id || ' → „' || s.display_name_override || '"', ', ' order by s.sky_id)
    into v_missing
    from _names_0117 n
    join public.skylanders s on s.sky_id = n.sky_id
   where s.display_name_override is not null
     and s.display_name_override is distinct from n.want;
  if v_missing is not null then
    raise exception '0117 Abbruch: diese Zeilen tragen bereits einen anderen Anzeigenamen: %', v_missing;
  end if;

  /*
   * WIE VIELE ANZEIGENAMEN ES VORHER GAB — gemessen, nicht angenommen.
   *
   * Die Zahl ist je Umgebung eine andere, und eine fest eingetragene
   * Erwartung würde die Migration in der jeweils anderen grundlos
   * abbrechen. Also wird die Nachbedingung RELATIV geprüft: hinterher genau
   * so viele mehr, wie diese Migration geschrieben hat.
   */
  select count(*) into v_before from public.skylanders
   where display_name_override is not null;

  -- Schreiben. Nur diese eine Spalte, nur diese 53 Zeilen, nur wenn der
  -- Rohname passt. Wiederholbar: ein zweiter Lauf trifft 0 Zeilen.
  update public.skylanders s
     set display_name_override = n.want
    from _names_0117 n
   where s.sky_id = n.sky_id
     and s.name = n.expect
     and s.display_name_override is distinct from n.want;
  get diagnostics v_touched = row_count;

  -- Und nachgezählt: alle 53 tragen jetzt genau den vorgesehenen Namen.
  select count(*) into v_elite
    from _names_0117 n join public.skylanders s on s.sky_id = n.sky_id
   where n.kind = 'elite' and s.display_name_override = n.want;
  select count(*) into v_games
    from _names_0117 n join public.skylanders s on s.sky_id = n.sky_id
   where n.kind = 'game' and s.display_name_override = n.want;
  if v_elite <> 14 then
    raise exception '0117 Befund: % von 14 Eon''s-Elite-Anzeigenamen gesetzt', v_elite;
  end if;
  if v_games <> 39 then
    raise exception '0117 Befund: % von 39 Spiel-Anzeigenamen gesetzt', v_games;
  end if;

  -- Und kein Rohname hat sich bewegt.
  select count(*) into v_count
    from _names_0117 n join public.skylanders s on s.sky_id = n.sky_id
   where s.name <> n.expect;
  if v_count > 0 then
    raise exception '0117 Befund: % Rohnamen haben sich verändert — das darf nicht passieren', v_count;
  end if;

  /*
   * UND KEINE ZEILE AUSSERHALB DER LISTE HAT EINEN ANZEIGENAMEN BEKOMMEN.
   *
   * Relativ geprüft: die Zahl der Overrides ist um genau so viele gestiegen,
   * wie dieses UPDATE Zeilen angefasst hat.
   */
  select count(*) into v_after from public.skylanders
   where display_name_override is not null;
  if v_after <> v_before + v_touched then
    raise exception '0117 Befund: % Zeilen mit Anzeigenamen, erwartet % (vorher %) + % geschrieben',
      v_after, v_before + v_touched, v_before, v_touched;
  end if;

  /*
   * UND DIE AUSGEBLENDETEN EON'S-ELITE-VARIANTEN BLEIBEN AUSGEBLENDET UND
   * OHNE ANZEIGENAMEN. Eine Zahl wird hier NICHT erwartet, weil sie je
   * Umgebung eine andere sein darf. Geprüft wird die Eigenschaft, nicht die
   * Menge.
   */
  select count(*) into v_hidden from public.skylanders
   where card_type = 'elite' and not catalog_visible
     and display_name_override is not null;
  if v_hidden > 0 then
    raise exception '0117 Befund: % ausgeblendete Elite-Zeilen haben einen Anzeigenamen bekommen', v_hidden;
  end if;

  /*
   * DIE SCHLUSSMELDUNG, UND WAS SIE BEI EINEM ZWEITEN LAUF SAGT.
   *
   * `v_touched` ist die Zahl der TATSÄCHLICH geschriebenen Zeilen, nicht 53:
   * das UPDATE trägt `is distinct from n.want`, also fasst ein zweiter Lauf
   * null Zeilen an und meldet „0 Anzeigenamen geschrieben … 53 → 53". Das
   * ist richtig und soll auch so dastehen — wiederholbar heisst, dass der
   * zweite Lauf nichts tut UND es sagt.
   *
   * `v_elite` und `v_games` bleiben 14 und 39, weil sie den ZUSTAND zählen
   * und nicht die Änderung.
   */
  select count(*) into v_invisible from public.skylanders where not catalog_visible;
  raise notice '0117: % Anzeigenamen geschrieben (Zustand: % Eon''s Elite, % Spiele). Overrides gesamt: % → %.',
    v_touched, v_elite, v_games, v_before, v_after;
  raise notice '0117: Katalog unverändert — % Zeilen, davon % ausgeblendet, % abgeschaltet.',
    (select count(*) from public.skylanders), v_invisible,
    (select count(*) from public.skylanders where not is_active);
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Die Figurenauswahl bekommt, was sie braucht
--
-- WARUM DROP UND NEU. Der Rückgabetyp wächst um drei Spalten, und
-- `create or replace function` kann einen Rückgabetyp nicht ändern. Die
-- Funktion hat keine Argumente, also ist der Drop eindeutig und erzeugt
-- keine zweite Overload.
--
-- WAS SIE NICHT TUT: filtern. Sie liefert weiter ALLE Zeilen, denn derselbe
-- Aufruf bedient den Arbeitsmappen-Import, und dessen Namens-Matching muss
-- auch eine ausgeblendete Zeile finden können — eine Arbeitsmappe aus 2024
-- kennt die redaktionellen Entscheidungen von heute nicht. Gefiltert wird
-- dort, wo die Auswahlliste entsteht.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_import_catalog();

create or replace function public.seller_import_catalog()
returns table (
  /*
   * DIE VIER AUS `0052` BEHALTEN IHRE POSITIONEN 1–4.
   *
   * Angehängt wird, nicht eingeschoben. Beide Aufrufer der Anwendung lesen
   * über den Feldnamen und PostgREST liefert JSON-Objekte, die Ordnungszahl
   * käme beim Client also gar nicht an — aber ein `select * into record`
   * irgendwann später würde positional zuweisen, und dann ist eine
   * verschobene Spalte ein Fehler, den niemand sieht. Die drei neuen Spalten
   * hinten anzuhängen kostet nichts und nimmt diese Möglichkeit weg.
   */
  sky_id          text,
  name            text,
  series_code     text,
  category        text,
  display_name    text,
  catalog_visible boolean,
  is_active       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The same predicate every other seller_* function asks, and the same one
  -- the /business route guard asks before rendering the page. A platform
  -- administrator is deliberately NOT admitted: `0042` keeps the two account
  -- types apart, the Business area answers `notFound()` to an administrator,
  -- and a function nobody can reach through the product should not be
  -- callable around it either.
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * `name` IST UND BLEIBT DER ROHNAME.
   *
   * `classifyRow()` matcht darauf, und die Arbeitsmappe enthält Rohnamen.
   * `display_name` steht DANEBEN und ist das, was ein Mensch lesen soll —
   * dieselbe Regel, die `src/lib/catalog/queries.ts` seit `0004` anwendet:
   * der redaktionelle Override, sonst der Rohname.
   *
   * `catalog_visible` und `is_active` kommen mit, damit die Auswahlliste
   * genau das anbieten kann, was der Katalog auch anbietet — und damit der
   * Importeur sie ignorieren kann. Beide Riegel, weil das ganze Projekt
   * beide prüft: `is_active` ist technisch, `catalog_visible` redaktionell
   * (0004), und `shop_offers()` verlangt seit `0006` ebenfalls beide.
   *
   * Alle drei stehen HINTEN, auf 5 bis 7. Die vier Spalten aus `0052`
   * behalten ihre Ordnungszahlen.
   *
   * Kein Preis, kein Bild, kein Slug, keine Notiz. `catalog_editorial` hält
   * die internen Bemerkungen und wird hier nicht angefasst (ADR-0043).
   */
  return query
    select s.sky_id,
           s.name,
           s.series_code,
           coalesce(c.name, ''),
           coalesce(s.display_name_override, s.name),
           s.catalog_visible,
           s.is_active
      from public.skylanders s
      left join public.categories c on c.id = s.category_id;
end;
$$;

comment on function public.seller_import_catalog() is
  'The catalog as the Einkaufsbuch needs it (0052, widened in 0117). `name` is the RAW name and stays that way — the workbook importer matches on it, and a workbook does not know today''s editorial decisions. `display_name` is what a person should read: the administrator''s override where one exists, otherwise the raw name, exactly as the public catalog resolves it. `catalog_visible` and `is_active` ride along so the figure picker can offer precisely what the catalog offers, while the importer ignores both. No price, no image, no slug, no editorial note.';

revoke all on function public.seller_import_catalog() from public, anon;
grant execute on function public.seller_import_catalog() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $$
declare v_count integer; v_args text; v_result text;
begin
  -- Genau eine Overload, und die neue Form.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_import_catalog';
  if v_count <> 1 then
    raise exception '0117 Befund: seller_import_catalog() hat % Overload(s), erwartet 1', v_count;
  end if;

  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    into v_args, v_result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_import_catalog';
  if v_args <> '' then
    raise exception '0117 Befund: seller_import_catalog nimmt Argumente (%)', v_args;
  end if;
  /*
   * DIE VIER ALTEN AUF 1–4, WÖRTLICH WIE IN `0052`, DANN DIE DREI NEUEN.
   * Ein Vergleich der ganzen Zeichenkette prüft Namen, Typen UND Reihenfolge
   * in einem Zug — eine Liste von `position(… in …)`-Prüfungen täte das
   * nicht und hätte eine Verschiebung durchgelassen.
   */
  if v_result <> 'TABLE(sky_id text, name text, series_code text, category text, '
                 || 'display_name text, catalog_visible boolean, is_active boolean)' then
    raise exception '0117 Befund: unerwarteter Rückgabetyp: %', v_result;
  end if;

  -- Rechte unverändert streng.
  if has_function_privilege('anon', 'public.seller_import_catalog()', 'EXECUTE') then
    raise exception '0117 Befund: anon darf seller_import_catalog ausführen';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_import_catalog()', 'EXECUTE') then
    raise exception '0117 Befund: authenticated darf seller_import_catalog NICHT ausführen';
  end if;

  /*
   * DIE DATENPRÜFUNGEN STEHEN IN ABSCHNITT 1, wo die Liste liegt — hier
   * wären sie eine zweite, gegen die Umgebung fest verdrahtete Erwartung.
   * Was hier bleibt, ist die eine Eigenschaft, die unabhängig von den Daten
   * gelten muss: die Auswahlliste kann jetzt filtern.
   */
  if (select count(*) from public.skylanders
       where not (catalog_visible and is_active)) = 0 then
    raise notice '0117 Hinweis: in dieser Umgebung ist keine Katalogzeile ausgeblendet oder abgeschaltet — der neue Filter wirkt hier auf nichts.';
  end if;
end;
$$;
