# M-04 – Audit der Schreibwerkzeuge mit Production-Zugriff

Stand: **2026-11-09** · Stability Baseline 1 · rein lesend erhoben (Quelltext von `tools/*.mts` und `package.json`).

Es wurde kein Werkzeug ausgeführt, keine Verbindung aufgebaut und keine Sicherheitslogik geändert.

---

## 1. Grundlagen

**Wie ein Werkzeug sein Ziel bekommt.** Fast jedes Werkzeug baut seinen Client aus `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`. Diese Werte lädt das npm-Skript über `--env-file=.env.local` (**Production**) oder `--env-file=.env.staging`.

- **Ohne Guard** entscheidet allein diese Datei über das Ziel.
- Ein Service-Role-Key gilt nur für sein eigenes Projekt. Er ist mit dessen JWT-Geheimnis signiert. Ein **vertauschtes Paar** aus URL des einen und Key des anderen Projekts scheitert deshalb schon an der Anmeldung.
- Das eigentliche Risiko ist ein **stimmiges Paar am falschen Ort**: Production-Werte in `.env.staging`, das falsche npm-Skript oder ein direkter `node --env-file=.env.local …`-Aufruf.

**Vorhandene Schutzmechanismen:**

| Mechanismus | Ort | Prüft | Schwäche |
|---|---|---|---|
| `requireStaging()` | `tools/lib/staging-guard.mts` | Ziel = `.env.staging` und ≠ `.env.local`, bei URL **und** Key | vertraut dem Inhalt von `.env.staging` |
| `requirePinnedStagingWrite()` (M-02) | dito | zusätzlich die **fest hinterlegte Staging-ID** | bisher nur in `sync-legacy-orderbook` |
| `requireStagingIfRequested()` | dito | wie `requireStaging`, **nur wenn** `SKYISLES_REQUIRE_STAGING=1` gesetzt ist | ohne das Flag kein Guard |
| `requireProduction()` | dito | Ziel = `.env.local` (URL und Key) und ≠ `.env.staging` | **keine** fest hinterlegte Production-ID, vertraut `.env.local` |
| `chooseEnvironment()` | dito | `--env staging\|production` ist Pflicht, Production verlangt zusätzlich `--confirm-production` | nur in `import-sales` |
| `verbinde(pfad, ref)`, mehrfach kopiert | `catalog-sync`, `catalog-sync-apply`, `catalog-finish`, `catalog-publish`, `storage-transfer`, `sync-collision-report` | URL der Datei **enthält** die feste Projekt-ID (Teilstring) | eigener, paralleler Mechanismus; vergleicht nur einen Teilstring |
| `tools/lib/staging-db.mts` | `db:*:staging` | feste ID, Lese-Rolle, TLS-CA, Stempel, `read_only` | vorbildlich, aber nur für den direkten DB-Zugang |
| eigener Guard | `transfer-to-production` | Staging ≠ Production, Keys verschieden, `--apply --confirm-production` | **keine** fest hinterlegte ID |

---

## 2. Werkzeugübersicht

**Legende:**

- **Prod?** heißt: kann über ein npm-Skript oder ein direktes `--env-file=.env.local` in Production schreiben.
- **Vorschau** heißt: Ohne `--apply` wird nichts geschrieben.
- **Guard** steht für die Prüfung von Ziel und Projekt-ID.
- **Best.** steht für eine ausdrückliche Production-Bestätigung.

### 2.1 Mit Production-Schreibpfad

