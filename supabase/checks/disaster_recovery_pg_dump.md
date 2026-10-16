# Vollständige logische Sicherung mit `pg_dump` und isolierter Restore-Test — Plan

**Nichts davon ist ausgeführt.** Keine Production-Verbindung, kein Download,
keine Änderung. Dieses Dokument ist der Plan und die Liste der Handschritte.

Anlass: Production läuft auf **Supabase Free** — keine nativen Backups, kein
PITR, und das bleibt so. Damit ist eine selbst erzeugte logische Sicherung die
**einzige** Stufe 2 im Sinne von `backup_architecture_two_tier.md`.

Ausgangslage (von dir gemessen, 2026-10-16): Production trägt `0121`–`0125`,
`0126`–`0131` fehlen, `seller_business_backup()` steht auf der `0104`-Fassung
(`md5 a3c922657e1c6410858b7c4b2bb7aae5`, 16 649 Zeichen), **0 Eigenbelege und
0 Korrekturbelege**.

> **Der Zeitpunkt ist günstig und das ist kein Zufall.** Solange kein
> Eigenbeleg existiert, ist ein Restore-Test harmlos: es gibt kein
> unveränderliches Dokument, das er verfälschen könnte, und keine
> Nummernfolge, die durcheinandergeraten kann. Nach dem ersten Beleg ist das
> anders.

---

## 0. Was auf diesem Rechner wirklich vorhanden ist — gemessen

| Werkzeug | Zustand |
|---|---|
| `pg_dump`, `pg_restore`, `pg_dumpall`, `psql`, `pg_config` | **fehlen alle** |
| Supabase CLI (`supabase`) | **fehlt** |
| `docker`, `podman`, `colima`, `lima` | **fehlen alle** — kein Containerlaufzeitsystem |
| `gpg`, `age` | **fehlen** |
| `openssl` | vorhanden, 4.0.3 |
| `hdiutil` (verschlüsselte Images, macOS) | vorhanden |
| `brew` | vorhanden, 7.0.9 |
| `tar` (bsdtar), `zstd` | vorhanden |

Daraus folgt zweierlei, und beides braucht deine Zustimmung, bevor etwas
passiert:

1. **Die PostgreSQL-Clientwerkzeuge müssen installiert werden.** Ohne
   `pg_dump` gibt es keine Sicherung. (`brew install postgresql@NN` — die
   Version steht in Schritt 1.)
2. **Einen isolierten lokalen Restore gibt es ohne Container nicht
   zum Nulltarif.** Entweder ein lokales PostgreSQL (Homebrew) oder ein
   zweites, leeres Supabase-Projekt. Abschnitt 7 vergleicht beides.

Außerdem gemessen, weil es für die Zugangsdaten wichtig ist: **kein Werkzeug
in diesem Repository benutzt eine direkte PostgreSQL-Verbindung.** Keine
`DATABASE_URL`, kein `postgres://` irgendwo in `tools/` oder `src/` — alles
läuft über die REST-API mit Schlüsseln. Es gibt hier also **kein**
Datenbankpasswort, das man wiederverwenden könnte, und keines, das durch ein
Zurücksetzen kaputtgeht.

---

## 1. Verbindungsart und Versionen

### 1.1 Die Version zuerst, nicht die Verbindung

`pg_dump` muss **mindestens so neu sein wie der Server**. Ein älterer Client
bricht ab (`server version mismatch`), ein neuerer ist zulässig.

**Schritt:** Dashboard → *Settings → Infrastructure* (bzw. *Database*) → die
**Postgres-Version** von `zmiwxswrpkmizvqsgype` ablesen und notieren
(z. B. `15.x` oder `17.x`). Ich kann sie nicht lesen, und sie steht nirgends
im Repository — ich rate sie nicht.

Danach die passende Hauptversion installieren, etwa:

```bash
brew install postgresql@17     # oder postgresql@15, je nach Ablesung
# NICHT verlinken, um keine andere Installation zu stören:
/usr/local/opt/postgresql@17/bin/pg_dump --version
```

**Immer den versionierten Pfad benutzen**, nie das blanke `pg_dump` aus dem
`PATH` — sonst erwischt man irgendwann eine andere Installation, und der
Unterschied fällt erst im Restore auf.

### 1.2 Welche Verbindung

Supabase bietet drei, und nur zwei taugen für `pg_dump`:

| Weg | Port | für `pg_dump` |
|---|---|---|
| **Direkte Verbindung** `db.<ref>.supabase.co` | 5432 | ja — aber bei neueren Projekten **nur über IPv6**, solange das IPv4-Add-on nicht gekauft ist. Auf Free praktisch oft nicht erreichbar |
| **Session-Pooler** (Supavisor), Nutzer `postgres.<ref>` | 5432 | **ja — der empfohlene Weg.** IPv4-fähig, Session-Modus, hält Sitzungszustand |
| **Transaction-Pooler** | 6543 | **nein.** Kein Sitzungszustand; `pg_dump` arbeitet damit nicht zuverlässig |

**Schritt:** Dashboard → *Settings → Database → Connection string* → den
Eintrag **„Session pooler"** kopieren. Host, Port, Nutzername und Datenbank
kommen **von dort**, nicht aus diesem Dokument — die Hostnamen und das Format
des Nutzernamens hat Supabase in der Vergangenheit geändert.

Zusätzlich sinnvoll: `--no-password` weglassen, stattdessen `PGPASSFILE`
(Abschnitt 6), und `?sslmode=require` sicherstellen.

### 1.3 Last auf dem kleinen Instanztyp

Free bedeutet eine kleine Compute-Instanz. Ein Dump liest alles einmal
durch und konkurriert dabei mit der Website. Deshalb: **ruhiges Zeitfenster**,
**kein `--jobs`** (Parallelität bringt hier nichts und kostet Verbindungen),
und vorher eine Vorstellung von der Größe. Zur Einordnung: der
Plattform-Export auf Staging war 2 156 313 Bytes als ZIP, der Betriebsexport
rund 1,71 MiB als JSON. Ein Dump von wenigen MB ist zu erwarten; **mehr als
etwa 200 MB wäre ein Befund**, dem nachzugehen ist, bevor man weitermacht.

---

## 2. Was gesichert wird — drei Dateien, nicht eine

### 2.1 Das Schema als lesbarer Text

```bash
PGDUMP=/usr/local/opt/postgresql@17/bin/pg_dump

"$PGDUMP" "$PGURI" \
  --schema-only \
  --schema=public --schema=storage \
  --no-owner --no-publications --no-subscriptions \
  --file=schema_public_storage.sql
```

* `--schema-only` — Struktur, keine Zeilen.
* `--no-owner` — Eigentümer unterscheiden sich im Zielprojekt; ohne das
  regnet es `must be owner`-Fehler.
