-- ===========================================================================
-- 0139 — ZUBEHOER DARF VERKAUFT WERDEN, ABER NUR STUECK FUER STUECK
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- DIE ENTSCHEIDUNG (Betreiber, 2026-10-20). Spiele und Portale werden ueber
-- den eigenen SkyIsles-Shop verkauft — mit derselben Angebots-, Warenkorb-,
-- Checkout- und Bestellarchitektur wie Figuren, und ausserhalb der Sammlung.
-- Sie revidiert ADR-0029/0048 fuer genau zwei Artikeltypen. Begruendung,
-- Bestandsaufnahme und die offenen Rechtsfragen:
-- `supabase/checks/accessory_offer_proposal.md`.
--
-- ---------------------------------------------------------------------------
-- WAS SIE TUT, UND NUR DAS
--
--   1. `shop_inventory.sale_released` — eine Freigabe JE LAGERPOSITION,
--      `not null default false`.
--   2. `shop_inventory.delivery_scope` — WAS geliefert wird, als eigene
--      Eigenschaft neben `condition` und nicht aus ihm abgeleitet.
--   3. `skylanders.usk_rating` — die Alterskennzeichnung eines Spiels,
--      nullable, mit gesicherter Wertemenge. NULL heisst „nicht erfasst",
--      und nicht erfasst heisst „nicht verkaeuflich".
--   4. `is_position_sellable(bigint)` — das neue, EINZIGE Tor der vier
--      Verkaufstueren.
--   5. Die vier Tueren tauschen je eine Zeile — `shop_offers()` bekommt
--      zusaetzlich eine fuenfte Spalte, `delivery_scope`.
--   6. Drei Betriebsfunktionen: Freigabe setzen, Lieferumfang setzen,
--      USK erfassen.
--   7. Die Betriebsdiagnose nennt kuenftig den richtigen Grund — fuenf
--      davon sind neu.
--
-- ---------------------------------------------------------------------------
-- ZUSTAND UND LIEFERUMFANG SIND ZWEI EIGENSCHAFTEN (Betreiber, 2026-10-20)
--
-- `condition` wird NICHT umgedeutet. Fuer ein Spiel heisst `loose`
-- ausdruecklich: Spielmedium OHNE Originalhuelle. Was ausserdem im Paket
-- liegt — Anleitung, USB-Kabel — sagt `delivery_scope`, und das laesst sich
-- aus dem Zustand nicht ableiten.
--
-- Daraus folgt eine Konsequenz, die hier benannt und nicht versteckt wird:
-- ein Spiel MIT Originalhuelle ist nach dieser Festlegung nicht `loose`, und
-- V1 verkauft nur `loose` (`0028`/`0029`/`0108`). `disc_case` ist deshalb
-- modelliert, waehlbar und durch einen CHECK gegen `loose` gesichert — aber
-- nicht verkaeuflich. Das zu aendern waere eine eigene Produktentscheidung
-- und steht NICHT in dieser Datei.
--
-- ---------------------------------------------------------------------------
-- WARUM DIE FREIGABE AN DER POSITION HAENGT UND NICHT AM ARTIKEL
--
-- Weil die Gefahr dort wohnt. 13 Lagerzeilen auf Spielen tragen heute
-- `is_listed = true` — und sie tragen zwingend auch einen Preis, denn
-- `shop_inventory_listed_needs_price` (0003) verbietet das eine ohne das
-- andere. Zur Veroeffentlichung fehlt ihnen ausschliesslich das Tor. Ein
-- Schalter am KATALOGARTIKEL haette alle Positionen dieses Artikels auf
-- einmal freigegeben; ein Schalter an der POSITION gibt genau eine frei.
--
-- Und weil `shop_inventory` die Zeile ist, die eine spaetere
-- Marketplace-Architektur je Verkaeufer fuehren wuerde. Die Freigabe ist
-- damit von Natur aus haendlereigen. DAS IST VORSORGE, KEINE
-- MARKETPLACE-IMPLEMENTIERUNG: es entsteht kein `seller_id`, keine
-- Seller-RLS, kein Onboarding, kein Stripe Connect, keine Provision. Der
-- Stopp aus ADR-0021 gilt unveraendert.
--
-- ---------------------------------------------------------------------------
-- `is_shop_eligible()` WIRD NICHT ANGEFASST
--
-- Das ist Absicht und es ist der Kern des Sicherheitsarguments. Die Funktion
-- bleibt Zeichen fuer Zeichen, wie `0135` sie hinterlassen hat: aktiv,
-- katalogsichtbar, `item_type = 'figure'`, keine nicht sammelbare Kategorie.
-- Das neue Tor RUFT sie fuer den Figurenfall auf, statt ihre Regel
-- abzuschreiben. Fuer jede Figur ist `is_position_sellable()` deshalb nicht
-- „ungefaehr dasselbe", sondern per Konstruktion DASSELBE.
--
-- Die Folge: 534 shopfaehige Zeilen bleiben 534, 256 Angebote bleiben 256,
-- der Abdruck ueber die Angebotsliste bleibt stehen. Abschnitt 8 prueft das
-- und bricht sonst ab.
--
-- ---------------------------------------------------------------------------
-- WAS SIE AUSDRUECKLICH NICHT TUT
--
--   * KEIN Angebot entsteht. `default false` auf 285 Lagerzeilen, die 13
--     Spielezeilen eingeschlossen. Nach dieser Migration ist genau so viel
--     kaufbar wie vorher.
--   * KEINE Zeile wird geloescht, umgebucht oder bepreist. Kein
--     `is_listed` wird veraendert — auch die 13 Altlastzeilen behalten ihres.
--   * KEINE Sammelbarkeit aendert sich. `non_collectible_categories()`
--     bleibt unberuehrt, die 534 sammelbaren Figuren bleiben 534, und
--     Zubehoer bleibt aus jeder Sammlung heraus (ADR-0128).
--   * KEINE Katalogsichtbarkeit aendert sich. Sichtbar und verkaeuflich
--     bleiben zwei Entscheidungen.
--   * KEIN Spiel wird freigebbar, solange seine USK-Kennzeichnung fehlt —
--     und sie fehlt heute bei allen 39. Das ist kein Versehen, sondern
--     Abschnitt 7.
--   * NICHTS an der Belegausstellung, ihren Rechten oder ihrer Sperre.
--   * KEIN `seller_id`, keine Multi-Seller-Struktur (ADR-0021).
--
-- ---------------------------------------------------------------------------
-- REIHENFOLGE UND ABHAENGIGKEITEN
--
-- Setzt voraus: `0003` (shop_inventory), `0008` (is_shop_eligible),
-- `0010` (reserve_for_order), `0028`, `0029`, `0040`, `0041` und `0135`
-- (item_type). `0135` ist die harte Bedingung — ohne `item_type` gibt es
-- keinen Artikeltyp zu fragen. Abschnitt 1 prueft jede davon.
--
-- EINE TRANSAKTION, UND SIE PRUEFT SICH SELBST. Wie `0135`: die temporaere
-- Abdrucktabelle traegt `on commit drop`, und laeuft die Datei ohne Klammer,
-- ist sie sofort wieder fort — der erste Block bricht dann ab, BEVOR eine
-- Spalte entsteht.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher `supabase/checks/0139_preflight.sql`, danach `0139_postflight.sql`.
-- Ruecknahme: `supabase/rollback/R0139_drop_sale_release.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen und die Abdruecke, gegen die Abschnitt 8 prueft
-- ---------------------------------------------------------------------------
create temporary table z4_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
begin
  -- Der Klammergriff. Siehe Kopf.
  if to_regclass('pg_temp.z4_abdruck') is null then
    raise exception '0139 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  perform set_config('lock_timeout', '5s', true);

  -- 1a. Jede vorausgesetzte Funktion und Spalte, einzeln benannt.
  if to_regprocedure('public.is_shop_eligible(text)') is null then
    raise exception '0139 setzt 0008 voraus: is_shop_eligible fehlt';
  end if;
  if to_regprocedure('public.shop_offers()') is null then
    raise exception '0139 setzt 0006/0029 voraus: shop_offers fehlt';
  end if;
  if to_regprocedure('public.shop_quantity_available(text, text, integer)') is null then
    raise exception '0139 setzt 0009/0028 voraus: shop_quantity_available fehlt';
  end if;
  if to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)') is null then
    raise exception '0139 setzt 0040 voraus: create_order mit sechs Parametern fehlt';
  end if;
  if to_regprocedure('public.reserve_for_order(bigint)') is null then
    raise exception '0139 setzt 0010 voraus: reserve_for_order fehlt';
  end if;
  if to_regprocedure('public.admin_shop_listing_audit()') is null then
    raise exception '0139 setzt 0008/0041 voraus: admin_shop_listing_audit fehlt';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0139 setzt 0041 voraus: can_operate_active_seller fehlt';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0139 setzt 0041 voraus: is_platform_admin fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception '0139 setzt 0135 voraus: skylanders.item_type fehlt';
  end if;

  -- 1b. Und die beiden neuen Spalten gibt es noch NICHT.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shop_inventory'
                and column_name = 'sale_released') then
    raise exception '0139 Abbruch: shop_inventory.sale_released steht schon';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'usk_rating') then
    raise exception '0139 Abbruch: skylanders.usk_rating steht schon';
  end if;

  -- 1c. Die Abdruecke. Was danach gleich sein MUSS, und was sich aendern darf.
  insert into z4_abdruck (schluessel, wert) values
    ('shopfaehig',
       (select count(*)::text from public.skylanders s
         where public.is_shop_eligible(s.sky_id))),
    ('angebote', (select count(*)::text from public.shop_offers())),
    ('angebote_md5',
       (select coalesce(md5(string_agg(o.sky_id || '|' || o.condition || '|'
                                       || o.price::text || '|' || o.available::text,
                                       E'\n' order by o.sky_id, o.condition)), '(leer)')
          from public.shop_offers() o)),
    -- Die Zahl der Lagerpositionen, die HEUTE verkaeuflich sind. Abschnitt 8
    -- vergleicht sie mit derselben Zahl, gemessen am NEUEN Tor.
    ('verkaufbare_positionen',
       (select count(*)::text from public.shop_inventory i
         where public.is_shop_eligible(i.sky_id))),
    ('lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('gelistet',     (select count(*)::text from public.shop_inventory where is_listed)),
    ('gelistet_md5',
       (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                       || coalesce(i.sale_price::text, '-'),
                                       E'\n' order by i.id)), '(leer)')
          from public.shop_inventory i)),
    ('sammelbar',
       (select count(*)::text from public.skylanders s
          join public.categories c on c.id = s.category_id
         where s.is_active
           and not (c.name = any (public.non_collectible_categories())))),
    ('katalogzeilen', (select count(*)::text from public.skylanders)),
    ('sichtbar',      (select count(*)::text from public.skylanders where catalog_visible));

  raise notice '0139 Abdruck: % shopfaehig, % Angebote (md5 %), % verkaufbare Positionen, % sammelbar',
    (select wert from z4_abdruck where schluessel = 'shopfaehig'),
    (select wert from z4_abdruck where schluessel = 'angebote'),
    (select wert from z4_abdruck where schluessel = 'angebote_md5'),
    (select wert from z4_abdruck where schluessel = 'verkaufbare_positionen'),
    (select wert from z4_abdruck where schluessel = 'sammelbar');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Freigabe — an der Lagerposition
--
-- `not null default false`: jede der vorhandenen Zeilen steht danach auf
-- „nicht freigegeben". Ein Vorgabewert statt NULL, weil „unbekannte Freigabe"
-- kein Zustand ist, den eine Verkaufsabfrage behandeln muesste — und weil
-- NULL in einer Sicherheitsbedingung die Antwort „weder ja noch nein" gibt,
-- und das ist in einem Tor die schlechteste aller Antworten.
--
-- SIE GILT NUR FUER ZUBEHOER. Fuer eine Figur ist die Spalte ohne Wirkung;
-- das Tor fragt sie dort gar nicht. Deshalb bleibt sie bei den 272
-- Figurenzeilen auf `false` stehen und bedeutet dort nichts — und deshalb
-- lehnt `seller_set_sale_release()` eine Figur ausdruecklich ab, statt einen
-- Schalter anzubieten, der nichts tut.
-- ---------------------------------------------------------------------------
alter table public.shop_inventory
  add column sale_released boolean not null default false;

/*
 * DER LIEFERUMFANG — eine EIGENE Eigenschaft, nicht der Zustand.
 *
 * ZWEI FRAGEN, DIE NICHT DIESELBE SIND (Betreiber, 2026-10-20):
 *
 *   condition        in welchem Zustand ist der Artikel? Das vorhandene
 *                    Vokabular `loose` / `boxed`, und es wird hier NICHT
 *                    umgedeutet. Fuer ein Spiel heisst `loose`
 *                    ausdruecklich: Spielmedium OHNE Originalhuelle.
 *   delivery_scope   was liegt im Paket? Disc allein, Disc mit Anleitung,
 *                    Portal allein, Portal mit USB-Kabel.
 *
 * Der Lieferumfang laesst sich aus dem Zustand NICHT ableiten — genau
 * deshalb steht er daneben und nicht darin. „Lose" sagt, dass keine
 * Originalhuelle dabei ist; es sagt nicht, ob eine Anleitung oder ein
 * Kabel dabei ist.
 *
 * NULL HEISST „NICHT ANGEGEBEN", und fuer eine Figur bleibt es dabei: dort
 * ist die Frage durch `condition` beantwortet und die Spalte bedeutungslos.
 * Fuer Zubehoer ist NULL ein VERKAUFSHINDERNIS — ein Angebot fuer ein
 * gebrauchtes Spiel muss sagen, was geliefert wird.
 *
 * ZWEI CHECKS, UND DER ZWEITE IST DER WICHTIGE. `disc_case` („mit
 * Originalhuelle") und `condition = 'loose'` widersprechen sich nach der
 * Festlegung oben. Die Tabelle laesst die Kombination deshalb nicht zu,
 * statt sich auf eine Funktion zu verlassen. Folge, und sie ist
 * beabsichtigt: ein Spiel MIT Huelle ist nicht `loose`, und V1 verkauft
 * nur `loose` (`0028`/`0029`/`0108`) — es ist damit modelliert und
 * waehlbar, aber nicht verkaeuflich. Das zu aendern waere eine eigene
 * Produktentscheidung.
 */
alter table public.shop_inventory
  add column delivery_scope text;

alter table public.shop_inventory
  add constraint shop_inventory_delivery_scope_known
    check (delivery_scope is null or delivery_scope in
           ('disc_only', 'disc_manual', 'disc_case', 'portal_only', 'portal_cable'));

alter table public.shop_inventory
  add constraint shop_inventory_case_is_not_loose
    check (delivery_scope is distinct from 'disc_case' or condition <> 'loose');

comment on column public.shop_inventory.delivery_scope is
  'Was bei DIESER Position wirklich geliefert wird (0139) — eine eigene Eigenschaft neben condition, nicht aus ihm ableitbar. disc_only | disc_manual | disc_case fuer Spiele, portal_only | portal_cable fuer Portale. NULL heisst NICHT ANGEGEBEN: fuer eine Figur bleibt es dabei (dort beantwortet condition die Frage), fuer Zubehoer ist es ein Verkaufshindernis — is_position_sellable() verlangt eine Angabe. condition wird dadurch NICHT umgedeutet: fuer ein Spiel heisst loose weiterhin "Spielmedium ohne Originalhuelle", und der CHECK shop_inventory_case_is_not_loose haelt die beiden Aussagen widerspruchsfrei.';

comment on column public.shop_inventory.sale_released is
  'Freigabe DIESER Lagerposition fuer den oeffentlichen Verkauf (0139). Gilt nur fuer Zubehoer (game, portal) — fuer eine Figur fragt is_position_sellable() die Spalte nicht, dort entscheidet is_shop_eligible() wie seit 0008. Vorgabe false: eine vorhandene Position wird durch diese Migration nicht kaufbar, auch nicht die 13 Spielezeilen mit is_listed = true. Sie sitzt an der POSITION und nicht am Katalogartikel, weil Preis, Menge und Listung dort sitzen und weil diese Zeile in einer spaeteren Marketplace-Architektur je Verkaeufer gefuehrt wuerde. Das ist Vorsorge, keine Multi-Seller-Implementierung (ADR-0021).';


-- ---------------------------------------------------------------------------
-- 3. Die Alterskennzeichnung — am Artikel
--
-- Sie gehoert dem SPIEL, nicht einer Kiste im Regal: zwei Exemplare desselben
-- Titels tragen dieselbe USK-Einstufung. Deshalb `skylanders`, nicht
-- `shop_inventory`.
--
-- NULLABLE, UND DAS IST DIE AUSSAGE. NULL heisst „nicht erfasst", nie „ohne
-- Kennzeichnung" und nie „0". Die Arbeitsmappe fuehrt keine USK-Angabe, und
-- geraten wird sie nicht (CLAUDE.md Regel 4). Ein Spiel ohne Eintrag ist
-- nicht freigebbar — Abschnitt 7.
--
-- OEFFENTLICH, UND DAS IST KEIN WIDERSPRUCH ZU `docs/SECURITY.md`. Die Regel
-- dort lautet: keine INTERNEN Daten auf `skylanders`, weil die Tabelle
-- weltlesbar ist. Eine Alterskennzeichnung ist das Gegenteil von intern — sie
-- MUSS im Angebot erkennbar sein, sonst darf das Angebot nicht stehen.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column usk_rating smallint;

alter table public.skylanders
  add constraint skylanders_usk_rating_known
    check (usk_rating is null or usk_rating in (0, 6, 12, 16, 18));

comment on column public.skylanders.usk_rating is
  'Die USK-Alterskennzeichnung eines Spiels (0139): 0, 6, 12, 16 oder 18. NULL heisst NICHT ERFASST — nie "ohne Kennzeichnung" und nie 0. Oeffentliche Produktinformation, deshalb hier und nicht in catalog_editorial. Wird NIE abgeleitet oder geraten: die Quelle ist die Huelle oder die USK-Titeldatenbank, erfasst von Hand ueber admin_set_usk_rating(). Ohne Eintrag lehnt seller_set_sale_release() ein Spiel ab.';


-- ---------------------------------------------------------------------------
-- 4. Das neue Tor
--
-- EINE Stelle, an der kuenftig entschieden wird, ob eine Lagerposition
-- oeffentlich verkauft werden darf. Die vier Tueren fragen ab Abschnitt 5
-- nur noch sie.
--
-- DER FIGURENZWEIG RUFT `is_shop_eligible()` AUF, statt ihre Regel
-- abzuschreiben. Damit ist „fuer Figuren aendert sich nichts" keine Zusage,
-- die jemand pflegen muesste, sondern eine Eigenschaft des Textes: aendert
-- sich eines Tages die Figurenregel, aendert sie sich hier mit, und zwar
-- genau einmal.
--
-- DER ZUBEHOERZWEIG nennt vier Bedingungen, und jede hat einen Grund:
--
--   item_type in ('game','portal')  Bundles und sonstiges Zubehoer sind
--                                   NICHT freigegeben — eine eigene
--                                   Entscheidung, die niemand getroffen hat.
--   is_active                       dieselbe Bedingung wie bei Figuren.
--   catalog_visible                 was nicht im Katalog steht, wird nicht
--                                   verkauft. Sichtbarkeit allein bewirkt
--                                   aber KEINE Freigabe — die Umkehrung gilt
--                                   nicht, und das ist Punkt 1 des Auftrags.
--   usk_rating is not null          nur bei Spielen. Abschnitt 3.
--   delivery_scope is not null      ein Angebot fuer gebrauchte Ware muss
--                                   sagen, was im Paket liegt. Abschnitt 2.
--   sale_released                   die ausdrueckliche Freigabe. Ohne sie
--                                   nichts, egal wie vollstaendig der Rest.
--
-- `stable`, nicht `immutable`: die Antwort haengt an Tabellenzeilen.
-- Kein `security definer`: die Funktion liest nur, was ihre Aufrufer ohnehin
-- lesen duerfen, und die vier Tueren sind selbst `security definer`.
-- ---------------------------------------------------------------------------
create or replace function public.is_position_sellable(p_inventory_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
     where i.id = p_inventory_id
       and (
         -- FIGUR: unveraendert, und zwar durch Aufruf statt durch Kopie.
         public.is_shop_eligible(i.sky_id)
         -- ZUBEHOER: vier Bedingungen, alle vier neu.
         or (
           s.item_type in ('game', 'portal')
           and s.is_active
           and s.catalog_visible
           and (s.item_type <> 'game' or s.usk_rating is not null)
           -- Ein Angebot muss sagen, WAS geliefert wird.
           and i.delivery_scope is not null
           and i.sale_released
         )
       )
  );
$$;

comment on function public.is_position_sellable(bigint) is
  'Whether THIS stock position may be sold to the public (0139). The one gate the four selling doors ask: shop_offers(), shop_quantity_available(), create_order() and reserve_for_order(). For a figure it simply calls is_shop_eligible() — unchanged behaviour by construction, not by promise. For an accessory it additionally requires item_type in (game, portal), an active and catalogue-visible article, a recorded USK rating when it is a game, and the explicit per-position release sale_released. Catalogue visibility alone never makes anything buyable. Says nothing about stock, price or condition — those stay where they were.';

revoke all on function public.is_position_sellable(bigint) from public;
grant execute on function public.is_position_sellable(bigint) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die vier Tueren — je eine getauschte Zeile
--
-- Jede Funktion steht hier VOLLSTAENDIG, Zeichen fuer Zeichen so, wie sie
-- zuletzt definiert wurde, mit genau einer Aenderung:
--
--     public.is_shop_eligible(i.sky_id)  ->  public.is_position_sellable(i.id)
--
-- Nichts sonst. Kein Formatwechsel, kein neuer Kommentar im Rumpf, keine
-- stillschweigende Verbesserung — wer diese Datei gegen `0029`, `0028`,
-- `0040` und `0010` diffed, soll genau eine Zeile je Funktion sehen.
--
--   shop_offers()              zuletzt 0029
--   shop_quantity_available()  zuletzt 0028
--   create_order()             zuletzt 0040
--   reserve_for_order()        zuletzt 0010
--
-- FUER EINE FIGUR AENDERT SICH DAMIT NICHTS, und das ist keine Behauptung,
-- sondern folgt aus Abschnitt 4: `is_position_sellable()` fragt fuer eine
-- Figur genau `is_shop_eligible()` — dieselbe Funktion, unveraendert.
-- ---------------------------------------------------------------------------

-- 5a. shop_offers() — die oeffentliche Projektion (zuletzt 0029)
--
-- DIE EINZIGE DER VIER TUEREN, DIE MEHR ALS EINE ZEILE AENDERT: sie bekommt
-- eine FUENFTE Spalte, `delivery_scope`. Ein Angebot fuer gebrauchte Ware
-- muss sagen, was geliefert wird, und die Projektion ist der einzige Weg,
-- auf dem eine oeffentliche Seite das erfaehrt. Eine zweite Abfrage daneben
-- waere eine zweite Angebotsverwaltung.
--
-- FUER FIGUREN IST SIE IMMER NULL. Dort beantwortet `condition` die Frage,
-- und `0139` setzt die Spalte bei keiner Figurenzeile. Abschnitt 8 prueft
-- das nach.
--
-- `drop` STATT `create or replace`: PostgreSQL laesst den Rueckgabetyp einer
-- Funktion nicht ersetzen. Die Rechte werden deshalb unten neu gesetzt — bei
-- einem `drop` gehen sie mit, und ein Recht, das niemand in der Migration
-- sieht, ist ein Recht, das niemand prueft.
drop function if exists public.shop_offers();

create function public.shop_offers()
returns table (
  sky_id         text,
  condition      text,
  price          numeric,
  available      boolean,
  delivery_scope text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.sky_id,
    i.condition,
    public.shop_price(i.sale_price, s.market_price, st.price_percentage) as price,
    (i.available_quantity > 0) as available,
    -- Was im Paket liegt. NULL fuer jede Figur — siehe Kopf.
    i.delivery_scope
  from public.shop_inventory i
  join public.skylanders s on s.sky_id = i.sky_id
  cross join public.shop_settings st
  where i.is_listed
    -- V1 SELLS LOOSE ONLY (0029). The projection stops advertising what
    -- the platform will not sell: create_order() and
    -- shop_quantity_available() have refused a non-V1 condition since
    -- 0028, so a boxed row here was a price and an availability flag for
    -- a purchase that could not happen.
    --
    -- The rule is asked for, not restated: public.v1_sale_condition() is
    -- the same function the two commerce functions call. One word, one
    -- place, three doors.
    and i.condition = public.v1_sale_condition()
    and public.is_position_sellable(i.id)
    -- Something without a price is not an offer, however released it is.
    and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
  order by i.sky_id, i.condition;
$$;

comment on function public.shop_offers() is
  'The public V1 storefront projection. Every position that is released (is_listed), sellable at this position (is_position_sellable, 0139) and priced - and, since 0029, in the one condition V1 currently sells (v1_sale_condition()). FIVE values per offer since 0139: sky_id, condition, price, available, delivery_scope. No stock level, no cost, no note, no inventory id, no seller. delivery_scope says what is in the parcel and is NULL for every figure, where condition already answers it; for an accessory it is required, because an offer for used goods must say what is delivered. Other conditions are NOT removed from the product - boxed stock, boxed order lines and the admin views keep them; they are simply not offered to the public while V1 sells one condition.';

revoke all on function public.shop_offers() from public;
grant execute on function public.shop_offers() to anon, authenticated;


-- 5b. shop_quantity_available() — Verfuegbarkeit und Warenkorbmenge (0028)
create or replace function public.shop_quantity_available(
  p_sky_id    text,
  p_condition text,
  p_quantity  integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_quantity is not null
    and p_quantity >= 1
    and p_quantity <= public.max_cart_quantity()
    and exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.sky_id    = p_sky_id
         and i.condition = p_condition
         -- V1 sells loose only (0028). A boxed position is real stock and
         -- stays in the table; it is simply not something this shop sells,
         -- so the honest answer is the same `false` a sold-out position
         -- already gets. No new error semantics for a boolean function.
         and i.condition = public.v1_sale_condition()
         and i.is_listed
         and public.is_position_sellable(i.id)
         -- Something without a price is not an offer, however released it is.
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
         -- The whole point. `available_quantity` is `quantity - reserved`,
         -- generated by the table (0003) — one definition, compared here,
         -- never returned.
         and i.available_quantity >= p_quantity
    );
$$;

revoke all on function public.shop_quantity_available(text, text, integer) from public;
grant execute on function public.shop_quantity_available(text, text, integer)
  to anon, authenticated;


-- 5c. create_order() — die Bestellung (zuletzt 0040)
create or replace function public.create_order(
  p_request_id      text,
  p_email           text,
  p_items           jsonb,
  p_address         jsonb,
  p_shipping_method text,
  p_payment_token   text
)
returns table (
  order_id        bigint,
  order_number    text,
  items_subtotal  numeric,
  shipping_amount numeric,
  total_amount    numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_number   text;
  v_user_id  uuid := (select auth.uid());
  v_item     jsonb;
  v_sky_id   text;
  v_cond     text;
  v_qty      integer;
  v_price    numeric(10,2);
  v_name     text;
  v_image    text;
  v_inv_id   bigint;
  v_line_total numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_lines    integer := 0;
  v_client   text;
  v_country  text;
  v_ship_name text;
  v_shipping numeric(10,2);
  v_token_hash text;
  v_existing record;

  -- The positions, priced and snapshotted, between pass 1 and pass 2. Never
  -- leaves this function and never reaches the caller.
  v_resolved jsonb := '[]'::jsonb;

  -- Which world this order belongs to, read once and stamped on the row.
  v_mode text := public.commerce_mode();
begin
  -- ---------------------------------------------------------------------------
  -- Before anything else, including the shape checks: may this caller buy?
  --
  -- The gate is here rather than in the server action because this function is
  -- reachable over PostgREST with the anon key. A check in TypeScript would be
  -- one request away from being skipped; this one cannot be.
  --
  -- Deliberately the same refusal for all three reasons — closed, not signed
  -- in, not a tester. A caller learns that they may not check out, not why,
  -- and not that a sandbox exists.
  -- ---------------------------------------------------------------------------
  if not public.commerce_checkout_allowed() then
    raise exception 'checkout is not open to this caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_request_id is null or length(p_request_id) < 8 then
    raise exception 'a checkout needs a request id' using errcode = 'check_violation';
  end if;

  -- The capability is required. An order nobody can prove they placed is an
  -- order nobody can pay for.
  if p_payment_token is null or length(p_payment_token) < 32 then
    raise exception 'a checkout needs a payment capability' using errcode = 'check_violation';
  end if;

  v_token_hash := encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex');

  -- Already done. Hand it back only to a caller that can prove it is the one
  -- that created it — the same token, not merely the same request id.
  select o.id, o.order_number, o.items_subtotal, o.shipping_amount, o.total_amount,
         o.payment_token_hash
    into v_existing
    from public.orders o
   where o.request_id = p_request_id;

  if found then
    if v_existing.payment_token_hash is distinct from v_token_hash then
      raise exception 'this checkout belongs to somebody else'
        using errcode = 'insufficient_privilege';
    end if;

    order_id        := v_existing.id;
    order_number    := v_existing.order_number;
    items_subtotal  := v_existing.items_subtotal;
    shipping_amount := v_existing.shipping_amount;
    total_amount    := v_existing.total_amount;
    return next;
    return;
  end if;

  if p_email is null or p_email not like '%@%' then
    raise exception 'a checkout needs a contact address' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_country := upper(coalesce(p_address ->> 'country_code', ''));
  /*
   * Asks the configuration, not a compiled-in country (ADR-0075).
   *
   * This is the authoritative check. The checkout form mirrors the same list
   * so it can offer a sensible field, but editing the client enables nothing:
   * an order for a country that is not enabled is refused here.
   */
  if not public.shipping_country_allowed(v_country) then
    raise exception 'this shop does not deliver to %', coalesce(nullif(v_country, ''), '(none)')
      using errcode = 'check_violation';
  end if;

  select c.name into v_ship_name
    from public.shipping_catalog() c
   where c.code = p_shipping_method;

  if v_ship_name is null then
    raise exception 'unknown shipping method %', coalesce(p_shipping_method, '(null)')
      using errcode = 'check_violation';
  end if;

  v_client := public.request_client_hash();
  perform public.enforce_checkout_limits(p_email, v_user_id, v_client);

  -- -------------------------------------------------------------------------
  -- Pass 1 — resolve and price every position. Writes nothing.
  --
  -- Identical to what the loop always did, except that the line is kept
  -- instead of inserted: the order it belongs to does not exist yet.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sky_id := v_item ->> 'sky_id';
    v_cond   := v_item ->> 'condition';
    v_qty    := nullif(v_item ->> 'quantity', '')::integer;

    if v_qty is null or v_qty < 1 or v_qty > public.max_cart_quantity() then
      raise exception 'invalid quantity for %', v_sky_id using errcode = 'check_violation';
    end if;

    -- V1 SELLS LOOSE ONLY (0028).
    --
    -- Validated explicitly rather than left to the lookup below. Without this,
    -- a boxed line would fall through to `article % / % is not offered`, which
    -- is misleading: the position exists, is listed, is eligible and is
    -- priced. What is wrong is the request, so it is refused the way every
    -- other unacceptable argument to this function is refused -- the same
    -- errcode an invalid quantity raises, which the application already maps
    -- to the same outcome (`UNAVAILABLE` in lib/commerce/actions.ts).
    --
    -- Placed in pass 1, which writes nothing: no order row exists yet, no
    -- line, no address, no reservation. See the header on atomicity.
    if v_cond is distinct from public.v1_sale_condition() then
      raise exception 'condition % is not offered', coalesce(v_cond, '(null)')
        using errcode = 'check_violation';
    end if;

    select i.id,
           public.shop_price(i.sale_price, s.market_price, st.price_percentage),
           coalesce(s.display_name_override, s.name),
           coalesce(s.image_override_path, s.image_file)
      into v_inv_id, v_price, v_name, v_image
      from public.shop_inventory i
      join public.skylanders s on s.sky_id = i.sky_id
      cross join public.shop_settings st
     where i.sky_id = v_sky_id
       and i.condition = v_cond
       and i.is_listed
       and public.is_position_sellable(i.id);

    if v_inv_id is null or v_price is null then
      raise exception 'article % / % is not offered', v_sky_id, v_cond
        using errcode = 'no_data_found';
    end if;

    v_line_total := round(v_price * v_qty, 2);

    v_resolved := v_resolved || jsonb_build_object(
      'inventory_id', v_inv_id,
      'sky_id',       v_sky_id,
      'condition',    v_cond,
      'quantity',     v_qty,
      'name',         v_name,
      'image',        v_image,
      'unit_price',   v_price,
      'line_total',   v_line_total
    );

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'a checkout needs at least one article' using errcode = 'check_violation';
  end if;

  v_shipping := public.shipping_amount_for(p_shipping_method, v_subtotal);

  -- -------------------------------------------------------------------------
  -- The order, with the amounts it will keep for ever.
  --
  -- This is the whole fix. `orders_protect_immutable()` sees one INSERT and
  -- no UPDATE, and `orders_total_is_the_sum` holds on the first row written:
  -- discount_amount defaults to 0, so total = subtotal + shipping - 0.
  -- -------------------------------------------------------------------------
  insert into public.orders
    (request_id, user_id, customer_email, client_hash, commerce_mode,
     items_subtotal, shipping_amount, total_amount,
     shipping_method_code, shipping_method_name, payment_token_hash)
  values
    (p_request_id, v_user_id, p_email, v_client, v_mode,
     v_subtotal, v_shipping, v_subtotal + v_shipping,
     p_shipping_method, v_ship_name, v_token_hash)
  returning id, orders.order_number into v_order_id, v_number;

  -- -------------------------------------------------------------------------
  -- Pass 2 — write the lines from pass 1's snapshots.
  --
  -- No lookup here, by design. Re-reading would risk pricing a line
  -- differently from the subtotal the order was just charged for.
  -- -------------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(v_resolved)
  loop
    insert into public.order_lines
      (order_id, sky_id, condition, quantity, name_snapshot, image_snapshot,
       unit_price, line_total, inventory_id)
    values
      (v_order_id,
       v_item ->> 'sky_id',
       v_item ->> 'condition',
       (v_item ->> 'quantity')::integer,
       v_item ->> 'name',
       v_item ->> 'image',
       (v_item ->> 'unit_price')::numeric(10,2),
       (v_item ->> 'line_total')::numeric(10,2),
       (v_item ->> 'inventory_id')::bigint);
  end loop;

  insert into public.order_addresses
    (order_id, kind, first_name, last_name, company, street, house_number,
     address_line_2, postal_code, city, country_code, phone)
  values
    (v_order_id, 'shipping',
     p_address ->> 'first_name', p_address ->> 'last_name', p_address ->> 'company',
     p_address ->> 'street', p_address ->> 'house_number', p_address ->> 'address_line_2',
     p_address ->> 'postal_code', p_address ->> 'city',
     v_country, p_address ->> 'phone');

  perform public.reserve_for_order(v_order_id);

  -- No token, no hash and no fragment of either: an event is a record of what
  -- happened, not a place to leak a secret.
  insert into public.order_events (order_id, event_type, actor_kind, actor_user_id)
  values (v_order_id, 'placed', case when v_user_id is null then 'system' else 'customer' end, v_user_id);

  order_id        := v_order_id;
  order_number    := v_number;
  items_subtotal  := v_subtotal;
  shipping_amount := v_shipping;
  total_amount    := v_subtotal + v_shipping;
  return next;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, text)
  to anon, authenticated;


-- 5d. reserve_for_order() — die letzte Pruefung unter Zeilensperre (0010)
--
-- DIE WICHTIGSTE DER VIER. Sie laeuft, nachdem die Bestellung steht, unter
-- `for update` auf jeder betroffenen Lagerzeile — und sie ist die Stelle,
-- an der eine Freigabe, die zwischen Warenkorb und Zahlung zurueckgenommen
-- wurde, den Kauf noch anhaelt.
create or replace function public.reserve_for_order(p_order_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids      bigint[];
  v_expires  timestamptz := now() + public.reservation_ttl();
  v_row      record;
  v_count    integer := 0;
begin
  select array_agg(distinct l.inventory_id order by l.inventory_id)
    into v_ids
    from public.order_lines l
   where l.order_id = p_order_id
     and l.inventory_id is not null;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'order % has no reservable lines', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Lock every position at once, always in the same order.
  perform 1
     from public.shop_inventory i
    where i.id = any (v_ids)
    order by i.id
      for update;

  -- 3. Now that they are held, reclaim anything that has run out of time.
  perform public.release_expired_reservations(v_ids);

  for v_row in
    select l.id, l.inventory_id, l.quantity, l.sky_id, l.condition
      from public.order_lines l
     where l.order_id = p_order_id
       and l.inventory_id is not null
     order by l.inventory_id
  loop
    -- 4. Still sellable at all? Same rules as shop_offers(), asked of the
    --    same functions rather than copied.
    if not exists (
      select 1
        from public.shop_inventory i
        join public.skylanders s on s.sky_id = i.sky_id
        cross join public.shop_settings st
       where i.id = v_row.inventory_id
         and i.is_listed
         and public.is_position_sellable(i.id)
         and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
    ) then
      raise exception 'article % / % is no longer offered', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    -- 5. The guard is the WHERE clause, not a preceding SELECT.
    update public.shop_inventory
       set reserved = reserved + v_row.quantity
     where id = v_row.inventory_id
       and quantity - reserved >= v_row.quantity;

    if not found then
      raise exception 'not enough stock for % / %', v_row.sky_id, v_row.condition
        using errcode = 'check_violation';
    end if;

    insert into public.order_reservations
      (order_id, inventory_id, quantity, expires_at)
    values
      (p_order_id, v_row.inventory_id, v_row.quantity, v_expires);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.reserve_for_order(bigint) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Die Betriebsdiagnose zieht mit (zuletzt 0041)
-- ---------------------------------------------------------------------------
create or replace function public.admin_shop_listing_audit()
returns table (
  sky_id     text,
  condition  text,
  is_listed  boolean,
  eligible   boolean,
  reason     text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      i.sky_id,
      i.condition,
      i.is_listed,
      public.is_position_sellable(i.id),
      -- 0139: der Grund folgt jetzt demselben Weg wie das Praedikat
      -- daneben. Vorher endete die Leiter bei 'not a collectible' — fuer
      -- eine freigegebene Zubehoerposition haette sie damit ein Hindernis
      -- genannt, das keines mehr ist, waehrend die Spalte links `true` sagt.
      case
        when s.sky_id is null            then 'no catalog row'
        when not s.is_active             then 'inactive figure'
        when not s.catalog_visible       then 'editorially hidden'
        when s.item_type = 'figure'
             and c.name = any (public.non_collectible_categories())
                                         then 'not a collectible'
        when s.item_type not in ('figure', 'game', 'portal')
                                         then 'item type not sold'
        when s.item_type = 'game' and s.usk_rating is null
                                         then 'usk rating missing'
        when s.item_type = 'game' and s.usk_rating = 18
                                         then 'usk 18 needs age verification'
        when s.item_type <> 'figure' and i.delivery_scope is null
                                         then 'delivery scope missing'
        when s.item_type <> 'figure' and not i.sale_released
                                         then 'not released for sale'
        else null
      end
      from public.shop_inventory i
      left join public.skylanders s on s.sky_id = i.sky_id
      left join public.categories c on c.id = s.category_id
     order by i.sky_id, i.condition;
end;
$$;

revoke all on function public.admin_shop_listing_audit() from public, anon;
grant execute on function public.admin_shop_listing_audit() to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Die zwei Betriebsfunktionen
--
-- Freigeben ist ein eigener Akt und bekommt deshalb eine eigene Funktion.
-- `set_shop_listing()` bleibt, was sie ist — Preis, Listung, interne Notiz —,
-- und wird NICHT erweitert: wer Preis und Freigabe in einen Aufruf legt, gibt
-- irgendwann versehentlich beim Preispflegen frei.
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_sale_release(
  p_sky_id    text,
  p_condition text,
  p_released  boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     bigint;
  v_art    text;
  v_usk    smallint;
  v_umfang text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_released is null then
    raise exception 'sale release must be true or false, not null'
      using errcode = 'null_value_not_allowed';
  end if;

  /*
   * SIE LEGT KEINE POSITION AN. `set_shop_listing()` tut das (mit Menge 0),
   * weil ein Preis auch fuer etwas gesetzt werden darf, das gerade nicht da
   * ist. Eine Freigabe fuer eine Position, die es nicht gibt, ist dagegen
   * eine Freigabe fuer nichts.
   */
  select i.id, s.item_type, s.usk_rating, i.delivery_scope
    into v_id, v_art, v_usk, v_umfang
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where i.sky_id = p_sky_id
     and i.condition = p_condition;

  if v_id is null then
    raise exception 'no stock position for % / %', p_sky_id,
      coalesce(p_condition, '(null)')
      using errcode = 'no_data_found';
  end if;

  /*
   * EINE FIGUR WIRD ABGELEHNT, statt stillschweigend nichts zu bewirken.
   * Das Tor fragt `sale_released` fuer Figuren nicht; ein Schalter, von dem
   * schon bekannt ist, dass er nicht wirkt, ist keine Auswahl, sondern eine
   * Falle (dieselbe Begruendung wie in `0108`).
   */
  if v_art = 'figure' then
    raise exception 'a figure needs no sale release; is_shop_eligible decides (0008)'
      using errcode = 'check_violation';
  end if;

  if v_art not in ('game', 'portal') then
    raise exception 'item type % is not sold by SkyIsles', v_art
      using errcode = 'check_violation';
  end if;

  /*
   * EIN SPIEL OHNE USK-KENNZEICHNUNG WIRD NICHT FREIGEGEBEN.
   *
   * Nur beim FREIGEBEN geprueft, nie beim Zuruecknehmen: eine Freigabe
   * zurueckzunehmen muss immer moeglich sein, auch wenn die Angaben
   * unvollstaendig sind. Ein Riegel, der das Abschalten verhindert, ist ein
   * Riegel in die falsche Richtung.
   */
  if p_released and v_art = 'game' and v_usk is null then
    raise exception
      'game % has no USK rating recorded; record it before releasing it for sale',
      p_sky_id
      using errcode = 'check_violation';
  end if;

  /*
   * UND EIN SPIEL AB 18 WIRD GAR NICHT FREIGEGEBEN.
   *
   * § 12 JuSchG: ein Bildtraeger mit „Keine Jugendfreigabe" darf im
   * Versandhandel nur abgegeben werden, wenn sichergestellt ist, dass kein
   * Minderjaehriger ihn erhaelt — Altersverifikation bei Bestellung UND
   * eine Zustellung nur an Erwachsene. SkyIsles hat beides nicht: der
   * Checkout kennt kein Geburtsdatum und der Versand kein Ident-Verfahren.
   *
   * Der Riegel ist deshalb technisch und nicht redaktionell: solange die
   * Verifikation fehlt, gibt es keinen zulaessigen Weg, so einen Artikel
   * zu verkaufen. Kommt sie, faellt dieser Block — eine Zeile, eine eigene
   * Entscheidung. Fuer die Skylanders-Titel ist er heute ohne praktische
   * Wirkung (USK 0 und 6), und genau deshalb kostet er nichts.
   */
  if p_released and v_art = 'game' and v_usk = 18 then
    raise exception
      'game % is rated USK 18; SkyIsles has no age verification at checkout '
      'or delivery, so it cannot be released for sale', p_sky_id
      using errcode = 'check_violation';
  end if;

  /*
   * UND OHNE ANGABE ZUM LIEFERUMFANG AUCH NICHT.
   *
   * Dieselbe Bauart wie der USK-Riegel: nur beim Freigeben geprueft, nie
   * beim Zuruecknehmen. Ein Angebot fuer gebrauchte Ware, das nicht sagt,
   * was im Paket liegt, ist eine unvollstaendige Produktangabe.
   */
  if p_released and v_umfang is null then
    raise exception
      'position % / % has no delivery scope; set it before releasing it for sale',
      p_sky_id, p_condition
      using errcode = 'check_violation';
  end if;

  -- Nur die lose Beschaffenheit wird verkauft (0028/0029/0108).
  if p_condition is distinct from public.v1_sale_condition() then
    raise exception 'SkyIsles sells % only; % is not an operative position',
      public.v1_sale_condition(), coalesce(p_condition, '(null)')
      using errcode = 'check_violation';
  end if;

  update public.shop_inventory
     set sale_released = p_released
   where id = v_id;

  return v_id;
end;
$$;

comment on function public.seller_set_sale_release(text, text, boolean) is
  'Releases ONE accessory stock position for public sale, or takes the release back (0139). Refuses a figure (there the release is implicit and the switch would do nothing), an item type SkyIsles does not sell, a position that does not exist, a condition other than the one V1 sells, and a GAME without a recorded usk_rating. The USK check guards releasing only, never un-releasing. Touches neither price nor is_listed nor quantity.';

revoke all on function public.seller_set_sale_release(text, text, boolean)
  from public, anon;
grant execute on function public.seller_set_sale_release(text, text, boolean)
  to authenticated;


create or replace function public.seller_set_delivery_scope(
  p_sky_id    text,
  p_condition text,
  p_scope     text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  bigint;
  v_art text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select i.id, s.item_type
    into v_id, v_art
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where i.sky_id = p_sky_id
     and i.condition = p_condition;

  if v_id is null then
    raise exception 'no stock position for % / %', p_sky_id,
      coalesce(p_condition, '(null)')
      using errcode = 'no_data_found';
  end if;

  /*
   * EINE FIGUR HAT KEINEN LIEFERUMFANG ZU WAEHLEN. Dort beantwortet
   * `condition` die Frage vollstaendig, und das Tor fragt die Spalte nicht
   * — ein Feld ohne Wirkung ist dieselbe Falle wie ein Schalter ohne
   * Wirkung.
   */
  if v_art = 'figure' then
    raise exception 'a figure has no delivery scope; condition already says it'
      using errcode = 'check_violation';
  end if;

  /*
   * DAS VOKABULAR GEHOERT ZUR ARTIKELART. `disc_case` an einem Portal
   * waere Unsinn, `portal_cable` an einem Spiel auch. Der CHECK der
   * Tabelle kennt nur die Wertemenge; welcher Wert zu welcher Art passt,
   * steht hier, weil `item_type` auf einer anderen Tabelle liegt.
   *
   * NULL ist erlaubt und heisst „wieder ohne Angabe" — damit laesst sich
   * eine falsche Angabe zuruecknehmen. Eine Position ohne Angabe ist nicht
   * freigebbar, also ist das Zuruecknehmen sicher.
   */
  if p_scope is not null then
    if v_art = 'game' and p_scope not in ('disc_only', 'disc_manual', 'disc_case') then
      raise exception 'delivery scope % is not one a game can have', p_scope
        using errcode = 'check_violation';
    end if;
    if v_art = 'portal' and p_scope not in ('portal_only', 'portal_cable') then
      raise exception 'delivery scope % is not one a portal can have', p_scope
        using errcode = 'check_violation';
    end if;
    if v_art not in ('game', 'portal') then
      raise exception 'item type % has no delivery scope vocabulary', v_art
        using errcode = 'check_violation';
    end if;
  end if;

  /*
   * `disc_case` an einer losen Position lehnt der CHECK
   * `shop_inventory_case_is_not_loose` ab — und zwar mit einer Meldung,
   * die niemand versteht. Deshalb hier zuerst, im Klartext.
   */
  if p_scope = 'disc_case'
     and (select condition from public.shop_inventory where id = v_id)
         = public.v1_sale_condition() then
    raise exception
      'a game with its original case is not %; the original-case scope belongs to a '
      'position in another condition, and V1 sells % only',
      public.v1_sale_condition(), public.v1_sale_condition()
      using errcode = 'check_violation';
  end if;

  update public.shop_inventory
     set delivery_scope = p_scope
   where id = v_id;

  return v_id;
end;
$$;

comment on function public.seller_set_delivery_scope(text, text, text) is
  'Sets what is delivered with ONE accessory stock position (0139): disc_only | disc_manual | disc_case for a game, portal_only | portal_cable for a portal, or NULL to take the statement back. Refuses a figure (condition already answers it there), a vocabulary that does not fit the item type, and disc_case on a loose position — for a game loose means "medium without its original case", and the two statements may not contradict each other. Touches neither price, nor is_listed, nor sale_released, nor quantity.';

revoke all on function public.seller_set_delivery_scope(text, text, text)
  from public, anon;
grant execute on function public.seller_set_delivery_scope(text, text, text)
  to authenticated;


create or replace function public.admin_set_usk_rating(
  p_sky_id text,
  p_rating smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art text;
begin
  /*
   * DER PLATTFORMADMIN, NICHT DER BETRIEB. Eine Alterskennzeichnung ist
   * Katalogdatum wie `display_name_override` und `catalog_visible` — sie
   * gehoert dem Artikel und nicht dem Regal (ADR-0039, ADR-0077).
   */
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  select item_type into v_art from public.skylanders where sky_id = p_sky_id;

  if v_art is null then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;

  /*
   * NUR SPIELE. Ein Portal ist Hardware und traegt keine USK-Kennzeichnung;
   * eine Figur erst recht nicht. Eine Angabe an einer Zeile, die sie nicht
   * haben kann, waere eine erfundene Produktinformation.
   */
  if v_art <> 'game' then
    raise exception 'only a game carries a USK rating; % is a %', p_sky_id, v_art
      using errcode = 'check_violation';
  end if;

  -- NULL ist erlaubt und heisst „wieder als nicht erfasst fuehren".
  update public.skylanders set usk_rating = p_rating where sky_id = p_sky_id;
end;
$$;

comment on function public.admin_set_usk_rating(text, smallint) is
  'Records the USK age rating of a GAME (0139), or sets it back to NULL = not recorded. Platform administrator only. Refuses every item type but game: a portal is hardware and carries no rating, and an invented one is worse than none. The value is never derived from a name — the source is the sleeve or the USK title database.';

revoke all on function public.admin_set_usk_rating(text, smallint) from public, anon;
grant execute on function public.admin_set_usk_rating(text, smallint) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Nachbedingungen — und der Beweis, dass nichts kaufbar geworden ist
-- ---------------------------------------------------------------------------
do $$
declare
  v_soll text;
  v_ist  text;
  v_n    integer;
begin
  -- 8a. Die beiden Spalten stehen, mit der richtigen Vorgabe.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'sale_released'
                    and is_nullable = 'NO' and column_default like '%false%') then
    raise exception '0139 Abbruch: sale_released fehlt, ist nullable oder hat nicht die Vorgabe false';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'usk_rating' and is_nullable = 'YES') then
    raise exception '0139 Abbruch: usk_rating fehlt oder ist not null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'skylanders_usk_rating_known') then
    raise exception '0139 Abbruch: der CHECK auf usk_rating fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shop_inventory'
                    and column_name = 'delivery_scope' and is_nullable = 'YES') then
    raise exception '0139 Abbruch: delivery_scope fehlt oder ist not null';
  end if;
  for v_soll in select unnest(array['shop_inventory_delivery_scope_known',
                                    'shop_inventory_case_is_not_loose']) loop
    if not exists (select 1 from pg_constraint where conname = v_soll) then
      raise exception '0139 Abbruch: der CHECK % fehlt', v_soll;
    end if;
  end loop;

  -- 8a2. Kein Lieferumfang wurde gesetzt. Wie bei der Freigabe: die
  --      Migration baut das Feld, sie fuellt es nicht.
  select count(*) into v_n from public.shop_inventory where delivery_scope is not null;
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Positionen tragen einen Lieferumfang, erwartet 0', v_n;
  end if;

  -- 8a3. Die oeffentliche Projektion hat jetzt fuenf Spalten.
  --      Gefragt wird `pg_proc`, nicht `information_schema.columns`:
  --      `shop_offers` ist eine Funktion und keine Sicht, und die Sicht
  --      haette stillschweigend 0 Zeilen geliefert — eine Pruefung, die
  --      immer zustimmt.
  select count(*) into v_n
    from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(nm, md)
   where p.oid = to_regprocedure('public.shop_offers()') and a.md = 't';
  if v_n <> 5 then
    raise exception '0139 Abbruch: shop_offers liefert % Spalten statt fuenf', v_n;
  end if;
  if not exists (
    select 1 from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(nm, md)
     where p.oid = to_regprocedure('public.shop_offers()')
       and a.md = 't' and a.nm = 'delivery_scope') then
    raise exception '0139 Abbruch: shop_offers nennt delivery_scope nicht';
  end if;

  -- 8a4. Und sie ist fuer jedes Figurenangebot leer.
  select count(*) into v_n from public.shop_offers() o
   where o.delivery_scope is not null;
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Angebote tragen einen Lieferumfang, erwartet 0', v_n;
  end if;

  -- 8b. KEINE EINZIGE POSITION IST FREIGEGEBEN. Der wichtigste Satz dieser Datei.
  select count(*) into v_n from public.shop_inventory where sale_released;
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Positionen stehen auf sale_released = true, erwartet 0', v_n;
  end if;

  -- 8c. Und keine einzige USK-Angabe wurde erfunden.
  select count(*) into v_n from public.skylanders where usk_rating is not null;
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Zeilen tragen eine USK-Angabe, erwartet 0', v_n;
  end if;

  -- 8d. Das Tor am ARTIKEL ist unberuehrt: 534 bleibt 534.
  v_soll := (select wert from z4_abdruck where schluessel = 'shopfaehig');
  select count(*) into v_n from public.skylanders s where public.is_shop_eligible(s.sky_id);
  if v_n::text <> v_soll then
    raise exception '0139 Abbruch: % shopfaehige Zeilen, erwartet % — is_shop_eligible wurde veraendert',
      v_n, v_soll;
  end if;

  -- 8e. Das NEUE Tor gibt fuer jede Position dieselbe Antwort wie das alte.
  --     Das ist die eigentliche Gleichheitspruefung: Zeile fuer Zeile, nicht
  --     als Summe. Eine Figur, die verschwindet, und ein Zubehoerteil, das
  --     dazukommt, heben sich in einer Summe auf — hier nicht.
  select count(*) into v_n
    from public.shop_inventory i
   where public.is_position_sellable(i.id) is distinct from public.is_shop_eligible(i.sky_id);
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Positionen antworten am neuen Tor anders als am alten', v_n;
  end if;

  -- 8f. Die oeffentliche Projektion ist Zeichen fuer Zeichen dieselbe.
  v_soll := (select wert from z4_abdruck where schluessel = 'angebote');
  select count(*) into v_n from public.shop_offers();
  if v_n::text <> v_soll then
    raise exception '0139 Abbruch: % Angebote, erwartet %', v_n, v_soll;
  end if;

  v_soll := (select wert from z4_abdruck where schluessel = 'angebote_md5');
  select coalesce(md5(string_agg(o.sky_id || '|' || o.condition || '|'
                                 || o.price::text || '|' || o.available::text,
                                 E'\n' order by o.sky_id, o.condition)), '(leer)')
    into v_ist from public.shop_offers() o;
  if v_ist <> v_soll then
    raise exception '0139 Abbruch: der Angebotsabdruck hat sich geaendert (% statt %)',
      v_ist, v_soll;
  end if;

  -- 8g. Kein Zubehoerteil steht im Angebot.
  select count(*) into v_n
    from public.shop_offers() o
    join public.skylanders s on s.sky_id = o.sky_id
   where s.item_type <> 'figure';
  if v_n <> 0 then
    raise exception '0139 Abbruch: % Zubehoerangebote entstanden, erwartet 0', v_n;
  end if;

  -- 8h. Lager, Listung und Preise sind unberuehrt — auch die 13 Altlastzeilen.
  for v_soll, v_ist in
    select z.wert,
           case z.schluessel
             when 'lagerzeilen'  then (select count(*)::text from public.shop_inventory)
             when 'gelistet'     then (select count(*)::text from public.shop_inventory
                                        where is_listed)
             when 'gelistet_md5' then (select coalesce(md5(string_agg(
                                         i.id::text || '|' || i.is_listed::text || '|'
                                         || coalesce(i.sale_price::text, '-'),
                                         E'\n' order by i.id)), '(leer)')
                                         from public.shop_inventory i)
             when 'katalogzeilen' then (select count(*)::text from public.skylanders)
             when 'sichtbar'      then (select count(*)::text from public.skylanders
                                         where catalog_visible)
             when 'sammelbar'     then (select count(*)::text from public.skylanders s
                                          join public.categories c on c.id = s.category_id
                                         where s.is_active
                                           and not (c.name = any (
                                                 public.non_collectible_categories())))
           end
      from z4_abdruck z
     where z.schluessel in ('lagerzeilen', 'gelistet', 'gelistet_md5',
                            'katalogzeilen', 'sichtbar', 'sammelbar')
  loop
    if v_ist is distinct from v_soll then
      raise exception '0139 Abbruch: ein Abdruck hat sich geaendert (% statt %)', v_ist, v_soll;
    end if;
  end loop;

  -- 8h2. Die Betriebsdiagnose kennt die vier neuen Gruende.
  for v_soll in select unnest(array['item type not sold', 'usk rating missing',
                                    'usk 18 needs age verification',
                                    'delivery scope missing', 'not released for sale']) loop
    if position(v_soll in (select prosrc from pg_proc
                            where oid = to_regprocedure('public.admin_shop_listing_audit()')))
       = 0 then
      raise exception '0139 Abbruch: die Betriebsdiagnose kennt den Grund "%" nicht', v_soll;
    end if;
  end loop;

  -- 8i. Die vier Tueren und die drei neuen Funktionen stehen.
  if to_regprocedure('public.is_position_sellable(bigint)') is null
     or to_regprocedure('public.seller_set_sale_release(text, text, boolean)') is null
     or to_regprocedure('public.seller_set_delivery_scope(text, text, text)') is null
     or to_regprocedure('public.admin_set_usk_rating(text, smallint)') is null then
    raise exception '0139 Abbruch: eine der vier neuen Funktionen fehlt';
  end if;
  if exists (
    select 1 from pg_proc p
     where p.oid in (to_regprocedure('public.shop_offers()'),
                     to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                     to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                     to_regprocedure('public.reserve_for_order(bigint)'))
       and position('is_position_sellable' in p.prosrc) = 0
  ) then
    raise exception '0139 Abbruch: eine der vier Tueren fragt das neue Tor nicht';
  end if;

  -- 8j. Und keine von ihnen fragt das alte noch direkt.
  if exists (
    select 1 from pg_proc p
     where p.oid in (to_regprocedure('public.shop_offers()'),
                     to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                     to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                     to_regprocedure('public.reserve_for_order(bigint)'))
       and position('is_shop_eligible' in p.prosrc) > 0
  ) then
    raise exception '0139 Abbruch: eine Tuer ruft is_shop_eligible noch direkt';
  end if;

  -- 8k. Die Belegsperre ist unberuehrt. Diese Datei fasst sie nicht an;
  --     geprueft wird es trotzdem, weil „nicht angefasst" und „noch dicht"
  --     zwei Aussagen sind.
  if exists (
    select 1
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
       and g.grantee in ('anon', 'authenticated')
  ) then
    raise exception '0139 Abbruch: die Belegsperre ist offen';
  end if;

  raise notice '0139 ok: Freigabe und USK stehen, 0 Positionen freigegeben, '
    '% shopfaehig, % Angebote unveraendert (md5 %), kein Zubehoerangebot',
    (select wert from z4_abdruck where schluessel = 'shopfaehig'),
    (select wert from z4_abdruck where schluessel = 'angebote'),
    (select wert from z4_abdruck where schluessel = 'angebote_md5');
end $$;
