-- ===========================================================================
-- 0133 auf Production — rein lesende Nachpruefung
--
-- WOZU. `0133` wurde am 2026-10-18 unbeabsichtigt auf Production angewendet
-- (`docs/history/2026-10-18-production-0132-0133.md`). Der Postflight war
-- `9999 = 0`, der Trigger steht also in der vorgesehenen Form. Offen ist die
-- andere Frage: **faellt er einem regulaeren Ablauf in den Weg?**
--
-- Ein Trigger BEFORE UPDATE auf `purchases` feuert bei JEDEM UPDATE der
-- Tabelle — auch bei denen, die mit der bezahlten Summe nichts zu tun haben.
-- Diese Datei zaehlt deshalb nicht nur den Trigger, sondern sucht im Schema
-- nach jeder Funktion, die `purchases` schreibt, und prueft, ob sie eines der
-- drei festgehaltenen Felder anfasst.
--
-- REIN LESEND. Ein einziges SELECT. Kein Trigger wird abgeschaltet, keine
-- Zeile angefasst, keine Transaktion offen gelassen. Zeile 9999 muss 0 zeigen.
--
-- WAS SIE NICHT BEWEISEN KANN. Statischer Text, kein Lauf. Dass ein UPDATE
-- ohne `total_cost` wirklich durchlaeuft, zeigt erst ein Schreibvorgang. Der
-- gehoert auf Staging und in die Oberflaeche, nicht in den Production-
-- SQL-Editor: `supabase/checks/0132_test_plan.md`, Faelle H7 bis H9.
--
-- Was sie dafuer leistet: 201-205 zeigen, dass von den Funktionen, die
-- `purchases` ueberhaupt schreiben, genau eine die bezahlte Summe anfasst —
-- und die traegt den Riegel seit `0132` selbst. Alle uebrigen schreiben
-- Datum, Testkennzeichen, Tagesreihenfolge, Aufteilung oder nur
-- `updated_at`; sie laufen durch.
-- ===========================================================================

