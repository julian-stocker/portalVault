# Laufzettel — 0180 (nur nachgewiesene, ausgewählte Übernahme) auf Staging

**Stand (2026-11-06): auf Staging angewendet, technisch nachkontrolliert, Prüflauf B abgenommen —
0180 insgesamt NICHT abgenommen.** Der reguläre Runner-Vorlauf wurde **übersprungen**; es gibt
**keine** `supabase/baselines/baseline-0180.json`, und sie wurde **nicht** nachträglich erzeugt.
Berechtigter Postflight 9998 = `0`, 9999 = `0`. Prüflauf B 32/32, zurückgerollt (P0001), beide
berechtigten Nachkontrollen gleich dem Vorher-Stand. Offen: Teil A (Ablehnungslauf
`verify:recon-0180:staging -- --live`), Teil C (Nachweisdatei der lokalen Parallelitätstests), das
Gesamturteil. `APPLY_RELEASED` bleibt `false`. **Production (`zmiwxswrpkmizvqsgype`): nicht
angewendet, nicht angesprochen.**

| | |
|---|---|
| Zielprojekt | Staging `qqxcpesbwfxzgytkdsac` (Stempel `skyisles-staging qqxcpesbwfxzgytkdsac`) |
| Commit | `a70655f` (HEAD, Branch `development/skyisles-v2`); Migration seit `e9f8abc` unverändert |
| Migration | `0180_sales_recon_selected_apply.sql`, SHA-256 `6f6c7363f2b8a27695facb921772963b02c6af3276dbdcd42a1e07640836d712` |
| Hülle | `supabase/operations/staging-0180.sql`, SHA-256 `4e18b3f7ded2de90d5d60965e7e455424f4e3e872275c2b8ea0a4f1755f0664d` |
| Preflight | `supabase/checks/0180_preflight.sql`, SHA-256 `2b68807bde481c35b2c307666a5f0108655d4c89ac00fd1e05fd92f5f09c2462` |
| Postflight | `supabase/checks/0180_postflight.sql`, SHA-256 `a04167e5a7ccf27d2671fd9cfba797f2d45b94f82263a8f6c92ebfd36de16ff7` |
| Rückbau | `supabase/rollback/R0180_sales_recon_apply_without_selection.sql` (nicht benutzt) |
| Runner-Akte | **keine** — `baseline-0180.json` existiert nicht, kein Protokoll `migrate-0180-*` |

## Abweichung vom vorgesehenen Ablauf

Vorgesehen war (ADR-0137, `CLAUDE.md`): Phase 1 privilegierter Preflight als `postgres` · Phase 2
`npm run db:migrate:staging -- 0180` (Preflight, Baselines einfrieren) · Phase 3 Hülle · Phase 4
`--resume` · Phase 5 `db:privileges:staging`.

**Tatsächlich:**

1. **Phase 1 übersprungen.** Kein privilegiertes Preflight-Ergebnis (131–153 als `postgres`) liegt vor.
2. **Phase 2 übersprungen.** Der Runner lief für 0180 nie; es gibt keine eingefrorene Akte.
3. **Keine nachträgliche Rekonstruktion.** Auf Entscheidung des Betreibers (2026-11-06) wird
   `baseline-0180.json` **nicht** erzeugt, keine Baseline neu erhoben und als Vorher-Wert deklariert,
   **kein** `--resume` gefahren (er bräche ohne Akte ohnehin ab).
4. Der berechtigte Postflight wurde **direkt** gefahren (unten), mit den Baselines aus dem lesenden
   Preflight des Prüfzugangs.

Vorhanden war allein der **lesende Preflight** über den Prüfzugang `skyisles_agent` (2026-11-05,
23:46 UTC, schreibgeschützte Sitzung, TLS): PostgreSQL 17.6, Stempel, 101–111 und die R4-Rümpfe ok,
**9999 = `0`, 9998 = `11`** (131–137, 141, 143, 145, 146 `KEIN-RECHT`); 142 = `1303|c234c880…`,
144 = `38|0e9c8e0b…`, 151–153 = Prüfzugangswerte; dazu:

- 900 `skyisles-base-1|257|76f027a6a335b9f8599955dbb371d943|594|594|286|658|8793a9e2abd76190c23bcb24e64f6e74|1216ff0082a7`
- 901 `skyisles-coll-1|21|1|965b149286b4e61212ef48a94a8bab01|bfa156bc6cb3`

Beide Zeilen sind zeichengleich mit der Akte `baseline-0179.json` (Runner, 2026-11-04).

## Anwendung (Betreiber, 2026-11-05/06)

Der Betreiber hat `supabase/operations/staging-0180.sql` einmal im SQL-Editor von
`qqxcpesbwfxzgytkdsac` als `postgres` ausgeführt; Supabase meldete **SUCCESS**. Die Hülle ist eine
Transaktion: A1 Stempel; A2 Daten- und Rechteabdrücke vorher; Migration zeichengleich mit Vor- und
Nachbedingung; Z1 dieselben Abdrücke nachher (jeder Unterschied bricht ab); Z2 Rümpfe; Z3 Rechte.
SUCCESS heißt: jede dieser Bedingungen hielt.

