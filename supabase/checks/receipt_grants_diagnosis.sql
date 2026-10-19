-- ===========================================================================
-- WER DARF EINEN EIGENBELEG AUSSTELLEN? — rein lesende Bestandsaufnahme
--
-- ANLASS. Die Staging-Readiness vom 2026-10-18 meldete in Zeile 602 den Wert
-- 1 statt 0: „Belegausstellung offen fuer eine API-Rolle oder NULL-ACL". Diese
-- Datei stellt fest, WELCHE Rolle es ist und WELCHER der beiden erklaerbaren
-- Rechtestaende hier gilt. Sie urteilt nur dort, wo es etwas zu urteilen gibt.
--
-- ZWEI RECHTESTAENDE SIND ERKLAERBAR, UND SIE SEHEN VERSCHIEDEN AUS
--
--   A  „Migrationsstand" — was `0122` und `0128` erklaeren:
--      `revoke all … from public, anon` und `grant execute … to authenticated`.
--      PUBLIC nein, anon nein, authenticated JA. `service_role` kann EXECUTE
--      haben, weil Supabase in `public` Standardrechte auch an sie vergibt und
--      keine der beiden Migrationen sie ausdruecklich entzieht (ADR-0125).
--
--   B  „Gesperrt" — zusaetzlich `supabase/operations/lock-receipt-issuance.sql`:
--      jede API-Rolle verliert EXECUTE, nur `postgres` behaelt es. Dieser
--      Schritt ist in `APPLIED.md` ausschliesslich fuer **Production**
--      verzeichnet, nicht fuer Staging.
--
-- Zeile 401 sagt in einem Wort, welcher der beiden Staende hier gilt.
--
-- WAS IN JEDEM FALL FALSCH WAERE, und nur das ist blockierend:
--   * `proacl is null` — kein ACL, und der Standard fuer FUNKTIONEN ist
--     EXECUTE fuer PUBLIC. `0122` entzieht PUBLIC ausdruecklich; ein leeres
--     ACL hiesse, dass dieser Entzug nie passiert ist.
--   * PUBLIC hat EXECUTE (ACL-Eintrag, der mit `=` beginnt).
--   * `anon` hat EXECUTE — das ist die unangemeldete Rolle.
--
-- REIN LESEND. Ein einziges SELECT, kein DDL, keine Datenanweisung, keine
-- Transaktion. Es wird kein Recht geaendert.
-- ===========================================================================

with fn (nr, rolle_im_text, signatur) as (values
  (1, 'Ausstellung', 'public.seller_issue_purchase_receipt(bigint)'),
  (2, 'Korrektur',   'public.seller_issue_purchase_receipt_correction(bigint)'),
  -- Zum Vergleich: der ABRUF darf offen sein. Ein ausgestellter Beleg muss
  -- abrufbar bleiben, auch im gesperrten Zustand.
  (3, 'Abruf',       'public.seller_purchase_receipt_history(bigint)')
),
fakt as (
  select f.nr, f.rolle_im_text, f.signatur,
         to_regprocedure(f.signatur)                        as oid,
         p.proname::text                                    as name,
         pg_get_function_identity_arguments(p.oid)           as argumente,
         p.prosecdef                                        as security_definer,
         (p.proacl is null)                                 as acl_fehlt,
         coalesce(array_to_string(p.proacl::text[], '  '), '(NULL)') as acl
    from fn f
    left join pg_proc p on p.oid = to_regprocedure(f.signatur)
),
-- Wirksames EXECUTE je echter Rolle. `has_function_privilege` beantwortet die
-- Frage einschliesslich Vererbung aus PUBLIC; PUBLIC selbst ist KEINE Rolle in
-- `pg_roles` und wird deshalb unten ueber den ACL-Eintrag geprueft.
rolle (rnr, rname) as (values (1, 'anon'), (2, 'authenticated'), (3, 'service_role'),
                              (4, 'postgres')),