* **Kein `--no-acl`.** Die Rechte sind Teil des Sicherheitsmodells dieses
  Projekts: 232 `grant … to authenticated`, 212 `to public`, 47 `to anon`,
  11 `to service_role`. Sie müssen mit.
* `--no-publications --no-subscriptions` — Supabase verwaltet die
  Realtime-Publikation selbst; ein Restore würde mit der des Zielprojekts
  kollidieren.
* **Textformat**, weil man es lesen, durchsuchen und gegen die Migrationen
  diffen kann. Das ist der Sinn dieser Datei.
* `storage` ist dabei, weil **eigene Objekte** darin liegen: die vier Policies
  `catalog_images_read/insert/update/delete` auf `storage.objects` aus `0007`.
  Ein Dump nur von `public` würde sie verlieren.

### 2.2 Alles Wiederherstellbare im Maschinenformat

```bash
"$PGDUMP" "$PGURI" \
  --format=custom --compress=9 \
  --schema=public --schema=storage --schema=auth \
  --no-owner --no-publications --no-subscriptions \
  --file=full_public_storage_auth.dump
```

`--format=custom` ist der eigentliche Sicherungsgegenstand:

* `pg_restore --list` liest das Inhaltsverzeichnis **ohne** Datenbank — das
  ist die Prüfung „ist die Datei vollständig und lesbar".
* Selektiver Restore ist möglich (nur Daten, nur ein Schema, nur eine
  Tabelle).
* **Und der entscheidende Punkt für diesen Fall:** `pg_restore` legt
  Trigger, Fremdschlüssel und Indizes im Abschnitt `post-data` an — also
  **nach** dem Laden der Zeilen. Die neun Trigger, die beim JSON-Restore
  einzeln abgeschaltet werden müssen (`orders_register_sale_trg` legt eine
  `sales`-Zeile an, `orders_snapshot_legal_trg` einen Rechtssnapshot,
  `purchase_items_touch_purchase_trg` überschreibt `updated_at` …), feuern
  hier gar nicht. Das ist der größte sachliche Vorteil dieses Weges
  gegenüber `0131_restore_plan.md`.

### 2.3 Die Daten allein

```bash
"$PGDUMP" "$PGURI" \
  --data-only \
  --schema=public --schema=storage --schema=auth \
  --no-owner \
  --format=custom --file=data_public_storage_auth.dump
```

Gebraucht für den Restore in ein Zielprojekt, in dem `auth` und `storage`
**schon existieren** (jedes Supabase-Projekt bringt sie mit). Dort darf nur
die Fracht hinein, nicht die Struktur.

### 2.4 Was absichtlich draußen bleibt

| Schema | warum |
|---|---|
| `cron` | **Hier liegt ein aktiver Job**: `expire-stale-checkouts`, `*/5 * * * *`, `select public.expire_stale_checkouts();` (laut `docs/DEPLOYMENT.md` auf Production eingerichtet und nachgewiesen). Würde er mitgesichert und wiederhergestellt, **schreibt die Testdatenbank alle fünf Minuten von selbst** — und ein Restore-Test, der nebenbei Reservierungen freigibt, ist kein Test. Der Job wird **als Text notiert**, nicht gedumpt. |
| `extensions`, `graphql`, `graphql_public`, `realtime`, `supabase_functions`, `vault`, `pgsodium`, `pgbouncer`, `net` | von Supabase verwaltet. Ein Restore kollidiert mit den eigenen Objekten des Zielprojekts, und dumpen darf man sie teilweise gar nicht. |

Dass `cron` draußen bleibt, ist **eine Lücke mit Absicht** — sie gehört ins
Protokoll, nicht ins Vergessen (Abschnitt 4).

---

## 3. Schema, Rechte, Sequenzen, RLS — was davon drin ist

| Gegenstand | im Dump | Bemerkung |
|---|---|---|
| Tabellen, Spalten, Typen, Defaults | ja | 65 `create table` in den Migrationen |
| Primär-, Fremd-, Unique- und Check-Constraints | ja | `post-data`, also nach den Daten |
| Indizes (94 benannte) | ja | `post-data` |
| Funktionen | ja | inklusive `security definer` und `set search_path` |
| Trigger (49) | ja | `post-data` → feuern beim Laden **nicht** |
| Views (3) | ja | |
| `COMMENT ON` | ja | in diesem Projekt Teil der Dokumentation |
| **RLS: `enable row level security`** | ja | |
| **Policies (30)** | ja | inklusive der vier in `storage` |
| **Grants / ACL** | ja | solange **nicht** `--no-acl` |
| **Sequenzen** | ja | 3 benannte (`order_number_seq`, `invoice_number_seq`, `sky_id_seq`) **und** die 41 Identitätssequenzen; `pg_dump` schreibt `setval` in den Datenabschnitt — der Stand kommt also mit |
| `auth.users`, `auth.identities`, Sessions, Refresh-Tokens | **Daten ja, wenn die Rechte reichen** | siehe Abschnitt 8 — das ist das Hauptrisiko dieses Plans |
| `storage.buckets` (die `catalog`-Zeile) | ja | `public`, 2 097 152 Bytes Limit, drei MIME-Typen |
| `storage.objects` (Metadaten) | ja | **die Dateien selbst nicht** — Abschnitt 5 |
| **Rollen** (`anon`, `authenticated`, `service_role`, …) | **nein** | `pg_dumpall --roles-only` braucht Superuser; `postgres` ist auf Supabase keiner. Entlastend: dieses Projekt legt **keine eigene Rolle** an (`create role` kommt in keiner Migration vor), und jedes Supabase-Projekt bringt die Standardrollen mit. |

---

## 4. Was `pg_dump` nicht abdeckt — vollständige Liste

**In der Datenbank, aber nicht im Dump (bewusst):**

1. `cron.job` — der aktive Fünf-Minuten-Job (Abschnitt 2.4).
2. Die Supabase-eigenen Schemata aus 2.4.
3. `vault`/`pgsodium`-Geheimnisse — verschlüsselt, der Schlüssel liegt beim
   Anbieter. Nicht entschlüsselbar, also nicht sicherbar.
4. Rollen und ihre Passwörter.

**Gar nicht in der Datenbank:**

5. **Storage-Dateien** (Bucket `catalog`) — nur die Metadatenzeilen sind im
   Dump, die Bytes liegen im Objektspeicher.
6. **Edge Functions** — vier Stück im Repository: `create-payment`,
   `refund-payment`, `send-order-mail`, `stripe-webhook`. Code liegt in Git,
   **Deployment-Zustand und Function-Secrets nicht**.
