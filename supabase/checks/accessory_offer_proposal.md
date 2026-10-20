# Spiele und Portale im eigenen Shop verkaufen — Bestandsaufnahme und Umsetzungsvorschlag

**Stand 2026-10-20.** Diese Datei ersetzt die erste Fassung vom selben Tag:
dort war die Frage „darf Zubehör überhaupt verkauft werden?" offen, hier ist
sie vom Betreiber **entschieden** — ja, über den eigenen SkyIsles-Shop, mit
gezielter Freigabe je Angebot.

**Umgesetzt ist noch nichts an der Datenbank.** Die Migration `0139` ist
geschrieben und **nicht angewendet**; Production ist unberührt; die
Belegausstellung bleibt gesperrt.

**Geprüft ist sie trotzdem.** `npm run verify:check-sql` fährt sie gegen
echtes PostgreSQL, Durchgänge **P34–P37**: sie veröffentlicht nichts — auch
nicht die gelistete, bepreiste Altlast —, eine freigegebene Portalposition
wird wirklich zum Angebot, ein freigegebenes Spiel **ohne** USK-Kennzeichnung
bleibt draußen, und die Freigabefunktion lehnt Figur, Spiel ohne USK und
unbekannte Position ab. Dazu `0139_preflight.sql` und `0139_postflight.sql`
sowie `supabase/rollback/R0139_drop_sale_release.sql`.

---

## Teil A — Bestandsaufnahme

### A1. Es gibt genau ein Tor, und vier Türen fragen es

```
public.is_shop_eligible(p_sky_id text)        -- 0008, zuletzt 0135
   is_active ∧ catalog_visible ∧ item_type = 'figure'
            ∧ Kategorie ∉ non_collectible_categories()
```

| Tür | Funktion | zuletzt definiert in |
|---|---|---|
| öffentliche Angebotsprojektion | `shop_offers()` | `0029` |
| Verfügbarkeit / Warenkorbmenge | `shop_quantity_available()` | `0028` |
| Bestellung anlegen | `create_order()` | `0040` |
| **letzte Prüfung unter Zeilensperre** | `reserve_for_order()` | `0010` |
| Betriebsdiagnose „verkäuflich" | `admin_shop_listing_audit()` | `0041` |

Alle vier Türen tragen **dieselbe Form**:

```sql
and i.is_listed
and i.condition = public.v1_sale_condition()
and public.is_shop_eligible(i.sky_id)
and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
```

**Das ist die gute Nachricht:** es braucht keine zweite Angebotsverwaltung,
keine Zubehörtabelle, keine zweite Preisregel und keinen zweiten Warenkorb.
Wer das Tor ändert, ändert alle Türen zugleich — **auch `create_order()`**.

### A2. Was Zubehör heute ausschließt — vollständig

| Ort | Ausschluss | Art |
|---|---|---|
| `is_shop_eligible()` (`0135`) | `item_type = 'figure'` | **Datenbank, hart** |
| `is_shop_eligible()` (`0006`/`0137`) | Kategorie in `non_collectible_categories()` — die fünf Zubehörkategorien stehen darin | **Datenbank, hart** |
| `shopEntries()` (`src/lib/shop/surface.ts`) | `isCollectible()` | Anwendung |
| `/shop` | liest `fetchCatalog()`, und das ist `collectibleOnly()` | Anwendung |
| `/skylanders/[slug]` | `isCollectible()` → **404** für jedes Zubehörteil | Anwendung |
| `isShopGoods()` (`src/lib/admin/inventory-model.ts`) | jede Zubehörposition ist „keine Shopware" — kein Preisfeld, kein Schalter | Anwendung |

**Zwei unabhängige Riegel in der Datenbank**, und beide müssen fallen; das
war `0137` ausdrücklich so gebaut.

### A3. Was Zubehör NICHT ausschließt — und das ist die Überraschung

