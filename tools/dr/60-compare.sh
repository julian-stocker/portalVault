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
# Bis M-03C wurde die Datei nur ausgegeben: eine verfehlte Zielpruefung liess
# den Vergleich trotzdem bestehen. Jetzt traegt jede Zeile ihr Urteil (`ok`,
# letzte Spalte), und jedes `f` ist ein Befund (M-03D).
if [ -f "$B/verify-target.csv" ]; then
  cat "$B/verify-target.csv"
  head -1 "$B/verify-target.csv" | grep -qE ',ok$' \
    || { printf '  FEHLT    Spalte ok in verify-target.csv\n'; befunde=$((befunde + 1)); }
  n_ziel="$(awk -F, 'NR > 1' "$B/verify-target.csv" | grep -c . || true)"
  [ "${n_ziel:-0}" -ge 9 ] \
    || { printf '  ZU WENIG Zielpruefungen: %s, erwartet 9\n' "${n_ziel:-0}"; befunde=$((befunde + 1)); }
  n_rot="$(awk -F, 'NR > 1 && $NF != "t"' "$B/verify-target.csv" | grep -c . || true)"
  if [ "${n_rot:-0}" -gt 0 ]; then
    printf '  NICHT OK %s Zielpruefung(en)\n' "$n_rot"; befunde=$((befunde + n_rot))
  else
    printf '  ok       alle Zielpruefungen\n'
  fi
else
  printf '  FEHLT    verify-target.csv\n'; befunde=$((befunde + 1))
fi

note "--- die Rechteproben aus 50-verify.sh"
# Auch sie wurden bisher nur ausgegeben. anon darf `purchases` nicht lesen:
# erwartet ist ein Rechtefehler oder 0 Zeilen, alles andere ist ein Befund.
if [ -f "$B/rls-anon-purchases.txt" ] \
   && grep -qiE '^0$|permission denied|keine Berechtigung' "$B/rls-anon-purchases.txt"; then
  printf '  ok       anon liest public.purchases nicht\n'
else
  printf '  NICHT OK anon und public.purchases: %s\n' \
    "$(tr -d '\n' < "$B/rls-anon-purchases.txt" 2>/dev/null | head -c 120)"
  befunde=$((befunde + 1))
fi
# Die Belegsperre: Gibt es Belege, MUSS das update abbrechen. Ohne Belege
# trifft es nichts — dann bleibt nur die Triggerzeile 4 in verify-target.csv.
belege="$(grep -E '^public,purchase_receipts,' "$B/baseline-rows.csv" | cut -d, -f3 || true)"
if grep -qiE "unveraender|immutable|cannot be changed|P0001" "$B/immutability.txt" 2>/dev/null; then
  printf '  ok       Belegsperre hat gegriffen\n'
elif [ "${belege:-0}" = "0" ]; then
  printf '  hinweis  keine Belege im Ziel — die Sperre ist nur ueber Zielpruefung 4 belegt\n'
else
  printf '  NICHT OK Belegsperre griff nicht, obwohl %s Belege im Ziel stehen\n' "$belege"
  befunde=$((befunde + 1))
fi

printf '\n'
if [ "$befunde" -eq 0 ]; then
  note "KEIN BEFUND. Damit ist der Restore in allen gemessenen Punkten gleich,"
  note "und jede Zielpruefung und Rechteprobe hat bestanden. Die Ausgabe oben"
  note "gehoert trotzdem ins Protokoll — gelesen, nicht nur gezaehlt."
  exit 0
fi
fail "$befunde Befund(e). Der Restore ist NICHT bestanden. Teilweise gelungen zaehlt nicht."
