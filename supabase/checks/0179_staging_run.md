# Laufzettel — 0179 (Analysewerte nur mit Nachweis) auf Staging

**Stand (2026-11-05): auf Staging angewendet, vollständig verifiziert und ABGENOMMEN.** Preflight
beider Rollen bestanden (`postgres`: 9998 = `0`, 9999 = `0`), berechtigter Postflight 9998 = `0`,
9999 = `0`, funktionale Leseabnahme 45 von 45. Nachweis auch in `supabase/migrations/APPLIED.md`.
**Production (`zmiwxswrpkmizvqsgype`): nicht angewendet, nicht angesprochen** — eigene, spätere Entscheidung.

| | |
|---|---|
| Zielprojekt | Staging `qqxcpesbwfxzgytkdsac` (Stempel `skyisles-staging qqxcpesbwfxzgytkdsac`). Production `zmiwxswrpkmizvqsgype` wurde nicht angesprochen. |
| Commit | `5c6284e` (`feat(0179): a value at analysis only with proof (local, not applied)`), Branch `development/skyisles-v2` |
| Datum | 2026-11-04, 19:20 UTC |
| Zugang | lesender Prüfzugang `skyisles_agent`, Sitzung schreibgeschützt, TLS `verify-full`, jede Datei in `begin … rollback` |
| Preflight | `supabase/checks/0179_preflight.sql`, 289 Zeilen, SHA-256 `f96cdf6fbadf9217ba39bed6d78f10daf9272237f1b854f9ca8f8f4082b94a1b` |
| Befehl | `npm run db:migrate:staging -- 0179` (Protokoll `supabase/log/staging/migrate-0179-2026-11-04T19-20-59-937Z.md`, ungetrackt) |
| Baselines | eingefroren in `supabase/baselines/baseline-0179.json` (SHA-256 `2efdb69947de5f1e376ae9ff1643e29e59436ed866290217380ba0ca15d7fdd8`) — vom Runner aus dem gemessenen Staging-Stand geschrieben, ab hier unverändert, nach der Migration NIE neu erheben |

## Vorab geprüft (2026-11-04)

- Branch `development/skyisles-v2`, HEAD `5c6284e`, Arbeitsbaum sauber (nur die zwei geschützten
  ungetrackten Pfade).
- Unverändert seit `5c6284e` und gleich `SHA256SUMS.txt` / `APPLIED.md`:
  Migration `04e6f0399e0f0ea9d78ff6fdd515928743611685e7b81c41ab7203cb021582c9`,
  Hülle `supabase/operations/staging-0179.sql` (524 Zeilen) `499983443d9d2e624785936cbabeb59898a1bf0d01da1c34a1aa4dfed7b73d47`,
  Postflight `756c0199478618d666920b8815f2db90aa2f00e0f63e719f590b72ea27b3ef12`,
  Rückbau `751751a9bf124ca5c011c2447711c544c0f7b735fdb72f24542a3b838316a817`.
- `npm run verify:sums`: 555 Dateien, alle Prüfsummen stimmen.
- Ziel: der Runner verband sich mit `qqxcpesbwfxzgytkdsac` (Stempel wie oben); Runner-Stand
  „`sales_recon_ledger(bigint)` steht → nein“ — 0179 nicht angewendet.
- Der Runner hielt nach dem Preflight an und nannte die Einfüge-Hülle. **Ihr wurde nicht gefolgt** —
  keine Anwendung freigegeben.

## Was 0179 tut

Ersetzt den Rumpf von `seller_recon_session` (`d70ee33c…` aus `0178` → `5ed52447…`; Signatur, Rechte
und jeder Schlüssel bleiben) und legt `sales_recon_ledger(bigint)` (`07875fe3…`) und
`sales_recon_proven(jsonb, text, jsonb, boolean)` (`b7b36ccd…`) ohne Clientrecht an. Rein lesend,
keine Datenanweisung. Pending, Decide, Apply, `sales_recon_pending_set`, `sales_recon_sale_values`
und `sales_recon_at_analysis` bleiben unverändert.

## Ergebnis des lesenden Preflights (Prüfzugang)

**9999 = `0`** (keine blockierende Abweichung unter den geprüften Zeilen), **9998 = `11`** (elf
Zeilen nicht geprüft — **nicht** als bestanden gewertet). Die Werte sind vollständig über das
lesende Prüfwerkzeug (`fahreEintrag`, dieselbe Datei, dieselbe Rolle) erhoben, nicht nur die
offenen Zeilen des Protokolls.

