# Automatisierter Staging-Zugang — Plan in drei Phasen

**Phase A ist fertig und getestet, aber nicht eingerichtet.** Kein Zugang
angelegt, keine Verbindung hergestellt, nichts committet. `pg` ist freigegeben
und installiert. Phase B und C sind Entwürfe.

**Production wird in Phase A nicht angefasst:** keine Zugangsdaten verschoben,
gelesen, importiert oder in einen Schlüsselbund übertragen; die 18
`:prod`-Skripte bleiben unverändert. Phase A funktioniert vollständig ohne
Production-Zugangsdaten.

| Phase | Was | Kanal | Rechte | Stand |
|---|---|---|---|---|
| **A** | rein lesende Staging-Prüfungen, ein Befehl | PostgreSQL-Sitzung | SELECT auf 12 Tabellen (je eigene Policy), EXECUTE auf 3 lesende Funktionen, Sitzung schreibgeschützt, **kein** `bypassrls` | **fertig, freigegeben, nicht eingerichtet** |
| **B** | gezielte Schreibtests über die bestehenden autorisierten APIs | `supabase-js` + Service-Role-Key | was die API erlaubt; echte Auth-Nutzer, echte RLS | Entwurf |
| **C** | Staging-Migrationen über einen gesondert abgesicherten Weg | PostgreSQL-Sitzung mit DDL-Rechten | mächtig — Passwort nur als Terminaleingabe, nirgends gespeichert | Entwurf |

---

## 1. Was heute da ist — geprüft, nicht angenommen

| Befund | Bedeutung |
|---|---|
| `psql`, `pg_dump`, Supabase CLI, Docker: **alle nicht vorhanden** | es gibt heute **keinen** Weg, SQL gegen Staging auszuführen |
| Node-Abhängigkeiten: `@supabase/supabase-js`, kein Postgres-Treiber | REST/RPC geht, **DDL nicht** |
| `.env.staging`: URL, Anon-Key, Service-Role-Key — **kein Datenbankpasswort** | der Service-Role-Key ist kein Datenbankzugang |
| `.env.local` enthält die **Production**-Zugangsdaten, im Arbeitsverzeichnis | **heute erreichbar.** `npm run env:audit` zählt es auf: 18 Skripte zeigen darauf |
| `tools/lib/staging-guard.mts`: zwei Identitäten, exakt verglichen, Allowlist | die tragende Schicht für Kanal A ist gebaut |
| `npm run verify:check-sql`: 4 Stufen, 47 Prüfdateien, 361 Funktionsrümpfe, 14 Probeläufe | der lokale Trockenlauf ist streng und bleibt die Vorstufe jedes Staging-Laufs |
| **alle 12** Tabellen führen RLS, und **jede** vorhandene Policy ist `to anon, authenticated` gebunden | eine neue Rolle passt auf keine davon und sähe **null Zeilen**. Nachgemessen: eine eigene SELECT-Policy je Tabelle genügt — `bypassrls` ist **nicht** erforderlich |

---

## 2. Die Optionen, und warum eine gewinnt

| Option | Kann DDL? | Erreicht Production? | Urteil |
|---|---|---|---|
| **A. Direkte PostgreSQL-Sitzung** (`pg`, Session-Pooler, eigene Rolle) | ja | **nein, aus Konstruktion**: die Projektkennung steht im Benutzernamen bzw. Host | **empfohlen** |
| B. Supabase CLI | ja | nur das verlinkte Projekt, aber `supabase link` ist globaler Zustand | **nein, heute nicht** — 136 Migrationen sind von Hand angewendet und in `APPLIED.md` belegt; die CLI führt ihre eigene `schema_migrations`. Zusammenführen ist ein eigenes Vorhaben |
| C. Management-API / Supabase-MCP | ja | **ja** — beide brauchen ein Personal Access Token, und ein PAT gilt fürs **ganze Konto** | **nein**, verletzt Anforderung 2 und 3 unmittelbar |

Nicht erwogen: eine `exec_sql`-Funktion in der Datenbank — sie machte den
Service-Role-Key zu einem Superuser-Äquivalent.

---

## 3. Phase A — der lesende Prüfzugang

### Ein Befehl

```bash
npm run db:check:staging                 # die ganze Suite
npm run db:check:staging 0135            # nur die Dateien, deren Name das enthält
```

Er fährt die Dateien aus **`supabase/checks/staging-suite.json`** — eine
Quelle, aus der sich auch die Rechteliste ableitet:

