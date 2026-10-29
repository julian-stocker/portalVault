-- ===========================================================================
-- CAT-10 BEWEIS: laesst sich `card_type` aus der Typmenge ABLEITEN, ohne
-- eine einzige Kartenkunst zu veraendern?
--
-- DIE FRAGE DES BETREIBERS, und sie ist die richtige. `card_type` steuert die
-- Kartenkunst in Shop und Sammlung — sieben Werte, jeder mit einer echten
-- PNG-Datei. Waere er eine Projektion der neuen Typmenge, wuerde jede
-- Typaenderung die Kartenkunst mitbewegen. Das soll nicht geschehen.
--
-- WAS HIER GERECHNET WIRD. Die Erstbelegung der Typmenge wird inline
-- nachgebaut — genau so, wie die Migration sie vornehmen wuerde (Gruppe,
-- Kategoriename, Kartentyp, kuratierte LightCore-Liste) — und daraus die
-- Projektion zurueckgerechnet. Dann wird Zeile fuer Zeile mit dem heutigen
-- `card_type` verglichen.
--
--   101-108  DIE KURATIERTE LIGHTCORE-LISTE: alle Zeilen, deren Name
--            „lightcore" enthaelt, mit SKY-ID, Name und heutigem Kartentyp.
--            Diese Liste wandert in die Migration und wird dort NICHT mehr
--            aus dem Namen gelesen.
--   201-210  DIE PROJEKTION GEGEN DEN BESTAND: wie viele Zeilen bekaemen
--            eine ANDERE Kartenkunst als heute, und welche.
--   301-306  DIE ZWEITE LUECKE: Ranggleichheit. `EDITION_RANK` gibt
--            `standard`, `chase` und `elite` denselben Rang 0 — eine Menge
--            mit Chase UND Elite hat also keine eindeutige Projektion.
--   401-406  DIE DRITTE LUECKE: eine Typaenderung bewegt die Kartenkunst.
--            Gezaehlt an den Zeilen, bei denen das passieren WUERDE.
--   501-508  WAS DIE ERSTBELEGUNG SONST BEWEGT: die 17 Banner, die von
--            SPECIAL auf LIGHTCORE wechseln — die EINE gewollte Folge aus
--            Entscheidung D3.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with roh as (
  select s.sky_id, s.name, s.card_type, c.name as kategorie, c.catalog_group
    from public.skylanders s
    left join public.categories c on c.id = s.category_id
),
/*
 * DIE LIGHTCORE-MENGE, HIER EINMAL AUS DEM NAMEN — und nur hier. Die
 * Migration traegt die SKY-IDs ausdruecklich (Entscheidung D2, Muster von
 * `0032`); diese Abfrage ERZEUGT die Liste, die dort hineinkommt.
 */
lightcore as (
  select sky_id from roh where lower(replace(name, ' ', '')) like '%lightcore%'
),
/* Die Erstbelegung, genau wie die Migration sie vornimmt. */
belegt as (
  select r.*,
         (select array_remove(array[
            case when r.catalog_group = 'giant'            then 'giant' end,
            case when r.catalog_group = 'swapper'          then 'swapper' end,
            case when r.catalog_group = 'trap_master'      then 'master' end,
            case when r.catalog_group = 'sensei'           then 'sensei' end,
            case when r.catalog_group = 'mini'
                  and r.kategorie = 'Minis'                then 'mini' end,
            case when r.catalog_group = 'mini'
                  and r.kategorie = 'Sidekicks'            then 'sidekick' end,
            case when r.catalog_group = 'item'             then 'item' end,
            case when r.catalog_group = 'trap'             then 'trap' end,
            case when r.catalog_group = 'vehicle'          then 'vehicle' end,
            case when r.catalog_group = 'creation_crystal' then 'crystal' end,
            case when r.sky_id in (select sky_id from lightcore)
                                                           then 'lightcore' end,
            /*
             * D3: der Kartentyp `special` wandert NICHT mit, wenn die Zeile
             * eine LightCore ist — dort war `special` nur die Kartenkunst.
             * Jede ANDERE Varianteneigenschaft bleibt erhalten.
             */
            case when r.card_type = 'special'
                  and r.sky_id not in (select sky_id from lightcore)
                                                           then 'special' end,
            case when r.card_type = 'elite'                then 'elite' end,
            case when r.card_type = 'dark'                 then 'dark' end,
            case when r.card_type = 'legendary'            then 'legendary' end,
            case when r.card_type = 'chase'                then 'chase' end,
            case when r.card_type = 'prestige'             then 'prestige' end
          ], null)) as types
    from roh r
),
/*
 * DIE PROJEKTION, so guenstig gerechnet wie moeglich: der staerkste
 * VARIANTS-Type nach `EDITION_RANK` (prestige 4, legendary 3, dark 2,
 * special 1, chase/elite/standard 0), mit `lightcore` als `special`
 * behandelt, weil `card-type.ts` LightCore als „a special form" fuehrt.
 */
