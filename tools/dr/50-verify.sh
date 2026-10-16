#!/usr/bin/env bash
# Schritt 5 — Messung (b): derselbe Satz Abfragen im ZIEL, plus die
# Zielpruefungen, die nur dort sinnvoll sind.
#
#   DR_TARGET_URI=… DR_TARGET_REF=… bash tools/dr/50-verify.sh
source "$(dirname "$0")/lib.sh"
require_client; require_volume; require_pgpass
: "${DR_TARGET_URI:?}"
forbid_target_prod_and_staging "$DR_TARGET_URI"

OUT="$DR_VOL/baseline-ziel"
mkdir -p "$OUT"
SQL="$(dirname "$0")/../../supabase/checks/dr"

for f in baseline-catalog baseline-rows baseline-sequences baseline-digests \
         baseline-definitions baseline-grants baseline-business shape-auth-storage \
         verify-target; do
  note "lese $f"
  "$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --csv --file="$SQL/$f.sql" > "$OUT/$f.csv"
done

note "--- RLS wirkt wirklich: als anon lesen"
# Eine Policy, die existiert, aber nicht greift, faellt beim Zaehlen nicht auf.
"$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=0 -tA \
  --command="set local role anon; select count(*) from public.purchases" \
  > "$OUT/rls-anon-purchases.txt" 2>&1 || true
note "Ergebnis: $(tr -d '\n' < "$OUT/rls-anon-purchases.txt" | head -c 200)"
note "  erwartet: 0 oder ein Rechtefehler — jede andere Zahl ist ein Befund"

note "--- Unveraenderlichkeit: ein update auf purchase_receipts MUSS abbrechen"
"$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=0 -tA \
  --command="begin; update public.purchase_receipts set receipt_number = receipt_number; rollback;" \
  > "$OUT/immutability.txt" 2>&1 || true
if grep -qiE "unveraender|immutable|kann nicht|cannot|P0001" "$OUT/immutability.txt"; then
  note "Trigger hat gegriffen"
else
  note "AUSGABE: $(tr -d '\n' < "$OUT/immutability.txt" | head -c 200)"
  note "  Hinweis: bei 0 Belegzeilen trifft der Trigger nichts. Dann ist dies"
  note "  KEIN Nachweis — die Zeile 'Trigger vorhanden' aus verify-target.csv zaehlt."
fi

note "--- geschrieben nach $OUT"
ls -l "$OUT"
printf '\n  Messung (b) steht. Jetzt 60-compare.sh.\n\n'
