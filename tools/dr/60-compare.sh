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

# ---------------------------------------------------------------------------
# DIE AUSNAHMEN (F4b.6, 2026-11-18). Jede ist einzeln benannt, begruendet und
# in src/lib/admin/dr-compare.test.ts gegen ihr Gegenteil geprueft. Keine
# gilt fuer ein ganzes Schema.
# ---------------------------------------------------------------------------

# (1) Plattformtabellen, deren ZEILEN der Plan bewusst nicht zurueckspielt
#     (30-filter-toc.mts: aus auth nur users/identities, aus storage nur
#     buckets/objects). Sitzungen, Tokens, Flows und die beiden
#     Versionsregister gehoeren dem Zielprojekt. Die Zeile der Tabelle bleibt
#     im Vergleich — sie muss auf beiden Seiten EXISTIEREN —, nur ihre
#     Zeilenzahl wird nicht verglichen. Ihre Spaltenform prueft weiter
#     shape-auth-storage. Eine Tabelle, die hier fehlt, wird voll verglichen:
#     eine neue Supabase-Tabelle faellt also auf, statt durchzurutschen.
PLATTFORM_OHNE_ZEILEN="
auth.audit_log_entries auth.custom_oauth_providers auth.flow_state
auth.instances auth.mfa_amr_claims auth.mfa_challenges auth.mfa_factors
auth.mfa_recovery_code_sets auth.mfa_recovery_codes auth.oauth_authorizations
auth.oauth_client_states auth.oauth_clients auth.oauth_consents
auth.one_time_tokens auth.refresh_tokens auth.saml_providers
auth.saml_relay_states auth.schema_migrations auth.scim_tokens auth.scim_users
auth.sessions auth.sso_domains auth.sso_providers auth.webauthn_challenges
auth.webauthn_credentials
storage.bucket_lifecycle_states storage.buckets_analytics storage.buckets_vectors
storage.lifecycle_abandoned_artifacts storage.migrations
storage.s3_multipart_uploads storage.s3_multipart_uploads_parts
storage.vector_indexes"

# (2) Plattformsequenzen, deren STAND der Plan nicht zurueckspielt — sie
#     zaehlen fuer eine Tabelle aus (1).
PLATTFORM_SEQUENZEN_OHNE_STAND="auth.refresh_tokens_id_seq"

# (3) CHECK-Constraints, deren Text sich beim Restore nachweislich NUR in der
#     Klammerung verschachtelter AND aendert. `x between a and b` wird als
#     ((x >= a) AND (x <= b)) gespeichert und innerhalb eines weiteren AND
#     verschachtelt; pg_dump schreibt das so aus, und das erneute Einlesen
#     fasst die AND-Kette zusammen. Nachweis 2026-11-18: md5 des Dumptexts =
#     Quell-Abdruck, und derselbe Text, im Ziel neu eingelesen, ergibt exakt
#     den Ziel-Abdruck. Gepaart wird je Name genau EIN Quell- mit genau EINEM
#     Ziel-Abdruck; jede andere Aenderung bleibt eine Abweichung.
#     Format: <schema.tabelle.constraint> <md5 Quelle> <md5 Ziel>
CHECK_AND_KETTE="
public.orders.orders_tracking_number_shape b58560d2b4dcf9166975fa3465d18615 2dbdfdd8128a3f7c81950af957de4604
public.perf_interactions.perf_interactions_viewport_sane d67c6156547b6db4424669f7a8c44cb9 cd2facf1fe84012b9ea9087120cc2304
public.perf_navigations.perf_navigations_viewport_sane d67c6156547b6db4424669f7a8c44cb9 cd2facf1fe84012b9ea9087120cc2304
public.profiles.profiles_username_format 3eb37843e35ff25c5a2fd84f799b263d b0a91b584e6aa0cab02f0b82f035e514"

# (4) Lokales Ziel. Nur wenn der Bediener DR_TARGET_KIND=local AUSDRUECKLICH
#     setzt, gelten zwei Unterschiede als Eigenschaft der Testumgebung statt
#     als Befund: die Zahl der Extensions (Supabase bringt sie mit, ein
#     lokaler Cluster nicht; der Plan verweist auf keine) und die Schema-ACL
#     von auth und storage (sie stammt aus der lokalen Plattformhuelle, nicht
#     aus dem Plan). Beides wird ausgegeben, nicht verschwiegen. Die ACL von
#     public wird IMMER verglichen. Fuer ein Supabase-Ziel bleibt alles streng.
LOKAL=0
[ "${DR_TARGET_KIND:-}" = "local" ] && LOKAL=1

