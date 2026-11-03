# Laufzettel — 0175 (Kontolöschung im Verkaufsabgleich) auf Staging

**Stand:** lokal vorbereitet, **nirgends angewendet**. Ausführen erst nach ausdrücklicher Freigabe
des Betreibers. **Nur Staging** (`qqxcpesbwfxzgytkdsac`). Production ist eine eigene, spätere
Entscheidung (ADR-0176).

## Was 0175 tut

`0175_sales_recon_account_deletion.sql` ersetzt **nur** den Rumpf von
`sales_recon_evidence_is_append_only()` (`aedd3c64…` aus `0169` → `ee1027ee…`). Danach lässt sich
ein Konto, das im Abgleich entschieden oder angewendet hat, wieder löschen: `decided_by` bzw.
`applied_by` werden dabei leer, sonst ändert sich keine Zeile. Jede andere Änderung und jedes
Löschen bleibt verboten — auch ein direktes `update … set decided_by = null`.

**Keine Datenanweisung.** Trigger, Fremdschlüssel, Rechte und Zeilen bleiben. Die Laufdatei misst
beide Belegtabellen vorher und nachher (jede Spalte) und bricht bei der kleinsten Bewegung ab.

## Ablauf (ADR-0137)

1. **Arbeitsbaum sauber, Tests grün:** `npm test`, `npm run check`, `npm run verify:sums`.
2. **Preflight und Baselines:** `npm run db:migrate:staging -- 0175`
   Erwartet: Zeile 9999 = `0`; 103 = `aedd3c64076884fbf29d0308f5e26ec7`, 102 = `2`, 104 = `0`,
   105 = `2`. Zeile 9998 ist für den Prüfzugang > 0 — 131–133 liest er bewusst nicht.
   **Preflight als `postgres` im SQL-Editor:** 9998 = `0`, 9999 = `0`; 131–133 notieren.
3. **Einfügen:** `supabase/operations/staging-0175.sql` vollständig in den SQL-Editor des
   Staging-Projekts, ausführen. Erwartet: die NOTICE-Zeilen `A3` und `0175 ok`, dann `commit`.
   Bricht etwas ab, ist **nichts** angewendet (eine Transaktion).
4. **Nachkontrolle:** `npm run db:migrate:staging -- 0175 --resume`
   Erwartet: Zeile 9999 = `0`; 201 = `ee1027ee285c6a31163fa3f123c07c73`.
5. **Berechtigter Lauf als `postgres`:** `supabase/log/staging/0175-postflight-berechtigt.sql`
   (vom Runner in Schritt 4 erzeugt, Baselines eingesetzt, `begin … rollback`) im SQL-Editor.
   Erwartet: **9998 = 0 und 9999 = 0**; 231–233 dieselben Werte wie Preflight 131–133.
6. **Rechte:** `npm run db:privileges:staging` (ADR-0140) — unverändert.
7. **Akte:** Zeile in `supabase/migrations/APPLIED.md` in die Staging-Tabelle verschieben,
   `npm run sums:write`.

## Danach

Der Funktionstest (`verify:sales-reconciliation:staging -- --apply`) legt seit dem Umbau kein
Konto mehr an; er arbeitet als das vorhandene Betriebskonto. `0175` ist für ihn deshalb keine
technische Voraussetzung mehr — wohl aber dafür, dass dieses Konto (und jedes andere, das im
Abgleich entscheidet) später gelöscht werden kann. Reihenfolge trotzdem: `0175`, dann der Test.

## Rückbau

`supabase/rollback/R0175_sales_recon_append_only_strict.sql` — setzt den Rumpf aus `0169` zurück.
Damit ist der Fehler wieder da: ein Konto, das entschieden hat, ist nicht mehr löschbar. Bereits
geleerte Kontoverweise bleiben leer.
