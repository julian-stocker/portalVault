-- ===========================================================================
-- STAGING — DER ZUSTAND NACH 0162, REIN LESEND
--
-- NACH `0162_admin_price_and_delete.sql` fahren, MIT der Baseline-Uebergabe
-- aus dem Preflight.
-- **Erwartet: Zeile 9998 = `0` und Zeile 9999 = `0`.**
--
--   101-109  DIE ZWEI NEUEN FUNKTIONEN: sie stehen, `security definer`,
--            leerer Suchpfad, nur `authenticated`, keine offenen Rechte.
--   111-119  WAS IHRE RUEMPFE ZUSAGEN, als Messung am Rumpf selbst:
--
--              111  der Preis prueft das Adminrecht
--              112  der Preis sperrt die Zeile (`for update`)
--              113  er schreibt GENAU `market_price` und `price_updated_at`
--              114  und keine andere Spalte — die Liste steht in 115
--              116  die Loeschung fragt `admin_merge_references`
--              117  sie fragt `order_lines` AUSDRUECKLICH (der stille Verweis)
--              118  sie nennt `confdeltype = 'c'` — die CASCADE-Schluessel
--              119  sie schreibt das Journal VOR dem `delete`
--
--   121-126  WAS DIE RUEMPFE NICHT TUN: kein `cascade`, kein `storage`,
--            kein `setval` auf der Sequenz, kein `update` auf einer fremden
--            SKY-ID (keine Umhaengung), kein `delete` auf `characters` oder
--            einer Variante.
--   131-139  UND NICHTS IST GESCHRIEBEN: derselbe PREIS-ABDRUCK wie im
--            Preflight (132), dieselbe Zahl Journalzeilen (133), dieselben
--            Katalogzeilen. Eine Migration, die zwei Funktionen anlegt, darf
--            keinen Preis anfassen und keine Zeile loeschen.
--   141-144  DAS JOURNAL: es kennt jetzt VIERZEHN Werte — die zwoelf alten
--            einzeln nachgewiesen, und die zwei neuen.
--   801-833  der Basis-Vertrag, zeichengleich mit `0142`-`0161`.
--
-- SIE RUFT KEINE DER BEIDEN FUNKTIONEN AUF. Was sie TUN, faehrt Probelauf
-- **P71** an erfundenen Zeilen — jede Abhaengigkeitsklasse einzeln, der
-- stille Verweis, der Wettlauf und das geteilte Bild.
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
basis_roh as (
  /*
   * DER PLATZHALTER ZAEHLT NICHT ALS BASELINE. Die Huelle bringt die
   * `set_config`-Zeile schon mit, damit niemand sie vergisst — und genau
   * deshalb muss ein NICHT ersetzter Platzhalter so behandelt werden wie
   * eine fehlende Zeile.
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
coll_mess as (
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
coll_roh as (
  select nullif(nullif(btrim(coalesce(current_setting('skyisles.coll', true), '')), ''),
                'SAMMLUNG-HIER-EINSETZEN') as roh
),
coll_teil as (
  /*
   * `k` UND NICHT `t`, UND DAS IST KEIN SCHOENHEITSWUNSCH.
   *
   * Der Basis-Vertrag oben legt seine Felder in `t` ab und entscheidet mit
   * `gueltig`. `staging-oneshot.test.ts` haelt fuer die ganze Familie fest,
   * dass GENAU SIEBEN Vergleiche ihren Sollwert aus `when gueltig then t[…]`
   * holen — so faellt auf, wenn einer davon heimlich aus der Messung kaeme.
   * Haette der zweite Vertrag dieselben Namen, waeren es zehn Treffer, und
   * der Waechter koennte die beiden nicht mehr trennen. Er schlug beim
   * ersten Lauf dieser Datei genau deshalb an und hatte recht damit.
   *
   * Zwei Vertraege, zwei Namen: `t`/`gueltig` fuer den Shop,
   * `k`/`coll_gueltig` fuer die Sammlung.
   */
  select roh,
         case when roh is null then null else string_to_array(roh, '|') end as k
    from coll_roh
),
coll as (
  select roh, k,
         (k is not null and k[1] = 'skyisles-coll-1')               as marke,
         case when k is not null and array_length(k, 1) = 5
              then k[5] = left(md5(array_to_string(k[2:4], '|')), 12)
         end                                                        as schutz_ok,
         (k is not null and array_length(k, 1) = 5
          and k[1] = 'skyisles-coll-1'
          and k[5] = left(md5(array_to_string(k[2:4], '|')), 12))   as coll_gueltig
    from coll_teil
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proacl, p.proname,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab. Ein
          * Vergleich gegen ein Literal waere ein Fehlalarm in Wartestellung
          * — `src/lib/admin/migration-integrity.test.ts` haelt diese Regel
          * fuer jede Pruefdatei fest, die `proconfig` liest.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%') as pfadanzahl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_merge_draft'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- -------------------------------------------- Die zwei neuen Funktionen
  (101, 'Neu', 'admin_set_market_price(text,numeric) steht',
      (to_regprocedure('public.admin_set_market_price(text,numeric)') is not null)::text,
      'true'),
  (102, 'Neu', 'admin_delete_figure(text) steht',
      (to_regprocedure('public.admin_delete_figure(text)') is not null)::text, 'true'),
  (103, 'Neu', 'beide sind security definer mit leerem Suchpfad und volatile',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and p.prosecdef and p.provolatile = 'v'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%')), '2'),
  (104, 'Neu', 'keine offenen EXECUTE-Rechte auf beiden',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (105, 'Neu', 'authenticated darf beide ausfuehren (die Oberflaeche ruft sie)',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '2'),
  (106, 'Neu', 'beide tragen einen Kommentar, der sagt, was sie NICHT tun',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and coalesce(obj_description(p.oid, 'pg_proc'), '') <> ''), '2'),
  (107, 'Neu', 'der Abdruck von admin_set_market_price',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_set_market_price(text,numeric)')),
      null),
  (108, 'Neu', 'der Abdruck von admin_delete_figure',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_delete_figure(text)')), null),
  (109, 'Neu', 'und es gibt von keiner der beiden eine zweite Signatur',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_set_market_price', 'admin_delete_figure')), '2'),

  -- --------------------------------- Was die Ruempfe zusagen, am Rumpf gemessen
  (111, 'Zusagen', 'der Preis prueft is_platform_admin()',
      (select (prosrc like '%is_platform_admin()%')::text from pg_proc
        where oid = to_regprocedure('public.admin_set_market_price(text,numeric)')),
      'true'),
  (112, 'Zusagen', 'und sperrt die Zeile mit for update',
      (select (prosrc like '%for update%')::text from pg_proc
        where oid = to_regprocedure('public.admin_set_market_price(text,numeric)')),
      'true'),
  (113, 'Zusagen', 'er schreibt market_price UND price_updated_at',
      (select (prosrc like '%market_price     = p_price%'
           and prosrc like '%price_updated_at = case%')::text from pg_proc
        where oid = to_regprocedure('public.admin_set_market_price(text,numeric)')),
      'true'),
  /*
   * ZEILE 114 IST DIE ANFORDERUNG „keine anderen Felder aendern", als
   * Messung — und sie wird AM CODE gemessen, nicht am Text.
   *
   * SIE HAT IN IHRER ERSTEN FASSUNG FALSCHEN ALARM GESCHLAGEN, und zwar am
   * 2026-10-29 bei der Nachkontrolle des echten Laufs: sie suchte das Wort
   * `card_type` im ganzen Rumpf, und der Rumpf NENNT es — in seinem eigenen
   * Kommentar, im Satz „keine Kategorie, kein `card_type` — die
   * Preisbearbeitung aendert den Preis". Eine Pruefung, die die Begruendung
   * einer Zusage fuer deren Verletzung haelt, ist keine Pruefung.
   *
   * DREI SCHICHTEN STATT EINER WORTSUCHE:
   *
   *   1. PROSA WEG. Block- und Zeilenkommentare werden entfernt, bevor
   *      irgendetwas gesucht wird. Danach ist jede Nennung einer Spalte eine
   *      Nennung im CODE.
   *   2. KEINE FREMDE SPALTE, in welcher Schreibweise auch immer. Gesucht
   *      wird der NAME, nicht die Form `set name =` — damit sind
   *      `set card_type=1`, `set "card_type" = 1`, ein Umbruch zwischen
   *      `set` und der Spalte, eine zweite Zuweisung hinter einem Komma und
   *      die zeilenweise Form `set (a, b) = (…)` alle erfasst. Eine
   *      Preisfunktion hat keinen Anlass, eine fremde Spalte ueberhaupt zu
   *      NENNEN — auch nicht lesend.
   *   3. UND NUR EIN SCHREIBWEG (Zeile 120 unten): genau ein `update` im
   *      Rumpf. Zwei waeren zwei Wirkungen, und die zweite stuende in keiner
   *      Zusage.
   *
   * `sky_id` steht ABSICHTLICH NICHT in der Liste: der Rumpf traegt
   * `p_sky_id` und `v_row.sky_id`, und beides ist richtig. Die Liste nennt
   * die Spalten, die eine Preisbearbeitung nicht anfassen darf.
   */
  (114, 'Zusagen', 'und KEINE andere Spalte — am kommentarfreien Rumpf gemessen '
                   '(name, slug, card_type, catalog_status, catalog_visible, '
                   'display_name_override, character_id, base_sky_id, item_type, '
                   'series_code, category_id, image_file, image_override_path)',
      (select (select bool_and(k.rumpf not like '%' || v.spalte || '%')
                 from unnest(array['name', 'slug', 'card_type', 'catalog_status',
                                   'catalog_visible', 'display_name_override',
                                   'character_id', 'base_sky_id', 'item_type',
                                   'series_code', 'category_id', 'image_file',
                                   'image_override_path']) as v(spalte))::text
         from (select regexp_replace(
                        regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'),
                        '--[^' || chr(10) || ']*', '', 'g') as rumpf
                 from pg_proc p
                where p.oid = to_regprocedure(
                        'public.admin_set_market_price(text,numeric)')) as k),
      'true'),
  (115, 'Zusagen', 'er weist 0 mit einem eigenen SATZ ab, nicht mit der Constraint',
      (select (prosrc like '%kein Preis%')::text from pg_proc
        where oid = to_regprocedure('public.admin_set_market_price(text,numeric)')),
      'true'),
  (116, 'Zusagen', 'die Loeschung fragt admin_merge_references',
      (select (prosrc like '%admin_merge_references%')::text from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),
  /*
   * ZEILE 117 IST DIE WICHTIGSTE DES GANZEN POSTFLIGHTS. `order_lines.sky_id`
   * traegt keinen Fremdschluessel (Preflight 105), also sieht
   * `admin_merge_references` sie nicht. Ohne diese Zeile im Rumpf waere
   * „referenzfrei" eine Behauptung, und eine Bestellung haette ihre Figur
   * verloren.
   */
  (117, 'Zusagen', 'UND sie fragt order_lines ausdruecklich (der stille Verweis)',
      (select (prosrc like '%from public.order_lines%')::text from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),
  (118, 'Zusagen', 'sie erkennt die CASCADE-Schluessel (confdeltype) und nennt sie',
      (select (prosrc like '%confdeltype%' and prosrc like '%CASCADE%')::text
         from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),
  (119, 'Zusagen', 'und sie schreibt das Journal VOR dem delete (der Auditsatz '
                   'ueberlebt die Zeile)',
      (select (position('catalog_admin_changes' in prosrc)
               < position('delete from public.skylanders' in prosrc))::text
         from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),

  -- -------------------------------------------- Was die Ruempfe NICHT tun
  /*
   * ZEILE 121: DIE EINE ERLAUBTE NENNUNG. Der Rumpf der Loeschung schreibt
   * `ON DELETE CASCADE: ` in seine MELDUNG, weil sie die betroffenen
   * Tabellen namentlich nennt. Jede andere Nennung von `cascade` waere der
   * Umweg, den Anforderung 8 ausschliesst — deshalb wird nicht auf
   * „enthaelt" geprueft, sondern auf „enthaelt und ist nicht die Meldung".
   */
  /*
   * ZEILE 120 IST DIE DRITTE SCHICHT VON 114: genau EIN `update` im
   * kommentarfreien Rumpf. Zeile 113 sagt, WAS dieses eine schreibt
   * (`market_price` und `price_updated_at`), 114 sagt, was nirgends
   * vorkommt, und diese Zeile sagt, dass es nur eines gibt.
   */
  (120, 'Zusagen', 'und GENAU EIN update im Rumpf — ein zweiter Schreibweg '
                   'stuende in keiner Zusage',
      (select (length(k.rumpf) - length(replace(lower(k.rumpf), 'update ', '')))::text
         from (select regexp_replace(
                        regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'),
                        '--[^' || chr(10) || ']*', '', 'g') as rumpf
                 from pg_proc p
                where p.oid = to_regprocedure(
                        'public.admin_set_market_price(text,numeric)')) as k),
      '7'),
  (121, 'Nicht', 'kein cascade als Umweg (die Meldung darf es nennen)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and lower(p.prosrc) like '%cascade%'
          and lower(p.prosrc) not like '%on delete cascade: %'), '0'),
  /*
   * ZEILE 122 HAT DENSELBEN FALSCHEN ALARM GESCHLAGEN, aus demselben Grund:
   * sie suchte das Wort `storage`, und der Rumpf der Loeschung NENNT
   * `supabase/checks/0162_storage_note.md` — die Datei, die festhaelt, was
   * liegen bleibt. Gesucht wird jetzt ein ZUGRIFF:
   *
   *   * erst Prosa weg, wie bei 114,
   *   * dann `storage` gefolgt von einem Punkt, mit beliebigem Abstand
   *     (`storage.objects`, `storage . objects`),
   *   * und die anfuehrte Form `"storage"`.
   *
   * Ein Dateiname mit Unterstrich (`0162_storage_note.md`) trifft keines
   * davon — und ein echter Zugriff kommt an keinem davon vorbei.
   */
  (122, 'Nicht', 'kein Zugriff auf das Schema storage — am kommentarfreien '
                 'Rumpf, als Schemaname und nicht als Wort '
                 '(geteilte Bilder bleiben)',
      (select count(*)::text
         from (select regexp_replace(
                        regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'),
                        '--[^' || chr(10) || ']*', '', 'g') as rumpf
                 from pg_proc p
                where p.oid in (
                        to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))) as k
        where k.rumpf ~* 'storage[[:space:]]*\.' or k.rumpf ~* '"storage"'), '0'),
  (123, 'Nicht', 'kein setval — eine SKY-ID kommt nicht in den Umlauf zurueck',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_market_price(text,numeric)'),
                        to_regprocedure('public.admin_delete_figure(text)'))
          and (lower(p.prosrc) like '%setval%'
            or lower(p.prosrc) like '%alter sequence%')), '0'),
  (124, 'Nicht', 'keine Umhaengung: die Loeschung schreibt keine fremde SKY-ID',
      (select (prosrc not like '%set sky_id%'
           and prosrc not like '%update public.collection_items%'
           and prosrc not like '%update public.favorites%'
           and prosrc not like '%update public.shop_inventory%'
           and prosrc not like '%update public.order_lines%')::text from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),
  (125, 'Nicht', 'sie loescht keine Familie, keinen Charakter, keine Variante',
      (select (prosrc not like '%delete from public.characters%'
           and prosrc not like '%delete from public.collection_items%'
           and prosrc not like '%delete from public.favorites%'
           and prosrc not like '%delete from public.shop_inventory%')::text
         from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), 'true'),
  (126, 'Nicht', 'sie loescht genau ZWEI Tabellen: catalog_editorial und '
                 'skylanders',
      (select (length(prosrc) - length(replace(prosrc, 'delete from', '')))::text
         from pg_proc
        where oid = to_regprocedure('public.admin_delete_figure(text)')), '22'),

  -- ----------------------------------------------- Und nichts ist geschrieben
  (131, 'Unberuehrt', 'Zeilen ohne Marktwert („Preis offen") — wie im Preflight',
      (select count(*)::text from public.skylanders where market_price is null), null),
  (132, 'Unberuehrt', 'DER PREIS-ABDRUCK — muss der aus Preflight 132 sein',
      (select coalesce(md5(string_agg(s.sky_id || '|'
                                      || coalesce(s.market_price::text, '-') || '|'
                                      || coalesce(s.price_updated_at::text, '-'),
                                      E'\n' order by s.sky_id)), '(leer)')
         from public.skylanders s), null),
  /*
   * DIE ZWEI JOURNALZEILEN STEHEN HINTER `has_table_privilege` (ADR-0141).
   * Zeile 134 ist dabei die wichtigere und die, die ein fehlendes Recht am
   * meisten kostet: sie ist der Nachweis, dass dieser Lauf die Funktionen
   * NICHT aufgerufen hat. Bleibt sie offen, zaehlt Zeile 9998 sie, und der
   * Betreiber faehrt sie als `postgres` nach — so wie bei `0159`.
   */
  (133, 'Unberuehrt', 'Journalzeilen — dieselbe Zahl wie im Preflight 133',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  (134, 'Unberuehrt', 'Journalzeilen mit market_price oder deleted (muss 0 sein — '
                      'die Migration ruft die Funktionen nicht auf)',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_admin_changes
                     where field in ('market_price', 'deleted')$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, '0'),
  (135, 'Unberuehrt', 'Varianten mit Basisfigur — unveraendert',
      (select count(*)::text from public.skylanders where base_sky_id is not null),
      null),
  (136, 'Unberuehrt', 'Zeilen mit Familie — unveraendert',
      (select count(*)::text from public.skylanders where character_id is not null),
      null),
  (137, 'Unberuehrt', 'redaktionelle Zeilen — die Loeschung wurde nicht aufgerufen',
      case when has_table_privilege('public.catalog_editorial', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.catalog_editorial$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  (138, 'Unberuehrt', 'Bestellzeilen — unveraendert',
      case when has_table_privilege('public.order_lines', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select count(*)::text as c from public.order_lines$q$,
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end, null),
  /*
   * ZEILE 139 NENNT DIE EINE ZAHL, DIE WIR WISSEN. Der Abdruck von
   * `admin_publish_variant_auto` ist aus `0161` bekannt und steht in
   * `APPLIED.md`; er wird deshalb VERGLICHEN. Der von `admin_discard_draft`
   * ist nie festgeschrieben worden — er wird als Auskunft gemessen, und der
   * Preflight (112) nennt denselben Wert. Eine erfundene Erwartung waere
   * schlechter als keine.
   */
  (139, 'Unberuehrt', 'admin_publish_variant_auto (0161) ist unveraendert',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')),
      'adf679deb5d42fad5dff15bd1641f318'),
  (140, 'Unberuehrt', 'und admin_discard_draft (0155) — dieselbe Zahl wie '
                      'Preflight 112',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_discard_draft(text)')), null),

  -- ------------------------------------------------------------- Das Journal
  (141, 'Journal', 'die Audit-Constraint kennt market_price',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%market_price%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (142, 'Journal', 'und deleted',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%''deleted''%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  /*
   * ZEILE 143 IST DIE LEHRE AUS `0152`, zum vierten Mal: eine
   * neugeschriebene CHECK-Liste kann einen alten Wert verlieren, und das
   * faellt erst auf, wenn der naechste Statuswechsel in `23514` laeuft.
   * Jeder der zwoelf wird einzeln gesucht.
   */
  (143, 'Journal', 'und jeden der ZWOELF alten Werte, einzeln nachgewiesen',
      (select coalesce(max((
             pg_get_constraintdef(c.oid) like '%catalog_visible%'
         and pg_get_constraintdef(c.oid) like '%display_name_override%'
         and pg_get_constraintdef(c.oid) like '%admin_note%'
         and pg_get_constraintdef(c.oid) like '%catalog_group%'
         and pg_get_constraintdef(c.oid) like '%image_override_path%'
         and pg_get_constraintdef(c.oid) like '%card_type%'
         and pg_get_constraintdef(c.oid) like '%''created''%'
         and pg_get_constraintdef(c.oid) like '%catalog_status%'
         and pg_get_constraintdef(c.oid) like '%merged_from%'
         and pg_get_constraintdef(c.oid) like '%discarded%'
         and pg_get_constraintdef(c.oid) like '%character_id%'
         and pg_get_constraintdef(c.oid) like '%base_sky_id%')::text), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (144, 'Journal', 'und es haengt weiterhin NICHT an skylanders',
      (select count(*)::text from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.contype = 'f'
          and c.confrelid = to_regclass('public.skylanders')), '0'),

  -- ------------------------------------------------------- Nichts verrueckt
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0162 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (801, 'Basis', 'eine Shop-Baseline ist uebergeben worden',
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

  -- ============================ Die Sammlungs-Baseline aus dem Preflight
  /*
   * DIE ZUSAGE, DIE 0145 GIBT: die Wunschliste kommt DANEBEN, die Sammlung
   * bleibt, wie sie war. Diese sechs Zeilen sind die Messung dazu.
   */
  (821, 'Sammlung', 'eine Sammlungs-Baseline ist uebergeben worden',
      (select case when roh is null
                   then 'FEHLT (oder der Platzhalter steht noch drin): Zeile 901 des '
                        || 'Preflights in set_config(''skyisles.coll'', ''…'', true) '
                        || 'einsetzen und MIT diesem SELECT zusammen ausfuehren'
                   else 'ja' end from coll), 'ja'),
  (822, 'Sammlung', 'sie traegt die Marke skyisles-coll-1',
      (select coalesce(marke::text, 'keine Baseline') from coll), 'true'),
  (823, 'Sammlung', 'sie hat fuenf Felder',
      (select case when k is null then 'keine Baseline'
                   else array_length(k, 1)::text end from coll), '5'),
  (824, 'Sammlung', 'die Schutzsumme stimmt',
      (select coalesce(schutz_ok::text, 'nicht pruefbar') from coll), 'true'),

  (831, 'Sammlung', 'Sammlungszeilen wie vor der Migration',
      (select zeilen from coll_mess),
      (select case when coll_gueltig then k[2]
                   else '(keine gueltige Basis)' end from coll)),
  (832, 'Sammlung', 'Konten mit Sammlung wie vor der Migration',
      (select konten from coll_mess),
      (select case when coll_gueltig then k[3]
                   else '(keine gueltige Basis)' end from coll)),
  (833, 'Sammlung', 'Sammlungs-Abdruck wie vor der Migration — Inhalt UND Reihenfolge',
      (select sammlung_md5 from coll_mess),
      (select case when coll_gueltig then k[4]
                   else '(keine gueltige Basis)' end from coll)),

  -- ------------------------------------------------------------ Zum Nachlesen
  /*
   * DIE NUMMERN 818 UND 819 SIND DIE DER FAMILIE. `0142` bis `0144` fuehren
   * den heutigen Stand unter 819, und `staging-oneshot.test.ts` prueft das
   * fuer jede Datei des Basis-Vertrags. Eine eigene Nummerierung hier waere
   * eine zweite Ordnung fuer dieselbe Sache.
   */
  (818, 'Basis', 'Info: die uebergebene Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from basis), null),
  (819, 'Basis', 'Info: der heutige Stand als Baseline-Zeile',
      (select zeile from basis_zeile), null),
  (828, 'Sammlung', 'Info: die uebergebene Sammlungs-Baseline, wie sie gelesen wurde',
      (select coalesce(roh, '(keine)') from coll), null),
  (829, 'Sammlung', 'Info: der heutige Sammlungsstand als Baseline-Zeile',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI.
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile liest ein Objekt, auf das die
   * aufrufende Rolle kein `select` hat. Das ist KEINE Abweichung — es ist
   * eine nicht durchgefuehrte Pruefung, und als solche wird sie in Zeile
   * 9998 GEZAEHLT UND GEMELDET. Sie als bestanden zu buchen waere die
   * stille Ignorierung, die es hier nicht gibt.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
/*
 * ZEILE 9998 — WAS DIESE ROLLE NICHT PRUEFEN KONNTE.
 *
 * Der lesende Pruefzugang `skyisles_agent` hat `select` auf zwoelf Tabellen;
 * `offer_state` und `offer_state_live` gehoeren bewusst nicht dazu (0146
 * erteilt gar kein Clientrecht darauf). Fuer ihn bleiben die beiden
 * Datenzeilen offen — die ~100 Katalogzeilen laufen trotzdem durch, und das
 * ist der Punkt: EIN fehlendes Recht darf nicht hundert gute Pruefungen
 * mitnehmen.
 *
 * Im SQL-Editor (als `postgres`) ist die Zahl 0 und jede Zeile gemessen.
 */
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