## Lesender Postflight (Prüfzugang, 2026-11-06) — 9999 = 0, 9998 = 11

`0180_postflight.sql` über `skyisles_agent`, die Baselines 900/901 oben transaktionslokal gesetzt,
informativ (kein Runner). `seller_recon_apply(bigint,bigint[],text)` steht → 0180 angewendet.

| Nr | Inhalt | Ergebnis |
|---|---|---|
| 201–210 | sieben neue, drei ersetzte Rümpfe | md5 = Nachbedingung der Migration, ok |
| 211 | SECURITY DEFINER, leerer `search_path` | `8`, ok |
| 212–215 | Vorschau/Übernahme nur `authenticated`; Decide/Pending wie vorher; alte Übernahme und Helfer für keine Clientrolle | ok |
| 221–227 | Lesefunktion, Ledger, Nachweis, `pending_set`, `sale_values`, Anlegen, Sperre | unverändert, ok |
| 242 / 244 | Positionen / Lagerbewegungen | `1303\|c234c880…` / `38\|0e9c8e0b…` = Preflight 142/144 |
| 251–253 | Funktions-, Tabellenrechte, Policies (Prüfzugang) | `c5c21c85…` / `6b1de419…` / `3978d0fc…` = Preflight 151–153 |
| 231–237, 241, 243, 245, 246 | Abgleich, Verkäufe, Erstattungen, Altbestand, Journal | `KEIN-RECHT` — ungemessen, **nicht** bestanden |
| 801–833 | Shop und Sammlung gegen 900/901 | ok |
| **9998 / 9999** | | **`11` / `0`** |

## Berechtigter Postflight (`postgres`, Betreiber, 2026-11-06) — 9998 = 0, 9999 = 0

**Datei:** `supabase/log/staging/0180-postflight-berechtigt-ohne-akte.sql` (ungetrackt, 499 Zeilen,
SHA-256 `96b717c5d501af34a3cbccbd38cedcad0afefb18654f919869dc834bf98f14bc`). **Nicht** vom Runner
erzeugt; Aufbau wie dessen Datei: `begin;` · zwei `set_config` (900/901 oben, `true`) ·
`0180_postflight.sql` eingebettet (eingebetteter Teil SHA-256 `a04167e5…` = Commit) · `rollback;`.
Keine schreibende Anweisung.

**Vom Betreiber übermittelt** (Befund je Bereich, keine Einzelwerte):

| Bereich | Ergebnis (Betreiber) |
|---|---|
| **9998 / 9999** | **`0` / `0`** |
| 201–215 Rümpfe, Definer, `search_path`, Rechte von 0180 | erfolgreich |
| 221–227 unberührte Funktionen, Sperre | erfolgreich |
| 231–253 Abgleich, Verkäufe, Positionen, Erstattungen, Lagerbewegungen, Altbestand, Journal, Rechte, Policies | vollständig lesbar (kein `KEIN-RECHT`) |
| 801–833 Shop und Sammlung | erfolgreich |
| fehlgeschlagene Prüfungen | keine |

231–253 haben in dieser Datei **keinen Sollwert** (Preflight-Referenz fehlt) und zählen nicht in
9999. „Vollständig lesbar“ heißt gemessen, **nicht** gegen einen Vorher-Wert verglichen. Die
Einzelwerte 231–246 liegen hier nicht vor.

## Rechteaufnahme (`npm run db:privileges:staging`, 2026-11-06, 08:22 UTC)

Rein lesend, `verify-full`. **„Einrichtungsdatei und Datenbank stimmen ueberein.“** Abdruck
`13f9f823c5e6ee8f…` — **unverändert** gegenüber der Aufnahme vom 2026-11-04 (nach 0178). Die Datei
`supabase/privileges/staging-agent.json` änderte sich nur im Zeitstempel `erhoben` und wurde
zurückgesetzt.

Erwartet nach 0180: **keine Änderung**, denn 0180 erteilt dem Prüfzugang nichts und entzieht ihm
nichts — die neuen Funktionen gehen nur an `authenticated`, die Helfer und die alte Übernahme an
keine Clientrolle (212–215). Bestätigt: `select` auf 12 Tabellen (ohne `favorites`, `offer_state`,
`offer_state_live`), `execute` nur auf `is_shop_eligible`, `non_collectible_categories`,
`shop_offers`; keine Abgleichsfunktion, keine Abgleichstabelle; `public` `create=false`.

## Belegkette — was belegt ist und was nicht

**1. Durch Vorher- und Nachher-Werte belegt** (Preflight Prüfzugang 2026-11-05 ↔ Postflight 2026-11-06):

- Shop und Sammlung (801–833) gegen 900/901 — Prüfzugang **und** `postgres`.
- Verkaufspositionen (242) und Lagerbewegungen (244) — Prüfzugang.
- Funktionsrechte außerhalb von 0180, Tabellenrechte, Policies (251–253 ↔ 151–153) — Prüfzugang,
  gleiche Rolle, gleiche Definition.
- Rechte des Prüfzugangs (Abdruck `13f9f823…`, seit 2026-11-04).

