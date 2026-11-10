-- ===========================================================================
-- STAGING — EIN LAUF FUER 0187
--            (admin_set_shop_policies ohne EXECUTE fuer PUBLIC und anon)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0187`, diese Datei,
-- `npm run db:migrate:staging -- 0187 --resume`.
--
-- NOCH NICHT FREIGEGEBEN. Gefahren wird sie erst nach einer eigenen Freigabe.
--
-- DIE MIGRATION IST ZEICHENGLEICH EINGEBETTET. Sie aendert NUR Rechte einer
-- Funktion; bricht sie ab, ist nichts angewendet. Der Rumpf aus 0041 bleibt
-- (Z2), ebenso Rollenpruefung und Feldhelfer.
--
-- SIE AENDERT KEINE DATEN. A2 misst vorher Verkaeufer, Lager und Sammlung,
-- dazu die Rechte jeder Funktion (ausser dieser einen) und jeder Tabelle und
-- jede Policy. Z1 misst nachher dasselbe und bricht ab, wenn sich auch nur ein
-- Wert bewegt hat. Z2 prueft die Ruempfe, Z3 die Rechte.
--
-- NUR STAGING. ERWARTET: die NOTICE `0187 ok`, dann `commit`.
-- ===========================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $lauf_a$
begin
  /* A1 — der Umgebungsstempel. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;
end
$lauf_a$;

/* A2 — Daten und Rechte, vorher gemessen. */
create temporary table policies_0187_vorher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('admin_set_shop_policies')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

-- ===========================================================================
-- >>> EINGEBETTET: supabase/migrations/0187_revoke_shop_policies_public.sql
-- ===========================================================================
-- 0187 — admin_set_shop_policies: kein EXECUTE mehr für PUBLIC und anon
--
-- ###########################################################################
-- ##  NOT APPLIED — neither on Staging nor on Production.                  ##
-- ##  Each environment only after a separate approval by the operator.     ##
-- ###########################################################################
--
-- WARUM (M-05B, Stability Baseline 1, 2026-11-10)
--
-- `0040` legte `admin_set_shop_policies` mit zehn Parametern an und sperrte
-- sie (`revoke all … from public, anon; grant execute … to authenticated`).
-- `0041` hat sie gelöscht und mit NEUN Parametern neu angelegt — und dabei
-- keine Rechte gesetzt. Ein Entzug hängt an der Signatur, nicht am Namen: die
-- neue Funktion kam mit der Vorgabe von PostgreSQL hoch (EXECUTE für PUBLIC)
-- und mit den Standardrechten, die Supabase neuen Funktionen in `public`
-- gibt (anon, authenticated, service_role). Gemessen im Staging-Schema vom
-- 2026-11-09: `GRANT ALL … TO anon / authenticated / service_role`, kein
-- `REVOKE … FROM PUBLIC`.
--
-- AUSNUTZBAR WAR DAS NICHT: die erste Anweisung des Funktionskörpers ist
-- `if not public.can_operate_active_seller() then raise …`. Ein anonymer
-- Aufruf endet dort, bevor gelesen oder geschrieben wird. Aber es bricht die
-- Regel des Projekts, und ein künftiger Eingriff in den Körper wäre sofort
-- öffentlich.
--
-- WAS SICH ÄNDERT — GENAU DAS:
--
--   EXECUTE  PUBLIC         entzogen
--   EXECUTE  anon           entzogen
--   EXECUTE  authenticated  erteilt (der einzige Aufrufer: `setShopPolicies`
--                           in src/lib/admin/actions.ts, als angemeldeter
--                           Betreiber)
--   EXECUTE  service_role   erteilt (Muster der übrigen Admin-Funktionen)
--
-- WAS SICH NICHT ÄNDERT: der Funktionskörper (vorher und nachher per md5
-- verglichen), `security definer`, `search_path = ''`, jede andere Funktion
-- und jede Geschäftsregel. Keine Tabelle, keine Zeile.
--
-- ANWENDBAR AUF BEIDE STÄNDE. Die Funktion stammt aus `0041`; Staging (0186)
-- und Production (0167) tragen sie. Diese Datei setzt nichts aus 0168–0186
-- voraus. Sie bricht ab, statt zu raten, wenn die Funktion fehlt oder in einer
-- zweiten Überladung existiert.
--
-- IDEMPOTENT. Ein zweiter Lauf entzieht nichts mehr und erteilt nichts Neues;
-- die Nachbedingungen gelten danach genauso.
--
-- RÜCKNAHME: `supabase/rollback/R0187_restore_shop_policies_grants.sql`.
-- ===========================================================================

do $m0187$
declare
  v_sig     constant text := 'public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)';
  v_oid     oid;
  v_body    text;
  v_secdef  boolean;
  v_path    text;
begin
  /* VORBEDINGUNGEN — kein Raten. */
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then
    raise exception '0187 precondition: % does not exist', v_sig;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_set_shop_policies') <> 1 then
    raise exception '0187 precondition: admin_set_shop_policies exists in more than one overload';
  end if;
  select md5(p.prosrc), p.prosecdef,
         (select btrim(substring(c from 'search_path=(.*)$'), '"')
            from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
    into v_body, v_secdef, v_path
    from pg_proc p where p.oid = v_oid;
  if not v_secdef or v_path is distinct from '' then
    raise exception '0187 precondition: % is not a security definer with an empty search_path', v_sig;
  end if;

  /* DIE ÄNDERUNG — nur Rechte, exakte Signatur. */
  revoke all on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)
    from public, anon;
  grant execute on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)
    to authenticated, service_role;

  /* NACHBEDINGUNGEN — gemessen, nicht angenommen. */
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0187 postcondition: anon can still execute %', v_sig;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = v_oid and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
    raise exception '0187 postcondition: PUBLIC can still execute %', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0187 postcondition: authenticated or service_role lost execute on %', v_sig;
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_oid) is distinct from v_body
     or not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception '0187 postcondition: the body or security of % changed', v_sig;
  end if;
end
$m0187$;
-- <<< ENDE: supabase/migrations/0187_revoke_shop_policies_public.sql

/* Z0 — dieselben Messungen nachher. */
create temporary table policies_0187_nachher on commit drop as
select
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.sellers t) as sellers,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.id)), '-') from public.shop_inventory t) as shop_inventory,
  (select count(*)::text || '|' || coalesce(md5(string_agg(to_jsonb(t)::text, chr(10) order by t.user_id, t.sky_id, t.id)), '-') from public.collection_items t) as collection_items,
  (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, '(vorgabe)') || '|'
                     || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''),
                     chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not in ('admin_set_shop_policies')) as funktionsrechte,
  (select md5(string_agg(c.oid::regclass::text || '=' || coalesce(c.relacl::text, '(vorgabe)') || '|'
                     || c.relrowsecurity::text, chr(10) order by c.oid::regclass::text))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') ) as tabellenrechte,
  (select coalesce(md5(string_agg(pl.tablename || '.' || pl.policyname || '|' || pl.cmd || '|'
                     || array_to_string(pl.roles, ',') || '|' || coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, ''),
                     chr(10) order by pl.tablename, pl.policyname)), '(keine)')
     from pg_policies pl where pl.schemaname = 'public') as policies;

do $lauf_z$
begin
  /* Z1 — kein Wert hat sich bewegt. */
  if exists (select 1 from pg_temp.policies_0187_vorher v, pg_temp.policies_0187_nachher n
              where (v.sellers, v.shop_inventory, v.collection_items, v.funktionsrechte, v.tabellenrechte, v.policies)
                    is distinct from (n.sellers, n.shop_inventory, n.collection_items, n.funktionsrechte, n.tabellenrechte, n.policies)) then
    raise exception 'ABBRUCH Z1: der Lauf hat Daten, andere Rechte oder Policies bewegt — nichts wird angewendet';
  end if;

  /* Z2 — der Rumpf aus 0041 und die unberuehrten Helfer sind unveraendert. */
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)')) is distinct from 'db2dc5fb246f6789e5de62d78ea783ec'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_operate_active_seller()')) is distinct from '3e220b0b1a0b33d0b5ad9afc1be4719d'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.shop_setting_value(text,text)')) is distinct from '30a1922dba899beebdf451c862b3940f' then
    raise exception 'ABBRUCH Z2: ein Rumpf hat sich bewegt — 0187 aendert nur Rechte';
  end if;

  /* Z3 — die Rechte: authenticated und service_role, nie anon oder PUBLIC. */
  if not (select (has_function_privilege('authenticated', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')
               and has_function_privilege('service_role', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')
               and not has_function_privilege('anon', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where p.oid = to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)') and a.privilege_type = 'EXECUTE' and a.grantee = 0))) or (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'))
          and p.prosecdef
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
          and (select btrim(substring(c from 'search_path=(.*)$'), '"') = ''
                 from unnest(p.proconfig) c where c like 'search\_path=%')) <> '1' then
    raise exception 'ABBRUCH Z3: ein Recht oder die Form von admin_set_shop_policies steht nicht wie zugesagt';
  end if;

  raise notice '0187 ok: admin_set_shop_policies nur noch fuer authenticated und service_role; keine Zeile, kein anderes Recht bewegt.';
end
$lauf_z$;

commit;
