-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0144, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- VOR `prod-0144.sql` fahren.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT. Sie vollstaendig         ##
-- ##  kopieren und in prod-s-postflight-0144.sql an die Stelle             ##
-- ##  BASIS-HIER-EINSETZEN setzen. Ohne sie laeuft die Nachkontrolle       ##
-- ##  nicht durch.                                                        ##
-- ###########################################################################
--
-- ERFOLGSKRITERIEN — Zeile `9999` muss `0` zeigen
--
--   101-105  `0142` steht, `system_platform_export()` steht genau einmal,
--            **ihr Rumpf IST der aus `0105`**, 53 Bereiche,
--            `is_platform_admin()` steht
--   110-112  der neue Rumpf steht NOCH NICHT, Formatversion noch 1, der
--            Bereich fehlt noch
--   201-205  `security definer`, `stable`, leere `search_path`-Festlegung,
--            kein EXECUTE fuer PUBLIC oder `anon`, `authenticated` darf
--   211-213  `purchase_calculations` unberuehrt: vier Richtlinien, RLS an,
--            `anon` ohne Tabellenrecht
--   311-312  nichts freigegeben
--   401-402  die Belegsperre
--
-- ZEILE 103 IST DIE ENTSCHEIDENDE. Weicht der Abdruck ab, laeuft hier eine
-- andere Fassung als die, aus der `0144` gerechnet ist — dann NICHT fahren,
-- sondern melden. Die Migration bricht selbst ab, aber eine Ueberraschung
-- gehoert vor den Lauf.
--
-- ZEILEN OHNE SOLLWERT (`ok` ist NULL): 1, 214, 301-307, 900. Messungen —
-- nichts davon blockiert, und abzuschreiben ist nichts: Zeile 900 traegt sie.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- EINGEBETTET: `supabase/checks/0144_preflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den schreibenden Dateien. Ein lesender
-- Lauf im falschen Fenster richtet keinen Schaden an, liefert aber einen
-- falschen Befund.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/0144_preflight.sql mit einer eigenen Baseline..';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/checks/0144_preflight.sql
-- ===========================================================================
-- 0144 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0144` ersetzt `system_platform_export()` — die eine Funktion, die unter
-- Supabase Free unsere gesamte Absicherung ist. Am Inhalt rein additiv (EIN
-- Bereich mehr), aber ein `create or replace` an genau der Stelle, an der
-- ein Fehler erst auffaellt, wenn man die Sicherung braucht.
--
-- DIE ENTSCHEIDENDE ZEILE IST 103. Sie prueft, dass hier WIRKLICH der Rumpf
-- aus `0105` steht (2e2da90e976a1e73ca00aba7cd830fae). Weicht er ab, laeuft in
-- dieser Datenbank eine andere Fassung als die, aus der `0144` gerechnet
-- ist — dann nicht fahren, sondern melden. Die Migration bricht selbst ab,
-- aber eine Ueberraschung gehoert vor den Lauf und nicht in ihn.
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- WOFUER DAS NEUNTE FELD. Es faengt ab, was ein Mensch beim Kopieren
-- anrichtet: eine abgeschnittene Zeile, zwei vertauschte Felder, eine
-- verlorene Stelle in einer Zahl. Es ist KEIN Schutz gegen Absicht — wer die
-- Werte von Hand neu setzen und die Summe neu rechnen will, kann das. Dagegen
-- schuetzt kein SQL, sondern nur die Reihenfolge der Schritte: die Basis
-- entsteht VOR der Migration und wird danach nicht mehr erhoben.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen. ZEILE 900 IST
-- DAS ERGEBNIS, DAS WEITERGEHT — sie gehoert in die Nachkontrolle.
-- ===========================================================================

