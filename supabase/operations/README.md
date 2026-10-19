# `supabase/operations` — betriebliche Schalter

**Keine Migrationen.** Diese Dateien gehören nicht in die Migrationskette,
nicht in `APPLIED.md` und nicht in die Reihenfolge eines Rollouts. Sie ändern
Production, sind aber **vollständig rücknehmbar** und werden nur nach einer
ausdrücklichen Entscheidung ausgeführt. Eine Datei kann auf **eine** Umgebung
beschränkt sein — `staging-agent-setup.sql` bricht auf Production von selbst
ab.

| Datei | tut | Gegenstück |
|---|---|---|
| `lock-receipt-issuance.sql` | entzieht **jeder API-Rolle** EXECUTE auf die zwei Funktionen, die einen Eigenbeleg entstehen lassen können | `unlock-…` |
| `unlock-receipt-issuance.sql` | stellt den Rechtestand her, den `0122`/`0128` erklären | — |
| `staging-agent-setup.sql` | **nur Staging**: Umgebungsstempel, Rolle `skyisles_agent` (SELECT auf 12 Tabellen mit je eigener Policy, EXECUTE auf 3 lesende Funktionen, Sitzung schreibgeschützt, **kein** `bypassrls`) | Rückbaurezept im Kopf der Datei |

**`staging-agent-setup.sql` fasst nichts Bestehendes an.** Sie enthält kein
`revoke execute`, kein `alter role` für eine andere Rolle als die neue, kein
`grant` an `anon`, `authenticated`, `service_role` oder `postgres` und kein
`drop policy`. Abschnitt 3 prüft **rein lesend** und über die **effektiven**
Rechte (`has_table_privilege`/`has_function_privilege`, also einschließlich
PUBLIC und Mitgliedschaften): kein Schreibrecht auf irgendeiner Relation, keine
Mitgliedschaft, kein EXECUTE auf einer der fünf sensiblen Funktionen, und die
Belegsperre für `anon`, `authenticated`, `service_role` und PUBLIC unverändert
dicht — sonst Abbruch.

`npm run verify:check-sql` fährt die Datei in PostgreSQL 18.6 durch (P15) samt
Gegenproben (P16): ohne Policy liest die Rolle 0 Zeilen, bei offener
Belegsperre bricht die Datei ab. P17 ruft die 21 von PUBLIC erreichbaren
Schreib- und `security definer`-Funktionen als die neue Rolle auf — **21 von
21** werden abgewiesen. P18 prüft die Rollenmitgliedschaft in beiden
Richtungen, P19 die Diagnosedatei. Plan und Phasen:
`supabase/checks/staging_agent_access_plan.md`.

**Berichtigt am 2026-10-19.** Der erste Lauf brach ab: die Nachbedingung
verbot **jede** Mitgliedschaft an der Rolle, und PostgreSQL legt selbst eine
an, sobald ein `CREATEROLE`-Nutzer ohne Superuser-Recht die Rolle erzeugt
(`admin` ja, `inherit`/`set` nein — ein Verwaltungsgriff, kein Rechteweg).
Geprüft wird jetzt das Gefährliche: fremde Mitglieder und Mitgliedschaften mit
`inherit`/`set`. Die Datei ist außerdem **wiederholbar** geworden. Diagnose des
Vorfalls: `supabase/checks/staging_agent_role_diagnosis.sql`.

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

## Was wo angewendet wurde

| Umgebung | Belegsperre | Nachweis |
|---|---|---|
| **Production** `zmiwxswrpkmizvqsgype` | angewendet (nach `0128`) | `supabase/migrations/APPLIED.md`, Production-Abschnitt · `docs/history/2026-10-17-production-0126-0131.md` |
| **Staging** `qqxcpesbwfxzgytkdsac` | **angewendet**, manuell im SQL-Editor, beide Postflights bestanden | `supabase/checks/open_verifications.md`, **Abschnitt 0d** — dort stehen ACL vorher und nachher, Belegzahlen und beide Prüfergebnisse |

**Beides sind Betriebsvorgänge, keine Migrationen.** Sie stehen deshalb in
keiner Migrationstabelle und werden nicht als angewendete Migration geführt.

## Pre- und Postflight der Belegsperre — zwei vorhandene Dateien, keine neue

**Geprüft am 2026-10-18 für den Staging-Zustand A** (`0122`/`0128`:
`authenticated` und `service_role` dürfen ausstellen, PUBLIC und `anon` nicht).
Es braucht dafür **keine neue Prüfdatei**; die beiden vorhandenen decken den
Vorgang vollständig ab:

| Schritt | Datei | Erwartung |
|---|---|---|
| **Preflight** | `supabase/checks/receipt_grants_diagnosis.sql` | `9999 = 0` · Zeile **401** = „A MIGRATIONSSTAND" · Zeilen 201/202 zeigen den ACL im Volltext (**ins Protokoll**, die Rücknahme braucht ihn) · 211/212 `false` (ACL vorhanden) · 311/321 `false` (`anon`) · 391/392 `false` (PUBLIC) · 341/351 `true` (`postgres`) · **402** = Zahl der Belege (Bezugswert) |
| **Postflight 1** | `supabase/checks/receipt_lock_check.sql` | `9999 = 0` · jede API-Rolle `false` · PUBLIC `false` · 200/201 `postgres` `true` · 300 `0` (kein INSERT-Trigger) · 304 `2` (Unveränderlichkeits-Trigger) · 301 **dieselbe** Belegzahl wie im Preflight |
| **Postflight 2** | `supabase/checks/receipt_grants_diagnosis.sql` erneut | Zeile **401** = „B GESPERRT" · Zeile **103 und 3x3** zeigen: der **Abruf** (`seller_purchase_receipt_history`) ist weiterhin für `authenticated` erlaubt · **402** unverändert |

**Warum zwei Postflights:** `receipt_lock_check.sql` beweist die Sperre, sagt
aber nichts über den Abrufweg; die Diagnose zeigt beides und nennt den Stand in
einem Wort. Zusammen beantworten sie auch die Frage, die eine Sperre immer
aufwirft — bleiben bestehende Belege unberührt und lesbar.

### Eigenschaften der Datei, mechanisch nachgewiesen

* Sie besteht aus **drei `DO`-Blöcken**; der einzige dynamisch ausgeführte
  Befehl ist `revoke execute on function`. Kein `insert`, `update`, `delete`,
  `truncate`, `drop`, kein `alter table`, kein `grant` — ausgezählt über den
  entschärften Dateitext.
* **Idempotent:** ein `revoke` auf ein nicht vergebenes Recht ist in
  PostgreSQL ein No-op. Ein zweiter Lauf ändert nichts und bricht nicht ab.
* **Transaktionssicher:** in `begin` / `commit` geklammert rollt die
  Nachbedingung in Abschnitt 3 die Sperre zurück, wenn sie nicht hält
  (`raise exception`). Rechte sind in PostgreSQL transaktional.
* **`postgres` behält EXECUTE** — Abschnitt 3 bricht ausdrücklich ab, wenn
  nicht. Ohne das wäre die Sperre nicht mehr rücknehmbar.
* **Keine Abhängigkeit zu `0132`, `0133` oder `0134`.** Sie berührt nur die
  Rechte zweier Funktionen aus `0122`/`0128`. Umgekehrt gilt: `create or
  replace function` **erhält** den ACL, eine spätere Ersetzung dieser
  Funktionen würde die Sperre also nicht aufheben. Ein `drop` und Neuanlegen
  würde sie verlieren — genau dagegen gibt es `receipt_lock_check.sql`.