7. **Function-Secrets und Umgebungsvariablen**: `STRIPE_SECRET_KEY_LIVE`,
   `STRIPE_SECRET_KEY_SANDBOX`, `STRIPE_WEBHOOK_SECRET_LIVE`,
   `STRIPE_WEBHOOK_SECRET_SANDBOX`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ALLOWED_ORIGINS`, `SITE_URL`, `COMMERCE_MODE` (Namen aus
   `docs/DEPLOYMENT.md`; **Werte gehören nirgendwohin außer in die
   Function-Secrets**).
8. **Auth-Konfiguration**: Redirect-URLs, Site-URL, Anbieter, SMTP,
   E-Mail-Vorlagen, Rate-Limits, Sitzungsdauer.
9. **Das JWT-Geheimnis** und damit die Gültigkeit von `anon`- und
   `service_role`-Schlüsseln. Ein Zielprojekt hat eigene — für einen Test
   richtig, für einen echten Wiederaufbau heißt es: **alle Schlüssel in
   Vercel und in den Function-Secrets neu setzen**.
10. **Welche Extensions eingeschaltet sind.** In diesem Projekt steht in
    keiner Migration ein `create extension` — pg_cron und die übrigen wurden
    im Dashboard aktiviert. Im Zielprojekt also von Hand nachzuziehen.
11. **Projekteinstellungen**: Region, Compute, Pooler-Modus, IPv4-Add-on,
    Log-Retention, API-Einstellungen, benutzerdefinierte Domain.
12. **Außerhalb von Supabase**: Vercel-Umgebungsvariablen, DNS,
    Stripe-Webhook-Endpunkte (zeigen auf die Projekt-URL), Stripe selbst.
13. **Das Datenbankpasswort.**

**Und ein Register, das dieses Projekt gar nicht führt:** es gibt keine
`supabase_migrations.schema_migrations`-Tabelle — Migrationen werden von Hand
im SQL-Editor angewendet. Das Register ist `supabase/migrations/APPLIED.md`.
Es gehört deshalb **mit** in die Sicherung (Abschnitt 6.3).

---

## 5. Storage-Dateien und Projektkonfiguration

### 5.1 Die Dateien

Dafür existiert bereits ein Werkzeug — nicht neu bauen:

```bash
npm run images:export:prod      # schreibt Dateien + Manifest mit SHA-256 je Datei
```

`src/lib/admin/image-backup.ts` erklärt, warum: das importierte Bild liegt in
Git (`public/images/skylanders/`), die **Administrator-Ersetzung** aber nur
als Objekt im Bucket `catalog` — „nicht in Git, nicht in der anderen
Umgebung, in keinem Export". Zwei gewöhnliche Adminhandlungen löschen sie
endgültig.

Zum Nachweis gehört deshalb: Manifest erzeugen, **Dateizahl und Gesamtgröße
gegen `select count(*), sum(metadata->>'size') from storage.objects` halten**,
und das Manifest zusammen mit dem Dump verschlüsselt ablegen. Auf Staging
waren es 36 Dateien und 2 055 123 Bytes — für Production ist die Zahl zu
messen, nicht zu übernehmen.

### 5.2 Die Konfiguration

Als Textdatei neben den Dump, von Hand aus dem Dashboard abgeschrieben —
**Namen und Einstellungen, keine Geheimwerte**:

* Postgres-Version, Region, Compute-Größe
* eingeschaltete Extensions (Liste)
* `cron.job`-Zeilen als Text (Jobname, Zeitplan, Kommando)
* Auth: Site-URL, Redirect-URLs, aktive Anbieter, SMTP-Absender
* Storage: Buckets mit `public`-Flag, Größenlimit, MIME-Typen
* Namen der gesetzten Function-Secrets (**nur Namen**)
* Vercel: Namen der Umgebungsvariablen je Umgebung (**nur Namen**)
* Stripe: welche Webhook-Endpunkte auf dieses Projekt zeigen (URL, Ereignisse)

Diese Datei ist das, was einen Wiederaufbau überhaupt möglich macht. Der Dump
allein ergibt eine Datenbank, aber kein funktionierendes SkyIsles.

---

## 6. Zugangsdaten und verschlüsselte Ablage

### 6.1 Das Passwort

Es existiert hier nicht (Abschnitt 0). Also: Dashboard → *Settings →
Database → Database password*. Entweder du hast es noch, oder es muss
**zurückgesetzt** werden.

**Zurücksetzen ist eine Projektänderung, keine Datenänderung** — und die
Sprengweite ist klein, weil kein Werkzeug dieses Repositories eine direkte
Verbindung benutzt. Was danach ein neues Passwort braucht: dein eigener
`psql`-Zugang und etwaige externe Werkzeuge. Trotzdem **deine Entscheidung,
vorher, schriftlich.**

### 6.2 Wie es nicht in die Welt gelangt

* **Nicht in die Kommandozeile.** Ein `postgres://user:pass@host/db` als
  Argument steht in `ps` und in der Shell-History. Stattdessen:

  ```bash
  # innerhalb des verschlüsselten Volumes, Rechte 600
  printf '%s:%s:%s:%s:%s\n' HOST 5432 postgres 'postgres.REF' 'PASSWORT' \
    > /Volumes/skyisles-dr/.pgpass
  chmod 600 /Volumes/skyisles-dr/.pgpass
  export PGPASSFILE=/Volumes/skyisles-dr/.pgpass
  PGURI='postgresql://postgres.REF@HOST:5432/postgres?sslmode=require'
  ```

  Die Zeile mit dem Passwort mit **führendem Leerzeichen** eintippen
  (`HISTCONTROL=ignorespace`), oder besser: in einem Editor schreiben.
* **Nie in das Repository**, nie in eine `.env*`, nie in einen Chat — auch
  nicht zu mir. Ich brauche es für keinen Schritt dieses Plans.
* `.gitignore` schützt bereits `skyisles-business-backup-*.json`; der
  Dump-Ordner liegt ohnehin außerhalb des Repositories.

### 6.3 Verschlüsselte Ablage — mit dem, was da ist

Ohne `gpg` und `age` bleibt das Beste auf diesem Rechner ein
**verschlüsseltes Sparse-Bundle**:

```bash
hdiutil create -size 2g -type SPARSEBUNDLE -fs APFS \
  -encryption AES-256 -stdinpass \
  -volname skyisles-dr ~/Backups/skyisles-dr.sparsebundle
# Passphrase kommt von stdin, nicht aus der History

hdiutil attach ~/Backups/skyisles-dr.sparsebundle   # fragt nach der Passphrase
# … Dumps, Manifest, Konfigurationsnotiz, APPLIED.md hineinschreiben …
hdiutil detach /Volumes/skyisles-dr
```

Hinein gehören: die drei Dumps, das Inhaltsverzeichnis samt Auswahl
(`full.toc`, `toc.keep`, `toc.report.txt`), das Bild-Manifest, die
Konfigurationsnotiz,
eine Kopie von `supabase/migrations/APPLIED.md` und `SHA256SUMS.txt`, sowie
eine `MANIFEST.txt` mit **SHA-256 jeder Datei und dem Zeitpunkt des Dumps**.

