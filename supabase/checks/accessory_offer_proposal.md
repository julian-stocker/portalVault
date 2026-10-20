# Zubehör anbieten und verkaufen — Architektur, Auswirkungen, Vorschlag

**Status:** Vorschlag, **nichts davon ist umgesetzt.** Keine Migration
geschrieben, keine Funktion geändert, kein Angebot entstanden. Diese Datei
beantwortet die Frage „kann Zubehör künftig wie eine Figur angeboten
werden?" — mit dem, was im Code steht, und mit dem, was vorher entschieden
werden muss.

**Vorarbeit:** `supabase/checks/accessory_offer_readonly.sql` (rein lesend,
plangeprüft, **noch nicht gefahren**). Sie misst die eine Zahl, auf die es
ankommt — siehe Abschnitt 3.

---

## 1. Die Angebotsarchitektur, wie sie heute ist

Die gute Nachricht zuerst: **es gibt genau EINE Stelle, an der entschieden
wird, ob ein Artikel verkauft werden darf.**

```
public.is_shop_eligible(sky_id)   -- 0008, zuletzt 0135
   aktiv  ∧  catalog_visible  ∧  item_type = 'figure'
          ∧  Kategorie nicht in non_collectible_categories()
```

Und jede Tür fragt sie:

| Tür | Funktion | Migration |
|---|---|---|
| öffentliche Angebotsprojektion | `shop_offers()` | `0029` |
| Verfügbarkeitsprüfung | `shop_quantity_available()` | `0028`, `0040` |
| Warenkorbprüfung | `cart_*` | `0010`, `0011` |
| **Bestellung anlegen** | `create_order()` | `0010` → `0040` |
| Betriebsansicht „verkäuflich" | `seller_inventory_listing()` | `0041` |

Das heißt für den Auftrag „die bestehende Angebotsarchitektur
wiederverwenden, keine zweite Angebotsverwaltung": **sie ist schon so
gebaut.** Es braucht keine Zubehör-Angebotstabelle, keine zweite
Projektion und keine zweite Preisregel. Zubehör anzubieten heißt, **ein
Prädikat zu ändern** — und sonst nichts.

Das ist zugleich die schlechte Nachricht.

### Was NICHT fragt: `set_shop_listing()`

