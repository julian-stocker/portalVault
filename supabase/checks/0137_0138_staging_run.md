# Staging-Lauf `0137` und `0138` — Zubehör wird ein Katalogartikel

**Stand: vorbereitet, nicht gelaufen.** Diese Datei ist die Klickfolge, nicht
der Nachweis. Der Nachweis entsteht erst als Ergebnisblatt aus dem SQL-Editor
und gehört danach nach `supabase/checks/open_verifications.md` und in
`supabase/migrations/APPLIED.md`.

ADR-0128, Schritte **Z2** (`0137`, der Weg) und **Z3** (`0138`, die 21
Portale der Arbeitsmappe).

---

## Der Ablauf: eine Datei, ein Einfügen

```
supabase/operations/staging-0137-0138.sql
```

Vollständig markieren, in den SQL-Editor des **Staging**-Projekts
`qqxcpesbwfxzgytkdsac` einfügen, ausführen. **Das ist alles.**

Die Datei bringt `begin` und `commit` selbst mit und enthält:

| | |
|---|---|
| **A** | Vorprüfung — Umgebungsstempel, Transaktionsklammer, Stand `0136`, `0133`/`0134` nicht angewendet, Belegsperre dicht, 20 Bezugswerte, der Z0-Vertrag, die vier Zubehörkategorien leer, der ZB-Bereich `SKY-0615`–`0642` frei |
| **B** | Migration `0137`, **zeichengleich** eingebettet |
| **B2** | Migration `0138`, **zeichengleich** eingebettet |
| **C** | Nachprüfung — dieselben 20 Werte, die 21 Portale einzeln, beide Riegel, `sky_id_seq` unberührt |
| **D** | Ergebnisraster vorher/nachher zum Übernehmen ins Protokoll |

**Nichts in Teilen ausführen.** Jede Zeile gehört zur selben Klammer; ein
Fehler irgendwo rollt alles zurück — die 21 Portale, die sechs Kategorien,
die Funktionsdefinitionen. Es gibt keinen Zwischenstand, in dem ein Portal
halb eingeführt wäre.

### Was danach im Raster stehen muss

20 Zeilen. **17 `gleich`**, und drei mit einer **erwarteten** Differenz:

| Gegenstand | erwartet |
|---|---|
| `katalogzeilen` | **+ 21** — die Portale |
| `kategorien` | **+ 6** — eine Kategorie `Portale` je Serie |
| `typen` | **+ `portal=21`** — und sonst nichts |

Jede andere Abweichung ist ein Befund, und Abschnitt C bricht dann von selbst
ab. Das Raster ist die Lesefassung, nicht die Prüfung.

**Unverändert bleiben müssen** — der Z0-Vertrag, in A und in C:
534 shopfähig · 256 Angebote · `angebote_md5 = 4d1d6c30fe0ae886ca2689bcb1fe9634` ·
534 sammelbar · 39 Spiele-Overrides.

---

## Die Lagerprüfung geht auch VORHER — und das ist nützlich

`supabase/checks/inventory_accessories_readonly.sql` hängt **nicht** an
`0137` oder `0138`. Ein Spiel ist nicht sammelbar, weil sein **Artikeltyp**
`game` ist, und `item_type` steht seit `0135` — das ist auf Staging
angewendet. Die 13 Lagerzeilen auf Spielen werden also schon jetzt benannt;
was `0137`/`0138` hinzufügen, sind die **Portale**, nicht die Sichtbarkeit.

Deshalb lohnt sich der Lauf **zweimal**: einmal vor den Migrationen (dann
steht da, was die Lagerübersicht heute zeigen wird) und einmal danach (dann
kommen die Portale dazu, sobald eines eingekauft und eingebucht ist). Die
Werte müssen sich zwischen beiden Läufen **nicht** unterscheiden — `0138`
legt Katalogartikel an, keine Lagerzeilen.

---

## Danach: was die Lagerübersicht jetzt zeigt

```sql
begin;
select set_config('skyisles.z0', 'staging', true);
-- Inhalt von supabase/checks/inventory_accessories_readonly.sql einfügen
rollback;
```

Rein lesend. Zeile **9999 muss 0** zeigen. Die Datei beantwortet die Frage,
die diese Arbeit ausgelöst hat: **werden die 13 Lagerzeilen auf Spielen
sichtbar?**

| Zeile | was sie sagt |
|---|---|
| 301 | Lagerzeilen auf Spielen — **13 erwartet** (Z0-Vertrag) |
| 302 | davon aktiv und im produktiven Bereich: **werden benannt** |
| 304 | ihre SKY-IDs, zum Nachsehen in der Oberfläche |
| 401–405 | was durch die Namensregel fällt und in „außerhalb des Sortiments" bleibt |
| 501–503 | keine Zubehörzeile ist shopfähig, im Angebot oder sammelbar |

Weicht 301 von 13 ab, hat sich das Regal seit Z0 bewegt — ein Verkauf, ein
Einkauf. Das ist ein Befund und keine Panne; die Zahl gehört dann ins
Protokoll und der Vertrag berichtigt.

---

## Die Prüfdateien einzeln (nur wenn etwas zu klären ist)