Für eine Kopie, die den Rechner verlässt, zusätzlich:

```bash
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in full_public_storage_auth.dump -out full.dump.enc
```

**Zwei Warnungen, die dazugehören:** `openssl enc` **authentifiziert nicht** —
eine veränderte Datei fällt beim Entschlüsseln nicht auf. Deshalb immer die
SHA-256 des *Klartexts* getrennt notieren und nach dem Entschlüsseln
vergleichen. Und: `-iter 600000` ist bewusst hoch; bei einer schwachen
Passphrase hilft auch das nicht.

**Nicht** in einen synchronisierten Ordner (iCloud, Dropbox, OneDrive) —
`docs/SECURITY.md` und CLAUDE.md verbieten das für Auth-Daten und
personenbezogene Kundendaten, und genau die sind hier drin.

### 6.4 Aufbewahrung

Kurz und rollierend. Ein Dump mit `auth.users` und jeder Kundenadresse ist
nach einem Jahr ein Risiko und kein Nachweis. **Frist offen** — sie gehört in
denselben Entscheidungsgang wie die übrigen Aufbewahrungsfragen
(`backup_architecture_two_tier.md`, Abschnitt A.4), und ich stelle sie hier
nicht als geklärt dar.

---

## 7. Der isolierte Restore-Test

### 7.1 Wohin — ein neues, leeres Supabase-Free-Projekt. Sonst nichts.

Entschieden am 2026-10-16: **kein lokales PostgreSQL, keine Container.** Das
Ziel ist ein **neues, leeres Supabase-Free-Projekt** in der EU-Region, das nur
für den Test existiert und danach gelöscht wird.

Das ist auch das fachlich bessere Ziel: ein Supabase-Projekt bringt die
Standardrollen (`anon`, `authenticated`, `service_role`, `supabase_admin`), die
Schemata `auth` und `storage` samt ihren Diensten und die Extensions mit. In
einem nackten PostgreSQL scheitern ACLs, Policies und die 74 Verweise auf
`auth.users` — man prüfte dort seinen eigenen Nachbau.

**Niemals als Ziel:** `zmiwxswrpkmizvqsgype` (Production) und
`qqxcpesbwfxzgytkdsac` (Staging). `tools/dr/lib.sh` bricht ab, wenn eine
dieser Referenzen in der Ziel-URI steht, und verlangt zusätzlich die
Projektreferenz des Testprojekts als bewusste Bestätigung.

Zu prüfen, bevor es losgeht: wie viele aktive Projekte Free je Organisation
erlaubt. Reicht es nicht, muss eines pausiert werden — **nicht Production.**

Die **Postgres-Version des Ziels** muss **gleich oder neuer** sein als die der
Quelle. Ein neu angelegtes Projekt ist in der Regel neuer, und ein Dump aus
einer älteren Hauptversion lässt sich in eine neuere laden. Umgekehrt nicht.

### 7.2 Wie `auth`, `public` und `storage` in ein BEREITS INITIALISIERTES Projekt kommen

Das ist der eigentliche Knackpunkt dieses Plans, und er verdient eine klare
Antwort.

**Ein frisches Supabase-Projekt ist keine leere Datenbank.** Es trägt schon
`auth`, `storage`, `extensions`, `realtime`, `vault`, `cron` — mit ihren
Tabellen, Funktionen, Policies und, am wichtigsten, **zwei Versionsregistern,
die die Plattformdienste selbst lesen**:

* `auth.schema_migrations` — welche GoTrue-Version dieses Projekt fährt,
* `storage.migrations` — dasselbe für den Storage-Dienst.

Würde man den Dump als Ganzes einspielen, ersetzten die Register der Quelle
die des Ziels. **Das wirft keinen Fehler.** Es bricht den Dienst später und
still, wenn er auf eine Migration trifft, die er für erledigt hält oder für
offen. Dasselbe gilt für Supabase-eigene Trigger (`on_auth_user_created`),
interne Storage-Policies und Funktionen wie `storage.extension()`.

Deshalb wird **nicht der Dump restauriert, sondern eine geprüfte Auswahl
daraus:**

```bash
# 1. Das Inhaltsverzeichnis, ohne Datenbank gelesen
pg_restore --list full.dump > full.toc

# 2. Jede Zeile beurteilen; verworfene werden AUSKOMMENTIERT, nicht gelöscht
node tools/dr/30-filter-toc.mts full.toc toc.keep toc.report.txt

# 3. Den Bericht und toc.keep LESEN — das ist kein formaler Schritt

# 4. Genau diese Auswahl anwenden, in EINER Transaktion
pg_restore --dbname="$ZIEL" --use-list=toc.keep \
           --single-transaction --exit-on-error --no-owner full.dump
```

Die Auswahlregeln, wie sie `tools/dr/30-filter-toc.mts` durchsetzt:

| Schema | behalten | verworfen |
|---|---|---|
| **`public`** | **alles** — Tabellen, Funktionen, Trigger, Constraints, Indizes, Views, Policies, RLS-Schalter, ACLs, Kommentare, Daten **und Sequenzstände** | — |
| **`auth`** | **nur die Zeilen** von `users` und `identities` | alles Strukturelle, und ausdrücklich `schema_migrations`, `sessions`, `refresh_tokens`, `audit_log_entries`, `flow_state`, `mfa_*`, `sso_*`, Trigger |
| **`storage`** | **nur die Zeilen** von `buckets` und `objects`, dazu die vier eigenen Policies `catalog_images_*` aus `0007` | `migrations`, interne Policies, Funktionen, Tabellenstruktur |
| alles andere | — | `CREATE SCHEMA` (alle drei existieren), `EXTENSION`, `cron`, `realtime`, `vault`, Publikationen, Event-Trigger |

Warum `auth.users` überhaupt mitkommt und nicht weggelassen wird: **74 Stellen
in den Migrationen verweisen auf `auth.users`** — `orders.user_id`,
`purchases.created_by`, `purchase_receipts.issued_by` und 15 weitere
Fremdschlüssel. Die Constraints werden im Abschnitt `post-data` angelegt und
dabei **geprüft**. Fehlen die Konten, scheitert genau dort der Restore. Dass
`pg_restore` die Daten aller Schemata vor allen Constraints lädt, löst das von
selbst — eine Reihenfolge von Hand ist nicht nötig.

Und warum die Sequenzstände ausdrücklich in der Liste stehen: `pg_dump`
schreibt sie als `SEQUENCE SET` in den Datenabschnitt. Fällt eine davon aus
der Auswahl, vergibt die erste Neuanlage im Ziel eine **schon belegte** Nummer.
`30-filter-toc.mts` bricht ab, wenn keine einzige übrig bliebe.

