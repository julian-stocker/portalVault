-- ===========================================================================
-- 0019 — runtime verification of the transactional-mail delivery state,
--        STAGING ONLY
--
-- The contract test proves what the migration file says. This proves what the
-- database does when it runs: that the primary key really is the lock, that a
-- sent mail really cannot be unsent, and that an ambiguous claim really does
-- stop a second send instead of inviting one.
--
--   HOW TO RUN
--   Supabase Dashboard -> SQL Editor, on the STAGING project. One section at a
--   time. Each raises on the first failure, so a section that finishes without
--   an error has passed.
--
--   WHY IT LEAVES NOTHING BEHIND
--   Every section runs inside `begin ... rollback`. Sequences advance and do
--   not roll back, which is harmless on a disposable project.
--
--   ⚠️  NEVER RUN THIS AGAINST PRODUCTION.
-- ===========================================================================


-- ===========================================================================
-- SECTION 0 — preflight. Reads only.
-- ===========================================================================
do $$
declare v_inv bigint; v_missing text[] := '{}';
begin
  select count(*) into v_inv from public.shop_inventory;
  if v_inv > 50 then
    raise exception 'This does not look like staging (% inventory rows). STOP.', v_inv;
  end if;

  if to_regclass('public.order_mail') is null
    then v_missing := v_missing || 'order_mail'; end if;
  if to_regprocedure('public.claim_order_mail(text,text,boolean)') is null
    then v_missing := v_missing || 'claim_order_mail'; end if;
  if to_regprocedure('public.mark_order_mail_sent(text,text,text)') is null
    then v_missing := v_missing || 'mark_order_mail_sent'; end if;
  if to_regprocedure('public.mark_order_mail_failed(text,text,text)') is null
    then v_missing := v_missing || 'mark_order_mail_failed'; end if;
  if to_regprocedure('public.mark_order_mail_unresolved(text,text,text)') is null
    then v_missing := v_missing || 'mark_order_mail_unresolved'; end if;
  if to_regprocedure('public.order_mail_payload(text)') is null
    then v_missing := v_missing || 'order_mail_payload'; end if;
  if to_regprocedure('public.mail_contact_settings()') is null
    then v_missing := v_missing || 'mail_contact_settings'; end if;
  if to_regprocedure('public.admin_set_business_contact(text,text)') is null
    then v_missing := v_missing || 'admin_set_business_contact'; end if;
  if to_regclass('public.business_settings') is null
    then v_missing := v_missing || 'business_settings'; end if;
  if to_regprocedure('public.business_settings_public()') is null
    then v_missing := v_missing || 'business_settings_public'; end if;
  if to_regprocedure('public.admin_business_settings()') is null
    then v_missing := v_missing || 'admin_business_settings'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0019 not applied, missing: %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'PASS  section 0 — 0019 applied';
end $$;


