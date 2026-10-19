# Staging nachziehen — `0132`, `0133` und der Schreibnachweis

**Stand 2026-10-18.** Production trägt `0126`–`0133`. Staging trägt `0126`–`0131`.
Die beiden Umgebungen stehen damit in der falschen Reihenfolge, und Staging ist
die Umgebung, in der der Schreibnachweis zu `0132` überhaupt geführt werden kann
(auf Production werden keine Testzeilen angelegt).

**Nichts in dieser Datei ist ausgeführt.** Jeder Schritt wartet auf eine eigene
Freigabe.

## Vor dem ersten Schritt: die Umgebung benennen

Der Vorfall vom 2026-10-18 war nicht durch einen Prüffehler möglich, sondern
dadurch, dass ein Ergebnisblatt nicht sagt, aus welcher Datenbank es kommt.
Deshalb gilt ab jetzt für jeden Lauf:

1. Die Projektkennung aus der Adresszeile des SQL-Editors ins Protokoll
   schreiben, **vor** dem ersten Befehl. Staging ist `qqxcpesbwfxzgytkdsac`,
   Production ist `zmiwxswrpkmizvqsgype`.
2. Jede Prüfdatei dieser Reihe trägt als erste Zeile einen Umgebungsstempel:
   `Testfiguren SKY-9101/SKY-9998` — **2 bedeutet Staging, 0 bedeutet
   Production**. Er ist ohne Sollwert, weil dieselbe Datei in beiden Umgebungen
   läuft; gelesen werden muss er trotzdem.
3. Weicht der Stempel von der erwarteten Umgebung ab: abbrechen, nichts
   ausführen, melden.

## Die Reihenfolge, verbindlich (Stand 2026-10-18)

Acht Schritte. **Jeder mit eigener Freigabe**, und die drei schreibenden sind
ausdrücklich markiert.

| # | Schritt | Art | Freigabe |
|---|---|---|---|
| 0 | `0132_preflight.sql` · `0132_staging_readiness.sql` · `receipt_grants_diagnosis.sql` | lesend | **erteilt und gelaufen** (2026-10-18) |
| 1 | `operations/lock-receipt-issuance.sql` — die Belegsperre | **SCHREIBT Rechte** | offen |
| 2 | `receipt_lock_check.sql` **und** `receipt_grants_diagnosis.sql` erneut | lesend | mit Schritt 1 |
| 3 | `0132_staging_readiness.sql` erneut (berichtigte Fassung) | lesend | mit Schritt 1 |
| 4 | Migration `0132` | **SCHREIBT Funktionen** | offen |
| 5 | `0132_postflight.sql` | lesend | mit Schritt 4 |
| 6 | **H1–H12** über `npm run dev:staging` | **SCHREIBT Daten** | offen |
| 7 | Migration `0133` mit Pre- und Postflight | **SCHREIBT Trigger** | offen |
| 8 | `0134` | — | **gesperrt** |

**Warum die Belegsperre vor `0132` und nicht danach:** sie ist von `0132`
unabhängig, und sie entscheidet, was **H12** auf Staging überhaupt beweisen
kann. Ohne sie ist die einzige Schranke `RECEIPT_ISSUANCE_RELEASED = false` in
der Oberfläche — H12 zeigte dann nur, dass kein Knopf da ist, nicht dass die
Datenbank verweigert. Mit ihr prüft H12 dasselbe wie auf Production.

**Was die Sperre kostet:** danach lässt sich auf Staging kein Eigenbeleg mehr
ausstellen oder korrigieren, auch nicht für einen künftigen Belegtest. Die
beiden bereits vorhandenen Belege bleiben unberührt und abrufbar. Rücknehmbar
mit `unlock-receipt-issuance.sql`.

**Schritt 6 ist der einzige Schritt, der Geschäftsdaten schreibt** — H4 legt
eine Position an, H5 bucht sie ein, H6 entfernt sie wieder. Er findet
**ausschließlich auf Staging** statt. Auf Production wären es erfundene Zeilen
in der echten Historie.

**Verbindliche Fallnummern H1–H12:** `supabase/checks/0132_test_plan.md`. Diese
Liste ist die einzige Quelle; ältere Beschreibungen mit anderer Nummerierung
sind am 2026-10-18 angeglichen worden.

## Schritt 1 — Bestandsaufnahme auf Staging (rein lesend)

| Datei | Erwartung auf Staging |
|---|---|
| `supabase/checks/0132_preflight.sql` | Zeile 1 zeigt **2**. Zeile 102 (`die Herkunftsbedingung steht noch drin`) `true` — `0132` ist hier nicht angewendet. 201 und 203 müssen **0** sein |
| `supabase/checks/0133_preflight.sql` | der Trigger fehlt noch |

Die Zeilen 202 (Zustände) und 307 (Eröffnungsbestand) sind Messungen ohne
Sollwert. **Ihre Werte sind auf Staging andere als auf Production** — notieren,
nicht vergleichen.

## Schritt 2 — `0132` auf Staging

Einzeln, in `begin` / `commit`, mit Postflight in derselben Sitzung:

```
begin;
  -- Inhalt von supabase/migrations/0132_purchase_item_remove_by_line.sql
commit;
```

Danach `supabase/checks/0132_postflight.sql`. **Erwartet `9999 = 0`** — mit den
korrigierten Prüfungen 202 und 303 (ADR-0127) gibt es keine bekannte Abweichung
mehr. Zeigt 9999 etwas anderes als 0, wird nicht weitergemacht.

Abbruchkriterium: Zeile 102 des Postflight muss `false` sein (die
Herkunftsbedingung ist weg) und 103 `true` (die vier Zeilenbedingungen stehen).

## Schritt 3 — der Schreibnachweis H1–H12

