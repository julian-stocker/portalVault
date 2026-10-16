#!/usr/bin/env bash
# Schritt 3 — passt die Spaltenform von auth und storage im ZIEL zu der in der
# Quelle?
#
# Das ist die Pruefung, die einen halb gelungenen Restore verhindert. Ein
# neueres Supabase-Projekt kann in `auth.users` oder `storage.objects` andere
# Spalten haben als das Quellprojekt. Der COPY-Befehl im Dump nennt die
# Spalten der QUELLE — passt er nicht, bricht der Datenabschnitt mitten im
# Lauf ab. Deshalb VORHER vergleichen, nicht hinterher feststellen.
#
#   DR_SOURCE_URI=… DR_TARGET_URI=… DR_TARGET_REF=… bash tools/dr/35-shape-check.sh
source "$(dirname "$0")/lib.sh"
require_client; require_volume; require_pgpass
: "${DR_SOURCE_URI:?}" "${DR_TARGET_URI:?}"
require_source_is_production "$DR_SOURCE_URI"
forbid_target_prod_and_staging "$DR_TARGET_URI"

SQL="$(dirname "$0")/../../supabase/checks/dr/shape-auth-storage.sql"
OUT="$DR_VOL/shape"
mkdir -p "$OUT"

"$PGBIN/psql" "$DR_SOURCE_URI" --no-psqlrc --set=ON_ERROR_STOP=1 --csv --file="$SQL" > "$OUT/quelle.csv"
"$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=1 --csv --file="$SQL" > "$OUT/ziel.csv"

note "--- Unterschiede in der Spaltenform (leer = gut)"
if diff -u "$OUT/quelle.csv" "$OUT/ziel.csv" > "$OUT/diff.txt"; then
  note "auth und storage haben im Ziel dieselbe Form wie in der Quelle"
else
  cat "$OUT/diff.txt"
  note ""
  note "Betroffene Tabellen pruefen. Weichen `auth.users`, `auth.identities`,"
  note "`storage.buckets` oder `storage.objects` ab, dann gilt:"
  note "  * ihre Daten NICHT restaurieren,"
  note "  * den Durchlauf als 'public only' protokollieren,"
  note "  * und das als LUECKE festhalten — nicht als Erfolg."
  fail "Spaltenform weicht ab"
fi
