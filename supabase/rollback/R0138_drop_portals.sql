-- ===========================================================================
-- RUECKNAHME VON 0138 — die 21 Portale wieder aus dem Katalog
--
-- WAS SIE ZURUECKNIMMT
--
--   1. Die 21 Katalogzeilen `SKY-0615`-`0622`, `0624`-`0630`, `0632`-`0637`.
--   2. Die Kategorien `Portale` — aber nur die, die danach leer sind.
--
-- WAS SIE NICHT ZURUECKNIMMT, UND WARUM NICHT
--
-- DIE JOURNALEINTRAEGE BLEIBEN. `catalog_admin_changes` ist append-only, und
-- zwar durch einen Trigger und nicht durch eine Policy (`0004`, Abschnitt
-- 6.1) — ein `delete` dort scheitert, auch unter der Service-Rolle. Nach
-- dieser Ruecknahme stehen also 21 Zeilen `created` zu SKY-IDs, die es nicht
-- mehr gibt. Das ist richtig: das Journal sagt, was geschehen IST, und nicht,
-- was am Ende stehengeblieben ist. Ein Journal, das sich mitloeschen laesst,
-- ist keines.
--
-- UND SIE LOESCHT NICHTS, WORAN ETWAS HAENGT
--
-- Abschnitt 1 fragt ZEHN Tabellen, bevor irgendetwas verschwindet. Zwei davon
-- sind der eigentliche Grund fuer diese Sorgfalt: `orderbook_name_mappings`
-- und `inventory_import_mappings` haengen mit `on delete cascade` an
-- `skylanders`. Ein `delete` auf eine Portalzeile nimmt deren Zuordnungen
-- also STILL mit — keine Fehlermeldung, kein Hinweis, nur weniger Daten.
-- Die uebrigen acht stehen auf `restrict` und wuerden laut scheitern; sie
-- werden trotzdem gefragt, damit die Meldung sagt, WAS im Weg steht, statt
-- einen Fremdschluesselnamen zu nennen.
--
-- Hat ein Portal also einen Einkauf, einen Bestand, eine Bewegung, eine
-- Sammlung, einen Warenkorb oder eine Zuordnung, bricht diese Datei ab. Dann
-- ist die Rueckname nicht mehr das richtige Mittel: ein gekauftes Portal ist
-- Geschaeftsvorfall, kein Versehen.
--
-- REIHENFOLGE: ERST DIESE, DANN `R0137`. `R0137` bricht von sich aus ab,
-- solange eine Zeile in einer Zubehoerkategorie steht — ohne die erweiterte
-- Kategorieliste waere ein Portal sammelbar. Diese Datei raeumt genau das
-- aus dem Weg.
--
-- AUSFUEHRUNG: vollstaendig in `begin` / `commit` geklammert.
-- ===========================================================================

create temporary table r0138_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_n     integer;
  v_wo    text;
begin
  if to_regclass('pg_temp.r0138_abdruck') is null then
    raise exception 'R0138 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern';
  end if;
  perform set_config('lock_timeout', '5s', true);

  -- ---- Was haengt an den 21 Zeilen? ------------------------------------
  /*
   * EINE FRAGE JE TABELLE, und die Meldung nennt sie beim Namen. Die Liste
   * ist jede Tabelle mit einem Fremdschluessel auf `skylanders.sky_id`;
   * `catalog_admin_changes` steht NICHT darin, weil `entity_id` dort text
   * ohne Fremdschluessel ist — das Journal ueberlebt die Zeile absichtlich.
   */
  v_wo := null;
  select string_agg(x.wo || ' (' || x.n::text || ')', ', ' order by x.wo) into v_wo
    from (
      select 'collection_items' as wo, count(*) as n from public.collection_items t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'shop_inventory', count(*) from public.shop_inventory t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      /* Eine Bewegung haengt an der LAGERZEILE, nicht an der SKY-ID — der
         Weg dorthin geht ueber `inventory_id`. Gefragt wird sie trotzdem
         getrennt, damit die Meldung „Bewegung" sagt und nicht „Lagerzeile". */
      select 'inventory_movements', count(*) from public.inventory_movements m
        join public.shop_inventory i on i.id = m.inventory_id
       where i.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'purchase_items', count(*) from public.purchase_items t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'sale_items', count(*) from public.sale_items t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'cart_items', count(*) from public.cart_items t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'catalog_editorial', count(*) from public.catalog_editorial t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'legacy_stock_events', count(*) from public.legacy_stock_events t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      -- Die beiden mit `on delete cascade`: sie wuerden still mitgehen.
      select 'orderbook_name_mappings', count(*) from public.orderbook_name_mappings t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
      union all
      select 'inventory_import_mappings', count(*) from public.inventory_import_mappings t
        where t.sky_id between 'SKY-0615' and 'SKY-0642'
    ) x
   where x.n > 0;

  if v_wo is not null then
    raise exception 'R0138 Abbruch: an den Portalen haengt noch etwas — %. '
      'Ein gekauftes, eingebuchtes oder zugeordnetes Portal wird nicht geloescht; '
      'zwei dieser Tabellen haengen mit ON DELETE CASCADE und gingen still mit', v_wo;
  end if;

  -- ---- Abdruecke, gegen die am Ende geprueft wird -----------------------
  insert into r0138_abdruck (schluessel, wert) values
    ('zeilen',     (select count(*)::text from public.skylanders)),
    ('portale',    (select count(*)::text from public.skylanders
                     where sky_id between 'SKY-0615' and 'SKY-0642')),
    ('angebote',   (select count(*)::text from public.shop_offers())),
    ('angebote_md5',
       (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                       || coalesce(o.price::text, ''),
                                       ';' order by o.sky_id, o.condition), ''))
          from public.shop_offers() o)),
    ('sammelbar',  (select count(*)::text from public.skylanders s
                      join public.categories c on c.id = s.category_id
                     where s.is_active and s.catalog_visible
                       and not (c.name = any (public.non_collectible_categories()))));

  select wert::integer into v_n from r0138_abdruck where schluessel = 'portale';
  if v_n = 0 then
    raise exception 'R0138 Abbruch: im Bereich SKY-0615..SKY-0642 steht keine Zeile — '
      '0138 ist hier nicht angewendet';
  end if;
  raise notice 'R0138: % Portalzeile(n) werden entfernt', v_n;