| Nr | Prüfung | Istwert | Soll | Ergebnis |
|---|---|---|---|---|
| 1 | Info: Katalogzeilen | `658` | — | Auskunft |
| 101 | `seller_recon_session` = Rumpf aus 0178 | `d70ee33c2b740aa811704ad5e561a34e` | dasselbe | ok |
| 102 | `seller_recon_apply` = Rumpf aus 0173 | `f8b1132c27ba1b18123f6c2548f9997c` | dasselbe | ok |
| 103 | `seller_recon_decide` = Rumpf aus 0172 | `2526d3a77ccf3153158182d0ecd391aa` | dasselbe | ok |
| 104 | `seller_recon_pending` = Rumpf aus 0178 | `51213fd88afb5441a487dc89bba2ac06` | dasselbe | ok |
| 105 | `sales_recon_at_analysis`, `sales_recon_sale_values` = Rümpfe aus 0178 (in dieser Reihenfolge) | `192dedca6ea258b54c6108ccbcd2d149,4c4a01eb05adb6d439450063f04eada9` | dasselbe | ok |
| 106 | Verkäufersperre steht (`sales_recon_gate`, `can_operate_active_seller`) | `true` | `true` | ok |
| 107 | `seller_recon_session`: nur `authenticated`, nicht `anon`/PUBLIC | `true` | `true` | ok |
| 108 | `seller_recon_session`: SECURITY DEFINER, ein leerer `search_path` | `true` | `true` | ok |
| 111 | `sales_recon_ledger` steht noch nicht | `true` | `true` | ok |
| 112 | `sales_recon_proven` steht noch nicht | `true` | `true` | ok |
| 131 | Abgleichssitzungen | `KEIN-RECHT` | — | **nicht geprüft** |
| 132 | Abgleichsdateien | `KEIN-RECHT` | — | **nicht geprüft** |
| 133 | Abgleichsbestellungen | `KEIN-RECHT` | — | **nicht geprüft** |
| 134 | Zuordnungen | `KEIN-RECHT` | — | **nicht geprüft** |
| 135 | Befunde | `KEIN-RECHT` | — | **nicht geprüft** |
| 136 | Entscheidungen | `KEIN-RECHT` | — | **nicht geprüft** |
| 137 | Übernahmen | `KEIN-RECHT` | — | **nicht geprüft** |
| 141 | Verkäufe | `KEIN-RECHT` | — | **nicht geprüft** |
| 142 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | — | Auskunft |
| 143 | Erstattungen | `KEIN-RECHT` | — | **nicht geprüft** |
| 144 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | — | Auskunft |
| 145 | Altbestandsereignisse | `KEIN-RECHT` | — | **nicht geprüft** |
| 146 | Orderbuch-Journal | `KEIN-RECHT` | — | **nicht geprüft** |
| 151 | Rechte/Definer/`search_path` aller Funktionen in `public` (ohne die zwei neuen) | `dec2c48cfbce7a8866861d019d0a663e` | — | Auskunft |
| 152 | Rechte und RLS-Schalter aller Tabellen, Sichten, Sequenzen in `public` | `6b1de419eb568f90971d8677ce49c0d0` | — | Auskunft |
| 153 | alle Policies in `public` (Verkäufer, Sammlung, alles) | `3978d0fc1c1b46d497fba620c8f53cd2` | — | Auskunft |
| 301 | öffentliche Angebote | `257` | — | Basis |
| 302 | Angebots-Abdruck | `76f027a6a335b9f8599955dbb371d943` | — | Basis |
| 303 | shopfähige Katalogzeilen | `594` | — | Basis |
| 304 | sammelbare Katalogzeilen | `594` | — | Basis |
| 305 | Lagerzeilen | `286` | — | Basis |
| 306 | Katalogzeilen | `658` | — | Basis |
| 307 | Lager-Abdruck | `8793a9e2abd76190c23bcb24e64f6e74` | — | Basis |
| 311 | freigegebene Lagerpositionen | `0` | `0` | ok |
| 401 | keine Grants auf die Belegtabellen für `anon`/`authenticated` | `0` | `0` | ok |
| 900 | Shop-Baseline | `skyisles-base-1\|257\|76f027a6a335b9f8599955dbb371d943\|594\|594\|286\|658\|8793a9e2abd76190c23bcb24e64f6e74\|1216ff0082a7` | — | eingefroren |
| 901 | Sammlungs-Baseline | `skyisles-coll-1\|21\|1\|965b149286b4e61212ef48a94a8bab01\|bfa156bc6cb3` | — | eingefroren |
| 9998 | nicht lesbare Zeilen | `11` | `0` für `postgres` | Prüfzugang: 11 ungemessen; als `postgres` `0` (unten) |
| 9999 | blockierende Abweichungen | `0` | `0` | ok |

### Drei Arten von Befund — getrennt

1. **Nicht lesbar für den Prüfzugang (11 Zeilen, `KEIN-RECHT`):** 131–137, 141, 143, 145, 146. Der
   Prüfzugang hat auf diese Tabellen bewusst kein `select`. Das ist **keine Abweichung und kein
   Bestehen** — die Zeilen sind ungemessen.
2. **Echte Abweichungen: keine.** Alle 15 blockierenden Zeilen (101–112, 311, 401, 9999) haben ihr
   Soll. Jeder lesbare Auskunftswert ist gleich dem Stand nach 0178 (unten).
3. **Privilegierte Prüfung als `postgres`:** am 2026-11-04 noch nicht durchgeführt; inzwischen vom
   Betreiber nachgeholt — 9998 = `0`, 9999 = `0`, die elf Zeilen sind dort gemessen (unten).

### Vergleich mit dem Stand nach 0178 (Prüfzugang)

