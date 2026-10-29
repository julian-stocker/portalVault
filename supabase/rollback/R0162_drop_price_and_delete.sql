-- ===========================================================================
-- RUECKNAHME VON 0162 — die zwei Admin-Funktionen wieder entfernen
--
-- WAS SIE TUT: `drop function` auf `admin_set_market_price(text, numeric)`
-- und `admin_delete_figure(text)`. Danach gibt es den Marktwert nur noch im
-- Bearbeitungsdialog und keine Loeschung ausser `admin_discard_draft` fuer
-- Entwuerfe (`0155`).
--
-- WAS SIE NICHT ANFASST:
--
--   * KEINE ZEILE. Ein geschriebener Marktwert bleibt geschrieben, eine
--     geloeschte Figur bleibt geloescht — eine Ruecknahme der FUNKTION ist
--     keine Ruecknahme ihrer Wirkung, und eine geloeschte Katalogzeile kaeme
--     ohnehin nicht zurueck (die SKY-ID wird nicht wiederverwendet).
--   * KEINE JOURNALZEILE. Jede Preisaenderung und jede Loeschung steht in
--     `catalog_admin_changes` und bleibt dort — das ist der Zweck eines
--     Journals.
--   * DIE AUDIT-CONSTRAINT WIRD NICHT ZURUECKGEDREHT. Sie kennt nach `0162`
--     vierzehn Werte; zwei davon stehen jetzt in echten Journalzeilen. Nimmt
--     man sie aus der Liste, ist die Tabelle mit ihrer eigenen Historie
--     unvereinbar — und ein `delete` auf das Journal waere Datenverlust
--     statt Ruecknahme. Die Liste bleibt also, wie `0162` sie gesetzt hat.
--   * Keine Funktion aus `0152`, `0154`, `0155`, `0158`, `0159` oder `0161`.
--   * Keine Datei in Supabase Storage.
--
-- SIE IST IDEMPOTENT: stehen die Funktionen nicht, laeuft sie durch.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

drop function if exists public.admin_set_market_price(text, numeric);
drop function if exists public.admin_delete_figure(text);

do $nach$
declare
  v_def   text;
  v_preis bigint;
begin
  if to_regprocedure('public.admin_set_market_price(text,numeric)') is not null
     or to_regprocedure('public.admin_delete_figure(text)') is not null then
    raise exception 'R0162 Nachbedingung: eine der Funktionen steht noch';
  end if;

  -- Die Wege der anderen Migrationen muessen stehen.
  if to_regprocedure('public.admin_discard_draft(text)') is null
     or to_regprocedure('public.admin_merge_references(text)') is null
     or to_regprocedure('public.admin_set_catalog_status(text,text)') is null
     or to_regprocedure('public.admin_publish_variant_auto(text,text)') is null then
    raise exception 'R0162 Nachbedingung: eine fremde Funktion ist mit entfernt '
      'worden — das waere ein Schritt zu viel';
  end if;

  -- Und die Constraint kennt die vierzehn Werte weiter.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null or v_def not like '%market_price%' or v_def not like '%deleted%' then
    raise exception 'R0162 Nachbedingung: die Audit-Constraint ist zurueckgedreht '
      'worden. Sie muss die vierzehn Werte behalten, sonst ist die Tabelle mit '
      'ihrer eigenen Historie unvereinbar.';
  end if;

  select count(*) into v_preis from public.catalog_admin_changes
   where field in ('market_price', 'deleted');
  raise notice 'R0162: die zwei Funktionen sind fort. Unberuehrt: % Journalzeile(n) '
    'zu Preis und Loeschung, und jede Katalogzeile.', v_preis;
end
$nach$;
