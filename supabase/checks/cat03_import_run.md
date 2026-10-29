# Laufzettel — der EINMALIGE Staging-Import der Katalogentwürfe

> ## Einmalig, nicht wiederkehrend (CAT-04E)
>
> Der Excel-Import vervollständigt den Katalog **ein Mal**. Alle gültigen
> Entwürfe gehen in **einem** Lauf, die fünf früheren Testkandidaten sind
> darin enthalten, und es wird kein dauerhaftes Importverfahren gepflegt.
> Production bekommt später einen **eigenen** Abgleich — der Bestand dort ist
> ein anderer, und dieselben 105 Zeilen blind zu übernehmen wäre falsch.
>
> **Stand 2026-10-27, gemessen:** Katalog 626 Zeilen · 105 Entwürfe · **0
> Dubletten** (geprüft gegen `name` **und** `display_name_override`) · 0
> übersprungen → **626 + 105 = 731 Zeilen** danach.

**Nichts davon ist ausgeführt.** Kein Schreibzugriff, keine SKY-ID, kein Bild.
Dieses Dokument ist die Anleitung für den Betreiber, in genau dieser
Reihenfolge.

| | |
|---|---|
| Entwürfe | `resources/analysis/cat-03-entwuerfe.json` (105) · `.csv` zum Lesen |
| Bericht | `resources/analysis/CAT-03-entwuerfe-bericht.md` |
| Aufbereitung | `npm run cat03:drafts:staging` (rein lesend) |
| Probelauf Import | `npm run cat03:import:staging` (rein lesend, **Standard**) |
| Einfüge-Hülle | `npm run cat03:import:staging -- --sql` erzeugt `supabase/operations/staging-cat03-import.sql` |

---

## 0. Die eine Voraussetzung, und sie ist nicht verhandelbar

**`0152` muss auf Staging liegen.** Ohne die Spalte `catalog_status` kann ein
Entwurf nicht als Entwurf entstehen — er wäre eine *versteckte* Zeile, und
genau diese Unterscheidung ist der Grund, warum CAT-02 existiert.

Der Probelauf sagt es selbst:

```
catalog_status : FEHLT (0152 nicht angewendet)
PROBLEME       : 1
                 0152 ist hier nicht angewendet — ohne `catalog_status` kann
                 ein Entwurf nicht als Entwurf entstehen.
```

→ Zuerst `supabase/checks/0152_staging_run.md`, Schritt 1 bis 4.

---

## 1. Das Hindernis, das vor dem Import geklärt werden muss

**Der Abgleich lief gegen Staging mit 626 Katalogzeilen. Der echte Katalog hat
820 SKY-IDs.** Staging ist eine unvollständige Kopie.

Daraus folgt ein konkretes Risiko, und es ist das einzige, das wirklich
gefährlich ist: **ein Kandidat, der auf Staging fehlt, kann auf Production
stehen.** Wird er dann angelegt, entsteht eine fachliche Dublette mit einer
neuen, **dauerhaften** SKY-ID — und SKY-IDs werden nie neu vergeben und nie
wiederverwendet (CLAUDE.md, Regel 2).

**Drei Wege, und sie sind nicht gleichwertig:**

| Weg | Was er kostet | Was er leistet |
|---|---|---|
| **A** Derselbe Abgleich gegen **Production**, rein lesend | eine Freigabe für einen lesenden Production-Zugriff | **die Frage ist beantwortet.** Es gibt keinen stärkeren Beleg |
| **B** Nur auf Staging importieren und dort prüfen | nichts | verschiebt das Risiko: dieselben Entwürfe müssten vor Production erneut geprüft werden |
| **C** Gegen die Legacy-Excel (`../webpage`, strict read-only) abgleichen | nichts | sie ist die Quelle der 820 Zeilen, aber ein Abgleich gegen sie ist ein zweites Werkzeug |