| Nr | 0179-Preflight | 0178-Postflight (Prüfzugang, 15:14 UTC) | Vergleich |
|---|---|---|---|
| 101 / 104 / 105 | `d70ee33c…`, `51213fd8…`, `4c4a01eb…`/`192dedca…` | 201 / 202 / 204–205 dieselben | **gleich** |
| 102 / 103 | `f8b1132c…`, `2526d3a7…` | 211 / 212 dieselben | **gleich** |
| 142 | `1303\|c234c880a0475259b4ebebc6277a0375` | 242 dasselbe | **gleich** |
| 144 | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | 244 dasselbe | **gleich** |
| 152 / 153 | `6b1de419…`, `3978d0fc…` | 252 / 253 dieselben | **gleich** |
| 900 / 901 | wie oben | `baseline-0178.json` zeichengleich | **gleich** |
| 151 | `dec2c48cfbce7a8866861d019d0a663e` | 251 `10ae0dd3359e52aa6f9ad922618411a8` | **nicht vergleichbar** — siehe unten |

**Zu 151:** Die beiden Zeilen nehmen verschiedene Funktionen aus (0178: die vier damals neuen;
0179: `sales_recon_ledger` und `sales_recon_proven`), ihre Werte sind deshalb verschieden, ohne dass
sich etwas bewegt hat. Damit das nicht nur angenommen ist, wurde `0178_postflight.sql` unmittelbar
nach dem Preflight erneut **lesend** als Prüfzugang gefahren: 251 = `10ae0dd3359e52aa6f9ad922618411a8`,
201 = `d70ee33c…`, 202 = `51213fd8…`, 242/244/252/253 wie oben, 9999 = `0`. Die Funktionsrechte
sind seit der 0178-Nachkontrolle unverändert. Referenz für die 0179-Nachkontrolle (251) ist
ausschließlich 151 dieses Preflights, je Rolle.

**Rollenabhängig:** 151–153 messen Katalogtexte (`regprocedure`, `regclass`), deren Darstellung vom
`search_path` der Rolle abhängen kann. Verglichen wird nur innerhalb **derselben** Rolle.

## Privilegierter Preflight (`postgres`, SQL-Editor) — vom Betreiber übermittelt

Der Betreiber hat `supabase/checks/0179_preflight.sql` (289 Zeilen, SHA-256
`f96cdf6fbadf9217ba39bed6d78f10daf9272237f1b854f9ca8f8f4082b94a1b`) unverändert als `postgres` im
SQL-Editor von `qqxcpesbwfxzgytkdsac` ausgeführt und das Ergebnis übermittelt. **Die Werte unten
sind die vom Betreiber übermittelten privilegierten SQL-Editor-Ergebnisse**, unverändert
übernommen. Sie stehen getrennt von der eingefrorenen Akte `baseline-0179.json`; diese bleibt
unverändert (SHA-256 `2efdb69947de5f1e376ae9ff1643e29e59436ed866290217380ba0ca15d7fdd8`).

**40 Zeilen, 9998 = `0`, 9999 = `0`** — jede Zeile gemessen, keine blockierende Abweichung.

**Grundlage:** 101 = `d70ee33c2b740aa811704ad5e561a34e`, 102 = `f8b1132c27ba1b18123f6c2548f9997c`,
103 = `2526d3a77ccf3153158182d0ecd391aa`, 104 = `51213fd88afb5441a487dc89bba2ac06`,
105 = `192dedca6ea258b54c6108ccbcd2d149,4c4a01eb05adb6d439450063f04eada9`, 106–108 = `true`,
111–112 = `true` (0179 nicht angewendet), 311 = `0`, 401 = `0` — alle ok, zeichengleich mit dem
Prüfzugang.

### Referenz für den Postflight: 131–153 (`postgres`)

Verglichen mit dem **berechtigten 0178-Postflight** (`supabase/checks/0178_staging_run.md`, ebenfalls
`postgres`, ebenfalls Zeilen gleicher Definition: jede Spalte, Anzahl|md5). Der berechtigte
0179-Postflight (231–253, `postgres`) muss **zeichengleich** diese Werte nennen.

| Nr | Inhalt | `postgres` (Betreiber) | 0178-Postflight (`postgres`) | Vergleich |
|---|---|---|---|---|
| 131 | Abgleichssitzungen | `3\|bf930e5a75f27fb8ad049b3088dfcc5c` | 231 dasselbe | **gleich** |
| 132 | Abgleichsdateien | `3\|25a4edc8fd92f1730b234d751594d671` | 232 dasselbe | **gleich** |
| 133 | Abgleichsbestellungen | `13\|7627af50aa9157d30e206081aac761d0` | 233 dasselbe | **gleich** |
| 134 | Zuordnungen | `13\|46b8b6a091eb1b3f21791aeef68ff60e` | 234 dasselbe | **gleich** |
| 135 | Befunde | `24\|5cd63838da73bdf73fbbed8c915b16af` | 235 dasselbe | **gleich** |
| 136 | Entscheidungen | `12\|26dc2a508294e1df6516339e37478bd1` | 236 dasselbe | **gleich** |
| 137 | Übernahmen | `11\|d712a101d7ab3242df5f62080467ef13` | 237 dasselbe | **gleich** |
| 141 | Verkäufe | `315\|6e9f9b5319651bacc34eda2f74ae7133` | 241 dasselbe | **gleich** |
| 142 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | 242 dasselbe | **gleich** (auch = Prüfzugang) |
| 143 | Erstattungen | `42\|1e44ee8cd000c517fb88ad767e236aec` | 243 dasselbe | **gleich** |
| 144 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | 244 dasselbe | **gleich** (auch = Prüfzugang) |
| 145 | Altbestandsereignisse | `2741\|e83d59a152942e4fda979021f74784d3` | 245 dasselbe | **gleich** |
| 146 | Orderbuch-Journal | `19\|ef347f2f486935f795c2c64321869bf6` | 246 dasselbe | **gleich** |
| 151 | Funktionsrechte, Definer, `search_path` (ohne `sales_recon_ledger`, `sales_recon_proven`) | `dec2c48cfbce7a8866861d019d0a663e` | 251 `10ae0dd3…` — **andere Prüfdefinition** | **neuer Referenzwert**, nicht verglichen |
| 152 | Tabellenrechte, RLS-Schalter | `6b1de419eb568f90971d8677ce49c0d0` | 252 dasselbe (gleiche Definition, gleiche Rolle) | **gleich** |
| 153 | Policies | `3978d0fc1c1b46d497fba620c8f53cd2` | 253 dasselbe (gleiche Definition, gleiche Rolle) | **gleich** |

