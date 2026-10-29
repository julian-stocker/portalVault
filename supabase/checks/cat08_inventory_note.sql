-- Bestandsaufnahme fuer die Akte, nach der Anwendung von 0161. Rein lesend.
-- Sie prueft nichts; sie HAELT FEST, womit 0161 angewendet wurde — die
-- Zahlen bewegen sich, weil der Betreiber parallel in der Oberflaeche
-- arbeitet, und eine Akte ohne Datum ist eine Behauptung.
select 1 as nr, 'Bestand' as bereich, 'Entwuerfe' as pruefung,
       (select count(*)::text from public.skylanders where catalog_status = 'draft') as befund,
       null::text as erwartet, null::boolean as ok
union all
select 2, 'Bestand', 'oeffentliche Zeilen',
       (select count(*)::text from public.skylanders where catalog_status = 'public'),
       null, null
union all
select 3, 'Bestand', 'versteckte Zeilen',
       (select count(*)::text from public.skylanders where catalog_status = 'hidden'),
       null, null
union all
select 4, 'Bestand', 'Katalogzeilen',
       (select count(*)::text from public.skylanders), null, null
union all
select 5, 'Bestand', 'Zeilen mit Familie',
       (select count(*)::text from public.skylanders where character_id is not null),
       null, null
union all
select 6, 'Bestand', 'verschiedene Familien',
       (select count(distinct character_id)::text from public.skylanders
         where character_id is not null), null, null
union all
select 7, 'Bestand', 'Varianten mit Basisfigur',
       (select count(*)::text from public.skylanders where base_sky_id is not null),
       null, null
union all
select 8, 'Bestand', 'verschiedene Basisfiguren',
       (select count(distinct base_sky_id)::text from public.skylanders
         where base_sky_id is not null), null, null
 order by nr;