`set_shop_listing()` (`0108`) prüft nur, dass die SKY-ID existiert und die
Beschaffenheit `loose` ist. **Es prüft die Shop-Eignung nicht.** Der Betrieb
kann für ein Spiel also schon heute einen Verkaufspreis setzen und
`is_listed = true` schreiben; es erscheint nur nirgends. Das ist bewusst so
(`docs/DATABASE.md`, „Freigabe ist nicht das Tor") — und es ist der Grund für
den nächsten Abschnitt.

---

## 2. Warum eine Lockerung am Artikeltyp der falsche Griff wäre

Der naheliegende Eingriff ist eine Zeile:

```sql
-- NICHT VORGESCHLAGEN
and s.item_type in ('figure', 'game', 'portal')
```

Was dabei passierte, steht schon in der Datenbank:

* **13 Lagerzeilen hängen an Spielen, mit 19 Stück — und alle tragen
  `is_listed = true`** (`docs/SKYLANDERS_DATA.md`, Abschnitt „Spiele: im
  Katalog, im Lager, im Verkauf — und nicht im Shop").
* Alle 39 Spiele sind `is_active` und `catalog_visible`.
* Die 21 Portale sind seit dem 2026-10-20 ebenfalls öffentlich sichtbar.

Es fehlt also **nur noch der Preis**, und den liefert `shop_price()` aus
zwei Quellen: einem gesetzten `sale_price` **oder** `market_price ×
Prozentsatz`. Wo eine der beiden steht, entstünde das Angebot **im selben
Augenblick** — ohne Knopfdruck, ohne Freigabeschritt, ohne dass jemand
„verkaufen" gesagt hätte.

**Das ist genau das, was der Betreiber bei der Katalogfreigabe ausdrücklich
nicht wollte:** keine pauschale Freigabe, sondern ein gezielter,
nachprüfbarer Schritt je Artikel. Dieselbe Haltung gehört an diese Tür.

> **Zweiter Grund gegen den Typ als Schalter:** er ist nicht umkehrbar ohne
> Kollateralschaden. Ein Artikeltyp beschreibt, *was etwas ist*. Ihn zur
> Verkaufserlaubnis zu machen, legt zwei unabhängige Eigenschaften wieder
> zusammen, die ADR-0128 gerade getrennt hat.

---

## 3. Die eine Messung, die vor jeder Entscheidung steht

`supabase/checks/accessory_offer_readonly.sql`, ein einziges `SELECT`,
in `begin … rollback`. Sie bildet die vier Bedingungen von `shop_offers()`
nach und ersetzt nur die Katalogeignung durch die hypothetische Regel:

| Zeile | Frage |
|---|---|
| 201–205 | der heutige Zustand: **256** Angebote, Abdruck `4d1d6c30…`, **0** davon Zubehör |
| 302–304 | wie viele Zubehör-Lagerzeilen gelistet, in `loose`, auf sichtbarem Artikel sind |
| **305** | **wie viele davon SOFORT Angebot würden — mit Preis, ohne weiteren Schritt** |
| 306 | und zwar welche SKY-IDs, mit Art und Preis |
| 401–403 | woher der Preis käme: eigener `sale_price`, Marktpreis, oder gar nicht |
| 501–503 | die Portale getrennt — **0** Lagerzeilen, also ohnehin kein Angebot |
| 601–602 | was außerhalb des Shops längst gehandelt wird (Orderbuch) |

**Ist 305 größer als null, ist jede Lockerung ohne zusätzlichen Riegel eine
Veröffentlichung.** Ist sie null, ist sie es morgen trotzdem, sobald der
Betrieb einem Spiel einen Preis gibt.

Der Lauf gehört in den SQL-Editor des Staging-Projekts; die Datei ist
plangeprüft (`npm run verify:check-sql`), aber **noch nicht gefahren**.

---

## 4. Der Vorschlag: eine Freigabe je Artikel, wie bei der Sichtbarkeit

Genau die Form, die sich bei `catalog_visible` bewährt hat — eine
redaktionelle Spalte, Vorgabe „nein", geschrieben durch eine Adminfunktion
mit Protokolleintrag.

### 4a. Eine Spalte

```sql
alter table public.skylanders
  add column shop_released boolean not null default false;
```

`not null default false` heißt: **alle 626 Zeilen stehen am Tag danach auf
„nicht freigegeben", und nichts ändert sich.** Für Figuren ist die Spalte
ohne Wirkung (siehe 4b).

### 4b. Das Prädikat bekommt einen ODER-Zweig, keinen neuen Typ

```sql
and (s.item_type = 'figure' or s.shop_released)
```

* **Für Figuren ändert sich nichts** — der linke Zweig trifft wie bisher,
  die 534 shopfähigen Zeilen bleiben 534, der Abdruck `4d1d6c30…` bleibt
  stehen. Das ist im Postflight beweisbar, genau wie bei `0135`.
* **Für Zubehör ändert sich nichts**, bis jemand `shop_released` setzt.
* Die Kategorieregel (`non_collectible_categories()`) bleibt unberührt.
  Sammelbarkeit und Verkäuflichkeit bleiben getrennt — ein freigegebenes
  Spiel wird dadurch **nicht** sammelbar.

### 4c. Eine Adminfunktion, nach dem Muster von `admin_set_catalog_visible()`

```sql
admin_set_shop_released(p_sky_id text, p_released boolean)
```

Prüft `is_admin()` in der Datenbank, schreibt die Spalte, schreibt einen
Eintrag in `catalog_admin_changes`. **Lehnt `item_type = 'figure'` ab** — für
Figuren ist die Spalte bedeutungslos, und eine Wahl ohne Wirkung ist eine
Falle.

### 4d. Die Betriebsansicht muss mitziehen

`seller_inventory_listing()` (`0041`) liefert neben der Eignung einen Grund,
und der Grund wird **unabhängig** vom Prädikat berechnet. Nach der Änderung
sagte er für ein freigegebenes Spiel weiterhin `'not a collectible'`,
während die Eignung `true` meldet. **Dieser Widerspruch gehört in dieselbe
Migration**: der Grund bekommt einen Zweig `'not released for sale'` und
hört auf, „nicht sammelbar" als Verkaufshindernis zu nennen.

### 4e. Was die Oberfläche dann schon kann

Nichts davon braucht neuen Anwendungscode:

* `/zubehoer` liest seit heute `fetchOffers()` — **dieselbe Projektion** wie
  Shop und Figurenkatalog. Jede Kachel hat ihre Angebotsstelle und sagt
  heute „Aktuell kein Angebot". Wird ein Artikel freigegeben und bepreist,
  füllt sie sich von selbst.
* Was die Kachel **nicht** hat, ist ein Kaufknopf. Der ist ein eigener,
  bewusster Schritt und steht nicht in diesem Vorschlag
  (`accessory-area.test.ts` hält das fest).
* Lager, Bewegungen und Einkaufshistorie sind für Zubehör seit `0137` /
  `0138` vollständig — es fehlt nichts auf der Bestandsseite.

---

## 5. Was NICHT technisch ist — und vor der Migration entschieden gehört

### 5a. Privat- und gewerbliche Verkäufer: das ist der Marketplace-Stopp

Der Wunsch nennt „später private und gewerbliche Verkäufer". Das ist
**ADR-0021** und die Single-Seller-Regel aus `CLAUDE.md`: kein `seller_id`,
keine sellerbezogenen Bestandsstrukturen, keine Multi-Seller-Bestellungen,
kein Seller-Onboarding — **auch nicht konzeptionell, auch nicht „nur das
Datenmodell".**

Der Vorschlag oben ist deshalb bewusst **einverkäuferisch**: `shop_released`
ist eine Eigenschaft des Artikels, keine Beziehung zu einem Verkäufer.
Mehrere Verkäufer sind eine eigene, große Entscheidung und werden hier nicht
vorbereitet. **Das ist eine Einschränkung des Vorschlags, keine Lücke.**

### 5b. Alterskennzeichnung bei Spielen

Skylanders-Titel tragen eine USK-Kennzeichnung. Beim Fernabsatz von
Bildträgern muss die Kennzeichnung **in der Artikelbeschreibung erkennbar**
sein. Im Katalog steht sie heute nirgends — es gibt keine Spalte dafür und
keine Quelle in der Arbeitsmappe. **Vor dem ersten Spieleverkauf braucht es
also entweder eine gepflegte Angabe je Titel oder die Entscheidung, zunächst
nur Portale freizugeben** (die sind Zubehör ohne Inhalt und tragen keine
Kennzeichnung).

> Portale sind damit der **einfachere erste Schritt** — und sie haben heute
> ohnehin keinen Bestand, also ist nichts eilig.

### 5c. Steuer und Widerruf

Beides ist nach erstem Augenschein **dasselbe wie bei Figuren** — derselbe
Verkäufer, dieselbe Rechtsform, gebrauchte Ware, 14 Tage Widerruf (die
Ausnahme für versiegelte Software greift bei loser Ware nicht). Trotzdem
gilt: **das ist keine steuerliche Beratung.** Ob die bestehende
Besteuerungsart unverändert auf Software anwendbar ist, bestätigt der
Betreiber oder sein Steuerberater, bevor etwas freigegeben wird.
`docs/LEGAL.md` ist dann entsprechend zu ergänzen.

### 5d. Was „loose" bei einem Spiel heißt

`v1_sale_condition()` liefert konstant `'loose'`, und `0108` erzwingt eine
Lagerzeile je Artikel in dieser Beschaffenheit. Für eine Figur ist „lose"
eindeutig. Für ein Spiel ist es das nicht — Disc ohne Hülle? mit Hülle, ohne
Anleitung? Entweder bekommt das Wort für Zubehör eine schriftliche
Bedeutung, oder die Beschaffenheiten werden erweitert — und **Letzteres
berührt `0108`, `0028`, `0029` und `create_order()`** und ist deutlich
teurer. **Empfehlung: das Wort festlegen, die Vokabel nicht anfassen.**

### 5e. Keine erfundene Plattformkompatibilität

Bei Portalen wird die Plattform **nicht** angezeigt, weil sie nirgends
gespeichert ist (ADR-0128). Wird ein Portal verkauft, ist eine
Kompatibilitätsangabe eine **zugesicherte Eigenschaft**. Sie darf erst
entstehen, wenn sie gepflegt ist — nicht abgeleitet, nicht geraten.

---

## 6. Der vorgeschlagene Weg, in der Reihenfolge

| # | Schritt | Art | Wer |
|---|---|---|---|
| 1 | `accessory_offer_readonly.sql` auf Staging fahren | rein lesend | Betreiber, SQL-Editor |
| 2 | 5a–5e entscheiden; `docs/LEGAL.md` und ADR-0128 fortschreiben | Entscheidung | Betreiber |
| 3 | `0139` schreiben: Spalte, Prädikat, Adminfunktion, Grundzweig — mit Preflight, Postflight, Rollback | Migration, **unangewendet** | später |
| 4 | Probelauf gegen echtes PostgreSQL (`verify:check-sql`), Beweis: **534 bleibt 534, `4d1d6c30…` bleibt stehen** | lesend | später |
| 5 | auf Staging anwenden, einen Artikel freigeben, bepreisen, im Katalog ansehen | Staging | Betreiber |
| 6 | Kaufknopf auf der Zubehörkachel | eigene Aufgabe | später |

**Schritt 3 beginnt nicht, bevor Schritt 2 entschieden ist.** Der
Unterschied zwischen „darf im Schaufenster stehen" und „darf verkauft
werden" ist keine Frage des Datenmodells.
