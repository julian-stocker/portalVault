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
| `0144_platform_export_calculations.sql` | `e012bba227640c7a40a914fd9e365120b0f7f887c88be7623f21747ce0727380` | gleich | **2026-10-25**, Betreiber: manuell im SQL-Editor, **über den Einmal-Durchgang** `supabase/operations/staging-0144.sql` (SHA-256 `89ca0cd697a449c75d8cc90bc2a718088946464d7ccf87f05f6ca16c246a2c93`), der die Migration **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. Preflight bestanden (Rumpfabdruck `2e2da90e976a1e73ca00aba7cd830fae`, 53 Bereiche), Postflight **vollständig bestanden** (`9999 = 0`): Abdruck `4c4d2e7c81e4efa8e18cdffa06bba40a`, **54 Bereiche**, Formatversion 2. **Zusätzlich im Betrieb nachgewiesen**, und das ist der stärkere Beweis: ein echter Plattformexport über `/admin/datensicherung`, lokal geprüft mit `npm run verify:platform-archive`, und die Historienzeile in `platform_export_runs` stimmte mit dem ZIP überein. **Auf Production NICHT angewendet** — dort steht weiter der Rumpf aus `0105` |
| `0145_favorites.sql` | `6f9c20b0197386077a092f1e4b62e20e64488cc5a7e43bdf497e2a2c6bd7d71d` | gleich | **2026-10-25**, Betreiber: manuell im SQL-Editor, **über den Einmal-Durchgang** `supabase/operations/staging-0145.sql` (SHA-256 `151ce263f7be7897b0e270ff7b53ddabbcbed22f20f98fc811130f2ed5bb7924`), der die Migration **zeichengleich** einbettet. Preflight bestanden (nach einer Berichtigung: Zeile 121 zählte Richtlinien statt sie zu benennen — auf Staging trägt `collection_items` fünf, weil `agent_read_collection_items` dazukommt, `docs/SECURITY.md` 4b). Postflight: der **erste Lauf** meldete `9999 = 18` — genau die achtzehn Zeilen der Baseline-Übergabe (801–804, 811–817, 821–824, 831–833), weil die Platzhälter nicht ersetzt waren; **alle übrigen Prüfungen grün** — Tabelle, Primärschlüssel `(user_id, sky_id)`, RLS, die drei Richtlinien, die Rechte `SELECT/INSERT/DELETE`, `favorite_demand()`. Die gemessenen Baselines stehen seitdem in `staging-s-postflight-0145.sql`, und der **Wiederholungslauf ist vollständig bestanden: `9999 = 0`** — Shop und Sammlung unverändert. **Funktional nachgewiesen:** `npm run verify:rls:staging`, Abschnitt 10, **17 von 17** mit zwei echten Konten — keines liest, legt an oder löscht beim anderen, `favorite_demand()` weist Sammler, `anon` UND den Dienstschlüssel ab. Einzelheiten: `supabase/checks/0145_staging_run.md`. **Auf Production NICHT angewendet** — und sie darf dort erst nach der Folgemigration laufen, die `favorites` in die Plattformsicherung aufnimmt (ADR-0136) |
| `0146_offer_state.sql` | `2a9caf5a13c3962e9e27e2707d6274f47ca1e7833b28183466d35a65378171ad` | gleich | **2026-10-25**, Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0146.sql`. Preflight bestanden. Die Nachkontrolle brauchte **fünf Anläufe**, und jeder deckte einen echten Mangel am Prüfweg auf, nicht an der Migration: die Baseline-Übergabe war Handarbeit (ADR-0137), dem Pooler fehlte die private CA (ADR-0138), `offer_state`/`offer_state_live` und der Aufruf von `offer_state_window()` waren dem Prüfzugang nicht erteilt (ADR-0139), die Erteilung auf `shop_offers()` war durch `drop function` in `0139` verloren gegangen (ADR-0140), und `information_schema` ist rechtegefiltert — Prüfung 102 meldete „(keine Tabelle)“, während drei Rechtezeilen **still grün** waren (ADR-0141). **Vollständig bestanden: `9998 = 0`, `9999 = 0`** — Shop, Lager und Sammlung unverändert. **Erstbefüllung im Betrieb nachgewiesen:** 225 kaufbare SKY-IDs, alle als bereits angekündigt angelegt, Wiederholung `225 geprüft, 0 verändert`. Einzelheiten: `supabase/checks/0146_staging_run.md`. **Auf Production NICHT angewendet** |

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

Am **2026-10-21** kam `0135` hinzu — der erste Schritt des Releases
`0135`–`0141`, und der erste Production-Lauf dieses Projekts, der **vorher**
geplant und **danach gemessen** wurde. Gefahren über
`supabase/operations/prod-0135.sql` (SHA-256
`6adea7e58f24853a85624249506fe796c5082adb0bf7ad03541a2ba1b1f8e793`), die
`0135` zeichengleich einbettet und genau eine Prüfung hinzufügt: den
**umgekehrten** Umgebungsstempel, der auf Staging abbricht. Dass er das tut,
fährt Probelauf **P41** nach — einschließlich des Falls, dass nur `SKY-0821`
da ist: Production trägt diese Zeile rechtmäßig, und erst das vollständige
Paar `SKY-0821` **und** `SKY-0822` bedeutet Staging.

Am **2026-10-21** folgten `0136` und `0137`, einzeln, über
`supabase/operations/prod-0136.sql` (SHA-256
`bef6821b4f44c756cf68fe0f15942e3ef4c75c8b02f928f52d49625903042925`) und
`supabase/operations/prod-0137.sql` (SHA-256
`e717b1ba0b7210f15f6bf927415b4a96d9cf46b061aa15376eebc554f790278e`). **Der
SQL-Editor zeigt `NOTICE`-Meldungen nicht an** — „Success" ist deshalb kein
sichtbarer Befund. Dass eine Datei durchlief, heißt immerhin: ihre eigenen
Nachbedingungen haben in derselben Transaktion gehalten, denn eine Abweichung
hätte alles zurückgerollt. Für den sichtbaren Nachweis gibt es seitdem zwei
rein lesende Dateien, `supabase/operations/prod-s-postflight-0136.sql` und
`-0137.sql` (Probeläufe **P42**/**P43**).

**Zu `0137` ist die Nachkontrolle gefahren und bestanden (2026-10-21):**
`9999 = 0`, 287 Angebote, Abdruck der Angebotsliste
`9b8341058bbfa0f7809eddc300ab0e9e` — der Bezugswert für `0139`.

**Danach wurde der neue Code deployt:** `git push origin main` am 2026-10-21,
`81386e6..21353e4`, 27 Commits; Vercel-Build nach 64 Sekunden live. Die sechs
öffentlichen Seiten antworten mit HTTP 200 und ohne Fehlermarker, die
Datenbank ist dabei unberührt geblieben (nachgemessen: 287 Angebote, 306
Lagerpositionen). Rollback-Ziel bleibt `81386e6`.

**Am 2026-10-21 folgte `0138`** — die erste Migration dieses Releases, die
Zeilen anlegt, gefahren über `supabase/operations/prod-0138.sql` (SHA-256
`ca68b7ec425d28576d4ff03dc8be7c4a31ba986ce78754253a84ccdb172c6b57`). Davor
der lesende Preflight, danach die lesende Nachkontrolle (beide neu:
`prod-s-preflight-0138.sql`, `prod-s-postflight-0138.sql`, Probelauf
**P44**). **Postflight `9999 = 0`**, vom Betreiber bestätigt: alle **21
Portale** angelegt · **624** Katalogzeilen (603 + 21) · **531** sammelbare
Figuren **unverändert** · **287** Angebote · **306** Lagerpositionen ·
Angebotsabdruck **unverändert** `9b8341058bbfa0f7809eddc300ab0e9e`.

Die 21 Portale sind `catalog_visible = false`; `skyisles.app/zubehoer` zeigt
deshalb weiter **39 Artikel** — nachgemessen am laufenden System. Die
Checkliste hatte an dieser Stelle „60 Artikel" versprochen, was die
Staging-Zahl ist (dort sind die Portale freigegeben); das ist berichtigt.

**Zu `0136` liegt der sichtbare Nachweis seit dem 2026-10-21 vor:**
Nachkontrolle gefahren, **`9999 = 0`**.

**Am 2026-10-21 folgte `0139`** — das Verkaufstor für Zubehör, gefahren über
`supabase/operations/prod-0139.sql` (SHA-256
`6f3aad33e96457ac35a29e8764308cce1df7aa07fac5c1bf8bf8f5a800cf0c97`), mit
lesendem Preflight davor und Nachkontrolle danach, beide im Z0-Modus
**`production`** — die sechs Bezugszahlen sind dort **blockierend** geprüft,
nicht nur gemessen. Probelauf **P45**.

**Postflight `9999 = 0`**, vom Betreiber bestätigt: **287** Angebote, Abdruck
**unverändert** `9b8341058bbfa0f7809eddc300ab0e9e` · **531** sammelbare
Figuren · **306** Lagerpositionen · **624** Katalogeinträge · **0**
Unterschiede zwischen alter und neuer Verkaufslogik für bestehende
Figurenpositionen · **0** freigegebene Zubehörpositionen · **0** öffentliche
Zubehörangebote · **4** Verkaufsfunktionen fragen `is_position_sellable()` ·
Belegsperre unverändert.

Unabhängig nachgemessen (lesend, aus dem Repository): `shop_offers()` liefert
jetzt **fünf** Spalten (`available, condition, delivery_scope, price,
sky_id`), `delivery_scope` ist bei allen 287 Figurenangeboten `null`, und
`seller_sale_state()` antwortet weiter `PGRST202` — `0141` ist richtig noch
nicht angewendet.

**Am 2026-10-21 folgte `0140`** — die Betriebssicherung kennt die Freigabe,
den Lieferumfang und die USK-Kennzeichnung. Gefahren über
`supabase/operations/prod-0140.sql` (SHA-256
`cc4a88ad3bd9804605c00c67d60926b8cb19a43e21820db9f6ace12a111f6d88`), mit
lesendem Preflight und Nachkontrolle; **beide Prüfdateien sind erst für
diesen Lauf entstanden** — `0140` war die einzige Migration des Releases
ohne. **Postflight `9999 = 0`**, bestätigt: `seller_business_backup()`
trägt den Abdruck **a32b148cebe00ee0d0d469f96fd2028e**, **28** Bereiche,
**356** Feldzeilen · 287 Angebote und Abdruck
`9b8341058bbfa0f7809eddc300ab0e9e` unverändert · 531 sammelbar · 306
Lagerpositionen · 624 Katalogzeilen · **0** Zubehör-Verkaufsfreigaben ·
Lagerabdruck **01e50b9d727a0486ff1ea0eb6ba2dd56** · Belegsperre unverändert.

Die drei Abdrücke der Prüfdateien (Rumpf, Länge, Kommentar) sind aus der
Migrationsdatei **gerechnet**, nicht abgelesen; die Rechnung ist an `0136`
geprüft und wird von `src/lib/backup/backup-sale-release.test.ts` bei jedem
Testlauf wiederholt. Probelauf **P46** fährt sie zusätzlich an echtem
PostgreSQL nach.

**Am 2026-10-21 folgte `0141`** — `seller_sale_state()`, die Lesefunktion des
Betriebs. Rein additiv. **Postflight `9999 = 0`**, bestätigt: Rumpfabdruck
**7befc95e690d91b239e4368b41644871**, alle acht Rückgabespalten und die
Rechte korrekt, **drei bestehende Nachbarfunktionen unverändert**
(`admin_shop_inventory` `857b767d…`, `admin_shop_listing_audit` `f36137c4…`,
die Betriebssicherung `a32b148c…`) · 287 Angebote und Abdruck
`9b8341058bbfa0f7809eddc300ab0e9e` · 531 sammelbar · 306 Lagerpositionen ·
624 Katalogzeilen · Lagerabdruck `01e50b9d727a0486ff1ea0eb6ba2dd56`
unverändert · **0** Zubehörfreigaben, **0** öffentliche Zubehörangebote ·
Belegsperre unverändert. Probelauf **P47** fährt den Schritt am Stück,
einschließlich der Probe, dass ein zweiter Lauf abprallt.

**Am 2026-10-25 folgten `0142` und `0143`** — der Kalkulator (ADR-0131) und
die Übernahme ins Orderbuch (ADR-0132). **Beide Postflights `9999 = 0`**,
vom Betreiber bestätigt: alle Baseline-Prüfungen bestanden, alle Shop- und
Lagerwerte unverändert, RLS, Berechtigungen und Belegsperre unverändert.

Die Reihenfolge war diesmal **umgekehrt** — Datenbank zuerst, Code danach —
und zwar begründet: der deployte Stand kennt weder `purchase_calculations`
noch `seller_create_purchase_from_calculation`, der Zwischenzustand ist also
wirkungslos. Umgekehrt hätte `listCalculations()` ein `42P01` bekommen und
der Kalkulator „konnten nicht geladen werden" gemeldet — sichtbar kaputt,
genau an der Stelle, die das Release liefert. Begründung vollständig in
`supabase/checks/production_release_0142_0143.md`, Abschnitt 2.

**Ein Befund auf dem Weg dorthin, und er war meiner.** Der erste
Production-Preflight meldete `9999 = 4`: Angebote 287 → 307, Lagerzeilen
306 → 337, beide Abdrücke entsprechend. Ursache war nicht die Datenbank,
sondern die Art der Erwartung — sieben Geschäftszahlen standen als
blockierende Konstanten vom 2026-10-21 in einer Prüfdatei, und keine von
ihnen ist eine Voraussetzung für `0142`. Nachgewiesen gewöhnlicher
Geschäftsbetrieb: 306 alte Lagerzeilen stehen noch alle da, 31 neue dazu,
jede mit Buchung und an einem Einkauf (`prod-s-baseline-drift.sql`,
`9999 = 0`). Seitdem **messen** die Preflights diese Zahlen und übergeben
sie als eine Baseline-Zeile; die Nachkontrolle vergleicht blockierend gegen
das tatsächliche Vorher. Hergang:
`supabase/checks/production_baseline_0142_finding.md`.

**ACHTUNG, REGEL 1 GILT AB JETZT FÜR BEIDE.** `0142` und `0143` sind
angewendet und damit eingefroren — auch ihre Nachbedingungen. Ein zweiter
Lauf prallt ohnehin ab: `0142` bricht mit „public.purchase_calculations
steht schon", `0143` mit „seller_create_purchase_from_calculation steht
schon". Probelauf **P48** fährt genau das nach.

**Damit ist das Release `0135`–`0143` auf Production vollständig.**
Nachgemessen, lesend: `seller_sale_state()` antwortet `anon` mit `42501` —
sie steht und ist dicht.

**Zu `0137` lesend gemessen (2026-10-21):** `non_collectible_categories()`
liefert `[Spiele, Portale, Bundles, Taschen, Zubehör]` und stimmt damit mit
der Liste der Anwendung überein (`verify:shop:prod`, Abschnitt 5 — vorher der
einzige dortige Widerspruch) · `seller_create_catalog_item(p_name,
p_series_code, p_item_type)` antwortet `42501`, steht also und ist für `anon`
gesperrt; mit falschem Parameternamen `PGRST202`, womit die Probe die
Signatur trifft und nicht nur den Namen · `seller_import_catalog` `42501` ·
287 Angebote, 306 Lagerpositionen, 293 verkäuflich, 6 Opt-outs, 13 nicht
sammelbar · 570 öffentlich sichtbare Katalogzeilen, 531 sammelbar, 39 Spiele,
nur die Typen `figure` und `game`. **`0137` schreibt auf Anweisungsebene
keine Geschäftstabelle** — vier `create or replace function`, vier `comment`,
drei `revoke`, zwei `grant`, ein `drop function`, zwei `do`-Blöcke, eine
temporäre Tabelle; die drei `insert` der Datei stehen im Rumpf von
`seller_create_catalog_item`. Das rechnet
`src/lib/catalog/staging-oneshot.test.ts` nach.

Nachher gemessen, lesend, aus diesem Repository (`npm run verify:shop:prod`):
`skylanders.item_type` steht · **39** Zeilen `item_type = 'game'`, **39** in
der Kategorie `Spiele`, **0** außerhalb, **0** ohne Typ, alle 39 aktiv und
sichtbar · nur die Typen `figure` und `game` — `0137`/`0138` waren **in
diesem Augenblick** richtig noch nicht angewendet (beide liefen am selben Tag
später) · **287** Angebote, **306** Lagerpositionen, **293**
verkäuflich, **13** nicht sammelbar, **6** bewusste Opt-outs: Ziffer für
Ziffer die Werte von vor dem Lauf. Die Kategorieregel ist unverändert die
Fassung aus `0006` (`[Spiele]`). Noch offen aus Stufe 1: der
**Backup-Nachweis** (`supabase/checks/production_release_checklist.md`,
Schritt 2) wurde nicht geführt.

**Der Zustand beider Datenbanken ist bis auf Weiteres GEMELDET, nicht
GEMESSEN** — mit einer Ausnahme, die seit dem 2026-10-21 wächst: was
`verify:shop:prod`, `verify:seller:prod` und `verify:commerce:prod` lesen,
ist **gemessen**, denn diese Werkzeuge verbinden sich selbst. Für alles
andere gilt weiter: Diese Akte hält fest, was der Betreiber ausgeführt und mit
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
| `0135_catalog_item_type.sql` | `08a75cf0ade1ae10f21f76038df6a8407746bf1db76e1c8b02ebeb3d0c637a04` | gleich |
| `0136_business_backup_item_type.sql` | `fde41c50ad0656c4354aea876b0248a73cdaf129e12def5319f7747ecc136a43` | gleich |
| `0137_catalog_accessories.sql` | `220cdfb66c377643ff2870853a254f39107a4defceea88309fcde8cb6de6e15b` | gleich |
| `0138_catalog_portals.sql` | `2c948264e3d6b0cb3a605deda4027945e3d12b9ab026de3505cd74614598b791` | gleich |
| `0139_accessory_sale_release.sql` | `55f0fcf9279d6484891e48d209371bbf229464849488b8d20ad02909ad3a5a04` | gleich |
| `0140_business_backup_sale_release.sql` | `ae74e4006ce0dfef07af87021aec2331e1d13009115255ea5c7b3cbd59499fc5` | gleich |
| `0141_seller_sale_state.sql` | `54c79e5ae7ca1de3ac6742dbf64bc5cf0c8b002ae39eb2f196659ae5426d13aa` | gleich |
| `0142_purchase_calculations.sql` | `2ff5d3f7dcf2b84a66ad36cee95ec8d9f2f1622dd56d544430b5ad28509a55a3` | gleich |
| `0143_purchase_from_calculation.sql` | `b030ef94c3827c8f2367358e0e837b6b658582f9b8fe2cff4a81019b4b5e7eb5` | gleich |

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

**`0141` stand hier bis zum 2026-10-21, `0142` und `0143` bis zum
2026-10-25** — seit ihren Läufen auf Production stehen alle drei in der
Tabelle oben, und damit ist die Liste der nicht angewendeten Migrationen
leer. Übrig bleibt `0134`, die nie dazugehörte.

**`0135` und `0136` sind seit dem 2026-10-19 auf Staging angewendet, `0137`
und `0138` seit dem 2026-10-20, `0139` und `0140` ebenfalls seit dem 2026-10-20** — alle sechs stehen deshalb in der Tabelle
oben, nicht mehr hier. **`0142` ist seit dem 2026-10-22 auf Staging angewendet, `0143` seit dem
2026-10-24** — beide stehen deshalb ebenfalls oben. **Auf Production sind
seit dem 2026-10-21 `0135` bis `0141` und seit dem 2026-10-25 `0142` und
`0143` angewendet** (Abschnitt „Production"); dort fehlt nur noch `0134`,
die nicht zum Release gehört. **`0138` gehörte ausdrücklich hinter das Deployment** —
sonst wären 21 Portale in den Fortschrittsnenner gewandert. Das Deployment
ist am 2026-10-21 erfolgt (`21353e4`), und `0138` lief danach am selben Tag.

| Migration | Stand |
|---|---|
**Gefahren wurde je ein Einmal-Durchgang:** `supabase/operations/staging-0139.sql` (SHA-256 `19134017c5694c274e3b239ed2295bb3b5a7a3a0777cdd2a85fec09042ab4bd8`) und `supabase/operations/staging-0140.sql` (SHA-256 `5e578594fcc776d2962b053e712c38bba2e5221df7532f3f64d52d753727502d`). Beide betten ihre Migration **zeichengleich** ein — geprueft von `src/lib/catalog/staging-oneshot.test.ts` — und fuegen genau eine Pruefung hinzu: den Umgebungsstempel (`SKY-0821`/`SKY-0822`), den eine Migration nicht kennen kann. Dass er anschlaegt, faehrt Probelauf **P39** nach. Reihenfolge, Erwartungen und Ruecknahme: `supabase/checks/0139_0140_staging_run.md`. **Beide sind seit dem 2026-10-20 angewendet und damit nach Regel 1 eingefroren** — auch ihre Nachbedingungen. Was an ihren Pruefdateien zu berichtigen war, wurde in `supabase/checks/` berichtigt, nicht in der Migration.

| `0144_platform_export_calculations.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production noch nicht**. Ersetzt `system_platform_export()` so, dass der Plattformexport auch `purchase_calculations` führt — **am Inhalt genau drei Änderungen**: `format_version` 1 → 2, der Gruppenkopf „Lager und Orderbuch“ 12 → 13 Bereiche, und ein Bereich mit allen zwölf Spalten am Ende derselben Gruppe. Der Rumpf ist aus `0105` **kopiert**; `src/lib/backup/platform-export-0144.test.ts` dreht die drei Änderungen zurück und prüft, dass dabei Zeichen für Zeichen der alte Rumpf entsteht. **Drei Riegel:** `0142` muss stehen, der vorhandene Rumpf muss der aus `0105` sein (`md5` **2e2da90e976a1e73ca00aba7cd830fae**, sonst wird er nicht blind überschrieben), und ein zweiter Lauf prallt ab. Danach **4c4d2e7c81e4efa8e18cdffa06bba40a** und 54 Bereiche. Keine Tabelle, keine Spalte, kein Recht, keine Zeile. Probelauf **P51** führt Abdruckmessung, beide Abbrüche, den guten Lauf und die Rücknahme an echtem PostgreSQL. Rücknahme: `supabase/rollback/R0144_platform_export_back_to_0105.sql` (stellt nur den Rumpf wieder her, fasst **keine** Nutzerdaten an, ist idempotent). Grenzen einer Wiederherstellung: `supabase/checks/0144_restore_limits.md`. **Für Production liegt `supabase/operations/prod-0144.sql` bereit und ist nicht gefahren.** SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0145_favorites.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production noch nicht** — und dort erst nach der Folgemigration, die `favorites` in die Plattformsicherung aufnimmt (ADR-0136). Legt `public.favorites` an — drei Spalten (`user_id`, `sky_id`, `created_at`), Primärschlüssel **`(user_id, sky_id)`**, Fremdschlüssel auf `auth.users` (CASCADE) und `skylanders` (RESTRICT), ein Index auf `sky_id`, RLS an und **drei** Richtlinien nach dem Muster von `collection_items` nach `0042`. **Keine `update`-Richtlinie und kein `update`-Recht.** Dazu `public.favorite_demand(text[])`: `security definer`, `stable`, hinter `can_operate_active_seller()`, gibt **ausschliesslich `(sky_id, users)`** zurück. Rein additiv, keine Zeile. Probelauf **P52**. Rücknahme: `supabase/rollback/R0145_drop_favorites.sql`. **Für Production liegt `supabase/operations/prod-0145.sql` bereit und ist nicht gefahren.** SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0146_offer_state.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production noch nicht** — und dort erst nach der Folgemigration, die `offer_state` in die Plattformsicherung aufnimmt (ADR-0136, D-6) |
| `0147_offer_availability.sql` | lokal vorbereitet, **nirgends angewendet**. **Erster Staging-Versuch am 2026-10-26 abgebrochen**, und zwar von der Migration selbst: `ERROR P0001: 0147 ABBRUCH: 6 Trigger an den Quellen oder am Spiegel`. Die Pruefung ZAEHLTE Trigger und erwartete null — die Quellen tragen aber sechs voellig legitime (`shop_inventory_identity_immutable`, `shop_inventory_set_updated_at`, `skylanders_item_type_from_category`, `skylanders_log_editorial`, `skylanders_set_updated_at`, `skylanders_sky_id_immutable`, aus `0001`, `0003`, `0004`, `0135`). Dieselbe Sorte Fehler wie die Richtlinienzahl in `0142`; `0146` hatte es richtig und fragte nur nach Triggern mit `offer_state` im Namen. **Eine Transaktion, also nichts hinterlassen** — lesend bestaetigt: `buyable_since` fort, beide Funktionen fort, fuenf CHECKs, `refresh_offer_state()` in der Fassung aus `0146`. **Behoben** mit einer benannten Erwartung in Migration, Preflight, Nachkontrolle und Huelle; `availability.test.ts` haelt die vier Listen zusammen und gegen die Migrationshistorie, und P55 faehrt die drei Faelle (sechs erlaubt, siebter erkannt, einer am Spiegel erkannt). Phase 4, Schritt **S2**: macht aus dem Spiegel eine **Kante**. Legt `offer_state.buyable_since` an (eine Spalte, nullable, CHECK `not buyable or buyable_since is not null`), ersetzt `refresh_offer_state()` so, dass sie sie pflegt, und legt `offer_availability_grace()` (`reservation_ttl() + 10 min`, heute 30 Minuten, `immutable`, ohne Clientrecht) sowie `offer_availability_due()` (`definer`, **`stable`**, leerer `search_path`, ohne Clientrecht) an. **WARUM EINE SPALTE NOETIG WAR:** `changed_at` aus `0146` bewegt sich auch bei einer **Preisaenderung** und ist damit keine verlaessliche Phasengrenze — S3 braucht sie aber, um nur die Konten zu benachrichtigen, die **vor** der Kaufbarkeit vorgemerkt haben. Und eine **kurze Warenkorbreservierung** war hinterher nicht von einer echten Abwesenheit zu unterscheiden, weil nur der Beginn der laufenden Phase gespeichert ist. `buyable_since` behebt beides: sie bewegt sich nur bei einem Uebergang nach kaufbar, und nur wenn die vorige Abwesenheit mindestens `reservation_ttl()` gedauert hat. **S2 SCHREIBT KEIN EREIGNIS FORT:** `offer_availability_due()` ist `stable` und setzt `announced_*` nicht — ein Ereignis gilt erst als uebernommen, wenn S3 es in derselben Transaktion wie die Meldungen vermerkt. **Kein Trigger, keine Tabelle, kein Scheduler, keine Benachrichtigung, kein Clientrecht.** Probelauf **P55** fuehrt beide Migrationen an echtem PostgreSQL und durchlaeuft jeden geforderten Fall — darunter vier Auffrischungen waehrend einer Warenkorbreservierung, die Grenze bei genau `reservation_ttl()` (19 min: dieselbe Phase, 20 min: neue), eine Preisaenderung vor `0147`, und die Uebernahme genau einmal (zweiter Versuch: 0 Zeilen). **Vorbereitet fuer Staging:** `0147_preflight.sql`, `0147_postflight.sql`, Eintrag in `migration-plans.json`, Einfuege-Huelle `supabase/operations/staging-0147.sql` und Laufzettel `supabase/checks/0147_staging_run.md`. Beide Pruefdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0146`, und ihre Erwartungen sind in P55 als Eigner gefahren — Sollwerte, die nie gelaufen sind, sind Vermutungen. Production-Huellen folgen mit der Production-Entscheidung. Ruecknahme: `supabase/rollback/R0147_offer_availability.sql` (laesst `announced_*` unberuehrt). **Offener Punkt bleibt:** `offer_state` und `favorites` stehen weiter in `PLATFORM_EXCLUDED_TABLES` — die Folgemigration muss sie aufnehmen (ADR-0136, D-6). SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0148_availability_notifications.sql` | lokal vorbereitet, **nirgends angewendet**. Phase 4, Schritt **S3**: aus einem erkannten Verfuegbarkeitsereignis werden persoenliche Meldungen. Legt `public.availability_notifications` an (fuenf Spalten, FK auf `auth.users` mit CASCADE und auf `skylanders` mit RESTRICT, RLS an, **eine** Richtlinie — nur lesen, nur das Eigene —, `authenticated` nur `SELECT`, **nichts** fuer `anon`) und `claim_availability_notifications()` (`definer`, `volatile`, leerer `search_path`, nur fuer `authenticated`). **DER PRIMAERSCHLUESSEL IST DER DUPLIKATSCHUTZ:** `(user_id, sky_id, buyable_since)` — genau eine Meldung je Nutzer, Figur und Verfuegbarkeitsphase, als Eigenschaft der Datenbank und nicht als Zusage der Anwendungslogik. Ein echter spaeterer Zyklus hat eine neue Phasengrenze und darf deshalb eine neue Meldung erzeugen; eine kurze Warenkorbreservierung behaelt die alte und erzeugt keine. **Die Verarbeitung ist EINE Anweisung:** `offer_availability_due()` (die Erkennung aus `0147`, samt Gegenprobe gegen `offer_state_live`), ein `update` auf `offer_state`, das die Faelligkeitsbedingung als `where` mittraegt, und ein `insert`, das aus dessen `returning` liest — es gibt also keinen Zustand mit beanspruchtem Ereignis und fehlenden Meldungen. Die Migration MISST, dass der Rumpf genau eine Anweisung ist. Benachrichtigt wird, wer **vor** der Phasengrenze vorgemerkt hat (`favorites.created_at < buyable_since`). Zurueck kommt nur die Zahl der Meldungen fuer den AUFRUFER — eine Zahl je Figur waere die Nachfrage, und die ist nach `0145` dem Verkaeuferbetrieb vorbehalten. **Keine E-Mail, kein Push, kein Preisalarm, kein Scheduler, keine Einstellung, keine `read_at`-Spalte** (Anzeige und „als gelesen" sind S4). Probelauf **P56** fuehrt `0146`–`0148` an echtem PostgreSQL und durchlaeuft jeden Fall. Ruecknahme: `supabase/rollback/R0148_availability_notifications.sql` (loescht die Meldungen und sagt es vorher; `offer_state.announced_*` bleibt). **Offener Punkt vor Production:** die Tabelle steht mit Ablaufdatum in `PLATFORM_EXCLUDED_TABLES` — die Folgemigration nimmt sie mit `favorites` und `offer_state` auf (Formatversion 3, ADR-0136, D-6). SHA-256 siehe `supabase/SHA256SUMS.txt` |
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
| Production `zmiwxswrpkmizvqsgype` | … `0133`, `0135`–`0141` | `0134` |

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
Staging-Fassung ohne Riegel, sondern mit dem UMGEKEHRTEN Riegel: das
vollstaendige **Markerpaar** `SKY-0821`+`SKY-0822` muss fehlen, `0133` muss
da sein, und der Katalog muss Zeilen haben.

> **Das PAAR, nicht eine einzelne ID — und das ist gemessen.** Eine erste
> Fassung brach bei irgendeiner der beiden ab und hat die Datei damit auf
> Production abgewiesen: dort liegt `SKY-0821` als **echter Artikel**
> („Winterfest Lob-Star", `source = admin`, angelegt 2026-09-16, aktiv und
> redaktionell ausgeblendet), und die ID gehoert in den produktiven
> Allokationsbereich `SKY-0821`-`SKY-8999`. `SKY-0822` gibt es dort nicht.
> Auf Staging sind beide Charakterimport-Fixtures.
>
> **Der Schutz wird dadurch nicht schwaecher:** Staging faellt zweifach —
> an A1 (beide Marker) und an A2 (`0133` fehlt dort). Probelauf **P41**
> fuehrt fuenf Faelle vor, darunter „nur `SKY-0821`" (laesst durch, Artikel
> unberuehrt) und „ohne `0133`" (weist ab, A1 allein haette durchgelassen).
> Ein Test haelt ausserdem fest, dass alle sieben Dateien **denselben**
> Riegel tragen, Zeichen fuer Zeichen.

