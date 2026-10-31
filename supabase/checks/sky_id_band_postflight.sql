-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZUR SKY-ID-BEREICHSSPERRE, REIN LESEND
--
-- NACH `supabase/operations/staging-sky-id-band.sql` fahren, als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT DIE BASELINE AUS DEM PREFLIGHT. In DERSELBEN Klammer davor:
--
--     select set_config('skyisles.band', 'skyisles-band-1|…', true);
--
-- WAS SIE PRUEFT
--
--   201-205  DAS BAND STEHT: genau 928..4999, kein Umlauf, is_called false,
--            last_value 928 — also ist der naechste Zug SKY-0928 SELBST.
--   211-212  DIE SPERRE GREIFT: die Grenzen stehen an der SEQUENZ, nicht in
--            einer Funktion. Darum halten sie auch gegen `setval` und gegen
--            SECURITY DEFINER.
--   221      FREMDE SKY-IDs BLEIBEN SPEICHERBAR: keine CHECK-Constraint ist
--            dazugekommen.
--   301-308  NICHTS HAT SICH BEWEGT — gegen die Baseline, Feld fuer Feld.
--
-- SIE ZIEHT KEINE NUMMER. Kein `nextval`, kein `setval`. Eine Nachkontrolle,
-- die eine SKY-ID verbraucht, um zu pruefen, ob man eine ziehen kann, hat die
-- Pruefung zur Handlung gemacht.
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
vertrag as (
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.band', true), '')), ''),
                'skyisles-band-1|') as roh
),
teile as (
  select roh, string_to_array(roh, '|') as t from vertrag
),
soll as (
  select roh,
         (t is not null and t[1] = 'skyisles-band-1')          as marke,
         t[2] as katalogzeilen, t[3] as hoechste, t[4] as katalogabdruck,
         t[5] as lagerzeilen,   t[6] as lagerabdruck,
         t[7] as sammlungszeilen, t[8] as sammlungabdruck, t[9] as kategorien
    from teile
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen', (select katalogzeilen from mess), null),

  -- ---------------------------------------------------------- Das Band steht
  (201, 'Band', 'die Untergrenze ist 928',
      (select min_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '928'),
  (202, 'Band', 'die Obergrenze ist 4999',
      (select max_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '4999'),
  (203, 'Band', 'NO CYCLE — die Sequenz laeuft nicht um und vergibt nichts zweimal',
      (select cycle::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), 'false'),
  (204, 'Band', 'der Startwert ist 928',
      (select start_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '928'),
  (205, 'Band', 'Sequenzstand — erwartet 928|false, dann ist der naechste Zug '
                'SKY-0928 SELBST und nicht einer mehr',
      (select sequenzstand from mess), null),

  -- ------------------------------------------------------- Die Sperre greift
  (211, 'Sperre', 'die Grenzen stehen an der SEQUENZ — darum halten sie auch '
                  'gegen setval und gegen SECURITY DEFINER',
      (select (min_value = 928 and max_value = 4999 and not cycle)::text
         from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq'),
      'true'),
  (212, 'Sperre', 'der reservierte Bereich ab SKY-9000 ist damit unerreichbar',
      (select (max_value < 9000)::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), 'true'),

  -- ------------------------------------------- Fremde IDs bleiben speicherbar
  /*
   * DIESELBE KORREKTUR WIE IM PREFLIGHT (141/142): keine Mustersuche in
   * Constraintdefinitionen, sondern zwei exakte Fragen. Die erste Fassung
   * zaehlte `skylanders_base_not_self` mit und haette auch ohne jede
   * Bereichssperre angeschlagen.
   */
  (221, 'Fremde IDs', 'die Formatconstraint ist unveraendert — SKY-0000 bis SKY-9999 '
                      'bleiben speicherbar, auch fremde Nummern',
      (select coalesce(pg_get_constraintdef(c.oid), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_sky_id_format'),
      'CHECK ((sky_id ~ ''^SKY-[0-9]{4}$''::text))'),
  (222, 'Fremde IDs', 'und es ist KEINE CHECK-Constraint auf sky_id dazugekommen',
      (select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders') and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%sky_id%'),
      'skylanders_base_not_self,skylanders_sky_id_format'),

  -- -------------------------------------------------- Gegen die Baseline
  (301, 'Baseline', 'eine Baseline ist uebergeben worden',
      (select (roh is not null)::text from soll), 'true'),
  (302, 'Baseline', 'sie traegt die Marke skyisles-band-1',
      (select coalesce(marke::text, 'false') from soll), 'true'),
  (303, 'Unveraendert', 'Katalogzeilen',
      (select katalogzeilen from mess), (select katalogzeilen from soll)),
  (304, 'Unveraendert', 'hoechste SKY-ID',
      (select hoechste from mess), (select hoechste from soll)),
  (305, 'Unveraendert', 'Katalogabdruck',
      (select katalogabdruck from mess), (select katalogabdruck from soll)),
  (306, 'Unveraendert', 'Lagerzeilen und Lagerabdruck',
      (select lagerzeilen || '|' || lagerabdruck from mess),
      (select lagerzeilen || '|' || lagerabdruck from soll)),
  (307, 'Unveraendert', 'Sammlungszeilen und Sammlungsabdruck',
      (select sammlungszeilen || '|' || sammlungabdruck from mess),
      (select sammlungszeilen || '|' || sammlungabdruck from soll)),
  (308, 'Unveraendert', 'Kategorien',
      (select kategorien from mess), (select kategorien from soll)),
  (309, 'Unveraendert', 'Journalzeilen — der Preflight nennt sie in Zeile 157',
      (select journalzeilen from mess), null)
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
