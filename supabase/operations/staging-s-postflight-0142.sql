-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0142, REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren. Die Klammer
-- und das `rollback` stehen schon darin.
--
-- NACH `staging-0142.sql` fahren. Der SQL-Editor zeigt `NOTICE`-Meldungen
-- nicht an — „Success" allein ist kein sichtbarer Befund.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Zeilen mit `ok = NULL` sind
-- Messungen ohne Sollwert (hier nur 504).
--
-- WAS SIE NICHT BEANTWORTET: ob die Richtlinien WIRKEN. Dafuer gibt es
-- `npm run verify:calculations:staging` — zwei echte Sitzungen, die
-- einander nicht sehen duerfen.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT: ein einziges SELECT in
-- `begin … rollback`.
--
-- EINGEBETTET: `supabase/checks/0142_postflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- Bin ich auf Staging? Derselbe Stempel wie in `staging-0142.sql`: das PAAR
-- SKY-0821 + SKY-0822. Ein lesender Lauf im falschen Fenster richtet keinen
-- Schaden an, liefert aber einen falschen Befund.
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/checks/0142_postflight.sql
-- ===========================================================================
-- 0142 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0142_purchase_calculations.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- WAS SIE BEANTWORTET: steht die Tabelle mit ihren zwoelf Spalten, ist RLS
-- an, gelten vier Richtlinien, sind die Rechte so eng wie vorgesehen, stehen
-- die zwei Indizes und der Trigger — und ist die Tabelle LEER.
--
-- WAS SIE NICHT BEANTWORTET: ob die Richtlinien WIRKEN. Das zeigt nur ein
-- Lauf mit zwei echten Sitzungen: `npm run verify:calculations:staging`.
-- Eine Richtlinie, die richtig konfiguriert ist, und eine, die greift, sind
-- zwei verschiedene Aussagen (dieselbe Lehre wie `verify-rls.mts`).
--
-- NUR LESEN. Ein einziges SELECT.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ---------------------------------------------------------- Die Tabelle
  (101, 'Tabelle', 'public.purchase_calculations steht',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),
  (102, 'Tabelle', 'zwoelf Spalten, in dieser Folge',
      coalesce((select string_agg(column_name, ',' order by ordinal_position)
                  from information_schema.columns
                 where table_schema = 'public'
                   and table_name = 'purchase_calculations'), '(keine)'),
      'id,user_id,name,status,lines,factor_percent,total_cents,positions,units,'
      || 'purchase_id,created_at,updated_at'),
  (103, 'Tabelle', 'und die Typen, die sie tragen muessen',
      coalesce((select string_agg(column_name || ':' || data_type, ',' order by column_name)
                  from information_schema.columns
                 where table_schema = 'public' and table_name = 'purchase_calculations'
                   and column_name in ('id', 'user_id', 'lines', 'factor_percent',
                                       'purchase_id')), '(keine)'),
      'factor_percent:smallint,id:uuid,lines:jsonb,purchase_id:bigint,user_id:uuid'),
  /*
   * BERICHTIGT AM 2026-10-22: AUCH HIER STAND EINE ZAHL, DIE VERFAELLT.
   *
   * Die Zeile verlangte `0` — richtig in der Minute nach der Migration und
   * falsch, sobald jemand eine Kalkulation gespeichert hat. Genau das ist
   * auf Staging passiert: eine Browserprobe hat eine Zeile angelegt, und
   * ein zweiter Lauf dieser Datei haette sie als Abweichung gemeldet.
   *
   * „Die Migration legt keine Zeile an" ist ohnehin keine Frage an die
   * Nachkontrolle, sondern an die Migration: `0142` prueft es in ihrer
   * EIGENEN Transaktion (`die Migration hat % Zeile(n) angelegt`), und dort
   * ist es beweisbar. Hier bleibt eine Messung — die Zahl, die der Betrieb
   * gerade fuehrt.
   */
  (104, 'Tabelle', 'Info: gespeicherte Kalkulationen (nach der Migration 0, '
        'danach alles, was gespeichert wurde)',
      (select count(*)::text from public.purchase_calculations), null),

  -- -------------------------------------------------------------- Die CHECKs
  (111, 'Form', 'die fuenf CHECK-Bedingungen stehen',
      (select count(*)::text from pg_constraint
        where conrelid = 'public.purchase_calculations'::regclass and contype = 'c'), '5'),
  (112, 'Form', 'der Status kennt genau vier Werte',
      (select (position('''rejected''' in pg_get_constraintdef(oid)) > 0
               and position('''review''' in pg_get_constraintdef(oid)) > 0)::text
         from pg_constraint where conname = 'purchase_calculations_status_known'), 'true'),
  (113, 'Form', 'die Positionen sind auf 200 gedeckelt (wie 0064)',
      (select (position('<= 200' in pg_get_constraintdef(oid)) > 0)::text
         from pg_constraint where conname = 'purchase_calculations_lines_shape'), 'true'),

  -- ------------------------------------------------------------------- RLS
  (201, 'RLS', 'Row Level Security ist eingeschaltet',
      (select relrowsecurity::text from pg_class
        where oid = 'public.purchase_calculations'::regclass), 'true'),
  (202, 'RLS', 'vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (203, 'RLS', 'und zwar je eine fuer select, insert, update, delete',
      coalesce((select string_agg(distinct cmd, ',' order by cmd) from pg_policies
                 where schemaname = 'public'
                   and tablename = 'purchase_calculations'), '(keine)'),
      'DELETE,INSERT,SELECT,UPDATE'),
  (204, 'RLS', 'keine Richtlinie gilt fuer anon',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and 'anon' = any (roles)), '0'),
  (205, 'RLS', 'die Aenderung prueft BEIDE Haelften (using und with check)',
      (select (qual is not null and with_check is not null)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and policyname = 'purchase_calculations_update_own'), 'true'),
  (206, 'RLS', 'und jede Richtlinie haengt an auth.uid() = user_id',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and coalesce(qual, with_check) like '%uid()%'
          and coalesce(qual, with_check) like '%user_id%'), '4'),

  -- ---------------------------------------------------------------- Rechte
  (301, 'Rechte', 'anon hat KEIN Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'purchase_calculations'
          and grantee = 'anon'), '0'),
  (302, 'Rechte', 'authenticated hat genau die vier — kein truncate',
      coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                  from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'purchase_calculations'
                   and grantee = 'authenticated'), '(keine)'),
      'DELETE,INSERT,SELECT,UPDATE'),

  -- --------------------------------------------------- Indizes und Trigger
  (401, 'Zugriff', 'der Index je Konto und Aenderungszeit steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_user_updated_idx'), '1'),
  (402, 'Zugriff', 'der PARTIELLE Unique-Index auf purchase_id steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'
          and indexdef like '%WHERE (purchase_id IS NOT NULL)%'), '1'),
  (403, 'Zugriff', 'der updated_at-Trigger aus 0001 haengt daran',
      (select count(*)::text from pg_trigger
        where tgrelid = 'public.purchase_calculations'::regclass
          and tgname = 'purchase_calculations_set_updated_at'), '1'),

  -- ------------------------------------------- Was NICHT dazugekommen ist
  (501, 'Unberuehrt', 'keine zweite Tabelle fuer den Arbeitsstand',
      (select count(*)::text from information_schema.tables
        where table_schema = 'public'
          and (table_name like '%calculator%' or table_name like '%draft%')), '0'),
  /*
   * BERICHTIGT AM 2026-10-22: HIER STAND EINE ZAHL, UND DIE WAR FALSCH.
   *
   * Die Zeile verlangte „genau vier Richtlinien" auf `collection_items`.
   * Auf Staging sind es FUENF, und das ist richtig: `staging-agent-setup.sql`
   * legt je Tabelle eine eigene Lesepolicy `agent_read_<tabelle>` fuer die
   * Rolle `skyisles_agent` an — fuer zwoelf Tabellen, `collection_items`
   * darunter (`docs/SECURITY.md`, 4b). Sie ist auf diese Rolle und auf
   * `select` begrenzt und stand dort lange vor `0142`.
   *
   * Eine ZAHL war also die falsche Formulierung: sie bricht, sobald jemand
   * eine berechtigte Diagnosepolicy anlegt, und sie sagt nichts darueber,
   * ob die vier, auf die es ankommt, noch da sind. Gepruefft wird deshalb
   * die EIGENSCHAFT: die vier eigenen Richtlinien stehen, sie gelten fuer
   * `authenticated`, und keine Richtlinie dieser Tabelle gibt `anon` etwas.
   *
   * Zeile 505 nennt zusaetzlich alle Richtlinien beim Namen — damit eine
   * kuenftige Abweichung nicht als Zahl erscheint, sondern als Auskunft.
   */
  (502, 'Unberuehrt', 'die vier eigenen Richtlinien von collection_items stehen, fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (505, 'Unberuehrt', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),
  (506, 'Unberuehrt', 'und keine davon gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and 'anon' = any (roles)), '0'),
  (503, 'Unberuehrt', 'die Belegsperre haelt unveraendert',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('platform_receipts', 'platform_receipt_sequence')
          and grantee in ('anon', 'authenticated')), '0'),
  (504, 'Unberuehrt', 'Info: Einkaeufe (0142 legt keinen an)',
      (select count(*)::text from public.purchases), null)
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
-- <<< ENDE: supabase/checks/0142_postflight.sql

rollback;