| Werkzeug (npm) | schreibt | beabsichtigt? | Vorschau | Guard | Best. | falsches .env erkannt? | Stufe |
|---|---|---|---|---|---|---|---|
| `grant-admin` (`admin:grant`) | `shop_admins` (`upsert`/`delete`), also **Admin-Recht** | ja, Production | ja (`--apply`) | **keiner** | **nein** | **nein**: Ziel ist, was `.env.local` sagt | **P0** |
| `verify-rls` (`verify:rls:prod`) | Auth-Nutzer, Fixtures, Lagerbewegungen, sich selbst als shop-admin (68 Schreibaufrufe, 28 RPCs) | laut Kommentar „deliberate“ | **nein**, schreibt immer | prod: **keiner** | **nein** | nein | **P0** |
| `verify-editorial` (`verify:editorial:prod`) | Auth-Nutzer, Fixtures, `admin_set_catalog_visible`/`_group`/`_note` (24 + 14) | dito | **nein** | prod: keiner | nein | nein | **P0** |
| `verify-inventory` (`verify:inventory:prod`) | Auth-Nutzer, `record_inventory_movement`, `set_shop_listing` (5 + 20) | dito | **nein** | prod: keiner | nein | nein | **P0** |
| `import-catalog` (`catalog:import:prod`) | `skylanders` u. a. | historisch, Cutover | ja | prod: keiner (`…IfRequested`) | **nein** | nein | **P0** |
| `import-characters` (`characters:import:prod`) | Charaktere, Zuordnungen | historisch | ja | prod: keiner | nein | nein | **P0** |
| `import-legacy-history` (`legacy:history:prod`) | `legacy_stock_events` | historisch | ja | prod: keiner | nein | nein | **P0** |
| `import-legacy-inventory` (`inventory:import-legacy:prod`) | **Lagerbewegungen** (`system_record_inventory_movement`) | historisch | ja | prod: keiner | nein | nein | **P0** |
| `reconcile-inventory` (`reconcile:inventory:prod`) | **Korrektur-Lagerbewegungen** | historisch | ja | prod: keiner | nein | nein | **P0** |
| `settle-legacy-sales` (`settle:legacy-sales:prod`) | `settled_at` (`system_settle_reconciled_legacy_item`) | historisch | ja | prod: keiner | nein | nein | **P0** |
| `storage-transfer` (`storage:transfer:apply:production`) | Storage-Objekte | ja | ja; `--apply` braucht `--ziel` | `verbinde` (feste ID, Teilstring) | **nein**: das npm-Skript allein schreibt | ja, feste ID | **P1** |
| `transfer-to-production` (`transfer:apply`) | Orderbuch-Historie nach Production | ja, einmalig | ja | eigener: beide Dateien verschieden | ja (`--confirm-production`) | **teilweise**: vertauschte Dateien schreiben Staging | **P1** |
| `catalog-sync-apply` (`catalog:sync:apply`) | Figuren, Charaktere | ja | ja | `verbinde`-artig, feste ID | ja | ja | P2 (eigener Mechanismus) |
| `catalog-finish` (`catalog:finish:apply`) | Katalog | ja | ja | `verbinde` | ja | ja | P2 |
| `catalog-publish` (`catalog:publish`) | Katalog | ja | ja | `verbinde` | ja | ja | P2 |
| `import-sales` (`orderbook:sales-import:prod`) | Verkäufe | historisch | ja | `chooseEnvironment` und `requireProduction` | ja | ja, gegen `.env.local` | P2, **das Vorbild** |
| `sync-legacy-orderbook` (`sync:orderbook:prod`) | – seit M-02 nur Vorschau | – | ja | `requirePinnedStagingWrite` | – | ja | P2 (Skriptname irreführend) |

### 2.2 Nur Staging oder nur lesend

| Gruppe | Werkzeuge | Bewertung |
|---|---|---|
| Staging-Schreiber mit `requireStaging()` | `apply-workbook-dates`, `build-recon-probe`, `cat03-*`, `cat05-bilder`, `fix-legacy-raw-name`, `import-orderbook`, `seed-category-groups`, `seed-shop-fixtures`, `staging-snapshot`, `sync-image-overrides`, `ui-fixtures-ship-day`, `verify-payment-mode`, `verify-purchase-*`, `verify-recon-*`, `verify-sale-*`, `verify-sales-reconciliation`, `verify-sandbox-e2e`, `verify-settled`, `verify-ship-and-day` | Guard vorhanden, aber ohne feste ID. **P1** (Umstieg auf `requirePinnedStagingWrite`) |
| Staging-Schreiber, Guard nur mit Flag | `verify-calculations` (13 Schreibaufrufe; nur ein `:staging`-Skript) | direkt per `node` ungeschützt. **P1** |
| Direkter DB-Zugang | `db-check`, `db-migrate`, `db-privileges` (`staging-db.mts`) | nur lesend, feste ID, TLS. **ok** |
| Production lesend | `export-image-overrides` (`requireProduction`), `perf-report`, `verify-legacy-history`, `verify-commerce`, `verify-seller`, `verify-shop` | Die `verify-*` machen nur anonyme Aufrufe, die abgelehnt werden **sollen**. `verify-commerce` legt zusätzlich einen Service-Client an und liest nur. **P2** (formaler Guard) |
| Lokal | `checksums`, `validate-check-sql`, `verify-platform-archive`, `verify-backup-export`, `dr/30-filter-toc`, Build-Werkzeuge | keine Datenbank. ok |
| Entwicklungsserver | `dev-staging` | verweigert Production, hält den Key zurück. ok |

### 2.3 Secrets in Ausgaben