| Datei | Modus |
|---|---|
| `staging_pending_migrations.sql` | 9999 = 0 |
| `receipt_lock_check.sql` | 9999 = 0 |
| `0131_function_body_check.sql` | 9999 = 0 |
| `0132_postflight.sql` | 9999 = 0 |
| `0135_preflight.sql` | 9999 = 0, Z0-Vertrag, nur solange `item_type` fehlt |
| `0135_postflight.sql` | 9999 = 0, Z0-Vertrag, nur wenn `item_type` steht |
| `0136_preflight.sql` | 9999 = 0, Z0-Vertrag, nur wenn Sicherung = Stand `0131` |
| `0136_postflight.sql` | 9999 = 0, Z0-Vertrag, nur wenn Sicherung = Stand `0136` |
| `state_audit_readonly.sql` | Messung ohne Sollwert |

**Derselbe Befehl bleibt vor und nach jeder Migration richtig:** jede Datei
trägt eine lesende Vorbedingung (`wenn`), und ist sie nicht erfüllt, wird die
Datei **mit Grund übersprungen** statt zu scheitern.

**Den Z0-Vertrag setzt das Werkzeug selbst** (`skyisles.z0 = staging`), in
derselben Einreichung wie die Prüfdatei. Genau daran ist S1 von Hand
gescheitert.

### Die Rechte: 12 Tabellen, 3 Funktionen — ausgezählt

```bash
npm run db:grants:plan          # der Rechteplan, aus den Prüfdateien gelesen
```

`tools/lib/grant-plan.py` parst die Suite mit `pglast` und zählt zusammen, was
sie wirklich anfasst: **12 Tabellen** (SELECT) und **3 Funktionen** (EXECUTE —
`is_shop_eligible`, `non_collectible_categories`, `shop_offers`). Kein
`pg_read_all_data`, kein CREATE, kein INSERT/UPDATE/DELETE, keine Belegfunktion.

CTE-Namen, die wie Tabellen aussehen, werden abgezogen; `pg_catalog` und
`information_schema` stehen nicht in der Liste, weil sie für PUBLIC ohnehin
lesbar sind — darauf ruht der größte Teil dieser Prüfungen.
`src/lib/admin/staging-access.test.ts` rechnet die Liste bei jedem Testlauf
gegen den Einrichtungsschritt nach: **wächst die Suite, fällt der Test** —
lokal, nicht erst mit `42501` im Lauf.

#### Kein `bypassrls` — nachgemessen, nicht behauptet

Alle zwölf Tabellen führen RLS, und jede vorhandene Policy ist
`to anon, authenticated` gebunden. Eine neue Rolle passt auf keine davon. Die
Frage, ob daraus `bypassrls` folgt, ist in PostgreSQL 18.6 mit demselben
Aufbau nachgemessen worden:

| Aufbau | Ergebnis |
|---|---|
| Rolle mit SELECT, **ohne** Policy, ohne `bypassrls` | **0 von 2** und **0 von 3** Zeilen |
| Rolle mit SELECT, **mit** Policy `to <rolle>`, ohne `bypassrls` | **2 von 2** und **3 von 3** |
| dieselbe Rolle: `insert`, `update`, `delete`, `create table`, `alter table` | **42501**, trotz Policy |
| für `anon` ändert sich durch die neue Policy | **nichts** |

Also: **kein `bypassrls`.** Die Rolle bekommt je Tabelle eine eigene
SELECT-Policy `agent_read_<tabelle>`, auf `skyisles_agent` und auf `select`
begrenzt. Eng, benannt, einzeln rücknehmbar — und ohne Wirkung auf bestehende
Rollen, Policies oder Rechte. Der Preis ist Pflege: eine neue Tabelle braucht
Grant **und** Policy, und beides zählt `grant-plan.py` aus.

#### Der Abbruch vom 2026-10-19 — und was er über die Prüfung sagte

Der erste Lauf des Einrichtungsschritts endete mit

```
ERROR P0001: ABBRUCH: eine andere Rolle ist Mitglied von skyisles_agent
```

**Die Abfrage war richtig, die Erwartung war falsch.** `pg_auth_members`
benennt die Richtung nicht von selbst:

| | Bedeutung | Bewertung |
|---|---|---|
| `m.member = skyisles_agent` | der Zugang ist Mitglied von X → **er gewinnt fremde Rechte** | bleibt ein Abbruch |
| `m.roleid = skyisles_agent` | X ist Mitglied des Zugangs → **X gewinnt die Rechte des Zugangs** | kommt von PostgreSQL selbst |

**Ursache, nachgemessen in PostgreSQL 18.6:** legt ein Nutzer mit `CREATEROLE`
**ohne** Superuser-Recht eine Rolle an — genau die Lage im Supabase-Dashboard —,
dann macht PostgreSQL ihn automatisch zum Mitglied der neuen Rolle:

| erzeugt als | Mitgliedschaft | `admin` | `inherit` | `set` |
|---|---|---|---|---|
| Superuser | keine | — | — | — |
| `CREATEROLE`, kein Superuser | Ersteller → neue Rolle | **true** | **false** | **false** |

Ohne `inherit` erbt der Ersteller nichts, ohne `set` kann er die Rolle nicht
annehmen — nachgemessen scheitert `set role` in **beide** Richtungen mit
`42501`. Es ist ein **Verwaltungsgriff**, kein Rechteweg, und ohne ihn könnte
der Dashboard-Nutzer die von ihm erzeugte Rolle später nicht einmal ändern
oder löschen.

**Geprüft wird jetzt das Gefährliche statt des Unvermeidlichen:**

* Richtung 1 (`agent ist Mitglied von …`) → **0**, sonst Abbruch.
* Mitglieder **des** Zugangs → als Hinweis aufgezählt, mit Grantor und allen
  drei Optionen.
* ein Mitglied, das **nicht der Ersteller** ist → Abbruch.
* eine Mitgliedschaft mit `inherit` **oder** `set` → Abbruch.

Versionsverträglich über `to_jsonb(m) ->> 'set_option'`: die beiden Spalten
gibt es erst ab PostgreSQL 16, und ein `42703` wäre der falsche Befund.

**Und der Einrichtungsschritt ist jetzt wiederholbar.** Besteht die Rolle
schon, werden Attribute und Passwort gesetzt statt abgebrochen — ein Abbruch
in der Nachbedingung darf den zweiten Versuch nicht unmöglich machen. Dazu
drei Prüfungen am Passwort (Präfix, Länge ≥ 32, nur Buchstaben und Ziffern);
die Zeichenmenge ist nicht Geschmack, sondern verhindert an der Quelle, dass
ein `#` die Verbindungszeichenkette zerlegt.

Nachgefahren: `verify:check-sql` **P18** (Ersteller erlaubt, `inherit`/`set`
und fremde Rollen nicht) und **P19** (die Diagnosedatei benennt beide
Ausgänge und schlägt bei `inherit` an).

#### Die effektiven Rechte, nicht die erteilten

Abschnitt 3 des Einrichtungsschritts prüft mit `has_table_privilege` und
`has_function_privilege` — die rechnen eigene Grants, Grants an **PUBLIC** und
jede **Rollenmitgliedschaft** zusammen. Geprüft wird, rein lesend:

* **kein** `insert`/`update`/`delete`/`truncate`/`references`/`trigger` auf
  **irgendeiner** Relation in `public` — nicht nur auf den zwölf, denn eine
  Standardberechtigung könnte Schreibrecht auf einer ganz anderen Tabelle
  geben;
* **keine Rollenmitgliedschaft**, in keiner Richtung (`pg_auth_members`);
* **kein EXECUTE** auf `seller_issue_purchase_receipt`,
  `…_correction`, `seller_business_backup`, `system_platform_export`,
  `purchase_receipt_fingerprint` — alle fünf haben PUBLIC ausdrücklich
  entzogen bekommen, und hier wird nachgesehen, dass das noch gilt;
* EXECUTE auf **genau** den drei lesenden Funktionen;
* lesbare Relationen außerhalb der zwölf werden als **Hinweis** aufgezählt —
  ein Grant an PUBLIC dort wäre bestehend und nicht von dieser Datei gesetzt.

#### Was die Rolle über PUBLIC ausführen könnte — vollständig aufgezählt

`npm run db:acl:audit` faltet die Migrationshistorie **in Textreihenfolge**
(ein `drop function` wirkt dort, wo es steht) und beantwortet für jede der
**337** lebenden Funktionen: hat irgendeine Migration PUBLIC das EXECUTE
entzogen, schreibt sie, und steht ein Berechtigungstor **vor** dem ersten
Schreibvorgang.

| Gruppe | Zahl | Bedeutung für `skyisles_agent` |
|---|---|---|
| PUBLIC entzogen | **287** | nicht aufrufbar |
| Triggerfunktionen | **30** | direkt nicht aufrufbar (`0A000`) |
| schreibend, Tor **vor** dem Schreiben | **19** | aufrufbar, bricht ab |
| lesend, harmlos | **4** | `orderbook_normalise` und `sale_item_is_closed` sind `immutable` und fassen keine Tabelle an; `seller_sale_audit` und `seller_sale_fingerprints` sind `security definer`, beginnen aber ebenfalls mit dem Tor |
| **schreibend ohne Tor** | **0** | — |