| Ort | Verhalten |
|---|---|
| `set_shop_listing()` (`0108`) | prüft **nur**, dass die SKY-ID existiert und `condition = 'loose'` ist. **Fragt die Shop-Eignung nicht.** Der Betrieb kann für ein Spiel also schon heute Preis und `is_listed` setzen |
| `record_inventory_movement()` (`0108`) | bucht Zugang und Abgang für Zubehör wie für Figuren |
| `create_order()` Namens-/Bildschnappschuss | liest `skylanders` direkt — funktioniert für Zubehör unverändert |
| **Warenkorb** (`src/lib/cart/cart.ts`) | Identität ist `sky_id + condition` plus ein Anzeige-Schnappschuss. **Lädt den Katalog nie.** Er funktioniert für Zubehör, ohne dass eine Zeile geändert wird |
| Checkout, Zahlung, Bestellung, Lagerabgang, Storno, Erstattung | hängen alle an `order_lines.inventory_id`, nicht am Artikeltyp |

**Es gibt also keine Zubehör-Warenkorbarchitektur zu bauen.** Es gibt gar
keine zu bauen — die bestehende ist bereits typneutral.

### A4. Die Altlast ist schärfer als gedacht

Die 13 Lagerpositionen auf Spielen tragen `is_listed = true`. Bisher war
offen, ob sie auch einen Preis haben. **Sie haben einen — zwingend:**

```sql
constraint shop_inventory_listed_needs_price
  check (not is_listed or sale_price is not null)   -- 0003
```

`is_listed` ohne `sale_price` ist durch die Tabelle **verboten**. Die 13
Positionen sind damit gelistet **und** bepreist; es fehlt ihnen zur
Veröffentlichung ausschließlich das Tor.

> **Daraus folgt unmittelbar:** eine Lockerung am Artikeltyp wäre keine
> Vorbereitung, sondern die sofortige Veröffentlichung von 13 Spielen mit
> 19 Stück zu Preisen, die niemand für den öffentlichen Shop geprüft hat.
> Genau das darf nicht passieren — und genau deshalb reicht ein Schalter am
> **Katalogartikel** nicht.

---

## Teil B — Wo die Freigabe gespeichert wird

Die Frage aus Punkt 9, und sie hat eine klare Antwort: **an der
Lagerposition, nicht am Katalogartikel.** Die erste Fassung dieses Vorschlags
hatte `skylanders.shop_released` vorgeschlagen; das ist verworfen.

### B1. Warum nicht am Katalogartikel

* **Es wäre das falsche Korn.** Die 13 Altlastzeilen zeigen, dass die Gefahr
  an der Position wohnt: Preis, Menge, Listung und Beschaffenheit stehen
  dort. Ein Schalter am Artikel gäbe alle Positionen dieses Artikels auf
  einmal frei — heute eine, später beliebig viele.
* **Es wäre beim zweiten Händler im Weg.** `shop_inventory` ist genau die
  Zeile, die in einer späteren Marketplace-Architektur ein `seller_id`
  bekäme. Eine Freigabe dort ist **von Natur aus je Verkäufer**; eine
  Freigabe am Artikel müsste beim ersten fremden Händler migriert werden —
  zum denkbar schlechtesten Zeitpunkt.
* **Es widerspräche der eigenen Praxis.** `catalog_visible` gehört dem
  Katalog, `is_listed` und `sale_price` gehören der Position. Eine
  Verkaufsfreigabe ist eine Aussage über ein **Angebot**, nicht über einen
  Artikel.

> **Das ist Vorsorge, keine Marketplace-Implementierung.** Es entsteht kein
> `seller_id`, keine Seller-RLS, kein Onboarding, kein Stripe Connect, keine
> Provision (ADR-0021, `CLAUDE.md`). Die Freigabe sitzt lediglich auf der
> Zeile, die eine spätere Entscheidung ohnehin je Verkäufer führen würde.

### B2. Warum trotzdem zwei Ebenen

Eine Sache gehört **nicht** an die Position: ob der Artikel überhaupt diese
Art Ware ist und ob seine **Produktinformationen** vollständig sind. Eine
USK-Kennzeichnung ist eine Eigenschaft des Spiels, nicht einer Kiste im
Regal. Deshalb zwei Tore auf zwei Ebenen, jedes dort, wo seine Wahrheit
wohnt:

