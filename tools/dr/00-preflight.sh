#!/usr/bin/env bash
# Schritt 0 — prueft die Lage, verbindet nichts.
#
#   PGBIN=/usr/local/opt/postgresql@17/bin PG_SERVER_MAJOR=17 \
#   DR_VOL=/Volumes/skyisles-dr PGPASSFILE=/Volumes/skyisles-dr/.pgpass \
#   bash tools/dr/00-preflight.sh
source "$(dirname "$0")/lib.sh"

note "--- Werkzeuge"
require_client
note "--- Verschluesseltes Volume"
require_volume
note "--- Zugangsdaten"
require_pgpass

note "--- Was NICHT installiert sein muss"
for t in docker podman colima supabase; do
  command -v "$t" >/dev/null 2>&1 && note "$t ist da (wird nicht gebraucht)" \
                                  || note "$t fehlt (in Ordnung, wird nicht gebraucht)"
done

note "--- Platz im Volume"
df -h "$DR_VOL" | tail -1

printf '\n  Preflight bestanden. Naechster Schritt: 10-baseline.sh gegen die QUELLE.\n\n'
