#!/usr/bin/env bash
# Schritt 1 — Messung (a): der Zustand der QUELLE, rein lesend.
#
# Schreibt sechs Textdateien in das verschluesselte Volume. Kein Schreibzugriff
# auf die Datenbank: sechs SELECTs, nichts weiter.
#
# Jede Abfrage laeuft ueber psql_read_only (lib.sh): eine eigene Verbindung,
# darin BEGIN TRANSACTION READ ONLY, SHOW transaction_read_only muss "on"
# sein, sonst Abbruch, dann die unveraenderte Datei, dann COMMIT. PGOPTIONS
# hilft hier nicht: der Session-Pooler reicht es nicht weiter.
#
#   DR_SOURCE_URI='postgresql://postgres.REF@HOST:5432/postgres?sslmode=require' \
#   bash tools/dr/10-baseline.sh
source "$(dirname "$0")/lib.sh"
require_client; require_volume; require_pgpass
: "${DR_SOURCE_URI:?DR_SOURCE_URI fehlt}"
require_source_is_production "$DR_SOURCE_URI"

OUT="$DR_VOL/baseline-quelle"
mkdir -p "$OUT"
SQL="$(dirname "$0")/../../supabase/checks/dr"

for f in baseline-catalog baseline-rows baseline-sequences baseline-digests \
         baseline-definitions baseline-grants baseline-business shape-auth-storage; do
  note "lese $f"
  psql_read_only "$DR_SOURCE_URI" < "$SQL/$f.sql" > "$OUT/$f.csv"
done

# Die Serverversion und der Zeitpunkt gehoeren ins Protokoll.
psql_read_only "$DR_SOURCE_URI" > "$OUT/server.csv" <<'SQL'
select version() as server, now() as gelesen_um,
       current_setting('server_version_num') as version_num;
SQL

note "--- geschrieben nach $OUT"
ls -l "$OUT"
printf '\n  Messung (a) steht. Diese Dateien NICHT ins Repository.\n\n'
