# Laufzettel — 0178 (Vergleichswerte und ausstehende Änderungen) auf Staging

**Stand (2026-11-04): auf Staging angewendet und vollständig verifiziert.** Privilegierter
Preflight und privilegierter Postflight je **9998 = `0` und 9999 = `0`**; 231–253 zeichengleich mit
131–153, beide Baselines unverändert. Nachweis auch in `supabase/migrations/APPLIED.md`.
**Production (`zmiwxswrpkmizvqsgype`): nicht angewendet** — eigene, spätere Entscheidung.

| | |
|---|---|
| Zielprojekt | Staging `qqxcpesbwfxzgytkdsac` (Stempel `skyisles-staging qqxcpesbwfxzgytkdsac`). Production `zmiwxswrpkmizvqsgype` wurde nicht angesprochen. |
| Commit | `6f8c2c1` (`feat(0178): read the comparison values and the pending changes …`) |
| Datum | 2026-11-04, 14:44 UTC |
| Zugang | lesender Prüfzugang `skyisles_agent`, Sitzung schreibgeschützt, TLS `verify-full`, jede Datei in `begin … rollback` |
| Preflight | `supabase/checks/0178_preflight.sql`, SHA-256 `f4ca024f7fca3d5abf816d658f4038e8d9f2de741001f0a3dd5f6f25d23d96a2` |
| Befehl | `npm run db:migrate:staging -- 0178` (Protokoll `supabase/log/staging/migrate-0178-2026-11-04T14-44-35-550Z.md`, ungetrackt) |
| Baselines | eingefroren in `supabase/baselines/baseline-0178.json` — ab hier unverändert, nach der Migration NIE neu erheben |

## Was 0178 tut

Ersetzt den Rumpf von `seller_recon_session` (`42c2f33b…` aus `0172` → `d70ee33c…`; Signatur,
Rechte und jeder Schlüssel bleiben, neu ist `ledger` je Zuordnung) und legt
`seller_recon_pending(bigint)` sowie drei interne Hilfsfunktionen ohne Clientrecht an. Rein lesend,
keine Datenanweisung. `seller_recon_decide` und `seller_recon_apply` bleiben unverändert. Die
Einfüge-Hülle `supabase/operations/staging-0178.sql` vergleicht Daten, Rechte und Policies in
derselben Transaktion vorher/nachher und bricht bei jeder Bewegung ab.

## Ergebnis des lesenden Preflights (Prüfzugang)

**9999 = `0`** (keine blockierende Abweichung unter den geprüften Zeilen), **9998 = `11`** (elf
Zeilen nicht geprüft — **nicht** als bestanden gewertet).

| Nr | Prüfung | Istwert | Soll | Ergebnis |
|---|---|---|---|---|
| 1 | Info: Katalogzeilen | `658` | — | Auskunft |
| 101 | `seller_recon_session` = Rumpf aus 0172 | `42c2f33b00fa40040a36e2a71637e724` | dasselbe | ok |
| 102 | `seller_recon_apply` = Rumpf aus 0173 | `f8b1132c27ba1b18123f6c2548f9997c` | dasselbe | ok |
| 103 | `seller_recon_decide` = Rumpf aus 0172 | `2526d3a77ccf3153158182d0ecd391aa` | dasselbe | ok |
| 104 | `sales_recon_validate_payload` = Rumpf aus 0176 | `44441ee3b50a6bbf4f4fcbfda21d0e93` | dasselbe | ok |
| 105 | Verkäufersperre steht (`sales_recon_gate`, `can_operate_active_seller`) | `true` | `true` | ok |
| 106 | `seller_recon_session`: nur `authenticated`, nicht `anon`/PUBLIC | `true` | `true` | ok |
| 107 | `seller_recon_session`: SECURITY DEFINER, ein leerer `search_path` | `true` | `true` | ok |
| 111 | `seller_recon_pending` steht noch nicht (keine angewendete 0178) | `true` | `true` | ok |
| 112 | die drei Hilfsfunktionen stehen noch nicht | `true` | `true` | ok |
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
| 151 | Rechte/Definer/`search_path` aller Funktionen in `public` (ohne die vier neuen) | `10ae0dd3359e52aa6f9ad922618411a8` | — | Auskunft |
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
| 9998 | nicht lesbare Zeilen | `11` | `0` für `postgres` | **offen** |
| 9999 | blockierende Abweichungen | `0` | `0` | ok |