**2. Durch A2/Z1 der Hülle belegt** (als `postgres`, in der Migrationstransaktion): die Migration
selbst hat keine Zeile in Abgleich, Verkäufen, Positionen, Erstattungen, Lagerbewegungen,
Altbestand oder Journal und kein Recht, keine Policy bewegt. Das deckt **nur** die Dauer der
Transaktion ab.

**3. Nicht historisch vergleichbar:**

- **231–237, 241, 243, 245, 246** (Abgleichstabellen, Verkäufe, Erstattungen, Altbestand,
  Journal): kein privilegierter Vorher-Wert für 0180. Ob sich zwischen dem lesenden Preflight
  (2026-11-05, 23:46 UTC) und dem Start der Hülle etwas bewegt hat, ist **nicht belegt**.
- **Privilegierte Sicht auf 251–253**: nur als Prüfzugang verglichen; als `postgres` fehlt der
  Vorher-Wert.
- **Schließbar**: die privilegierten 0179-Werte (`0179_staging_run.md`, Preflight 131–146 als
  `postgres`, im 0179-Postflight bestätigt) haben **dieselbe Zeilendefinition** wie 0180 231–246
  (zeichengleich geprüft). Übermittelt der Betreiber die Einzelwerte 231–246 seines Laufs, lässt
  sich Unverändertheit seit dem 0179-Postflight (2026-11-05) belegen — oder eine Bewegung finden.
  Bis dahin: **offen**.

## Historischer Vergleich 0179 → 0180 (`postgres`, 2026-11-06)

Referenz: privilegierte 0179-Werte (`0179_staging_run.md`, Preflight 131–146 als `postgres`,
2026-11-04; im berechtigten 0179-Postflight am 2026-11-05 als unverändert bestätigt). Die Zeilen
231–246 von `0180_postflight.sql` sind **zeichengleich definiert** wie die von `0179_postflight.sql`
(geprüft), also direkt vergleichbar. 0180-Werte: **Anzahlen vom Betreiber übermittelt**; die
md5-Abdrücke 231–246 des berechtigten Laufs lagen bei Erstellung dieses Abschnitts **nicht** vor.

| Nr | Inhalt | 0179 (`postgres`) | 0180 (`postgres`, Anzahl) | Δ | Einordnung |
|---|---|---|---|---|---|
| 231 | Sitzungen | `3\|bf930e5a…` | `5` | +2 | **ungeklärt** (siehe unten) |
| 232 | Dateien | `3\|25a4edc8…` | `5` | +2 | **ungeklärt** |
| 233 | Bestellungen | `13\|7627af50…` | `69` | +56 | **ungeklärt** |
| 234 | Zuordnungen | `13\|46b8b6a0…` | `72` | +59 | **ungeklärt** |
| 235 | Befunde | `24\|5cd63838…` | `82` | +58 | **ungeklärt** |
| 236 | Entscheidungen | `12\|26dc2a50…` | `12` | 0 | Anzahl gleich; Inhalt erst mit md5 |
| 237 | Übernahmen | `11\|d712a101…` | `11` | 0 | Anzahl gleich; Inhalt erst mit md5 |
| 241 | Verkäufe | `315\|6e9f9b53…` | `315` | 0 | Anzahl gleich; Inhalt erst mit md5 |
| 242 | Positionen | `1303\|c234c880…` | `1303` | 0 | **unverändert** (md5 über Prüfzugang gleich) |
| 243 | Erstattungen | `42\|1e44ee8c…` | `42` | 0 | Anzahl gleich; Inhalt erst mit md5 |
| 244 | Lagerbewegungen | `38\|0e9c8e0b…` | `38` | 0 | **unverändert** (md5 über Prüfzugang gleich) |
| 245 | Altbestand | `2741\|e83d59a1…` | `2741` | 0 | Anzahl gleich; Inhalt erst mit md5 |
| 246 | Journal | `19\|ef347f2f…` | `19` | 0 | Anzahl gleich; Inhalt erst mit md5 |

**Zu 231–235:** zwei neue Abgleichssitzungen mit je einer Datei, 56 Bestellungen, 59 Zuordnungen,
58 Befunden — und **keine** neue Entscheidung, **keine** Übernahme, kein Verkauf, keine
Erstattung, keine Journalzeile. Das Muster passt zu zwei CSV-Analysen über `seller_recon_create`
(der einzige Weg, der diese Tabellen beschreibt, und er ändert keinen Verkauf). Nicht verursacht
durch: die Migration (A2/Z1 der Hülle), die Prüfwerkzeuge dieser Sitzung (alle schreibfrei).
**Herkunft und Zeitpunkt sind vom Betreiber zu bestätigen**; bis dahin ungeklärt. Für Prüflauf B
ist das kein Hindernis: B legt seine Sitzungen mit einem eigenen Fingerabdruck je Transaktion an
(kein Konflikt mit offenen Sitzungen) und vergleicht Prüfung 30 nur außerhalb seiner Zeilen.

## Prüflauf B — Vorbereitung (2026-11-06, nicht ausgeführt)

