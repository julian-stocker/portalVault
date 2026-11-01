# OVP-Katalogduplikate — Audit und Bereinigungsplan

**Stand 2026-10-31 · Staging UND Production rein lesend erhoben · NICHTS geändert.**
Staging über den Service-Schlüssel aus `.env.staging`, Production über `.env.local`,
ausschließlich `select`. Jeder Schritt in Abschnitt 5 braucht eine eigene Freigabe.

## 1. Die Meldung „Auf diese Figur zeigen noch Daten: public."

**`public` ist nicht der Katalogstatus, sondern der abgeschnittene Tabellenname.**

`admin_delete_figure` (`0162`) meldet z. B.

    0162: auf SKY-0012 zeigen noch Daten: public.inventory_import_rows.sky_id=3.

`deleteFigure()` in `src/lib/admin/actions.ts` schneidet die Liste mit
`/zeigen noch Daten: ([^.]*)/` heraus — `[^.]*` hört am **ersten Punkt** auf, und
der steht im Schema-Präfix `public.`. Übrig bleibt „public". Die Sperre selbst ist
richtig und bleibt; nur der **Grund** geht in der Anzeige verloren. Das ist ein
Anzeigefehler in einer Zeile Code, keine Sicherheitsregel.

**Was SKY-0012 auf Staging tatsächlich sperrt:** drei Zeilen in
`inventory_import_rows` — das Protokoll der Legacy-Lagerimporte 1, 5 und 7
(Blatt SA, Zeile 16, Klassifikation `SUPPORTED_COMPLETE_LOOSE_FIGURE`, Menge 0,
Status `unchanged`). Der Fremdschlüssel ist `RESTRICT`. Das ist ein
Prüfprotokoll; es zu löschen oder umzuhängen hieße, die Importhistorie zu
fälschen.

### Was beim Löschen und Verwerfen gilt (unverändert)

| | Verwerfen (`admin_discard_draft`, 0155) | Löschen (`admin_delete_figure`, 0162) |
|---|---|---|
| für | nur Admin-Entwürfe, nie öffentlich gewesen | jede Katalogzeile |
| Sperre | jeder Verweis aus `pg_constraint` (14 Pfade) | dieselben 14, dazu `order_lines.sky_id` (ohne FK) und Varianten |
| Journal | `discarded`, vor dem Löschen | `deleted`, vor dem Löschen; überlebt die Zeile |
| SKY-ID | nie wieder vergeben (`sky_id_seq`, ADR-0001) | ebenso |
| Storage | nicht angefasst, verwaister Pfad wird genannt | nicht angefasst |

## 2. Audit — 30 eigenständige OVP-Einträge, in beiden Umgebungen dieselben

**Erkannt anhand der Struktur, die die App selbst benutzt:** `parseEliteEdition()`
(`src/lib/catalog/variant.ts`) — eine Elite-Zeile ist nur dann eine OVP-Ausgabe,
wenn ihre lose Schwester `… - ohne OVP` in derselben Serie existiert; dazu
`card_type = elite` / `types = {elite}` aus der kuratierten 42er-Liste (`0032`).
Die zwei übrigen tragen OVP als Namenszusatz und haben eine Grundzeile derselben
Serie. Es gibt **keine** Verpackungsspalte im Katalog (SKYLANDERS_DATA §11b).

| Gruppe | Anzahl | SKY-IDs | reguläre Figur |
|---|---:|---|---|
| Eon's Elite OVP Series 1 | 14 | 0012 0018 0023 0031 0036 0041 0050 0057 0061 0067 0072 0076 0084 0090 | die `… - ohne OVP`-Zeile derselben Figur (0011 0017 0022 0030 0035 0040 0049 0056 0060 0066 0071 0075 0083 0089) |
| Eon's Elite OVP Series 2 | 14 | 0013 0019 0024 0032 0037 0042 0051 0058 0062 0068 0073 0077 0085 0091 | dieselben 14 |
| OVP im Namen | 2 | 0564 `Kaos in OVP`, 0591 `Dark Pyramid - OVP` | 0563 `Kaos`, 0590 `Dark Pyramid` |