Das Tor wird **positionsgenau** verlangt: `tor_pos < schreib_pos`. Ein
`can_operate_active_seller()` hinter dem ersten `insert` zählt nicht.

**Und das wird ausgeführt, nicht nur gelesen.** `verify:check-sql`, Probelauf
**P17**: die echten Funktionsrümpfe in PostgreSQL 18.6, die Rolle
`skyisles_agent`, `auth.uid()` NULL — dann werden **alle 21** aufgerufen (19
schreibende + die 2 `security definer`-Leser). Ergebnis: **21 von 21** mit
„seller operator role required" abgewiesen, **keine Zeilenzahl bewegt** (über
9 Tabellen gemessen). Das ist der Unterschied zwischen „im Rumpf steht ein
Tor" und „die Rolle kommt nicht durch".

**Ein Fehler im Audit selbst, gefunden und behoben:** die erste Fassung
sammelte je Datei erst alle `create`, dann alle `drop` — und `0063` droppt
`seller_create_sale(6 Argumente)` unmittelbar **vor** dem `create` mit sieben.
Drei schreibende Funktionen (`seller_create_sale`, `seller_set_sale_date`,
`seller_set_sale_payout`) fehlten damit im Bericht, der „kein Befund" meldete.
Ein Audit, das seinen Gegenstand verliert, meldet immer „kein Befund".

**Es sind keine Änderungen an bestehenden PUBLIC-Berechtigungen nötig.** Diese
Rechte sind bestehend, jede erreichbare Schreibfunktion ist verriegelt, und
der Einrichtungsschritt ändert daran nichts.

### Vier Riegel, unabhängig voneinander

1. **Die Verbindungszeichenkette** (`pruefeVerbindung`, reine Funktion). Die
   Production-Kennung `zmiwxswrpkmizvqsgype` darf **nirgends** darin stehen —
   nicht im Host, nicht im Benutzernamen, nicht in einem Parameter. Und
   zugelassen sind genau zwei Formen, exakt verglichen statt per
   Teilstringsuche:

   | | Session-Pooler (empfohlen) | direkt |
   |---|---|---|
   | Benutzer | `skyisles_agent.qqxcpesbwfxzgytkdsac` | `skyisles_agent` |
   | Host | `*.pooler.supabase.com` | `db.qqxcpesbwfxzgytkdsac.supabase.co` |
   | Port | `5432` | `5432` |
   | Datenbank | `postgres` | `postgres` |
   | TLS | `?sslmode=require` (oder `verify-full`) | ebenso |

   Der Pooler (Supavisor) liest den Benutzernamen als `rolle.tenant` — **die
   Projektkennung ist Teil des Zugangs**, nicht eine Angabe daneben. Ein
   `postgres`-Benutzer in dieser Variablen ist eine Verweigerung, kein
   Sonderfall, und der Transaktions-Pooler auf 6543 ebenfalls.

   **`sslmode` ist Pflicht**, weil `pg` ohne ihn **unverschlüsselt**
   verbindet — nachgemessen an der installierten Fassung: ohne `sslmode` ist
   `connectionParameters.ssl` falsy, mit `sslmode=require` ist TLS an. Dass
   ein ausdrückliches `ssl`-Argument dann **ignoriert** wird, ist ebenfalls
   nachgemessen; das Werkzeug übergibt deshalb keines, statt eine Einstellung
   zu behaupten, die nicht gilt.

   Und ein `#` im Passwort wird am **Rohtext** abgelehnt: `new URL` schneidet
   dort ab und liest ein falsches Passwort, `pg` scheitert mit `Invalid URL` —
   zwei Leser, zwei Ergebnisse. `:` und `@` sind dagegen **kein** Fehler
   (beide Parser stimmen überein), und ein Riegel, der Richtiges ablehnt, wird
   umgangen.
2. **Der Umgebungsstempel**, erste Anweisung der Sitzung:
   `shobj_description` der Datenbank muss `skyisles-staging qqxcpesbwfxzgytkdsac` lauten. **Production trägt keinen Stempel**, und „kein Stempel"
   ist der Fall, den die Verweigerung namentlich nennt.
3. **`default_transaction_read_only = on`**, an der **Rolle** gesetzt. Ein
   Schreibversuch endet mit `25006`, unabhängig von Rechten und unabhängig
   davon, welches Werkzeug ihn schickt. Das Werkzeug liest zurück, dass die
   Sitzung wirklich schreibgeschützt ist, und bricht sonst ab. Dazu: die Rolle
   hat **kein** Schreibrecht, **kein** CREATE, **kein** `bypassrls` und keine
   Mitgliedschaft.
