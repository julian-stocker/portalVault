# Offene Prüfungen — was nachweislich noch NICHT geprüft ist

**Stand 2026-10-18.** Diese Datei führt die Nachweise, die **fehlen**. Sie ist das
Gegenstück zu `APPLIED.md`: dort steht, was gelaufen ist, hier, was aussteht.
Ein Punkt wird erst gestrichen, wenn ein Lauf ihn belegt — nicht, wenn er
plausibel erscheint.

**Nichts davon ist ausgeführt.** Jeder Punkt braucht eine eigene Freigabe.

## 0. Lauf vom 2026-10-18 — was damit BESTÄTIGT ist

Der Betreiber hat die vier lesenden Prüfungen auf Production
(`zmiwxswrpkmizvqsgype`) ausgeführt. Bestätigt ist damit:

| Gegenstand | Befund |
|---|---|
| Angewendete Fassungen | `seller_save_purchase_edit` = **0127** · `seller_business_backup` = **0131** · `seller_remove_purchase_item` = **0132** · `seller_update_purchase` = **0132** · `purchases_paid_total_is_final` = **0133** · `seller_purchase` = **0119** |
| `0134` | **nicht angewendet** — wie vorgesehen gesperrt |
| Schutztrigger | alle vier aktiv |
| Eigenbelege | **0** |
| `0132`-Postflight | **`9999 = 0`** — die am 2026-10-18 korrigierten Prüfungen bestehen |
| Eröffnungsbestand aus dem Cutover | **245 Positionen / 806 Einheiten**, und **806 stimmt exakt mit `legacy_stock_events` überein** |
| Historische Einkaufssumme | **4 476,39 €**, unverändert |
| Lager am 2026-10-18 | 306 Positionen / 779 Einheiten / 362 Bewegungen |
| Die 109 wiedereröffneten Importpositionen | **vollständig geschützt** — alle tragen `source_row`, keine würde `seller_remove_purchase_item` durchlassen |
| Bestandsintegrität | keine negativen Bestände, keine unzulässige Reservierung, keine Position mit negativem Eröffnungsbestand |

**Der wichtigste Nebenbefund: die Invariante aus ADR-0127 hat sich bewährt.**
Zwischen dem ersten und dem zweiten Lauf sind Bestand und Journal um je **+78**
gewachsen (701 → 779 Einheiten, 284 → 362 Bewegungen) — und der
Eröffnungsbestand ist mit 245 / 806 **unverändert** geblieben. Genau das sagt
Invariante 2 voraus: jede Mengenänderung geht durch beide Seiten, die Differenz
aus dem Cutover bewegt sich nicht.

## 0a. Was derselbe Lauf WIDERLEGT hat

| Annahme | Befund | Folge |
|---|---|---|
| „Nur Staging trägt die synthetischen Testfiguren" | Production trägt **eine** davon | Der Umgebungsstempel war eine **falsche Annahme** und ist in allen fünf Prüfdateien durch eine Aufzählung ersetzt. Die Figur selbst ist ein Altlastbefund: `verify:rls` legt `SKY-9998` als DAUERHAFTE Fixture an, deren Fremdschlüssel ON DELETE RESTRICT tragen; vor dem 2026-09-09 gab es nur ein Projekt. Aufklärung: `fixture_audit_readonly.sql` |
| `0133_production_readonly.sql` läuft | **Abbruch mit `42725 operator is not unique: text \|\| "char"`** | `tgenabled` ist `"char"`, `tgname` ist `name`. Beide sind jetzt ausdrücklich nach `text` gecastet, und die ganze Datei ist auf dieselbe Fehlerklasse durchsucht. **Die Prüfung ist unverändert offen** — es ist keine Zeile entstanden |
| 0069: „ein Trophy und zwei Portale" ohne Katalogbezug | **206** Einkaufspositionen ohne `sky_id` | Zahl deutlich höher als geplant. Aufklärung: `accessory_audit_readonly.sql` |
| Spiele sind im Orderbuch nicht wählbar | **40** Spiele-Katalogzeilen, **39 aktiv und sichtbar** — und damit in der Einkaufsauswahl wählbar; **13 Lagerzeilen und 18 Verkaufspositionen** hängen schon daran | Spiele sind operativ längst in Gebrauch, nur nicht modelliert und nicht als Bereich sichtbar |

## 0b. Lauf vom 2026-10-18, zweiter Teil — vier Abbrüche und was daraus folgt

| Datei | Ergebnis |
|---|---|
| `0133_production_readonly.sql` | **bestanden, `9999 = 0`.** Trigger aktiv, Zahlungsschutz korrekt, und die verschärfte Rechteprüfung ist grün: PUBLIC, `anon`, `authenticated` und `service_role` haben kein EXECUTE auf den beiden Ausstellungsfunktionen, der ACL lautet je `postgres=X/postgres` — **kein NULL-ACL**, die Belegsperre hält also auch gegen den Standardfall |
| `fixture_audit_readonly.sql` | **abgebrochen** — `42P01 missing FROM-clause entry for table "f"` |
| `0132_diagnose_production.sql` | **abgebrochen** — `42P01 … "ofr"` |
| `accessory_audit_readonly.sql` | **abgebrochen** — `42P01 … "ofr"` |
| `state_audit_readonly.sql` | **abgebrochen** — `42P01 … "ofr"`, FROM-Alias `ofrfr`, WHERE-Referenz `ofr` |

**Ursachen, beide hausgemacht:** eine Textersetzung, deren drittes Muster das
Ergebnis des ersten noch einmal getroffen hat (`ofr` → `ofrfr`), und ein
CTE-Alias, der in fünf Zeilen benutzt, aber nicht deklariert war. Beide Dateien
waren syntaktisch einwandfrei — die Syntaxprüfung konnte davon nichts sehen.

**Konsequenz:** drei Stufen der Prüfung, getrennt benannt, siehe
`supabase/checks/README.md`. Neu dazu: `npm run verify:check-sql` plant jede
Prüfdatei gegen ein echtes PostgreSQL (PGlite) mit einem Stub-Schema aus den
Migrationen, und zwei dependency-freie Wächter in der Testsuite fangen genau
die beiden Klassen ab, die hier durchgekommen sind.

## 0c. Lauf vom 2026-10-18 — die vier letzten lesenden Prüfungen

Alle vier ausgeführt. **Drei ohne blockierende Abweichung, eine mit einer
widerlegten Annahme meinerseits.**

### Messwerte, bestätigt

