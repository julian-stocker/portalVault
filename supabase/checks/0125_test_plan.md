# Testplan 0125 — bleiben die internen Belegfunktionen funktionsfähig?

**Die Frage, die dieser Plan beantwortet:** Nach dem Entzug erreichen
`seller_purchase_receipt`, `seller_issue_purchase_receipt` und (ab `0124`)
`purchase_receipt_stale` den Fingerabdruck **nur noch über implizite
Eigentümerrechte**. Trägt diese Kette wirklich, oder habe ich sie gekappt?

**Nichts hiervon ist ausgeführt.** Die SQL-Spalte sagt, was *Sie* tun würden.

---

## Die entscheidende Einsicht: der Test braucht keinen neuen Beleg

`seller_purchase_receipt(bigint)` ist `stable`, `security definer`, **liest
nur** — und ruft den Fingerabdruck (`0122`, Rumpfzeile 47):

```sql
      'stale', v_receipt.content_fingerprint
               is distinct from public.purchase_receipt_fingerprint(p_purchase_id)
```

Damit ist der vollständige funktionale Nachweis der Eigentümerkette ohne
**eine einzige Schreiboperation** möglich und ohne einen Eigenbeleg
auszustellen. `seller_issue_purchase_receipt` ist `volatile` und stellt aus —
die wird **nicht** aufgerufen.

---

## Stufe 1 · Statisch, lokal, ohne Datenbank

| # | Prüfung | Werkzeug | Status |
|---|---|---|---|
| S1 | `0125` enthält genau eine rechteverändernde Anweisung, und das ist ein `revoke` | `receipt-status.test.ts` | **grün** |
| S2 | `0125` enthält kein `create`/`alter`/`drop function`, kein DML auf Fachtabellen | dto. | **grün** |
| S3 | `0125` entzieht nur `authenticated`, nicht `service_role` | dto. | **grün** |
| S4 | die Nachbedingung verlangt ausdrücklich, dass `service_role` behält | dto. | **grün** |
| S5 | kein Anwendungscode ruft den Fingerabdruck per RPC | `grep src/ tools/` | **grün**, nur Treffer in Teststrings |
| S6 | alle SQL-Aufrufer sind `security definer` | dto. | **grün** |
| S7 | `0122` bleibt unverändert | `git diff --stat` auf `supabase/migrations/0122_*` | **grün**, 0 Zeilen |

Stufe 1 ist **ausgeführt**. Ergebnisse im Bericht.

## Stufe 2 · Lesend auf Staging, vor der Migration

**Staging ist seit dem 2026-10-15 schon im Zielzustand** — das `revoke` wurde
dort von Hand ausgeführt. Der Preflight erwartet deshalb keinen festen Wert
mehr für `authenticated`, sondern ordnet ein:

| # | Prüfung | Erwartung auf Staging | Erwartung auf Production |
|---|---|---|---|
| V1 | `0125_preflight.sql`, Zeile 9999 | 0 | 0 |
| V2 | 208 (erkannter Zustand) | `SICHER_NACH_REVOKE` | `UNSICHER_VOR_0125` |
| V3 | 207 (einer der beiden bekannten) | `true` | `true` |
| V4 | 301 / 302 (Eigentümerkette) | 1 / `postgres` | 1 / `postgres` |
| V5 | 921–923 notieren | drei Werte, die der Postflight **exakt** wiederholen muss |

Jedes `UNERWARTET_*` in 208 blockiert. Läuft 301 ≠ 1 oder 302 anders als
erwartet, **nicht migrieren**: dann trägt die Eigentümerkette nicht.

Läuft 301 ≠ 1 oder 302 anders als erwartet, **nicht migrieren**: dann trägt
die Eigentümerkette nicht, und der Entzug würde die Belegfunktionen kappen.

## Stufe 3 · Die Migration — auf Staging ein Leerlauf, und das ist in Ordnung

`0125` selbst prüft vor dem `revoke`, dass alle vier Funktionen denselben
Eigentümer haben, und bricht sonst ab. Erwartete Meldungen:

```
NOTICE:  0125: authenticated hat EXECUTE — wird entzogen.
NOTICE:  0125 ok: Fingerabdruck nur noch ueber die Eigentuemerkette erreichbar; ...
```

**Auf Staging ist genau die zweite Meldung zu erwarten:**

```
NOTICE:  0125: authenticated hat bereits kein EXECUTE — Leerlauf.
NOTICE:  0125 ok: Fingerabdruck nur noch ueber die Eigentuemerkette erreichbar; ...
```

Das `revoke` wurde dort am 2026-10-15 von Hand ausgeführt. Die Migration wird
trotzdem angewendet: sie ist die versionierte Quelle der Wahrheit, sie ist
idempotent, und ihr Wert ist hier die **Nachprüfung** — die Vorbedingung
belegt die Eigentümerkette, die Nachbedingung den Zielzustand, unabhängig
davon, wer ihn hergestellt hat. Auf **Production** wird dieselbe Datei den
tatsächlichen Entzug vornehmen und die erste Meldung ausgeben.

Erscheint auf Staging stattdessen `authenticated hat EXECUTE — wird
entzogen.`, wurde das Recht zwischenzeitlich neu vergeben. Kein Fehler der
Migration, aber **stoppen und berichten**: dann ist zu klären, wodurch.

## Stufe 4 · Lesend auf Staging, nach der Migration

