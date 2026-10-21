-- ===========================================================================
-- PRODUCTION — DIE NACHKONTROLLE ZU 0139, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- NACH `prod-0139.sql` fahren. Der SQL-Editor zeigt `NOTICE`-Meldungen nicht
-- an; „Success" allein ist kein sichtbarer Befund.
--
-- DIE EINE AUSSAGE, DIE ZAEHLT: ES IST NICHTS KAUFBAR GEWORDEN.
--
-- `0139` baut ein Tor und oeffnet es nicht. Alles andere hier stuetzt diesen
-- Satz:
--
--   201  freigegebene Lagerpositionen                        **0**
--   202  Zeilen mit erfasster USK-Kennzeichnung              **0**
--   203  Zubehoerzeilen im oeffentlichen Angebot             **0**
--   204  Zubehoerpositionen, die das neue Tor durchliesse    **0**
--   205  die Altlast ist unveraendert gelistet und unverkaeuflich
--
-- UND DIE FIGUREN BLEIBEN, WIE SIE WAREN — blockierend im Modus
-- `production`:
--
--   301  oeffentliche Angebote                               **287**
--   302  Abdruck der Angebotsliste    **9b8341058bbfa0f7809eddc300ab0e9e**
--   303  shopfaehige Katalogzeilen — `is_shop_eligible` unberuehrt  **531**
--   304  Positionen, die am NEUEN Tor anders antworten als am alten  **0**
--   501  sammelbare Katalogzeilen (Fortschrittsnenner)       **531**
--   502  Lagerzeilen                                         **306**
--   503  Katalogzeilen                                       **624**
--   504  Abdruck ueber Listung und Preis jeder Lagerzeile — gegen
--        Preflight 408 halten
--   505  Sammlungseintraege auf Zubehoer                      **0**
--
-- DIE VIER TUEREN FRAGEN JETZT EIN TOR, UND NUR EINES
--
--   401  Tueren, die `is_position_sellable` fragen           **4**
--   402  Tueren, die `is_shop_eligible` noch direkt fragen   **0**
--   403  die Betriebsdiagnose kennt den Grund „not released for sale"
--   404  und den Grund „usk rating missing"
--
-- UND DIE RIEGEL
--
--   601  `is_position_sellable` ist fuer anon und authenticated ausfuehrbar
--        — das muss sie sein, sonst antwortet der Shop nicht mehr
--   602  `seller_set_sale_release` ist fuer anon NICHT ausfuehrbar
--   603  `admin_set_usk_rating` ist fuer anon NICHT ausfuehrbar
--   604  die Belegsperre haelt unveraendert
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Zeilen mit `ok = NULL` sind
-- Messungen ohne Sollwert — hier 504 und die Infozeilen.
--
-- EINGEBETTET: `supabase/checks/0139_postflight.sql`, Zeichen fuer Zeichen —
-- geprueft von `src/lib/catalog/staging-oneshot.test.ts`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den sieben schreibenden Dateien. Ein
-- lesender Lauf in der falschen Datenbank richtet keinen Schaden an, aber er
-- liefert einen FALSCHEN BEFUND — die Panne vom 2026-10-20.
--
-- A1 verlangt das VOLLSTAENDIGE Staging-Markerpaar: Production traegt
-- `SKY-0821` rechtmaessig, erst `SKY-0821` UND `SKY-0822` bedeuten Staging.
-- Zeile 1 der eingebetteten Pruefung sagt dasselbe noch einmal als
-- Messung — im Modus `production` erwartet sie `false`.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-s3-postflight-0139.sql mit dem Modus staging.';
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

-- ---------------------------------------------------------------------------
-- DER Z0-MODUS: `production`, NICHT `keine`
--
-- Das ist der Unterschied zu den Nachkontrollen von 0136, 0137 und 0138.
-- Dort gab es keine Production-Bezugszahlen, und der Verzicht war
-- ausdruecklich. Hier GIBT es sie — gemessen, nicht geraten —, und damit
-- werden aus sechs Messungen sechs BLOCKIERENDE Erwartungen: Angebote,
-- Angebotsabdruck, shopfaehige Zeilen, sammelbare Zeilen, Lagerzeilen,
-- Katalogzeilen. Genau die Zahlen, die sich bei `0139` nicht bewegen duerfen.
--
-- Er gilt transaktionslokal und ist mit dem `rollback` unten fort.
-- ---------------------------------------------------------------------------
select set_config('skyisles.z0', 'production', true);

