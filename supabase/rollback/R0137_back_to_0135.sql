-- ===========================================================================
-- RUECKNAHME VON 0137 — zurueck auf den Stand nach 0135/0136
--
-- WAS SIE ZURUECKNIMMT
--
--   1. `catalog_item_type_for_category()` wieder auf die eine Zeile aus
--      `0135`: Spiele -> game, alles andere -> figure.
--   2. `non_collectible_categories()` wieder auf `['Spiele']` (Stand `0006`).
--   3. `seller_create_catalog_item(text, text, text)` wird entfernt.
--   4. `seller_import_catalog()` wieder auf die sieben Spalten aus `0117`.
--
-- WAS SIE NICHT TUT, UND WARUM SIE DANN ABBRICHT
--
-- Sie loescht KEINEN Artikel und KEINE Kategorie. Steht aber schon ein
-- Zubehoerartikel im Katalog, waere diese Ruecknahme gefaehrlich: ohne die
-- erweiterte Kategorieliste wird ein Portal SAMMELBAR und ohne den
-- `item_type`-Riegel aus `0135` waere es beinahe shopfaehig. Abschnitt 1
-- bricht deshalb ab, sobald eine Zeile in einer der vier Zubehoerkategorien
-- steht oder einen Artikeltyp ausser `figure` und `game` traegt. Dann ist die
-- richtige Reihenfolge: zuerst die Artikel entfernen oder umhaengen — eine
-- Entscheidung des Betreibers —, danach diese Datei.
--
-- `0136` bleibt unberuehrt: die Betriebssicherung liest `skylanders.item_type`
-- und die Spalte bleibt stehen. Wer bis `0135` zurueck will, nimmt danach
-- `R0136_back_to_0131.sql` und erst dann `R0135_drop_item_type.sql`.
--
-- AUSFUEHRUNG: vollstaendig in `begin` / `commit` geklammert.
-- ===========================================================================

create temporary table r0137_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_n integer;
begin
  if to_regclass('pg_temp.r0137_abdruck') is null then
    raise exception 'R0137 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern';
  end if;
  perform set_config('lock_timeout', '5s', true);

  select count(*) into v_n
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör');
  if v_n > 0 then
    raise exception 'R0137 Abbruch: % Katalogzeile(n) stehen in einer Zubehoerkategorie — '
      'ohne die erweiterte Kategorieliste waeren sie sammelbar. Erst die Artikel '
      'entscheiden, dann zuruecknehmen', v_n;
  end if;

  select count(*) into v_n from public.skylanders s
   where s.item_type not in ('figure', 'game');
  if v_n > 0 then
    raise exception 'R0137 Abbruch: % Zeile(n) tragen einen Artikeltyp ausser figure und game', v_n;
  end if;

  insert into r0137_abdruck (schluessel, wert) values
    ('angebote_md5',
       (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                       || coalesce(o.price::text, ''),
                                       ';' order by o.sky_id, o.condition), ''))
          from public.shop_offers() o)),
    ('sammelbar',  (select count(*)::text from public.skylanders s
                      join public.categories c on c.id = s.category_id
                     where s.is_active and s.catalog_visible
                       and not (c.name = any (public.non_collectible_categories())))),
    ('zeilen',     (select count(*)::text from public.skylanders));
end $$;


