-- ===========================================================================
-- PRODUCTION — DIE 30 OVP-KATALOGDUPLIKATE ENTFERNEN (CAT-12, ADR-0166)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen, ausfuehren.
-- Gegenstueck fuer die andere Umgebung: `staging-ovp-removal.sql`.
--
-- VORAUSSETZUNG: `0167` ist auf dieser Umgebung angewendet.
--
-- WAS GESCHIEHT: fuer jede der 30 SKY-IDs aus `data/catalog/ovp-removal.json`
-- ein Aufruf von `system_remove_ovp_figure` (0167). Die Funktion prueft jede
-- Zeile einzeln — Identitaet, Sichtbarkeit, Varianten, JEDEN Verweis — und
-- bricht bei der ersten Abweichung ab. Dann rollt diese Datei ALLES zurueck:
-- es gibt keinen Teillauf. Eine schon entfernte SKY-ID ist ein Nichtstun;
-- ein zweiter Lauf nach einem erfolgreichen ersten aendert nichts.
--
-- WAS GEMESSEN WIRD (Abschnitt C, sonst Abbruch und Ruecknahme):
--   * keine der 30 steht mehr in `skylanders`, alle 30 haben einen Grabstein
--   * die 16 regulaeren Figuren stehen unveraendert
--   * Katalog: genau so viele Zeilen weniger, wie dieser Lauf entfernt hat
--   * Sammlungen, Favoriten, Warenkoerbe, Bestellungen, Bestellzeilen,
--     Einkauf, Verkauf, Lagerbewegungen: Zeilenzahl UND Abdruck unveraendert
--   * Lager: nur die leeren Positionen der 30 sind fort
--   * `sky_id_seq` unberuehrt
--
-- ERWARTET: NOTICE A3 (vorher), NOTICE C (nachher), `commit`.
-- Keine Storage-Datei wird angefasst.
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';

do $lauf_a$
begin
  /*
   * A1 — PRODUCTION, nachgewiesen am SCHEMA (dieselben Riegel wie
   * `prod-0165.sql`): 0133 liegt nur auf Production, die Sequenz traegt kein
   * Staging-Band, und der Staging-Stempel fehlt.
   */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     = 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: das ist Staging. Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype); auf Staging gehoert staging-ovp-removal.sql.';
  end if;
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A1a: die Triggerfunktion aus 0133 fehlt — diese Datenbank '
      'ist nicht Production.';
  end if;
  if exists (select 1 from pg_sequences where schemaname = 'public'
              and sequencename = 'sky_id_seq' and min_value = 928 and max_value = 4999) then
    raise exception 'ABBRUCH A1b: sky_id_seq traegt das STAGING-Band. Nicht Production.';
  end if;

  if to_regprocedure('public.system_remove_ovp_figure(text)') is null
     or to_regclass('public.catalog_removed_sky_ids') is null then
    raise exception 'ABBRUCH A2: 0167 ist auf dieser Umgebung nicht angewendet.';
  end if;
end
$lauf_a$;