**Seit der 0178-Abnahme hat sich keine Zeile bewegt** — weder Abgleich noch Verkäufe, Positionen,
Erstattungen, Lagerbewegungen, Altbestand oder Journal, kein Tabellenrecht, keine Policy. Die
funktionale Leseabnahme dazwischen war damit nachweislich schreibfrei.

**Zu 151:** Die 0178-Zeile nahm die vier damals neuen Funktionen aus, die 0179-Zeile nimmt die zwei
jetzt neuen aus — verschiedene Prüfdefinitionen, also kein Vergleich. Der Wert ist der
**privilegierte Referenzwert für 251** des berechtigten 0179-Postflights. Dass der Prüfzugang
denselben Wert liefert, ist ein Befund dieses Laufs und keine Zusage; die Nachkontrolle des
Prüfzugangs wird gegen dessen eigene 151 geprüft, die berechtigte gegen diese. Dass sich die
Funktionsrechte seit 0178 nicht bewegt haben, belegt die lesende Wiederholung des 0178-Postflights
(251 = `10ae0dd3…`, oben).

### Shop und Baselines

| Nr | `postgres` (Betreiber) | Prüfzugang | Akte `baseline-0179.json` | Vergleich |
|---|---|---|---|---|
| 301–307 | `257`, `76f027a6a335b9f8599955dbb371d943`, `594`, `594`, `286`, `658`, `8793a9e2abd76190c23bcb24e64f6e74` | dieselben | — | **gleich** |
| 900 | `skyisles-base-1\|257\|76f027a6a335b9f8599955dbb371d943\|594\|594\|286\|658\|8793a9e2abd76190c23bcb24e64f6e74\|1216ff0082a7` | dieselbe | `skyisles.base` zeichengleich | **gleich** |
| 901 | `skyisles-coll-1\|21\|1\|965b149286b4e61212ef48a94a8bab01\|bfa156bc6cb3` | dieselbe | `skyisles.coll` zeichengleich | **gleich** |

## Voraussetzungen für die Anwendung — erfüllt

1. Rümpfe 0178 (Lesefunktion, Pending, sale_values, at_analysis), 0173 (Apply), 0172 (Decide),
   Sperre, Rechte und `search_path` der Lesefunktion wie erwartet (101–108) — **erfüllt**, beide
   Rollen.
2. 0179 nicht angewendet (111–112, Runner-Stand „nein“) — **erfüllt**.
3. Privilegierter Preflight vollständig, 9998 = `0`, 9999 = `0` — **erfüllt** (Betreiber).
4. Rollenunabhängige Werte beider Läufe gleich (101–112, 142, 144, 301–307, 900, 901) — **erfüllt**.
5. Baselines eingefroren, unverändert und zeichengleich mit dem privilegierten Lauf — **erfüllt**.
6. Referenzwerte 131–153 (`postgres`) für den berechtigten Postflight festgehalten — **erfüllt**.
7. Dateien unverändert seit `5c6284e`, Prüfsummen stimmen — **erfüllt**.

Die Anwendung selbst braucht eine **eigene Freigabe**. Unmittelbar davor wird der lesende Preflight
wiederholt (101, 111, 112, 142, 144, 151–153, 900, 901 zeichengleich, 9999 = `0`).

## Freigabe und Ausführungsanweisung (2026-11-05) — vom Betreiber ausgeführt (unten)

Der Betreiber hat am 2026-11-05 die einmalige Anwendung von 0179 auf Staging
`qqxcpesbwfxzgytkdsac` freigegeben. Die Anwendung erfolgt ausschließlich durch den Betreiber im
SQL-Editor; ein anderer Schreibzugang wird nicht eingerichtet. **Ob sie ausgeführt wurde und mit
welchem Ergebnis, steht erst nach der Rückmeldung hier.**