-- ===========================================================================
-- SECTION 1 — the claim is a lock, and a sent mail is terminal.
-- ===========================================================================
begin;
do $$
declare
  v_order  bigint;
  v_number text;
  v_a     text;
  v_b     text;
  v_row   public.order_mail;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  if v_order is null then raise exception 'no order to hang a fixture off'; end if;

  -- A previous rolled-back section cannot have left anything, but a previous
  -- REAL mail could — so work on a kind/order pair and assert from zero.
  -- `order_mail_no_delete` is a real guard and it fires here too. Switching it
  -- off inside a transaction that rolls back is the honest way to get a clean
  -- slate: the guard is proven in section 5, and nothing leaves this block.
  alter table public.order_mail disable trigger order_mail_no_delete;
  delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  alter table public.order_mail enable trigger order_mail_no_delete;

  v_a := public.claim_order_mail(v_number, 'resolution_alert');
  if v_a <> 'claimed' then raise exception 'first claim returned %', v_a; end if;

  -- The second caller must be told somebody else is sending, not handed a
  -- second licence to send.
  v_b := public.claim_order_mail(v_number, 'resolution_alert');
  if v_b <> 'in_flight' then raise exception 'second claim returned %, expected in_flight', v_b; end if;

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.attempts <> 1 then raise exception 'attempts = %, expected 1', v_row.attempts; end if;
  if v_row.state <> 'sending' then raise exception 'state = %', v_row.state; end if;
  if v_row.sent_at is not null then raise exception 'sent_at set before sending'; end if;

  perform public.mark_order_mail_sent(v_number, 'resolution_alert', 'msg_runtime_test');

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.state <> 'sent' then raise exception 'state = % after mark_sent', v_row.state; end if;
  if v_row.sent_at is null then raise exception 'sent_at missing'; end if;
  if v_row.provider_message_id <> 'msg_runtime_test' then raise exception 'message id lost'; end if;

  -- TERMINAL. Not even the force flag may reopen it: Resend's idempotency
  -- window is 24 hours, so a later second send is a second inbox entry.
  v_a := public.claim_order_mail(v_number, 'resolution_alert');
  if v_a <> 'already_sent' then raise exception 'claim after sent returned %', v_a; end if;

  v_b := public.claim_order_mail(v_number, 'resolution_alert', true);
  if v_b <> 'already_sent' then raise exception 'FORCED claim after sent returned %', v_b; end if;

  raise notice 'PASS  section 1 — claim locks, sent is terminal, force does not override it';
end $$;
rollback;


-- ===========================================================================
-- SECTION 2 — a failed send is retryable, and the retry is not a second row.
-- ===========================================================================
begin;
do $$
declare
  v_order  bigint;
  v_number text;
  v_claim text;
  v_row   public.order_mail;
  v_rows  bigint;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  -- `order_mail_no_delete` is a real guard and it fires here too. Switching it
  -- off inside a transaction that rolls back is the honest way to get a clean
  -- slate: the guard is proven in section 5, and nothing leaves this block.
  alter table public.order_mail disable trigger order_mail_no_delete;
  delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  alter table public.order_mail enable trigger order_mail_no_delete;

  perform public.claim_order_mail(v_number, 'resolution_alert');
  perform public.mark_order_mail_failed(v_number, 'resolution_alert', 'rate_limit_exceeded');

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.state <> 'failed' then raise exception 'state = %, expected failed', v_row.state; end if;
  if v_row.last_error <> 'rate_limit_exceeded' then raise exception 'error not recorded'; end if;

  -- Retryable without a force flag: the provider clearly refused, so nothing
  -- was accepted and nothing can be duplicated.
  v_claim := public.claim_order_mail(v_number, 'resolution_alert');
  if v_claim <> 'claimed' then raise exception 'retry claim returned %', v_claim; end if;

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.attempts <> 2 then raise exception 'attempts = %, expected 2', v_row.attempts; end if;
  if v_row.last_error is not null then raise exception 'stale error survived the retry'; end if;

  select count(*) into v_rows from public.order_mail
   where order_id = v_order and kind = 'resolution_alert';
  if v_rows <> 1 then raise exception 'a retry created % rows', v_rows; end if;

  raise notice 'PASS  section 2 — failed is retryable, in place, counted';
end $$;
rollback;