| # | Prüfung | Erwartung |
|---|---|---|
| N1 | `0125_postflight.sql` | 9999 = 0; **101 = false**, 104 = **true** (`service_role` behält) |
| N2 | 923 gegen V2 | **zeichengleich**. Abweichung ⇒ untersuchen, nicht weitermachen |
| N3 | 302 gegen Preflight 302 | gleicher Eigentümer |
| N4 | 924 | 0 — die Belegtabellen bleiben für `anon` und `authenticated` gesperrt |

## Stufe 5 · Der funktionale Test der Eigentümerkette — `0125_function_test.sql`

**Hier stand ein Test, der nichts bewiesen hätte.** Er setzte
`request.jwt.claims` und rief dann die Funktionen auf. `request.jwt.claims`
ist aber eine GUC, die `auth.uid()` liest — **sie wechselt die Datenbankrolle
nicht**. Der SQL-Editor läuft als Eigentümer (`postgres`), und ein Eigentümer
darf seine eigenen Funktionen ohnehin ausführen, mit und ohne `revoke`. Beide
Teile wären trivial grün gewesen: F1 hätte funktioniert statt zu scheitern,
F2 ebenfalls — und der Test hätte „Kette trägt" gemeldet, ohne die Kette
angefasst zu haben.

Was es braucht, ist **`set local role authenticated`** — erst damit gelten die
Rechte der Rolle, um die es geht. Zusammen mit der Claim-Einstellung ergibt
das die vollständige Simulation: Rolle für die Rechte, `sub` für das
Betreibertor.

**Das ist ein neues Mittel in diesem Projekt und braucht Ihre Freigabe.**
`set local role` kommt in keiner Migration und keinem Werkzeug vor;
`npm run verify:rls:staging` arbeitet mit echten Auth-Nutzern über PostgREST.
Es ist kein Schreibvorgang, es vergibt keine Rechte, es endet mit der
Transaktion, und es kann die Rechte nur *verkleinern* — als `authenticated`
greift zusätzlich RLS. Es setzt voraus, dass die Sitzungsrolle Mitglied von
`authenticated` ist; **nachgeprüft habe ich das nicht**, Schritt 0 der Datei
prüft es und bricht sonst ab.

| # | Prüfung | Erwartung |
|---|---|---|
| F0 | `pg_has_role(current_user, 'authenticated', 'MEMBER')` | `true` — sonst sind F1/F2 nicht durchführbar. Dann **berichten**, nicht ausweichen |
| F1 | als `authenticated`: `seller_purchase_receipt(…)` | `SI-E-2026-000001`, `stale = false` |

**`SI-E-2026-000001` ist eine Staging-Testreferenz** — der einzige auf
Staging ausgestellte Eigenbeleg. Keine Production-Belegnummer, keine
personenbezogene Angabe.
| F2 | als `authenticated`: `purchase_receipt_fingerprint(…)` direkt | **scheitert** mit `permission denied for function purchase_receipt_fingerprint` |

**F1 und F2 zusammen sind der ganze Punkt von `0125`:** derselben Rolle wird
der direkte Weg verwehrt und der beabsichtigte bleibt offen. Fällt F1 durch,
ist `0125` zurückzunehmen — `grant execute on function
public.purchase_receipt_fingerprint(bigint) to authenticated;`.

F2 bricht seine Transaktion ab und steht deshalb in einem eigenen Lauf.

**Eine Falle, die beim Schreiben zugeschnappt ist:** `0122` Zeile 246 entzieht
`purchase_receipts` *alle* Tabellenrechte für `authenticated`. Eine
Unterabfrage auf diese Tabelle nach dem Rollenwechsel scheitert mit
`permission denied for table purchase_receipts` — der Test wäre rot geworden,
ohne etwas über den Fingerabdruck zu sagen. Die Einkaufs-ID wird deshalb
**vor** dem Rollenwechsel als Eigentümer ermittelt und transaktionslokal
abgelegt.

**Wenn Sie `set local role` nicht einsetzen wollen:** dann ist der Entzug
durch den Postflight belegt (ACL und `has_function_privilege`) und durch die
Oberfläche (Stufe 6) — aber nicht durch einen tatsächlichen Aufruf unter der
Rolle. Eine kleinere Zusicherung, ehrlich benannt.

## Stufe 6 · Durch die Oberfläche

| # | Prüfung | Erwartung |
|---|---|---|
| U1 | `/business/orderbuch`, (i)-Dialog eines Einkaufs mit Beleg | Belegnummer, Datum und „stimmt überein" wie vorher |
| U2 | Beleg-PDF herunterladen | lädt, Abrufzähler steigt |
| U3 | Nach `0124`: Spalte „Beleg" | ein grüner Punkt, kein `?` |

**U3 ist der Regressionstest, der 0125 und 0124 verbindet.** Zeigt die
Belegspalte nach beiden Migrationen `?`, hat die Schutzhülle einen
Rechtefehler gefangen — dann ist `0125` zu breit geraten.

## Was ausdrücklich NICHT getestet wird

- **Kein neuer Eigenbeleg.** `seller_issue_purchase_receipt` wird nicht
  aufgerufen. Ein ausgestellter Beleg ist unveränderlich und hat keinen
  Rückweg; die Kette ist über `seller_purchase_receipt` vollständig prüfbar.
- **Kein Production-Zugriff.** Der Befund betrifft Production ebenso, aber
  erst nach Staging und erst nach eigener Freigabe.
- **Keine Rechteänderung durch mich.** Weder hier noch per Werkzeug.