- Kein Werkzeug gibt einen Service-Role-Key, ein Passwort oder ein Token aus. Gesucht wurde nach `console.*` mit `KEY`, `SERVICE`, `password` und `token`.
- `dev-staging` meldet ausdrücklich „service-role key: withheld“.
- `grant-admin` maskiert die E-Mail-Adresse.
- Einige Werkzeuge geben die **Projekt-URL** aus, zum Beispiel `sync-legacy-orderbook` („Ziel …“). Die URL ist kein Geheimnis, sollte aber einheitlich auf die Projekt-ID verkürzt werden. **P2**

---

## 3. Konkrete Risiken

1. **[P0] Ein einziger Befehl ändert Production-Daten oder -Rechte ohne Bestätigung.**
   - `npm run admin:grant -- --email … --apply` vergibt ein Admin-Recht.
   - `npm run reconcile:inventory:prod -- --apply` und `inventory:import-legacy:prod -- --apply` buchen Lagerbewegungen.
   - `settle:legacy-sales:prod -- --apply` setzt Abrechnungsstände.
   - `catalog:import:prod -- --apply` und `characters:import:prod -- --apply` überschreiben Katalogdaten.

   Geschützt sind diese Befehle nur durch `--apply` und den Skriptnamen. Kein Abgleich mit der Production-ID, keine zweite Bestätigung. Das widerspricht dem Arbeitsmodus „Production wird nicht mehr verändert“ (PROJECT_STATUS, seit 2026-09-12).
2. **[P0] Drei Prüfwerkzeuge schreiben immer, auch gegen Production.** `verify:rls:prod`, `verify:editorial:prod` und `verify:inventory:prod`:
   - legen Auth-Konten an,
   - fügen Fixtures ein und löschen sie wieder,
   - geben sich selbst shop-admin.

   Es gibt keine Vorschau und keine Bestätigung. Ein Abbruch mitten im Lauf hinterlässt Fixtures oder Konten in Production. Der Name `verify:` verschleiert, dass es Schreiber sind.
3. **[P1] Uneinheitliche Bestätigung.**
   - `storage:transfer:apply:production` schreibt ohne `--confirm-production`.
   - `catalog-*` und `transfer-to-production` verlangen das Flag.
   - `import-sales` verlangt zusätzlich `--env production`.
4. **[P1] `requireProduction()` und `transfer-to-production` kennen die Production-ID nicht.** Sie vertrauen `.env.local`. Sind die Dateien vertauscht oder umgeschrieben, wird die falsche Seite als „Production“ beschrieben.
5. **[P1] Sechs Kopien von `verbinde()` mit Teilstring-Vergleich** (`url.includes(ref)`) bilden einen zweiten, parallelen Mechanismus neben `staging-guard.mts`.
6. **[P1] Staging-Guards ohne feste ID.** `requireStaging()` vertraut `.env.staging`. `requireStagingIfRequested()` schützt nur mit Flag, das betrifft 11 Werkzeuge.
7. **[P2] Bedienung.**
   - `npm run dev` arbeitet mit Production-Daten.
   - `sync:orderbook:prod` existiert noch, kann seit M-02 aber nicht mehr schreiben.
   - Einmalwerkzeuge (`cat*`, `preflight-0115/0116`, `fix-legacy-raw-name`, Cutover-Importe) liegen weiter in `tools/`.
   - `CLAUDE.md` behauptet einen einheitlichen Staging-Guard.

---

## 4. Vorschlag: ein gemeinsamer Schutz für alle Schreibwerkzeuge

**Grundsatz:** Ein Werkzeug, eine Zielentscheidung, ein Modul (`tools/lib/staging-guard.mts`). Keine neuen parallelen Mechanismen. Die kopierten `verbinde()` werden durch das Modul ersetzt.

### 4.1 Drei Funktionen, alle vor dem ersten Client

| Funktion | für | prüft |
|---|---|---|
| `requirePinnedStagingWrite(label)` (gibt es, M-02) | jeden Staging-Schreiber | feste Staging-ID, `.env.staging` und `.env.local` wie bisher |
| **neu:** `requireProductionWrite(label, argv)` | jeden Production-Schreibpfad | (1) `--env production` (`chooseEnvironment`), (2) `--apply`, (3) **`--confirm-production=<production-ref>`**, also die ID wörtlich, die man nicht aus Gewohnheit tippt, (4) Ziel = **feste Production-ID**, (5) Ziel = `.env.local` bei URL **und** Key (`requireProduction`-Logik), (6) Ziel ≠ `.env.staging`, (7) **unmittelbar vor dem ersten Schreibzugriff**, nach Vorschau und Plan: eine Zusammenfassung (Projekt-ID, Zahl der Änderungen) und, wenn `stdin` ein Terminal ist, die wörtliche Eingabe der Projekt-ID |
| **neu:** `requireProductionRead(label)` | lesende Production-Läufe | feste Production-ID und `.env.local`, ohne Bestätigung |

