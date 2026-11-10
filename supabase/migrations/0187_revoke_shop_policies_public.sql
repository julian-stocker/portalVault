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
