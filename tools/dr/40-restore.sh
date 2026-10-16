#!/usr/bin/env bash
# Schritt 4 — der Restore in das leere Testprojekt. EINE Transaktion.
#
#   PGBIN=… PG_SERVER_MAJOR=… DR_VOL=… PGPASSFILE=… \
#   DR_TARGET_URI='postgresql://postgres.TESTREF@HOST:5432/postgres?sslmode=require' \
#   DR_TARGET_REF=TESTREF DR_DUMP_DIR=/Volumes/skyisles-dr/dump-2026… \
#   bash tools/dr/40-restore.sh
#
# WARUM EINE TRANSAKTION: `--single-transaction` macht einen TEILWEISEN
# Restore technisch unmoeglich. Entweder ist am Ende alles da, oder nichts.
# Genau das ist die Anforderung — ein halb gelungener Restore darf nie als
# bestanden gelten, und am sichersten ist er, wenn er gar nicht entstehen kann.
source "$(dirname "$0")/lib.sh"
require_client; require_volume; require_pgpass
: "${DR_TARGET_URI:?}" "${DR_DUMP_DIR:?DR_DUMP_DIR muss auf das Dumpverzeichnis zeigen}"
forbid_target_prod_and_staging "$DR_TARGET_URI"

[ -f "$DR_DUMP_DIR/full.dump" ] || fail "$DR_DUMP_DIR/full.dump fehlt"
[ -f "$DR_DUMP_DIR/toc.keep" ] || fail "$DR_DUMP_DIR/toc.keep fehlt — erst 30-filter-toc.mts laufen lassen"
[ -f "$DR_DUMP_DIR/MANIFEST.txt" ] || fail "MANIFEST.txt fehlt"

note "--- Pruefsummen der Dumpdateien"
( cd "$DR_DUMP_DIR" && shasum -a 256 -c MANIFEST.txt ) || fail "eine Dumpdatei hat sich veraendert"

note "--- Das Ziel muss LEER sein"
LEER="$("$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=1 -tA \
  --command="select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")"
[ "$LEER" = "0" ] || fail "im Ziel stehen schon $LEER Tabellen in public — dieses Skript schreibt nur in ein leeres Projekt"

note "--- Was der gefilterte Plan anwenden wird"
grep -cE '^[0-9]+;' "$DR_DUMP_DIR/toc.keep" | xargs -I{} note "{} aktive Eintraege"
note "davon aus auth/storage:"
grep -E '^[0-9]+;' "$DR_DUMP_DIR/toc.keep" | grep -E ' (auth|storage) ' || note "  (keine)"

confirm "Restore in das Testprojekt $DR_TARGET_REF"

note "--- pg_restore, eine Transaktion, Abbruch bei jedem Fehler"
"$PGBIN/pg_restore" \
  --dbname="$DR_TARGET_URI" \
  --use-list="$DR_DUMP_DIR/toc.keep" \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --verbose \
  "$DR_DUMP_DIR/full.dump" 2> "$DR_DUMP_DIR/restore.log" \
  || { tail -40 "$DR_DUMP_DIR/restore.log"; fail "pg_restore ist fehlgeschlagen — das Ziel ist unveraendert (eine Transaktion)"; }

note "--- Warnungen im Protokoll (muessen erklaerbar sein)"
grep -iE "warning|error|skipping" "$DR_DUMP_DIR/restore.log" | head -20 || note "  keine"

printf '\n  Restore durchgelaufen. NOCH NICHT bestanden — dafuer 50-verify.sh und 60-compare.sh.\n\n'
