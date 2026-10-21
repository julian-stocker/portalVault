-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0141, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- VOR `prod-0141.sql` fahren. `0141` legt EINE neue Lesefunktion an und
-- sonst nichts.
--
-- ERFOLGSKRITERIEN — Zeile `9999` muss `0` zeigen
--
--   101-106  die Grundlagen aus `0139`/`0041`: drei Spalten,
--            `is_position_sellable`, `admin_shop_listing_audit`,
--            `can_operate_active_seller`
--   107      die Betriebssicherung steht auf Stand `0140`:
--            **a32b148cebe00ee0d0d469f96fd2028e**
--   108      `admin_shop_inventory` ist der Stand aus `0041`:
--            **857b767d4ad5ea9bfc2e333fd6605b1f**
--   109      `admin_shop_listing_audit` ist der Stand aus `0139`:
--            **f36137c40155375b92bae76b5dd63740**
--   110      `seller_sale_state()` **fehlt noch** — daran faellt ein
--            zweiter Lauf auf
--   201-205  **nichts freigegeben**: 0 Freigaben, 0 USK, 0 Lieferumfaenge,
--            0 Zubehoerangebote, und 0 Zubehoerpositionen, die das Tor
--            durchliesse
--   301-307  **287** Angebote · Abdruck **9b8341058bbfa0f7809eddc300ab0e9e**
--            · **531** shopfaehig · **531** sammelbar · **306** Lagerzeilen
--            · **624** Katalogzeilen · Lagerabdruck
--            **01e50b9d727a0486ff1ea0eb6ba2dd56**
--   401-402  die Belegsperre
--
-- WENN ZEILE 108 ODER 109 ABWEICHT, ist das ein BEFUND und kein Grund,
-- weiterzumachen: dann steht in der Datenbank ein anderer Funktionsrumpf als
-- in diesem Repository, und die Frage „ist `0141` additiv?" waere danach
-- nicht mehr beantwortbar. Beide Werte sind aus den Migrationen gerechnet
-- und von Probelauf **P47** an echtem PostgreSQL nachgefahren.
--
-- WENN ZEILE 307 ABWEICHT: der Abdruck aendert sich bei jeder Lageraenderung
-- — ein neuer Preis, eine Listung, ein Verkauf. Das ist dann eine Auskunft
-- ueber den Betrieb und kein Fehler. Dann bitte den NEUEN Wert notieren und
-- Preflight gegen Postflight vergleichen statt gegen diese Konstante.
--
-- EINGEBETTET: `supabase/checks/0141_preflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den sieben schreibenden Dateien.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/0141_preflight.sql mit dem Modus staging.';
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

-- DER Z0-MODUS: `production`. Die Bezugszahlen sind gemessen, also
-- BLOCKIEREND. Transaktionslokal, mit dem `rollback` unten fort.
select set_config('skyisles.z0', 'production', true);

-- >>> EINGEBETTET: supabase/checks/0141_preflight.sql
-- ===========================================================================
-- 0141 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0141` legt EINE neue Lesefunktion an: `seller_sale_state()`. Rein additiv
-- — keine Spalte, keine Zeile, kein bestehender Rumpf, kein bestehendes
-- Recht. Diese Datei haelt fest, dass die Voraussetzungen stehen, dass die
-- Funktion NOCH NICHT da ist, dass nichts freigegeben ist, und mit welchen
-- Zahlen der Betrieb in den Lauf geht.
--
-- DER MODUS WAEHLT DIE UMGEBUNG, nicht die Zahlen: `staging`, `production`
-- oder `keine`. Ohne Modus ist Zeile 902 blockierend.
--
--   select set_config('skyisles.z0', 'production', true);
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ===========================================================================

/*
 * KEIN `fn`-CTE UND KEIN `proconfig` IN DIESER DATEI.
 *
 * Der Preflight fragt nur, OB `seller_sale_state()` schon da ist — das
 * beantwortet `to_regprocedure`. Form, Rechte und `search_path` prueft der
 * Postflight, wenn es etwas zu pruefen gibt.
 *
 * Und `proconfig` steht hier deshalb nirgends: wer die Spalte liest, muss
 * den Wert AUSPACKEN statt ihn zu vergleichen (PostgreSQL quotiert ihn,
 * `search_path="$user", public` gegen `search_path=` ist ein Fehlalarm).
 * `src/lib/admin/migration-integrity.test.ts` haelt diese Regel fuer jede
 * Datei fest, die `proconfig` nennt — eine ungenutzte Spalte in einem CTE
 * waere eine Einladung, sie spaeter falsch zu vergleichen.
 */
