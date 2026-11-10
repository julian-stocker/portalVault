-- ===========================================================================
-- R0187 — Rücknahme von 0187: die Rechte von admin_set_shop_policies wie vorher
--
-- ACHTUNG: Diese Rücknahme stellt den Stand VOR 0187 wieder her — und der war
-- die Lücke (EXECUTE für PUBLIC und anon). Nur verwenden, wenn 0187 selbst ein
-- Problem verursacht, etwa wenn ein legitimer Aufrufer nicht mehr durchkommt.
-- Der Funktionskörper wird nicht angefasst; die interne Rollenprüfung
-- (`can_operate_active_seller`) bleibt in beiden Ständen die eigentliche
-- Sperre.
--
-- Gemessen vor 0187 (Staging-Schema vom 2026-11-09): EXECUTE für PUBLIC
-- (Vorgabe, kein REVOKE), anon, authenticated und service_role.
-- ===========================================================================

grant execute on function public.admin_set_shop_policies(text, text, text, boolean, boolean, text, text, text, numeric)
  to public, anon, authenticated, service_role;
