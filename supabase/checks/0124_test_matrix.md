# Testmatrix für die beiden Statusspalten — Staging

**Nichts hiervon habe ich ausgeführt.** Die SQL-Spalte sagt, was *Sie* tun
würden; sie ist keine Datei zum Draufklicken, und mehrere Zeilen darin
**verändern Staging-Daten**. Das ist gekennzeichnet.

---

## Was Staging schon hergibt, ohne eine Zeile anzulegen

Der Preflight (Datei 1, Zeilen 907–924) sagt es exakt. Nach dem Stand der
Eigenbeleg-Arbeiten gilt:

- Es gibt **einen** ausgestellten Beleg, `SI-E-2026-000001` — eine
  **Staging-Testreferenz**, keine Production-Belegnummer und keine
  personenbezogene Angabe.
- Es gibt **undatierte** Einkäufe (die `#REF!`-Gruppen aus `0058`).
- Es gibt **Testeinkäufe** (`is_test`).
- Es gibt Einkäufe **ohne** Absenderdaten — die große Mehrheit.

Damit sind **sieben von zehn** Fällen der Matrix ohne jede Datenänderung
prüfbar. Für die drei übrigen braucht es eine Änderung, und dafür gilt Ihre
Vorgabe: **ausschließlich fiktive personenbezogene Daten.**

---

## Spalte „Daten"

| # | Fall | Erwartung | Woher der Fall kommt |
|---|---|---|---|
| D1 | Testeinkauf | **grau ○**, Tooltip „Testeinkauf — bekommt keinen Beleg" | vorhanden |
| D2 | kein Kaufdatum | **grau ○**, „Kaufdatum fehlt" | vorhanden (`?jahr=ohne`) |
| D3 | keine Position | **grau ○**, „keine Position erfasst" | **anzulegen**: Einkauf nur mit Datum und Summe |
| D4 | mehrere Gründe gleichzeitig | grau, Tooltip nennt **alle**, nicht nur den ersten | D1 + D2 kombinieren: Testeinkauf ohne Datum |
| D5 | ausstellbar, kein Absender | **orange ◐**, „Eigenbeleg möglich, dokumentiert aber den Absender nicht" + „Absendername fehlt" + „Absenderanschrift fehlt" | vorhanden (fast jeder Einkauf) |
| D6 | Name da, Anschrift leer | orange, „Absenderanschrift fehlt" | **Änderung**: nur `sender_name` setzen |
| D7 | Name da, Anschrift **halb** | orange, „Absenderanschrift unvollständig (Straße, PLZ, Ort)" | **Änderung**: Name + Straße, PLZ und Ort leer |
| D8 | alles da | **grün ●**, „Absenderdaten vollständig — für einen Eigenbeleg ausreichend" | **Änderung**: Name + Straße + PLZ + Ort |
| D9 | grün, aber ohne Inserat und ohne Vereinbarung | **grün bleibt grün**, Tooltip ergänzt zwei Hinweiszeilen | D8 ohne `listing_*` und ohne `agreement_note` |
| D10 | grün, Land leer | **grün** — Land ist nicht grün-relevant | D8 ohne `sender_country` |

**Unter jedem dieser Tooltips, auch unter D8 und D10:** „Keine Aussage über
steuerliche oder rechtliche Anerkennung der Belegform." Wenn dieser Satz
fehlt, ist der Test nicht bestanden.

## Spalte „Beleg"

| # | Fall | Erwartung | Woher der Fall kommt |
|---|---|---|---|
| B1 | kein Beleg | **grau ○**, „Kein Eigenbeleg ausgestellt" | vorhanden |
| B2 | Beleg, Daten unverändert | **grün ●**, „SI-E-2026-000001 vom … — stimmt mit den aktuellen Einkaufsdaten überein" | vorhanden |
| B3 | Beleg, belegrelevantes Feld geändert | **orange ◐**, „Belegrelevante Daten haben sich seit der Ausstellung geändert" **und** „Der ausgestellte Beleg bleibt unverändert" | **Änderung** am Einkauf von B2 |
| B4 | Beleg, **interne Notiz** geändert | **grün bleibt grün** | `note` am Einkauf von B2 ändern |
| B5 | Beleg, Position **eingebucht** | **grün bleibt grün** | eine Position des Einkaufs von B2 einbuchen |
| B6 | Beleg, Anzeigename im Katalog geändert | **orange** — und das ist richtig, der gedruckte Name wäre ein anderer | `display_name_override` einer Figur aus diesem Einkauf in `/admin` ändern |
| B7 | Migration nicht angewendet | **`?`**, „Zustand nicht ermittelbar" + „Diese Datenbank liefert den Belegzustand nicht" | **vor** `0124`: Frontend lokal gegen Staging starten |

