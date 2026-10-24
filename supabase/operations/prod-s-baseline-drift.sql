-- ===========================================================================
-- PRODUCTION — WOHER DIE VIER ABWEICHUNGEN KOMMEN, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- PRODUCTION-Projekts einfuegen, ausfuehren. Die Klammer und das `rollback`
-- stehen schon darin.
--
-- ANLASS. `prod-s-preflight-0142.sql` meldete am 2026-10-25 `9999 = 4`:
-- Angebote 287 → 307, Lagerzeilen 306 → 337, beide Abdruecke entsprechend
-- anders. Katalog (624), shopfaehig (531) und sammelbar (531) unveraendert.
--
-- WAS SIE BEANTWORTET. Ob die Differenz VOLLSTAENDIG erklaert ist — nicht,
-- ob sie existiert. Drei Zeilen blockieren:
--
--   101  die 306 alten Lagerzeilen stehen noch alle da
--   111  alle 287 alten Angebote sind noch Angebote
--   201  jede neue Lagerzeile hat eine Bewegung
--
-- Sind die drei gruen, ist Ware dazugekommen und nichts verschwunden. Ist
-- eine davon rot, steht dort der eigentliche Befund — und dann ist `0142`
-- nicht die Frage, die als naechste zu klaeren ist.
--
-- ZEILE 11 UND 12 ZEIGEN DIE ZEITACHSE tagweise. Daran ist zu sehen, ob die
-- Grenze (22.10.2026, 00:00 Berliner Zeit) richtig liegt.
--
-- ZEILE 900 gibt den heutigen Zustand als EINE Zeichenkette aus — der neue
-- Ausgangszustand, aber erst zu uebernehmen, wenn `9999 = 0` ist.
--
-- SIE SCHREIBT NICHTS. Ein einziges SELECT in `begin … rollback`. Keine
-- Zeile, kein Preis, keine Freigabe, kein Beleg wird angefasst — und `0142`
-- wird dabei NICHT angewendet.
--
-- EINGEBETTET: `supabase/checks/production_baseline_drift.sql`, Zeichen fuer
-- Zeichen.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den schreibenden Dateien. Ein lesender
-- Lauf im falschen Fenster richtet keinen Schaden an, liefert aber einen
-- falschen Befund — und genau darum geht es hier.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/production_baseline_drift.sql — dort sagt sie nichts ueber Production..';
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

-- >>> EINGEBETTET: supabase/checks/production_baseline_drift.sql
-- ===========================================================================
-- WOHER DIE VIER ABWEICHUNGEN KOMMEN — rein lesend
--
-- ANLASS. Der Preflight zu `0142` meldete am 2026-10-25 vier Abweichungen:
-- Angebote 287 → 307, Lagerzeilen 306 → 337, und die beiden Abdruecke
-- entsprechend anders. Katalogzeilen (624), shopfaehige (531) und sammelbare
-- (531) Zeilen waren unveraendert.
--
-- WAS DIESE DATEI BEANTWORTET. Nicht „sind die Zahlen anders" — das ist
-- bekannt. Sondern: **ist die Differenz vollstaendig erklaert?** Dafuer muss
-- eine Arithmetik aufgehen:
--
--   306 alte Lagerzeilen  +  31 neue   =  337 heute
--   287 Angebote aus alten Zeilen  +  20 aus neuen  =  307 heute
--
-- Geht sie auf, ist nichts verschwunden und nichts umgedeutet worden: es ist
-- Ware dazugekommen. Geht sie NICHT auf, steht hier der eigentliche Befund.
--
-- DIE DREI ZEILEN, DIE WIRKLICH BLOCKIEREN, sind 101, 111 und 201:
--
--   101  die 306 alten Lagerzeilen stehen noch alle da     → sonst DATENVERLUST
--   111  alle 287 alten Angebote sind noch Angebote        → sonst still
--                                                             abgemeldet
--   201  jede neue Lagerzeile hat eine Bewegung            → sonst ist eine
--                                                             Zeile ohne
--                                                             Buchung
--                                                             entstanden
--
-- Alles andere ist Auskunft. Eine Zahl, die sich bewegt, ist in einem
-- laufenden Betrieb kein Fehler — eine Zeile, die verschwindet, schon.
--
-- DIE GRENZE. Der letzte beglaubigte Ausgangszustand ist die Nachkontrolle zu
-- `0141` vom 2026-10-21 (Lager-Abdruck `01e50b9d…`, vom Betreiber
-- bestaetigt). Die Grenze unten steht deshalb auf dem **22.10.2026, 00:00
-- Berliner Zeit**. Zeile 11 und 12 zeigen die Zeilen und Bewegungen TAGWEISE
-- — stehen dort Eintraege am 21.10., ist die Grenze um einen Tag zu spaet;
-- dann in der CTE `grenze` auf `'2026-10-21 00:00'` setzen und erneut fahren.
--
-- NUR LESEN. Ein einziges SELECT. Keine Zeile wird angefasst, kein Preis,
-- keine Freigabe, kein Beleg.
--
-- ZUM EINFUEGEN IN DEN SQL-EDITOR gibt es die Huelle
-- `supabase/operations/prod-s-baseline-drift.sql`: dieselbe Pruefung, mit
-- dem Production-Riegel und `begin … rollback` darum.
--
-- ZUM SCHLUSS, ZEILE 900: der heutige Zustand als EINE Zeichenkette. Das ist
-- der neue Ausgangszustand, wenn die Pruefungen oben ihn tragen.
-- ===========================================================================

