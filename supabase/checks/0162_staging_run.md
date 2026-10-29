# 0162 auf Staging — der Laufzettel

**Der Marktwert an der Kachel, und die Löschung einer unbenutzten Zeile.**
CAT-09. **Stand 2026-10-29: auf Staging angewendet und vollständig geprüft**
(Abschnitt „Der Lauf" unten); auf **Production nicht**. Sie brauchte eine
ausdrückliche Freigabe des Betreibers, weil sie zum ersten Mal einen Weg
anlegt, der eine Katalogzeile **entfernt** (CLAUDE.md, „Wann du den Nutzer
fragen musst": destruktive Migrationen, Löschen von Daten, und jede Form von
Adminberechtigung). **Die Freigabe gilt für Staging; für Production ist sie
erneut einzuholen.**

## Worum es geht

Zwei kleine Funktionen für die Adminkachel im Katalog:

| | |
|---|---|
| `admin_set_market_price(text, numeric)` | schreibt **eine** Spalte und ihr Datum |
| `admin_delete_figure(text)` | löscht **eine** Zeile, wenn nichts auf sie zeigt |

Dazu zwei neue Journalwerte (`market_price`, `deleted`). Sonst nichts: keine
Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie, kein
Index.

## Die Falle, die der Betreiber benannt hat

**Der angezeigte Marktwert ist nicht der gespeicherte.** `market_price` ist
der gespeicherte Referenzwert; was der Katalog druckt, ist

```
Anzeige = market_price × (1 + boost/100)
```

gerechnet in `src/lib/catalog/market-boost.ts`, im Moment des Druckens, und
**nie gespeichert**. Schriebe die Inlinebearbeitung den **angezeigten** Wert
zurück, wäre der Zuschlag beim nächsten Lesen zweimal drin — und beim
nächsten Speichern dreimal.

**Deshalb bindet die Oberfläche an den gespeicherten Wert.** Das Eingabefeld
wird mit `figure.marketPrice` vorbelegt, nicht mit dem gedruckten Betrag; die
Kachel zeigt weiter den gedruckten und nennt den gespeicherten als Hinweis.
`src/lib/admin/inline-price.test.ts` hält beides fest, und die Funktion nimmt
nur den gespeicherten.

## „Preis offen" ist NULL und nicht 0 €

ADR-0010. Das leere Feld schreibt `NULL`, und `price_updated_at` geht mit —
ein Datum ohne Preis wäre eine Auskunft über nichts. Eine `0` weist die
Funktion mit einem **eigenen Satz** ab:

> *ein Marktwert von 0 ist kein Preis. Für „Preis offen" das Feld leer lassen
> — das schreibt NULL und nicht 0.*

Die Constraint `skylanders_market_price_positive` (`null or > 0`) würde die 0
auch abweisen, aber mit ihrer eigenen Meldung. Sie bleibt die **letzte**
Schicht, nicht die erste. Wächter **A6** der Hülle bricht ab, falls sie je
fehlt.

## Warum die Löschung mehr prüft als der Fremdschlüssel

**Drei Prüfungen**, und die dritte ist der Grund, warum es diese Funktion
überhaupt gibt:

1. **Die gezählten Verweise.** `admin_merge_references` (`0154`, berichtigt
   in `0159`) leitet aus `pg_constraint` her, wer auf die SKY-ID zeigt.
   Gemessen am 2026-10-29: **vierzehn** Fremdschlüssel.

2. **Die vier mit `ON DELETE CASCADE`, namentlich.** `cart_items`,
   `catalog_editorial`, `inventory_import_mappings`,
   `orderbook_name_mappings`. Ein blankes `delete from skylanders` hätte sie
   **stillschweigend mitgenommen** — genau das schließt Anforderung 8 aus.
   `admin_merge_references` zählt sie mit; die Meldung nennt sie einzeln,
   weil ein Warenkorb, der still verschwindet, kein blockierter
   Löschvorgang ist, sondern ein stiller.

   `catalog_editorial` ist die eine Ausnahme, und sie ist keine: diese Zeile
   gehört der Figur selbst (Notiz, Gruppe), `0154` nimmt sie ausdrücklich aus
   der Zählung, `0155` löscht sie vor der Figur. Hier genauso — **ausdrücklich
   und nicht per `cascade`**, damit im Code steht, was verschwindet.

3. **Der stille Verweis.** `order_lines.sky_id` ist ein `text`-Feld **ohne**
   Fremdschlüssel — gemessen die **einzige** solche Spalte im Schema. Eine
   Bestellzeile ist ein historischer Beleg und soll Katalogänderungen
   überleben; deshalb steht dort kein Schlüssel, und deshalb sieht
   `admin_merge_references` sie **nicht**. Die Funktion fragt sie
   ausdrücklich. Ohne diese Zeile wäre „referenzfrei" eine Behauptung, und
   eine Bestellung hätte ihre Figur verloren.

Dazu die **Varianten**: zeigt eine Zeile als Basisfigur, bricht die Funktion
mit einem lesbaren Satz ab, bevor der Fremdschlüssel aus `0159` es mit `23001`
tut.

## Was die Löschung nicht tut

* **Sie hängt nichts um.** Keine fremde SKY-ID bekommt die Daten.
* **Sie löscht keine Variante, keine Familie, keinen Charakter** — und auch
  keine Sammlungszeile, keinen Favoriten, keine Lagerzeile. Sie bricht ab.
* **Sie benutzt kein `cascade` als Umweg.** Die einzige Stelle, an der das
  Wort im Rumpf steht, ist die **Meldung**, die die Tabellen nennt.
* **Sie fasst keine Datei in Supabase Storage an.** Gemessen: **44
  Bilddateien sind von 103 Zeilen geteilt** (Grundfigur und Variante, das
  Projekt tut das absichtlich). Eine gelöschte Zeile hinterlässt also
  höchstens eine verwaiste Datei — der harmlose Fehler. Eine gelöschte Datei
  nähme einer anderen Figur das Bild. Der Bereinigungsbedarf steht in
  `supabase/checks/0162_storage_note.md`.
* **Sie gibt die SKY-ID nicht in den Umlauf zurück.** Neue Nummern kommen aus
  `sky_id_seq` (`0033`), und eine Sequenz geht nur vorwärts — gemessen stehen
  heute schon **232 Lücken** im Nummernband, und keine davon wurde je neu
  vergeben.

## Das Journal überlebt die Löschung

`catalog_admin_changes` hat **keinen** Fremdschlüssel auf `skylanders`
(gemessen, Preflight Zeile 109). Also bleibt die Auditzeile stehen, wenn die
Figur fort ist — und sie wird **vor** dem `delete` geschrieben, derselbe
Ablauf wie in `0155`. Ein Auditsatz, der die referenzfreie Löschung selbst
blockiert, wäre der Widerspruch aus Anforderung 16; Wächter **A4** bricht ab,
falls dieser Fremdschlüssel je entsteht.

Die Zeile hält fest, was verschwunden ist: `Name | Serie | Status | Herkunft
| Marktwert`.

## Nebenläufigkeit

`select … for update` auf der Zeile, dann prüfen, dann schreiben — alles in
**einer** Transaktion. Legt jemand zwischen Prüfung und `delete` eine
Sammlungszeile an, scheitert der `delete` am Fremdschlüssel, und die ganze
Transaktion rollt zurück. **Die Constraint ist die letzte Schicht, nicht die
erste** — und das ist die richtige Reihenfolge: die Prüfung gibt die lesbare
Meldung, der Schlüssel gibt die Garantie.

## Die Schritte

1. **Preflight** (rein lesend):
   ```
   npm run db:migrate:staging -- 0162
   ```
   Erwartet `9999 = 0`. Zeile 105 belegt, dass `order_lines.sky_id`
   **wirklich** keinen Fremdschlüssel trägt; 109, dass das Journal nicht an
   `skylanders` hängt; **132 ist der Preis-Abdruck**, den die Nachkontrolle
   wieder nennt; 136 nennt die vier CASCADE-Schlüssel namentlich.

2. **Die eine schreibende Anweisung** — vom Bediener, im SQL-Editor von
   `qqxcpesbwfxzgytkdsac`:
   ```
   supabase/operations/staging-0162.sql
   ```
   Vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**

3. **Nachkontrolle**:
   ```
   npm run db:migrate:staging -- 0162 --resume
   ```
   Erwartet `9998 = 0` und `9999 = 0`.

## Die Wächter der Hülle

| | Was er abfängt |
|---|---|
| **A1** | falsche Umgebung |
| **A2** | `admin_merge_references`, `is_platform_admin`, `admin_discard_draft` oder `order_lines` fehlt |
| **A3** | `order_lines.sky_id` trägt **inzwischen** einen Fremdschlüssel — dann ist die Annahme dieser Migration überholt |
| **A4** | das Journal hängt an `skylanders` — dann blockierte der Auditsatz die Löschung selbst |
| **A5** | die Audit-Constraint ist nicht die Fassung aus `0159` (sonst verliert die neue Liste einen Wert — die Lehre aus `0152`) |
| **A6** | `skylanders_market_price_positive` fehlt |
| **A7** | NOTICE, kein Riegel: Katalogzeilen, Zeilen ohne Preis, Journalzeilen, Fremdschlüssel, davon CASCADE, Bestellzeilen |
| **B1–B5** | nach dem Lauf: Attribute, Rechte, vierzehn Journalwerte, **nichts gelöscht und kein Preis angefasst**, `0161` unverändert |

## Stoppbedingungen

* `ABBRUCH A1`–`A6` — die Lage ist zu klären, nicht zu überschreiben
* Preflight Zeile 121 oder 122 ≠ `true` — eine der Funktionen steht schon
* Nachkontrolle Zeile **117** ≠ `true` — **`order_lines` wird nicht gefragt**;
  dann ist „referenzfrei" eine Behauptung, und die Funktion darf nicht
  benutzt werden
* Nachkontrolle 114 ≠ `true` — die Preisfunktion fasst eine andere Spalte an
* Nachkontrolle 119 ≠ `true` — der Auditsatz steht **nach** dem `delete` und
  würde die Löschung blockieren
* Nachkontrolle 121–126 ≠ erwartet — `cascade`, Storage, `setval` oder eine
  Umhängung ist in einen Rumpf geraten
* Nachkontrolle **132** ≠ Preflight 132 — **ein Preis hat sich bewegt**,
  obwohl diese Migration keinen anfasst
* Nachkontrolle 133 ≠ Preflight 133, oder 134 ≠ `0` — der Lauf hat die
  Funktionen aufgerufen
* 143 ≠ `true` — ein alter Journalwert ist verloren
* eine veränderte Angebots-, Lager-, Katalog- oder Sammlungszahl (811–817,
  831–833 gegen die eingefrorene Baseline)

## Was gemessen ist, bevor jemand etwas ausführt

Probelauf **P71** (`npm run verify:check-sql`) fährt gegen echtes PostgreSQL
— **mit den echten Fremdschlüsseln**, die das Stub-Schema nicht trägt, denn
ohne sie wäre die ganze Frage gegenstandslos:

* **Der Preis:** gesetzt → auf „offen" zurückgenommen → wieder gesetzt, und
  `price_updated_at` folgt jedes Mal. `0` und ein negativer Betrag werden mit
  dem **Satz** abgewiesen, nicht von der Constraint. Jede Änderung steht im
  Journal mit altem und neuem Wert, und **keine andere Spalte** bewegt sich.
* **Die Löschung einer referenzfreien Zeile** geht durch — und die
  **Journalzeile überlebt sie**.
* **Jede Abhängigkeitsklasse einzeln:** Sammlung, Favorit, Lager, Warenkorb.
  Jedes Mal blockiert sie, und die fremde Zeile bleibt stehen.
* **Der CASCADE-Schlüssel wird namentlich genannt** — er wäre
  stillschweigend mitgegangen.
* **Der stille Verweis:** `admin_merge_references` zählt **nichts**, weil
  `order_lines` keinen Fremdschlüssel hat — und die Löschung blockiert
  **trotzdem**.
* **Eine Basisfigur mit Variante** blockiert mit einem lesbaren Satz; die
  Variante selbst ist löschbar.
* **Ohne Adminrecht** weisen beide mit `42501` ab, und die Zeile steht.
* **Der Wettlauf:** entsteht die Referenz vor dem Aufruf, blockiert die
  Prüfung, und beide Zeilen stehen danach unverändert.
* **Das geteilte Bild** bleibt liegen: die andere Zeile behält die Datei, und
  im Rumpf steht kein `storage`.
* **R0162** entfernt genau die zwei Funktionen, lässt die Audit-Constraint
  stehen und **jede Journalzeile**.

## Der Lauf vom 2026-10-29

| Schritt | Ergebnis |
|---|---|
| **Preflight** (`db:migrate:staging -- 0162`) | **40 Zeilen, `9999 = 0`**, vier offene Zeilen (133, 134, 137, 139) — alle vier lesen Objekte ohne `select` für den Prüfzugang |
| **Baseline** | `supabase/baselines/baseline-0162.json`, erhoben 13:45:02.688Z, Herkunft `preflight` — danach **nie neu erhoben**, Prüfsumme vor und nach dem Lauf `0c78c34f7b83c038…` |
| **Die eine schreibende Anweisung** | Betreiber, im SQL-Editor von `qqxcpesbwfxzgytkdsac` als `postgres`, über `supabase/operations/staging-0162.sql` — Supabase meldete `Success` |
| **Nachkontrolle** (`--resume`) | **66 Zeilen, `9999 = 0`**, vier offene Zeilen (133, 134, 137, 138) |
| **Berechtigter Lauf** | `supabase/log/staging/0162-postflight-berechtigt.sql` als `postgres`, mit den eingefrorenen Baselines schon eingesetzt: **`9998 = 0` UND `9999 = 0`**, keine offene Zeile |

**Die Baseline weicht von der von `0161` ab, und das ist richtig:** Angebote
257 und Lagerzeilen 287 unverändert, shopfähig und sammelbar 552 → **565**,
Katalogzeilen 725 → **694**, Sammlung 21 und Favoriten 1 unverändert. Der
Betreiber hat zwischen beiden Migrationen redaktionell gearbeitet. Pre- und
Postflight **dieser** Migration stimmen überein — sie hat keine Datenzeile
bewegt, nur zwei Funktionen und zwei Journalwerte angelegt.

**Vor dem Lauf hat `P71` einen echten Fehler in der Migration gefunden:**
`to_regclass('public.' || r.tabelle)` auf den schon qualifizierten Namen aus
`admin_merge_references` wäre `0A000 cross-database references are not
implemented` gewesen. Gelaufen ist die korrigierte Fassung, SHA-256
`5bb5caf934ea218a9bda37b1a11cb5f7c8947976e681e797bfe966da662a0f63`.

**Die Nachkontrolle brauchte zwei Anläufe, und der Befund lag beide Male in
der PRÜFDATEI, nicht in der Datenbank.** Der erste Lauf meldete `9999 = 2`:
Zeile **114** („und KEINE andere Spalte") und Zeile **122** („kein Zugriff auf
`storage`"). Beide suchten ein blankes Wort in `prosrc` — und `prosrc` enthält
die **Kommentare**: die Preisfunktion sagt im Kommentar „kein `card_type`",
die Löschfunktion nennt `0162_storage_note.md`. Dieselbe Klasse wie `0159`
Zeile 51, `0156` Zeile 115 und `0153` Zeile 104; sie ist damit die vierte.
Beide Zeilen messen jetzt am **kommentarfreien** Rumpf und suchen die
**Schreibform** statt des Wortes — die Spalte in einem `set`, `storage` mit
folgendem Punkt oder in Anführungszeichen —, neu dazu Zeile **120**: genau ein
`update` im Rumpf. **Keine Prüfung wurde entfernt oder pauschal auf Erfolg
gesetzt**, und `P71` Abschnitt **V** schneidet den echten Zeilentext aus der
Prüfdatei heraus und fährt ihn gegen Rümpfe, die den Fehler wirklich
enthalten. **Die Migrationsdatei blieb unberührt** (Regel 1 aus
`APPLIED.md`), die Baseline ebenso.

**Protokolliert in `supabase/migrations/APPLIED.md`**, Spalte `Datei heute` =
`gleich`: die Datei im Repository ist bitgenau die ausgeführte Fassung, und
`src/lib/admin/migration-integrity.test.ts` rechnet das bei jedem Testlauf
nach.

## Die Freigabe, die sie braucht

Diese Migration legt den ersten Weg an, der eine **Katalogzeile entfernt**.
Vor einer Ausführung auf Staging gehört ausdrücklich bestätigt:

1. dass eine referenzfreie Katalogzeile **endgültig** verschwinden darf —
   sie steht danach nur noch im Journal und in der Plattformsicherung,
2. dass die **SKY-ID** damit dauerhaft verbraucht ist (sie kommt nie
   zurück — ADR-0003),
3. dass die **verwaisten Bilddateien** in Storage liegen bleiben, bis jemand
   sie nach `0162_storage_note.md` aufräumt.

**Der Betreiber hat alle drei am 2026-10-29 bestätigt, und danach lief die
Migration auf Staging.** Production ist davon unberührt und braucht eine
**eigene** Freigabe — eine Freigabe für Staging ist keine für den Betrieb.