**B4 und B5 sind die beiden wichtigsten Tests der ganzen Matrix.** Sie
beweisen, dass der Fingerabdruck die richtigen Felder beobachtet: eine interne
Notiz und ein Lagervorgang dürfen keine Abweichung auslösen. Schlägt einer von
beiden an, stimmt etwas mit `purchase_receipt_fingerprint` nicht — und dann
**stoppen**, nicht die Spalte anpassen.

**B7 ist der Test, der ohne Migration läuft** und als einziger vorher gemacht
werden kann: `npm run dev:staging` gegen das noch nicht migrierte Staging. Beide
Spalten müssen `?` zeigen, nicht grau. Wenn die Belegspalte dort grau zeigt,
ist der Marker `status_known` nicht wirksam, und das ist der Fehler, den der
vierte Zustand verhindern soll.

**B8 — Fehler in der Vergleichsberechnung → `?`, nicht leeres Orderbuch.**
Dieser Fall ist der Grund, warum `purchase_receipt_stale` überhaupt existiert.
Er lässt sich **auf Staging nicht testen**: man müsste die
Fingerabdruck-Funktion ersetzen, und das verändert Staging — selbst in einer
zurückgerollten Transaktion hält die DDL bis zum `rollback` eine Sperre, an der
jede gleichzeitige Orderbuch-Abfrage hängt. Das Rezept liegt daher in
`0124_fingerprint_failure_isolated.sql` und gehört auf eine **leere Wegwerf-Instanz**
(Supabase-Branch, lokaler Stack, `docker run postgres`) mit den Migrationen
0001–0124. **Keine davon existiert hier, und die Datei ist nicht gelaufen.**

Maschinell abgedeckt ist stattdessen die *Struktur*:
`src/lib/orderbook/receipt-status.test.ts`, Abschnitt 7 — die Hülle ist
`stable`, `security definer`, `search_path=''`, gibt im Ausnahmezweig NULL und
weder `true` noch `false`, hat für niemanden EXECUTE, der Ledger ruft sie statt
des Fingerabdrucks, und NULL kommt im Frontend als `unknown` an. Das begründet
den Schutz; gemessen ist er nicht.

| # | Fall | Erwartung | Woher der Fall kommt |
|---|---|---|---|
| B8 | Fingerabdruck wirft eine Ausnahme | **`?`**, „Zustand nicht ermittelbar" — und die Tabelle zeigt **alle** Zeilen, Summen und Filter unverändert | **nur isoliert**: `0124_fingerprint_failure_isolated.sql` |

Fällt B8 durch — also schlägt der Ledger-Aufruf fehl statt NULL zu liefern —,
dann **stoppen**. Nicht die Spalte anpassen, nicht die Hülle nachbessern,
nicht `0124` auf Staging laufen lassen.

---

## Die Änderungen, die Sie dafür vornehmen — mit fiktiven Daten

Für D6–D8 und B3 brauchen Sie einen Einkauf, dessen Absenderdaten Sie
verändern. **Über die Oberfläche**, nicht über SQL: der (i)-Dialog hat seit
`0121` die Felder, und `seller_update_purchase` setzt sie einzeln.

Vorschlag für die fiktiven Werte — erkennbar erfunden, damit sie niemand für
echt hält:

```
Absendername     Erika Mustermann
Straße           Musterstraße 1
PLZ              12345
Ort              Musterstadt
Land             (leer lassen, für D10)
```

**Für B3** reicht eine Änderung an einem Feld, das im Fingerabdruck steht —
etwa die Zahlungsart oder ein Betrag. Eine Änderung an `note` gehört dagegen
zu B4 und darf **nicht** wirken.

**Was Sie nicht tun sollten:** einen zweiten Eigenbeleg ausstellen, um B2 zu
bekommen. Es gibt einen, und ein ausgestellter Beleg ist unveränderlich — es
gibt keinen Weg zurück. B2 ist mit dem vorhandenen prüfbar.

---

## Darstellung und Barrierefreiheit