**Rollenabhängig:** 151–153 messen Katalogtexte (`regprocedure`, `regclass`), deren Darstellung vom
`search_path` der Rolle abhängen kann. Verglichen wird deshalb nur innerhalb **derselben** Rolle —
Prüfzugang mit Prüfzugang, `postgres` mit `postgres`.

## Privilegierter Preflight (`postgres`, SQL-Editor) — vom Betreiber übermittelt

Der Betreiber hat `supabase/checks/0178_preflight.sql` am 2026-11-04 als `postgres` im SQL-Editor
von `qqxcpesbwfxzgytkdsac` ausgeführt und das Ergebnisblatt übermittelt. **Die Werte unten sind die
vom Betreiber übermittelten SQL-Editor-Ergebnisse**, unverändert übernommen. Sie stehen getrennt
von der eingefrorenen Akte `baseline-0178.json`; diese bleibt unverändert
(SHA-256 `ab05e6e08e7f74e842446fc40f0c76e3d9ef6f37c1c73865c94111e5a69e79d2`).

**9998 = `0`, 9999 = `0`** — jede Zeile gemessen, keine blockierende Abweichung.

**Grundlage:** 101 = `42c2f33b00fa40040a36e2a71637e724`, 102 = `f8b1132c27ba1b18123f6c2548f9997c`,
103 = `2526d3a77ccf3153158182d0ecd391aa`, 104 = `44441ee3b50a6bbf4f4fcbfda21d0e93`, 105–107 = `true`,
111–112 = `true` (0178 nicht angewendet), 311 = `0`, 401 = `0` — alle ok.

### Referenz für den Postflight: 131–153 (`postgres`)

Der berechtigte Postflight (231–253, ebenfalls als `postgres`) muss **zeichengleich** diese Werte
nennen.

| Nr | Inhalt | `postgres` (Betreiber) | Prüfzugang (oben) | Vergleich |
|---|---|---|---|---|
| 131 | Abgleichssitzungen | `3\|bf930e5a75f27fb8ad049b3088dfcc5c` | `KEIN-RECHT` | nur `postgres` |
| 132 | Abgleichsdateien | `3\|25a4edc8fd92f1730b234d751594d671` | `KEIN-RECHT` | nur `postgres` |
| 133 | Abgleichsbestellungen | `13\|7627af50aa9157d30e206081aac761d0` | `KEIN-RECHT` | nur `postgres` |
| 134 | Zuordnungen | `13\|46b8b6a091eb1b3f21791aeef68ff60e` | `KEIN-RECHT` | nur `postgres` |
| 135 | Befunde | `24\|5cd63838da73bdf73fbbed8c915b16af` | `KEIN-RECHT` | nur `postgres`; zeichengleich mit 0176-Abnahme (`APPLIED.md`, Zeile 135/235 vom 2026-11-03) |
| 136 | Entscheidungen | `12\|26dc2a508294e1df6516339e37478bd1` | `KEIN-RECHT` | nur `postgres` |
| 137 | Übernahmen | `11\|d712a101d7ab3242df5f62080467ef13` | `KEIN-RECHT` | nur `postgres` |
| 141 | Verkäufe | `315\|6e9f9b5319651bacc34eda2f74ae7133` | `KEIN-RECHT` | nur `postgres` |
| 142 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | `1303\|c234c880a0475259b4ebebc6277a0375` | **gleich** (Tabellendaten, rollenunabhängig) |
| 143 | Erstattungen | `42\|1e44ee8cd000c517fb88ad767e236aec` | `KEIN-RECHT` | nur `postgres` |
| 144 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | **gleich** (Tabellendaten, rollenunabhängig) |
| 145 | Altbestandsereignisse | `2741\|e83d59a152942e4fda979021f74784d3` | `KEIN-RECHT` | nur `postgres` |
| 146 | Orderbuch-Journal | `19\|ef347f2f486935f795c2c64321869bf6` | `KEIN-RECHT` | nur `postgres` |
| 151 | Rechte/Definer/`search_path` aller Funktionen | `10ae0dd3359e52aa6f9ad922618411a8` | `10ae0dd3359e52aa6f9ad922618411a8` | **rollenabhängig möglich** — hier zufällig gleich; Referenz ist je Rolle die eigene Zeile |
| 152 | Rechte und RLS-Schalter aller Tabellen | `6b1de419eb568f90971d8677ce49c0d0` | `6b1de419eb568f90971d8677ce49c0d0` | **rollenabhängig möglich** — ebenso |
| 153 | alle Policies | `3978d0fc1c1b46d497fba620c8f53cd2` | `3978d0fc1c1b46d497fba620c8f53cd2` | **rollenabhängig möglich** — ebenso |