**Die Form muss vorher verglichen werden.** Ein neueres Zielprojekt kann in
`auth.users` oder `storage.objects` andere Spalten haben. Der `COPY`-Befehl im
Dump nennt die Spalten der **Quelle** — passt er nicht, bricht der
Datenabschnitt mitten im Lauf ab. `tools/dr/35-shape-check.sh` vergleicht
beide Seiten vorher und bricht ab, bevor etwas geschrieben wird. Weicht die
Form ab, gilt: die Daten von `auth`/`storage` **nicht** restaurieren, den
Durchlauf als „`public` only" protokollieren, und das als **Lücke**
festhalten — nicht als Erfolg.

**Drei Flags sind nicht verhandelbar:**

* **`--single-transaction`** — macht einen teilweise gelungenen Restore
  technisch unmöglich. Entweder ist am Ende alles da, oder das Ziel ist
  unverändert. Genau das ist die Anforderung.
* **`--exit-on-error`** — ohne das läuft `pg_restore` über Fehler hinweg und
  hinterlässt eine halbe Datenbank, die aussieht wie eine ganze.
  (`--single-transaction` setzt es ohnehin.)
* **`--no-owner`** — die Eigentümer heißen im Ziel anders; sonst regnet es
  `must be owner`.

**Was ausdrücklich nicht geht und nicht gebraucht wird:**
`--disable-triggers` (braucht Superuser, und `postgres` ist auf Supabase
keiner) — die eigenen Trigger entstehen im Abschnitt `post-data`, also **nach**
den Zeilen, und feuern beim Laden gar nicht. `--clean` und `--create` sind
verboten: sie löschten im Ziel.

**Was der Restore nicht herstellt und von Hand nachgezogen wird:** die
Storage-**Dateien** (Abschnitt 5.1), die eingeschalteten Extensions, die
Auth-Konfiguration und die Edge Functions. Für den Integritätsnachweis ist das
unerheblich; für die Aussage „der Betrieb läuft wieder" nicht.


### 7.3 Die Integritätsprüfungen

Dreimal dieselben Abfragen: **(a) auf Production unmittelbar vor dem Dump,
(b) auf dem Ziel nach dem Restore** — und dann verglichen. Die Zahlen
stammen also aus der Messung, nicht aus einer Erwartung.

**Prüfung 1 — Katalog-Inventar.** Ein `SELECT`, rein lesend:

```sql
select c.relnamespace::regnamespace::text as schema,
       case c.relkind when 'r' then 'Tabelle' when 'v' then 'View'
                      when 'm' then 'MatView' when 'S' then 'Sequenz'
                      when 'p' then 'Partitioniert' else c.relkind::text end as art,
       count(*) as anzahl
  from pg_class c
 where c.relnamespace::regnamespace::text in ('public', 'auth', 'storage', 'cron')
   and c.relkind in ('r', 'v', 'm', 'S', 'p')
 group by 1, 2
union all
select n.nspname, 'Funktion', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Trigger', count(*)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Policy', count(*)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Index', count(*)
  from pg_index i join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Constraint', count(*)
  from pg_constraint k join pg_namespace n on n.oid = k.connamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select 'public', 'RLS eingeschaltet', count(*)
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
union all
select 'global', 'Extension', count(*) from pg_extension
order by 1, 2;
```

Zur Einordnung, **aus den Migrationen gezählt und nicht aus der Datenbank**:
65 `create table`, 49 Trigger, 30 Policies, 94 benannte Indizes, 3 Views,
3 benannte Sequenzen. Maßgeblich ist der Messwert aus (a), nicht diese Liste.

**Prüfung 2 — Zeilen je Tabelle**, exakt und in einer Anweisung:

```sql
select t.table_schema as schema, t.table_name as tabelle,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I',
                                  t.table_schema, t.table_name),
                           false, true, '')))[1]::text::bigint as zeilen
  from information_schema.tables t
 where t.table_schema in ('public', 'auth', 'storage')
   and t.table_type = 'BASE TABLE'
 order by 1, 2;
```

**Prüfung 3 — Sequenzstände.** Ohne sie vergibt die erste Neuanlage eine
schon belegte Nummer:

```sql
select s.schemaname, s.sequencename, s.last_value
  from pg_sequences s
 where s.schemaname in ('public', 'auth', 'storage')
 order by 1, 2;
```

**Prüfung 4 — Inhaltsabdrücke** der Kerntabellen, damit nicht nur die Anzahl,
sondern der Inhalt verglichen wird. Je Tabelle:
`select md5(string_agg(t::text, '|' order by <pk>)) from <tabelle> t`
für `purchases`, `purchase_items`, `shop_inventory`, `inventory_movements`,
`sales`, `sale_items`, `orders`, `order_lines`, `invoices`, `sellers`.
(Das ist dieselbe Technik, die die Rollout-Preflights schon benutzen.)

**Prüfung 5 — der Rundlauf über die Anwendung.** `seller_business_backup()`
im Zielprojekt aufrufen und das `data`-Objekt gegen einen Production-Export
vom selben Zeitpunkt diffen. Erwartet: zeichengleich, bis auf die Metadaten
`created_at`, `snapshot_txid` und `commerce_mode`. Dafür braucht das Ziel
genau **einen** Auth-Nutzer mit eingeschalteter `seller_operators`-Zeile —
`can_operate_active_seller()` prüft das. Sind die `auth`-Daten mitgekommen,
ist das ohnehin erfüllt.

**Prüfung 6 — RLS wirkt wirklich.** Nicht nur zählen, sondern probieren: als
`anon` auf eine geschützte Tabelle zugreifen (muss 0 Zeilen oder einen Fehler
geben), und `has_table_privilege('anon', …)` /
`has_function_privilege('anon', …)` für eine Stichprobe prüfen. Eine Policy,
die existiert, aber nicht greift, fällt sonst nicht auf.

**Prüfung 7 — die Unveränderlichkeit.** Ein `update` auf
`purchase_receipts` muss abbrechen. Heute ist die Tabelle auf Production leer
(0 Belege) — die Probe ist trotzdem zu machen, denn sie prüft den **Trigger**,
nicht die Zeilen.

**Prüfung 8 — Storage.** `select count(*) from storage.objects` gegen die
Dateizahl im Bildmanifest; die `catalog`-Zeile in `storage.buckets` mit
`public`, Limit und MIME-Typen; die vier Policies.

**Prüfung 9 — `cron` ist leer.** `select count(*) from cron.job` im Ziel muss
**0** sein. Wäre es 1, hätte sich der Fünf-Minuten-Job mitgeschlichen und die
Testdatenbank schreibt von selbst.

### 7.4 Danach

