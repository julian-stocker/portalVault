-- ===========================================================================
-- RUECKNAHME DER SPERRE: Eigenbelege duerfen wieder ausgestellt werden
--
-- KEINE MIGRATION. Nur nach **Freigabe B** — der ausdruecklichen Erlaubnis,
-- auf Production rechtlich relevante Eigenbelege auszustellen. Die fuenf
-- Vorbedingungen stehen in `supabase/checks/release_0126_0131.md`,
-- Abschnitt 6.
--
-- WAS SIE HERSTELLT: genau den Rechtestand, den `0122` und `0128` erklaeren —
-- `public` und `anon` ohne EXECUTE, `authenticated` mit EXECUTE.
--
-- AUCH `service_role` BEKOMMT EXECUTE ZURUECK — und das ist kein Versehen.
-- ADR-0125 haelt fest, dass Supabase im Schema `public` Standardrechte an
-- `anon`, `authenticated` und `service_role` vergibt; `0122` und `0128`
-- entziehen ausdruecklich nur `public` und `anon`. `service_role` hatte das
-- Recht also vor der Sperre, und `0128_postflight` Pruefung 224 duldet es
-- ausdruecklich („service_role behaelt EXECUTE mit Absicht"). Eine Ruecknahme,
-- die es wegliesse, hinterliesse einen DRITTEN Zustand — weder gesperrt noch
-- der erklaerte. Deshalb wird hier genau der erklaerte Stand hergestellt.
--
-- Das Protokoll aus `lock-receipt-issuance.sql` Abschnitt 1 sagt, was vorher
-- wirklich galt. Weicht es ab, gilt das Protokoll, nicht diese Datei.
--
-- AUSFUEHRUNG: in `begin` / `commit`. Danach `receipt_lock_check.sql` —
-- `9999` muss dann **ungleich 0** sein, weil die Sperre bewusst nicht mehr
-- gilt. Genau diese Umkehrung ist der Nachweis.
-- ===========================================================================

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop

    if to_regprocedure(v_sig) is null then
      raise notice 'UEBERSPRUNGEN %: nicht vorhanden', v_sig;
      continue;
    end if;

    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
    raise notice 'ENTSPERRT %: authenticated und service_role duerfen wieder', v_sig;
  end loop;
end $$;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.seller_issue_purchase_receipt(bigint)',
    'public.seller_issue_purchase_receipt_correction(bigint)'] loop
    if to_regprocedure(v_sig) is null then continue; end if;

    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'Ruecknahme Abbruch: authenticated hat kein EXECUTE auf %', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'Ruecknahme Abbruch: anon hat EXECUTE auf % — das war nie so', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'Ruecknahme Abbruch: service_role hat kein EXECUTE auf % — dann waere der Stand nicht der aus 0122/0128 (ADR-0125)', v_sig;
    end if;
    /* PUBLIC darf auch nach der Ruecknahme nicht duerfen — und ein leeres
       ACL waere genau das. */
    if exists (select 1 from pg_proc p
                where p.oid = to_regprocedure(v_sig)
                  and (p.proacl is null
                       or exists (select 1 from unnest(p.proacl) a
                                   where a::text ~ '^='))) then
      raise exception 'Ruecknahme Abbruch: PUBLIC darf % ausfuehren (ACL-Eintrag oder leeres ACL)', v_sig;
    end if;
  end loop;
  raise notice 'Rechtestand wie in 0122/0128 erklaert. Ab jetzt koennen Belege entstehen.';
end $$;
