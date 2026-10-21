# Angewendete Migrationen — die Fassung, die wirklich gelaufen ist

Diese Datei ist das Gedächtnis des Projekts für eine Frage, die Git allein
nicht beantwortet: **welcher Dateiinhalt wurde auf Staging tatsächlich
ausgeführt?** Eine Migration, die nach ihrer Ausführung geändert wird, sieht
hinterher aus wie die, die gelaufen ist — und ist es nicht (`0130`).

Erfasst sind die Migrationen ab `0122`, also ab dem Eigenbeleg-Teil. Ältere
sind seit Langem angewendet und in Git versioniert; für sie ist der Commit die
Historie.

`src/lib/admin/migration-integrity.test.ts` liest **diese Tabelle** und prüft
jede Zeile bei jedem Testlauf. Die Spalte `Datei heute` ist der Vertrag:
`gleich` heißt, die Datei im Repository ist bitgenau die ausgeführte Fassung.

## Staging

| Migration | SHA-256 der ausgeführten Fassung | Datei heute | Nachweis |
|---|---|---|---|
| `0122_purchase_receipts.sql` | `b79e9677ec8b7669fef570fdb62e2cb42eb086044b6ddc08a5d2ec2e520e3599` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0123_purchase_receipt_format_version.sql` | `b87e8795ffe63d4477a24792fbcbc91a4720789937c78366346d935bc6be0f58` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0124_orderbook_receipt_status.sql` | `f8efa038a7aa4116b0602dc16460d3f63df65c0a6770182dcc5d591cfea0b53e` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0125_revoke_internal_fingerprint_execute.sql` | `fba03467c10e77545c747c89105c05668be0e1d3d0c5add12545ddc9b2fc7fd2` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0126_purchase_item_edit.sql` | `536239adcc3b97d5d7a1438c7615f1b6060d2c42b33ba9544b31c5c0afd8248d` | gleich | vom Betreiber als angewendet bestätigt; Fassung seit der ersten Berichtung unverändert |
| `0127_purchase_item_swap.sql` | `35e52cecd351b044a3218dc660e35cc1efa1dcf6c003f6fc7fe3aa2dbf6287f9` | gleich | erster Versuch brach in der Nachbedingung ab und rollte zurück; diese korrigierte Fassung lief erfolgreich, bestätigt durch `0127_swap_effect_check.sql` auf Staging |
| `0128_purchase_receipt_corrections.sql` | `8effcdff114a0de510db333ce01df979d5d506fcdee0d57191de8387f69415d2` | gleich | belegt über den erfolgreichen `0129_preflight` und `0129_postflight`, die die Strukturen aus `0128` voraussetzen |
| `0129_business_backup_receipts.sql` | `d4b0f17b24bca90ac0844b7e35b10e64e55da04ceef4e97a0daf89703b2c16f8` | gleich | Betreiber: Postflight `9999 = 0`; `0129_export_baseline.sql` ergab 28 Bereiche und 5 508 Datensätze |
| `0130_business_backup_fields.sql` | `37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe` | abweichend — siehe `supabase/checks/0130_amendment.md` | Betreiber: erfolgreich; gemessen durch den `0131`-Preflight mit 339 Feldzeilen (Stand nach `0130`) |
| `0131_business_backup_seller_fields.sql` | `644cc0bbd15073426f54af6fa542281c95b8e4d4dc5abb8ce2d63a3b4c35f218` | gleich | Betreiber: Postflight `9999 = 0`; erster Versuch mit einer früheren Fassung brach ab und rollte zurück |
| `0132_purchase_item_remove_by_line.sql` | `382aa64749cb035e9a6402fe36fc16f9e1ae663228c7806cc34e29331b7ec6b3` | gleich | **2026-10-18**, Betreiber: manuell im SQL-Editor in `BEGIN`/`COMMIT`, beide `NOTICE`-Zeilen erschienen. **Zwei** Postflights bestanden: `0132_postflight.sql` `9999 = 0` (Herkunftssperre weg, die vier Zeilenbedingungen stehen, der Riegel auf `total_cost` ist da) und `receipt_lock_check.sql` `9999 = 0` (die Belegsperre hat die Migration unverändert überstanden). Bezugswerte unverändert: 84 importierte Einkäufe, 2 114 Positionen, 285 Lagerzeilen, 812 Einheiten, 26 Bewegungen, Importsumme 4476.39, 2 Eigenbelege. Dieselbe Prüfsumme wie der Production-Lauf |
| `0135_catalog_item_type.sql` | `08a75cf0ade1ae10f21f76038df6a8407746bf1db76e1c8b02ebeb3d0c637a04` | gleich | **2026-10-19**, Betreiber: manuell im SQL-Editor, **über das Einmal-Skript** `supabase/operations/staging-0135-0136.sql` (SHA-256 `60294b8cc2794eada94f3e4c7a2c41b29487743f02ba8c58477a85ffc5d598a9`), dessen eingebettete Abschnitte zeichengleich zu dieser Datei sind — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. Ein Durchgang, eine Transaktion. Abschlussraster: **19 Bezugswerte unverändert**, einzige Änderung `sicherung_md5` (siehe `0136`). Der erste Versuch brach in Abschnitt A7 ab (Z0-Vertrag: „overrides ist 53, erwartet 39“) und rollte vollständig zurück — **falsch abgeleiteter Sollwert**, kein Datenbefund; berichtigt, Begründung in `open_verifications.md` Abschnitt 0g |
| `0136_business_backup_item_type.sql` | `fde41c50ad0656c4354aea876b0248a73cdaf129e12def5319f7747ecc136a43` | gleich | **2026-10-19**, im selben Durchgang wie `0135`. Belegt durch das Abschlussraster: `sicherung_md5` `24c3810288bb20929fe995554a267adf` → `f6d08440707ba72a8040a8d1e666c092`, und die Nachbedingung D3 des Skripts verlangt genau diesen Wert. Damit führt die Betriebssicherung 28 Bereiche und **353** Feldzeilen |
| `0137_catalog_accessories.sql` | `220cdfb66c377643ff2870853a254f39107a4defceea88309fcde8cb6de6e15b` | gleich | **2026-10-20**, Betreiber: manuell im SQL-Editor, **über das Einmal-Skript** `supabase/operations/staging-0137-0138.sql` (SHA-256 `83af5cebdcb9130a3b5cb0df17162bde94505aee5d8d83d3c454675fa48b9344`), dessen eingebettete Abschnitte zeichengleich zu dieser Datei sind — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. Ein Durchgang, eine Transaktion, zusammen mit `0138`. Dass die Nachbedingungen des Abschnitts C gehalten haben, folgt aus dem `commit`: eine Abweichung hätte die ganze Transaktion zurückgerollt. Nachgemessen am 2026-10-20 über `npm run verify:shop:staging`: `non_collectible_categories()` liefert `[Bundles, Portale, Spiele, Taschen, Zubehör]` und stimmt mit `src/lib/catalog/collectible.ts` überein (Abschnitt 5, PASS) |
| `0138_catalog_portals.sql` | `2c948264e3d6b0cb3a605deda4027945e3d12b9ab026de3505cd74614598b791` | gleich | **2026-10-20**, im selben Durchgang wie `0137`. Abschlussraster: **17 Bezugswerte unverändert**, drei erwartete Differenzen — `katalogzeilen` 605 → **626**, `kategorien` 32 → **38**, `typen` → `figure=566, game=39, portal=21`. Unabhängig nachgelesen am 2026-10-20 (rein lesend): die **21** Zeilen `SKY-0615`–`0622`, `0624`–`0630`, `0632`–`0637` stehen mit den Rohnamen der Arbeitsmappe, alle `portal` · unsichtbar · aktiv · ohne Preis · ohne Override · ohne Bild · ohne Charakter · `source = admin` · `card_type = standard`, **21 verschiedene Slugs**, **21** Journaleinträge `created`, sechs Kategorien `Portale` in `SA, G, SF, T, SC, I`, `SKY-0637` trägt `SF`. `SKY-0623` und `SKY-0631` fehlen wie vorgesehen (ADR-0128, Punkt 9) |

