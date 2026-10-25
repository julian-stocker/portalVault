-- ===========================================================================
-- STAGING — DER ZUSTAND VOR 0145, REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren. Die Klammer
-- und das `rollback` stehen schon darin.
--
-- VOR `staging-0145.sql` fahren.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT — UND ZEILE 901 DAZU.     ##
-- ##  Beide vollstaendig kopieren und in der Nachkontrolle an die Stellen  ##
-- ##  BASIS-HIER-EINSETZEN und SAMMLUNG-HIER-EINSETZEN setzen.             ##
-- ###########################################################################
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die entscheidenden Zeilen sind
-- **110** und **111** — dort muss stehen, dass `favorites` und
-- `favorite_demand()` noch NICHT da sind.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- ZWEI VERTRAEGE STATT EINEM, und der zweite ist neu in `0145`. Der
-- Basis-Vertrag (Shop, Lager, Katalog) ist unveraendert der aus `0142` bis
-- `0144`; dazu kommt der Sammlungs-Vertrag, weil `0145` die Wunschliste
-- NEBEN die Sammlung legt und die Zusage, dass die Sammlung unberuehrt
-- bleibt, gemessen werden soll und nicht behauptet. Beide Feldfolgen stehen
-- im Kopf der eingebetteten Pruefdatei.
--
-- EINGEBETTET: `supabase/checks/0145_preflight.sql`, Zeichen fuer Zeichen.
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

