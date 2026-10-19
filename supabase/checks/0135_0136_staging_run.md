# Laufzettel: `0135` und `0136` auf Staging

**Umgebung:** Supabase-SQL-Editor, Projekt **`qqxcpesbwfxzgytkdsac`** (Staging).
**Production `zmiwxswrpkmizvqsgype` wird in diesem Lauf nicht geöffnet.**

**Stand dieses Zettels:** 2026-10-19. Beide Migrationen sind **nirgends
angewendet**. Dieser Zettel ist die Vorbereitung; die Ausführung braucht die
ausdrückliche Freigabe des Betreibers und erfolgt **manuell durch ihn**.

**Was in diesem Lauf nicht passiert:** keine Schreibtests (H1–H12), keine
Belegausstellung, keine Änderung an `RECEIPT_ISSUANCE_RELEASED`, keine
Aufhebung der Belegsperre, kein Katalogartikel für Portale oder Spiele (Z3),
keine neue SKY-ID, keine Änderung an einem `display_name_override`, kein
Deployment.

---

## Der kurze Weg: ein Skript, ein Einfügen

**`supabase/operations/staging-0135-0136.sql`** ist dieser ganze Laufzettel als
**eine** Datei: `begin`, Vorprüfungen, `0135`, `0136`, Nachprüfungen,
Ergebnisraster, `commit`. Die beiden Migrationen sind darin **zeichengleich**
eingebettet (geprüft von `src/lib/catalog/staging-oneshot.test.ts`), und jede
eigene Prüfung ist ein `raise` — kein Raster, das man überlesen kann.

```
1.  supabase/operations/staging-0135-0136.sql   vollständig einfügen, ausführen
2.  das Ergebnisraster ins Protokoll
```

**Jeder Fehler rollt alles zurück**, es gibt keinen Halbzustand. Nach einem
Fehler: `rollback;` — danach ist nichts geschehen, und die Meldung sagt mit
`ABBRUCH A…`/`ABBRUCH D…`, welche Prüfung angeschlagen hat. Wer dann wissen
will, *wo* genau es klemmt, fährt die Prüfdatei aus der Tabelle unten.

Nachgefahren in PostgreSQL 18.6 (`npm run verify:check-sql`, P21): einmal
durch, und einmal mit unverändertem Z0-Vertrag — dann **muss** er anschlagen
und alles zurückrollen.

**Der lange Weg unten bleibt gültig** und ist die Wahl, wenn Sie Schritt für
Schritt sehen wollen, was passiert, oder wenn `0135` schon steht und nur `0136`
fehlt.

---

## Die Dateien, mit vollständigem Pfad

| Rolle | Datei |
|---|---|
| Wächter (vor **und** nach dem Lauf) | `supabase/checks/staging_pending_migrations.sql` |
| Preflight `0135` | `supabase/checks/0135_preflight.sql` |
| **Migration `0135`** | `supabase/migrations/0135_catalog_item_type.sql` |
| Postflight `0135` | `supabase/checks/0135_postflight.sql` |
| Preflight `0136` | `supabase/checks/0136_preflight.sql` |
| **Migration `0136`** | `supabase/migrations/0136_business_backup_item_type.sql` |
| Postflight `0136` | `supabase/checks/0136_postflight.sql` |
| Abdruck der Sicherungsfunktion | `supabase/checks/0131_function_body_check.sql` |
| Belegsperre | `supabase/checks/receipt_lock_check.sql` |
| Dateninvarianten | `supabase/checks/0132_postflight.sql` |
| Bestandsaufnahme ohne Sollwert | `supabase/checks/state_audit_readonly.sql` |
| Rücknahme Sicherung → `0131` | `supabase/rollback/R0136_back_to_0131.sql` |
| Rücknahme Spalte | `supabase/rollback/R0135_drop_item_type.sql` |
| **beides in einem Durchgang** | `supabase/operations/staging-0135-0136.sql` |

**Vor dem ersten Schritt, lokal:** `npm run verify:sums` muss „alle
Prüfsummen stimmen" melden. Nur dann ist die Datei im Editor dieselbe, die
geprüft wurde.