**Prüflauf-Datei (Stand vor der R7-Korrektur, überholt):** `supabase/operations/staging-0180-probe.sql`, 1057 Zeilen, SHA-256
`2766b586ba307555e662c4736ab92afc0348fb1087d527056994a79ab7d5b8b0` (= `supabase/SHA256SUMS.txt`,
Commit `a70655f`, seither unverändert, ebenso Erzeuger, Vorlage und Migration).
`node tools/build-recon-probe.mts --check`: „aktuell“. `recon-probe-0180.test.ts`: 23/23.
`begin;` Zeile 52, `rollback;` letzte Zeile, kein `commit`/`prepare transaction`, keine
Production-Kennung.

**Vorab (`postgres`, vor B), je Ergebnistabelle vollständig zurückmelden:**

1. `supabase/checks/verify_sales_reconciliation_state.sql` (112 Zeilen) — 101–108, 201–206, 9998.
2. `supabase/log/staging/0180-postflight-berechtigt-ohne-akte.sql` (wie oben, `96b717c5…`) —
   231–253 mit md5: der **Vorher-Stand für B**.
3. `supabase/log/staging/0180-probe-riegel-vorab.sql` (ungetrackt, 130 Zeilen, SHA-256
   `80eb910807f6c58b8e89d0c52ec1a2f6481efe10d83418c56ac281b5ef4133db`) — R1–R7 als Tabelle statt
   als Abbruch; R4-Liste, R5-Tabellen und -Erlaubnisliste, R6-Spalten maschinell aus der
   Prüflauf-Datei übernommen; R7 setzt die Identität transaktionslokal wie B. Zusätzlich (Info 11)
   jeder Trigger in `public`, der `supabase_functions`/`net`/HTTP aufruft (Dashboard-Webhooks).
   pglast: 4 Anweisungen (`begin`, zwei `select`, `rollback`). Lokal auf PGlite: alles ok,
   9999 = `0`; mit zwei Betriebskonten R7 = `2`, 9999 = `1`; danach keine Identität übrig.
   **Grenze:** PGlite ersetzt `auth.uid()` durch eine Testfunktion; Zeile 10 ist erst auf Staging
   echt geprüft.

Ergebnisse: siehe „Prüflauf B — abgenommen“ unten. Die hier genannte Vorabprüfung `80eb9108…`
ist durch die R7-Korrektur überholt und gelöscht.

## R7-Befund vor Prüflauf B (2026-11-06) — NO-GO, Diagnose und Korrekturvorschlag

**Ergebnis der Vorabprüfung (Betreiber, `postgres`):** R1–R6 bestanden; R7 aktive Betriebskonten
`3` statt `1`, Identität `false` statt `true`, 9999 = `2`. Entscheidung des Betreibers: **NO-GO für B
in der jetzigen Form.** B wurde nicht ausgeführt; nichts auf Staging geschrieben.

**Ursache — eine zu strenge Annahme des Prüfwerkzeugs, kein Datenfehler:**

- Staging hat **seit Langem drei** freigeschaltete Betriebskonten des aktiven Verkäufers —
  dokumentiert in ADR-0119 (`send-order-mail`) und `supabase/checks/0124_baseline.sql` (2026-10-16:
  „drei aktive, freigeschaltete Betreiberkonten“, deshalb dort jeder einzeln gemessen). Die
  Annahme „genau eins“ in B war falsch; `0180_probe.md` nannte sie schon als ungeprüft.
- **Fachlich nicht notwendig.** Mehrere Konten je Verkäufer sind gewollt (Mitgliedschaft,
  ADR-0077). Die 0180-Funktionen fragen nur das Tor `can_operate_active_seller()`; *wer* aufruft,
  steht nur in Auditspalten (`decided_by`, `created_by`, …), die B ohnehin zurückrollt. Der
  berechtigte Zweck von R7 — nur eine **echte, freigeschaltete** Identität, nie eine erfundene,
  und keine Auswahl auf gut Glück — bleibt; nur „genau eins“ ist zu eng.
- **Identität `false` ist Folge, kein zweiter Befund.** Die Vorabprüfung setzt die Claims nur bei
  genau einem Konto, sonst leer; dann liefert `auth.uid()` `null` und Zeile 10 `false`. Der Prüflauf
  selbst bricht schon bei der Zählung ab und setzt keine Identität.

**Tatsächliche Implementierung (lesend geprüft):**

| | Stand |
|---|---|
| R7 im Prüflauf (`staging-0180-probe.sql`) | zählt `seller_operators` ⋈ `sellers` mit `is_active and is_enabled`; ≠ 1 → `ABBRUCH R7`; danach `select … into` (ohne `limit`), `set_config` von `request.jwt.claim.sub` und `request.jwt.claims` (`true` = transaktionslokal); verlangt `auth.uid()` = Konto **und** `can_operate_active_seller()` |
| R7 in der Vorabprüfung (`0180-probe-riegel-vorab.sql`) | dieselbe Zählung; Claims nur bei genau einem Konto (`having count(*) = 1`), sonst leer |
| `auth.uid()` auf Staging | `coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid`, kein Definer (md5 `cdef18c69c4f4cbbced2eaf81e628b49`, über den Prüfzugang aus `pg_proc` gelesen) — liest genau die GUCs, die B setzt |
| `can_operate_active_seller()` auf Staging | md5 `3e220b0b1a0b33d0b5ad9afc1be4719d` = Rumpf aus `0041`: aktiver Verkäufer, `o.user_id = auth.uid()`, `o.is_enabled`; SECURITY DEFINER, leerer `search_path` |
| Simulation | wirkt nur in der Transaktion; ändert **nicht** die Datenbankrolle (bleibt `postgres`, Lehre aus `0125_function_test.sql`). B prüft also das Tor, **nicht** die Grants für `authenticated` — die belegen 212–215 und Teil A (`--live`) |

