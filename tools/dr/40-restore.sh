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

note "--- Jede Rolle, der der Plan Rechte gibt, muss im Ziel schon bestehen"
# Die Rechte werden so wiederhergestellt, wie die Quelle sie hatte — nicht
# mehr. Fehlt eine Rolle im Ziel, scheiterte der Restore erst mitten in der
# Transaktion; hier faellt es vorher auf, und angelegt wird nichts (M-03D).
ROLLEN="$("$PGBIN/pg_restore" --use-list="$DR_DUMP_DIR/toc.keep" --file=- "$DR_DUMP_DIR/full.dump" \
  | grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) ' \
  | sed -nE 's/^ALTER DEFAULT PRIVILEGES FOR ROLE ([a-z_][a-z0-9_]*) .*/\1/p; s/.* (TO|FROM) ([^;]*)( WITH GRANT OPTION)?;$/\2/p' \
  | tr ',' '\n' | sed -E 's/^ +//; s/ +$//; s/ WITH GRANT OPTION$//; s/"//g' | awk 'NF && $0 != "PUBLIC"' | sort -u)" \
  || fail "der Restore-Plan laesst sich nicht lesen — full.dump ist unvollstaendig oder beschaedigt; das Ziel ist unveraendert"
FEHLT=""
for r in $ROLLEN; do
  case "$r" in *[!a-z0-9_]*) fail "unerwarteter Rollenname im Plan: '$r'";; esac
  DA="$("$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=1 -tA \
    --command="select count(*) from pg_roles where rolname = '$r'")"
  [ "$DA" = "1" ] || FEHLT="$FEHLT $r"
done
[ -z "$FEHLT" ] || fail "im Ziel fehlen Rollen, denen der Plan Rechte gibt:$FEHLT"
note "$(printf '%s\n' $ROLLEN | grep -c .) Rollen aus den Rechten, alle im Ziel vorhanden"

note "--- Was der gefilterte Plan anwenden wird"
# `note` ist eine Shell-Funktion; `xargs` kann sie nicht aufrufen (Exit 127,
# unter `set -e` brach das Skript hier immer ab — M-03C).
note "$(grep -cE '^[0-9]+;' "$DR_DUMP_DIR/toc.keep") aktive Eintraege"
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