Testprojekt löschen bzw. lokales PostgreSQL entfernen, verschlüsseltes Volume
abmelden, Protokoll schreiben: Zeitpunkt, Dumpgrößen, SHA-256, die Zahlen aus
(a) und (b), jede Abweichung mit Begründung. **Erst dieses Protokoll** macht
aus „gesichert" ein „wiederherstellbar" — und erst dann darf irgendwo stehen,
dass es eine funktionierende Stufe 2 gibt.

---

## 8. Abbruchkriterien

**Beim Dump — sofort anhalten, Datei verwerfen, nichts darauf aufbauen:**

1. `pg_dump` endet mit einem Rückgabewert ≠ 0.
2. Auf `stderr` steht `permission denied`, `must be owner of`,
   `server version mismatch` oder `connection reset`.
3. `pg_restore --list` kann die Datei nicht lesen oder listet ein
   angefordertes Schema nicht.
4. Die Datei ist auffällig klein (< 100 KB) oder auffällig groß (> 200 MB).
5. Der Lauf bricht in der Mitte ab und wird „einfach noch mal" gestartet,
   ohne die erste Datei zu verwerfen. Zwei halbe Dumps sind schlimmer als
   keiner.

**Bei fehlenden Rechten — der wahrscheinlichste Fall:**

`auth` ist das heikle Schema. Scheitert sein Dump an Rechten, dann gilt:

* **Nicht umbenennen, sondern einschränken.** Die Sicherung heißt dann
  „`public` + `storage`, ohne `auth`" und wird genau so protokolliert.
  Sie ist dann **kein** Notfall-Backup im Sinne von Abschnitt A.2 der
  Architektur, weil sich ohne `auth` niemand anmelden kann.
* Als Teilersatz existiert das **Auth-Inventar** aus `0107`
  (`system_auth_inventory()`): sieben Felder je Konto, keine Passwörter. Es
  ist auf Production **nicht angewendet** (`0105`–`0107` fehlen dort) —
  dieser Weg müsste also erst freigegeben werden.
* Nach einem Wiederaufbau ohne `auth` ordnet man Konten über die
  **E-Mail-Adresse** zu und setzt Passwörter neu. Das ist in
  `PROJECT_STATUS.md` schon so festgehalten.
* **Keine Rechteerweiterung auf Production**, um den Dump zu erzwingen. Kein
  `grant` an `postgres`, keine Rolle anfassen. Ein Backup, für das man die
  Produktionsrechte verändert, hat mehr Risiko erzeugt als es abdeckt.

**Beim Restore — anhalten:**

6. `pg_restore` endet ≠ 0 (mit `--exit-on-error` ist das jeder Fehler).
7. Eine Zeilenzahl, ein Inhaltsabdruck oder ein Sequenzstand weicht zwischen
   (a) und (b) ab.
8. Ein Katalogzähler ist im Ziel **kleiner** als auf Production.
9. `cron.job` im Ziel ist nicht 0.
10. Die RLS-Probe als `anon` liefert Zeilen.
11. Ein `update` auf `purchase_receipts` geht durch.
12. Der Export-Rundlauf (Prüfung 5) weicht in mehr als den drei bekannten
    Metadatenfeldern ab.

**Vor dem Restore — anhalten, bevor etwas geschrieben wird:**

13. `35-shape-check.sh` findet einen Unterschied in der Spaltenform von
    `auth` oder `storage`. Dann passt der `COPY` des Dumps nicht auf die
    Zieltabelle. **Kein Umbiegen des Dumps**, kein `--column-inserts` als
    Notlösung: der Durchlauf wird als „`public` only" protokolliert und die
    `auth`/`storage`-Daten bleiben draußen.
14. `30-filter-toc.mts` meldet einen Verstoß — keine Daten aus `public`,
    keine Sequenzstände, keine Tabellenstruktur, ein `CREATE SCHEMA`, ein
    Strukturobjekt aus `auth`/`storage`, oder ein Versionsregister in der
    Auswahl. Das Skript endet dann mit Rückgabewert 1 und schreibt nichts.
15. Eine Zeile im Inhaltsverzeichnis hat eine **unbekannte Form**. Sie wird
    als `UNGEPARST` ausgeschlossen — und das ist zu klären, nicht zu
    übergehen: der Dump enthält dann einen Objekttyp, den der Filter nicht
    kennt.
16. `40-restore.sh` findet im Ziel schon Tabellen in `public`. Das Ziel ist
    dann nicht leer; es wird nicht beschrieben.
17. Eine Prüfsumme aus `MANIFEST.txt` stimmt nicht mehr.

**Die Regel, die über jeder Einzelprüfung steht:**

> **Ein teilweise gelungener Restore ist NICHT bestanden.**

Sie wird zweifach erzwungen und nicht nur aufgeschrieben:

* **Technisch** — `--single-transaction`. Ein halber Restore kann nicht
  entstehen; bei jedem Fehler bleibt das Ziel unverändert.
* **Im Urteil** — `60-compare.sh` prüft nicht, ob Fehler ausblieben, sondern
  ob die Zahlen **gleich** sind, und zusätzlich, dass überhaupt genug da ist
  (Mindestmengen: ≥ 40 Tabellen in `public`, ≥ 20 Sequenzen, Objektarten
  vorhanden). Ein leeres Ziel gegen eine leere Messung ginge sonst als
  „gleich" durch. Jeder Befund führt zu Rückgabewert ≠ 0.

**Und die Regel über allem:** Solange das Protokoll aus 7.4 nicht vorliegt,
heißt es „Sicherung erzeugt, Wiederherstellbarkeit unbewiesen". Nicht
„Backup vorhanden".

---

## 9. Die Handschritte, in Reihenfolge

Die Skripte liegen in `tools/dr/` und sind **absichtlich nicht ausführbar
gesetzt** — sie werden mit `bash tools/dr/…` aufgerufen, damit keines aus
Versehen losläuft. `tools/dr/README.md` nennt alle Umgebungsvariablen.

Mit ⚠ markierte Schritte brauchen vorher deine ausdrückliche Entscheidung.