**Ob die Simulation das Tor wirklich öffnet — getrennt geprüft:** Die PGlite-Welt ersetzt
`auth.uid()` durch eine Testtabelle; dort hätten die Claims nie etwas bewirkt, und die alten
Riegeltests konnten das nicht zeigen. Neu in `recon-probe-0180.test.ts`
(„R7 with Supabase's auth.uid() and 0041's seller gate“): Stagings `auth.uid()` wortgleich und das
Tor aus `0041`. Ergebnis: ohne Claims Tor zu; mit den Claims des Prüflaufs **32/32**; danach Tor
wieder zu. Damit ist lokal belegt, dass genau die Claims das Tor öffnen.

**Regressionstests (neu, alle grün, 28/28 in der Datei):** drei Konten wie auf Staging →
`ABBRUCH R7: 3 aktive Betriebskonten`; kein Konto → `0`; `auth.uid()` ignoriert die Claims →
„Identitaet greift nicht“; Identität richtig, Tor bleibt zu → „greift nicht“. Jeweils: keine
Zeile verändert, keine temporäre Funktion, keine Identität übrig.

**Kann ein eindeutiges Konto aus den Daten sicher gewählt werden?** Nicht ohne Zusatzannahme. Der
Prüfzugang darf `seller_operators` nicht lesen; Notiz oder Datum sind kein belegtes
Unterscheidungsmerkmal, eine Rangfolge nach Kennung (wie `0125`) wäre deterministisch, aber
willkürlich. Eindeutig benannt ist ein Konto nur durch das **Staging-Betriebskonto** der
Prüfwerkzeuge (`~/.skyisles/staging-operator.env`; dasselbe Konto, mit dem Teil A und die
Leseabnahmen arbeiten). Wer die drei Konten sind, beantwortet optional
`supabase/log/staging/0180-betriebskonten-diagnose.sql` (ungetrackt, nur lesend, ohne E-Mail und
ohne volle Kennung).

### Korrekturvorschlag (Entwurf, nicht umgesetzt)

Nur Prüfwerkzeug; keine Migration, keine Geschäftslogik, keine Rechte, kein Konto geändert.

1. **Vorlage `probe-template.sql.tpl`, R7 neu:**
   1. Das Konto ist **benannt**: `nullif(current_setting('skyisles.probe_operator', true), '')::uuid`;
      fehlt es → `ABBRUCH R7: kein Betriebskonto benannt`.
   2. Genau **eine** freigeschaltete Mitgliedschaft dieses Kontos beim aktiven Verkäufer
      (`count(*) = 1`), sonst `ABBRUCH`. Andere Konten zählen nicht; kein `limit`.
   3. **Vorher** (ohne Claims) muss `can_operate_active_seller()` `false` sein — sonst trägt die
      Sitzung schon eine Identität → `ABBRUCH`.
   4. Claims setzen; `auth.uid()` = Konto **und** Tor `true`, sonst `ABBRUCH`.
   5. **Gegenprobe:** Claims kurz auf eine zufällige Kennung ohne Mitgliedschaft → Tor `false`,
      sonst `ABBRUCH`; dann zurück auf das Konto. Belegt, dass die Identität das Tor öffnet.
2. **Laufdatei statt Handgriff:** ein Erzeuger (Erweiterung von `build-recon-probe.mts`, Modus
   `--run-file`) meldet sich nach `requireStaging()` mit dem öffentlichen Schlüssel als
   Staging-Betriebskonto an (ohne Service-Role, Zugangsdaten nie ausgegeben), liest nur die eigene
   Kennung aus der Sitzung, meldet sich ab und schreibt
   `supabase/log/staging/0180-probe-lauf.sql` (ungetrackt): Kopfzeilen, `begin;`, **eine**
   `set_config('skyisles.probe_operator', '<kennung>', true)`, danach die versionierte
   Prüflauf-Datei Zeichen für Zeichen ab ihrer Zeile nach `begin;`. Er prüft die SHA-256 des
   eingebetteten Teils gegen `SHA256SUMS.txt`. Kein Platzhalter, nichts von Hand.
3. **Vorabprüfung** analog: dieselbe Einstellung, Zeile 9 „benanntes Konto ist freigeschaltet“,
   Zeile 10 Identität und Tor, Zeile 10a Gegenprobe; die Kontenzahl nur als Auskunft.