**Rollenregel für 151–153:** Die Abdrücke lesen Katalogtexte (`regprocedure`, `regclass`), deren
Darstellung vom `search_path` der Rolle abhängen kann. Dass beide Rollen hier denselben Wert
liefern, ist ein Befund dieses Laufs und keine Zusage. Der Postflight des Prüfzugangs (251–253) wird
gegen dessen Preflight geprüft, der berechtigte Postflight gegen die `postgres`-Werte hier.

### Shop und Baselines

| Nr | `postgres` (Betreiber) | Prüfzugang | Akte `baseline-0178.json` | Vergleich |
|---|---|---|---|---|
| 301–307 | `257`, `76f027a6a335b9f8599955dbb371d943`, `594`, `594`, `286`, `658`, `8793a9e2abd76190c23bcb24e64f6e74` | dieselben | — | **gleich** |
| 900 | `skyisles-base-1\|257\|76f027a6a335b9f8599955dbb371d943\|594\|594\|286\|658\|8793a9e2abd76190c23bcb24e64f6e74\|1216ff0082a7` | dieselbe | `skyisles.base` dieselbe | **gleich** |
| 901 | `skyisles-coll-1\|21\|1\|965b149286b4e61212ef48a94a8bab01\|bfa156bc6cb3` | dieselbe | `skyisles.coll` dieselbe | **gleich** |

## Voraussetzungen für die Anwendung — erfüllt

1. Funktionsrümpfe 0172/0173/0176 wie erwartet, Sperre steht, Rechte und `search_path` der
   Lesefunktion wie erwartet (101–107) — **erfüllt**.
2. 0178 nicht angewendet (111–112, Runner-Stand „nein“) — **erfüllt**.
3. Privilegierter Preflight vollständig, 9998 = `0`, 9999 = `0` — **erfüllt** (Betreiber).
4. Rollenunabhängige Werte beider Läufe gleich (142, 144, 301–307, 900, 901) — **erfüllt**.
5. Baselines eingefroren und gleich dem privilegierten Lauf — **erfüllt**.
6. Referenzwerte 131–153 für den berechtigten Postflight festgehalten — **erfüllt**.

Die Freigabe erteilte der Betreiber am 2026-11-04 (unten).

## Freigabe und Ausführungsanweisung (2026-11-04) — ausgeführt

Der Betreiber hat am 2026-11-04 die einmalige Anwendung von 0178 auf Staging
`qqxcpesbwfxzgytkdsac` freigegeben. Die Anwendung erfolgt durch den Betreiber im SQL-Editor; ein
anderer Schreibzugang wird nicht eingerichtet.

**Vorab geprüft (2026-11-04):** Branch `development/skyisles-v2`, HEAD `6f8c2c1`; Migration
(SHA-256 `0a0278a708628af2122b306dd87a03419e0b222f222beab1914e516e99197643`) und Hülle
(`91ef2dbeffed20291a4b746953625ba44b139abe08a405f2c2e137bb851f2adc`) seit `6f8c2c1` unverändert und
gleich `APPLIED.md`; `verify:sums` 551 Dateien ok; `baseline-0178.json` unverändert
(`ab05e6e0…`, `preflightSha256` = heutige Preflight-Datei). Erneuter lesender Preflight unmittelbar
vor der Übergabe: 101, 111, 112, 142, 144, 151–153, 900, 901 zeichengleich, 9999 = `0` — Staging ist
seit dem Preflight unverändert, 0178 nicht angewendet.

**Anweisung an den Betreiber:**

1. Im Supabase-Dashboard das Projekt **`qqxcpesbwfxzgytkdsac`** öffnen (nicht Production
   `zmiwxswrpkmizvqsgype`), SQL-Editor, neue leere Abfrage.
2. `supabase/operations/staging-0178.sql` **vollständig** einfügen — alle 665 Zeilen, von
   `-- ===` bis `commit;`, **ohne Änderung**, ohne weitere Anweisung davor oder danach. Die Datei
   enthält genau eine Migration (0178, zeichengleich eingebettet) und sonst nur Messungen.
3. Ausführen. **Erwartet:** NOTICE `A3: …`, NOTICE `0178: seller_recon_session carries ledger …`,
   NOTICE `0178 ok: …`, dann Erfolg.
