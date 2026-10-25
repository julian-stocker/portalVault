# Gehört `purchase_calculations` in die Plattformsicherung?

**Untersuchung vom 2026-10-24. Nichts umgesetzt, nichts ausgeführt.** Der
Auftrag war ausdrücklich: Optionen und Risiken, und erst dann eine
Entscheidung.

**Die kurze Antwort: ja, sie kann sicher aufgenommen werden** — aber es
braucht eine Migration, und zwar eine, die die eine Funktion ersetzt, die
unter Supabase Free unsere einzige Absicherung ist. Das gehört nicht in das
Release `0142`/`0143`, sondern danach und für sich.

---

## 1. Export und Wiederherstellung sind hier zwei völlig verschiedene Dinge

Die Unterscheidung, nach der gefragt wurde — und sie fällt schärfer aus, als
man erwarten würde.

| | Plattform**export** | Plattform**wiederherstellung** |
|---|---|---|
| Existiert? | **ja**, `system_platform_export()` aus `0105`, ausgelöst über `/admin/datensicherung` | **nein. Es gibt sie nicht.** |
| Belegt durch | 53 Bereiche, 486 Felder; `platform-sql.test.ts` vergleicht Manifest und SQL Feld für Feld | — |
| Automatisiert geprüft? | ja, aber nur der **Vertrag**: dass jedes Feld des Manifests im SQL steht und umgekehrt | — |
| Je mit echten Daten durchgeführt? | der Betreiber hat Archive gezogen; eine **geprüfte** Production-Sicherung ist in `business_backup_proof.md` als offener Punkt geführt | — |

**`restore_supported` steht im Dokument fest auf `false`**, und das ist keine
Vorsicht, sondern eine Tatsache: es gibt **keine Importfunktion**. Eine
Wiederherstellung hieße heute, aus der JSON-Datei von Hand
`INSERT`-Anweisungen zu bilden und sie als Eigentümer im SQL-Editor
einzuspielen. `supabase/checks/0129_restore_test.md` schreibt das ausdrücklich
hin — und ist selbst eine **Anleitung**, kein Test, und betrifft die
*Betriebs*sicherung, nicht diese hier.

Auch das Prüfwerkzeug gibt es nur für die andere Seite: `npm run
verify:backup` hält eine heruntergeladene **Betriebs**sicherung gegen ihre
Baseline. **Für das Plattformarchiv existiert kein solches Werkzeug.**

> **Was daraus folgt.** „Beschädigt die Aufnahme die Wiederherstellung?" ist
> hier keine beantwortbare Frage, weil es nichts gibt, was beschädigt werden
> könnte. Die ehrliche Formulierung lautet: **Eine zusätzliche Tabelle im
> Export macht eine spätere Wiederherstellung weder leichter noch schwerer —
> sie liefert eine JSON-Liste mehr, aus der jemand `INSERT`-Anweisungen
> bilden müsste.** Alles andere wäre eine Zusicherung, für die es keinen
> Nachweis gibt.

---

## 2. Spricht inhaltlich etwas gegen die Aufnahme? Nein

Geprüft, nicht vermutet:

| Prüfung | Befund |
|---|---|
| Gesperrte Felder | **keines.** Die zwölf Spalten (`id`, `user_id`, `name`, `status`, `lines`, `factor_percent`, `total_cents`, `positions`, `units`, `purchase_id`, `created_at`, `updated_at`) stehen in keiner der 33 Sperrlisten-Einträge von `PLATFORM_FORBIDDEN_FIELDS` |
| Geheimnisse, Zahlungsdaten, Auth-Felder | **keine.** Kein Token, kein Provider-Bezug, kein Kartenschnappschuss |
| Personenbezug | `user_id` — und der ist im Plattformarchiv **gewollt**. `collection_items` und `profiles` führen ihn ebenso; ohne ihn wüsste nach einem Wiederaufbau niemand mehr, wem etwas gehörte |
| Rechte | `system_platform_export()` ist `security definer` und gibt **NULL** zurück, wenn `is_platform_admin()` nicht gilt. Eine neue Tabelle darin ändert daran nichts |
| Argumentgrenze | `FUNC_MAX_ARGS` ist 100. Der Rumpf ist in sechs Gruppen geschnitten; die größte hat **36** Argumente. Ein 54. Bereich macht daraus 38 — weit unter der Grenze, und `platform-sql.test.ts` hält ohnehin jede Gruppe unter 80 |
| Größe, Laufzeit | vernachlässigbar: eine Handvoll Zeilen mit einem kleinen `jsonb` je Zeile |

**Inhaltlich ist es dieselbe Klasse wie `collection_items`:** rein
nutzergeneriert, aus nichts ableitbar, von keinem anderen Export erfasst.
Das ist das stärkste Argument *für* die Aufnahme — und es ist genau das
Argument, mit dem `collection_items` im Manifest steht.