| Ebene | Tor | sagt |
|---|---|---|
| **Artikel** | `is_shop_eligible(sky_id)` | **unverändert** — die Figurenregel aus `0135`, Zeichen für Zeichen |
| **Position** | `is_position_sellable(inventory_id)` | **ruft** das obere für Figuren auf; für Zubehör verlangt es zusätzlich Art, Aktivität, Katalogsichtbarkeit, **USK bei Spielen** und die **ausdrückliche Freigabe dieser Position** |

**`is_shop_eligible()` wird nicht angefasst, und das ist der Kern des
Sicherheitsarguments.** Das neue Tor RUFT sie für den Figurenfall auf, statt
ihre Regel abzuschreiben. „Für Figuren ändert sich nichts" ist damit keine
Zusage, die jemand pflegen müsste, sondern eine Eigenschaft des Textes — und
534 bleibt 534, auch auf Artikelebene.

Die vier Türen fragen künftig **nur noch die Position**. Ein Tausch je Tür,
eine Regel an einem Ort.

---

## Teil C — Die Umsetzung

### C1. Migration `0139` — geschrieben, NICHT angewendet

```sql
alter table public.shop_inventory
  add column sale_released boolean not null default false;
alter table public.shop_inventory
  add column delivery_scope text;                   -- null = nicht angegeben

alter table public.skylanders
  add column usk_rating smallint;                   -- null = nicht erfasst
```

`not null default false` heißt: **alle 285 Lagerzeilen stehen am Tag danach
auf „nicht freigegeben"**, die 13 Altlastzeilen eingeschlossen. Es entsteht
kein einziges Angebot.

**Das Tor an der Position** ist das einzige neue Prädikat:

```sql
public.is_position_sellable(p_inventory_id bigint)
  -- FIGUR: unverändert, durch Aufruf statt durch Kopie
  is_shop_eligible(i.sky_id)
  -- ZUBEHÖR: sechs Bedingungen, alle neu
  or (s.item_type in ('game','portal')
      and s.is_active and s.catalog_visible
      and (s.item_type <> 'game' or s.usk_rating is not null)
      and i.delivery_scope is not null
      and i.sale_released)
```

**Vier Türen tauschen eine Zeile:** `is_shop_eligible(i.sky_id)` →
`is_position_sellable(i.id)`. Für Figuren ist das beweisbar dieselbe
Aussage — der Zweig `item_type = 'figure'` fordert nichts Neues.

**Der Beweis im Postflight:** `534` shopfähige Zeilen bleiben `534`, `256`
Angebote bleiben `256`, der Abdruck `4d1d6c30…` bleibt Zeichen für Zeichen
stehen, und **kein Zubehörteil** steht im Angebot. Dazu die schärfere
Prüfung: **Zeile für Zeile** antwortet jede der 285 Lagerpositionen am neuen
Tor genau so wie am alten — eine Figur, die herausfiele, und ein Zubehörteil,
das dazukäme, heben sich in einer Summe auf, hier nicht.

**Und ein Textvergleich im Test:** `accessory-sale.test.ts` nimmt jede der
vier Türen aus ihrer alten Migration, wendet die eine erlaubte Ersetzung an
und verlangt, dass das Zeichen für Zeichen die Fassung in `0139` ist. Eine
Bedingung, die beim Neuschreiben verrutscht, fällt damit auf.

**Zwei neue Betriebsfunktionen:**

| Funktion | tut | lehnt ab |
|---|---|---|
| `seller_set_sale_release(sky_id, condition, released)` | setzt `sale_released` an **einer** Position | eine **Figur** (dort ist der Schalter ohne Wirkung — und ein wirkungsloser Schalter ist eine Falle) · eine unbekannte Position · eine andere Beschaffenheit als die verkaufte · ein **Spiel ohne USK-Erfassung** · ein Spiel mit **USK 18** · eine Position **ohne Lieferumfang** |
| `seller_set_delivery_scope(sky_id, condition, scope)` | setzt, was geliefert wird | eine **Figur** · ein Vokabular, das nicht zur Artikelart passt · `disc_case` an einer losen Position |
| `admin_set_usk_rating(sky_id, rating)` | erfasst die Alterskennzeichnung | alles außer `0, 6, 12, 16, 18` · alles außer `item_type = 'game'` |

