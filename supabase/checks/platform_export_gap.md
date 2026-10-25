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

---

## Nachtrag 2026-10-24: eine ganze TABELLE, und derselbe Fehlgrund

Beim Release-Check zu `0142`/`0143` gefunden, nicht von einem Test.

`0142` legt `purchase_calculations` an. `platform-manifest.test.ts` hat einen
Test, der genau das verhindern soll — „jede Tabelle der Plattform ist
entschieden: entweder ein Bereich oder ausdrücklich ausgeschlossen". Er lief
grün, **weil die neue Tabelle in seiner Grundgesamtheit fehlte.**

Diese Grundgesamtheit (`ALL_PUBLIC_TABLES`) ist eine **handgepflegte Liste**
im Test. Genau dieser Fehlgrund steht schon einmal in derselben Datei: vor
`0122` fehlten die drei Belegtabellen, und der Kommentar dazu lautet „Ein
Wächter, der seine eigene Grundgesamtheit veraltet führt, prüft nichts."
Zweimal derselbe Satz ist kein Zufall mehr.

**Sofort erledigt (im Release enthalten):**

- `purchase_calculations` steht in `ALL_PUBLIC_TABLES` — der Wächter sieht
  die Tabelle jetzt.
- Sie ist in `PLATFORM_EXCLUDED_TABLES` **begründet ausgeschlossen**, nach
  demselben Muster wie `purchase_receipts`: ausgelassen, aber nicht
  unbemerkt, mit Verweis auf diese Datei.
- Damit ist die Lücke **sichtbar statt still**. Behoben ist sie nicht.

**Offen, und die eigentliche Antwort:**

1. **Die Grundgesamtheit aus den Migrationen erheben** statt sie zu tippen.
   Das Werkzeug dafür steht schon: `tools/validate-check-sql.mts` baut aus
   allen Migrationen ein Stub-Schema. Eine Liste, die sich selbst aktuell
   hält, kann nicht zum dritten Mal veralten. **Das zuerst** — es ist der
   Test, der die beiden anderen Punkte danach überhaupt erst erzwingt.
2. **Entscheiden, ob `purchase_calculations` in die Sicherung gehört.** Für
   eine Aufnahme spricht: es sind Arbeitsstände, die der Betreiber beim
   Verlust vermisst. Dagegen: eine Kalkulation ist eine Bewertung, kein
   Geschäftsvorfall — ein verlorener Einkauf steht in `purchases`, eine
   verlorene Kalkulation ist neu zu rechnen.
3. **Erst danach die Migration**, die `system_platform_export()` um die vier
   Spalten oben und gegebenenfalls um diesen Bereich erweitert.

**Nicht Teil des Releases 0142/0143.** Die Sicherung stillschweigend
mitzuziehen wäre genau die Art Änderung, die niemand geprüft hat.

**Nachtrag 2026-10-24, zweiter Teil.** Der Betreiber will die Tabelle nicht
unnötig draußen haben. Die Untersuchung dazu — kann sie sicher aufgenommen
werden, was müsste sich ändern, welche Risiken — steht in
`supabase/checks/platform_backup_purchase_calculations.md`. Ergebnis in
einem Satz: **ja, und zwar als eigenes kleines Release nach `0142`/`0143`**,
weil die Erweiterung die eine Funktion ersetzt, die unsere Absicherung ist.
Punkt 1 oben (die Grundgesamtheit aus den Migrationen erheben) ist dort
Schritt 1.

---

## Phase 1 erledigt (2026-10-25) — der Fehlgrund ist behoben, die Lücke noch nicht

