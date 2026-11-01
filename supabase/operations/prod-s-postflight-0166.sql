-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0166, MIT BASELINE IN DERSELBEN TRANSAKTION
--
-- Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype, als `postgres`.
-- DIE GANZE DATEI IN EINEM STUECK ausfuehren.
--
-- ###########################################################################
-- ##  EINE STELLE MUESSEN SIE ERSETZEN:                                    ##
-- ##    BASIS-HIER-EINSETZEN   <- Zeile 900 von prod_0166_preflight.sql     ##
-- ##  Abschnitt B prueft das VOR der Tabelle und bricht ab.               ##
-- ###########################################################################
--
-- Warum geklammert: `set_config(..., true)` gilt nur bis zum Ende der
-- Transaktion; ohne `begin` laeuft im SQL-Editor jede Anweisung in ihrer
-- eigenen (Lehre aus P-1, 0167). Hier: `begin; set transaction read only;`
-- … `rollback;` — sie schreibt nichts.
--
-- ERGEBNIS: eine Tabelle. Zeile 9999 muss `0` zeigen. Zeile 805 ist
-- Auskunft (Sammlungen/Favoriten bewegen sich im Betrieb).
-- ===========================================================================

begin;
set transaction read only;

-- A  IST DAS PRODUCTION, UND LIEGT 0166?
do $ziel$
begin
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     = 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: das ist Staging. Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype).';
  end if;
  if to_regprocedure('public.purchases_paid_total_is_final()') is null
     or not exists (select 1 from pg_trigger t
                     where t.tgrelid = to_regclass('public.purchases')
                       and t.tgname = 'purchases_paid_total_immutable_trg'
                       and not t.tgisinternal) then
    raise exception 'ABBRUCH A2: 0133 liegt hier nicht vollstaendig — das ist nicht Production.';
  end if;
  if exists (select 1 from pg_sequences where schemaname = 'public'
              and sequencename = 'sky_id_seq' and min_value = 928 and max_value = 4999) then
    raise exception 'ABBRUCH A3: sky_id_seq traegt das Staging-Band.';
  end if;
  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A4: weniger als 100 Katalogzeilen — kein Production-Projekt.';
  end if;
  if to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is null then
    raise exception 'ABBRUCH A5: 0166 liegt hier nicht. Erst prod-0166.sql.';
  end if;
end
$ziel$;

-- B  DIE BASELINE — in DIESER Transaktion gesetzt
select set_config('skyisles.p0166', 'BASIS-HIER-EINSETZEN', true);

do $basis$
declare
  v text[] := string_to_array(current_setting('skyisles.p0166', true), '|');
begin
  if coalesce(current_setting('skyisles.p0166', true), '') not like 'skyisles-p0166-1|%' then
    raise exception 'ABBRUCH B0: keine Baseline — der Platzhalter steht noch oder die Zeile ist '
      'unvollstaendig. Zeile 900 des Preflights einsetzen.';
  end if;
  if v is null or array_length(v, 1) <> 7 or v[1] <> 'skyisles-p0166-1' then
    raise exception 'ABBRUCH B1: die Baseline ist nicht angekommen oder hat nicht sieben Felder.';
  end if;
  if v[7] <> left(md5(array_to_string(v[2:6], '|')), 12) then
    raise exception 'ABBRUCH B2: die Schutzsumme der Baseline stimmt nicht.';
  end if;
end
$basis$;

-- C  DIE NACHKONTROLLE, unveraendert
-- >>> EINGEBETTET: supabase/checks/prod_0166_postflight.sql
-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0166, REIN LESEND
--
-- Nicht einzeln fahren: sie braucht die Baseline in DERSELBEN Transaktion.
-- Fertig geklammert: `supabase/operations/prod-s-postflight-0166.sql`.
-- **Erwartet: Zeile 9999 = `0`.**
--
--   201-206  die Funktion steht genau einmal, acht Parameter, SECURITY
--            DEFINER, leerer search_path, ruft die vier Schreibwege.
--   211-213  authenticated darf sie, anon und PUBLIC nicht.
--   801-804  der Bestand ist der aus dem Preflight (Katalog, Journal, Lager,
--            Bestellzeilen, Katalogabdruck mit Varianten/Types/Banner).
--   805      Auskunft: Sammlungen und Favoriten — NICHT blockierend.
-- ===========================================================================

