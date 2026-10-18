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
Spielraum, mit dem die Fälle H7–H9 noch korrigierbar wären. Preflight,
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

## Was ausdrücklich nicht geplant ist

* Keine Rücknahme von `0132` oder `0133` auf Production
  (`docs/history/2026-10-18-production-0132-0133.md`).
* Kein Abschalten des Triggers aus `0133`, in keiner Umgebung.
* Keine Korrektur von Lagerbeständen und keine Änderung an historischen
  Positionen, um eine Prüfung grün zu bekommen.
* Keine Freigabe der Eigenbelegausstellung (Freigabe B bleibt aus).
