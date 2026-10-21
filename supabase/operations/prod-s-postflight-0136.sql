-- ===========================================================================
-- PRODUCTION — DIE NACHKONTROLLE ZU 0136, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- PRODUCTION-Projekts einfuegen, ausfuehren. Die Klammer, der Riegel, der
-- Z0-Modus und das `rollback` stehen schon darin — es ist nichts
-- zusammenzusetzen und nichts einzutippen.
--
-- WARUM ES SIE GIBT: der Supabase-SQL-Editor zeigt `NOTICE`-Meldungen nicht
-- an. „Success" ohne Meldungen ist deshalb KEIN Befund — weder ein guter noch
-- ein schlechter. Die Migration hat ihre Nachbedingungen in ihrer eigenen
-- Transaktion geprueft und bei einer Abweichung ALLES zurueckgerollt; dass sie
-- durchlief, heisst also schon etwas. Was sie geprueft hat, ist aber nirgends
-- zu sehen. Diese Datei fragt es von aussen nochmal, und zwar sichtbar.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT. Ein `do`-Block, der nur
-- zaehlt, ein `set_config` mit Transaktionsgeltung, ein einziges SELECT —
-- geklammert in `begin … rollback`. Kein `insert`, kein `update`, kein DDL,
-- keine Rechteaenderung. **Sie ruft `seller_business_backup()` NICHT auf:**
-- gelesen wird die gespeicherte DEFINITION, nicht ihr Ergebnis. Es werden
-- keine Geschaeftsdaten gelesen und keine ausgegeben.
--
-- WAS SIE BEANTWORTET — die fuenf Fragen zu 0136
--
--   Zeile 108  fuehrt der Bereich `figures` jetzt `item_type`?      (muss 1)
--   Zeile 107  und zwar an der richtigen Stelle, Feld fuer Feld?
--   Zeile 105  stehen weiterhin genau 28 Bereiche?                 (muss 28)
--   Zeile 106  sind die Feldzeilen 352 → 353 gestiegen?            (muss 353)
--   Zeile 102  sind die uebrigen 27 Bereiche unveraendert?
--
-- Zeile 102 ist der eigentliche Beweis, und er ist staerker als eine
-- bereichsweise Gegenrechnung: `md5(prosrc) = f6d08440707ba72a8040a8d1e666c092`
-- heisst, der gespeicherte Rumpf ist ZEICHEN FUER ZEICHEN der aus
-- `0136_business_backup_item_type.sql`. Dass dieser Rumpf der aus `0131` mit
-- GENAU EINER eingefuegten Zeile ist, rechnet
-- `src/lib/backup/backup-item-type.test.ts` nach. Stimmt der Abdruck, koennen
-- die 27 anderen Bereiche nicht abweichen — es gibt kein anderes Zeichen, das
-- abweichen koennte. Derselbe Wert gilt auf Staging: der Rumpf ist Text, und
-- Text ist umgebungsunabhaengig.
--
-- Zeilen 131 und 132 sind die Antwort auf „keine Auswirkungen auf Angebote,
-- Lagerbestaende oder Bestellungen": im Rumpf steht kein `insert`, `update`,
-- `delete`, `truncate`, `nextval`, `setval`. Die Funktion KANN nichts
-- aendern. Was `0136` sonst anfasst, ist nichts: sie schreibt einen
-- Funktionsrumpf, keine Tabellenzeile.
--
-- WAS SIE HIER NICHT BEWERTET — die fuenf Z0-Zeilen 911 bis 915
--
-- Der Z0-Vertrag traegt STAGING-Bezugszahlen (534 shopfaehig, 256 Angebote,
-- Abdruck `4d1d6c30…`, 534 sammelbar, 39 Overrides). Production fuehrt andere
-- Zahlen; eine umgebungsblinde Erwartung waere hier fuenf Fehlalarme. Der
-- Modus ist deshalb `keine` — ein AUSDRUECKLICHER Verzicht, der im Protokoll
-- steht, kein stilles Uebergehen (Zeile 902 wuerde ein fehlendes `set_config`
-- blockierend melden).
--
-- Die fuenf Zeilen werden trotzdem GEMESSEN. Erwartet werden auf Production,
-- aus den Bedingungen der Funktionen abgeleitet und am 2026-10-21 lesend
-- vorhergesagt:
--
--   911 shopfaehige Katalogzeilen   531
--   912 oeffentliche Angebote       287
--   913 Abdruck der Angebotsliste   (nicht vorhersagbar — er ist der Bezug
--                                    fuer den NAECHSTEN Lauf; bitte notieren)
--   914 sammelbare Artikel          531
--   915 Zeilen mit Override          59
--
-- Weichen 911, 912, 914 oder 915 ab, ist das ein BEFUND und kein Freibrief:
-- `0136` kann keine davon veraendern — sie schreibt keine Tabellenzeile.
--
-- ERGEBNIS LESEN: die Tabelle hat eine Zeile `9999`. Steht dort `0`, ist
-- alles wie erwartet. Steht dort etwas anderes, zeigen die Zeilen mit
-- `ok = false`, welche Erwartung nicht stimmt. Zeilen mit `ok = NULL` sind
-- Messungen ohne Sollwert — dazu gehoeren 911 bis 915.
--
-- EINGEBETTET: `supabase/checks/0136_postflight.sql`, Zeichen fuer Zeichen —
-- geprueft von `src/lib/catalog/staging-oneshot.test.ts` bei jedem Testlauf.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den sieben schreibenden Dateien, mit
-- denselben Abbruchkennungen — und aus demselben Anlass: am 2026-10-20 sind
-- Pruefdateien auf STAGING gelaufen, waehrend sie als Production-Ergebnisse
-- gelesen wurden. Ein lesender Lauf in der falschen Datenbank richtet keinen
-- Schaden an, aber er liefert einen FALSCHEN BEFUND, und das ist schlimmer
-- als kein Befund.
--
-- A1 verlangt das VOLLSTAENDIGE Staging-Markerpaar. Production traegt
-- `SKY-0821` rechtmaessig (Winterfest Lob-Star, seit 2026-09-16, redaktionell
-- ausgeblendet); erst `SKY-0821` UND `SKY-0822` bedeuten Staging. Probelauf
-- P41 fuehrt beide Faelle vor.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/0136_postflight.sql mit dem Modus staging.';
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

