# Preflight `0142` meldet vier Abweichungen — Ursache und Vorschlag

**Stand 2026-10-25.** `0142` bleibt gesperrt. Nichts ausgeführt, nichts
geändert, keine Sollwerte stillschweigend nachgezogen.

---

## 1. Was gemeldet wurde

| Zeile | | erwartet | tatsächlich | Differenz |
|---|---|---|---|---|
| 301 | öffentliche Angebote | 287 | **307** | +20 |
| 302 | Angebots-Abdruck | `9b8341058b…` | `1116f423b2…` | — |
| 305 | Lagerzeilen | 306 | **337** | +31 |
| 307 | Lager-Abdruck | `01e50b9d72…` | `ac62508ef1…` | — |

Unverändert: Katalogzeilen **624**, shopfähige **531**, sammelbare **531**,
der Abdruck der Betriebssicherung, die Belegsperre. Alle übrigen Prüfungen
bestanden.

---

## 2. Woher die Sollwerte stammen und wann sie erfasst wurden

Die sieben Bezugszahlen stehen in `supabase/checks/0142_preflight.sql` in der
CTE `z0`, Spalte `production`. Sie sind **nicht** aus Production gelesen,
als ich die Datei schrieb (2026-10-24), sondern **aus
`0141_preflight.sql` übernommen** — und dort stammen sie aus der
Nachkontrolle zu `0141`, gemessen am **2026-10-21** und an diesem Tag vom
Betreiber bestätigt.

Der Kommentar in der Datei sagt genau das, und er sagt auch, was bei einer
Abweichung los ist:

> *„Die PRODUCTION-Spalte ist der Stand nach `0141`, gemessen am 2026-10-21
> und vom Betreiber im Postflight zu `0141` bestaetigt. Seit diesem Tag ist
> auf Production keine Migration gelaufen; weicht hier etwas ab, hat sich der
> BETRIEB bewegt (ein Preis, eine Listung, ein Verkauf) und nicht das
> Schema."*

**Die Werte sind also vier Tage alt, und die Datei hat diesen Fall
vorhergesagt.** Was sie falsch gemacht hat, steht in Abschnitt 4.

---

## 3. Sind die vier Abweichungen mit normalem Shop-Betrieb vereinbar?

**Ja — und zwar auffällig genau.** Drei Beobachtungen zusammen:

**a) Der Katalog ist unverändert.** 624 Zeilen, 531 shopfähig, 531
sammelbar. Es ist also **keine** Katalogzeile dazugekommen, keine
Sichtbarkeit geändert, kein `item_type` verschoben. Jede neue Lagerzeile
zeigt auf eine Figur, die am 2026-10-21 schon im Katalog stand.

**b) Nur Lager und Angebote sind gewachsen, und in der richtigen Richtung.**
+31 Lagerzeilen, +20 Angebote. Beides nach oben. Ein Fehler in einer
Projektion oder eine verlorene Zeile sähe anders aus — dann wären Zahlen
*gesunken* oder der Katalog hätte mitgewandert.

**c) Das Verhältnis passt zur Mechanik.** Seit `0139` gibt `shop_offers()`
**eine Zeile je Lagerzeile** zurück, gefiltert auf: gelistet · lose
(`v1_sale_condition()`) · `is_position_sellable()` · Preis vorhanden. Von 31
neuen Lagerzeilen erfüllen 20 alle vier Bedingungen, 11 nicht — eine
eingebuchte Position ohne Preis oder noch nicht gelistet ist genau der
Normalfall nach einem Wareneingang.

**Das Bild ist: Ware gekauft, eingebucht, ein Teil davon gelistet.** Also der
Vorgang, für den dieses System gebaut ist.

### Was ich daraus NICHT folgere

Dass es „plausibel aussieht", ist kein Nachweis. Drei Dinge wären mit
derselben Zahlendifferenz vereinbar und wären ein echtes Problem:

1. **Alte Zeilen sind verschwunden** und mehr neue dazugekommen — die Summe
   verschleiert es. (337 = 300 alte + 37 neue sähe von außen gleich aus.)
2. **Alte Angebote wurden still abgemeldet**, während neue dazukamen.
3. **Lagerzeilen sind ohne Buchung entstanden** — also nicht über den
   Wareneingang, sondern irgendwie sonst.

Genau diese drei prüft die Datei in Abschnitt 6. **Bis sie gelaufen ist, ist
die Ursache nicht geklärt, sondern nur wahrscheinlich.**

---

## 4. Sollte der Preflight zwischen Struktur und Geschäftsdaten
unterscheiden?

**Ja. Und dass er es nicht tut, ist der eigentliche Fehler — mein Fehler.**

