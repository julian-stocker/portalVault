# Production-Release `0135`–`0141` — Plan

**Stand 2026-10-21. Nichts davon ist ausgeführt.** Kein Production-Write,
kein Push, kein Deployment. Diese Datei sagt, in welcher Reihenfolge es
geschehen muss und woran man merkt, dass es schiefgeht.

Die kurze Bedienanleitung für den Betreiber steht getrennt:
**`supabase/checks/production_release_checklist.md`**.

---

## 1. Der gemessene Ausgangszustand

| | Stand | wie belegt |
|---|---|---|
| **Staging** `qqxcpesbwfxzgytkdsac` | `0141` | **gemessen**: `shop_offers()` liefert 5 Spalten, `seller_sale_state()` antwortet `42501` (`npm run verify:seller:staging`) |
| **Production** `zmiwxswrpkmizvqsgype` | `0133` | **gemessen**: `non_collectible_categories()` = `[Spiele]` (Fassung `0006`), `shop_offers()` 4 Spalten, `seller_sale_state()` = `PGRST202` (`verify:shop:prod`, `verify:seller:prod`) |
| **Deployt** auf `skyisles.app` | **seit 2026-10-21: `21353e4`** | gepusht am 2026-10-21 (`81386e6..21353e4`, 27 Commits), Vercel-Build nach **64 Sekunden** live. Vorher `81386e6` — das ist weiterhin das **Rollback-Ziel** |

> **Eine Tatsache fehlt noch, und sie ist Schritt 1 des Ablaufs:** ob
> `skylanders.item_type` auf Production existiert. Indirekt stark belegt —
> `0137` setzt `0135` voraus und ist nachweislich nicht angewendet —, aber
> **nicht gelesen**. `state_audit_readonly.sql`, Zeile 60, beantwortet es.

**Production braucht:** `0135` → `0136` → `0137` → `0138` → `0139` → `0140`
→ `0141`.