### 4.2 Regeln

- **Standard ist Vorschau.** Ohne `--apply` wird nie geschrieben. Wer kein `--env` angibt, bekommt keinen Production-Schreibpfad.
- **Keine Umgehung über Variablen.** Die Entscheidung stützt sich auf die festen IDs aus `staging-db.mts` *und* auf den Abgleich beider Env-Dateien. Eine Umgebungsvariable kann sie nicht aufheben. `SKYISLES_REQUIRE_STAGING` bleibt nur noch für Lesewerkzeuge, die beide Umgebungen bedienen.
- **Ausgabe:** nur Projekt-ID und Modus, nie URL-Parameter, Keys oder E-Mail-Adressen (Adressen maskiert, wie in `grant-admin`).
- **Bestehende Abläufe bleiben möglich**, mit einem zusätzlichen, wörtlichen Bestätigungsschritt:
  - `admin:grant`: `--apply --env production --confirm-production=zmiwxswrpkmizvqsgype`
  - die Katalog-Werkzeuge
  - `storage:transfer`
  - `transfer:apply`
  - `orderbook:sales-import:prod`
  - `images:export:prod` (lesend)
- **Schreibende Prüfwerkzeuge gegen Production** (`verify:rls|editorial|inventory:prod`) bekommen eine von zwei Behandlungen. **Deine Entscheidung:**
  - (a) Die `:prod`-Skripte entfallen. Staging-first gilt, diese Prüfungen laufen nur noch auf Staging.
  - (b) Sie bleiben, laufen aber nur über `requireProductionWrite` und räumen ihre Fixtures garantiert ab.

  Empfehlung: **(a)**.
- **Historische Einmal-Importe** gegen Production (`catalog:import:prod`, `characters:import:prod`, `legacy:history:prod`, `inventory:import-legacy:prod`, `reconcile:inventory:prod`, `settle:legacy-sales:prod`): Ihre `:prod`-Skripte entfallen. Die Werkzeuge bekommen `requireProductionWrite`, falls sie je wieder gebraucht werden. Empfehlung: **beides**, also Skripte entfernen und Guard trotzdem einbauen.

---

## 5. Priorisierte Maßnahmen

| Nr. | Stufe | Maßnahme | Dateien | Aufwand | Abhängigkeit |
|---|---|---|---|---|---|
| M-04.1 | P0 | `requireProductionRead`, `requireProductionWrite` und die reine Entscheidungsfunktion `checkProductionWrite` in `staging-guard.mts`, mit Tests | `tools/lib/staging-guard.mts` | S–M | – |
| M-04.2 | P0 | `grant-admin` auf `requireProductionWrite` | `tools/grant-admin.mts`, `package.json` | S | 4.1 |
| M-04.3 | P0 | Die sechs historischen Importe auf `requireProductionWrite` für den Production-Pfad und `requirePinnedStagingWrite` für Staging. `:prod`-Skripte entfernen (Entscheidung 4.2) | `import-catalog`, `import-characters`, `import-legacy-history`, `import-legacy-inventory`, `reconcile-inventory`, `settle-legacy-sales`, `package.json` | M | 4.1 |
| M-04.4 | P0 | `verify:rls|editorial|inventory:prod` nach Entscheidung (a) oder (b) | `package.json`, die drei Werkzeuge | S | 4.1 |
| M-04.5 | P1 | `storage-transfer`, `transfer-to-production`, `catalog-sync-apply`, `catalog-finish`, `catalog-publish`, `catalog-sync`, `sync-collision-report`: `verbinde()` durch die Modulfunktionen ersetzen. Production-Schreiben einheitlich über `requireProductionWrite`, `storage:transfer:apply:production` mit Bestätigung | 7 Werkzeuge, `package.json` | M | 4.1 |
| M-04.6 | P1 | `requireProduction()` an die feste ID binden. `import-sales` und `export-image-overrides` profitieren ohne eigene Änderung | `staging-guard.mts` | S | 4.1 |
| M-04.7 | P1 | Staging-Schreiber von `requireStaging` auf `requirePinnedStagingWrite`. `verify-calculations` und die übrigen Werkzeuge mit `requireStagingIfRequested` werden ohne Flag geschützt | etwa 25 Werkzeuge (mechanisch) | M | – |
| M-04.8 | P2 | Lese-Prüfer (`verify-commerce/seller/shop`) mit `requireProductionRead` bzw. Staging-Guard. Ausgaben auf die Projekt-ID verkürzen | 3 bis 5 Werkzeuge | S | 4.1 |
| M-04.9 | P2 | Doku: Satz in `CLAUDE.md` korrigieren, Schreibwerkzeuge in `docs/CREDENTIALS_MAP.md` und `docs/DEPLOYMENT.md` eintragen, `sync:orderbook:prod` umbenennen oder entfernen, Einmalwerkzeuge archivieren | Doku, `package.json` | S | 4.2–4.7 |