Dagegen steht nur eins, und es ist schwächer: eine Kalkulation ist eine
**Bewertung**, kein Geschäftsvorfall. Ein verlorener Einkauf steht in
`purchases`; eine verlorene Kalkulation ist neu zu rechnen. Aber „neu zu
rechnen" heißt: alle Positionen eines Inserats noch einmal eintippen — und
das ist der Verlust, den der Betreiber nennt.

---

## 3. Was dafür geändert werden müsste — vollständig

### 3a. Eine Migration, und sie ersetzt die Sicherungsfunktion

```sql
create or replace function public.system_platform_export() …
```

`0105` ist die **letzte** Migration, die diese Funktion schreibt. Sie ist
angewendet und darf nach Regel 1 in `APPLIED.md` **nicht mehr geändert
werden** — die Erweiterung ist also eine neue Datei (`0144`), die den ganzen
Rumpf noch einmal hinschreibt, mit einem Bereich mehr in der Gruppe „Lager
und Orderbuch" (12 → 13 Bereiche).

### 3b. Das Manifest

- `purchase_calculations` aus `PLATFORM_EXCLUDED_TABLES` **entfernen**
- einen Abschnitt in `PLATFORM_SECTIONS` **anlegen**: `key`, `source`,
  `purpose`, `fields`, `personalData: true`, `restoreRelevant: true`

### 3c. Acht Stellen, an denen die Zahl `53` steht

`platform-archive.{ts,test.ts}` (2×), `platform-sql.test.ts` (4×),
`platform-history.test.ts`, `platform-export.test.ts` (2×),
`platform-source.ts`, dazu die Feldsumme `486` und die Gruppenaufstellung im
Kopf von `0105`. Die meisten sind abgeleitet
(`PLATFORM_SECTIONS.length`), einige sind Literale.

### 3d. Und die eigentliche Arbeit: ein Test, der auf `0105` festgenagelt ist

```ts
const FILE = "supabase/migrations/0105_platform_export.sql";
```

`platform-sql.test.ts` vergleicht das Manifest gegen **genau diese Datei**.
Steht die Funktion danach in `0144`, vergleicht der Test ein 54-Bereiche-
Manifest gegen einen 53-Bereiche-Rumpf — **und wird rot und bleibt rot**,
weil `0105` nicht nachgebessert werden darf.

Der Test muss also lernen, der **neuesten** Definition zu folgen statt einer
festen Datei. Das ist kein Beiwerk: es ist derselbe Fehlgrund, der die
Tabelle überhaupt erst durchrutschen ließ — ein Wächter mit einer von Hand
gepflegten Annahme darüber, wo die Wahrheit steht.

---

## 4. Die Risiken, einzeln

| | Risiko | Wie groß | Was dagegen hilft |
|---|---|---|---|
| **R1** | Der Test auf `0105` geht rot und lässt sich nicht einfach grün machen | **sicher eintretend**, nicht „Risiko" | Den Test auf die neueste Definition umstellen — **vor** der Migration, als eigener Schritt |
| **R2** | `create or replace` auf die eine Funktion, die unsere Absicherung IST. Ein Fehler darin bricht die Sicherung selbst | **hoch in der Wirkung**, gering in der Wahrscheinlichkeit | Staging zuerst · ein PGlite-Probelauf wie P48/P49 · ein Export auf Staging ziehen und **die Datei ansehen** · eine Rücknahme, die den `0105`-Rumpf wiederherstellt |
| **R3** | Die Sicherung enthält danach Einkaufsbewertungen | **niedrig** | Sie enthält bereits Käuferadressen, Bestellungen und fremde Sammlungen. `docs/SECURITY.md` verbietet solche Daten **im Repository**, nicht in einer privaten Sicherungsdatei. Die Datei gehört ohnehin nie ins Projektverzeichnis |
| **R4** | Reihenfolge Code ↔ Datenbank | **keines** | Das Archiv nimmt `database.json` **unverändert** aus der Funktion, und `sectionCounts()` läuft über die Schlüssel des Dokuments. Der Code filtert nicht — siehe unten |
| **R5** | Bestehende Bereiche verlieren Felder, weil der Rumpf neu getippt wird | **real, und der Grund für die Sorgfalt** | Der Rumpf wird **kopiert**, nicht neu geschrieben; `platform-sql.test.ts` vergleicht hinterher Feld für Feld gegen das Manifest und würde jedes verlorene Feld melden |

### Der überraschende Teil von R4

Der Anwendungscode **filtert nicht**. `platform-archive.ts` übernimmt das
Dokument wörtlich, und `sectionCounts()` zählt die Schlüssel, die da sind —
nicht die, die das Manifest erwartet. `EXPECTED_SECTION_COUNT` wird
ausschließlich in Tests benutzt, nirgends zur Laufzeit.

**Das heißt: die Migration allein würde genügen, damit die Daten im Archiv
landen** — auch unter dem heute deployten Code. Die Änderungen an Manifest
und Tests sind die Buchführung darüber, nicht die Mechanik. Für die
Reihenfolge ist das eine gute Nachricht: es gibt keinen Zwischenzustand, in
dem etwas fehlt oder bricht.

---

## 5. Drei Optionen