| `0139_accessory_sale_release.sql` | `55f0fcf9279d6484891e48d209371bbf229464849488b8d20ad02909ad3a5a04` | gleich | **2026-10-20**, Betreiber: manuell im SQL-Editor, **ueber das Einmal-Skript** `supabase/operations/staging-0139.sql` (SHA-256 `19134017c5694c274e3b239ed2295bb3b5a7a3a0777cdd2a85fec09042ab4bd8`), dessen eingebetteter Abschnitt zeichengleich zu dieser Datei ist — geprueft von `src/lib/catalog/staging-oneshot.test.ts`. Eine Transaktion, Umgebungsstempel davor. Postflight `0139_postflight.sql`: **eine** Abweichung, und die lag an der Pruefdatei (Zeile 501 zaehlte ohne `catalog_visible` — 564 statt 534, die 30 ausgeblendeten Figuren; `supabase/checks/open_verifications.md`, Abschnitt 0g). Alle Sicherheitszeilen erfuellt: **0** freigegebene Positionen, **0** Zubehoerangebote, **256** Angebote mit Abdruck `4d1d6c30…`, **534** shopfaehig, **285** Lagerzeilen, **626** Katalogzeilen, Belegsperre dicht |
| `0140_business_backup_sale_release.sql` | `ae74e4006ce0dfef07af87021aec2331e1d13009115255ea5c7b3cbd59499fc5` | gleich | **2026-10-20**, als eigene Transaktion nach `0139`, ueber `supabase/operations/staging-0140.sql` (SHA-256 `5e578594fcc776d2962b053e712c38bba2e5221df7532f3f64d52d753727502d`). Die Betriebssicherung traegt jetzt `sale_released`, `delivery_scope` und `usk_rating`: 353 Feldzeilen → **356**, 28 Bereiche unveraendert |