**Keine Migration, keine Datenbankrechte, keine Remote-Verbindung** für eine dieser Maßnahmen.

---

## 6. Testplan ohne Remote-Schreibzugriffe

1. **Reine Entscheidung** (`checkProductionWrite`, nach dem Muster von `legacy-sync-write-guard.test.ts`). Jeder dieser Fälle muss abgelehnt werden:
   - ohne `--env`
   - `--env staging` gegen die Production-ID
   - ohne `--apply`
   - ohne `--confirm-production`
   - mit `--confirm-production` ohne ID oder mit falscher ID
   - Ziel = Staging-ID
   - Ziel = unbekanntes Projekt
   - `.env.local` fehlt
   - `.env.local` nennt ein drittes Projekt
   - Key aus `.env.staging` an der Production-URL
   - URL mit Großbuchstaben oder Schrägstrich am Ende

   Zugelassen werden genau: feste ID, beide Dateien stimmig, beide Flags.
2. **Abdeckungswächter für das ganze Repository**, ein neuer Test. Jedes Werkzeug unter `tools/` mit einem Schreibaufruf (`.insert|update|upsert|delete(`, schreibende `.rpc(`, Storage `upload|remove`) **und** einem npm-Skript mit `.env.local` muss `requireProductionWrite` vor `createClient` aufrufen. Jedes Werkzeug mit Schreibaufruf und `.env.staging` muss `requirePinnedStagingWrite` aufrufen. Ein neues Werkzeug ohne Guard lässt den Test scheitern.
3. **Echte Prozessstarts, offline:**
   - `grant-admin`, ein Import, `storage-transfer` und `transfer-to-production` laufen in einem temporären Verzeichnis mit erfundenen Env-Dateien.
   - `fetch` ist vor dem Laden ersetzt. Abgelehnte Fälle enden mit Exit 1 vor jeder Ausgabe zum Ziel. Der zugelassene Fall kommt bis zum blockierten `fetch` (wie M-02).
   - Die Bestätigung am Terminal wird über eine Pseudo-Eingabe getestet: Eine falsche ID führt zum Abbruch, die richtige lässt weiter.
4. **Bestehende Guard-Tests** (`staging-guard.test.ts`, `legacy-sync-write-guard.test.ts`, `dev-lan.test.ts`) bleiben grün. Die Quelltexttests der betroffenen Werkzeuge werden nur angepasst, wo sie den Guard-Aufruf festhalten.
5. **Kein** Lauf eines Werkzeugs gegen Staging oder Production, keine vollständige Testsuite.

---

## 7. Status: umgesetzt am 2026-11-09 (nicht committet)

Freigegeben und umgesetzt, mit diesen Entscheidungen:

- (1) `verify:rls|editorial|inventory:prod` sind entfernt. Diese Prüfer schreiben nur noch auf Staging.
- (2) Die `:prod`-Skripte der Cutover-Importe sind entfernt. Die Werkzeuge bleiben und sind auch beim direkten `node`-Aufruf geschützt.
- (3) Lesende Production-Prüfungen bleiben.

### 7.1 Gemeinsame Guards (`tools/lib/staging-guard.mts`)

| Baustein | Zweck |
|---|---|
| `productionConfirmation()` | `--confirm-production=zmiwxswrpkmizvqsgype`. Ein blankes `--confirm-production` zählt nirgends mehr, auch nicht in `chooseEnvironment` |
| `checkProductionTarget()` (rein) | feste Production-ID, `.env.local` stimmt bei URL **und** Key, `.env.staging` nennt weder dieses Projekt noch diesen Key (erkennt gekreuzte Konfiguration) |
| `checkProductionWriteIntent()` (rein) | `--env production`, `--apply`, genau eine Bestätigung mit ID |
| `requireProductionWrite()` | beides, vor jedem Client, Exit 1 bei jedem Befund |
| `confirmProductionWrite()` und `decideConfirmation()` (rein) | **unmittelbar vor dem ersten Schreiben**: Zusammenfassung, dann die Projekt-ID am Terminal tippen. **Ohne Terminal Abbruch** (fail-closed). Ein abgebrochener Prompt (Ctrl-D/C) zählt als „nicht bestätigt“. Keine Umgebungsvariable ersetzt die Eingabe |
| `guardWriteTool()` | Einstieg für Werkzeuge, die beide Umgebungen bedienen. Production-Schreiben nur mit der vollen Regel. `--apply` ohne `--env production` geht nur an die feste Staging-ID; ein Production-Paar auf dem Staging-Pfad wird dort abgelehnt. Vorschau gegen Production nur mit `--env production` |
| `requireProduction()` / `requireProductionRead()` | jetzt mit fester ID (`checkProductionTarget`) |
| `requireStaging()` | jetzt mit fester Staging-ID (`checkPinnedStagingWrite`). Das gilt für alle etwa 25 Staging-Schreiber ohne eigene Änderung |
| `pinnedEnvFile()` | für Werkzeuge, die beide Env-Dateien selbst lesen: exakte Projekt-ID statt Teilstring. Die beiden Dateien dürfen nicht dasselbe Projekt oder denselben Key nennen |