-- ===========================================================================
-- SECTION 3 — the ambiguous state refuses a blind retry.
-- ===========================================================================
begin;
do $$
declare
  v_order  bigint;
  v_number text;
  v_claim text;
  v_row   public.order_mail;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  -- `order_mail_no_delete` is a real guard and it fires here too. Switching it
  -- off inside a transaction that rolls back is the honest way to get a clean
  -- slate: the guard is proven in section 5, and nothing leaves this block.
  alter table public.order_mail disable trigger order_mail_no_delete;
  delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  alter table public.order_mail enable trigger order_mail_no_delete;

  perform public.claim_order_mail(v_number, 'resolution_alert');
  -- What a 409 on the idempotency key, or a timeout, leaves behind.
  perform public.mark_order_mail_unresolved(v_number, 'resolution_alert', 'invalid_idempotent_request');

  v_claim := public.claim_order_mail(v_number, 'resolution_alert');
  if v_claim <> 'unresolved' then
    raise exception 'unresolved claim returned %, expected unresolved', v_claim;
  end if;

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.attempts <> 1 then
    raise exception 'a refused claim counted an attempt (%)', v_row.attempts;
  end if;

  -- Only an administrator who has looked at it gets through, and the Edge
  -- Function only passes this flag after verifying a real admin JWT.
  v_claim := public.claim_order_mail(v_number, 'resolution_alert', true);
  if v_claim <> 'claimed' then raise exception 'forced claim returned %', v_claim; end if;

  select * into v_row from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_row.attempts <> 2 then raise exception 'attempts = %, expected 2', v_row.attempts; end if;

  raise notice 'PASS  section 3 — unresolved blocks a blind retry, yields to an acknowledged one';
end $$;
rollback;


-- ===========================================================================
-- SECTION 4 — a stale claim reads as unresolved, not as free to send.
-- ===========================================================================
begin;
do $$
declare
  v_order  bigint;
  v_number text;
  v_claim text;
  v_state text;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  -- `order_mail_no_delete` is a real guard and it fires here too. Switching it
  -- off inside a transaction that rolls back is the honest way to get a clean
  -- slate: the guard is proven in section 5, and nothing leaves this block.
  alter table public.order_mail disable trigger order_mail_no_delete;
  delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  alter table public.order_mail enable trigger order_mail_no_delete;

  perform public.claim_order_mail(v_number, 'resolution_alert');

  -- The crash: the process took the claim and never came back. Backdate it
  -- past the grace period rather than waiting ten minutes.
  update public.order_mail
     set claimed_at = now() - public.order_mail_grace() - interval '1 minute'
   where order_id = v_order and kind = 'resolution_alert';

  select public.order_mail_effective_state(state, claimed_at) into v_state
    from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  if v_state <> 'unresolved' then
    raise exception 'a stale claim reads as %, expected unresolved', v_state;
  end if;

  -- And the claim agrees with the interface, because both ask the same rule.
  v_claim := public.claim_order_mail(v_number, 'resolution_alert');
  if v_claim <> 'unresolved' then
    raise exception 'stale claim returned %, expected unresolved', v_claim;
  end if;

  select state into v_state from public.order_mail
   where order_id = v_order and kind = 'resolution_alert';
  if v_state <> 'unresolved' then
    raise exception 'the stale row was not promoted, state = %', v_state;
  end if;

  raise notice 'PASS  section 4 — a crashed claim becomes a question, not a licence';
end $$;
rollback;


-- ===========================================================================
-- SECTION 5 — the guards. A sent mail cannot be unsent or deleted.
-- ===========================================================================
begin;
do $$
declare
  v_order  bigint;
  v_number text;
  v_ok    boolean;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  -- `order_mail_no_delete` is a real guard and it fires here too. Switching it
  -- off inside a transaction that rolls back is the honest way to get a clean
  -- slate: the guard is proven in section 5, and nothing leaves this block.
  alter table public.order_mail disable trigger order_mail_no_delete;
  delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  alter table public.order_mail enable trigger order_mail_no_delete;

  perform public.claim_order_mail(v_number, 'resolution_alert');
  perform public.mark_order_mail_sent(v_number, 'resolution_alert', 'msg_guard_test');

  v_ok := false;
  begin
    update public.order_mail set state = 'failed'
     where order_id = v_order and kind = 'resolution_alert';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a sent mail was moved to failed'; end if;

  v_ok := false;
  begin
    update public.order_mail set sent_at = now() - interval '1 day'
     where order_id = v_order and kind = 'resolution_alert';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'sent_at was rewritten'; end if;

  v_ok := false;
  begin
    update public.order_mail set provider_message_id = 'msg_forged'
     where order_id = v_order and kind = 'resolution_alert';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'the provider message id was rewritten'; end if;

  v_ok := false;
  begin
    update public.order_mail set attempts = 0
     where order_id = v_order and kind = 'resolution_alert';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'attempts went backwards'; end if;

  -- THE GUARD ITSELF. Deliberately with the trigger ON — this is the one
  -- delete in the suite that must fail, and an earlier blanket edit had it
  -- disabling the very trigger it exists to prove.
  v_ok := false;
  begin
    delete from public.order_mail where order_id = v_order and kind = 'resolution_alert';
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'a delivery record was deleted'; end if;

  raise notice 'PASS  section 5 — sent is immutable and records are not deleted';
