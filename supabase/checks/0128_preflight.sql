-- ===========================================================================
-- PREFLIGHT fuer Migration 0128  —  Korrekturbelege
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung.
--
-- ABLESEN
--   ok = true    Bedingung erfuellt
--   ok = false   BLOCKIEREND. Nicht migrieren, bis geklaert ist, warum.
--   ok = null    Zahl oder Text zum Vergleich, kein Urteil
--
-- Zeile 9999 muss 0 zeigen.
--
-- DIE 9xx-ZEILEN SIND DIE EINGANGSSEITIGE BASELINE. Der Postflight vergleicht
-- gegen genau diese Zahlen; `0128` darf keine davon bewegen — sie legt zwei
-- Spalten und zwei Funktionen an und stellt keinen Beleg aus.
--
-- ---------------------------------------------------------------------------
-- WORAUF 0128 AUFSETZT
--
-- Die Kettenstruktur steht seit `0122` und wird NICHT angefasst. Die
-- 1xx-Zeilen pruefen deshalb Stueck fuer Stueck, dass sie noch da ist: ohne
-- `receipts_supersedes_fk`, die beiden Teilindizes und die
-- Unveraenderlichkeits-Trigger waere eine Korrekturkette nicht
-- widerspruchsfrei, sondern nur eine zweite Zeile.
--
-- EIN SICHERER ZUSTAND DARF NICHT BLOCKIEREN. Laeuft dieser Preflight nach
-- `0128`, steht in 210 `NACH_0128` statt `VOR_0128` — beides ist in Ordnung,
-- `UNKLAR` nicht. Dieselbe Lehre wie bei `0125` und `0127`.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Die Struktur aus 0122/0123
  -- =====================================================================
  (101, '0122', 'die drei Belegtabellen stehen',
        ((select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('purchase_receipts', 'purchase_receipt_downloads',
                                'purchase_receipt_counters')))::text, '3'),
  (102, '0122', 'die Unveraenderlichkeits-Trigger stehen',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('purchase_receipts_immutable_trg',
                            'purchase_receipt_downloads_immutable_trg')))::text, '2'),
  (103, '0122', 'sie feuern BEFORE update und delete',
        ((select count(*) from pg_trigger
           where not tgisinternal
             and tgname = 'purchase_receipts_immutable_trg'
             and tgtype::int & 2 = 2
             and tgtype::int & 8 = 8
             and tgtype::int & 16 = 16))::text, '1'),
  (110, '0122', 'je Einkauf genau EIN Ursprungsbeleg (Teilindex)',
        (exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'purchase_receipts_origin_uniq'))::text, 'true'),
  (111, '0122', 'und die Kette gabelt nicht (Teilindex)',
        (exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'purchase_receipts_supersedes_uniq'))::text, 'true'),
  (112, '0122', 'die acht Zusicherungen der Kette',
        ((select count(*) from pg_constraint
           where conrelid = 'public.purchase_receipts'::regclass
             and conname in ('receipts_supersedes_fk', 'receipts_revision_matches_chain',
                             'receipts_no_self_reference', 'receipts_id_purchase_uniq',
                             'receipts_number_unique', 'receipts_number_shape',
                             'receipts_revision_sane', 'receipts_lines_present')))::text,
        '8'),
  (113, '0122', 'der Verweis zeigt auf (id, purchase_id) — derselbe Einkauf',
        ((select count(*) from pg_constraint c
            join pg_attribute a on a.attrelid = c.confrelid
                               and a.attnum = any (c.confkey)
           where c.conname = 'receipts_supersedes_fk'
             and a.attname in ('id', 'purchase_id')))::text, '2'),
  (120, '0123', 'die Spalte format_version steht',
        (exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchase_receipts'
                    and column_name = 'format_version'))::text, 'true'),
  (121, '0123', 'ihr Default ist 1 — die Aussage ueber bestehende Zeilen',
        (coalesce((select substring(pg_get_expr(d.adbin, d.adrelid) from '^[0-9]+')
                     from pg_attrdef d
                     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                    where d.adrelid = 'public.purchase_receipts'::regclass
                      and a.attname = 'format_version'), '(keiner)'))::text, '1'),
  /*
   * UND DIE ERSTAUSSTELLUNG SCHREIBT DIE FORMATNUMMER.
   *
   * Gesucht wird die SPALTENLISTE des INSERT und nicht das Literal `2`: eine
   * Zahl mit Einrueckung zu suchen waere eine Pruefung auf Formatierung.
   */
  (122, '0123', 'und die Erstausstellung schreibt format_version mit',
        (position('content_fingerprint, format_version' in coalesce((select p.prosrc
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),

  -- =====================================================================
  -- 13x  Die gerufenen Funktionen und die Eigentuemerkette
  -- =====================================================================
  (131, 'Kette', 'purchase_receipt_fingerprint(bigint) vorhanden',
        (to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is not null)::text,
        'true'),
  (132, 'Kette', 'seller_purchase_receipt(bigint) vorhanden',
        (to_regprocedure('public.seller_purchase_receipt(bigint)') is not null)::text,
        'true'),
  (133, 'Kette', 'seller_issue_purchase_receipt(bigint) vorhanden',
        (to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is not null)::text,
        'true'),
  /*
   * UND SIE IST IDEMPOTENT.
   *
   * Darauf ruht die ganze Aufteilung: die Erstausstellung gibt einen
   * bestehenden Beleg zurueck, nur die Korrektur legt eine weitere Fassung an.
   */
  (134, 'Kette', 'die Erstausstellung gibt einen bestehenden Beleg zurueck',
        (position('return public.seller_purchase_receipt(p_purchase_id);'
          in coalesce((select p.prosrc from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'seller_issue_purchase_receipt'), '')) > 0)::text, 'true'),
  (135, 'Kette', 'alle drei sind security definer',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('purchase_receipt_fingerprint', 'seller_purchase_receipt',
                               'seller_issue_purchase_receipt')
             and p.prosecdef))::text, '3'),
  (136, 'Kette', 'und gehoeren EINEM Eigentuemer',
        ((select count(distinct p.proowner) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('purchase_receipt_fingerprint', 'seller_purchase_receipt',
                               'seller_issue_purchase_receipt')))::text, '1'),
  (137, 'Kette', 'Info: wer ist dieser Eigentuemer',
        (coalesce((select pg_get_userbyid(p.proowner) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace
                      and p.proname = 'seller_issue_purchase_receipt'), '(fehlt)'))::text,
        null),
  /* 0125 muss in Kraft sein: der interne Fingerabdruck ist nicht erreichbar. */
  (138, '0125', 'authenticated darf den Fingerabdruck nicht rufen',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.purchase_receipt_fingerprint(bigint)')
             and a.privilege_type = 'EXECUTE'
             and (a.grantee = 0
                  or a.grantee::regrole::text in ('anon', 'authenticated'))))::text, '0'),
  (139, 'Rechte', 'die Belegtabellen sind fuer anon und authenticated gesperrt',
        ((select count(*) from (values ('anon'), ('authenticated')) t(rolle)
            cross join (values ('purchase_receipts'), ('purchase_receipt_counters'),
                               ('purchase_receipt_downloads')) u(tab)
           where has_table_privilege(t.rolle, 'public.' || u.tab, 'SELECT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'INSERT')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'UPDATE')
              or has_table_privilege(t.rolle, 'public.' || u.tab, 'DELETE')))::text, '0'),

  -- =====================================================================
  -- 2xx  Was 0128 anlegt
  -- =====================================================================
  (201, '0128', 'Info: supersedes_number vorhanden',
        (exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'purchase_receipts'
                    and column_name = 'supersedes_number'))::text, null),
  (202, '0128', 'Info: die Korrekturfunktion vorhanden',
        (to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
           is not null)::text, null),
  (203, '0128', 'Info: die Historienfunktion vorhanden',
        (to_regprocedure('public.seller_purchase_receipt_history(bigint)')
           is not null)::text, null),
  (210, '0128', 'Gesamtbefund zum Zustand',
        (case
           when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'purchase_receipts'
                           and column_name = 'supersedes_number')
                and to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
                    is not null
             then 'NACH_0128'
           when not exists (select 1 from information_schema.columns
                             where table_schema = 'public'
                               and table_name = 'purchase_receipts'
                               and column_name = 'supersedes_number')
                and to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
                    is null
             then 'VOR_0128'
           else 'UNKLAR'
         end)::text, null),
  (211, '0128', 'der Befund ist VOR_0128 oder NACH_0128, nicht UNKLAR',
        (case
           when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'purchase_receipts'
                           and column_name = 'supersedes_number')
                and to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
                    is not null
             then 'true'
           when not exists (select 1 from information_schema.columns
                             where table_schema = 'public'
                               and table_name = 'purchase_receipts'
                               and column_name = 'supersedes_number')
                and to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)')
                    is null
             then 'true'
           else 'false'
         end)::text, 'true'),

  -- =====================================================================
  -- 3xx  Die Kette ist heute widerspruchsfrei
  -- =====================================================================
  (301, 'Kette', 'kein Beleg mit revision > 1 ohne Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision > 1 and supersedes_id is null))::text, '0'),
  (302, 'Kette', 'kein Ursprungsbeleg mit Vorgaenger',
        ((select count(*) from public.purchase_receipts
           where revision = 1 and supersedes_id is not null))::text, '0'),
  (303, 'Kette', 'kein Beleg wird zweimal ersetzt',
        ((select count(*) from (select supersedes_id from public.purchase_receipts
                                 where supersedes_id is not null
                                 group by supersedes_id having count(*) > 1) d))::text, '0'),
  (304, 'Kette', 'kein Einkauf mit zwei Ursprungsbelegen',
        ((select count(*) from (select purchase_id from public.purchase_receipts
                                 where supersedes_id is null
                                 group by purchase_id having count(*) > 1) d))::text, '0'),
  (305, 'Kette', 'jeder Beleg zeigt auf einen Vorgaenger desselben Einkaufs',
        ((select count(*) from public.purchase_receipts r
           join public.purchase_receipts v on v.id = r.supersedes_id
          where r.purchase_id <> v.purchase_id))::text, '0'),
  (306, 'Kette', 'Info: Einkaeufe mit Beleg / Belege insgesamt',
        ((select count(distinct purchase_id)::text || ' / ' || count(*)::text
            from public.purchase_receipts))::text, null),

  -- =====================================================================
  -- 9xx  Eingangsseitige Baseline
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Lagerzeilen / Summe Menge',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  (905, 'Bestand', 'Lagerbewegungen',
        ((select count(*) from public.inventory_movements))::text, null),
  (911, 'Beleg', 'Eigenbelege',
        ((select count(*) from public.purchase_receipts))::text, null),
  (912, 'Beleg', 'bestaetigte Abrufe',
        ((select count(*) from public.purchase_receipt_downloads))::text, null),
  (913, 'Beleg', 'Nummernzaehler: Jahr und naechste Nummer',
        (coalesce((select string_agg(year::text || ':' || next_number::text, ' | '
                                     order by year)
                     from public.purchase_receipt_counters), '(keiner)'))::text, null),
  (914, 'Beleg', 'je Beleg: Nummer, Revision, Verweis',
        (coalesce((select string_agg(
                     r.receipt_number || '/r' || r.revision::text || '/'
                     || coalesce(r.supersedes_id::text, '-'),
                     ' | ' order by r.id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  /*
   * UND DER GESPEICHERTE FINGERABDRUCK JE BELEG.
   *
   * `0128` darf keinen davon bewegen — sie stellt nichts aus. Bewegt sich
   * einer doch, hat zwischen den beiden Laeufen jemand einen Beleg ausgestellt
   * oder einen Einkauf geaendert, und das gehoert geklaert.
   */
  (915, 'Beleg', 'Pruefsumme ueber die gespeicherten Fingerabdruecke',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.content_fingerprint,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),
  (916, 'Beleg', 'Belege, deren Fingerabdruck noch zum Einkauf passt',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (917, 'Beleg', 'Pruefsumme ueber die eingefrorenen Positionslisten',
        (coalesce((select md5(string_agg(r.id::text || ':' || r.lines::text,
                                         '|' order by r.id))
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (992, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0'),
  (993, 'Invariante', 'Belege ohne Position',
        ((select count(*) from public.purchase_receipts
           where jsonb_array_length(lines) = 0))::text, '0'),
  (994, 'Invariante', 'Belege zu einem Testvorgang',
        ((select count(*) from public.purchase_receipts r
           join public.purchases p on p.id = r.purchase_id
          where p.is_test))::text, '0')
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
