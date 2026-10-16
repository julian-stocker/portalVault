#!/usr/bin/env bash
# Schritt 1 — Messung (a): der Zustand der QUELLE, rein lesend.
#
# Schreibt sechs Textdateien in das verschluesselte Volume. Kein Schreibzugriff
# auf die Datenbank: sechs SELECTs, nichts weiter.
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
  "$PGBIN/psql" "$DR_SOURCE_URI" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --csv --file="$SQL/$f.sql" > "$OUT/$f.csv"
done

# Die Serverversion und der Zeitpunkt gehoeren ins Protokoll.
"$PGBIN/psql" "$DR_SOURCE_URI" --no-psqlrc --set=ON_ERROR_STOP=1 --csv \
  --command="select version() as server, now() as gelesen_um, \
                    current_setting('server_version_num') as version_num" \
  > "$OUT/server.csv"

note "--- geschrieben nach $OUT"
ls -l "$OUT"
printf '\n  Messung (a) steht. Diese Dateien NICHT ins Repository.\n\n'
