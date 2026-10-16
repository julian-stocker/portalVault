-- ===========================================================================
-- Der Anker: ist die LEBENDE Funktion zeichengleich der im Repository?
--
-- Der Rueckvergleich eines Exports mit sich selbst beweist nichts ueber seine
-- eigene Vollstaendigkeit — er benutzt dieselbe Funktion zweimal. Dieser
-- Zirkel wird hier geschlossen: `prosrc` ist der Rumpf, den PostgreSQL
-- gespeichert hat, und er wird gegen die Fassung im Repository gehalten.
--
-- ERWARTET fuer Stand 0131:
--   md5(prosrc)     = 24c3810288bb20929fe995554a267adf
--   length(prosrc)  = 21458 Zeichen
--   md5(Kommentar)  = 6b980ac961d1d6ac704587ecc6e9524f  (674 Zeichen)
--
-- Beide Werte stammen aus
-- `supabase/migrations/0131_business_backup_seller_fields.sql`, gerechnet
-- ueber genau den Text zwischen den Dollarzeichen — das ist, was `prosrc`
-- enthaelt. `src/lib/admin/migration-integrity.test.ts` rechnet sie bei jedem
-- Testlauf nach, damit Datei und Erwartung nicht auseinanderlaufen.
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rollenumschaltung, keine Rechteaenderung. Die Funktion wird NICHT
-- aufgerufen — gelesen wird ihre gespeicherte Definition. Es werden keine
-- Geschaeftsdaten gelesen und keine ausgegeben.
--
-- NACHTRAG ZUM ERSTEN LAUF AUF STAGING: Pruefung 206 verglich den search_path
-- als Text gegen 'search_path=' und schlug fehl, weil PostgreSQL einen leeren
-- Wert quotiert ablegt (`search_path=""`). Die Funktion war in Ordnung, die
-- Erwartung war falsch. Siehe den Kommentar bei 206-208.
--
-- Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with
fn as (
  select p.oid, p.prosrc, p.prolang, p.provolatile, p.prosecdef, p.proconfig,
         p.pronargs, p.prorettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'seller_business_backup'
),

/*
 * ---------------------------------------------------------------------------
 * SELBSTTEST DES ZEILENPARSERS (Pruefungen 1-3)
 *
 * Die Zaehlung unten arbeitet zeilenweise, weil PostgreSQL die Gierigkeit
 * fuer den GANZEN Zweig bestimmt und ein mehrzeiliger Regex deshalb den
 * ersten Bereich den ganzen Rumpf verschlucken laesst (Handbuch 9.7.3.5).
 * Die Probe enthaelt zwei Bereiche mit 2 und 1 Feld. Ein gieriger Parser
 * findet 1 Bereich mit 3 Feldern — und dann bricht diese Datei ab, statt
 * ein falsches "in Ordnung" zu melden.
 * ---------------------------------------------------------------------------
 */