| Größe | Wert |
|---|---|
| Funktionsfassungen | `seller_save_purchase_edit` **0127** · `seller_business_backup` **0131** · `seller_remove_purchase_item` **0132** · `seller_update_purchase` **0132** · `purchases_paid_total_is_final` **0133** · `seller_purchase` **0119** |
| `0134` | nicht angewendet |
| Schutztrigger | alle vier aktiv |
| Belegausstellung und -korrektur | EXECUTE **ausschließlich `postgres`** — kein NULL-ACL, keine API-Rolle |
| Eigenbelege | **0** |
| Eröffnungsbestand | **245 Positionen / 806 Einheiten** |
| Lager / Journalsaldo | **779 Einheiten / −27** (806 − 27 = 779, die Rechnung geht auf) |
| Herkunftsmerkmale | keine importierte Zeile ohne Merkmal |
| 109 wiedereröffnete Positionen | weiterhin vollständig geschützt |
| Negative Bestände, unzulässige Reservierungen | keine |
| Testfiguren im öffentlichen Angebot | **0** |

### Die Fixture-Figuren — kein Production-Problem

Gefunden: **`SKY-9994`** und **`SKY-9998`**, beide in Serie `SA`, dort neben 108
echten Katalogzeilen. Keine Lagerzeile, keine Bewegung, kein Einkauf, kein
Verkauf, keine Bestellung, keine Reservierung, kein Warenkorb, kein
Sammlungseintrag. Beide **nicht shopfähig**, **0** öffentliche Angebote, **0**
Verkaufspositionen.

Das ist der dokumentierte Zustand, nicht ein neuer Befund:

* `PROJECT_STATUS.md`: *„Offen, bewusst liegen gelassen: die Verifizierer-Fixtures
  `SKY-9994`/`SKY-9998` in Production"*.
* Beide Figuren sind **inaktiv**; deshalb hat die einmalige Freigabeaktivierung
  ihre vier Positionen übersprungen — *„über die zentrale Regel, nicht über eine
  Sonderliste"*.
* Ihre Lagerpositionen hat der Pre-Go-Live-Reset vom 2026-09-21 entfernt
  (Schritt 7, mit eigener Nachbedingung). Die Zahl **209 Stück** in
  `PROJECT_STATUS.md` ist der Stand von **vor** dem Cutover und überholt.
* `SKY-9998` steht in `SA`/`Spiele`, weil `tools/verify-rls.mts` die Fixture
  bewusst in einer **vorhandenen** Kategorie beherbergt
  (`select id, series_code from categories limit 1`) statt eine eigene Serie zu
  erfinden, die mit der nächsten Fixture kollidiert.