4. **Tests:** die vier Regressionstests oben bleiben; neu: drei Konten **mit** benanntem Konto →
   32/32; benanntes Konto fehlt / ist nicht freigeschaltet / gehört nicht zum aktiven Verkäufer /
   ist keine gültige Kennung → je `ABBRUCH R7`, nichts geschrieben; Sitzung mit vorhandenen Claims
   → `ABBRUCH`; Gegenprobe schlägt an, wenn das Tor jede Kennung durchlässt. Erzeugertest:
   eingebetteter Teil zeichengleich, genau eine `set_config`, keine Production-Kennung.
5. **Dokumentation:** `0180_probe.md` (R7), dieser Laufzettel, ADR-0178 (Ergänzung).

Danach erneut: Erzeugerprüfung, Tests, Vorabprüfung als `postgres`, und erst mit **eigener
Freigabe** Prüflauf B.

## R7-Korrektur — lokal umgesetzt (2026-11-06), auf Staging nichts gefahren

Freigabe des Betreibers für die lokale Umsetzung; **Prüflauf B bleibt gesperrt.** Keine Änderung an
Migration 0180, an Geschäftslogik, an Konten oder Rechten; ADR-0178 um eine Ergänzung erweitert.

**R7 neu** (`tools/recon-probe/probe-template.sql.tpl`, erzeugt nach
`supabase/operations/staging-0180-probe.sql`, 1102 Zeilen, SHA-256
`49bb803ca41f7d43f353969083d643494f4de008e46867a653d39cc72241899d`, löst `2766b586…` ab), in
dieser Reihenfolge, jede Abweichung `ABBRUCH R7` vor dem ersten Schreiben:

1. `skyisles.probe_operator` gesetzt — sonst „kein Betriebskonto benannt“ (die versionierte Datei
   allein bricht hier ab);
2. strikt `^[0-9a-f]{8}-…-[0-9a-f]{12}$`, nicht die Null-Kennung — erst danach `::uuid`;
3. genau **eine** freigeschaltete Mitgliedschaft dieses Kontos beim aktiven Verkäufer; andere Konten
   zählen nicht, kein `limit`;
4. vorher: weder `request.jwt.claim.sub` noch `request.jwt.claims` gesetzt, `auth.uid()` leer, das
   Tor zu;
5. Identität setzen (transaktionslokal): `auth.uid()` = Konto, sonst „greift nicht“; Tor offen,
   sonst „bleibt zu“;
6. Gegenprobe: `gen_random_uuid()` ohne **jede** Zeile in `seller_operators` → `auth.uid()` liefert
   sie, das Tor ist zu;
7. zurück auf das benannte Konto, erneut `auth.uid()` und Tor geprüft.

**Laufdatei** (`npm run probe:recon-0180:staging` = `build-recon-probe.mts --run-file`):
`requireStaging()`, Service-Role aus der Umgebung entfernt, Prüfdatei = Erzeuger und = `SHA256SUMS.txt`
— alles **vor** der Anmeldung; dann eine Anmeldung mit dem öffentlichen Schlüssel als vorhandenes
Staging-Betriebskonto (`~/.skyisles/staging-operator.env`), nur `user.id` übernommen, Abmeldung
`scope: "local"` im `finally`. Kein `.rpc`, kein `.from`, kein Storage, keine Admin-API. Geschrieben
nur `supabase/log/staging/0180-probe-lauf.sql` (Prüfdatei + eine Zeile nach `begin;`, beim Erzeugen
zurückgelesen und gegen die SHA-256 verglichen) und `…/0180-probe-riegel-vorab.sql`. Ausgabe: Pfade,
SHA-256, Kennung gekürzt auf vier Zeichen. **Noch nicht ausgeführt.**

**Vorabprüfung** (vom Erzeuger aus der Prüfdatei geschnitten, gleiche Identität): Zeilen 9–16 R7
(Kennung gültig, eine Mitgliedschaft, vorher leer, vorher Tor zu, `auth.uid()`, Tor offen,
Gegenprobe, wiederhergestellt), 17 Gesamtzahl der Konten **nur Auskunft**, 18 Webhooks, 9999. Jeder
R7-Schritt ist eine eigene Anweisung, ihr Ergebnis eine transaktionslokale Einstellung; `rollback`.
Die frühere Vorabprüfung (`80eb9108…`) ist überholt und wird beim Erzeugen überschrieben.

**Tests:** `recon-probe-0180.test.ts` 42/42 — B läuft jetzt in einer Welt mit Stagings `auth.uid()`
und dem Tor aus `0041`: drei Konten + benanntes → 32/32, nichts bleibt; Konto fehlt; fünf ungültige
Kennungen (auch Großbuchstaben, Null-Kennung, Leerzeichen, Einschleusung); nicht freigeschaltet;
ohne Mitgliedschaft; falscher Verkäufer; doppelte Mitgliedschaft; vorhandene Identität; Tor ohne
Identität offen; `auth.uid()` ignoriert Claims; Tor bleibt zu; Gegenprobe (Tor für jedes angemeldete
Konto) — je Abbruch, keine Zeile, keine temporäre Funktion, keine Identität übrig. Vorabprüfung: drei
Konten bestehen, Fehlerbilder je richtig. `build-recon-probe-run.test.ts` 10/10: Laufdatei
zeichengleich zurück, genau eine Zeile, ungültige Kennungen abgewiesen, nur `supabase/log/`, kein
`.rpc`/`.from`/Admin, nur `signInWithPassword` + `signOut`, nichts Geheimes und keine volle Kennung
in Ausgaben, kein Production-Bezug.