---

## Die Reihenfolge

```
S0   staging_pending_migrations.sql          lesend     Wächter + Umgebungsstempel
S1   0135_preflight.sql     (+ Vertrag)      lesend
S2   0135_catalog_item_type.sql              SCHREIBT   begin … commit
S3   0135_postflight.sql    (+ Vertrag)      lesend
S4   0136_preflight.sql     (+ Vertrag)      lesend
S5   0136_business_backup_item_type.sql      SCHREIBT   begin … commit
S6   0136_postflight.sql    (+ Vertrag)      lesend
S7   0131_function_body_check.sql            lesend     Abdruck, Befund STAND_0136
S8   receipt_lock_check.sql                  lesend     Belegsperre unberührt
S9   0132_postflight.sql                     lesend     Dateninvarianten
S10  staging_pending_migrations.sql          lesend     Wächter erneut
S11  state_audit_readonly.sql                lesend     Protokollaufnahme
```

**Nach S3 darf unterbrochen werden.** `0135` ist ohne `0136` ein vollständiger,
in sich geschlossener Zustand — die Sicherung führt dann weiter 352 Felder.
Umgekehrt nicht: `0136` ohne `0135` bricht ab (S4 fängt das ab, und die
Migration selbst noch einmal).

---

## Der Transaktionsrahmen — zwei Formen, nicht verwechseln

### Lesende Prüfdatei mit Vertrag (S1, S3, S4, S6)

**Eine** Einreichung, zwei Anweisungen, **kein** `begin`/`commit`:

```sql
select set_config('skyisles.z0', 'staging', true);

-- << hier den VOLLSTÄNDIGEN Inhalt der Prüfdatei einfügen >>
```

**Warum das reicht:** PostgreSQL führt eine Anweisungsfolge, die als **eine**
Einreichung ankommt, als **eine implizite Transaktion** aus — nachgestellt in
PostgreSQL 18.6. `set_config(…, true)` wirkt transaktionslokal und gilt damit
für das folgende SELECT; nach der Einreichung ist der Parameter wieder fort.
Auf dasselbe Verfahren baut `0124_baseline.sql` in diesem Repository.

Das Ergebnisraster zeigt die **letzte** Anweisung, die Zeilen liefert — darum
steht das SELECT zuletzt und **kein `rollback;` darunter**.

**Und es sagt selbst, ob es funktioniert hat.** Zeile **902** liest den
Vertragsmodus: steht dort `nein: set_config('skyisles.z0', 'staging', true)
fehlt`, obwohl die Zeile im Fenster stand, dann hat der Editor die Anweisungen
GETRENNT geschickt. Dann — und nur dann — die ausdrückliche Klammer nehmen:

```sql
begin;
  select set_config('skyisles.z0', 'staging', true);

  -- << hier den VOLLSTÄNDIGEN Inhalt der Prüfdatei einfügen >>
rollback;
```

Das Raster liegt dann beim vorletzten Ergebnis; `rollback` ist unbedenklich,
weil keine dieser Dateien schreibt. Es gibt damit keinen Weg, den Vertrag
unbemerkt zu verlieren: entweder 902 sagt `ja`, oder die Datei blockiert.

**Der Vertrag gehört zur Prüfdatei, nicht zur Migration.** In der
Migrationsklammer hätte die Zeile keine Wirkung und würde nur den Eindruck
erwecken, die Migration prüfe ihn.

### Migration (S2, S5)

**Eine** Einreichung, vollständig geklammert:

```sql
begin;

-- << hier den VOLLSTÄNDIGEN Inhalt der Migrationsdatei einfügen >>

commit;
```

**Vollständig heißt vollständig.** Kein markierter Teil, keine zwei
Einreichungen, keine Zeile weggelassen. Beide Migrationen prüfen das selbst:
sie legen als erste Anweisung eine temporäre Tabelle mit `on commit drop` an
und brechen ab, wenn sie unmittelbar danach schon wieder fort ist — der Fall
„jede Anweisung ihre eigene Transaktion". Es gibt deshalb keinen Weg, sie halb
anzuwenden.

