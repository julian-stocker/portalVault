# Oberfläche: Lager, Zubehörangebot, Checkout — der Plan

**Status:** Plan. **Kein Anwendungscode dieser Art ist geschrieben.** Er wird
es erst, wenn `0139` auf Staging angewendet ist — eine Seite, die
`sale_released` liest, bringt `/business/inventory` zum Absturz, solange die
Spalte nicht existiert. Das ist keine Vorsicht, sondern die Reihenfolge.

Grundlage: ADR-0129, `supabase/checks/accessory_offer_proposal.md`.

---

## 0. Was schon fertig ist und nicht mehr angefasst wird

| | |
|---|---|
| **Warenkorb** | braucht **keine Zeile**. Identität ist `sky_id + condition`, er lädt den Katalog nie und kennt keinen Artikeltyp |
| **Checkout, Zahlung, Bestellung** | typneutral. `create_order()` liest Name und Bild direkt aus `skylanders` |
| **Lagerabgang, Storno, Retoure, Erstattung** | hängen an `order_lines.inventory_id` |
| **Angebotsprojektion** | **eine**: `shop_offers()`. `/zubehoer` liest sie seit heute schon |
| **Sammlung** | unberührt. Zubehör ist nicht sammelbar, und keine der Änderungen unten fasst Sammlungscode an |

**Es gibt also keine zweite Shop- oder Warenkorbarchitektur zu bauen — und
es wird keine gebaut.**

---

## 1. Lageroberfläche — `/business/inventory`

### 1a. Was sich ändert

`isShopGoods()` (`src/lib/admin/inventory-model.ts`) sagt heute: *jede
Zubehörposition ist keine Shopware*. Daraus wird:

```
Figur                      → Shopware, wie bisher
Spiel oder Portal          → Shopware, wenn die Position freigegeben ist
Bundle, sonstiges Zubehör  → keine Shopware (nicht entschieden)
```

Die Karte einer Zubehörposition bekommt damit dieselben Felder wie eine
Figurenkarte — **Verkaufspreis** und **Verkaufsstatus** —, plus zwei, die es
bei Figuren nicht gibt.

### 1b. Die Karte einer Zubehörposition

| Zeile | Inhalt | Quelle |
|---|---|---|
| Kopf | Name, Artikeltyp, SKY-ID, Plattform/Modell | wie heute |
| Bestand | Menge, verfügbar, Bewegungen, Einkaufshistorie | **unverändert** |
| **Lieferumfang** | Auswahl aus `scopesFor(itemType)` — drei Werte für Spiele, zwei für Portale, **keine** für Figuren | `seller_set_delivery_scope()` |
| **Verkaufspreis** | wie bei Figuren | `set_shop_listing()` |
| **Im Shop** | `is_listed`, wie bei Figuren | `set_shop_listing()` |
| **Zum Verkauf freigegeben** | der neue Schalter | `seller_set_sale_release()` |
| **Warum noch nicht verkäuflich** | ein Satz, siehe 1c | `admin_shop_listing_audit()` |

**Drei Aufrufe, nicht einer.** Preis, Lieferumfang und Freigabe bleiben
getrennt: wer sie in einen Aufruf legt, gibt irgendwann beim Preispflegen
versehentlich frei.

**Alle fünf Werte stehen zur Wahl** — `Spielmedium mit Originalhülle`
eingeschlossen. Die frühere Kopplung an `condition` ist aufgehoben
(ADR-0130): ein Spiel mit Hülle ist genauso verkäuflich wie eines ohne.

