# `supabase/operations` — betriebliche Schalter

**Keine Migrationen.** Diese Dateien gehören nicht in die Migrationskette,
nicht in `APPLIED.md` und nicht in die Reihenfolge eines Rollouts. Sie ändern
Production, sind aber **vollständig rücknehmbar** und werden nur nach einer
ausdrücklichen Entscheidung ausgeführt.

| Datei | tut | Gegenstück |
|---|---|---|
| `lock-receipt-issuance.sql` | entzieht **jeder API-Rolle** EXECUTE auf die zwei Funktionen, die einen Eigenbeleg entstehen lassen können | `unlock-…` |
| `unlock-receipt-issuance.sql` | stellt den Rechtestand her, den `0122`/`0128` erklären | — |

Nachweis, ob die Sperre hält: `supabase/checks/receipt_lock_check.sql`
(rein lesend, `9999 = 0`).

## Warum die Sperre jede Rolle einzeln nennt

`revoke execute … from authenticated` genügt **nicht**. `0122` entzieht
ausdrücklich nur `public` und `anon` und gibt `authenticated` EXECUTE — über
`service_role` sagt es nichts, und Supabase vergibt in `public`
Standardrechte auch an diese Rolle. Ein Aufruf mit dem Service-Role-Schlüssel
hätte eine halbe Sperre umgangen.

Und PUBLIC lässt sich nicht über die Rolle prüfen: PUBLIC steht nicht in
`pg_roles`, `has_function_privilege('public', …)` bricht ab. Geprüft wird
PUBLIC über den ACL-Eintrag — **ein leeres ACL ist dabei nicht harmlos**, denn
der Standard für Funktionen ist EXECUTE für PUBLIC.

`postgres` behält EXECUTE, sonst wäre die Sperre nicht rücknehmbar. Der
SQL-Editor ist kein API-Weg.

## Vollständigkeit

Über alle 131 Migrationen ausgezählt schreiben genau zwei Funktionen auf
`public.purchase_receipts` — `seller_issue_purchase_receipt(bigint)` (`0122`,
ersetzt in `0123`) und `seller_issue_purchase_receipt_correction(bigint)`
(`0128`). Kein Trigger auf dieser Tabelle feuert bei `insert`. Die Sperre
erfasst damit jeden Weg.

Nicht gesperrt und bewusst offen: Lesen, Herunterladen und der Abrufnachweis
(`seller_purchase_receipt`, `…_document`, `…_history`,
`seller_record_purchase_receipt_download`).

## Vor jeder Ausführung

1. `npm run verify:sums`
2. in `begin` / `commit` klammern
3. die `VORHER`-Ausgabe von `lock-receipt-issuance.sql` **ins Protokoll** —
   die Rücknahme braucht sie
4. danach `receipt_lock_check.sql`

Keine dieser Dateien ist ausgeführt.