4. **`begin … rollback` je Datei**, zusätzlich `set transaction read only`.

Dazu: **das Werkzeug hat keinen Production-Pfad.** Kein `--env`, keine
Verzweigung, kein Modus. Was es nicht kann, kann es nicht aus Versehen.

### Das Protokoll

Je Lauf eine Datei unter `supabase/log/staging/`: Projekt, Stempel, je Datei
SHA-256, Status, Zeile 9999, Dauer, und für jede Abweichung die vollständige
Prüfzeile (`nr`, Bereich, Prüfung, Befund, erwartet).

**Keine Zugangsdaten, keine personenbezogenen Daten.** Die Prüfdateien geben
Zählstände, Prüfsummen und Prüfzeilen aus — keine Namen, keine Adressen. Und
jede Ausgabe läuft durch `redigiere()`: Verbindungszeichenketten, JWTs,
Supabase-Schlüssel und Passwortzuweisungen werden ersetzt, auch in
Treiberfehlern. Sechs Tests halten das fest.

### Was bereits bewiesen ist — ohne Zugangsdaten

`src/lib/admin/staging-access.test.ts` (41 Tests) fährt **denselben Code**, der
später gegen Staging arbeitet, gegen **PGlite**:

* jede Verweigerung von Riegel 1 und 2, einzeln,
* der Z0-Vertrag kommt in derselben Transaktion an — und ist danach wieder fort,
* eine Abweichung wird erkannt und die auffällige Zeile benannt,
* eine nicht erfüllte Vorbedingung überspringt statt zu scheitern,
* ein Schreibversuch wird abgelehnt und hinterlässt nichts,
* der Einrichtungsschritt läuft vollständig durch, die Rolle liest danach
  wirklich (3 von 3 Zeilen) **ohne `bypassrls`**, und Schreiben sowie
  `seller_business_backup()` enden mit `42501` (`verify:check-sql`, P15),
* ohne die Policy liest sie 0 Zeilen, und bei offener Belegsperre bricht der
  Einrichtungsschritt ab (P16),
* ein SQL-Fehler bricht den Lauf nicht ab: es wird zurückgerollt, damit die
  **nächste** Datei nicht an `25P02` scheitert,
* Bericht und Protokoll verraten kein Geheimnis.

Zwei echte Fehler in meinem Werkzeug hat dieser Lauf gefunden, bevor es eine
Verbindung gab: Zeile 9999 wurde als eigene Abweichung mitgezählt, und nach
einem Fehler blieb die Transaktion offen.

---

## 4. Phase B — Schreibtests über die bestehenden autorisierten APIs

**Kein neuer Zugang.** Phase B benutzt, was es gibt: `@supabase/supabase-js`
mit dem Service-Role-Key aus `.env.staging`, abgesichert durch
`requireStaging()`. `tools/verify-rls.mts` macht es seit Monaten so — echte
Auth-Nutzer, echte Anmeldung, echte RLS, echte `security definer`-Funktionen.

Das ist der **richtige** Weg für H1–H12: die Fälle sollen den
Autorisierungspfad beweisen, nicht ihn umgehen. Eine Datenbanksitzung könnte
sie gar nicht fahren — jede schreibende Verkäuferfunktion beginnt mit
`can_operate_active_seller()`, und dort ist `auth.uid()` NULL.

**Grenzen, maschinell:**

* Schreiben nur auf **Fixturen** (`SKY-9000`+) und auf Zeilen, die derselbe
  Lauf angelegt hat.
* **Wirkungsgrenze**: überschreitet ein Testlauf sein angemeldetes Budget
  (Standard 50 Zeilen), wird abgebrochen und zurückgenommen.
* Nach jedem Lauf **automatisch** die Abschlussprüfung aus Phase A:
  `receipt_lock_check.sql`, `0132_postflight.sql`,
  `staging_pending_migrations.sql`.
* **Niemals** an historischen Originaldaten: `purchases`, `purchase_items`,
  `inventory_movements`, `purchase_receipts*` sind für den Testpfad gesperrt,
  außer an Zeilen, die der Lauf selbst erzeugt hat.

---

## 5. Phase C — Migrationen über einen gesondert abgesicherten Weg

**Das Problem, klar benannt:** eine Migration braucht DDL-Rechte, und DDL
heißt auf Supabase praktisch `postgres`. Diese Zugangsdaten dürfen nach
Anforderung 3 **nicht frei im normalen Prozess liegen** — und eine Datei, die
derselbe Prozess lesen kann, ist keine Grenze.

