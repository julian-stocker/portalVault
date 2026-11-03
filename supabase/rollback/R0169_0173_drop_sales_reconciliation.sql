-- ===========================================================================
-- R0169_0173 — TAKE THE SALES RECONCILIATION BACK OUT (ADR-0174)
--
-- STAGING ONLY, and only as long as it was never used. One transaction.
--
-- ORDER. `R0174_backups_without_sales_reconciliation.sql` goes FIRST: the
-- backup functions of 0174 read the seven tables, and dropping the tables
-- underneath them would leave two backups that fail at run time. This file
-- checks that and stops otherwise.
--
-- IT REFUSES ONCE THERE IS EVIDENCE. A session, a decision or an application
-- is the record of what an operator decided and changed. Dropping it to make
-- a rollback convenient would destroy exactly what 0169 exists to keep. With
-- even one session the rollback stops; the way back then is a reviewed,
-- separate decision — not this file.
--
-- WHAT IT REMOVES: the functions of 0170, 0172 and 0173, the index of 0171,
-- the seven tables and the trigger function of 0169.
-- WHAT IT LEAVES: every sale, item, refund, audit line, hold and movement —
-- none of them was ever written by the migrations themselves. A sale that was
-- cancelled THROUGH 0170 stays cancelled; that is a fact in the books now,
-- recorded in `orderbook_audit`, and taking it back is a decision, not a
-- rollback.
-- ===========================================================================

begin;

do $guard$
begin
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Dieser Rueckbau laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('seller_business_backup', 'system_business_export', 'system_platform_export')
                and p.prosrc like '%sales\_recon\_%') then
    raise exception 'R0169_0173 stops: 0174 is still in the backup functions — run R0174 first';
  end if;
  if to_regclass('public.sales_recon_sessions') is not null
     and exists (select 1 from public.sales_recon_sessions) then
    raise exception 'R0169_0173 stops: reconciliation sessions exist — they are evidence and are not dropped by a rollback';
  end if;
end
$guard$;

-- 0173
drop function if exists public.seller_recon_apply(bigint, integer);

-- 0172
drop function if exists public.seller_recon_thin_snapshots(bigint);
drop function if exists public.seller_recon_discard(bigint);
drop function if exists public.seller_recon_close(bigint);
drop function if exists public.seller_recon_decide(bigint, text, jsonb, text, jsonb, jsonb);
drop function if exists public.seller_recon_session(bigint, text, integer, integer);
drop function if exists public.seller_recon_sessions();
drop function if exists public.seller_recon_create(jsonb);
drop function if exists public.seller_recon_aliases(text);
drop function if exists public.seller_recon_candidates(text, date, date);
drop function if exists public.sales_recon_allowed(text);
drop function if exists public.sales_recon_numbers_only(jsonb);
drop function if exists public.sales_recon_array(jsonb, text, integer, text);
drop function if exists public.sales_recon_day(jsonb, text, boolean, text);
drop function if exists public.sales_recon_number(jsonb, text, numeric, numeric, boolean, text);
drop function if exists public.sales_recon_text(jsonb, text, integer, boolean, text);
drop function if exists public.sales_recon_no_contact(text, text);
drop function if exists public.sales_recon_only_keys(jsonb, text[], text);
drop function if exists public.sales_recon_gate();

-- 0171
drop index if exists public.sales_external_order_ref_per_channel;

-- 0170
drop function if exists public.seller_uncancel_external_sale(bigint, text, timestamptz);
drop function if exists public.seller_cancel_external_sale(bigint, text, date, timestamptz);

-- 0169 — children first
drop table if exists public.sales_recon_applications;
drop table if exists public.sales_recon_decisions;
drop table if exists public.sales_recon_findings;
drop table if exists public.sales_recon_matches;
drop table if exists public.sales_recon_orders;
drop table if exists public.sales_recon_files;
drop table if exists public.sales_recon_sessions;
drop function if exists public.sales_recon_evidence_is_append_only();

do $after$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'sales\_recon\_%') then
    raise exception 'R0169_0173: a reconciliation table is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and (p.proname like 'seller\_recon\_%' or p.proname like 'sales\_recon\_%'
                     or p.proname in ('seller_cancel_external_sale', 'seller_uncancel_external_sale'))) then
    raise exception 'R0169_0173: a reconciliation function is still there';
  end if;
  raise notice 'R0169_0173 ok: the sales reconciliation is gone; no sale, item, refund, audit line or movement was touched.';
end
$after$;

commit;