-- >>> EINGEBETTET: supabase/checks/0145_preflight.sql
-- ===========================================================================
-- 0145 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0145` legt `public.favorites` und `public.favorite_demand()` an. Rein
-- additiv: keine bestehende Tabelle, Spalte, Richtlinie, Funktion oder
-- Berechtigung wird angefasst. Diese Datei haelt fest, dass das vorher auch
-- stimmt — und erhebt die Vergleichswerte, gegen die die Nachkontrolle
-- blockierend prueft.
--
-- ZWEI VERTRAEGE GEHEN WEITER, ZEILE 900 UND ZEILE 901.
--
-- (1) DER BASIS-VERTRAG — sieben Geschaeftszahlen, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
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
--   Unveraendert aus `0142`/`0143`/`0144`. Dieselben neun Felder, dieselbe
--   Folge, dieselbe Schutzsumme — eine Baseline aus einem dieser Laeufe ist
--   hier lesbar und umgekehrt.
--
-- (2) DER SAMMLUNGS-VERTRAG — NEU IN `0145`, und zwar aus einem Grund
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
--   WOFUER EIN ZWEITER VERTRAG. `0145` legt die Wunschliste an — die
--   Tabelle neben der Sammlung. Die Zusage lautet, dass die SAMMLUNG dabei
--   unberuehrt bleibt, und eine Zusage ohne Messung ist eine Behauptung.
--   Der Basis-Vertrag deckt Shop, Lager und Katalog ab, nicht
--   `collection_items`; ihn zu erweitern haette jede Baseline aus `0142`
--   bis `0144` unlesbar gemacht. Deshalb eine zweite Zeile statt eines
--   geaenderten Vertrags.
--
--   `sammlung_md5` haengt an Inhalt UND Reihenfolge. Zwei Aenderungen, die
--   sich in der Anzahl aufheben — eine Zeile fort, eine dazu —, faengt die
--   Zahl nicht ab, der Abdruck schon.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ZEILE 900 UND ZEILE 901 SIND DIE ERGEBNISSE, DIE WEITERGEHEN.
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
coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ---------------------------------------------------- Was 0145 voraussetzt
  (101, 'Grundlage', 'skylanders steht (0001) — der Fremdschluessel der Figur',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'collection_items steht (0001) — das Muster, das 0145 kopiert',
      (to_regclass('public.collection_items') is not null)::text, 'true'),
  (103, 'Grundlage', 'is_collector_account() steht (0042) — in jeder Richtlinie',
      (to_regprocedure('public.is_collector_account()') is not null)::text, 'true'),
  (104, 'Grundlage', 'can_operate_active_seller() steht (0041) — das Tor von favorite_demand',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),

  -- --------------------------------------- Und 0145 ist noch nicht da
  (110, 'Neu', 'favorites steht NOCH NICHT',
      (to_regclass('public.favorites') is null)::text, 'true'),
  (111, 'Neu', 'favorite_demand(text[]) steht NOCH NICHT',
      (to_regprocedure('public.favorite_demand(text[])') is null)::text, 'true'),

  -- ------------------- Das Muster, das 0145 kopiert, ist noch, wie es war
  /*
   * Nicht Bequemlichkeit: `0145` beschreibt seine Richtlinien als „das
   * Muster von collection_items nach 0042". Steht dieses Muster hier nicht
   * mehr, ist die Beschreibung falsch, und dann gehoert das VOR den Lauf.
   */
  /*
   * HIER STAND EINE ZAHL, UND DIE WAR FALSCH — berichtigt am 2026-10-25,
   * nachdem der Betreiber den Preflight gefahren hat.
   *
   * Die Zeile verlangte „genau vier Richtlinien" auf `collection_items`. Auf
   * Staging sind es FUENF, und das ist richtig: `staging-agent-setup.sql`
   * legt je Tabelle eine eigene Lesepolicy `agent_read_<tabelle>` fuer die
   * Rolle `skyisles_agent` an — fuer zwoelf Tabellen, `collection_items`
   * darunter (`docs/SECURITY.md`, 4b). `select`, nur diese Rolle, nur
   * Staging, und sie stand lange vor `0145`.
   *
   * DAS PEINLICHE DARAN: `0142` hatte genau diesen Fehler, er wurde am
   * 2026-10-22 gefunden und in `0142_postflight.sql` berichtigt — und
   * `0145` hat die ALTE Formulierung kopiert statt der neuen. Deshalb steht
   * die Begruendung hier noch einmal vollstaendig, nicht als Verweis.
   *
   * Eine Zahl ist die falsche Formulierung: sie bricht, sobald jemand eine
   * berechtigte Diagnosepolicy anlegt, und sie sagt nichts darueber, ob die
   * VIER, auf die es ankommt, noch da sind. Gepruefft wird deshalb die
   * EIGENSCHAFT — und zwar in vier Schritten.
   */
  (121, 'Vorbild', 'die vier eigenen Richtlinien von collection_items stehen, '
        'fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (122, 'Vorbild', 'und jede der vier fragt Konto UND Rolle',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and coalesce(qual, with_check) like '%is_collector_account()%'
          and coalesce(qual, with_check) like '%auth.uid()%'), '4'),
  (123, 'Vorbild', 'RLS ist dort an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.collection_items')), '(keine)'), 'true'),
  (124, 'Vorbild', 'keine Richtlinie dieser Tabelle gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and 'anon' = any (roles)), '0'),
  /*
   * UND KEINE UNBEKANNTE SECHSTE — die Agentenpolicy wird AUSDRUECKLICH
   * zugelassen, nicht pauschal uebergangen.
   *
   * Zugelassen ist sie nur in ihrer bekannten Form: `agent_read_collection_items`,
   * `select`, GENAU die Rolle `skyisles_agent`, permissiv. Haette jemand ihr
   * Schreiben gegeben oder eine zweite Rolle, faellt sie hier auf.
   *
   * Dieselbe Formulierung traegt BEIDE Umgebungen: auf Production gibt es
   * die Agentenpolicy nicht, dort sind die vier alles — und die Zahl ist
   * ebenfalls 0. `prod-s-preflight-0145.sql` bettet genau diese Datei ein.
   */
  (125, 'Vorbild', 'und KEINE unbekannte weitere Richtlinie auf collection_items',
      (select count(*)::text from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'collection_items'
          and not (p.policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own'))
          and not (p.policyname = 'agent_read_collection_items'
                   and p.cmd = 'SELECT'
                   and p.permissive = 'PERMISSIVE'
                   and array_to_string(p.roles, '+') = 'skyisles_agent')), '0'),
  (126, 'Vorbild', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),

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

  -- ------------------------- Die Zahlen der Sammlung (Sammlungs-Vertrag)
  (321, 'Sammlung', 'Sammlungszeilen',
      (select zeilen from coll_mess), null),
  (322, 'Sammlung', 'Konten mit Sammlung',
      (select konten from coll_mess), null),
  (323, 'Sammlung', 'Sammlungs-Abdruck',
      (select sammlung_md5 from coll_mess), null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0145 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and (a.grantee::regrole::text in ('anon', 'authenticated'))), '0'),
  (402, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

  -- ===================== Die beiden Zeilen, die weitergehen
  /*
   * BEIDE vollstaendig kopieren und in der Nachkontrolle oben einsetzen:
   *
   *   select set_config('skyisles.base', '<Zeile 900>', true);
   *   select set_config('skyisles.coll', '<Zeile 901>', true);
   *
   * Die Nachkontrolle vergleicht dann BLOCKIEREND gegen genau diesen Stand.
   * Fehlt eine der beiden, ist das eine blockierende Abweichung — `0145`
   * fasst weder Shop noch Sammlung an, also darf sich dort nichts bewegen.
   */
  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
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
-- <<< ENDE: supabase/checks/0145_preflight.sql

rollback;