| # | Prüfung | Erwartung |
|---|---|---|
| A1 | Mauszeiger über beiden Zellen | vollständiger Tooltip, Bedeutung zuerst |
| A2 | Screenreader | derselbe Satz als `aria-label`, nicht der Glyph |
| A3 | Graustufen / `forced-colors` | die vier Zustände bleiben durch ○ ◐ ● ? unterscheidbar |
| A4 | Kopfzeile | „Daten" und „Beleg" vollständig lesbar, nicht abgeschnitten |
| A5 | Telefonbreite (~390 px) | Tabelle scrollt seitwärts, **keine** Spalte verschwindet, Kopfzeile bleibt sichtbar |
| A6 | Reihenfolge | Daten · Beleg · Lager · ⌄ — die drei Zustandsspalten beieinander |
| A7 | Gold | nirgends. Die Zustände sind grau, bernstein, smaragd |

## Was unverändert sein muss (Regression)

| # | Prüfung |
|---|---|
| R1 | Jahresfilter, Monatsfilter, `?jahr=ohne` liefern dieselben Zeilen wie vorher |
| R2 | Die vier Klassifikationszähler (normal, unvollständig, offen, Test) stimmen |
| R3 | Suche nach Text, Zahl mit Komma, SKY-ID, Datum — dieselben Treffer |
| R4 | Summenzeile: Ausgaben, Marktwert, Faktor unverändert |
| R5 | Sortierung: höchster Tagesplatz oben, undatierte zuletzt |
| R6 | Aufklappen lädt die Positionen, Einbuchen funktioniert |
| R7 | Der (i)-Dialog öffnet und speichert |

**R1 bis R5 sind durch `0124_baseline.sql` maschinell abgedeckt** — derselbe `alt_hash`
vor und nach der Migration beweist sie exakter als jede Sichtprüfung. R6 und
R7 muss der Browser zeigen.

---

## Reihenfolge und Anzahl der Läufe — geändert nach dem ersten Preflight

**`0125` ZUERST, DANN `0124`.** Der erste Staging-Preflight hat gezeigt, dass
`authenticated` EXECUTE auf `purchase_receipt_fingerprint` hat. Preflight 206
verlangt das Gegenteil und bleibt ohne `0125` rot.

**`0124_baseline.sql` läuft sechsmal, nicht zweimal.** Staging hat **drei**
aktive, freigeschaltete Betreiber (Befund 310). Statt einen auszuwählen, wird
jeder gemessen — der Rang steht dabei an **einer** Stelle, in Schritt 1 der
Datei (`portalvault.baseline_rang`):

| Lauf | `rang` | Zeitpunkt |
|---|---|---|
| 1–3 | 1, 2, 3 | **vor** der Migration |
| 4–6 | 1, 2, 3 | **nach** der Migration |

Zwei Gleichheiten müssen gelten:

- **quer** — Läufe 1/2/3 untereinander gleich in `alt_hash`, `summe_hash`,
  `ids`, `zeilen`, `klassen`; ebenso 4/5/6.
- **längs** — 1 gegen 4, 2 gegen 5, 3 gegen 6; nur `mit_status`, `mit_beleg`,
  `abweichend` und `unbekannt` dürfen sich ändern.

Die Quer-Gleichheit ist ein neuer Test, den es vorher nicht gab: sie
**beweist**, dass die Ledger-Ausgabe nicht davon abhängt, wer sie abruft. Aus
dem Rumpf folgt das (der Betreiber kommt dort genau einmal vor, als Tor); hier
wird es gemessen. Weicht ein Lauf ab, **stoppen** — dann ist das Orderbuch
entgegen dem Quelltext betreiberabhängig, und `0124` ist die falsche Baustelle.

**Erwartet nach `0124` auf Staging:** `mit_beleg = 1`, `abweichend = 0`,
`unbekannt = 0` — aus dem Preflight (921 = 0, 922 = 1, 923 = 0).

**Abnahmeregel für jeden der sechs Läufe — beide Bedingungen, sonst ist es
keine Baseline:**

1. `verdikt` = `OK` in **jeder** Zeile.
2. `alt_hash` und `summe_hash` sind **64 Hexzeichen** lang.

Steht dort `KEINE_BASELINE`, hat die Wache einen Abbruchgrund gefunden und der
Ledger wurde nicht gerufen. Den Grund nennt `0124_baseline_guard.sql`, ohne
selbst abzubrechen. Ein solcher Lauf ist zu verwerfen — **nicht** zu
vergleichen.
