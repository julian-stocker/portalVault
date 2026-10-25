-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0144, REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR, bis auf eine Stelle: die Baseline.
--
-- ###########################################################################
-- ##  VOR DEM AUSFUEHREN: die Zeile 900 des Preflights unten anstelle von ##
-- ##  BASIS-HIER-EINSETZEN eintragen. Bleibt der Platzhalter stehen,      ##
-- ##  laeuft diese Datei NICHT durch — er zaehlt ausdruecklich nicht als   ##
-- ##  Baseline, und die aktuellen Werte werden NIEMALS als Sollwert        ##
-- ##  eingesetzt.                                                          ##
-- ###########################################################################
--
-- NACH `staging-0144.sql` fahren. Der SQL-Editor zeigt `NOTICE`-Meldungen
-- nicht an — „Success" allein ist kein sichtbarer Befund.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die staerkste Zeile ist
-- **101**, der Rumpfabdruck: stimmt er, sind alle 53 alten Bereiche
-- zeichengleich erhalten.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT: ein einziges SELECT in
-- `begin … rollback`.
--
-- EINGEBETTET: `supabase/checks/0144_postflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- B  DIE BASELINE AUS DEM PREFLIGHT
--
-- Transaktionslokal (`true`), mit dem `rollback` unten fort. Sie wird NICHT
-- gespeichert — sie lebt genau so lange wie dieser Lauf.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', 'BASIS-HIER-EINSETZEN', true);

-- >>> EINGEBETTET: supabase/checks/0144_postflight.sql
-- ===========================================================================
-- 0144 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0144_platform_export_calculations.sql` fahren. Zeile 9999 muss 0
-- zeigen.
--
-- WAS SIE BEANTWORTET: traegt die Exportfunktion jetzt 54 Bereiche, ist ihr
-- Rumpf GENAU der erwartete (4c4d2e7c81e4efa8e18cdffa06bba40a), sind Attribute
-- und Rechte unveraendert, ist die neue Tabelle unberuehrt — und hat sich am
-- Shop nichts bewegt.
--
-- DER RUMPFABDRUCK IN ZEILE 101 IST DIE STAERKSTE ZEILE. Er wurde aus dem
-- Rumpf von `0105` plus genau drei Aenderungen gerechnet und an echtem
-- PostgreSQL nachgefahren (Probelauf P51). Stimmt er, sind alle 53 alten
-- Bereiche zeichengleich erhalten — ohne dass jemand 53 Namen auflisten
-- muss.
--
-- WAS SIE NICHT BEANTWORTET: ob ein Archiv wirklich entsteht. Das zeigt nur
-- ein Download ueber `/admin/datensicherung` mit einem Blick in die Datei.
--
-- SO UEBERGIBST DU DIE BASIS. Zeile 900 des Preflights gibt eine Zeile aus.
-- Sie vollstaendig kopieren und VOR diesem SELECT ausfuehren:
--
--   select set_config('skyisles.base', 'skyisles-base-1|…', true);
--
-- Beides zusammen markieren und ausfuehren — `set_config(…, true)` gilt nur
-- in DERSELBEN Transaktion. Ohne Baseline laeuft hier nichts durch, und die
-- aktuellen Werte werden NIEMALS als Sollwert eingesetzt.
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
-- DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS, ausdruecklich.
--
-- Er sagt „zwischen den beiden Laeufen hat sich X bewegt". Er sagt NICHT,
-- WER es bewegt hat. Zwischen Preflight und Nachkontrolle kann regulaerer
-- Betrieb stattgefunden haben: ein Verkauf im Shop, ein eingebuchter
-- Wareneingang, eine Umpreisung in `/business/inventory`.
--
-- SO UNTERSCHEIDET MAN BEIDES:
--
--   1. ZEITFENSTER KLEIN HALTEN. Preflight, Migration und Nachkontrolle
--      hintereinander fahren, nicht ueber eine Nacht verteilt. Dann bleibt
--      fuer Betrieb kaum Raum, und jede Abweichung ist erklaerungsbeduerftig.
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN. `0144` ersetzt EINE Funktion
--      und legt nichts an. Keine der beiden enthaelt ein `update`,
--      `insert` oder `delete` auf `shop_inventory`, `shop_offers`,
--      `skylanders` oder `categories` — und beide laufen in EINER
--      Transaktion, die bei jeder Abweichung ihrer eigenen Nachbedingungen
--      abbricht. Eine Abweichung hier ist deshalb fast immer Betrieb.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest es
--      auf. Sie fragt tagweise, welche Lagerzeilen und Bewegungen wann
--      entstanden sind, und ob jede neue Zeile eine Buchung hat. Ein
--      Wareneingang sieht dort anders aus als ein Schemaeingriff.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben (eine Zeile fort, eine dazu). Die Abdruecke fangen
-- das ab — sie haengen an Inhalt und Reihenfolge, nicht nur an der Anzahl.
--
-- NUR LESEN. Ein einziges SELECT.
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
    (select count(*)::text from public.shop_offers())                      as angebote,
    (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                    || coalesce(o.price::text, ''),
                                    ';' order by o.sky_id, o.condition), ''))
       from public.shop_offers() o)                                        as angebote_md5,
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
basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile. Sonst waere die Bequemlichkeit der Huelle die
   * Luecke im Riegel.
   */
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.base', true), '')), ''),
                'BASIS-HIER-EINSETZEN') as roh
),
basis_teil as (
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as t
    from basis_roh
),
basis as (
  select roh, t,
         (t is not null and array_length(t, 1) = 9)                 as neun,
         (t is not null and t[1] = 'skyisles-base-1')               as marke,
         case when t is not null and array_length(t, 1) = 9
              then t[9] = left(md5(array_to_string(t[2:8], '|')), 12)
         end                                                        as schutz_ok,
         (t is not null and array_length(t, 1) = 9
          and t[1] = 'skyisles-base-1'
          and t[9] = left(md5(array_to_string(t[2:8], '|')), 12))   as gueltig
    from basis_teil
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

  -- -------------------------------------------------- Die Exportfunktion
  (101, 'Export', 'der Rumpf ist GENAU der erwartete — damit sind alle 53 '
        'alten Bereiche zeichengleich erhalten',
      coalesce((select abdruck from fn), '(keine Funktion)'), '4c4d2e7c81e4efa8e18cdffa06bba40a'),
  (102, 'Export', '54 Bereiche',
      coalesce((select bereiche::text from fn), '(keine Funktion)'), '54'),
  (103, 'Export', 'der Bereich purchase_calculations steht drin',
      coalesce((select (prosrc like '%''purchase_calculations'', coalesce((%')::text
                 from fn), '(keine)'), 'true'),
  (104, 'Export', 'die Formatversion ist 2',
      coalesce((select (prosrc like '%''format_version'', 2,%')::text from fn), '(keine)'),
      'true'),
  (105, 'Export', 'und genau einmal — keine zweite Fassung',
      (select count(*)::text from fn), '1'),

  -- -------------------------------------- Attribute und Rechte unveraendert
  (201, 'Attribute', 'security definer',
      coalesce((select prosecdef::text from fn), '(keine)'), 'true'),
  (202, 'Attribute', 'stable (s), nicht volatile',
      coalesce((select provolatile::text from fn), '(keine)'), 's'),
  /*
   * `search_path=""` UND NICHT `search_path=`. Gemessen an echtem
   * PostgreSQL: `set search_path = ''` wird als `search_path=""` abgelegt,
   * mit zwei Anfuehrungszeichen. Hier stand zuerst die andere Fassung — sie
   * waere auf Production rot gewesen, ohne dass etwas falsch ist.
   * Probelauf P51 hat es gefunden.
   */
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

  -- ------------------------------------- Die Tabelle selbst ist unberuehrt
  (501, 'Unberuehrt', 'purchase_calculations hat weiter vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (502, 'Unberuehrt', 'RLS ist weiter an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.purchase_calculations')), '(keine)'),
      'true'),
  (503, 'Unberuehrt', 'anon hat weiter KEIN Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'purchase_calculations'
          and grantee = 'anon'), '0'),
  (504, 'Unberuehrt', 'Info: gespeicherte Kalkulationen (die Migration legt keine an '
        'und loescht keine)',
      (select count(*)::text from public.purchase_calculations), null),
  (505, 'Unberuehrt', 'die Historientabelle des Exports steht weiter',
      (to_regclass('public.platform_export_runs') is not null)::text, 'true'),

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

  -- ================================== Die Baseline aus dem Preflight
  /*
   * VIER FRAGEN AN DIE UEBERGEBENE ZEILE, bevor eine einzige Zahl
   * verglichen wird. Sie fangen ab, was beim Kopieren passiert: vergessen,
   * abgeschnitten, vertauscht, eine Stelle verloren.
   *
   * Sie fangen NICHT ab, dass jemand die Werte absichtlich neu setzt und
   * die Schutzsumme neu rechnet. Dagegen schuetzt kein SELECT, sondern die
   * Reihenfolge der Schritte — die Basis entsteht VOR der Migration.
   */
  (801, 'Basis', 'eine Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 900 des '
                        || 'Preflights in set_config(''skyisles.base'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from basis), 'ja'),
  (802, 'Basis', 'sie traegt die Marke skyisles-base-1',
      (select coalesce(marke::text, 'keine Baseline') from basis), 'true'),
  (803, 'Basis', 'sie hat neun Felder',
      (select case when t is null then 'keine Baseline'
                   else array_length(t, 1)::text end from basis), '9'),
  (804, 'Basis', 'die Schutzsumme stimmt — kein Feld vertauscht, keine Stelle fort',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from basis), 'true'),

  -- --------------- Die sieben Werte: heute gegen das Vorher, BLOCKIEREND
  /*
   * Eine Abweichung hier heisst: zwischen Preflight und Nachkontrolle hat
   * sich am Shop etwas bewegt. Das muss diese Migration nicht gewesen sein —
   * sie fasst Angebote und Lager nicht an. Was es sonst sein kann und wie
   * man es unterscheidet, steht im Kopf dieser Datei unter DIE GRENZE.
   */
  (811, 'Shop', 'oeffentliche Angebote wie vor der Migration',
      (select angebote from basis_mess),
      (select case when gueltig then t[2] else '(keine gueltige Basis)' end from basis)),
  (812, 'Shop', 'Angebots-Abdruck wie vor der Migration',
      (select angebote_md5 from basis_mess),
      (select case when gueltig then t[3] else '(keine gueltige Basis)' end from basis)),
  (813, 'Shop', 'shopfaehige Katalogzeilen wie vor der Migration',
      (select shopfaehig from basis_mess),
      (select case when gueltig then t[4] else '(keine gueltige Basis)' end from basis)),
  (814, 'Shop', 'sammelbare Katalogzeilen wie vor der Migration',
      (select sammelbar from basis_mess),
      (select case when gueltig then t[5] else '(keine gueltige Basis)' end from basis)),
  (815, 'Shop', 'Lagerzeilen wie vor der Migration',
      (select lagerzeilen from basis_mess),
      (select case when gueltig then t[6] else '(keine gueltige Basis)' end from basis)),
  (816, 'Shop', 'Katalogzeilen wie vor der Migration',
      (select katalogzeilen from basis_mess),
      (select case when gueltig then t[7] else '(keine gueltige Basis)' end from basis)),
  (817, 'Shop', 'Lager-Abdruck wie vor der Migration',
      (select lager_md5 from basis_mess),
      (select case when gueltig then t[8] else '(keine gueltige Basis)' end from basis)),
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
      (select zeile from basis_zeile), null)
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
-- <<< ENDE: supabase/checks/0144_postflight.sql

rollback;