probe as (
  select E'      ''alpha'', coalesce((\n'
      || E'          ''eins'', t.eins,\n'
      || E'          ''zwei'', t.zwei\n'
      || E'      ), ''[]''::jsonb),\n'
      || E'      ''beta'', coalesce((\n'
      || E'          ''drei'', t.drei\n'
      || E'      ), ''[]''::jsonb)\n' as d
),
probe_zeilen as (
  select txt from probe p, regexp_split_to_table(p.d, E'\n') as txt
),
probe_zahl as (
  select count(*) filter (where txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($')
           as bereiche,
         count(*) filter (where txt ~ '^ {10}''[a-z_0-9]+'',') as felder
    from probe_zeilen
),

/*
 * ---------------------------------------------------------------------------
 * Die Zaehlung im echten Rumpf
 * ---------------------------------------------------------------------------
 */
zeilen as (
  select txt from fn f, regexp_split_to_table(f.prosrc, E'\n') as txt
),
zahl as (
  select count(*) filter (where txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($')
           as bereiche,
         count(*) filter (where txt ~ '^ {10}''[a-z_0-9]+'',') as felder
    from zeilen
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- --- Selbsttest -------------------------------------------------------
  (1, 'Selbsttest', 'die Probe hat 2 Bereiche (gierig waere 1)',
      ((select bereiche from probe_zahl))::text, '2'),
  (2, 'Selbsttest', 'die Probe hat 3 Feldzeilen',
      ((select felder from probe_zahl))::text, '3'),
  (3, 'Selbsttest', 'die Funktion ist genau einmal definiert',
      ((select count(*) from fn))::text, '1'),

  -- --- Der Anker --------------------------------------------------------
  (101, 'Anker', 'md5 des gespeicherten Rumpfs',
       (coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)')),
       '24c3810288bb20929fe995554a267adf'),
  (102, 'Anker', 'Laenge des gespeicherten Rumpfs in Zeichen',
       (coalesce((select length(f.prosrc) from fn f), -1))::text, '21458'),
  (103, 'Anker', 'md5 des Funktionskommentars',
       (coalesce((select md5(obj_description(f.oid, 'pg_proc')) from fn f),
                 '(kein Kommentar)')),
       '6b980ac961d1d6ac704587ecc6e9524f'),
  (104, 'Anker', 'Laenge des Funktionskommentars',
       (coalesce((select length(obj_description(f.oid, 'pg_proc')) from fn f),
                 -1))::text, '674'),

  -- --- Die Form, unabhaengig von md5 ------------------------------------
  (201, 'Form', 'Bereiche im Rumpf',   ((select bereiche from zahl))::text, '28'),
  (202, 'Form', 'Feldzeilen im Rumpf', ((select felder   from zahl))::text, '352'),
  (203, 'Form', 'Sprache ist sql (nicht plpgsql)',
       (select l.lanname from fn f join pg_language l on l.oid = f.prolang),
       'sql'),
  (204, 'Form', 'stabil (s), nicht volatil',
       (select f.provolatile::text from fn f), 's'),
  (205, 'Form', 'security definer',
       (select f.prosecdef::text from fn f), 'true'),
  /*
   * DER SEARCH_PATH — UND DIE LEHRE, DIE HIER ZUM ZWEITEN MAL FAELLIG WAR.
   *
   * Ein exakter Vergleich gegen 'search_path=' ist FALSCH. PostgreSQL legt
   * einen leeren Wert QUOTIERT ab, in `proconfig` steht also
   * `search_path=""`. Genau daran ist der 0124-Preflight auf Staging schon
   * einmal gescheitert (Befund 106), und genau denselben Fehlgriff hat die
   * erste Fassung dieser Datei wiederholt: Staging meldete `search_path=""`
   * gegen erwartet `search_path=`, Gesamt 9999 = 1 — bei im uebrigen
   * zeichengleichem Rumpf.
   *
   * Richtig ist, was `0124` Pruefung 106/117 und `0127` Pruefung 108/109
   * schon tun: Vorhandensein ueber den PRAEFIX pruefen, und den Wert
   * AUSPACKEN statt den Text zu vergleichen. Der Praefix allein liesse
   * `search_path=public` durch, der Wert allein saehe eine fehlende
   * Festlegung nicht — deshalb drei Zeilen statt einer.
   */
  (206, 'Form', 'es gibt eine search_path-Festlegung',
       (select (exists (select 1 from unnest(coalesce(f.proconfig, '{}'::text[])) c
                         where c like 'search\_path=%'))::text from fn f),
       'true'),
  (207, 'Form', 'und ihr Wert ist LEER (quotiert abgelegt als "")',
       (select coalesce(
                 (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                    from unnest(coalesce(f.proconfig, '{}'::text[])) c
                   where c like 'search\_path=%'),
                 '(leer)')::text
          from fn f),
       '(leer)'),
  (208, 'Form', 'und es ist genau EINE Festlegung, keine weitere',
       (select coalesce(array_length(f.proconfig, 1), 0)::text from fn f), '1'),
  (209, 'Form', 'keine Parameter',
       (select f.pronargs::text from fn f), '0'),
  (210, 'Form', 'Rueckgabetyp jsonb',
       (select f.prorettype::regtype::text from fn f), 'jsonb'),

  -- --- Was der Rumpf NICHT tun darf -------------------------------------
  (301, 'Schreibschutz', 'kein insert im Rumpf',
       ((select count(*) from fn f where f.prosrc ~* '\minsert\s+into\m'))::text, '0'),
  (302, 'Schreibschutz', 'kein update im Rumpf',
       ((select count(*) from fn f where f.prosrc ~* '\mupdate\s+public\.'))::text, '0'),
  (303, 'Schreibschutz', 'kein delete im Rumpf',
       ((select count(*) from fn f where f.prosrc ~* '\mdelete\s+from\m'))::text, '0'),
  (304, 'Vertrag', 'restore_supported steht als false im Rumpf',
       ((select count(*) from fn f
          where f.prosrc like '%''restore_supported'',      false%'))::text, '1'),
  (305, 'Vertrag', 'Formatversion 1 steht im Rumpf',
       ((select count(*) from fn f
          where f.prosrc like '%''format_version'',  1%'))::text, '1'),

  -- --- Befund -----------------------------------------------------------
  (401, 'Befund', 'Stand der lebenden Funktion',
       (select case
                 when md5(f.prosrc) = '24c3810288bb20929fe995554a267adf'
                   then 'STAND_0131_ZEICHENGLEICH'
                 when md5(f.prosrc) = 'a27b61db988df7627a4992b1770ac626'
                   then 'STAND_0130'
                 else 'UNBEKANNT' end
          from fn f),
       'STAND_0131_ZEICHENGLEICH')
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