**Der Entwurf: zwei Prozesse, eine Freigabe pro Lauf.**

1. **Ich bereite vor** — vollautomatisch, ohne jeden Zugang:
   Migrationsdatei, Pre- und Postflight, Trockenlauf gegen PGlite
   (`verify:check-sql`), Anweisungsklassifikation gegen die Policy, und eine
   **Laufanforderung** unter `supabase/log/staging/` mit SHA-256 jeder
   beteiligten Datei und dem erwarteten Ergebnis.
2. **Sie lösen aus** — ein Befehl, den Sie starten:

   ```bash
   npm run db:apply:staging -- 0133
   ```

   Er fragt das DDL-Passwort **am Terminal** ab (verdeckte Eingabe) und hält
   es nur im Speicher dieses einen Prozesses. **Es liegt nirgends auf dieser
   Maschine** — nicht in einer Datei, nicht im Schlüsselbund, nicht in einer
   Umgebungsvariablen.

   **Korrektur eines früheren Vorschlags:** ich hatte den macOS-Schlüsselbund
   als Grenze vorgeschlagen. Das war falsch. Läuft der Agent unter derselben
   Benutzerkennung, ist die Rückfrage **keine garantierte menschliche
   Freigabe**: ein Eintrag, dessen ACL das aufrufende Programm kennt oder dem
   „Always Allow" erteilt wurde, wird ohne Rückfrage ausgelesen. Die einzige
   Grenze, die im selben Benutzerkontext trägt, ist, dass das Geheimnis **nicht
   vorhanden** ist. Deshalb die Eingabe am Terminal.
3. **Danach läuft alles wieder automatisch**: Preflight (`9999 = 0`, sonst
   Abbruch), `begin … commit`, Postflight, Abschlussprüfung, Protokoll,
   Vorschlagszeile für `APPLIED.md`.

**Was der Weg verweigert, maschinell und vor der ersten Anweisung:**
`drop table`, `drop schema`, `truncate`, `drop column`, `alter column … type`,
`delete`/`update` ohne `where`, jedes Schreiben auf die vier historischen
Tabellen, `grant`/`revoke` auf die Belegfunktionen, `create`/`alter`/`drop
role`, `alter … owner`, `create extension`, alles in `auth`, `storage`,
`vault`. Erlaubt ohne Rückfrage bleibt, was der Betreiber freigegeben hat:
neue Spalte, neue Funktion, neuer Index, Kommentar.

**Die Alternative, falls Ihnen auch das zu viel ist:** die Migration
bleibt im SQL-Editor, und automatisiert wird nur der Rahmen — Trockenlauf,
Preflight, Postflight, Abschlussprüfung und Protokoll laufen über Phase A. Der
Gewinn gegenüber heute ist dann schon groß: von sieben manuellen Schritten
bleibt einer.

### Diese Alternative ist gebaut — 2026-10-25 (ADR-0137)

```bash
npm run db:migrate:staging -- 0146            # prüft, friert ein, hält an
#   … die eine Anweisung in den SQL-Editor einfügen …
npm run db:migrate:staging -- 0146 --resume   # Nachkontrolle
```

`tools/db-migrate-staging.mts` fährt über **denselben lesenden Zugang** wie
Phase A — kein zweiter Zugang, kein DDL-Passwort, kein neues Geheimnis auf
dieser Maschine. Er prüft den Stand, fährt den Preflight, friert dessen
Vertragszeilen **unveränderbar** nach `supabase/baselines/` ein und reicht sie
der Nachkontrolle in derselben Einreichung mit.

**Der Anlass war kein Wunsch nach Bequemlichkeit, sondern ein Fehlermodus.**
Bei `0145` und `0146` ist das Kopieren der Baselines übersprungen worden, und
beide Male meldete die Nachkontrolle achtzehn Abweichungen — ausschließlich
die der Übergabe. Ein Handgriff, der zweimal in Folge vergessen wird, gehört
nicht auf den Laufzettel.

**Phase C bleibt damit offen und unnötig.** Der Weg mit DDL-Passwort am
Terminal ist nicht gebaut; der Gewinn wäre ein eingespartes Einfügen, der
Preis ein Prozess mit `postgres`-Rechten. Solange das Verhältnis so steht,
bleibt es bei dieser Alternative.

---

## 6. Das Freigabemodell