Punkt 1 der Folgeaufgabe oben („die Grundgesamtheit aus den Migrationen
erheben") **ist umgesetzt** — und dabei kam eine dritte Lücke heraus.

**Was gefunden wurde:**

| | |
|---|---|
| Plattformsicherung | `ALL_PUBLIC_TABLES` war eine **getippte Liste im Test**. Zweimal hat sie eine Tabelle verschwiegen |
| **Betriebssicherung** | **vierzehn** Tabellen waren nie entschieden: 28 Bereiche + 24 Ausschlüsse gegen **66** Tabellen im Schema. Ihr Wächter prüfte jede **Spalte** eines bekannten **Bereichs** — eine ganze Tabelle konnte er nicht vermissen |
| eine dünne Begründung | `platform_settings: "Plattformkonfiguration."` — 23 Zeichen, ein Haken statt einer Entscheidung. Vom neuen Test sofort gemeldet |

**Was jetzt schützt:** `tablesOf()` faltet `create table`, `drop table` und
`alter table … rename to` über die ganze Historie; beide Wächter fragen ihn.
Er zählt temporäre Notizblöcke und Ansichten nicht mit, liest keine
Kommentare — **jedes** `drop table` dieser Historie steht in einem — und
**scheitert laut**, sobald eine Form auftaucht, die er nicht versteht. Auch
die leere Menge ist ein Fehler. Beide Wächter haben zusätzlich einen Test,
der ihr **Anschlagen** beweist: eine erfundene Tabelle muss genau sie nennen.

Vollständig: **ADR-0134**.

**Was damit NICHT behoben ist:** die vier Spalten oben
(`item_type`, `usk_rating`, `sale_released`, `delivery_scope`) fehlen weiter
in `system_platform_export()`, und `purchase_calculations` ist weiter nur
begründet ausgeschlossen statt gesichert. Beides ist Phase 2 (`0144`) und
braucht eine eigene Freigabe. **Die Lücke ist sichtbar, nicht geschlossen.**

---

## Phase 2 vorbereitet (2026-10-25) — die Tabelle ist drin, die vier Spalten nicht

`0144` nimmt `purchase_calculations` in die Plattformsicherung auf (ADR-0135):
54 Bereiche, alle zwölf Spalten, `format_version` 2, Version-1-Archive
bleiben gültig. **Nirgends angewendet** — lokal fertig und geprüft.

**Die vier Spaltenlücken dieser Datei bleiben offen**, und das ist eine
Entscheidung: `0144` fasst `system_platform_export()` an, also genau die
Funktion, die unsere Absicherung ist. Vier Spalten mitzunehmen, die niemand
in diesem Zug geprüft hat, wäre dieselbe Sorte Nebenbei-Änderung, gegen die
der ganze Aufwand gerichtet ist.

| Spalte | seit | Bereich |
|---|---|---|
| `skylanders.item_type` | `0135` | Katalog |
| `skylanders.usk_rating` | `0139` | Katalog |
| `shop_inventory.sale_released` | `0139` | `shop_inventory` |
| `shop_inventory.delivery_scope` | `0139` | `shop_inventory` |

**Der Weg dorthin ist jetzt gebahnt:** `platform-sql.test.ts` folgt der
neuesten Funktionsdefinition, der Spaltenwächter prüft jede Spalte eines
bekannten Bereichs, und das Verfahren aus `0144` — Rumpf kopieren, Abdruck
vorher und nachher, Umkehrprobe, P-Lauf — lässt sich für eine `0145`
wiederholen. Was fehlt, ist die Entscheidung und eine eigene Freigabe.

---

## Eine neue Lücke, mit Ablaufdatum: `favorites` (2026-10-25)

`0145` legt `public.favorites` an (ADR-0136) — **persönliche Nutzerdaten**,
dieselbe Klasse wie `collection_items` und `purchase_calculations`. Sie
**gehört ins Plattformarchiv**, und der Betreiber hat das ausdrücklich so
entschieden: „Neue persönliche Nutzerdaten dürfen nicht dauerhaft aus dem
Plattformbackup ausgeschlossen bleiben."

Heute steht sie trotzdem in `PLATFORM_EXCLUDED_TABLES`. Der Grund ist
**Reihenfolge, nicht Wert**: ein Bereich im Archiv heißt
`system_platform_export()` ersetzen, und diese Funktion prüft den `md5` ihrer
Vorgängerfassung, bevor sie sich überschreiben lässt. `0144` hat sie auf
Staging schon ersetzt (`4c4d2e7c…`), auf Production noch nicht — dort steht
weiter der Rumpf aus `0105` (`2e2da90e…`). Eine Migration, die sie **jetzt**
ein zweites Mal ersetzt, wäre auf Production nicht anwendbar. `0145` bleibt
deshalb isoliert anwendbar, und die Aufnahme kommt getrennt.

**Was diesen Eintrag wieder entfernt — als Bedingung, nicht als Absicht:**

1. `0144` liegt auf Production (`supabase/migrations/APPLIED.md`).
2. Die Folgemigration nimmt `favorites` als Bereich auf und zählt
   `PLATFORM_FORMAT_VERSION` auf **3** hoch
   (`SECTIONS_BY_FORMAT_VERSION = { 1: 53, 2: 54, 3: 55 }`).
3. Der Eintrag in `PLATFORM_EXCLUDED_TABLES` fällt — und danach verlangt der
   Vollständigkeitswächter (ADR-0134) einen Bereich, kann ihn also nicht
   übersehen.

> **Punkt 2 muss VOR dem Production-Rollout der Favoriten erledigt sein.**
> Das ist die Zusage, unter der `0145` freigegeben wurde.
> `supabase/operations/prod-0145.sql` sagt es in ihrem eigenen Kopf, und
> `src/lib/favorites/schema.test.ts` hält fest, dass der Ausschluss seinen
> Ablauf benennt — ein Eintrag ohne diese Sätze wäre der stille
> Dauerausschluss, den es nicht geben soll.

**Aus der Betriebssicherung bleibt `favorites` dauerhaft draußen**, und das
ist kein Zwischenstand: sie hängt an `user_id`, das dieser Export als
Kontoidentität sperrt, und fremde Wunschlisten in einem Händlerexport wären
nicht eine Lücke, sondern ein Leck — sie gäben genau das heraus, was
`favorite_demand()` dem Betrieb bewusst nur als **Zahl** zeigt.

**Der offene Punkt dieser Datei ist damit zweiteilig:** die vier Spalten
oben (ohne Termin, eigene Entscheidung) und `favorites` (mit Bedingung und
Termin, Entscheidung getroffen).