**Für alle 30, in beiden Umgebungen:** Status `hidden`, nicht öffentlich, aktiv;
keine Variante zeigt auf sie, keine ist selbst Variante; 28 haben ein Bild
(0072 und 0073 keins); 20 tragen einen Marktwert (z. B. 0012 69,99 €). Alle 30
stehen im Publish-Ledger (versteckte Zeilen werden veröffentlicht).

### Verweise je Umgebung (14 FK-Pfade + `order_lines`)

| | Staging | Production |
|---|---|---|
| Sammlungen, Favoriten, Warenkorb | 0 | 0 |
| Lager (`shop_inventory`) | **1** — SKY-0090, Fixture „staging UX fixture", Menge 0 | 0 |
| Einkauf, Verkauf, Bestellzeilen | 0 | 0 |
| Angebotsstatus, Benachrichtigungen | 0 | 0 |
| Import-Zuordnungen, Altbestand, Orderbuch-Namen | 0 | 0 |
| **Importprotokoll** (`inventory_import_rows`) | **3 je Elite-OVP-Zeile = 84** (zusammen mit der Fixture 85 Verweise) | 0 |
| `Kaos in OVP`, `Dark Pyramid - OVP` | 0 | 0 |

Nicht prüfbar: `availability_alerts` (`0150` auf keiner Umgebung angewendet).

### Was KEIN Duplikat ist und bleibt

* Die **14 losen Elite-Zeilen** (`… - ohne OVP`) — das sind die regulären
  Figuren; öffentlich als „Eon's Elite X".
* **OVP als Bestandszustand:** `shop_inventory.condition = 'boxed'` an
  regulären SKY-IDs (Staging: 8 Zeilen an 0007, 0043, 0114, 0203, 0242, 0313,
  0471, 0499 + Testzeile SKY-9998; Production: 0) und `condition` in Einkauf und
  Verkauf. Genau das Modell, das ADR-0037 §5a vorsieht.

## 3. Entscheidung (2026-10-31): endgültig entfernen — ADR-0166

Der Betreiber nimmt die frühere Excel-Katalogentscheidung zurück: die 30
verschwinden aus `skylanders`, auf beiden Umgebungen. Kein Status `retired`.
Abschnitt 3–6 der ersten Fassung (Ausmustern vs. Löschen) sind damit entschieden
und ersetzt.

### Was je Umgebung wegfällt (gemessen 2026-10-31)

| | Staging | Production |
|---|---|---|
| `skylanders`-Zeilen (mit Marktwert, 20 davon bepreist) | 30 | 30 |
| `inventory_import_rows` (Importe 1, 5, 7; keine mit Lagerbewegung) | 84 | 0 |
| `shop_inventory` — Fixture SKY-0090, Menge 0, nichts darauf | 1 | 0 |
| `catalog_editorial` (interne Notizen) | was je Zeile steht | was je Zeile steht |
| Bilder / Storage | **nichts** — alle 28 Bilddateien teilt die reguläre Figur, Storage-Objekte gibt es keine | **nichts** |
| Bestellungen, Zahlungen, Belege, Sammlungen, Favoriten, Einkauf, Verkauf | **0 — und jeder Fund bricht ab** | **0 — ebenso** |

Neu entsteht je Umgebung: 30 Journalzeilen `deleted` und 30 Grabsteine.

### Was schon vorbereitet ist (lokal, nichts ausgeführt)

| Baustein | Datei |
|---|---|
| Liste der 30 | `data/catalog/ovp-removal.json` |
| Migration: Grabstein, Anlage-Riegel, Entfernungsfunktion | `supabase/migrations/0167_ovp_removal.sql` (+ Pre-/Postflight, `staging-0167.sql`, `R0167`) |
| Entfernung Staging | `supabase/operations/staging-ovp-removal.sql` |
| Entfernung Production | `supabase/operations/prod-ovp-removal.sql` (gleicher Rumpf, Production-Riegel) |
| Import sondert sie aus | `tools/import-catalog.mts` |
| Publish-Riegel 6 (beide Modi) | `tools/catalog-sync.mts`, `src/lib/catalog/ovp-removal.ts` |
| Quelldaten bereinigt | `products.json` (600 → 570), `characters.json` (−15 Zuordnungen), Shop-Fixture (−SKY-0090) |
| Löschsperre zeigt den Grund | `src/lib/admin/delete-errors.ts` |
| Nachweis | `ovp-removal-0167.test.ts` (25 Fälle, echtes PostgreSQL), `ovp-removal.test.ts`, `delete-errors.test.ts` |

