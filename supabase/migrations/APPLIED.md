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
| `0147_offer_availability.sql` | `d708276f267c3e422fdab00e348dcbee666413686e1937149a67d99fee9c44d7` | gleich | **2026-10-26**, Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0147.sql`, nach `npm run db:migrate:staging -- 0147`. **Der erste Versuch brach ab** — von der Migration selbst, mit `ERROR P0001: 0147 ABBRUCH: 6 Trigger an den Quellen oder am Spiegel`: die Prüfung ZÄHLTE Trigger und erwartete null, die Quellen tragen aber sechs völlig legitime. Eine Transaktion, also wurde nichts hinterlassen — lesend bestätigt (`buyable_since` fort, beide Funktionen fort, fünf CHECKs, `refresh_offer_state()` in der Fassung aus `0146`). Behoben mit einer **benannten** Erwartung statt einer Zählung. Danach: Preflight `9999 = 0` bei 7 offenen Zeilen, Nachkontrolle `9999 = 0` bei 6 offenen (`migrate-0147-2026-10-26T08-30-01-575Z.md`). **Der berechtigte Lauf ist gefahren** (2026-10-26, `0147-postflight-berechtigt.sql`): **`9998 = 0`** und `9999 = 4`. Keine der Abweichungen stammt aus dieser Migration — Einordnung unter „Die berechtigten Nachkontrollen zu `0147`–`0149`“ weiter unten. **Auf Production NICHT angewendet** |
| `0148_availability_notifications.sql` | `a6f96a9d52b324a69f15117d6d7616341b206f875f3206e3845b4850e672f50e` | gleich | **2026-10-26**, Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0148.sql`. Preflight `9999 = 0` bei 4 offenen Zeilen, Nachkontrolle `9999 = 0` bei 1 offenen (`migrate-0148-2026-10-26T10-40-26-253Z.md`). **Der berechtigte Lauf ist gefahren** (2026-10-26, `0148-postflight-berechtigt.sql`): **`9998 = 0`** und `9999 = 6`. Keine der Abweichungen stammt aus dieser Migration — Einordnung unter „Die berechtigten Nachkontrollen zu `0147`–`0149`“ weiter unten. **Auf Production NICHT angewendet** |
| `0149_notification_read_state.sql` | `131bbd98eeda0e3ff7391a46e6af020b48a3eaaf093d97bbf2a02b2160a62526` | gleich | **2026-10-26**, Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0149.sql`. **Der kürzeste Durchgang dieser Reihe: 44 Sekunden vom Preflight bis zur bestandenen Nachkontrolle.** Preflight `9999 = 0` bei 3 offenen Zeilen (`11:43:50`), Nachkontrolle `9999 = 0` bei 2 offenen (`11:44:34`) — offen sind genau die zwei Zeilen, die `availability_notifications` lesen müssten (104, 105). Alle Struktur- und Rechtezeilen (101–103, 111–126) sind **geprüft und bestanden**, weil sie `pg_catalog` lesen und das nicht rechtegefiltert ist (ADR-0141). **Der berechtigte Lauf ist gefahren** (2026-10-26, `0149-postflight-berechtigt.sql`): **`9998 = 0`** und `9999 = 4`. **Zeile 104 (`KEINE Meldung ist als gelesen geführt`) ist bestanden.** Keine der vier Abweichungen stammt aus dieser Migration — Einordnung unter „Die berechtigten Nachkontrollen zu `0147`–`0149`“ weiter unten. **Dabei trat der `28P01` erstmals mit Beleg auf** — siehe die Zeile darunter. **Auf Production NICHT angewendet** |
| `0152_catalog_status.sql` | `e94e943f6e2adbd7875758b66ec16558e6192c3e43f166efb1f1c3a547041566` | gleich | **2026-10-27**, Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0152.sql` (SHA-256 `b5e14e420b3874cb82c774d1fab67945b86001355826c6b9839cac30310ff681`), der die Migration **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-02B/CAT-04B, ADR-0151. **Der erste Preflight brach ab**, und zwar an einem Mangel der PRÜFDATEI und nicht der Migration: Zeile 105 nannte eine von Hand getippte Signatur `admin_create_figure(…, numeric, boolean, text)`, während die echte `(…, boolean, text, text, text)` lautet. `to_regprocedure` antwortet auf eine falsch geschriebene Signatur NULL — genauso wie auf eine fehlende Funktion; die beiden Fälle sehen gleich aus. Zeile 106 (»genau EINE Fassung«) war dabei grün, die Funktion stand also die ganze Zeit. Behoben, indem die Zeile jetzt die **Parameterzahl** fragt (`pronargs = 8`) statt einer Typliste, und eine neue Zeile 108 die **tatsächliche** Signatur ins Protokoll schreibt; derselbe Wächter in der Hülle (`ABBRUCH A4`) ebenso. **Preflight bestanden** (`0152_preflight.sql`, SHA-256 `7e9107b88a6f54ee0bfb76b75be4e4d70ed4e3cbd18efdda998415e0457e3ae3`): 34 Zeilen, `9999 = 0`, eine offene Zeile (133, Journal — der Prüfzugang darf `catalog_admin_changes` nicht lesen, ADR-0141). Gemessener Ausgangszustand: **626 Katalogzeilen, 596 sichtbar, 30 unsichtbar, 0 mit NULL**. Baselines eingefroren in `supabase/baselines/baseline-0152.json` (ADR-0137) und danach **nie neu erhoben**. **Nachkontrolle bestanden** (`0152_postflight.sql`, SHA-256 `2bb9db5ca93e805bd1560c200f006e581eaeefd1e176d7eb22e2953b9de82b57`): **52 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, eine offene Zeile (136, dasselbe Journal). **Das Ergebnis, rein lesend gegengeprüft:** 626 Zeilen unverändert, **596 `public`, 30 `hidden`, 0 `draft`** — kein bestehender Eintrag ist zum Entwurf geworden; null Zeilen mit `public` und unsichtbar, null mit sichtbar und nicht `public`, null mit unbekanntem Wert. Shop, Lager und Sammlung unverändert (Zeilen 801–833 gegen die eingefrorenen Baselines: Angebote 257, shopfähig 534, sammelbar 534, Lagerzeilen 287, Katalogzeilen 626). Beide Lesepolitiken lesen weiter `is_active and catalog_visible` und **nicht** den Status; RLS an, `skylanders_public_catalog_idx` steht, `admin_set_catalog_visible` unberührt. `admin_set_catalog_status(text,text)` steht als `security definer` mit leerem `search_path`, ohne Recht für `anon`/`public` und mit genau einem für `authenticated`. **Der berechtigte Lauf ist gefahren** (2026-10-27, `supabase/log/staging/0152-postflight-berechtigt.sql` als `postgres`): **`9998 = 0`** und `9999 = 2`. Die zwei Abweichungen sind die beiden Sammlungszeilen des Basis-Vertrags und erklärt — siehe unmittelbar darunter. **ERKLÄRTE ABWEICHUNG IM BASIS-VERTRAG (2026-10-27):** die beiden Sammlungszeilen weichen ab — **14 → 21 Zeilen**, Konten unverändert 1. **Die Ursache liegt nicht bei dieser Migration.** Nimmt man aus den 21 Zeilen genau die, die VOR der Baseline-Erhebung (20:23:19.426) entstanden sind, bleiben **14** übrig, und ihr Abdruck ist **zeichengleich** der eingefrorene Wert `5935b9378c6dfaf7dfa2af2e72af96ce`. Die sieben übrigen entstanden zwischen **20:43:35 und 20:43:44** — sieben Zeilen in neun Sekunden, Menge 1, ohne Notiz, auf BESTEHENDE Katalogfiguren; der Betreiber hat in diesem Zeitraum das neue UX bedient. `0152` fasst `collection_items` nirgends an. **Die Baseline wurde NICHT angepasst und keine Prüfung abgeschwächt** — die zwei Zeilen bleiben abweichend und zählen weiter in `9999`, dieselbe Einordnung wie bei den berechtigten Nachkontrollen zu `0147`–`0149`. Einzelheiten: `supabase/checks/cat03_import_run.md`. Protokolle: `migrate-0152-2026-10-27T20-23-19-477Z.md` (Preflight) und `…T20-35-32-830Z.md` (Nachkontrolle). Laufzettel `supabase/checks/0152_staging_run.md`, Rücknahme `supabase/rollback/R0152_drop_catalog_status.sql` (nennt die betroffenen SKY-IDs **vor** dem ersten Eingriff und verweigert, solange `0153` liegt). **EINE KORREKTUR AN DIESER DATEI SELBST war vorher nötig (CAT-02C Teil D):** sie klammerte sich mit `begin;`/`commit;` selbst, was nicht die Hausform ist — die Klammer gehört in die Einfüge-Hülle, damit deren Wächter in derselben Transaktion liegen; eine zweite Klammer hätte mit ihrem inneren `commit` die äußere vorzeitig abgeschlossen. Entfernt, bevor irgendetwas lief. Probelauf **P60** fährt 17 Schreibwege an echtem PostgreSQL. **Auf Production NICHT angewendet** |
| `0153_platform_export_catalog_status.sql` | `039d0da360ec5de8f1db28bdd4690f7b3b4f9a2ac130dac39d66cc87c81da3c2` | gleich | **2026-10-28**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0153.sql` (zeichengleiche Einbettung). CAT-02C Teil B, Laufzettel `supabase/checks/0153_staging_run.md`. **Preflight bestanden:** 40 Zeilen, `9999 = 0`, **keine offene Zeile** — jede Prüfung wurde durchgeführt. Baselines eingefroren in `supabase/baselines/baseline-0153.json` (erhoben 2026-10-28T13:21:33Z: Angebote 257, shopfähig 535, sammelbar 535, Lagerzeilen 287, Katalogzeilen 730, Sammlung 21). Gemessener Ausgangszustand: **103 Entwürfe, 30 versteckt, 597 öffentlich**. **DIE ERSTE NACHKONTROLLE WICH AB — `9999 = 1`, und zwar an einem Mangel der PRÜFDATEI, nicht der Migration.** Zeile 104 zählte, wie oft die Zeichenfolge `catalog_status` im Funktionsrumpf steht, und erwartete **1**; tatsächlich sind es **2**, weil eine Feldzeile dieses Exports ihren Namen zweimal nennt — als JSON-Schlüssel `'catalog_status'` und als Spaltenreferenz `t.catalog_status`. **Das ist die kanonische Form JEDES Feldes dort:** `category_id`, `price_updated_at`, `image_file`, `image_override_path`, `catalog_visible`, `display_name_override`, `card_type` und `character_id` kommen aus demselben Grund genau zweimal vor; **eins wäre unmöglich** — ein Feld ohne Spaltenreferenz ist kein Feld. Die Erwartung war nicht knapp daneben, sondern begrifflich verkehrt: die Zeile wollte eine ZEILE prüfen und zählte ein VORKOMMEN. Dieselbe Klasse wie `%kein Bildpfad%` in `0156` und die von Hand getippte Signatur im `0152`-Preflight. **Behoben, indem Zeile 104 das vollständige Muster `'catalog_status', t.catalog_status,` zählt** — das ist **strenger** als die alte Fassung, nicht schwächer: es nagelt Schlüssel und Spalte in genau dieser Paarung fest, und ein `'catalog_status', t.card_type,` fiele damit auf. Geändert wurde ausschliesslich die Prüfdatei; die Migration ist unberührt (Abdruck `92c48444f99b9e294f9703d0c0ddeaa8`, Länge 31072, Umkehrprobe am lebenden Rumpf gegen `4c4d2e7c…` aufgegangen). **Die Fehlerklasse ist geschlossen:** `src/lib/admin/check-body-patterns.test.ts` rechnet jetzt auch jede ZÄHLENDE Behauptung über einen Funktionsrumpf gegen den echten Rumpf nach — am echten Fehler erprobt, mit dem alten Muster schlägt sie fehl. Zuvor prüfte sie nur `prosrc like`-Muster. **ZWEITE NACHKONTROLLE: jede Zeile über 0153 ist grün** — Abdruck (102), `catalog_status` im Rumpf (103), die Feldzeile genau einmal (104), die **Umkehrprobe am lebenden Rumpf** (105, `4c4d2e7c…`), die Stellung hinter `catalog_visible` (106), die Länge 31072 (107), der Wächter im Rumpf (108), Attribute und Rechte unverändert (111–118), `format_version` bleibt 2 und die Bereichszahl 54 (121–125), `seller_business_backup()` unberührt und ohne `catalog_status` (126), kein unbekannter Status und kein Widerspruch zwischen Status und Sichtbarkeit (134–135). **EINE ERKLÄRTE ABWEICHUNG BLEIBT, und sie stammt nicht von dieser Migration** (`9999 = 1`): Zeile 816, Katalogzeilen **730 → 729**. Zwischen der Baseline (13:21) und der Nachkontrolle (13:58) hat der Betreiber eine Entwurfszeile verarbeitet. **Die Rechnung schliesst vollständig auf:** Entwürfe **103 → 102**, versteckt 30 und öffentlich 597 **unverändert**, mit Familie 107 unverändert — es ist genau eine Entwurfszeile verschwunden und keine hat ihren Status gewechselt. Das ist die Signatur einer Zusammenführung oder eines Verwerfens, nicht einer Veröffentlichung (dann wäre `public` auf 598 gegangen). `0153` ersetzt einen Funktionsrumpf und fasst keine Zeile an. **Die Baseline wurde NICHT angepasst und keine Prüfung abgeschwächt** — dieselbe Einordnung wie bei der Sammlungsabweichung zu `0152` und den drei Katalogabweichungen zu `0157`. **Probelauf P66 RUFT die Sicherung auf** — das tat vorher keiner, P51 prüft `0144` nur am Rumpf — und fährt einen echten **Umlauf**: drei Zeilen mit `public`, `hidden` und `draft`, exportieren, löschen, aus dem Archiv wieder einspielen. **Ohne `0153`** fehlt der Status im Archiv und `catalog_visible` ist bei Entwurf UND versteckter Zeile `false`; **mit `0153`** kommen alle drei Werte zurück, und nach dem Einspielen steht jeder Status wieder da. Der auf Staging stehende Rumpf ist **byte-identisch** mit dem, den P66 durchgefahren hat. Protokolle: `migrate-0153-2026-10-28T13-21-33-*.md` (Preflight), `…T13-5*.md` (die abgewichene erste Nachkontrolle) und `…T13-58-28-207Z.md` (die zweite). **Auf Production NICHT anwendbar**, solange dort der Rumpf aus `0105` steht (`2e2da90e…`) — dort bricht sie mit eigener Meldung ab. **Offen bleiben** die vier Spalten aus `supabase/checks/platform_export_gap.md` und die Bereiche `favorites` und `offer_state` |
| `0154_merge_draft_into_figure.sql` | `c75bb19081c315091f2e4f86405263ff07a7e2fa2976826154920115ca72d09b` | gleich | **auf Staging angewendet am 2026-10-28**, auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0154.sql`, der die Migration **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. Freigabe CAT-05E. **Preflight bestanden** (`0154_preflight.sql`, SHA-256 `d971051db12604b4…`): 27 Zeilen, `9999 = 0`, eine offene Zeile (134, `catalog_editorial` — der Prüfzugang darf das Objekt nicht lesen, ADR-0141). Baselines eingefroren in `supabase/baselines/baseline-0154.json`, erhoben `2026-10-28T07:16:32Z`: **Angebote 257, shopfähig 534, sammelbar 534, Lagerzeilen 287, Katalogzeilen 731**, Sammlung **21** Zeilen auf 1 Konto. **Eine erste Erhebung vom 2026-10-27T22:51Z wurde von Hand gelöscht**, damit der Runner den Stand unmittelbar vor dem Schreiben misst — ihr Inhalt ist nicht rekonstruierbar; der Vorgang und die Gegenmaßnahme (`--refreeze` archiviert statt zu löschen) stehen in `supabase/baselines/archiv/README.md`. **Nachkontrolle bestanden** (`0154_postflight.sql`, SHA-256 `68b1d9e5460a6f6c…`): **43 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, eine offene Zeile (125, dasselbe `catalog_editorial`). Der berechtigte Lauf liegt als `supabase/log/staging/0154-postflight-berechtigt.sql` bereit; sein Ergebnis ist **noch nicht erfasst**. Protokolle: `migrate-0154-2026-10-28T06-55-19-731Z.md` und `…T07-16-32-085Z.md` (Preflight), `…T07-24-58-246Z.md` (Nachkontrolle). **Durch `0156` ist der Rumpf der Dreiparameterfassung ersetzt** — die Datei selbst bleibt unverändert, die Signatur und ihre Rechte ebenso; `0156` macht aus ihr eine Weiterleitung, damit es die Übernahmelogik genau einmal gibt. CAT-05: der Adminbereich bekommt eine **Zusammenführung** — ein importierter Entwurf geht in einer bestehenden Figur auf. **DIE BESTEHENDE SKY-ID BLEIBT**, und das ist der ganze Punkt: an ihr hängen Sammlungen, Favoriten, Lager, Angebote und Bestellungen. Zwei Definer-Funktionen, beide nur für `is_platform_admin()`, beide ohne Recht für `anon`/`public`: `admin_merge_references(text)` zählt, wer auf eine SKY-ID zeigt — **hergeleitet aus `pg_catalog`**, nicht aus einer getippten Liste (heute 14 Fremdschlüssel; eine Liste wäre beim fünfzehnten still falsch, ADR-0134), und `catalog_editorial` zählt ausdrücklich NICHT mit, weil diese Zeile dem Entwurf selbst gehört. `admin_merge_draft(text,text,text[])` übernimmt die **benannten** Felder und nur dort, wo der Entwurf wirklich etwas hat — ein leerer Wert überschreibt keinen vorhandenen. **NICHT ÜBERNOMMEN:** `sky_id`, `slug` (reine Navigation, ADR-0011), `catalog_status`/`catalog_visible` (eine Zusammenführung veröffentlicht nichts), `market_price`, `image_file` und `source`. **Fünf kontrollierte Abweisungen:** Entwurf = Ziel, Ziel ist selbst ein Entwurf, Quelle ist kein Entwurf, unbekanntes Feld, und `series_code` ohne `category_id` (ein zusammengesetzter Fremdschlüssel). **Referenzen blockieren das Löschen** — liegt der Entwurf in einer Sammlung, bricht der Vorgang ab und nennt Tabelle und Zeilenzahl. Eine Transaktion: ein Fehler lässt keinen halb zusammengeführten Zustand zurück. Probelauf **P62** fährt sie an echtem PostgreSQL und prüft alles davon; **dabei fiel ein sechster Werkzeugbefund auf** — das Stub-Schema trägt keine Fremdschlüssel, die Herleitung fand nichts, und der Wächter wäre still wirkungslos gewesen. Der Durchgang zieht die zwei nötigen Schlüssel deshalb selbst nach. **Vorbereitet für Staging (CAT-05B):** `0154_preflight.sql` (prüft unter anderem, dass **alle** Fremdschlüssel auf `skylanders` einspaltig sind — ein mehrspaltiger wäre ein Fall, den `admin_merge_references()` nicht zählen kann), `0154_postflight.sql` (die beiden Funktionen mit Rechten und Attributen, **und** der Nachweis, dass sich am Bestand nichts bewegt hat), Eintrag in `migration-plans.json` und Einfüge-Hülle `supabase/operations/staging-0154.sql` mit **fünf** Wächtern. Beide Prüfdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0152`. **Kein Laufzettel** — der entsteht mit der Freigabe. **VEREINFACHT IN CAT-05D:** keine Feldliste mehr — `admin_merge_draft(text, text)` übernimmt **jedes** fachliche Feld, das der Entwurf wirklich trägt, und lässt stehen, was er nicht hat. Zwei Ausnahmen, beide eine Regel über Platzhalter: ein **generischer** `card_type`/`item_type` (`standard`/`figure`) ersetzt nie einen spezifischen — bei 51 der 105 Entwürfe steht er nur, weil es einen Vorgabewert gibt —, und `admin_note` wird **angehängt** statt ersetzt. `series_code` und `category_id` wandern immer gemeinsam. **Unverändert bleiben** `sky_id`, `slug`, `catalog_status`, `catalog_visible`, `market_price`, `image_file`, `source` und alles, was an der SKY-ID hängt. **DAS BILD ZIEHT UM (CAT-05E):** ein dritter Parameter `p_image_path` nimmt den Pfad entgegen, den der Aufrufer **vorher** unter der SKY-ID der ZIELFIGUR angelegt hat; die Funktion prüft, dass er wirklich ihr gehört, und setzt ihn — sie kopiert nichts und löscht nichts. **Die Reihenfolge ist die Sicherheit:** PostgreSQL und der Speicher teilen keine Transaktion, und Kopieren-dann-Schreiben lässt nur zwei Ausgänge zu — alles fertig, oder ein verwaistes Objekt ohne Datenbankänderung. Umgekehrt zeigte die Karte womöglich auf ein Objekt, das es nicht gibt. Die Kopie ist inhaltsadressiert, ein zweiter Versuch also folgenlos; weder das Objekt des Entwurfs noch das bisherige der Zielfigur wird gelöscht. SHA-256 der vorliegenden Fassung: `c75bb19081c315091f2e4f86405263ff07a7e2fa2976826154920115ca72d09b` |
| `0155_discard_draft.sql` | `43b1b30c7b36ed3ee446c5718f5dad0ff012f79162dda69cd2bd9a9551584e15` | gleich | **auf Staging angewendet am 2026-10-28**, auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0155.sql` (zeichengleiche Einbettung). Freigabe CAT-05E, **nach** vollständigem `0154`. **Die Reihenfolge ist erzwungen und das ist belegt:** der Preflight ist am 2026-10-28 vor der Anwendung von `0154` **zu Recht in Zeile 103 gescheitert** (`9999 = 1`). Danach **Preflight bestanden** und **Nachkontrolle bestanden** (`0155_postflight.sql`, SHA-256 `d77992f8fd4fa813…`): **42 Zeilen, `9999 = 0`, `9998 = 0`** — keine offene Zeile. Protokolle: `migrate-0155-2026-10-28T07-26-07-726Z.md` (Preflight) und `…T07-27-04-245Z.md` (Nachkontrolle). **Von `0156` nicht angefasst.** CAT-05D: `admin_discard_draft(text)` verwirft **einen** importierten Entwurf — die dritte Handlung neben Zusammenführen und Bearbeiten. **Die einzige Stelle im Produkt, die einen Katalogeintrag wirklich löscht**; der Import deaktiviert sonst über `is_active` (`0001`). **VIER Riegel:** `catalog_status = 'draft'` (eine öffentliche oder versteckte Figur nie), `source = 'admin'` (was dem Katalogimport gehört, wird nicht gelöscht), **sie stand nie öffentlich** (das Journal aus `0152` weiß es — eine Zeile mit Vergangenheit wird versteckt, nicht vernichtet) und **keine Verweise** — gezählt von `admin_merge_references()` aus `0154`, damit es die Referenzprüfung genau **einmal** gibt. **Die Reichweite ist gemessen (2026-10-28):** 128 Zeilen tragen `source = admin`, davon sind **105 Entwürfe — genau die importierten** —, die übrigen 23 sind öffentlich und damit unantastbar. Die Funktion ist trotzdem nicht auf die 105 festgeschrieben: die Regel lautet „ein Entwurf, auf den nichts zeigt und der nie live war“, und die ist nachprüfbar, während eine Festlegung auf die 105 an einer bearbeitbaren Notiz hinge. **Die Journalzeile wird VOR dem Löschen geschrieben**, sie überlebt die Figur. **Der Speicher bleibt unberührt:** ein hochgeladenes Bild bleibt liegen und wird im Rückgabewert als `orphaned_image` **benannt** — SQL erreicht den Bucket nicht, und ein Löschen über zwei Systeme wäre keine Transaktion mehr. Die SKY-ID wird nie wiederverwendet (ADR-0070). **Setzt `0154` voraus.** Probelauf **P62** fährt alle vier Fälle an echtem PostgreSQL: öffentliche Figur abgewiesen, Importzeile abgewiesen, Referenz blockiert, und der referenzfreie Entwurf verschwindet samt Notiz, mit Journalzeile und benanntem Bild. **Vorbereitet für Staging (CAT-05E):** `0155_preflight.sql` (Zeile 103 verlangt `0154` — der Lauf am 2026-10-28 ist daran **zu Recht gescheitert**, `9999 = 1`, und das ist der Beweis, dass die Reihenfolge erzwungen wird), `0155_postflight.sql` (die vier Riegel einzeln am Funktionsrumpf, **und** der Nachweis, dass nichts gelöscht wurde), Eintrag in `migration-plans.json` und Einfüge-Hülle `supabase/operations/staging-0155.sql` mit fünf Wächtern. Beide Prüfdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0154`. SHA-256 der vorliegenden Fassung: `43b1b30c7b36ed3ee446c5718f5dad0ff012f79162dda69cd2bd9a9551584e15` |
| `0156_merge_selected_fields.sql` | `d9bb3b27e633d90cc6abd1ea14bcc1d41ed6048f52ac0895e9aa3706d1204cc7` | gleich | **auf Staging angewendet am 2026-10-28**, auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Betreiber: manuell im SQL-Editor über den Einmal-Durchgang `supabase/operations/staging-0156.sql` (zeichengleiche Einbettung). **Preflight bestanden:** 26 Zeilen, `9999 = 0`, keine offene Zeile — damit ist auch belegt, dass `0154` und `0155` dort stehen. Baselines eingefroren in `supabase/baselines/baseline-0156.json`, erhoben `2026-10-28T08:24:42Z` (Angebote 257, Katalogzeilen 731, Sammlung 21). **Die erste Nachkontrolle wich ab — `9999 = 1`, und zwar an einem Mangel der PRÜFDATEI und nicht der Migration.** Zeile 115 suchte `%kein Bildpfad%`; diese Meldung ist im Rumpf über **zwei** SQL-Literale verteilt (`… es kommt kein '` + `'Bildpfad mit`), und `prosrc` trägt den Rumpf so, wie er geschrieben ist — mit Umbruch und Anführungszeichen dazwischen. Das Muster konnte nie treffen, **obwohl der Riegel steht und wirkt**; Probelauf P63 löst ihn in vier Gestalten aus und misst danach, dass sich keine Zeile bewegt hat. Behoben, indem die Zeile ein Stück sucht, das GANZ in einem Literal liegt (`%das Bild ist ausgewaehlt%`). **Bei derselben Durchsicht fiel ein zweiter Mangel auf:** Zeile 113 suchte `%series_code%category_id%` — grün, aber wertlos, weil beide Namen ein Dutzend Mal in dem Rumpf stehen; sie prüft jetzt die Bedingung selbst. Beides sind Änderungen an der Prüfdatei, **nicht** an der Migration und **nicht** an der Datenbank. `src/lib/admin/check-body-patterns.test.ts` rechnet diese Regel seither für jede Zeile nach, die `prosrc` liest — und der Riegel ist am echten Fehler erprobt. **Nachkontrolle bestanden** (`0156_postflight.sql`): **52 Zeilen, `9999 = 0`, `9998 = 0`**, keine offene Zeile, Baselines unverändert übernommen. Protokolle: `migrate-0156-2026-10-28T08-24-42-*.md` (Preflight), `…T08-26-49-804Z.md` (die abgewichene Nachkontrolle) und `…T08-35-46-810Z.md` (die bestandene). CAT-05F: die Zusammenführung übernimmt **nur die ausgewählten Felder**. Der Dialog zeigt jede anstehende Änderung als eigene Tabellenzeile mit Kästchen; diese Migration ist die Serverseite davon, denn ein Kästchen, das nur die Anzeige ändert, wäre eine Behauptung. **EINE REGEL, EINE STELLE:** `admin_merge_plan(text,text,text)` rechnet den Änderungsplan **rein lesend** (`stable`) und ist die einzige Stelle, an der die Übernahmeregeln stehen — die schreibende Funktion ruft sie auf, Vorschau und Anwendung können also nicht auseinanderlaufen. `admin_merge_draft(text,text,text,jsonb)` nimmt die Auswahl als Objekt `{feld: {old, new}}`. **DIE WERTE DES AUFRUFERS SIND EINE BEHAUPTUNG, KEINE ANWEISUNG:** sie nennen, was der Bediener GESEHEN hat; der Server vergleicht sie mit seiner eigenen Rechnung und bricht bei jeder Abweichung ab. Geschrieben wird ausschliesslich aus der Zeile des Entwurfs, bei `admin_note` und `image_override_path` aus dem Plan (dort entsteht der Wert erst) — **nie** aus dem Aufruf. **Serverseitige Allowlist von neun Feldern**, als Konstante im Rumpf; `sky_id`, `slug`, `catalog_status`, `catalog_visible`, `market_price`, `price_updated_at`, `image_file`, `source` und `is_active` sind nicht darunter, und es gibt **kein dynamisches SQL** — jede Spalte ist getippt. `series_code` und `category_id` müssen **gemeinsam** ausgewählt sein (ein zusammengesetzter Fremdschlüssel; eine halbe Auswahl ist ein Abbruch). Ein Bildpfad wird nur angenommen, wenn das Bild ausgewählt ist — und umgekehrt; so kopiert die Aktion auch nichts in den Speicher, wenn das Kästchen leer ist. Eine **leere Auswahl** löscht keinen Entwurf. **ABWÄRTSKOMPATIBEL:** `admin_merge_draft(text,text,text)` aus `0154` bleibt mit Signatur, Rechten und Verhalten; ihr Rumpf wird eine Weiterleitung mit `p_selection = NULL` (= alles), damit es die Übernahmelogik genau einmal gibt. **Setzt `0154` voraus** — die Vorbedingung ist geprüft, nicht behauptet: Probelauf **P63** nimmt die Funktionen in einer frischen Welt weg und sieht den Abbruch. P63 fährt an echtem PostgreSQL alle Fälle: alle Felder, nur der Name, nur das Bild, Bild abgewählt (beide Richtungen), leere Auswahl, vier manipulierte Auswahlen (`market_price`, `catalog_status`, `sky_id`, kein Objekt), ein halber Fremdschlüssel, drei Gestalten einer veralteten Vorschau — und danach ist jedes Mal nachgemessen, dass sich **nichts** bewegt hat. Die Referenz auf das **Ziel** überlebt (Sammlungsmenge 3), die auf den **Entwurf** blockiert. **Vorbereitet für Staging:** `0156_preflight.sql` (Zeile 121 verlangt **genau eine** Fassung von `admin_merge_draft` — bei zwei ersetzte `create or replace` nur eine davon und die andere liefe mit der alten Logik weiter), `0156_postflight.sql` (die drei Funktionen mit Rechten und Attributen, die neun Riegel einzeln am Rumpf, die Weiterleitung, **genau zwei** Fassungen — und der Nachweis, dass keine Zeile geschrieben wurde), Eintrag in `migration-plans.json` und Einfüge-Hülle `supabase/operations/staging-0156.sql` mit **sechs** Wächtern. Beide Prüfdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0155`. **NICHT ANGEFASST:** keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie, kein Index, nicht `admin_merge_references()` und nicht `admin_discard_draft()`. **Kein Laufzettel** — der entsteht mit der Freigabe |
| `0157_audit_fields_and_automatic_notes.sql` | `d74a7c0ed105c930e18135c87010dd5eed3f2b8dccc671246a54954ba71f2bd6` | gleich | **2026-10-28**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0157.sql` (zeichengleiche Einbettung). CAT-05I. **Preflight bestanden:** 36 Zeilen, `9999 = 0`, eine offene Zeile (125, Journal — Rechtegrenze, ADR-0141). Baselines eingefroren in `supabase/baselines/baseline-0157.json` (erhoben 2026-10-28T10:17Z: Angebote 257, shopfähig 534, sammelbar 534, Lagerzeilen 287, Katalogzeilen 731, Sammlung 21). **Nachkontrolle: `9999 = 3`, und alle drei Abweichungen sind ERKLÄRT und stammen nicht von dieser Migration.** Grün sind: die Constraint mit **zehn** Werten und allen sieben alten (101–108), `merge_note` vorhanden und `immutable` ohne offenes Recht (111–113), `admin_note` aus Allowlist **und** Plan entfernt (121–122), die acht auswählbaren Felder (123), die Notiz über `merge_note` (124), drei `security definer` (125), die Dreiparameterfassung steht noch (126), **alle sechs Riegel aus `0156`** (131–136), kein sichtbarer Entwurf und kein Widerspruch zwischen Status und Sichtbarkeit (142–143), und **Shop wie Sammlung unberührt**: Angebote 257, Angebots-Abdruck, Lagerzeilen 287, Lager-Abdruck und beide Sammlungszeilen zeichengleich. **Abweichend sind genau drei Zahlen** — 816 Katalogzeilen `731 → 730`, 813 shopfähig `534 → 535`, 814 sammelbar `534 → 535` —, und sie gehören zu **zwei Handlungen des Betreibers zwischen Preflight und Nachkontrolle**: SKY-0824 „Pirate Seas" wurde in SKY-0103 „Pirate Ship" zusammengeführt (die Entwurfszeile verschwindet: −1 Katalogzeile), und SKY-0825 „Chrome Spyro" wurde als eigenständige Figur veröffentlicht (+1 sammelbar, +1 shopfähig). **Die Rechnung schliesst vollständig auf:** Status vorher 596 `public` / 30 `hidden` / 105 `draft` = 731, Status nachher **597 / 30 / 103 = 730** — 596 + 1 = 597, 105 − 2 = 103, 626 + 105 − 1 = 730. Gegengeprüft an SKY-0103 (heisst jetzt „Pirate Seas", `public`, Bild unverändert) und SKY-0824 (fort). **Die Baseline wurde NICHT angepasst und keine Prüfung abgeschwächt** — dieselbe Einordnung wie bei der Sammlungsabweichung zu `0152`. **Vier offene Zeilen** (114–116, 144): sie rufen `merge_note` beziehungsweise lesen `catalog_editorial`, und der lesende Prüfzugang hat darauf kein Recht; sie zählen in `9998`, nicht in `9999` (ADR-0139/0141). Probelauf **P64** deckt sie ab — er fährt `merge_note` über **alle 105 echten Importnotizen**. Protokolle: `migrate-0157-2026-10-28T10-17-*.md` (Preflight) und `…T11-17-27-055Z.md` (Nachkontrolle). **Auf Production NICHT angewendet** |
| `0158_figure_families.sql` | `8f87c836e74a5c754efb476e1c4ed720fe0e0419e97d6dfd093486b2ad73a2b2` | gleich | **2026-10-28**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0158.sql` (zeichengleiche Einbettung). CAT-06 Phase 2, ADR-0155. **Preflight bestanden:** 32 Zeilen, `9999 = 0`, drei offene Zeilen (124, 126, 128 — `characters` und das Journal, Rechtegrenze des Prüfzugangs, ADR-0141). Baselines eingefroren in `supabase/baselines/baseline-0158.json` (Angebote 257, shopfähig 535, sammelbar 535, Lagerzeilen 287, Katalogzeilen 730, Sammlung 21). **Nachkontrolle bestanden:** `0158_postflight.sql`, **57 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, zwei offene Zeilen (135, 138 — dieselbe Rechtegrenze). **Der berechtigte Lauf ist gefahren** (als `postgres`, `supabase/log/staging/0158-postflight-berechtigt.sql`): **`9998 = 0` UND `9999 = 0`** — damit ist auch belegt, dass **keine** Journalzeile `character_id` entstanden ist und keine Figur auf eine Familie zeigt, die es nicht gibt. **Was die Nachkontrolle im Einzelnen festhält:** die Constraint kennt `character_id` und **alle zehn** bisherigen Werte stehen noch (101–103, jeder einzeln geprüft), der zweite CHECK und der Fremdschlüssel auf `characters` sind unberührt (105–106); alle drei Funktionen stehen, `security definer`, je eine `search_path`-Festlegung, kein Recht für `anon`/`public`, je eines für `authenticated`, Adminprüfung in allen drei Rümpfen (111–118); **keine der drei schreibt `name` oder `slug`** (121, am Funktionsrumpf nachgerechnet), Weg B lässt nur Entwürfe durch und verlangt eine Familie (122–123), benutzt den **vorhandenen** Veröffentlichungsweg und die vorhandene Zuordnung statt zweiter Fassungen (124–125), die Zuordnung prüft die Existenz der Familie (126), `NULL` ist der Rückweg (127), das Anlegen weist einen vorhandenen Namen ab (128). **Und nichts ist geschrieben:** 107 Zeilen mit Familie, 623 ohne, 20 Familien, 103 Entwürfe — alle vier zeichengleich wie im Preflight; kein Entwurf sichtbar, kein Widerspruch zwischen Status und Sichtbarkeit (131–137). **Rein lesend gegengeprüft** (`cat06_variant_survey.sql`, nach der Anwendung): 730 Katalogzeilen, `draft:103 hidden:30 public:597`, 107 mit `character_id`, 20 Familien — die Migration hat keine Zuordnung erzeugt, wie zugesagt. Protokolle: `migrate-0158-2026-10-28T11-5*.md` (Preflight) und `…T12-43-01-984Z.md` (Nachkontrolle). **Auf Production NICHT angewendet** |
| `0159_variant_base_figure.sql` | `848583f8c1755ad7466858a7ba7eff00986bcb57159536548179ca8da143270b` | gleich | **2026-10-28**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0159.sql` (SHA-256 `7d1a483fab7913d4251c214f0a44d4c93bc42e50e4c6f375bf864ac86dbb58bb`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-07, ADR-0156, Laufzettel `supabase/checks/0159_staging_run.md`. **Preflight bestanden:** 40 Zeilen, `9999 = 0`, eine offene Zeile (134 — das Journal, Rechtegrenze des Prüfzugangs, ADR-0141). Baselines eingefroren in `supabase/baselines/baseline-0159.json` (Angebote 257, shopfähig 535, sammelbar 535, Lagerzeilen 287, Katalogzeilen 729, Sammlung 21) und danach **nie neu erhoben**. **Die Nachkontrolle brauchte zwei Anläufe, und der erste deckte einen Mangel am Prüfweg auf, nicht an der Migration:** Zeile 123 meldete `0` statt `2` für „beide sind `security definer` mit genau einer `search_path`-Festlegung“, weil das Suchmuster **zwei** Backslashes trug — SQL `LIKE` liest das als einen echten Backslash und findet dann nichts. Vor jeder Änderung rein lesend gegengemessen (`cat07_function_attributes.sql`): beide Funktionen sind `prosecdef`, tragen **genau eine** `proconfig`-Festlegung `search_path=""` (leer, also sicher) und haben **0** offene EXECUTE-Rechte; `admin_merge_references` ist nach dem Rumpftausch unverändert `security definer`, `stable`, `search_path=""`. Korrigiert wurde **ein Zeichen in der Prüfdatei**; die Migration blieb unberührt (Regel 1). **Nachkontrolle bestanden:** `0159_postflight.sql`, **57 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, eine offene Zeile (135 — dieselbe Rechtegrenze). **Der berechtigte Lauf ist gefahren** (Betreiber, als `postgres`, `supabase/log/staging/0159-postflight-berechtigt.sql`): **`9998 = 0` UND `9999 = 0`**, Prüfung 135 mit **0** Journalzeilen `base_sky_id`, alle Katalog-, Angebots-, Lager- und Sammlungs-Bezugswerte unverändert. **Was die Nachkontrolle im Einzelnen festhält:** die Spalte `base_sky_id` steht, die Eindeutigkeit `(sky_id, series_code)` ist da (105), der Serienriegel ist ein **zusammengesetzter Fremdschlüssel** auf **beide** Spalten mit `ON UPDATE RESTRICT` und `ON DELETE RESTRICT` (103 — das ist die Zusage dieser Migration), der Selbstbezug fällt an einem CHECK, der Teilindex steht, der Kettenschutz-Trigger greift in **beiden** Richtungen, das Journal kennt `base_sky_id` als zwölften Wert, beide neuen RPCs sind `security definer` mit leerem Suchpfad und ohne Recht für `anon`/`public` (121–125), und `admin_merge_references` löst die verweisende Spalte jetzt über `confkey` auf (112) — **ohne diesen Rumpftausch hätte der zweispaltige Schlüssel jede Zusammenführung und jedes Verwerfen gebrochen** (Probelauf P67). **Und nichts ist geschrieben:** 0 Zuordnungen, 729 Katalogzeilen, 20 Familien, 102 Entwürfe — zeichengleich wie im Preflight (131–138). **Nebenbefund, gemessen und als Hausnorm bestätigt** (`cat07_trigger_acl.sql`): `skylanders_variant_base_guard()` trägt EXECUTE für PUBLIC und `anon`, weil `0159` dort keinen Widerruf ausspricht — **32 von 45** Triggerfunktionen im Schema `public` tragen dasselbe, darunter **jede** andere an `public.skylanders`; Rückgabetyp `trigger` ist nicht als Ausdruck aufrufbar und wird von PostgREST nicht angeboten. Kein Sonderfall, keine Reparatur. **Zwei neue Wächter** halten die Maskierungsklasse fest: der Abschnitt *Maskierung in Suchmustern* in `src/lib/admin/check-body-patterns.test.ts` (alle 357 `LIKE`-Muster aller Prüfdateien) und **P68** in `tools/validate-check-sql.mts`, der den Ausdruck **aus der Prüfdatei selbst** gegen echtes PostgreSQL fährt. Protokolle: `migrate-0159-2026-10-28T15-32-28-163Z.md` (Preflight), `…T15-43-55-346Z.md` (erster Anlauf) und `…T18-17-52-359Z.md` (Nachkontrolle). **Auf Production NICHT angewendet** |
| `0160_platform_export_base_sky_id.sql` | `ca17578cf7255e79407bb1acc1c81e9e91726a8ed041f310f0c93cb5218ef382` | gleich | **2026-10-28**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0160.sql` (SHA-256 `52f13b110b471da6761a16f7e9c73f3bf161a01140d8a4531d5bb7e6307c56e7`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-07, Nachtrag; ADR-0156, Laufzettel `supabase/checks/0160_staging_run.md`, Reihenfolgefragen in `supabase/checks/0160_restore_order.md`. **`base_sky_id` ist jetzt in der Plattformsicherung.** Dieselbe Bauform wie `0153`: **EINE Zeile** im Rumpf von `system_platform_export()` (`'base_sky_id', t.base_sky_id,`, hinter `character_id`), alles andere Zeichen für Zeichen die Fassung aus `0153`. **Preflight bestanden:** 45 Zeilen, `9999 = 0`, **keine offene Zeile**. Baselines eingefroren in `supabase/baselines/baseline-0160.json` (Angebote 257, shopfähig 535, sammelbar 535, Lagerzeilen 287, Katalogzeilen 729, Sammlung 21) und danach **nie neu erhoben** — zeichengleich zu `baseline-0159.json`, der Katalog hat sich zwischen beiden Migrationen nicht bewegt. **Nachkontrolle bestanden:** `0160_postflight.sql`, **59 Zeilen, `9999 = 0`**, Baselines unverändert übernommen, eine offene Zeile (139 — das Journal, Rechtegrenze des Prüfzugangs, ADR-0139/0141). **Der berechtigte Lauf ist gefahren** (Betreiber, als `postgres`): **`9998 = 0` UND `9999 = 0`**, alle Baselines unverändert, keine ungewollte Variantenbeziehung und keine Katalogänderung. **Was die Nachkontrolle im Einzelnen festhält:** der Rumpfabdruck ist `ff4f38e61cbd4e5857ea914d6be68d44` (102), die eingefügte Feldzeile steht **genau einmal** (104, das vollständige Muster gezählt — die Lehre aus `0153` Zeile 104 stand hier von Anfang an richtig), und **zieht man die eine Zeile wieder ab, ist der Rumpf zeichengleich der aus `0153`** (105, `92c48444f99b9e294f9703d0c0ddeaa8`) — das ist die Zusage dieser Migration, am lebenden Rumpf nachgerechnet und nicht nur im Arbeitsbaum. Die Zeile steht hinter `character_id` im Bereich `skylanders` (106), die Länge ist 31 072 + 42 = **31 114** Zeichen (107), `catalog_status` aus `0153` steht unverändert daneben (109 — **einen** Schritt, nicht zwei), Attribute und Rechte sind unberührt (111–118: `security definer`, `stable`, genau eine leere `search_path`-Festlegung, 0 offene EXECUTE, genau eines für `authenticated`, Kommentar nennt `0160`), **54 Bereiche und `format_version` 2** (121–126 — ein FELD, kein Bereich, und `seller_business_backup()` führt `base_sky_id` nicht), und die Variantenbeziehung ist unverändert: keine Kette, keine Zuordnung über Seriengrenzen, kein Selbstbezug, kein verwaister Verweis, **derselbe Abdruck der Beziehung wie im Preflight** (131–138). **Vorher gemessen, nicht angenommen** (Probelauf **P69**, `npm run verify:check-sql`): der vollständige Umlauf mit einer Basisfigur und **drei** Varianten in der **schlechtesten Reihenfolge** — Varianten vor der Basisfigur, in **einer** Anweisung — läuft durch, weil ein nicht aufschiebbarer Fremdschlüssel am **Anweisungsende** prüft; zeilenweise in derselben Reihenfolge scheitert es mit `23503`; **`set constraints all deferred` hilft NICHT** (die Anweisung läuft durch und tut nichts, weil die Constraint nicht `deferrable` ist — die leise Falle, aufgeschrieben in `0160_restore_order.md` Abschnitt 3); und zwei Durchgänge (erst `NULL`, dann `UPDATE`) führen zum selben Ergebnis **ohne eine Journalzeile**. **Der Fremdschlüssel aus `0159` ist NICHT angefasst** — ob er `deferrable` werden soll, bleibt eine eigene Frage mit eigener Freigabe. Rücknahme `supabase/rollback/R0160_platform_export_back_to_0153.sql` geht **einen** Schritt zurück: `catalog_status` bleibt, Spalte und Beziehungen bleiben unberührt. **Archive der Version 2 ohne dieses Feld bleiben lesbar** — die Vollständigkeitsprüfung zählt Bereiche, nicht Felder (`src/lib/backup/platform-export-0160.test.ts`). Protokolle: `migrate-0160-2026-10-28T20-07-11-463Z.md` (Preflight) und `…T20-08-28-298Z.md` (Nachkontrolle). **Auf Production NICHT angewendet** — dort steht weiter der Rumpf aus `0105` |
| `0161_variant_family_auto.sql` | `177d9ece20c64b26ad6fb51106ad2b3e6ee6e9fdc5818e7e1af4009f28446e86` | gleich | **2026-10-29**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0161.sql` (SHA-256 `569656de4fcaf8ab4000a70824aeb5ea41825f6a33846d344445abc65efbc7e4`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-08 Stufe 1, ADR-0157, Laufzettel `supabase/checks/0161_staging_run.md`. **Die Familie entsteht von selbst:** `admin_publish_variant_auto(text, text)` ist eine **vierte** Funktion neben den drei Wegen aus `0158`/`0159` — sie ersetzt keine, sie **ruft** sie. **Preflight bestanden:** 43 Zeilen, `9999 = 0`, **keine offene Zeile**. Baselines eingefroren in `supabase/baselines/baseline-0161.json` (erhoben 07:36:41: Angebote 257, shopfähig 552, sammelbar 552, Lagerzeilen 287, Katalogzeilen 725, Sammlung 21) und danach **nie neu erhoben** — die Zahlen weichen von `baseline-0160.json` ab, weil der Betreiber zwischen beiden Migrationen redaktionell gearbeitet hat (Entwürfe veröffentlicht und verworfen); Pre- und Postflight dieser Migration stimmen überein, **sie selbst hat nichts verändert**. **Nachkontrolle bestanden:** `0161_postflight.sql`, **59 Zeilen, `9999 = 0` UND `9998 = 0`** — der lesende Prüfzugang konnte jede Zeile prüfen, es gibt keine offene. **Zusätzlich am Rumpfabdruck nachgewiesen** (`supabase/checks/cat08_applied_fingerprint.sql`, rein lesend, 20 Zeilen, `9999 = 0`), und das ist mehr als die Nachkontrolle leistet: die hält Muster im Rumpf fest, dieser Nachweis den **ganzen** Rumpf — `md5(prosrc)` auf Staging ist `adf679deb5d42fad5dff15bd1641f318` bei **6553** Zeichen, Zeichen für Zeichen der Rumpf zwischen `as $$` und `$$;` dieser Datei. Die Parameter heißen `p_sky_id text, p_base_sky_id text`, also genau so, wie `src/lib/admin/actions.ts` sie über PostgREST **benannt** schickt; ein anderer Name wäre `PGRST202` im Betrieb. **Die sechs Funktionen, die unverändert bleiben mussten, sind es** (Anforderung 1, an den Abdrücken gemessen): `admin_set_variant_base` `b47289cb…`, `admin_publish_with_base` `3df170df…`, `admin_create_character` `5f8137b4…`, `admin_set_character` `4b02bf10…`, `admin_publish_as_variant` `99339dc5…`, `admin_set_catalog_status` `e3c76fa5…` — und der Exportrumpf aus `0160` ebenfalls (`ff4f38e6…`). **Was die Nachkontrolle im Einzelnen festhält:** die Funktion steht genau einmal, `security definer`, genau eine `search_path`-Festlegung mit leerem Wert, **0** offene EXECUTE-Rechte und genau eines für `authenticated` (101–106); im Rumpf stehen die drei Zusagen — der **Advisory-Lock** auf dem kleingeschriebenen Familiennamen, die **feste Sperrordnung** über beide Zeilen in `sky_id`-Ordnung und die **Vetoprüfung** mit `right()` statt `like` (107–109); sie schreibt **nicht selbst** (kein `update public.skylanders`, kein `delete`, kein Name, kein Slug, kein Preis, keine Sichtbarkeit) und ruft `admin_set_character`, `admin_set_variant_base` und `admin_set_catalog_status` (121–126); und nichts ist geschrieben — dieselben Zahlen und dieselben Abdrücke der Varianten- und der Familienzuordnung wie im Preflight, **0** Namen mit zwei verschiedenen Familien, **0** Ketten, **0** Zuordnungen über Seriengrenzen (131–139). **Namensgleichheit findet eine Familie, bestätigt sie aber nicht:** jedes Mitglied der gefundenen Familie muss einen Namen tragen, der mit dem der Basisfigur an einer **Wortgrenze** vereinbar ist — sonst Abbruch mit Nennung des Mitglieds. Das ist ein **Veto, keine Suche**, und damit bleibt **ADR-0034 unberührt**. **Vorher gemessen, nicht angenommen** (Probelauf **P70**, `npm run verify:check-sql`): die drei Fälle, die der Betreiber genannt hat — **Chop Chop, Stump Smash, Wrecking Ball** stehen je zweimal im Katalog (`SA` und `G` Series 2), und der zweite Entwurf **benutzt** die Familie des ersten statt abzubrechen (vier Mitglieder, **eine** Familie, Basisfiguren bleiben Basisfiguren); das **Veto** (Familie „Zook" mit dem Mitglied „Cynder" → Abbruch, nichts geschrieben; nach Umbenennung in „Gold Zook" geht derselbe Lauf durch); die Übernahme ohne neue Familie; der Widerspruchsabbruch mit unberührter Variante; vier Abweisungen mit eigener Meldung; `42501` ohne Adminrecht; das Journal (`character_id` zweimal, `base_sky_id` einmal); **keine Massenzuordnung** (genau zwei Zeilen, eine gleichnamige dritte Figur bleibt unberührt); der verlorene Wettlauf; `admin_publish_with_base` aus `0159` unverändert lauffähig; und `R0161`, das **eine** Funktion entfernt und **keine** Zuordnung. **Bestand bei der Anwendung** (`cat08_inventory_note.sql`): 81 Entwürfe, 614 öffentliche und 30 versteckte Zeilen, 725 Katalogzeilen, 109 Zeilen mit Familie in 20 Familien, 17 Varianten mit Basisfigur über 16 Basisfiguren. Protokolle: `migrate-0161-2026-10-29T07-36-41-445Z.md` (Preflight) und `…T07-37-20-954Z.md` (Nachkontrolle). **Auf Production NICHT angewendet** |
| `0162_admin_price_and_delete.sql` | `5bb5caf934ea218a9bda37b1a11cb5f7c8947976e681e797bfe966da662a0f63` | gleich | **2026-10-29**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0162.sql` (SHA-256 `6d9ccb558033377bcbcaf1521512c1f4fd24049dd68e57d3b08c50d0e76b7563`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-09, ADR-0159, Laufzettel `supabase/checks/0162_staging_run.md`. Zwei Funktionen und zwei Journalwerte, sonst nichts — keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie, kein Index. `admin_set_market_price(text, numeric)` schreibt **eine** Spalte und ihr Datum (`market_price`, `price_updated_at`); der Katalog druckt `market_price × (1 + boost/100)`, gerechnet in `src/lib/catalog/market-boost.ts` im Moment des Druckens und **nie gespeichert** — die Inlinebearbeitung bindet deshalb an den **gespeicherten** Wert. `admin_delete_figure(text)` löscht **eine** referenzfreie Zeile und prüft dafür drei Dinge: die **vierzehn** gezählten Fremdschlüssel aus `admin_merge_references`, die **vier mit `ON DELETE CASCADE`** (`cart_items`, `catalog_editorial`, `inventory_import_mappings`, `orderbook_name_mappings`) namentlich in der Meldung, und **DEN STILLEN VERWEIS** `order_lines.sky_id`, den kein Fremdschlüssel schützt und `admin_merge_references` deshalb nicht sieht. **Ein echter Fehler wurde VOR dem Lauf gefunden**, und zwar von `P71` an echtem PostgreSQL: `to_regclass('public.' || r.tabelle)` auf den schon qualifizierten Namen des Helfers wäre `0A000 cross-database references are not implemented` gewesen. Gelaufen ist die korrigierte Fassung, deren Prüfsumme hier steht. **Preflight bestanden:** 40 Zeilen, `9999 = 0`, vier offene Zeilen (133, 134, 137, 139) — alle vier lesen Objekte, auf die der lesende Prüfzugang kein `select` hat. Baselines eingefroren in `supabase/baselines/baseline-0162.json` (erhoben 13:45:02.688Z: Angebote 257, shopfähig 565, sammelbar 565, Lagerzeilen 287, Katalogzeilen 694, Sammlung 21, Favoriten 1) und danach **nie neu erhoben**; Pre- und Postflight stimmen überein, **die Migration selbst hat keine Datenzeile bewegt**. **Die Nachkontrolle brauchte zwei Anläufe, und der Befund lag beide Male in der PRÜFDATEI, nicht in der Datenbank:** `9999 = 2`, Zeile **114** („und KEINE andere Spalte") und Zeile **122** („kein Zugriff auf `storage`"). Beide suchten ein blankes Wort in `prosrc` — und `prosrc` enthält die **Kommentare**: die Preisfunktion sagt im Kommentar „kein `card_type`", die Löschfunktion nennt `0162_storage_note.md`. Dieselbe Klasse wie `0159` Zeile 51, `0156` Zeile 115 und `0153` Zeile 104. Beide Zeilen messen jetzt am **kommentarfreien** Rumpf (`/* … */` und `--` zuvor herausgenommen) und suchen die **Schreibform** statt des Wortes: Zeile 114 die Spalte in einem `set`, Zeile 122 `storage` mit folgendem Punkt oder in Anführungszeichen; neu dazu Zeile **120** — genau ein `update` im Rumpf. **Keine Prüfung wurde entfernt oder pauschal auf Erfolg gesetzt**, und `P71` Abschnitt **V** schneidet den echten Zeilentext aus der Prüfdatei heraus und fährt ihn gegen Rümpfe, die den Fehler wirklich enthalten: fremde Spalte nach Komma, ohne Leerzeichen, in Anführungszeichen, Zeilenumbruch nach `set`, zeilenweises `set (a, b) = (…)`, ein zweites `update`, drei Formen des Storage-Zugriffs — und den Rückfall, dass beide Wörter nur im Kommentar stehen. Die Migrationsdatei blieb unberührt (Regel 1), und die Baseline ebenso: ihre Prüfsumme `0c78c34f7b83c038…` ist vor und nach dem Lauf dieselbe. **Nachkontrolle bestanden:** `0162_postflight.sql`, 66 Zeilen, `9999 = 0`, vier offene Zeilen (133, 134, 137, 138) — und der **berechtigte Lauf** als `postgres` über `supabase/log/staging/0162-postflight-berechtigt.sql`, in das der Runner die eingefrorenen Baselines schon eingesetzt hatte: **`9998 = 0` UND `9999 = 0`**, keine offene Zeile mehr. `admin_set_market_price` und `admin_delete_figure` stehen, kein `setval`, kein Zugriff auf Supabase Storage, keine unerwartete Datenänderung. Rücknahme: `supabase/rollback/R0162_drop_price_and_delete.sql` (entfernt die zwei Funktionen, lässt die Audit-Constraint und **jede** Journalzeile stehen). |
| `0163_catalog_types.sql` | `f75b04eaf426aea1ec80ef4000b3470b305441003f4ff56f4b9530134fec1763` | gleich | **2026-10-29**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0163.sql` (SHA-256 `efbc229c05eb5a4cc9ee53b6ddf61bd1535456e6b33ae319edfc905aaf2ee620`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-10, ADR-0160, Laufzettel `supabase/checks/0163_staging_run.md`. Angelegt: `types text[] not null default '{}'`, `visible_type text`, `visible_type_decided boolean not null default false`; die drei CHECKs `skylanders_types_known` (`types <@` **17** Werte), `skylanders_visible_type_member` (`visible_type is null or = any (types)`) und `skylanders_visible_type_decided`; der normalisierende Trigger `skylanders_canonical_types`; zwei Journalwerte (**fünfzehnter** und **sechzehnter**); `admin_set_figure_types(text, text[])` und `admin_set_visible_type(text, text)`; und die zwei Zusammenführungsrümpfe aus `0157` mit `types` als **neuntem** Feld. **Preflight bestanden:** 42 Zeilen, `9999 = 0`, **keine offene Zeile**. Baselines eingefroren in `supabase/baselines/baseline-0163.json` (erhoben 14:17:15.335Z, Prüfsumme `f00787e5f82b4627…`): Angebote 257, shopfähig 565, sammelbar 565, Lagerzeilen 287, Katalogzeilen 694, Sammlung 21, Favoriten 1 — **zeichengleich mit `baseline-0162.json`**, zwischen den beiden Migrationen hat sich im Katalog nichts bewegt, und `0162` hat damit nachweislich keine Datenzeile angefasst. **Nachkontrolle bestanden:** `0163_postflight.sql`, 69 Zeilen, `9999 = 0`, **eine** offene Zeile (144, `catalog_admin_changes` — kein `select` für den Prüfzugang); der **berechtigte Lauf** als `postgres` über `supabase/log/staging/0163-postflight-berechtigt.sql` schloss sie: **`9998 = 0` UND `9999 = 0`**, Zeile 144 = **0** (die Migration ruft die beiden Funktionen nicht auf, sie schreibt die Erstbelegung direkt). **Der gemessene Zustand nach dem Lauf** (rein lesend nachgemessen, `set transaction read only`): 694 Katalogzeilen, **479** mit mindestens einem Type und 215 ohne, **66** mit zwei (größte Menge 2), **206** mit Banner und **alle 206** mit `visible_type_decided = true`, **0** Banner ohne Mitgliedschaft in der eigenen Menge, **0** Zeilen „kein Banner, aber entschieden"; Banner `chase` 56, `elite` 42, `special` 42, `legendary` 28, `dark` 21, `lightcore` 17 — **kein Gruppen-Type ist Banner geworden** (D4/D6), `categories.catalog_group` bleibt für die Navigation maßgeblich (D5). **Die 21 LightCore-Zeilen kommen vollständig aus der kuratierten Liste** (D2, kein Treffer außerhalb, keine Namensheuristik): 17 davon tragen nur `{lightcore}` und zeigen seither LIGHTCORE statt SPECIAL — **die 17 gewollten Bannerwechsel** —, vier tragen eine **zweite, echte** Eigenschaft und behalten deren Banner (`{legendary,lightcore}` SKY-0130 und SKY-0252, `{chase,lightcore}` SKY-0172 und SKY-0854). **DIE KARTENKUNST IST UNVERÄNDERT, UND DAS IST GEMESSEN:** `md5(sky_id|card_type)` über alle 694 Zeilen ist `4b81b91886b911d6f9dcbbca0d381be3` — genau der Wert, den Wächter **A7** der Hülle **vor** dem Lauf aus den lebenden Daten genommen hat; **B3** hat ihn nach der Erstbelegung neu gerechnet und verglichen, und die Migration selbst tut dasselbe und bricht ab, wenn er sich bewegt. Verteilung unangetastet: `standard` 488, `special` 59, `chase` 56, `elite` 42, `legendary` 28, `dark` 21. `card_type` bleibt eine **eigene** Spalte, weil die vorgeschlagene Projektion am ganzen Katalog nachweislich nicht verlustfrei ist (`supabase/checks/cat10_projection_proof.sql`), und keine der beiden neuen Funktionen nennt sie (Postflightzeile 118 = 0). **EINE KORREKTUR AN DER HÜLLE VOR DEM LAUF, UND SIE GEHÖRT HIERHER:** `staging-0163.sql` verglich den Kunstabdruck ursprünglich gegen einen **eingefrorenen** Wert (`4d6bbb02…` vom 11:12). Nach der redaktionellen Arbeit des Betreibers war der lebende Wert `4b81b918…`, und die Hülle hätte die ganze Transaktion abgebrochen. Der Wert ist **nicht ungeschützt entfernt** worden: A7 **misst** ihn jetzt und legt ihn transaktionslokal ab (`set_config(..., true)`), B3 liest ihn zurück und bricht ab, wenn die Ablage **fehlt** — ein Lauf ohne A7 kann die Prüfung also nicht überspringen. `P72` Abschnitt **U** fährt genau das: fehlende Ablage bricht ab, unveränderte Kunst geht durch, veränderte wird gefangen und zurückgerollt. **Die beiden neuen Funktionen, als Sicherheitsaussage:** `security definer`, `search_path=""`, Eigner `postgres`, `execute` nur für `authenticated` und `service_role` (kein `public`, kein `anon`), und beide prüfen `is_platform_admin()` im kommentarfreien Rumpf. Unberührt: `base_sky_id`, `character_id` (D7), Name, Slug, Serie, Kategorie, Preis, Bild, Status, Lager, Angebote, Sammlungen, Bestellungen. Rücknahme: `supabase/rollback/R0163_drop_catalog_types.sql` — sie **verwirft Daten** (jede Typzuordnung) und sagt die Zahl vorher; `card_type` und jede Journalzeile bleiben, und sie **verweigert**, solange die `0163`-Fassung der Zusammenführung steht. |
| `0164_platform_export_types.sql` | `f2d5e77cf56c94c832614a5eff0eb8c3b480d2fe1166416944d47b721902e601` | gleich | **2026-10-29**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0164.sql` (SHA-256 `5c4338cf249a7b556d54878311d4acfef8fb603bcbe902750a4fa89d8ddc668d`), das diese Datei **zeichengleich** einbettet — geprüft von `src/lib/catalog/staging-oneshot.test.ts`. CAT-10, ADR-0160, derselbe Laufzettel wie `0163`. Sie ersetzt **einen** Funktionsrumpf und fügt im Bereich `skylanders` genau **drei** Zeilen hinzu: `'types', t.types,` · `'visible_type', t.visible_type,` · `'visible_type_decided', t.visible_type_decided,`. **Preflight bestanden:** 28 Zeilen, `9999 = 0`, **keine offene Zeile** — darunter die drei Riegel: `0163` liegt, der vorhandene Rumpf **war** der aus `0160` (`md5 ff4f38e61cbd4e5857ea914d6be68d44`, 31114 Zeichen), und der Rumpf nannte die drei Spalten **noch nicht**. Baselines eingefroren in `supabase/baselines/baseline-0164.json` (erhoben 14:31:06.306Z, Prüfsumme `d4a7322d6972d263…`): Angebote 257, shopfähig 565, sammelbar 565, Lagerzeilen 287, Katalogzeilen 694, Sammlung 21, Favoriten 1. **Technisch verifiziert:** `md5(prosrc)` ist **`7e9e58e2d84a9f8a7c660262aa21926b`** bei **31248** Zeichen; die **Umkehrprobe** zieht die drei Zeilen wieder heraus und ergibt **`ff4f38e61cbd4e5857ea914d6be68d44`** — zeichengleich der Rumpf aus `0160`, also ist **nichts anderes** am Export verändert; **540** Bereichsklammern (die 54 Bereiche, kein neuer), `format_version` bleibt **2**, `catalog_status` (0153) und `base_sky_id` (0160) stehen weiter drin; `security definer`, `search_path=""`, Eigner `postgres`, `execute` nur für `postgres` und `authenticated` — **kein `service_role`, kein `public`, kein `anon`**. Typmengen, Banner und Kartenkunst unberührt (479 mit Type, 478 Banner, 21 LightCore, 17 `lightcore`-Banner, Kunstabdruck `4b81b918…`), die zwei Funktionen aus `0163` unverändert, Betriebssicherung nicht angefasst. **ZWEI ERKLÄRTE ABWEICHUNGEN, UND DER BEFUND WIRD NICHT WEGGESCHRIEBEN:** die Nachkontrolle `0164_postflight.sql` lief mit **44 Zeilen, `9999 = 2`** (keine offene Zeile, also war **kein** berechtigter Lauf erforderlich) — Zeile **813** „shopfaehige Katalogzeilen wie vor der Migration" mit `564` statt `565` und Zeile **814** „sammelbare Katalogzeilen" ebenso. **Ursache: eine beabsichtigte redaktionelle Änderung des Betreibers im offenen Migrationsfenster.** `SKY-0564` „Kaos in OVP" (Serie I, Kategorie Senseis, `item_type = figure`, aktiv) wurde am **2026-10-29 um 14:38:40 UTC** auf versteckt gesetzt — nach dem Einfrieren der Baseline um 14:31:06 und vor der Nachkontrolle um 14:44:24. Das **Journal belegt es**: `catalog_status` `public` → `hidden`, `catalog_visible` `true` → `false`, und **keine weitere Status- oder Sichtbarkeitsänderung** im geprüften Zeitraum (gelesen als `postgres`; der lesende Prüfzugang hat auf `catalog_admin_changes` kein `select`). **Die Gegenrechnung geht ohne Rest auf:** beide Zahlen hängen an `is_active ∧ catalog_visible ∧ (figure) ∧ sammelbare Kategorie`, und mit `catalog_visible` **nur für diese eine Zeile** als wahr angenommen ergeben sie wieder **565** und **565** — genau die eingefrorenen Werte. Jeder andere Vertragswert stimmt: Angebote 257, Angebots-Abdruck, Lagerzeilen 287, Lager-Abdruck, Katalogzeilen 694, Sammlung. **Die Migration kann die Ursache nicht sein:** sie enthält **genau eine** Anweisung, `create or replace function public.system_platform_export()` — kein `update`, `insert`, `delete`, `alter`, keinen Trigger, keine Richtlinie; eine versteckte Katalogzeile liegt außerhalb dessen, was sie berühren kann. Die Prüfdatei wurde **nicht** geändert und keine Prüfung abgeschwächt: `0164_postflight.sql` sagt weiter `9999 = 2`, und `baseline-0164.json` bleibt eingefroren (Prüfsumme vor und nach dem Lauf dieselbe). **Lehre für die nächste Migration:** solange ein Migrationsfenster offen ist, keine redaktionelle Arbeit im Adminbereich — die Baseline wird **vor** dem Schreiben erhoben und **danach** verglichen, jede Zwischenänderung erscheint zwangsläufig als Abweichung. Rücknahme: `supabase/rollback/R0164_platform_export_back_to_0160.sql` (stellt nur den Rumpf wieder her, fasst keine Spalte und keine Zeile an); **Reihenfolge einer Rücknahme: erst `R0164`, dann `R0163`.** |
| `0165_system_sync_create_figure.sql` | `c3183ffac4e7cace57b5884a4da550fdb3d7672975c4ad7af50ddb66836918df` | gleich | **2026-10-30**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0165.sql`. Preflight **9999 = 0** (31 Zeilen, 1 offen: Sequenzstand — der Pruefzugang darf `sky_id_seq` nicht lesen). Nachkontrolle mit berechtigtem Zugang: **9998 = 0 und 9999 = 0**. Die Funktion steht genau einmal, elf Parameter, SECURITY DEFINER mit leerem `search_path`; `service_role` darf sie, `anon`, `authenticated` und PUBLIC nicht; ihr Rumpf nennt weder `sky_id_seq` noch `market_price`. Katalog, Shop, Lager und Sammlungen unveraendert; `sky_id_seq` 927 / `is_called` true. Baseline: `supabase/baselines/baseline-0165.json`. **ZWEI PRUEFZEILEN WAREN FALSCH UND SIND KORRIGIERT, die Migration nicht:** die Registrierung im Runner fehlte zunaechst ganz, und Postflight 242 behauptete, `service_role` habe auf den zwei Tabellen kein TRUNCATE/REFERENCES/TRIGGER — es hat sie, wie auf 68 von 69 Tabellen des Schemas, als Supabase-Projektvorgabe. Beides traegt jetzt einen Regressionstest (`src/lib/admin/migration-registration.test.ts`). **Production: nicht angewendet, eigene Freigabe.** |
| `0166_admin_create_variant_figure.sql` | `67c291d51340d8f551f319bb68564b3171f2768f0a88e22c0037c4361cd4aa8b` | gleich | **2026-10-31**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0166.sql` (SHA-256 `64d0c4494f4126e39adf1eb13323b2f266bf77df22df9dce823c64e555b31631`, bettet die Migration zeichengleich ein), Supabase meldete „Success". Runner `npm run db:migrate:staging -- 0166`: Preflight **9999 = 0** (27 Zeilen, 1 offen: Sequenzstand — der Pruefzugang darf `sky_id_seq` nicht lesen), Baselines eingefroren in `supabase/baselines/baseline-0166.json`. `--resume`: Nachkontrolle **9999 = 0** (43 Zeilen, 1 offen: Zeile 234). Berechtigter Postflight `supabase/log/staging/0166-postflight-berechtigt.sql` als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**, Zeile 234 `929|true`. `npm run db:privileges:staging`: Einrichtung und Datenbank stimmen ueberein, Abdruck `13f9f823…` unveraendert. Rein lesend nachgemessen: `admin_create_variant_figure` steht genau einmal, acht Parameter, SECURITY DEFINER mit leerem `search_path`, `md5(prosrc)` = `bfb4a56fbe3467131d3b1b0ff48c912a` = Rumpf der Migrationsdatei; `authenticated` darf, `anon` und PUBLIC nicht; `is_platform_admin()` steht vor dem ersten Schreibweg. Katalog 696 Zeilen, Abdruck `7b263fb435e2a52b9702905db6635971` vorher = nachher; `SKY-0010`/`SKY-0836`/`SKY-0929` Abdruck `b558f2fbf90a45d1e119dcf5ea4d1b60` vorher = nachher; hoechste SKY-ID `SKY-0929`; `resources/sync/catalog-baseline.json` und `publish-ledger.json` byte-gleich. **Sequenzstand:** `929|true` passt zur hoechsten Zeile `SKY-0929` — seit deren Anlage ist keine Nummer gezogen worden, also auch nicht durch diesen Lauf. **Offen:** der woertliche Vergleich mit der A3-NOTICE der Huelle (Katalog-, Journalzeilen und Sequenzstand VOR dem Lauf) — die Zeile liegt nicht vor. Die Journalzahl ist damit nicht vorher/nachher belegt; die Migration enthaelt keine Datenanweisung. **Production: bewusst nicht angewendet (ADR-0167, 2026-11-01).** |
| `0167_ovp_removal.sql` | `9f1fad86b7b1923dc06eff64db8215b9e8e5efb1169a7b0360d5b12ff3d71788` | gleich | **2026-10-31**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0167.sql` (SHA-256 `e4c1c5b5d33dadc8e2508432b89cc1fb197ae4a2893a73a3598a6ea30b5a8c93`, bettet die Migration zeichengleich ein), Supabase meldete „Success". Runner: Preflight **9999 = 0** (27 Zeilen, 1 offen: Sequenzstand), Baselines eingefroren in `supabase/baselines/baseline-0167.json`; `--resume` am 2026-11-01: Nachkontrolle **9999 = 0** (43 Zeilen, 2 offen: 202, 234). Berechtigter Postflight `supabase/log/staging/0167-postflight-berechtigt.sql` als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**, Zeile 202 `0` (Grabstein leer), Zeile 234 `929|true`. `npm run db:privileges:staging`: Einrichtung und Datenbank stimmen ueberein, Abdruck unveraendert. Rein lesend nachgemessen: `md5(prosrc)` von `system_remove_ovp_figure` = `ea22abb1b5c79561b175164ca4b0e59f`, von `skylanders_refuse_removed` = `49f7816c93abf8e0331f911a24e5c6f1` — beide gleich dem Rumpf der Migrationsdatei; beide SECURITY DEFINER mit leerem `search_path`; die Entfernungsfunktion darf weder `anon` noch `authenticated` noch PUBLIC noch `service_role` ausfuehren; Trigger `skylanders_refuse_removed_trg` BEFORE INSERT, aktiv; RLS am Grabstein an. Katalog 696 Zeilen, Abdruck `7b263fb435e2a52b9702905db6635971` vorher = nachher; die 30 OVP-Zeilen Abdruck `ba7b6b9f29bde10419aae29fc0333477` vorher = nachher; Lager 287, Abdruck `4a48f364…` gleich; Importprotokolle 2462, Notizen 104, **Journal 1152 vorher = nachher**; `catalog_removed_sky_ids` 0 Zeilen; `resources/sync/catalog-baseline.json` und `publish-ledger.json` byte-gleich. **Sequenzstand:** `929|true` nach dem Lauf, gleich dem Stand nach 0166 — keine Nummer gezogen. **Offen:** der woertliche Vergleich mit der A3-NOTICE dieses Laufs; sie liegt nicht vor. Die Journalzahl ist trotzdem vorher/nachher belegt (Service-Schluessel, rein lesend). **Production: angewendet 2026-11-01 (P-1, Abschnitt „`0167` auf Production").** |
| `0168_variant_family_inheritance.sql` | `341138968f54f8e1035e9d3c27e24f05f5beba86e3e0d61a4c77be153221c5bc` | gleich | **2026-11-02**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0168.sql` (SHA-256 `813fc837d116269013f735429da237aeb45aeb78689ca98531b74869897e8047`, bettet die Migration zeichengleich ein, committet in `213377d`), Supabase meldete „Success". Runner `npm run db:migrate:staging -- 0168`: Preflight **9999 = 0** (30 Zeilen, 3 offen: 114, 115, 134 — der Pruefzugang darf `characters` und `sky_id_seq` nicht lesen), Baselines eingefroren in `supabase/baselines/baseline-0168.json`. `--resume`: Nachkontrolle **9999 = 0** (47 Zeilen, 3 offen: 222, 223, 234). Berechtigter Postflight `supabase/log/staging/0168-postflight-berechtigt.sql` (SHA-256 `ef487eb99295d6a1c278509f52f7612b1d181401f7a64106368e83a5fbce2c19`, `begin … rollback`) als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**, Zeile 222 `4` (leere Familien, wie vorher), 223 `119` (Familien, wie vorher), 234 `931|true`; alle Zeilen mit Sollwert `ok=true`, Shop- und Sammlungsbaseline vollstaendig gleich. Trigger `skylanders_variant_family_cascade_trg` und `skylanders_variant_family_follow_trg` beide `tgenabled = O`. Rein lesend nachgemessen (Dienstschluessel) vor und nach dem Lauf, **bitgenau gleich**: 658 Katalogzeilen, 119 Familien, 1655 Journalzeilen, 30 Grabsteine, Sammlung 21, Favoriten 7, Lager 286, Bestellungen 4; Abdruck aller `(sky_id, character_id, base_sky_id)` `a37109d366adeb43624a1accb41ced03`, aller `updated_at` `4c2cfa85bef53eb6443866311984412f`, aller Familien `f7f049aa31cca5b8e9377b53e862a77b` — keine Katalogzeile wurde beruehrt. Die 8 Familienabweichungen (SKY-0829, 0832, 0833, 0843, 0844, 0845, 0850, 0871) bestehen weiter, wie vorgesehen. Production im selben Zeitraum bitgenau unveraendert (627 Zeilen, 24 Familien, 715 Journalzeilen). **Sequenzstand:** `931|true` — der Vorher-Wert liegt nicht vor (Preflight 134 ohne Recht, NOTICE A3 der Huelle nennt ihn nicht); da die Katalogzeilen vorher und nachher 658 sind und die Migration keine Datenanweisung enthaelt, hat der Lauf keine Nummer gezogen (die Spanne seit `929|true` nach 0167 stammt aus Anlagen vor dem Lauf). **Production: nicht angewendet** — erst nach einem Publish mit dem angepassten Executor und eigener Freigabe (ADR-0171).
| `0169_sales_reconciliation_schema.sql` | `460db9759c5debfedc9a2f04daee74dfcc8993426daf27c5430f95e99a5a75b0` | gleich | **2026-11-03**, Betreiber: manuell im SQL-Editor ueber den gemeinsamen Lauf `supabase/operations/staging-0169-0170-0171-0172-0173-0174.sql` (SHA-256 `810a3117ce0730424f4b02169515b90705606db794dab137cbb00cef225e0d2c`, bettet alle sechs Migrationen zeichengleich ein, eine Transaktion, committet in `6a39f03`). Vorher beide Sicherungen gezogen und geprueft (ausserhalb des Repositorys): Plattformsicherung Format 2, 54 Bereiche, `verify:platform-archive` bestanden; Betriebssicherung Format 1, 28 Bereiche, Struktur und Belegkette bestanden — drei Zaehlabweichungen gegen die feste Baseline vom 2026-10-16 (`purchases` 92/90, `purchase_items` 2137/2128, Summe), durch die Plattformsicherung bereichsgleich bestaetigt (24 von 24 gemeinsamen Bereichen gleich). Runner `npm run db:migrate:staging -- 0169`: Preflight **9999 = 0** (36 Zeilen, 6 offen: 121, 131, 133, 134, 135, 137), 106 `0`, 107/108 die Ruempfe aus 0140/0164, 109/110 die gemessenen ACLs; Baselines eingefroren in `supabase/baselines/baseline-0169.json`. Preflight als `postgres` vom Betreiber: **9998 = 0 und 9999 = 0**, 121 `0`, 131 `303|9785982d196cbeace5165af75d90977d`, 132 `1284|ae97c9d0563f8e00189896c5f87e736b`, 133 `41|624.41`, 134 `11`, 135 `0|0`, 136 `38`, 137 `2741`. `--resume`: Nachkontrolle **9999 = 0** (53 Zeilen, 6 offen: 207, 231, 233, 234, 235, 237). Ein erster Postflight als `postgres` mit der ROHEN Pruefdatei ergab `9999 = 18` — nur die Baselinezeilen, weil keine Baseline uebergeben war; ein Bedienfehler, kein Befund. Berechtigter Postflight `supabase/log/staging/0169-postflight-berechtigt.sql` (SHA-256 `252d37e293427d224e8b7cd1d8a165685be4c096b41f0741560071d645de378c`, `begin … rollback`) als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**, alle 40 bewerteten Zeilen `ok=true`; sieben Tabellen leer mit RLS, 22 Funktionen, 231–237 exakt wie Preflight 131–137, 241–246 (Ruempfe `3a798f50…`/`23be72d5…`, ACL unveraendert inkl. `service_role` auf der Betriebssicherung), Shop- und Sammlungsbaseline 801–833 vollstaendig gleich. `npm run db:privileges:staging`: Pruefzugang unveraendert (12 Tabellen, 3 Funktionen, Abdruck `13f9f823…`). **Production: nicht angewendet** (ADR-0174 Nr. 14). |
| `0170_external_sale_cancel.sql` | `e6df67521db93d923e788232659d50a13353421957e8d50f6207f33c69359075` | gleich | **2026-11-03**, im gemeinsamen Lauf mit `0169` — Nachweis siehe dort. |
| `0171_external_order_ref_per_channel.sql` | `646c37202015c5f9fdb9aaa997d785ed79a32b5655359b93a79513910beebd90` | gleich | **2026-11-03**, im gemeinsamen Lauf mit `0169` — Nachweis siehe dort. |
| `0172_sales_reconciliation_rpcs.sql` | `2d392b68b02c99c8627c74cf0732c2b9d7f3bf468f52824ccac49dd221c86b86` | gleich | **2026-11-03**, im gemeinsamen Lauf mit `0169` — Nachweis siehe dort. |
| `0173_sales_reconciliation_apply.sql` | `1273b7b5325a4c4eadbb4015951f03f87ed3e904669e13b6d5eb486970c3b056` | gleich | **2026-11-03**, im gemeinsamen Lauf mit `0169` — Nachweis siehe dort. |
| `0174_backup_sales_reconciliation.sql` | `1face70facd19910087f3378608d1839531547d1f4df2cce33e873e4787c575e` | gleich | **2026-11-03**, im gemeinsamen Lauf mit `0169` — Nachweis siehe dort. |
| `0175_sales_recon_account_deletion.sql` | `937e71e9c604698e918679865e407bda151eb239025497c61db1eb6ef58d0276` | gleich | **2026-11-03**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0175.sql` (SHA-256 `4309bf598d57d2617fed62fc7bc1c524240a25734dbc695672183af3d92a0202`, bettet die Migration zeichengleich ein, eine Transaktion, committet in `b052e2a`). Runner `npm run db:migrate:staging -- 0175`: Preflight `supabase/checks/0175_preflight.sql` (SHA-256 `d2ecf3035d1f104fab02cba9f1fc569e41588b496edc458fe9b798fdfa794af8`) **9999 = 0** (22 Zeilen, 3 offen: 131, 132, 133 — der Pruefzugang darf die Belegtabellen nicht lesen), 103 `aedd3c64…` (Rumpf aus 0169); Baselines eingefroren in `supabase/baselines/baseline-0175.json`, zeichengleich mit denen vor 0169–0174. Ein Preflight als `postgres` ist fuer diese Akte nicht uebermittelt; die Werte 131–133 belegt der berechtigte Postflight (unten). `--resume`: Nachkontrolle **9999 = 0** (33 Zeilen, 3 offen: 231, 232, 233). Ein erster Postflight als `postgres` mit der ROHEN Pruefdatei ergab `9999 = 18` — nur die Baselinezeilen, weil keine Baseline uebergeben war (die gemessenen Werte 819/829 stimmten mit dem Preflight); ein Bedienfehler, kein Befund. Berechtigter Postflight `supabase/log/staging/0175-postflight-berechtigt.sql` (SHA-256 `3520430738ba7b570a29e83f8807a80aced1ec4641b2f836f8adbd4ededd86d5`, `begin … rollback`) als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**, alle bewerteten Zeilen `ok=true`; 201 Rumpf `ee1027ee285c6a31163fa3f123c07c73`, 202–205 bestanden, 231 und 232 `0|(leer)`, 233 `0|0` (auf Staging gab es noch keine Abgleichsentscheidung), Shop- und Sammlungsbaseline 801–833 vollstaendig gleich. `npm run db:privileges:staging`: Pruefzugang unveraendert (12 Tabellen, 3 Funktionen, Abdruck `13f9f823…`). **Production: nicht angewendet** (ADR-0176). |
| `0176_sales_recon_validate_before_dedup.sql` | `bfef785243e0472761c52f72d949932b32feafc215027b588ea3a4e4a9fc2ac3` | gleich | **2026-11-03**, Betreiber: manuell im SQL-Editor ueber `supabase/operations/staging-0176.sql` (SHA-256 `658a289659dd9c9fa95159331080aa9e2748ae47c86f8e3256668ad27eedcfd8`, bettet die Migration zeichengleich ein, eine Transaktion, committet in `0664e6c`), Supabase meldete „Success“ ohne Fehler. Runner `npm run db:migrate:staging -- 0176`: Preflight `supabase/checks/0176_preflight.sql` (SHA-256 `e9d8dc66645838ca9456ce557b79bd52abf85077e766869be7fe573fb0caf5b9`) **9999 = 0** (23 Zeilen, 5 offen: 131–135 — der Pruefzugang darf die Abgleichstabellen nicht lesen); Baselines eingefroren in `supabase/baselines/baseline-0176.json`, zeichengleich mit denen von 0175. Preflight als `postgres` vom Betreiber: **9998 = 0 und 9999 = 0**; 131 `2|2768b73f8f79f807c3d4b1a1b922cfc0`, 132 `2|5a9f8299299624543780311c0c5450ae`, 133 `12|49fb93bf523af6ab5544b191e91c1d60`, 134 `12|9b77b3709ce69ea36acbd0a16f89c446`, 135 `24|5cd63838da73bdf73fbbed8c915b16af` (der Stand nach dem Funktionstest `mw12dxva`). `--resume`: Nachkontrolle **9999 = 0** (35 Zeilen, 5 offen: 231–235). Berechtigter Postflight `supabase/log/staging/0176-postflight-berechtigt.sql` (SHA-256 `d04bc5aea5206b616f62a1f8fb0d59d09d500b2d2f323154d7773060eb53f7bf`, `begin … rollback`) als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**; 201 `21fab5ff4ea2c7cb2550f3db821fce0f`, 202 `44441ee3b50a6bbf4f4fcbfda21d0e93`, 203 und 204 `true`, 205 `0`, 231–235 zeichengleich mit 131–135, Shop- und Sammlungsbaseline 801–833 vollstaendig gleich. `npm run db:privileges:staging`: Pruefzugang unveraendert (12 Tabellen, 3 Funktionen, Abdruck `13f9f823…`). **Funktionale Abnahme:** Gezielte Ablehnungsprobe `tools/verify-recon-refusals.mts`, Lauf `mw15zob3` (2026-11-03, als vorhandenes Betriebskonto, ohne Service-Role): **19/19** — `buyerName` und E-Mail-Adresse je als neuer und als bekannter Upload abgewiesen, keine verbotenen Inhalte gespeichert, die Sitzung durch die Ablehnungen unverändert, der gültige wiederholte Upload idempotent (dieselbe Sitzung), keine Entscheidung, keine Anwendung, kein Verkauf angelegt; Mini-Sitzung 3 über Testverkauf 362 im Abschlussschritt verworfen. Zustandsdatei `supabase/checks/verify_sales_reconciliation_state.sql` als `postgres` vorher und nachher: 101-108 zeichengleich, 201 `12`, 202 `0`, 203 `0|1|1` → `0|1|2` (einzige Änderung: die verworfene Mini-Sitzung), 204 `12`, 205 `6|5`, 206 `0`, 9998 `0`. **Production: nicht angewendet** (ADR-0177). |
| `0178_sales_recon_comparison_and_pending.sql` | `0a0278a708628af2122b306dd87a03419e0b222f222beab1914e516e99197643` | gleich | **2026-11-04**, Betreiber: manuell im SQL-Editor über `supabase/operations/staging-0178.sql` (SHA-256 `91ef2dbeffed20291a4b746953625ba44b139abe08a405f2c2e137bb851f2adc`, bettet die Migration zeichengleich ein, eine Transaktion, committet in `6f8c2c1`), Supabase meldete „Success“ ohne Fehler. Runner `npm run db:migrate:staging -- 0178`: Preflight `supabase/checks/0178_preflight.sql` (SHA-256 `f4ca024f7fca3d5abf816d658f4038e8d9f2de741001f0a3dd5f6f25d23d96a2`) **9999 = 0** (39 Zeilen, 11 offen: 131–137, 141, 143, 145, 146 — der Prüfzugang darf diese Tabellen nicht lesen); Baselines eingefroren in `supabase/baselines/baseline-0178.json` (SHA-256 `ab05e6e08e7f74e842446fc40f0c76e3d9ef6f37c1c73865c94111e5a69e79d2`). Preflight als `postgres` vom Betreiber: **9998 = 0 und 9999 = 0**; 131 `3|bf930e5a75f27fb8ad049b3088dfcc5c`, 132 `3|25a4edc8fd92f1730b234d751594d671`, 133 `13|7627af50aa9157d30e206081aac761d0`, 134 `13|46b8b6a091eb1b3f21791aeef68ff60e`, 135 `24|5cd63838da73bdf73fbbed8c915b16af` (zeichengleich mit 0176), 136 `12|26dc2a508294e1df6516339e37478bd1`, 137 `11|d712a101d7ab3242df5f62080467ef13`, 141 `315|6e9f9b5319651bacc34eda2f74ae7133`, 142 `1303|c234c880a0475259b4ebebc6277a0375`, 143 `42|1e44ee8cd000c517fb88ad767e236aec`, 144 `38|0e9c8e0b6e2f08f0e0534b7cb7f91cf6`, 145 `2741|e83d59a152942e4fda979021f74784d3`, 146 `19|ef347f2f486935f795c2c64321869bf6`, 151 `10ae0dd3359e52aa6f9ad922618411a8`, 152 `6b1de419eb568f90971d8677ce49c0d0`, 153 `3978d0fc1c1b46d497fba620c8f53cd2`. `--resume`: Nachkontrolle **9999 = 0** (54 Zeilen, 11 offen). Berechtigter Postflight `supabase/log/staging/0178-postflight-berechtigt.sql` (SHA-256 `4a07822c1118ca62ed33a4ca981ecc12b7cf5458d6d631a3a736bd93d13a6851`, `begin … rollback`) als `postgres`, vom Betreiber gefahren: **9998 = 0 und 9999 = 0**; 201 `d70ee33c2b740aa811704ad5e561a34e`, 202 `51213fd88afb5441a487dc89bba2ac06`, 203 `3228eb12e00d7982c5cad5c42ea6f773`, 204 `4c4a01eb05adb6d439450063f04eada9`, 205 `192dedca6ea258b54c6108ccbcd2d149`, 206 `4`, 207 und 208 `true`, 209 `0`, 211 `f8b1132c27ba1b18123f6c2548f9997c` (Apply unverändert), 212 `2526d3a77ccf3153158182d0ecd391aa` (Decide unverändert), 213 `44441ee3b50a6bbf4f4fcbfda21d0e93`, 214 `true`; 231–253 zeichengleich mit 131–153 (Abgleichstabellen, Verkäufe, Positionen, Erstattungen, Lagerbewegungen, Altbestand, Journal, Rechte, Policies — keine Zeile, kein Recht bewegt), Shop- und Sammlungsbaseline 801–833 vollständig gleich. **Vollständig verifiziert auf Staging.** **Production: nicht angewendet.** |

**Gelaufen ist der Einmal-Durchgang:** `supabase/operations/staging-0137-0138.sql`
(SHA-256 `83af5cebdcb9130a3b5cb0df17162bde94505aee5d8d83d3c454675fa48b9344`) bettet `0137` und `0138` **zeichengleich** ein — geprüft von
`src/lib/catalog/staging-oneshot.test.ts` — und legt eine Transaktion samt
blockierender Vor- und Nachprüfungen darum. Klickfolge, Abnahmeraster und
Rücknahme: `supabase/checks/0137_0138_staging_run.md`.

Der lokale Probelauf fährt beide Migrationen, beide Rücknahmen **und dieses
Skript** gegen echtes PostgreSQL (`npm run verify:check-sql`, Durchgänge
**P22–P30**) — was eine bestandene Planprüfung **nicht** ist, steht in
`supabase/checks/open_verifications.md`, Abschnitt 3a.

### Die berechtigten Nachkontrollen zu `0147`–`0149` (2026-10-26) — gefahren, vier erklärte Abweichungen

Alle drei liefen als `postgres` im SQL-Editor von `qqxcpesbwfxzgytkdsac`, aus
`supabase/log/staging/01??-postflight-berechtigt.sql`, in `begin … rollback`.
**`9998 = 0` in allen drei** — keine Zeile war unlesbar, der berechtigte Lauf
hat also getan, wofür er da ist. Damit sind die drei zuvor hier als offen
geführten Nachweise erbracht.

| Datei | 9998 | 9999 | davon erklärt |
|---|---|---|---|
| `0147_offer_availability.sql` | 0 | **4** | die vier Basiszeilen 811 / 812 / 815 / 817 |
| `0148_availability_notifications.sql` | 0 | **6** | dieselben vier plus zwei Anachronismen (siehe unten) |
| `0149_notification_read_state.sql` | 0 | **4** | dieselben vier; **Zeile 104 bestanden** |

**Die vier gemeinsamen Abweichungen haben genau eine Ursache: die Einbuchung
von Blue Bash (`SKY-0009`) am 2026-10-26 um 11:53:24.** Sie hat eine **neue**
Lagerposition angelegt (ADR-0145), und daraus folgt zwingend und vollständig:

| Vertragsfeld (`skyisles-base-1`) | eingefroren | gemessen | warum |
|---|---|---|---|
| `angebote` | 256 | **257** | die neue Position ist gelistet und bepreist, erscheint also in `shop_offers()` |
| `angebote_md5` | `4d1d6c30…` | geändert | md5 über `sky_id`, `condition` und `price` **jeder** Angebotszeile |
| `lagerzeilen` | 286 | **287** | `count(*) from shop_inventory`, eine Zeile mehr |
| `lager_md5` | `3821eb4f…` | geändert | md5 über `id`, `is_listed`, `sale_price` und `sale_released` je Lagerzeile |

**Die Zeitfolge passt:** `0149` lief von 11:43:50 bis 11:44:34, die Baselines
wurden davor eingefroren (ADR-0137), die Einbuchung kam neun Minuten später.
Eine Nachkontrolle, die heute gegen diese Baselines läuft, **muss** diese vier
Abweichungen zeigen.

**Drei Gegenproben, die die Deutung tragen** — ohne sie wäre sie geraten:

1. **`shopfaehig` ist unverändert bei 534.** Wäre Blue Bash neu aktiviert oder
   katalogsichtbar gemacht worden, hätte sich dieses Feld mitbewegt. Die Figur
   war längst shopfähig, ihr fehlte nur eine Lagerposition.
2. **`katalogzeilen` ist unverändert bei 626.** Am Katalog wurde nichts
   angelegt, gelöscht oder importiert.
3. **Cynder (`SKY-0020`) ist in diesem Vertrag unsichtbar, und das erklärt,
   warum es genau vier sind.** `lager_md5` hasht `id`, `is_listed`,
   `sale_price` und `sale_released` — **nicht `quantity`**. Ihre Buchung von
   fünf auf sechs ändert kein Feld. Eine fünfte Abweichung wäre ein Befund
   gegen diese Deutung gewesen.

**Die zwei zusätzlichen Zeilen bei `0148`** — sechs statt fünf Spalten in
`availability_notifications`, `read_at` bereits vorhanden — sind **kein
Mangel, sondern ein Anachronismus**: `0148_postflight.sql` behauptet den
Zustand **unmittelbar nach `0148`**, und `0149` hat `read_at` danach
hinzugefügt. Eine angewendete Prüfdatei wird nach Regel 1 nicht geändert.
Umgekehrt gelesen sind diese zwei Zeilen der **Beweis, dass `0149` korrekt
angewendet wurde**.

**Die Baselines bleiben eingefroren.** Sie neu zu erheben würde ihren Zweck
zerstören (ADR-0137); eine erklärte Abweichung ist etwas anderes als eine
unerklärte. Der Sammlungsvertrag `skyisles-coll-1` wies keine Abweichung aus
— `favorites` und `collection_items` sind unberührt.


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

### Die Production-Laeufe vom 2026-10-28 bis 2026-10-30 (`0144`-`0149`, `0152`-`0158`)

**Quelle dieser Zeilen ist die Meldung des Betreibers nach jedem Lauf**, nicht
ein Protokoll, das dieses Repository selbst geschrieben haette: der
Pruefzugang hat keinen Production-Modus (`tools/lib/staging-db.mts` bricht ab,
bevor eine Verbindung entsteht), und der SQL-Editor schreibt keine Datei. Was
hier steht, ist deshalb genau das, was gemeldet wurde, und nicht mehr.

| Lauf | gefahren ueber | gemeldetes Ergebnis |
|---|---|---|
| `0144` | `supabase/operations/prod-0144.sql` | Postflight `9998 = 0`, `9999 = 0` |
| `0145` | `supabase/operations/prod-0145.sql` | Postflight `9998 = 0`, `9999 = 0` |
| `0146` | `supabase/operations/prod-0146.sql` | Postflight `9998 = 0`, `9999 = 0` |
| `0147` | `supabase/operations/prod-0147.sql` | erfolgreich angewendet |
| `0148` | `supabase/operations/prod-0148.sql` | erfolgreich abgeschlossen |
| `0149` | `supabase/operations/prod-0149.sql` (Gruppe **G1**, erste selbstmessende Huelle) | erfolgreich abgeschlossen |
| `0152`-`0158` | `supabase/operations/prod-g2-0152-0158.sql` (Gruppe **G2'**, EINE Transaktion, SHA-256 `8abb3572a953609cee02cec2ea23cd260714f46ec5f7fe919d1ea06d6ac2162c`) | Preflight `9998 = 0`, `9999 = 0`; Nachkontrolle `9998 = 0`, `9999 = 0` |

**Warum `0152`-`0158` zusammen liefen:** `0152` laesst den Journaltrigger
`catalog_status` schreiben, nimmt den Namen aber nicht in
`catalog_admin_changes_field_known` auf; `0157` tut es, `0158` fuegt den
elften Wert hinzu. Zwischen den beiden scheitert JEDER Statuswechsel mit
`23514`, die deployte `admin_set_catalog_visible` eingeschlossen. ADR-0161
haelt die Entscheidung fest, die sieben als eine Transaktion zu fahren.

**Der gemessene Production-Stand nach G2' (2026-10-29/30, vom Betreiber
gemeldet):** 624 Katalogzeilen, davon **571 oeffentlich** und **53
versteckt**, 217 Journalzeilen, 6 Konten mit Sammlung. Die beiden
Geschaeftsvertraege sind durch ihre Schutzsummen bezeichnet
(`skyisles-base-1` ... `20b3f93c2e68` und `skyisles-coll-1` ...
`9b0bb70dc52d`); **die vollstaendigen Zeilen stehen NICHT in diesem
Repository**, weil sie Lagerzahlen und Angebotsabdruecke tragen (CLAUDE.md,
Regel 3). Wer sie braucht, erzeugt sie mit dem Preflight neu.

**Die Zahlen 500/124 aus aelteren Notizen sind KEIN Production-Stand.** Sie
stammen aus dem Testaufbau in PGlite, der 624 erfundene Zeilen anlegt und
jede fuenfte unsichtbar setzt (`g % 5 <> 0`) — also genau 500 sichtbar und
124 unsichtbar. Gemessen wurde auf Production **571/53**. Es gibt hier also
keine unerklaerte Abweichung, sondern eine Testkonstante, die wie ein Befund
gelesen wurde.

**Zwei offene Punkte, die aus diesen Laeufen folgen und nicht verschwiegen
werden:**

1. **Die Plattformsicherung fuehrt `favorites`, `offer_state` und
   `availability_notifications` nicht.** `0145`-`0149` liefen vor der
   Folgemigration, die sie aufnimmt (ADR-0136, D-6, Formatversion 3). Eine
   Wiederherstellung aus `system_platform_export()` verlore diese Daten. Die
   Migration dafuer existiert noch nicht.

   **Nachtrag 2026-10-30: sie bekommt NICHT `0165`.** Diese Nummer traegt
   jetzt `0165_system_sync_create_figure.sql` (der Systemweg fuer die
   Figurenanlage mit vorgegebener SKY-ID, Katalogabgleich). Der Grund ist
   nicht Vorrang, sondern eine Regel dieses Projekts: vier Testdateien
   sichern `numbers === [1 … n]` zu — `create-order.test.ts`,
   `payment-bootstrap.test.ts`, `payment.test.ts` und
   `purchase-sender-listing.test.ts`. Eine reservierte, aber nicht
   geschriebene Nummer waere eine Luecke, und eine Luecke bricht die Suite.
   Reserviert wird in diesem Projekt also nicht durch Freihalten, sondern
   durch Hinschreiben — die Sicherungserweiterung bekommt die naechste freie
   Nummer, wenn sie geschrieben wird.
2. **Dieses Repository hat kein eigenes Protokoll dieser Laeufe.** Ein
   Production-Lauf laeuft im SQL-Editor; das Ergebnisblatt liegt beim
   Betreiber. Solange das so ist, bleibt diese Akte eine Mitschrift und kein
   Nachweis — und das ist eine bewusste Grenze, keine Luecke, die ein
   Werkzeug schliessen koennte, ohne dem Pruefzugang Schreibrechte zu geben.

### Der Production-Stand von `0159`–`0165`, am 2026-10-30 GEMESSEN

Der Widerspruch, der hier zwischenzeitlich stand, ist aufgelöst. Der Betreiber
hat **`supabase/checks/prod_0159_0165_state.sql`** im Production-SQL-Editor als
`postgres` ausgeführt; das Ergebnisblatt ist der Nachweis.

**Zwei Arten von Nachweis, und sie werden hier nicht vermischt:**

| | |
|---|---|
| **Funktions- und Schemanachweis** | Was in der Datenbank an Objekten STEHT — Spalten, Constraints, Trigger, Rumpfabdrücke, Rechte, und bei `0163` zusätzlich die Erstbelegung in den Daten. Das ist für `0159`–`0164` **belegt**. |
| **Ausführungsprotokoll** | WANN, WOMIT und mit welchem Ergebnisblatt ein Lauf stattgefunden hat. Das ist für `0159`–`0164` auf Production **nicht vorhanden** und auch nicht mehr herstellbar. |

Der Schemanachweis sagt, dass der Zustand erreicht ist. Er sagt nicht, über
welche Datei, in welcher Reihenfolge und mit welchem Postflight. Diese Lücke
bleibt offen stehen, statt sie zu erfinden.

| Migration | Urteil (gemessen) | woran |
|---|---|---|
| `0159` | **ANGEWENDET** | `base_sky_id`, `skylanders_base_same_series`, `admin_set_variant_base`, `admin_publish_with_base` |
| `0160` | **ANGEWENDET** | im Rumpfabdruck von `0164` enthalten |
| `0161` | **ANGEWENDET** | `admin_publish_variant_auto` |
| `0162` | **ANGEWENDET** | `admin_set_market_price`, `admin_delete_figure` |
| `0163` | **ANGEWENDET** | drei Spalten, Trigger `skylanders_canonical_types`, zwei RPCs, **und die Erstbelegung**: 418 Zeilen mit Typmenge, 171 mit entschiedenem Banner |
| `0164` | **ANGEWENDET** | `system_platform_export` trägt `7e9e58e2d84a9f8a7c660262aa21926b` — das ist der Rumpf aus `0164` (aus der Migrationsdatei nachgerechnet; `0160` wäre `ff4f38e6…`) |
| **`0165`** | **FEHLT** | `system_sync_create_figure`: **0 Fassungen** |

**Zwei Befunde daneben, beide neu und beide offen:**

* **`system_set_image_override` (0035) fehlt auf Production — 0 Fassungen.**
  Keine Migration löscht sie; `0035` ist dort also nie angewendet worden. Der
  Katalogabgleich plant **7 Bildschritte** über diese Funktion. Sie haben
  derzeit keinen Weg. Eigene Klärung, eigene Freigabe.
* **Die SKY-ID-Sequenz steht auf `821|true`**, unbegrenzt (`1` ..
  `9223372036854775807`, NO CYCLE). Der **nächste Zug wäre `SKY-0822`** — die
  erste der 33 Nummern, die der Abgleich dort anlegen soll. Das
  Production-Band `5001`–`8999` ist leer und nicht gesperrt.

**Gemessener Bestand auf Production (2026-10-30):** 624 Katalogzeilen, 217
Journalzeilen, 340 Lagerzeilen, 622 Sammlungszeilen, 36 Kategorien. Ein
Plattformadmin. Die vier Klasse-B-RPCs liegen (1/1/1/1). Der Importbereich
`SKY-0822`–`SKY-0928` ist in Tabelle **und** Journal frei.

### `0035` auf Production — angewendet und durch Preflight/Postflight belegt (2026-10-31)

| | |
|---|---|
| Weg | `supabase/operations/prod-0035.sql`, manuell im SQL-Editor als `postgres`, eine Transaktion |
| Eingebettet | `0035_system_set_image_override.sql`, **zeichengleich** — von `src/lib/catalog/sync-blocker.test.ts` gemessen |
| Preflight | `supabase/checks/prod_0035_preflight.sql`, `9999 = 0` |
| Nachkontrolle | `supabase/checks/prod_0035_postflight.sql`, **`9998 = 0`, `9999 = 0`** |
| Rücknahme | `supabase/rollback/R0035_drop_system_set_image_override.sql` — verwirft keine Daten |

**Bestätigt:** `system_set_image_override(text, text)` genau einmal,
`SECURITY DEFINER`, leerer `search_path`, **Rumpfabdruck
`f269a6fe05349cad53c0cf44a8e01e11`** — derselbe Wert, den der Rumpf aus der
Migrationsdatei ergibt (889 Zeichen), Production führt also zeichengleich die
freigegebene Fassung. EXECUTE ausschließlich `postgres` und `service_role`.
Bestand unverändert: 624 Katalog · 217 Journal · 340 Lager · 622 Sammlungen ·
51 Bildverweise, Abdruck `e6dfa5729833703f5173df77c4b3b8db`.

**Wozu:** die 7 Bildschritte des Katalogabgleichs nach Production laufen über
diese Funktion. Vorher hatten sie dort keinen Weg.

### Über die Vergangenheit von `0035` auf Production wird nichts behauptet

**Es ist nicht nachweisbar, ob `0035` dort früher schon einmal gelaufen ist.**
Der Grund steht in der Migration selbst: sie legt **genau ein Objekt** an —
diese Funktion. Es gibt kein zweites, an dem sich die Migration erkennen
ließe, und keine spätere Migration löscht, ersetzt oder benennt sie um (alle
Migrationen am 2026-10-30 durchsucht; ein Test hält beides fest).

Was die Forensik hergab, und was nicht:

* Production führte vor dem Lauf **59 Journalzeilen** zu
  `image_override_path`, davon **6 mit `changed_by = NULL`**. NULL heißt nach
  `0004` „über die Service-Rolle **oder** nach dem Löschen des Kontos" — ein
  serverseitiger Weg hat dort geschrieben, **welcher**, sagt die Zeile nicht.
  Ein direktes `update` der Service-Rolle sieht genauso aus.
* Das einzige Werkzeug, das die Funktion aufruft
  (`tools/sync-image-overrides.mts`), ist mit `SKYISLES_REQUIRE_STAGING=1` auf
  Staging festgenagelt.
* `admin_set_image_override` lag auf beiden Seiten; nur der serverseitige Weg
  fehlte.

**Belegt ist der Zustand ab dem 2026-10-31**, nicht die Geschichte davor. Die
Lücke bleibt offen stehen — wie bei `0159`–`0164`, nur aus einem anderen
Grund: dort fehlt das Protokoll, hier fehlt jedes messbare Objekt, an dem ein
Protokoll hängen könnte.

### SKY-ID-Bereichssperre auf Production — angewendet und verifiziert (2026-10-30)

**Ein Betriebsvorgang, keine Migration.** Sie ändert kein Schema und keine
Zeile, sondern die **Vergabe**.

| | |
|---|---|
| Vorgang | `supabase/operations/production-sky-id-band.sql`, manuell im SQL-Editor als `postgres`, eine Transaktion |
| Wirksame Anweisung | **eine**: `alter sequence public.sky_id_seq minvalue 5001 maxvalue 8999 no cycle start with 5001 restart with 5001` |
| Preflight | `supabase/checks/prod_sky_id_band_preflight.sql`, `9999 = 0` |
| Nachkontrolle | `supabase/checks/prod_sky_id_band_postflight.sql`, **`9998 = 0`, `9999 = 0`** |
| Rücknahme | `supabase/rollback/R_production_sky_id_band.sql` — **verweigert nach jeder Vergabe**, auf zwei Wegen |

**Bestätigt:** `MINVALUE 5001`, `MAXVALUE 8999`, `NO CYCLE`, `START 5001`,
`last_value = 5001` mit **`is_called = false`** — der nächste Zug ist
`SKY-5001` **selbst**, und es ist seit der Umstellung keine Nummer gezogen
worden. Importbereich `SKY-0822`–`SKY-0928` frei. Bestand unverändert: 624
Katalog · 217 Journal · 340 Lager · 622 Sammlungen · 95 Favoriten · 0
Warenkörbe · 2 Bestellpositionen, Katalogabdruck
`95bbbb51bd6ca2fd9d0be184b22bfda4`.

**Warum sie vor dem Figurenimport liegen musste:** vorher stand die Sequenz
auf `821|true`, der nächste Zug wäre **`SKY-0822`** gewesen — die erste der
33 Importnummern. Eine gewöhnliche Figurenanlage über `admin_create_figure`
hätte sie gezogen und dem Abgleich weggenommen. Jetzt vergibt sie ab `5001`,
und der Importbereich ist strukturell geschützt.

**Der Importbereich liegt UNTER dem Band — und das ist kein Widerspruch.** Ein
Band regelt die **Vergabe**, nicht die **Speicherung**;
`system_sync_create_figure` (0165) bekommt die SKY-ID als Parameter und zieht
die Sequenz nicht. Deshalb trägt `skylanders.sky_id` bewusst **keine**
CHECK-Constraint auf ein Band; Nachkontrolle 221/222 prüft, dass auch keine
dazugekommen ist.

### Drei Dinge, die an dieser Datei vor dem Lauf korrigiert wurden

* **Der Umgebungswächter A1** erkannte Production an ZEILEN: „`SKY-0821`
  steht, `SKY-0822` steht nicht". Der Abgleich legt `SKY-0822` dort an — der
  Stempel hätte sich durch den eigenen Sync zerstört. Ersetzt durch zwei
  POSITIVE Nachweise am Schema: `0133` mit **beiden** Objekten
  (Triggerfunktion *und* Trigger, nur auf Production) und „die Sequenz trägt
  nicht das Staging-Band". Beides überlebt jeden Zeilenimport. Dieselbe
  latente Falle steckte noch in `prod-0165.sql` (A3b) und ist dort ebenfalls
  entfernt.
* **Das Zeitfenster zwischen A4 und der Anweisung.** Dort hält niemand die
  Sequenz; eine gleichzeitige Figurenanlage hätte `SKY-0822` ziehen können,
  und an der Sequenz wäre das hinterher nicht mehr zu sehen gewesen, weil
  `restart` den Stand überschreibt. A5 legt jetzt Katalog-, Journal-, Lager-
  und Sammlungszahlen **und die höchste SKY-ID** ab; **B1–B4** halten sie
  danach dagegen. Dazu `lock_timeout = '5s'`.
* **Das Transaktionsverhalten wurde gemessen statt angenommen.** Die
  verbreitete Annahme lautet, `RESTART` sei wie `setval` nicht transaktional.
  An echtem PostgreSQL mit genau dieser Anweisung nachgemessen: nach
  `rollback` **und** nach einem Fehler steht alles wieder auf `821|true`,
  Grenzen unverändert. **`ALTER SEQUENCE … RESTART` ist vollständig
  transaktional** — ein Abbruch lässt nichts Halbes zurück. Für `setval()`
  gilt das nicht; deshalb benutzt die Datei es nicht.

### `0165` auf Production — angewendet und durch den vollständigen Postflight belegt (2026-10-30)

**Die erste Production-Migration dieser Arbeitsreihe mit lückenlosem
Nachweis**, und damit der Gegenentwurf zu `0159`–`0164`.

| | |
|---|---|
| Weg | `supabase/operations/prod-0165.sql`, manuell im SQL-Editor als `postgres`, eine Transaktion |
| Eingebettet | `0165_system_sync_create_figure.sql`, **zeichengleich** — von `src/lib/catalog/prod-0165-hull.test.ts` gemessen |
| Preflight | `supabase/checks/prod_0165_preflight.sql`, `9998 = 0`, `9999 = 0`, Baseline Zeile 900 |
| Nachkontrolle | `supabase/checks/prod_0165_postflight.sql`, **`9998 = 0`, `9999 = 0`** |

**Der konkrete Nachweis, Stück für Stück:**

| | |
|---|---|
| Funktion | `system_sync_create_figure` **genau einmal**, erwartete Signatur |
| Autorisierung | `SECURITY DEFINER`, `search_path` explizit leer; EXECUTE **ausschließlich** `postgres` und `service_role` — `anon`, `authenticated` und **PUBLIC** haben keines |
| **Rumpfabdruck** | **`6a0383c5c4da7fec3cdd6a39041c3069`** — identisch mit dem Rumpf aus der Migrationsdatei im Repository (4232 Zeichen, nachgerechnet). Production führt also zeichengleich die freigegebene Fassung |
| nicht aufgerufen | keine Figur im Importbereich `SKY-0822`–`SKY-0928` |
| nichts bewegt | Katalog 624, Journal 217, Lager 340, Sammlungen 622, Favoriten 95, Warenkörbe 0, Bestellpositionen 2 — alle gegen die Preflight-Baseline; Katalogabdruck unverändert `95bbbb51bd6ca2fd9d0be184b22bfda4` |
| Sequenz | unberührt: `1 .. 9223372036854775807`, NO CYCLE, Stand `821\|true` |

**Die Abgrenzung zu `0159`–`0164`, und sie ist der Punkt:**

| | `0159`–`0164` | **`0165`** |
|---|---|---|
| Funktions- und Schemanachweis | ja, am 2026-10-30 nachgemessen | ja |
| **Ausführungsprotokoll** | **nein** — wann, womit, mit welchem Ergebnisblatt ist nicht festgehalten und nicht mehr herstellbar | **ja** — benannte Hülle, Preflight mit Baseline, Postflight mit `9999 = 0` |
| Rumpf gegen das Repository geprüft | nur für `system_platform_export` (`7e9e58e2…`) | ja, `6a0383c5…` |
| Vorher/Nachher-Vergleich des Bestands | nein | ja, Feld für Feld gegen die Baseline |

Bei `0159`–`0164` ist belegt, **dass** der Zustand erreicht ist. Bei `0165`
ist zusätzlich belegt, **wie** er erreicht wurde und **dass sonst nichts
passiert ist**. Diese Lücke in der Historie bleibt stehen; sie wird nicht
nachträglich gefüllt.

**Drei Korrekturen am Weg dorthin, alle an meinen Prüfdateien und keine an
der Migration:**

* Der erste Postflight meldete `9999 = 3`. Zeile 204 erwartete einen leeren
  `search_path` als leere Zeichenkette — PostgreSQL legt ihn **quotiert** als
  `search_path=""` ab. `""` war richtig, die Erwartung falsch. Dieselbe Falle
  hat `staging-0137.sql` am 2026-10-20 abbrechen lassen; `0165` selbst macht
  es richtig, und der Ausdruck ist von dort übernommen.
* Die Baseline war per `set_config(…, true)` verlangt — **transaktionslokal**,
  im SQL-Editor also zwischen zwei Ausführungen unerreichbar. Sie steht
  jetzt als Literal in der Prüfdatei. **Regel ab sofort für jedes
  Preflight/Postflight-Paar dieses Projekts.**
* `9999 = 3` war zu **klein**: ohne Baseline waren sieben Erwartungen NULL,
  und diese Zeilen gaben gar kein Urteil ab. Jede Erwartung ist jetzt mit
  `coalesce(…, '(BASELINE FEHLT)')` gesichert — aus Schweigen wird ein
  Fehlschlag.

### `0167` auf Production — angewendet und belegt (P-1, 2026-11-01)

Grabstein `catalog_removed_sky_ids`, Anlage-Riegel und `system_remove_ovp_figure`
(ADR-0166). **Entfernt wurde nichts** — die Entfernung ist P-2 mit eigener Freigabe.

| | |
|---|---|
| Weg | `supabase/operations/prod-0167.sql` (SHA-256 `88ff7b1ef027fd16eef45d14dc0cee42b14f6e178ec23a31fc5674962302aab9`), manuell im SQL-Editor als `postgres`, eine Transaktion |
| Eingebettet | `0167_ovp_removal.sql` (`9f1fad86…`), **zeichengleich** dieselbe Fassung wie auf Staging — gemessen von `src/lib/catalog/ovp-removal-0167.test.ts` |
| Preflight | `supabase/checks/prod_0167_preflight.sql` (`8c37c336…`), `9999 = 0`, Zeile 900: `skyisles-p0167-1\|657\|685\|348\|629\|88\|0\|2\|614\|cbfd242815d96ff227ffa6605cf729ce\|5bbcbd3c8178` (Schutzsumme nachgerechnet: stimmt) |
| Erste Nachkontrolle | `prod_0167_postflight.sql` — `9999 = 4`, **nur 801–804**: die Baseline kam nicht an. Ursache: `set_config(…, true)` gilt bis zum Ende der Transaktion, und der SQL-Editor führte `set_config` und Prüfung ohne `begin` in zwei Transaktionen aus. Ein Fehler der Anleitung, nicht der Migration. Zeile 809 (heutiger Stand) war zeichengleich Zeile 900 |
| Zweite Nachkontrolle | `supabase/operations/prod-s-postflight-0167.sql` (`c0cd0765…`): `begin; set transaction read only;`, Production-Riegel, Baseline **unverändert** in derselben Transaktion gesetzt und geprüft, die Prüfdatei zeichengleich eingebettet, `rollback`. Ergebnis: 801–803 bestanden, Grabstein leer, die 30 stehen, alle Schutzprüfungen bestanden; **804 weicht ab — erklärt, siehe unten** |
| Rein lesend nachgemessen (2026-11-01, Service-Schlüssel) | 30 OVP-Zeilen exakt vorhanden, **0 Verweise** auf allen 14 Pfaden; Grabstein liegt, **0 Zeilen**; Journal **685** wie in der Baseline; Katalog **657**; keine Zeile im Production-Vergabeband `SKY-5001`–`SKY-8999`, höchste SKY-ID `SKY-0928` |
| Sequenz | **`5001\|false`** laut Betreiber (Production-SQL-Editor). Vom Prüfwerkzeug nicht lesbar; damit vereinbar: keine Zeile im Band, also keine Nummer gezogen |

**Die Abweichung in Zeile 804 — vom Betreiber erklärt (2026-11-01).** Zeile
804 vergleicht neun Bestandszahlen mit der Baseline. Abgewichen sind genau
zwei, beide Nutzerdaten:

| Feld | Baseline | beim Postflight |
|---|---:|---:|
| Sammlungszeilen | 629 | 632 (+3) |
| Favoriten | 88 | 129 (+41) |

**Betreiberbestätigung:** der Betreiber hat im Prüfzeitraum selbst seine
private Sammlung erweitert und Figuren als Favoriten markiert. `0167` enthält
keine schreibende Anweisung an `collection_items` oder `favorites` (die
Funktion zählt dort nur, und angewendet wurde sie nicht). Alle übrigen sieben Felder — Katalog, Journal, Lager,
Warenkörbe, Bestellzeilen, Importprotokolle, Katalogabdruck — stimmen. Die
Baseline wurde **nicht** verändert.

Beim lesenden Nachmessen danach standen weitere Bewegungen außerhalb von
`0167` (Sammlungen 634, Favoriten 149, Lagerbewegungen 750, Einkaufspositionen
2 487) — laufender Betrieb; `0167` schreibt keine dieser Tabellen.

**Der SQL-Editor zeigt keine `NOTICE`-Meldungen** (so schon in
`prod-s-postflight-g5.sql` festgehalten). Das erklärt auch, warum A3/`C ok`
der Staging-Entfernung nie vorlagen. Belege kommen deshalb aus
Ergebnistabellen: Preflight, Nachkontrolle, `ovp_removal_postflight.sql`.

**Rücknahme:** `supabase/rollback/R0167_drop_ovp_removal.sql` — nur solange kein
Grabstein steht.

### Die 30 OVP-Duplikate auf Production entfernt (P-2, 2026-11-01)

**Ein Betriebsvorgang über `0167`, keine Migration.** Alle 30 SKY-IDs aus
`data/catalog/ovp-removal.json` sind aus `skylanders` entfernt und **dauerhaft
gesperrt** (`catalog_removed_sky_ids`, Anlage-Riegel `skylanders_refuse_removed_trg`).

| | |
|---|---|
| Vorher, rein lesend bestätigt | Ziel `zmiwxswrpkmizvqsgype`; die 30 exakt nach Liste, versteckt, ohne Variante; **0 Verweise** auf allen 14 Pfaden (Sammlungen, Favoriten, Warenkörbe, Bestellzeilen, Einkauf, Verkauf, Lager, Importprotokolle, …); die 16 regulären Figuren öffentlich und in allen geregelten Feldern gleich Staging; Katalog 657, Journal 685, Grabstein leer. Der Rückgang der Einkaufspositionen 2 489 → 2 487 betraf keine der 30 (dort 0 Verweise, auch schon am 2026-10-31) |
| Weg | `supabase/operations/prod-ovp-removal.sql` (SHA-256 `dcd3bb5f4e39549edc27c2874b21a985dbfcb78a9402b84c99bb5719ce6a403f`), manuell im SQL-Editor als `postgres`, **eine** Transaktion, Supabase „Success" |
| Berechtigte Nachkontrolle | `supabase/checks/ovp_removal_postflight.sql`, vom Betreiber gefahren: 101 = `0` · 102 = `30` · 103 = `30` · 104 = `1` · 105 = `30` · 106 = `16` · 107 = `0` · 108 = `0` · **201 = `5001\|false`** · **9998 = `0`, 9999 = `0`** |
| Danach rein lesend | Katalog **627** (657 − 30), Journal **715** (685 + 30), Grabsteine **30**; keine Lagerposition, kein Importprotokoll betroffen; Sequenz unverändert gegenüber P-1 (`5001\|false`) |

Die NOTICE-Zeilen der Hülle (A3/B/`C ok`) zeigt der SQL-Editor nicht an; der
Beleg ist die Ergebnistabelle der Nachkontrolle.

### `0166` auf Production — bewusst NICHT angewendet (Entscheidung 2026-11-01, ADR-0167)

**Entschieden:** `0166` wird auf Production nicht angewendet. Die Dateien unten
sind ein geprüftes Archiv, kein ausstehender Schritt.

| | |
|---|---|
| Preflight | `supabase/checks/prod_0166_preflight.sql` — Production-Riegel, 0166 fehlt, die vier Schreibwege und `is_platform_admin` liegen, Spalten/Riegel/Journalwerte aus 0152/0159/0163, Rechte; Baseline Zeile 900 (Katalog, Journal, Lager, Bestellzeilen, Katalogabdruck MIT Variantenbeziehung, Types und Banner) — Sammlungen und Favoriten nur als Auskunft |
| Lauf | `supabase/operations/prod-0166.sql` — Production-Riegel wie `prod-0167.sql` plus Datenbankstempel, eigene Vorbedingungen A5a–A5i, Ablage A6, Migration zeichengleich eingebettet, Nachbedingungen B1–B6 in derselben Transaktion; ein zweiter Lauf bricht an A5a ab |
| Nachkontrolle | `supabase/operations/prod-s-postflight-0166.sql` — `begin; set transaction read only;` … `rollback;`, Baseline in derselben Transaktion (Platzhalter `BASIS-HIER-EINSETZEN`), eingebettet `supabase/checks/prod_0166_postflight.sql` |
| Lesend vorgeprüft (PostgREST-Beschreibung, Service-Schlüssel) | `admin_create_variant_figure` **fehlt**; `admin_create_figure`, `admin_set_variant_base`, `admin_set_figure_types`, `admin_set_visible_type`, `is_platform_admin` liegen mit den erwarteten Parametern; die fünf Spalten liegen |
| Nachweis | `src/lib/catalog/variant-create-0166.test.ts` — Preflight → Lauf → Nachkontrolle an echtem PostgreSQL mit den wörtlichen Rümpfen: `9999 = 0`, `9998 = 0`, nichts bewegt; Sammlungen/Favoriten im Betrieb schlagen nicht an; Platzhalter bricht ab; fehlender Schreibweg bricht ab; Staging bricht ab; zweiter Lauf bricht ab |

**Architekturfrage — entschieden in ADR-0167:** Katalogpflege findet auf Staging statt.
Eine über den Production-Admin angelegte Figur wäre eine Zeile, die nur
Production führt — der Driftriegel des Publish meldet sie als `nur_production`
und hält jeden weiteren Publish an. Das gilt heute schon für `admin_create_figure`;
`0166` fügt einen zweiten solchen Weg hinzu. Der Publish selbst braucht `0166`
nicht (er ruft die vier Schreibwege einzeln).
Entscheidung: Staging bleibt die einzige redaktionelle Quelle; die direkte
Katalogschreibsperre auf Production ist Folgeaufgabe CAT-13.

### `G3'`, `G4'` und `G5'` sind aus der Ausführungsplanung GESTRICHEN

**Sie werden nicht mehr gefahren.** Der Zustand, den sie herstellen sollten,
ist auf Production erreicht; ihre Vorbedingungen verlangen das Gegenteil
(`prod-s-preflight-g3.sql` Zeile 111 und 115 verlangen, dass `base_sky_id` und
`admin_set_variant_base` FEHLEN, die Hülle bricht an `ABBRUCH A6a` ab). Ein
Lauf wäre gegenstandslos.

**Die Dateien bleiben liegen** — `prod-g3-0159.sql`, `prod-g4-0160-0162.sql`,
`prod-g5-0163-0164.sql` samt ihrer sechs Prüfdateien. Sie sind die einzige
Beschreibung dessen, was die Objekte dort herstellen, und ihre Wächter
dokumentieren die Vorbedingungen. Gelöscht wird nichts; sie sind ab jetzt
**Archiv, nicht Plan**.

### Archiv: die Dateien zu `0159` (Gruppe **G3'**)

Drei Dateien liegen fertig und sind lokal geprueft:
`supabase/operations/prod-s-preflight-g3.sql` (rein lesend),
`supabase/operations/prod-g3-0159.sql` (eine Transaktion) und
`supabase/operations/prod-s-postflight-g3.sql` (rein lesend). Die Entscheidung
und die Risiken stehen in ADR-0162.

**Sie werden nicht gefahren** — siehe den Abschnitt oben. `0159` ist auf
Production gemessen ANGEWENDET; diese Dateien verlangen in ihren
Vorbedingungen, dass die Objekte fehlen.

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

**`0159` stand hier bis zum 2026-10-28** — seit dem Lauf auf Staging steht sie in der Tabelle oben, mit ihrer Pruefsumme und dem berechtigten Nachweis. Damit nennt diese Liste nur noch `0134`, `0150` und `0151`.

**`0162`, `0163` und `0164` standen hier bis zum 2026-10-29** — seit ihren Läufen auf Staging stehen alle drei mit Prüfsumme in der Tabelle oben: `0162` und `0163` mit berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`), `0164` mit **zwei ausdrücklich erklärten Abweichungen** (`9999 = 2`, Zeilen 813/814 — die Begründung steht in ihrer Zeile und wird nicht weggeschrieben). Damit nennt diese Liste nur noch `0134`, `0150` und `0151`.

**`0167` stand hier vom 2026-10-31 an als lokal vorbereitet** — seit dem Lauf auf Staging steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis. Auf Production angewendet am 2026-11-01 (P-1).

**`0168` stand hier vom 2026-11-02 an als lokal vorbereitet** — seit dem Lauf auf Staging am selben Tag steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`). Auf Production noch nicht angewendet (ADR-0171).

**`0169`–`0174` standen hier am 2026-11-03 als lokal vorbereitet** — seit dem gemeinsamen Lauf auf Staging am selben Tag stehen alle sechs in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`). Auf Production nicht angewendet (ADR-0174).

**`0175` stand hier am 2026-11-03 als lokal vorbereitet** — seit dem Lauf auf Staging am selben Tag steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`). Auf Production nicht angewendet (ADR-0176).

