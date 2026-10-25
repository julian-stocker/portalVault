-- ===========================================================================
-- STAGING — DER ZUSTAND NACH 0145, REIN LESEND
--
-- NACH `staging-0145.sql` fahren. Vollstaendig markieren, in den SQL-Editor
-- des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- ###########################################################################
-- ##  NICHTS ZU ERSETZEN. Beide Basiszeilen stehen unten eingetragen —     ##
-- ##  gemessen vom bestandenen Staging-Preflight am 2026-10-25.            ##
-- ###########################################################################
--
-- WARUM HIER WERTE STEHEN UND KEINE PLATZHALTER. Der erste Lauf dieser Datei
-- endete mit `9999 = 18`: achtzehn rote Zeilen, und zwar GENAU die achtzehn
-- der Baseline-Uebergabe (801-804, 811-817, 821-824, 831-833). Alles andere
-- war gruen — Tabelle, Primaerschluessel, RLS, die drei Richtlinien, die
-- Rechte, `favorite_demand()`. Die Platzhalter waren nicht ersetzt, und das
-- ist genau das Verhalten, das der Riegel verspricht: ein stehengelassener
-- Platzhalter zaehlt wie eine FEHLENDE Baseline und blockiert.
--
-- Der Riegel bleibt unveraendert. Was sich geaendert hat, ist, dass die
-- gemessenen Werte jetzt in der Datei stehen, damit der Wiederholungslauf
-- ohne Handarbeit durchlaeuft.
--
-- ###########################################################################
-- ##  DIESE ZWEI ZEILEN GEHOEREN AUSSCHLIESSLICH ZUM STAGING-ROLLOUT VON   ##
-- ##  0145 AM 2026-10-25. Sie sind KEIN Sollwert fuer irgendetwas sonst:   ##
-- ##                                                                       ##
-- ##    * nicht fuer Production — dort werden sie frisch gemessen          ##
-- ##      (`prod-s-preflight-0145.sql`, Zeilen 900 und 901), und            ##
-- ##      `prod-s-postflight-0145.sql` traegt deshalb weiter Platzhalter;  ##
-- ##    * nicht fuer eine spaetere Migration — jede Migration misst ihre   ##
-- ##      eigene Basis VOR ihrem eigenen Lauf;                             ##
-- ##    * nicht fuer einen zweiten Lauf auf Staging zu einem anderen       ##
-- ##      Zeitpunkt — sobald der Betrieb eine Figur einbucht oder ein      ##
-- ##      Sammler eine Figur hinzufuegt, sind sie veraltet und MUESSEN     ##
-- ##      blockieren.                                                      ##
-- ##                                                                       ##
-- ##  Genau das ist der Zweck des Vergleichs: nicht „sieht Staging aus wie ##
-- ##  am 25. Oktober", sondern „hat die Migration den Shop und die         ##
-- ##  Sammlung angefasst". Die Begruendung dieser Unterscheidung steht in  ##
-- ##  `supabase/checks/production_baseline_0142_finding.md`.               ##
-- ###########################################################################
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen.
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
-- WAS SIE NICHT BEANTWORTET: ob die Richtlinien GREIFEN. Das zeigt nur ein
-- funktionaler Lauf mit zwei echten Konten (`npm run verify:rls:staging`).
--
-- EINGEBETTET: `supabase/checks/0145_postflight.sql`, Zeichen fuer Zeichen.
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
-- B  DIE BEIDEN BASISZEILEN AUS DEM PREFLIGHT VOM 2026-10-25
--
-- Transaktionslokal (`true`), mit dem `rollback` unten fort. Sie werden NICHT
-- gespeichert — sie leben genau so lange wie dieser Lauf, und die Datenbank
-- behaelt nach dem `rollback` keine Spur davon. Deshalb muessen sie IN
-- DERSELBEN Klammer stehen wie die Abfrage: der SQL-Editor fuehrt jeden
-- Lauf getrennt aus, und `set_config(…, true)` ueberlebt das nicht.
--
-- Die Schutzsummen `95ca138932c1` und `c8a5542794f2` sind nachgerechnet,
-- bevor diese Werte hier eingetragen wurden: `left(md5(Felder 2-8), 12)`
-- bzw. `left(md5(Felder 2-4), 12)`. Ein Tippfehler auf dem Weg aus dem
-- SQL-Editor haette die Nachkontrolle in Zeile 804 bzw. 824 blockiert, nicht
-- stillschweigend eine falsche Zahl verglichen.
--
-- NUR FUER DIESEN EINEN LAUF — siehe den Kasten im Kopf.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base',
  'skyisles-base-1|256|4d1d6c30fe0ae886ca2689bcb1fe9634|534|534|285|626|54fdbf243d672038128875e9a707e3dd|95ca138932c1', true);