4. **Bei jedem Fehler** (`ABBRUCH A1/Z1/Z2/Z3` oder eine `0178 abort`-/`postcondition`-Meldung):
   nichts weiter tun, die vollständige Meldung zurückmelden. Die Hülle ist eine Transaktion — ein
   Abbruch lässt nichts zurück. Kein zweiter Versuch, keine Reparatur ohne eigene Freigabe.
5. Bei Erfolg zurückmelden; danach folgen `npm run db:migrate:staging -- 0178 --resume` und der
   berechtigte Postflight (unten, Schritte 4–5).

## Anwendung und Nachkontrolle (2026-11-04)

**Anwendung (Betreiber):** `supabase/operations/staging-0178.sql` (SHA-256 `91ef2dbe…`) vollständig im
SQL-Editor von `qqxcpesbwfxzgytkdsac` ausgeführt; Supabase meldete „Success“, kein Fehler.

**Nachkontrolle Prüfzugang** (`npm run db:migrate:staging -- 0178 --resume`, 15:14 UTC, Protokoll
`supabase/log/staging/migrate-0178-2026-11-04T15-14-47-199Z.md`): Stand „liegt schon“ — 0178 ist
angewendet. Baselines aus der Akte unverändert übernommen. **9999 = `0`, 9998 = `11`** (231–237,
241, 243, 245, 246 für diese Rolle nicht lesbar — **nicht** als bestanden gewertet).

| Nr | Prüfung | Istwert (Prüfzugang) | Soll / Preflight | Ergebnis |
|---|---|---|---|---|
| 201 | `seller_recon_session` = Rumpf 0178 | `d70ee33c2b740aa811704ad5e561a34e` | dasselbe | ok |
| 202 | `seller_recon_pending` = Rumpf 0178 | `51213fd88afb5441a487dc89bba2ac06` | dasselbe | ok |
| 203 | `sales_recon_pending_set` = Rumpf 0178 | `3228eb12e00d7982c5cad5c42ea6f773` | dasselbe | ok |
| 204 | `sales_recon_sale_values` = Rumpf 0178 | `4c4a01eb05adb6d439450063f04eada9` | dasselbe | ok |
| 205 | `sales_recon_at_analysis` = Rumpf 0178 | `192dedca6ea258b54c6108ccbcd2d149` | dasselbe | ok |
| 206 | vier Definer-Funktionen, STABLE, ein leerer `search_path` | `4` | `4` | ok |
| 207 | `seller_recon_pending` nur `authenticated` | `true` | `true` | ok |
| 208 | `seller_recon_session` nur `authenticated` | `true` | `true` | ok |
| 209 | Clientrechte auf den drei Hilfsfunktionen | `0` | `0` | ok |
| 211 | `seller_recon_apply` unverändert (0173) | `f8b1132c27ba1b18123f6c2548f9997c` | dasselbe | ok |
| 212 | `seller_recon_decide` unverändert (0172) | `2526d3a77ccf3153158182d0ecd391aa` | dasselbe | ok |
| 213 | `sales_recon_validate_payload` unverändert (0176) | `44441ee3b50a6bbf4f4fcbfda21d0e93` | dasselbe | ok |
| 214 | Verkäufersperre steht | `true` | `true` | ok |
| 231–237, 241, 243, 245, 246 | Abgleich, Verkäufe, Erstattungen, Altbestand, Journal | `KEIN-RECHT` | — | **offen** |
| 242 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | Preflight 142 (Prüfzugang) gleich | gleich |
| 244 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | Preflight 144 (Prüfzugang) gleich | gleich |
| 251 | Funktionsrechte (Prüfzugang) | `10ae0dd3359e52aa6f9ad922618411a8` | Preflight 151 (Prüfzugang) gleich | gleich (rollengetrennt) |
| 252 | Tabellenrechte (Prüfzugang) | `6b1de419eb568f90971d8677ce49c0d0` | Preflight 152 (Prüfzugang) gleich | gleich (rollengetrennt) |
| 253 | Policies (Prüfzugang) | `3978d0fc1c1b46d497fba620c8f53cd2` | Preflight 153 (Prüfzugang) gleich | gleich (rollengetrennt) |
| 801–817 | Shop-Baseline: übergeben, Marke, 9 Felder, Schutzsumme, 811–817 wie vorher | `257`, `76f027a6…`, `594`, `594`, `286`, `658`, `8793a9e2…` | Akte | ok |
| 821–833 | Sammlungs-Baseline: übergeben, Marke, 5 Felder, Schutzsumme, 831–833 wie vorher | `21`, `1`, `965b1492…` | Akte | ok |