| # | Schritt | Werkzeug |
|---|---|---|
| 1 | Dashboard Production: **Postgres-Version**, Region, Compute, eingeschaltete Extensions ablesen | — |
| 2 | Dashboard Production: *Settings → Database* → **Session-Pooler**-Verbindungsstring kopieren (Host, Port, Nutzer `postgres.<ref>`) | — |
| 3 | ⚠ Datenbankpasswort: vorhanden oder **zurücksetzen** | — |
| 4 | ⚠ `brew install postgresql@NN` in der Version aus Schritt 1 | — |
| 5 | Verschlüsseltes Sparse-Bundle anlegen und einbinden | Abschnitt 6.3 |
| 6 | `.pgpass` **darin** anlegen (Rechte 600), `PGPASSFILE` setzen | Abschnitt 6.2 |
| 7 | Lage prüfen, ohne zu verbinden | `bash tools/dr/00-preflight.sh` |
| 8 | **Messung (a)** auf Production — fünf `SELECT`s, rein lesend | `bash tools/dr/10-baseline.sh` |
| 9 | Die drei Dumps, Inhaltsverzeichnis, `MANIFEST.txt` | `bash tools/dr/20-dump.sh` |
| 10 | `npm run images:export:prod` — Bilddateien und Manifest ins Volume | npm |
| 11 | Konfigurationsnotiz schreiben, `APPLIED.md` und `SHA256SUMS.txt` dazulegen | Abschnitt 5.2 |
| 12 | Volume abmelden. **Die Sicherung existiert** — noch ohne Nachweis | — |
| 13 | ⚠ **Neues, leeres Supabase-Free-Projekt** anlegen (EU), Referenz notieren. Nicht Production, nicht Staging | Dashboard |
| 14 | Spaltenform von `auth`/`storage` zwischen Quelle und Ziel vergleichen | `bash tools/dr/35-shape-check.sh` |
| 15 | Auswahl aus dem Inhaltsverzeichnis erzeugen **und lesen** | `node tools/dr/30-filter-toc.mts …` |
| 16 | ⚠ Restore in das Testprojekt, eine Transaktion | `bash tools/dr/40-restore.sh` |
| 17 | **Messung (b)** im Ziel, plus RLS- und Unveränderlichkeitsprobe | `bash tools/dr/50-verify.sh` |
| 18 | **Der Vergleich.** Hier wird bestanden oder nicht | `bash tools/dr/60-compare.sh` |
| 19 | `verify-target.csv` von Hand lesen — `cron.job = 0`, vier Policies, Bucket, `auth.users` | — |
| 20 | Testprojekt **löschen**, Volume abmelden, Protokoll ablegen, mir die Zahlen geben | — |

Keinen dieser Schritte kann ich übernehmen: ich darf Production nicht
verbinden, kein Werkzeug installieren und kein Projekt anlegen. Was ich danach
mache: die Zahlen auswerten, Abweichungen erklären und — wenn alles hält —
`backup_architecture_two_tier.md` und `PROJECT_STATUS.md` fortschreiben.


## 10. Offene Risiken

1. **`auth` ist das Risiko dieses Plans.** Ob `pg_dump` als `postgres` die
   `auth`-Daten auf Free vollständig mitnimmt, ist hier **nicht geprüft** und
   wird erst Schritt 8 zeigen. Abschnitt 8 sagt, was dann gilt.
2. **Rollen und Extensions kommen nicht mit** — ein Wiederaufbau ist
   deshalb immer Dump **plus** Konfigurationsnotiz plus Handarbeit.
3. **Der Dump ist ein Standbild.** Alles nach seinem Zeitpunkt fehlt. Auf
   Free gibt es keinen PITR, der die Lücke schließt — die Frequenz der
   Sicherung ist damit die Obergrenze des möglichen Verlusts. Eine Frequenz
   ist noch nicht entschieden.
4. **Ein Dump mit `auth.users` und jeder Kundenadresse ist das sensibelste
   Artefakt, das dieses Projekt je erzeugt.** Verschlüsselt, kurz
   aufbewahrt, nicht synchronisiert — sonst ist er ein Schaden und keine
   Absicherung.
5. **`openssl enc` authentifiziert nicht.** SHA-256 des Klartexts getrennt
   notieren.
6. **Das Zielprojekt könnte verwechselt werden.** Ein Restore in das
   bestehende Staging würde es überschreiben. Der Ziel-String gehört vor dem
   Lauf laut vorgelesen — `zmiwxswrpkmizvqsgype` (Production) und
   `qqxcpesbwfxzgytkdsac` (Staging) sind **keine** zulässigen Ziele.
7. **Frei verfügbare Projektzahl auf Free** ist begrenzt; das kann den
   Testdurchlauf blockieren, bevor er beginnt. Pausiert wird dann irgendetwas,
   aber **nicht Production**.
9. **Die Spaltenform von `auth` und `storage` kann abweichen**, wenn das
   Testprojekt eine neuere Dienstversion fährt als Production. Dann ist der
   Nachweis auf `public` beschränkt — und das ist ein echtes Loch in der
   Aussage „wir können wiederherstellen", kein Formfehler.
10. **Der TOC-Filter ist das gefährlichste Stück des Wegs.** Lässt er zu viel
    durch, überschreibt der Restore ein Versionsregister der Plattform — ohne
    Fehlermeldung, mit Wirkung erst später. `src/lib/admin/dr-toc-filter.test.ts`
    prüft ihn mit 20 Fällen und vier Positivkontrollen, ohne Datenbank.
11. **`shellcheck` ist hier nicht installiert.** Die Skripte sind mit
    `bash -n` syntaktisch geprüft und gelesen, nicht statisch analysiert.
8. **Aufbewahrungsfrist und Löschkonzept für Sicherungen: offen.** Rechtlich
   nicht geklärt, hier nicht als geklärt dargestellt.

---

## 11. Drei Nachprüfungen vor der ersten Verbindung

Durchgeführt am 2026-10-16, bevor irgendetwas verbunden wurde. Zwei der drei
haben echte Lücken gefunden; beide sind geschlossen.

### 11.1 Reicht `auth.users` + `auth.identities`?

**Zuerst die Tatsachen, aus dem Code erhoben** — nicht aus Annahmen:

| Auth-Weg | im Code | Beleg |
|---|---|---|
| E-Mail + Passwort | **ja** | `signInWithPassword` (3 Stellen), `signUp` (40), `resetPasswordForEmail` (1), `updateUser` (8) |
| OAuth / Fremdanbieter | **nein** | `signInWithOAuth`: 0 Treffer |
| Magic Link / OTP | **nein** | `signInWithOtp`, `verifyOtp`: 0 Treffer |
| MFA / TOTP | **nein** | keine `mfa.*`-Aufrufe in `src/`; die Treffer in `platform-manifest.ts` sind Ausschlussregeln |
| SSO / SAML | **nein** | nicht eingerichtet |

Der Benutzername hängt **nicht** an Auth-Metadaten: `public.profiles`
(`username`, `display_name`, `avatar_url`, `country`) liegt in `public` und
kommt vollständig mit.

**Bewertung: für unseren Zweck reicht die Auswahl.** `auth.users` trägt
`encrypted_password`, `email` und `email_confirmed_at` — Anmeldung mit
Passwort funktioniert nach dem Restore wieder. `auth.identities` trägt die
E-Mail-Identität; Passwortanmeldung hängt streng genommen an `users`, aber
ohne Identitätszeile wären Identitätsverknüpfung und E-Mail-Wechsel schief.
Deshalb bleibt sie drin.

**Was nach dem Restore ausdrücklich NICHT wiederhergestellt ist:**