with
trg as (
  select t.tgname, t.tgenabled, t.tgtype::integer as typ, p.prosrc, p.proname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc  p on p.oid = t.tgfoid
   where not t.tgisinternal
     and c.relname = 'purchases'
),
riegel as (
  select * from trg where tgname = 'purchases_paid_total_immutable_trg'
),
-- Jede Funktion im Schema, die `purchases` schreibt. `prosrc` ist Text, also
-- eine Suche und kein Parser — grob in die sichere Richtung: sie findet mehr,
-- nicht weniger.
schreiber as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prosrc like '%update public.purchases%'
),
-- Dieselben Funktionen, aber nur die, die eines der drei gehaltenen Felder
-- auf der linken Seite einer Zuweisung tragen.
heikel as (
  select proname, args from schreiber
   where prosrc ~ 'total_cost\s*=' or prosrc ~ 'currency\s*=' or prosrc ~ '\bsource\s*='
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- -------------------------------------------------------------- Umgebung
  (1, 'Umgebung', 'Info: Testfiguren SKY-9101/SKY-9998 (Staging 2, Production 0)',
        ((select count(*) from public.skylanders
           where sky_id in ('SKY-9101', 'SKY-9998')))::text, null),

  -- ----------------------------------------------------------------- Trigger
  (101, 'Trigger', 'purchases_paid_total_immutable_trg ist da',
        ((select count(*) from riegel))::text, '1'),
  (102, 'Trigger', 'er ist aktiv (O = eingeschaltet, D = abgeschaltet)',
        ((select tgenabled::text from riegel)), 'O'),
  (103, 'Trigger', 'Form: BEFORE / UPDATE / FOR EACH ROW',
        ((select (typ & 2 = 2 and typ & 16 = 16 and typ & 1 = 1) from riegel))::text, 'true'),
  (104, 'Trigger', 'er feuert NICHT bei insert oder delete',
        ((select (typ & 4 = 0 and typ & 8 = 0) from riegel))::text, 'true'),
  (105, 'Trigger', 'die Ausnahme fuer manuelle Einkaeufe steht drin',
        ((select (position('old.source = ''manual''' in prosrc) > 0) from riegel))::text,
        'true'),
  (106, 'Trigger', 'er haelt genau drei Felder',
        ((select (position('total_cost' in prosrc) > 0
                  and position('currency' in prosrc) > 0
                  and position('new.source is distinct from old.source' in prosrc) > 0)
            from riegel))::text, 'true'),
  (107, 'Trigger', 'und keines der nachtragbaren (muss false sein)',
        ((select (position('items_cost' in prosrc) > 0
                  or position('shipping_cost' in prosrc) > 0
                  or position('buyer_protection_cost' in prosrc) > 0
                  or position('purchased_at' in prosrc) > 0
                  or position('sender_name' in prosrc) > 0
                  or position('listing_url' in prosrc) > 0
                  or position('note' in prosrc) > 0)
            from riegel))::text, 'false'),
  (108, 'Trigger', 'Info: alle nicht-internen Trigger auf purchases',
        ((select string_agg(tgname || ' (' || tgenabled || ')', ', ' order by tgname)
            from trg)), null),

  -- -------------------------------------------------- Vertraeglichkeit
  (201, 'Ablaeufe', 'Info: Funktionen, die public.purchases schreiben',
        ((select string_agg(proname, ', ' order by proname) from schreiber)), null),
  (202, 'Ablaeufe', 'Info: davon mit total_cost/currency/source auf der linken Seite',
        ((select coalesce(string_agg(proname, ', ' order by proname), '(keine)')
            from heikel)), null),
  -- Nur diese beiden duerfen es sein: `seller_update_purchase` traegt seit
  -- `0132` den Riegel selbst, und `purchases_paid_total_is_final` IST der
  -- Riegel. Jede dritte Funktion hiesse, dass ein Ablauf die Summe schreibt
  -- und seit `0133` scheitern wuerde.
  (203, 'Ablaeufe', 'genau die erwarteten Schreiber, kein dritter',
        ((select coalesce(string_agg(proname, ',' order by proname), '')
            from heikel
           where proname not in ('seller_update_purchase',
                                 'purchases_paid_total_is_final'))), ''),
  (204, 'Ablaeufe', 'der Riegel in seller_update_purchase steht (0132)',
        ((select (position('the paid total of an imported purchase is final' in p.prosrc) > 0)
            from pg_proc p
           where p.oid = to_regprocedure(
             'public.seller_update_purchase(bigint, date, numeric, text, text, text,'
             || ' numeric, numeric, numeric, text, text, boolean, text, text, text,'
             || ' text, text, text, text, text, text)')))::text, 'true'),
  (205, 'Ablaeufe', 'der Positionstrigger aus 0126 fasst nur updated_at an',
        ((select (position('set updated_at = now()' in p.prosrc) > 0
                  and position('total_cost' in p.prosrc) = 0)
            from pg_proc p
           where p.oid = to_regprocedure('public.purchase_items_touch_purchase()')))::text,
        'true'),
  (206, 'Ablaeufe', 'Info: Einkaeufe je Herkunft (nur source <> manual ist betroffen)',
        ((select string_agg(h.source || '=' || h.n::text, ', ' order by h.source)
            from (select source, count(*) as n from public.purchases
                   group by source) h)), null),
  (207, 'Ablaeufe', 'kein Einkauf ohne Herkunft (NULL waere eine Luecke im Riegel)',
        ((select count(*) from public.purchases where source is null))::text, '0'),
  (208, 'Ablaeufe', 'kein Einkauf ohne Summe oder Waehrung',
        ((select count(*) from public.purchases
           where total_cost is null or currency is null))::text, '0'),

  -- -------------------------------------------------------------- Unberuehrt
  (301, 'Unberuehrt', 'Info: Eigenbelege (0133 fasst sie nicht an)',
        ((select count(*) from public.purchase_receipts))::text, null),
  (302, 'Unberuehrt', 'die Belegausstellung bleibt fuer jede API-Rolle gesperrt',
        ((select count(*) from pg_proc p, aclexplode(p.proacl) a
           where p.oid = to_regprocedure('public.seller_issue_purchase_receipt(bigint)')
             and a.privilege_type = 'EXECUTE'
             and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')))::text,
        '0'),
  (303, 'Unberuehrt', 'Info: Lagerzeilen / Bewegungen (0133 fasst beides nicht an)',
        ((select count(*)::text from public.shop_inventory) || ' / '
         || (select count(*)::text from public.inventory_movements)), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