## 4. Ausführung — jede Stufe mit eigener Freigabe

| # | Stufe | Wer / womit | Nachweis |
|---|---|---|---|
| **1** | **`0167` auf Staging**: `npm run db:migrate:staging -- 0167` → `staging-0167.sql` im SQL-Editor → `--resume` → `npm run db:privileges:staging`. Entfernt nichts. | Betreiber (SQL-Editor) + Runner | Postflight `9999 = 0`, berechtigt `9998 = 0`; 30 Zeilen stehen noch |
| **2** | **Entfernung Staging**: `staging-ovp-removal.sql` im SQL-Editor | Betreiber | NOTICE `C ok`; danach lesend: 0 der 30, 30 Grabsteine, Katalog 696 → 666 |
| **3** | **Prüfung Staging**: lesender Abgleich (30 fort, 16 reguläre unverändert, Shop-/Sammlungsabdrücke gleich) und `npm run catalog:publish:plan` — erwartet: Riegel 5 und 6 ok, **kein** Schritt an den 30 | Runner / lesend | Plan ohne OVP-Schritt |
| **4** | **`0167` auf Production** — eigene Freigabe; Hülle `prod-0167.sql` wird dann aus der Migration erzeugt (wie `prod-0165.sql`) | Betreiber | wie 1 |
| **5** | **Entfernung Production**: `prod-ovp-removal.sql` | Betreiber, eigene Freigabe | NOTICE `C ok`; Katalog 657 → 627 |
| **6** | **Nächster Publish** (eigene Freigabe): Plan muss leer sein bis auf echte Staging-Arbeit; das Ledger wird danach ohne die 30 geschrieben | Publish | Driftbefund `ok`, keine OVP-ID im Ledger |

**Nie** Production vor Staging. **Nie** eine Stufe auslassen, um schneller zu sein.
`R0167` nimmt die Migration nur zurück, solange kein Grabstein steht — eine
entfernte Figur kommt durch nichts in diesem Repository zurück.

## 4a. Ausführungsprotokoll

### Stufe 1 — `0167` auf Staging: ausgeführt 2026-10-31

Nachweis in `supabase/migrations/APPLIED.md` (berechtigter Postflight `9998 = 0`,
`9999 = 0`, Grabstein leer, Katalog 696, alle 30 unverändert).

### Stufe 2 — Entfernung auf Staging: ausgeführt 2026-11-01

Vom Betreiber im SQL-Editor über `supabase/operations/staging-ovp-removal.sql`
(SHA-256 `69cfcd8511d769420d51072219cf70b8eb97cbf7df17f68e5da83a5070b260fe`),
Supabase meldete „Success". **Rein lesend nachgemessen am 2026-11-01:**