Der Lauf oben enthält sie der Sache nach. Einzeln gefahren werden sie nur,
wenn ein Abbruch zu untersuchen ist — jede in **ihrer eigenen** Klammer, mit
dem Vertragsschalter **in derselben**:

```sql
begin;
select set_config('skyisles.z0', 'staging', true);
-- Inhalt der Prüfdatei einfügen
rollback;
```

`0137_preflight.sql` · `0137_postflight.sql` · `0138_preflight.sql` ·
`0138_postflight.sql`. Ein `set_config(…, true)` ist transaktionslokal:
steht es allein, gilt es nur für die eine Anweisung, und die Prüfdatei sieht
es nicht mehr.

---

## Wenn etwas schiefgeht

Die Transaktion ist dann abgebrochen, und **jede weitere Anweisung meldet
`25P02`**. Dann `rollback;` ausführen, die Meldung notieren und nichts
weiter versuchen. Es bleibt nichts zurück.

Ein **bereits bestätigter** Lauf wird anders zurückgenommen, und die
Reihenfolge ist zwingend:

```
R0138_drop_portals.sql   →   R0137_back_to_0135.sql
```

`R0137` bricht von sich aus ab, solange eine Zeile in einer
Zubehörkategorie steht — ohne die erweiterte Kategorieliste würde ein Portal
**sammelbar**. `R0138` bricht ab, sobald an einem Portal ein Einkauf, ein
Bestand, eine Bewegung, eine Sammlung, ein Warenkorb oder eine Zuordnung
hängt; zwei dieser zehn Tabellen hängen mit `ON DELETE CASCADE` und gingen
andernfalls still mit.

Die 21 Journaleinträge bleiben in jedem Fall stehen.
`catalog_admin_changes` ist append-only, durch einen Trigger und nicht durch
eine Policy — ein Journal, das sich mitlöschen lässt, ist keines.

---

## Zwei Dinge, die bis zum Lauf anschlagen — und das zu Recht

**`npm run verify:shop:staging` meldet eine Abweichung.**
`src/lib/catalog/collectible.ts` nennt fünf Kategorien,
`non_collectible_categories()` auf Staging noch eine:

```
db: [Spiele]  app: [Bundles, Portale, Spiele, Taschen, Zubehör]
```

Nach `0137` stimmen beide. **Kein Grund, die Anwendungsliste
zurückzudrehen** — die Meldung ist die Anzeige dafür, dass die Migration noch
fehlt.

**Und der Anwendungscode darf bis dahin nicht ausgeliefert werden.**
`FIGURE_COLUMNS` fordert `skylanders.item_type` ausdrücklich an; eine
fehlende Spalte lässt eine PostgREST-Auswahlliste **ganz** fehlschlagen. Auf
Staging steht sie seit `0135`, auf **Production fehlt sie** — dort gehen
`0135`–`0138` zuerst, der Code danach (`docs/DEPLOYMENT.md`).

---

## Was der lokale Probelauf schon zeigt

`npm run verify:check-sql` fährt beide Migrationen, beide Rücknahmen **und
das Einmal-Skript** gegen echtes PostgreSQL (PGlite, erfundene Zeilen):

| | |
|---|---|
| P22 | `0137` läuft durch: fünf Kategorienamen, acht Spalten, kein Angebot bewegt sich |
| P23 | `0137` **vor** `0135` bricht ab — und weder Funktion noch Kategorieliste bleiben zurück |
| P24 | `0137` bricht ab, wenn in einer Zubehörkategorie schon eine Zeile steht |
| P25 | `0138` legt 21 Portale an — kein Angebot, kein Nenner, keine Sequenz bewegt sich |
| P26 | `0138` **vor** `0137` bricht ab, keine Portalzeile bleibt zurück |
| P27 | `R0137` verweigert, solange ein Portal steht; in der Reihenfolge `R0138`, `R0137` geht beides |
| P28 | eine **gelistete** Lagerzeile auf einem Spiel wird benannt — und ist trotzdem kein Angebot |
| P29 | und die Lagerprüfung schlägt an, wenn Kategorie und Artikeltyp auseinanderlaufen |
| P30 | **das Einmal-Skript läuft in einem Durchgang durch** — und der Z0-Vertrag greift, bevor eine Zeile entsteht |

**Das ist kein Lauf gegen Staging.** Die Zeilen sind erfunden; über die echten
Bestände sagt der Probelauf nichts (`supabase/checks/open_verifications.md`,
Abschnitt 3a).

---

## Prüfsumme des Laufs

`supabase/operations/staging-0137-0138.sql`
SHA-256 `83af5cebdcb9130a3b5cb0df17162bde94505aee5d8d83d3c454675fa48b9344`

Die eingebetteten Abschnitte sind **zeichengleich** zu
`0137_catalog_accessories.sql` und `0138_catalog_portals.sql` — geprüft bei
jedem Testlauf von `src/lib/catalog/staging-oneshot.test.ts`. Wird der Lauf
hierüber gefahren, gehört diese Prüfsumme ins Protokoll, mit dem Hinweis auf
die beiden Migrationsdateien.