# BSD awk (macOS) refuses a newline inside -v: the lists go in flattened.
flach() { printf '%s' "$1" | tr '\n' "${2:- }"; }
maskiere_zeilen() {
  awk -F, -v liste="$(flach "$PLATTFORM_OHNE_ZEILEN")" '
    BEGIN { n = split(liste, t, / +/); for (i = 1; i <= n; i++) if (t[i] != "") m[t[i]] = 1 }
    NR > 1 && (($1 "." $2) in m) { print $1 "," $2 ",(Plattform, nicht restauriert)"; next }
    { print }'
}
maskiere_sequenzen() {
  awk -F, -v liste="$(flach "$PLATTFORM_SEQUENZEN_OHNE_STAND")" '
    BEGIN { n = split(liste, t, / +/); for (i = 1; i <= n; i++) if (t[i] != "") m[t[i]] = 1 }
    NR > 1 && (($1 "." $2) in m) { print $1 "," $2 ",(Plattform, nicht restauriert)"; next }
    { print }'
}
ohne_extensions() { grep -v '^cron,' | grep -v '^global,Extension,'; }
paare_check_and_kette() {
  awk -F, -v liste="$(flach "$CHECK_AND_KETTE" ';')" '
    BEGIN { n = split(liste, z, /;/)
            for (i = 1; i <= n; i++) { split(z[i], f, " "); if (f[1] != "") { q[f[1]] = f[2]; ziel[f[1]] = f[3] } } }
    $1 == "constraint" && ($2 in q) && ($3 == q[$2] || $3 == ziel[$2]) {
      print "constraint," $2 ",AND-Kette:" q[$2] "~" ziel[$2]; next }
    { print }'
}

# Katalog: `cron` wird absichtlich nicht restauriert. Extensions getrennt, unten.
pruef baseline-catalog.csv     "Katalog-Inventar (ohne cron, Extensions getrennt)" "ohne_extensions"
ext_a="$(grep -E '^global,Extension,' "$A/baseline-catalog.csv" | cut -d, -f3 || true)"
ext_b="$(grep -E '^global,Extension,' "$B/baseline-catalog.csv" | cut -d, -f3 || true)"
if [ -n "$ext_a" ] && [ "$ext_a" = "$ext_b" ]; then
  printf '  gleich   Extensions (%s)\n' "$ext_a"
elif [ "$LOKAL" = "1" ]; then
  printf '  umgebung Extensions: Quelle %s, Ziel %s — lokales Ziel (DR_TARGET_KIND=local); ein Supabase-Ziel muss sie mitbringen\n' "${ext_a:-?}" "${ext_b:-?}"
else
  printf '  ABWEICH. Extensions: Quelle %s, Ziel %s\n' "${ext_a:-?}" "${ext_b:-?}"
  befunde=$((befunde + 1))
fi
pruef baseline-rows.csv        "Zeilenzahlen je Tabelle (alle; Plattformtabellen ohne Zeilen siehe Liste)" "maskiere_zeilen"
pruef baseline-sequences.csv   "Sequenzstaende (alle, inkl. Identitaetsspalten; Plattformsequenzen siehe Liste)" "maskiere_sequenzen"
pruef baseline-digests.csv     "Inhaltsabdruecke (29 Tabellen)"
pruef baseline-definitions.csv "Definitionen: Spalten, Constraints, Indizes, Trigger, Policies, Funktionen, RLS" "paare_check_and_kette"

# Rechte. (5) Leere ACL im Ziel gegen ausdrueckliche Eigentuemer-ACL in der
# Quelle: pg_dump schreibt fuer `postgres=arwdDxtm/postgres` (genau die
# Eigentuemerrechte) keine Anweisung, im Ziel steht dann NULL. Gleichwertig
# ist das NUR, wenn 50-verify.sh fuer genau diese Relation belegt: Eigentuemer
# postgres, und anon, authenticated, service_role duerfen weder SELECT noch
# INSERT, UPDATE, DELETE. Sonst bleibt es eine Abweichung.
NULL_ACL_GLEICHWERTIG=""
for obj in $(grep -E '^tabelle,public\.[a-z0-9_]+,postgres=arwdDxtm/postgres$' "$A/baseline-grants.csv" | cut -d, -f2); do
  grep -qxF "tabelle,$obj,(Standard)" "$B/baseline-grants.csv" 2>/dev/null || continue
  name="${obj#public.}"
  if [ -f "$B/rights-effective.csv" ] && awk -F, -v n="$name" '
       $1 == n { rows++; if ($2 != "postgres") bad++
                 if ($3 != "postgres" && ($4 != "f" || $5 != "f" || $6 != "f" || $7 != "f")) bad++ }
       END { exit !(rows == 4 && bad == 0) }' "$B/rights-effective.csv"; then
    NULL_ACL_GLEICHWERTIG="$NULL_ACL_GLEICHWERTIG $obj"
    printf '  ok       %s: Ziel ohne eigene ACL, effektiv nur der Eigentuemer postgres (anon, authenticated, service_role: kein S/I/U/D)\n' "$obj"
  else
    printf '  NICHT OK %s: leere ACL im Ziel, effektive Rechte nicht als gleichwertig belegt\n' "$obj"
  fi
done
normalisiere_rechte() {
  awk -v liste="$NULL_ACL_GLEICHWERTIG" -v lokal="$LOKAL" '
    BEGIN { n = split(liste, t, " "); for (i = 1; i <= n; i++) ok[t[i]] = 1 }
    skip { if ($0 ~ /"$/) skip = 0; next }
    lokal == 1 && /^schema,(auth|storage),/ {
      split($0, f, ","); print "schema," f[2] ",(lokale Plattformhuelle, nicht verglichen)"
      if ($0 ~ /,"/ && $0 !~ /"$/) skip = 1; next }
    /^tabelle,public\.[a-z0-9_]+,\(Standard\)$/ {
      split($0, f, ","); if (f[2] in ok) { print "tabelle," f[2] ",postgres=arwdDxtm/postgres"; next } }
    { print }'
}
pruef baseline-grants.csv      "Rechte: Tabellen-, Funktions- und Schema-ACL" "normalisiere_rechte"
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
