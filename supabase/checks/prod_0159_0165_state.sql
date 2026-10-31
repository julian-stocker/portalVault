-- ===========================================================================
-- PRODUCTION — WELCHE MIGRATIONEN LIEGEN DORT WIRKLICH? (0159-0165)
--
-- REIN LESEND, EINE ANWEISUNG. Im SQL-Editor des Projekts
-- zmiwxswrpkmizvqsgype als `postgres` ausfuehren.
--
-- *** WARUM ES SIE GIBT ***
--
-- `APPLIED.md` fuehrt `0159`-`0164` auf Production als OFFEN und sagt
-- ausdruecklich „Vorbereitet, aber nicht ausgefuehrt: `0159` (Gruppe G3')".
-- Eine lesende Messung ueber PostgREST am 2026-10-30 hat das Gegenteil
-- gezeigt: `admin_set_variant_base`, `admin_publish_variant_auto`,
-- `admin_delete_figure`, `admin_set_figure_types` und `admin_set_visible_type`
-- sind dort ausgewiesen, die Spalten `base_sky_id`, `types`, `visible_type`
-- und `visible_type_decided` stehen, und **418 Zeilen tragen eine nicht leere
-- Typmenge** samt 171 entschiedenen Bannern — das ist die Erstbelegung aus
-- `0163`.
--
-- Zwei Quellen widersprechen sich, und keiner von beiden wird geglaubt
-- (CLAUDE.md). PostgREST sieht aber nur, was ihm ausgewiesen ist: keine
-- Constraints, keine Trigger, keine Funktionsruempfe, keine Rechte und keine
-- Triggerfunktionen. Diese Datei sieht alles davon.
--
-- *** SIE STUFT NICHTS VORAB EIN ***
--
-- Die Bereiche 1xx-7xx MESSEN, ohne Sollwert. Erst Bereich 9xx leitet daraus
-- ein Urteil je Migration ab — aus dem, was gefunden wurde, nicht aus der
-- Akte. „TEILWEISE" ist ein moegliches Ergebnis und das wichtigste: es hiesse,
-- ein Lauf ist in der Mitte stehengeblieben.
-- ===========================================================================

with
/* ------------------------------------------------------------------ Bausteine */
sp as (   -- Spalten von skylanders
  select a.attname::text as name from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped and a.attnum > 0
),
co as (   -- Constraints auf den beiden Tabellen
  select c.conname::text as name, c.conrelid::regclass::text as tab,
         pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conrelid in (to_regclass('public.skylanders'),
                        to_regclass('public.catalog_admin_changes'))
),
tg as (   -- Trigger auf skylanders
  select t.tgname::text as name from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal
),
fn as (   -- Funktionen in public, mit Rumpfabdruck
  select p.proname::text as name,
         pg_get_function_identity_arguments(p.oid) as args,
         md5(p.prosrc) as rumpf, p.prosecdef as definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
da as (select name from fn),
mess (nr, bereich, pruefung, befund) as (values
  -- ------------------------------------------------------------------ 0159
  (101, '0159', 'Spalte skylanders.base_sky_id',
      (select case when exists (select 1 from sp where name = 'base_sky_id') then 'da' else 'fehlt' end)),
  (102, '0159', 'Constraint skylanders_base_same_series',
      (select coalesce(max(def), 'fehlt') from co where name = 'skylanders_base_same_series')),
  (103, '0159', 'Constraint skylanders_id_series_uniq',
      (select case when exists (select 1 from co where name = 'skylanders_id_series_uniq') then 'da' else 'fehlt' end)),
  (104, '0159', 'Constraint skylanders_base_not_self',
      (select case when exists (select 1 from co where name = 'skylanders_base_not_self') then 'da' else 'fehlt' end)),
  (105, '0159', 'Trigger-Namen auf skylanders, alle',
      (select string_agg(name, ', ' order by name collate "C") from tg)),
  (106, '0159', 'admin_set_variant_base / admin_publish_with_base',
      (select (select count(*) from da where name = 'admin_set_variant_base')::text || ' / '
           || (select count(*) from da where name = 'admin_publish_with_base')::text)),
  (107, '0159', 'Rumpf von admin_merge_references (0159 = ?)',
      (select coalesce(max(rumpf), 'fehlt') from fn where name = 'admin_merge_references')),
  (108, '0159', 'Zeilen mit base_sky_id gesetzt',
      (select count(*)::text from public.skylanders where base_sky_id is not null)),

  -- --------------------------------------------------------------- 0160/0164
  /*
   * BEIDE AENDERN NUR `system_platform_export()`. Der Rumpfabdruck
   * unterscheidet sie eindeutig — nachgerechnet aus den Migrationsdateien
   * selbst am 2026-10-30:
   *     0160  31 114 Zeichen  ff4f38e61cbd4e5857ea914d6be68d44
   *     0164  31 248 Zeichen  7e9e58e2d84a9f8a7c660262aa21926b
   */
  (201, '0160/0164', 'Rumpfabdruck von system_platform_export',
      (select coalesce(max(rumpf), 'fehlt') from fn where name = 'system_platform_export')),
  (202, '0160/0164', 'Rumpflaenge in Zeichen',
      (select coalesce(max(length(p.prosrc))::text, 'fehlt') from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'system_platform_export')),

  -- ------------------------------------------------------------------ 0161
  (301, '0161', 'Rumpf von admin_publish_variant_auto (0161 = adf679de...)',
      (select coalesce(max(rumpf), 'fehlt') from fn where name = 'admin_publish_variant_auto')),

  -- ------------------------------------------------------------------ 0162
  (401, '0162', 'admin_set_market_price / admin_delete_figure',
      (select (select count(*) from da where name = 'admin_set_market_price')::text || ' / '
           || (select count(*) from da where name = 'admin_delete_figure')::text)),

  -- ------------------------------------------------------------------ 0163
  (501, '0163', 'Spalten types / visible_type / visible_type_decided',
      (select (select count(*) from sp where name = 'types')::text || ' / '
           || (select count(*) from sp where name = 'visible_type')::text || ' / '
           || (select count(*) from sp where name = 'visible_type_decided')::text)),
  (502, '0163', 'die drei CHECKs aus 0163, namentlich',
      (select coalesce(string_agg(name, ', ' order by name collate "C"), '(keine)')
         from co where def like '%types%' or def like '%visible_type%')),
  (503, '0163', 'Trigger skylanders_canonical_types',
      (select case when exists (select 1 from tg where name = 'skylanders_canonical_types')
                   then 'da' else 'fehlt' end)),
  (504, '0163', 'admin_set_figure_types / admin_set_visible_type',
      (select (select count(*) from da where name = 'admin_set_figure_types')::text || ' / '
           || (select count(*) from da where name = 'admin_set_visible_type')::text)),
  (505, '0163', 'Erstbelegung: Zeilen mit nicht leerer Typmenge',
      (select count(*)::text from public.skylanders where types <> '{}'::text[])),
  (506, '0163', 'Zeilen mit entschiedenem Banner',
      (select count(*)::text from public.skylanders where visible_type_decided)),
  (507, '0163', 'die Journal-Constraint, im Volltext',
      (select coalesce(max(def), 'fehlt') from co
        where name = 'catalog_admin_changes_field_known')),

  -- ------------------------------------------------------------------ 0165
  (601, '0165', 'system_sync_create_figure, Fassungen',
      (select count(*)::text from da where name = 'system_sync_create_figure')),
  (602, '0165', 'und mit der erwarteten Signatur',
      (select case when to_regprocedure('public.system_sync_create_figure(text,text,'
                     'text,text,bigint,text,text,text,text,text,smallint)') is not null
                   then 'da' else 'fehlt' end)),

  -- ------------------------------- Was der Abgleich zusaetzlich braucht
  /*
   * `system_set_image_override` (0035) traegt die sieben Bildschritte des
   * Plans. PostgREST hat sie auf Production NICHT ausgewiesen, auf Staging
   * schon — das kann Fehlen ODER ein fehlendes Recht sein. Hier wird beides
   * getrennt gefragt.
   */
  (701, 'Abgleich', 'system_set_image_override, Fassungen',
      (select count(*)::text from da where name = 'system_set_image_override')),
  (702, 'Abgleich', 'und wer sie ausfuehren darf',
      (select coalesce(string_agg(g.grantee || '=' || g.priv, ', ' order by g.grantee collate "C"),
                       '(niemand / Funktion fehlt)')
         from (select (aclexplode(p.proacl)).grantee::regrole::text as grantee,
                      (aclexplode(p.proacl)).privilege_type as priv
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'system_set_image_override') g)),
  (703, 'Abgleich', 'die vier Klasse-B-RPCs, Fassungen je',
      (select (select count(*) from da where name = 'admin_set_figure_types')::text || '/'
           || (select count(*) from da where name = 'admin_set_visible_type')::text || '/'
           || (select count(*) from da where name = 'admin_set_variant_base')::text || '/'
           || (select count(*) from da where name = 'admin_set_character')::text)),
  (704, 'Abgleich', 'Plattformadmins auf Production',
      (select count(*)::text from public.platform_admins)),

  -- ------------------------------------------------- Das Vergabeband
  (801, 'Band', 'sky_id_seq: Grenzen und Umlauf',
      (select min_value::text || ' .. ' || max_value::text || ', cycle ' || cycle::text
         from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq')),
  (802, 'Band', 'Sequenzstand',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select last_value::text || ''|'' || is_called::text as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end)),
  (803, 'Band', 'hoechste SKY-ID unter SKY-9000',
      (select coalesce(max(sky_id), '(leer)') from public.skylanders
        where sky_id ~ '^SKY-[0-8][0-9]{3}$')),
  (804, 'Band', 'Zeilen im Production-Band SKY-5001..SKY-8999 (Tabelle + Journal)',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-5001' and 'SKY-8999')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-5001' and 'SKY-8999'))::text),
  (805, 'Band', 'Zeilen im Bereich der 33 zu uebertragenden Nummern SKY-0822..SKY-0928',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0822' and 'SKY-0928')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0822' and 'SKY-0928'))::text),

  -- ------------------------------------------------- Bestand, zur Einordnung
  (901, 'Bestand', 'Katalog / Journal / Lager / Sammlungen / Kategorien',
      ((select count(*) from public.skylanders)::text || ' / '
       || (select count(*) from public.catalog_admin_changes)::text || ' / '
       || (select count(*) from public.shop_inventory)::text || ' / '
       || (select count(*) from public.collection_items)::text || ' / '
       || (select count(*) from public.categories)::text)),

  -- ============================================= DAS URTEIL, abgeleitet
  /*
   * ERST HIER WIRD EINGESTUFT, und zwar aus dem Gemessenen. Jede Zeile nennt
   * die Objekte, auf die sie sich stuetzt — wer das Urteil bestreitet, kann
   * es an den Bereichen oben nachprufen.
   */
  (9101, 'URTEIL', '0159 (base_sky_id, Constraints, zwei RPCs)',
      (select case
         when (select count(*) from sp where name = 'base_sky_id') = 0
              and (select count(*) from da where name = 'admin_set_variant_base') = 0
           then 'FEHLT'
         when (select count(*) from sp where name = 'base_sky_id') = 1
              and (select count(*) from co where name = 'skylanders_base_same_series') = 1
              and (select count(*) from da where name = 'admin_set_variant_base') = 1
              and (select count(*) from da where name = 'admin_publish_with_base') = 1
           then 'ANGEWENDET'
         else 'TEILWEISE — nachsehen' end)),
  (9102, 'URTEIL', '0160 / 0164 (am Rumpf von system_platform_export)',
      (select case (select coalesce(max(rumpf), 'fehlt') from fn where name = 'system_platform_export')
         when 'ff4f38e61cbd4e5857ea914d6be68d44' then '0160 ANGEWENDET, 0164 FEHLT'
         when '7e9e58e2d84a9f8a7c660262aa21926b' then '0160 UND 0164 ANGEWENDET'
         when 'fehlt' then 'die Funktion fehlt ganz — weder 0105 noch spaeter'
         else 'UNBEKANNTE FASSUNG — nachsehen' end)),
  (9103, 'URTEIL', '0161 (admin_publish_variant_auto)',
      (select case (select coalesce(max(rumpf), 'fehlt') from fn where name = 'admin_publish_variant_auto')
         when 'adf679deb5d42fad5dff15bd1641f318' then 'ANGEWENDET'
         when 'fehlt' then 'FEHLT'
         else 'ANDERE FASSUNG — nachsehen' end)),
  (9104, 'URTEIL', '0162 (zwei RPCs)',
      (select case
         when (select count(*) from da where name = 'admin_delete_figure') = 1
              and (select count(*) from da where name = 'admin_set_market_price') = 1 then 'ANGEWENDET'
         when (select count(*) from da where name = 'admin_delete_figure') = 0
              and (select count(*) from da where name = 'admin_set_market_price') = 0 then 'FEHLT'
         else 'TEILWEISE — nachsehen' end)),
  (9105, 'URTEIL', '0163 (drei Spalten, Trigger, zwei RPCs, Erstbelegung)',
      (select case
         when (select count(*) from sp where name in ('types','visible_type','visible_type_decided')) = 0
           then 'FEHLT'
         when (select count(*) from sp where name in ('types','visible_type','visible_type_decided')) = 3
              and (select count(*) from tg where name = 'skylanders_canonical_types') = 1
              and (select count(*) from da where name = 'admin_set_figure_types') = 1
              and (select count(*) from da where name = 'admin_set_visible_type') = 1
           then 'ANGEWENDET'
         else 'TEILWEISE — nachsehen' end)),
  (9106, 'URTEIL', '0165 (system_sync_create_figure)',
      (select case when to_regprocedure('public.system_sync_create_figure(text,text,text,'
                     'text,bigint,text,text,text,text,text,smallint)') is not null
                   then 'ANGEWENDET' else 'FEHLT' end)),
  (9107, 'URTEIL', 'das Production-Vergabeband SKY-5001..SKY-8999',
      (select case when min_value = 5001 and max_value = 8999 and not cycle
                   then 'GESPERRT' else 'NICHT GESPERRT (' || min_value::text || '..'
                        || max_value::text || ')' end
         from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq'))
)
select nr, bereich, pruefung, befund from mess
union all
select 9999, 'GESAMT', 'Diese Datei urteilt, sie verlangt nichts — es gibt keine '
       'blockierende Abweichung. Das Ergebnisblatt ist der Nachweis.', '(Messung)'
 order by nr;