**Gelaufen ist der Einmal-Durchgang:** `supabase/operations/staging-0137-0138.sql`
(SHA-256 `83af5cebdcb9130a3b5cb0df17162bde94505aee5d8d83d3c454675fa48b9344`) bettet `0137` und `0138` **zeichengleich** ein — geprüft von
`src/lib/catalog/staging-oneshot.test.ts` — und legt eine Transaktion samt
blockierender Vor- und Nachprüfungen darum. Klickfolge, Abnahmeraster und
Rücknahme: `supabase/checks/0137_0138_staging_run.md`.

Der lokale Probelauf fährt beide Migrationen, beide Rücknahmen **und dieses
Skript** gegen echtes PostgreSQL (`npm run verify:check-sql`, Durchgänge
**P22–P30**) — was eine bestandene Planprüfung **nicht** ist, steht in
`supabase/checks/open_verifications.md`, Abschnitt 3a.

## Production

Am **2026-10-17** wurden `0126`–`0131` auf Production
(`zmiwxswrpkmizvqsgype`) angewendet — einzeln, in `begin`/`commit`, in dieser
Reihenfolge, jede mit Pre- und Postflight. Sämtliche Prüfungen `9999 = 0`,
`0131_function_body_check` = `STAND_0131_ZEICHENGLEICH`.

Am **2026-10-18** kamen `0132` und `0133` hinzu — **unbeabsichtigt**. Sie waren
für Staging freigegeben und wurden im Production-Projekt ausgeführt; der
Betreiber hat das am selben Tag festgestellt und gemeldet. **Auf Staging sind
beide weiterhin nicht angewendet.** Sämtliche Prüfzahlen, die zuvor als
Staging-Ergebnisse geführt wurden, sind Production-Ergebnisse. Hergang,
Bewertung und Folgen: `docs/history/2026-10-18-production-0132-0133.md`.

**Der Zustand beider Datenbanken ist bis auf Weiteres GEMELDET, nicht
GEMESSEN.** Diese Akte hält fest, was der Betreiber ausgeführt und mit
Postflight-Ergebnissen bestätigt hat; aus diesem Repository heraus ist keine
Datenbank angefasst worden. Was ein Lauf noch belegen muss, steht vollständig
in `supabase/checks/open_verifications.md` — Production P1–P5, Staging S1–S6.
Den Zustand selbst liest `supabase/checks/state_audit_readonly.sql` aus dem
Katalog statt aus dieser Datei.

