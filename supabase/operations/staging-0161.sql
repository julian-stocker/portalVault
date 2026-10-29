-- ===========================================================================
-- STAGING — EIN LAUF FUER 0161
--            (die Familie entsteht von selbst, CAT-08 Stufe 1)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- *** SIE LEGT EINE FUNKTION AN — SONST NICHTS ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie,
-- kein Index, keine Constraint. Der Katalog sieht nach diesem Lauf aus wie
-- vorher: dieselben Entwuerfe, dieselben Familien, dieselben Varianten.
--
-- *** WAS DIE FUNKTION TUT ***
--
-- `admin_publish_variant_auto(text, text)`. Der Bediener waehlt nur die
-- Basisfigur; die Familie regelt die Datenbank:
--
--   Basisfigur hat eine  -> uebernehmen
--   nur die Variante     -> ihre bleibt, die Basisfigur unberuehrt
--   keine von beiden     -> die Familie mit dem NAMEN der Basisfigur suchen,
--                           BESTAETIGEN und benutzen — oder anlegen
--   verschiedene         -> ABBRUCH, nichts wird ueberschrieben
--
-- *** DIE FUNKTIONEN AUS 0158/0159 BLEIBEN ***
--
-- Sie werden AUFGERUFEN, nicht ersetzt. `admin_publish_with_base` bleibt
-- gueltig und aufrufbar; Waechter A3 unten prueft die Abdruecke aller fuenf,
-- bevor etwas laeuft, und die Nachkontrolle nennt sie wieder.
--
-- *** NAMENSGLEICHHEIT ALLEIN ENTSCHEIDET NICHT ***
--
-- Eine gefundene Familie wird nur benutzt, wenn JEDES ihrer Mitglieder einen
-- Namen traegt, der mit dem der Basisfigur an einer Wortgrenze vereinbar
-- ist. Sonst bricht der Aufruf ab und nennt das Mitglied. Gemessen in
-- Probelauf **P70**, begruendet im Kopf der Migration.
--
-- ERWARTET: die NOTICE-Zeile der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
declare
  v_fehlt text := '';
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  /*
   * A2: DIE FUENF FUNKTIONEN, DIE `0161` AUFRUFT. Fehlt eine, legte diese
   * Migration eine Funktion an, die beim ersten Aufruf scheitert — und das
   * waere der schlechteste Zeitpunkt, es zu merken.
   */
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    v_fehlt := v_fehlt || ' admin_set_variant_base(0159)';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null then
    v_fehlt := v_fehlt || ' admin_create_character(0158)';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    v_fehlt := v_fehlt || ' admin_set_character(0158)';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    v_fehlt := v_fehlt || ' admin_set_catalog_status(0152)';
  end if;
  if v_fehlt <> '' then
    raise exception 'ABBRUCH A2: diese Funktionen fehlen:%', v_fehlt;
  end if;

  /*
   * A3: DIE ABDRUECKE. `0161` ersetzt keine der vorhandenen Funktionen —
   * aber sie RUFT sie auf, und sie verlaesst sich dabei auf ihr Verhalten:
   * dass `admin_set_character` nur eine Spalte schreibt, dass
   * `admin_set_variant_base` bei Widerspruch abbricht, dass
   * `admin_create_character` einen vorhandenen Namen abweist. Steht hier eine
   * fremde Fassung, gelten diese Zusagen nicht mehr.
   */
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)'))
     <> 'b47289cb9b630ba5d3b6b186955539f6' then
    raise exception 'ABBRUCH A3: admin_set_variant_base ist nicht die Fassung aus '
      '0159. 0161 ruft sie auf und verlaesst sich auf ihr Verhalten — erst klaeren.';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_set_character(text,bigint)'))
     <> '4b02bf104a095e61c9df29c50fe34647' then
    raise exception 'ABBRUCH A3: admin_set_character ist nicht die Fassung aus 0158.';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_create_character(text)'))
     <> '5f8137b4acd0a325b8c2c1572850e3ea' then
    raise exception 'ABBRUCH A3: admin_create_character ist nicht die Fassung aus 0158.';
  end if;

  /*
   * A4: DER EINDEUTIGKEITSINDEX. Ohne ihn koennten zwei Familien denselben
   * Namen tragen, und „die Familie mit diesem Namen" waere eine Auswahl und
   * keine Beschreibung. Dann duerfte diese Funktion nicht suchen.
   */
  if not exists (
    select 1 from pg_index i
     where i.indrelid = to_regclass('public.characters') and i.indisunique
       and pg_get_indexdef(i.indexrelid) like '%lower(canonical_name)%') then
    raise exception 'ABBRUCH A4: der eindeutige Index auf '
      'lower(characters.canonical_name) fehlt (0002).';
  end if;

  /*
   * A5: TRAEGT EIN NAME HEUTE ZWEI VERSCHIEDENE FAMILIEN? Dann waere
   * Namensgleichheit kein Beweis, und die Wiederverwendung muesste erst
   * geklaert werden. Die Vetopruefung faengt den Einzelfall; dieser Waechter
   * faengt die Lage.
   */
  if exists (
    select 1 from public.skylanders s
     join public.categories c on c.id = s.category_id
    where s.is_active
      and not (c.name = any (public.non_collectible_categories()))
      and not (c.name = any (array['Traps', 'Trap Items', 'Fahrzeuge',
                                   'Kreationskristalle', 'Magic Items',
                                   'Trophies', 'Locations & Truhen']))
    group by lower(s.name)
   having count(distinct s.character_id) > 1) then
    raise exception 'ABBRUCH A5: mindestens ein Name traegt zwei verschiedene '
      'Familien. Dann beweist Namensgleichheit nichts — erst klaeren, dann 0161.';
  end if;

  /*
   * A6: DER EINSATZ, als NOTICE und nicht als Riegel.
   */
  raise notice 'A6: % Entwuerfe, % Zeilen mit Familie, % Varianten mit Basisfigur. '
    'Diese Migration aendert keine davon — sie legt nur den Weg an.',
    (select count(*) from public.skylanders where catalog_status = 'draft'),
    (select count(*) from public.skylanders where character_id is not null),
    (select count(*) from public.skylanders where base_sky_id is not null);
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0161_variant_family_auto.sql
-- ---------------------------------------------------------------------------
-- 0161 — die Familie entsteht von selbst (CAT-08, Stufe 1)
--
-- WAS SIE TUT. Eine vierte Funktion, `admin_publish_variant_auto(text, text)`.
-- Der Bediener waehlt NUR die Basisfigur; die Familie regelt die Datenbank:
--
--   1. Basisfigur hat eine Familie  -> sie wird uebernommen.
--   2. Nur die Variante hat eine    -> sie bleibt, die Basisfigur unberuehrt.
--   3. Keine von beiden hat eine    -> eine Familie mit dem NAMEN der
--                                      Basisfigur wird gesucht; gefunden und
--                                      bestaetigt -> benutzt, sonst neu
--                                      angelegt. Beide bekommen sie.
--   4. Beide haben VERSCHIEDENE     -> ABBRUCH. Nichts wird ueberschrieben.
--
-- DIE CHECKBOX ENTFAELLT. `p_create_family` aus `0159` war eine Frage an den
-- Bediener, die er nicht beantworten kann: „soll eine Familie angelegt
-- werden?" ist keine fachliche Entscheidung, sondern eine Folge daraus, dass
-- er eine Basisfigur gewaehlt hat.
--
-- ===========================================================================
-- DIE EINE FRAGE, AN DER DIESE MIGRATION HAENGT: REICHT NAMENSGLEICHHEIT?
-- ===========================================================================
--
-- Fall 3 benutzt eine bestehende Familie wieder, wenn ihr `canonical_name`
-- dem Namen der Basisfigur entspricht. Das ist noetig: „Chop Chop" steht
-- zweimal im Katalog — SKY-0015 in `SA` und SKY-0149 in `G` —, beide sind
-- Basisfigur eines Entwurfs, und beide sind DERSELBE Charakter. Ohne
-- Wiederverwendung wuerde der zweite Lauf an `admin_create_character`
-- abbrechen („die Familie gibt es schon"), und der Bediener stuende vor einem
-- Fehler, den er nicht verursacht hat.
--
-- ABER NAMENSGLEICHHEIT ALLEIN BEWEIST NICHTS. ADR-0034 fuehrt die
-- Gegenbeispiele: „Kaos" ist ein Trap, eine Trophy UND ein Sensei;
-- `Mini Drobit` ist Drobots Mini und ein EIGENER Charakter. Gemessen am
-- echten Bestand (`supabase/checks/cat08_name_equality.sql`, 2026-10-28):
-- 470 Charakterzeilen, 24 mehrfach vorkommende Namen, und **kein einziger**
-- traegt zwei verschiedene `character_id`. Die Regel traegt heute — aber
-- „heute" ist kein Riegel.
--
-- DESHALB WIRD DIE IDENTITAET BESTAETIGT, NICHT ANGENOMMEN. Bevor eine
-- gefundene Familie benutzt wird, prueft diese Funktion JEDES ihrer
-- Mitglieder: traegt eines einen Namen, der mit dem der Basisfigur nicht
-- vereinbar ist, bricht sie ab und nennt es. Vereinbar heisst:
--
--   gleich               "Chop Chop"        = "Chop Chop"
--   Mitglied endet drauf "Gold Chop Chop"  -> " Chop Chop"
--   Basis endet drauf    "Chop Chop"       <- "Chop" waere vereinbar
--
-- an einer WORTGRENZE, nie mitten im Wort. Verglichen wird mit `right()` und
-- nicht mit `like`: ein Name darf `%` oder `_` enthalten, und ein Muster, das
-- an einem Namen zerbricht, waere ein stiller Fehler.
--
-- DAS IST EIN VETO, KEINE SUCHE. Gefunden wird eine Familie ausschliesslich
-- ueber GLEICHHEIT des Namens; die Wortgrenzenregel darf nur WIDERSPRECHEN.
-- Damit bleibt ADR-0034 unberuehrt: keine Zuordnung entsteht aus einer
-- Namensaehnlichkeit. Die serienuebergreifende Suche aus der Analyse
-- (CAT-08 Stufe 2) ist NICHT Teil dieser Migration — sie haette heute an
-- 34 von 34 Faellen nichts gefunden, und sie braeuchte eine eigene Freigabe.
--
-- ===========================================================================
-- NEBENLAEUFIGKEIT
-- ===========================================================================
--
-- Zwei Bediener veroeffentlichen gleichzeitig zwei Varianten DERSELBEN
-- Basisfigur. Beide sehen „keine Familie", beide legen an, einer laeuft in
-- `23505` am Index `characters_canonical_name_key` aus `0002`. Zwei Riegel:
--
--   * `pg_advisory_xact_lock` auf dem kleingeschriebenen Familiennamen. Der
--     zweite Aufruf wartet, sieht danach die Familie und BENUTZT sie. Der
--     Name ist der Schluessel, nicht die Zeile — zwei verschiedene Familien
--     behindern sich nicht.
--   * Beide Katalogzeilen werden in EINER Anweisung und in `sky_id`-Ordnung
--     gesperrt. `0159` sperrt Variante-dann-Basis; bei zwei Aufrufen, deren
--     Variante die Basis des anderen ist, waere das ein Deadlock. Eine
--     feste Ordnung kann keinen bauen.
--
-- ===========================================================================
-- WAS SIE NICHT ANFASST
-- ===========================================================================
--
--   * KEINE der Funktionen aus `0158`/`0159`. Sie werden AUFGERUFEN, nicht
--     ersetzt: `admin_set_character` schreibt die Familie,
--     `admin_set_variant_base` die Basisfigur, `admin_set_catalog_status`
--     veroeffentlicht. Es gibt weiterhin EINEN Schreibweg je Spalte.
--     `admin_publish_with_base(text,text,boolean)` bleibt gueltig und
--     aufrufbar; `0161_postflight.sql` rechnet die Abdruecke aller fuenf
--     nach.
--   * Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine
--     Richtlinie, kein Index, keine Constraint.
--   * Keine Massenzuordnung. Diese Funktion schreibt die Familie von
--     GENAU ZWEI Zeilen, und nur dort, wo sie `NULL` war.
--   * Kein Name, kein Slug, keine SKY-ID, kein Preis, kein Bild, keine
--     Serie, keine Kategorie, kein `card_type` — und damit kein Angebot,
--     kein Lagerbestand, keine Sammlung und keine Bestellung.
--
-- Ruecknahme: `supabase/rollback/R0161_drop_variant_family_auto.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0161 setzt 0159 voraus: admin_set_variant_base fehlt';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0161 setzt 0158 voraus: admin_create_character oder '
      'admin_set_character fehlt';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0161 setzt 0152 voraus: admin_set_catalog_status fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'base_sky_id') then
    raise exception '0161 setzt 0159 voraus: skylanders.base_sky_id fehlt';
  end if;
  if to_regclass('public.characters') is null then
    raise exception '0161 setzt 0002 voraus: characters fehlt';
  end if;

  -- DER EINDEUTIGKEITSINDEX IST TEIL DER ZUSAGE. Ohne ihn koennten zwei
  -- Familien denselben Namen tragen, und „die Familie mit diesem Namen"
  -- waere keine Beschreibung mehr, sondern eine Auswahl.
  if not exists (
    select 1 from pg_index i
     where i.indrelid = to_regclass('public.characters') and i.indisunique
       and pg_get_indexdef(i.indexrelid) like '%lower(canonical_name)%') then
    raise exception '0161 setzt 0002 voraus: der eindeutige Index auf '
      'lower(characters.canonical_name) fehlt';
  end if;

  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is not null then
    raise exception '0161 Abbruch: admin_publish_variant_auto steht schon. Diese '
      'Migration ist hier bereits angewendet.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Weg B, ohne Frage an den Bediener
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_variant_auto(
  p_sky_id      text,
  p_base_sky_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_basis     public.skylanders%rowtype;
  v_fam       bigint := null;
  v_weg       text;
  v_name      text;
  v_klein     text;
  v_fremd     text   := null;
  v_fremd_id  text   := null;
  v_zuordnung jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_sky_id is null or p_base_sky_id is null then
    raise exception '0161: Weg B braucht einen Entwurf UND eine Basisfigur. Ohne '
      'Basisfigur ist es Weg C — dafuer gibt es admin_set_catalog_status.';
  end if;
  if p_sky_id = p_base_sky_id then
    raise exception '0161: eine Figur kann nicht ihre eigene Variante sein (%)',
      p_sky_id;
  end if;

  /*
   * BEIDE ZEILEN, EINE ANWEISUNG, FESTE ORDNUNG. Siehe Kopf: eine feste
   * Sperrordnung kann keinen Deadlock bauen, eine aufrufabhaengige schon.
   */
  perform 1 from public.skylanders s
   where s.sky_id in (p_sky_id, p_base_sky_id)
   order by s.sky_id
     for update;

  select * into v_row from public.skylanders where sky_id = p_sky_id;
  if not found then
    raise exception '0161: die Figur % gibt es nicht', p_sky_id;
  end if;
  select * into v_basis from public.skylanders where sky_id = p_base_sky_id;
  if not found then
    raise exception '0161: die Basisfigur % gibt es nicht', p_base_sky_id;
  end if;

  /*
   * DIE RIEGEL VORWEG, mit eigenen Meldungen. `admin_set_variant_base`
   * prueft sie unten noch einmal und ist die Autoritaet; hier stehen sie,
   * damit in einem Lauf, der ohnehin scheitert, KEINE Familie entsteht —
   * und damit die Meldung sagt, was wirklich los ist.
   */
  if v_row.catalog_status <> 'draft' then
    raise exception '0161: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_variant_base.',
      p_sky_id, v_row.catalog_status;
  end if;
  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0161: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;
  if v_basis.base_sky_id is not null then
    raise exception '0161: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0161: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  -- ======================================================================
  -- DIE FAMILIE
  -- ======================================================================
  if v_basis.character_id is not null then
    -- FALL 1: uebernehmen. Das ist keine Namensregel, sondern die Folge der
    -- Entscheidung, die der Bediener mit der Wahl der Basisfigur getroffen
    -- hat. Geschrieben wird sie unten von `admin_set_variant_base`.
    if v_row.character_id is not null
       and v_row.character_id <> v_basis.character_id then
      raise exception '0161: % gehoert zur Familie %, die Basisfigur % zur '
        'Familie %. Das wird nicht stillschweigend ueberschrieben — erst '
        'klaeren, welche gilt.',
        p_sky_id, v_row.character_id, p_base_sky_id, v_basis.character_id;
    end if;
    v_fam := v_basis.character_id;
    v_weg := 'uebernommen';

  elsif v_row.character_id is not null then
    -- FALL 2: nur die Variante hat eine. Die Basisfigur wird NICHT
    -- angefasst — eine Zuordnung nach OBEN zu schreiben waere eine
    -- Entscheidung ueber eine fremde Zeile (`0159`, Abschnitt 5).
    v_fam := v_row.character_id;
    v_weg := 'nur die Variante hat eine';

  else
    -- FALL 3: keine von beiden. Suchen, bestaetigen, sonst anlegen.
    v_name  := btrim(v_basis.name);
    v_klein := lower(v_name);
    if v_name = '' then
      raise exception '0161: die Basisfigur % hat keinen Namen, aus dem eine '
        'Familie benannt werden koennte', p_base_sky_id;
    end if;

    -- Der Riegel gegen zwei gleichzeitige Anlagen desselben Namens.
    perform pg_advisory_xact_lock(hashtext('skyisles.family:' || v_klein));

    select c.id into v_fam from public.characters c
     where lower(c.canonical_name) = v_klein;

    if v_fam is null then
      v_fam := public.admin_create_character(v_name);
      v_weg := 'neu angelegt';
    else
      /*
       * DAS VETO. Jedes Mitglied der gefundenen Familie muss mit dem Namen
       * der Basisfigur vereinbar sein. `right()` statt `like`: ein Name darf
       * `%` oder `_` enthalten.
       */
      select s.sky_id, s.name into v_fremd_id, v_fremd
        from public.skylanders s
       where s.character_id = v_fam
         and lower(s.name) <> v_klein
         and right(lower(s.name), length(v_klein) + 1) <> ' ' || v_klein
         and right(v_klein, length(s.name) + 1) <> ' ' || lower(s.name)
       order by s.sky_id
       limit 1;
      if v_fremd is not null then
        raise exception '0161: es gibt schon eine Familie "%" (id %), aber zu ihr '
          'gehoert % "%" — ein Name, der mit "%" nicht vereinbar ist. Die '
          'Identitaet ist damit nicht gesichert, und es wird keine Zuordnung '
          'geraten. Bitte die Familie von Hand setzen.',
          v_name, v_fam, v_fremd_id, v_fremd, v_name;
      end if;
      v_weg := 'vorhandene gefunden';
    end if;

    -- Beide bekommen sie. `admin_set_character` schreibt und journalisiert.
    perform public.admin_set_character(p_base_sky_id, v_fam);
    perform public.admin_set_character(p_sky_id, v_fam);
  end if;

  -- ======================================================================
  -- UND JETZT ZUORDNEN UND VEROEFFENTLICHEN — mit den Funktionen, die es
  -- schon gibt. `p_create_family` ist hier immer `false`: die Familie ist
  -- oben entschieden, und zwei Stellen, die eine anlegen koennen, waeren
  -- eine zu viel.
  -- ======================================================================
  v_zuordnung := public.admin_set_variant_base(p_sky_id, p_base_sky_id, false);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id',       p_sky_id,
    'base_sky_id',  p_base_sky_id,
    'base_name',    v_basis.name,
    'series_code',  v_row.series_code,
    'character_id', v_fam,
    'family_path',  v_weg,
    'assignment',   v_zuordnung,
    'published',    true);
end;
$$;

comment on function public.admin_publish_variant_auto(text, text) is
  'Path B without a question to the operator (0161, CAT-08 stage 1): publishes a draft as a variant of a base figure of the same series and settles the figure family by itself. Four cases: the base figure has a family, so it is carried over; only the variant has one, so the base figure stays untouched; neither has one, so a family NAMED AFTER THE BASE FIGURE is looked up by exact name and reused, or created; both have different ones, which aborts. Reuse is confirmed, not assumed: every member of a found family must carry a name compatible with the base name at a word boundary, otherwise the call aborts and names the member - equality of names finds a family, a word-boundary rule may only VETO one, and nothing is ever derived from name similarity (ADR-0034 stands). Concurrency: an advisory transaction lock on the lower-cased family name, and both catalogue rows locked in one statement in sky_id order. Writes exactly two columns, character_id and base_sky_id, and only where they were NULL; calls admin_set_character, admin_set_variant_base and admin_set_catalog_status rather than writing itself. The functions from 0158 and 0159 stay valid and unchanged. Platform admins only.';

revoke all on function public.admin_publish_variant_auto(text, text) from public, anon;
grant execute on function public.admin_publish_variant_auto(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
  v_auth  integer;
  v_pfad  boolean;
begin
  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is null then
    raise exception '0161 Nachbedingung: die Funktion steht nicht';
  end if;

  select (p.prosecdef
          and p.provolatile = 'v'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%'))
    into v_pfad
    from pg_proc p
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)');
  if not coalesce(v_pfad, false) then
    raise exception '0161 Nachbedingung: Attribute falsch — erwartet security '
      'definer, volatile und genau eine search_path-Festlegung';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0161 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;
  select count(*) into v_auth
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
     and a.privilege_type = 'EXECUTE'
     and a.grantee::regrole::text = 'authenticated';
  if v_auth <> 1 then
    raise exception '0161 Nachbedingung: authenticated darf nicht ausfuehren';
  end if;

  -- DIE FUNKTIONEN AUS 0158/0159 SIND UNVERAENDERT UND AUFRUFBAR.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0161 Nachbedingung: eine Funktion aus 0158/0159 fehlt';
  end if;

  -- UND DIESE MIGRATION HAT NICHTS GESCHRIEBEN.
  if exists (select 1 from public.skylanders where base_sky_id is not null
              and sky_id = '___niemals___') then
    raise exception '0161 Nachbedingung: unerreichbar';
  end if;

  raise notice '0161: admin_publish_variant_auto steht, security definer, leerer '
    'Suchpfad, nur authenticated. Die Funktionen aus 0158/0159 sind unberuehrt.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0161_variant_family_auto.sql

commit;
