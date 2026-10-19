-- ===========================================================================
-- R0135 — Ruecknahme von 0135
--
-- Stellt `is_shop_eligible(text)` auf den Stand aus `0008` zurueck und
-- entfernt `skylanders.item_type` samt CHECK. Der Funktionskoerper darunter
-- ist Zeichen fuer Zeichen der aus `0008`.
--
-- WANN SIE GEBRAUCHT WIRD: eigentlich nie. `0135` prueft innerhalb ihrer
-- eigenen Transaktion, dass sich Angebotsliste, Nenner und Overrides nicht
-- geaendert haben, und bricht sonst ab — ein fehlgeschlagener Lauf hinterlaesst
-- gar nichts. Diese Datei ist fuer den anderen Fall: die Migration lief
-- erfolgreich, und die Entscheidung wird spaeter zurueckgenommen.
--
-- FOLGE DER RUECKNAHME: `item_type` verschwindet mitsamt dem Backfill der 39
-- Spiele. Steht zu diesem Zeitpunkt schon ein Portal im Katalog (Z3), waere es
-- danach ueber die Kategorie zu beurteilen — und eine Kategorie „Portale" ist
-- ohne die Typbedingung SHOPFAEHIG. **Dann darf diese Datei nicht laufen**,
-- ohne dass `non_collectible_categories()` zuerst die neuen Kategorien
-- aufnimmt. Abschnitt 1 bricht genau dafuer ab.
--
-- UND SIE DARF NICHT VOR `R0136` LAUFEN. Seit `0136` liest
-- `seller_business_backup()` die Spalte `item_type`. PostgreSQL vermerkt fuer
-- einen `language sql`-Rumpf KEINE Abhaengigkeit auf die gelesenen Spalten:
-- `drop column` gelingt, und die Sicherung scheitert erst beim AUFRUF mit
-- `42703` — eine Datensicherung, die erst im Ernstfall nicht mehr laeuft.
-- (Nachgestellt und bestaetigt in PostgreSQL 18.6.) Abschnitt 1 bricht
-- deshalb ab, solange der Rumpf `item_type` nennt. Reihenfolge einer
-- vollstaendigen Ruecknahme: ERST `R0136_back_to_0131.sql`, DANN diese Datei.
--
-- Rein strukturell: keine Datenzeile wird geloescht, kein Katalogartikel, kein
-- Lager, kein Beleg. Ausfuehrung in `begin` / `commit`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingung — die Ruecknahme darf keine Luecke aufreissen
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception 'R0135 Abbruch: item_type gibt es nicht — 0135 ist hier nicht angewendet';
  end if;

  /* Jeder Artikel, der NICHT figure oder game ist, waere nach der Ruecknahme
     allein ueber seine Kategorie zu beurteilen. Solange die nicht in
     `non_collectible_categories()` steht, wuerde er shopfaehig. */
  select count(*) into v_n from public.skylanders
   where item_type not in ('figure', 'game');
  if v_n > 0 then
    raise exception 'R0135 Abbruch: % Artikel sind weder figure noch game (Z3 ist gelaufen) — '
      'erst non_collectible_categories() um deren Kategorien erweitern', v_n;
  end if;

  /*
   * DIE SICHERUNG DARF DIE SPALTE NICHT MEHR LESEN.
   *
   * `0136` nimmt `item_type` in den Bereich `figures` auf. Ein `drop column`
   * davor ist kein Fehler, den die Datenbank meldet — es ist einer, den
   * niemand merkt, bis die Sicherung gebraucht wird.
   */
  if position('item_type' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.seller_business_backup()')), '')) > 0 then
    raise exception 'R0135 Abbruch: die Betriebssicherung liest item_type noch (Stand 0136) — '
      'erst R0136_back_to_0131.sql fahren, dann diese Datei';
  end if;

  raise notice 'R0135 vorher: % shopfaehige Zeilen, % Angebote',
    (select count(*) from public.skylanders s where public.is_shop_eligible(s.sky_id)),
    (select count(*) from public.shop_offers());
end $$;


-- ---------------------------------------------------------------------------
-- 2. is_shop_eligible zurueck auf 0008 — ohne die item_type-Bedingung
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_eligible(p_sky_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.skylanders s
      join public.categories c on c.id = s.category_id
     where s.sky_id = p_sky_id
       and s.is_active
       and s.catalog_visible
       and not (c.name = any (public.non_collectible_categories()))
  );
$$;

comment on function public.is_shop_eligible(text) is
  'Whether a figure may be offered in the shop at all: active, editorially visible, and a collectible rather than software (ADR-0048). Called by shop_offers() AND by the one-time release in 0008 - the same rule, not two copies. Says nothing about stock or price.';

revoke all on function public.is_shop_eligible(text) from public;
grant execute on function public.is_shop_eligible(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Die Spalte und ihr CHECK
-- ---------------------------------------------------------------------------
alter table public.skylanders
  drop constraint if exists skylanders_item_type_known;

alter table public.skylanders
  drop column if exists item_type;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingung
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'item_type') then
    raise exception 'R0135 Abbruch: item_type steht noch';
  end if;
  if position('item_type' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) > 0 then
    raise exception 'R0135 Abbruch: is_shop_eligible nennt item_type noch';
  end if;
  if position('non_collectible_categories' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) = 0 then
    raise exception 'R0135 Abbruch: is_shop_eligible hat die Kategoriebedingung verloren';
  end if;
  raise notice 'R0135: item_type entfernt, is_shop_eligible ist der Stand aus 0008 — % Angebote',
    (select count(*) from public.shop_offers());
end $$;
