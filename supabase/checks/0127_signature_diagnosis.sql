-- ===========================================================================
-- DIAGNOSE zum Abbruch von 0127
--
--   ERROR: P0001: 0127 Abbruch: die Argumenttypen sind nicht die erwarteten
--   CONTEXT: PL/pgSQL function inline_code_block line 50 at RAISE
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Betreiber-Simulation, kein set_config, keine Rollenumschaltung. Sie faesst
-- `seller_save_purchase_edit` nicht an und ruft sie nicht auf.
--
-- Zeile 9999 muss 0 zeigen. Zeigt sie mehr, sagen die 1xx-Zeilen, was vom
-- abgebrochenen Versuch stehen geblieben ist.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI BEANTWORTET
--
--   1xx  Ist der Abbruch vollstaendig zurueckgerollt? Welche Fassung lebt,
--        welchen ACL und welchen Kommentar hat sie, steht der Trigger aus
--        `0126` noch?
--   2xx  Wie sieht die TATSAECHLICHE Signatur aus — Zahl, Namen, Defaults und
--        Typen Position fuer Position?
--   3xx  Die Mechanik des Abbruchs, am lebenden Objekt nachgestellt: derselbe
--        Ganzarray-Vergleich, den `0127` gemacht hat, gegen die
--        positionsweise Form daneben.
--   9xx  Bestand und Belege, zum Vergleich mit dem Preflight, den du vorher
--        gefahren hast.
--
-- ---------------------------------------------------------------------------
-- DIE VERMUTUNG, DIE 3xx PRUEFT
--
-- `pg_proc.proargtypes` ist ein `oidvector`. Der ist NULLBASIERT, und der Cast
-- nach `oid[]` ist binaerkompatibel — die untere Grenze 0 bleibt also stehen:
-- `[0:4]={…}`. Ein `array[…]`-Literal beginnt dagegen bei 1. Die
-- Array-Gleichheit in PostgreSQL vergleicht Dimensionen UND Grenzen; zwei
-- Arrays mit denselben Elementen, aber verschiedener unterer Grenze sind
-- deshalb NICHT gleich.
--
-- Trifft das zu, dann konnte die Pruefung in `0127` nie bestehen — bei keiner
-- Signatur. Pruefung 305 stellt sie an der HEUTIGEN, unbestrittenen Signatur
-- nach: ergibt sie `false`, liegt der Fehler in der Pruefung und nicht in der
-- Funktion. Pruefung 306 zeigt dieselbe Frage positionsweise gestellt.
-- Pruefungen 307 und 308 belegen es noch einmal an zwei Konstanten, ganz ohne
-- Katalog.
-- ===========================================================================

with
fn as (
  select p.oid, p.pronargs, p.pronargdefaults, p.proargnames, p.proargtypes,
         p.proargmodes, p.proacl, p.prosecdef, p.proconfig, p.proowner
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'seller_save_purchase_edit'
),
/*
 * EINE ZEILE, DETERMINISTISCH GEWAEHLT.
 *
 * Pruefung 101 sagt, wie viele es wirklich sind. Diese Einschraenkung steht
 * nur da, damit die uebrigen Zeilen auch bei einer unerwarteten Ueberladung
 * eine Antwort liefern statt einen Fehler.
 */