end $$;


-- ---------------------------------------------------------------------------
-- Die Zeilen, dann die leeren Kategorien
--
-- IN DIESER REIHENFOLGE. `skylanders_category_fk` steht auf `restrict`: eine
-- Kategorie mit Zeilen laesst sich nicht loeschen, und das ist die
-- Sicherung, die hier mitarbeitet statt im Weg zu stehen.
-- ---------------------------------------------------------------------------
delete from public.skylanders
 where sky_id between 'SKY-0615' and 'SKY-0642';

/*
 * NUR LEERE KATEGORIEN, und nur die, die `Portale` heissen. Haengt an einer
 * noch eine Zeile — etwa ein spaeter von Hand angelegtes Portal mit einer
 * SKY-ID ausserhalb des ZB-Bereichs —, bleibt sie stehen. Sie wegzunehmen
 * waere eine Entscheidung ueber fremde Daten.
 */
delete from public.categories c
 where c.name = 'Portale'
   and not exists (select 1 from public.skylanders s where s.category_id = c.id);


do $$
declare
  v_ist  text;
  v_soll text;
  v_n    integer;
begin
  if to_regclass('pg_temp.r0138_abdruck') is null then
    raise exception 'R0138 Abbruch: der Abdruck ist fort — die Datei lief nicht als '
      'eine Transaktion';
  end if;

  select count(*) into v_n from public.skylanders
   where sky_id between 'SKY-0615' and 'SKY-0642';
  if v_n <> 0 then
    raise exception 'R0138 Befund: % Zeile(n) stehen noch im Bereich SKY-0615..SKY-0642', v_n;
  end if;

  v_soll := (select wert from r0138_abdruck where schluessel = 'zeilen');
  v_ist  := (select count(*)::text from public.skylanders);
  if v_ist::integer <> v_soll::integer
       - (select wert::integer from r0138_abdruck where schluessel = 'portale') then
    raise exception 'R0138 Befund: % Katalogzeilen, erwartet % minus die Portale',
      v_ist, v_soll;
  end if;

  /* Und wieder: die Angebotsliste hat sich nicht bewegt. Sie hat es auch bei
     0138 nicht — ein Portal war nie ein Angebot, in keiner Richtung. */
  v_soll := (select wert from r0138_abdruck where schluessel = 'angebote_md5');
  v_ist  := (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                            || coalesce(o.price::text, ''),
                                            ';' order by o.sky_id, o.condition), ''))
               from public.shop_offers() o);
  if v_ist <> v_soll then
    raise exception 'R0138 Befund: die Angebotsliste hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  v_soll := (select wert from r0138_abdruck where schluessel = 'sammelbar');
  v_ist  := (select count(*)::text from public.skylanders s
               join public.categories c on c.id = s.category_id
              where s.is_active and s.catalog_visible
                and not (c.name = any (public.non_collectible_categories())));
  if v_ist <> v_soll then
    raise exception 'R0138 Befund: % sammelbare Zeilen, vorher %', v_ist, v_soll;
  end if;

  raise notice 'R0138 fertig: Portale entfernt, % Kategorie(n) "Portale" geblieben. '
    'Die 21 Journaleintraege bleiben stehen — append-only, und das ist Absicht',
    (select count(*) from public.categories where name = 'Portale');
end $$;
