# Handprobe `/business/inventory` nach `0141` — ohne etwas freizugeben

**Angemeldet mit dem Geschäftskonto. Lesen, hinsehen, nichts bestätigen.**
Jeder Schritt unten ist ein Blick; der einzige Knopf, der etwas freigibt, ist
ausdrücklich benannt und wird **nicht** gedrückt.

---

## Vorab: was überhaupt freigeben KANN

Nur `seller_set_sale_release(sky_id, condition, true)`, und sie lehnt ab,
solange eine der Bedingungen fehlt: Betriebsrolle · nicht `null` · Position
existiert · **keine Figur** · Artikeltyp `game` oder `portal` · bei Spielen
eine **USK-Kennzeichnung** · **nicht USK 18** · ein **Lieferumfang** · ein
**wirksamer Preis**. Heute ist auf Production nichts davon gesetzt: 0 USK, 0
Lieferumfänge, 0 Freigaben. **Ein einzelner Fehlklick kann also nichts
freigeben** — es fehlen zwei weitere Angaben, und die Funktion prüft sie.

Das ist die Zusicherung, mit der du hineingehen kannst. Trotzdem gilt unten:
Hände weg vom Freigabeknopf.

---

## 1. Die Seite lädt, und die Lagerübersicht ist unverändert

`https://skyisles.app/business/inventory`

| ☐ | |
|---|---|
| ☐ | Die Seite lädt ohne Fehlerbanner |
| ☐ | Die Figurenpositionen sehen aus wie vorher — Zustand, Menge, Preis, Listung. `0141` erweitert `admin_shop_inventory()` **nicht**, hier darf sich nichts geändert haben |
| ☐ | Die Zahl der Positionen ist **306** |

**Wenn die Seite leer bleibt oder ein Fehler erscheint:** melden, nichts
anklicken. Dann antwortet `seller_sale_state()` nicht wie erwartet, und das
wäre der einzige Weg, auf dem `0141` etwas kaputt machen könnte.

## 2. Bei einer FIGURENposition darf keine Verkaufssteuerung stehen

Eine beliebige Figurenposition aufsuchen (z. B. eine der 287 gelisteten).

| ☐ | |
|---|---|
| ☐ | **Kein** Lieferumfang-Auswahlfeld |
| ☐ | **Keine** USK-Auswahl |
| ☐ | **Kein** Freigabeknopf |

Für Figuren entscheidet `is_shop_eligible()` wie seit `0008`; eine Freigabe
gibt es dort nicht, und ein Schalter, der nichts tut, wäre eine Falle.

## 3. Bei einem SPIEL erscheinen jetzt drei Dinge

Eine der **13** Lagerpositionen auf Spiele aufsuchen (sie sind gelistet, aber
nicht verkäuflich).

| ☐ | |
|---|---|
| ☐ | Ein **Lieferumfang**-Auswahlfeld mit den drei Spielwerten (nur Medium · Medium und Anleitung · Medium mit Originalhülle) |
| ☐ | Eine **USK**-Auswahl mit `0, 6, 12, 16, 18` |
| ☐ | Ein **Freigabeknopf** — **nicht drücken** |
| ☐ | Eine **Begründungszeile**, die sagt, was noch fehlt (z. B. „USK-Kennzeichnung fehlt") |

Die Begründung kommt aus derselben Gründeleiter, die auch die Datenbank
benutzt (`admin_shop_listing_audit()`, aus `0139`) — sie wird gejoint, nicht
nachgerechnet. Steht dort etwas anderes als „fehlt noch", bitte melden.

## 4. Bei einem PORTAL dasselbe, ohne USK

Ein Portal ist über die Lagerübersicht nur erreichbar, wenn es eine
Lagerposition hat. Heute hat keines eine — die 21 Portale sind Katalogzeilen
ohne Bestand. **Dieser Punkt ist also voraussichtlich nicht prüfbar**, und
das ist richtig: ein Portal ohne Bestand hat keine Position, und ohne
Position gibt es nichts freizugeben.

| ☐ | Wenn doch eines auftaucht: Lieferumfang mit den **zwei** Portalwerten, **keine** USK-Auswahl, Freigabeknopf — **nicht drücken** |

## 5. Zum Schluss: es ist nichts passiert

Nach dem Durchsehen, von außen (jeder Rechner, keine Anmeldung nötig):

```bash
npm run verify:shop:prod
```

| ☐ | |
|---|---|
| ☐ | **287** Angebote |
| ☐ | `publicly visible accessories  Spiele=39` — **kein** Portal, **kein** Angebot auf ein Spiel |
| ☐ | 306 Positionen · 293 verkäuflich · 287 freigegeben · 6 Opt-outs · 13 nicht sammelbar |

Und falls du im SQL-Editor nachsehen willst:
`supabase/operations/prod-s-postflight-0141.sql` nochmals fahren — Zeilen
201 bis 205 müssen weiter fünfmal `0` zeigen.

---

## Wenn du später wirklich etwas freigeben willst

Die Reihenfolge ist durch die Ablehnungsgründe vorgegeben, und sie ist kein
Zufall:

1. **USK erfassen** (nur Spiele) — `admin_set_usk_rating()`, Plattformadmin.
2. **Lieferumfang setzen** — was wirklich im Paket liegt.
3. **Preis sicherstellen** — eigener Verkaufspreis oder wirksamer Marktpreis.
4. **Erst dann freigeben.**

Nach der Freigabe erscheint die Position im Shop und auf `/zubehoer/<slug>`,
und der Lagerabdruck `01e50b9d727a0486ff1ea0eb6ba2dd56` ändert sich — er
trägt `sale_released` mit. Das ist dann eine gewollte Änderung und kein
Befund. **Vorher bitte eine neue Bezugszahl festhalten**, sonst meldet die
nächste Prüfung eine Abweichung, die eine Entscheidung war.