recht as (
  select k.nr, k.rolle_im_text, r.rnr, r.rname,
         case when k.oid is null then '(Funktion fehlt)'
              when not exists (select 1 from pg_roles g where g.rolname = r.rname)
                then '(Rolle fehlt)'
              else has_function_privilege(r.rname, k.oid, 'execute')::text
         end as befund
    from fakt k cross join rolle r
),
public_recht as (
  select k.nr, k.rolle_im_text,
         case when k.oid is null then '(Funktion fehlt)'
              when k.acl_fehlt then 'true (NULL-ACL = Standard fuer PUBLIC)'
              else (exists (select 1 from pg_proc p, unnest(p.proacl) a
                             where p.oid = k.oid and a::text ~ '^='))::text
         end as befund
    from fakt k
),
zeilen (nr, bereich, gegenstand, befund, erwartet) as (

  -- ------------------------------------------------------- 1xx Die Funktionen
  select 100 + k.nr, 'Funktion',
         k.rolle_im_text || ': Signatur',
         case when k.oid is null then '(Funktion fehlt)'
              else k.name || '(' || k.argumente || ')'
                   || case when k.security_definer then '  security definer'
                           else '  security invoker' end end,
         null
    from fakt k

  -- ------------------------------------------------------------- 2xx Der ACL
  union all
  select 200 + k.nr, 'ACL', k.rolle_im_text || ': ACL im Volltext', k.acl, null
    from fakt k
  union all
  select 210 + k.nr, 'ACL', k.rolle_im_text || ': ACL fehlt (muss false sein)',
         case when k.oid is null then '(Funktion fehlt)' else k.acl_fehlt::text end,
         case when k.oid is null then '(Funktion fehlt)' else 'false' end
    from fakt k

  -- --------------------------------------------------- 3xx Wirksame Rechte
  union all
  select 300 + r.nr * 10 + r.rnr, 'Recht',
         r.rolle_im_text || ': darf ' || r.rname || ' ausfuehren?',
         r.befund,
         /*
          * BLOCKIEREND nur bei `anon` und nur fuer die beiden schreibenden
          * Funktionen. `authenticated` und `service_role` unterscheiden
          * gerade die beiden erklaerbaren Staende — sie sind hier Messung,
          * nicht Urteil. `postgres` soll EXECUTE behalten, sonst waere eine
          * Sperre nicht ruecknehmbar.
          */
         case when r.befund in ('(Funktion fehlt)', '(Rolle fehlt)') then null
              when r.rname = 'anon' and r.nr in (1, 2) then 'false'
              when r.rname = 'postgres' then 'true'
              else null end
    from recht r
  union all
  select 390 + p.nr, 'Recht', p.rolle_im_text || ': darf PUBLIC ausfuehren?',
         p.befund,
         case when p.befund = '(Funktion fehlt)' then null
              when p.nr in (1, 2) then 'false'
              else null end
    from public_recht p

  -- ------------------------------------------------- 4xx Welcher Stand gilt?
  union all
  select 401, 'Einordnung', 'welcher Rechtestand gilt hier?',
         (select case
            when count(*) filter (where k.oid is not null and k.nr in (1, 2)) = 0
              then 'UNBESTIMMT (Funktionen fehlen)'
            when bool_and(case when k.nr in (1, 2)
                               then not has_function_privilege('authenticated', k.oid, 'execute')
                               else true end)
              then 'B GESPERRT (keine API-Rolle, nur postgres) — der Production-Stand'
            else 'A MIGRATIONSSTAND (authenticated darf) — 0122/0128 ohne operations-Sperre'
          end
            from fakt k), null
  union all
  select 402, 'Einordnung', 'Info: bereits ausgestellte Eigenbelege',
         (select count(*)::text from public.purchase_receipts), null
  union all
  select 403, 'Einordnung', 'Info: Belege je Revision',
         coalesce((select string_agg(x.revision::text || '=' || x.n::text, ', '
                                     order by x.revision)
                     from (select revision, count(*) as n
                             from public.purchase_receipts group by revision) x),
                  '(keine)'), null
  union all
  select 404, 'Einordnung', 'Trigger, die purchase_receipts schreiben (muss 0 sein)',
         (select count(*)::text from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname = 'purchase_receipts'
            and t.tgname not in ('purchase_receipts_immutable_trg')), '0'
),
ergebnis as (
  select nr, bereich, gegenstand, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from zeilen
)
select nr, bereich, gegenstand, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