create temporary table ovp_vorher on commit drop as
select
  (select count(*) from public.skylanders)                                   as katalog,
  (select count(*) from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591'))           as ovp,
  (select count(*) from public.collection_items)                              as sammlung,
  (select md5(coalesce(string_agg(c::text, '|' order by c::text), '')) from public.collection_items c) as sammlung_md5,
  (select count(*) from public.favorites)                                     as favoriten,
  (select count(*) from public.cart_items)                                    as warenkorb,
  (select count(*) from public.orders)                                        as bestellungen,
  (select md5(coalesce(string_agg(o::text, '|' order by o::text), '')) from public.order_lines o) as bestellzeilen_md5,
  (select count(*) from public.purchase_items)                                as einkauf,
  (select count(*) from public.sale_items)                                    as verkauf,
  (select count(*) from public.inventory_movements)                           as bewegungen,
  (select count(*) from public.shop_inventory where sky_id not in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591'))    as lager_rest,
  (select md5(coalesce(string_agg(i::text, '|' order by i.id), '')) from public.shop_inventory i
     where i.sky_id not in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591'))                                           as lager_rest_md5,
  (select md5(coalesce(string_agg(s::text, '|' order by s.sky_id), '')) from public.skylanders s
     where s.sky_id in ('SKY-0011', 'SKY-0017', 'SKY-0022', 'SKY-0030', 'SKY-0035', 'SKY-0040', 'SKY-0049', 'SKY-0056', 'SKY-0060', 'SKY-0066', 'SKY-0071', 'SKY-0075', 'SKY-0083', 'SKY-0089', 'SKY-0563', 'SKY-0590'))                                          as regulaer_md5,
  (select last_value::text || '|' || is_called::text from public.sky_id_seq)  as sequenz;

do $lauf_a3$
begin
  raise notice 'A3: % Katalogzeilen, davon % der 30 OVP-Duplikate; Sequenz %.',
    (select katalog from ovp_vorher), (select ovp from ovp_vorher),
    (select sequenz from ovp_vorher);
end
$lauf_a3$;

-- B — die 30, einzeln, in fester Reihenfolge.
do $lauf_b$
declare
  v_id  text;
  v_erg jsonb;
begin
  foreach v_id in array array['SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591'] loop
    v_erg := public.system_remove_ovp_figure(v_id);
    raise notice 'B: %', v_erg;
  end loop;
end
$lauf_b$;

-- C — was danach stehen MUSS. Jede Abweichung rollt den ganzen Lauf zurueck.
do $lauf_c$
declare
  v ovp_vorher%rowtype;
  n bigint;
begin
  select * into v from ovp_vorher;

  select count(*) into n from public.skylanders where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591');
  if n <> 0 then raise exception 'ABBRUCH C1: % der 30 stehen noch im Katalog.', n; end if;
  select count(*) into n from public.catalog_removed_sky_ids where sky_id in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591');
  if n <> 30 then raise exception 'ABBRUCH C2: % statt 30 Grabsteine.', n; end if;
  if (select count(*) from public.skylanders) <> v.katalog - v.ovp then
    raise exception 'ABBRUCH C3: der Katalog hat sich um mehr als die % OVP-Zeilen bewegt.', v.ovp;
  end if;
  if (select md5(coalesce(string_agg(s::text, '|' order by s.sky_id), '')) from public.skylanders s
       where s.sky_id in ('SKY-0011', 'SKY-0017', 'SKY-0022', 'SKY-0030', 'SKY-0035', 'SKY-0040', 'SKY-0049', 'SKY-0056', 'SKY-0060', 'SKY-0066', 'SKY-0071', 'SKY-0075', 'SKY-0083', 'SKY-0089', 'SKY-0563', 'SKY-0590')) is distinct from v.regulaer_md5 then
    raise exception 'ABBRUCH C4: eine regulaere Figur hat sich veraendert.';
  end if;
  if (select count(*) from public.collection_items) <> v.sammlung
     or (select md5(coalesce(string_agg(c::text, '|' order by c::text), '')) from public.collection_items c)
        is distinct from v.sammlung_md5 then
    raise exception 'ABBRUCH C5: Sammlungen haben sich veraendert.';
  end if;
  if (select count(*) from public.favorites) <> v.favoriten
     or (select count(*) from public.cart_items) <> v.warenkorb then
    raise exception 'ABBRUCH C6: Favoriten oder Warenkoerbe haben sich veraendert.';
  end if;
  if (select count(*) from public.orders) <> v.bestellungen
     or (select md5(coalesce(string_agg(o::text, '|' order by o::text), '')) from public.order_lines o)
        is distinct from v.bestellzeilen_md5 then
    raise exception 'ABBRUCH C7: Bestellungen haben sich veraendert.';
  end if;
  if (select count(*) from public.purchase_items) <> v.einkauf
     or (select count(*) from public.sale_items) <> v.verkauf
     or (select count(*) from public.inventory_movements) <> v.bewegungen then
    raise exception 'ABBRUCH C8: Einkauf, Verkauf oder Lagerbewegungen haben sich veraendert.';
  end if;
  if (select count(*) from public.shop_inventory where sky_id not in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')) <> v.lager_rest
     or (select md5(coalesce(string_agg(i::text, '|' order by i.id), '')) from public.shop_inventory i
          where i.sky_id not in ('SKY-0012', 'SKY-0013', 'SKY-0018', 'SKY-0019', 'SKY-0023', 'SKY-0024', 'SKY-0031', 'SKY-0032', 'SKY-0036', 'SKY-0037', 'SKY-0041', 'SKY-0042', 'SKY-0050', 'SKY-0051', 'SKY-0057', 'SKY-0058', 'SKY-0061', 'SKY-0062', 'SKY-0067', 'SKY-0068', 'SKY-0072', 'SKY-0073', 'SKY-0076', 'SKY-0077', 'SKY-0084', 'SKY-0085', 'SKY-0090', 'SKY-0091', 'SKY-0564', 'SKY-0591')) is distinct from v.lager_rest_md5 then
    raise exception 'ABBRUCH C9: Lagerpositionen ausserhalb der 30 haben sich veraendert.';
  end if;
  if (select last_value::text || '|' || is_called::text from public.sky_id_seq) <> v.sequenz then
    raise exception 'ABBRUCH C10: sky_id_seq hat sich bewegt.';
  end if;

  raise notice 'C ok: 30 entfernt (davon % in diesem Lauf), 30 Grabsteine, Katalog % -> %, '
    'regulaere Figuren, Sammlungen, Favoriten, Warenkoerbe, Bestellungen, Einkauf, Verkauf, '
    'Lagerbewegungen und uebriges Lager unveraendert, Sequenz %.',
    v.ovp, v.katalog, v.katalog - v.ovp, v.sequenz;
end
$lauf_c$;

commit;