**Vorab geprüft (2026-11-05):** Branch `development/skyisles-v2`, HEAD `5c6284e`; Migration, Hülle,
Pre-/Postflight und Rückbau seit `5c6284e` unverändert; `verify:sums` 556 Dateien ok;
`baseline-0179.json` unverändert (`2efdb699…`). Erneuter lesender Preflight unmittelbar vor der
Übergabe (Prüfzugang, Ziel `qqxcpesbwfxzgytkdsac`): alle 40 Zeilen zeichengleich mit dem ersten
Lauf, 9999 = `0`, 900/901 = Akte — Staging seit dem Preflight unverändert, 0179 nicht angewendet.

**Hülle:** `supabase/operations/staging-0179.sql`, 524 Zeilen, SHA-256
`499983443d9d2e624785936cbabeb59898a1bf0d01da1c34a1aa4dfed7b73d47` (= Commit `5c6284e`,
`SHA256SUMS.txt`, `APPLIED.md`). Eine Transaktion (`begin;` … `commit;`); A1 bricht ab, wenn der
Datenbankkommentar nicht `skyisles-staging qqxcpesbwfxzgytkdsac` ist; die Migration ist
zeichengleich eingebettet (Vorbedingungen, Nachbedingung); A2/Z1 Daten, Rechte, Policies; Z2
Rümpfe; Z3 `search_path`. Keine `insert`/`update`/`delete`, keine Production-Kennung.

**Anweisung an den Betreiber:**

1. Im Supabase-Dashboard das Projekt **`qqxcpesbwfxzgytkdsac`** öffnen (nicht Production
   `zmiwxswrpkmizvqsgype`), SQL-Editor, neue leere Abfrage.
2. `supabase/operations/staging-0179.sql` **vollständig** einfügen — alle 524 Zeilen, von `-- ===`
   bis `commit;`, ohne Änderung, ohne weitere Anweisung davor oder danach.
3. Ausführen. **Erwartet:** NOTICE `A3: …`, NOTICE `0179: ledger.atAnalysis only with proof. …`,
   NOTICE `0179 ok: …`, dann Erfolg.
4. **Bei jedem Fehler** (`ABBRUCH A1/Z1/Z2/Z3`, `0179 abort`, `0179 needs 0178` oder
   `0179 postcondition`): nichts weiter tun, die vollständige Meldung zurückmelden. Ein Abbruch
   lässt nichts zurück. Kein zweiter Versuch, kein Rückbau, keine Reparatur ohne eigene Freigabe.
5. Bei Erfolg zurückmelden; danach folgen `npm run db:migrate:staging -- 0179 --resume` und der
   berechtigte Postflight.

## Anwendung und Nachkontrolle (2026-11-05)

**Anwendung (Betreiber):** Der Betreiber meldet, `supabase/operations/staging-0179.sql` im SQL-Editor
von `qqxcpesbwfxzgytkdsac` ausgeführt zu haben. Bestätigt durch den Runner-Stand „`sales_recon_ledger`
steht → JA“ und die Rümpfe 201–203 (unten).

### Erster Postflight des Betreibers — UNVOLLSTÄNDIG, kein Integritätsbefund

Der Betreiber hat `supabase/checks/0179_postflight.sql` **ohne** die zwei `set_config`-Zeilen der
Baselines als `postgres` gefahren. Übermittelt (Zusammenfassung des Betreibers, keine Einzelwerte):
201–203 richtig, Rechte und SECURITY DEFINER richtig, Abgleich-, Verkaufs- und Rechteabdrücke
unverändert, **9998 = `0`, 9999 = `18`**.

**Bewertung: unvollständige Prüfung wegen fehlender Baselines — kein Datenintegritätsfehler.** Ohne
`skyisles.base`/`skyisles.coll` scheitern genau 18 blockierende Zeilen, und zwar unabhängig vom
Datenstand: 801–804 und 811–817 (Shop, 11) sowie 821–824 und 831–833 (Sammlung, 7). Die
Prüfdatei hält das absichtlich so — eine fehlende Baseline zählt nie als bestanden. Dieser Lauf
ersetzt den berechtigten Postflight **nicht**.

### Nachkontrolle Prüfzugang (`--resume`, 07:23 UTC)

`npm run db:migrate:staging -- 0179 --resume` (Protokoll
`supabase/log/staging/migrate-0179-2026-11-05T07-23-41-765Z.md`, ungetrackt). Baselines aus der Akte
unverändert eingesetzt. **9999 = `0`, 9998 = `11`** (231–237, 241, 243, 245, 246 für diese Rolle
nicht lesbar — **nicht** als bestanden gewertet).

