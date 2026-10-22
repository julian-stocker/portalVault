-- ===========================================================================
-- STAGING — DIE NACHKONTROLLE ZU 0143, REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren. Klammer,
-- Stempel und `rollback` stehen schon darin.
--
-- NACH `staging-0143.sql` fahren. Zeile `9999` muss `0` zeigen.
--
-- RUECKGAENGIG MACHT SIE NICHTS: ein `do`-Block, der nur zaehlt, und ein
-- einziges SELECT in `begin … rollback`. Sie ruft die neue Funktion NICHT
-- auf — es entsteht kein Einkauf.
--
-- EINGEBETTET: `supabase/checks/0143_postflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/checks/0143_postflight.sql
-- ===========================================================================
-- 0143 POSTFLIGHT — der Zustand nach der Migration, rein lesend
--
-- Nach `0143_purchase_from_calculation.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- WAS SIE BEANTWORTET
--
--   * Steht die Funktion, mit vierzehn Argumenten in der richtigen Folge,
--     `security definer`, leerem `search_path`, und nur fuer `authenticated`?
--   * RUFT SIE DIE BESTEHENDE EINKAUFSFUNKTION AUF, statt sie nachzubauen?
--     Das ist die eigentliche Frage dieser Datei: es darf keinen zweiten Weg
--     geben, einen Einkauf anzulegen.
--   * Stehen die drei Riegel im Rumpf — Betriebsrolle, Besitz der
--     Kalkulation, Einmaligkeit mit `for update`?
--   * Liest sie aus der Kalkulation KEINE Zahl?
--   * Und ist ringsherum nichts verrutscht: `seller_create_purchase_with_items`
--     unveraendert, `purchase_calculations` unveraendert, die BELEGSPERRE
--     unveraendert?
--
-- WAS SIE NICHT BEANTWORTET: ob ein Einkauf dabei wirklich entsteht und die
-- Verknuepfung sitzt. Das faehrt Probelauf **P49** an echtem PostgreSQL nach
-- (ohne Rolle abgewiesen, fremde Kalkulation „not found", guter Fall ein
-- Einkauf mit zwei Positionen und gesetzter `purchase_id`, derselbe Entwurf
-- noch einmal ohne zweiten Einkauf, neuer Entwurf abgewiesen ohne Waise) —
-- und am laufenden System der Lauf durch das Formular.
--
-- NUR LESEN. Ein einziges SELECT. Sie ruft die Funktion NICHT auf.
-- ===========================================================================