**Zwischen `begin` und `commit` ist nichts endgültig.** Wer vor dem `commit`
abbrechen will, schickt `rollback;` — danach ist nichts geschehen.

---

## Die fünf Vertragswerte

Z0 hat am 2026-10-19 auf Staging gemessen
(`supabase/checks/open_verifications.md`, Abschnitt 0f):

| Größe | Wert | geprüft in Zeile |
|---|---|---|
| shopfähige Zeilen | **534** | 911 |
| öffentliche Angebote | **256** | 912 |
| Abdruck der Angebotsliste | **`4d1d6c30fe0ae886ca2689bcb1fe9634`** | 913 |
| sammelbare Artikel (Fortschritts-Nenner) | **534** | 914 |
| **Spiele**-Zeilen mit `display_name_override` | **39** | 915 |

*(Berichtigt am 2026-10-19: die 39 sind **spielebezogen**. Katalogweit sind es
53 — Z0 hat diese Zahl nie festgehalten, sie steht als Messung in Zeile 916.
Begründung in `open_verifications.md`, Abschnitt 0f.)*

**Diese fünf Zahlen stehen in den Prüfdateien selbst** — versioniert,
prüfsummiert, nachlesbar. Eingetippt wird nur, **ob** sie gelten:

```sql
select set_config('skyisles.z0', 'staging', true);
```

Ein Sollwert, den der Bediener bei jedem Lauf mitliefert, wäre bei jedem Lauf
eine neue Gelegenheit für einen Tippfehler — und ein Tippfehler in der
**Erwartung** lässt die Prüfung bestehen. Darum nur der Modus.

**Fehlt die Zeile, ist die Prüfdatei blockierend:** Zeile 902 meldet
`nein: set_config('skyisles.z0', 'staging', true) fehlt`, und `9999` ist nicht
0. Es gibt damit keinen Lauf, der die fünf Werte still übergeht. Der Modus
`keine` ist der ausdrückliche Verzicht — er gehört nach Production, wo andere
Zahlen gelten, nicht in diesen Lauf.

Nachgefahren: `npm run verify:check-sql` prüft genau das in drei Durchgängen
(P9 ohne Modus → blockierend, P10 mit `keine` → grün, P11 mit `staging` gegen
erfundene Zahlen → **fünf** Abweichungen).

---

## S0 — Wächter und Umgebungsstempel

`supabase/checks/staging_pending_migrations.sql`, ohne Vertrag, ohne Klammer.

**`9999 = 0`.** Dazu einzeln lesen:

| Zeile | erwartet | Bedeutung |
|---|---|---|
| 101 | `true` | `SKY-0821` **und** `SKY-0822` vorhanden — auf Production bewusst nicht. **Ist das `false`, ist das falsche Projekt offen: abbrechen.** |
| 201 / 202 | `0132` | `0132` steht (Staging wurde am 2026-10-18 nachgezogen) |
| 211 | `FEHLT` | **`0133` ist nicht angewendet** — die Funktion `purchases_paid_total_is_final` gibt es nicht |
| 212 | `0` | **`0133` ist nicht angewendet** — der Trigger `purchases_paid_total_immutable_trg` gibt es nicht |
| 221 | `0119` | **`0134` ist nicht angewendet** — `seller_purchase` ist die Fassung aus `0119` |
| 222 | `false` | **`0134` ist nicht angewendet** — der Rumpf gibt `source_row` nicht aus |
| 231 | `fehlt` | `item_type` gibt es noch nicht (Messung) |
| 232 | `0131` | Stand der Sicherung (Messung) |

Zusätzlich die **Projektkennung aus der Adresszeile** ins Protokoll. Der
Stempel in Zeile 101 ist ein Hinweis, kein Beweis.

**Abbruch, wenn:** `9999 ≠ 0`, oder 101 ist `false`, oder 211/212/221/222
weichen ab. Eine Abweichung dort heißt: die Lage ist anders als dieser Zettel
annimmt, und dann wird nichts geschrieben.