| Migration | SHA-256 der ausgeführten Fassung | Datei heute |
|---|---|---|
| `0126_purchase_item_edit.sql` | `536239adcc3b97d5d7a1438c7615f1b6060d2c42b33ba9544b31c5c0afd8248d` | gleich |
| `0127_purchase_item_swap.sql` | `35e52cecd351b044a3218dc660e35cc1efa1dcf6c003f6fc7fe3aa2dbf6287f9` | gleich |
| `0128_purchase_receipt_corrections.sql` | `8effcdff114a0de510db333ce01df979d5d506fcdee0d57191de8387f69415d2` | gleich |
| `0129_business_backup_receipts.sql` | `d4b0f17b24bca90ac0844b7e35b10e64e55da04ceef4e97a0daf89703b2c16f8` | gleich |
| `0130_business_backup_fields.sql` | `bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77` | gleich |
| `0131_business_backup_seller_fields.sql` | `644cc0bbd15073426f54af6fa542281c95b8e4d4dc5abb8ce2d63a3b4c35f218` | gleich |
| `0132_purchase_item_remove_by_line.sql` | `382aa64749cb035e9a6402fe36fc16f9e1ae663228c7806cc34e29331b7ec6b3` | gleich |
| `0133_paid_total_immutable.sql` | `65832d746ce26d3fe5a7c1cb7feaec3a7793917b31d965c7c911215b347e0ef4` | gleich |

**`0130` lief auf Production in der heutigen Repository-Fassung** — dort war
sie erstmalig. Der Nachtrag aus `supabase/checks/0130_amendment.md` betrifft
ausschliesslich Staging, wo sie in der Fassung `37417c45…` lief.

Nach `0128` wurde `supabase/operations/lock-receipt-issuance.sql` angewendet:
keine API-Rolle darf die Eigenbeleg-Ausstellung oder -Korrektur aufrufen,
`postgres` behält EXECUTE. Bestätigt durch `receipt_lock_check.sql` vor und
nach `0129`–`0131`, je `9999 = 0`. **Der Rechtestand weicht damit bewusst von
dem ab, den `0122`/`0128` erklären** — ein erneuter `0128`-Postflight meldet
das in Prüfung 223 (1 statt 2). Rücknahme nur mit Freigabe B über
`unlock-receipt-issuance.sql`.

Protokoll: `docs/history/2026-10-17-production-0126-0131.md`.

## Nicht angewendet

Diese Migrationen liegen vor und sind **nirgends** ausgeführt — weder auf
Staging noch auf Production. Sie stehen hier, damit die Akte lückenlos bleibt:
jede Migration ab `0122` ist entweder oben mit ihrer Prüfsumme erfasst oder in
dieser Liste.

**`0135` und `0136` sind seit dem 2026-10-19 auf Staging angewendet, `0137`
und `0138` seit dem 2026-10-20, `0139` und `0140` ebenfalls seit dem 2026-10-20** — alle sechs stehen deshalb in der Tabelle
oben, nicht mehr hier. Auf Production fehlen sie alle, wie `0134`.

| Migration | Stand |
|---|---|
**Gefahren wurde je ein Einmal-Durchgang:** `supabase/operations/staging-0139.sql` (SHA-256 `19134017c5694c274e3b239ed2295bb3b5a7a3a0777cdd2a85fec09042ab4bd8`) und `supabase/operations/staging-0140.sql` (SHA-256 `5e578594fcc776d2962b053e712c38bba2e5221df7532f3f64d52d753727502d`). Beide betten ihre Migration **zeichengleich** ein — geprueft von `src/lib/catalog/staging-oneshot.test.ts` — und fuegen genau eine Pruefung hinzu: den Umgebungsstempel (`SKY-0821`/`SKY-0822`), den eine Migration nicht kennen kann. Dass er anschlaegt, faehrt Probelauf **P39** nach. Reihenfolge, Erwartungen und Ruecknahme: `supabase/checks/0139_0140_staging_run.md`. **Beide sind seit dem 2026-10-20 angewendet und damit nach Regel 1 eingefroren** — auch ihre Nachbedingungen. Was an ihren Pruefdateien zu berichtigen war, wurde in `supabase/checks/` berichtigt, nicht in der Migration.

