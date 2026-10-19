-- ===========================================================================
-- DIAGNOSE: 53 Anzeigenamen statt 39 — Datenaenderung oder falscher Sollwert?
--
-- DER ABBRUCH
--   ABBRUCH A7: der Z0-Vertrag stimmt nicht mehr — overrides ist 53,
--   erwartet 39.
--
-- WAS DIESE DATEI ENTSCHEIDEN SOLL. Zwei Erklaerungen sind moeglich, und sie
-- fuehren zu entgegengesetzten Schritten:
--
--   (1) FALSCHER SOLLWERT. Z0 hat am 2026-10-19 gezaehlt, wie viele der 39
--       SPIELE einen `display_name_override` tragen — Antwort: alle 39. Der
--       Vertrag hat diese Zahl als katalogweite Gesamtzahl uebernommen. Dann
--       haben nie 39 Zeilen insgesamt einen Override getragen, sondern 39
--       Spiele PLUS die Figuren, bei denen der Adminbereich einen Anzeigenamen
--       gesetzt hat. Nichts waere passiert; der Vertrag waere falsch
--       abgeleitet.
--
--   (2) DATENAENDERUNG. Zwischen Z0 und heute sind 14 Overrides dazugekommen.
--       Dann ist der Katalog bewegt worden, und Z0 ist neu zu erheben, bevor
--       irgendeine Migration laeuft.
--
-- WIE SIE UNTERSCHEIDET. `public.catalog_admin_changes` fuehrt seit `0004`
-- jede Aenderung an `display_name_override` mit Zeitstempel (Trigger
-- `skylanders_log_editorial`). Pruefung 201 zaehlt die Aenderungen von HEUTE,
-- 202 nennt die juengste ueberhaupt. Null Aenderungen heute und eine alte
-- juengste Aenderung heissen: Erklaerung (1).
--
-- DIE ZAHLEN, DIE Z0 WIRKLICH FESTGEHALTEN HAT (`open_verifications.md`,
-- Abschnitt 0f): „Spiele | 39, alle mit display_name_override". Eine
-- katalogweite Gesamtzahl steht dort NICHT.
--
-- KEINE PERSONENBEZOGENEN DATEN. `changed_by` wird nicht ausgegeben, nur
-- gezaehlt. Anzeigenamen sind redaktioneller Inhalt und werden im Wortlaut
-- gezeigt — wie in Z0 selbst.
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rechteaenderung. Zeile 9999 muss 0 zeigen: sie zaehlt nur die
-- Abweichungen, die eine DATENAENDERUNG bedeuten wuerden.
-- ===========================================================================