with rumpf (name, md5) as (
  select p.proname, md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_business_backup', 'admin_shop_inventory',
                       'admin_shop_listing_audit')
),
sammelbar as (
  select s.sky_id
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
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — wie in den Pruefdateien zu `0139` und
   * `0140`. Rechts der gemessene Production-Stand nach `0140` (2026-10-21,
   * vom Betreiber im Postflight bestaetigt).
   *
   * `lager_md5` hat KEINEN Staging-Wert: dieser Abdruck (Listung, Preis und
   * Freigabe je Lagerzeile) ist erst mit den `0140`-Pruefdateien entstanden
   * und auf Staging nie erhoben worden. `null` heisst hier „fuer diese
   * Umgebung nicht festgehalten" — die Zeile wird dann gemessen und nicht
   * bewertet. Eine erfundene Zahl waere schlimmer als keine.
   */
  ('angebote',      '256', '287'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634',
                    '9b8341058bbfa0f7809eddc300ab0e9e'),
  ('shopfaehig',    '534', '531'),
  ('sammelbar',     '534', '531'),
  ('lagerzeilen',   '285', '306'),
  ('katalogzeilen', '626', '624'),
  ('lager_md5',     null,  '01e50b9d727a0486ff1ea0eb6ba2dd56')
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

  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),
  (2, 'Umgebung', 'Info: Abdruecke der drei beruehrten Nachbarfunktionen',
      coalesce((select string_agg(name || '=' || left(md5, 8), ', ' order by name)
                  from rumpf), '(keine)'), null),

  -- ------------------------------------------- Die Grundlage aus 0139-0140
  (101, 'Grundlage', 'shop_inventory.sale_released steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), 'true'),
  (102, 'Grundlage', 'shop_inventory.delivery_scope steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'delivery_scope'), 'true'),
  (103, 'Grundlage', 'skylanders.usk_rating steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), 'true'),
  (104, 'Grundlage', 'is_position_sellable(bigint) steht (0139)',
      (to_regprocedure('public.is_position_sellable(bigint)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_shop_listing_audit() steht (0008/0041/0139)',
      (to_regprocedure('public.admin_shop_listing_audit()') is not null)::text, 'true'),
  (106, 'Grundlage', 'can_operate_active_seller() steht (0041)',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (107, 'Grundlage', 'die Betriebssicherung steht auf Stand 0140',
      coalesce((select md5 from rumpf where name = 'seller_business_backup'),
               '(keine Funktion)'), 'a32b148cebe00ee0d0d469f96fd2028e'),

  (108, 'Grundlage', 'admin_shop_inventory ist der Stand aus 0041',
      coalesce((select md5 from rumpf where name = 'admin_shop_inventory'),
               '(keine Funktion)'), '857b767d4ad5ea9bfc2e333fd6605b1f'),
  (109, 'Grundlage', 'admin_shop_listing_audit ist der Stand aus 0139',
      coalesce((select md5 from rumpf where name = 'admin_shop_listing_audit'),
               '(keine Funktion)'), 'f36137c40155375b92bae76b5dd63740'),

  -- ---------------------------------------------- Und 0141 ist noch nicht da
  (110, 'Neu', 'seller_sale_state() fehlt NOCH — sonst liefe 0141 zweimal',
      (to_regprocedure('public.seller_sale_state()') is null)::text, 'true'),

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
  (205, 'Nichts offen', 'Positionen, die das Tor durchliesse, obwohl der Artikel '
        'kein figure ist',
      (select count(*)::text from public.shop_inventory i
         join public.skylanders s on s.sky_id = i.sky_id
        where s.item_type <> 'figure' and public.is_position_sellable(i.id)), '0'),

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
         from public.shop_inventory i),
      (select wert from soll where schluessel = 'lager_md5')),

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
-- <<< ENDE: supabase/checks/0141_preflight.sql

rollback;