| Ohne Rückfrage (Staging) | Mit Ihrer ausdrücklichen Freigabe |
|---|---|
| alle lesenden Prüfungen (Phase A) | destruktive Migrationen |
| nichtdestruktive Migrationen: neue Spalte, Funktion, Index, Kommentar (Phase C, Lauf von Ihnen ausgelöst) | Datenmigrationen mit breiter Wirkung (> 50 Zeilen) |
| isolierte Schreibtests auf Fixturen (Phase B) | jede Änderung an `purchases`, `purchase_items`, `inventory_movements` |
| Rücknahme eines eigenen, fehlgeschlagenen Laufs | jede Änderung an Belegrechten, Belegtabellen, Belegtriggern |
| eigene Testfixturen anlegen und entfernen | Freigabe B / `RECEIPT_ISSUANCE_RELEASED` |
|  | Datenbank-Reset, Rollenänderungen, Erweiterungen |

**Production: nichts.** Keine Zeile, keine Prüfung, keine Verbindung.
Production-Migrationen bleiben **separate SQL-Dateien** für Ihre manuelle
Ausführung — künftig mit dem Staging-Protokoll als Beilage.

---

## 7. Die Einrichtung von Phase A — vier Schritte

### Schritt 1 · Verbindungsdaten holen (Dashboard, Staging)

*Settings → Database → Connection string → **Session pooler*** (Port 5432).
Host und Benutzernamensform notieren. **Nicht** der Transaktions-Pooler auf
6543: dort bekommt jede Transaktion eine andere Serververbindung, und der
Stempel wäre nur für die erste geprüft.

### Schritt 2 · `supabase/operations/staging-agent-setup.sql` ausführen

Im SQL-Editor **von Staging**, in einem Durchgang. Liegt vorbereitet im
Repository und tut vier Dinge: Umgebungsstempel setzen, Rolle
`skyisles_agent` anlegen (schreibgeschützte Sitzung, kein `bypassrls`), die
12 SELECT- und 3 EXECUTE-Rechte erteilen, und je Tabelle eine SELECT-Policy
`agent_read_<tabelle>` anlegen. Vorher im Editor den Passwort-Platzhalter
ersetzen — **ein neues, langes, zufälliges Passwort, nicht das des
Dashboard-Nutzers.** Die Datei danach nicht speichern.

Die Datei **ändert nichts Bestehendes**: kein `revoke execute`, kein
`alter role` für eine andere Rolle, kein `grant` an `anon`, `authenticated`,
`service_role` oder `postgres`, kein `drop policy`. Abschnitt 0 bricht ab,
wenn der Umgebungsstempel fehlt; Abschnitt 3 prüft rein lesend die
**effektiven** Rechte und bricht ab, wenn die Rolle mehr kann als vorgesehen
oder die Belegsperre nicht mehr dicht ist.

Erwartete Schlussmeldung:

```
OK: skyisles_agent angelegt — SELECT auf 12 Tabellen mit je eigener Policy,
EXECUTE auf 3 lesende Funktionen, kein bypassrls, kein Schreibrecht auf
irgendeiner Tabelle, keine Mitgliedschaft, Sitzung schreibgeschuetzt.
Die Belegsperre ist unveraendert und dicht.
```

Bricht **Abschnitt 1** mit `42501 must be owner of database` ab, gehört die
Datenbank nicht dem Dashboard-Nutzer: dann diesen einen Abschnitt
überspringen und es mir melden — der Riegel ruht dann auf der Zugangsbindung
und dem Datenstempel.

### Schritt 3 · Die eine Zugangsdatei anlegen

```bash
mkdir -p ~/.skyisles && chmod 700 ~/.skyisles
printf 'SKYISLES_STAGING_DB_URL=%s\n' '<URL aus Schritt 1 mit dem neuen Passwort>' \
  > ~/.skyisles/staging-db.env
chmod 600 ~/.skyisles/staging-db.env
```

**An die URL gehört `?sslmode=verify-full`**, ausgeschrieben (ADR-0138).
`require` wird abgelehnt: in `pg` 8.23 ist es noch ein Alias für
Vollprüfung, ab `pg` v9 bekommt es libpq-Semantik und prüfte das Zertifikat
nicht mehr.

### Schritt 3b · Die CA des Poolers holen — einmal je Rechner

Der Session-Pooler präsentiert eine **private** Kette:

```
*.pooler.supabase.com  ←  Supabase Intermediate 2021 CA
                       ←  Supabase Root 2021 CA   (selbstsigniert)
```

Diese Wurzel steht in keinem öffentlichen Vertrauensspeicher. Ohne sie endet
der Handschlag mit `self-signed certificate in certificate chain` — es fehlt
die **CA**, nicht die Verschlüsselung.

1. Dashboard → Project Settings → Database → **SSL Configuration** →
   *Download certificate*. Die Datei heißt `prod-ca-2021.crt`.
