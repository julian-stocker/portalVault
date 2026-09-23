-- ===========================================================================
-- 0094 — Ein temporärer Aufschlag auf den ANGEZEIGTEN Katalog-Marktwert
--
-- WAS DAS IST, UND VOR ALLEM, WAS ES NICHT IST
--
-- `skylanders.market_price` ist heute faktisch der Shoppreis eines
-- Mitbewerbers und liegt nach Einschätzung des Betreibers rund fünf Prozent
-- unter dem realen Marktwert. Bis ein besserer Preis tatsächlich berechnet
-- werden kann, soll der ÖFFENTLICHE KATALOG einen aufgeschlagenen Wert
-- anzeigen.
--
-- Das hier ist deshalb eine ANZEIGEEINSTELLUNG und sonst nichts. Der
-- kanonische Marktpreis bleibt unverändert, und keine Berechnung liest diesen
-- Prozentsatz:
--
--   Shoppreis          `shop_price(override, market_price, percentage)`
--                      rechnet weiter aus `skylanders.market_price`
--   Snapshots          `sale_items.market_price_snapshot` und
--                      `legacy_stock_events.market_price_snapshot` werden
--                      weiter aus dem gespeicherten Wert eingefroren
--   Buy-in-Faktor      unberührt
--   Sammlung           bewertet weiter mit dem gespeicherten Wert
--   Lager, Orderbuch   unberührt
--
-- Diese Migration ändert KEINE Daten. Sie legt eine Spalte mit Default an,
-- erweitert einen Lesepfad und fügt zwei Funktionen hinzu.
--
-- WARUM `platform_settings` UND NICHT `shop_settings`
--
-- Der Katalog gehört SkyIsles, dem Plattformbetreiber (ADR-0064, ADR-0076).
-- `shop_settings.price_percentage` ist die Konfiguration des VERKÄUFERS und
-- wird seit 0041 unter `/business` bearbeitet. Eine Katalogeinstellung dort
-- wäre genau die Vermischung der beiden Rollen, die 0041 aufgelöst hat.
--
-- WARUM EINE EIGENE ÖFFENTLICHE FUNKTION
--
-- `platform_settings` ist für `anon` und `authenticated` gesperrt und bleibt
-- es. `platform_settings_public()` existiert, ist aber niemandem gewährt und
-- hat einen anderen Vertrag (Kontaktadressen). Der Katalog braucht genau eine
-- Zahl, also gibt es genau eine Funktion, die genau diese eine Zahl
-- zurückgibt — kein Tabellenzugriff, keine zweite Spalte, kein Nebeneffekt.
--
-- RÜCKBAU. Spalte fallen lassen, die beiden Funktionen fallen lassen, den
-- Lesepfad zurücknehmen. Es wurde nichts migriert und nichts überschrieben.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Spalte
--
-- `numeric`, nie float: 0,1 + 0,2 hat in Geldnähe nichts zu suchen — dieselbe
-- Begründung wie bei `shop_settings.price_percentage`. Zwei Nachkommastellen,
-- damit 7,5 % ausdrückbar ist.
--
-- Die Grenzen sind eine Tippfehlerbremse, keine Produktregel: 0 ist erlaubt
-- und bedeutet „aus", 50 ist weit über allem, was hier je sinnvoll wäre, und
-- fängt die 500-statt-5-Eingabe ab.
-- ---------------------------------------------------------------------------

alter table public.platform_settings
  add column if not exists catalog_market_boost_percent numeric(5,2) not null default 5.00;

alter table public.platform_settings
  drop constraint if exists platform_settings_catalog_boost_sane;
alter table public.platform_settings
  add constraint platform_settings_catalog_boost_sane
  check (catalog_market_boost_percent >= 0 and catalog_market_boost_percent <= 50);

comment on column public.platform_settings.catalog_market_boost_percent is
  'TEMPORARY DISPLAY ONLY (0094). Percent added to skylanders.market_price when the PUBLIC CATALOG prints a market value: 5.00 means a stored 10.00 is shown as 10.50. Read by nothing that calculates — shop_price(), the buy-in factor, every market_price_snapshot and the collection value all keep using the stored price unchanged. 0 switches the visible effect off.';


