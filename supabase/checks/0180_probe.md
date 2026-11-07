# 0180 — Prüfstrategie B + C: die Übernahme auf Testverkäufen prüfen, ohne etwas zu hinterlassen

**Stand 2026-11-06: B auf Staging bestanden und abgenommen (32/32, zurückgerollt; `0180_staging_run.md`); A und C offen.** 0180 ist auf Staging
angewendet (`0180_staging_run.md`); R7 benennt jetzt das Betriebskonto (ADR-0178, Ergänzung). `APPLY_RELEASED` bleibt
`false`. Production: nicht betroffen, nicht angesprochen.

ADR-0178, Variante **B + C** (Entwurf vom 2026-11-05, freigegeben). 0180 und seine Regeln bleiben
**unverändert** — insbesondere weist der reguläre Weg Testverkäufe weiter ab (`test_sale`).

| Teil | Wo | Was es zeigt | Was nicht |
|---|---|---|---|
| **A** Ablehnungen über PostgREST | `npm run verify:recon-0180:staging -- --live` | Vorschau, Übernahme, alte Übernahme, anon — jede Ablehnung **vor** einem Schreiben; legt **nichts** an | eine Übernahme |
| **B** Prüflauf, zurückgerollt | Laufdatei `supabase/log/staging/0180-probe-lauf.sql` aus `npm run probe:recon-0180:staging` (SQL-Editor, `postgres`) | die ganze Übernahme mit den echten Staging-Funktionen: Token, Sperre, Audit, Rollback bei Fehler, Wiederholschutz, `unique` → nur Nummer, erneute Analyse, Erstattung, Storno, veraltet; regulärer Weg weiter gesperrt | zwei Verbindungen |
| **C** echte Parallelität | `npm run test:recon-pg` (lokal, eigener Cluster) | gleichzeitige Übernahme derselben Auswahl, Sitzungssperre, gekreuzte Verkäufe ohne Deadlock, Entscheidung während Übernahme, fremde Änderung → PT409, veralteter Token, genau eine Anwendung je Entscheidung | Supabase, PostgREST, Pooler |

Vollständig ist die Abnahme erst, wenn alle drei belegt sind: `verify-recon-0180.mts` meldet sonst
Exit 3 „unvollständig“ (`--evidence-b`, `--evidence-c`).

## B — die temporären Funktionen und ihre Unterschiede zu 0180

Erzeugt von `tools/build-recon-probe.mts` aus den Rümpfen in `0180_sales_recon_selected_apply.sql`.
Jede Ersetzung hat eine feste Trefferzahl; trifft sie anders, bricht der Erzeuger ab. Der Test
`recon-probe-0180.test.ts` macht jede Ersetzung rückgängig und verlangt den 0180-Rumpf zeichengleich
zurück, und jede geänderte Zeile muss eine dokumentierte Ersetzung tragen.

| Kopie (`pg_temp.`) | Original | Ersetzungen |
|---|---|---|
| `probe_sales_recon_take_check` | `sales_recon_take_check` | Name · **`if s.is_test then return 'test_sale'`** → `if not s.is_test or not exists (… pg_temp.probe_sales …) then return 'not_probe'` (×1) · `not s2.is_test` → `(not s2.is_test or s2.id in (… pg_temp.probe_sales …))` (×2: vergebene Nummer, Rivale) |
| `probe_sales_recon_decision_problem` | `sales_recon_decision_problem` | Name · ruft `probe_sales_recon_take_check` |
| `probe_sales_recon_selection` | `sales_recon_selection` | Name · ruft `probe_sales_recon_decision_problem` |
| `probe_seller_recon_preview` | `seller_recon_preview` | Name · ruft `probe_sales_recon_selection` |
| `probe_seller_recon_apply` | `seller_recon_apply(bigint, bigint[], text)` | Name · ruft `probe_sales_recon_selection` · `not s2.is_test` wie oben (×1, Nummernprüfung beim Schreiben) |
| `probe_seller_recon_decide` | `seller_recon_decide` | Name · ruft `probe_sales_recon_take_check` |

