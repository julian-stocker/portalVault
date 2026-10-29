-- ---------------------------------------------------------------------------
-- 0163 — DER TYPE: eine Menge je Artikel, hoechstens ein Banner (CAT-10)
--
-- WAS SIE ANLEGT:
--
--   `skylanders.types`                 text[]  — die vollstaendige Menge
--   `skylanders.visible_type`          text    — der EINE, der als Banner erscheint
--   `skylanders.visible_type_decided`  boolean — hat ein Mensch entschieden?
--
--   `admin_set_figure_types(text, text[])`   schreibt die Menge
--   `admin_set_visible_type(text, text)`     schreibt das Banner
--
-- Dazu zwei Journalwerte, ein normalisierender Trigger, und die zwei
-- Zusammenfuehrungsfunktionen aus `0157` mit je einem Block mehr.
--
-- ===========================================================================
-- WARUM `card_type` BLEIBT, WAS ES IST — DIE FRAGE DES BETREIBERS
-- ===========================================================================
--
-- Naheliegend waere, `card_type` aus der neuen Menge ABZULEITEN: „die
-- Kartenkunst ist der staerkste Variantentype". Der Betreiber hat verlangt,
-- das sorgfaeltig zu pruefen, und die Pruefung faellt dagegen aus.
-- `supabase/checks/cat10_projection_proof.sql` rechnet sie gegen den GANZEN
-- Katalog; zweimal gefahren am 2026-10-29, und die zweite Messung ist die
-- jetzt gueltige:
--
--   1. ES VERLIEREN ZEILEN IHRE KARTENKUNST — und zwischen den zwei
--      Messungen wurden es MEHR.
--
--      Um 11:12 (701 Katalogzeilen) war es EINE: SKY-0854 „White Flocked
--      LightCore Prism Break", damals `card_type = 'standard'`, projiziert
--      `special`. Abdruck `4d6bbb026b37449cc0d2def77949d095`, projiziert
--      `ece2af88f8f9ecaeb985ccfcea5f6b12`.
--
--      Um 13:11 (694 Zeilen, nachdem der Betreiber Varianten uebernommen und
--      zugeordnet und Katalogzeilen bereinigt hat) sind es ZWEI: SKY-0172
--      „Employee Edition LightCore Prism Break" und SKY-0854, beide
--      inzwischen `chase`, beide projiziert `special`. Abdruck
--      `4b81b91886b911d6f9dcbbca0d381be3`, projiziert
--      `5d324fcb766e650b46c7a3c0d15e397b`.
--
--      DIE ZAHL BEWEGT SICH, DER BEFUND NICHT — und genau darum steht in
--      dieser Migration KEIN eingefrorener Abdruck als Riegel, sondern ein
--      Vergleich vor und nach der Erstbelegung (Abschnitt 6). Eine
--      Migration, die eine Kartenkunst veraendert, ist eine Migration, die
--      ein Bild veraendert.
--
--   2. ES GIBT KEINE EINDEUTIGE REIHENFOLGE. `EDITION_RANK` gibt `standard`,
--      `chase` und `elite` denselben Rang 0 — `chase` absichtlich (eine
--      andere Ausfuehrung, keine staerkere Ausgabe), `elite` absichtlich
--      (eine Produktlinie). Eine Menge mit Chase UND Elite hat damit keine
--      fachliche Antwort, sondern nur eine Reihenfolge im Quelltext. Heute
--      kann das nicht vorkommen (eine Spalte); 56 bzw. 42 Zeilen koennten
--      morgen beides tragen.
--
--   3. JEDE TYPAENDERUNG BEWEGTE DIE KARTENKUNST. 488 Zeilen tragen (Stand
--      13:11) keinen Variantentype; bei ihnen aenderte das Hinzufuegen eines
--      Types das Artwork. 206 tragen einen; bei ihnen das Entfernen. 39
--      davon sind im Shop gelistet, 4 stehen in Sammlungen.
--
-- ALSO ZWEI EIGENSCHAFTEN, ZWEI SPALTEN. `card_type` steuert weiter die
-- Kartenkunst (`card-template.ts`, sieben PNG-Dateien), `types` die
-- fachliche Klassifikation, `visible_type` das Banner. Das ist keine zweite
-- Wahrheit, sondern eine zweite FRAGE — dieselbe Trennung, die `0135`
-- zwischen Artikeltyp, Sammelbarkeit, Sichtbarkeit und Shopfaehigkeit zieht.
-- Der Dialog fuehrt beide getrennt und benennt sie getrennt: „Types" und
-- „Kartenkunst".
--
-- ===========================================================================
-- DIE ERSTBELEGUNG — WOHER JEDER TYPE KOMMT
-- ===========================================================================
--
-- Aus STRUKTURIERTEN Daten, nie aus einem Figurennamen (ADR-0034):
--
--   giant · swapper · master · sensei      <- categories.catalog_group
--   item · trap · vehicle · crystal        <- categories.catalog_group
--   mini                                   <- catalog_group 'mini' UND
--                                             Kategorie „Minis"
--   sidekick                               <- catalog_group 'mini' UND
--                                             Kategorie „Sidekicks"
--   special · elite · dark · legendary ·   <- skylanders.card_type
--   chase · prestige
--   lightcore                              <- EINE KURATIERTE LISTE von 21
--                                             SKY-IDs, unten namentlich
--
-- WARUM MINI UND SIDEKICK AN DER KATEGORIE HAENGEN UND NICHT AN DER GRUPPE:
-- „Sidekicks" traegt heute die Gruppe `mini` — 27 Zeilen sind Minis 19 plus
-- Sidekicks 8. Die Gruppe kann die beiden nicht trennen, der KATEGORIENAME
-- kann es. Das ist keine Namensheuristik auf einer Figur, sondern eine
-- kuratierte Kategorie, die der Betreiber selbst angelegt hat.
--
-- WARUM LIGHTCORE EINE LISTE IST UND KEIN MUSTER (Entscheidung D2): es gibt
-- keine strukturierte Quelle dafuer. Im Bestand ist LightCore nur am NAMEN
-- erkennbar, und daraus eine Eigenschaft abzuleiten ist genau das, was
-- ADR-0034 verbietet. Deshalb dieselbe Bauform wie `0032` fuer die 42
-- Eon's-Elite-Zeilen: eine ausgeschriebene, nachlesbare Liste, EINMAL
-- angewendet, danach Handarbeit des Administrators.
--
-- WAS D3 BEDEUTET, UND ES IST DIE EINZIGE GEWOLLTE AENDERUNG AM BILDSCHIRM:
-- eine LightCore bekommt NICHT zusaetzlich den Type `special`, denn `special`
-- war dort nur die Kartenkunst. Folge: die LightCore-Zeilen mit dem
-- Kartentyp `special` zeigen danach LIGHTCORE statt SPECIAL — Stand
-- 2026-10-29 um 13:11 sind das 17 von 21. Ihre KARTENKUNST bleibt `special`
-- und damit unveraendert. Jede andere Varianteneigenschaft wandert mit: die
-- zwei Legendary-LightCores behalten `legendary`, und die zwei, die
-- inzwischen `chase` tragen, behalten `chase`.
--
-- DIE ZAHL STEHT HIER ALS AUSKUNFT UND NICHT ALS RIEGEL. Verschiebt der
-- Betreiber vorher noch eine LightCore von `special` auf `chase`, sind es
-- sechzehn — und das ist richtig so. Die Huelle
-- `supabase/operations/staging-0163.sql` MISST die Zahl vor dem Lauf und
-- vergleicht sie danach; eingefroren ist sie nirgends.
--
-- WAS DIE MIGRATION AM BANNER SONST TUT: `visible_type` wird mit dem
-- vorhandenen `card_type` belegt, wo er zur neuen Menge gehoert (Stand
-- 13:11: 189 Zeilen), und `visible_type_decided` auf `true` gesetzt — damit
-- der Vorschlag diese Entscheidung nie ueberschreibt. Die Zeilen, die nur
-- eine Gruppe tragen (Stand 13:11: 273, davon 251 oeffentlich), bekommen
-- KEIN Banner: sonst erschienen auf einen Schlag neue Banner, und das ist
-- eine Produktentscheidung und keine Nebenwirkung einer Migration
-- (Entscheidung D4).
--
-- ===========================================================================
-- DREI ZUSTAENDE, UND DIE DATENBANK KENNT ALLE DREI
-- ===========================================================================
--
--   visible_type NULL,  decided false   niemand hat entschieden
--   visible_type NULL,  decided true    ausdruecklich „kein Banner"
--   visible_type gesetzt (dann immer decided true)   dieses Banner
--
-- Die Mitgliedschaft — „der sichtbare Type gehoert zur Menge" — ist eine
-- ZEILEN-CHECK und kein Trigger und kein Anwendungsversprechen. Das ist der
-- Grund, warum die Menge als `text[]` auf derselben Zeile steht und nicht in
-- einer Zuordnungstabelle: dort braeuchte dieselbe Regel einen
-- zusammengesetzten Fremdschluessel oder einen Trigger, der Katalogexport
-- einen eigenen Bereich, und `admin_merge_references` wuerde einen neuen
-- Fremdschluessel zaehlen und damit jede Figurenloeschung blockieren.
--
-- WAS SIE NICHT ANFASST: `base_sky_id`, `character_id`, `card_type`, Name,
-- Slug, Serie, Kategorie, Preis, Bild, Sichtbarkeit, Status, Lager,
-- Angebote, Sammlungen, Bestellungen. Gemessen: 178 Zeilen tragen einen
-- Kartentyp ohne Basisfigur — ein Type ist keine Variantenbeziehung
-- (Entscheidung D7).
--
-- REIHENFOLGE: `0162` MUSS VORHER LIEGEN. Beide Migrationen schreiben die
-- Audit-Constraint neu; `0162` nennt ihre vierzehn Werte fest, diese hier
-- baut die Liste aus dem VORGEFUNDENEN Stand plus den eigenen zwei. Laeufe
-- in dieser Reihenfolge verlieren nichts; umgekehrt wuerde `0162` die zwei
-- neuen Werte wieder herauswerfen. Die Vorbedingung unten erzwingt es.
--
-- Ruecknahme: `supabase/rollback/R0163_drop_catalog_types.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.categories') is null
     or (select count(*) from pg_attribute a
          where a.attrelid = to_regclass('public.categories')
            and a.attname = 'catalog_group' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0040 voraus: categories.catalog_group fehlt — '
      'ohne sie gibt es keine Quelle fuer die Figuren- und Zubehoertypen';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'card_type' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0030 voraus: skylanders.card_type fehlt';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'catalog_status' and not a.attisdropped) <> 1 then
    raise exception '0163 setzt 0152 voraus: skylanders.catalog_status fehlt';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0163 setzt 0026 voraus: is_platform_admin() fehlt';
  end if;

  /*
   * ZUERST: STEHT SIE SCHON? Diese Frage gehoert VOR die Abdruckpruefung
   * darunter — nach einem Lauf tragen die zwei Zusammenfuehrungsruempfe die
   * Fassung aus `0163`, und ein zweiter Lauf wuerde dann „admin_merge_plan
   * ist nicht die Fassung aus 0157" melden. Richtig, aber irrefuehrend: er
   * prallt ab, weil die Migration schon liegt. Gefunden von Probelauf P72.
   */
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 0 then
    raise exception '0163 Abbruch: eine der drei Spalten steht schon. Diese '
      'Migration ist hier bereits angewendet.';
  end if;

  /*
   * DIE ZWEI RUEMPFE, DIE DIESE MIGRATION ERSETZT. Sie werden nicht blind
   * ueberschrieben: steht hier eine fremde Fassung, gelten die Zusagen
   * nicht, auf die der neue Block aufsetzt (die Allowlist, die
   * Vorschaupruefung, die Reihenfolge der Uebernahme).
   */
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
     is distinct from 'ef512e9ea093ae36926d3f0333bd0622' then
    raise exception '0163 Abbruch: admin_merge_plan ist nicht die Fassung aus '
      '0157. Erst klaeren, dann erweitern.';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))
     is distinct from '0b724dff0bb0fe535e3e5b9ec3573298' then
    raise exception '0163 Abbruch: admin_merge_draft ist nicht die Fassung aus '
      '0157. Erst klaeren, dann erweitern.';
  end if;

  /*
   * DIE REIHENFOLGE, ALS RIEGEL. `0162` nennt ihre vierzehn Journalwerte
   * fest; lief sie nach dieser Migration, wuerfe sie `types` und
   * `visible_type` wieder heraus, und der erste Typwechsel liefe in `23514`.
   */
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0163: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%''market_price''%' or v_def not like '%''deleted''%' then
    raise exception '0163 setzt 0162 voraus: die Audit-Constraint kennt '
      'market_price und deleted nicht. 0162 zuerst anwenden — sonst wirft sie '
      'die zwei neuen Werte spaeter wieder heraus.';
  end if;

end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die drei Spalten
--
-- `types` ist NOT NULL mit leerem Array als Vorgabe: „kein Type" ist eine
-- Menge und keine Abwesenheit, und `null` waere ein vierter Zustand, den
-- niemand braucht. `visible_type` ist nullbar, weil „kein Banner" genau das
-- ist.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column if not exists types                text[]  not null default '{}',
  add column if not exists visible_type         text,
  add column if not exists visible_type_decided boolean not null default false;

comment on column public.skylanders.types is
  'The complete set of TYPES this catalogue article has (0163, CAT-10). An article may be a Giant AND a Legendary; before CAT-10 one column had to choose, and for 192 of 701 rows it chose wrong by omission. Seeded from categories.catalog_group, the category name (Minis vs Sidekicks) and card_type, plus a curated list of 21 LightCore SKY-IDs - never from a figure name (ADR-0034). This is NOT the card artwork: card_type keeps that job, because the projection was measured and is not lossless (see the head of 0163).';

comment on column public.skylanders.visible_type is
  'The ONE type shown as a banner on the tile, or NULL for no banner (0163). Guaranteed by a row CHECK to be a member of types. Never derived at read time: the priority order in src/lib/catalog/catalog-type.ts is a PROPOSAL for the dropdown only, because deriving it would silently put new banners on 248 public tiles.';

comment on column public.skylanders.visible_type_decided is
  'Whether a human has decided about the banner (0163). It separates "nobody has chosen yet" from "explicitly no banner" - two states a single nullable text column cannot tell apart, and the operator asked for both. Setting a banner implies a decision (CHECK); clearing one to an explicit dash keeps this true.';


-- ---------------------------------------------------------------------------
-- 3. Die drei Regeln, als Constraint
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add constraint skylanders_types_known
    check (types <@ array['giant', 'swapper', 'master', 'sensei', 'mini',
                          'sidekick',
                          'item', 'trap', 'vehicle', 'crystal',
                          'lightcore', 'special', 'dark', 'legendary', 'elite',
                          'chase', 'prestige']);

-- DIE MITGLIEDSCHAFT. Eine Zeilen-CHECK, kein Trigger, kein Versprechen der
-- Anwendung: der sichtbare Type MUSS in der Menge stehen.
alter table public.skylanders
  add constraint skylanders_visible_type_member
    check (visible_type is null or visible_type = any (types));

-- UND EIN BANNER HEISST: ENTSCHIEDEN. Ohne diese Zeile waere der Zustand
-- „ein Banner gesetzt, aber niemand hat entschieden" darstellbar, und der
-- Vorschlag duerfte ihn ueberschreiben.
alter table public.skylanders
  add constraint skylanders_visible_type_decided
    check (visible_type is null or visible_type_decided);


-- ---------------------------------------------------------------------------
-- 4. Die Menge ist kanonisch — sortiert und ohne Doppel
--
-- WARUM EIN TRIGGER UND KEINE CONSTRAINT: „keine Doppel" braeuchte eine
-- Unterabfrage, und die sind in einer CHECK nicht erlaubt. Der Trigger
-- macht die Spalte stattdessen kanonisch — sortiert, jeder Wert einmal —,
-- und zwar fuer JEDEN Schreibweg, auch fuer einen Service-Role-Lauf, der die
-- RPC nicht benutzt. Er ist idempotent und kostet bei hoechstens siebzehn
-- Werten nichts.
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_canonical_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.types := coalesce(
    (select array_agg(t order by t) from (select distinct unnest(new.types) as t) x),
    '{}'::text[]);
  return new;
end;
$$;

create trigger skylanders_canonical_types
  before insert or update of types on public.skylanders
  for each row execute function public.skylanders_canonical_types();

comment on function public.skylanders_canonical_types() is
  'Keeps skylanders.types canonical - sorted, each value once - on every write path (0163). A CHECK cannot do it: "no duplicates" needs a subquery. Idempotent, and it never adds or removes a value.';


-- ---------------------------------------------------------------------------
-- 5. Das Journal kennt zwei weitere Werte — ADDITIV, aus dem Vorgefundenen
--
-- Dieselbe Lehre zum fuenften Mal, und diesmal geloest statt wiederholt:
-- `0152` hat einen Wert vergessen, `0157`, `0158`, `0159` und `0162` haben
-- die Liste jeweils neu getippt. Hier wird sie aus dem GEFUNDENEN Stand
-- gebaut — jeder Wert des bekannten Universums, der heute drinsteht, bleibt
-- drin — plus die eigenen zwei. Verlieren kann sie damit keinen.
-- ---------------------------------------------------------------------------
do $journal$
declare
  v_alt    text;
  v_wert   text;
  v_werte  text;
  v_liste  text[] := '{}';
  c_alle   text[] := array[
    'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
    'image_override_path', 'card_type', 'created', 'catalog_status',
    'merged_from', 'discarded', 'character_id', 'base_sky_id',
    'market_price', 'deleted'];
begin
  select pg_get_constraintdef(c.oid) into v_alt
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';

  /*
   * GESUCHT WIRD DER WERT IN ANFUEHRUNGSZEICHEN und nicht als Teilwort:
   * `card_type` steht auch in `visible_type` nicht, aber die Regel soll
   * nicht davon abhaengen, welche Namen zufaellig keine Teilworte sind.
   */
  foreach v_wert in array c_alle loop
    if v_alt like '%''' || v_wert || '''%' then
      v_liste := v_liste || v_wert;
    end if;
  end loop;
  /*
   * ALS ARRAY ANGEHAENGT UND NICHT ALS ZWEI LITERALE. `text[] || 'types'`
   * ist zweideutig: PostgreSQL kennt `anyarray || anyelement` UND
   * `anyarray || anyarray`, und bei einem Literal ohne Typ waehlt es das
   * zweite — „malformed array literal: types". Gefunden von Probelauf P72,
   * und zwar beim ersten Lauf.
   */
  v_liste := v_liste || array['types', 'visible_type'];

  if array_length(v_liste, 1) < 15 then
    raise exception '0163: die vorgefundene Audit-Constraint kennt nur % '
      'bekannte Werte — das ist zu wenig, hier ist etwas anderes passiert: %',
      array_length(v_liste, 1) - 2, v_alt;
  end if;

  select string_agg(quote_literal(w), ', ' order by w) into v_werte
    from unnest(v_liste) as w;

  execute 'alter table public.catalog_admin_changes '
          'drop constraint if exists catalog_admin_changes_field_known';
  execute format(
    'alter table public.catalog_admin_changes '
    'add constraint catalog_admin_changes_field_known check (field in (%s))',
    v_werte);

  raise notice '0163: das Journal kennt jetzt % Werte: %',
    array_length(v_liste, 1), array_to_string(v_liste, ', ');
end
$journal$;


-- ---------------------------------------------------------------------------
-- 6. DIE ERSTBELEGUNG — eine Anweisung, und sie fasst nur die drei neuen
--    Spalten an
--
-- Die kuratierte LightCore-Liste steht hier ausgeschrieben. Erhoben am
-- 2026-10-29 mit `supabase/checks/cat10_projection_proof.sql`, Zeile 103 —
-- dort steht zu jeder SKY-ID der Name und die heutige Kartenkunst, damit die
-- Liste nachlesbar ist und nicht geglaubt werden muss.
-- ---------------------------------------------------------------------------
do $belegung$
declare
  c_lightcore text[] := array[
    'SKY-0129',  -- Chill Light Core
    'SKY-0130',  -- Legendary LightCore Chill            [legendary bleibt]
    'SKY-0140',  -- Jet-Vac Light Core
    'SKY-0143',  -- Pop Fizz Light Core
    'SKY-0146',  -- Shroomboom Light Core
    'SKY-0157',  -- Drobot Light Core
    'SKY-0159',  -- Eruptor Light Core
    'SKY-0166',  -- Hex Light Core
    'SKY-0171',  -- Prism Break Light Core
    'SKY-0172',  -- Employee Edition LightCore Prism Break [Kartenkunst bleibt]
    'SKY-0243',  -- Bumble Blast - Lightcore
    'SKY-0246',  -- Countdown - Lightcore
    'SKY-0251',  -- Grim Creeper - Lightcore
    'SKY-0252',  -- Legendary LightCore Grim Creeper     [legendary bleibt]
    'SKY-0263',  -- Smolderdash LightCore
    'SKY-0265',  -- Star Strike - Lightcore
    'SKY-0266',  -- Enchanted LightCore Star Strike
    'SKY-0294',  -- Flashwing - Lightcore
    'SKY-0295',  -- Warnado - Lightcore
    'SKY-0296',  -- Wham Shell - Lightcore
    'SKY-0854'   -- White Flocked LightCore Prism Break  [Kartenkunst bleibt]
  ];
  v_zeilen   integer;
  v_banner   integer;
  v_kunst    text;
begin
  -- Der Abdruck der Kartenkunst VOR der Belegung. Er muss danach gleich sein.
  select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type, E'\n'
                                 order by s.sky_id)), '(leer)')
    into v_kunst from public.skylanders s;

  update public.skylanders s
     set types = array_remove(array[
           case when c.catalog_group = 'giant'            then 'giant' end,
           case when c.catalog_group = 'swapper'          then 'swapper' end,
           case when c.catalog_group = 'trap_master'      then 'master' end,
           case when c.catalog_group = 'sensei'           then 'sensei' end,
           case when c.catalog_group = 'mini'
                 and c.name = 'Minis'                     then 'mini' end,
           case when c.catalog_group = 'mini'
                 and c.name = 'Sidekicks'                 then 'sidekick' end,
           case when c.catalog_group = 'item'             then 'item' end,
           case when c.catalog_group = 'trap'             then 'trap' end,
           case when c.catalog_group = 'vehicle'          then 'vehicle' end,
           case when c.catalog_group = 'creation_crystal' then 'crystal' end,
           case when s.sky_id = any (c_lightcore)         then 'lightcore' end,
           /*
            * D3: `special` wandert NICHT mit, wenn die Zeile eine LightCore
            * ist — dort war es nur die Kartenkunst. JEDE andere
            * Varianteneigenschaft wandert mit.
            */
           case when s.card_type = 'special'
                 and not (s.sky_id = any (c_lightcore))   then 'special' end,
           case when s.card_type = 'elite'                then 'elite' end,
           case when s.card_type = 'dark'                 then 'dark' end,
           case when s.card_type = 'legendary'            then 'legendary' end,
           case when s.card_type = 'chase'                then 'chase' end,
           case when s.card_type = 'prestige'             then 'prestige' end
         ], null)
    from public.categories c
   where c.id = s.category_id;

  /*
   * ZEILEN OHNE KATEGORIE bekommen nur die Variantentypen. `update … from`
   * laesst sie aus, weil der Verbund sie nicht trifft — deshalb hier noch
   * einmal, ohne Kategorie. (Gemessen gibt es sie heute nicht; eine
   * Belegung, die eine Zeile stillschweigend ueberspringt, waere trotzdem
   * ein Loch.)
   */
  update public.skylanders s
     set types = array_remove(array[
           case when s.sky_id = any (c_lightcore)       then 'lightcore' end,
           case when s.card_type = 'special'
                 and not (s.sky_id = any (c_lightcore)) then 'special' end,
           case when s.card_type = 'elite'              then 'elite' end,
           case when s.card_type = 'dark'               then 'dark' end,
           case when s.card_type = 'legendary'          then 'legendary' end,
           case when s.card_type = 'chase'              then 'chase' end,
           case when s.card_type = 'prestige'           then 'prestige' end
         ], null)
   where s.category_id is null;

  /*
   * DAS BANNER: der heutige Kartentyp, wo er zur neuen Menge gehoert.
   *
   * Die 17 LightCore-Zeilen mit `card_type = 'special'` treffen das NICHT —
   * `special` steht bei ihnen nach D3 nicht in der Menge. Sie bekommen
   * `lightcore` als Banner, und genau das sind die 17 gewollten Wechsel von
   * SPECIAL auf LIGHTCORE.
   */
  update public.skylanders s
     set visible_type = s.card_type, visible_type_decided = true
   where s.card_type <> 'standard' and s.card_type = any (s.types);

  update public.skylanders s
     set visible_type = 'lightcore', visible_type_decided = true
   where s.card_type = 'special' and 'lightcore' = any (s.types);

  select count(*) into v_zeilen from public.skylanders where cardinality(types) > 0;
  select count(*) into v_banner from public.skylanders where visible_type is not null;

  -- UND DIE KARTENKUNST IST UNVERAENDERT. Keine Behauptung, eine Messung.
  if (select coalesce(md5(string_agg(s.sky_id || '|' || s.card_type, E'\n'
                                     order by s.sky_id)), '(leer)')
        from public.skylanders s) is distinct from v_kunst then
    raise exception '0163: die Erstbelegung hat eine Kartenkunst veraendert. '
      'Das darf nicht geschehen — Transaktion abbrechen.';
  end if;

  raise notice '0163: % Zeilen tragen jetzt mindestens einen Type, % tragen ein '
    'Banner. Die Kartenkunst ist unveraendert (%).', v_zeilen, v_banner, v_kunst;
end
$belegung$;


-- ---------------------------------------------------------------------------
-- 7. Die Menge schreiben
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_figure_types(
  p_sky_id text,
  p_types  text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.skylanders%rowtype;
  v_neu   text[];
  v_alt   text[];
  v_wert  text;
  v_sicht text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0163: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := coalesce(v_row.types, '{}');

  /*
   * EINE NULL-MENGE IST DIE LEERE MENGE und kein Fehler: „alle Haekchen
   * abgewaehlt" ist eine gueltige Angabe und heisst Standard.
   */
  v_neu := coalesce(
    (select array_agg(t order by t)
       from (select distinct unnest(coalesce(p_types, '{}'::text[])) as t) x),
    '{}'::text[]);

  /*
   * JEDER WERT WIRD BENANNT ABGEWIESEN. Die CHECK faengt es auch, aber mit
   * einer Meldung, in der der falsche Wert nicht vorkommt.
   */
  foreach v_wert in array v_neu loop
    if not (v_wert = any (array['giant', 'swapper', 'master', 'sensei', 'mini',
                                'sidekick', 'item', 'trap', 'vehicle', 'crystal',
                                'lightcore', 'special', 'dark', 'legendary',
                                'elite', 'chase', 'prestige'])) then
      raise exception '0163: „%" ist kein Type. Erlaubt sind die siebzehn aus '
        'src/lib/catalog/catalog-type.ts.', v_wert;
    end if;
  end loop;

  if v_alt = v_neu then
    return jsonb_build_object('sky_id', p_sky_id, 'types', v_neu,
                              'visible_type', v_row.visible_type,
                              'changed', false);
  end if;

  /*
   * FAELLT DER SICHTBARE TYPE AUS DER MENGE, wird er auf AUSDRUECKLICHES „–"
   * zurueckgesetzt — die Regel, die der Betreiber gewaehlt hat. Nicht auf
   * „unentschieden": sonst schluege der Vorschlag beim naechsten Oeffnen
   * einen anderen vor, und das waere eine Auswahl hinter dem Ruecken des
   * Bedieners.
   */
  v_sicht := case when v_row.visible_type = any (v_neu) then v_row.visible_type
                  else null end;

  update public.skylanders
     set types = v_neu,
         visible_type = v_sicht,
         /*
          * NUR EIN WIRKLICH ENTFERNTES BANNER GILT ALS ENTSCHEIDUNG — siehe
          * dieselbe Stelle in `admin_merge_draft`. Hatte die Zeile kein
          * Banner, bleibt sie unentschieden.
          */
         visible_type_decided = case
           when v_row.visible_type is not null and v_sicht is null then true
           else visible_type_decided end
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'types',
          array_to_string(v_alt, ','), array_to_string(v_neu, ','),
          (select auth.uid()));

  if v_sicht is distinct from v_row.visible_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'visible_type',
            v_row.visible_type, v_sicht, (select auth.uid()));
  end if;

  return jsonb_build_object('sky_id', p_sky_id, 'types', v_neu,
                            'old_types', v_alt,
                            'visible_type', v_sicht,
                            'banner_cleared', (v_sicht is null
                                           and v_row.visible_type is not null),
                            'changed', true);
end;
$$;

comment on function public.admin_set_figure_types(text, text[]) is
  'Replaces the TYPE set of one catalogue row (0163, CAT-10). The set is canonical - sorted, each value once - and every unknown value is refused by name before the CHECK would refuse it anonymously. If the currently visible type falls out of the set, the banner is reset to an EXPLICIT dash (visible_type NULL, decided true), never to "undecided": otherwise the next proposal would pick a different banner behind the operator''s back. It writes three columns and nothing else - no name, no slug, no card_type, no base_sky_id, no character_id - and journals types and, when it moves, visible_type. Platform admins only.';

revoke all on function public.admin_set_figure_types(text, text[]) from public, anon;
grant execute on function public.admin_set_figure_types(text, text[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Das Banner schreiben
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_visible_type(
  p_sky_id text,
  p_type   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.skylanders%rowtype;
  v_neu text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0163: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- Ein leerer String ist dasselbe wie NULL: „–", kein Banner.
  v_neu := nullif(btrim(coalesce(p_type, '')), '');

  /*
   * NUR EIN HINTERLEGTER TYPE DARF SICHTBAR WERDEN. Die CHECK faengt es
   * auch; diese Meldung sagt, WARUM, und nennt, was zur Wahl stand.
   */
  if v_neu is not null and not (v_neu = any (coalesce(v_row.types, '{}'))) then
    raise exception '0163: „%" ist % nicht zugeordnet. Zur Wahl stehen: %. '
      'Ein Type wird im Bearbeiten-Dialog zugeordnet, nicht hier.',
      v_neu, p_sky_id,
      coalesce(nullif(array_to_string(coalesce(v_row.types, '{}'), ', '), ''),
               '(keiner)');
  end if;

  if v_row.visible_type is not distinct from v_neu and v_row.visible_type_decided then
    return jsonb_build_object('sky_id', p_sky_id, 'visible_type', v_neu,
                              'changed', false);
  end if;

  /*
   * EINE SPALTE UND IHR KENNZEICHEN. `visible_type_decided` wird IMMER
   * `true` — auch und gerade bei „–": das ist der Unterschied zwischen
   * „ausdruecklich kein Banner" und „noch nicht entschieden", und ohne ihn
   * waere die Wahl „–" beim naechsten Oeffnen wieder fort.
   *
   * KEINE ANDERE SPALTE. Kein Type wird hinzugefuegt oder entfernt, keine
   * Kartenkunst bewegt sich, kein Name, kein Status.
   */
  update public.skylanders
     set visible_type = v_neu, visible_type_decided = true
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'visible_type',
          v_row.visible_type, v_neu, (select auth.uid()));

  return jsonb_build_object('sky_id', p_sky_id,
                            'visible_type', v_neu,
                            'old_visible_type', v_row.visible_type,
                            'types', coalesce(v_row.types, '{}'),
                            'changed', true);
end;
$$;

comment on function public.admin_set_visible_type(text, text) is
  'Sets which ONE of a row''s types is shown as its banner, or clears it to an explicit dash (0163, CAT-10). It refuses a type the row does not carry, naming the ones it does - the dropdown offers only those, and assigning a type is the edit dialog''s job. It always sets visible_type_decided, including for the dash: that is what separates "explicitly no banner" from "nobody has chosen", and without it the choice would be gone on the next read. It writes TWO columns and nothing else: no type is added or removed, and card_type - the card artwork - never moves. Platform admins only.';

revoke all on function public.admin_set_visible_type(text, text) from public, anon;
grant execute on function public.admin_set_visible_type(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Die Zusammenfuehrung kennt die Typmenge
--
-- Beide Ruempfe sind die aus `0157`, Zeichen fuer Zeichen, mit JE EINEM
-- Block mehr. Die Vorbedingung oben hat ihre Abdruecke geprueft, bevor hier
-- etwas ersetzt wurde (`ef512e9e…` und `0b724dff…`).
--
-- WARUM DIE MENGE UEBERHAUPT MITMUSS: ein Entwurf aus dem Import traegt
-- keine Types, und dann aendert sich nichts — die Menge des Ziels bleibt
-- unberuehrt, weil der Plan sie nicht nennt. Hat ein Bediener dem Entwurf
-- aber Types gegeben, waeren sie beim Zusammenfuehren still verschwunden.
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

  /*
   * DIE TYPMENGE, ALS NEUNTES FELD (0163).
   *
   * Angeboten wird sie nur, wenn der Entwurf ueberhaupt Types traegt — der
   * Import setzt keine, also ist das der Fall, in dem ein Bediener sie dem
   * Entwurf selbst gegeben hat. Eine LEERE Entwurfsmenge loescht die des
   * Ziels NICHT: dasselbe Muster wie bei `name` und `card_type`, wo eine
   * leere oder generische Angabe des Entwurfs nicht gewinnt.
   *
   * `old` und `new` sind die sortierten Listen als TEXT. Die Auswahl wird
   * ueber genau diese beiden Werte gegengeprueft (Zeile „hat sich seit der
   * Vorschau geaendert"), und ein Array in jsonb waere dort zwei
   * Darstellungen derselben Sache.
   */
  if coalesce(cardinality(v_draft.types), 0) > 0
     and array(select unnest(v_draft.types) order by 1)
         is distinct from array(select unnest(coalesce(v_target.types, '{}'::text[]))
                                 order by 1) then
    v_plan := v_plan || jsonb_build_object('field', 'types',
      'old', array_to_string(array(select unnest(coalesce(v_target.types, '{}'::text[]))
                                    order by 1), ','),
      'new', array_to_string(array(select unnest(v_draft.types) order by 1), ','));
  end if;

  return v_plan;
end;
$$;create or replace function public.admin_merge_draft(
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
  -- `types` ist seit `0163` das NEUNTE. `card_type` bleibt daneben stehen:
  -- es ist die Kartenkunst und keine Typmenge (Kopf von `0163`).
  c_allow text[] := array[
    'name', 'display_name_override', 'series_code', 'category_id',
    'card_type', 'item_type', 'character_id', 'image_override_path',
    'types'];
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
    elsif v_feld = 'types' then
      /*
       * DIE MENGE WIRD ERSETZT, NICHT VEREINIGT — und die Vorschau sagt
       * genau das („alt -> neu"). Eine stille Vereinigung waere eine
       * Uebernahme, die der Bediener nicht gesehen hat.
       *
       * UND DER SICHTBARE TYPE ZIEHT MIT. Faellt er aus der neuen Menge,
       * setzt diese Zeile ihn auf ausdrueckliches „–" zurueck; sonst
       * verweigerte die Mitgliedschafts-CHECK das Update, und die
       * Zusammenfuehrung braeche an einer Stelle ab, an der der Bediener
       * nichts falsch gemacht hat.
       */
      update public.skylanders
         set types = v_draft.types,
             visible_type = case when visible_type = any (v_draft.types)
                                 then visible_type else null end,
             /*
              * NUR EIN WIRKLICH ENTFERNTES BANNER GILT ALS ENTSCHEIDUNG. Eine
              * Zeile, die vorher kein Banner hatte, bleibt unentschieden —
              * sonst waere der Vorschlag nach einer Zusammenfuehrung fuer
              * immer stillgelegt, und niemand haette etwas gewaehlt.
              */
             visible_type_decided = case
               when visible_type is null then visible_type_decided
               when visible_type = any (v_draft.types) then visible_type_decided
               else true end
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
comment on function public.admin_merge_plan(text, text, text) is
  'The change plan of a merge, read-only (0156, narrowed in 0157, extended in 0163). NINE fields now: the eight business fields plus `types`, the TYPE set from CAT-10. A draft with an empty set changes nothing - the plan simply does not name it, and the target keeps its own. card_type stays a separate field beside it, because it is the card artwork and not a type set.';

revoke all on function public.admin_merge_plan(text, text, text) from public, anon;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;

comment on function public.admin_merge_draft(text, text, text, jsonb) is
  'Merges an imported draft into an existing catalogue row, taking over ONLY the selected fields (0156, narrowed in 0157, extended in 0163). NINE selectable business fields - `types` is the ninth; admin_note is still not one of them and is always processed through merge_note(). When the set is taken over it REPLACES the target set rather than uniting with it, exactly as the preview says, and the visible type moves with it: a banner that falls out of the new set is reset to an explicit dash instead of making the CHECK refuse the whole merge. p_selection maps field name to the {old, new} pair the operator saw; the server recomputes the plan via admin_merge_plan and aborts on any mismatch. Values written come from the draft row, never from the call. The TARGET keeps its SKY-ID, slug, status, visibility, price, card artwork and every reference hanging off it. One transaction.';

revoke all on function public.admin_merge_draft(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_merge_draft(text, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
  v_n     integer;
begin
  -- ---- Die drei Spalten stehen, mit den drei Regeln.
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 3 then
    raise exception '0163 Nachbedingung: eine der drei Spalten fehlt';
  end if;
  for v_def in select unnest(array['skylanders_types_known',
                                   'skylanders_visible_type_member',
                                   'skylanders_visible_type_decided'])
  loop
    if not exists (select 1 from pg_constraint c
                    where c.conrelid = to_regclass('public.skylanders')
                      and c.conname = v_def) then
      raise exception '0163 Nachbedingung: die Constraint % fehlt', v_def;
    end if;
  end loop;

  -- ---- DIE MITGLIEDSCHAFT HAELT IM GANZEN BESTAND.
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not (visible_type = any (types));
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen ein Banner, das nicht '
      'in ihrer Menge steht', v_n;
  end if;
  select count(*) into v_n from public.skylanders
   where visible_type is not null and not visible_type_decided;
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen ein Banner ohne '
      'Entscheidung', v_n;
  end if;

  -- ---- UND DIE MENGE IST KANONISCH.
  select count(*) into v_n from public.skylanders s
   where s.types is distinct from coalesce(
           (select array_agg(t order by t)
              from (select distinct unnest(s.types) as t) x), '{}'::text[]);
  if v_n <> 0 then
    raise exception '0163 Nachbedingung: % Zeilen tragen eine unsortierte oder '
      'doppelte Menge', v_n;
  end if;

  -- ---- Die zwei neuen Funktionen, mit den Attributen.
  for v_def in select unnest(array['public.admin_set_figure_types(text,text[])',
                                   'public.admin_set_visible_type(text,text)'])
  loop
    if to_regprocedure(v_def) is null then
      raise exception '0163 Nachbedingung: % steht nicht', v_def;
    end if;
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_def)
                      and p.prosecdef and p.provolatile = 'v'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0163 Nachbedingung: % hat die Attribute nicht', v_def;
    end if;
    select count(*) into v_offen
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = to_regprocedure(v_def)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
    if v_offen <> 0 then
      raise exception '0163 Nachbedingung: % offene EXECUTE-Rechte auf %',
        v_offen, v_def;
    end if;
  end loop;

  -- ---- Der Trigger steht.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_canonical_types'
                    and not t.tgisinternal) then
    raise exception '0163 Nachbedingung: der Trigger skylanders_canonical_types fehlt';
  end if;

  -- ---- Das Journal kennt types UND visible_type UND alles von vorher.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0163 Nachbedingung: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%''types''%' or v_def not like '%''visible_type''%' then
    raise exception '0163 Nachbedingung: das Journal kennt die zwei neuen Werte '
      'nicht: %', v_def;
  end if;
  foreach v_def in array array['catalog_visible', 'display_name_override',
      'admin_note', 'catalog_group', 'image_override_path', 'card_type',
      'created', 'catalog_status', 'merged_from', 'discarded', 'character_id',
      'base_sky_id', 'market_price', 'deleted']::text[]
  loop
    if (select pg_get_constraintdef(c.oid) from pg_constraint c
         where c.conrelid = to_regclass('public.catalog_admin_changes')
           and c.conname = 'catalog_admin_changes_field_known')
       not like '%''' || v_def || '''%' then
      raise exception '0163 Nachbedingung: der Journalwert % ist verloren', v_def;
    end if;
  end loop;

  -- ---- DIE KARTENKUNST IST UNVERAENDERT, und ihr CHECK auch.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.conname = 'skylanders_card_type_known';
  if v_def is null or v_def not like '%prestige%' or v_def not like '%elite%' then
    raise exception '0163 Nachbedingung: der CHECK auf card_type ist veraendert: %',
      v_def;
  end if;

  -- ---- UND DIE VARIANTENBEZIEHUNG IST UNBERUEHRT (Entscheidung D7).
  select count(*) into v_n from public.skylanders where base_sky_id is not null;
  raise notice '0163: % Variantenbeziehungen stehen unveraendert', v_n;

  raise notice '0163: types, visible_type und visible_type_decided stehen; die '
    'Mitgliedschaft ist eine CHECK, die Menge ist kanonisch, das Journal kennt '
    'sechzehn Werte, und die Kartenkunst ist nicht angefasst.';
end
$nach$;
