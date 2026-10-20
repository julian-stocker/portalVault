-- ===========================================================================
-- RUECKNAHME DER PORTALZUORDNUNG — die 35 Positionen werden wieder Freitext
--
-- WAS SIE TUT. Sie setzt auf genau den Positionen, die
-- `supabase/operations/staging-portal-assignment.sql` zugeordnet hat, die
-- `sky_id` wieder auf NULL. Eine Spalte, plus `updated_at`.
--
-- WARUM DAS GEFAHRLOS IST. Die Zuordnung hat nichts anderes angefasst: der
-- Rohname steht noch da — er ist der Herkunftsnachweis und wurde nie
-- beruehrt —, der Zustand ist unveraendert `reconciled_legacy`, es gibt
-- keine Lagerbewegung, und es ist keine entstanden. Nach dieser Datei ist
-- der Stand wieder der vom 2026-10-20: 206 Freitextpositionen, 0 davon auf
-- Portalen.
--
-- `seller_set_purchase_item_sky(id, null)` waere der gebaute Weg und tut
-- dasselbe — aus dem SQL-Editor ist er nicht erreichbar
-- (`can_operate_active_seller()` braucht ein `auth.uid()`). Diese Datei
-- bildet ihn nach und uebernimmt seine Bedingungen.
--
-- WELCHE POSITIONEN SIE TRIFFT, UND KEINE ANDERE
--
-- Nur solche, bei denen ALLE fuenf Dinge zutreffen:
--
--   1. die `sky_id` ist einer der elf Portalartikel,
--   2. der `raw_name` ist GENAU der Name dieses Artikels — also die
--      Zuordnung, die das Skript gemacht hat, und keine andere,
--   3. der Zustand ist `reconciled_legacy`,
--   4. es gibt keine Lagerbewegung,
--   5. `source_row` ist gesetzt — es ist eine Arbeitsmappenzeile.
--
-- Eine Position, die spaeter von Hand oder ueber das Einkaufsbuch auf ein
-- Portal gesetzt wird, traegt nicht denselben Rohnamen (ein neu erfasster
-- Einkauf schreibt keinen) und wird deshalb NICHT mitgerissen. Abschnitt A
-- bricht trotzdem ab, wenn die Zahl nicht stimmt.
--
-- WAS SIE NICHT TUT. Keinen Bestand, keine Bewegung, keinen Preis, keine
-- Menge, keinen Rohnamen, keinen Zustand, keinen Beleg. Und nichts an
-- Production.
--
-- AUSFUEHRUNG: vollstaendig in `begin` / `commit` geklammert.
-- ===========================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

create temporary table rpa_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

/* Dieselben elf Paare wie im Skript. Zeichengleich — wer hier etwas aendert,
   nimmt etwas anderes zurueck als zugeordnet wurde. */
create temporary table rpa_zuordnung (
  sky_id   text primary key,
  raw_name text not null unique,
  erwartet integer not null
) on commit drop;

insert into rpa_zuordnung (sky_id, raw_name, erwartet) values
  ('SKY-0615', '84157790 (SA)',            1),
  ('SKY-0616', '83973080 (SA)',            2),
  ('SKY-0617', '83973080A Wireless (SA)',  5),
  ('SKY-0618', '0000502 (G)',              7),
  ('SKY-0619', '0000547 (SF)',            11),
  ('SKY-0620', '0000586 (T)',              2),
  ('SKY-0621', '0000655 (SC)',             3),
  ('SKY-0622', '0000726 (I)',              1),
  ('SKY-0624', '84151790 (SA)',            1),
  ('SKY-0627', '84704790 (SF)',            1),
  ('SKY-0637', '84721790 (SF, T, SC)',     1);

create temporary table rpa_ziel (id bigint primary key) on commit drop;