with grenze as (
  -- HIER aendern, falls Zeile 11/12 Eintraege am Grenztag zeigen.
  select '2026-10-22 00:00:00'::timestamp at time zone 'Europe/Berlin' as ab
),
lager as (
  select i.*, (i.created_at >= (select ab from grenze)) as ist_neu
    from public.shop_inventory i
),
angebot as (
  -- `shop_offers()` gibt EINE Zeile je Lagerzeile zurueck (0139): gelistet,
  -- lose, verkaeuflich, mit Preis. Die Zuordnung ist deshalb eindeutig ueber
  -- (sky_id, condition) — es gibt je Paar genau eine Lagerzeile.
  select o.sky_id, o.condition, o.price, l.ist_neu, l.id as inventory_id
    from public.shop_offers() o
    join lager l on l.sky_id = o.sky_id and l.condition = o.condition
),
bewegung as (
  select m.*, (m.created_at >= (select ab from grenze)) as ist_neu
    from public.inventory_movements m
),
sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  /* ============================================ 1. Was ist heute Stand */

  (1, 'Heute', 'Lagerzeilen',
      (select count(*)::text from lager), null),
  (2, 'Heute', 'oeffentliche Angebote',
      (select count(*)::text from angebot), null),
  (3, 'Heute', 'Katalogzeilen',
      (select count(*)::text from public.skylanders), null),
  (4, 'Heute', 'Grenze, ab der eine Zeile als NEU gilt',
      (select to_char(ab at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI')
         from grenze), null),

  /* ----------------- Die Grenze sichtbar machen, statt sie zu behaupten */
  (11, 'Zeitachse', 'Lagerzeilen je Anlagetag, letzte 21 Tage',
      coalesce((select string_agg(t.tag || ': ' || t.n, ' · ' order by t.tag)
                  from (select to_char(i.created_at at time zone 'Europe/Berlin',
                                       'YYYY-MM-DD') as tag,
                               count(*)::text as n
                          from public.shop_inventory i
                         where i.created_at > now() - interval '21 days'
                         group by 1) t), '(keine)'), null),
  (12, 'Zeitachse', 'Bewegungen je Tag und Grund, letzte 21 Tage',
      coalesce((select string_agg(t.tag || ' ' || t.reason || ': ' || t.n,
                                  ' · ' order by t.tag, t.reason)
                  from (select to_char(m.created_at at time zone 'Europe/Berlin',
                                       'YYYY-MM-DD') as tag,
                               m.reason, count(*)::text as n
                          from public.inventory_movements m
                         where m.created_at > now() - interval '21 days'
                         group by 1, 2) t), '(keine)'), null),

  /* ====================== 2. Die Arithmetik, die aufgehen MUSS */

  (101, 'Nichts fort', 'Lagerzeilen von VOR der Grenze — die 306 muessen '
        'noch alle da sein',
      (select count(*)::text from lager where not ist_neu), '306'),
  (102, 'Dazu', 'Lagerzeilen von NACH der Grenze',
      (select count(*)::text from lager where ist_neu), null),
  (103, 'Arithmetik', 'alt + neu = heute',
      (select (count(*) filter (where not ist_neu)
               + count(*) filter (where ist_neu) = count(*))::text
         from lager), 'true'),

  (111, 'Nichts fort', 'Angebote, die auf einer ALTEN Lagerzeile stehen — '
        'die 287 muessen noch alle Angebote sein',
      (select count(*)::text from angebot where not ist_neu), '287'),
  (112, 'Dazu', 'Angebote, die auf einer NEUEN Lagerzeile stehen',
      (select count(*)::text from angebot where ist_neu), null),
  (113, 'Arithmetik', 'alt + neu = heute',
      (select (count(*) filter (where not ist_neu)
               + count(*) filter (where ist_neu) = count(*))::text
         from angebot), 'true'),

  /* ============== 3. Haben die neuen Zeilen eine nachweisbare Herkunft? */

  (201, 'Herkunft', 'neue Lagerzeilen OHNE jede Bewegung — eine Zeile, die '
        'ohne Buchung entstanden ist, waere der eigentliche Befund',
      (select count(*)::text from lager l
        where l.ist_neu
          and not exists (select 1 from public.inventory_movements m
                           where m.inventory_id = l.id)), '0'),
  (202, 'Herkunft', 'Bewegungen seit der Grenze, je Grund',
      coalesce((select string_agg(t.reason || ': ' || t.n || ' (Summe '
                                  || t.summe || ')', ' · ' order by t.reason)
                  from (select m.reason, count(*)::text as n,
                               sum(m.delta)::text as summe
                          from bewegung m where m.ist_neu
                         group by 1) t), '(keine)'), null),
  (203, 'Herkunft', 'Stueck insgesamt seit der Grenze eingebucht (Summe der '
        'positiven Deltas)',
      (select coalesce(sum(m.delta), 0)::text from bewegung m
        where m.ist_neu and m.delta > 0), null),
  (204, 'Herkunft', 'neue Lagerzeilen, die an einem Einkauf haengen '
        '(ueber purchase_items.movement_id)',
      (select count(distinct l.id)::text from lager l
         join public.inventory_movements m on m.inventory_id = l.id
         join public.purchase_items pi on pi.movement_id = m.id
        where l.ist_neu), null),
  (205, 'Herkunft', 'Einkaeufe seit der Grenze (insgesamt / davon Test)',
      (select count(*)::text || ' / '
              || count(*) filter (where p.is_test)::text
         from public.purchases p
        where p.created_at >= (select ab from grenze)), null),

  /* ============ 4. Was an ALTEN Zeilen veraendert wurde (die Preisfrage) */
  /*
   * WARUM DAS NICHT AUS DEM ABDRUCK ZU HOLEN IST. `angebote_md5` ist EIN
   * md5 ueber die ganze Liste. Er sagt „etwas ist anders", niemals „dieser
   * Preis ist anders" — eine Pruefsumme laesst sich nicht aufschluesseln.
   * Was es gibt, ist `updated_at`: jede Preis- oder Listungsaenderung an
   * einer alten Zeile hat ihn bewegt. Ein Journal fuer Preise fuehrt dieses
   * Projekt NICHT (`inventory_movements` fuehrt Mengen, nicht Preise) — das
   * ist die Grenze dieser Auskunft, und sie steht hier, statt verschwiegen
   * zu werden.
   */
  (301, 'Geaendert', 'ALTE Lagerzeilen, die seit der Grenze angefasst wurden '
        '(updated_at) — das ist die Umpreis-/Umlistungsmenge',
      (select count(*)::text from lager
        where not ist_neu and updated_at >= (select ab from grenze)), null),
  (302, 'Geaendert', 'davon heute gelistet / nicht gelistet',
      (select count(*) filter (where is_listed)::text || ' / '
              || count(*) filter (where not is_listed)::text
         from lager
        where not ist_neu and updated_at >= (select ab from grenze)), null),
  (303, 'Geaendert', 'ALTE Lagerzeilen, die heute NICHT gelistet sind',
      (select count(*)::text from lager where not ist_neu and not is_listed), null),
  (304, 'Geaendert', 'ALTE Lagerzeilen ohne eigenen Preis (sale_price NULL)',
      (select count(*)::text from lager
        where not ist_neu and sale_price is null), null),

  /* ===================== 5. Was NICHT passiert sein darf */

  (401, 'Unveraendert', 'Katalogzeilen — im Preflight 624 gemessen',
      (select count(*)::text from public.skylanders), '624'),
  (402, 'Unveraendert', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)), '531'),
  (403, 'Unveraendert', 'sammelbare Katalogzeilen (Fortschrittsnenner)',
      (select count(*)::text from sammelbar), '531'),
  (404, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (405, 'Nichts offen', 'freigegebene Lagerpositionen',
      (select count(*)::text from public.shop_inventory i
        where i.sale_released), '0'),
  (406, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
  (407, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

  /* ========================= 6. Der neue Ausgangszustand */
  /*
   * EINE ZEICHENKETTE, SIEBEN WERTE, in genau der Reihenfolge des
   * Z0-Vertrags: angebote | angebote_md5 | shopfaehig | sammelbar |
   * lagerzeilen | katalogzeilen | lager_md5.
   *
   * Sie ist erst etwas wert, wenn 101, 111, 201 und 401-407 gruen sind —
   * vorher ist sie nur der aktuelle Stand und kein geprufter
   * Ausgangszustand. Deshalb steht sie unten und nicht oben.
   */
  (900, 'NEUE BASIS', 'der heutige Zustand als eine Zeile (erst uebernehmen, '
        'wenn 9999 = 0)',
      (select (select count(*)::text from public.shop_offers()) || '|'
           || (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                              || coalesce(o.price::text, ''),
                                              ';' order by o.sky_id, o.condition), ''))
                 from public.shop_offers() o) || '|'
           || (select count(*)::text from public.skylanders s
                where public.is_shop_eligible(s.sky_id)) || '|'
           || (select count(*)::text from sammelbar) || '|'
           || (select count(*)::text from public.shop_inventory) || '|'
           || (select count(*)::text from public.skylanders) || '|'
           || (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text
                                              || '|' || coalesce(i.sale_price::text, '-')
                                              || '|' || i.sale_released::text,
                                              E'\n' order by i.id)), '(leer)')
                 from public.shop_inventory i)), null)
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
-- <<< ENDE: supabase/checks/production_baseline_drift.sql

rollback;
