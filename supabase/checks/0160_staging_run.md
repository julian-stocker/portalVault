# 0160 auf Staging — der Laufzettel

**`base_sky_id` kommt in die Plattformsicherung.** CAT-07, Nachtrag; die
Folgemigration, die ADR-0156 angekündigt hat. **Stand 2026-10-28: auf Staging
angewendet und vollständig geprüft** (Abschnitt „Der Lauf" unten); auf
Production nicht.

## Worum es geht

`0159` gibt jeder Variante eine direkte Beziehung zu ihrer Basisfigur. Die
Plattformsicherung führt sie nicht — ihre Spaltenliste steht im Rumpf von
`system_platform_export()`, und der ist älter.

**Die Frage in einem Satz:** steht eine Variante nach einer Wiederherstellung
wieder unter ihrer Basisfigur?

Heute lautet die Antwort **nein**. `database.json` führt `character_id`, also
die **Familie** — „Chrome Spyro" und „Spyro" gehören demselben Charakter.
Was fehlt, ist die **Mitte**: welche Figur derselben Serie die Basis ist.
Nach einer Wiederherstellung käme jede Variante als eigenständige Figur
zurück, mit SKY-ID, Namen, Preis und Familie, aber ohne Basis. Im Katalog
sähe das nicht nach einem Fehler aus, sondern nach einer falschen
Sortierung — und genau diese Leisheit ist der Grund für diese Migration.

## Die eine Änderung

```diff
  'character_id', t.character_id,
+ 'base_sky_id',  t.base_sky_id,
```

Alles andere ist **Zeichen für Zeichen** der Rumpf aus `0153`. 31 072 Zeichen
gehen unverändert durch, 31 114 kommen heraus.

| | |
|---|---|
| Abdruck vorher | `92c48444f99b9e294f9703d0c0ddeaa8` (der Rumpf aus `0153`, 54 Bereiche) |
| Abdruck nachher | `ff4f38e61cbd4e5857ea914d6be68d44` (54 Bereiche, ein Feld mehr) |
| Länge | 31 072 → 31 114 Zeichen (+42, die eine Zeile) |
| Bereiche | 54 → **54** |
| `format_version` | 2 → **2** |

**Die Umkehrprobe ist die Zusage:** neuer Rumpf **minus** die eine Zeile ist
byteweise der alte. `src/lib/backup/platform-export-0160.test.ts` rechnet das
bei jedem Testlauf nach, `0160_postflight.sql` Zeile 105 am **lebenden** Rumpf
in der Datenbank. Eine zweite Änderung, irgendwo in 31 072 Zeichen, fällt
damit auf, auch wenn niemand sie sucht.

## Was sich nicht ändert

* **Ein Feld, kein Bereich.** Deshalb bleibt `format_version` bei 2 und
  Archive der Version 2 **ohne** dieses Feld bleiben lesbar. Die
  Vollständigkeitsprüfung in `src/lib/backup/platform-archive.ts` zählt
  Bereiche, nicht Felder — nachgerechnet im Test, nicht angenommen.
* **Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie,
  kein Index, kein Recht, keine Constraint.** Nur ein Funktionsrumpf.
* **Der Fremdschlüssel aus `0159` wird nicht angefasst** — insbesondere wird
  er nicht `deferrable`. Warum nicht: `0160_restore_order.md`, Abschnitt 4.
* **Die Betriebssicherung bleibt unberührt.** `seller_business_backup()`
  führt `base_sky_id` nicht und soll es nicht: eine Variantenbeziehung ist
  redaktionelle Gruppierung der Plattform, kein Händlerdatum. Dieser
  Ausschluss in `src/lib/backup/manifest.ts` hat **kein** Ablaufdatum.

## Die Reihenfolge ist eine Vorbedingung

Diese Datei ist aus dem Rumpf von `0153` **gerechnet** und ersetzt nur genau
diesen. Vier Fälle, vier Meldungen:

| vorhandener Abdruck | was passiert |
|---|---|
| `92c48444…` (`0153`) | **der erwartete Fall** — die Migration läuft |
| `ff4f38e6…` (`0160`) | Abbruch: „ist schon der neue" — ein zweiter Lauf prallt ab |
| `4c4d2e7c…` (`0144`) | Abbruch mit eigener Meldung: erst `0153` anwenden |
| `2e2da90e…` (`0105`) | Abbruch mit eigener Meldung: erst `0144`, dann `0153` |
| irgendetwas anderes | Abbruch: „eine unbekannte Fassung wird nicht blind überschrieben" |

**Auf Production steht der Rumpf aus `0105`.** Diese Migration bricht dort
kontrolliert ab. Wer die Reihenfolge auflösen will, nimmt `0144`, `0152`,
`0153` und `0159` nach Production und kann danach diese Datei dort fahren.

## Die Schritte

1. **Preflight** (rein lesend):
   ```
   npm run db:migrate:staging -- 0160
   ```
   Erwartet `9999 = 0`. Zeile 112 belegt, dass hier wirklich der Rumpf aus
   `0153` steht; Zeile 116 belegt den Anlass (`base_sky_id` kommt im Rumpf
   noch nicht vor); Zeile 131 sagt, wie viele Varianten auf dem Spiel stehen,
   und Zeile 137 ist der **Abdruck der Beziehung**, den die Nachkontrolle
   wieder nennt.

2. **Die eine schreibende Anweisung** — vom Bediener, im SQL-Editor von
   `qqxcpesbwfxzgytkdsac`:
   ```
   supabase/operations/staging-0160.sql
   ```
   Vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**

3. **Nachkontrolle**:
   ```
   npm run db:migrate:staging -- 0160 --resume
   ```
   Erwartet `9998 = 0` und `9999 = 0`. Zeile 139 liest das Journal und ist
   beim lesenden Prüfzugang **offen** — dafür gibt es wie bei `0158` und
   `0159` die berechtigte Datei, die der Runner erzeugt.

## Die Wächter der Hülle

| | Was er abfängt |
|---|---|
| **A1** | falsche Umgebung — der Stempel `SKY-0821`/`SKY-0822` fehlt |
| **A2** | `skylanders.base_sky_id` fehlt (`0159` nicht angewendet) |
| **A3** | der Rumpf ist nicht der aus `0153` — vier Fälle, vier Meldungen |
| **A4** | die Sicherung ist nicht `security definer`/`stable`, oder sie trägt ein offenes `EXECUTE` |
| **A5** | die Variantenbeziehung ist heute nicht sauber: eine Kette, eine Zuordnung über Seriengrenzen oder ein verwaister Verweis. Gesichert wird nur ein Zustand, den `0159` zulässt |
| **A6** | NOTICE, kein Riegel: wie viele Varianten ohne diese Migration ihre Basisfigur verlieren würden |

## Stoppbedingungen

* `ABBRUCH A1`–`A5` — die Lage ist zu klären, nicht zu überschreiben
* Preflight Zeile 112 ≠ `92c48444…` — hier steht nicht der Rumpf aus `0153`
* Nachkontrolle Zeile 102 ≠ `ff4f38e6…` oder Zeile 105 ≠ `92c48444…` — **das
  ist die Zusage dieser Migration**
* Nachkontrolle Zeile 107 ≠ `31114` — es ist mehr als eine Zeile verändert
* Nachkontrolle Zeile 109 ≠ `true` — `catalog_status` aus `0153` ist fort,
  die Ersetzung ist einen Schritt zu weit gegangen
* Nachkontrolle Zeile 137 ≠ Preflight Zeile 137 — eine Zuordnung hat sich
  bewegt, obwohl diese Migration keine anfasst
* eine veränderte Angebots-, Lager-, Katalog- oder Sammlungszahl (811–817,
  831–833 gegen die eingefrorene Baseline)

## Was gemessen ist, bevor jemand etwas ausführt

Probelauf **P69** (`npm run verify:check-sql`) fährt gegen echtes PostgreSQL:

* eine **Basisfigur und drei Varianten**, exportiert, gelöscht und aus dem
  Archiv wieder eingespielt — **in der schlechtesten Reihenfolge**, Varianten
  vor der Basisfigur, in **einer** Anweisung: läuft durch, jede Beziehung
  steht wieder
* **ohne `0160`** fehlt das Feld im Archiv, während `character_id` dasteht —
  die Lücke, gemessen
* **zeilenweise** in derselben Reihenfolge: `23503`, am Fremdschlüssel
* **`set constraints all deferred`** hilft **nicht** — die Anweisung läuft
  durch und tut nichts, weil der Fremdschlüssel nicht aufschiebbar ist
* **zwei Durchgänge** (erst `NULL`, dann `UPDATE`) führen zum selben Ergebnis
  und schreiben **keine** Journalzeile
* die Riegel: ohne `0159`, gegen `0105`, gegen `0144`, zweiter Lauf
* die **Rücknahme** `R0160` stellt den Rumpf aus `0153` zeichengleich her,
  lässt `catalog_status` drin (**einen** Schritt zurück, nicht zwei) und
  rührt Spalte und Beziehungen nicht an

Die Einzelheiten zur Wiederherstellung — Reihenfolge, Fallstricke, die
Anleitung — stehen in `supabase/checks/0160_restore_order.md`.

## Der Lauf vom 2026-10-28

Gefahren wie im Laufzettel beschrieben, in drei Schritten, ohne Abweichung:

| Schritt | Ergebnis |
|---|---|
| **Preflight** (`db:migrate:staging -- 0160`) | **45 Zeilen, `9999 = 0`, keine offene Zeile** |
| **Baseline** | eingefroren in `supabase/baselines/baseline-0160.json`, erhoben 20:07:11, Herkunft `preflight` — und danach **nie neu erhoben** |
| **Die eine schreibende Anweisung** | Betreiber, im SQL-Editor von `qqxcpesbwfxzgytkdsac`, über `supabase/operations/staging-0160.sql` |
| **Nachkontrolle** (`--resume`) | **59 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, **eine** offene Zeile (139 — das Journal, Rechtegrenze des Prüfzugangs) |
| **Berechtigter Lauf** (als `postgres`) | **`9998 = 0` und `9999 = 0`** |

**Die Baseline ist zeichengleich der von `0159`:** 257 Angebote, 535
shopfähig, 535 sammelbar, 287 Lagerzeilen, 729 Katalogzeilen, 21
Sammlungszeilen. Zwischen den beiden Migrationen hat sich im Katalog nichts
bewegt — und nach dieser auch nicht.

**Was der Betreiber bestätigt hat:** die Exportfunktion trägt den erwarteten
`0160`-Abdruck, `base_sky_id` ist im Plattformexport enthalten, alle
Baselines sind unverändert, und es gibt keine ungewollte Variantenbeziehung
und keine Katalogänderung.

**Was die Nachkontrolle im Einzelnen festgehalten hat.** Der Rumpfabdruck ist
`ff4f38e61cbd4e5857ea914d6be68d44` (102); die eingefügte Feldzeile steht
**genau einmal** (104 — gezählt wird das vollständige Muster
`'base_sky_id', t.base_sky_id,`, nicht die Zeichenfolge; die Lehre aus `0153`
Zeile 104 stand hier von Anfang an richtig); und **zieht man die eine Zeile
wieder ab, ist der Rumpf zeichengleich der aus `0153`** (105,
`92c48444f99b9e294f9703d0c0ddeaa8`). Das ist die Zusage dieser Migration, am
**lebenden** Rumpf nachgerechnet und nicht nur im Arbeitsbaum. Dazu: die
Zeile sitzt hinter `character_id` (106), die Länge ist 31 114 Zeichen (107),
`catalog_status` aus `0153` steht unverändert daneben (109 — **einen**
Schritt, nicht zwei), Attribute und Rechte sind unberührt (111–118), 54
Bereiche und `format_version` 2 (121–126), und die Variantenbeziehung ist
unverändert: keine Kette, keine Seriengrenze, kein Selbstbezug, kein
verwaister Verweis, derselbe Abdruck der Beziehung wie im Preflight
(131–138).

Protokolle: `supabase/log/staging/migrate-0160-2026-10-28T20-07-11-463Z.md`
(Preflight) und `…T20-08-28-298Z.md` (Nachkontrolle).

**Protokolliert in `supabase/migrations/APPLIED.md`**, Spalte `Datei heute` =
`gleich`: die Datei im Repository ist bitgenau die ausgeführte Fassung, und
`src/lib/admin/migration-integrity.test.ts` rechnet das bei jedem Testlauf
nach.

## Was danach offen bleibt

Die **vier Spalten** aus `platform_export_gap.md`
(`skylanders.item_type`, `skylanders.usk_rating`,
`shop_inventory.sale_released`, `shop_inventory.delivery_scope`) und die
beiden Tabellen `favorites` und `offer_state`. Jede ist eine eigene
Entscheidung mit eigener Freigabe.

Und: **es gibt weiterhin keine automatische Wiederherstellung.**
`restore_supported` steht im Archiv auf `false`. `0160` macht das Archiv
vollständiger, nicht den Rückweg automatisch.