eine as (
  select * from fn order by pronargs limit 1
),
/* Die Soll-Typen, als EINSBASIERTES Array — genau wie in 0127. */
soll as (
  select array['bigint', 'jsonb', 'jsonb', 'bigint[]',
               'timestamptz', 'jsonb']::regtype[]::oid[] as alle
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  values
  -- =====================================================================
  -- 1xx  Was vom abgebrochenen Versuch steht
  -- =====================================================================
  (101, 'Zustand', 'Anzahl Fassungen von seller_save_purchase_edit',
        ((select count(*) from fn))::text, '1'),
  (102, 'Zustand', 'Info: Fuenf-Parameter-Fassung vorhanden',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null)::text, null),
  (103, 'Zustand', 'Info: Sechs-Parameter-Fassung vorhanden',
        (to_regprocedure('public.seller_save_purchase_edit('
          || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null)::text,
        null),
  (104, 'Zustand', 'Info: Gesamtbefund',
        (case
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null
             then 'NACH_0127'
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is null
             then 'VOR_0127'
           else 'UNKLAR'
         end)::text, null),
  /*
   * DIE EIGENTLICHE RUECKROLLFRAGE.
   *
   * Nach einem Abbruch im Nachbedingungsblock MUSS der Zustand `VOR_0127`
   * sein: der Fehler kommt aus derselben Transaktion wie `drop` und `create`.
   * Steht hier `NACH_0127`, waere die Datei nicht als eine Transaktion
   * gelaufen — dann ist die Funktion schon getauscht und die Lage eine andere.
   */
  (105, 'Zustand', 'die Rueckrollung ist vollstaendig: Fuenf-Parameter-Fassung lebt',
        (case
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is null
             then 'NACH_0127'
           when to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz)') is not null
                and to_regprocedure('public.seller_save_purchase_edit('
                  || 'bigint, jsonb, jsonb, bigint[], timestamptz, jsonb)') is null
             then 'VOR_0127'
           else 'UNKLAR'
         end)::text, 'VOR_0127'),
  (106, 'Zustand', 'Info: der ACL, Zeichen fuer Zeichen',
        (coalesce((select array_to_string(e.proacl, ' | ') from eine e),
                  '(kein ACL)'))::text, null),
  (107, 'Zustand', 'authenticated darf ausfuehren — der ACL ist unberuehrt',
        ((select count(*) from eine e, aclexplode(e.proacl) a
           where a.privilege_type = 'EXECUTE'
             and a.grantee <> 0
             and a.grantee::regrole::text = 'authenticated'))::text, '1'),
  (108, 'Zustand', 'PUBLIC und anon duerfen nicht',
        ((select count(*) from eine e, aclexplode(e.proacl) a
           where a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text = 'anon')))::text, '0'),
  /*
   * DER KOMMENTAR IST DER ZWEITE ZEUGE.
   *
   * `0126` schreibt einen Kommentar ohne „0127", `0127` einen mit. Steht hier
   * `false`, lebt der Stand von `0126` — und das `drop` hat nicht gegriffen.
   */
  (109, 'Zustand', 'Info: nennt der Funktionskommentar 0127?',
        (coalesce((select obj_description(e.oid, 'pg_proc') from eine e), '')
           like '%0127%')::text, null),
  (110, 'Zustand', 'Info: der Funktionskommentar, erste 120 Zeichen',
        (left(coalesce((select obj_description(e.oid, 'pg_proc') from eine e),
                       '(kein Kommentar)'), 120))::text, null),
  (111, 'Zustand', 'security definer',
        ((select e.prosecdef from eine e))::text, 'true'),
  (112, 'Zustand', 'leerer search_path',
        (coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                     from eine e, unnest(coalesce(e.proconfig, '{}'::text[])) c
                    where c like 'search\_path=%'), '(leer)'))::text, '(leer)'),
  (113, 'Zustand', 'der Versionstrigger aus 0126 steht unveraendert',
        ((select t.tgtype::int from pg_trigger t
           where not t.tgisinternal
             and t.tgname = 'purchase_items_touch_purchase_trg'
             and t.tgrelid = 'public.purchase_items'::regclass))::text, '29'),
  (114, 'Zustand', 'Info: Eigentuemer',
        (coalesce((select pg_get_userbyid(e.proowner) from eine e), '(fehlt)'))::text,
        null),
  (115, 'Zustand', 'die vier gerufenen Funktionen sind unberuehrt',
        ((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('seller_update_purchase', 'seller_add_purchase_item',
                               'seller_remove_purchase_item',
                               'seller_set_purchase_item_sky')
             and p.prosecdef))::text, '4'),

  -- =====================================================================
  -- 2xx  Die tatsaechliche Signatur
  -- =====================================================================
  (201, 'Signatur', 'Info: Anzahl Parameter (pronargs)',
        ((select e.pronargs from eine e))::text, null),
  (202, 'Signatur', 'Info: Parameternamen in Reihenfolge',
        (coalesce((select array_to_string(e.proargnames, ', ') from eine e),
                  '(keine)'))::text, null),
  (203, 'Signatur', 'Info: Anzahl Parameter mit Default (pronargdefaults)',
        ((select e.pronargdefaults from eine e))::text, null),
  (204, 'Signatur', 'alle Parameter sind Eingabeparameter (proargmodes is null)',
        ((select e.proargmodes is null from eine e))::text, 'true'),
  /*
   * DIE TYPEN POSITION FUER POSITION, MIT SICHTBARER NUMMERIERUNG.
   *
   * `generate_subscripts` laeuft ueber die echten Grenzen des Arrays — die
   * erste Nummer in dieser Spalte ist damit selbst schon die Antwort auf die
   * Frage, ob der Vektor bei 0 anfaengt.
   */
  (205, 'Signatur', 'Info: Typen nach Position, so wie sie wirklich stehen',
        (coalesce((select string_agg(i::text || ':' || (e.proargtypes[i])::regtype::text,
                                     ' | ' order by i)
                     from eine e, generate_subscripts(e.proargtypes::oid[], 1) i),
                  '(keine)'))::text, null),
  (206, 'Signatur', 'Info: die Signatur im Klartext, mit Namen und Defaults',
        (coalesce((select pg_get_function_arguments(e.oid) from eine e), '(fehlt)'))::text,
        null),
  (207, 'Signatur', 'Info: Rueckgabetyp',
        (coalesce((select pg_get_function_result(e.oid) from eine e), '(fehlt)'))::text,
        null),

  -- =====================================================================
  -- 3xx  Der Abbruch, am lebenden Objekt nachgestellt
  -- =====================================================================
  (301, 'Mechanik', 'Info: proargtypes::oid[] als Text — mit Dimensionsgrenzen',
        ((select (e.proargtypes::oid[])::text from eine e))::text, null),
  (302, 'Mechanik', 'Info: array_dims davon',
        (coalesce((select array_dims(e.proargtypes::oid[]) from eine e), '(leer)'))::text,
        null),
  /*
   * DIE ZWEI ZAHLEN, UM DIE ES GEHT.
   */
  (303, 'Mechanik', 'untere Grenze von proargtypes::oid[]',
        ((select array_lower(e.proargtypes::oid[], 1) from eine e))::text, '0'),
  (304, 'Mechanik', 'untere Grenze eines array[...]-Literals',
        ((select array_lower(s.alle, 1) from soll s))::text, '1'),
  /*
   * UND DIE FOLGE: DERSELBE VERGLEICH, DEN 0127 GEMACHT HAT.
   *
   * Verglichen wird die HEUTIGE Signatur gegen die Soll-Typen in ihrer Laenge
   * (`alle[1:pronargs]`) — also gegen genau das, was richtig ist. Kommt
   * `false` heraus, ist der Vergleich selbst der Fehler.
   */
  (305, 'Mechanik', 'Ganzarray-Vergleich der RICHTIGEN Signatur — der Defekt',
        ((select e.proargtypes::oid[] = s.alle[1:e.pronargs]
            from eine e, soll s))::text, 'false'),
  (306, 'Mechanik', 'derselbe Inhalt positionsweise verglichen — die Korrektur',
        ((select bool_and(e.proargtypes[i] = s.alle[i + 1])
            from eine e, soll s, generate_subscripts(e.proargtypes::oid[], 1) i))::text,
        'true'),
  /*
   * ZWEI KONSTANTEN, GANZ OHNE KATALOG.
   *
   * Dieselben drei Zahlen, einmal mit unterer Grenze 0 und einmal mit 1.
   * `=` sagt nein, der beidseitige Enthaltenseins-Test sagt ja — damit ist die
   * Aussage „Array-Gleichheit vergleicht die Grenzen mit" belegt und nicht
   * behauptet.
   */
  (307, 'Mechanik', 'Beleg: [0:2]={1,2,3} = {1,2,3}',
        ('[0:2]={1,2,3}'::int[] = '{1,2,3}'::int[])::text, 'false'),
  (308, 'Mechanik', 'Beleg: dieselben Elemente, beidseitig enthalten',
        (('[0:2]={1,2,3}'::int[] @> '{1,2,3}'::int[]
          and '{1,2,3}'::int[] @> '[0:2]={1,2,3}'::int[]))::text, 'true'),
  (309, 'Mechanik', 'Info: Soll-Typen als Text, einsbasiert',
        ((select (s.alle)::text from soll s))::text, null),
  (310, 'Mechanik', 'Info: Soll-Typen im Klartext',
        ((select array_to_string(s.alle::regtype[], ', ') from soll s))::text, null),

  -- =====================================================================
  -- 9xx  Bestand und Belege — mit dem Preflight vergleichen
  -- =====================================================================
  (901, 'Umgebung', 'Info: Serverversion',
        (current_setting('server_version'))::text, null),
  (902, 'Bestand', 'Einkaeufe (Preflight 902)',
        ((select count(*) from public.purchases))::text, null),
  (903, 'Bestand', 'Einkaufspositionen (Preflight 903)',
        ((select count(*) from public.purchase_items))::text, null),
  (904, 'Bestand', 'Summe total_cost (Preflight 904)',
        (coalesce((select sum(total_cost) from public.purchases), 0))::text, null),
  (905, 'Bestand', 'booked / nicht booked (Preflight 905)',
        ((select (count(*) filter (where state = 'booked'))::text || ' / '
                 || (count(*) filter (where state <> 'booked'))::text
            from public.purchase_items))::text, null),
  (906, 'Bestand', 'Positionen MIT Lagerbewegung (Preflight 906)',
        ((select count(*) from public.purchase_items where movement_id is not null))::text,
        null),
  (907, 'Bestand', 'Lagerbewegungen (Preflight 907)',
        ((select count(*) from public.inventory_movements))::text, null),
  (908, 'Bestand', 'Lagerzeilen / Menge (Preflight 908)',
        ((select count(*)::text || ' / ' || coalesce(sum(quantity), 0)::text
            from public.shop_inventory))::text, null),
  (909, 'Bestand', 'Eigenbelege (Preflight 909)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (910, 'Bestand', 'Pruefsumme (Position, SKY-ID, Zustand) — MUSS Preflight 910 gleichen',
        (coalesce((select md5(string_agg(
                     i.id::text || ':' || i.position::text || ':'
                     || coalesce(i.sky_id, '-') || ':' || i.state,
                     '|' order by i.id))
                     from public.purchase_items i), '(keine Positionen)'))::text, null),
  (911, 'Bestand', 'Positionen OHNE SKY-ID (Preflight 911)',
        ((select count(*) from public.purchase_items where sky_id is null))::text, null),
  (912, 'Bestand', 'gelernte Namensregeln (Preflight 912)',
        ((select count(*) from public.orderbook_name_mappings))::text, null),
  (921, 'Beleg', 'Belege, deren Fingerabdruck stimmt (Preflight 921)',
        ((select count(*) from public.purchase_receipts r
           where r.content_fingerprint
                 = public.purchase_receipt_fingerprint(r.purchase_id)))::text, null),
  (922, 'Beleg', 'erste 16 Zeichen je Beleg — MUSS Preflight 922 gleichen',
        (coalesce((select string_agg(
                     r.purchase_id::text || ':' ||
                     left(public.purchase_receipt_fingerprint(r.purchase_id), 16),
                     ' | ' order by r.purchase_id)
                     from public.purchase_receipts r), '(keine Belege)'))::text, null),

  -- =====================================================================
  -- 99x  Invarianten
  -- =====================================================================
  (991, 'Invariante', 'gebuchte Positionen OHNE Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state = 'booked' and movement_id is null))::text, '0'),
  (992, 'Invariante', 'Positionen mit Sonderzustand UND Lagerbewegung',
        ((select count(*) from public.purchase_items
           where state in ('damaged', 'missing')
             and movement_id is not null))::text, '0'),
  (993, 'Invariante', 'negative Lagermengen',
        ((select count(*) from public.shop_inventory where quantity < 0))::text, '0')
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