### 7.2 Abgesicherte Schreibpfade

| Werkzeug | vorher | jetzt |
|---|---|---|
| `grant-admin` | `--apply` reichte | `guardWriteTool`, Bestätigung vor `upsert` und `delete` (Production: `--env production … --confirm-production=<id>`, dann ID tippen) |
| `import-catalog`, `import-characters`, `import-legacy-history`, `import-legacy-inventory`, `reconcile-inventory`, `settle-legacy-sales` | Guard nur mit Flag, Production ungeprüft | `guardWriteTool` immer, `confirmProductionWrite` vor dem ersten Schreiben. `:prod`-Skripte entfernt |
| `verify-rls`, `verify-editorial`, `verify-inventory`, `verify-calculations` | schrieben auch gegen Production, Guard nur mit Flag | `requirePinnedStagingWrite` ohne Bedingung. Einen Production-Pfad gibt es nicht mehr |
| `storage-transfer` | `--ziel production --apply` schrieb ohne Bestätigung | zusätzlich `--confirm-production=<id>` (Riegel 0b), ID tippen vor dem ersten Upload, `pinnedEnvFile` |
| `catalog-sync-apply` | blankes `--confirm-production`, Teilstring | Bestätigung mit ID, `pinnedEnvFile`, exakte ID beim Anmelden von W, ID tippen vor dem ersten Schritt |
| `catalog-finish`, `catalog-publish` | blankes Flag, auch fest im npm-Skript | Bestätigung mit ID. Sie geben sie an die Kindwerkzeuge weiter, die vor dem Schreiben nach der ID fragen. npm-Skripte ohne eingebaute Bestätigung |
| `transfer-to-production` | nur „beide Dateien verschieden“ | feste IDs beider Seiten, Bestätigung mit ID, ID tippen vor dem ersten `insert` |
| `import-sales` | blankes `--confirm-production` | Bestätigung mit ID und ID tippen vor `apply`. `orderbook:sales-import:prod` entfernt (Cutover-Import mit fest eingebauter Bestätigung) |
| `catalog-sync`, `sync-collision-report` (lesend) | Teilstring | `pinnedEnvFile` |

**Entfernte npm-Skripte:**

- `verify:rls:prod`, `verify:editorial:prod`, `verify:inventory:prod`
- `catalog:import:prod`, `characters:import:prod`
- `legacy:history:prod`, `inventory:import-legacy:prod`
- `reconcile:inventory:prod`, `settle:legacy-sales:prod`
- `orderbook:sales-import:prod`

`catalog:finish:apply` und `catalog:publish` tragen keine Bestätigung mehr. Kein Werkzeug wurde gelöscht.

**Bleiben, nur lesend:** `verify:shop|seller|commerce|legacy-history:prod`, `perf:report:prod`, `images:export:prod`, `sync:orderbook:prod` (Vorschau; sein Schreibpfad ist seit M-02 auf Staging festgelegt).

### 7.3 Tests (gezielt, offline)

- Neu ist `src/lib/ops/production-write-guard.test.ts` mit **114 Tests**:
  - **reine Entscheidungen:** alle Ablehnungsgründe, darunter gekreuzte Konfiguration, falsche oder fehlende ID, blankes Flag, zwei Umgebungen, Großschreibung und Schrägstrich;
  - **echte Prozessstarts** mit erfundenen Env-Dateien und ersetztem `fetch`: Jeder abgelehnte Fall endet mit Exit 1 **ohne einen einzigen Netzwerkversuch**. Abgedeckt sind `grant-admin` in 11 Fällen, drei Cutover-Werkzeuge, vier Prüfer, `storage-transfer`, `transfer-to-production` und `catalog-sync-apply`. Die legitimen Abläufe (Production lesen, Production schreiben bis zur Bestätigung, Staging) passieren den Guard;
  - **Bestätigung über ein echtes Pseudo-Terminal** (Python `pty`): Die richtige ID bestätigt. Tippfehler, Staging-ID und „yes“ werden abgelehnt. Ohne Terminal wird auch mit der richtigen, per Pipe gelieferten ID abgelehnt;
  - **Abdeckungswächter** über `tools/` und `package.json`: Jeder Schreiber ruft einen gemeinsamen Guard (Ausnahmen benannt und begründet). Jeder Production-Schreiber fragt vor dem Schreiben nach der ID. Kein Werkzeug akzeptiert das blanke Flag. Kein npm-Skript trägt eine Bestätigung. Kein `.env.local`-Skript zeigt auf einen Schreiber ohne Production-Regel. Die entfernten Skripte fehlen, die lesenden sind da. Kein kopierter Teilstring-Vergleich bleibt.
