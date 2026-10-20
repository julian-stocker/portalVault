-- ===========================================================================
-- STAGING — DIE 21 PORTALE WERDEN OEFFENTLICH SICHTBAR
--
-- ###########################################################################
-- ##  NICHT AUSGEFUEHRT. Braucht eine ausdrueckliche Freigabe.             ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- WAS SIE TUT, UND NUR DAS
--
-- Sie setzt auf 21 Katalogzeilen `catalog_visible = true`. EINE SPALTE, auf
-- 21 ausgeschriebenen SKY-IDs. Nichts sonst.
--
-- WAS DAS BEDEUTET, UND WAS NICHT
--
-- `catalog_visible` ist die redaktionelle Freigabe (ADR-0039) und zugleich
-- die Bedingung, unter der die Zeilenpolicy aus `0004` einem anonymen
-- Besucher die Zeile ueberhaupt zeigt. Nach diesem Lauf stehen die 21
-- Portale im oeffentlichen Zubehoerkatalog `/zubehoer`, und der zeigt dann
-- 60 statt 39 Artikel.
--
-- SIE WERDEN DADURCH NICHT SAMMELBAR. `isCollectible()` fragt den Artikeltyp
-- und den Kategorienamen — `catalog_visible` kommt darin nicht vor. Die
-- Kategorie `Portale` steht seit `0137` in `non_collectible_categories()`,
-- also bleiben die 534 sammelbaren Figuren 534. Abschnitt C beweist das.
--
-- SIE WERDEN DADURCH NICHT VERKAEUFLICH. `is_shop_eligible()` verlangt seit
-- `0135` `item_type = 'figure'`, unabhaengig von der Sichtbarkeit. Die
-- Angebotsliste bleibt Zeichen fuer Zeichen dieselbe; auch das prueft C.
--
-- WAS SIE AUSDRUECKLICH NICHT TUT
--
--   * KEINE pauschale Freigabe. Genau 21 ausgeschriebene SKY-IDs, und
--     Abschnitt A bricht ab, wenn eine davon keine Portalzeile ist. Die 30
--     redaktionell ausgeblendeten FIGUREN bleiben ausgeblendet — Abschnitt C
--     vergleicht dafuer einen Abdruck ueber alle uebrigen Zeilen.
--   * KEIN neuer Artikel, keine Kategorie, keine SKY-ID.
--   * KEIN Shop-Angebot, keine Lagerzeile, keine Lagerbewegung, kein Preis.
--   * KEINE Einkaufsposition, kein Beleg, kein Belegzaehler.
--   * Nichts an Production.
--
-- SIE IST WIEDERHOLBAR. Sie setzt nur, was noch nicht gesetzt ist, und
-- rechnet am Ende mit dem Endzustand — nicht mit der Differenz.
--
-- ERWARTETES ERGEBNIS: 21 sichtbare Portale, `sammelbar` und `angebote_md5`
-- unveraendert, und der Abdruck ueber die Sichtbarkeit ALLER anderen Zeilen
-- unveraendert.
--
-- RUECKNAHME: `supabase/rollback/R_portal_release.sql`.
-- ===========================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

create temporary table pr_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

/*
 * DIE 21, AUSGESCHRIEBEN. Das ist die gezielte Freigabe: eine Liste, keine
 * Regel. `SKY-0623` und `SKY-0631` (Disney Infinity) stehen nicht darin und
 * existieren auch nicht; `SKY-0638`-`0642` ebenso wenig.
 */
create temporary table pr_ziel (sky_id text primary key) on commit drop;
insert into pr_ziel (sky_id) values
  ('SKY-0615'), ('SKY-0616'), ('SKY-0617'), ('SKY-0618'), ('SKY-0619'),
  ('SKY-0620'), ('SKY-0621'), ('SKY-0622'), ('SKY-0624'), ('SKY-0625'),
  ('SKY-0626'), ('SKY-0627'), ('SKY-0628'), ('SKY-0629'), ('SKY-0630'),
  ('SKY-0632'), ('SKY-0633'), ('SKY-0634'), ('SKY-0635'), ('SKY-0636'),
  ('SKY-0637');