| `0141_seller_sale_state.sql` | lokal vorbereitet, **noch nicht freigegeben**. **Rein additiv:** eine neue Lesefunktion `seller_sale_state()` — je Lagerposition Artikeltyp, `sale_released`, `delivery_scope`, `usk_rating`, verkaeuflich ja/nein und der Grund. Der Grund wird aus `admin_shop_listing_audit()` GEJOINT, nicht nachgerechnet. Keine Spalte, keine Zeile, kein bestehender Rumpf, kein bestehendes Recht — insbesondere wird `admin_shop_inventory()` nicht erweitert. Setzt `0139` voraus. Lauf: `supabase/operations/staging-0141.sql`; Ruecknahme `supabase/rollback/R0141_drop_sale_state.sql`. SHA-256: `54c79e5ae7ca1de3ac6742dbf64bc5cf0c8b002ae39eb2f196659ae5426d13aa` |
| `0134_purchase_item_source_row_visible.sql` | lokal vorbereitet, **noch nicht freigegeben**. Gibt `source_row` in der Positionsliste von `seller_purchase()` mit aus, damit der Dialog dieselben vier Ablehnungsgründe prüft wie die Datenbank. Der Funktionskörper ist der aus `0119` mit genau einem zusätzlichen Schlüssel; Rücknahme `supabase/rollback/R0134_purchase_item_source_row_visible.sql`. SHA-256 der vorliegenden Fassung: `b2a745e34e0349640f3a4b10efe9da45bb633c854efd703fc8e6c146514e9b49` |

**Beide zusammen in einem Durchgang:** `supabase/operations/staging-0135-0136.sql` (SHA-256 `654d20fbdb08cb319c0d95005a403fa5cffe13ca77c41d44aafedaf9dc50bb17`) bettet `0135` und `0136` **zeichengleich** ein — geprueft von `src/lib/catalog/staging-oneshot.test.ts` — und legt eine Transaktion samt blockierender Vor- und Nachpruefungen darum. Wird der Lauf darueber gefahren, gehoert in die Tabelle oben die SHA-256 des **Skripts** mit dem Hinweis, dass die eingebetteten Abschnitte den beiden Migrationsdateien entsprechen.

**`0132` und `0133` kamen am 2026-10-18 zuerst auf Production** — unbeabsichtigt,
vorgesehen war Staging. Nachgezogen wird seitdem Staging, nicht auf Production
zurückgenommen.

**Stand:** `0132` ist inzwischen **auch auf Staging** angewendet und dort mit
zwei Postflights belegt (Zeile oben). **`0133` fehlt auf Staging weiterhin**;
dazu sind am 2026-10-19 `0135` und `0136` auf Staging gelaufen. Die
Staging-Tabelle hat damit eine **Lücke bei `0133`/`0134`** — gewollt, und im
Abschnitt „Die Nummer ist eine Reihenfolge, keine Kette" begründet. Reihenfolge und Freigaben:
`supabase/checks/0132_staging_plan.md`; der Nachweis je Lauf steht in
`supabase/checks/open_verifications.md`.

## Die Nummer ist eine Reihenfolge, keine Kette

Eine Migrationsnummer sagt, in welcher Reihenfolge die Dateien **entstanden**
sind. Sie sagt **nicht**, dass jede Zahl davor in einer Umgebung stehen muss.
Was tatsächlich steht, sagt allein diese Akte — und seit dem 2026-10-18 stehen
Staging und Production ausdrücklich **nicht** auf demselben Stand.

Deshalb ist die folgende Lücke erlaubt und keine Nachlässigkeit:

| Umgebung | angewendet | offen |
|---|---|---|
| Staging `qqxcpesbwfxzgytkdsac` | … `0132` | `0133`, `0134` |
| Production `zmiwxswrpkmizvqsgype` | … `0133` | `0134` |

**`0135` und `0136` dürfen auf Staging vor `0133` und `0134` laufen.** Das ist
keine Abschätzung, sondern an den berührten Objekten ablesbar:

| Migration | ersetzt / ändert | liest |
|---|---|---|
| `0133` | Trigger `purchases_paid_total_immutable_trg`, Funktion `purchases_paid_total_is_final()` | `purchases` |
| `0134` | Funktion `seller_purchase(bigint)` | `purchases`, `purchase_items`, `skylanders` |
| `0135` | Tabelle `skylanders` (+ Spalte `item_type`, + CHECK), Funktion `is_shop_eligible(text)` | `categories`, `shop_offers()`, `non_collectible_categories()` |
| `0136` | Funktion `seller_business_backup()` | alle 28 Exportbereiche, darunter `skylanders` |

Die Schnittmenge der GEÄNDERTEN Objekte ist **leer**. `0134` und `0136` lesen
beide `skylanders`, aber Lesen begründet keine Reihenfolge: `0135` fügt eine
Spalte hinzu und nimmt keine weg, und `seller_purchase()` nennt seine Spalten
einzeln — eine zusätzliche Spalte ist für sie unsichtbar. Umgekehrt braucht
`0136` die Spalte aus `0135`, und **nur** diese eine Abhängigkeit besteht:

```
0135  →  0136        zwingend (der Rumpf liest t.item_type)
0133  ⊥  0135, 0136  unabhängig
0134  ⊥  0135, 0136  unabhängig
```

Nachgefahren wird das nicht nur behauptet: `npm run verify:check-sql` fährt
`0135` und `0136` in einer Wegwerf-Instanz (PostgreSQL 18.6 als WebAssembly,
erfundene Zeilen) und prüft unter anderem, dass `0136` **vor** `0135`
abbricht — und dass die Rücknahmen nur in der Reihenfolge `R0136`, `R0135`
durchgehen.

**Was beim Nachziehen zu tun ist:** wird `0133` später auf Staging angewendet,
während `0135`/`0136` schon stehen, ändert das an beiden nichts — `0133`
hängt an `purchases` und `0132`, nicht am Katalog. Die Tabelle oben wird dann
in der Reihenfolge der **Ausführung** ergänzt, nicht in der der Nummern; die
Spalte „Datum" hält die Wahrheit, die Nummer nur die Herkunft.

## Zwei eingefrorene Kopfzeilen, die nicht mehr stimmen

`0132` und `0133` sind angewendet und werden deshalb **nicht mehr geändert** —
auch nicht ihr Kommentarkopf. Beide behaupten dort etwas, das seit dem
2026-10-18 falsch ist:

| Datei | Zeile im Kopf | tatsächlich |
|---|---|---|
| `0132_purchase_item_remove_by_line.sql` | „NUR LOKAL VORBEREITET. Nicht auf Staging und nicht auf Production ausgefuehrt." | **auf Production angewendet**, auf Staging nicht |
| `0133_paid_total_immutable.sql` | „NICHT FREIGEGEBEN. Vorbereitet, nirgends angewendet." | **auf Production angewendet**, auf Staging nicht |

Eine Korrektur im Dateikopf wäre genau der Fehler, den diese Akte verhindern
soll: die Prüfsumme der ausgeführten Fassung würde nicht mehr passen, und
niemand könnte später beweisen, was gelaufen ist. **Der Stand steht hier, in
der Tabelle oben, und im Protokoll** — nicht in der Datei.

## Der eine abweichende Fall

`0130` wurde **nach** der Ausführung um vier Zeilen in ihrem
Nachbedingungsblock ergänzt. Umfang, Beweis und das Rezept, mit dem die
ausgeführte Fassung aus der heutigen nachgerechnet wird, stehen in
`supabase/checks/0130_amendment.md`. Der Test prüft beides: dass die Datei
heute **nicht** mehr der ausgeführten Fassung entspricht, und dass das Rezept
genau diese Prüfsumme wiederherstellt.

**`0130` wird nicht erneut angewendet.**

## Der vorbereitete Production-Release (`0135`–`0141`)

**Nichts davon ist ausgefuehrt.** Production steht **gemessen** auf `0133`
(`non_collectible_categories()` = Fassung `0006`, `shop_offers()` vier
Spalten, `seller_sale_state()` fehlt). Sieben Migrationen fehlen dort, und
fuer jede liegt eine eigene Einmal-Datei bereit — **nicht** die
Staging-Fassung ohne Riegel, sondern mit dem UMGEKEHRTEN Stempel: der
Staging-Stempel muss fehlen, `0133` muss da sein, und der Katalog muss
Zeilen haben. Probelauf **P41** faehrt alle drei Richtungen nach.

| Migration | Lauf | SHA-256 des Laufs |
|---|---|---|
| `0135` | `supabase/operations/prod-0135.sql` | `7b3c470e67a1c641318079b53a2fc0c74046128b9fa680f12205627a43a75b7e` |
| `0136` | `supabase/operations/prod-0136.sql` | `c050c600a152eab31cd87e95100b20933dd5cfbbe99f317f69bd9744552bcd1a` |
| `0137` | `supabase/operations/prod-0137.sql` | `7cdb46b85c0e860af8260b01765fafe58a0cca451d3cacb2e880adf544b0550c` |
| `0138` | `supabase/operations/prod-0138.sql` | `d7db14faa2d4cb1402e4a318e7cd538ddf4e38b0a550ad2a567af17cd76f7a89` |
| `0139` | `supabase/operations/prod-0139.sql` | `23e24df824079e25bba2571a86612355d703806dd955db0125a0c7f32a38adc2` |
| `0140` | `supabase/operations/prod-0140.sql` | `386a4bec05a29b262c180098648f43532470337dc20d1460e7b50c39002e0d3c` |
| `0141` | `supabase/operations/prod-0141.sql` | `2aa004372bee9629ae934d123b84235ea4a0921d202751df53a54814fb37635d` |