with ueberschrieben as (
  select s.sky_id, s.name, s.display_name_override, s.series_code, s.updated_at,
         c.name as kategorie,
         (c.name = 'Spiele') as ist_spiel
    from public.skylanders s
    left join public.categories c on c.id = s.category_id
   where s.display_name_override is not null
),
spiele as (
  select s.sky_id, s.display_name_override
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name = 'Spiele'
),
aenderung as (
  select a.entity_id, a.old_value, a.new_value, a.changed_at
    from public.catalog_admin_changes a
   where a.entity = 'skylander' and a.field = 'display_name_override'
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------- Die Zaehlung
  (101, 'Zaehlung', 'Zeilen mit display_name_override insgesamt',
      (select count(*)::text from ueberschrieben), null),
  (102, 'Zaehlung', 'davon in der Kategorie Spiele',
      (select count(*)::text from ueberschrieben where ist_spiel), null),
  (103, 'Zaehlung', 'davon NICHT in der Kategorie Spiele',
      (select count(*)::text from ueberschrieben where not ist_spiel), null),
  (104, 'Zaehlung', 'Zeilen in der Kategorie Spiele insgesamt',
      (select count(*)::text from spiele), null),

  /*
   * DIE AUSSAGE, DIE Z0 WIRKLICH GEMACHT HAT.
   *
   * „39, alle mit display_name_override" heisst: jede Spiele-Zeile traegt
   * einen. Genau das wird hier geprueft — und es ist die Zahl, die in den
   * Vertrag gehoert. Stimmt sie nicht mehr, IST etwas passiert.
   */
  (111, 'Z0-Aussage', 'blockierend: jede Spiele-Zeile traegt einen Override',
      (select (count(*) = (select count(*) from spiele))::text
         from spiele where display_name_override is not null), 'true'),
  (112, 'Z0-Aussage', 'blockierend: es sind genau die 39 aus Z0',
      (select count(*)::text from spiele where display_name_override is not null), '39'),

  -- --------------------------------------------- Hat sich heute etwas bewegt?
  (201, 'Historie', 'blockierend: Aenderungen an display_name_override HEUTE',
      (select count(*)::text from aenderung where changed_at >= current_date), '0'),
  (202, 'Historie', 'jüngste Aenderung ueberhaupt',
      coalesce((select max(changed_at)::text from aenderung), '(keine)'), null),
  (203, 'Historie', 'Aenderungen in den letzten 7 Tagen',
      (select count(*)::text from aenderung
        where changed_at >= current_date - 7), null),
  (204, 'Historie', 'Aenderungen insgesamt protokolliert',
      (select count(*)::text from aenderung), null),
  (205, 'Historie', 'Zeilen mit Override, zu denen es KEINE Aenderungszeile gibt',
      (select count(*)::text from ueberschrieben u
        where not exists (select 1 from aenderung a where a.entity_id = u.sky_id)), null),
  (206, 'Historie', 'jüngstes updated_at unter den Override-Zeilen',
      coalesce((select max(updated_at)::text from ueberschrieben), '(keine)'), null),

  -- ------------------------------------- Wer sind die Nicht-Spiele-Overrides?
  (301, 'Nicht-Spiele', 'Kategorien und Anzahl',
      coalesce((select string_agg(x.kategorie || '=' || x.n::text, ', ' order by x.kategorie)
                  from (select coalesce(kategorie, '(ohne Kategorie)') as kategorie,
                               count(*) as n
                          from ueberschrieben where not ist_spiel
                         group by 1) x), '(keine)'), null),
  (302, 'Nicht-Spiele', 'Serien und Anzahl',
      coalesce((select string_agg(x.series_code || '=' || x.n::text, ', ' order by x.series_code)
                  from (select series_code, count(*) as n
                          from ueberschrieben where not ist_spiel
                         group by 1) x), '(keine)'), null),
  (303, 'Nicht-Spiele', 'im Wortlaut — NICHT ueberschreiben',
      coalesce((select string_agg(u.sky_id || ': ' || u.name || ' -> ' || u.display_name_override,
                                  '  |  ' order by u.sky_id)
                  from ueberschrieben u where not ist_spiel), '(keine)'), null),
  (304, 'Nicht-Spiele', 'aeltestes und jüngstes updated_at',
      coalesce((select min(updated_at)::text || '  bis  ' || max(updated_at)::text
                  from ueberschrieben where not ist_spiel), '(keine)'), null),

  -- --------------------------------------------------------------- Befund
  (401, 'Befund', 'Deutung',
      (select case
         when (select count(*) from aenderung where changed_at >= current_date) > 0
           then 'DATENAENDERUNG HEUTE — Z0 neu erheben, nicht migrieren'
         when (select count(*) from spiele where display_name_override is not null) <> 39
           then 'DIE 39 SPIELE STIMMEN NICHT MEHR — gezielt nachsehen'
         else 'FALSCHER SOLLWERT — Z0 zaehlte die 39 SPIELE, der Vertrag las es '
              || 'als katalogweite Gesamtzahl. Katalogweit sind es '
              || (select count(*)::text from ueberschrieben)
              || ', davon ' || (select count(*)::text from ueberschrieben where not ist_spiel)
              || ' Figuren mit redaktionellem Anzeigenamen.' end), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