`supabase/checks/0132_test_plan.md`, über die Oberfläche: `npm run dev:staging`,
angemeldet als Betrieb. Die zwölf Fälle sind der Teil, den kein SELECT zeigen
kann — Entfernen, Nachtragen, Einbuchen, die Zahlung. Erst danach ist `0132`
vollständig nachgewiesen.

**Nicht auf Production ausführen.** H4 und H5 legen Positionen an und buchen sie
ein; das wären erfundene Zeilen in der echten Geschäftshistorie.

## Schritt 4 — `0133` auf Staging

Erst nach Schritt 3, denn `0133` macht die Summe hart und nimmt damit den
Spielraum, mit dem eine im H-Lauf falsch eingetippte Summe noch zu berichtigen
wäre — betroffen sind **H10** (die Summe ist unveränderlich) und **H11** (die
Aufteilung ergänzen). Verbindliche Fallnummern: `0132_test_plan.md`. Preflight,
Migration, Postflight; `9999 = 0` in beiden.

Danach `supabase/checks/0133_production_readonly.sql` auch auf Staging laufen
lassen: dieselbe Datei, dieselben Sollwerte außer dem Umgebungsstempel (dort
**2**). Zeile 203 nennt die Funktionen, die `purchases` schreiben und die
bezahlte Summe anfassen — erwartet ist genau `seller_update_purchase`.

## Schritt 5 — `0134`

**Bleibt gesperrt** (Entscheidung des Betreibers vom 2026-10-18). Wenn sie
freigegeben wird, gilt dieselbe Reihenfolge: Staging zuerst, dann Production,
und das Deployment der Oberfläche **nach** der Migration — `canRemoveItem()`
liest `source_row` aus der Antwort von `seller_purchase()`, und eine Oberfläche,
die das Feld erwartet, bevor die Funktion es liefert, bekommt `null` und bietet
für die wiedereröffneten Importzeilen wieder ein Entfernen an, das scheitert.

## Schritt 6 — `0135` und `0136` (Z1), unabhängig von allem oben

**Diese beiden hängen nicht an `0132`–`0134` und dürfen vor ihnen laufen.** Das
ist an den berührten Objekten ablesbar und in
`supabase/migrations/APPLIED.md` ausgezählt („Die Nummer ist eine Reihenfolge,
keine Kette"): `0133` ändert einen Trigger an `purchases`, `0134` eine
Funktion über `purchases`/`purchase_items`, `0135` die Tabelle `skylanders`
und `is_shop_eligible`, `0136` die Exportfunktion. Die Schnittmenge der
**geänderten** Objekte ist leer.

Die eine echte Abhängigkeit liegt **innerhalb** von Z1: `0136` setzt `0135`
voraus, weil ihr Rumpf `t.item_type` liest und ein `language sql`-Rumpf bei der
Erzeugung aufgelöst wird.

**Der vollständige Laufzettel steht in
`supabase/checks/0135_0136_staging_run.md`** — Dateinamen, Reihenfolge S0–S11,
Transaktionsrahmen, Vertragszeile, Erwartungen und Abbruchkriterien je Schritt,
der Umgang mit einer abgebrochenen Transaktion und die Rücknahme. Die Tabelle
hier ist die Kurzfassung.

| # | Schritt | Art | Freigabe |
|---|---|---|---|
| 6a | `staging_pending_migrations.sql` — `0133`/`0134` fehlen, Umgebungsstempel | lesend | offen |
| 6b | `0135_preflight.sql` **mit** `set_config('skyisles.z0', 'staging', true)` | lesend | offen |
| 6c | Migration `0135` | **SCHREIBT Schema + Backfill** | offen |
| 6d | `0135_postflight.sql`, gleiche Vertragszeile | lesend | mit 6c |
| 6e | `0136_preflight.sql` — erwartet `STAND_0131` | lesend | offen |
| 6f | Migration `0136` | **SCHREIBT eine Funktion** | offen |
| 6g | `0136_postflight.sql` und `0131_function_body_check.sql` — `STAND_0136` | lesend | mit 6f |
| 6h | `receipt_lock_check.sql`, `0132_postflight.sql`, `staging_pending_migrations.sql` erneut | lesend | mit 6f |

Beide Migrationen gehören **vollständig in `begin` / `commit`**. `0135` bricht
von selbst ab, wenn das fehlt (die Temporärtabelle mit `on commit drop` ist
dann schon wieder fort, bevor die Spalte entsteht), `0136` ebenso. Nach einem
Abbruch bleibt in beiden Fällen nichts zurück.

**Rücknahme, falls nötig:** `R0136_back_to_0131.sql` **vor**
`R0135_drop_item_type.sql`. `R0135` verweigert, solange die Sicherung
`item_type` liest, und sagt das auch.

Der Z0-Vertrag (534 / 256 / `4d1d6c30fe0ae886ca2689bcb1fe9634` / 534 / 39)
steht in den Prüfdateien selbst; eingetippt wird nur der Modus. Begründung und
Nachweis: `open_verifications.md`, Abschnitt 0f.

## Was ausdrücklich nicht geplant ist

* Keine Rücknahme von `0132` oder `0133` auf Production
  (`docs/history/2026-10-18-production-0132-0133.md`).
* Kein Abschalten des Triggers aus `0133`, in keiner Umgebung.
* Keine Korrektur von Lagerbeständen und keine Änderung an historischen
  Positionen, um eine Prüfung grün zu bekommen.
* Keine Freigabe der Eigenbelegausstellung (Freigabe B bleibt aus).
* Kein Katalogartikel für Portale oder Spiele (Z3) — `0135` und `0136` legen
  keine SKY-ID an und ändern keinen `display_name_override`.