| Migration | Lauf | SHA-256 des Laufs |
|---|---|---|
| `0135` | `supabase/operations/prod-0135.sql` | `6adea7e58f24853a85624249506fe796c5082adb0bf7ad03541a2ba1b1f8e793` |
| `0136` | `supabase/operations/prod-0136.sql` | `bef6821b4f44c756cf68fe0f15942e3ef4c75c8b02f928f52d49625903042925` |
| `0137` | `supabase/operations/prod-0137.sql` | `e717b1ba0b7210f15f6bf927415b4a96d9cf46b061aa15376eebc554f790278e` |
| `0138` | `supabase/operations/prod-0138.sql` | `17f897fbe05835be7dfce68df815fc9d297599bc23ea122bd3a014b7da060663` |
| `0139` | `supabase/operations/prod-0139.sql` | `6f3aad33e96457ac35a29e8764308cce1df7aa07fac5c1bf8bf8f5a800cf0c97` |
| `0140` | `supabase/operations/prod-0140.sql` | `cc4a88ad3bd9804605c00c67d60926b8cb19a43e21820db9f6ace12a111f6d88` |
| `0141` | `supabase/operations/prod-0141.sql` | `60a046ea13a61fe8dc3904e28d1fdfb4ee214b6d8b99624ca6d4081e1768c0e4` |

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