**Privilegierte Nachkontrolle — Datei.** Der Runner hat
`supabase/log/staging/0178-postflight-berechtigt.sql` erzeugt (457 Zeilen, SHA-256
`4a07822c1118ca62ed33a4ca981ecc12b7cf5458d6d631a3a736bd93d13a6851`, ungetrackt): Kopf, `begin;`,
die beiden `set_config` mit den Baselines **aus der eingefrorenen Akte**, `0178_postflight.sql`
zeichengleich eingebettet, `rollback;`. Keine schreibende Anweisung. Erwartet als `postgres`:
**9998 = `0` und 9999 = `0`**; 231–237 = Preflight 131–137, 241–246 = Preflight 141–146 und
251–253 = Preflight 151–153 — jeweils die `postgres`-Werte aus dem privilegierten Preflight oben.

### Privilegierter Postflight (`postgres`, SQL-Editor) — vom Betreiber übermittelt

Ausgeführt vom Betreiber am 2026-11-04 im SQL-Editor von `qqxcpesbwfxzgytkdsac`; die Werte sind die
**vom Betreiber übermittelten SQL-Editor-Ergebnisse**. **9998 = `0`, 9999 = `0`.**

| Nr | Prüfung | Istwert (`postgres`) | Soll | Ergebnis |
|---|---|---|---|---|
| 201 | `seller_recon_session` | `d70ee33c2b740aa811704ad5e561a34e` | Rumpf 0178 | ok |
| 202 | `seller_recon_pending` | `51213fd88afb5441a487dc89bba2ac06` | Rumpf 0178 | ok |
| 203 | `sales_recon_pending_set` | `3228eb12e00d7982c5cad5c42ea6f773` | Rumpf 0178 | ok |
| 204 | `sales_recon_sale_values` | `4c4a01eb05adb6d439450063f04eada9` | Rumpf 0178 | ok |
| 205 | `sales_recon_at_analysis` | `192dedca6ea258b54c6108ccbcd2d149` | Rumpf 0178 | ok |
| 206 | Definer, STABLE, ein leerer `search_path` | `4` | `4` | ok |
| 207 | `seller_recon_pending` nur `authenticated` | `true` | `true` | ok |
| 208 | `seller_recon_session` nur `authenticated` | `true` | `true` | ok |
| 209 | Clientrechte auf den Hilfsfunktionen | `0` | `0` | ok |
| 211 | `seller_recon_apply` (0173) | `f8b1132c27ba1b18123f6c2548f9997c` | unverändert | ok |
| 212 | `seller_recon_decide` (0172) | `2526d3a77ccf3153158182d0ecd391aa` | unverändert | ok |
| 213 | `sales_recon_validate_payload` (0176) | `44441ee3b50a6bbf4f4fcbfda21d0e93` | unverändert | ok |
| 214 | Verkäufersperre | `true` | `true` | ok |
| 231 | Abgleichssitzungen | `3\|bf930e5a75f27fb8ad049b3088dfcc5c` | Preflight 131 | gleich |
| 232 | Abgleichsdateien | `3\|25a4edc8fd92f1730b234d751594d671` | Preflight 132 | gleich |
| 233 | Abgleichsbestellungen | `13\|7627af50aa9157d30e206081aac761d0` | Preflight 133 | gleich |
| 234 | Zuordnungen | `13\|46b8b6a091eb1b3f21791aeef68ff60e` | Preflight 134 | gleich |
| 235 | Befunde | `24\|5cd63838da73bdf73fbbed8c915b16af` | Preflight 135 | gleich |
| 236 | Entscheidungen | `12\|26dc2a508294e1df6516339e37478bd1` | Preflight 136 | gleich |
| 237 | Übernahmen | `11\|d712a101d7ab3242df5f62080467ef13` | Preflight 137 | gleich |
| 241 | Verkäufe | `315\|6e9f9b5319651bacc34eda2f74ae7133` | Preflight 141 | gleich |
| 242 | Verkaufspositionen | `1303\|c234c880a0475259b4ebebc6277a0375` | Preflight 142 | gleich |
| 243 | Erstattungen | `42\|1e44ee8cd000c517fb88ad767e236aec` | Preflight 143 | gleich |
| 244 | Lagerbewegungen | `38\|0e9c8e0b6e2f08f0e0534b7cb7f91cf6` | Preflight 144 | gleich |
| 245 | Altbestandsereignisse | `2741\|e83d59a152942e4fda979021f74784d3` | Preflight 145 | gleich |
| 246 | Orderbuch-Journal | `19\|ef347f2f486935f795c2c64321869bf6` | Preflight 146 | gleich |
| 251 | Funktionsrechte (`postgres`) | `10ae0dd3359e52aa6f9ad922618411a8` | Preflight 151 (`postgres`) | gleich |
| 252 | Tabellenrechte (`postgres`) | `6b1de419eb568f90971d8677ce49c0d0` | Preflight 152 (`postgres`) | gleich |
| 253 | Policies (`postgres`) | `3978d0fc1c1b46d497fba620c8f53cd2` | Preflight 153 (`postgres`) | gleich |
| 801–804 | Shop-Baseline übergeben, Marke, 9 Felder, Schutzsumme | bestanden | | ok |
| 811–817 | Shop | `257`, `76f027a6a335b9f8599955dbb371d943`, `594`, `594`, `286`, `658`, `8793a9e2abd76190c23bcb24e64f6e74` | Akte | gleich |
| 818/819 | übergebene und heutige Shop-Baseline | identisch mit der Akte | | gleich |
| 821–824 | Sammlungs-Baseline übergeben, Marke, 5 Felder, Schutzsumme | bestanden | | ok |
| 828/829 | übergebene und heutige Sammlungs-Baseline | identisch mit der Akte | | gleich |
| 831–833 | Sammlung | `21`, `1`, `965b149286b4e61212ef48a94a8bab01` | Akte | gleich |