## S1 — Preflight `0135`

`supabase/checks/0135_preflight.sql`, **mit** Vertragszeile.

**`9999 = 0`.** Dazu notieren, für den Vergleich in S3:

| Zeile | erwartet / zu notieren |
|---|---|
| 101 / 102 / 103 | `true`, `true`, `Spiele` — die Grundlage aus `0001` und `0008` |
| 104 / 105 / 107 | **`true`** — Spalte, CHECK und die Typbedingung fehlen **noch**. Die Prüfung heißt „fehlt noch", und `true` ist ihre Bestätigung |
| 112 | Info: `STAND_0131` (die Sicherung ist noch die aus `0131`) |
| 201 / 202 / 203 / 204 | **notieren**: Spiele-Zeilen (erwartet 39), Katalogzeilen (605), Overrides (39), Abdruck der Overrides |
| 303 | `0` — der ZB-Bereich `SKY-0615`–`SKY-0642` ist frei |
| 601 / 602 / 603 | **notieren**: 534, 256, `4d1d6c30…9634` |
| 604 / 605 | `0`, `0` — keine Nicht-Figur shopfähig, kein Spiel im Angebot |
| 701 / 702 | **notieren**: 534, Nenner je Serie |
| 801 / 802 | **notieren**: Lager und Belege |
| 911–915 | **der Vertrag: alle fünf `true`** |

**Abbruch, wenn:** `9999 ≠ 0`. Insbesondere ein `false` in 911–915 heißt: der
Katalog hat sich seit Z0 bewegt — dann ist Z0 neu zu erheben, nicht die
Migration zu fahren.

## S2 — Migration `0135`

`supabase/migrations/0135_catalog_item_type.sql`, in `begin` / `commit`.

**Erwartete Meldungen** (`NOTICE`, im Reiter *Messages*):

```
0135 Abdruck: 534 shopfaehig, 256 Angebote, md5 4d1d6c30…, 534 sammelbar
0135: item_type steht, 39 Spiele markiert, Angebote unveraendert (md5 4d1d6c30…)
```

Die Migration prüft in **ihrer eigenen** Transaktion: Angebotszahl,
Angebotsabdruck, shopfähige Zeilen, Nenner, Nenner je Serie, Abdruck der
Overrides, Katalogzeilen und die Zahl der Spiele-Zeilen. Weicht einer ab,
bricht sie ab und **die Transaktion rollt alles zurück** — Spalte, CHECK,
Kommentar, Backfill und Funktionsänderung.

**Abbruch, wenn:** irgendeine Meldung mit `0135 Abbruch:` erscheint. Dann
`rollback;` (siehe *Wenn SQL fehlschlägt*), Meldungstext vollständig
übernehmen, nichts von Hand nachziehen.

## S3 — Postflight `0135`

`supabase/checks/0135_postflight.sql`, **mit** Vertragszeile.

**`9999 = 0`**, und gegen die Notizen aus S1:

| Zeile | erwartet |
|---|---|
| 104 / 105 / 108 | `true` — Spalte, CHECK und die fünf erlaubten Werte stehen |
| 107 / 109 | `true` — `is_shop_eligible` prüft `item_type` **und** behält die Kategoriebedingung |
| 110 / 111 | `true` — `anon` und `authenticated` dürfen ausführen, ACL materialisiert |
| 112 | **`STAND_0131`** — `0135` fasst die Sicherung nicht an. Erst `0136` tut das |
| 205 | `figure=566, game=39` (Zeilen je Artikeltyp; die Summe ist 605) |
| 206 / 207 / 208 / 209 | `true`, `0`, `0`, `0` — der Backfill traf genau die Spiele |
| 202 / 203 / 204 | **unverändert** gegenüber S1 |
| 601 / 602 / 603 | **unverändert** gegenüber S1 |
| 701 / 702 | **unverändert** gegenüber S1 |
| 801 / 802 | **unverändert** gegenüber S1 |
| 911–915 | alle fünf `true` |

