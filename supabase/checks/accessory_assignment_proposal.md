# 35 Freitextpositionen sind Portale — Befund und Vorschlag

**Stand 2026-10-20. Nichts davon ist ausgeführt.** Dieses Blatt legt die
Fälle vor; die Entscheidung gehört dem Betreiber (ADR-0128, Punkt 10).

Reproduzieren: `supabase/checks/accessory_assignment_readonly.sql`, rein
lesend, ein einziges SELECT.

---

## Die Frage, die offen war

`accessory_audit_readonly.sql` hat am 2026-10-18 notiert, dass die **206
Einkaufspositionen ohne `sky_id`** nicht erwartet waren, und zwei Lesarten
offengelassen: entweder gibt es viel mehr Nicht-Katalogartikel als gedacht,
oder die Zahl enthält etwas anderes.

**Es war das Zweite.** Seit `0138` gibt es die 21 Portale als
Katalogartikel, und damit lässt sich der Rohname jeder Freitextposition mit
`skylanders.name` vergleichen.

## Der Befund

| | |
|---|---|
| Einkaufspositionen insgesamt | **2 128** |
| davon ohne `sky_id` | **206** |
| davon mit **exaktem** Katalogtreffer | **35** |
| davon mehrdeutig | **0** |
| bleiben Freitext | **171** |

**Alle 35 Treffer sind Portale.** Kein Spiel ist in den Freitextpositionen
gelandet — die 37 Spiele-Positionen tragen längst ihre `sky_id`.

| SKY-ID | Positionen | in Einkäufen | Rohname |
|---|---|---|---|
| `SKY-0615` | 1 | 1 | `84157790 (SA)` |
| `SKY-0616` | 2 | 2 | `83973080 (SA)` |
| `SKY-0617` | 5 | 5 | `83973080A Wireless (SA)` |
| `SKY-0618` | 7 | 7 | `0000502 (G)` |
| `SKY-0619` | 11 | 11 | `0000547 (SF)` |
| `SKY-0620` | 2 | 2 | `0000586 (T)` |
| `SKY-0621` | 3 | 3 | `0000655 (SC)` |
| `SKY-0622` | 1 | 1 | `0000726 (I)` |
| `SKY-0624` | 1 | 1 | `84151790 (SA)` |
| `SKY-0627` | 1 | 1 | `84704790 (SF)` |
| `SKY-0637` | 1 | 1 | `84721790 (SF, T, SC)` |

**11 der 21 Portale** sind betroffen, verteilt auf **24 importierte Einkäufe**
(`source = excel_order_2026`, keiner davon ein Test). Die übrigen 10 Portale
haben keine Einkaufshistorie.

### Warum das keine Vermutung ist

Beide Seiten stammen aus **Spalte B derselben Arbeitsmappe**: die
Freitextposition aus dem Einkaufsimport, der Katalogartikel aus `0138`. Wo
beide **Zeichen für Zeichen** übereinstimmen, ist das dieselbe Quellzeile.
Verglichen wird ohne `trim`, ohne `ilike`, ohne Normalisierung — eine
Normalisierung würde aus einer Tatsache eine Heuristik machen.

Gegenprobe: die 171 Positionen **ohne** Treffer sind durchweg Dinge, die
bewusst keinen Katalogartikel haben — Disney Infinity (`1.0 - Sulley`,
`INF-8032386 (Disney Infinity)`, `3.0 - Spiel PlayStation 4`), Amiibo
(`335000AJADW2 - Tom Nook`), Figurenteile (`Blastzone - OBERTEIL`), dazu
`Tasche`, `Trophy` und zwei Zeilen, die wörtlich `portal` heißen und keiner
Modellnummer zuzuordnen sind. **Kein einziger Disney-Infinity-Name trifft
versehentlich einen Skylanders-Artikel** — genau das leistet die exakte
Gleichheit.

## Was heute schon richtig ist

* **37 Einkaufspositionen** hängen korrekt an Spielen, **18
  Verkaufspositionen** ebenso.
* **13 Lagerzeilen** auf Spielen mit 19 Stück — seit dieser Arbeit in der
  Lagerübersicht benannt und filterbar.
* **0 Lagerzeilen** auf Portalen. Das ist richtig: die 35 Positionen sind
  `reconciled_legacy`, ihr Bestand wurde getrennt abgeglichen, und keine
  besitzt eine Lagerbewegung.
* **0 Sammlungseinträge** auf Zubehör. Die Sammlung ist unberührt.
* **Nichts ist falsch zugeordnet.** Keine Position zeigt auf einen falschen
  Artikel, keine Zubehörzeile steht in einer sammelbaren Kategorie, und kein
  vorhandener Artikel wird durch einen Filter verschluckt.