Sieh dir an, was in `0142_preflight.sql` **blockierend** ist und was nicht:

| Zeilen | Was | Art | Veränderlich? |
|---|---|---|---|
| 101–105 | `auth.users`, `purchases`, `set_updated_at()`, `gen_random_uuid()`, `non_collectible_categories()` | **Struktur** | nein |
| 110–112 | `purchase_calculations` fehlt noch, kein Index-/Richtlinienrest | **Struktur** | nein |
| 301–307 | Angebote, Abdruck, shopfähig, sammelbar, Lagerzeilen, Katalogzeilen, Lagerabdruck | **Geschäftsdaten** | **ja, täglich** |
| 311–312, 401–402 | nichts freigegeben, Belegsperre | **Invariante** | nein (soll sich nie bewegen) |

**Keiner der sieben Werte in 301–307 ist eine Voraussetzung für `0142`.** Die
Migration legt eine Tabelle an, die mit Angeboten und Lager nichts zu tun
hat. Die sieben stehen dort aus einem anderen Grund: damit die Nachkontrolle
ein **Vorher** hat, gegen das sie vergleichen kann.

Für `0139`, `0140` und `0141` war die blockierende Konstante richtig — diese
Migrationen *haben* Angebote, Lager und Katalog angefasst, „unverändert" war
dort die Aussage, auf die es ankam. Für `0142` habe ich das Muster
übernommen, **ohne neu zu prüfen, ob es noch passt.** Das Ergebnis ist ein
Preflight, der ein Release blockiert, weil der Shop Geschäfte gemacht hat.

> **Die Invariante, die wirklich zählt, heißt nicht „gleich 287", sondern
> „nach der Migration dasselbe wie vorher".** Eine Konstante vom 21. Oktober
> kann das nicht ausdrücken. Ein Vergleich Preflight ↔ Postflight kann es.

---

## 5. Zeigen die Abdrücke ein Problem — oder nur einen veralteten Stand?

**Hier nur einen veralteten Stand, und sie können im Moment gar nichts
anderes zeigen.**

Beide Abdrücke sind ein **einziger md5 über die ganze Liste**:

- `angebote_md5` über `sky_id|condition|price` aller Angebote
- `lager_md5` über `id|is_listed|sale_price|sale_released` aller Lagerzeilen

Eine einzige zusätzliche Zeile ändert ihn vollständig. Da die Zeilenzahlen
nachweislich gewachsen sind, **mussten** beide Abdrücke sich ändern — sie
tragen hier also **keine Information über die Counts hinaus.**

Informativ wären sie im umgekehrten Fall: **Zahl gleich, Abdruck anders.**
Das hieße, bei gleichbleibender Zeilenzahl hat sich ein Preis, eine Listung
oder eine Freigabe bewegt. Dieser Fall ist hier nicht eingetreten.

**Und was ein md5 grundsätzlich nicht kann:** sich aufschlüsseln. Er sagt
„etwas ist anders", niemals „dieser Preis ist anders". Ob an einer **alten**
Zeile ein Preis bewegt wurde, lässt sich daraus nicht lesen — dafür gibt es
`shop_inventory.updated_at`, und die Diagnosedatei fragt ihn (Zeilen
301–304).

**Eine Grenze, die ich ausdrücklich nenne:** für Preise und Listungen führt
dieses Projekt **kein Journal**. `inventory_movements` protokolliert Mengen,
nicht Preise. „Welcher Preis wurde wann von wem geändert" ist auf Production
heute nicht beantwortbar — nur „diese Zeile wurde nach dem 21.10. angefasst".
Das steht so auch in der Diagnosedatei, damit die Lücke nicht als Freispruch
gelesen wird.

---

## 6. Die Datei, die du fahren kannst

```
supabase/operations/prod-s-baseline-drift.sql
```

Vollständig markieren, in den SQL-Editor des Production-Projekts, ausführen.
**Rein lesend** (`begin … rollback`), mit demselben Production-Riegel
A1/A2/A3 wie die übrigen Dateien, und sie wendet `0142` **nicht** an. Gegen
echtes PostgreSQL probegeplant (67 Dateien, 0 Fehler).

**Drei Zeilen blockieren, und nur drei:**

| | | rot heißt |
|---|---|---|
| **101** | Lagerzeilen von vor der Grenze = **306** | **Datenverlust** — alte Zeilen sind fort |
| **111** | Angebote auf alten Lagerzeilen = **287** | ein altes Angebot wurde **still abgemeldet** |
| **201** | neue Lagerzeilen ohne Bewegung = **0** | eine Zeile ist **ohne Buchung** entstanden |