**Abbruch, wenn:** `9999 ≠ 0`, oder eine der als „unverändert" markierten
Zeilen weicht von S1 ab. Rücknahme wäre `supabase/rollback/R0135_drop_item_type.sql`
— **nicht** ohne neue Freigabe.

## S4 — Preflight `0136`

`supabase/checks/0136_preflight.sql`, **mit** Vertragszeile.

**`9999 = 0`.** Die tragenden Zeilen:

| Zeile | erwartet |
|---|---|
| 102 | `24c3810288bb20929fe995554a267adf` — die Sicherung ist der Stand `0131` |
| 103 | `21458` |
| 104 | `6b980ac961d1d6ac704587ecc6e9524f` (Funktionskommentar) |
| 105 / 106 | `28` Bereiche, `352` Feldzeilen |
| 107 | der Bereich `figures` mit **neun** Feldern, in dieser Folge |
| 108 | `0` — der Rumpf nennt `item_type` noch nicht |
| 111–114 | `true`, `true`, `0`, `true` — `0135` steht, nur `figure`/`game` |
| 121–127 | Form und Vertrag: `s`, `true`, `(leer)`, `0`, `jsonb`, `true`, `true` |
| 131 / 132 | `0` — die Sicherung schreibt nichts |
| 141–143 | `true`, `0`, `true` — ACL materialisiert, kein PUBLIC/`anon`, `authenticated` darf |
| 151 / 152 / 153 | `0`, `9`, `0` — die neun privaten Felder **nur** im Belegsnapshot |
| 401 | `STAND_0131` |

**Abbruch, wenn:** `9999 ≠ 0`. Ein `FEHLT` oder ein abweichender Abdruck in
102 heißt: die Sicherung ist nicht der Stand, den `0136` voraussetzt.

## S5 — Migration `0136`

`supabase/migrations/0136_business_backup_item_type.sql`, in `begin` / `commit`.

**Erwartete Meldungen:**

```
0136: Vorbedingungen erfuellt — 28 Bereiche, 352 Feldzeilen, figures mit
      9 Feldern, 27 andere Bereiche als Abdruck <md5>
0136 ok: der Bereich figures traegt item_type, 28 Bereiche, 353 Feldzeilen,
      die 27 anderen Bereiche unveraendert (Abdruck <derselbe md5>)
```

**Die beiden `<md5>` müssen gleich sein.** Das ist der Beweis der Migration
über sich selbst: 27 Bereiche tragen danach Zeichen für Zeichen dieselben
Feldzeilen in derselben Folge.

**Abbruch, wenn:** irgendeine Meldung mit `0136 Abbruch:` erscheint. Besonders
aussagekräftig sind drei:

* `setzt 0135 voraus: skylanders.item_type fehlt` → S2 wurde nicht gefahren.
* `schon angewendet — der lebende Rumpf IST der aus 0136` → die Migration lief
  bereits; nichts tun.
* `der lebende Rumpf ist nicht der aus 0131 (md5 …)` → erst
  `0131_function_body_check.sql` lesen, dann entscheiden.

## S6 — Postflight `0136`

`supabase/checks/0136_postflight.sql`, **mit** Vertragszeile.

**`9999 = 0`.** Gegenläufig zu S4:

| Zeile | erwartet |
|---|---|
| 102 | `f6d08440707ba72a8040a8d1e666c092` |
| 103 | `21494` |
| 104 | `c12618f312b413571eeabe912ca03651` |
| 105 / 106 | `28` Bereiche, `353` Feldzeilen |
| 107 | der Bereich `figures` mit **zehn** Feldern — `item_type` direkt nach `card_type` |
| 108 | `1` |
| 121–153 | **unverändert** gegenüber S4 |
| 401 | `STAND_0136` |
| 911–915 | alle fünf `true` — die Sicherung hat am Shop nichts geändert |

## S7 — Der Abdruck, zum zweiten Mal und aus der anderen Datei

`supabase/checks/0131_function_body_check.sql`, ohne Vertrag.

**`9999 = 0`**, Zeile **101 = `1`** (der Rumpf ist zeichengleich **einem**
bekannten Stand), Zeile **105 = `ja`** (und dieser Stand ist freigegeben),
Zeile **401 = `STAND_0136_ZEICHENGLEICH`**.

