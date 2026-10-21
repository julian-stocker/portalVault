-- ===========================================================================
-- 0140 POSTFLIGHT — der Zustand danach, rein lesend
--
-- Dieselben Zeilen wie der Preflight, mit UMGEKEHRTEN Erwartungen an den
-- Stand der Funktion (`0140` statt `0136`, 356 Feldzeilen statt 353, der
-- Bereich `figures` mit elf Feldern, `shop_inventory` mit dreizehn) — und
-- mit UNVERAENDERTEN Erwartungen an alles andere: Rechte, Formatversion,
-- Ausschluesse, Freigaben, Shop und Fortschritt.
--
-- DER ABDRUCK IST DER BEWEIS. `md5(prosrc) = a32b148cebe00ee0d0d469f96fd2028e`
-- heisst: der Rumpf ist Zeichen fuer Zeichen der aus
-- `0140_business_backup_sale_release.sql`. Dieser Wert ist nicht geraten — er
-- ist aus der Migrationsdatei gerechnet, und die Rechnung ist an `0136`
-- geprueft: dieselbe Methode liefert dort `f6d08440707ba72a8040a8d1e666c092`
-- und 21 494 Zeichen, also genau die Werte, die der `0136`-Postflight seit
-- dem 2026-10-19 verlangt. Probelauf **P46** fuehrt den Abdruck ausserdem an
-- echtem PostgreSQL nach.
--
-- Stimmt dieser eine Wert, koennen die 26 unberuehrten Bereiche nicht
-- abweichen — es gibt kein anderes Zeichen, das abweichen koennte. Die
-- Zeilen 106 und 107 stehen trotzdem da, damit eine Abweichung LESBAR ist
-- statt nur gemeldet.
--
-- SIE RUFT `seller_business_backup` NICHT AUF. Dass die Sicherung auch
-- LAEUFT, zeigt erst ein echter Export: `/business` herunterladen und
-- `npm run verify:backup` fahren.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with fn as (
  select p.oid, p.prosrc, p.provolatile, p.prosecdef, p.proconfig, p.proacl,
         p.pronargs, p.prorettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_business_backup'
),
/*
 * Die Bereich-Feld-Paare, ZEILENWEISE bestimmt — dieselbe Lehre wie in
 * `0130`, `0131`, `0136`: ein mehrzeiliger Ausdruck kollabiert, weil die
 * Gierigkeit fuer den ganzen Zweig gilt (Handbuch 9.7.3.5), und der erste
 * Bereich verschluckte dann den gesamten Rumpf.
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
vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, staging, production) as (values
  /*
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — wie in den Pruefdateien zu `0139`.
   * Links der Z0-Vertrag von Staging (Stand 2026-10-20), rechts der
   * gemessene Production-Stand nach `0139` (2026-10-21, vom Betreiber im
   * Postflight bestaetigt).
   */
  ('angebote',      '256', '287'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634',
                    '9b8341058bbfa0f7809eddc300ab0e9e'),
  ('shopfaehig',    '534', '531'),
  ('sammelbar',     '534', '531'),
  ('lagerzeilen',   '285', '306'),
  ('katalogzeilen', '626', '624')
),
soll as (
  select z.schluessel,
         case (select v.modus from vertrag v)
           when 'staging'    then z.staging
           when 'production' then z.production
         end as wert
    from z0 z
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: Abdruck der lebenden Sicherung',
      coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)'), null),
  (2, 'Umgebung', 'Stand der lebenden Funktion (Messung ohne Sollwert)',
      (select case md5(f.prosrc)
                when 'a32b148cebe00ee0d0d469f96fd2028e' then 'STAND_0140'
                when 'f6d08440707ba72a8040a8d1e666c092' then 'STAND_0136'
                when '24c3810288bb20929fe995554a267adf' then 'STAND_0131'
                when 'a27b61db988df7627a4992b1770ac626' then 'STAND_0130'
                else 'UNBEKANNT: ' || md5(f.prosrc) end
         from fn f), null),

  -- ------------------------------------------- Der Stand NACH der Migration
  (101, 'Stand', 'die Funktion ist genau einmal definiert',
      (select count(*)::text from fn), '1'),
  (102, 'Stand', 'md5 des gespeicherten Rumpfs — STAND 0140',
      coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)'),
      'a32b148cebe00ee0d0d469f96fd2028e'),
  (103, 'Stand', 'Laenge des Rumpfs in Zeichen',
      coalesce((select length(f.prosrc) from fn f), -1)::text, '21622'),
  (104, 'Stand', 'genau 28 Bereiche im Rumpf — keiner kam dazu, keiner fiel weg',
      (select count(*)::text from anfang), '28'),
  (105, 'Stand', 'Feldzeilen im Rumpf — 353 + 3 = 356',
      (select count(*)::text from paar), '356'),
  (106, 'Stand', 'der Bereich figures, Feld fuer Feld und in dieser Folge',
      coalesce((select string_agg(p.feld, '; ' order by p.nr)
                  from paar p where p.bereich = 'figures'), '(kein Bereich figures)'),
      '''sky_id'', t.sky_id; ''name'', t.name; ''slug'', t.slug; ''series_code'', t.series_code; ''card_type'', t.card_type; ''item_type'', t.item_type; ''usk_rating'', t.usk_rating; ''market_price'', t.market_price::text; ''category_id'', t.category_id; ''is_active'', t.is_active; ''source'', t.source'),
  (107, 'Stand', 'der Bereich shop_inventory, Feld fuer Feld und in dieser Folge',
      coalesce((select string_agg(p.feld, '; ' order by p.nr)
                  from paar p where p.bereich = 'shop_inventory'),
               '(kein Bereich shop_inventory)'),
      '''id'', t.id; ''sky_id'', t.sky_id; ''condition'', t.condition; ''quantity'', t.quantity; ''reserved'', t.reserved; ''available_quantity'', t.available_quantity; ''sale_price'', t.sale_price::text; ''is_listed'', t.is_listed; ''sale_released'', t.sale_released; ''delivery_scope'', t.delivery_scope; ''note'', t.note; ''created_at'', t.created_at; ''updated_at'', t.updated_at'),
  (108, 'Stand', 'die drei neuen Felder, einmal je Bereich',
      (select count(*)::text from paar p
        where (p.bereich = 'figures' and p.feld = '''usk_rating'', t.usk_rating')
           or (p.bereich = 'shop_inventory'
               and p.feld in ('''sale_released'', t.sale_released',
                              '''delivery_scope'', t.delivery_scope'))), '3'),
  (109, 'Stand', 'jede Feldzeile gehoert zu einem Bereich',
      (select count(*)::text from paar p where p.bereich = ''), '0'),
  (110, 'Stand', 'md5 des Funktionskommentars',
      coalesce((select md5(obj_description(f.oid, 'pg_proc')) from fn f),
               '(kein Kommentar)'), 'ffc66ad2060e89b7cf982c3f95012ffa'),

  -- ------------------------------------------- Die Grundlage aus 0139
  (111, 'Grundlage 0139', 'shop_inventory.sale_released steht',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), 'true'),
  (112, 'Grundlage 0139', 'shop_inventory.delivery_scope steht',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'delivery_scope'), 'true'),
  (113, 'Grundlage 0139', 'skylanders.usk_rating steht',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), 'true'),
  (114, 'Grundlage 0139', 'is_position_sellable(bigint) steht',
      (to_regprocedure('public.is_position_sellable(bigint)') is not null)::text, 'true'),

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

  -- ------------------------------------ Nichts ist freigegeben (0139 gilt)
  (201, 'Nichts offen', 'freigegebene Lagerpositionen',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (202, 'Nichts offen', 'Zeilen mit erfasster USK-Kennzeichnung',
      (select count(*)::text from public.skylanders s
        where s.usk_rating is not null), '0'),
  (203, 'Nichts offen', 'Positionen mit erfasstem Lieferumfang',
      (select count(*)::text from public.shop_inventory i
        where i.delivery_scope is not null), '0'),
  (204, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- --------------------------- Und die Zahlen, die Nutzer kennen (Z0-Vertrag)
  (301, 'Unberuehrt', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  (302, 'Unberuehrt', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (303, 'Unberuehrt', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (304, 'Unberuehrt', 'sammelbare Katalogzeilen (Fortschrittsnenner)',
      (select count(*)::text from sammelbar),
      (select wert from soll where schluessel = 'sammelbar')),
  (305, 'Unberuehrt', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (306, 'Unberuehrt', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (307, 'Unberuehrt', 'Abdruck ueber Listung, Preis und Freigabe jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-') || '|'
                                      || i.sale_released::text,
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i), null),

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

  -- ------------------------------------------------------- Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging, production oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'production', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''production'', true) fehlt'
              end from vertrag v), 'ja')
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