| Nr | Prüfung | Istwert (Prüfzugang) | Soll / Preflight | Ergebnis |
|---|---|---|---|---|
| 201 | `seller_recon_session` = Rumpf 0179 | `5ed52447581cc895efc6a56f268c0da3` | dasselbe | ok |
| 202 | `sales_recon_ledger` = Rumpf 0179 | `07875fe3ba889fefab1c55dbe67005d9` | dasselbe | ok |
| 203 | `sales_recon_proven` = Rumpf 0179 | `b7b36ccd5efdd57e661808b62274df68` | dasselbe | ok |
| 204 | Lesefunktion und Ledger: Definer, STABLE, ein leerer `search_path` | `2` | `2` | ok |
| 205 | `seller_recon_session` nur `authenticated` | `true` | `true` | ok |
| 206 | Clientrechte auf den Hilfsfunktionen | `0` | `0` | ok |
| 211–216 | Apply, Decide, Pending, pending_set, sale_values, at_analysis | `f8b1132c…`, `2526d3a7…`, `51213fd8…`, `3228eb12…`, `4c4a01eb…`, `192dedca…` | unverändert | ok |
| 217 | Verkäufersperre | `true` | `true` | ok |
| 231–237, 241, 243, 245, 246 | Abgleich, Verkäufe, Erstattungen, Altbestand, Journal | `KEIN-RECHT` | — | für diese Rolle ungemessen; als `postgres` unverändert (berechtigter Postflight) |
| 242 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | Preflight 142 | gleich |
| 244 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | Preflight 144 | gleich |
| 251 | Funktionsrechte (Prüfzugang) | `dec2c48cfbce7a8866861d019d0a663e` | Preflight 151 (Prüfzugang) | gleich (gleiche Definition, gleiche Rolle) |
| 252 | Tabellenrechte (Prüfzugang) | `6b1de419eb568f90971d8677ce49c0d0` | Preflight 152 (Prüfzugang) | gleich |
| 253 | Policies (Prüfzugang) | `3978d0fc1c1b46d497fba620c8f53cd2` | Preflight 153 (Prüfzugang) | gleich |
| 801–804 / 811–817 | Shop-Baseline übergeben, Marke, 9 Felder, Schutzsumme; `257`, `76f027a6…`, `594`, `594`, `286`, `658`, `8793a9e2…` | bestanden | Akte | ok |
| 818 / 819 | übergebene und heutige Shop-Baseline | beide = Akte `skyisles.base` | | gleich |
| 821–824 / 831–833 | Sammlungs-Baseline übergeben, Marke, 5 Felder, Schutzsumme; `21`, `1`, `965b1492…` | bestanden | Akte | ok |
| 828 / 829 | übergebene und heutige Sammlungs-Baseline | beide = Akte `skyisles.coll` | | gleich |

Mit eingesetzten Baselines bestehen also alle 18 Zeilen, die im ersten Lauf fehlten.

### Berechtigter Postflight (`postgres`) — vorbereitet und vom Betreiber ausgeführt (unten)

**Datei:** `supabase/log/staging/0179-postflight-berechtigt.sql` (vom Runner erzeugt, ungetrackt),
447 Zeilen, SHA-256 `8df113d491b34f0e43a16cbf7656ce535f3ca3dae30267f3a16443b2e7037c31`.

Inhalt, außerhalb der Prüfdatei genau vier Anweisungen: `begin;` · `select set_config('skyisles.base',
…, true);` · `select set_config('skyisles.coll', …, true);` · die Prüfdatei · `rollback;`.

**Lokal geprüft (2026-11-05):**
- `0179_postflight.sql` zeichengleich eingebettet (unverändert seit `5c6284e`).
- Beide Werte zeichengleich mit `baseline-0179.json` (`2efdb699…`, unverändert).
- pglast: 5 Anweisungen (Transaktion, drei `select`, Transaktion); keine `insert`/`update`/`delete`/
  `truncate`/`create`/`drop`/`alter`/`grant`/`revoke`/`commit`; keine Production-Kennung.
- PGlite: Vorspann ausgeführt — beide Einstellungen in derselben Transaktion lesbar, Marke, Feldzahl
  und Schutzsumme gültig; nach `rollback` leer (nichts bleibt).
- `npm run verify:check-sql`: `0179_postflight.sql` geplant, 176 Dateien ohne Planfehler.

**Anweisung an den Betreiber:** Projekt `qqxcpesbwfxzgytkdsac` (nicht `zmiwxswrpkmizvqsgype`),
SQL-Editor, neue leere Abfrage; die Datei vollständig (447 Zeilen, `-- ===` bis `rollback;`)
unverändert einfügen und ausführen. Erwartet: 9998 = `0`, 9999 = `0`; 231–253 zeichengleich mit dem
privilegierten Preflight 131–153; 818/819 und 828/829 je gleich. Das Ergebnisblatt zurückmelden.

### Berechtigter Postflight (`postgres`, SQL-Editor) — vom Betreiber übermittelt

Der Betreiber hat `supabase/log/staging/0179-postflight-berechtigt.sql` (447 Zeilen, SHA-256
`8df113d4…`, Baselines eingesetzt, `begin … rollback`) am 2026-11-05 als `postgres` im SQL-Editor von
`qqxcpesbwfxzgytkdsac` ausgeführt. **Die Angaben unten sind die vom Betreiber übermittelten
privilegierten SQL-Editor-Ergebnisse** (als Befund je Bereich übermittelt, nicht als Einzelwerte):

| Bereich | Ergebnis (Betreiber) |
|---|---|
| 9998 / 9999 | **`0` / `0`** |
| 201–206 neue Rümpfe, Definer, `search_path`, Rechte | korrekt |
| 211–217 unberührte Funktionen, Sperre | korrekt |
| 231–237 Abgleichsdaten | unverändert |
| 241–246 Verkäufe, Positionen, Erstattungen, Lagerbewegungen, Altbestand, Journal | unverändert |
| 251–253 Funktionsrechte, Tabellenrechte, Policies | unverändert |
| 801–833 Shop und Sammlung | vollständig bestanden |
| 818/819, 828/829 übergebene = heutige Baseline | je zeichengleich |