end $$;
rollback;


-- ===========================================================================
-- SECTION 6 — the mail payload carries nothing it should not.
-- ===========================================================================
begin;
do $$
declare
  v_order   bigint;
  v_number  text;
  v_payload jsonb;
  v_leak    text[] := '{}';
  v_key     text;
begin
  select id, order_number into v_order, v_number from public.orders order by id limit 1;
  v_payload := public.order_mail_payload(v_number);

  if v_payload is null then raise exception 'no payload for order %', v_number; end if;
  if v_payload ? 'order_number' is false then raise exception 'no order number'; end if;
  if v_payload ? 'lines' is false then raise exception 'no lines'; end if;
  if v_payload ? 'address' is false then raise exception 'no address'; end if;

  -- Nothing that identifies a session, a capability or a row.
  foreach v_key in array array[
    'id', 'user_id', 'request_id', 'client_hash', 'payment_token_hash',
    'provider_payment_id', 'session_id', 'stripe_session_id'
  ] loop
    if v_payload ? v_key then v_leak := v_leak || v_key; end if;
  end loop;

  -- And the line items name the article, not its catalogue identity.
  if jsonb_array_length(v_payload -> 'lines') > 0
     and (v_payload -> 'lines' -> 0) ? 'sky_id' then
    v_leak := v_leak || 'lines[].sky_id';
  end if;

  if array_length(v_leak, 1) > 0 then
    raise exception 'the mail payload carries: %', array_to_string(v_leak, ', ');
  end if;

  raise notice 'PASS  section 6 — payload carries no id, capability or provider reference';
end $$;
rollback;


-- ===========================================================================
-- SECTION 7 — the delivery functions are closed to every client role.
-- ===========================================================================
do $$
declare
  v_open text[] := '{}';
  v_fn   text;
