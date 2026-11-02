-- ===========================================================================
-- FAMILIEN UND VARIANTEN — DER KORREKTURPLAN ZU 0168, REIN LESEND
--
-- Vor und nach `0168` fahrbar, auf Staging und Production. Sie KORRIGIERT
-- NICHTS; sie sagt, was nach der Regel aus ADR-0171 anders stuende.
--
--   abweichung   eine Variante traegt eine andere Familie als ihre
--                Basisfigur (auch: eine hat eine, die andere keine).
--                Korrektur: die Familie an der BASISFIGUR pflegen — mit 0168
--                nimmt sie die Variante mit. Eine falsche Familie an einer
--                eigenstaendigen Basisfigur loest keine Vererbung; die bleibt
--                eine fachliche Entscheidung.
--   leer         eine Familie ohne ein einziges Mitglied; `kuratiert` sagt,
--                ob admin_delete_empty_character sie loeschen DUERFTE.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

select 'abweichung' as art,
       v.sky_id,
       v.name,
       v.series_code,
       v.character_id::text            as familie_ist,
       cv.canonical_name               as familie_ist_name,
       b.sky_id                        as basis,
       b.character_id::text            as familie_soll,
       cb.canonical_name               as familie_soll_name,
       v.catalog_status                as status
  from public.skylanders v
  join public.skylanders b on b.sky_id = v.base_sky_id
  left join public.characters cv on cv.id = v.character_id
  left join public.characters cb on cb.id = b.character_id
 where v.character_id is distinct from b.character_id

union all

select 'leer' as art,
       null, c.canonical_name, null,
       c.id::text, c.canonical_name, null, null, null,
       case when c.element is not null or c.species is not null or c.role_type is not null
              or c.short_description is not null or c.source_url is not null
              or c.source_label is not null or c.verified_at is not null
            then 'kuratiert' else 'unkuratiert' end
  from public.characters c
 where not exists (select 1 from public.skylanders s where s.character_id = c.id)

 order by 1, 2, 3;