-- Der Z0-Modus. `keine` ist der ausdrueckliche Verzicht auf die fuenf
-- Staging-Bezugszahlen — siehe Kopf. Er gilt transaktionslokal (`true`) und
-- ist mit dem `rollback` unten fort.
select set_config('skyisles.z0', 'keine', true);

-- >>> EINGEBETTET: supabase/checks/0136_postflight.sql
-- ===========================================================================
-- Zustand nach 0136 — rein lesend
--
-- Dieselben Zeilen wie der Preflight, mit UMGEKEHRTEN Erwartungen an den
-- Stand der Funktion (`0136` statt `0131`, 353 Feldzeilen statt 352, der
-- Bereich `figures` mit zehn Feldern statt neun) — und mit UNVERAENDERTEN
-- Erwartungen an alles andere: Rechte, Formatversion, Ausschluesse, Shop und
-- Fortschritt.
--
-- DER ABDRUCK IST DER BEWEIS. `md5(prosrc) = f6d08440707ba72a8040a8d1e666c092`
-- heisst: der Rumpf ist Zeichen fuer Zeichen der aus
-- `0136_business_backup_item_type.sql` — und der ist, nachgerechnet in
-- `src/lib/backup/backup-item-type.test.ts`, der aus `0131` mit GENAU EINER
-- eingefuegten Zeile. Eine bereichsweise Gegenrechnung waere danach
-- redundant; sie steht trotzdem als Zeile 105 bis 107 da, damit eine
-- Abweichung lesbar ist statt nur gemeldet.
--
-- SIE RUFT `seller_business_backup` NICHT AUF. Gelesen wird die gespeicherte
-- Definition, nicht ihr Ergebnis — es werden keine Geschaeftsdaten gelesen und
-- keine ausgegeben. Dass die Sicherung auch LAEUFT, zeigt erst ein echter
-- Export: `/business` herunterladen und `npm run verify:backup` fahren.
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML, keine
-- Rechteaenderung. Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with fn as (
  select p.oid, p.prosrc, p.provolatile, p.prosecdef, p.proconfig, p.proacl,
         p.pronargs, p.prorettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_business_backup'
),
/*
 * Die Bereich-Feld-Paare, ZEILENWEISE bestimmt.
 *
 * Ein mehrzeiliger Ausdruck kollabiert in PostgreSQL, weil die Gierigkeit
 * fuer den ganzen Zweig gilt (Handbuch 9.7.3.5) — der erste Bereich
 * verschluckte dann den gesamten Rumpf. Dieselbe Lehre wie in `0130`, `0131`
 * und `0136`.
 */
