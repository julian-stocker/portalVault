-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0035, REIN LESEND
--
-- EINE ANWEISUNG. Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als
-- `postgres`. **Erwartet: Zeile 9999 = `0`.**
--
-- *** DIE BASELINE GEHOERT IN DIESE DATEI ***
--
-- Vor dem Lauf die Zeile 900 des Preflights dort eintragen, wo
-- `BASELINE-PLATZHALTER` steht. KEIN `set_config` davor: das ist
-- transaktionslokal und erreicht eine spaetere Ausfuehrung im SQL-Editor
-- nicht. Zeile 301 schlaegt an, solange der Platzhalter drinsteht.
--
-- *** SIE RUFT DIE FUNKTION NICHT AUF ***
--
-- Kein `select system_set_image_override(...)`. Eine Nachkontrolle, die einen
-- Bildverweis setzt, um zu pruefen, ob man einen setzen kann, hat die
-- Pruefung zur Handlung gemacht. Geprueft wird der ZUSTAND.
--
--   101-103  DIE UMGEBUNG, positiv und am Schema
--   201-207  DIE FUNKTION: Existenz, Signatur, definer, leerer search_path,
--            RUMPFABDRUCK gegen die Migrationsdatei, und sie ist nicht
--            aufgerufen worden
--   211-215  DIE RECHTE — service_role ja, anon/authenticated/PUBLIC nein
--   301-309  BESTAND, BILDVERWEISE und Nutzerdaten unveraendert
-- ===========================================================================