**Empfehlung: A, und zwar vor dem Import.** Der lesende Abgleich ändert auf
Production nichts; `tools/lib/staging-guard.mts` hat für genau diesen Fall
`requireProduction()`, das ein lesendes Werkzeug positiv auf Production
festnagelt. Es braucht eine ausdrückliche Freigabe, und bis dahin ist das
hier eine offene Entscheidung.

---

## 2. Die Reihenfolge

| # | Schritt | Befehl / Datei | Erwartet |
|---|---|---|---|
| 1 | `0152` auf Staging | `supabase/checks/0152_staging_run.md` | `9998 = 0`, `9999 = 0` |
| 2 | Momentaufnahme **neu** holen | `npm run cat03:drafts:staging` | der Katalog nach `0152`, Validierung ohne Fehler |
| 3 | Probelauf | `npm run cat03:import:staging` | `catalog_status : vorhanden`, `PROBLEME : 0`, `Dubletten` prüfen |
| 4 | Hülle erzeugen | `npm run cat03:import:staging -- --sql` | `supabase/operations/staging-cat03-import.sql` |
| 5 | **Die Hülle lesen.** Nicht überfliegen | der Datei | 105 Namen, alle mit `'draft'`, `false` |
| 6 | Einfügen | SQL-Editor des Staging-Projekts | `NOTICE: CAT-03: 105 Entwurf/Entwuerfe angelegt, 0 uebersprungen` |
| 7 | Nachkontrolle, in derselben Datei | — | `NOTICE: CAT-03 Nachkontrolle: 105 Entwurf/Entwuerfe im Katalog, keiner sichtbar.` |
| 8 | Ansehen | `/admin/catalog?status=draft` | 105 Zeilen, Statusfeld auf „Entwurf" |
| 9 | Gegenprobe im öffentlichen Katalog | `/katalog` | **unverändert.** Kein Entwurf ist sichtbar |

**Schritt 2 ist kein Formalismus.** Zwischen Aufbereitung und Import kann
jemand eine Figur angelegt haben; der Probelauf rechnet deshalb gegen den
Katalog, wie er **jetzt** ist, und nicht gegen die Momentaufnahme.

---

## 3. Was im Adminbereich zu tun ist, Figur für Figur

Jeder Entwurf kommt mit dem, was belegbar war, und ohne das, was nicht belegbar
war. Im Formular bleibt genau das übrig:

