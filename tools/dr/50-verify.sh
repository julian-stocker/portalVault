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

note "--- Effektive Rechte auf jede Relation in public OHNE eigene ACL"
# pg_dump schreibt fuer eine Relation, deren ACL nur aus den Eigentuemerrechten
# besteht, KEINE Anweisung: im Ziel steht dann eine leere ACL (NULL). Ob das
# gleichwertig ist, entscheidet nicht der Text, sondern was die Rollen
# wirklich duerfen. 60-compare.sh wertet diese Datei aus (F4b.6).
# Grenze: lokal ist `postgres` Superuser — seine Spalte sagt dort nichts.
"$PGBIN/psql" "$DR_TARGET_URI" --no-psqlrc --set=ON_ERROR_STOP=1 --csv \
  > "$OUT/rights-effective.csv" <<'SQL'
select c.relname as objekt,
       pg_get_userbyid(c.relowner) as eigentuemer,
       r.rolle,
       has_table_privilege(r.rolle, c.oid, 'SELECT') as sel,
       has_table_privilege(r.rolle, c.oid, 'INSERT') as ins,
       has_table_privilege(r.rolle, c.oid, 'UPDATE') as upd,
       has_table_privilege(r.rolle, c.oid, 'DELETE') as del
  from pg_class c
 cross join (values ('anon'), ('authenticated'), ('service_role'), ('postgres')) r(rolle)
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'v', 'p')
   and c.relacl is null
 order by 1, 3;
SQL
note "$(awk -F, 'NR > 1' "$OUT/rights-effective.csv" | cut -d, -f1 | sort -u | grep -c . || true) Relation(en) ohne eigene ACL"

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