| Tabelle | Folge | Bewertung |
|---|---|---|
| `auth.sessions`, `auth.refresh_tokens` | **jede angemeldete Person ist abgemeldet** und muss sich neu anmelden | hinnehmbar, gewollt |
| `auth.one_time_tokens`, `auth.flow_state` | offene Bestätigungs-, Einladungs- und Passwort-Zurücksetz-Links **werden ungültig** | hinnehmbar: neu anfordern |
| `auth.audit_log_entries` | **die Auth-Protokollspur ist weg** — wann sich wer angemeldet oder seine E-Mail geändert hat | **echte Lücke.** Für eine Streitfrage („seit wann hat dieses Konto diese Adresse?") gibt es danach keinen Nachweis. Bewusst draußen, weil die Tabelle groß wird und keine Betriebsfunktion daran hängt |
| `auth.mfa_factors`, `mfa_challenges`, `mfa_amr_claims` | zweite Faktoren wären verloren | **heute ohne Folge** — MFA ist nicht im Einsatz. **Wird MFA je eingeschaltet, muss diese Liste erweitert werden**, sonst sperrt ein Restore alle Konten aus |
| `auth.sso_providers`, `saml_*`, `auth.instances` | — | nicht im Einsatz |
| `auth.schema_migrations` | — | **darf nicht restauriert werden**, siehe 7.2 |

**Und was gar nicht in der Datenbank steht** (Abschnitt 4): das
JWT-Geheimnis, die Auth-Konfiguration (Site-URL, Redirect-URLs, SMTP,
Vorlagen, Rate-Limits). Nach einem echten Wiederaufbau sind deshalb **alle
Schlüssel neu zu setzen** — in Vercel und in den Function-Secrets.

### 11.2 Schützt der Filter zuverlässig? — **eine Lücke gefunden und geschlossen**

Geprüft wurde gegen die Frage „was passiert mit einer Zeile, die der Filter
nicht kennt". Befund: sie wurde **ausgeschlossen, aber nicht gemeldet** — im
`toc.keep` stand ein Kommentar, im Bericht nichts, und der Rückgabewert blieb
0. Ausschließen ohne Meldung ist auch eine Entscheidung, nur eine unbemerkte;
und eine unbekannte Zeilenform heißt, dass der Dump einen Objekttyp enthält,
über den **niemand** entschieden hat.

**Geändert:** unbekannte Zeilen werden gezählt, im Bericht einzeln aufgeführt
und führen zum **Abbruch** (Rückgabewert 1). Dazu eine zweite neue
Zusicherung: **kein behaltener Eintrag aus einem vierten Schema** —
`cron`, `realtime`, `vault`, `extensions`, `supabase_functions` gehören der
Plattform.

Der Schutz steht damit auf drei Beinen:

1. **Erlaubnisliste statt Verbotsliste.** `decide` behält nur, was
   ausdrücklich genannt ist. Ein neues Supabase-Systemobjekt — in `auth`, in
   `storage`, in einem neuen Schema — fällt automatisch heraus, ohne dass
   jemand es vorher kennen musste.
2. **Sechs Zusicherungen über das Ergebnis**, unabhängig von `decide`: Daten
   aus `public` vorhanden, Sequenzstände vorhanden, Tabellenstruktur
   vorhanden, kein `CREATE SCHEMA`, kein Versionsregister, kein Strukturobjekt
   aus `auth`/`storage`, kein fremdes Schema, keine ungeparste Zeile.
3. **22 Prüfungen ohne Datenbank** in `src/lib/admin/dr-toc-filter.test.ts`,
   darunter das Parsen von Funktionssignaturen mit Leerzeichen und fünf
   Positivkontrollen.

Dazu die Prüfungen in `40-restore.sh`: das Ziel muss **leer** sein (0 Tabellen
in `public`), die Prüfsummen aus `MANIFEST.txt` müssen stimmen, und der
Restore läuft in **einer** Transaktion.

### 11.3 Deckt der Vergleich die geschäftskritischen Daten? — **nein, und das ist behoben**

Befund: die Zeilenzahlen deckten jede Tabelle ab, die **Inhaltsabdrücke** aber
nur zwölf. Damit wären `purchase_receipt_downloads` und
`purchase_receipt_counters` — also Abrufnachweise und Nummernzähler —
ungeprüft durchgelaufen, ebenso `order_line_events`, `order_reservations`,
`order_refunds`, `order_refund_allocations`, `order_legal_snapshots`,
`sale_fees`, `sale_refunds`, `settlement_adjustments`. Und es fehlten drei
ganze Prüfdimensionen.

**Ergänzt:**

| Datei | prüft |
|---|---|
| `baseline-digests.sql` | jetzt **29 Tabellen** statt 12 — alle 28 Exportbereiche plus `profiles` |
| `baseline-definitions.sql` | **neu**: Abdruck je *Definition* — Spalten samt Typ, Nullbarkeit und Default, Constraints (`pg_get_constraintdef`), Indizes (`pg_get_indexdef`), Trigger (`pg_get_triggerdef`), Policies (Rollen, `using`, `with check`), Funktionen (`prosrc`, Volatilität, `security definer`, `search_path`, Rückgabetyp), RLS-Schalter je Tabelle. Zähler allein genügen nicht: 94 Indizes vorher und 94 nachher kann auch heißen, einer fehlt und ein anderer ist doppelt |
| `baseline-grants.sql` | **neu**: Tabellen-, Funktions- und Schema-ACL im Volltext. Ein Restore, der die Rechte verliert, fällt durch jeden Zähler hindurch — die Tabellen sind da, und `anon` darf plötzlich mehr |
| `baseline-business.sql` | **neu, 21 Größen**: Belegkette als Abdruck über `id>vorgänger:nummer`, Fingerabdrücke, eingefrorene Positionslisten, **Kettenbruch-Zähler** (`supersedes_id is null <> revision = 1` muss 0 sein), kein Beleg zweimal ersetzt, Abrufe und ihre Bytes, Nummernzähler je Jahr, **Zähler kleiner als die höchste vergebene Nummer** (muss 0 sein), **Lagerbilanz** (`quantity <> sum(delta)` muss 0 sein), Lagersummen, Bewegungen, Bestellungen ohne Position, Rechnungen ohne Bestellung, Rechnungs- und Bestellnummern, Einkaufskosten-Konsistenz, Summen, und der **abgeleitete Ankaufsfaktor** |

Sequenzstände waren schon abgedeckt (`pg_sequences` führt auch die 41
Identitätssequenzen) — und sie sind zusätzlich eine Abbruchbedingung des
Filters, damit sie nicht aus der Auswahl fallen.

`60-compare.sh` vergleicht nun **acht** Dateien und prüft **elf**
Mindestmengen. Letzteres ist der Teil, der „teilweise gelungen" abfängt: ein
leeres Ziel gegen eine leere Messung wäre sonst „gleich".