- Angepasst wurden die Quelltexttests, die die alten Texte festhielten: `staging-guard`, `sales`, `calculator-save-ui`, `catalog-finish`, `catalog-publish`, `sync-apply`, `sync-character-gate`, `storage-verify`. **Jede Anpassung ist strenger als vorher**, keine entfernt eine Prüfung.
- **49 betroffene Testdateien mit 1 904 Tests grün**, `tsc` und `eslint` ohne neuen Befund.

### 7.4 Verbleibende Risiken

- **`verify-commerce` und `verify-seller`** senden gegen Production anonyme Schreibproben, die abgelehnt werden **sollen**. Wäre die RLS kaputt, könnten sie schreiben. Genau das sollen sie finden. Es ist eine bewusste Ausnahme und im Abdeckungswächter benannt.
- **`verify-payment-smoke`** hat weiter eine eigene Prüfung und schreibt laut Analyse nicht. Nicht umgestellt.
- **Lesewerkzeuge mit `requireStagingIfRequested`** (`perf-report`, `verify-legacy-history`, die Vorschau von `sync-legacy-orderbook`) hängen weiter am Flag. Sie schreiben nicht.
- **Kindprozesse** von `catalog-finish` und `catalog-publish` fragen je Schreibschritt einzeln nach der ID. Das ist gewollt, aber ein Lauf verlangt dadurch mehrere Eingaben.
- **`dev-staging`** behält seine eigene Verriegelung (`checkStagingTarget` ohne feste ID). Es ist der Entwicklungsserver und kein Schreibwerkzeug.
- **Nichts lief gegen Staging oder Production.** Das Verhalten echter Läufe ist bis zur Bestätigung offline nachgewiesen, danach nicht.

---

## 8. M-04B (2026-11-09): Production-Sicherheit abgeschlossen (nicht committet)

### 8.1 Befunde und Korrekturen

| Werkzeug | Befund | Korrektur (gemeinsame Guards, nichts Paralleles) |
|---|---|---|
| `verify-commerce` | sandte gegen Production anonyme **Schreibproben**: `insert` auf `orders`, `order_lines` und `order_reservations` sowie 8 Aufrufe schreibender oder interner Funktionen (`reserve_for_order`, `next_order_number`, `release_expired_reservations` …). Bei kaputter RLS hätten sie geschrieben | `guardWriteTool(…, { apply: false })`. Die Schreibproben laufen nur, wenn das Ergebnis die **feste Staging-ID** ist. Auf Production werden sie als `SKIP … staging only` gemeldet und nie gesendet. Lese- und Integritätsprüfungen bleiben |
| `verify-seller` | anonyme Aufrufe von `seller_create_catalog_item` und `seller_import_catalog` gegen Production | dito. Auf Production werden die beiden Proben übersprungen und gezählt |
| `verify-legacy-history` (**neu gefunden**) | rief gegen Production `apply_reconciled_legacy_settlement` **mit dem Service-Key** sowie zwei `settle`-Funktionen anonym auf, jeweils mit unmöglicher ID. Bei kaputten Rechten liefe eine schreibende Funktion in Production | dito. Diese Proben laufen nur auf Staging |
| `perf-report`, `verify-legacy-history`, Vorschau von `sync-legacy-orderbook` | Guard nur mit Flag. Ein direkter `node`-Aufruf mit einem Production-Paar in `.env.staging` hätte Production gelesen | `guardWriteTool(…, { apply: false })`: Ohne `--env production` muss das Ziel die feste Staging-ID sein, unabhängig vom Flag |
| `verify-payment-smoke` | **schreibt nicht**. Nachgewiesen: Jede `.from(…)` endet in `.select(`, es gibt kein `insert`, `update`, `upsert`, `delete`, `rpc`, `invoke` und kein `fetch`. Der eigene URL-Vergleich hing aber an `.env.local` | eigener Vergleich ersetzt durch `requireStaging` (feste Staging-ID, beide Dateien, Origin und Key) |

