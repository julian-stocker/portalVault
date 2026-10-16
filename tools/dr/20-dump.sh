#!/usr/bin/env bash
# Schritt 2 — die drei Dumps, das Inhaltsverzeichnis und das Prüfsummen-Manifest.
#
#   DR_SOURCE_URI=… bash tools/dr/20-dump.sh
#
# Kein --jobs: die Free-Instanz ist klein, und ueber den Session-Pooler bringt
# Parallelitaet nur zusaetzliche Verbindungen.
# Kein --no-acl: die Rechte sind Teil des Sicherheitsmodells.
# Kein --clean, kein --create: dieser Dump wird NIE ueber eine bestehende
# Datenbank gelegt.
source "$(dirname "$0")/lib.sh"
require_client; require_volume; require_pgpass
: "${DR_SOURCE_URI:?DR_SOURCE_URI fehlt}"
require_source_is_production "$DR_SOURCE_URI"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DR_VOL/dump-$STAMP"
mkdir -p "$OUT"
note "Ziel: $OUT"

GEMEINSAM=(--no-owner --no-publications --no-subscriptions)

note "--- 1/3 Schema als lesbarer Text (public + storage)"
"$PGBIN/pg_dump" "$DR_SOURCE_URI" --schema-only \
  --schema=public --schema=storage "${GEMEINSAM[@]}" \
  --file="$OUT/schema_public_storage.sql"

note "--- 2/3 Gesamtdump im Maschinenformat (public + storage + auth)"
"$PGBIN/pg_dump" "$DR_SOURCE_URI" --format=custom --compress=9 \
  --schema=public --schema=storage --schema=auth "${GEMEINSAM[@]}" \
  --file="$OUT/full.dump"

note "--- 3/3 nur Daten (fuer ein Ziel, das auth und storage schon mitbringt)"
"$PGBIN/pg_dump" "$DR_SOURCE_URI" --data-only --format=custom --compress=9 \
  --schema=public --schema=storage --schema=auth --no-owner \
  --file="$OUT/data.dump"

note "--- Inhaltsverzeichnis, ohne Datenbank gelesen"
"$PGBIN/pg_restore" --list "$OUT/full.dump" > "$OUT/full.toc"
grep -c ';' "$OUT/full.toc" | xargs -I{} note "{} Zeilen im Inhaltsverzeichnis"

note "--- Mindestpruefungen auf die Datei selbst"
for s in public storage auth; do
  grep -qE "^[0-9]+; .* $s " "$OUT/full.toc" \
    || fail "im Inhaltsverzeichnis fehlt das Schema $s — der Dump ist unbrauchbar"
done
grep -qE "^[0-9]+; .* TABLE DATA public purchases " "$OUT/full.toc" \
  || fail "keine Daten fuer public.purchases im Dump"
grep -qE "^[0-9]+; .* SEQUENCE SET public " "$OUT/full.toc" \
  || fail "keine Sequenzstaende im Dump — nach einem Restore vergaebe die erste Neuanlage eine belegte Nummer"

GROESSE="$(wc -c < "$OUT/full.dump")"
[ "$GROESSE" -gt 102400 ] || fail "full.dump ist nur $GROESSE Bytes — zu klein, um vollstaendig zu sein"
[ "$GROESSE" -lt 209715200 ] || fail "full.dump ist $GROESSE Bytes — unerwartet gross, erst klaeren"
note "full.dump: $GROESSE Bytes"

note "--- Pruefsummen"
( cd "$OUT" && shasum -a 256 -- * > MANIFEST.txt )
cat "$OUT/MANIFEST.txt"

printf '\n  Dumps liegen in %s. Als naechstes 30-filter-toc.mts.\n\n' "$OUT"