## Generatorlauf (2026-11-06) — vom Betreiber freigegeben, einmal gefahren

`npm run probe:recon-0180:staging`, Exit 0: Production-Guard bestanden (Ziel `qqxcpesbwfxzgytkdsac`);
Anmeldung als Staging-Betriebskonto und Abmeldung (diese Sitzung) erfolgreich; Konto `43ee…` benannt.
Keine Funktion aufgerufen, keine Tabelle gelesen, keine Service-Role; Nebenwirkung nur Supabases
Anmeldebuchführung in `auth`.

| Datei (ungetrackt, `git check-ignore` bestätigt) | SHA-256 | Zeilen |
|---|---|---|
| Prüfdatei `supabase/operations/staging-0180-probe.sql` (versioniert) | `49bb803ca41f7d43f353969083d643494f4de008e46867a653d39cc72241899d` | 1102 |
| Laufdatei `supabase/log/staging/0180-probe-lauf.sql` | `0c83272654e8fc87a48de67e609d23c231449d6404286e6c051548a09f59f4b0` | 1115 |
| Vorprüfung `supabase/log/staging/0180-probe-riegel-vorab.sql` | `533ba8209701fcf799f5278ced48535289c18d5e3f346d7a5b51418714c337f0` | 185 |

Unabhängig nachgeprüft: eingebettete Prüfdatei zeichengleich (SHA-256 wie oben); genau eine
Benennungszeile, unmittelbar nach `begin;`; Vorprüfung mit derselben Kennung und gleich dem Erzeuger;
Kennung je Datei genau einmal; kein Wert aus `staging-operator.env` oder `.env.staging`, kein JWT,
keine Production-Kennung; beide enden mit `rollback;`, kein `commit`; Vorprüfung pglast: 12
Anweisungen, nur `select` und Transaktion. Migration 0180 unverändert, `APPLY_RELEASED` = `false`.

**Vorprüfung (Betreiber, `postgres`):** R1–R7 bestanden, 9999 = `0` — Ergebnis unten.

## Prüflauf B — abgenommen (2026-11-06, Entscheidung des Betreibers)

**Teil B ist abgenommen.** Gefahren hat der Betreiber im SQL-Editor als `postgres`; die
Ergebnisse unten hat er übermittelt. Rohtabellen und Meldung liegen nicht im Repository.

| | |
|---|---|
| Versionierte Prüflauf-Datei | `supabase/operations/staging-0180-probe.sql`, SHA-256 `49bb803ca41f7d43f353969083d643494f4de008e46867a653d39cc72241899d` (1102 Zeilen, = `SHA256SUMS.txt`) |
| Gefahren über | die Laufdatei `supabase/log/staging/0180-probe-lauf.sql` (SHA-256 `0c832726…`, ungetrackt): obige Datei zeichengleich eingebettet plus genau eine Benennungszeile nach `begin;` |
| Riegel R1–R7 | Vorabprüfung `0180-probe-riegel-vorab.sql` (`533ba820…`): alle bestanden, 9999 = `0` |
| Prüflauf B | **32/32 bestanden**, Ende mit der erwarteten Ausnahme `P0001` → alles zurückgerollt |
| Berechtigte Nachkontrolle 1 | sämtliche Werte gleich dem Vorher-Stand, 9998 = `0` |
| Berechtigte Nachkontrolle 2 | alle Funktionen und Rechte korrekt; md5-Abdrücke der Zeilen **231–253 gleich dem Vorher-Stand**; 9998 = `0`, 9999 = `0` |
| Shop- und Sammlungs-Baselines | unverändert (900/901 wie oben) |

**R7-Korrektur auf Staging bewährt.** Staging hat **drei** freigeschaltete Betriebskonten beim
aktiven Verkäufer. Das ist kein Fehler: es stand so schon in ADR-0119, `0124_baseline.sql` und
`0125_function_test.sql`. B nimmt keines davon von selbst, sondern das benannte
Staging-Betriebskonto der Prüfwerkzeuge (`43ee…`, volle Kennung nur in der ungetrackten Laufdatei).
Die Vorabprüfung hat auf Staging gezeigt:

- Kennung gültig, genau eine Mitgliedschaft;
- vorher keine Identität, das Tor war zu;
- mit der transaktionslokalen Identität liefert `auth.uid()` das Konto, und das Tor ist offen;
- Gegenprobe mit einem fremden Konto: das Tor bleibt zu;
- danach war die Identität wiederhergestellt.

Die beiden anderen Konten blieben unberührt.

**Was die Datenabdrücke belegen:** Der Vergleich vorher/nachher umschließt den Prüflauf B. Das
heißt: B hat in Abgleich, Verkäufen, Positionen, Erstattungen, Lagerbewegungen, Altbestand, Journal,
Rechten und Policies (231–253) nichts hinterlassen.

