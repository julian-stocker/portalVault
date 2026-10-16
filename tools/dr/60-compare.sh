#!/usr/bin/env bash
# Schritt 6 — der Vergleich (a) gegen (b). HIER wird bestanden oder nicht.
#
#   DR_VOL=… bash tools/dr/60-compare.sh
#
# Die Regel, die dieses Skript durchsetzt: EIN TEILWEISE GELUNGENER RESTORE
# IST NICHT BESTANDEN. Es prueft deshalb nicht, ob Fehler ausblieben, sondern
# ob die Zahlen GLEICH sind — und es zaehlt zusaetzlich, dass ueberhaupt
# genug vorhanden ist. Fehlendes faellt sonst durch jedes "keine Fehler".
source "$(dirname "$0")/lib.sh"
require_volume

A="$DR_VOL/baseline-quelle"
B="$DR_VOL/baseline-ziel"
[ -d "$A" ] || fail "$A fehlt — 10-baseline.sh wurde nicht gelaufen"
[ -d "$B" ] || fail "$B fehlt — 50-verify.sh wurde nicht gelaufen"
OUT="$DR_VOL/vergleich"
mkdir -p "$OUT"

befunde=0
pruef() {                       # pruef <datei> <was> [filter]
  local datei="$1" was="$2" filter="${3:-cat}"
  if [ ! -f "$A/$datei" ] || [ ! -f "$B/$datei" ]; then
    printf '  FEHLT    %s\n' "$was"; befunde=$((befunde + 1)); return
  fi
  if eval "$filter" < "$A/$datei" > "$OUT/a-$datei" \
     && eval "$filter" < "$B/$datei" > "$OUT/b-$datei" \
     && diff -u "$OUT/a-$datei" "$OUT/b-$datei" > "$OUT/diff-$datei"; then
    printf '  gleich   %s\n' "$was"
  else
    printf '  ABWEICH. %s  -> %s\n' "$was" "$OUT/diff-$datei"
    befunde=$((befunde + 1))
  fi
}

note "--- Vergleich (a) Quelle vor dem Dump  gegen  (b) Ziel nach dem Restore"

# Der Katalog von `cron` darf abweichen: das Schema wird absichtlich nicht
# restauriert. Alles andere muss Zeile fuer Zeile gleich sein.
pruef baseline-catalog.csv     "Katalog-Inventar (ohne cron)" "grep -v '^cron,'"
pruef baseline-rows.csv        "Zeilenzahlen je Tabelle (alle)"
pruef baseline-sequences.csv   "Sequenzstaende (alle, inkl. Identitaetsspalten)"
pruef baseline-digests.csv     "Inhaltsabdruecke (29 Tabellen)"
pruef baseline-definitions.csv "Definitionen: Spalten, Constraints, Indizes, Trigger, Policies, Funktionen, RLS"
pruef baseline-grants.csv      "Rechte: Tabellen-, Funktions- und Schema-ACL"
pruef baseline-business.csv    "Geschaeftsinvarianten: Belegkette, Lagerbilanz, Bestellungen, Rechnungen, Zaehler"
pruef shape-auth-storage.csv   "Spaltenform von auth und storage"

note "--- Vollstaendigkeit, unabhaengig vom Vergleich"
# Ein leeres Ziel wuerde gegen ein leeres (a) "gleich" ergeben. Deshalb
# zusaetzlich Mindestmengen pruefen.
mindestens() {                 # mindestens <datei> <muster> <zahl> <was>
  local n
  n="$(grep -cE "$2" "$B/$1" || true)"
  if [ "${n:-0}" -ge "$3" ]; then printf '  ok       %s (%s)\n' "$4" "$n"
  else printf '  ZU WENIG %s: %s, erwartet mindestens %s\n' "$4" "${n:-0}" "$3"
       befunde=$((befunde + 1)); fi
}
mindestens baseline-rows.csv '^public,'  40 "Tabellen in public gezaehlt"
mindestens baseline-catalog.csv '^public,(Funktion|Trigger|Policy|Index)' 4 "Objektarten in public"
mindestens baseline-sequences.csv '^public,' 20 "Sequenzen in public"
mindestens baseline-definitions.csv '^constraint,' 60 "Constraint-Definitionen"
mindestens baseline-definitions.csv '^index,' 80 "Index-Definitionen"
mindestens baseline-definitions.csv '^trigger,' 20 "Trigger-Definitionen"
mindestens baseline-definitions.csv '^policy,' 20 "Policy-Definitionen"
mindestens baseline-definitions.csv '^funktion,' 100 "Funktions-Definitionen"
mindestens baseline-grants.csv '^tabelle,' 40 "Tabellen mit ACL-Zeile"
mindestens baseline-business.csv '^[0-9]+,' 20 "Geschaeftsinvarianten"

note "--- die Zielpruefungen aus verify-target.csv"
if [ -f "$B/verify-target.csv" ]; then
  cat "$B/verify-target.csv"
else
  printf '  FEHLT    verify-target.csv\n'; befunde=$((befunde + 1))
fi

printf '\n'
if [ "$befunde" -eq 0 ]; then
  note "KEIN BEFUND. Damit ist der Restore in allen gemessenen Punkten gleich."
  note "Das Urteil 'bestanden' setzt zusaetzlich voraus, dass die Zeilen aus"
  note "verify-target.csv von Hand gelesen und erklaert wurden — insbesondere"
  note "cron.job = 0, die vier Policies, der Bucket und auth.users."
  exit 0
fi
fail "$befunde Befund(e). Der Restore ist NICHT bestanden. Teilweise gelungen zaehlt nicht."