Mit 9999 = `0` ist jede blockierende Zeile bestanden; 231–253 vergleichen gegen die privilegierten
Preflight-Werte 131–153 (gleiche Rolle, gleiche Definition). **Damit ist 0179 auf Staging technisch
nachkontrolliert.** Die funktionale Leseabnahme folgt getrennt (unten); erst sie entscheidet über die
Abnahme.

## Funktionale Leseabnahme (2026-11-05) — 45 von 45 bestanden

Als bestehendes Staging-Betriebskonto (öffentlicher Schlüssel, Anmeldung mit Passwort, **ohne
Service-Role**, kein Konto angelegt), ausschließlich die regulären RPCs `seller_recon_sessions`,
`seller_recon_session` und `seller_recon_pending`. Keine Sitzung, kein Verkauf, keine Entscheidung,
keine Übernahme, keine Schreiboperation. Ausgegeben wurden nur Zählungen, Strukturbefunde, Zuordnungs-
IDs und Hashes — kein Wert eines Verkaufs oder Berichts. Antwort gelesen mit `view.ts` (Stand des
Repositorys, unverändert seit Schritt 1).

**Geprüfte Regeln je Zuordnung und Feld** (`soldOn`, `itemsNet`, `shipping`, `expectedTotal`,
`pieces`), gegen das, was der Client sieht — Befund, Berichtswert, `ledger.current`, `state`,
`version`, `applied` je Befund:
- Form: `atAnalysis` hat genau die fünf Felder, jedes genau `{value, basis}`; `basis` ∈
  stored/derived/unknown; `unknown` ⇔ `value` null. **Ein eigenes Feld `proof` gibt es nicht** —
  der Nachweis wird in der Datenbank geführt (`sales_recon_proven`) und zeigt sich ausschließlich in
  `basis`; das Antwortschema ist bewusst unverändert (Vorgabe für 0179).
- Behauptung: `stored` nur mit Befund und `value` = Befundwert; `derived` nur ohne Befund und
  `value` = Berichtswert; ohne Paar `unknown`.
- `unchanged`: bewiesen **genau dann**, wenn die Behauptung dem heutigen Wert gleicht (in beide
  Richtungen: kein Widerspruch als bewiesen, kein stimmiger Wert verloren).
- `changed`: kein `derived`; ein `stored` bleibt.
- `applied`: unberührte Felder bewiesen nur, wenn gleich heute; von der Sitzung übernommene Felder
  einzeln ausgewiesen.
- Dazu wie bei 0178: `state`/`version`/`stale` widerspruchsfrei, `current` vollständig und in sich
  stimmig (Netto, erwarteter Gesamtbetrag), Seiten, Kategorien, Grenzwerte, `pending`, ungültige IDs.