| Prüfung | vorher | nachher | |
|---|---:|---:|---|
| Katalogzeilen | 696 | **666** | −30 |
| davon die 30 OVP-SKY-IDs | 30 | **0** | |
| `catalog_removed_sky_ids` | 0 | **30** — exakt die Liste, Serie und Name gleich | |
| Journal `catalog_admin_changes` | 1 152 | **1 182** — davon 30 × `deleted` an den 30 | +30 |
| Importprotokolle | 2 462 | **2 378**; keines mehr an den 30 | −84 |
| Lagerzeilen | 287 | **286**; Position 36 (SKY-0090) fort | −1 |
| interne Notizen | 104 | 104 | 0 |
| die 16 regulären Figuren | 16, öffentlich | 16, öffentlich, letzte Änderung 2026-10-29 | unberührt |
| Sammlung (Baseline `skyisles-coll-1`) | `21\|1\|965b1492…` | **gleich** | |
| Angebote · shopfähig · sammelbar (Baseline `skyisles-base-1`) | 257 `76f027a6…` · 563 · 563 | **gleich** | |
| Favoriten · Warenkörbe · Bestellungen · Bestellzeilen | — | 7 · 0 · 4 · 9 | keine Änderung seit 2026-10-26 nachweisbar (C5–C7 der Hülle) |
| Einkauf · Verkauf · Lagerbewegungen | — | 2 137 · 1 284 · 38; letzte Bewegung 2026-10-26 | (C8 der Hülle) |
| Grabsteine und Journalzeilen | — | **ein** Zeitstempel `2026-11-01T12:12:50.657Z` | eine Transaktion |
| Anlage-Riegel `skylanders_refuse_removed_trg` | — | aktiv | |
| `npm run catalog:publish:plan` | — | **0 Schritte** nach Production und Staging; Riegel 2–6 ok; geregelte Projektion beider Seiten `625·16746058` zeichengleich | |

**Staging ist damit abgeschlossen** (Bestätigung des Betreibers 2026-11-01,
alle Werte oben gemessen).

**Ergänzt 2026-11-01:** der Sequenzstand ist inzwischen durch den berechtigten
Postflight (unten) nachgewiesen. Ursprünglich offen: die NOTICE-Zeilen `A3`
und `C ok` dieses Laufs liegen nicht vor. Damit war der **Sequenzstand** (`929|true` erwartet; Prüfung C10 der
Hülle) und der wörtliche Vorher-Wert aus A3 nicht von mir belegt — der
Prüfzugang darf `sky_id_seq` nicht lesen. Alle übrigen Werte oben sind
gemessen. Der Publish-Driftbericht nennt die 30 als „Zeilen aus dem Stand, die
Production nicht mehr veröffentlicht" — das ist die erwartete Auskunft bis zum
nächsten Publish nach Stufe 5, kein Abbruch.

### Berechtigter Postflight — bestanden (2026-11-01)

`supabase/checks/ovp_removal_postflight.sql`, vom Betreiber im
Staging-SQL-Editor als `postgres` gefahren:

| Zeile | Prüfung | Befund |
|---|---|---|
| 101 | keine der 30 im Katalog | `0` |
| 102 | jede der 30 hat einen Grabstein | `30` |
| 103 | kein weiterer Grabstein | `30` |
| 104 | Anlage-Riegel aktiv | `1` |
| 105 | je eine Journalzeile `deleted` | `30` |
| 106 | die 16 regulären Figuren, öffentlich | `16` |
| 107 | kein Importprotokoll an den 30 | `0` |
| 108 | keine Lagerposition an den 30 | `0` |
| 201 | `sky_id_seq` | **`929\|true`** |
| 9998 / 9999 | | **`0` / `0`** |

**Der heutige SKY-ID-Zähler ist damit nachgewiesen:** `929|true` — derselbe
Stand wie nach `0166` und `0167`; die Entfernung hat keine Nummer gezogen.

**Bleibende Dokumentationslücke:** die NOTICE-Zeilen `A3` und `C ok` des
Entfernungslaufs liegen nicht vor. Der wörtliche Vorher-Wert aus A3 ist damit
nicht belegt; belegt ist der Zustand danach.

## 4b. Production — vorbereitet, NICHTS ausgeführt

**Lesend erneut geprüft am 2026-11-01** (Service-Schlüssel, nur `select`): alle
30 exakt (Serie, Rohname, Kartenkunst), versteckt, ohne Variante; die 16
regulären Figuren öffentlich; **null** Verweise — Sammlungen, Favoriten,
Warenkörbe, Bestellzeilen, Einkauf, Verkauf, Lager, Importprotokolle,
Angebotsstatus, Benachrichtigungen, Zuordnungen, Altbestand, Notizen. Katalog
657; `catalog_removed_sky_ids` liegt nicht.

**Erwartete Wirkung der Entfernung auf Production:** Katalog 657 → **627**,
Journal +30 `deleted`, Grabsteine 0 → 30; **sonst nichts** — kein
Importprotokoll, keine Lagerposition, keine Notiz.

