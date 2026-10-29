-- ===========================================================================
-- STAND DER DREI OFFENEN MIGRATIONEN 0150, 0151, 0153 — REIN LESEND
--
-- WOZU. `APPLIED.md` fuehrt sie als „lokal vorbereitet, nirgends
-- angewendet". Eine Akte ist aber eine Behauptung, bis sie gemessen ist —
-- und genau diese Art stiller Veralterung ist der Grund, warum die Akte
-- ueberhaupt existiert (`0144`, `0146`, `0152`, `0154`-`0158` standen alle
-- einmal falsch darin). Diese Datei fragt die Objekte selbst.
--
--   701-704  `0150` (Verfuegbarkeitsalarme): Tabelle und die drei
--            Funktionen. Sie legt `availability_alerts` an.
--   711-714  `0151` (`offer_state_live`): die SICHT. Besonderheit — `0146`
--            hat sie auf Staging schon angelegt, `0151` stellt sie nur
--            unabhaengig bereit und laesst eine vorhandene unberuehrt. Hier
--            steht sie also womoeglich, OHNE dass `0151` gelaufen ist; der
--            Unterschied liegt im Kommentar, den `0151` setzt.
--   721-723  `0153` (Katalogstatus in der Plattformsicherung): der Abdruck
--            des Rumpfes von `system_platform_export()`. `4c4d2e7c…` ist
--            die Fassung aus `0144`, `92c48444…` die aus `0153`.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund) as (values
  (701, '0150', 'Tabelle availability_alerts',
      case when to_regclass('public.availability_alerts') is null
             then 'FEHLT (0150 nicht angewendet)' else 'steht' end),
  (702, '0150', 'alert_arm(text)',
      case when to_regprocedure('public.alert_arm(text)') is null
             then 'FEHLT' else 'steht' end),
  (703, '0150', 'alert_withdraw(text)',
      case when to_regprocedure('public.alert_withdraw(text)') is null
             then 'FEHLT' else 'steht' end),
  (704, '0150', 'my_alerts()',
      case when to_regprocedure('public.my_alerts()') is null
             then 'FEHLT' else 'steht' end),

  (711, '0151', 'Sicht offer_state_live',
      case when to_regclass('public.offer_state_live') is null
             then 'FEHLT' else 'steht' end),
  (712, '0151', 'ihre Spalten',
      coalesce((select string_agg(a.attname::text || ' ' || format_type(a.atttypid, null),
                                  ', ' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.offer_state_live')
                   and a.attnum > 0 and not a.attisdropped), '(keine)')),
  /*
   * DER UNTERSCHIED ZWISCHEN `0146` UND `0151`. Beide koennen diese Sicht
   * angelegt haben. `0151` setzt dabei einen Kommentar; steht er nicht, ist
   * die Sicht die aus `0146` — und `0151` ist nicht gelaufen.
   */
  (713, '0151', 'ihr Kommentar (0151 setzt einen, 0146 nicht)',
      coalesce(obj_description(to_regclass('public.offer_state_live'), 'pg_class'),
               '(keiner — dann ist es die Fassung aus 0146)')),
  (714, '0151', 'Clientrechte auf ihr (0151 vergibt keine)',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid = to_regclass('public.offer_state_live')
          and a.grantee::regrole::text in ('anon', 'authenticated'))),

  (721, '0153', 'system_platform_export() steht',
      case when to_regprocedure('public.system_platform_export()') is null
             then 'FEHLT' else 'steht' end),
  (722, '0153', 'Abdruck ihres Rumpfes (0144 = 4c4d2e7c…, 0153 = 92c48444…)',
      coalesce((select md5(p.prosrc) from pg_proc p
                 where p.oid = to_regprocedure('public.system_platform_export()')),
               '(keine)')),
  (723, '0153', 'nennt der Rumpf catalog_status? (nur 0153 tut das)',
      coalesce((select (p.prosrc like '%catalog_status%')::text from pg_proc p
                 where p.oid = to_regprocedure('public.system_platform_export()')),
               '(keine)'))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