with
mess as (
  select
    (select count(*)::text from public.skylanders)                 as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)      as journalzeilen,
    (select count(*)::text from public.shop_inventory)             as lagerzeilen,
    (select count(*)::text from public.order_lines)                as bestellzeilen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug || '|'
                                    || coalesce(s.base_sky_id, '~') || '|'
                                    || array_to_string(s.types, '+') || '|'
                                    || coalesce(s.visible_type, '~'),
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                   as katalogabdruck,
    (select count(*)::text from public.collection_items)           as sammlungszeilen,
    (select count(*)::text from public.favorites)                  as favoriten
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || bestellzeilen || '|' || katalogabdruck as kern, m.* from mess m
),
heute as (
  select 'skyisles-p0166-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
basis as (
  select nullif(btrim(coalesce(current_setting('skyisles.p0166', true), '')), '') as roh
),
teil as (
  select roh, case when roh is null then null else string_to_array(roh, '|') end as t from basis
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (201, '0166', 'admin_create_variant_figure liegt, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_create_variant_figure'), '1'),
  (202, '0166', 'mit genau dieser Signatur (acht Parameter)',
      (to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is not null)::text, 'true'),
  (203, '0166', 'SECURITY DEFINER',
      coalesce((select p.prosecdef::text from pg_proc p where p.oid = to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)')), '(fehlt)'), 'true'),
  (204, '0166', 'mit LEEREM search_path',
      coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                  from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                 where p.oid = to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') and c like 'search\_path=%'), '(leer)'), '(leer)'),
  (205, '0166', 'ruft die vier Schreibwege',
      coalesce((select (p.prosrc like '%public.admin_create_figure(%'
                        and p.prosrc like '%public.admin_set_variant_base(%'
                        and p.prosrc like '%public.admin_set_figure_types(%'
                        and p.prosrc like '%public.admin_set_visible_type(%')::text
                  from pg_proc p where p.oid = to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)')), '(fehlt)'), 'true'),
  (206, '0166', 'Auskunft: md5 des Rumpfs (Staging: bfb4a56fbe3467131d3b1b0ff48c912a)',
      (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)')),
      'bfb4a56fbe3467131d3b1b0ff48c912a'),
  (211, 'Rechte', 'authenticated darf sie — der Adminbereich ruft sie',
      coalesce(has_function_privilege('authenticated', to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)'), 'execute')::text, '(fehlt)'), 'true'),
  (212, 'Rechte', 'anon darf sie NICHT',
      coalesce(has_function_privilege('anon', to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)'), 'execute')::text, '(fehlt)'), 'false'),
  (213, 'Rechte', 'PUBLIC darf sie NICHT',
      coalesce(has_function_privilege('public', to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)'), 'execute')::text, '(fehlt)'), 'false'),

  (801, 'Basis', 'eine Baseline ist uebergeben worden',
      (select case when roh like 'skyisles-p0166-1|%' then 'ja' else 'FEHLT' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-p0166-1 und sieben Felder',
      (select case when t is null then 'keine Baseline'
                   else (t[1] = 'skyisles-p0166-1' and array_length(t, 1) = 7)::text end from teil), 'true'),
  (803, 'Basis', 'die Schutzsumme stimmt',
      (select case when t is null or array_length(t, 1) <> 7 then 'keine Baseline'
                   else (t[7] = left(md5(array_to_string(t[2:6], '|')), 12))::text end from teil), 'true'),
  (804, 'Bestand', 'Katalog, Journal, Lager, Bestellzeilen und Katalogabdruck wie vor dem Lauf',
      (select kern from feld),
      (select case when t is null then '(keine Baseline)' else array_to_string(t[2:6], '|') end from teil)),
  (805, 'Auskunft', 'Sammlungen · Favoriten (laufender Betrieb, nicht blockierend)',
      (select sammlungszeilen || ' · ' || favoriten from mess), null),
  (809, 'Info', 'der heutige Stand als Baseline-Zeile', (select zeile from heute), null)
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
-- <<< ENDE: supabase/checks/prod_0166_postflight.sql

rollback;