with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proacl,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab, und
          * `search_path="$user", public` waere ein ganz anderer Text. Ein
          * Vergleich gegen ein Literal ist deshalb ein Fehlalarm in
          * Wartestellung — `src/lib/admin/migration-integrity.test.ts`
          * haelt diese Regel fuer jede Pruefdatei fest, die `proconfig`
          * liest. Hier wird der Wert HINTER dem `=` herausgeholt.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadanzahl,
         (length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
           / length('coalesce((') as bereiche,
         md5(p.prosrc) as abdruck
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_platform_export'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------- Was 0144 voraussetzt
  (101, 'Grundlage', 'purchase_calculations steht (0142) — ohne sie laeuft 0144 nicht',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),
  (102, 'Grundlage', 'system_platform_export() steht (0105), genau einmal',
      (select count(*)::text from fn), '1'),
  (103, 'Grundlage', 'und ihr Rumpf IST der aus 0105',
      coalesce((select abdruck from fn), '(keine Funktion)'), '2e2da90e976a1e73ca00aba7cd830fae'),
  (104, 'Grundlage', '53 Bereiche',
      coalesce((select bereiche::text from fn), '(keine Funktion)'), '53'),
  (105, 'Grundlage', 'is_platform_admin() steht (0026) — der Waechter im Rumpf',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),

  -- ------------------------------------------- Und 0144 ist noch nicht da
  (110, 'Neu', 'der neue Rumpf steht NOCH NICHT',
      coalesce((select (abdruck <> '4c4d2e7c81e4efa8e18cdffa06bba40a')::text from fn), '(keine)'), 'true'),
  (111, 'Neu', 'die Formatversion ist noch 1',
      coalesce((select (prosrc like '%''format_version'', 1,%')::text from fn), '(keine)'),
      'true'),
  (112, 'Neu', 'und der Bereich purchase_calculations fehlt noch',
      coalesce((select (prosrc not like '%''purchase_calculations'', coalesce((%')::text
                 from fn), '(keine)'), 'true'),

  -- ------------------------- Die Attribute, die erhalten bleiben muessen
  (201, 'Attribute', 'security definer',
      coalesce((select prosecdef::text from fn), '(keine)'), 'true'),
  (202, 'Attribute', 'stable (s), nicht volatile',
      coalesce((select provolatile::text from fn), '(keine)'), 's'),
  (203, 'Attribute', 'es gibt GENAU EINE search_path-Festlegung',
      coalesce((select pfadanzahl::text from fn), '(keine)'), '1'),
  (204, 'Attribute', 'und ihr Wert ist LEER (ausgepackt, nicht verglichen)',
      coalesce((select pfadwert from fn), '(keine)'), '""'),
  (206, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (207, 'Rechte', 'authenticated darf ausfuehren',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),

  -- ---------------------- Die Tabelle, die dazukommt, ist unberuehrt
  (211, 'Tabelle', 'purchase_calculations hat vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (212, 'Tabelle', 'RLS ist an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.purchase_calculations')), '(keine)'),
      'true'),
  (213, 'Tabelle', 'anon hat KEIN Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'purchase_calculations'
          and grantee = 'anon'), '0'),
  (214, 'Tabelle', 'Info: gespeicherte Kalkulationen (gehen ab jetzt mit ins Archiv)',
      (select count(*)::text from public.purchase_calculations), null),

  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0144 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
  (402, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

  -- ===================== Die Basis, die weitergeht
  /*
   * EINE ZEILE, SIEBEN WERTE, UND EINE SCHUTZSUMME. Vollstaendig kopieren
   * und in der Nachkontrolle oben einsetzen:
   *
   *   select set_config('skyisles.base', '<diese Zeile>', true);
   *
   * Die Nachkontrolle vergleicht dann BLOCKIEREND gegen genau diesen Stand.
   * Fehlt die Zeile dort, ist das eine blockierende Abweichung — `0144`
   * fasst den Shop nicht an, also darf sich dort nichts bewegen.
   */
  (900, 'BASIS', 'die Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
-- <<< ENDE: supabase/checks/0144_preflight.sql

rollback;