**Die eine fachliche Änderung ist umgekehrt, nicht gelockert:** die Kopie weist jeden Verkauf ab,
der NICHT ein Testverkauf ist, den dieser Lauf selbst angelegt und in `pg_temp.probe_sales`
eingetragen hat. Einen echten Verkauf kann sie nie erreichen. Gate, Sitzungssperre, Sperre der
Verkäufe in ID-Reihenfolge, Token, Stale-Prüfung, Audit (`sales_recon_applications`,
`orderbook_audit`), Schreibweg (`seller_update_sale` gegen die gesperrte Version) und alles oder
nichts sind zeichengleich die von 0180.

## B — Rechte

- Nichts Dauerhaftes: **kein** `create function` außerhalb von `pg_temp`, **kein** `grant`, kein
  `alter`, kein `drop`, keine Tabelle außer drei `temporary … on commit drop` (Test).
- Die 13 temporären Funktionen (6 Kopien, 7 Werkzeuge) liegen in `pg_temp` **dieser Sitzung** —
  keine andere Verbindung sieht sie; jede ist mit `revoke all … from public` für keine Clientrolle
  ausführbar (Prüfung 32). Die regulären Funktionen sprechen alles mit `public.` an und lesen
  `pg_temp` nie.
- Die Rechte jeder Funktion in `public` sind vorher und nachher zeichengleich (Test).
- Die Identität: `request.jwt.claims` / `request.jwt.claim.sub` **transaktionslokal**
  (`set_config(…, true)`) auf das **benannte** Betriebskonto (R7); danach muss `auth.uid()` es
  liefern und `can_operate_active_seller()` wahr sein, für ein fremdes Konto falsch, sonst Abbruch.
  Mit dem Rollback sind Identität und Benennung fort (Test, mit Stagings `auth.uid()`).

## B — die Riegel vor dem ersten Schreiben

| | Prüft | Sonst |
|---|---|---|
| R1 | Datenbankstempel `skyisles-staging qqxcpesbwfxzgytkdsac` (Production trägt keinen) | Abbruch |
| R2 | Rolle `skyisles_agent` existiert (nur Staging, `staging-agent-setup.sql`) | Abbruch |
| R3 | PostgreSQL 15–18 | Abbruch |
| R4 | md5 von 23 Rümpfen = Commit: die zehn von 0180, Lesen/Anlegen (0176, 0178, 0179), Sperre, `seller_update_sale`, Orderbuch-Helfer, Erstattung, Storno. Der Erzeuger gleicht die 0180-Werte mit der Nachbedingung von 0180 ab und verweigert, wenn eine spätere Migration eine der Funktionen neu definiert | Abbruch |
| R5 | **Nebenwirkungen:** kein Trigger auf den berührten Tabellen außer den vier bekannten (`sales_set_day_and_index_trg`, `sale_items_no_historical_movement_trg`, die zwei Nur-Erweitern-Trigger); keine Triggerfunktion, die `net.`, `http`, `dblink` oder `NOTIFY` nennt. Ein Dashboard-Webhook ist ein Trigger und fällt hier auf | Abbruch |
| R6 | jede Pflichtspalte von `sales`/`sale_items` ohne Vorgabe ist eine, die der Lauf setzt | Abbruch |
| R7 | das **benannte** Betriebskonto (`skyisles.probe_operator`, nur über die Laufdatei): gültige Kennung, genau eine freigeschaltete Mitgliedschaft beim aktiven Verkäufer (andere Konten zulässig); vorher keine Identität, Tor zu; mit Identität `auth.uid()` = Konto und Tor offen; Gegenprobe fremdes Konto → Tor zu; danach wieder das Konto | Abbruch |

Jeder Riegel ist im Test einzeln verletzt: Abbruch mit seinem Namen, danach jede Zeile und jede
Funktion wie vorher.

## B — Rollback-Verhalten

`begin` ist die erste Anweisung, **kein `commit`** in der Datei (auch kein `end`, `release`,
`prepare transaction`), `rollback` die letzte. Der Lauf endet mit einer Ausnahme, die jede Prüfung
einzeln nennt — `PRUEFLAUF 0180 ZURUECKGEROLLT — 32/32 bestanden | 1 ok … | 32 ok …` —, damit ist
die Transaktion abgebrochen; eine fehlgeschlagene Prüfung erscheint als `FEHLT`, der Lauf wird
trotzdem zurückgerollt. Es bleibt: **nichts** außer verbrauchten Sequenznummern (Lücken in den IDs,
in keinem Abdruck enthalten). Im Test: `everything()` (Verkäufe, Positionen, Erstattungen, alle
sieben Abgleichstabellen, Journal) vorher = nachher, keine temporäre Funktion, keine Hilfstabelle,
keine Identität übrig.