**Es gibt also keinen Datenfehler zu beheben.** Was es gibt, ist eine
Zuordnung, die seit `0138` *möglich* geworden ist.

## Der Vorschlag, falls Sie ihn wollen

**Nichts Neues bauen.** Der Weg existiert seit `0054`:

```
seller_set_purchase_item_sky(item_id, sky_id)
```

Erreichbar als **Figurenwechsel** im Einkaufsdialog, eine Position je Griff.
Was die Funktion zusagt, steht in ihrem Kommentar und ist für diesen Fall
genau richtig:

| | |
|---|---|
| fasst **nicht** an | `raw_name`, `source_row`, Legacy-Flaggen, Zustand, Lage, Zustandsangabe |
| bewegt **keinen** Bestand | kein `insert` in `inventory_movements`, keine Lagerzeile |
| weist ab | jede Position, die schon eine Lagerbewegung besitzt |
| umkehrbar | derselbe Aufruf mit `null` stellt den Freitext wieder her |

**Alle 35 Positionen erfüllen die Vorbedingung:** keine besitzt eine
Lagerbewegung (`movement_id` ist überall NULL). Der Herkunftsnachweis bleibt
in jedem Fall erhalten — `raw_name` wird nicht angefasst, die Position weiß
also weiterhin, wie die Arbeitsmappe sie genannt hat.

### Was die Zuordnung bringt

Die Einkaufshistorie eines Portals wäre lesbar: wie oft `SKY-0619` eingekauft
wurde, in welchen Einkäufen, zu welchem Anteil am Paketpreis. Heute steht das
als Freitext da und lässt sich nur von Hand zusammensuchen.

### Was sie NICHT bringt, und auch nicht soll

**Keinen Bestand.** Die 35 Positionen sind `reconciled_legacy` —
`seller_book_purchase_item` weist diesen Zustand ausdrücklich ab („a
historical purchase item is already reflected in stock and is never booked
again"). Nach der Zuordnung stehen also weiterhin **0 Lagerzeilen auf
Portalen**, und das ist richtig: ob tatsächlich noch Portale im Regal
liegen, sagt eine Zählung, kein Import.

### Der Ablauf ist vorbereitet

**`supabase/checks/portal_assignment_run.md`** — Klickfolge, Vorher/Nachher-Zahlen
und Rücknahmeweg. Kurz:

1. `accessory_assignment_readonly.sql` lesen (erwartet: 103 = 35, 203 = 0).
2. **Eine** Stichprobe von Hand über den Figurenwechsel (`SKY-0622`,
   Einkauf #74) — damit Sie einmal selbst sehen, dass Rohname und Zustand
   stehenbleiben.
3. `supabase/operations/staging-portal-assignment.sql` — ein Einfügen, eine
   Transaktion, mit blockierender Vor- und Nachprüfung und Ergebnisraster.
4. Dasselbe Leseblatt noch einmal (erwartet: 102 = 171, 402 = 35, 502 = 0).

Rücknahme: `supabase/rollback/R_portal_assignment.sql`.

**Warum nicht über `seller_set_purchase_item_sky()`:** die Funktion ist aus
dem SQL-Editor nicht erreichbar — sie fragt `can_operate_active_seller()`,
und das verlangt ein `auth.uid()`, das eine Editor-Sitzung nicht hat. Das
Skript bildet nach, was sie tut, und übernimmt ihre Bedingungen; über die
Oberfläche (Schritt 2) läuft sie unverändert.

**Nachgefahren gegen echtes PostgreSQL:** `npm run verify:check-sql`,
Durchgänge **P31** (0 → 35, Rohnamen unverändert, Rücknahme stellt wieder
her) und **P32** (bricht ab bei einer Position zuviel oder einer
Lagerbewegung, mit 0 zugeordneten Zeilen).

**Freigabe erforderlich.** 35 Schreibvorgänge an historischen Einkäufen sind
keine Nebensache, auch wenn jeder einzelne umkehrbar ist und keinen Bestand
bewegt.

## Was ausdrücklich NICHT vorgeschlagen wird

* **Kein Massenlauf.** Kein Skript, keine Migration, kein `update … where
  raw_name = …`. ADR-0128 Punkt 10 verlangt eine namensweise Entscheidung,
  und 35 Entscheidungen sind 35 Griffe.
* **Keine Erfindung von Bestand.** Keine Lagerzeile, keine Bewegung.
* **Kein Umhängen der 171 übrigen Positionen.** Disney Infinity, Amiibo,
  Figurenteile und Taschen haben keinen Katalogartikel und sollen keinen
  bekommen (ADR-0128, Punkt 9).
* **Keine Freigabe der Portale im öffentlichen Katalog.** Das ist eine
  getrennte Entscheidung je Artikel unter `/admin/catalog`.