**Was sie nicht belegen:**

- Den Zeitraum vor 0180 schließen sie **nicht**. Die privilegierte Lücke zwischen dem lesenden
  Preflight und der Hülle bleibt so bestehen wie oben beschrieben.
- Der Vergleich gegen 0179 (md5 231–246) und die Herkunft der zwei neuen Sitzungen bleiben offen.

**Runner-Akte:** `baseline-0180.json` existiert **nicht**. Sie wurde weder für B noch danach
erzeugt, keine Baseline wurde neu erhoben oder nachträglich als Vorher-Wert eingefroren, und kein
`--resume` lief. Die Vorher-Werte für B sind Messungen des Betreibers, keine Runner-Akte.

**Grenze von B (bleibt):**

- Eine Verbindung, Rolle `postgres`: B prüft das Tor, nicht die Grants für `authenticated`. Das
  belegt Teil A.
- Keine Parallelität. Das belegt Teil C.

## Offene Abnahmeschritte — vorbereitet, nicht gefahren

**Teil A — Ablehnungen über PostgREST (Staging, je eigene Freigabe):**
`npm run verify:recon-0180:staging -- --live`

- **Ablauf:** zuerst `requireStaging()`, dann wird die Service-Role entfernt. Danach Anmeldung als
  Staging-Betriebskonto (`~/.skyisles/staging-operator.env`, wird nicht ausgegeben).
- **Aufrufe:** 12 Aufrufe, die 0180 **vor** jedem Schreiben ablehnen muss:
  - Vorschau unbekannte Sitzung P0002;
  - leere, doppelte und zu lange Auswahl 23514;
  - Übernahme ohne, mit falschem und mit großgeschriebenem Token 23514;
  - unbekannte Sitzung P0002;
  - die alte Übernahme ist nicht aufrufbar;
  - anon darf weder Vorschau noch Übernahme noch Entscheidung.
- **Sitzung 0 existiert nicht:** keine Sitzung, kein Verkauf, keine Entscheidung wird angelegt.
- **Nebenwirkung:** nur Supabases Anmeldebuchführung in `auth`.
- **Vorbereitet (2026-11-06):** Die Abmeldung gilt jetzt nur für diese Sitzung
  (`signOut({ scope: "local" })`). Bisher war sie global und hätte jede andere Sitzung desselben
  Kontos beendet, etwa eine offene `/business`-Anmeldung. Das ist durch einen Test festgehalten
  (`verify-recon-0180.test.ts`).
- **Erwartet:** 12/12 PASS. Ohne Nachweisdateien endet der Lauf mit Exit `3` „UNVOLLSTÄNDIG“, und
  das ist dann richtig.

**Teil C — echte Parallelität (lokal, kein Staging):**
`npm run test:recon-pg -- --reporter=json --outputFile=supabase/log/staging/0180-nachweis-c.json`

- **Umgebung:** eigener PostgreSQL-17-Cluster in einem Temp-Verzeichnis, nur über einen
  Unix-Socket erreichbar, danach gestoppt. Binärdateien unter `/usr/local/opt/postgresql@17/bin`
  sind vorhanden (geprüft).
- **Erwartet:** die 6 Tests von `concurrency-0180.test.ts` bestanden, keiner übersprungen.

**Nachweis B für das Gesamturteil:** Verlangt ist die abschließende Meldung des Prüflaufs, so wie der
SQL-Editor sie zeigte, als Textdatei, etwa `supabase/log/staging/0180-nachweis-b.txt`:

- die Zeile `PRUEFLAUF 0180 ZURUECKGEROLLT — 32/32 bestanden`;
- 32 einzelne `| n ok`;
- kein `FEHLT`.

Ohne diese Meldung kann `--evidence-b` nicht belegt werden. **B wird dafür nicht erneut gefahren.**

**Gesamturteil (danach, eigene Freigabe):**
`npm run verify:recon-0180:staging -- --live --evidence-b supabase/log/staging/0180-nachweis-b.txt --evidence-c supabase/log/staging/0180-nachweis-c.json`
→ Exit `0` „VOLLSTÄNDIG“.

## Nicht gefahren

- keine erneute Migration, kein `--resume`, keine Runner-Akte;
- B nicht erneut gefahren, keine bleibenden Testverkäufe;
- keine CSV-Übernahme, kein Ablehnungslauf (A), kein Lauf von C;
- keine Production-Verbindung, kein Push, kein Commit.

`APPLY_RELEASED` = `false` (`src/lib/reconciliation/release.ts`).

## Nächste Schritte (je eigene Freigabe)

1. Meldung von B als Nachweisdatei sichern (siehe oben).
2. C lokal mit JSON-Bericht.
3. A: `verify:recon-0180:staging -- --live`, danach mit beiden Nachweisen → Exit `0`.
4. Abnahme von 0180 insgesamt. Erst danach `APPLIED.md` „abgenommen“, und `APPLY_RELEASED` nur mit
   eigener Entscheidung.
5. Optional: md5 231–246 gegen 0179; Herkunft der zwei neuen Abgleichssitzungen.