| Feld | Zustand | Was der Admin tut |
|---|---|---|
| Name | aus der Quelle, **roh** | prüfen, ggf. `display_name_override` setzen |
| Serie, Kategorie | gesetzt, bei 70 von 105 **wie die Grundfigur** | prüfen |
| `card_type` | bei 51 von 105 `standard` mit Marke `card_type_unsicher` | Edition wählen |
| Bild | 40 haben einen **Vorschlag** aus dem Projekt, 65 einen Platzhalter | Bild setzen oder lassen |
| Element | leer — die Quelle führt keines | später über die Charakterkuratierung |
| `character_id` | nur gesetzt, wo der Name **genau eine** Identität traf | kuratieren (`data/characters/characters.json`) |
| Marktpreis | leer (`NULL` heißt „kein bekannter Preis", ADR-0010) | Legacy-Weg |
| Status | **`draft`** | nach der Prüfung auf `public` |

**Die 51 unsicheren Editionen sind kein Mangel der Aufbereitung.** Ihr Merkmal
verteilt sich im bestehenden Katalog auf mehrere `card_type`-Werte — `gold`
etwa auf fünf. Daraus eine Regel zu machen wäre eine Erfindung gewesen.

---

## 4. Rücknahme

**Es gibt keine Migration zurückzunehmen.** Der Import legt Zeilen an, und die
nimmt man so zurück:

```sql
-- Nur die Zeilen dieses Laufs: source = 'admin', Status 'draft', und die
-- Notiz nennt CAT-01. ALLE DREI Bedingungen, nicht eine.
begin;
select s.sky_id, s.name
  from public.skylanders s
  join public.catalog_editorial e on e.sky_id = s.sky_id
 where s.source = 'admin' and s.catalog_status = 'draft'
   and e.admin_note like 'CAT-01 Kandidat%';
-- ERST ANSEHEN. Dann, wenn die Liste stimmt, dieselbe Bedingung als delete.
rollback;
```

**Und die Warnung dazu:** ein Löschen gibt die SKY-IDs **nicht** zurück. Die
Sequenz läuft weiter, die Lücke bleibt — absichtlich (ADR-0070). Wer 105
Entwürfe anlegt und löscht, hat 105 IDs verbraucht. Bei 8999 als Obergrenze
und 820 belegten ist das kein Engpass, aber es ist unumkehrbar.

**Besser als löschen:** die Entwürfe stehen lassen. Sie sind nicht sichtbar,
sie stören nichts, und sie sind die Arbeit, die schon getan ist.

---

## 5. Abbruchbedingungen

1. **`0152` liegt nicht.** Der Probelauf sagt es; nicht weitermachen.
2. **Der Probelauf nennt Dubletten.** Jede einzelne ansehen — sie bedeutet,
   dass eine Figur inzwischen angelegt wurde.
3. **Die Hülle nennt eine andere Zahl als der Probelauf.** Dann ist zwischen
   den beiden Läufen etwas passiert.
4. **Die `NOTICE` in Schritt 6 nennt mehr als 0 übersprungene Zeilen**, ohne
   dass der Probelauf Dubletten gemeldet hätte.
5. **Die Nachkontrolle in Schritt 7 nennt einen sichtbaren Entwurf.** Das darf
   der CHECK aus `0152` nicht zulassen — anhalten und melden.
6. **Der öffentliche Katalog in Schritt 9 hat sich verändert.** Dieser Import
   darf dort nichts bewirken.
7. **Punkt 1 dieses Laufzettels ist nicht geklärt** (Staging ist unvollständig)
   und es soll trotzdem auf **Production** importiert werden. Dann nicht.

---

## 6. Was dieser Lauf nicht leistet

* **Er klärt keine Bildrechte.** 105 Entwürfe tragen einen Pfad *innerhalb*
  der fremden .xlsx und den Status `unverified`. Es wurde nichts extrahiert.
* **Er prüft keine Identität abschließend.** Eine Namensnormalisierung ist ein
  Suchhilfsmittel, kein Beweis. Die 12 unklaren Kandidaten sind genau deshalb
  **nicht** vorbereitet.
* **Er ersetzt die Kuratierung nicht.** Element und `character_id` bleiben
  offen, wo die Quelle nichts hergibt (ADR-0034).

---

## Gefahren am 2026-10-27 — Ergebnis, rein lesend nachgemessen

**Der Import ist gelaufen und hat getan, was er zusagte.**

| | Baseline | jetzt | |
|---|---:|---:|---|
| Katalogzeilen | 626 | **731** | +105, die einzige gewollte Änderung |
| `catalog_status = draft` | 0 | **105** | SKY-0823 … SKY-0927 |
| davon sichtbar | — | **0** | keiner |
| davon `source = admin` | — | **105** | alle |
| `public` / `hidden` | 596 / 30 | **596 / 30** | unverändert |
| Lagerzeilen | 287 | **287** | unverändert |
| öffentliche Angebote | 257 | **257** | unverändert |
| `catalog_editorial`-Zeilen | — | **105** | eine Notiz je Entwurf |
| davon mit Bildzuordnung | — | **102** | die drei mehrdeutigen tragen keine |
| Journalzeilen `field = created` | 23 | **128** | 23 + 105 |

**Die Entwürfe entstanden um `21:46:19.223501` — alle mit demselben
Zeitstempel, also in EINER Transaktion.**

**Der zweite Lauf war folgenlos**, und das ist nachgemessen und nicht
geglaubt: zu den 105 neuen SKY-IDs stehen **genau 105** Journalzeilen
`field = created`. Ein zweiter Durchgang hätte 210 erzeugt. Auch
`catalog_editorial` trägt 105 Zeilen, nicht 210.

**Kein Entwurf trägt ein Bild oder einen Preis** — `image_override_path`,
`image_file` und `market_price` sind bei allen 105 leer, wie zugesagt.

---

## Die erklärte Abweichung: Sammlung 14 → 21

Die Nachkontrolle zu `0152` meldet die beiden Sammlungszeilen des
Basis-Vertrags als abweichend: **14 → 21 Zeilen**, und damit auch einen
anderen Abdruck. Die Kontenzahl bleibt **1**.

**Die Ursache ist nachgewiesen und liegt NICHT beim Import.**

Die Baseline wurde am **2026-10-27 um 20:23:19.426** eingefroren. Nimmt man
aus den heutigen 21 Zeilen genau die, die **vor** diesem Zeitpunkt entstanden
sind, bleiben **14** übrig — und ihr Abdruck, nach derselben Regel gerechnet
(`user_id|sky_id|quantity`, sortiert), ist

```
5935b9378c6dfaf7dfa2af2e72af96ce
```

**zeichengleich der eingefrorene Wert aus `baseline-0152.json`.**

Die sieben übrigen Zeilen entstanden am **2026-10-27 zwischen 20:43:35 und
20:43:44** — sieben Zeilen in neun Sekunden, je Menge 1, ohne Notiz, auf
SKY-0203, 0210, 0212, 0233, 0239, 0258, 0260. Das sind **bestehende**
Katalogfiguren; **keine einzige** Sammlungszeile verweist auf einen der neuen
Entwürfe (SKY-0823 … SKY-0927).

**Die Zeitachse schließt den Import als Ursache aus:**

```
20:23:19   Baseline eingefroren          14 Sammlungszeilen
20:43:35   ─┐
   …        │ sieben Zeilen, je eine pro Sekunde   ← Bedienung der Oberfläche
20:43:44   ─┘
21:46:19   Import der 105 Entwuerfe       eine Transaktion
```

Die Sammlungszeilen entstanden **eine Stunde vor** dem Import. Der Import
schreibt ohnehin nur `skylanders`, `catalog_editorial` und
`catalog_admin_changes`; `collection_items` nennt er nirgends.

**Das deckt sich mit der Angabe des Betreibers**, in diesem Zeitraum das neue
UX auf Staging getestet und dabei Figuren zur Sammlung hinzugefügt zu haben.
Das Muster — sieben aufeinanderfolgende Klicks in neun Sekunden auf benachbarte
Katalogfiguren — passt dazu und zu nichts anderem.

### Was daraus folgt, und was ausdrücklich NICHT

* **Die Baseline bleibt, wie sie ist.** Sie wurde vor der Migration erhoben
  und wird nie neu erhoben (ADR-0137). Sie nachträglich anzupassen würde
  genau die Abweichung verschwinden lassen, die hier erklärt wird — und sie
  wäre danach kein Beweis mehr.
* **Keine Prüfung wird abgeschwächt.** Die beiden Zeilen bleiben abweichend
  und zählen weiter in `9999`. Eine erklärte Abweichung ist etwas anderes als
  eine entfernte Prüfung.
* **Dieselbe Einordnung wie bei `0147`–`0149`** (`supabase/migrations/APPLIED.md`,
  „Die berechtigten Nachkontrollen"): dort bewegte der laufende Betrieb
  Lagerzahlen zwischen Baseline und Nachkontrolle, und auch dort war die
  Antwort, es zu benennen statt es wegzurechnen.
* **Für künftige Läufe:** wer die Oberfläche bedient, während eine Migration
  läuft, erzeugt solche Abweichungen zwangsläufig. Das ist kein Fehler,
  sondern der Preis dafür, gegen eine lebende Datenbank zu prüfen.
