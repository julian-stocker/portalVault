# Folgeaufgabe: vier Spalten fehlen in der Plattformsicherung

**Stand 2026-10-21. Nicht behoben, nicht eingeplant, nicht dringend —
aber erfasst, damit es nicht nur im Chatverlauf steht.**

---

## Der Befund

Die **Plattformsicherung** (`/admin/datensicherung`,
`system_platform_export()` aus `0105`) führt **vier Spalten nicht**, die das
Release `0135`–`0141` eingeführt hat:

| Spalte | seit | Bereich der Plattformsicherung |
|---|---|---|
| `skylanders.item_type` | `0135` | Katalog (`source: skylanders`) |
| `skylanders.usk_rating` | `0139` | Katalog |
| `shop_inventory.sale_released` | `0139` | `shop_inventory` |
| `shop_inventory.delivery_scope` | `0139` | `shop_inventory` |

`src/lib/backup/platform-manifest.ts` nennt sie in den Feldlisten der beiden
Bereiche nicht, und `0105` ist die letzte Migration, die
`system_platform_export()` schreibt — die Funktion kennt die Spalten also
auch nicht.

## Warum es niemandem aufgefallen ist

`src/lib/backup/manifest-gap.test.ts` hält für die **Betriebssicherung** fest,
dass jede Spalte des Schemas entschieden ist — drin oder begründet draußen.
Für die Plattformsicherung gibt es diese Zusicherung **nicht**:
`platform-manifest.test.ts` prüft, dass jede **Tabelle** entschieden ist
(`unentschiedene Tabellen` muss leer sein), nicht jede Spalte. Eine neue
Spalte in einer bereits entschiedenen Tabelle fällt damit durch.

Das ist der eigentliche Befund: nicht die vier Spalten, sondern die fehlende
Prüfung, die sie hätte nennen müssen.

## Was es praktisch bedeutet

Die Plattformsicherung ist die Sicherung für den **Totalverlust** — 53
Bereiche, Konten-Inventar, Storage-Dateien, gedacht für einen Wiederaufbau
von null. Nach einem solchen Wiederaufbau wäre:

* der Artikeltyp jeder Katalogzeile verloren → 39 Spiele und 21 Portale
  wären wieder Figuren, bis der Trigger aus `0135` sie bei einem Neuimport
  aus der Kategorie ableitet (das tut er — aber nur für Zeilen, die über den
  Import kommen);
* die Alterskennzeichnung verloren → kein Spiel wäre freigebbar, bis sie von
  Hand neu erfasst ist;
* jede Verkaufsfreigabe und jeder Lieferumfang verloren → nichts wäre
  freigegeben, und niemand könnte sagen, was vorher freigegeben war.

**Heute ist der Schaden klein**, weil alle drei Angaben überall leer sind: 0
Freigaben, 0 Lieferumfänge, 0 USK-Kennzeichnungen (am 2026-10-21 gemessen).
Er wächst mit der ersten Freigabe.

Die **Betriebssicherung** führt alle vier seit `0140` (28 Bereiche, 356
Feldzeilen) — der Katalog- und Lagerstand ist dort also abgedeckt.

## Was zu tun wäre, und was dafür entschieden werden muss

1. **Entscheiden**, ob die vier Spalten in die Plattformsicherung gehören.
   Die Antwort ist absehbar ja — sie tragen Entscheidungen, die sich aus
   nichts anderem rekonstruieren lassen (dieselbe Begründung wie in `0140`).
   Trotzdem ist es eine Entscheidung und kein Automatismus: `platform-manifest.ts`
   ist ein Vertrag, und `restoreRelevant` ist pro Bereich gesetzt.
2. **Eine neue Migration**, die `system_platform_export()` neu schreibt — wie
   `0130`/`0131` es für die Betriebssicherung getan haben: Abdruck der
   unberührten Bereiche vorher, Vergleich nachher, keine Rechteänderung.
   Sie kommt **nicht** in dieses Release; `0135`–`0141` ist abgeschlossen.
3. **Die Prüflücke schließen**, und zwar als Erstes: ein Test, der für die
   Plattformsicherung dasselbe verlangt wie `manifest-gap.test.ts` für die
   Betriebssicherung — jede Spalte entschieden, drin oder begründet draußen.
   Ohne ihn entsteht die nächste Lücke genauso unbemerkt.

**Reihenfolge:** erst 3, dann 1, dann 2. Der Test zeigt dann die vollständige
Liste der unentschiedenen Spalten — es könnten mehr als diese vier sein, und
eine Entscheidung über eine unvollständige Liste wäre wieder eine halbe.

## Was dieser Befund NICHT ist

* **Kein Blocker für `0135`–`0141`.** Keine der sieben Migrationen berührt
  die Plattformsicherung.
* **Kein Datenverlust heute.** Nichts ist verloren; eine Sicherung führt drei
  leere und eine abgeleitete Angabe nicht mit.
* **Keine Sicherheitslücke.** Es fehlt etwas in einer Sicherung, es ist
  nichts zugänglich, was es nicht sein soll.