**Die Reihenfolge ist nicht beliebig:** `0135`→`0136`→`0137`→
**Vercel-Deployment**→`0138`→`0139`→`0140`→`0141`. Begruendung und Beweis
je Schritt: `supabase/checks/production_release_0135_0141.md`; die
Bedienanleitung: `supabase/checks/production_release_checklist.md`.

**`0134` ist nicht Teil des Releases** — nirgends angewendet, und der
Anwendungscode arbeitet ohne sie.

---

## Wie ein zweiter Lauf verhindert wird — drei Schichten

Dieses Projekt führt **keine** `supabase_migrations.schema_migrations`.
Migrationen werden von Hand im SQL-Editor angewendet, und das Register ist
diese Datei (`supabase/checks/disaster_recovery_pg_dump.md`, Abschnitt 4).
Die Frage „kann `0139` versehentlich noch einmal laufen?" beantworten
deshalb drei Schichten, von innen nach außen:

| # | Schicht | greift wann |
|---|---|---|
| **1** | **Die Migration selbst.** Abschnitt 1b von `0139` bricht mit `shop_inventory.sale_released steht schon` ab; `0140` mit `% Feldzeilen statt 353`. Beide **vor** der ersten Änderung, in derselben Transaktion | immer, auch ohne Register und ohne Mensch |
| **2** | **Die Datenbank sagt, was steht.** `supabase/checks/staging_pending_migrations.sql`, Zeilen 241–246: stehen die drei Spalten? kennt die Sicherung die drei Felder? passt beides zusammen? Rein lesend, vor jedem Lauf | wer nachsieht, muss nicht raten |
| **3** | **Diese Akte.** Jede angewendete Datei mit SHA-256 und Nachweis; `src/lib/admin/migration-integrity.test.ts` prüft, dass die Tabelle vollständig ist und die Prüfsummen stimmen | bei jedem Testlauf |

**Schicht 1 ist die eigentliche Sicherung** — sie braucht niemanden, der
etwas gepflegt hat. Probelauf **P39** fährt sie nach: beide Einmal-Skripte
laufen einmal durch, prallen beim zweiten Mal ab, und danach steht immer
noch keine Position auf `sale_released`.

**Wenn die Supabase-CLI jemals dazukommt** (`supabase db push`), bringt sie
ihr eigenes Register mit. Das Zusammenführen von 140 handangewendeten
Migrationen mit einer leeren `schema_migrations` ist ein **eigenes
Vorhaben** und keine Nebenwirkung — `supabase/checks/staging_agent_access_plan.md`,
Abschnitt B, hält das fest. Bis dahin gilt: die CLI wird nicht benutzt, und
Schicht 1 trägt.

---

## Regeln

1. Eine angewendete Migration wird nicht mehr geändert — auch nicht ihre
   Nachbedingung. Neue Wächter gehören in `supabase/checks/` und in die
   Testsuite; dort wirken sie auch nach der Ausführung.
2. Wird eine Migration angewendet, kommt sie **mit ihrer Prüfsumme** in diese
   Tabelle, bevor die nächste beginnt.
3. Wird eine angewendete Migration doch verändert, bleibt ihre Zeile
   unverändert, die Spalte `Datei heute` wird auf `abweichend` gesetzt, und der
   Umfang wird in einem eigenen Nachtrag belegt — mit einem Test, der den
   Umfang nachrechnet.
4. Für Production gilt diese Tabelle nicht. Sie beschreibt Staging. Eine
   Production-Anwendung braucht eine eigene Freigabe und eine eigene Zeile.

## Nicht erfasst

`0001`–`0121`: angewendet, committet, durch Git versioniert. Ihre Prüfsummen
stehen in `supabase/SHA256SUMS.txt` und fallen damit auf, wenn sie sich
ändern — nur eben ohne die Aussage „genau so ist sie gelaufen".
