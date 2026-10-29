-- ===========================================================================
-- CAT-08 KORREKTUR: welche STRUKTURIERTEN Daten trennen die Artikelarten?
--
-- DER BEFUND DES BETREIBERS, und er ist richtig: nicht nur Charakterfiguren
-- haben Varianten. Ein Trap, ein Fahrzeug, ein Kreationskristall kann
-- ebenfalls eine Variante haben — und dann ist die Basis ein Trap, ein
-- Fahrzeug, ein Kristall. `NOT_FIGURES` taugt also als Filter fuer
-- CHARAKTERFAMILIEN, aber nicht als Variantenfilter.
--
-- DIE FRAGE DIESER DATEI: woran erkennt der Server die Artikelart, OHNE den
-- Namen zu lesen?
--
--   101-106  `item_type`: welche Werte es gibt und wie sie sich auf die
--            Kategorien verteilen. Traegt die Spalte die Unterscheidung
--            allein?
--   201-206  die KATEGORIEN, vollstaendig, mit Zeilenzahl und item_type.
--            Das ist die Liste, aus der eine Klassifizierung gebaut werden
--            muss.
--   301-308  die Variantenbeziehungen, die es HEUTE gibt: welche Artikelart
--            zeigt auf welche? Zeile 303 ist die Probe, ob die Regel
--            „gleiche Art" dem Bestand widerspricht.
--   401-404  und die Frage zu `0161`: hat die automatische Familienbildung
--            schon einen Trap oder ein Fahrzeug in eine Charakterfamilie
--            gelegt?
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with aktiv as (
  select s.sky_id, s.name, s.series_code, s.character_id, s.base_sky_id,
         s.item_type, s.catalog_status, c.name as kategorie
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'item_type', 'alle Werte mit Zeilenzahl',
      (select coalesce(string_agg(x.item_type || ':' || x.n::text, ', '
                                  order by x.n desc), '(keine)')
         from (select item_type, count(*) as n from aktiv group by item_type) x)),
  (102, 'item_type', 'verschiedene Kategorien je item_type',
      (select coalesce(string_agg(x.item_type || ':' || x.k::text, ', '
                                  order by x.item_type), '(keine)')
         from (select item_type, count(distinct kategorie) as k from aktiv
                group by item_type) x)),
  /*
   * DIE ENTSCHEIDENDE ZEILE. Teilen Traps, Fahrzeuge und Figuren denselben
   * `item_type`, dann trennt die Spalte sie NICHT — und eine Klassifizierung
   * muss die Kategorie lesen. Genau so steht es da: alle drei sind `figure`.
   */
  (103, 'item_type', 'verschiedene item_type-Werte ueber Traps, Fahrzeuge und Figuren '
                     '(1 = die Spalte trennt sie NICHT)',
      (select count(*)::text
         from (select item_type from aktiv
                where kategorie in ('Traps', 'Fahrzeuge', 'Figuren')
                group by item_type) x)),
  (104, 'item_type', 'item_type der Traps',
      (select coalesce(string_agg(distinct item_type, ', '), '(keine)')
         from aktiv where kategorie in ('Traps', 'Trap Items'))),
  (105, 'item_type', 'item_type der Fahrzeuge',
      (select coalesce(string_agg(distinct item_type, ', '), '(keine)')
         from aktiv where kategorie = 'Fahrzeuge')),
  (106, 'item_type', 'item_type der Portale und Spiele',
      (select coalesce(string_agg(distinct kategorie || '=' || item_type, ', '),
                       '(keine)')
         from aktiv where kategorie in ('Portale', 'Spiele', 'Bundles', 'Taschen',
                                        'Zubehör'))),

  (201, 'Kategorien', 'alle, mit Zeilenzahl und item_type',
      (select coalesce(string_agg(x.z, ' | ' order by x.kategorie), '(keine)')
         from (select kategorie,
                      kategorie || ' (' || count(*)::text || ', '
                      || string_agg(distinct item_type, '/') || ')' as z
                 from aktiv group by kategorie) x)),
  (202, 'Kategorien', 'wie viele es sind',
      (select count(distinct kategorie)::text from aktiv)),
  (203, 'Kategorien', 'Kategorien MIT Varianten (dort gibt es Basisartikel)',
      (select coalesce(string_agg(x.z, ' | ' order by x.z), '(keine)')
         from (select distinct v.kategorie || ' -> ' || b.kategorie as z
                 from aktiv v join aktiv b on b.sky_id = v.base_sky_id
                where v.base_sky_id is not null) x)),

  (301, 'Beziehungen', 'Varianten mit Basisartikel',
      (select count(*)::text from aktiv where base_sky_id is not null)),
  (302, 'Beziehungen', 'davon mit Basis in DERSELBEN Kategorie',
      (select count(*)::text from aktiv v join aktiv b on b.sky_id = v.base_sky_id
        where v.base_sky_id is not null and v.kategorie = b.kategorie)),
  (303, 'Beziehungen', 'und in einer ANDEREN Kategorie — die muessen angesehen werden',
      (select coalesce(string_agg(v.sky_id || ' ' || v.name || ' [' || v.kategorie
                                  || '] -> ' || b.sky_id || ' ' || b.name || ' ['
                                  || b.kategorie || ']', ' | ' order by v.sky_id),
                       '(keine)')
         from aktiv v join aktiv b on b.sky_id = v.base_sky_id
        where v.base_sky_id is not null and v.kategorie <> b.kategorie)),
  (304, 'Beziehungen', 'alle Beziehungen, namentlich',
      (select coalesce(string_agg(v.sky_id || ' ' || v.name || ' -> ' || b.sky_id
                                  || ' ' || b.name, ' | ' order by v.sky_id),
                       '(keine)')
         from aktiv v join aktiv b on b.sky_id = v.base_sky_id
        where v.base_sky_id is not null)),

  (401, '0161', 'Zeilen mit Charakterfamilie, die KEIN Charakter sind '
                '(muss 0 sein — sonst hat 0161 schon zugeordnet)',
      (select count(*)::text from aktiv
        where character_id is not null
          and kategorie in ('Traps', 'Trap Items', 'Fahrzeuge', 'Kreationskristalle',
                            'Magic Items', 'Trophies', 'Locations & Truhen',
                            'Portale', 'Spiele', 'Bundles', 'Taschen', 'Zubehör'))),
  (402, '0161', 'diese Zeilen, namentlich',
      (select coalesce(string_agg(a.sky_id || ' ' || a.name || ' [' || a.kategorie
                                  || '] F' || a.character_id::text, ' | '
                                  order by a.sky_id), '(keine)')
         from aktiv a
        where a.character_id is not null
          and a.kategorie in ('Traps', 'Trap Items', 'Fahrzeuge', 'Kreationskristalle',
                              'Magic Items', 'Trophies', 'Locations & Truhen',
                              'Portale', 'Spiele', 'Bundles', 'Taschen', 'Zubehör'))),
  (403, '0161', 'Entwuerfe, die KEINE Charaktere sind (fuer sie darf 0161 nicht '
                'die Familie regeln)',
      (select count(*)::text from aktiv
        where catalog_status = 'draft'
          and kategorie in ('Traps', 'Trap Items', 'Fahrzeuge', 'Kreationskristalle',
                            'Magic Items', 'Trophies', 'Locations & Truhen',
                            'Portale', 'Spiele', 'Bundles', 'Taschen', 'Zubehör'))),
  (404, '0161', 'diese Entwuerfe, die ersten zwanzig',
      (select coalesce(string_agg(x.z, ' | '), '(keine)') from (
         select a.sky_id || ' ' || a.name || ' [' || a.kategorie || '/'
                || a.series_code || ']' as z
           from aktiv a
          where a.catalog_status = 'draft'
            and a.kategorie in ('Traps', 'Trap Items', 'Fahrzeuge',
                                'Kreationskristalle', 'Magic Items', 'Trophies',
                                'Locations & Truhen', 'Portale', 'Spiele', 'Bundles',
                                'Taschen', 'Zubehör')
          order by a.sky_id limit 20) x))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
