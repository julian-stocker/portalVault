# Laufzettel — 0176 (Prüfung vor der Wiedererkennung) auf Staging

**Stand:** lokal vorbereitet, **nirgends angewendet**. Ausführen erst nach ausdrücklicher Freigabe
des Betreibers. **Nur Staging** (`qqxcpesbwfxzgytkdsac`). Production ist eine eigene, spätere
Entscheidung (ADR-0177).

## Was 0176 tut

`0176_sales_recon_validate_before_dedup.sql` legt die reine Prüffunktion
`sales_recon_validate_payload(jsonb)` an (`44441ee3…`, liest keine Tabelle, für keine Clientrolle
ausführbar) und ersetzt den Rumpf von `seller_recon_create(jsonb)` (`c54080be…` aus `0172` →
`21fab5ff…`): der **ganze** Upload wird geprüft, bevor ein bereits bekannter Upload wiedererkannt
wird. Ein bekannter Upload mit verbotenem Inhalt wird damit abgewiesen statt mit seiner Sitzung
beantwortet. Ein korrekter bekannter Upload liefert weiter seine Sitzung.

**Keine Datenanweisung.** Rechte und Zeilen bleiben. Die Laufdatei misst die fünf Tabellen, die
`seller_recon_create` beschreibt, vorher und nachher (jede Spalte) und bricht bei der kleinsten
Bewegung ab.

## Ablauf (ADR-0137)

1. **Arbeitsbaum sauber, Tests grün:** `npm test`, `npm run check`, `npm run verify:sums`.
2. **Preflight und Baselines:** `npm run db:migrate:staging -- 0176`
   Erwartet: Zeile 9999 = `0`; 101 = `c54080be8908ef61589629314c1c0d9c`, 102 = `7`, 103 = `true`,
   111 = `true`. Zeile 9998 ist für den Prüfzugang > 0 — 131–135 liest er bewusst nicht.
   **Preflight als `postgres` im SQL-Editor:** `supabase/checks/0176_preflight.sql`;
   9998 = `0`, 9999 = `0`; 131–135 notieren und **zurückmelden** (Nachweis für die Akte).
3. **Einfügen:** `supabase/operations/staging-0176.sql` vollständig in den SQL-Editor des
   Staging-Projekts, ausführen. Erwartet: die NOTICE-Zeilen `A3` und `0176 ok`, dann `commit`.
   Bricht etwas ab, ist **nichts** angewendet (eine Transaktion).
4. **Nachkontrolle:** `npm run db:migrate:staging -- 0176 --resume`
   Erwartet: Zeile 9999 = `0`; 201 = `21fab5ff4ea2c7cb2550f3db821fce0f`,
   202 = `44441ee3b50a6bbf4f4fcbfda21d0e93`.
5. **Berechtigter Lauf als `postgres`:** `supabase/log/staging/0176-postflight-berechtigt.sql`
   (vom Runner in Schritt 4 erzeugt, Baselines eingesetzt, `begin … rollback`) im SQL-Editor, **in
   einem Lauf**. Erwartet: **9998 = 0 und 9999 = 0**; 231–235 dieselben Werte wie Preflight 131–135.
6. **Rechte:** `npm run db:privileges:staging` (ADR-0140) — unverändert.
7. **Akte:** Zeile in `supabase/migrations/APPLIED.md` in die Staging-Tabelle verschieben,
   `npm run sums:write`.

## Danach

Der Funktionstest (`verify:sales-reconciliation:staging -- --apply`) prüft seine Ablehnungen jetzt
als neuen **und** als bekannten Upload. Vor `0176` auf Staging scheitern die zwei Prüfpunkte
„… (known upload)“ — gewollt; nach `0176` müssen alle bestehen.

## Rückbau

`supabase/rollback/R0176_sales_recon_validate_after_dedup.sql` — setzt `seller_recon_create` auf den
Rumpf aus `0172` zurück und entfernt die Prüffunktion. Die Lücke ist dann wieder da.
**Reihenfolge bei einem vollständigen Rückbau des Abgleichs:** `R0176` zuerst, dann `R0175`,
`R0174`, `R0169_0173` — `R0169_0173` kennt die Prüffunktion aus `0176` nicht und ließe sie
stehen.
