-- Zusatzpruefungen, die nur im ZIEL sinnvoll sind.
--
-- JEDE ZEILE TRAEGT IHR URTEIL (M-03D, 2026-11-09). Bis M-03C stand hier nur
-- `befund` und `erwartet`, und `60-compare.sh` gab die Datei bloss aus — eine
-- verfehlte Zielpruefung liess den Vergleich trotzdem bestehen. Jetzt rechnet
-- jede Zeile `ok` selbst aus, und `60-compare.sh` zaehlt jede Zeile mit
-- `ok = false` als Befund. Zeilen, die nur informieren, sagen das in
-- `erwartet` und sind `ok`, weil ihr Vergleich anderswo stattfindet
-- (`baseline-rows`, `baseline-definitions`).
--
-- KEIN DIREKTER VERWEIS AUF `cron`. `case when to_regclass('cron.job') is null
-- then … else (select … from cron.job) end` scheitert ohne cron-Schema schon
-- beim Planen — PostgreSQL loest den Unterzweig auf, auch wenn er nie
-- ausgefuehrt wird. Gezaehlt wird deshalb dynamisch (`query_to_xml`), und nur,
-- wenn es die Tabelle gibt. `cron` wird beim Restore bewusst nicht
-- uebernommen; ein Ziel ohne cron ist also zulaessig, ein Ziel MIT Jobs nicht.
select 1 as nr, 'cron.job muss leer sein' as pruefung, befund,
       '0 oder (kein cron-Schema)' as erwartet,
       befund in ('0', '(kein cron-Schema)') as ok
  from (select case when to_regclass('cron.job') is null then '(kein cron-Schema)'
                    else (xpath('/row/c/text()',
                                query_to_xml('select count(*) as c from cron.job', false, true, '')))[1]::text
               end as befund) x
union all
select 2, 'Bucket catalog vorhanden, oeffentlich, 2 MiB, 3 MIME-Typen', befund,
       'catalog|true|2097152|3', befund = 'catalog|true|2097152|3'
  from (select coalesce((select b.id || '|' || b.public::text || '|'
                                || coalesce(b.file_size_limit::text, 'null') || '|'
                                || coalesce(array_length(b.allowed_mime_types, 1)::text, 'null')
                           from storage.buckets b where b.id = 'catalog'), '(fehlt)') as befund) x
union all
select 3, 'die vier catalog_images-Policies auf storage.objects', befund, '4', befund = '4'
  from (select (select count(*)::text from pg_policy pol
                  join pg_class c on c.oid = pol.polrelid
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'objects'
                   and pol.polname like 'catalog\_images\_%') as befund) x
union all
select 4, 'Unveraenderlichkeits-Trigger der Belege', befund, '2', befund = '2'
  from (select (select count(*)::text from pg_trigger
                 where not tgisinternal
                   and tgname in ('purchase_receipts_immutable_trg',
                                  'purchase_receipt_downloads_immutable_trg')) as befund) x
union all
select 5, 'auth.users vorhanden (Anzahl, keine Inhalte)',
       (select count(*)::text from auth.users),
       '(Vergleich mit der Quelle: baseline-rows)', true
union all
select 6, 'Tabellen in public mit RLS',
       (select count(*)::text from pg_class c
         where c.relnamespace = 'public'::regnamespace
           and c.relkind = 'r' and c.relrowsecurity),
       '(Vergleich mit der Quelle: baseline-definitions, rls)', true
union all
-- Kein fest hinterlegter Abdruck mehr: der alte (`a3c9…`) war seit den
-- Neufassungen nach 0104 veraltet und haette jeden korrekten Restore
-- durchfallen lassen. Ob der Rumpf GLEICH ist, prueft `baseline-definitions`
-- (md5 jeder Funktion in Quelle und Ziel, Zeile fuer Zeile). Hier zaehlt nur,
-- dass sie da ist, genau einmal und als security definer.
select 7, 'seller_business_backup() vorhanden, einmal, security definer', befund,
       '1|definer (Rumpf: Vergleich mit der Quelle, baseline-definitions)',
       befund = '1|definer'
  from (select count(*)::text || '|'
               || case when bool_and(p.prosecdef) then 'definer' else 'invoker' end as befund
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'seller_business_backup') x
union all
select 8, 'eine aktive Verkaeuferzeile (nur Anzahl)', befund, '1', befund = '1'
  from (select (select count(*)::text from public.sellers where is_active) as befund) x
union all
-- Unser einziges Objekt in `auth` (0001): ohne ihn bekommt nach dem Restore
-- kein neues Konto ein Profil. Genau einmal, aktiviert, auf auth.users, und er
-- ruft public.handle_new_user().
select 9, 'Registrierungstrigger on_auth_user_created -> public.handle_new_user()', befund,
       '1|aktiv|public.handle_new_user', befund = '1|aktiv|public.handle_new_user'
  from (select count(*)::text || '|'
               || coalesce(min(case when t.tgenabled <> 'D' then 'aktiv' else 'aus' end), '-') || '|'
               || coalesce(min(fn.nspname || '.' || f.proname), '-') as befund
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_proc f on f.oid = t.tgfoid
          join pg_namespace fn on fn.oid = f.pronamespace
         where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users'
           and t.tgname = 'on_auth_user_created') x
order by nr;