**`0176` stand hier am 2026-11-03 als lokal vorbereitet** — seit dem Lauf auf Staging am selben Tag steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`) samt zurückgemeldetem Preflight. Auf Production nicht angewendet (ADR-0177).

**`0178` stand hier vom 2026-11-04 an als lokal vorbereitet** — seit dem Lauf auf Staging am selben Tag steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`) samt privilegiertem Preflight. Auf Production nicht angewendet. `0177` bleibt für die zentrale Sicherung reserviert.

**`0166` stand hier vom 2026-10-31 an als lokal vorbereitet** — seit dem Lauf auf Staging am selben Tag steht sie in der Tabelle oben, mit Prüfsumme und berechtigtem Nachweis (`9998 = 0` UND `9999 = 0`). Auf Production wird sie bewusst nicht angewendet (ADR-0167).

**Gefahren wurde je ein Einmal-Durchgang:** `supabase/operations/staging-0139.sql` (SHA-256 `19134017c5694c274e3b239ed2295bb3b5a7a3a0777cdd2a85fec09042ab4bd8`) und `supabase/operations/staging-0140.sql` (SHA-256 `5e578594fcc776d2962b053e712c38bba2e5221df7532f3f64d52d753727502d`). Beide betten ihre Migration **zeichengleich** ein — geprueft von `src/lib/catalog/staging-oneshot.test.ts` — und fuegen genau eine Pruefung hinzu: den Umgebungsstempel (`SKY-0821`/`SKY-0822`), den eine Migration nicht kennen kann. Dass er anschlaegt, faehrt Probelauf **P39** nach. Reihenfolge, Erwartungen und Ruecknahme: `supabase/checks/0139_0140_staging_run.md`. **Beide sind seit dem 2026-10-20 angewendet und damit nach Regel 1 eingefroren** — auch ihre Nachbedingungen. Was an ihren Pruefdateien zu berichtigen war, wurde in `supabase/checks/` berichtigt, nicht in der Migration.