Die drei letzten Riegel von `seller_set_sale_release()` hängen an
`p_released`: das **Zurücknehmen** einer Freigabe bleibt immer möglich. Ein
Riegel, der das Abschalten verhindert, zeigt in die falsche Richtung.

**`admin_shop_listing_audit()` zieht mit:** der Grund wird heute unabhängig
vom Prädikat berechnet und sagte für ein freigegebenes Spiel weiterhin
„not a collectible". Er bekommt die Zweige `'usk rating missing'` und
`'not released for sale'`, und „nicht sammelbar" hört auf, ein
Verkaufshindernis zu sein.

### C2. Anwendungsseite

| Ort | Änderung |
|---|---|
| `/business/inventory` | für Zubehör: Preisfeld, Mengen, **Freigabeschalter** und ein Satz, **warum** eine Position noch nicht verkäuflich ist. Dieselbe Bedienung wie bei Figuren |
| `isShopGoods()` | aus „jede Zubehörposition ist keine Shopware" wird „Figur, oder freigegebene Zubehörposition" |
| `AccessoryCard` | nutzt die echte Angebotslogik — Preis bei Angebot, sonst unverändert „Aktuell kein Angebot" |
| **`/zubehoer/[slug]`** | **neu**: die Detailseite eines Zubehörteils, mit `OfferPanel` und „In den Warenkorb". Die Kachel verlinkt dorthin, wie die Figurenkarte auf `/skylanders/<slug>#angebote` |
| `/shop` | nimmt freigegebene Zubehörangebote auf — dieselbe Seite, dieselbe `shopEntries()`-Regel, erweitert um Zubehör |
| Warenkorb, Checkout, Zahlung, Bestellung, Storno, Erstattung | **keine Änderung.** Sie sind bereits typneutral (A3) |

**Warum eine Detailseite und kein Kaufknopf auf der Kachel:** ein Angebot für
ein gebrauchtes Spiel muss Zustand, Lieferumfang, Plattform und
Alterskennzeichnung zeigen. Auf einer Kachel ist dafür kein Platz, und ein
Kauf ohne diese Angaben wäre genau der Fehler, den Punkt 5 ausschließt.

---

## Teil D — Rechtlich offen, vor jeder Freigabe zu entscheiden

Diese vier Punkte sind **nicht** technisch lösbar und werden deshalb
vorgelegt statt beantwortet.

### D1. USK — es gibt keine Datenquelle im Projekt

Die Arbeitsmappe führt **keine** Alterskennzeichnung, und sie wird **nicht
geraten** (`CLAUDE.md` Regel 4 und Punkt 5 des Auftrags). `0139` legt die
Spalte an und **verweigert die Freigabe jedes Spiels ohne Eintrag** — aber
die 39 Werte muss jemand erfassen.

**Zu entscheiden:** woher. Die Kennzeichnung steht auf jeder Hülle; die
USK-Titeldatenbank ist die amtliche Quelle. Beides ist Handarbeit des
Betreibers, keine Ableitung.

**Und ein zweiter Riegel kam dazu: USK 18 wird gar nicht freigegeben.**
§ 12 Abs. 3 JuSchG verlangt beim Versandhandel von Bildträgern „Keine
Jugendfreigabe" eine Altersprüfung bei der Bestellung **und** eine
Zustellung nur an Erwachsene. SkyIsles hat beides nicht. Für die
Skylanders-Titel (USK 0 und 6) ist die Sperre ohne praktische Wirkung —
genau deshalb kostet sie nichts und verhindert den einen Fall, der teuer
wäre. Kommt eine Altersverifikation, fällt der Block; eine Zeile, eine
eigene Entscheidung.

