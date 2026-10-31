-- ===========================================================================
-- STAGING — DER ZUSTAND VOR DER SKY-ID-BEREICHSSPERRE, REIN LESEND
--
-- VOR `supabase/operations/staging-sky-id-band.sql` fahren, im SQL-Editor
-- von qqxcpesbwfxzgytkdsac, als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- REIN LESEND. Ein `select`. Kein DDL, keine Datenanweisung, kein `nextval`,
-- kein `setval`.
--
-- WAS DIE SPERRE TUT. Eine Anweisung an `public.sky_id_seq`:
--
--     alter sequence public.sky_id_seq
--       minvalue 928 maxvalue 4999 no cycle start with 928 restart with 928;
--
-- Danach kann die AUTOMATISCHE Vergabe dieser Umgebung das Band nicht mehr
-- verlassen — weder durch `nextval`, noch durch `setval`, noch aus einer
-- `security definer`-Funktion heraus.
--
-- *** SIE BEGRENZT DIE VERGABE, NICHT DIE SPEICHERUNG ***
--
-- Eine auf Production vergebene SKY-ID muss hier weiterhin gespeichert
-- werden koennen — der Katalogsync traegt sie unter genau ihrer Nummer ein.
-- Deshalb gibt es KEINE CHECK-Constraint auf `skylanders.sky_id`, und Zeile
-- 141 haelt ausdruecklich fest, dass keine existiert.
--
-- *** DIE ZEILE 900 ***
--
-- Sie ist die Baseline fuer die Nachkontrolle. Vollstaendig kopieren und vor
-- `sky_id_band_postflight.sql` in derselben Klammer setzen:
--
--     select set_config('skyisles.band', 'skyisles-band-1|…', true);
-- ===========================================================================