-- ---------------------------------------------------------------------------
-- A. Vorher
-- ---------------------------------------------------------------------------
do $pr_a$
declare
  v_zahl integer;
  v_text text;
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden — nur Staging.';
  end if;
  if to_regclass('pg_temp.pr_abdruck') is null or to_regclass('pg_temp.pr_ziel') is null then
    raise exception 'ABBRUCH A2: die Datei laeuft nicht in einer Transaktion.';
  end if;

  -- A3. Genau 21, und jede ist eine aktive Portalzeile.
  if (select count(*) from pr_ziel) <> 21 then
    raise exception 'ABBRUCH A3: die Liste hat % Eintraege, erwartet 21',
      (select count(*) from pr_ziel);
  end if;
  select string_agg(z.sky_id, ', ' order by z.sky_id) into v_text
    from pr_ziel z
   where not exists (select 1 from public.skylanders s
                      where s.sky_id = z.sky_id
                        and s.item_type = 'portal' and s.is_active);
  if v_text is not null then
    raise exception 'ABBRUCH A3: keine aktive Portalzeile fuer %', v_text;
  end if;

  -- A4. Die Kategorie nimmt ihnen die Sammelbarkeit — vor der Freigabe geprueft.
  select count(*) into v_zahl
    from pr_ziel z
    join public.skylanders s on s.sky_id = z.sky_id
    join public.categories c on c.id = s.category_id
   where not (c.name = any (public.non_collectible_categories()));
  if v_zahl > 0 then
    raise exception 'ABBRUCH A4: % Portal(e) stehen in einer SAMMELBAREN Kategorie — '
      'eine Freigabe wuerde sie in den Fortschritt holen. Nicht fahren.', v_zahl;
  end if;

  -- A5. Und die Shop-Eignung haengt am Artikeltyp, nicht an der Sichtbarkeit.
  select count(*) into v_zahl
    from pr_ziel z where public.is_shop_eligible(z.sky_id);
  if v_zahl > 0 then
    raise exception 'ABBRUCH A5: % Portal(e) sind shopfaehig — eine Freigabe wuerde '
      'sie in den Shop holen. Nicht fahren.', v_zahl;
  end if;

  -- A6. Die Abdruecke.
  insert into pr_abdruck (schluessel, wert) values
    ('ziel',          (select count(*)::text from pr_ziel)),
    ('schon_sichtbar',(select count(*)::text from pr_ziel z
                        join public.skylanders s on s.sky_id = z.sky_id
                       where s.catalog_visible)),
    ('katalogzeilen', (select count(*)::text from public.skylanders)),
    ('sammelbar',     (select count(*)::text from public.skylanders s
                         join public.categories c on c.id = s.category_id
                        where s.is_active and s.catalog_visible
                          and not (c.name = any (public.non_collectible_categories())))),
    ('sammelbar_je_serie',
       (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
          from (select s.series_code, count(*) as n
                  from public.skylanders s
                  join public.categories c on c.id = s.category_id
                 where s.is_active and s.catalog_visible
                   and not (c.name = any (public.non_collectible_categories()))
                 group by s.series_code) x)),
    ('shopfaehig',    (select count(*)::text from public.skylanders s
                        where public.is_shop_eligible(s.sky_id))),
    ('angebote',      (select count(*)::text from public.shop_offers())),
    ('angebote_md5',  (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                         || coalesce(o.price::text, ''),
                                         ';' order by o.sky_id, o.condition), ''))
                         from public.shop_offers() o)),
    ('sammlung',      (select count(*)::text from public.collection_items)),
    ('lagerzeilen',   (select count(*)::text from public.shop_inventory)),
    /*
     * DER ABDRUCK, DER DIE GEZIELTHEIT BEWEIST: die Sichtbarkeit JEDER
     * Zeile ausser den 21. Bewegt sich daran etwas, war die Freigabe nicht
     * gezielt — und genau das soll nicht passieren.
     */
    ('sicht_andere_md5',
       (select md5(coalesce(string_agg(s.sky_id || '=' || s.catalog_visible::text,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s
         where not exists (select 1 from pr_ziel z where z.sky_id = s.sky_id))),
    ('versteckte_figuren',
       (select count(*)::text from public.skylanders s
         where s.is_active and not s.catalog_visible and s.item_type = 'figure'));

  raise notice 'A ok: 21 Portale, davon % schon sichtbar; % sammelbar, % Angebote, '
    '% ausgeblendete Figuren.',
    (select wert from pr_abdruck where schluessel = 'schon_sichtbar'),
    (select wert from pr_abdruck where schluessel = 'sammelbar'),
    (select wert from pr_abdruck where schluessel = 'angebote'),
    (select wert from pr_abdruck where schluessel = 'versteckte_figuren');
end $pr_a$;


-- ---------------------------------------------------------------------------
-- B. Die Freigabe — eine Anweisung, eine Spalte, 21 Zeilen
--
-- `item_type = 'portal'` steht noch einmal da, obwohl A3 es geprueft hat:
-- eine Bedingung, die beides tut, kostet nichts und macht die Anweisung
-- allein lesbar.
-- ---------------------------------------------------------------------------
update public.skylanders s
   set catalog_visible = true
  from pr_ziel z
 where s.sky_id = z.sky_id
   and s.item_type = 'portal'
   and not s.catalog_visible;


-- ---------------------------------------------------------------------------
-- C. Nachher
-- ---------------------------------------------------------------------------
do $pr_c$
declare
  v_ist  text;
  v_soll text;
  v_zahl integer;
begin
  if to_regclass('pg_temp.pr_abdruck') is null then
    raise exception 'ABBRUCH C0: der Abdruck aus A ist fort.';
  end if;

  -- C1. Alle 21 sind sichtbar.
  select count(*) into v_zahl
    from pr_ziel z join public.skylanders s on s.sky_id = z.sky_id
   where s.catalog_visible;
  if v_zahl <> 21 then
    raise exception 'ABBRUCH C1: % von 21 Portalen sind sichtbar', v_zahl;
  end if;

  -- C2. UND SONST HAT SICH KEINE SICHTBARKEIT BEWEGT.
  v_soll := (select wert from pr_abdruck where schluessel = 'sicht_andere_md5');
  v_ist  := (select md5(coalesce(string_agg(s.sky_id || '=' || s.catalog_visible::text,
                                            ';' order by s.sky_id), ''))
               from public.skylanders s
              where not exists (select 1 from pr_ziel z where z.sky_id = s.sky_id));
  if v_ist <> v_soll then
    raise exception 'ABBRUCH C2: die Sichtbarkeit einer anderen Zeile hat sich geaendert '
      '(md5 % statt %) — die Freigabe war nicht gezielt.', v_ist, v_soll;
  end if;

  -- C3. Die ausgeblendeten Figuren sind unveraendert ausgeblendet.
  v_soll := (select wert from pr_abdruck where schluessel = 'versteckte_figuren');
  v_ist  := (select count(*)::text from public.skylanders s
              where s.is_active and not s.catalog_visible and s.item_type = 'figure');
  if v_ist <> v_soll then
    raise exception 'ABBRUCH C3: % ausgeblendete Figuren, vorher %', v_ist, v_soll;
  end if;

  /*
   * C4. DIE ZUSICHERUNG, AUF DIE ES ANKOMMT: sichtbar heisst nicht
   *     sammelbar und nicht verkaeuflich. Beide Zahlen muessen stehen,
   *     obwohl 21 Zeilen gerade sichtbar geworden sind.
   */
  for v_ist, v_soll in
    select a.schluessel, a.wert from pr_abdruck a
     where a.schluessel in ('katalogzeilen', 'sammelbar', 'sammelbar_je_serie',
                            'shopfaehig', 'angebote', 'angebote_md5',
                            'sammlung', 'lagerzeilen')
  loop
    if (case v_ist
          when 'katalogzeilen' then (select count(*)::text from public.skylanders)
          when 'sammelbar' then (select count(*)::text from public.skylanders s
                                   join public.categories c on c.id = s.category_id
                                  where s.is_active and s.catalog_visible
                                    and not (c.name = any (public.non_collectible_categories())))
          when 'sammelbar_je_serie' then
            (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
               from (select s.series_code, count(*) as n
                       from public.skylanders s
                       join public.categories c on c.id = s.category_id
                      where s.is_active and s.catalog_visible
                        and not (c.name = any (public.non_collectible_categories()))
                      group by s.series_code) x)
          when 'shopfaehig' then (select count(*)::text from public.skylanders s
                                   where public.is_shop_eligible(s.sky_id))
          when 'angebote' then (select count(*)::text from public.shop_offers())
          when 'angebote_md5' then (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition
                                              || '|' || coalesce(o.price::text, ''),
                                              ';' order by o.sky_id, o.condition), ''))
                                      from public.shop_offers() o)
          when 'sammlung' then (select count(*)::text from public.collection_items)
          when 'lagerzeilen' then (select count(*)::text from public.shop_inventory)
        end) is distinct from v_soll then
      raise exception 'ABBRUCH C4: % hat sich bewegt — eine Freigabe darf das nicht. '
        'Vorher "%"', v_ist, v_soll;
    end if;
  end loop;

  -- C5. Und kein Portal ist im Angebot gelandet.
  if exists (select 1 from public.shop_offers() o join pr_ziel z on z.sky_id = o.sky_id) then
    raise exception 'ABBRUCH C5: ein Portal steht im oeffentlichen Angebot';
  end if;

  raise notice 'C ok: 21 Portale sichtbar, Sichtbarkeit aller anderen Zeilen unveraendert, '
    '% sammelbar, % shopfaehig, % Angebote — alles wie vorher.',
    (select wert from pr_abdruck where schluessel = 'sammelbar'),
    (select wert from pr_abdruck where schluessel = 'shopfaehig'),
    (select wert from pr_abdruck where schluessel = 'angebote');
