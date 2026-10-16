-- ===========================================================================
-- Ist die Belegausstellung gesperrt? — rein lesend
--
-- Es gibt genau ZWEI Wege, einen Eigenbeleg entstehen zu lassen. Beide sind
-- Funktionen; es gibt keinen Trigger und keinen anderen Schreibpfad auf
-- `public.purchase_receipts` (ueber alle Migrationen ausgezaehlt):
--
--   * `seller_issue_purchase_receipt(bigint)`             — 0122, ersetzt in 0123
--   * `seller_issue_purchase_receipt_correction(bigint)`  — 0128
--
-- Gesperrt heisst: KEINE der vier API-Rollen hat EXECUTE. `postgres` behaelt
-- es — sonst waere die Sperre nicht ruecknehmbar.
--
-- Wichtig: `revoke ... from authenticated` allein genuegt NICHT. Supabase
-- vergibt in `public` Standardrechte auch an `service_role`, und `0122`
-- entzieht ausdruecklich nur `public` und `anon`. Eine Sperre muss deshalb
-- jede API-Rolle einzeln nennen — und diese Pruefung sieht jede einzeln nach.
--
-- NUR LESEN. Ein einziges SELECT. Kein DO-Block, kein DDL, kein DML.
-- Zeile 9999 muss 0 zeigen, wenn die Sperre gelten SOLL.
-- ===========================================================================

with fn (nr, name, signatur) as (values
  (1, 'Ausstellung', 'public.seller_issue_purchase_receipt(bigint)'),
  (2, 'Korrektur',   'public.seller_issue_purchase_receipt_correction(bigint)')
),
-- PUBLIC ist KEINE Rolle in `pg_roles` — `has_function_privilege('public', …)`
-- bricht mit „role does not exist" ab. PUBLIC wird deshalb unten ueber den
-- ACL-Eintrag geprueft (Pruefungen 19x), die echten Rollen hier.
rolle (rnr, rname) as (values
  (1, 'anon'), (2, 'authenticated'), (3, 'service_role')
),
recht as (
  /*
   * Drei Faelle, und sie duerfen nicht verwechselt werden:
   *   * die Funktion gibt es nicht  -> nicht aufrufbar, also GESPERRT
   *     (so steht Production vor 0128 fuer die Korrekturfunktion)
   *   * die Rolle gibt es nicht     -> Befund, kein Urteil
   *   * beides da                   -> das Recht entscheidet
   */
  select f.nr, f.name, f.signatur, r.rnr, r.rname,
         case
           when to_regprocedure(f.signatur) is null then '(Funktion fehlt)'
           when not exists (select 1 from pg_roles g where g.rolname = r.rname)
             then '(Rolle fehlt)'
           else has_function_privilege(r.rname, f.signatur, 'execute')::text
         end as befund,
         case
           when to_regprocedure(f.signatur) is null then '(Funktion fehlt)'
           when not exists (select 1 from pg_roles g where g.rolname = r.rname)
             then null
           else 'false'
         end as erwartet
    from fn f cross join rolle r
),

pruef (nr, bereich, pruefung, befund, erwartet) as (
  select 100 + r.nr * 10 + r.rnr, 'Sperre',
         r.name || ': darf ' || r.rname || ' ausfuehren?',
         r.befund, r.erwartet
    from recht r
  union all
  /*
   * PUBLIC ueber den ACL. Zwei Faelle sind „offen":
   *   * ein Eintrag, der mit `=` beginnt (`=X/postgres`) — PUBLIC wurde
   *     ausdruecklich EXECUTE gegeben,
   *   * `proacl is null` — gar kein ACL-Eintrag, und der Standard fuer
   *     FUNKTIONEN ist EXECUTE fuer PUBLIC. Ein leeres ACL ist hier also
   *     NICHT harmlos.
   */
  select 190 + f.nr, 'Sperre', f.name || ': darf PUBLIC ausfuehren?',
         case when to_regprocedure(f.signatur) is null then '(Funktion fehlt)'
              else (select (p.proacl is null
                            or exists (select 1 from unnest(p.proacl) a
                                        where a::text ~ '^='))::text
                      from pg_proc p where p.oid = to_regprocedure(f.signatur))
         end,
         case when to_regprocedure(f.signatur) is null then '(Funktion fehlt)'
              else 'false' end
    from fn f
  union all
  select 200, 'Sperre', 'Ausstellung: postgres behaelt EXECUTE (Ruecknahme moeglich)',
         coalesce((select has_function_privilege('postgres',
                    'public.seller_issue_purchase_receipt(bigint)', 'execute')::text
                   where to_regprocedure('public.seller_issue_purchase_receipt(bigint)') is not null),
                  '(Funktion fehlt)'), 'true'
  union all
  select 201, 'Sperre', 'Korrektur: postgres behaelt EXECUTE',
         coalesce((select has_function_privilege('postgres',
                    'public.seller_issue_purchase_receipt_correction(bigint)', 'execute')::text
                   where to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)') is not null),
                  '(Funktion fehlt — 0128 nicht angewendet)'), null
  union all
  select 300, 'Vollstaendigkeit', 'Trigger, die purchase_receipts schreiben (muss 0 sein)',
         (select count(*)::text from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal
            and c.relname = 'purchase_receipts'
            and t.tgtype::integer & 4 = 4), '0'
  union all
  select 301, 'Vollstaendigkeit', 'Belege insgesamt',
         (select count(*)::text from public.purchase_receipts), null
  union all
  select 302, 'Vollstaendigkeit', 'Zaehlerzeilen',
         (select count(*)::text from public.purchase_receipt_counters), null
  union all
  select 303, 'Vollstaendigkeit', 'Abrufnachweise',
         (select count(*)::text from public.purchase_receipt_downloads), null
  union all
  select 304, 'Vollstaendigkeit', 'Unveraenderlichkeits-Trigger stehen',
         (select count(*)::text from pg_trigger
           where not tgisinternal
             and tgname in ('purchase_receipts_immutable_trg',
                            'purchase_receipt_downloads_immutable_trg')), '2'
),

ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)

select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein, wenn gesperrt)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
order by nr;