**`0134` gehört NICHT dazu.** Sie ist nirgends angewendet, und der
Anwendungscode arbeitet ohne sie — `src/lib/catalog/item-type.test.ts`
hält das ausdrücklich fest („0134 fehlt: seller_purchase ist die Fassung
aus 0119").

---

## 2. Die Reihenfolge, und warum sie nicht beliebig ist

```
0135 → 0136 → 0137 → [ VERCEL-DEPLOYMENT ] → 0138 → 0139 → 0140 → 0141
```

Drei Behauptungen tragen diesen Schnitt. Jede ist unten belegt.

### 2a. Der bis zum 2026-10-21 deployte Code (`81386e6`) verträgt `0135`, `0136` und `0137`

> **Erledigt.** Die drei Migrationen liefen am 2026-10-21 unter diesem Code,
> ohne Störung; danach wurde `21353e4` deployt. Der Abschnitt bleibt als
> Begründung der Reihenfolge stehen — und `81386e6` bleibt das Rollback-Ziel.
> `src/lib/shop/production-compatibility.test.ts` prüft ihn seitdem gegen den
> **festen** Commit, nicht mehr gegen `origin/main`: sonst wäre die Aussage
> mit dem Push zur Tautologie geworden.

**Belegt am deployten Quelltext**, gelesen mit `git show origin/main:…`:

| Änderung | Wirkung auf `81386e6` | Beleg |
|---|---|---|
| `0135` legt `skylanders.item_type` an | **keine**. Die deployte `FIGURE_COLUMNS` nennt die Spalte nicht — sie endet bei `card_type` | `git show origin/main:src/lib/catalog/queries.ts` |
| `0135` hängt `item_type = 'figure'` an `is_shop_eligible()` | **keine**. Jede vorhandene Zeile ist `figure` (Vorgabewert), Spiele waren über die Kategorie ohnehin ausgeschlossen. Die Migration beweist es selbst: shopfähige Zeilen, Angebotszahl und Angebotsabdruck müssen identisch bleiben, sonst bricht sie ab | `0135`, Abschnitt 5 |
| `0136` nimmt `item_type` in die Betriebssicherung auf | **ein zusätzliches JSON-Feld** im Download. Die Oberfläche liest Felder einzeln, sie prüft keine Feldmenge | — |
| `0137` erweitert `non_collectible_categories()` auf fünf Namen | **keine**. Die deployte `NON_COLLECTIBLE_CATEGORIES` ist `{"Spiele"}`; die vier neuen Namen (`Portale`, `Bundles`, `Taschen`, `Zubehör`) treffen auf Production auf **keine** Kategorie, solange `0138` nicht gelaufen ist | `git show origin/main:src/lib/catalog/collectible.ts` |
| `0137` tauscht `seller_import_catalog()` gegen eine Fassung mit **achter** Spalte | **keine**. Der deployte Verbraucher liest `Record<string, unknown>` feldweise mit toleranten Vorgaben und **dokumentiert den Fall ausdrücklich**: „fehlt die Spalte, weil noch die alte Funktionsfassung läuft (etwa zwischen Migration und Deployment), wird NICHTS ausgefiltert" | `git show origin/main:src/lib/orderbook/queries.ts`, Zeile ~345 |
| `0137` legt `seller_create_catalog_item()` an | **keine**. Neue Funktion, der deployte Code ruft sie nicht | — |

> **Daraus folgt die wichtigste Eigenschaft dieses Plans:** der Zustand
> „`0137` angewendet, neuer Code noch nicht deployt" ist **unbegrenzt
> haltbar**. Scheitert das Deployment oder verzögert es sich um Tage,
> passiert nichts — die Datenbank kann fünf Kategorien nennen, solange es
> keine Zeile in ihnen gibt.

### 2b. Der NEUE Code verträgt den Zwischenstand `0137`

Also: deployt, aber `0138`–`0141` noch nicht angewendet.

| Was fehlt | Wie der neue Code damit umgeht | Beleg |
|---|---|---|
| `0138` (die 21 Portale) | `/zubehoer` zeigt die **39 Spiele**. Die Artauswahl erscheint erst ab zwei Arten, die Serienleiste erst ab zwei Serien — beides vorhanden | `accessory-view.tsx`, `types.length > 1` |
| `0139` → `shop_offers()` hat 4 statt 5 Spalten | `row.delivery_scope` ist `undefined`, `?? null` macht daraus „nicht angegeben". Die Kachel zeigt dann keinen Lieferumfang | `src/lib/shop/queries.ts` |
| `0139` → `skylanders.usk_rating` fehlt | `fetchUskRating()` fängt **genau** `42703` ab und gibt `null`. Die Detailseite zeigt „Nicht erfasst" | `src/lib/catalog/queries.ts` |
| `0141` → `seller_sale_state()` fehlt | `fetchSaleState()` fängt **genau** `PGRST202` ab und gibt `null`. Die Lagerkarte zeigt die drei Steuerungen dann nicht, statt sie anzubieten und beim Speichern zu scheitern | `src/lib/admin/inventory.ts` |

**`FIGURE_COLUMNS` enthält `usk_rating` NICHT** — ausdrücklich, weil diese
Spaltenliste auf jeder Umgebung läuft und eine Spalte darin den ganzen
Katalog lahmlegte. Ein Test hält das fest
(`accessory-sale-ui.test.ts`).

> **Jeder dieser vier Fälle ist ein Test**, nicht eine Zusage:
> `src/lib/shop/production-compatibility.test.ts`.

### 2c. `0138` darf NICHT vor dem Deployment laufen

Das ist der einzige Schritt mit einer zwingenden Seite. `0138` legt 21
Zeilen in Kategorien `Portale` an. Der deployte Code (`81386e6`) kennt nur
`Spiele` als nicht sammelbar — er würde die 21 Portale

* im **Figurenkatalog** als Karten zeigen,
* in den **Fortschrittsnenner** der Sammlung aufnehmen (534 → 555),
* und über `is_shop_eligible()`… **nein**: shopfähig werden sie nicht, weil
  `0135` den Artikeltyp verlangt und `0137` die Kategorie ausschließt. Die
  Datenbank hält, die Anzeige nicht.

Zwei der drei Wirkungen sind also reine Anzeigefehler — aber der
Fortschrittsnenner ist eine Zahl, die Nutzer kennen, und sie würde sich
ohne Zutun ändern (ADR-0040). Deshalb: **Deployment zuerst.**

`supabase/operations/prod-0138.sql` trägt diese Warnung in ihrem eigenen
Kopf, und ein Test prüft, dass sie dort steht.

### 2d. Was NACH dem Deployment noch fehlen darf

`0139`, `0140`, `0141` sind **keine** Release-Blocker (2b). Sie sind der
Mechanismus für den Zubehörverkauf; ohne sie ist der Katalog vollständig
und nichts ist kaufbar. Sie können am selben Tag oder später laufen.

---

## 3. Backup und Wiederherstellung

**Drei verschiedene Dinge, und sie dürfen nicht verwechselt werden.**

### 3a. Ein Vercel-Deployment zurücknehmen — minutenschnell, folgenlos

Vercel hält jedes Deployment. „Promote to Production" auf das vorige
(`81386e6`) stellt den alten Code in Sekunden wieder her. **Es berührt die
Datenbank nicht.** Nach 2a ist der alte Code mit `0135`–`0137` verträglich
— ein Rollback des Deployments ist also auch nach den Migrationen
gefahrlos, solange `0138` noch nicht gelaufen ist.

> **Nach `0138` gilt das nicht mehr:** dann zeigte der alte Code Portale als
> Figuren. Wer nach `0138` das Deployment zurücknimmt, muss auch `0138`
> zurücknehmen (`R0138_drop_portals.sql`) — oder die 21 Portale
> vorübergehend auf `is_active = false` setzen.

### 3b. Eine Schemaänderung zurücknehmen — pro Migration, in Gegenrichtung

Jede der sieben hat eine Rücknahme, und sie laufen **in umgekehrter
Reihenfolge**:

```
R0141_drop_sale_state.sql     →  R0140_back_to_0136.sql
→ R0139_drop_sale_release.sql →  R0138_drop_portals.sql
→ R0137_back_to_0135.sql      →  R0136_back_to_0131.sql
→ R0135_drop_item_type.sql
```

`R0140` **vor** `R0139`: der Rumpf aus `0140` liest die Spalten, die
`R0139` löscht. `R0139` bricht ab, wenn eine Position freigegeben ist oder
ein Lieferumfang gesetzt wurde — die gingen mit der Spalte verloren.

**Was eine Rücknahme NICHT kann:** eine Bestellung ungeschehen machen. Alle
sieben Migrationen fassen keine Geschäftszeile an; ihre Rücknahmen auch
nicht. Das ist der Grund, warum sie überhaupt zurücknehmbar sind.

### 3c. Production-Daten wiederherstellen — die letzte Wahl, und nicht pauschal

> **Keine Empfehlung, nach erfolgten Bestellungen die Datenbank auf einen
> alten Stand zurückzusetzen.** Ein Point-in-time-Restore wirft jede
> Bestellung, jede Zahlung, jede Lagerbewegung und jeden Beleg nach dem
> Zeitpunkt weg. Bei einem Shop, der Geld nimmt, ist das fast immer der
> größere Schaden — und bei bereits ausgestellten Rechnungen eine
> aufbewahrungsrechtliche Frage, keine technische.

Richtig ist die Reihenfolge: **3b vor 3c.** Eine Schemaänderung nimmt man
zurück; Daten stellt man nur wieder her, wenn Daten beschädigt sind. Keine
dieser sieben Migrationen schreibt eine Geschäftszeile — es gibt also
keinen Fall, in dem 3c die Antwort auf diesen Release ist.

### 3d. Was vor dem Release vorliegen muss, und wie es nachgewiesen wird

> **BERICHTIGUNG vom 2026-10-21 — Punkt 1 und 2 sind auf Production nicht
> erreichbar.** Production läuft auf **Supabase Free: keine nativen Backups,
> kein PITR** (`PROJECT_STATUS.md`, Stand 2026-10-01 und Abschnitt zur
> Plattformsicherung). Die Tabelle unten verlangt damit zwei Nachweise, die
> es in diesem Tarif nicht gibt. Das ist beim Schreiben dieses Plans
> übersehen worden.
>
> **Was an ihre Stelle tritt — und was nicht:**
>
> | statt | tritt | und was es nicht kann |
> |---|---|---|
> | Automatikbackup | **Plattformsicherung** `/admin/datensicherung` (53 Bereiche, Konten-Inventar, Storage) — auf Production angewendet, Historie in `platform_export_runs`, nur `received` zählt (`backup_evidence_check.sql`) | kein Schema, keine Funktionen, keine Policies, keine Sequenzstände, keine Passwörter |
> | PITR | **die Rücknahmedatei der jeweiligen Migration** — für `0138` ist das `R0138_drop_portals.sql`, die genau die 21 Zeilen und die danach leeren Kategorien entfernt und abbricht, falls etwas daran hängt | keinen Punkt-in-der-Zeit-Rücksprung; wer die Zeilen behalten UND den alten Stand will, hat beides nicht |
>
> **Für `0138` ist damit kein neuer Nachweis nötig.** Die Begründung steht
> in einem Satz: der Inhalt der 21 Zeilen steht zeichengleich in der
> Migrationsdatei selbst, die Rücknahme ist präzise und geprüft (**P27**,
> **P44**), und `0138` fasst keine Geschäftszeile an. Ein Backup ist das
> Netz für verlorene Daten — hier gibt es keine, die verloren gehen könnten.
> Offen bleibt der **schemaseitige** Nachweis (`pg_dump`,
> `backup_architecture_two_tier.md`, Punkt 9); der ist älter als dieser
> Release und gehört nicht in seine Entscheidung.


| # | Was | Wie der Nachweis aussieht |
|---|---|---|
| 1 | **Supabase-Automatikbackup** steht und ist jung | Supabase-Dashboard → Database → Backups: Datum und Uhrzeit des letzten Backups ins Protokoll. **Älter als 24 h: stopp** |
| 2 | **Point-in-time-Recovery** ist aktiv (falls im Tarif) | derselbe Ort; das früheste erreichbare Datum ins Protokoll |
| 3 | **Betriebssicherung** heruntergeladen | `/business/datensicherung`, Datei speichern |
| 4 | Und sie ist **vollständig und lesbar** | `npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json` — **28 Bereiche, alle Zähler, die vollständige Belegkette**. Fehlschlag: stopp |
| 5 | **Schemastand festgehalten** | `state_audit_readonly.sql` auf Production, Ergebnis vollständig ins Protokoll. Das ist der Vorher-Zustand, gegen den später verglichen wird |

> **Punkt 4 ist der eigentliche Nachweis.** Ein Backup, dessen
> Wiederherstellbarkeit niemand geprüft hat, ist eine Datei. `verify:backup`
> vergleicht jedes Feld jedes Bereichs gegen `manifest.ts` **und** gegen den
> Rumpf der letzten Migration — es liest nur Dateien, keine Datenbank.
>
> **Und was es nicht beweist:** dass sich daraus eine Datenbank
> wiederherstellen lässt. Es gibt **keine** Importfunktion
> (`restore_supported = false`); `supabase/checks/0129_restore_test.md`
> beschreibt den Weg auf einer isolierten Testdatenbank, und **das
> Ergebnisprotokoll dort ist leer**. Die Wiederherstellung von Daten (3c)
> hängt deshalb am Supabase-Backup, nicht an dieser Datei.

---

## 4. Stopp-Kriterien

**Sofort anhalten, nichts weiter ausführen**, wenn:

| # | Beobachtung | Warum |
|---|---|---|
| S1 | Backup älter als 24 h oder `verify:backup` schlägt fehl | ohne Netz kein Seil |
| S2 | `state_audit_readonly.sql` zeigt auf Production einen Stand **nach** `0133` | dann ist die Akte falsch, und die Reihenfolge ist neu zu bestimmen |
| S3 | eine Migration bricht ab — **gleich mit welcher Meldung** | sie rollt sich selbst zurück; weiterzumachen hieße, auf einem unbekannten Stand aufzubauen |
| S4 | `ABBRUCH A1`, `A2` oder `A3` | die Datei läuft im falschen Projekt |
| S5 | eine Zahl im Abschlussraster weicht ab, die „gleich" sein muss | insbesondere **Angebote**, **Angebotsabdruck**, **sammelbare Zeilen** |
| S6 | nach `0139`: **mehr als 0** freigegebene Positionen | eine Zubehörposition wäre kaufbar geworden |
| S7 | die Belegsperre ist offen | `receipt_lock_check.sql` muss `9999 = 0` zeigen |
| S8 | das Vercel-Deployment schlägt fehl | **nicht** mit `0138` weitermachen; der Zwischenstand ist haltbar (2a) |
| S9 | `skyisles.app` zeigt nach dem Deployment einen Fehler im Katalog | sofort Deployment zurücknehmen (3a) und melden |

---

## 5. Was dieser Release NICHT tut

* **Keine Zubehörposition wird kaufbar.** `sale_released` steht nach `0139`
  auf `false`, bei jeder Zeile. Die Migration prüft es selbst nach
  (Abschnitt 8b), der Postflight von außen.
* **Keine USK-Angabe wird erfunden.** `usk_rating` bleibt überall `null`;
  ohne Eintrag lässt `seller_set_sale_release()` kein Spiel frei.
* **Keine Belegausstellung wird freigegeben.** Keine der sieben Dateien
  fasst sie an, und `0139` prüft nach, dass die Sperre dicht ist.
* **Kein bestehendes Figurenangebot ändert sich.** `0135`, `0137` und `0139`
  vergleichen Angebotszahl und Angebotsabdruck vor und nach dem Lauf und
  brechen bei jeder Abweichung ab.
* **Keine Marktpreise, Lagerbestände, Bestellungen, Sammlungen oder Belege
  werden geschrieben.** Keine der sieben enthält ein `insert`, `update` oder
  `delete` auf einer Geschäftstabelle — außer `0138`, die 21 Katalogzeilen
  anlegt.

---

## 6. Was offen bleibt — und was davon blockiert

### Blockiert diesen Release NICHT

| Offener Punkt | Warum er warten kann |
|---|---|
| **Authentifizierter Test der Lagerverwaltung** | Die Oberfläche zeigt ihre Steuerungen nur, wenn `seller_sale_state()` antwortet; ohne Freigabe ist nichts kaufbar. Ein Fehler dort kann keinen Kunden und keine Bestellung treffen |
| **Zubehör-Bestelldurchstich** (Warenkorb → Checkout → Bestellung → Storno) | Es gibt kein Zubehörangebot, also auch keinen Weg hinein |
| **USK-Quelle und Darstellung** | relevant erst vor dem ersten Spieleverkauf (`docs/LEGAL.md`, 8b) |
| **Steuer, Erschöpfungsgrundsatz, BattG, ElektroG, Widerruf** | dieselbe Grenze: vor der ersten Freigabe, nicht vor diesem Release |
| **Lieferumfang bei kabellosen Portalen** | eine Produktfrage, kein Schemafehler |

### Blockiert — und ist erledigt

| Punkt | Stand |
|---|---|
| Der Code braucht `item_type` (`FIGURE_COLUMNS`) | gelöst durch die Reihenfolge: Migration vor Deployment |
| Der Code erwartet fünf nicht sammelbare Kategorien | gelöst durch `0137` vor dem Deployment |
| Der alte Code zeigte Portale als Figuren | gelöst durch `0138` nach dem Deployment |

### Vorbestehende Production-Befunde — gemessen, und kein Blocker

Beide am 2026-10-21 rein lesend gemessen. Keine der sieben Migrationen
fasst die betroffenen Tabellen an; sie blockieren diesen Release **nicht**,
und sie sind nicht durch diese Arbeit entstanden.

| Befund | Messung | Einordnung |
|---|---|---|
| **6 shopfähige Positionen nicht gelistet** | `verify:shop:prod`, Abschnitt 4 | bewusste Opt-outs des Betreibers. Auf Staging dasselbe Bild mit 15 |
| **101 von 103 umgewandelten Reservierungen zeigen auf eine `sale_external`-Bewegung** | `verify:commerce:prod`, Abschnitt 2 | `seller_book_sale_item()` lehnt eine bestellgebundene Position ab (`0090`) — eine Reservierung sollte also nie auf eine solche Bewegung zeigen. Gehört zur Familie der **„61 verwaisten `sale_external`-Bewegungen"**, die `PROJECT_STATUS.md` seit dem 2026-09-19 als *„offen, bewusst liegen gelassen"* führt |

> **Die zweite Zeile ist eine offene Frage, keine beantwortete.** Die
> Prüfung bleibt dort deshalb **rot** und nennt die Ursache, statt
> aufgeweicht zu werden, bis sie grün ist — eine aufgeweichte Prüfung
> löscht die Frage. Sie gehört angesehen, aber nicht in diesem Release.

### Nicht geprüft, und ausdrücklich nicht als bestanden dargestellt

* Die **Lagerkarte** mit angemeldetem Betriebskonto — nie geöffnet.
* **Freigabe, Preis, Lieferumfang** an einer echten Position — nie ausgeführt.
* **Warenkorb und Checkout mit Zubehör** — nie durchlaufen.
* Dass `skylanders.item_type` auf Production fehlt — **nur indirekt belegt**,
  Schritt 1 misst es.
* Dass eine **Wiederherstellung** aus der Betriebssicherung funktioniert —
  es gibt keine Importfunktion (3d).

---

## 7. Die Dateien

| Schritt | Datei | schreibt |
|---|---|---|
| 1 | `supabase/checks/state_audit_readonly.sql` | nein |
| 2 | `supabase/checks/receipt_lock_check.sql` | nein |
| 3 | `supabase/operations/prod-0135.sql` | **ja** |
| 4 | `supabase/operations/prod-0136.sql` | **ja** |
| 5 | `supabase/operations/prod-0137.sql` | **ja** |
| 6 | — Vercel-Deployment — | |
| 7 | `supabase/operations/prod-0138.sql` | **ja** |
| 8 | `supabase/operations/prod-0139.sql` | **ja** |
| 9 | `supabase/operations/prod-0140.sql` | **ja** |
| 10 | `supabase/operations/prod-0141.sql` | **ja** |
| 11 | `supabase/checks/state_audit_readonly.sql` erneut | nein |
| 11 | `supabase/checks/receipt_lock_check.sql` erneut | nein |

Jede `prod-*.sql` bringt `begin`, `commit` und den **Production-Riegel**
selbst mit, und alle sieben tragen ihn Zeichen für Zeichen gleich (ein Test
rechnet das nach):

| | Bedingung | fällt wo |
|---|---|---|
| **A1** | das vollständige Markerpaar `SKY-0821`+`SKY-0822` **fehlt** | Staging trägt beide |
| **A2** | `0133` ist **angewendet** | auf Staging nicht |
| **A3** | der Katalog trägt ≥ 100 Zeilen | kein leeres Projekt |

> **A1 prüft das PAAR, nicht eine einzelne ID — gemessen am 2026-10-21.**
> Production trägt `SKY-0821` als **echten Artikel**: „Winterfest
> Lob-Star", `source = admin`, angelegt 2026-09-16, aktiv und redaktionell
> ausgeblendet. Die ID liegt im produktiven Allokationsbereich
> `SKY-0821`–`SKY-8999` und gehört dort hin; `SKY-0822` existiert dort
> nicht. Eine erste Fassung des Riegels brach bei *irgendeiner* der beiden
> ab und hätte damit jede der sieben Dateien auf Production abgewiesen.
>
> **Schwächer wird der Schutz dadurch nicht.** Staging fällt zweifach: an
> A1 **und** an A2. Probelauf **P41** führt fünf Fälle vor — Markerpaar
> (A1), winziger Katalog (A3), ohne Marker (durch), **nur `SKY-0821`**
> (durch, und der Artikel bleibt unberührt) und **ohne `0133`** (A2, wo A1
> allein durchgelassen hätte).

Die Pre- und Postflights der einzelnen Migrationen sind **nicht** in dieser
Liste: sie tragen Z0-Bezugszahlen von **Staging** und würden auf Production
zu Recht abweichen. Was auf Production geprüft werden muss, prüft jede
Migration in ihrer eigenen Transaktion — gegen Abdrücke, die sie dort selbst
genommen hat.