**Meine Prüfung 112 war sachlich falsch** („echte Katalogzeilen in einer
Fixture-Serie müssen 0 sein"). Sie ist ersetzt — nicht abgeschwächt — durch die
drei Bedingungen, an denen der Schutz wirklich hängt: **inaktiv** (112),
**nicht shopfähig** (113), **kein öffentliches Angebot** (301). Die
Serienzugehörigkeit ist jetzt eine Messung ohne Sollwert.

**Die Figuren selbst bleiben unverändert.** Ein Löschen ist kein Gewinn: es
gäbe keine Außenwirkung zurück, die nicht schon 0 ist, und PROJECT_STATUS führt
sie seit dem 2026-09-19 bewusst.

## 0d. Staging-Betriebsvorgänge — manuell angewendet, nicht Migrationen

Dieser Abschnitt führt **betriebliche Schalter**, keine Migrationen. Sie stehen
nicht in `APPLIED.md` und nicht in der Migrationskette; sie sind rücknehmbar und
werden hier protokolliert, weil ein Rechtestand, der nur im Chatverlauf steht,
nicht dokumentiert ist.

### Belegsperre auf Staging (`qqxcpesbwfxzgytkdsac`)

| | |
|---|---|
| Vorgang | `supabase/operations/lock-receipt-issuance.sql` |
| SHA-256 der ausgeführten Fassung | `9812867cd95b1a546ebaf8743e8823d49ddfdc255929974710f346d82fa8d8d7` — bitgenau die Fassung, die am 2026-10-17 auf Production lief (Commit `81386e6`) |
| Art | **Betriebsvorgang, keine Migration.** Drei `DO`-Blöcke, einziger ausgeführter Befehl `revoke execute on function` |
| Ausführung | **manuell im Supabase-SQL-Editor durch den Betreiber**, in `BEGIN` / `COMMIT` geklammert. Nicht aus diesem Repository heraus — es gibt dafür keinen Zugang |
| Zeitpunkt | **vom Betreiber nicht mitgeteilt und hier deshalb nicht eingetragen.** Gemeldet im Arbeitsschritt nach der Freigabe vom 2026-10-18 |
| Rücknahme | `supabase/operations/unlock-receipt-issuance.sql` — stellt den Stand her, den `0122`/`0128` erklären |

**Rechtestand vor der Sperre** (gemessen mit `receipt_grants_diagnosis.sql`,
Zustand **A MIGRATIONSSTAND**):

| Funktion | ACL |
|---|---|
| `seller_issue_purchase_receipt(bigint)` | `postgres=X/postgres`, `authenticated=X/postgres`, `service_role=X/postgres` |
| `seller_issue_purchase_receipt_correction(bigint)` | dieselben drei |
| PUBLIC, `anon` | kein EXECUTE · beide ACLs materialisiert |

**Rechtestand nach der Sperre** (beide Postflights bestanden):

| Prüfung | Befund |
|---|---|
| `receipt_lock_check.sql` | **`9999 = 0`** |
| `anon`, `authenticated`, `service_role`, PUBLIC | je **`false`**, für Ausstellung **und** Korrektur |
| `postgres` | je **`true`** — die Sperre bleibt rücknehmbar |
| 300 (Schreibtrigger auf `purchase_receipts`) | `0` |
| 304 (Unveränderlichkeits-Trigger) | `2` |
| `receipt_grants_diagnosis.sql` | **`9999 = 0`**, Zeile **401 = „B GESPERRT (keine API-Rolle, nur postgres)"** |
| 201, 202 (ACL im Volltext) | **ausschließlich `postgres=X/postgres`** |
| 203 (Beleghistorie) | weiter ausführbar für `postgres`, `authenticated`, `service_role` — **der Abruf bleibt offen** |

**Bestehende Belege unverändert:**

| Größe | vorher | nachher |
|---|---|---|
| Eigenbelege (301 / 402) | 2 | **2** |
| Revisionen (403) | 1 und 2 | **`1=1, 2=1`** |
| Zählerzeilen (302) | — | 1 |
| Abrufnachweise (303) | — | 7 |
| unbekannte Schreibtrigger (404) | — | 0 |

**Folgen, die ins Gedächtnis gehören:**

* Auf Staging lässt sich kein Eigenbeleg mehr ausstellen **oder korrigieren**.
  Ein künftiger Belegtest braucht vorher `unlock-receipt-issuance.sql`.
* **Ein erneuter `0128`-Postflight auf Staging wird anschlagen**: der
  Rechtestand weicht nun von dem ab, den `0122`/`0128` herstellen. Das ist
  gewollt — dieselbe Lage wie auf Production.
* Die Sperre steht in **keiner** Migration. Ein neu aufgebautes Staging hätte
  sie nicht; `receipt_lock_check.sql` ist der Weg, das zu merken.
* `RECEIPT_ISSUANCE_RELEASED = false` ist unverändert. **Freigabe B bleibt
  verweigert** — die Sperre ersetzt sie nicht, sie trägt sie.

## 0e. Migration `0132` auf Staging — angewendet und zweifach belegt

| | |
|---|---|
| Projekt | `qqxcpesbwfxzgytkdsac` |
| Datei | `supabase/migrations/0132_purchase_item_remove_by_line.sql` |
| SHA-256 | `382aa64749cb035e9a6402fe36fc16f9e1ae663228c7806cc34e29331b7ec6b3` — **dieselbe Fassung, die auf Production lief**; gegengeprüft gegen Datei, `SHA256SUMS.txt`, Git-Blob und `APPLIED.md` |
| Ausführung | **manuell im Supabase-SQL-Editor durch den Betreiber**, in `BEGIN` / `COMMIT`. Nicht aus diesem Repository heraus |
| Zeitpunkt | 2026-10-18 |

**Postflight 1 — `0132_postflight.sql`: `9999 = 0`.** Die alte Herkunftssperre
ist entfernt, die **vier** Schutzbedingungen für Importpositionen stehen, der
Riegel auf `total_cost` ist da.

**Postflight 2 — `receipt_lock_check.sql`: `9999 = 0`.** `anon`,
`authenticated`, `service_role` und PUBLIC dürfen weder ausstellen noch
korrigieren, `postgres` behält EXECUTE, 0 schreibende Belegtrigger, 2
Unveränderlichkeits-Trigger. **Die Migration hat die Belegsperre nicht
angetastet.**

**Bezugswerte vor und nach der Migration identisch** — 0132 bewegt keine Daten,
und das ist jetzt gemessen, nicht nur aus dem Dateitext geschlossen:

| Größe | Wert |
|---|---|
| importierte Einkäufe / Positionen | 84 / 2 114 |
| Lagerzeilen / Einheiten / Bewegungen | 285 / 812 / 26 |
| Importsumme `total_cost` | 4476.39 |
| Eigenbelege / Zählerzeilen / Abrufnachweise | 2 / 1 / 7 |

**Damit sind Staging und Production in `seller_remove_purchase_item` und
`seller_update_purchase` auf demselben Stand.** Offen bleibt auf Staging
`0133`; auf Production ist es umgekehrt angewendet. Der vollständige Abgleich
ist S6.

## 0f. Z0 — Bestandsaufnahme vor der Portal- und Spielintegration (Staging)

Beide Prüfungen `9999 = 0`, alle Stopp-Kriterien erfüllt.
`Z0_catalog_accessories_readonly.sql` und `orderbook_catalog_scope.sql`,
ausgeführt vom Betreiber auf `qqxcpesbwfxzgytkdsac`.

| Größe | Wert |
|---|---|
| Katalogzeilen | **605** |
| Spiele | **39, alle mit `display_name_override`** |
| belegte IDs im ZB-Bereich `SKY-0615`–`SKY-0642` | **0** |
| Portal-Kategorien / Portal-Slugs | **0 / 0** |
| Slugs eindeutig | **605 von 605** |
| **sammelbare Artikel (Fortschritts-Nenner)** | **534** |
| **shopfähige Artikel** | **534** |
| **öffentliche Angebote** | **256** |
| Spiele im öffentlichen Angebot | **0** |
| Nicht-Figuren unter den shopfähigen | **0** |
| **Shop-Abdruck `md5`** | **`4d1d6c30fe0ae886ca2689bcb1fe9634`** |
| historische Positionen ohne `sky_id` | 206 |
| `item_type` und die vier weiteren Spalten | **existieren nicht** |

**Diese drei Werte sind der Vertrag für Z1:** nach `0135` müssen
**534 / 256 / `4d1d6c30fe0ae886ca2689bcb1fe9634`** unverändert sein — Zahl der
shopfähigen Zeilen, Zahl der Angebote und der Abdruck über die vollständige
Angebotsliste (`sky_id|condition|price`). Die Migration prüft das in ihrer
eigenen Transaktion und bricht sonst ab; der Postflight macht es von außen
nachvollziehbar. Dass 534 = 534 gilt, ist kein Zufall: `is_shop_eligible()`
und der Fortschritts-Nenner stellen heute dieselbe Frage.

### Nachtrag 2026-10-20: S1 scheiterte, S1a maß — zwei Befunde

**S1 (`0139_preflight.sql`) brach ab:** `column s.usk_rating does not exist`.
Die Datei las eine Spalte, die `0139` erst **anlegt**. Ein Preflight misst
den Zustand **vor** seiner Migration und darf das nicht. Behoben; und damit
es nicht wiederkommt, fährt **Probelauf P40** jeden Preflight gegen genau
diesen Vorzustand — die Planprüfung in Stufe 2 konnte es nicht sehen, weil
ihr Stub-Schema aus **allen** Migrationen entsteht.

**S1a lieferte einen abweichenden Abdruck** —
`faabf8ef0d124c3dc75ed08b4eb4f398` statt
`4d1d6c30fe0ae886ca2689bcb1fe9634`, bei **gleicher** Angebotszahl (256).

> **Keine Datenänderung.** Die Prüfdatei rechnete eine **andere Formel**:
> vier Felder (`sky_id|condition|price|available`), Trenner `\n`. Der
> Z0-Vertrag rechnet drei (`sky_id|condition|price`), Trenner `;`, **ohne**
> `available` — so, wie es oben in diesem Abschnitt steht. Zwei Formeln,
> zwei Zahlen, kein Befund. Alle Dateien rechnen jetzt die Z0-Formel.
>
> Dass `available` **nicht** mitzählt, ist der Grund, warum der Vertrag
> überhaupt taugt: ein Abdruck mit Verfügbarkeit änderte sich bei jedem
> Verkauf.

**Und S1a maß, worauf es ankommt** (rein lesend, `qqxcpesbwfxzgytkdsac`):

| Größe | Wert |
|---|---|
| öffentliche Angebote | **256** |
| shopfähige Katalogzeilen | **534** |
| Zubehör-Lagerpositionen, alle `is_listed = true` | **13** |
| davon mit eigenem `sale_price` | **0** |
| davon mit **wirksamem** Preis — sofort Angebot bei einer Lockerung | **11** |
| Zubehörartikel mit `market_price` | **34** |
| Zubehör-Lagerpositionen ohne Preisquelle | **2** |
| Portale im Katalog / Portal-Lagerpositionen | **21 / 0** |

**Das korrigiert eine Begründung, nicht einen Schluss.** Frühere Fassungen
von ADR-0129, `PROJECT_STATUS.md` und `accessory_offer_proposal.md`
schrieben, die 13 Zeilen trügen „zwingend einen Preis, weil
`shop_inventory_listed_needs_price` das eine ohne das andere verbietet".
**Diesen CHECK gibt es seit `0007` nicht mehr** — er wurde abgeschafft,
weil eine gelistete Position seitdem auch ohne Übersteuerung einen Preis
haben kann; die Regel lebt in `set_shop_listing()` und `shop_offers()`. Der
Preis der 11 kommt aus dem **Marktpreis**. Die Gefahr ist damit dieselbe,
der Beleg dafür jetzt eine Messung.

**S2, S3 und S4 wurden nicht ausgeführt.**

## 0g. `0139` und `0140` auf Staging — angewendet am 2026-10-20

Alle fünf Schritte gefahren (`0139_0140_staging_run.md`). **S2 und S4
erfolgreich**, S1a `9999 = 0`. S1 und S3 meldeten **je genau eine**
Abweichung, und die lag an der Prüfdatei.

### Was gemessen wurde — alle Sicherheitszeilen erfüllt

| Größe | Wert |
|---|---|
| öffentliche Angebote | **256** |
| Abdruck der Angebotsliste | **`4d1d6c30fe0ae886ca2689bcb1fe9634`** |
| shopfähige Katalogzeilen | **534** |
| **freigegebene Zubehörpositionen** | **0** |
| **Zubehörangebote** | **0** |
| Lagerpositionen | **285** |
| Katalogzeilen | **626** |
| Belegausstellung | **weiterhin gesperrt** |

**Die Migration hat getan, was sie sollte: ein Tor gebaut und es nicht
geöffnet.**

### Der eine Befund: 564 statt 534 sammelbare Zeilen

S1 Zeile 405 und S3 Zeile 501. **Die Differenz ist genau 30 — die Zahl der
redaktionell ausgeblendeten Figuren auf Staging.**

Die Sammlungslogik ist richtig; die Prüfung war es nicht. Z0 definiert
„sammelbar" in `0135_preflight.sql` (Zeilen 16–21) als

```sql
where s.is_active and s.catalog_visible
  and not (c.name = any (public.non_collectible_categories()))
```

Meine Zählung liess `s.catalog_visible` weg und nahm die 30 mit. Dass die
Sichtbarkeit dazugehört, bestätigt die Anwendung an zwei Stellen:
`collectionStats()` zählt `entry.figure.isActive && entry.figure.catalogVisible`,
und die Nennerabfrage in `fetchCatalog()` filtert auf beides. Eine
ausgeblendete Figur ist in keiner Hälfte — und genau das macht
„besessen > gesamt" unmöglich (ADR-0040).

**Berichtigt wurde die Prüfdatei, nicht die Migration.** `0139` ist
angewendet und damit nach Regel 1 eingefroren. Ihr interner
`sammelbar`-Abdruck verwendet dieselbe Formel ohne `catalog_visible` — das
bleibt so und ist unschädlich: sie vergleicht **vorher gegen nachher in
derselben Transaktion**, und eine Formel, die auf beiden Seiten dieselbe
ist, beweist „unverändert" unabhängig davon, was sie zählt. Für den
Vergleich mit dem **Z0-Vertrag** taugt sie nicht, und dafür ist der
Preflight da.

**Keine Daten wurden geändert, keine Migration erneut angewendet, kein
Rollback gefahren.**

### Der Riegel dagegen

`src/lib/shop/z0-parity.test.ts`: jede Prüfdatei, die einen Z0-Wert als
Erwartung führt, muss ihn mit **demselben Ausdruck** messen, mit dem Z0 ihn
gemessen hat — verglichen wird der Ausdruck, nicht die Zahl. Der Test
fängt beide Pannen dieses Tages: die erfundene `md5`-Formel und die
Zählung ohne `catalog_visible`.

---

## 0h. `0141` auf Staging, und die Oberfläche am laufenden System (2026-10-21)

`0141` ist angewendet. **Belegt, nicht angenommen:** ein anonymer Aufruf
von `seller_sale_state()` antwortet mit **`42501`** (keine Berechtigung) und
nicht mit `PGRST202` (gibt es nicht) — damit ist beides auf einmal gezeigt,
die Funktion steht und der Riegel hält (`npm run verify:seller:staging`,
Abschnitt 11).

### Was am laufenden System gegen Staging geprüft ist

| Fläche | Ergebnis |
|---|---|
| `/zubehoer` | **60 Kacheln**, alle als Verweis auf `/zubehoer/<slug>`, **60 ×** „Aktuell kein Angebot", **kein** Kaufknopf, **kein** Sammelknopf, Zählzeile „60 Artikel" |
| `/zubehoer/0000502-g` (Portal) | Art **Portal** · Modellnummer **0000502** · Serie **Giants** · Zustand **„Gebraucht · mindestens guter Zustand · voll funktionsfähig"** · `SKY-0618` · „Aktuell kein Angebot" |
| `/zubehoer/wii-u-spiel-trap-team` (Spiel) | Art **Spiel** · Plattform **Wii U** · Serie **Trap Team** · **USK „Nicht erfasst"** · Zustandsstandard · `SKY-0312` |
| `/shop` | **225 Artikel im Angebot** (unverändert), Zustandsstandard im Kopf, **0** Zubehörkacheln — richtig, es ist nichts freigegeben |
| `/` | **unverändert**, 0 Zubehörmarken, ein Tab-Verweis |
| `/zubehoer/bash` · `/skylanders/0000502-g` | beide **404** — zwei Adressräume, keine Vermischung |
| `/collection` | **307** auf die Anmeldung, wie vorher |
| `npm run verify:shop:staging` | **16/17**, und der eine Fehlschlag ist der vorbestehende („15 eligible positions not released", Figuren mit bewusstem Opt-out) |
| `npm run verify:seller:staging` | **19/19** |
| `npm run verify:commerce:staging` | **30/30** |

### Drei echte Fehler, gefunden und behoben

1. **`verify:seller` pinnte vier Spalten in `shop_offers()`.** `0139` hat eine
   fünfte hinzugefügt (`delivery_scope`), und die Prüfung meldete das als
   Verstoß gegen einen Vertrag, den der Betreiber selbst geändert hat. Jetzt
   fünf, namentlich — und zusätzlich geprüft, dass keine Menge dabei ist.
2. **`verify:commerce` suchte einen Bewegungsgrund, den `0025` umbenannt
   hat.** `sale_skyisles` wurde zu `sale`, der alte Wert blieb als Historie.
   Die Prüfung meldete seitdem jede Umwandlung als Abweichung — neun, und
   alle neun richtig. Jetzt gelten beide Namen, dasselbe Paar wie in `0086`.
   **Vorbestehend seit `0025`**, nicht durch diese Arbeit entstanden.
3. **Der Shop zählte „Figuren".** Seit er auch Zubehör zeigt, wäre das falsch,
   sobald ein Portal im Angebot steht. Vier Wörter sind jetzt artneutral
   („225 Artikel im Angebot").

Dazu ein Mobil-Befund in eigener Sache: die drei neuen Bedienelemente der
Lagerkarte waren 36 px hoch. Der Projektstandard für Telefone sind 44
(`INPUT` in `form-section.tsx`), und ein Schalter, der einen Artikel
öffentlich zum Verkauf stellt, ist der falsche Ort fürs Knappe. Jetzt
`min-h-11 sm:min-h-9`.

### Was NICHT geprüft ist, und warum nicht

| | |
|---|---|
| die **Lagerkarte** selbst | `/business/inventory` antwortet einem anonymen Aufruf mit **404**, und `can_operate_active_seller()` liest `auth.uid()`. Ohne angemeldetes Betriebskonto im Browser ist die Karte nicht erreichbar — auch nicht mit dem Service-Role-Key |
| **Freigabe, Preis, Lieferumfang** an einer echten Position | dieselben drei Funktionen verlangen dasselbe Konto |
| **Warenkorb und Checkout** mit Zubehör | braucht ein freigegebenes Zubehörangebot, und das braucht die Freigabe |

**Und ein praktischer Befund für den Durchstich:** auf Staging gibt es
**keine Portal-Lagerposition** (21 Portale im Katalog, 0 Positionen). Die 13
Zubehörpositionen sind alle **Spiele** — und die sind ohne erfasste
USK-Kennzeichnung nicht freigebbar. Der Weg zu einem sichtbaren Portalangebot
führt deshalb über `/business/inventory`: das Portal **suchen**, Position
anlegen, Bestand buchen, Preis setzen, Lieferumfang wählen, freigeben.

---

### Wie die sechs Z0-Werte nach Z1 geprüft werden

Sechs Größen, drei Prüfwege. Die Migration vergleicht **alle sechs** gegen
ihren eigenen Abdruck aus derselben Transaktion — exakt und umgebungsneutral,
weil sie den Vorzustand selbst gemessen hat. Pre- und Postflight messen
dieselben sechs, damit ein Mensch sie nebeneinander legen kann. Und fünf davon
prüfen sie **gegen die hier dokumentierten Zahlen**, sobald der Vertragsmodus
gewählt ist:

```sql
select set_config('skyisles.z0', 'staging', true);

-- hier 0135_preflight.sql bzw. 0135_postflight.sql einfügen
```

**Die Zahlen stehen in den Prüfdateien selbst** — versioniert, prüfsummiert,
nachlesbar. Eingetippt wird nur der Modus. Ein Sollwert, den der Bediener bei
jedem Lauf mitliefert, wäre bei jedem Lauf eine neue Gelegenheit für einen
Tippfehler, und ein Tippfehler in der **Erwartung** lässt die Prüfung bestehen.

**Fehlt die Zeile, ist die Prüfdatei blockierend** (Zeile 902). Es gibt damit
keinen Lauf, der die fünf Werte still übergeht: entweder sie werden geprüft,
oder der Verzicht steht als `keine` ausdrücklich im Protokoll. **Warum nicht
bedingungslos:** Production führt andere Zahlen, und dieselbe Datei muss dort
ohne fünf Fehlalarme laufen. Eine umgebungsblinde Erwartung war in diesem
Projekt schon zweimal die Ursache eines falschen Befundes (`0132`-Readiness
Zeile 602, `0124`-Preflight Zeile 106).

| Z0-Größe | Wert (Staging) | Migration | Flight | Vertrag |
|---|---|---|---|---|
| shopfähige Zeilen | 534 | `shopfaehig` | 601 | **911** |
| öffentliche Angebote | 256 | `angebote` | 602 | **912** |
| Abdruck der Angebotsliste | `4d1d6c30…9634` | `angebote_md5` | 603 | **913** |
| sammelbare Artikel | 534 | `sammelbar` | 701 | **914** |
| Nenner je Serie | (Zeichenkette) | `sammelbar_je_serie` | 702 | — |
| **Spiele** mit `display_name_override` | **39** | `override_md5` | 203 / 204 | **915** |
| `display_name_override` **katalogweit** | **53** (am 2026-10-19 gemessen, **kein Z0-Wert**) | `override_md5` | 916 | — |

### Berichtigt am 2026-10-19: die 39 Overrides waren spielebezogen

Der erste Lauf von `supabase/operations/staging-0135-0136.sql` brach ab:

```
ABBRUCH A7: der Z0-Vertrag stimmt nicht mehr — overrides ist 53, erwartet 39.
```

**Ursache: ein falsch abgeleiteter Sollwert, keine Datenänderung.** Z0 zählt
die Overrides in `Z0_catalog_accessories_readonly.sql` Zeile 102 **innerhalb
der CTE `spiel`** — also nur in der Kategorie `Spiele`. Die Aussage „39, alle
mit `display_name_override`" heißt: *jede der 39 Spiele-Zeilen trägt einen*.
Eine **katalogweite** Gesamtzahl hat Z0 nie festgehalten; der Vertrag hatte
sie als solche gelesen. Katalogweit tragen auch Figuren einen redaktionellen
Anzeigenamen (ADR-0030, ADR-0039) — 53 insgesamt, also 14 Figuren neben den
39 Spielen.

**Die vier anderen Vertragswerte haben bestanden** — `shopfaehig`, `angebote`,
der Abdruck der Angebotsliste und der Nenner. Der Katalog ist also in jeder
Dimension unverändert, die Z0 wirklich gemessen hat.

**Korrigiert, ohne die Prüfung abzuschwächen:**

* Der Vertragswert ist jetzt die belegte Aussage: **39 Spiele-Zeilen mit
  Override** (Zeile 915). Das ist die *strengere* Form — sie fällt auch, wenn
  ein einzelner Spielname überschrieben würde.
* Die katalogweite Zahl bleibt als **Messung** (Zeile 916) und als Wert, der
  sich **während** des Laufs nicht bewegen darf — zusammen mit dem `md5` über
  alle Overrides (Abschnitt D2 des Skripts).
* Neu im Ergebnisraster: `aenderungen_heute` aus `catalog_admin_changes` —
  eine redaktionelle Namensänderung ist erlaubt und soll sichtbar sein, nicht
  blockieren.

**Bestätigung aus den Daten:** `supabase/checks/z0_overrides_diagnosis.sql`
(rein lesend) unterscheidet die zwei Erklärungen über den Änderungsprotokoll-
Trigger aus `0004`: null Änderungen an `display_name_override` heute heißt
falscher Sollwert, nicht bewegter Katalog.

Der **Nenner je Serie** und der **`md5` der Overrides** sind in Z0 nicht als
Zahl festgehalten; für sie gibt es keinen Vertragswert, nur den Vergleich
Preflight ↔ Postflight und die Prüfung innerhalb der Migration. Das ist kein
Verzicht: der Abdruck in der Transaktion ist die strengere der beiden
Prüfungen.

Nachgefahren wird auch das: `npm run verify:check-sql` prüft in drei
Durchgängen, dass der Vertrag wirklich vergleicht statt abzulesen — ohne Modus
blockierend (P9), mit `keine` grün (P10), mit `staging` gegen erfundene Zahlen
**fünf** Abweichungen (P11).

### Z1 liegt vollständig vor, einschließlich der Backup-Entscheidung

| Datei | Zweck | Stand |
|---|---|---|
| `supabase/migrations/0135_catalog_item_type.sql` | `item_type`, Backfill aus der Kategorie, `is_shop_eligible` am Artikeltyp | **nicht angewendet**, 11 Anweisungen |
| `supabase/migrations/0136_business_backup_item_type.sql` | `item_type` in den Bereich `figures` der Betriebssicherung | **nicht angewendet**, 5 Anweisungen, setzt `0135` voraus |
| `supabase/checks/0135_preflight.sql` / `0135_postflight.sql` | Zustand davor / danach, beide mit den sechs Abdrücken und dem Z0-Vertrag | plangeprüft |
| `supabase/checks/0136_preflight.sql` / `0136_postflight.sql` | Stand der Sicherung davor / danach: Abdruck, Länge, Kommentar, 28/352 gegen 28/353, Bereich `figures` mit neun gegen zehn Feldern, Rechte, Formatvertrag, die neun privaten Felder | plangeprüft, in PGlite gegen **beide** Stände gefahren (P12/P13) |
| `supabase/checks/staging_pending_migrations.sql` | **nur Staging**: `0132` steht, `0133`/`0134` nicht — samt Umgebungsstempel | plangeprüft, mit Gegenprobe (P14) |
| `supabase/checks/0135_0136_staging_run.md` | **der Laufzettel**: Dateien, Reihenfolge S0–S11, Transaktionsrahmen, Vertrag, Abbruchkriterien, `25P02`, Rücknahme | — |
| `supabase/checks/0131_function_body_check.sql` | kennt jetzt **beide** Stände der Sicherung (`0131`, `0136`) | plangeprüft, in PGlite gegen beide Stände gefahren |
| `supabase/rollback/R0135_drop_item_type.sql` | Spalte zurück; **verweigert**, solange die Sicherung `item_type` liest | — |
| `supabase/rollback/R0136_back_to_0131.sql` | Rumpf zurück auf `0131`, zeichengleich | — |

**Die Entscheidung des Betreibers vom 2026-10-19:** `item_type` kommt in den
Business-Backup. Begründung wortgleich: „Der Artikeltyp ist langfristig eine
eigenständige fachliche Eigenschaft und soll bei einer Wiederherstellung nicht
aus Kategorien rekonstruiert werden müssen." Umgesetzt in `0136`, nicht in
`0135` — Begründung in ADR-0128 (Nachtrag).

**Was lokal nachgewiesen ist, und was nicht.** `npm run verify:check-sql` fährt
seit dem 2026-10-19 vier Stufen: Stub-Schema, Planprüfung der 44 Prüfdateien,
**Definitionslauf** (jeder gefaltete Funktionsrumpf wird in PostgreSQL 18.6
erzeugt — für `language sql` eine vollständige Namens- und Typauflösung) und
**Probelauf** von `0135`/`0136` gegen **erfundene** Zeilen, mit acht
Durchgängen. Fünf davon müssen scheitern: ohne Klammer, bei verändertem
Angebot, `0136` vor `0135`, `R0135` vor `R0136`. Das beweist das **Verhalten**
der Migrationen — nicht, dass sie auf Staging oder Production laufen. Nachweis
dafür bleibt allein das Ergebnisblatt aus dem SQL-Editor.

### Eine berichtigte Annahme: der ZB-Bereich ist ein LOCH, kein Anhang

Z0 meldet als höchste SKY-ID **`SKY-0822`**, nicht `SKY-0614`. Meine frühere
Aussage, der Katalog ende bei `SKY-0614` und die ZB-Nummern setzten ihn fort,
war in ihrer zweiten Hälfte falsch. `SKY-0614` war der Höchstwert in
`data/catalog/products.json` — einem Abzug vom 2026-09-04, nicht dem heutigen
Katalog.

Die Bereiche sind in `docs/SKYLANDERS_DATA.md` längst festgelegt:
`SKY-0001`–`SKY-0820` historisch, `SKY-0821`–`SKY-8999` produktiver
Allokationsbereich, ab `SKY-9000` Fixtures. `SKY-0821` ist eine
Charakterimport-Fixture auf Staging, `SKY-0822` wurde nie nach Production
übernommen (`PROJECT_STATUS.md`).

**Was unverändert gilt und was daraus folgt:** `SKY-0615`–`SKY-0642` ist
**nachweislich frei** (Z0, Zeile 201 = 0) — aber als **Lücke innerhalb** des
historischen Bereichs. Eine Vergabe nach „höchste ID plus eins" wäre damit
falsch und würde im produktiven Allokationsbereich landen. **Z3 setzt genau die
21 IDs aus der Arbeitsmappe**, prüft ihre Freiheit unmittelbar vor dem Insert
in derselben Transaktion und leitet keine ID ab. Der Preflight von `0135`
führt die Bereichsverteilung deshalb mit (Zeilen 301–304).

## 0g. `0135` und `0136` auf Staging — angewendet und belegt (2026-10-19)

| | |
|---|---|
| Projekt | `qqxcpesbwfxzgytkdsac` |
| Weg | **ein Durchgang**: `supabase/operations/staging-0135-0136.sql`, manuell im SQL-Editor, `begin` … `commit` in der Datei |
| Eingebettet | `0135_catalog_item_type.sql` und `0136_business_backup_item_type.sql`, **zeichengleich** — geprüft von `src/lib/catalog/staging-oneshot.test.ts` |
| Ergebnis | Abschlussraster: **19 Bezugswerte unverändert**, einzige Änderung `sicherung_md5` |
| Betriebssicherung | `24c3810288bb20929fe995554a267adf` → `f6d08440707ba72a8040a8d1e666c092` — Stand `0131` → Stand `0136`, 28 Bereiche, **353** Feldzeilen |

**Was damit auf Staging gilt:** `skylanders.item_type` steht (Vorgabewert
`figure`, CHECK über fünf Werte), die 39 Spiele sind `game` — **aus der
Kategorie**, aus keinem Namen —, `is_shop_eligible()` verlangt zusätzlich
`item_type = 'figure'`, die Ableitungsregel
`catalog_item_type_for_category()` und ihr Trigger stehen, und die
Betriebssicherung führt `item_type` im Bereich `figures`.

**Was sich nicht bewegt hat**, gemessen vor und nach dem Lauf in derselben
Transaktion: shopfähige Zeilen, Angebote, Abdruck der Angebotsliste,
Fortschritts-Nenner gesamt und je Serie, Overrides und ihr Abdruck,
Katalogzeilen, Spiele-Zeilen, importierte Einkäufe, Positionen, Lagerzeilen,
Einheiten, Bewegungen, Importsumme, Eigenbelege, Zählerzeilen, Abrufnachweise.
Zusätzlich blockierend geprüft: `0133` und `0134` fehlen weiterhin, und die
Belegsperre ist unverändert dicht.

### Der erste Versuch brach ab — und das war richtig

```
ABBRUCH A7: der Z0-Vertrag stimmt nicht mehr — overrides ist 53, erwartet 39.
```

**Falsch abgeleiteter Sollwert, kein Datenbefund.** Z0 zählt die
`display_name_override` in `Z0_catalog_accessories_readonly.sql` Zeile 102
**innerhalb der CTE `spiel`** — also nur in der Kategorie `Spiele`. Die
Aussage „39, alle mit `display_name_override`" heißt: *jede der 39
Spiele-Zeilen trägt einen*. Eine **katalogweite** Zahl hat Z0 nie
festgehalten; der Vertrag hatte sie als solche gelesen. Katalogweit sind es
**53** — 39 Spiele plus 14 Figuren mit redaktionellem Anzeigenamen
(ADR-0030, ADR-0039).

Die vier anderen Vertragswerte haben **bestanden** (A7 bricht beim ersten
Treffer ab): `shopfaehig = 534`, `angebote = 256`, der Abdruck der
Angebotsliste und `sammelbar = 534`. Der Katalog war also in jeder Dimension
unverändert, die Z0 wirklich gemessen hat — und der Abbruch hat alles
zurückgerollt, wie vorgesehen.

**Berichtigt, ohne Abschwächung:** der Vertragswert ist jetzt die belegte
Aussage (**39 Spiele-Zeilen mit Override**, Zeile 915) — das ist strenger, denn
es fällt auch, wenn ein einzelner Spielname überschrieben würde. Die
katalogweite Zahl bleibt als Messung (916) und als Wert, der sich **während**
des Laufs nicht bewegen darf, zusammen mit ihrem `md5`. Neu im Raster:
`aenderungen_heute` aus `catalog_admin_changes` — eine redaktionelle
Namensänderung ist erlaubt und soll sichtbar sein, nicht blockieren.
Ursachenanalyse: `supabase/checks/z0_overrides_diagnosis.sql`.

### Offen bleibt

`0133` und `0134` auf Staging · `0134`, `0135` und `0136` auf Production ·
Z3 (Portale und Spiele als Katalogartikel) · Freigabe B (Belegausstellung
bleibt gesperrt).

## 1. Production — nur lesend, keine Freigabe über das Ausführen hinaus nötig

| # | Prüfung | Datei | Erwartung |
|---|---|---|---|
| P1 | Welche Migrationen sind wirklich angewendet? | `state_audit_readonly.sql` | **am 2026-10-18 bestanden**, mit der verschärften Belegrechte-Prüfung (Abschnitt 0c) |
| P2 | Nachlauf zu `0132` mit den korrigierten Prüfungen | `0132_postflight.sql` | **am 2026-10-18 bestanden, `9999 = 0`.** Erneut auszuführen nur wegen des berichtigten Stempels (Infozeile) |
| P3 | Ursachen der beiden Abweichungen mit Daten | `0132_diagnose_production.sql` | **am 2026-10-18 bestanden, `9999 = 0`** — einschließlich der neuen Zeile 3 (Testfiguren im öffentlichen Angebot = 0) |
| P4 | `0133`: Form, Zustand und Verträglichkeit des Triggers | `0133_production_readonly.sql` | **am 2026-10-18 bestanden, `9999 = 0`** — Trigger aktiv, Zahlungsschutz korrekt, ACL je `postgres=X/postgres` ohne NULL-ACL |
| P5 | Welcher Anwendungsstand ist ausgeliefert? | Vercel-Dashboard | **OFFEN** — `c24926e` oder `81386e6` |
| **P6** | Welche Testfigur, woran hängt sie, wirkt sie nach außen? | `fixture_audit_readonly.sql` | **am 2026-10-18 gelaufen.** 301 = 0, 305 = 0, keine Verknüpfung. `9999 = 1` **wegen einer falschen Annahme meiner Prüfung 112**, nicht wegen eines Befundes — berichtigt, Abschnitt 0c. Ein erneuter Lauf ist **nicht** nötig: die drei neuen Schutzzeilen messen, was der Lauf schon gezeigt hat (inaktiv, nicht shopfähig, kein Angebot) |
| **P7** | Was sind die 206 Positionen ohne `sky_id`, und was hängt an Spielen? | `accessory_audit_readonly.sql` | **am 2026-10-18 gelaufen**, Befunde in `docs/SKYLANDERS_DATA.md` (Abschnitt 11j) |

**Stand 2026-10-18: P1 bis P4, P6 und P7 sind geprüft.** Offen bleibt allein
**P5** (welcher Anwendungsstand ausgeliefert ist — nur im Vercel-Dashboard
ablesbar) — der
Production-Zustand ist damit nicht mehr nur gemeldet. **Offen bleiben P4
(abgebrochen), P5, P6 und P7.** Alle Messungen stammen aus Läufen des
Betreibers im SQL-Editor; aus diesem Repository heraus ist keine Datenbank
angefasst worden.

## 2. Staging — braucht Migrationen und damit eine Freigabe

| # | Prüfung | Voraussetzung | Erwartung |
|---|---|---|---|
| S0 | Belegsperre als Betriebsvorgang | — | **erledigt** — Abschnitt 0d |
| S1 | Eingangszustand und Eignung | `0132_preflight.sql`, `0132_staging_readiness.sql` | **erledigt**: je `9999 = 0`, 102 `true`, 402 `true`, 602 `0`, 603 `false`, 901 `true`, 902 `false`, 903 `true` |
| S2 | `0132` anwenden, Nachlauf | S1 | **erledigt** — Abschnitt 0e |
| S3 | **Schreibnachweis H1–H12** | S2 + `npm run dev:staging` | **OFFEN** — zwölf Fälle über die Oberfläche; `0132_test_plan.md` |
| S4 | `0133` anwenden, Nachlauf | S3 | **OFFEN** — `9999 = 0` in Pre- und Postflight |
| S5 | `0133_production_readonly.sql` auch auf Staging | S4 | **OFFEN** — `9999 = 0` |
| S6 | Zustandsabgleich beider Umgebungen | S4 | **OFFEN** — `state_audit_readonly.sql` liefert in beiden Projekten dieselben Fassungen |

**Nach dem Staging-Lauf von `0132` ist S3 der EINZIGE große offene Nachweis.**
Production ist gemessen, Staging trägt `0132`; was fehlt, ist der Beweis, dass
die Schreibwege tun, was sie sollen — und der ist auf Production nicht zu
führen.

**S3 ist der wichtigste offene Nachweis des ganzen Vorgangs.** Entfernen,
Nachtragen, Einbuchen und die Zahlungssperre sind bisher **nur lesend** belegt:
durch SQL-Text und durch 93 lokale Tests, nicht durch einen Schreibvorgang.
Auf Production darf er nicht geführt werden — H4 und H5 legen Positionen an und
buchen sie ein, und das wären erfundene Zeilen in der echten Geschäftshistorie.

## 2a. Die offenen Staging-Schreibtests, einzeln benannt

Keiner davon ist geführt. Alle brauchen `0132` auf Staging (S2) und laufen über
die Oberfläche mit `npm run dev:staging` — **nicht** im SQL-Editor, weil
`can_operate_active_seller()` dort an `auth.uid() = NULL` scheitert.

| Fall | was er beweisen muss |
|---|---|
| H1 | ein historischer Einkauf lässt sich **öffnen und bearbeiten** |
| H2 | **Verkäufer- und Absenderanschrift** nachtragen |
| H3 | **Inserat und Vereinbarung** ergänzen |
| H4 | eine **fehlende Figur hinzufügen** |
| H5 | die neue Figur **einbuchen, genau einmal** — Bestand steigt um 1 |
| H6 | die nachgetragene Figur **wieder entfernen** |
| H7 | eine **ursprüngliche Excel-Position bleibt geschützt** — Entfernen wird mit dem erklärenden Satz abgelehnt |
| H8 | **ihre Figur darf trotzdem korrigiert werden** (Figurenwechsel) |
| H9 | eine importierte Position wird **nicht erneut eingebucht** |
| H10 | die **bezahlte Summe ist unveränderlich** |
| H11 | die **Aufteilung lässt sich ergänzen**, ohne die Summe zu ändern |
| H12 | die **Belegausstellung bleibt zu** |

**Diese Zuordnung ist verbindlich und hat genau eine Quelle:**
`supabase/checks/0132_test_plan.md`. Eine frühere Fassung dieser Tabelle trug
eine andere Nummerierung — sie ist am 2026-10-18 an den Testplan angeglichen
worden. Wer H-Nummern nennt, nennt diese.

Vollständige Anleitung: `supabase/checks/0132_test_plan.md`. Reihenfolge und
Freigaben: `supabase/checks/0132_staging_plan.md`.

## 3. Was gar keinen Nachweis hat

| Gegenstand | Fehlt | Folge |
|---|---|---|
| `0134` | Preflight, Postflight, jede Umgebung | gesperrt (Betreiber, 2026-10-18) |
| `0137`, `0138` auf **Production** | Freigabe, Preflight, Lauf, Postflight | auf Staging seit dem 2026-10-20 angewendet (`APPLIED.md`). Auf Production fehlen sie, zusammen mit `0134`–`0136` |
| Zubehör in der Oberfläche | Deployment; Bedienprobe am Telefon | Anlegen aus dem Einkauf, Suche über die Art, der gemischte Einkauf und die Lagerübersicht sind in Unit-Tests und an **gelesenen** Staging-Daten belegt — aber an keinem Gerät bedient |
| Die Portalfreigabe | **nichts mehr** — am 2026-10-20 ausgeführt und unabhängig nachgeprüft (`portal_release_run.md`): 21 von 21 sichtbar, 30 ausgeblendete Figuren unverändert, 534 sammelbar, 256 Angebote ohne Portal. Als **anonymer Besucher** sind 594 Katalogzeilen lesbar statt 573 — das ist der Beweis, dass „öffentlich sichtbar" wörtlich gilt |
| Die Portalzuordnung | **nichts mehr** — am 2026-10-20 ausgeführt und unabhängig nachgeprüft (`portal_assignment_run.md`): 35 Positionen auf 11 Portalen, derselbe 15-Spalten-Abdruck `45340984792692b0cdfae951dd1ced48` wie vor dem Lauf, kein Bestand und keine Bewegung entstanden. Steht hier als **erledigt**, damit die Akte die Zeile nicht verliert |
| Zubehör in der Lagerübersicht | ein Lauf von `inventory_accessories_readonly.sql` | die Datei ist plangeprüft und im Probelauf P28/P29 gegen echtes PostgreSQL gefahren, und die Zahlen sind am 2026-10-20 direkt aus Staging **gelesen** (285 Lagerzeilen, davon 13 auf Spielen mit 19 Stück, keine außerhalb des Katalogs). Ein **Ergebnisblatt** aus dem SQL-Editor gibt es noch nicht — nach Abschnitt 3a gilt die Datei damit als nicht geprüft |
| Historische Bearbeitung in der Oberfläche | Deployment; Bedienprobe am Telefon | die Funktion ist auf Production nicht erreichbar |
| `tools/verify-rls.mts` Abschnitt 9.9 | Umstellung auf Richtung und Konstanz | die Prüfung schlägt seit dem Cutover vom 2026-09-21 zwangsläufig fehl (ADR-0127) |
| Wiederherstellbarkeit der Betriebssicherung | ein echter Restore | `restore_supported` bleibt `false`; Vorbedingung 4 der Freigabe B |
| Eigenbelege | fünf fachliche Vorbedingungen | **Freigabe B nicht erteilt**, Ausstellung in Oberfläche und Datenbank gesperrt |

## 3a. Was eine bestandene Planprüfung NICHT ist

`npm run verify:check-sql` plant jede Prüfdatei gegen ein echtes PostgreSQL
(PGlite, Stub-Schema aus den Migrationen, keine einzige Datenzeile). Besteht
eine Datei das, ist bewiesen: sie ist syntaktisch gültig, jeder Name löst auf,
jeder Typ passt, jede Signatur existiert.

**Bewiesen ist damit NICHT, dass die Datei auf Production läuft.** Ein Plan
sieht keine Laufzeitfehler an echten Daten, und ob eine Prüfung fachlich das
Richtige misst, sagt kein Planer. Eine Datei gilt in dieser Akte erst dann als
geprüft, wenn ein **Ergebnisblatt aus dem SQL-Editor** vorliegt — mit
Projektkennung und mit der Zeile `9999`.

Die Reihenfolge ist deshalb fest: Planprüfung lokal, dann Lauf im Editor, dann
Eintrag hier. Nicht umgekehrt, und keine Stufe ersetzt die nächste.

## 4. Was diese Prüfungen NICHT dürfen

* Keine Migration auf Production ohne gesonderte Freigabe.
* Keine Rücknahme von `0132` oder `0133`
  (`docs/history/2026-10-18-production-0132-0133.md`).
* Kein Abschalten eines Triggers, in keiner Umgebung.
* Keine Bestandskorrektur und keine Änderung an historischen Positionen, damit
  eine Prüfung grün wird.
* Keine Eigenbelege ausstellen.
