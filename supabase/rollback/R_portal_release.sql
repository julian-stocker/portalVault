-- ===========================================================================
-- RUECKNAHME DER PORTALFREIGABE — die 21 werden wieder unsichtbar
--
-- Setzt auf denselben 21 SKY-IDs `catalog_visible = false`. Eine Spalte.
-- Danach zeigt `/zubehoer` wieder 39 Artikel, und die Zeilenpolicy aus
-- `0004` haelt die 21 vor anonymen Besuchern wieder zurueck.
--
-- Sie trifft nur Zeilen, die `item_type = 'portal'` tragen — eine Figur
-- wird von dieser Datei nie ausgeblendet. Abschnitt A bricht ab, wenn die
-- Zahl nicht stimmt.
--
-- AUSFUEHRUNG: vollstaendig in `begin` / `commit` geklammert.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

create temporary table rpr_ziel (sky_id text primary key) on commit drop;
insert into rpr_ziel (sky_id) values
  ('SKY-0615'), ('SKY-0616'), ('SKY-0617'), ('SKY-0618'), ('SKY-0619'),
  ('SKY-0620'), ('SKY-0621'), ('SKY-0622'), ('SKY-0624'), ('SKY-0625'),
  ('SKY-0626'), ('SKY-0627'), ('SKY-0628'), ('SKY-0629'), ('SKY-0630'),
  ('SKY-0632'), ('SKY-0633'), ('SKY-0634'), ('SKY-0635'), ('SKY-0636'),
  ('SKY-0637');

do $rpr_a$
declare v_zahl integer;
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden — nur Staging.';
  end if;
  if to_regclass('pg_temp.rpr_ziel') is null then
    raise exception 'ABBRUCH A2: die Datei laeuft nicht in einer Transaktion.';
  end if;
  select count(*) into v_zahl
    from rpr_ziel z join public.skylanders s on s.sky_id = z.sky_id
   where s.item_type = 'portal';
  if v_zahl <> 21 then
    raise exception 'ABBRUCH A3: % von 21 sind Portalzeilen', v_zahl;
  end if;
end $rpr_a$;

update public.skylanders s
   set catalog_visible = false
  from rpr_ziel z
 where s.sky_id = z.sky_id
   and s.item_type = 'portal'
   and s.catalog_visible;

do $rpr_c$
declare v_zahl integer;
begin
  select count(*) into v_zahl
    from rpr_ziel z join public.skylanders s on s.sky_id = z.sky_id
   where s.catalog_visible;
  if v_zahl <> 0 then
    raise exception 'ABBRUCH C1: % Portal(e) sind noch sichtbar', v_zahl;
  end if;
  raise notice 'C ok: 21 Portale wieder unsichtbar.';
end $rpr_c$;

commit;