begin
  foreach v_fn in array array[
    'public.claim_order_mail(text,text,boolean)',
    'public.mark_order_mail_sent(text,text,text)',
    'public.mark_order_mail_failed(text,text,text)',
    'public.mark_order_mail_unresolved(text,text,text)',
    'public.order_mail_payload(text)',
    'public.mail_contact_settings()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      v_open := v_open || v_fn;
    end if;
  end loop;

  if array_length(v_open, 1) > 0 then
    raise exception 'reachable by a client role: %', array_to_string(v_open, ', ');
  end if;

  -- The table itself, too.
  if has_table_privilege('anon', 'public.order_mail', 'select')
     or has_table_privilege('authenticated', 'public.order_mail', 'select') then
    raise exception 'order_mail is readable by a client role';
  end if;

  -- The administrator's two are reachable, and gated inside by is_shop_admin().
  if not has_function_privilege('authenticated', 'public.admin_set_business_contact(text,text)', 'execute') then
    raise exception 'an administrator cannot set the business contact';
  end if;

  raise notice 'PASS  section 7 — delivery is service-role only, settings are admin-gated';
end $$;


-- ===========================================================================
-- SECTION 8 — the business contact is configuration, not authorisation,
--             and the public projection publishes only what it names.
-- ===========================================================================
begin;
do $$
declare
  v_before text;
  v_ok     boolean;
  v_cols   text[];
  v_key    text;
begin
  select contact_email into v_before from public.business_settings;

  -- The CHECK is a guard against a typo, and it holds.
  v_ok := false;
  begin
    update public.business_settings set contact_email = 'not-an-address' where id;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'a malformed contact address was accepted'; end if;

  update public.business_settings set contact_email = 'fixture@example.com' where id;
  if (select contact_email from public.business_settings) <> 'fixture@example.com' then
    raise exception 'the contact address did not stick';
  end if;

  -- Null is a real value: no address configured yet.
  update public.business_settings set contact_email = null where id;
  if (select contact_email from public.business_settings) is not null then
    raise exception 'the contact address cannot be cleared';
  end if;

  -- Exactly one row, forever.
  v_ok := false;
  begin
    insert into public.business_settings (id) values (false);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'business_settings is not a singleton'; end if;

  -- THE TABLE'S OWN COLUMN LIST, pinned.
  --
  -- The legal block will add Betreibername, Anschrift, Telefon and tax fields
  -- here on purpose. Until it does, this fails on any of them — an empty
  -- column is a promise nobody checked, and a field that arrives before
  -- anything renders it is a field nobody decided the visibility of.
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.business_settings'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  if v_cols is distinct from
     array['id', 'contact_email', 'transactional_reply_to', 'updated_at', 'updated_by'] then
    raise exception 'business_settings holds %, which is not the agreed list',
      array_to_string(v_cols, ', ');
  end if;

  -- THE PROJECTION IS AN ALLOW-LIST, asked directly.
  --
  -- Two earlier attempts asked about a REPRESENTATION and both were wrong:
  -- pg_proc -> pg_type -> pg_class returns nothing for a `returns table`
  -- function (its columns are OUT parameters, there is no composite type),
  -- and `to_jsonb(b)` over a single-column table function resolves `b` to the
  -- COLUMN rather than the row — `to_jsonb(null::text)` is SQL NULL, so the
  -- set-returning function yielded no rows at all.
  --
  -- So ask the question itself: can a caller select a column that is not in
  -- the allow-list? Referencing one raises `undefined_column`, and that is the
  -- property this test exists for — a field the legal block adds to the table
  -- must not become visible by arriving.
  begin
    execute 'select contact_email from public.business_settings_public()';
  exception when others then
    raise exception 'the public projection does not expose contact_email';
  end;

  for v_key in
    select a.attname::text
      from pg_attribute a
     where a.attrelid = 'public.business_settings'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname <> 'contact_email'
  loop
    begin
      execute format('select %I from public.business_settings_public()', v_key);
      -- P0001, so the handler below does not swallow it.
      raise exception 'the public projection exposes %, which is not on the allow-list', v_key;
    exception when undefined_column then
      null;
    end;
  end loop;

  raise notice 'PASS  section 8 — contact validates, singleton holds, columns pinned, projection is one named column (was: %)',
    coalesce(v_before, 'unset');
end $$;
rollback;


-- ===========================================================================
-- SECTION 9 — business_settings is closed, and the public projection is not
--             granted to anybody yet.
-- ===========================================================================
do $$
begin
  if has_table_privilege('anon', 'public.business_settings', 'select')
     or has_table_privilege('authenticated', 'public.business_settings', 'select') then
    raise exception 'business_settings is readable by a client role';
  end if;

  -- Defined, deliberately ungranted until a public page needs it.
  if has_function_privilege('anon', 'public.business_settings_public()', 'execute') then
    raise exception 'the public projection is already granted to anon';
  end if;

  if not has_function_privilege('authenticated', 'public.admin_business_settings()', 'execute') then
    raise exception 'an administrator cannot read the business settings';
  end if;

  raise notice 'PASS  section 9 — table closed, projection defined but not yet published';
end $$;