**Keine Zustandsauswahl.** Es gibt einen Zustand, und eine Auswahl mit einem
Wert ist keine Auswahl. Die Karte nennt ihn als Wort („Gebraucht"); den
Standard im Klartext trägt `/shop` einmal für die ganze Seite.

### 1c. Der Satz „warum noch nicht"

`admin_shop_listing_audit()` liefert je Position einen Grund. Die sechs
werden einmal übersetzt (`de.ts`), nicht an der Karte zusammengebaut:

| Grund aus der Datenbank | Satz auf der Karte |
|---|---|
| `no catalog row` | Zu dieser Position gibt es keinen Katalogartikel. |
| `inactive figure` | Der Artikel ist nicht aktiv. |
| `editorially hidden` | Der Artikel ist im Katalog nicht sichtbar. |
| `not a collectible` | *(nur noch bei Figuren)* |
| `item type not sold` | Diese Artikelart wird nicht verkauft. |
| `usk rating missing` | Für dieses Spiel ist keine USK-Kennzeichnung erfasst. |
| `usk 18 needs age verification` | USK 18 lässt sich ohne Altersprüfung nicht verkaufen. |
| `delivery scope missing` | Es ist nicht angegeben, was geliefert wird. |
| `not released for sale` | Diese Position ist nicht zum Verkauf freigegeben. |

Dazu ein Fall, den die Diagnose **nicht** meldet, weil er die Eignung nicht
berührt: **kein Preis**. `seller_set_sale_release()` lehnt ihn ab, und die
Karte zeigt ihn an derselben Stelle — aus dem Preisfeld, das ohnehin da ist.

**Der Grund wird gelesen, nicht nachgerechnet.** Eine zweite Herleitung in
TypeScript wäre eine zweite Wahrheit.

### 1d. Was die Oberfläche NICHT bekommt

* **keine Sammelfreigabe.** Kein „alle Portale freigeben", keine Mehrfachauswahl.
  Jede Freigabe ist ein Vorgang an einer Position (Punkt 1 des Auftrags).
* **keinen USK-Schalter.** Die Alterskennzeichnung gehört dem Katalog
  (`admin_set_usk_rating()`, Plattformadmin) und erscheint unter
  `/admin/catalog`, nicht im Betriebsbereich (ADR-0077).
* **keine automatische Vorbelegung** des Lieferumfangs. Geraten wird nichts.

### 1e. Tests

Dieselben neun Fälle wie bisher, dazu: ein Schalter erscheint nur, wenn er
wirkt · eine Figur zeigt keinen Freigabeschalter und keine
Lieferumfangsauswahl · **alle fünf** Lieferumfänge sind wählbar ·
jeder Grund hat genau einen Satz und kein Satz steht ohne Grund da.

---

## 2. Zubehörangebote im Katalog

### 2a. Die Kachel (`AccessoryCard`) — fast fertig

Sie liest **heute schon** `offersFor(...)` aus derselben Projektion und zeigt
„Aktuell kein Angebot". Es fehlt:

* der **Preis**, sobald `shop_offers()` einen liefert (die Stelle existiert),
* der **Lieferumfang** als zweite Zeile am Angebot (`deliveryScopeLabel()`),
* ein **Verweis auf die Detailseite** — wie die Figurenkarte auf
  `/skylanders/<slug>#angebote` zeigt (`OfferLink`, seller-neutral).

**Kein Kaufknopf auf der Kachel.** Dafür fehlt der Platz für Zustand,
Lieferumfang, Plattform und Alterskennzeichnung — und ein Kauf ohne diese
Angaben ist genau der Fehler, den Punkt 5 des vorigen Auftrags ausschließt.

### 2b. Neu: `/zubehoer/[slug]`

Die Detailseite eines Zubehörartikels, gebaut wie `/skylanders/[slug]`, aber
**ohne** Charakterpanel, ohne Sammelknopf, ohne Besitzsiegel, ohne
Marktpreis.

| Abschnitt | Inhalt |
|---|---|
| Kopf | Name, Artikeltyp, Serie(n), Plattform **oder** Modellnummer, SKY-ID |
| Produktangaben | **USK-Kennzeichnung** (bei Spielen, Pflicht), der Zustandsstandard im Klartext, **Lieferumfang** |
| Angebot | `OfferPanel` — **dieselbe Komponente** wie bei Figuren, mit `AddToCartButton` |
| Versandhinweis | `ShippingNote`, wie bei Figuren |
| ohne Angebot | ein ruhiger Satz, kein deaktivierter Knopf (V7) |

**404, solange der Artikel nicht katalogsichtbar ist** — dieselbe Regel wie
`/skylanders/[slug]` (ADR-0039).

`/skylanders/[slug]` bleibt **unverändert** figurenonly: `isCollectible()`
→ 404. Zwei Bereiche, zwei Adressräume, keine Vermischung.

### 2c. `/shop`

`shopEntries()` filtert heute `isCollectible()`. Daraus wird „katalogsichtbar
**und** (sammelbar **oder** Zubehör)", und die Seite liest zusätzlich
`fetchAccessoryCatalog()`. **Dieselbe Seite, dieselbe Regel, dieselbe
Projektion** — kein zweites Schaufenster.

Ein freigegebenes Portal erscheint damit automatisch im Shop, sobald es Preis
und Bestand hat. Ohne Freigabe erscheint nichts.

### 2d. Warenkorb und Checkout

**Keine Änderung.** Die Zeile trägt `sky_id + condition` und einen
Anzeige-Schnappschuss; beides funktioniert für ein Portal wie für eine Figur.
Der Lieferumfang kommt aus `shop_offers()` und wird im Warenkorb **angezeigt**
— eine Zeile mehr in der bestehenden Komponente, keine neue Architektur.

### 2e. Tests

Kachel zeigt Preis und Lieferumfang, wenn ein Angebot da ist · Detailseite
404 ohne Katalogsichtbarkeit · kein Sammelknopf, kein Besitzsiegel · USK wird
bei einem Spiel angezeigt und nie geraten · `/shop` zeigt ein freigegebenes
Portal und kein nicht freigegebenes · Figurenangebote unverändert (die
bestehende Suite muss grün bleiben, ohne angefasst zu werden).

---

## 3. Checkout und Bestellung

**Hier ist nichts zu bauen.** Geprüft wurde, dass alles typneutral ist:

| Schritt | Zubehörtauglich, weil |
|---|---|
| Verfügbarkeit | `shop_quantity_available()` fragt das neue Tor |
| Warenkorbprüfung | dieselbe Funktion |
| Bestellung anlegen | `create_order()` fragt das neue Tor, Name und Bild aus `skylanders` |
| Reservierung | `reserve_for_order()` fragt das neue Tor unter Zeilensperre |
| Lagerabgang | `apply_inventory_movement()` über `inventory_id` |
| Storno, Retoure, Erstattung | über `order_lines`, kein Artikeltyp |
| Rechnung | aus der unveränderlichen Bestellzeile |

**Eine Sache ist zu prüfen, nicht zu ändern:** ob die Versandkostenregel für
ein Portal (schwerer, größer) stimmt. Das ist eine **Preisfrage des
Betreibers**, keine technische — die Regel kennt heute nur Deutschland und
eine Freigrenze.

**Die Belegausstellung bleibt gesperrt.** Nichts in diesem Plan berührt sie.

---

## 4. Reihenfolge

| # | Schritt | Voraussetzung |
|---|---|---|
| 1 | `0139_preflight.sql` → `0139` → `0139_postflight.sql` auf **Staging** | Freigabe des Betreibers |
| 2 | `0140` auf Staging (Betriebssicherung) | Schritt 1 |
| 3 | Lageroberfläche (Abschnitt 1) | Schritt 1 |
| 4 | **Ein Portal** freigeben, bepreisen — und im Katalog ansehen | Schritt 3 |
| 5 | Detailseite, Kachel, `/shop` (Abschnitt 2) | Schritt 4 |
| 6 | Der Durchstich: kaufen, bezahlen, stornieren — auf Staging | Schritt 5 |
| 7 | USK erfassen, dann Spiele | `docs/LEGAL.md`, Abschnitt 8b |
| 8 | Production | eigene Freigabe |

**Schritt 3 beginnt nicht vor Schritt 1.**