## B — unveränderte Daten

Prüfung 30 vergleicht innerhalb der Transaktion zehn Abdrücke vor und nach dem Lauf — Verkäufe,
Positionen, Erstattungen, Journal und Abgleich **außerhalb** der eigenen Zeilen, dazu Lager,
Lagerbewegungen und Altbestand vollständig. Prüfung 31: jede Prüfdatenzeile ist ein Testverkauf
dieses Laufs (`is_test`, Notiz `verify:recon-0180-probe <txid>`, 2001). Nach dem Lauf belegen die
Zustandsdatei und die 0180-Nachkontrolle von außen, dass nichts geblieben ist.

## Grenzen — ausdrücklich

- **`now()` ist in einer Transaktion fest.** Eine Orderbuch-Änderung im selben Lauf bewegte
  `updated_at` nicht. Prüfung 24 rückt die Version deshalb selbst weiter (`clock_timestamp()`,
  direkt auf den eigenen Testverkauf) — die Nachstellung einer fremden Änderung. Echte getrennte
  Transaktionen prüft C.
- **B hat eine Verbindung**: keine Parallelität auf Staging. C prüft sie auf einem echten
  PostgreSQL 17 — aber **nicht** über Supabases PostgREST und Pooler. Zwei HTTP-Aufrufe werden dort
  zu zwei Transaktionen, deren Sperren PostgreSQLs sind; der Weg davor ist nicht geprüft.
- **Die Prüfdaten legt B direkt an** (`insert`, Testverkauf, nur in dieser Transaktion), Erstattung
  und Storno über die regulären Funktionen; die Sitzungen über das reguläre `seller_recon_create`
  aus SQL-gebauten Analysedaten — Kategorie und Sicherheit behauptet der Lauf, 0180 prüft sie
  selbst. Den Abgleich in TypeScript (`match.ts`) prüft B nicht.
- **R4 gegen die Lokalwelt:** die md5-Werte sind die der Migrationsdateien. Weicht ein Rumpf auf
  Staging ab (eine nie erfasste Handänderung), bricht B ab — richtig so, aber dann ist zuerst der
  Stand zu klären.
- **R7 benennt das Konto.** Staging hat drei aktive Betriebskonten; B nimmt keines von selbst,
  sondern das Staging-Betriebskonto der Prüfwerkzeuge, dessen Kennung `npm run
  probe:recon-0180:staging` aus einer Anmeldung liest (ohne Service-Role; An- und Abmeldung sind
  Supabases eigene Buchführung in `auth`, sonst schreibt das Werkzeug nichts). Die versionierte
  Datei allein bricht in R7 ab. Die Simulation wechselt die Datenbankrolle nicht: B prüft das Tor,
  nicht die Grants für `authenticated` (Teil A).
- **Der SQL-Editor**: dass er `pg_temp`-Funktionen in einer Sitzung über das ganze Skript hält und
  die abschließende Ausnahme anzeigt, ist erst beim ersten Lauf zu sehen. Bricht er anders ab, ist
  trotzdem nichts geblieben.

## Abnahmefolge (jeder Schritt mit eigener Freigabe)

1. Lokal: `npm run test:recon-pg -- --reporter=json --outputFile=<datei-c>` grün (6/6).
2. Staging lesend: Zustandsdatei `verify_sales_reconciliation_state.sql` als `postgres` (vorher).
3. 0180 über `db:migrate:staging -- 0180` (Preflight, Einfügen, `--resume`, `db:privileges:staging`).
4. `npm run probe:recon-0180:staging` (schreibt Laufdatei und Vorprüfung nach `supabase/log/staging/`); die Vorprüfung `0180-probe-riegel-vorab.sql` als `postgres` (9999 = 0); dann die Laufdatei `0180-probe-lauf.sql` als `postgres` einfügen; die Meldung vollständig in `<datei-b>` sichern.
5. Zustandsdatei erneut (101–108 zeichengleich) und 0180-Nachkontrolle erneut (231–253 gleich).
6. `npm run verify:recon-0180:staging -- --live --evidence-b <datei-b> --evidence-c <datei-c>` → Exit 0.
7. Laufzettel `0180_staging_run.md`, `APPLIED.md`.