with
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_set_image_override'
),
mess as (
  select
    (select count(*)::text from public.skylanders)            as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes) as journalzeilen,
    (select count(*)::text from public.shop_inventory)        as lagerzeilen,
    (select count(*)::text from public.collection_items)      as sammlungszeilen,
    (select count(*)::text from public.skylanders
      where image_override_path is not null)                  as mit_bildverweis,
    (select coalesce(md5(string_agg(s.sky_id || '|' || coalesce(s.image_override_path, '~'),
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                              as bildabdruck
),
vertrag as (
  select coalesce(
    nullif(btrim(coalesce(current_setting('skyisles.p0035', true), '')), ''),
    'BASELINE-PLATZHALTER'
  ) as roh,
  (nullif(btrim(coalesce(current_setting('skyisles.p0035', true), '')), '') is not null)
    as vorgegeben
),
soll as (
  select roh, t[1] = 'skyisles-p0035-1' as marke,
         t[2] as katalogzeilen, t[3] as journalzeilen, t[4] as lagerzeilen,
         t[5] as sammlungszeilen, t[6] as mit_bildverweis, t[7] as bildabdruck,
         t[8] as selbstprobe
    from (select roh, string_to_array(roh, '|') as t from vertrag) q
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (101, 'Umgebung', '0133: die Triggerfunktion liegt weiter',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', '0133: und ihr Trigger auch',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'es ist NICHT das Staging-Band',
      (select (count(*) = 0)::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'
          and min_value = 928 and max_value = 4999), 'true'),

  (201, 'Funktion', 'sie liegt, genau einmal',
      (select count(*)::text from fn), '1'),
  (202, 'Funktion', 'mit der erwarteten Signatur (text, text)',
      (select (to_regprocedure('public.system_set_image_override(text,text)') is not null)::text),
      'true'),
  (203, 'Funktion', 'security definer',
      (select coalesce(bool_or(prosecdef)::text, 'fehlt') from fn), 'true'),
  (204, 'Funktion', 'eine search_path-Festlegung ist vorhanden',
      (select (count(*) > 0)::text from fn, unnest(coalesce(fn.proconfig, '{}'::text[])) c
        where c like 'search\_path=%'), 'true'),
  /*
   * ENTQUOTET, nicht verglichen: PostgreSQL legt den leeren Wert als
   * `search_path=""` ab. Der Ausdruck ist der aus `0165`, Zeichen fuer
   * Zeichen.
   */
  (205, 'Funktion', 'und sie ist LEER — ausgepackt und entquotet',
      (select coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                          from fn, unnest(coalesce(fn.proconfig, '{}'::text[])) c
                         where c like 'search\_path=%'), '(leer)')), '(leer)'),
  /*
   * DER RUMPFABDRUCK GEGEN DIE MIGRATIONSDATEI. 889 Zeichen, am 2026-10-30
   * aus `supabase/migrations/0035_system_set_image_override.sql` gerechnet.
   * Weicht er ab, laeuft hier eine andere Funktion als die freigegebene.
   */
  (206, 'Funktion', 'der Rumpfabdruck ist der aus der Migrationsdatei',
      (select coalesce(md5(max(prosrc)), 'fehlt') from fn),
      'f269a6fe05349cad53c0cf44a8e01e11'),
  (207, 'Funktion', 'sie ist nicht aufgerufen worden — kein neuer Bildverweis',
      (select mit_bildverweis from mess),
      (select coalesce(mit_bildverweis, '(BASELINE FEHLT)') from soll)),

  (211, 'Rechte', 'service_role darf ausfuehren',
      (select has_function_privilege('service_role',
         'public.system_set_image_override(text,text)', 'execute')::text), 'true'),
  (212, 'Rechte', 'anon darf NICHT',
      (select has_function_privilege('anon',
         'public.system_set_image_override(text,text)', 'execute')::text), 'false'),
  (213, 'Rechte', 'authenticated darf NICHT',
      (select has_function_privilege('authenticated',
         'public.system_set_image_override(text,text)', 'execute')::text), 'false'),
  (214, 'Rechte', 'PUBLIC darf NICHT — der Fall, den ein NULL-ACL erlauben wuerde',
      (select has_function_privilege('public',
         'public.system_set_image_override(text,text)', 'execute')::text), 'false'),
  (215, 'Rechte', 'der ACL im Volltext',
      (select coalesce(string_agg(g.grantee || '=' || g.priv, ', '
                                  order by g.grantee collate "C"), '(NULL-ACL!)')
         from (select (aclexplode(p.proacl)).grantee::regrole::text as grantee,
                      (aclexplode(p.proacl)).privilege_type as priv
                 from pg_proc p where p.oid = (select oid from fn)) g), null),

  (301, 'Baseline', 'eine Baseline ist eingetragen (nicht der Platzhalter)',
      (select (roh <> 'BASELINE-PLATZHALTER')::text from vertrag), 'true'),
  (302, 'Baseline', 'sie traegt die Marke skyisles-p0035-1',
      (select coalesce(marke::text, 'false') from soll), 'true'),
  (303, 'Baseline', 'ihre Selbstprobe stimmt',
      (select coalesce(left(md5(katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen
                       || '|' || sammlungszeilen || '|' || mit_bildverweis || '|'
                       || bildabdruck), 12), '(BASELINE FEHLT)') from soll),
      (select coalesce(selbstprobe, '(BASELINE FEHLT)') from soll)),
  (304, 'Unveraendert', 'Katalogzeilen',
      (select katalogzeilen from mess),
      (select coalesce(katalogzeilen, '(BASELINE FEHLT)') from soll)),
  (305, 'Unveraendert', 'Journalzeilen — der Lauf schreibt keine',
      (select journalzeilen from mess),
      (select coalesce(journalzeilen, '(BASELINE FEHLT)') from soll)),
  (306, 'Unveraendert', 'Lagerzeilen',
      (select lagerzeilen from mess),
      (select coalesce(lagerzeilen, '(BASELINE FEHLT)') from soll)),
  (307, 'Nutzerdaten', 'Sammlungszeilen',
      (select sammlungszeilen from mess),
      (select coalesce(sammlungszeilen, '(BASELINE FEHLT)') from soll)),
  (308, 'Unveraendert', 'der Abdruck ueber alle Bildverweise — hier MUSS er '
                        'gleich sein',
      (select bildabdruck from mess),
      (select coalesce(bildabdruck, '(BASELINE FEHLT)') from soll)),
  (309, 'Baseline', 'Info: Herkunft der Grundlage',
      (select case when vorgegeben then 'uebergeben' else 'aus der Datei' end
         from vertrag), null)
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