-- --- 1. Die Ableitung, wortgleich wie in 0135 ------------------------------
create or replace function public.catalog_item_type_for_category(p_category_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Positivliste. Kein `else 'game'`, nirgends: ein unbekannter Name ist eine
  -- Figur, kein Spiel.
  select case p_category_name
           when 'Spiele' then 'game'
           else 'figure'
         end;
$$;

comment on function public.catalog_item_type_for_category(text) is
  'The one place a category name maps to an item type (0135, ADR-0128): Spiele -> game, everything else -> figure. A POSITIVE list: an unknown category is a figure, never a game. Z3 extends it with Portale -> portal, together with the rows that need it. Pure, immutable, reads nothing.';

revoke all on function public.catalog_item_type_for_category(text) from public, anon, authenticated, service_role;


-- --- 2. Die Kategorieliste, wortgleich wie in 0006 -------------------------
create or replace function public.non_collectible_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['Spiele']::text[];
$$;


-- --- 3. Die Anlegefunktion geht ganz ---------------------------------------
drop function if exists public.seller_create_catalog_item(text, text, text);


-- --- 4. Die Auswahlfunktion, wortgleich wie in 0117 -----------------------
drop function if exists public.seller_import_catalog();

create or replace function public.seller_import_catalog()
returns table (
  sky_id          text,
  name            text,
  series_code     text,
  category        text,
  display_name    text,
  catalog_visible boolean,
  is_active       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select s.sky_id,
           s.name,
           s.series_code,
           coalesce(c.name, ''),
           coalesce(s.display_name_override, s.name),
           s.catalog_visible,
           s.is_active
      from public.skylanders s
      left join public.categories c on c.id = s.category_id;
end;
$$;

comment on function public.seller_import_catalog() is
  'The catalog as the Einkaufsbuch needs it (0052, widened in 0117). `name` is the RAW name and stays that way — the workbook importer matches on it, and a workbook does not know today''s editorial decisions. `display_name` is what a person should read: the administrator''s override where one exists, otherwise the raw name, exactly as the public catalog resolves it. `catalog_visible` and `is_active` ride along so the figure picker can offer precisely what the catalog offers, while the importer ignores both. No price, no image, no slug, no editorial note.';

revoke all on function public.seller_import_catalog() from public, anon;
grant execute on function public.seller_import_catalog() to authenticated;


-- --- 5. Nachbedingungen ---------------------------------------------------
do $$
declare
  v_ist  text;
  v_soll text;
begin
  if to_regclass('pg_temp.r0137_abdruck') is null then
    raise exception 'R0137 Abbruch: der Abdruck aus Abschnitt 1 ist fort';
  end if;

  select array_to_string(public.non_collectible_categories(), ',') into v_ist;
  if v_ist <> 'Spiele' then
    raise exception 'R0137 Befund: non_collectible_categories() ist "%"', v_ist;
  end if;
  if public.catalog_item_type_for_category('Portale') <> 'figure' then
    raise exception 'R0137 Befund: Portale leitet noch nicht wieder auf figure ab';
  end if;
  if public.catalog_item_type_for_category('Spiele') <> 'game' then
    raise exception 'R0137 Befund: Spiele leitet nicht mehr auf game ab';
  end if;
  if to_regprocedure('public.seller_create_catalog_item(text, text, text)') is not null then
    raise exception 'R0137 Befund: seller_create_catalog_item steht noch';
  end if;

  select string_agg(a.name, ',' order by a.ord) into v_ist
    from (select unnest(p.proargnames) as name,
                 generate_subscripts(p.proargnames, 1) as ord
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'seller_import_catalog') a;
  if v_ist <> 'sky_id,name,series_code,category,display_name,catalog_visible,is_active' then
    raise exception 'R0137 Befund: seller_import_catalog liefert "%"', v_ist;
  end if;

  v_soll := (select wert from r0137_abdruck where schluessel = 'angebote_md5');
  v_ist  := (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                            || coalesce(o.price::text, ''),
                                            ';' order by o.sky_id, o.condition), ''))
               from public.shop_offers() o);
  if v_ist <> v_soll then
    raise exception 'R0137 Befund: die Angebotsliste hat sich geaendert (md5 % statt %)', v_ist, v_soll;
  end if;

  v_soll := (select wert from r0137_abdruck where schluessel = 'sammelbar');
  v_ist  := (select count(*)::text from public.skylanders s
               join public.categories c on c.id = s.category_id
              where s.is_active and s.catalog_visible
                and not (c.name = any (public.non_collectible_categories())));
  if v_ist <> v_soll then
    raise exception 'R0137 Befund: % sammelbare Zeilen, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from r0137_abdruck where schluessel = 'zeilen');
  v_ist  := (select count(*)::text from public.skylanders);
  if v_ist <> v_soll then
    raise exception 'R0137 Befund: % Katalogzeilen, vorher %', v_ist, v_soll;
  end if;

  raise notice 'R0137 fertig: zurueck auf den Stand nach 0135. % Angebote unveraendert (md5 %)',
    (select count(*) from public.shop_offers()),
    (select wert from r0137_abdruck where schluessel = 'angebote_md5');
end $$;