select set_config('skyisles.coll',
  'skyisles-coll-1|1|1|a8c965923be52b4d6fee837ae35fd22e|c8a5542794f2', true);

-- >>> EINGEBETTET: supabase/checks/0145_postflight.sql
-- ===========================================================================
-- 0145 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0145_favorites.sql` fahren. Zeile 9999 muss 0 zeigen.
--
-- WAS SIE BEANTWORTET: steht `favorites` mit genau drei Spalten, dem
-- zusammengesetzten Primaerschluessel, RLS und DREI Richtlinien, die alle
-- Konto UND Rolle fragen; hat `anon` nichts und `authenticated` genau
-- SELECT/INSERT/DELETE; steht `favorite_demand()` als `definer`+`stable`
-- hinter dem Betriebs-Tor und ist fuer PUBLIC nicht ausfuehrbar — und hat
-- sich weder am Shop noch an der SAMMLUNG etwas bewegt.
--
-- WAS SIE NICHT BEANTWORTET: ob die Richtlinien im Betrieb das Richtige tun.
-- Das zeigt nur ein funktionaler Lauf mit zwei echten Konten
-- (`npm run verify:rls:staging`). Eine Richtlinie, die DA steht, ist nicht
-- dasselbe wie eine, die GREIFT.
--
-- SO UEBERGIBST DU DIE BEIDEN BASISZEILEN. Zeile 900 und Zeile 901 des
-- Preflights vollstaendig kopieren und VOR diesem SELECT ausfuehren:
--
--   select set_config('skyisles.base', 'skyisles-base-1|…', true);
--   select set_config('skyisles.coll', 'skyisles-coll-1|…', true);
--
-- Alles zusammen markieren und ausfuehren — `set_config(…, true)` gilt nur
-- in DERSELBEN Transaktion, und der SQL-Editor fuehrt jeden Lauf getrennt
-- aus. Ohne Baseline laeuft hier nichts durch, und die aktuellen Werte
-- werden NIEMALS als Sollwert eingesetzt.
--
-- BLEIBT DER PLATZHALTER STEHEN, LAEUFT DIESE DATEI NICHT DURCH. Die Huelle
-- bringt beide `set_config`-Zeilen schon mit, damit niemand sie vergisst —
-- und genau deshalb zaehlt ein nicht ersetzter Platzhalter wie eine fehlende
-- Zeile. Sonst waere die Bequemlichkeit die Luecke im Riegel.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
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
-- DER SAMMLUNGS-VERTRAG — fuenf Felder, neu in `0145`
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
-- Warum ein zweiter Vertrag statt eines erweiterten, steht im Kopf von
-- `0145_preflight.sql`: den Basis-Vertrag zu aendern haette jede Baseline
-- aus `0142` bis `0144` unlesbar gemacht.
--
-- Das jeweils letzte Feld ist `left(md5(<die Felder davor, ohne Marke,
-- mit | verbunden>), 12)`. Es faengt ab, was ein Mensch beim Kopieren
-- anrichtet: eine abgeschnittene Zeile, zwei vertauschte Felder, eine
-- verlorene Stelle. Es ist KEIN Schutz gegen Absicht — wer die Werte neu
-- setzt und die Summe neu rechnet, kann das. Dagegen schuetzt kein SQL,
-- sondern die Reihenfolge der Schritte: die Basis entsteht VOR der
-- Migration und wird danach nicht mehr erhoben.
--
-- DIE GRENZE EINES VORHER-NACHHER-VERGLEICHS, ausdruecklich.
--
-- Er sagt „zwischen den beiden Laeufen hat sich X bewegt". Er sagt NICHT,
-- WER es bewegt hat. Zwischen Preflight und Nachkontrolle kann regulaerer
-- Betrieb stattgefunden haben: ein Verkauf im Shop, ein Wareneingang, eine
-- Umpreisung — und an der Sammlung ein Sammler, der eine Figur hinzufuegt.
--
-- SO UNTERSCHEIDET MAN BEIDES:
--
--   1. ZEITFENSTER KLEIN HALTEN. Preflight, Migration und Nachkontrolle
--      hintereinander fahren.
--   2. DIE MIGRATION KANN ES NICHT GEWESEN SEIN. `0145` legt eine Tabelle
--      und eine Funktion an. Sie enthaelt kein `update`, `insert` oder
--      `delete` auf irgendeine bestehende Tabelle und nennt
--      `collection_items`, `shop_inventory` und `skylanders` nur in ihren
--      Vorbedingungen. Sie laeuft in EINER Transaktion, die bei jeder
--      Abweichung ihrer eigenen Nachbedingungen abbricht.
--   3. UND WENN DOCH GEZWEIFELT WIRD: `prod-s-baseline-drift.sql` loest die
--      Shop-Seite tagweise auf.
--
-- Was ein reiner Vergleich NICHT leisten kann: zwei Aenderungen, die sich
-- gegenseitig aufheben. Die Abdruecke fangen das ab — sie haengen an Inhalt
-- und Reihenfolge, nicht nur an der Anzahl.
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
tab as (
  select to_regclass('public.favorites') as oid
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proacl,
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
   where n.nspname = 'public' and p.proname = 'favorite_demand'
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------------ Die Tabelle
  (101, 'Tabelle', 'favorites steht',
      (to_regclass('public.favorites') is not null)::text, 'true'),
  (102, 'Tabelle', 'genau drei Spalten, in dieser Reihenfolge',
      coalesce((select string_agg(column_name, ',' order by ordinal_position)
                  from information_schema.columns
                 where table_schema = 'public' and table_name = 'favorites'),
               '(keine Tabelle)'), 'user_id,sky_id,created_at'),
  /*
   * DIE REIHENFOLGE KOMMT AUS `array_position`, NICHT AUS `with ordinality`.
   *
   * Die erste Fassung schrieb
   * `cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)`.
   * Fachlich dasselbe — aber `src/lib/admin/check-sql-hazards.test.ts`
   * meldete `k` als nirgends gebundenen Qualifizierer, weil seine
   * Alias-Erkennung die Form `… with ordinality as k(…)` nicht sieht. Der
   * Waechter hatte recht in der Sache: so geschrieben ist der Qualifizierer
   * aus dem Text nicht ableitbar. `array_position` braucht gar keinen Alias
   * und ist eine Zeile kuerzer.
   */
  (103, 'Tabelle', 'der Primaerschluessel IST (user_id, sky_id) — doppelte '
        'Favoriten sind kein Zustand, den es gibt',
      coalesce((select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
                  from pg_constraint c
                  join pg_attribute a on a.attrelid = c.conrelid
                                     and a.attnum = any (c.conkey)
                 where c.conrelid = to_regclass('public.favorites') and c.contype = 'p'),
               '(keiner)'), 'user_id,sky_id'),
  (104, 'Tabelle', 'RLS ist an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.favorites')), '(keine Tabelle)'), 'true'),
  (105, 'Tabelle', 'der Index auf sky_id steht (die Nachfrage-Richtung)',
      (select count(*)::text from pg_indexes
        where schemaname = 'public' and indexname = 'favorites_sky_id_idx'), '1'),
  (106, 'Tabelle', 'favorites_sky_fk ist ON DELETE RESTRICT — eine Katalogzeile '
        'bricht nicht unter einer Wunschliste weg',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.favorites')
          and conname = 'favorites_sky_fk' and confdeltype = 'r'), '1'),
  (107, 'Tabelle', 'favorites_user_fk ist ON DELETE CASCADE — Konto fort heisst '
        'Wunschliste fort (DSGVO)',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.favorites')
          and conname = 'favorites_user_fk' and confdeltype = 'c'), '1'),
  (108, 'Tabelle', 'die Migration hat keine Zeile angelegt',
      (select count(*)::text from public.favorites), '0'),

  -- ------------------------------------------------------- Die Richtlinien
  (111, 'RLS', 'genau DREI Richtlinien — kein update, weil es nichts zu aendern gibt',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'), '3'),
  (112, 'RLS', 'und es gibt keine update-Richtlinie',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'
          and cmd = 'UPDATE'), '0'),
  (113, 'RLS', 'keine Richtlinie gilt fuer anon',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'
          and 'anon' = any (roles)), '0'),
  (114, 'RLS', 'alle drei fragen das eigene Konto UND die Rolle',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'
          and coalesce(qual, with_check) like '%is_collector_account()%'
          and coalesce(qual, with_check) like '%auth.uid()%'), '3'),
  (115, 'RLS', 'die drei sind SELECT, INSERT und DELETE',
      coalesce((select string_agg(distinct cmd, ',' order by cmd) from pg_policies
                 where schemaname = 'public' and tablename = 'favorites'),
               '(keine)'), 'DELETE,INSERT,SELECT'),

  -- ------------------------------------------------------------- Die Rechte
  (121, 'Rechte', 'anon hat KEIN Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'favorites'
          and grantee = 'anon'), '0'),
  (122, 'Rechte', 'authenticated hat genau SELECT/INSERT/DELETE — kein update, '
        'kein truncate (dafuer gilt RLS nicht)',
      coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                  from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'favorites'
                   and grantee = 'authenticated'), '(keine)'),
      'DELETE,INSERT,SELECT'),

  -- ---------------------------------------------------------- Die Funktion
  (131, 'Funktion', 'favorite_demand(text[]) steht, genau einmal',
      (select count(*)::text from fn), '1'),
  (132, 'Funktion', 'security definer',
      coalesce((select prosecdef::text from fn), '(keine)'), 'true'),
  (133, 'Funktion', 'stable (s), nicht volatile',
      coalesce((select provolatile::text from fn), '(keine)'), 's'),
  (134, 'Funktion', 'es gibt GENAU EINE search_path-Festlegung',
      coalesce((select pfadanzahl::text from fn), '(keine)'), '1'),
  (135, 'Funktion', 'und ihr Wert ist LEER (ausgepackt, nicht verglichen)',
      coalesce((select pfadwert from fn), '(keine)'), '""'),
  (136, 'Funktion', 'sie fragt can_operate_active_seller(), bevor sie zaehlt',
      coalesce((select (prosrc like '%can_operate_active_seller()%')::text from fn),
               '(keine)'), 'true'),
  (137, 'Funktion', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))), '0'),
  (138, 'Funktion', 'authenticated darf ausfuehren (das Tor sitzt im Rumpf)',
      (select count(*)::text from fn, aclexplode(fn.proacl) a
        where a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated'), '1'),

  -- -------------------- Das Vorbild ist unberuehrt: collection_items
  /*
   * `0145` kopiert das Muster von `collection_items`. Es zu VERAENDERN war
   * nie die Absicht — diese Zeilen halten fest, dass es auch nicht
   * versehentlich geschehen ist.
   *
   * DIESELBE BERICHTIGUNG WIE IM PREFLIGHT (2026-10-25). Hier stand „genau
   * vier Richtlinien", und auf Staging sind es fuenf: die Lesepolicy
   * `agent_read_collection_items` der Rolle `skyisles_agent`
   * (`staging-agent-setup.sql`, `docs/SECURITY.md` 4b). Eine Zahl bricht an
   * einer berechtigten Diagnosepolicy und sagt nichts darueber, ob die
   * vier, auf die es ankommt, noch stehen. Gepruefft wird die Eigenschaft —
   * und eine unbekannte sechste faellt trotzdem auf.
   */
  (141, 'Sammlung', 'die vier eigenen Richtlinien von collection_items stehen weiterhin, '
        'fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (142, 'Sammlung', 'und RLS ist dort weiterhin an',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.collection_items')), '(keine)'), 'true'),
  (143, 'Sammlung', 'jede der vier fragt weiterhin Konto UND Rolle',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and coalesce(qual, with_check) like '%is_collector_account()%'
          and coalesce(qual, with_check) like '%auth.uid()%'), '4'),
  (144, 'Sammlung', 'keine Richtlinie dieser Tabelle gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and 'anon' = any (roles)), '0'),
  (145, 'Sammlung', 'und 0145 hat KEINE Richtlinie auf collection_items hinterlassen',
      (select count(*)::text from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'collection_items'
          and not (p.policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own'))
          and not (p.policyname = 'agent_read_collection_items'
                   and p.cmd = 'SELECT'
                   and p.permissive = 'PERMISSIVE'
                   and array_to_string(p.roles, '+') = 'skyisles_agent')), '0'),
  (146, 'Sammlung', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0145 ruehrt das nicht an)',
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

  -- ================================== Die Shop-Baseline aus dem Preflight
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
-- <<< ENDE: supabase/checks/0145_postflight.sql

rollback;