-- >>> EINGEBETTET: supabase/checks/0139_postflight.sql
-- ===========================================================================
-- 0139 POSTFLIGHT — der Zustand danach, rein lesend
--
-- Nach `0139_accessory_sale_release.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- DIE EINE AUSSAGE, DIE ZAEHLT: es ist nichts kaufbar geworden. Die Migration
-- baut ein Tor, sie oeffnet es nicht. Alles andere hier stuetzt diese Aussage.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0139_postflight.sql
--   rollback;
--
-- NUR LESEN. NICHT in `staging-suite.json` — manueller Lauf.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, staging, production) as (values
  /*
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — UND KEINE DRITTE WAHRHEIT.
   *
   * Links der Z0-Vertrag von Staging (Stand 2026-10-20), rechts der
   * gemessene Production-Stand nach `0138` (2026-10-21):
   *
   *   angebote/md5   287 und `9b834105…` — vom Betreiber im Postflight zu
   *                  `0137` und `0138` bestaetigt, beide Male gleich
   *   shopfaehig     531 — lesend gemessen (`verify:shop:prod`)
   *   sammelbar      531 — der Fortschrittsnenner, vom Betreiber bestaetigt
   *   lagerzeilen    306 — lesend gemessen
   *   katalogzeilen  624 — vom Betreiber nach `0138` bestaetigt (603 + 21)
   *
   * WARUM DIE WERTE IM CODE STEHEN: ein Sollwert, den der Bediener bei jedem
   * Lauf mittippt, ist bei jedem Lauf eine neue Gelegenheit fuer einen
   * Tippfehler — und ein Tippfehler in der ERWARTUNG laesst die Pruefung
   * bestehen. Gewaehlt wird nur die Umgebung.
   *
   * WARUM SIE UMGEBUNGSWEISE GETRENNT SIND: eine umgebungsblinde Erwartung
   * war in diesem Projekt schon zweimal die Ursache eines falschen Befundes.
   * Im Modus `keine` gilt keine der beiden Spalten, und die Zeilen sind
   * Messungen ohne Bewertung — das ist der ausdrueckliche Verzicht.
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
zubehoer as (
  select i.*, s.item_type, s.usk_rating
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where s.item_type <> 'figure'
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- -------------------------------------------- 1. Die neuen Bauteile stehen
  (101, 'Neu', 'shop_inventory.sale_released steht, not null, Vorgabe false',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released' and is_nullable = 'NO'
          and column_default like '%false%'), 'true'),
  (102, 'Neu', 'skylanders.usk_rating steht und ist nullable',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating' and is_nullable = 'YES'), 'true'),
  (103, 'Neu', 'der CHECK auf usk_rating steht',
      (select (count(*) = 1)::text from pg_constraint
        where conname = 'skylanders_usk_rating_known'), 'true'),
  (104, 'Neu', 'is_position_sellable(bigint) steht',
      (to_regprocedure('public.is_position_sellable(bigint)') is not null)::text, 'true'),
  (105, 'Neu', 'seller_set_sale_release(text,text,boolean) steht',
      (to_regprocedure('public.seller_set_sale_release(text, text, boolean)')
         is not null)::text, 'true'),
  (106, 'Neu', 'admin_set_usk_rating(text,smallint) steht',
      (to_regprocedure('public.admin_set_usk_rating(text, smallint)') is not null)::text,
      'true'),

  -- ------------------------------- 2. ES IST NICHTS KAUFBAR GEWORDEN
  (201, 'Nichts offen', 'freigegebene Lagerpositionen',
      (select count(*)::text from public.shop_inventory where sale_released), '0'),
  (202, 'Nichts offen', 'Zeilen mit erfasster USK-Kennzeichnung',
      (select count(*)::text from public.skylanders where usk_rating is not null), '0'),
  (203, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (204, 'Nichts offen', 'Zubehoerpositionen, die das neue Tor durchliesse',
      (select count(*)::text from zubehoer z
        where public.is_position_sellable(z.id)), '0'),
  (205, 'Nichts offen', 'die Altlast ist unveraendert gelistet (und unverkaeuflich)',
      (select count(*)::text from zubehoer where is_listed), null),

  -- ------------------------------ 3. Fuer Figuren hat sich nichts geaendert
  (301, 'Figuren', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  /* Die Z0-Formel aus `0135_preflight.sql`, Zeile 913: drei Felder, Trenner
     `;`, OHNE `available`. Ein Abdruck, der die Verfuegbarkeit mitnaehme,
     aenderte sich bei jedem Verkauf. */
  (302, 'Figuren', 'Abdruck ueber die Angebotsliste — Zeichen fuer Zeichen',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (303, 'Figuren', 'shopfaehige Katalogzeilen — is_shop_eligible ist unberuehrt',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (304, 'Figuren', 'Positionen, die am NEUEN Tor anders antworten als am alten',
      (select count(*)::text from public.shop_inventory i
        where public.is_position_sellable(i.id)
              is distinct from public.is_shop_eligible(i.sky_id)), '0'),

  -- ---------------------- 4. Die vier Tueren fragen das neue Tor, und nur es
  (401, 'Tueren', 'Tueren, die is_position_sellable fragen (muss 4 sein)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.shop_offers()'),
                        to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                        to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                        to_regprocedure('public.reserve_for_order(bigint)'))
          and position('is_position_sellable' in p.prosrc) > 0), '4'),
  (402, 'Tueren', 'Tueren, die is_shop_eligible noch direkt fragen (muss 0 sein)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.shop_offers()'),
                        to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                        to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                        to_regprocedure('public.reserve_for_order(bigint)'))
          and position('is_shop_eligible' in p.prosrc) > 0), '0'),
  (403, 'Tueren', 'die Betriebsdiagnose kennt den Grund "not released for sale"',
      (select (position('not released for sale' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_shop_listing_audit()')), 'true'),
  (404, 'Tueren', 'und den Grund "usk rating missing"',
      (select (position('usk rating missing' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_shop_listing_audit()')), 'true'),

  -- --------------------------- 5. Sammlung, Katalog und Lager unberuehrt
  /*
   * DIE Z0-DEFINITION, ZEICHEN FUER ZEICHEN AUS `0135_preflight.sql`
   * (Zeilen 16-21) — EINSCHLIESSLICH `s.catalog_visible`.
   *
   * Eine frueher hier stehende Fassung liess die Sichtbarkeit weg und zaehlte
   * damit die 30 redaktionell ausgeblendeten Figuren mit: 564 statt 534. Das
   * war der einzige Befund von S1 und S3 am 2026-10-20, und er lag an DIESER
   * Zeile, nicht an den Daten.
   *
   * Die Sichtbarkeit gehoert dazu, weil der Fortschritts-Nenner zaehlt, was
   * der oeffentliche Katalog HEUTE anbietet: `collectionStats()` zaehlt
   * `entry.figure.isActive && entry.figure.catalogVisible`, und die
   * Nennerabfrage in `fetchCatalog()` filtert auf beides. Eine ausgeblendete
   * Figur ist in keiner Haelfte — und genau das macht „besessen > gesamt"
   * unmoeglich (ADR-0040).
   */
  (501, 'Unberuehrt', 'sammelbare Katalogzeilen',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))),
      (select wert from soll where schluessel = 'sammelbar')),
  (502, 'Unberuehrt', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (503, 'Unberuehrt', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (504, 'Unberuehrt', 'Abdruck ueber Listung und Preis jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-'),
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i), null),
  (505, 'Unberuehrt', 'Sammlungseintraege auf Zubehoer',
      (select count(*)::text from public.collection_items ci
         join public.skylanders s on s.sky_id = ci.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------- 6. Rechte und Belegsperre
  (601, 'Rechte', 'is_position_sellable ist fuer anon und authenticated ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'is_position_sellable'
          and g.grantee in ('anon', 'authenticated')), '2'),
  (602, 'Rechte', 'seller_set_sale_release ist fuer anon NICHT ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'seller_set_sale_release'
          and g.grantee = 'anon'), '0'),
  (603, 'Rechte', 'admin_set_usk_rating ist fuer anon NICHT ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'admin_set_usk_rating'
          and g.grantee = 'anon'), '0'),
  (604, 'Belege', 'die Belegsperre haelt unveraendert',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),

  -- ------------------------------------------------------ Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging, production oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'production', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''staging'', true) fehlt'
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
-- <<< ENDE: supabase/checks/0139_postflight.sql

rollback;
