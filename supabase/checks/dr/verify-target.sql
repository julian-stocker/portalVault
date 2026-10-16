-- Zusatzpruefungen, die nur im ZIEL sinnvoll sind.
select 1 as nr, 'cron.job muss leer sein' as pruefung,
       case when to_regclass('cron.job') is null then '(kein cron-Schema)'
            else (select count(*)::text from cron.job) end as befund,
       '0 oder (kein cron-Schema)' as erwartet
union all
select 2, 'Bucket catalog vorhanden, oeffentlich, 2 MiB, 3 MIME-Typen',
       coalesce((select b.id || '|' || b.public::text || '|'
                        || coalesce(b.file_size_limit::text, 'null') || '|'
                        || coalesce(array_length(b.allowed_mime_types, 1)::text, 'null')
                   from storage.buckets b where b.id = 'catalog'), '(fehlt)'),
       'catalog|true|2097152|3'
union all
select 3, 'die vier catalog_images-Policies auf storage.objects',
       (select count(*)::text from pg_policy pol
          join pg_class c on c.oid = pol.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'storage' and c.relname = 'objects'
           and pol.polname like 'catalog\_images\_%'), '4'
union all
select 4, 'Unveraenderlichkeits-Trigger der Belege',
       (select count(*)::text from pg_trigger
         where not tgisinternal
           and tgname in ('purchase_receipts_immutable_trg',
                          'purchase_receipt_downloads_immutable_trg')), '2'
union all
select 5, 'auth.users vorhanden (Anzahl, keine Inhalte)',
       (select count(*)::text from auth.users), '(Vergleich mit der Quelle)'
union all
select 6, 'Tabellen in public mit RLS',
       (select count(*)::text from pg_class c
         where c.relnamespace = 'public'::regnamespace
           and c.relkind = 'r' and c.relrowsecurity),
       '(Vergleich mit der Quelle)'
union all
select 7, 'seller_business_backup() Rumpf-md5',
       coalesce((select md5(p.prosrc) from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname = 'seller_business_backup'), '(fehlt)'),
       'a3c922657e1c6410858b7c4b2bb7aae5'
union all
select 8, 'eine aktive Verkaeuferzeile (nur Anzahl)',
       (select count(*)::text from public.sellers where is_active), '1'
order by nr;