end $pr_c$;


-- ---------------------------------------------------------------------------
-- D. Das Ergebnisraster
-- ---------------------------------------------------------------------------
select
  a.schluessel as gegenstand,
  a.wert       as vorher,
  case a.schluessel
    when 'schon_sichtbar' then (select count(*)::text from pr_ziel z
                                  join public.skylanders s on s.sky_id = z.sky_id
                                 where s.catalog_visible)
    when 'sammelbar'      then (select count(*)::text from public.skylanders s
                                  join public.categories c on c.id = s.category_id
                                 where s.is_active and s.catalog_visible
                                   and not (c.name = any (public.non_collectible_categories())))
    when 'shopfaehig'     then (select count(*)::text from public.skylanders s
                                 where public.is_shop_eligible(s.sky_id))
    when 'angebote'       then (select count(*)::text from public.shop_offers())
    when 'katalogzeilen'  then (select count(*)::text from public.skylanders)
    when 'sammlung'       then (select count(*)::text from public.collection_items)
    when 'lagerzeilen'    then (select count(*)::text from public.shop_inventory)
    else a.wert
  end          as nachher,
  case a.schluessel
    when 'schon_sichtbar' then 'erwartet 0 → 21'
    when 'sicht_andere_md5' then 'Abdruck, in C verglichen'
    else 'muss gleich sein'
  end          as befund
from pr_abdruck a
order by a.schluessel;

commit;