with
mess as (
  select
    (select count(*)::text from public.skylanders)                          as katalogzeilen,
    (select coalesce(max(sky_id), '(leer)') from public.skylanders
      where sky_id ~ '^SKY-[0-8][0-9]{3}$')                                 as hoechste,
    (select coalesce(md5(string_agg(x.z, chr(10) order by x.z)), '(leer)') from (
       select s.sky_id || '|' || s.name || '|' || s.slug || '|' || s.catalog_status
              || '|' || s.source as z from public.skylanders s
        where s.series_code not in ('TEST', 'SMOK')
          and s.sky_id < 'SKY-9000' and s.catalog_status <> 'draft') x)     as katalogabdruck,
    (select count(*)::text from public.shop_inventory)                      as lagerzeilen,
    (select coalesce(md5(string_agg(i.sky_id || '|' || i.condition || '|'
                                    || i.quantity::text || '|' || i.is_listed::text,
                                    chr(10) order by i.sky_id, i.condition)), '(leer)')
       from public.shop_inventory i)                                        as lagerabdruck,
    (select count(*)::text from public.collection_items)                    as sammlungszeilen,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    chr(10) order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                     as sammlungabdruck,
    (select count(*)::text from public.categories)                          as kategorien,
    /*
     * DAS JOURNAL — hinter einer Rechtepruefung. `catalog_admin_changes` ist
     * dem lesenden Pruefzugang nicht geteilt; als `postgres` steht hier eine
     * Zahl, sonst `KEIN-RECHT`, und Zeile 9998 zaehlt sie als OFFEN.
     */
    case when has_table_privilege('public.catalog_admin_changes', 'SELECT')
         then (xpath('/row/c/text()', query_to_xml(
                'select count(*)::text as c from public.catalog_admin_changes',
                false, true, '')))[1]::text
         else 'KEIN-RECHT' end                                              as journalzeilen,
    /*
     * DIE SEQUENZ, ebenso. `0033` entzieht sie jedem Clientrecht.
     */
    case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
         then (xpath('/row/c/text()', query_to_xml(
                'select last_value::text || ''|'' || is_called::text as c '
                'from public.sky_id_seq', false, true, '')))[1]::text
         else 'KEIN-RECHT' end                                              as sequenzstand,
    (select min_value::text || '|' || max_value::text || '|' || cycle::text
       from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq')
                                                                            as band
),
feld as (
  select katalogzeilen || '|' || hoechste || '|' || katalogabdruck || '|'
         || lagerzeilen || '|' || lagerabdruck || '|' || sammlungszeilen || '|'
         || sammlungabdruck || '|' || kategorien as kern, m.*
    from mess m
),
baseline as (
  select 'skyisles-band-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
)
,
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen', (select katalogzeilen from mess), null),

  -- ---------------------------------------------------------- Die Grundlage
  (101, 'Grundlage', 'die Sequenz public.sky_id_seq steht',
      (select count(*)::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '1'),
  (102, 'Grundlage', 'sie traegt HEUTE noch KEIN Band — diese Datei laeuft einmal',
      (select (min_value = 1 and max_value = 9223372036854775807)::text
         from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq'),
      'true'),
  (103, 'Grundlage', 'und sie laeuft nicht um',
      (select cycle::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), 'false'),
  (104, 'Grundlage', 'Umgebungsstempel: SKY-0821 UND SKY-0822 stehen (nur auf Staging)',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0821', 'SKY-0822')), '2'),

  -- -------------------------------------------- Die Zahlen, auf denen A3 beruht
  (111, 'Vergabe', 'hoechste SKY-ID in der Tabelle', (select hoechste from mess), null),
  (112, 'Vergabe', 'hoechste JE GEZOGENE SKY-ID (Tabelle und Journal) — '
                   'die Untergrenze 928 muss dahinter liegen',
      case when has_table_privilege('public.catalog_admin_changes', 'SELECT')
           then (xpath('/row/c/text()', query_to_xml(
                  'select ''SKY-'' || lpad(max(n)::text, 4, ''0'') as c from ('
                  'select (substring(sky_id from 5))::integer as n from public.skylanders '
                  'where sky_id ~ ''^SKY-[0-8][0-9]{3}$'' union '
                  'select (substring(entity_id from 5))::integer from '
                  'public.catalog_admin_changes where entity = ''skylander'' '
                  'and entity_id ~ ''^SKY-[0-8][0-9]{3}$'') q',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (113, 'Vergabe', 'Sequenzstand (last_value|is_called)',
      (select sequenzstand from mess), null),
  (114, 'Vergabe', 'Zeilen im Band 0928..4999 — es muss leer sein',
      (select count(*)::text from public.skylanders
        where sky_id >= 'SKY-0928' and sky_id <= 'SKY-4999'), '0'),

  -- ------------------------------------ Was die Sperre NICHT tun darf
  /*
   * DIESE ZEILE WAR FALSCH, und der Lauf vom 2026-10-30 hat es gezeigt: sie
   * zaehlte CHECK-Constraints, deren Definition `sky_id` nennt und NICHT das
   * Literal `SKY-[0-9]` enthaelt — und erwartete 0. Gemeldet wurde 1.
   *
   * WAS DIE 1 WAR: `skylanders_base_not_self`, aus `0159`:
   * `CHECK ((base_sky_id IS DISTINCT FROM sky_id))`. Sie sagt „eine Variante
   * ist nicht ihre eigene Basisfigur" und ueber Nummernbereiche gar nichts.
   * Die Zeile haette auch ohne jede Bereichssperre 1 gemeldet.
   *
   * UND DIE HEURISTIK WAR AUF BEIDEN SEITEN BRUECHIG. `like '%SKY-[0-9]%'`
   * sieht wie eine Zeichenklasse aus, ist in SQL-LIKE aber die woertliche
   * Folge `[`, `0`, `-`, `9`, `]`. Dass sie die Formatconstraint traf, lag
   * daran, dass deren Definition genau diese Zeichen enthaelt — ein Zufall,
   * kein Entwurf.
   *
   * WAS STATTDESSEN HIER STEHT: zwei exakte Fragen statt einer Mustersuche.
   * 141 prueft die Formatconstraint WOERTLICH — sie erlaubt SKY-0000 bis
   * SKY-9999 und damit jede fremde Nummer. 142 nennt die Menge der
   * CHECK-Constraints, die `sky_id` ueberhaupt erwaehnen, beim NAMEN: kommt
   * eine dazu, aendert sich die Zeichenkette und die Pruefung blockiert.
   */
  /*
   * DIESE ZEILE WAR FALSCH, und der Lauf vom 2026-10-30 hat es gezeigt: sie
   * zaehlte CHECK-Constraints, deren Definition `sky_id` nennt und NICHT das
   * Literal `SKY-[0-9]` enthaelt, und erwartete 0. Gemeldet wurde 1.
   *
   * WAS DIE 1 WAR: `skylanders_base_not_self` aus `0159`,
   * `CHECK ((base_sky_id IS DISTINCT FROM sky_id))`. Sie sagt „eine Variante
   * ist nicht ihre eigene Basisfigur" und ueber Nummernbereiche gar nichts.
   * Die Zeile haette auch ohne jede Bereichssperre 1 gemeldet.
   *
   * UND DIE HEURISTIK WAR AUF BEIDEN SEITEN BRUECHIG. `like '%SKY-[0-9]%'`
   * sieht wie eine Zeichenklasse aus, ist in SQL-LIKE aber die woertliche
   * Folge `[`, `0`, `-`, `9`, `]`. Dass sie die Formatconstraint ueberhaupt
   * traf, lag daran, dass deren Definition genau diese Zeichen enthaelt —
   * ein Zufall ihrer Schreibweise, kein Entwurf.
   *
   * STATTDESSEN ZWEI EXAKTE FRAGEN. 141 vergleicht die Formatconstraint
   * WOERTLICH — sie laesst SKY-0000 bis SKY-9999 zu und damit jede fremde
   * Nummer. 142 nennt die Menge der CHECK-Constraints, die `sky_id`
   * ueberhaupt erwaehnen, beim NAMEN: kommt eine dazu, aendert sich die
   * Zeichenkette und die Pruefung blockiert.
   */
  (141, 'Fremde IDs', 'die Formatconstraint ist woertlich die erwartete — sie laesst '
                      'SKY-0000 bis SKY-9999 zu und damit jede fremde Nummer',
      (select coalesce(pg_get_constraintdef(c.oid), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_sky_id_format'),
      'CHECK ((sky_id ~ ''^SKY-[0-9]{4}$''::text))'),
  (142, 'Fremde IDs', 'und das sind ALLE CHECK-Constraints, die sky_id erwaehnen — '
                      'keine davon begrenzt einen Nummernbereich',
      (select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders') and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%sky_id%'),
      'skylanders_base_not_self,skylanders_sky_id_format'),

  (151, 'Unveraendert', 'Katalogabdruck',   (select katalogabdruck from mess), null),
  (152, 'Unveraendert', 'Lagerzeilen',      (select lagerzeilen from mess), null),
  (153, 'Unveraendert', 'Lagerabdruck',     (select lagerabdruck from mess), null),
  (154, 'Unveraendert', 'Sammlungszeilen',  (select sammlungszeilen from mess), null),
  (155, 'Unveraendert', 'Sammlungsabdruck', (select sammlungabdruck from mess), null),
  (156, 'Unveraendert', 'Kategorien',       (select kategorien from mess), null),
  (157, 'Unveraendert', 'Journalzeilen',    (select journalzeilen from mess), null),

  (900, 'BASIS', 'Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from baseline), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