Die `:prod`-Skripte `verify:commerce:prod`, `verify:seller:prod`, `verify:legacy-history:prod`, `perf:report:prod` und `sync:orderbook:prod` nennen jetzt `--env production`. Ein direkter `node`-Aufruf braucht dasselbe.

### 8.2 Production-Schreibpfade: ausgeschlossen und erlaubt

**Ausgeschlossen:**

- jeder Production-Schreibzugriff ohne `--env production --apply --confirm-production=<id>`, ohne feste ID, ohne stimmige Env-Dateien oder **ohne getippte ID am Terminal**;
- alle **schreibenden Prüfer** gegen Production: `verify-rls`, `verify-editorial`, `verify-inventory`, `verify-calculations`;
- alle **anonymen und Service-Schreibproben** in Lese-Prüfern gegen Production: `verify-commerce`, `verify-seller`, `verify-legacy-history`;
- jeder Lauf mit einem Production-Paar auf einem Staging-Pfad, auch beim direkten `node`-Aufruf und mit gesetztem oder fehlendem Flag;
- jede Bestätigung über ein npm-Skript, eine Pipe oder eine Umgebungsvariable.

**Absichtlich erlaubt** (nur mit der vollen Regel und getippter ID):

- `admin:grant`
- die Cutover-Werkzeuge per direktem `node`-Aufruf
- `catalog:sync:apply`, `catalog:finish:apply`, `catalog:publish`
- `storage:transfer:apply:production`
- `transfer:apply`
- `import-sales`

Lesend erlaubt: die `:prod`-Lese-Prüfer mit `--env production` und `images:export:prod`.

### 8.3 Tatsächlich ausgeführte Tests (offline)

- `src/lib/ops/production-write-guard.test.ts`: **139 Tests grün**, 25 davon neu in M-04B. Der neue Netzwerk-Ersatz protokolliert jede Anfrage mit Methode, Pfad und Key-Art und antwortet bei Lesezugriffen leer, sonst mit „verweigert“. So wird sichtbar, was ein Lauf gesendet **hätte**.
  - `verify-commerce` und `verify-seller`, je sechs Fälle:
    - Production ohne `--env`, Production-Paar auf dem Staging-Pfad, unbekanntes Projekt und falscher Key werden abgelehnt, **mit null Anfragen**.
    - Mit `--env production` laufen die Leseprüfungen, aber **keine einzige Schreibprobe** wird gesendet, und die übersprungenen Proben werden gemeldet.
    - Auf fester Staging-ID werden die Schreibproben **weiterhin gesendet**, die Staging-Prüfung bleibt also unverändert.
  - `perf-report`, `verify-legacy-history` und die `sync-legacy-orderbook`-Vorschau:
    - Production-Paar auf dem Staging-Pfad und Production ohne Namen werden abgelehnt, mit null Anfragen.
    - Mit `--env production` gibt es keinen `insert` und keinen Aufruf einer schreibenden Funktion.
    - `verify-legacy-history` sendet auf Staging weiterhin seine zwei Funktionsproben.
  - `verify-payment-smoke`: Ein Production-Paar auf dem Staging-Pfad wird abgelehnt. Ein statischer Nachweis bestätigt, dass nur `select` vorkommt.
  - Die Abdeckungswächter unterscheiden jetzt Lese-Guards (`{ apply: false }`) von Schreibpfaden. Die drei Lese-Prüfer müssen jede Schreibprobe an `WRITE_PROBES` binden.
- Angepasst wurden `legacy-sync-write-guard`, `perf/interaction` und `perf/telemetry`, jeweils strenger als vorher.
- **Regression: 59 betroffene Testdateien mit 2 324 Tests grün.** `tsc` ohne Fehler, `eslint` ohne neuen Befund (die eine Warnung ist alt, in `validate-check-sql.mts`), `git diff --check` sauber.
- **Kein** Lauf gegen Staging oder Production, keine vollständige Testsuite.

### 8.4 Offene Risiken

- **Getestet wurde nur offline.** Ein echter Production-Schreiblauf, ein echter Lese-Lauf und ein echter Staging-Lauf sind nicht ausgeführt.
- **`verify-shop`** liest mit dem Service-Key und hat weiterhin keinen eigenen Guard. Es schreibt nicht und ist nicht Teil von M-04B.
- **Katalog-Publish:** Jedes Kindwerkzeug fragt einzeln nach der ID. Das bedeutet mehrere Eingaben je Lauf.
- **`dev-staging`** behält seine eigene Verriegelung. Es ist der Entwicklungsserver und kein Schreibwerkzeug.
- **RLS und Grants** selbst sind weiterhin die eigentliche Sicherheitsgrenze. Die Guards verhindern Versehen, keine Angriffe.