| Freigabe | Schritt | Datei | Erwartet |
|---|---|---|---|
| **P-1** | Preflight, lesend | `supabase/checks/prod_0167_preflight.sql` (Production-SQL-Editor) | `9999 = 0`; **Zeile 900 kopieren** |
| **P-1** | 0167 anwenden | `supabase/operations/prod-0167.sql` | NOTICE A6, `0167 ok`, `ok: 0167 liegt …`, `commit` |
| **P-1** | Nachkontrolle, lesend | `supabase/checks/prod_0167_postflight.sql` mit `set_config('skyisles.p0167', '<Zeile 900>', true)` davor | `9999 = 0`; Grabstein leer, die 30 stehen |
| **P-2** | Entfernung | `supabase/operations/prod-ovp-removal.sql` (gleicher Rumpf wie Staging, Production-Riegel) | NOTICE A3, 30 × B, `C ok … Katalog 657 -> 627 …`, `commit` |
| **P-2** | Nachkontrolle, lesend | `supabase/checks/ovp_removal_postflight.sql` | `9998 = 0`, `9999 = 0`, Zeile 201 = Wert aus Preflight 131 |
| **P-3** | Publish-Plan, lesend | `npm run catalog:publish:plan` | 0 Schritte, Riegel 2–6 ok |
| **P-3** | Ledger fortschreiben | `npm run catalog:publish` — bei 0 Schritten nimmt er NUR die 30 aus dem Ledger, wenn das Ledger ohne sie zeichengleich dem Production-Stand ist und Staging gleich steht (`ledgerOhneEntfernte`); kein Datenbankschreiben | Ledger 655 → 625 Zeilen |

**Warum der Publish zwischen den Stufen nicht blockiert:** beide Werkzeuge
nehmen die 30 aus der geregelten Projektion (nicht aus dem versiegelten
Bootstrap-Fingerprint). Gemessen 2026-11-01 nach der Staging-Entfernung:
Staging und Production `625·16746058`, zeichengleich, Plan 0 Schritte.

Getestet an echtem PostgreSQL (`ovp-removal-0167.test.ts`): `prod-0167.sql`
bettet die Migration zeichengleich ein, bricht auf Staging ab, läuft auf einem
Production-Stumpf durch ohne eine Zeile zu ändern, prallt beim zweiten Lauf ab;
danach entfernt `prod-ovp-removal.sql` die 30 und `ovp_removal_postflight.sql`
meldet `9998 = 0`, `9999 = 0`.

### P-1 — `0167` auf Production: ABGESCHLOSSEN (2026-11-01)

Preflight `9999 = 0` (Baseline Zeile 900), `prod-0167.sql` angewendet,
Nachkontrolle über `prod-s-postflight-0167.sql`: 801–803 bestanden, Grabstein
leer, die 30 stehen. Zeile 804 weicht nur in Sammlungen (+3) und Favoriten
(+41) ab — **vom Betreiber als eigene Nutzung im Prüfzeitraum bestätigt**;
die Baseline bleibt unverändert. Lesend nachgemessen: 0 Verweise auf die 30,
Journal 685, kein Eintrag im Band `SKY-5001`+; Sequenz `5001|false` laut
Betreiber. Vollständig: `APPLIED.md`, Abschnitt „`0167` auf Production".

**Wichtig für P-2:** der SQL-Editor zeigt keine `NOTICE`-Meldungen. Die
Meldungen A3/B/`C ok` von `prod-ovp-removal.sql` erscheinen dort nicht; der
Beleg ist „Success" plus die Ergebnistabelle von `ovp_removal_postflight.sql`.

### P-2 — Entfernung auf Production: ABGESCHLOSSEN (2026-11-01)

`prod-ovp-removal.sql` vom Betreiber im SQL-Editor ausgeführt, „Success".
Berechtigte Nachkontrolle `ovp_removal_postflight.sql`: 101 `0` · 102 `30` ·
103 `30` · 104 `1` · 105 `30` · 106 `16` · 107 `0` · 108 `0` · 201
`5001|false` · **9998 `0` · 9999 `0`**.