Diese Datei prüft dasselbe wie S6, aber aus einer anderen Richtung: sie hält
die lebende Definition gegen die **Tabelle** der bekannten Stände. Ein
`UNBEKANNT` in 401 bei `9999 = 0` ist unmöglich — 101 fängt es ab.

## S8 — Die Belegsperre

`supabase/checks/receipt_lock_check.sql`, ohne Vertrag.

**`9999 = 0`:** `anon`, `authenticated`, `service_role` und PUBLIC dürfen
weder ausstellen noch korrigieren, `postgres` behält EXECUTE, 0 schreibende
Belegtrigger, 2 Unveränderlichkeits-Trigger. Dasselbe Ergebnis wie am
2026-10-18 (Abschnitt 0d/0e).

**`RECEIPT_ISSUANCE_RELEASED` bleibt `false`, Freigabe B bleibt verweigert.**
Weder `0135` noch `0136` berührt eine Belegtabelle, ein Belegrecht oder einen
Belegtrigger.

## S9 — Die Dateninvarianten

`supabase/checks/0132_postflight.sql`, ohne Vertrag.

**`9999 = 0`**, und die Bezugswerte gegen Abschnitt 0e:

| Größe | Wert vom 2026-10-18 |
|---|---|
| importierte Einkäufe / Positionen | **84 / 2 114** |
| Lagerzeilen / Einheiten / Bewegungen | **285 / 812 / 26** |
| Importsumme `total_cost` | **4476.39** |
| Eigenbelege / Zählerzeilen / Abrufnachweise | **2 / 1 / 7** |

**Diese Zahlen dürfen sich in diesem Lauf nicht bewegen.** `0135` schreibt
genau eine Spalte auf `skylanders`, `0136` keine Zeile. Eine Abweichung ist
nur erklärbar, wenn zwischen dem 2026-10-18 und heute ein **dokumentierter**
Schreibtest gelaufen ist (H4/H5 legen eine Position an und buchen sie ein).
Ohne solche Dokumentation ist eine Abweichung ein Befund.

## S10 — Der Wächter erneut

`supabase/checks/staging_pending_migrations.sql`.

**`9999 = 0`**, und die vier Zeilen zu `0133`/`0134` **unverändert** wie in S0:
**211 = `FEHLT`, 212 = `0`, 221 = `0119`, 222 = `false`.** Damit ist belegt,
dass dieser Lauf an den beiden ausstehenden Migrationen nichts geändert hat.

Zeile 231 ist jetzt `steht`, Zeile 232 `0136` — die beiden Messzeilen, die sich
ändern **dürfen**.

## S11 — Protokollaufnahme

`supabase/checks/state_audit_readonly.sql`. Diese Datei hat **kein** `9999`:
sie stellt fest. Zeile 13 muss `0136   md5 f6d08440…` zeigen, Zeile 16
`FEHLT`, Zeile 17 `0119`.

Ergebnis vollständig nach `supabase/checks/open_verifications.md`.

---

## Wenn SQL fehlschlägt

**Der wichtigste Fall: die Transaktion ist abgebrochen.** Nach einem Fehler
innerhalb von `begin` / `commit` antwortet PostgreSQL auf **jede** weitere
Anweisung mit

```
25P02  current transaction is aborted, commands ignored until end of
       transaction block
```

Das ist **kein zweiter Fehler** und keine Kettenreaktion — es ist die normale
Sperre. Die einzige richtige nächste Anweisung ist:

```sql
rollback;
```

Danach ist **nichts** geschehen: keine Spalte, kein CHECK, kein Kommentar,
kein Backfill, keine Funktionsänderung, keine Hilfstabelle. Die
Temporärtabelle verschwindet mit der Transaktion (`on commit drop` gilt für
`commit` **und** `rollback`).

**Dann, in dieser Reihenfolge:**

1. Die **erste** Fehlermeldung vollständig übernehmen — Code und Text. Alle
   folgenden `25P02` sind Rauschen.