-- ---------------------------------------------------------------------------
-- 2. Der Admin-Lesepfad, um das Feld erweitert
--
-- Byte für byte die Fassung aus 0041, plus eine Spalte. Gate
-- (`is_platform_admin()`), `security definer`, `search_path` und `stable`
-- bleiben, wie sie sind.
--
-- Vorher fallen gelassen, aus demselben Grund, aus dem 0041 es tat: die
-- Funktion bekommt eine Spalte dazu, und PostgreSQL kann einen Rückgabetyp
-- nicht an Ort und Stelle ändern.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_platform_settings();

create or replace function public.admin_platform_settings()
returns table (
  contact_email                text,
  support_email                text,
  catalog_market_boost_percent numeric,
  updated_at                   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select p.contact_email, p.support_email, p.catalog_market_boost_percent, p.updated_at
      from public.platform_settings p;
end;
$$;

comment on function public.admin_platform_settings() is
  'The platform''s own facts, for the admin area (ADR-0064): the two published addresses and, since 0094, the temporary catalog market-value boost. Separate from admin_seller(): two subjects, two readers.';


-- ---------------------------------------------------------------------------
-- 3. Schreiben — Plattformadministrator, niemand sonst
--
-- Dasselbe Gate wie jede andere Plattformeinstellung: `is_platform_admin()`.
-- Ein Seller-Operator hält es nicht — `can_operate_active_seller()` ist eine
-- andere Frage —, und `admin_set_shop_percentage()`, die Einstellung des
-- Verkäufers, bleibt davon unberührt. Zwei Einstellungen, zwei Schreiber,
-- zwei Bedeutungen.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_catalog_market_boost(p_percent numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Hier UND in der CHECK-Bedingung, damit der Aufrufer einen Satz über den
  -- Prozentsatz bekommt statt eines Constraint-Namens.
  if p_percent is null or p_percent < 0 or p_percent > 50 then
    raise exception 'the catalog market boost must be between 0 and 50 percent'
      using errcode = 'check_violation';
  end if;

  update public.platform_settings
     set catalog_market_boost_percent = round(p_percent, 2),
         updated_at                   = now(),
         updated_by                   = (select auth.uid())
   where id;
end;
$$;

comment on function public.admin_set_catalog_market_boost(numeric) is
  'Sets the temporary catalog market-value boost (0094), 0 to 50 percent, rounded to two decimals. Platform administrator only. Touches no price, no snapshot and no seller setting — it changes what the public catalog PRINTS, nothing that is calculated.';


-- ---------------------------------------------------------------------------
-- 4. Lesen — der öffentliche Katalog, und nur diese eine Zahl
--
-- Der Katalog ist ohne Konto vollständig nutzbar, also muss `anon` den Wert
-- lesen können. Was dabei herausgeht, ist ein Prozentsatz, den der Betreiber
-- selbst gesetzt hat — keine Lagerzahl, keine Kundendaten, keine zweite
-- Spalte. `platform_settings` selbst bleibt für jede Clientrolle gesperrt;
-- diese Funktion ist der einzige Weg an den Wert, und sie kennt nur ihn.
-- ---------------------------------------------------------------------------

create or replace function public.catalog_market_boost()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p.catalog_market_boost_percent from public.platform_settings p;
$$;

comment on function public.catalog_market_boost() is
  'The temporary catalog market-value boost in percent (0094). The one public read: it returns a single number and opens no access to platform_settings. Display only — nothing that computes a price reads it.';


-- ---------------------------------------------------------------------------
-- 5. Rechte
--
-- Die neuen Funktionen bekommen genau das, was sie brauchen. An der RLS von
-- `platform_settings` ändert sich nichts: `revoke all … from anon,
-- authenticated` aus 0026 gilt unverändert weiter.
-- ---------------------------------------------------------------------------

/*
 * Der Lesepfad wurde oben fallen gelassen und neu angelegt, und eine frisch
 * angelegte Funktion hält in PostgreSQL EXECUTE für PUBLIC. Ohne die nächsten
 * zwei Zeilen wäre sie also weiter offen als 0026 sie gesetzt hat — das Gate
 * im Rumpf schützt sie zwar, aber die Zusicherung „nur `authenticated` darf
 * sie überhaupt rufen" wäre verloren. Hier wiederhergestellt, wortgleich zu
 * 0026, Zeile 450/451.
 */
revoke all on function public.admin_platform_settings() from public, anon;
grant execute on function public.admin_platform_settings() to authenticated;

revoke all on function public.admin_set_catalog_market_boost(numeric) from public, anon;
grant execute on function public.admin_set_catalog_market_boost(numeric) to authenticated;

revoke all on function public.catalog_market_boost() from public;
grant execute on function public.catalog_market_boost() to anon, authenticated;