| Sitzung | Zustand | Ergebnis |
|---|---|---|
| 1 (geschlossen, 11 Zuordnungen) | `unchanged` 5, `applied` 6 | **konsistente Werte bleiben nachweisbar:** Basis `derived` 48, `stored` 7, kein `unknown` — wie unter 0178. Keine `unchanged`-Behauptung weicht von heute ab. Von der Sitzung übernommen und weiter `stored`: `soldOn` bei #2, #3, #7, #8; `expectedTotal` bei #9, #10 |
| 2 (verworfen, 1 Zuordnung) | `changed` | `soldOn` bleibt `stored`; `itemsNet`, `shipping`, `expectedTotal`, `pieces` **`unknown`** (unter 0178: `derived`) |
| 3 (verworfen, 1 Zuordnung #13) | `unchanged` | `itemsNet`, `shipping`, `expectedTotal` **`unknown`** — genau die drei Felder, deren handgebaute Beträge dem Verkauf widersprechen; `soldOn` und `pieces` stimmen und bleiben `derived`. **Der Befund der 0178-Leseabnahme ist behoben.** |

**Weitere Prüfungen:** ohne Anmeldung beide Funktionen `42501`; `view.ts` liest alle drei
Sitzungen; seitenweises Lesen in gleicher Reihenfolge; Kategorien summieren sich; `limit` 0 und 201
sowie `offset` −1 `23514`; `pending` in Form, für nicht offene Sitzungen ohne Token, wiederholt
identisch; ungültige IDs (0, −1, 999999999) `P0002` ohne Wert; Sitzungsliste, jede Sitzungsseite und
jedes `pending` vorher/nachher gleich.

**Schreibfreiheit:** Der Prüfzugang hat `0179_postflight.sql` unmittelbar vor und nach der Abnahme
gelesen — alle 54 Zeilen zeichengleich (242, 244, 251–253, Shop, Sammlung; 9999 = `0`).

**Grenzen:**
- Bei `applied` sieht der Client den alten Wert der Übernahme nicht; dass ein übernommenes Feld
  `stored` bleibt, belegt nur, dass die Datenbank Befundwert und aufgezeichneten alten Wert gleich
  fand. Unabhängig davon prüfen das die PGlite-Tests (`ledger-proof-0179.test.ts`).
- Ein `stored` unter `changed` (Sitzung 2) ist der aufgezeichnete Befundwert, nicht neu bewiesen.
- Keine offene Sitzung auf Staging — Token über eine nicht leere Menge weiterhin nicht prüfbar;
  ein angemeldetes Konto ohne Verkäuferrolle wurde nicht getestet.

## Formale Abnahme auf Staging (2026-11-05)

Der Betreiber hat am 2026-11-05 die formale Abnahme freigegeben. **0179 ist auf Staging
`qqxcpesbwfxzgytkdsac` angewendet und abgenommen**, auf dieser Grundlage:

1. Preflight lesend und als `postgres` bestanden (9998 = `0`, 9999 = `0`), unmittelbar vor der
   Anwendung lesend wiederholt und zeichengleich.
2. Anwendung über die geprüfte Hülle (`499983443d9d…`), eine Transaktion.
3. Nachkontrolle Prüfzugang 9999 = `0`; berechtigter Postflight 9998 = `0`, 9999 = `0` — keine
   Datenzeile, kein Recht, keine Policy bewegt, Shop und Sammlung gleich der Akte.
4. Funktionale Leseabnahme 45 von 45; die Abweichung der 0178-Leseabnahme (Sitzung 3) ist behoben,
   ohne dass Sitzung 1 einen nachweisbaren Wert verliert.
5. Die Leseabnahme hat nachweislich nichts geschrieben (Prüfzugang vorher/nachher zeichengleich).

Die oben genannten **Grenzen bleiben bestehen**. Eingetragen in `APPLIED.md` (Staging-Tabelle).
**Production: nicht angewendet.**

## Was die spätere Nachkontrolle auf Unverändertheit prüft

Jede der folgenden Gruppen wird **zweimal** verglichen: in der Einfüge-Hülle blockierend in derselben
Transaktion (A2 vorher, Z1 nachher; ein Unterschied bricht ab, nichts bleibt zurück) und im
berechtigten Postflight (231–253 gegen 131–153 als `postgres`, Shop und Sammlung gegen die Akte).

| Bereich | Hülle Z1 | Postflight |
|---|---|---|
| Abgleich: Sitzungen, Dateien, Bestellungen, Zuordnungen, Befunde, Entscheidungen, Übernahmen | jede Spalte | 231–237 |
| Verkäufe, Verkaufspositionen, Erstattungen | jede Spalte | 241–243 |
| Lagerbewegungen, Altbestandsereignisse, Orderbuch-Journal | jede Spalte | 244–246 |
| Shop: Lager (`shop_inventory`) | jede Spalte | 801–819 gegen `skyisles.base` |
| Shop: öffentliche Angebote, Katalog | — (nur Postflight) | 811–817 gegen `skyisles.base` |
| Sammlung (`collection_items`) | jede Spalte | 821–833 gegen `skyisles.coll` |
| Funktionsrechte, Definer, `search_path` (ohne die zwei neuen) | Abdruck | 251 |
| Tabellenrechte, RLS-Schalter | Abdruck | 252 |
| Policies | Abdruck | 253 |
| Rümpfe Apply, Decide, Pending | Z2 | 211–213 |
| Rümpfe pending_set, sale_values, at_analysis | Nachbedingung der Migration | 214–216 |
| neue Rümpfe | Z2 | 201–203 |
| Definer und leerer `search_path` von Lesefunktion und Ledger | Z3 | 204 |
| Clientrechte (Lesefunktion wie vorher, Hilfsfunktionen keine) | Nachbedingung der Migration | 205–206 |

## Ablauf (ADR-0137)

1. Arbeitsbaum sauber, `npm test`, `npm run check`, `npm run verify:sums` — erledigt (`5c6284e`).
2. Lesender Preflight und Baselines — **erledigt**; Akte `baseline-0179.json` steht.
3. Privilegierter Preflight als `postgres` — **erledigt** (Betreiber, 9998 = `0`, 9999 = `0`).
4. Anwendung (`supabase/operations/staging-0179.sql`) — **erledigt** (Betreiber, 2026-11-05).
   Erwartet dann: NOTICE `A3`, die NOTICE der Migration, `0179 ok`, dann `commit`.
5. Nachkontrolle `npm run db:migrate:staging -- 0179 --resume`. Erwartet 9999 = `0`;
   201 = `5ed52447581cc895efc6a56f268c0da3`, 202 = `07875fe3ba889fefab1c55dbe67005d9`,
   203 = `b7b36ccd5efdd57e661808b62274df68`, 211 = `f8b1132c…`, 212 = `2526d3a7…`,
   213 = `51213fd8…`, 214 = `3228eb12…`, 215 = `4c4a01eb…`, 216 = `192dedca…`.
6. Berechtigter Postflight als `postgres` (vom Runner erzeugt): 9998 = `0`, 9999 = `0`; 231–253
   gleich den privilegierten Preflight-Werten 131–153.
7. Rechte `npm run db:privileges:staging`; Akte `APPLIED.md`, `npm run sums:write`.
8. Funktionale Leseabnahme — **durchgeführt 2026-11-05, 45 von 45** (oben).

## Rückbau

`supabase/rollback/R0179_sales_recon_ledger_without_proof.sql` — stellt den 0178-Rumpf wieder her
und entfernt die zwei Hilfsfunktionen; nur solange `0180` nicht steht. Production: eigene, spätere
Entscheidung.