2. Ablegen und sichern:

```bash
mv ~/Downloads/prod-ca-2021.crt ~/.skyisles/supabase-ca.crt
chmod 600 ~/.skyisles/supabase-ca.crt
# Gegenprobe — muss 807025ad50d4ed21… ergeben:
openssl x509 -in ~/.skyisles/supabase-ca.crt -outform der | shasum -a 256
```

**Warum aus dem Dashboard und nicht aus der Verbindung.** Die Kette, die der
Server präsentiert, ist keine Vertrauensquelle: wer die Verbindung umlenkt,
liefert seine eigene Wurzel mit. Der Download ist der unabhängige Weg; der
Abdruck oben ist nur die Gegenprobe, dass beide dasselbe meinen.

Ein anderer Pfad geht mit `SKYISLES_STAGING_DB_CA`. Die Datei ist **kein
Geheimnis** — ein CA-Zertifikat ist öffentlich; sie liegt außerhalb des
Repositorys, weil sie rechnerlokale Einrichtung ist und keine Projektdatei.

**Production bleibt unangetastet.** `.env.local` bleibt liegen, die 18
`:prod`-Skripte bleiben, wie sie sind. Phase A liest, verschiebt und
importiert **keine** Production-Zugangsdaten — sie braucht genau eine
Variable, `SKYISLES_STAGING_DB_URL`, und drei Tests halten fest, dass die
Phase-A-Dateien weder `.env.local` noch eine Production-Datei noch den
Schlüsselbund anfassen.

Die Absicherung von Production ist ein **eigenes Vorhaben** — und eines, für
das es im selben Benutzerkontext keine einfache Lösung gibt (siehe Abschnitt 8).

### Schritt 4 · Abnehmen

```bash
npm run env:audit            # zwei blockierende Punkte, beide müssen OK sein
npm run db:check:staging     # der erste Lauf, rein lesend
```

`npm run env:audit` liest **keine** Zugangsdaten — es prüft Vorhandensein,
Dateirechte und Verweise. **Zwei** Punkte entscheiden (Staging-Datei
vorhanden und `chmod 600`; keine Production-Kennung in dieser
Prozessumgebung); der heutige Production-Zustand steht als **Information**
daneben und ist kein Fehler. `pg` ist freigegeben und installiert.

---

## 8. Grenzen — benannt, nicht verschwiegen

* **Im selben Benutzerkontext gibt es keine Dateigrenze.** Weder Dateirechte
  noch der Schlüsselbund sperren einen Prozess dieses Benutzers zuverlässig
  aus. Die einzige tragende Grenze ist, dass ein Geheimnis **nicht vorhanden**
  ist — und genau so ist Phase A gebaut: sie kennt kein Production-Zugangsdatum
  und braucht keines. Die Absicherung von Production bleibt ein eigenes
  Vorhaben; ernsthafte Optionen sind eine zweite Benutzerkennung, ein
  Hardware-Token oder die Credentials gar nicht auf dieser Maschine zu halten.
* **Der Prüfzugang hat kein erhöhtes Recht.** Kein `bypassrls`, kein
  `pg_read_all_data`, keine Mitgliedschaft, kein Schreibrecht auf irgendeiner
  Relation — nachgeprüft über die effektiven Rechte. Was er sieht, sieht er
  über zwölf benannte SELECT-Policies.
* **Der Stempel schützt gegen Verwechslung, nicht gegen Absicht.**
* **Phase C bleibt mächtig.** Die Grenze dort ist, dass das Passwort am
  Terminal eingegeben wird und nirgends liegt — plus Policy, Trockenlauf und
  Protokoll. **Nicht** die Datenbank. Eine Rechtegrenze auch für DDL hieße, die
  Eigentümerschaft von über 300 Funktionen zu übertragen: eigenes Vorhaben,
  eigenes Risiko.
* **Ein grüner Staging-Lauf ist kein Production-Nachweis.** Andere
  Datenmengen, andere Rechte, andere Historie.

---

## 9. Was als Erstes läuft

1. Phase A einrichten (Abschnitt 7), erster Lauf `npm run db:check:staging`.
2. `0133` und `0134` auf Staging — nichtdestruktiv, über Phase C.
3. `0135`, dann `0136` nach `0135_0136_staging_run.md`, nur automatisiert.
4. H1–H12 als Phase-B-Schreibtests über echte Auth-Nutzer.

Danach je Schritt ein kompakter Bericht: was lief, was die Prüfzeilen sagten,
welche Zahlen sich bewegt haben, was offen bleibt.
