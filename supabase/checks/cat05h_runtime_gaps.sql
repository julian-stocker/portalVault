-- ===========================================================================
-- DIAGNOSE CAT-05H, Teil 2: was der Probelauf NICHT hat
--
-- WAS SCHON BEWIESEN IST (Teil 1 und ein PostgREST-Aufruf mit nicht
-- existierenden SKY-IDs):
--   * SKY-0103 und SKY-0824 sind UNVERAENDERT.
--   * PostgREST loest die Vierparameterfassung richtig auf — der Aufruf
--     erreichte den Rumpf und bekam `42501 not authorised` von der
--     Adminpruefung. Signatur, Schema-Cache und Ueberladung sind in Ordnung.
--   * Die Vorschau ist nicht veraltet: `Pirate Ship -> Pirate Seas` ist
--     genau, was der Server rechnet.
--
-- WAS ALSO UEBRIG BLEIBT: etwas im Rumpf, das es im Probelauf nicht gibt.
-- Das Stub-Schema des Probelaufs traegt **keine Trigger, keine Schluessel
-- und keine Richtlinien** — sechs dokumentierte Werkzeugbefunde. Diese Datei
-- messt genau diese Luecken an der echten Datenbank.
--
--   201-204  `catalog_editorial`: traegt `sky_id` eine UNIQUE- oder
--            PRIMARY-KEY-Einschraenkung? **Der Hauptverdacht.** Die
--            Uebernahme der Notiz macht
--            `insert … on conflict (sky_id) do update`. Ohne passende
--            Einschraenkung antwortet PostgreSQL `42P10` („there is no
--            unique or exclusion constraint matching the ON CONFLICT
--            specification") — und im Probelauf musste genau dieser Index
--            von Hand angelegt werden, weil das Stub-Schema ihn nicht hat.
--   211-216  DIE TRIGGER auf `skylanders`. Jeder `update` im Rumpf loest
--            sie aus. Einer davon schreibt das Journal.
--   221-226  DIE RICHTLINIEN auf `catalog_admin_changes` und
--            `catalog_editorial`, und ob RLS dort an ist. Eine
--            `security definer`-Funktion laeuft als Eigner — aber eine
--            Richtlinie mit `with check` greift auch dann, wenn der Eigner
--            nicht `bypassrls` hat.
--   231-236  `is_platform_admin()` und `admin_merge_references()`: Rumpf,
--            Attribute, und wie viele Fremdschluessel die Zaehlung wirklich
--            durchgeht.
--   241-244  Die Spalten, die der Rumpf anfasst — gibt es sie alle, und mit
--            welchem Typ.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with ce as (
  select c.conname, c.contype, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_editorial')
),
ce_idx as (
  select i.indexrelid::regclass::text as name, i.indisunique, i.indisprimary,
         pg_get_indexdef(i.indexrelid) as def
    from pg_index i
   where i.indrelid = to_regclass('public.catalog_editorial')
),
trg as (
  select t.tgname, t.tgenabled, p.proname, p.prosecdef,
         pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal
),
pruef (nr, bereich, pruefung, befund) as (values
  -- ------------- 1. catalog_editorial und ON CONFLICT (sky_id)  [Verdacht]
  (201, 'ON CONFLICT', 'catalog_editorial steht',
      (to_regclass('public.catalog_editorial') is not null)::text),
  (202, 'ON CONFLICT', 'Einschraenkungen (Typ:Name:Definition)',
      (select coalesce(string_agg(contype::text || ':' || conname::text || ':' || def, '  ||  '
                                  order by conname), '(keine)') from ce)),
  (203, 'ON CONFLICT', 'eindeutige Indizes',
      (select coalesce(string_agg(name || ' unique=' || indisunique::text
                                  || ' pk=' || indisprimary::text, '  ||  '
                                  order by name), '(keine)') from ce_idx)),
  /*
   * DIE ENTSCHEIDENDE ZEILE. `on conflict (sky_id)` braucht einen
   * eindeutigen Index GENAU auf `sky_id`. Steht hier 0, ist der Fehler
   * gefunden: `42P10`, und zwar in der Zeile, die die interne Notiz
   * uebernimmt.
   */
  (204, 'ON CONFLICT', 'eindeutige Indizes GENAU auf (sky_id) — 0 waere der Fehler 42P10',
      (select count(*)::text from pg_index i
        where i.indrelid = to_regclass('public.catalog_editorial')
          and i.indisunique
          and i.indnatts = 1
          and (select a.attname from pg_attribute a
                where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'sky_id')),

  -- ---------------------------------- 2. Die Trigger auf skylanders
  (211, 'Trigger', 'Anzahl eigener Trigger auf skylanders',
      (select count(*)::text from trg)),
  (212, 'Trigger', 'Namen : Funktion : security definer : aktiv',
      (select coalesce(string_agg(tgname::text || ':' || proname::text || ':' || prosecdef::text
                                  || ':' || tgenabled::text, '  ||  ' order by tgname),
                       '(keine)') from trg)),
  (213, 'Trigger', 'einer davon schreibt das Journal (0004)',
      (select count(*)::text from trg where def ilike '%update%' or proname ilike '%log%'
                                         or proname ilike '%audit%' or proname ilike '%change%')),
  (214, 'Trigger', 'der Statussynchronisierer aus 0152 steht',
      (select count(*)::text from trg where tgname = 'skylanders_sync_catalog_status')),
  (215, 'Trigger', 'Trigger, deren Funktion KEIN security definer ist',
      (select count(*)::text from trg where not prosecdef)),
  (216, 'Trigger', 'Trigger, deren Funktion keine search_path-Festlegung hat',
      (select count(*)::text from trg t2
        join pg_proc p2 on p2.proname = t2.proname
       where (select count(*) from unnest(coalesce(p2.proconfig, '{}')) c
               where c like 'search\_path=%') = 0)),

  -- --------------------------------- 3. RLS auf den beiden Zieltabellen
  (221, 'RLS', 'catalog_admin_changes: RLS an?',
      (select coalesce(max(c.relrowsecurity::text), '(fehlt)') from pg_class c
        where c.oid = to_regclass('public.catalog_admin_changes'))),
  (222, 'RLS', 'catalog_admin_changes: erzwungen auch fuer den Eigner?',
      (select coalesce(max(c.relforcerowsecurity::text), '(fehlt)') from pg_class c
        where c.oid = to_regclass('public.catalog_admin_changes'))),
  (223, 'RLS', 'catalog_admin_changes: Richtlinien (Name:Befehl)',
      (select coalesce(string_agg(polname::text || ':' || polcmd::text, ', ' order by polname), '(keine)')
         from pg_policy where polrelid = to_regclass('public.catalog_admin_changes'))),
  (224, 'RLS', 'catalog_editorial: RLS an? | erzwungen?',
      (select coalesce(max(c.relrowsecurity::text || ' | ' || c.relforcerowsecurity::text),
                       '(fehlt)') from pg_class c
        where c.oid = to_regclass('public.catalog_editorial'))),
  (225, 'RLS', 'catalog_editorial: Richtlinien (Name:Befehl)',
      (select coalesce(string_agg(polname::text || ':' || polcmd::text, ', ' order by polname), '(keine)')
         from pg_policy where polrelid = to_regclass('public.catalog_editorial'))),
  (226, 'RLS', 'skylanders: RLS an? | erzwungen?',
      (select coalesce(max(c.relrowsecurity::text || ' | ' || c.relforcerowsecurity::text),
                       '(fehlt)') from pg_class c
        where c.oid = to_regclass('public.skylanders'))),

  -- -------------------------- 4. Die beiden Funktionen, die der Rumpf ruft
  (231, 'Aufrufe', 'is_platform_admin(): security definer | volatil | search_path',
      (select coalesce(max(p.prosecdef::text || ' | ' || p.provolatile::text || ' | '
                       || (select count(*)::text from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.is_platform_admin()'))),
  (232, 'Aufrufe', 'is_platform_admin(): welche Tabelle sie liest',
      (select coalesce(max(case when p.prosrc ilike '%shop_admins%' then 'shop_admins'
                                else 'etwas anderes' end), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.is_platform_admin()'))),
  (233, 'Aufrufe', 'admin_merge_references(text): security definer | volatil',
      (select coalesce(max(p.prosecdef::text || ' | ' || p.provolatile::text), '(fehlt)')
         from pg_proc p where p.oid = to_regprocedure('public.admin_merge_references(text)'))),
  /*
   * WIE VIELE TABELLEN DIE ZAEHLUNG WIRKLICH DURCHGEHT. Im Probelauf waren
   * es ZWEI (von Hand nachgezogen), hier sind es alle echten. Jede davon
   * wird gezaehlt — eine, die der Eigner nicht lesen darf, waere ein Fehler
   * mitten im Rumpf.
   */
  (234, 'Aufrufe', 'einspaltige Fremdschluessel auf skylanders.sky_id',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'
          and array_length(c.conkey, 1) = 1)),
  (235, 'Aufrufe', 'MEHRSPALTIGE Fremdschluessel auf skylanders — muss 0 sein',
      (select count(*)::text from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f'
          and array_length(c.conkey, 1) <> 1)),
  (236, 'Aufrufe', 'die verweisenden Tabellen',
      (select coalesce(string_agg(distinct c.conrelid::regclass::text, ', '), '(keine)')
         from pg_constraint c
        where c.confrelid = to_regclass('public.skylanders') and c.contype = 'f')),

  -- ------------------------------- 5. Die Spalten, die der Rumpf schreibt
  (241, 'Spalten', 'skylanders: die neun Felder der Allowlist, mit Typ',
      (select coalesce(string_agg(a.attname::text || ':' || format_type(a.atttypid, null), ', '
                                  order by a.attname), '(keine)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped
          and a.attname in ('name', 'display_name_override', 'series_code', 'category_id',
                            'card_type', 'item_type', 'character_id',
                            'image_override_path'))),
  (242, 'Spalten', 'catalog_editorial: admin_note und updated_at',
      (select coalesce(string_agg(a.attname::text || ':' || format_type(a.atttypid, null), ', '
                                  order by a.attname), '(keine)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.catalog_editorial') and not a.attisdropped
          and a.attname in ('sky_id', 'admin_note', 'updated_at'))),
  (243, 'Spalten', 'catalog_editorial: Spalten NOT NULL ohne Vorgabewert — die muss ein insert treffen',
      (select coalesce(string_agg(a.attname::text, ', ' order by a.attname), '(keine)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.catalog_editorial') and not a.attisdropped
          and a.attnum > 0 and a.attnotnull
          and not exists (select 1 from pg_attrdef d
                           where d.adrelid = a.attrelid and d.adnum = a.attnum))),
  (244, 'Spalten', 'catalog_admin_changes: Spalten NOT NULL ohne Vorgabewert',
      (select coalesce(string_agg(a.attname::text, ', ' order by a.attname), '(keine)')
         from pg_attribute a
        where a.attrelid = to_regclass('public.catalog_admin_changes') and not a.attisdropped
          and a.attnum > 0 and a.attnotnull
          and not exists (select 1 from pg_attrdef d
                           where d.adrelid = a.attrelid and d.adnum = a.attnum)))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