2. **Nichts von Hand nachziehen.** Kein einzelnes `alter table`, kein
   `create or replace function`, kein „nur die eine Zeile". Eine halb
   angewendete Migration ist der Zustand, den dieser ganze Aufbau verhindert.
3. Den Lauf **nicht blind wiederholen**. Die Vorbedingungen erkennen einen
   zweiten Lauf (`die Spalte item_type steht schon`, `schon angewendet`) und
   brechen ab — aber die Ursache des ersten Abbruchs ist damit nicht geklärt.
4. Ergebnis melden. Die Entscheidung über den nächsten Schritt trifft der
   Betreiber.

**Die Fehlerbilder, die zu erwarten sind:**

| Code | Bedeutung | richtige Reaktion |
|---|---|---|
| `P0001` + `0135 Abbruch:` / `0136 Abbruch:` | eine Vor- oder Nachbedingung hat angeschlagen. Der Text sagt, welche | `rollback;`, Text übernehmen |
| `25P02` | Folgefehler nach dem ersten Fehler | `rollback;` — nicht interpretieren |
| `55P03 lock_not_available` | `alter table … add column` kam nicht an die Sperre; `lock_timeout` von 5 s hat zugeschlagen, weil eine andere Abfrage auf `skylanders` lief | `rollback;`, später erneut — **harmlos**, die Grenze existiert genau dafür |
| `42703 column … does not exist` | bei `0136`: `0135` fehlt. Sonst: Datei nicht vollständig eingefügt | `rollback;`, S0/S4 erneut lesen |
| `42P07` / `42701` „already exists" | der Lauf wurde wiederholt | `rollback;`, Stand über S0 und S7 feststellen |
| `25001` / „cannot run inside a transaction block" | tritt hier nicht auf — keine der Dateien enthält eine solche Anweisung | melden |

**Wenn `commit` selbst fehlschlägt:** dann ist nichts angewendet. Das ist der
Normalfall, kein Sonderfall.

**Wenn die Verbindung während der Migration abbricht:** PostgreSQL rollt eine
offene Transaktion beim Verbindungsende zurück. Danach S0, S1 und S7 lesen und
den Stand feststellen, bevor irgendetwas erneut läuft.

---

## Rücknahme

Nur nach ausdrücklicher Freigabe, und **nur in dieser Reihenfolge**:

```
1.  supabase/rollback/R0136_back_to_0131.sql     begin … commit
2.  supabase/rollback/R0135_drop_item_type.sql   begin … commit
```

`R0135` **verweigert** den Lauf, solange die Sicherung `item_type` liest, und
sagt, welche Datei zuerst gehört. Der Grund: PostgreSQL vermerkt für einen
`language sql`-Rumpf keine Abhängigkeit auf die gelesenen Spalten — ein
`drop column` gelingt, und die Sicherung scheitert erst beim **Aufruf**.

Nach einer Rücknahme: `0131_function_body_check.sql` muss
`STAND_0131_ZEICHENGLEICH` melden, `staging_pending_migrations.sql` Zeile 231
`fehlt`.

---

## Was lokal nachgewiesen ist — und was dieser Lauf erst zeigt

`npm run verify:check-sql` fährt vier Stufen und **14 Durchgänge** gegen
PostgreSQL 18.6 (PGlite, erfundene Zeilen, keine Daten aus einer echten
Datenbank): Plan, Funktionsdefinitionen, die Migrationen in einer
Transaktion, die Gegenproben (ohne Klammer, bei verändertem Angebot, falsche
Reihenfolge, Rücknahmereihenfolge), der Z0-Vertrag und beide Flüge zu `0136`
gegen **beide** Stände.

**Das ist kein erfolgreicher Lauf gegen Staging.** Was PGlite nicht kennt:
die echten 605 Katalogzeilen, die echten Rechte, die echten Trigger, die
Supabase-Version und jeden Laufzeitfehler, den erst Daten auslösen. Nachweis
bleibt allein das Ergebnisblatt aus dem SQL-Editor
(`supabase/checks/open_verifications.md`).
