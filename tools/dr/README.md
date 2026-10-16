# `tools/dr` — Sicherung und Restore-Test

Die Skripte zum Plan in `supabase/checks/disaster_recovery_pg_dump.md`.
**Keines davon ist ausgeführt.** Jedes verbindet erst, wenn alle Wächter
halten, und keines schreibt nach Production oder Staging.

| Datei | tut |
|---|---|
| `lib.sh` | die gemeinsamen Wächter: Clientversion ≥ Server, verschlüsseltes Volume, `PGPASSFILE` mit Rechten 600, Quelle **ist** Production, Ziel ist **weder** Production **noch** Staging |
| `00-preflight.sh` | prüft die Lage, verbindet nichts |
| `10-baseline.sh` | Messung **(a)** auf der Quelle — fünf `SELECT`s, rein lesend |
| `20-dump.sh` | die drei Dumps, das Inhaltsverzeichnis, Mindestprüfungen auf die Datei, `MANIFEST.txt` |
| `30-filter-toc.mts` | entscheidet Eintrag für Eintrag, was in ein **initialisiertes** Projekt darf → `toc.keep` + Bericht |
| `35-shape-check.sh` | vergleicht die Spaltenform von `auth`/`storage` zwischen Quelle und Ziel **vor** dem Restore |
| `40-restore.sh` | `pg_restore --use-list --single-transaction --exit-on-error` |
| `50-verify.sh` | Messung **(b)** im Ziel plus die Zielprüfungen |
| `60-compare.sh` | (a) gegen (b). **Hier** wird bestanden oder nicht |
| `../../supabase/checks/dr/` | die sechs Abfragen, die auf beiden Seiten gleich laufen |

## Die drei Regeln, die in den Skripten stehen und nicht nur im Plan

1. **Ein teilweise gelungener Restore kann nicht entstehen.**
   `--single-transaction` — entweder alles oder nichts.
2. **„Keine Fehler" ist kein Nachweis.** `60-compare.sh` vergleicht Zahlen und
   prüft zusätzlich Mindestmengen; ein leeres Ziel gegen eine leere Messung
   würde sonst als „gleich" durchgehen.
3. **Supabase-Systemobjekte werden nicht angefasst.** `30-filter-toc.mts`
   kommentiert jede Zeile aus, die sie berührte — insbesondere
   `auth.schema_migrations` und `storage.migrations`, die Versionsregister der
   Plattformdienste. Geprüft in `src/lib/admin/dr-toc-filter.test.ts`
   (20 Prüfungen, ohne Datenbank).

## Umgebungsvariablen

```
PGBIN=/usr/local/opt/postgresql@17/bin      # versionierter Pfad, nie das blanke pg_dump
PG_SERVER_MAJOR=17                          # aus dem Dashboard abgelesen
DR_VOL=/Volumes/skyisles-dr                 # eingebundenes verschlüsseltes Volume
PGPASSFILE=/Volumes/skyisles-dr/.pgpass     # Rechte 600, IM Volume
DR_SOURCE_URI='postgresql://postgres.PRODREF@HOST:5432/postgres?sslmode=require'
DR_TARGET_URI='postgresql://postgres.TESTREF@HOST:5432/postgres?sslmode=require'
DR_TARGET_REF=TESTREF                       # bewusste Bestätigung des Ziels
DR_DUMP_DIR=/Volumes/skyisles-dr/dump-…     # von 20-dump.sh angelegt
```

**Kein Passwort in einer URI.** `lib.sh` bricht ab, wenn eines drinsteht — es
stünde in `ps` und in der Shell-History. Das Passwort gehört in `PGPASSFILE`.

## Noch offen

* Die **Abfragen** liegen unter `supabase/checks/dr/` und sind in
  `supabase/SHA256SUMS.txt` erfasst (179 Dateien) — sie laufen gegen
  Production und gehören gegen unbemerkte Änderung geschützt. Dass dort kein
  ausführbares `.sql` unter `tools/` liegt, ist keine Stilfrage: ein eigener
  Wächter in `src/lib/orderbook/legacy-history.test.ts` verbietet es, seit
  verbrauchtes Einmal-SQL unter `tools/sql/` lag und ein Kommentar
  „DO NOT RUN AGAIN" der ganze Schutz war.
* Die **Skripte selbst** sind noch nicht in der Prüfsummenliste; `tools/dr`
  käme mit einer weiteren Zeile in `tools/checksums.mts` dazu, sobald sie
  committet werden.
* `shellcheck` ist auf diesem Rechner nicht installiert; geprüft wurde mit
  `bash -n` (Syntax) und durch Lesen.
