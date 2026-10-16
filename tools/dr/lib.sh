#!/usr/bin/env bash
# Shared guards for the disaster-recovery scripts.
#
# Nothing in here connects anywhere. It checks that the situation is the one
# the operator thinks it is, and refuses otherwise. Every script sources this
# first, and every script is safe to run twice.
#
# Rules it enforces:
#   * the PostgreSQL client tools exist and the major version is >= the server
#   * the encrypted volume is mounted and writable
#   * a connection URI carries NO password (the password lives in PGPASSFILE)
#   * a RESTORE target is never Production and never Staging
#   * a DUMP source is Production and nothing else

set -euo pipefail

PROD_REF="zmiwxswrpkmizvqsgype"
STAGING_REF="qqxcpesbwfxzgytkdsac"

fail() { printf '\n  ABBRUCH: %s\n\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------- Werkzeuge
require_client() {
  : "${PGBIN:?PGBIN muss auf das bin-Verzeichnis der passenden PostgreSQL-Version zeigen, z. B. /usr/local/opt/postgresql@17/bin}"
  for t in pg_dump pg_restore psql; do
    [ -x "$PGBIN/$t" ] || fail "$PGBIN/$t fehlt oder ist nicht ausfuehrbar"
  done
  : "${PG_SERVER_MAJOR:?PG_SERVER_MAJOR muss die Hauptversion des Servers sein, aus dem Dashboard abgelesen (z. B. 17)}"
  local client_major
  client_major="$("$PGBIN/pg_dump" --version | sed -E 's/^pg_dump \(PostgreSQL\) ([0-9]+).*/\1/')"
  case "$client_major" in
    ''|*[!0-9]*) fail "Clientversion nicht erkennbar: '$("$PGBIN/pg_dump" --version)'";;
  esac
  case "$PG_SERVER_MAJOR" in
    ''|*[!0-9]*) fail "PG_SERVER_MAJOR muss eine Zahl sein, ist '$PG_SERVER_MAJOR'";;
  esac
  if [ "$client_major" -lt "$PG_SERVER_MAJOR" ]; then
    fail "pg_dump ist Version $client_major, der Server ist $PG_SERVER_MAJOR — ein aelterer Client bricht ab. Passende Version installieren."
  fi
  note "Client $client_major, Server $PG_SERVER_MAJOR — in Ordnung"
}

# ------------------------------------------------- verschluesseltes Volume
require_volume() {
  : "${DR_VOL:?DR_VOL muss auf das eingebundene verschluesselte Volume zeigen, z. B. /Volumes/skyisles-dr}"
  [ -d "$DR_VOL" ] || fail "$DR_VOL ist nicht eingebunden"
  [ -w "$DR_VOL" ] || fail "$DR_VOL ist nicht beschreibbar"
  case "$DR_VOL" in
    */Library/Mobile\ Documents/*|*/Dropbox/*|*/OneDrive/*|*/iCloud*)
      fail "$DR_VOL liegt in einem synchronisierten Ordner — das ist fuer Auth- und Kundendaten verboten";;
  esac
  local repo; repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  case "$DR_VOL" in
    "$repo"*) fail "$DR_VOL liegt INNERHALB des Repositories";;
  esac
  note "Volume $DR_VOL — eingebunden, beschreibbar, ausserhalb des Repositories"
}

# --------------------------------------------------------------- Passwoerter
require_pgpass() {
  : "${PGPASSFILE:?PGPASSFILE muss auf die .pgpass-Datei IM verschluesselten Volume zeigen}"
  [ -f "$PGPASSFILE" ] || fail "$PGPASSFILE fehlt"
  case "$PGPASSFILE" in
    "${DR_VOL:-/nonexistent}"*) : ;;
    *) fail "$PGPASSFILE liegt nicht im verschluesselten Volume";;
  esac
  local mode; mode="$(stat -f '%OLp' "$PGPASSFILE")"
  [ "$mode" = "600" ] || fail "$PGPASSFILE hat Rechte $mode, erwartet 600"
  note "PGPASSFILE in Ordnung (Rechte 600, im Volume)"
}

# Eine URI darf das Passwort NICHT enthalten — es stuende in `ps` und in der
# Shell-History.
check_uri_clean() {
  local uri="$1" name="$2"
  case "$uri" in
    *"://"*:*@*) fail "$name enthaelt ein Passwort. Passwort gehoert in PGPASSFILE, nicht in die URI.";;
  esac
  case "$uri" in
    postgresql://*|postgres://*) : ;;
    *) fail "$name ist keine postgresql://-URI";;
  esac
  case "$uri" in
    *sslmode=require*|*sslmode=verify-full*) : ;;
    *) fail "$name hat kein sslmode=require";;
  esac
}

# Maskiert alles, was wie ein Hostname aussieht, fuer die Ausgabe.
show_uri() { printf '%s' "$1" | sed -E 's#(://[^@/]*@)?[^/?]+#\1<host>#'; }

require_source_is_production() {
  local uri="$1"
  check_uri_clean "$uri" "DR_SOURCE_URI"
  case "$uri" in
    *"$PROD_REF"*) note "Quelle ist Production ($PROD_REF)";;
    *) fail "Die Quelle traegt nicht die Production-Referenz $PROD_REF. Dieses Skript sichert ausschliesslich Production.";;
  esac
}

forbid_target_prod_and_staging() {
  local uri="$1"
  check_uri_clean "$uri" "DR_TARGET_URI"
  case "$uri" in
    *"$PROD_REF"*) fail "Das Ziel ist PRODUCTION ($PROD_REF). Ein Restore dorthin ist ausgeschlossen.";;
    *"$STAGING_REF"*) fail "Das Ziel ist STAGING ($STAGING_REF). Ein Restore dorthin wuerde Staging ueberschreiben.";;
  esac
  : "${DR_TARGET_REF:?DR_TARGET_REF muss die Projektreferenz des TESTPROJEKTS sein — als bewusste Bestaetigung}"
  case "$uri" in
    *"$DR_TARGET_REF"*) note "Ziel ist das Testprojekt ($DR_TARGET_REF)";;
    *) fail "Die Ziel-URI enthaelt DR_TARGET_REF ($DR_TARGET_REF) nicht";;
  esac
}

# Eine Bestaetigung, die man nicht aus Gewohnheit wegtippt.
confirm() {
  local satz="$1"
  printf '\n  Zum Fortfahren bitte wortwoertlich eingeben:\n    %s\n  > ' "$satz"
  local eingabe; read -r eingabe
  [ "$eingabe" = "$satz" ] || fail "Bestaetigung stimmt nicht"
}