| Migration | Stand |
|---|---|
| `0144_platform_export_calculations.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Ersetzt `system_platform_export()` so, dass der Plattformexport auch `purchase_calculations` führt — **am Inhalt genau drei Änderungen**: `format_version` 1 → 2, der Gruppenkopf „Lager und Orderbuch“ 12 → 13 Bereiche, und ein Bereich mit allen zwölf Spalten am Ende derselben Gruppe. Der Rumpf ist aus `0105` **kopiert**; `src/lib/backup/platform-export-0144.test.ts` dreht die drei Änderungen zurück und prüft, dass dabei Zeichen für Zeichen der alte Rumpf entsteht. **Drei Riegel:** `0142` muss stehen, der vorhandene Rumpf muss der aus `0105` sein (`md5` **2e2da90e976a1e73ca00aba7cd830fae**, sonst wird er nicht blind überschrieben), und ein zweiter Lauf prallt ab. Danach **4c4d2e7c81e4efa8e18cdffa06bba40a** und 54 Bereiche. Keine Tabelle, keine Spalte, kein Recht, keine Zeile. Probelauf **P51** führt Abdruckmessung, beide Abbrüche, den guten Lauf und die Rücknahme an echtem PostgreSQL. Rücknahme: `supabase/rollback/R0144_platform_export_back_to_0105.sql` (stellt nur den Rumpf wieder her, fasst **keine** Nutzerdaten an, ist idempotent). Grenzen einer Wiederherstellung: `supabase/checks/0144_restore_limits.md`. **Für Production liegt `supabase/operations/prod-0144.sql` bereit und ist nicht gefahren.** SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0145_favorites.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production angewendet** (2026-10-28) — **und zwar VOR** der Folgemigration, die `favorites` in die Plattformsicherung aufnimmt (ADR-0136). Der Vorbehalt ist damit nicht eingehalten: eine Sicherung aus `system_platform_export()` fuehrt `favorites` bis heute nicht, und eine Wiederherstellung daraus verlore diese Daten. Offener Punkt, siehe Abschnitt „Production“. Legt `public.favorites` an — drei Spalten (`user_id`, `sky_id`, `created_at`), Primärschlüssel **`(user_id, sky_id)`**, Fremdschlüssel auf `auth.users` (CASCADE) und `skylanders` (RESTRICT), ein Index auf `sky_id`, RLS an und **drei** Richtlinien nach dem Muster von `collection_items` nach `0042`. **Keine `update`-Richtlinie und kein `update`-Recht.** Dazu `public.favorite_demand(text[])`: `security definer`, `stable`, hinter `can_operate_active_seller()`, gibt **ausschliesslich `(sky_id, users)`** zurück. Rein additiv, keine Zeile. Probelauf **P52**. Rücknahme: `supabase/rollback/R0145_drop_favorites.sql`. **Für Production liegt `supabase/operations/prod-0145.sql` bereit und ist nicht gefahren.** SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0146_offer_state.sql` | **auf Staging angewendet am 2026-10-25** (siehe Abschnitt „Staging“), auf **Production angewendet** (2026-10-28) — **und zwar VOR** der Folgemigration, die `offer_state` in die Plattformsicherung aufnimmt (ADR-0136, D-6); der Vorbehalt ist damit nicht eingehalten, siehe Abschnitt „Production“ |
| `0147_offer_availability.sql` | **auf Staging angewendet am 2026-10-26** (siehe Abschnitt „Staging“), auf **Production angewendet** (2026-10-28) — **und zwar VOR** der Folgemigration, die `offer_state` in die Plattformsicherung aufnimmt (ADR-0136, D-6). Der Vorbehalt ist damit nicht eingehalten: eine Sicherung aus `system_platform_export()` fuehrt `offer_state` bis heute nicht, und eine Wiederherstellung daraus verlore diese Daten. Offener Punkt, siehe Abschnitt „Production“. **Erster Staging-Versuch am 2026-10-26 abgebrochen**, und zwar von der Migration selbst: `ERROR P0001: 0147 ABBRUCH: 6 Trigger an den Quellen oder am Spiegel`. Die Pruefung ZAEHLTE Trigger und erwartete null — die Quellen tragen aber sechs voellig legitime (`shop_inventory_identity_immutable`, `shop_inventory_set_updated_at`, `skylanders_item_type_from_category`, `skylanders_log_editorial`, `skylanders_set_updated_at`, `skylanders_sky_id_immutable`, aus `0001`, `0003`, `0004`, `0135`). Dieselbe Sorte Fehler wie die Richtlinienzahl in `0142`; `0146` hatte es richtig und fragte nur nach Triggern mit `offer_state` im Namen. **Eine Transaktion, also nichts hinterlassen** — lesend bestaetigt: `buyable_since` fort, beide Funktionen fort, fuenf CHECKs, `refresh_offer_state()` in der Fassung aus `0146`. **Behoben** mit einer benannten Erwartung in Migration, Preflight, Nachkontrolle und Huelle; `availability.test.ts` haelt die vier Listen zusammen und gegen die Migrationshistorie, und P55 faehrt die drei Faelle (sechs erlaubt, siebter erkannt, einer am Spiegel erkannt). Phase 4, Schritt **S2**: macht aus dem Spiegel eine **Kante**. Legt `offer_state.buyable_since` an (eine Spalte, nullable, CHECK `not buyable or buyable_since is not null`), ersetzt `refresh_offer_state()` so, dass sie sie pflegt, und legt `offer_availability_grace()` (`reservation_ttl() + 10 min`, heute 30 Minuten, `immutable`, ohne Clientrecht) sowie `offer_availability_due()` (`definer`, **`stable`**, leerer `search_path`, ohne Clientrecht) an. **WARUM EINE SPALTE NOETIG WAR:** `changed_at` aus `0146` bewegt sich auch bei einer **Preisaenderung** und ist damit keine verlaessliche Phasengrenze — S3 braucht sie aber, um nur die Konten zu benachrichtigen, die **vor** der Kaufbarkeit vorgemerkt haben. Und eine **kurze Warenkorbreservierung** war hinterher nicht von einer echten Abwesenheit zu unterscheiden, weil nur der Beginn der laufenden Phase gespeichert ist. `buyable_since` behebt beides: sie bewegt sich nur bei einem Uebergang nach kaufbar, und nur wenn die vorige Abwesenheit mindestens `reservation_ttl()` gedauert hat. **S2 SCHREIBT KEIN EREIGNIS FORT:** `offer_availability_due()` ist `stable` und setzt `announced_*` nicht — ein Ereignis gilt erst als uebernommen, wenn S3 es in derselben Transaktion wie die Meldungen vermerkt. **Kein Trigger, keine Tabelle, kein Scheduler, keine Benachrichtigung, kein Clientrecht.** Probelauf **P55** fuehrt beide Migrationen an echtem PostgreSQL und durchlaeuft jeden geforderten Fall — darunter vier Auffrischungen waehrend einer Warenkorbreservierung, die Grenze bei genau `reservation_ttl()` (19 min: dieselbe Phase, 20 min: neue), eine Preisaenderung vor `0147`, und die Uebernahme genau einmal (zweiter Versuch: 0 Zeilen). **Vorbereitet fuer Staging:** `0147_preflight.sql`, `0147_postflight.sql`, Eintrag in `migration-plans.json`, Einfuege-Huelle `supabase/operations/staging-0147.sql` und Laufzettel `supabase/checks/0147_staging_run.md`. Beide Pruefdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0146`, und ihre Erwartungen sind in P55 als Eigner gefahren — Sollwerte, die nie gelaufen sind, sind Vermutungen. Production-Huellen folgen mit der Production-Entscheidung. Ruecknahme: `supabase/rollback/R0147_offer_availability.sql` (laesst `announced_*` unberuehrt). **Offener Punkt bleibt:** `offer_state` und `favorites` stehen weiter in `PLATFORM_EXCLUDED_TABLES` — die Folgemigration muss sie aufnehmen (ADR-0136, D-6). SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0148_availability_notifications.sql` | **auf Staging angewendet am 2026-10-26** (siehe Abschnitt „Staging“), auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Phase 4, Schritt **S3**: aus einem erkannten Verfuegbarkeitsereignis werden persoenliche Meldungen. Legt `public.availability_notifications` an (fuenf Spalten, FK auf `auth.users` mit CASCADE und auf `skylanders` mit RESTRICT, RLS an, **eine** Richtlinie — nur lesen, nur das Eigene —, `authenticated` nur `SELECT`, **nichts** fuer `anon`) und `claim_availability_notifications()` (`definer`, `volatile`, leerer `search_path`, nur fuer `authenticated`). **DER PRIMAERSCHLUESSEL IST DER DUPLIKATSCHUTZ:** `(user_id, sky_id, buyable_since)` — genau eine Meldung je Nutzer, Figur und Verfuegbarkeitsphase, als Eigenschaft der Datenbank und nicht als Zusage der Anwendungslogik. Ein echter spaeterer Zyklus hat eine neue Phasengrenze und darf deshalb eine neue Meldung erzeugen; eine kurze Warenkorbreservierung behaelt die alte und erzeugt keine. **Die Verarbeitung ist EINE Anweisung:** `offer_availability_due()` (die Erkennung aus `0147`, samt Gegenprobe gegen `offer_state_live`), ein `update` auf `offer_state`, das die Faelligkeitsbedingung als `where` mittraegt, und ein `insert`, das aus dessen `returning` liest — es gibt also keinen Zustand mit beanspruchtem Ereignis und fehlenden Meldungen. Die Migration MISST, dass der Rumpf genau eine Anweisung ist. Benachrichtigt wird, wer **vor** der Phasengrenze vorgemerkt hat (`favorites.created_at < buyable_since`). Zurueck kommt nur die Zahl der Meldungen fuer den AUFRUFER — eine Zahl je Figur waere die Nachfrage, und die ist nach `0145` dem Verkaeuferbetrieb vorbehalten. **Keine E-Mail, kein Push, kein Preisalarm, kein Scheduler, keine Einstellung, keine `read_at`-Spalte** (Anzeige und „als gelesen" sind S4). Probelauf **P56** fuehrt `0146`–`0148` an echtem PostgreSQL und durchlaeuft jeden Fall. Ruecknahme: `supabase/rollback/R0148_availability_notifications.sql` (loescht die Meldungen und sagt es vorher; `offer_state.announced_*` bleibt). **Offener Punkt vor Production:** die Tabelle steht mit Ablaufdatum in `PLATFORM_EXCLUDED_TABLES` — die Folgemigration nimmt sie mit `favorites` und `offer_state` auf (Formatversion 3, ADR-0136, D-6). SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0149_notification_read_state.sql` | **auf Staging angewendet am 2026-10-26** (siehe Abschnitt „Staging“), auf **Production angewendet** (siehe Abschnitt „Production“, Laeufe vom 2026-10-28 bis 2026-10-30). Phase 4, Schritt **S4**: die Oberflaeche zu den Meldungen aus `0148`. Legt `availability_notifications.read_at` an (nullbar, **ohne Vorgabewert** — NULL heisst ungelesen), einen **Teilindex** `(user_id) where read_at is null` fuer den Zaehler der Navigationsleiste und `mark_availability_notifications_read(text[])` (`definer`, `volatile`, leerer `search_path`, nur fuer `authenticated`; ohne Argument alle eigenen ungelesenen, mit Argument genau diese Figuren). **KEIN `update`-RECHT FUER CLIENTS:** der naheliegende Weg waere `grant update (read_at) … to authenticated` mit einer `for update`-Richtlinie — er wird nicht genommen. Ein Tabellenrecht ist breiter als die Absicht („als gelesen markieren" heisst `read_at = now()` fuer eigene ungelesene Zeilen, nicht „setze diese Spalte auf irgendeinen Wert"), und es waere das erste Schreibrecht eines Clients auf dieser Tabelle. Die Zusage aus `0148` bleibt damit gueltig: `authenticated` hat genau `SELECT`, und es bleibt bei der **einen** Richtlinie. Die Definer-Funktion traegt die Eigentuemerbedingung **Wort fuer Wort** wie die `select`-Richtlinie im `where` — RLS gilt fuer eine Definer-Funktion nicht, also IST dieses `where` die Grenze; die Migration misst, dass sie drinsteht. **SIE SETZT KEIN `read_at`:** weder per Vorgabewert noch per Backfill, und sie misst es (Nachweis 4.3 und Nachkontrolle 104). Jede Meldung aus `0148` gilt danach als ungelesen, und das ist richtig — es gab bis jetzt keine Oberflaeche, in der sie jemand hat sehen koennen. **Die Anzeige markiert nichts:** Lesen (`notification-queries.ts`, schreibfrei) und Markieren (`notification-actions.ts`, nur am Klick) sind zwei Wege und nicht zwei Wirkungen eines Weges. **Keine E-Mail, kein Push, kein Preisalarm, kein Scheduler, keine Benachrichtigungseinstellung, kein neuer Navigationspunkt und keine Glocke** — die Marke haengt am vorhandenen Menuepunkt „Favoriten". Ruecknahme: `supabase/rollback/R0149_notification_read_state.sql` (Funktion, Index, Spalte in umgekehrter Reihenfolge; die Meldungen bleiben liegen und gelten danach wieder alle als neu). **Vorbereitet fuer Staging:** `0149_preflight.sql`, `0149_postflight.sql`, Eintrag in `migration-plans.json`, Einfuege-Huelle `supabase/operations/staging-0149.sql` und Laufzettel `supabase/checks/0149_staging_run.md`. Beide Pruefdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0148`. **Offener Punkt vor Production:** unveraendert — die Folgemigration nimmt `favorites`, `offer_state` und `availability_notifications` in die Plattformsicherung auf (Formatversion 3, ADR-0136, D-6). SHA-256 siehe `supabase/SHA256SUMS.txt` |
| `0150_availability_alerts.sql` | lokal vorbereitet, **noch nicht freigegeben** und **nirgends angewendet** — am 2026-10-28 rein lesend nachgemessen (`supabase/checks/pending_0150_0153.sql`): `availability_alerts` fehlt, und `alert_arm`, `alert_withdraw` und `my_alerts` fehlen alle drei. Phase M2 nach ADR-0147: die Verfuegbarkeitsalarme als **Fire and forget**. Legt `public.availability_alerts` an — sieben Spalten (`id`, `user_id`, `sky_id`, `created_at`, `notified_at`, `notified_cents`, `read_at`), `id` als **GENERATED ALWAYS AS IDENTITY**, Fremdschluessel auf `auth.users` (CASCADE) und `skylanders` (RESTRICT), drei CHECKs, RLS an und **eine** Richtlinie (nur lesen, nur das Eigene), `authenticated` genau `SELECT`, **nichts** fuer `anon`, und die Identitaetssequenz ohne Clientrecht. **EINE ZEILE TRAEGT VORMERKUNG UND MELDUNG:** scharf (`notified_at` NULL), ausgeloest (gesetzt, `read_at` NULL) oder abgeschlossen (`read_at` gesetzt). **DER TEILINDEX IST DIE FACHREGEL:** `unique (user_id, sky_id) where read_at is null` — „ein offener Alarm je Konto und Figur“ ist damit kein Zustand, den die Datenbank darstellen kann (ADR-0143, mit einem partiellen Unique-Index als Traeger statt dem Primaerschluessel). Dazu zwei weitere Teilindizes und **vier** Definer-Funktionen mit leerem `search_path`, nur fuer `authenticated`: `watch_availability(text)` (drei unterscheidbare Antworten `armed`/`already_open`/`buyable`, geprueft gegen die **Sicht** `offer_state_live`, also gegen `shop_offers()` live), `unwatch_availability(text)`, `fire_availability_alerts()` und `acknowledge_availability_alerts(bigint[])`. **DER ABGLEICH IST EINE ANWEISUNG** — es gibt keinen Zustand mit ausgeloestem Alarm ohne Meldung, weil beides dieselbe Zeile ist; idempotent durch `notified_at is null`, parallele Laeufe serialisieren ueber Zeilensperren, **kein Schloss noetig**. **ER BRAUCHT KEINEN NUTZERKONTEXT:** `auth.uid()` steht ausschliesslich in der Zaehlung, nie im `update` — unter einem Scheduler gibt er 0 zurueck und loest trotzdem vollstaendig aus; die Migration MISST, dass `auth.uid()` genau einmal im Rumpf vorkommt. **„Gesehen“ trifft das EREIGNIS ueber die `id`**, nicht eine SKY-ID, und `read_at is null` haelt historische Meldungen unberuehrt. **KEINE KARENZZEIT, KEIN SPIEGELZUSTAND, KEIN BLICK AUF `favorites`** — die Alarmzeile ist ihre eigene Grundlinie. **Keine E-Mail, kein Push, kein Preisalarm, kein Trigger, kein Scheduler und KEIN AUFRUFER** (der ist M4, eigene Freigabe). **Die eine Abhaengigkeit:** `0150` setzt von `0146` nur die **Sicht** `offer_state_live` voraus und prueft genau sie; `favorites`, `offer_state` und `availability_notifications` nennt sie nirgends. Auf Production liegt `0146` nicht — die Reihenfolge dorthin ist eine offene Betreiberentscheidung. **Rein additiv:** `0146`–`0149` bleiben unberuehrt, nichts wird zurueckgebaut. Probelauf **P58** fuehrt sie an echtem PostgreSQL in einer Welt **ohne** `favorites`, `offer_state` und `availability_notifications` und durchlaeuft jeden geforderten Fall — die drei Antworten, der Teilindex je Konto, Ausloesung ohne Karenzzeit, dreimal nachgefeuert ohne neue Meldung, Abgleich ohne Nutzerkontext, ereignisgenaues „Gesehen“ samt leerer Liste und fremder `id`, erneuter Alarm erst bei neuer Nichtverfuegbarkeit, beide CHECKs, RLS mit zwei echten Konten, und die Ruecknahme in beiden Richtungen. **Vorbereitet fuer Staging:** `0150_preflight.sql`, `0150_postflight.sql`, Eintrag in `migration-plans.json`, Einfuege-Huelle `supabase/operations/staging-0150.sql` (zeichengleich eingebettet, geprueft von `src/lib/catalog/staging-oneshot.test.ts`) und Laufzettel `supabase/checks/0150_staging_run.md`. Beide Pruefdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`–`0149`. Ruecknahme: `supabase/rollback/R0150_drop_availability_alerts.sql` (bricht ab, solange eine Zeile steht, und laesst die alte Bauform unberuehrt). SHA-256 der vorliegenden Fassung: `10dad459d1fa9d24ebbea6dfd1c4041e11512a76251fc4908b88b279fd59c2b9` |
| `0151_offer_state_live.sql` | lokal vorbereitet, **noch nicht freigegeben** und **nirgends angewendet** — am 2026-10-28 rein lesend nachgemessen: die Sicht `offer_state_live` **steht**, aber sie ist die Fassung aus `0146`; ihr Kommentar nennt `0146`, und `0151` setzt einen eigenen. Spalten `sky_id text, cheapest_cents integer` wie zugesagt, null Clientrechte. `0151` wäre dort also ein Lauf, der die vorhandene Sicht prüft und unberührt lässt — nicht einer, der sie anlegt. ADR-0147, Entscheidung **E-1/B2**: sie stellt die SICHT `public.offer_state_live` **eigenstaendig** bereit, damit Production die alte Spiegelarchitektur aus `0146`-`0149` **nie bekommt**. Fachlich gehoert sie **VOR `0150`** — die Nummer ist eine Reihenfolge und keine Kette, und der Nachweis ist trivial: `0151` aendert nur `offer_state_live`, `0150` nur seine fuenf eigenen Objekte, die Schnittmenge der geaenderten Objekte ist **leer**, und es besteht genau eine Abhaengigkeit (`0150` liest die Sicht). **ZWEI AUSGANGSLAGEN, EIN ENDZUSTAND:** fehlt die Sicht (Production), wird sie angelegt — Rumpf und Kommentar **zeichengleich aus `0146`**, kein Clientrecht; steht sie (Staging seit `0146`), wird sie **geprueft und NICHT angefasst**. `create or replace view` kommt nicht vor, es waere der kurze und gleichzeitig der gefaehrliche Weg. **DESHALB IST SIE WIEDERHOLBAR**, anders als `0150`: ihr Gegenstand ist ein ZUSTAND, nicht ein EREIGNIS — ein zweiter Lauf prueft erneut und laesst alles stehen. **EINE DEFINITION, ALS EIN EINZIGES LITERAL:** `v_rumpf` ist der Rumpf aus `0146` Zeichen fuer Zeichen und wird zweimal benutzt — zum Anlegen und als Unterabfrage beim Vergleichen. Es gibt also keine zweite Fassung der Kaufbarkeitsregel, auch nicht zum Pruefen (Entscheidung **E-3**). **FACHLICHE GLEICHWERTIGKEIT IN VIER STUFEN**, und eine abweichende Fassung wird nicht stillschweigend akzeptiert: **1 Bauart** (eine Sicht, genau `sky_id text` und `cheapest_cents integer`) - **2 Herkunft** (haengt an `shop_offers()` UND `v1_sale_condition()` und an KEINER Relation, gelesen aus `pg_depend` ueber die Umschreiberegel, also formatunabhaengig) - **3 Wortlaut** (der normalisierte `pg_get_viewdef()` enthaelt `shop_offers`, `v1_sale_condition`, `min(round(`, `*100`, `available`, `group by` — das faengt ein `max` statt `min` und ein fehlendes `available`) - **4 Verhalten** (ihr Ergebnis ist zeichengleich mit dem der verbindlichen Fassung, beide Abdruecke in EINER Anweisung, damit ein gleichzeitiger Kauf kein Fehlalarm ist). Dazu: kein Clientrecht, sonst Abbruch. **Voraussetzungen: nur `shop_offers()` (0029/0139) und `v1_sale_condition()` (0028)** — beide liegen auf Production. `offer_state`, `favorites` und `availability_notifications` nennt sie nirgends. **Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Funktion, kein Rueckbau.** Probelauf **P59** fuehrt beide Ausgangslagen und provoziert jede der vier Stufen einzeln (dritte Spalte - Relation im Verbund - `max` statt `min` - zusaetzlicher Filter bei vollstaendigem Wortlaut) sowie ein Clientrecht, die Wiederholbarkeit (drei Laeufe, Abdruck unveraendert) und `R0151`. **P58 faehrt seitdem die echte Reihenfolge `0151` dann `0150`.** **Vorbereitet fuer Staging:** `0151_preflight.sql`, `0151_postflight.sql`, Eintrag in `migration-plans.json` (dessen `angewendet`-Probe den ZUSTAND fragt und das ausdruecklich sagt — auf Staging antwortet sie von Anfang an JA, und der Runner verweigert dann zu Recht), Einfuege-Huelle `supabase/operations/staging-0151.sql` und Laufzettel `supabase/checks/0151_staging_run.md`. Beide Pruefdateien teilen den Basis-Vertrag **zeichengleich** mit `0142`-`0150`. Ruecknahme: `supabase/rollback/R0151_drop_offer_state_live.sql` — sie **verweigert, solange irgendwer die Sicht liest**, denn PostgreSQL haelt auf einen Funktionsrumpf keine Abhaengigkeit und ein `drop view` liefe glatt durch. **WICHTIG FUER M9:** `R0146` enthaelt `drop view if exists public.offer_state_live` und wuerde die neue Benachrichtigungsfunktion zerbrechen — der Rueckbau braucht eine eigene Fassung, die die Sicht LAESST. Anforderungen in `0151_staging_run.md`, Abschnitt „Der spaetere Rueckbau“; umgesetzt wird sie erst mit M9 (Entscheidung **E-4**). SHA-256 der vorliegenden Fassung: `1c9bb34a58344f3e7f3e4d2d6e1bc83321a5eeffe160b9694d20a74d71e9ffc5` |
| `0179_sales_recon_ledger_proof.sql` | lokal vorbereitet, **noch nicht freigegeben** und **nirgends angewendet** (2026-11-04). Rein lesend, ADR-0174 Phase 4 — behebt den Befund der funktionalen Leseabnahme von `0178` (verworfene Sitzung 3: handgebauter Payload, `exact` ohne Befund, 1 / 0 / 1, als `derived` ausgegeben). `ledger.atAnalysis` nennt einen Wert nur mit Nachweis: `unchanged` gegen den heutigen Wert, `applied` gegen unberührte Felder und die von der Übernahme aufgezeichneten alten Werte, `changed` ohne Nachweis (`stored` bleibt, `derived` wird `unknown`); Widerspruch, fehlender, mehrdeutiger oder nicht lesbarer Nachweis → `unknown` mit `value` null. Neu `sales_recon_ledger(bigint)` und `sales_recon_proven(jsonb, text, jsonb, boolean)`, beide ohne Clientrecht; `seller_recon_session` neuer Rumpf bei gleicher Signatur, gleichen Rechten und gleichem Schema. Pending, Decide, Apply, `sales_recon_sale_values`, `sales_recon_at_analysis` unverändert (Nachbedingung). Keine Datenanweisung. Probelauf `src/lib/reconciliation/sql/ledger-proof-0179.test.ts`. **Vorbereitet für Staging:** `0179_preflight.sql`, `0179_postflight.sql`, Eintrag in `migration-plans.json`, Einfüge-Hülle `supabase/operations/staging-0179.sql` (SHA-256 `499983443d9d2e624785936cbabeb59898a1bf0d01da1c34a1aa4dfed7b73d47`). Rücknahme: `supabase/rollback/R0179_sales_recon_ledger_without_proof.sql`. Die frühere Planung „0179 = Token- und Decide-Härtung“ ist jetzt `0180`. SHA-256 der vorliegenden Fassung: `04e6f0399e0f0ea9d78ff6fdd515928743611685e7b81c41ab7203cb021582c9` |
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

| Umgebung | angewendet (mit Zeile in dieser Akte) | offen |
|---|---|---|
| Staging `qqxcpesbwfxzgytkdsac` | … `0132`, `0135`–`0140`, `0144`–`0149`, `0152`–`0164` | `0133`, `0134`, `0150`, `0151` |
| Production `zmiwxswrpkmizvqsgype` | … **`0035`** (2026-10-31, mit vollständigem Nachweis; über eine frühere Ausführung wird nichts behauptet), `0133`, `0135`–`0149`, `0152`–**`0165`** (`0159`–`0164` am 2026-10-30 **gemessen**, ohne Ausführungsprotokoll; **`0165` mit vollständigem Nachweis**) | `0134`, `0150`, `0151` |

**Diese Tabelle stand bis zum 2026-10-29 auf dem Stand vom 2026-10-18** („Staging
… `0132`") und war damit über zwanzig Migrationen veraltet. Sie ist beim Lauf von
`0162` nachgezogen worden; die Wahrheit über eine einzelne Migration steht
weiterhin in den Zeilen oben, nicht hier.

**Zwei Buchungslücken bleiben ausdrücklich offen und werden nicht durch
Behauptung geschlossen:** `0141` ist am 2026-10-28 rein lesend auf Staging
nachgewiesen (die Spalten und die Funktion stehen dort), hat aber **keine Zeile**
in der Staging-Tabelle oben; für `0142` und `0143` fehlt dort ebenfalls eine
Zeile, und ob sie auf Staging stehen, ist in dieser Arbeitsphase **nicht
gemessen** worden. Beide Lücken gehören zur Buchführung, nicht zum Schema.

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