### Option A — alles so lassen

Die Tabelle bleibt begründet ausgeschlossen, die Lücke steht dokumentiert in
`platform_export_gap.md` und im Manifest.

**Kosten:** Gehen die Production-Daten verloren, sind die gespeicherten
Kalkulationen fort. **Aufwand:** null. **Risiko:** null.

### Option B — nur den Wächter reparieren, den Export nicht anfassen

`ALL_PUBLIC_TABLES` aus den Migrationen erheben statt sie zu tippen. Das
Werkzeug steht bereit: `tools/validate-check-sql.mts` baut aus allen
Migrationen ein Stub-Schema.

**Behebt die Klasse**, nicht den Einzelfall: die Liste kann nicht zum dritten
Mal veralten. Die Tabelle bliebe draußen — aber nachweislich absichtlich.

**Aufwand:** klein. **Risiko:** null (nur Testcode). **Berührt die Sicherung
nicht.**

### Option C — Aufnahme, als eigenes kleines Release nach `0142`/`0143`

In dieser Reihenfolge:

1. **Erst Option B** — sonst wiederholt sich der Fehlgrund beim nächsten Mal.
2. `platform-sql.test.ts` auf die **neueste** Definition umstellen (R1).
3. Manifest erweitern, `0144` schreiben, PGlite-Probelauf, Staging.
4. Auf Staging einen Export ziehen und **in die Datei sehen** — 54 Bereiche,
   die Kalkulationen drin, die 53 alten unverändert.
5. Dann Production.

**Aufwand:** überschaubar, aber kein Nebenbei. **Risiko:** R2 und R5, beide
beherrschbar, beide verlangen den Staging-Umweg.

---

## 6. Empfehlung

**Option C — aber nicht jetzt und nicht in diesem Release.**

Die Tabelle gehört in die Sicherung; das inhaltliche Argument ist dasselbe,
mit dem `collection_items` darin steht, und es gibt keinen technischen Grund
dagegen. Was dagegen spricht, ist ausschließlich der Zeitpunkt: `0142` und
`0143` sind geprüft, probegefahren und freigegeben. Eine dritte Migration
jetzt dazuzunehmen hieße, die **Sicherungsfunktion selbst** in ein Release zu
ziehen, dessen Prüfungen sie nicht abdecken — und das ausgerechnet an der
Stelle, an der ein Fehler erst dann auffällt, wenn man die Sicherung
braucht.

**Bis dahin gilt kein Datenverlust, sondern ein Nachweisverlust:** die
Kalkulationen liegen in der Datenbank und werden bei einem Ausfall des
Projekts nicht mitgerettet. Der Zeitraum dafür lässt sich kurz halten —
Option C ist ein überschaubares eigenes Vorhaben.

**Option B würde ich vorziehen, sobald etwas dazwischenkommt.** Sie kostet
fast nichts, fasst die Sicherung nicht an und verhindert, dass dieselbe
Lücke ein drittes Mal entsteht.

---

## 6a. Nachtrag 2026-10-25: Phase 1 ist umgesetzt

Der Betreiber hat **ausschließlich Phase 1** freigegeben — Option B oben,
plus die Befreiung des festgenagelten Tests. Beides ist erledigt, und dabei
kam eine dritte Lücke heraus:

**Die Betriebssicherung hatte vierzehn unentschiedene Tabellen.** 28 Bereiche
plus 24 begründete Ausschlüsse gegen 66 Tabellen im Schema. Ihr Wächter
prüfte jede Spalte eines bekannten *Bereichs* — eine ganze Tabelle war für
ihn unsichtbar, genau wie im Plattformmanifest. Alle vierzehn sind jetzt
entschieden, `purchase_calculations` darunter: **begründet draußen**, weil sie
an `user_id` hängt und dieser Export genau das als Kontoidentität sperrt.

**Was jetzt nicht mehr passieren kann:** eine neue Tabelle hält beide
Sicherungs-Suiten an, bis jemand sie entscheidet. Die Grundgesamtheit kommt
aus den Migrationen (`tablesOf()`), nicht aus einer Liste, und der Fold
scheitert laut statt leer zu bestehen. ADR-0134.

**Was offen bleibt:** alles aus Abschnitt 5, Option C — die Aufnahme selbst.
Die Architekturentscheidungen dafür hat der Betreiber am 2026-10-25
getroffen: `purchase_calculations` in die Plattformsicherung,
Betriebssicherung mit begründetem Ausschluss, **`PLATFORM_FORMAT_VERSION =
2`**, Archive der Version 1 bleiben gültig, **kein automatischer Restore in
`0144`**. Umgesetzt ist nichts davon.

---

## 7. Was hier ausdrücklich nicht getan wurde

Keine Migration geschrieben, kein Manifest geändert, kein Test umgestellt,
nichts ausgeführt. Der Ausschluss aus dem letzten Commit bleibt, wie er ist —
er ist eine **Markierung**, keine Entscheidung gegen die Aufnahme, und der
Kommentar im Manifest sagt genau das.