zeile as (
  select z.nr, z.txt
    from fn f, regexp_split_to_table(f.prosrc, E'\n') with ordinality as z(txt, nr)
),
anfang as (
  select z.nr,
         (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
    from zeile z
   where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
),
paar as (
  select z.nr,
         coalesce((select a.name from anfang a
                    where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
         rtrim(btrim(z.txt), ',') as feld
    from zeile z
   where z.txt ~ '^ {10}''[a-z_0-9]+'','
),
/* Die neun personenbezogenen Felder duerfen NUR im Belegsnapshot stehen. */
privat (feld) as (values
  ('''sender_name'''), ('''sender_street'''), ('''sender_postal_code'''),
  ('''sender_city'''), ('''sender_country'''), ('''listing_title'''),
  ('''listing_url'''), ('''listing_details'''), ('''agreement_note''')
),
sammelbar as (
  select s.sky_id, s.series_code
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
/*
 * ---------------------------------------------------------------------------
 * DER Z0-VERTRAG — DIE WERTE STEHEN HIER, GEWAEHLT WIRD NUR DER MODUS
 *
 * Z0 hat am 2026-10-19 auf Staging gemessen: 534 shopfaehige Zeilen, 256
 * oeffentliche Angebote, Abdruck `4d1d6c30fe0ae886ca2689bcb1fe9634`, 534
 * sammelbare Artikel, 39 `display_name_override`
 * (`supabase/checks/open_verifications.md`, Abschnitt 0f).
 *
 * WARUM DIE ZAHLEN IM CODE STEHEN UND NICHT EINGETIPPT WERDEN. Ein Sollwert,
 * den der Bediener bei jedem Lauf mitliefert, ist bei jedem Lauf eine neue
 * Gelegenheit fuer einen Tippfehler — und ein Tippfehler in der Erwartung
 * laesst die Pruefung bestehen. Die Werte sind versioniert, pruefsummiert und
 * nachlesbar; gewaehlt wird nur, OB sie gelten.
 *
 * WARUM SIE TROTZDEM NICHT BEDINGUNGSLOS GELTEN. Production fuehrt andere
 * Zahlen. Dieselbe Datei muss dort laufen koennen, ohne fuenf Fehlalarme zu
 * melden — eine umgebungsblinde Erwartung war in diesem Projekt schon zweimal
 * die Ursache eines falschen Befundes (`0132`-Readiness Zeile 602,
 * `0124`-Preflight Zeile 106).
 *
 * UND WARUM DAS VERGESSEN AUFFAELLT. Fehlt der Modus, ist Pruefung 902
 * blockierend. Es gibt damit keinen Lauf, der die fuenf Werte STILL
 * uebergeht: entweder sie werden geprueft, oder der Verzicht steht als
 * ausdrueckliche Wahl im Protokoll.
 *
 *   -- auf Staging, in DERSELBEN Klammer wie diese Datei:
 *   select set_config('skyisles.z0', 'staging', true);
 *
 *   -- anderswo, als ausdruecklicher Verzicht:
 *   select set_config('skyisles.z0', 'keine', true);
 *
 * `current_setting(..., true)` ist die nachsichtige Form: sie wirft nicht,
 * wenn der Parameter fehlt. `set_config(..., true)` gilt transaktionslokal —
 * die `set`-Zeile und diese Datei muessen deshalb GEMEINSAM in einer Klammer
 * laufen.
 *
 * NICHT IM VERTRAG, weil Z0 sie nicht als Zahl festgehalten hat: der Nenner
 * JE SERIE und der `md5` der Overrides. Beide vergleicht der Postflight gegen
 * das Preflight-Raster, und die Migration prueft beide in ihrer eigenen
 * Transaktion — das ist die strengere der zwei Pruefungen.
 * ---------------------------------------------------------------------------
 */
vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
  ('shopfaehig',   '534'),
  ('angebote',     '256'),
  ('angebote_md5', '4d1d6c30fe0ae886ca2689bcb1fe9634'),
  ('sammelbar',    '534'),
  ('overrides',    '39')
),
soll as (
  -- Im Modus `staging` ist der Wert ein Sollwert, sonst NULL — und eine Zeile
  -- mit NULL-Erwartung ist in diesen Dateien eine Messung ohne Bewertung.
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s where s.sky_id >= 'SKY-9000'), '(keine)'), null),
  (2, 'Umgebung', 'Info: Abdruck der lebenden Sicherung',
      coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)'), null),

  -- --------------------------------------------------- Der Stand der Funktion
  (101, 'Stand', 'die Funktion ist genau einmal definiert',
      (select count(*)::text from fn), '1'),
  (102, 'Stand', 'md5 des gespeicherten Rumpfs',
      coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)'), 'f6d08440707ba72a8040a8d1e666c092'),
  (103, 'Stand', 'Laenge des Rumpfs in Zeichen',
      coalesce((select length(f.prosrc) from fn f), -1)::text, '21494'),
  (104, 'Stand', 'md5 des Funktionskommentars',
      coalesce((select md5(obj_description(f.oid, 'pg_proc')) from fn f),
               '(kein Kommentar)'), 'c12618f312b413571eeabe912ca03651'),
  (105, 'Form', 'genau 28 Bereiche im Rumpf',
      (select count(*)::text from anfang), '28'),
  (106, 'Form', 'Feldzeilen im Rumpf',
      (select count(*)::text from paar), '353'),
  (107, 'Form', 'der Bereich figures, Feld fuer Feld und in dieser Folge',
      coalesce((select string_agg(p.feld, '; ' order by p.nr)
                  from paar p where p.bereich = 'figures'), '(kein Bereich figures)'),
      '''sky_id'', t.sky_id; ''name'', t.name; ''slug'', t.slug; ''series_code'', t.series_code; ''card_type'', t.card_type; ''item_type'', t.item_type; ''market_price'', t.market_price::text; ''category_id'', t.category_id; ''is_active'', t.is_active; ''source'', t.source'),
  (108, 'Form', 'der Rumpf nennt item_type (0 vor 0136, 1 danach)',
      (select count(*)::text from paar p
        where p.bereich = 'figures' and p.feld = '''item_type'', t.item_type'), '1'),
  (109, 'Form', 'jede Feldzeile gehoert zu einem Bereich',
      (select count(*)::text from paar p where p.bereich = ''), '0'),

  -- ------------------------------------------------- Die Grundlage aus 0135
  (111, 'Grundlage', 'skylanders.item_type steht (0135 ist angewendet)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (112, 'Grundlage', 'CHECK skylanders_item_type_known steht',
      (select (count(*) = 1)::text from pg_constraint
        where conname = 'skylanders_item_type_known'), 'true'),
  (113, 'Grundlage', 'andere Artikeltypen als figure/game (muss 0 sein)',
      (select count(*)::text from public.skylanders
        where item_type not in ('figure', 'game')), '0'),
  (114, 'Grundlage', 'is_shop_eligible prueft item_type = figure',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),
  (115, 'Grundlage', 'Info: Zeilen je item_type',
      coalesce((select string_agg(x.item_type || '=' || x.n::text, ', ' order by x.item_type)
                  from (select item_type, count(*) as n from public.skylanders
                         group by item_type) x), '(keine)'), null),

  -- ----------------------------------------------------- Die Form der Funktion
  (121, 'Vertrag', 'stabil (s), nicht volatil',
      (select f.provolatile::text from fn f), 's'),
  (122, 'Vertrag', 'security definer',
      (select f.prosecdef::text from fn f), 'true'),
  (123, 'Vertrag', 'es gibt eine search_path-Festlegung, und sie ist leer',
      (select coalesce(
                (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                   from unnest(coalesce(f.proconfig, '{}'::text[])) c
                  where c like 'search\_path=%'),
                '(leer)')::text from fn f), '(leer)'),
  (124, 'Vertrag', 'keine Parameter',
      (select f.pronargs::text from fn f), '0'),
  (125, 'Vertrag', 'Rueckgabetyp jsonb',
      (select f.prorettype::regtype::text from fn f), 'jsonb'),
  (126, 'Vertrag', 'Formatversion 1 steht im Rumpf',
      (select (position('''format_version'',  1' in f.prosrc) > 0)::text from fn f), 'true'),
  (127, 'Vertrag', 'restore_supported steht als false im Rumpf',
      (select (position('''restore_supported'',      false' in f.prosrc) > 0)::text
         from fn f), 'true'),

  -- ------------------------------------------------------------ Schreibschutz
  (131, 'Schreibschutz', 'kein insert, update, delete, truncate im Rumpf',
      (select count(*)::text from fn f
        where f.prosrc ~* '\minsert\s+into\m' or f.prosrc ~* '\mupdate\s+public\.'
           or f.prosrc ~* '\mdelete\s+from\m' or f.prosrc ~* '\mtruncate\m'), '0'),
  (132, 'Schreibschutz', 'keine Sequenzberuehrung (nextval, setval)',
      (select count(*)::text from fn f
        where f.prosrc ~* '\mnextval\m' or f.prosrc ~* '\msetval\m'), '0'),

  -- ---------------------------------------------------------------- Rechte
  (141, 'Rechte', 'materialisierter ACL (NULL waere PUBLIC)',
      (select (f.proacl is not null)::text from fn f), 'true'),
  (142, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from fn f, aclexplode(f.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (143, 'Rechte', 'authenticated darf ausfuehren',
      has_function_privilege('authenticated', 'public.seller_business_backup()',
                             'execute')::text, 'true'),
  (144, 'Rechte', 'Info: der ACL im Klartext',
      (select coalesce(f.proacl::text, '(NULL)') from fn f), null),

  -- --------------------------------------- Die neun personenbezogenen Felder
  (151, 'Datenschutz', 'kein privates Feld ausserhalb von purchase_receipts',
      (select count(*)::text from paar p join privat v on p.feld like v.feld || ',%'
        where p.bereich <> 'purchase_receipts'), '0'),
  (152, 'Datenschutz', 'und im Belegsnapshot stehen alle neun',
      (select count(*)::text from privat v
        where exists (select 1 from paar p
                       where p.bereich = 'purchase_receipts'
                         and p.feld like v.feld || ',%')), '9'),
  (153, 'Datenschutz', 'keine Kontoidentitaet im Rumpf',
      (select count(*)::text from fn f
        where position('''updated_by''' in f.prosrc) > 0
           or position('''issued_by''' in f.prosrc) > 0
           or position('''delivered_by''' in f.prosrc) > 0
           or position('''client_salt''' in f.prosrc) > 0), '0'),

  -- --------------------------------------------------------------- Befund
  (401, 'Befund', 'Stand der lebenden Funktion (Messung ohne Sollwert)',
      (select case md5(f.prosrc)
                when '24c3810288bb20929fe995554a267adf' then 'STAND_0131'
                when 'f6d08440707ba72a8040a8d1e666c092' then 'STAND_0136'
                when 'a27b61db988df7627a4992b1770ac626' then 'STAND_0130'
                else 'UNBEKANNT: ' || md5(f.prosrc) end
         from fn f), null),
  -- ------------------------------------------------- Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''staging'', true) fehlt'
              end from vertrag v), 'ja'),
  (911, 'Z0-Vertrag', 'shopfaehige Zeilen = Z0 (534)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (912, 'Z0-Vertrag', 'oeffentliche Angebote = Z0 (256)',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  (913, 'Z0-Vertrag', 'Abdruck der Angebotsliste = Z0 (4d1d6c30...9634)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (914, 'Z0-Vertrag', 'sammelbare Artikel = Z0 (534)',
      (select count(*)::text from sammelbar),
      (select wert from soll where schluessel = 'sammelbar')),
  (915, 'Z0-Vertrag', 'Zeilen mit display_name_override = Z0 (39)',
      (select count(*)::text from public.skylanders
        where display_name_override is not null),
      (select wert from soll where schluessel = 'overrides'))
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
-- <<< ENDE: supabase/checks/0136_postflight.sql

rollback;