**Alle 30 OVP-SKY-IDs sind damit auf Staging UND Production entfernt und
dauerhaft gesperrt.** Katalog Staging 666, Production 627; je 30 Grabsteine.

### P-3 — Ledger-Fortschreibung: ABGESCHLOSSEN (2026-11-01)

Freigabe des Betreibers. Unmittelbar davor `npm run catalog:publish:plan`:
0/0 Schritte, Riegel 1–6 ok. Dann `npm run catalog:publish`: der Lauf rechnete
den Plan selbst neu (0/0), nahm über `ledgerOhneEntfernte()` **genau die 30**
aus dem Ledger und endete im 0-Schritte-Zweig — **keine Datenbankanweisung,
keine Storage-Operation**.

| | vorher | nachher |
|---|---|---|
| `resources/sync/publish-ledger.json` | 655 Zeilen, `df54fd6e…`, 2026-10-31T12:29:59Z | **625 Zeilen, `16746058d479c5dadc7feb31eb0338d1`**, 2026-11-01T13:21:38Z; 0 OVP-IDs |
| Diff | | 30 Zeilen entfernt; geändert nur `veroeffentlicht_am`, `zeilen`, `abdruck` |
| Siegel `catalog-baseline.json` | `caa90aa4…` | unverändert |
| Production (lesend, danach) | Katalog 627, Journal 715, Sammlungen 634, Favoriten 149, Warenkörbe 0, Bestellzeilen 2, Lagerbewegungen 750 | dieselben Zahlen |
| Neuer Plan | | 0/0 Schritte, Drift 0, **keine** „Zeilen aus dem Stand, die Production nicht mehr führt" mehr; Staging = Production = Ledger `625·16746058` |

**Die OVP-Bereinigung ist damit auf allen Ebenen abgeschlossen**: Staging,
Production, Publish-Stand.

### P-3 — Vorbereitung (Stand vor der Ausführung, 2026-11-01)

`npm run catalog:publish:plan`: **0 Schritte** nach Production und nach
Staging; Riegel 1–6 bestanden; geregelte Projektion Staging und Production
`625·16746058` zeichengleich; Drift 0; Auskunft: 30 Zeilen aus dem Ledger, die
Production nicht mehr führt — genau die 30.

Ledger-Fortschreibung, lokal nachgerechnet (`standAbdruck`, nichts
geschrieben): Ledger heute schlüssig, **655 Zeilen**; abgezogen werden
**genau die 30** der Liste; danach **625 Zeilen**, Abdruck
`16746058d479c5dadc7feb31eb0338d1` — derselbe, den der Plan für Staging und
Production misst. `ledgerOhneEntfernte()` wird also zustimmen.

`npm run catalog:publish` würde bei 0 Schritten **nur** das Ledger schreiben:
keine Datenbankanweisung, keine Storage-Operation (der Zweig endet vor den
Bildstufen), keine Nutzerdaten. Ausführung erst nach eigener Freigabe.

## 5. Verbleibende Risiken

* **Ein künftiger Export aus der Arbeitsmappe** brächte die 30 wieder in eine
  `products.json`. `catalog:import` sondert sie aus, und der Trigger weist sie
  ab — aber die Arbeitsmappe selbst (`../webpage`, nur lesend) führt sie weiter.
* **Ein Name-basierter Importweg** (wie CAT-03) könnte „Elite Boomer" unter
  einer NEUEN SKY-ID anlegen. Heute führt keiner die 30 Namen (geprüft:
  `staging-cat03-import.sql`, 105 Zeilen, 0 Treffer); ein künftiger braucht
  dieselbe Liste als Ausschluss.
* **Der Grabstein steht in keinem Export.** Wiederherstellbar aus Liste,
  Konstante und Journal; Aufnahme mit der nächsten Exportfassung.
* **Shop-Fixture „kein Marktwert"** hat keinen Träger mehr (siehe ADR-0166).
* Zwischen Stufe 2 und 5 führt Production die 30 weiter — versteckt, ohne
  Verweise. Das ist ungefährlich; Riegel 6 hält jeden Publish-Schritt daran auf.
