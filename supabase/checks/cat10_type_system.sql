-- ===========================================================================
-- CAT-10 ANALYSE: was heute „Typ" heisst — und wie viele Eigenschaften eine
-- Katalogzeile dabei verliert.
--
-- DIE FRAGE. Der Betreiber will ein TYPE-System mit MEHRFACHZUORDNUNG und
-- genau EINEM sichtbaren Banner. Dafuer muss zuerst beantwortet sein, was es
-- heute gibt: `skylanders.card_type` (sieben Werte, EINE Spalte),
-- `skylanders.item_type` (fuenf Werte) und `categories.catalog_group` (zehn
-- Werte, an der KATEGORIE und nicht an der Zeile).
--
--   101-110  CARD_TYPE: die Verteilung, und `prestige` — ein Wert, der in
--            der gewuenschten Liste der 17 NICHT vorkommt.
--   201-206  ITEM_TYPE: die Verteilung.
--   301-312  CATALOG_GROUP: welche Kategorie welche Gruppe traegt, wie viele
--            Zeilen daran haengen, und welche Kategorie GAR KEINE hat.
--   401-410  DIE MEHRFACHZUORDNUNG, als Zahl: wie viele Zeilen traegen
--            heute GLEICHZEITIG eine Gruppe (Giant, Trap, Vehicle, …) und
--            einen Kartentyp (Legendary, Dark, …). Das sind genau die
--            Zeilen, bei denen die heutige EINE Spalte eine Eigenschaft
--            verschweigt.
--   501-510  LIGHTCORE: der Type, den es als Wert NICHT gibt. Gemessen am
--            NAMEN — nur hier, nur zur Mengenabschaetzung, und ausdruecklich
--            nicht als Vorschlag, ihn aus Namen abzuleiten.
--   601-608  DIE UEBRIGEN NEUEN: Sidekick, Crystal, Master, Sensei, Mini.
--   701-706  WAS UNBERUEHRT BLEIBEN MUSS: base_sky_id und character_id.
--            Ein Type ist keine Variantenbeziehung.
--   801-806  DAS BANNER HEUTE: wie viele Kacheln eines zeigen.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with zeile as (
  select s.sky_id, s.name, s.card_type, s.item_type, s.catalog_status,
         s.base_sky_id, s.character_id, c.name as kategorie, c.catalog_group
    from public.skylanders s
    left join public.categories c on c.id = s.category_id
),
pruef (nr, bereich, pruefung, befund) as (values
  (1, 'Umgebung', 'Katalogzeilen insgesamt',
      (select count(*)::text from zeile)),

  -- ---------------------------------------------------------- 1. CARD_TYPE
  (101, 'card_type', 'Verteilung (Wert=Zeilen)',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(leer)')
         from (select card_type, count(*) as n from zeile group by card_type) x)),
  (102, 'card_type', 'verschiedene Werte im Bestand',
      (select count(distinct card_type)::text from zeile)),
  (103, 'card_type', 'NULL oder leer (duerfte es nicht geben)',
      (select count(*)::text from zeile
        where card_type is null or btrim(card_type) = '')),
  /*
   * ZEILE 104 IST EINE OFFENE FACHFRAGE. `prestige` steht im CHECK aus
   * `0032` und ist in der gewuenschten Liste der 17 Types NICHT enthalten.
   * Gibt es solche Zeilen, braucht die Umstellung dafuer eine Entscheidung.
   */
  (104, 'card_type', 'Zeilen mit prestige — in den 17 gewuenschten Types NICHT '
                     'enthalten',
      (select count(*)::text from zeile where card_type = 'prestige')),
  (105, 'card_type', 'welche davon (SKY-ID und Name)',
      (select coalesce(string_agg(sky_id || ' ' || name, ' | ' order by sky_id),
                       '(keine)')
         from zeile where card_type = 'prestige')),
  (106, 'card_type', 'Zeilen mit einem Kartentyp ausser standard (= heutige Banner)',
      (select count(*)::text from zeile where card_type <> 'standard')),
  (107, 'card_type', 'der CHECK, wie er heute steht',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_card_type_known')),
  (108, 'card_type', 'Abdruck der Spalte — die Nachkontrolle einer Migration '
                     'nennt ihn wieder',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n' order by sky_id)),
                       '(leer)') from zeile)),

  -- ---------------------------------------------------------- 2. ITEM_TYPE
  (201, 'item_type', 'Verteilung (Wert=Zeilen)',
      (select coalesce(string_agg(coalesce(item_type, '(null)') || '=' || n::text,
                                  ', ' order by n desc), '(leer)')
         from (select item_type, count(*) as n from zeile group by item_type) x)),
  (202, 'item_type', 'Zeilen ohne item_type',
      (select count(*)::text from zeile where item_type is null)),
  /*
   * ZEILE 203 IST DER BEFUND AUS CAT-08, NOCH EINMAL GEMESSEN: `item_type`
   * trennt Traps, Fahrzeuge und Kristalle NICHT — sie sind alle `figure`.
   * Deshalb kann das neue Type-System seine EXTRA-FIGURES-Gruppe nicht aus
   * `item_type` ableiten.
   */
  (203, 'item_type', 'Zeilen mit item_type=figure, deren Kategoriegruppe KEINE '
                     'Charakterfigur ist (Trap, Vehicle, Crystal, Item)',
      (select count(*)::text from zeile
        where item_type = 'figure'
          and catalog_group in ('trap', 'vehicle', 'creation_crystal', 'item'))),

  -- ------------------------------------------------------ 3. CATALOG_GROUP
  (301, 'catalog_group', 'Kategorien insgesamt',
      (select count(*)::text from public.categories)),
  (302, 'catalog_group', 'Gruppe=Kategorien (wie viele Kategorien je Gruppe)',
      (select coalesce(string_agg(coalesce(catalog_group, '(null)') || '=' || n::text,
                                  ', ' order by n desc), '(leer)')
         from (select c.catalog_group, count(*) as n from public.categories c
                group by c.catalog_group) x)),
  (303, 'catalog_group', 'Gruppe=Zeilen (wie viele Katalogzeilen je Gruppe)',
      (select coalesce(string_agg(coalesce(catalog_group, '(ohne)') || '=' || n::text,
                                  ', ' order by n desc), '(leer)')
         from (select catalog_group, count(*) as n from zeile
                group by catalog_group) x)),
  (304, 'catalog_group', 'Kategorien OHNE Gruppe — ihre Zeilen bekaemen keinen '
                         'Figures-Type',
      (select coalesce(string_agg(c.name, ' | ' order by c.name), '(keine)')
         from public.categories c where c.catalog_group is null)),
  (305, 'catalog_group', 'wie viele Zeilen daran haengen',
      (select count(*)::text from zeile where catalog_group is null)),
  (306, 'catalog_group', 'traegt irgendeine Kategorie zwei Gruppen? (unmoeglich — '
                         'eine Spalte; hier nur die Zahl der Kategorien je Name)',
      (select count(*)::text from (select c.name from public.categories c
         group by c.name having count(distinct coalesce(c.catalog_group, '-')) > 1) x)),
  (307, 'catalog_group', 'die Zuordnung Kategorie -> Gruppe, vollstaendig',
      (select coalesce(string_agg(c.name || '=' || coalesce(c.catalog_group, '(ohne)'),
                                  ' | ' order by c.name), '(leer)')
         from public.categories c)),

  /*
   * ZEILE 308 IST DIE FRAGE, OB DIE GRUPPE WIRKLICH DIE ARTIKELART TRIFFT.
   * Nur „Giants grosse Figuren" traegt `giant`; „Giants neue Figuren" und
   * „Giants Series 2 Figuren" tragen `figure`. Fachlich sind das aber auch
   * Giants bzw. gerade NICHT Giants — das muss der Betreiber entscheiden,
   * bevor ein Type daraus abgeleitet wird.
   */
  (308, 'catalog_group', 'Kategorie=Zeilen, vollstaendig — welche Kategorie wie '
                         'viele Zeilen traegt',
      (select coalesce(string_agg(k || '=' || n::text, ' | ' order by k), '(leer)')
         from (select kategorie as k, count(*) as n from zeile
                where kategorie is not null group by kategorie) x)),
  (309, 'catalog_group', 'die drei Giants-Kategorien und ihre Gruppen',
      (select coalesce(string_agg(c.name || '=' || coalesce(c.catalog_group, '(ohne)'),
                                  ' | ' order by c.name), '(keine)')
         from public.categories c where c.name like 'Giants%')),
  (310, 'catalog_group', 'Zeilen in Kategorien, die „Giants" heissen',
      (select count(*)::text from zeile where kategorie like 'Giants%')),

  -- -------------------------------------------- 4. DIE MEHRFACHZUORDNUNG
  /*
   * DIE ZAHL, UM DIE ES GEHT. Eine Zeile mit `catalog_group = 'giant'` UND
   * `card_type = 'legendary'` traegt heute ZWEI fachliche Eigenschaften, und
   * die Kachel kann nur eine zeigen — die Gruppe ueberhaupt nicht, weil sie
   * an der Kategorie haengt und nie auf ein Banner kommt.
   */
  (401, 'Mehrfach', 'Zeilen mit Gruppe UND Kartentyp ausser standard',
      (select count(*)::text from zeile
        where catalog_group is not null and card_type <> 'standard')),
  (402, 'Mehrfach', 'davon mit einer NICHT-Charaktergruppe (Trap, Vehicle, '
                    'Crystal, Item) — das sind die Faelle „Special Trap"',
      (select count(*)::text from zeile
        where catalog_group in ('trap', 'vehicle', 'creation_crystal', 'item')
          and card_type <> 'standard')),
  (403, 'Mehrfach', 'die Kombinationen, die wirklich vorkommen (Gruppe+Typ=Zeilen)',
      (select coalesce(string_agg(k || '=' || n::text, ', ' order by n desc, k),
                       '(keine)')
         from (select coalesce(catalog_group, '(ohne)') || '+' || card_type as k,
                      count(*) as n
                 from zeile where card_type <> 'standard'
                group by 1) x)),
  (404, 'Mehrfach', 'Zeilen, die NUR eine Gruppe tragen (heute ohne Banner) — '
                    'sie bekaemen mit dem Vorschlag ein NEUES Banner',
      (select count(*)::text from zeile
        where catalog_group is not null and catalog_group <> 'figure'
          and card_type = 'standard')),
  (405, 'Mehrfach', 'davon oeffentlich sichtbar',
      (select count(*)::text from zeile
        where catalog_group is not null and catalog_group <> 'figure'
          and card_type = 'standard' and catalog_status = 'public')),

  -- ------------------------------------------------------------ 5. LIGHTCORE
  /*
   * NUR ZUR MENGENABSCHAETZUNG, UND NUR HIER. Es gibt heute keinen Wert
   * `lightcore`; der Bestand kennt ihn ausschliesslich im NAMEN. ADR-0034
   * verbietet, aus einem Namen eine Eigenschaft abzuleiten — diese Zeilen
   * sagen deshalb, WIE GROSS die Handarbeit waere, und nicht, dass sie
   * automatisch gehen soll.
   */
  (501, 'LightCore', 'Zeilen, deren NAME „light core" oder „lightcore" enthaelt',
      (select count(*)::text from zeile
        where lower(replace(name, ' ', '')) like '%lightcore%')),
  (502, 'LightCore', 'welchen Kartentyp sie heute tragen',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(keine)')
         from (select card_type, count(*) as n from zeile
                where lower(replace(name, ' ', '')) like '%lightcore%'
                group by card_type) x)),
  (503, 'LightCore', 'davon mit einem ANDEREN Typ als special (die echten '
                     'Doppelfaelle)',
      (select count(*)::text from zeile
        where lower(replace(name, ' ', '')) like '%lightcore%'
          and card_type not in ('standard', 'special'))),
  (504, 'LightCore', 'Beispiele davon',
      (select coalesce(string_agg(sky_id || ' ' || name || ' [' || card_type || ']',
                                  ' | ' order by sky_id), '(keine)')
         from (select * from zeile
                where lower(replace(name, ' ', '')) like '%lightcore%'
                  and card_type not in ('standard', 'special')
                order by sky_id limit 8) x)),

  -- -------------------------------------------------- 6. DIE UEBRIGEN NEUEN
  (601, 'Neue Types', 'Kategorie „Sidekicks" — Zeilen',
      (select count(*)::text from zeile where kategorie = 'Sidekicks')),
  (602, 'Neue Types', 'Gruppe mini — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'mini')),
  (603, 'Neue Types', 'Gruppe creation_crystal — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'creation_crystal')),
  (604, 'Neue Types', 'Gruppe trap_master — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'trap_master')),
  (605, 'Neue Types', 'Gruppe sensei — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'sensei')),
  (606, 'Neue Types', 'Gruppe giant — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'giant')),
  (607, 'Neue Types', 'Gruppe swapper — Zeilen',
      (select count(*)::text from zeile where catalog_group = 'swapper')),
  (608, 'Neue Types', 'Gruppen trap / vehicle / item — Zeilen',
      (select coalesce(string_agg(catalog_group || '=' || n::text, ', '
                                  order by catalog_group), '(keine)')
         from (select catalog_group, count(*) as n from zeile
                where catalog_group in ('trap', 'vehicle', 'item')
                group by catalog_group) x)),

  -- ------------------------------------- 7. WAS UNBERUEHRT BLEIBEN MUSS
  (701, 'Unberuehrt', 'Varianten mit Basisfigur (base_sky_id)',
      (select count(*)::text from zeile where base_sky_id is not null)),
  (702, 'Unberuehrt', 'Zeilen mit Charakterfamilie (character_id)',
      (select count(*)::text from zeile where character_id is not null)),
  /*
   * ZEILE 703 IST DER BEWEIS, DASS TYPE UND VARIANTENBEZIEHUNG ZWEI DINGE
   * SIND: Zeilen mit einem Kartentyp ausser standard, die KEINE Basisfigur
   * haben. Waere der Type die Variantenbeziehung, gaebe es sie nicht.
   */
  (703, 'Unberuehrt', 'Zeilen mit Kartentyp ausser standard, aber OHNE '
                      'Basisfigur — Type ist keine Variantenbeziehung',
      (select count(*)::text from zeile
        where card_type <> 'standard' and base_sky_id is null)),
  (704, 'Unberuehrt', 'und umgekehrt: Varianten mit Kartentyp standard',
      (select count(*)::text from zeile
        where base_sky_id is not null and card_type = 'standard')),
  (705, 'Unberuehrt', 'Abdruck der Variantenbeziehung',
      (select coalesce(md5(string_agg(sky_id || '|' || base_sky_id, E'\n' order by sky_id)),
                       '(leer)') from zeile where base_sky_id is not null)),
  (706, 'Unberuehrt', 'Abdruck der Familienzuordnung',
      (select coalesce(md5(string_agg(sky_id || '|' || character_id::text,
                                      E'\n' order by sky_id)), '(leer)')
         from zeile where character_id is not null)),

  -- ------------------------------------------------ 8. DAS BANNER HEUTE
  (801, 'Banner heute', 'Kacheln mit Banner (card_type <> standard)',
      (select count(*)::text from zeile where card_type <> 'standard')),
  (802, 'Banner heute', 'davon oeffentlich',
      (select count(*)::text from zeile
        where card_type <> 'standard' and catalog_status = 'public')),
  (803, 'Banner heute', 'Kacheln ohne Banner',
      (select count(*)::text from zeile where card_type = 'standard')),
  (804, 'Banner heute', 'Shopfaehige Zeilen mit Banner (der Shop zeichnet sie '
                        'ebenfalls)',
      (select count(*)::text from zeile z
        where z.card_type <> 'standard'
          and exists (select 1 from public.shop_inventory i
                       where i.sky_id = z.sky_id))),
  (805, 'Banner heute', 'Zeilen in Sammlungen mit Banner (die Sammlung zeichnet '
                        'die klassische Karte)',
      (select count(*)::text from zeile z
        where z.card_type <> 'standard'
          and exists (select 1 from public.collection_items ci
                       where ci.sky_id = z.sky_id)))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