projiziert as (
  select b.*,
         case
           when 'prestige'  = any (b.types) then 'prestige'
           when 'legendary' = any (b.types) then 'legendary'
           when 'dark'      = any (b.types) then 'dark'
           when 'special'   = any (b.types) then 'special'
           when 'lightcore' = any (b.types) then 'special'
           when 'elite'     = any (b.types) then 'elite'
           when 'chase'     = any (b.types) then 'chase'
           else 'standard'
         end as kunst
    from belegt b
),
pruef (nr, bereich, pruefung, befund) as (values
  (1, 'Umgebung', 'Katalogzeilen insgesamt', (select count(*)::text from roh)),

  -- -------------------------------------------- 1. DIE KURATIERTE LISTE
  (101, 'LightCore-Liste', 'Zeilen in der Liste',
      (select count(*)::text from lightcore)),
  (102, 'LightCore-Liste', 'die SKY-IDs, als Liste fuer die Migration',
      (select coalesce(string_agg(sky_id, ', ' order by sky_id), '(keine)')
         from lightcore)),
  (103, 'LightCore-Liste', 'SKY-ID, Name und heutiger Kartentyp — zum Pruefen',
      (select coalesce(string_agg(r.sky_id || ' [' || r.card_type || '] ' || r.name,
                                  ' | ' order by r.sky_id), '(keine)')
         from roh r where r.sky_id in (select sky_id from lightcore))),
  (104, 'LightCore-Liste', 'Verteilung ihrer heutigen Kartenkunst',
      (select coalesce(string_agg(card_type || '=' || n::text, ', ' order by n desc),
                       '(keine)')
         from (select r.card_type, count(*) as n from roh r
                where r.sky_id in (select sky_id from lightcore)
                group by r.card_type) x)),

  -- --------------------------------- 2. DIE PROJEKTION GEGEN DEN BESTAND
  /*
   * ZEILE 201 IST DER BEWEIS ODER SEIN GEGENTEIL. Null hiesse: die
   * Projektion reproduziert jede heutige Kartenkunst. Alles ueber null
   * heisst: sie veraendert Kartenkunst, und dann darf sie nicht gebaut
   * werden.
   */
  (201, 'Projektion', 'Zeilen, deren Kartenkunst die Projektion AENDERN wuerde '
                      '(muss 0 sein, damit sie zulaessig ist)',
      (select count(*)::text from projiziert where kunst <> card_type)),
  (202, 'Projektion', 'welche das sind — SKY-ID, heute -> projiziert',
      (select coalesce(string_agg(sky_id || ' ' || card_type || ' -> ' || kunst
                                  || ' (' || name || ')', ' | ' order by sky_id),
                       '(keine)')
         from projiziert where kunst <> card_type)),
  (203, 'Projektion', 'ihre Typmenge',
      (select coalesce(string_agg(sky_id || ' {' || array_to_string(types, ',') || '}',
                                  ' | ' order by sky_id), '(keine)')
         from projiziert where kunst <> card_type)),
  (204, 'Projektion', 'Abdruck der heutigen Kartenkunst',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n' order by sky_id)),
                       '(leer)') from roh)),
  (205, 'Projektion', 'Abdruck der projizierten Kartenkunst — gleich hiesse '
                      'verlustfrei',
      (select coalesce(md5(string_agg(sky_id || '|' || kunst, E'\n' order by sky_id)),
                       '(leer)') from projiziert)),

  -- -------------------------------------------- 3. DIE RANGGLEICHHEIT
  /*
   * `EDITION_RANK` gibt `standard`, `chase` und `elite` denselben Rang 0.
   * Solange eine Zeile nur EINEN Kartentyp trug, fiel das nicht auf. Eine
   * Typmenge kann beide tragen, und dann hat die Projektion keine Antwort,
   * sondern eine Reihenfolge im Quelltext.
   */
  (301, 'Rangleere', 'Zeilen, die heute Chase UND Elite tragen koennten '
                     '(heute unmoeglich: eine Spalte)',
      (select count(*)::text from projiziert
        where 'chase' = any (types) and 'elite' = any (types))),
  (302, 'Rangleere', 'Werte mit Rang 0 in EDITION_RANK — unter ihnen entscheidet '
                     'keine Fachregel',
      'standard, chase, elite'),
  (303, 'Rangleere', 'Zeilen mit Chase (sie koennten morgen Elite dazubekommen)',
      (select count(*)::text from projiziert where 'chase' = any (types))),
  (304, 'Rangleere', 'Zeilen mit Elite (ebenso)',
      (select count(*)::text from projiziert where 'elite' = any (types))),

  -- ------------------------------- 4. EINE TYPAENDERUNG BEWEGT DIE KUNST
  /*
   * DIE DRITTE LUECKE, und sie ist die, die der Betreiber benannt hat: mit
   * einer Projektion aendert JEDES Hinzufuegen eines Variantentypes die
   * Kartenkunst. Gezaehlt wird, wie viele Zeilen das betraefe — naemlich
   * jede, die heute ohne Variantentyp dasteht und morgen einen bekommt.
   */
  (401, 'Nebenwirkung', 'Zeilen ohne Variantentyp — bei ihnen wuerde das '
                        'Hinzufuegen eines Types die Kartenkunst aendern',
      (select count(*)::text from projiziert
        where not (types && array['lightcore','special','dark','legendary',
                                  'elite','chase','prestige']))),
  (402, 'Nebenwirkung', 'Zeilen MIT Variantentyp — bei ihnen wuerde das '
                        'Entfernen sie aendern',
      (select count(*)::text from projiziert
        where types && array['lightcore','special','dark','legendary',
                             'elite','chase','prestige'])),
  (403, 'Nebenwirkung', 'davon im Shop gelistet (dort wird die Kartenkunst '
                        'gezeichnet)',
      (select count(*)::text from projiziert p
        where p.types && array['lightcore','special','dark','legendary',
                               'elite','chase','prestige']
          and exists (select 1 from public.shop_inventory i
                       where i.sky_id = p.sky_id))),
  (404, 'Nebenwirkung', 'davon in Sammlungen (dort ebenso)',
      (select count(*)::text from projiziert p
        where p.types && array['lightcore','special','dark','legendary',
                               'elite','chase','prestige']
          and exists (select 1 from public.collection_items ci
                       where ci.sky_id = p.sky_id))),

  -- --------------------------------- 5. WAS DIE ERSTBELEGUNG BEWEGT
  (501, 'Erstbelegung', 'Zeilen mit mindestens einem Type',
      (select count(*)::text from projiziert where cardinality(types) > 0)),
  (502, 'Erstbelegung', 'Zeilen mit ZWEI oder mehr Types',
      (select count(*)::text from projiziert where cardinality(types) > 1)),
  (503, 'Erstbelegung', 'die Mengen mit zwei oder mehr, als Verteilung',
      (select coalesce(string_agg(k || '=' || n::text, ', ' order by n desc, k),
                       '(keine)')
         from (select array_to_string(array(select unnest(types) order by 1), '+') as k,
                      count(*) as n
                 from projiziert where cardinality(types) > 1 group by 1) x)),
  (504, 'Erstbelegung', 'Zeilen OHNE Type (= Standard)',
      (select count(*)::text from projiziert where cardinality(types) = 0)),
  /*
   * DIE EINE GEWOLLTE BANNERAENDERUNG. Eine LightCore, die heute das Banner
   * SPECIAL traegt, traegt danach LIGHTCORE — weil `special` nach D3 nicht
   * mitwandert. Das ist die Folge der Entscheidung und keine Nebenwirkung;
   * sie steht hier als Zahl, damit sie nicht als Ueberraschung kommt.
   */
  (505, 'Erstbelegung', 'Banner, die von SPECIAL auf LIGHTCORE wechseln',
      (select count(*)::text from projiziert
        where card_type = 'special' and 'lightcore' = any (types))),
  (506, 'Erstbelegung', 'welche das sind',
      (select coalesce(string_agg(sky_id || ' ' || name, ' | ' order by sky_id),
                       '(keine)')
         from projiziert where card_type = 'special' and 'lightcore' = any (types))),
  (507, 'Erstbelegung', 'alle UEBRIGEN Banner bleiben zeichengleich — Zeilen mit '
                        'Kartentyp ausser standard, deren Banner sich NICHT aendert',
      (select count(*)::text from projiziert
        where card_type <> 'standard'
          and not (card_type = 'special' and 'lightcore' = any (types)))),
  (508, 'Erstbelegung', 'und die Mitgliedschaftsregel haelt: Zeilen, deren '
                        'heutiger Kartentyp NICHT in der neuen Menge steht '
                        '(ausser den LightCore-Wechseln)',
      (select count(*)::text from projiziert
        where card_type <> 'standard'
          and not (card_type = any (types))
          and not (card_type = 'special' and 'lightcore' = any (types))))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