> **Folge, und sie ist beabsichtigt:** solange kein Spiel eine USK-Angabe
> trägt, ist **kein Spiel freigebbar**. Die **21 Portale sind es sofort** —
> ein Portal ist Hardware und trägt keine Alterskennzeichnung.

### D2. Zustand und Lieferumfang — ENTSCHIEDEN und gebaut (2026-10-20)

Der Betreiber hat festgelegt: **zwei getrennte Eigenschaften**, und
`condition` wird nicht umgedeutet. Für ein Spiel heißt `loose`
ausdrücklich *Spielmedium ohne Originalhülle*. Der Lieferumfang ist
**strukturiert**, aus einer festen Liste:

| Wert | Wort | für |
|---|---|---|
| `disc_only` | Nur Spielmedium | Spiel |
| `disc_manual` | Spielmedium mit Anleitung | Spiel |
| `disc_case` | Mit Originalhülle | Spiel |
| `portal_only` | Nur Portal | Portal |
| `portal_cable` | Portal mit USB-Kabel | Portal |

`shop_inventory.delivery_scope`, nullable, mit zwei CHECKs. `NULL` heißt
*nicht angegeben* — für eine Figur bleibt es dabei (dort beantwortet
`condition` die Frage), für Zubehör ist es ein **Verkaufshindernis**.
`shop_offers()` bekommt dafür eine **fünfte Spalte**; `shop_inventory.note`
bleibt intern und wird nicht angefasst.

> **Eine Konsequenz, benannt statt versteckt:** nach dieser Festlegung ist
> ein Spiel **mit** Originalhülle nicht `loose`, und V1 verkauft nur `loose`
> (`0028`/`0029`/`0108`). `disc_case` ist deshalb modelliert, wählbar und
> durch `shop_inventory_case_is_not_loose` gegen `loose` gesichert — aber
> **nicht verkäuflich**. Ob SkyIsles auch Spiele mit Hülle verkauft, ist
> eine eigene Produktentscheidung und steht nicht in `0139`.

**Für Portale** ist die sinnvolle Angabe das **USB-Kabel** — ohne das ein
kabelgebundenes Portal nicht benutzbar ist. Batterien werden bewusst **nicht**
genannt (siehe `docs/LEGAL.md`, 8b).

### D3. Steuer

Gleicher Verkäufer, gleiche Rechtsform, gebrauchte Ware. Nach erstem
Augenschein ändert sich nichts gegenüber Figuren. **Das ist keine
steuerliche Beratung** — die Bestätigung gehört dem Betreiber oder seinem
Steuerberater, und `docs/LEGAL.md` wird danach fortgeschrieben.

### D4. Widerruf

Die Ausnahme für **versiegelte** Datenträger (§ 312g Abs. 2 Nr. 6 BGB)
greift bei gebrauchter, offener Ware **nicht**. Es bleibt beim gewohnten
14-tägigen Widerruf — also unverändert zur Figur. Zu bestätigen, nicht zu
ändern.

---

## Teil E — Die Reihenfolge

| # | Schritt | Art | wer |
|---|---|---|---|
| 1 | `accessory_offer_readonly.sql` auf Staging fahren | rein lesend | Betreiber, SQL-Editor |
| 2 | `0139_preflight.sql` → `0139` → `0139_postflight.sql` auf **Staging** | Migration | Betreiber, SQL-Editor |
| 3 | Oberfläche: Lagerverwaltung, Kachel, Detailseite, `/shop` | Code | folgt nach Schritt 2 |
| 4 | **ein Portal** freigeben, bepreisen, kaufen, stornieren — der Durchstich | Staging | Betreiber |
| 5 | D1 entscheiden, USK erfassen, dann Spiele | Entscheidung | Betreiber |
| 6 | Production | Freigabe | Betreiber |

**Schritt 3 beginnt erst nach Schritt 2:** eine Oberfläche, die eine Spalte
liest, die es in der Datenbank nicht gibt, bringt `/business/inventory` zum
Absturz. Die Reihenfolge ist nicht Vorsicht, sondern Notwendigkeit.