-- ---------------------------------------------------------------------------
-- A. Vorher
-- ---------------------------------------------------------------------------
do $rpa_a$
declare
  v_zahl integer;
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden — nur Staging.';
  end if;
  if to_regclass('pg_temp.rpa_abdruck') is null then
    raise exception 'ABBRUCH A2: die Datei laeuft nicht in einer Transaktion.';
  end if;

  insert into rpa_ziel (id)
  select pi.id
    from public.purchase_items pi
    join rpa_zuordnung z on z.sky_id = pi.sky_id and z.raw_name = pi.raw_name
   where pi.state = 'reconciled_legacy'
     and pi.movement_id is null
     and pi.source_row is not null;

  select count(*) into v_zahl from rpa_ziel;
  if v_zahl <> (select sum(erwartet) from rpa_zuordnung) then
    raise exception 'ABBRUCH A3: % zurueckzunehmende Positionen gefunden, erwartet % — '
      'erst klaeren, nichts zuruecknehmen.',
      v_zahl, (select sum(erwartet) from rpa_zuordnung);
  end if;

  insert into rpa_abdruck (schluessel, wert) values
    ('ziel',         (select count(*)::text from rpa_ziel)),
    ('ohne_sky_id',  (select count(*)::text from public.purchase_items where sky_id is null)),
    ('auf_portalen', (select count(*)::text from public.purchase_items pi
                       join public.skylanders s on s.sky_id = pi.sky_id
                      where s.item_type = 'portal')),
    ('positionen',   (select count(*)::text from public.purchase_items)),
    ('lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('bewegungen',   (select count(*)::text from public.inventory_movements)),
    ('felder_md5',
       (select md5(coalesce(string_agg(pi.id::text || '|' || coalesce(pi.raw_name, '') || '|'
                                       || pi.state || '|' || pi.condition,
                                       ';' order by pi.id), ''))
          from public.purchase_items pi join rpa_ziel t on t.id = pi.id));

  raise notice 'A ok: % Positionen werden wieder Freitext.',
    (select wert from rpa_abdruck where schluessel = 'ziel');
end $rpa_a$;


-- ---------------------------------------------------------------------------
-- B. Die Ruecknahme — eine Anweisung, eine Spalte
-- ---------------------------------------------------------------------------
update public.purchase_items pi
   set sky_id     = null,
       updated_at = now()
  from rpa_ziel t
 where pi.id = t.id
   and pi.movement_id is null;


-- ---------------------------------------------------------------------------
-- C. Nachher
-- ---------------------------------------------------------------------------
do $rpa_c$
declare
  v_ist  text;
  v_soll text;
begin
  if to_regclass('pg_temp.rpa_abdruck') is null then
    raise exception 'ABBRUCH C0: der Abdruck aus A ist fort.';
  end if;

  if exists (select 1 from public.purchase_items pi join rpa_ziel t on t.id = pi.id
              where pi.sky_id is not null) then
    raise exception 'ABBRUCH C1: eine Zielposition traegt noch eine SKY-ID.';
  end if;

  /* Rohname, Zustand und Lage sind auch bei der Ruecknahme unberuehrt. */
  v_soll := (select wert from rpa_abdruck where schluessel = 'felder_md5');
  v_ist  := (select md5(coalesce(string_agg(pi.id::text || '|' || coalesce(pi.raw_name, '') || '|'
                                            || pi.state || '|' || pi.condition,
                                            ';' order by pi.id), ''))
               from public.purchase_items pi join rpa_ziel t on t.id = pi.id);
  if v_ist <> v_soll then
    raise exception 'ABBRUCH C2: Rohname, Zustand oder Lage haben sich geaendert '
      '(md5 % statt %)', v_ist, v_soll;
  end if;

  v_soll := (select wert from rpa_abdruck where schluessel = 'ohne_sky_id');
  v_ist  := (select count(*)::text from public.purchase_items where sky_id is null);
  if v_ist::integer <> v_soll::integer
       + (select wert::integer from rpa_abdruck where schluessel = 'ziel') then
    raise exception 'ABBRUCH C3: Freitextpositionen sind %, erwartet % plus der '
      'zurueckgenommenen', v_ist, v_soll;
  end if;

  if (select count(*) from public.purchase_items pi
        join public.skylanders s on s.sky_id = pi.sky_id
       where s.item_type = 'portal') <> 0 then
    raise exception 'ABBRUCH C3: es stehen noch Positionen auf Portalen.';
  end if;

  for v_ist, v_soll in
    select 'positionen', (select count(*)::text from public.purchase_items)
    union all select 'lagerzeilen', (select count(*)::text from public.shop_inventory)
    union all select 'bewegungen', (select count(*)::text from public.inventory_movements)
  loop
    if v_soll <> (select wert from rpa_abdruck where schluessel = v_ist) then
      raise exception 'ABBRUCH C4: % ist "%", vorher "%"', v_ist, v_soll,
        (select wert from rpa_abdruck where schluessel = v_ist);
    end if;
  end loop;

  raise notice 'C ok: % Positionen wieder Freitext, 0 auf Portalen, '
    'Rohname/Zustand/Lage unveraendert, kein Bestand bewegt.',
    (select wert from rpa_abdruck where schluessel = 'ziel');
end $rpa_c$;

commit;