with fn as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl, p.pronargs,
         p.proargnames, p.proargtypes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'seller_create_purchase_from_calculation'
),
nachbar as (
  select p.proname, md5(p.prosrc) as md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_create_purchase_with_items', 'seller_create_purchase')
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------------- Die Funktion
  (101, 'Neu', 'seller_create_purchase_from_calculation steht, genau einmal',
      (select count(*)::text from fn), '1'),
  (102, 'Neu', 'vierzehn Argumente, in dieser Folge',
      coalesce((select array_to_string(f.proargnames, ',') from fn f), '(keine)'),
      'p_calculation_id,p_purchased_at,p_total_cost,p_note,p_is_test,p_items,'
      || 'p_platform,p_seller_name,p_items_cost,p_shipping_cost,'
      || 'p_buyer_protection_cost,p_payment_method,p_external_ref,p_client_token'),
  (103, 'Neu', 'und mit diesen Typen',
      coalesce((select array_to_string(array(
                 select t::regtype::text from unnest(f.proargtypes) t), ',')
                 from fn f), '(keine)'),
      'uuid,date,numeric,text,boolean,jsonb,text,text,numeric,numeric,numeric,'
      || 'text,text,text'),
  (104, 'Neu', 'Rueckgabetyp bigint',
      coalesce((select p.prorettype::regtype::text from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname = 'seller_create_purchase_from_calculation'),
               '(keine)'), 'bigint'),
  (105, 'Neu', 'security definer',
      coalesce((select f.prosecdef::text from fn f), '(keine)'), 'true'),
  (106, 'Neu', 'es gibt eine search_path-Festlegung, und sie ist leer',
      coalesce((select coalesce(
                 (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                    from unnest(coalesce(f.proconfig, '{}'::text[])) c
                   where c like 'search\_path=%'),
                 '(leer)') from fn f), '(keine)'), '(leer)'),

  -- ----------------------------- SIE LEGT DEN EINKAUF NICHT SELBST AN
  (201, 'Ein Weg', 'sie ruft seller_create_purchase_with_items auf',
      coalesce((select (position('public.seller_create_purchase_with_items('
                                in f.prosrc) > 0)::text from fn f), '(keine)'), 'true'),
  (202, 'Ein Weg', 'und fuegt selbst nichts in purchases ein',
      coalesce((select (f.prosrc ~* '\minsert\s+into\s+public\.purchases\m')::text
                  from fn f), '(keine)'), 'false'),
  (203, 'Ein Weg', 'auch nichts in purchase_items',
      coalesce((select (f.prosrc ~* '\minsert\s+into\s+public\.purchase_items\m')::text
                  from fn f), '(keine)'), 'false'),
  /*
   * DIE VERKETTUNG BRAUCHT KLAMMERN, und das ist keine Stilfrage.
   *
   * `x ~* 'A' || 'B'` liest PostgreSQL als `(x ~* 'A') || 'B'` — beide
   * Operatoren haben dieselbe Vorrangstufe und binden nach links. Das
   * Muster war damit abgeschnitten, seine Klammern unbalanciert, und der
   * Probelauf brach mit „parentheses () not balanced" ab. Gefunden hat es
   * `npm run verify:check-sql`, bevor die Datei jemand gefahren hat.
   */
  (204, 'Ein Weg', 'und sie bucht nichts ein (keine Bewegung, kein Bestand)',
      coalesce((select (f.prosrc ~* ('\m(inventory_movements|shop_inventory|'
                        || 'seller_book_purchase_item)\m'))::text
                  from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------- Die drei Riegel
  (301, 'Riegel', '1. sie fragt die Betriebsrolle',
      coalesce((select (position('can_operate_active_seller' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (302, 'Riegel', '2. sie prueft den Besitz der Kalkulation ausdruecklich',
      coalesce((select (position('c.user_id = (select auth.uid())' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (303, 'Riegel', '3. sie sperrt die Kalkulationszeile (for update)',
      coalesce((select (position('for update' in f.prosrc) > 0)::text from fn f),
               '(keine)'), 'true'),
  (304, 'Riegel', 'und weist eine zweite Uebernahme ab',
      coalesce((select (position('already handed over' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (305, 'Riegel', 'dieselbe Antwort fuer "gibt es nicht" und "gehoert jemand anderem"',
      coalesce((select (position('calculation not found' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),

  -- --------------------------------------------- Keine Zahl aus der Kalkulation
  (401, 'Kein Geld', 'sie liest aus der Kalkulation nur purchase_id',
      coalesce((select (position('select c.purchase_id into v_vorher' in f.prosrc) > 0)::text
                  from fn f), '(keine)'), 'true'),
  (402, 'Kein Geld', 'und keinen Betrag, keinen Faktor, keine Positionen',
      coalesce((select (f.prosrc ~* '\m(total_cents|factor_percent|c\.lines)\m')::text
                  from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------------- Die Rechte
  (501, 'Rechte', 'materialisierter ACL (NULL waere PUBLIC)',
      coalesce((select (f.proacl is not null)::text from fn f), '(keine)'), 'true'),
  (502, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      coalesce((select count(*)::text from fn f, aclexplode(f.proacl) a
                 where a.privilege_type = 'EXECUTE'
                   and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '(keine)'),
      '0'),
  (503, 'Rechte', 'authenticated darf ausfuehren',
      has_function_privilege('authenticated',
        'public.seller_create_purchase_from_calculation(uuid, date, numeric, text, '
        || 'boolean, jsonb, text, text, numeric, numeric, numeric, text, text, text)',
        'execute')::text, 'true'),

  -- -------------------------------------------- Ringsherum ist nichts verrutscht
  (601, 'Unberuehrt', 'seller_create_purchase_with_items steht, genau einmal',
      (select count(*)::text from nachbar
        where proname = 'seller_create_purchase_with_items'), '1'),
  (602, 'Unberuehrt', 'seller_create_purchase steht, genau einmal',
      (select count(*)::text from nachbar where proname = 'seller_create_purchase'), '1'),
  (603, 'Unberuehrt', 'purchase_calculations hat weiter vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (604, 'Unberuehrt', 'und keine davon gibt anon etwas',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'
          and 'anon' = any (roles)), '0'),
  (605, 'Unberuehrt', 'der partielle Unique-Index auf purchase_id steht',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'), '1'),

  -- --------------------------------------------------------- DIE BELEGSPERRE
  (701, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
  (702, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),
  (703, 'Belege', 'und 0143 nennt die Belegausstellung nirgends',
      coalesce((select (f.prosrc ~* ('\m(platform_receipt|issue_platform|'
                        || 'correct_platform)\m'))::text from fn f), '(keine)'), 'false'),

  -- ------------------------------------------------------------------- Infos
  (901, 'Info', 'Einkaeufe insgesamt (0143 legt keinen an)',
      (select count(*)::text from public.purchases), null),
  (902, 'Info', 'gespeicherte Kalkulationen, davon verknuepft',
      (select count(*)::text from public.purchase_calculations) || ' / ' ||
      (select count(*)::text from public.purchase_calculations
        where purchase_id is not null), null)
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
-- <<< ENDE: supabase/checks/0143_postflight.sql

rollback;