Dazu blockierend, was sich nie bewegen darf: Katalog 624, shopfähig 531,
sammelbar 531, Zubehör im Angebot 0, Freigaben 0, Belegsperre.

**Alles andere ist Auskunft ohne Sollwert** — unter anderem:

- **Zeile 11 und 12:** Lagerzeilen und Bewegungen **tagweise**, letzte 21
  Tage. Daran ist zu sehen, ob die Grenze (22.10., 00:00 Berliner Zeit)
  richtig liegt. Stehen Einträge am 21.10., ist sie um einen Tag zu spät —
  dann in der CTE `grenze` auf `'2026-10-21 00:00'` setzen und erneut fahren.
- **Zeile 202–205:** Bewegungen je Grund mit Summen, eingebuchte Stück, wie
  viele neue Zeilen an einem **Einkauf** hängen, und wie viele Einkäufe es
  seit der Grenze gab. Das ist die Herkunftskette.
- **Zeile 301–304:** welche **alten** Zeilen seit der Grenze angefasst wurden
  — die Umpreis-/Umlistungsmenge.
- **Zeile 900:** der heutige Zustand als **eine Zeichenkette**, in der
  Reihenfolge des Z0-Vertrags.

**Die erwartete Lesart, falls es gewöhnlicher Betrieb war:** 101 = 306,
111 = 287, 201 = 0, 102 = 31, 112 = 20, und in Zeile 202 stehen
`purchase`-Bewegungen an einem oder zwei Tagen nach dem 21.10.

---

## 7. Wie wir einen neuen Ausgangszustand festhalten — der Vorschlag

Nicht „die vier Zahlen ersetzen". Sondern **die Art der Erwartung ändern**,
für beide Preflights und beide Nachkontrollen:

### Die Übergabe eines Vorher-Werts

**Im Preflight** werden die sieben Werte zu **Messungen** (`ok` ist NULL) —
sie blockieren nichts mehr. Stattdessen gibt der Preflight sie als **eine
Zeile** aus, so wie Zeile 900 der Diagnosedatei es schon tut:

```
307|1116f423b2156cf5f239e4e63e79242b|531|531|337|624|ac62508ef179efacef07cfc67d2e12ca
```

**In der Nachkontrolle** steht oben eine Zeile zum Einfügen:

```sql
select set_config('skyisles.base', '<die Zeile aus dem Preflight>', true);
```

Die Nachkontrolle spaltet die sieben Werte heraus und vergleicht sie mit dem
Zustand **nach** der Migration — **blockierend**. Fehlt die Zeile, ist das
eine blockierende Abweichung, genau wie ein fehlender Z0-Modus heute.

### Was das leistet

| | |
|---|---|
| Legitime Shop-Änderungen **vor** dem Release | blockieren nichts mehr — sie werden gemessen und weitergegeben |
| Eine Änderung **während** der Migration | blockiert, und zwar automatisch statt nach Augenmaß |
| Veraltete Konstanten im Repository | gibt es nicht mehr. Der Vergleichswert entsteht im Lauf |
| Die Frage „hat `0142` den Shop angefasst?" | wird zum ersten Mal wirklich beantwortet statt nur umrissen |

Heute beantwortet der Preflight eine andere Frage — „sieht Production aus
wie am 21. Oktober?" —, und die ist für `0142` belanglos.

### Was dafür zu ändern wäre

`0142_preflight.sql` · `0142_postflight.sql` · `0143_preflight.sql` ·
`0143_postflight.sql`, die vier Production-Hüllen neu erzeugt (sie betten
die Prüfdateien zeichenweise ein), und die Testgruppe, die den Hüllen heute
„kein Z0-Vertrag" bescheinigt. Überschaubar, aber kein Nebenbei — und es
berührt **keine** Migration, **keinen** Anwendungscode und **keine** Daten.

### Die Reihenfolge, die ich vorschlage

1. **`prod-s-baseline-drift.sql` fahren** und mir die Tabelle schicken.
2. Sind 101, 111 und 201 grün: **Ursache geklärt** — gewöhnlicher Betrieb,
   und die Zeile aus 900 ist ein geprüfter Ausgangszustand.
3. Dann baue ich die Übergabe aus Abschnitt 7 ein, auf dein Wort.
4. Preflight `0142` erneut fahren — er muss dann `9999 = 0` zeigen, **weil
   die Geschäftszahlen nicht mehr blockieren**, nicht weil jemand sie
   angeglichen hat.
5. Erst danach `0142`.

**Ist eine der drei Zeilen rot, ist `0142` nicht die nächste Frage.** Dann
ist der Shop die nächste Frage, und das Release wartet.