**Vergleich mit dem Preflight:** 231–253 sind **zeichengleich** mit 131–153 — beide als `postgres`
gemessen, also rollengleich verglichen. Keine Zeile in Abgleichssitzungen, Entscheidungen,
Übernahmen, Verkäufen, Positionen, Erstattungen, Lagerbewegungen, Altbestand oder Journal hat sich
bewegt, kein Funktions- oder Tabellenrecht, keine Policy. Die Rechte des Prüfzugangs (251–253 als
Prüfzugang) sind ebenfalls gleich seinem Preflight.

**Rechte des Prüfzugangs:** `npm run db:privileges:staging` (2026-11-04, 15:19 UTC) — Abdruck
`13f9f823c5e6ee8f…` unverändert seit 0176, Einrichtungsdatei und Datenbank stimmen überein
(`supabase/privileges/staging-agent.json`, nur der Erhebungszeitpunkt neu).

**Eingefrorene Akte:** `supabase/baselines/baseline-0178.json`, unverändert seit dem Preflight,
SHA-256 `ab05e6e08e7f74e842446fc40f0c76e3d9ef6f37c1c73865c94111e5a69e79d2`.

## Ablauf (ADR-0137) — ausgeführt am 2026-11-04

1. Arbeitsbaum sauber, `npm test`, `npm run check`, `npm run verify:sums`.
2. Preflight und Baselines: erledigt (oben); Akte `baseline-0178.json` steht.
3. **Einfügen:** `supabase/operations/staging-0178.sql` vollständig in den SQL-Editor, ausführen.
   Erwartet: NOTICE `A3`, die NOTICE der Migration, `0178 ok`, dann `commit`. Bricht etwas ab, ist
   **nichts** angewendet (eine Transaktion; Z1 vergleicht Daten, Rechte und Policies, Z2 die Rümpfe
   samt Apply und Decide, Z3 den `search_path`).
4. **Nachkontrolle:** `npm run db:migrate:staging -- 0178 --resume`. Erwartet 9999 = `0`;
   201 = `d70ee33c2b740aa811704ad5e561a34e`, 202 = `51213fd88afb5441a487dc89bba2ac06`,
   211 = `f8b1132c27ba1b18123f6c2548f9997c`, 212 = `2526d3a77ccf3153158182d0ecd391aa`.
5. **Berechtigter Postflight als `postgres`** (vom Runner erzeugt, Baselines eingesetzt,
   `begin … rollback`): 9998 = `0`, 9999 = `0`; 231–253 gleich den privilegierten Preflight-Werten
   131–153.
6. **Rechte:** `npm run db:privileges:staging` — unverändert.
7. **Akte:** Zeile in `APPLIED.md` in die Staging-Tabelle, `npm run sums:write`.

## Rückbau

`supabase/rollback/R0178_sales_recon_without_comparison.sql` — nur solange `0179` nicht steht
(sie verweigert sonst selbst). Production: eigene, spätere Entscheidung.
