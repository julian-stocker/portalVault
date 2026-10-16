# `supabase/checks/` — Prüf-SQL rund um eine Migration

Lesende SQL-Dateien, die eine Migration **umrahmen**: Preflight vor der
Anwendung, Postflight danach, Baselines für Vorher/Nachher-Vergleiche,
Diagnosen und Testpläne. Sie werden **von Hand im Supabase-SQL-Editor
ausgeführt**, nie automatisch, und sind kein Teil des Migrationsablaufs.

## Abgrenzung zu `supabase/tests/`

| Ordner | Was dort liegt |
|---|---|
| `supabase/migrations/` | der Schemazustand — wird angewendet |
| `supabase/tests/` | Laufzeitverifikation von Verhalten (`0015_runtime_verification.sql` …) |
| `supabase/checks/` | Katalog- und Rechteprüfungen **um** eine Migration, plus Baselines |

## Regeln für Dateien in diesem Ordner

1. **Nur lesend.** Kein `insert`, `update`, `delete`, DDL, `grant`/`revoke`.
   Einzige erlaubte Ausnahme: transaktionslokales `set_config(..., true)` für
   eine Claim-Simulation, immer in `begin; … rollback;`.
2. **Kein `set role`** ohne ausdrückliche Freigabe. `0125_function_test.sql`
   braucht es und ist deshalb **nicht freigegeben**; der Kopf der Datei sagt
   das.
3. **Keine absichtlichen SQL-Fehler als Statusmeldung.** Ein konstanter Cast
   wie `'ABBRUCH'::int` wird von PostgreSQL **beim Planen** ausgewertet und
   feuert dann immer — auch in einem `CASE`-Zweig, der nie genommen wird
   (Handbuch, „Conditional Expressions"). Status gehört in eine Textspalte.
4. **Keine internen Zahlen im Quelltext.** Keine Lager-, Order- oder
   Einkaufszahlen aus Staging oder Production in Kommentaren — `CLAUDE.md`,
   Regel 3. Erwartungswerte gehören in den Prüfbericht, nicht in die Datei.
5. **Keine personenbezogenen Daten.** Keine Namen, Anschriften, E-Mail-Adressen,
   Benutzer-UUIDs — auch nicht gekürzt, auch nicht gehasht. Belegnummern aus
   Staging sind zulässig, wenn sie **als Staging-Testreferenz gekennzeichnet**
   sind.
6. **Dateinamen englisch**, Muster `NNNN_<zweck>.sql` mit der Migrationsnummer
   vorn (`CLAUDE.md`, Regel 5).
7. **Eine Anweisung je Prüfdatei**, wo es geht: ein `select`, das eine Tabelle
   mit `nr · bereich · pruefung · befund · erwartet · ok` liefert und als
   letzte Zeile `9999` mit der Zahl blockierender Abweichungen. `9999 = 0`
   heißt bestanden.

## Was hier liegt

| Datei | Zweck |
|---|---|
| `0124_preflight.sql` | Eingangszustand vor `0124`; setzt `0125` voraus |
| `0124_baseline.sql` | Ledger-Ausgabe über alle Filter, als Hash — sechs Läufe |
| `0124_baseline_guard.sql` | Diagnose, wenn die Baseline nicht `OK` sagt |
| `0124_rollback_check.sql` | nach einem abgebrochenen `0124`-Versuch: ist der Zustand von vorher wieder da? |
| `0124_postflight.sql` | Zielzustand nach `0124` |
| `0124_fingerprint_failure_isolated.sql` | **nur Wegwerf-Instanz**: erzwungener Fingerabdruck-Fehler |
| `0124_test_matrix.md` | Browser- und Datenfälle D1–D10, B1–B8, A1–A7, R1–R7 |
| `0125_preflight.sql` | Rechtezustand vor `0125`; lässt beide Normallagen zu |
| `0125_postflight.sql` | Zielzustand nach `0125`, streng |
| `0125_function_test.sql` | Eigentümerkette unter der Rolle `authenticated` — **nicht freigegeben** |
| `0125_test_plan.md` | Stufen S1–S7, V1–V5, N1–N4, F0–F2, U1–U3 |
| `0126_preflight.sql` | Eingangszustand vor `0126`; prüft die drei gerufenen Funktionen samt Schutzregeln |
| `0126_postflight.sql` | Trigger, Speicherfunktion, Rechte und unveränderter Bestand nach `0126` |
| `0127_preflight.sql` | Eingangszustand vor `0127`; Abhängigkeiten der Funktion, heutiger ACL, Zustandsbefund |
| `0127_postflight.sql` | eine Fassung mit sechs Parametern, wiederhergestellte Rechte, unveränderter Bestand nach `0127` |
| `0127_signature_diagnosis.sql` | nach dem Abbruch von `0127`: tatsächliche Signatur, Rückrollzustand, und der Ganzarray-Vergleich nachgestellt |
| `0127_swap_effect_check.sql` | nach einem unklaren Speichern: ist der Figurenwechsel in der Datenbank angekommen, und weicht ein Beleg jetzt ab? |
| `0128_preflight.sql` | Eingangszustand vor `0128`; Kettenstruktur aus `0122`, Eigentümerkette, Zustandsbefund |
| `0128_postflight.sql` | zwei Spalten, zwei Funktionen, Rumpf und unberührte Belege nach `0128` |
| `0128_test_plan.md` | die Schreibfälle K1–K10, darunter Nebenläufigkeit in zwei Fenstern |
| `0129_preflight.sql` | Eingangszustand vor `0129`; alle 38 Spalten, die der Export nennen wird |
| `0129_postflight.sql` | 28 Bereiche, Kette im Export, keine Kontoidentität, nichts geschrieben |
| `0129_restore_test.md` | Wiederherstellung mit drei Belegrevisionen — **Handprüfung auf isolierter Testdatenbank** |
| `0129_export_baseline.sql` | die Gegenzahl zum heruntergeladenen Backup: Zeilenzahl je Bereich, Belegkette, Prüfsummen, Lückenzählung |
| `0130_backup_extension_proposal.md` | der Vorschlag zu den 57 unentschiedenen Spalten — A1/A3/B umgesetzt, **A2 nicht freigegeben** |
| `0130_preflight.sql` | Eingangszustand vor `0130`; die 18 Spalten müssen existieren, die 9 privaten dürfen nicht im Export sein |
| `0130_postflight.sql` | die 18 Feldzeilen, die 9 privaten weiter draußen, Form und Vertrag unverändert |
| `0131_preflight.sql` | Eingangszustand vor `0131`; die 13 Rechtsangaben, genau eine aktive Verkäuferzeile |
| `0131_postflight.sql` | die 13 Feldzeilen, Bereich `seller` ohne Zeitstempel, frühere Ergänzungen intakt |
| `0131_state_diagnosis.sql` | nach dem Abbruch von `0131`: Stand `0130` oder teilweise `0131`, die 13 erwarteten gegen die erkannten `seller`-Schlüssel — **ohne Verkäuferwerte** |
| `0130_staging_order.md` | die Ausführungsreihenfolge für `0130`/`0131`: Preflight, Migration, Postflight, Download, Verifikation |
| `0130_export_keys_diagnosis.sql` | welche JSON-Schlüssel wirklich in welchem Bereich stehen — mit Selbsttest des Bereichsparsers |
| `0130_amendment.md` | **Nachtrag**: `0130` wurde nach der Ausführung geändert — Umfang, Beweis, Rezept für die ausgeführte Fassung. `0130` wird nicht erneut angewendet |
| `backup_architecture_two_tier.md` | die zweistufige Backup-Architektur: Geschäftsbackup und geschütztes Notfall-Backup, Abhängigkeitsmatrix, Implementierungsplan |
| `0131_function_body_check.sql` | der Anker gegen den Zirkel: `md5(prosrc)` der lebenden `seller_business_backup()` gegen die Fassung im Repository — rein lesend |
| `0131_restore_plan.md` | der Plan für den isolierten Wiederherstellungstest: Reihenfolge, Trigger, Identitäten, Lücken, Verifikation — **nichts davon ausführen** |
| `production_rollout_0126_0131.md` | die Bereitschaftsprüfung für Production: Messung zuerst, Backuplage, Reihenfolge, Abbruchkriterien, Rücknahme je Migration |
| `0132_platform_export_receipts_proposal.md` | **Vorschlag, nicht umgesetzt**: die Eigenbelege im Plattformarchiv |

## Bereichserkennung: zeilenweise, niemals mit einem mehrzeiligen Regex

**PostgreSQL bestimmt die Gierigkeit für den ganzen Zweig, nicht je Quantor.**
Handbuch 9.7.3.5: ein Zweig hat die Gierigkeit des **ersten** quantifizierten
Atoms mit Vorliebe. In

```
regexp_matches(d, '\n {6}''([a-z_0-9]+)'', coalesce\(\((.*?)\n {6}\), …', 'g')
```

ist das `[a-z_0-9]+` — gierig. `(.*?)` verhält sich damit wie `(.*)`, der erste
Bereich verschluckt den ganzen Rumpf, und heraus kommt **ein** Bereich
`shop_inventory` mit **321** Schlüsseln statt 28 Bereichen. In Python und
JavaScript funktioniert dasselbe Muster — wer dort testet, testet die falsche
Engine.

Deshalb gilt in allen Prüfdateien und Migrationen:

```
zeile  as (select z.nr, z.txt from code c,
             regexp_split_to_table(c.d, E'\n') with ordinality as z(txt, nr)),
anfang as (select z.nr, (regexp_match(z.txt,
             '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
             from zeile z where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'),
feld   as (select (select a.name from anfang a
                    where a.nr < z.nr order by a.nr desc limit 1) as name, …)
```

Jede Zeile einzeln, verankert, kein Ausdruck über Zeilengrenzen. Und **jede
Datei beweist den Parser in der Engine, die sie ausführt**: sie trägt eine Probe
mit zwei Bereichen (`alpha` mit zwei Feldern, `beta` mit einem). Ein gieriger
Parser liefert dort einen Bereich mit drei Feldern; die Prüfung blockiert.

Dazu in jeder Datei **blockierend**: genau 28 Bereiche, jede Feldzeile genau
einem Bereich zugeordnet, kein Bereich ohne Feld. Eine Parserabweichung kann
damit nie als bestandener Pre- oder Postflight durchgehen. `backup-sql-areas.test.ts`
hält die Form und die exakten Feldzahlen je Stand fest (321 / 339 / 352).

## Eine Syntaxprüfung sieht keine Spalten

`pglast` parst — es löst keine Namen auf. Ein Verweis auf eine Spalte, die ein
CTE nicht mehr liefert, kommt damit durch jede Syntaxprüfung und bricht erst in
PostgreSQL ab:

```
ERROR: 42703: column b.block does not exist
```

Genau das passierte beim Umbau von der block- auf die zeilenweise
Bereichserkennung: `bereich` lieferte nur noch `name`, zwei Prüfungen in der
Diagnose und eine im `0130`-Postflight verwiesen weiter auf `b.block`.

Geprüft wird das jetzt zweifach:

* **`src/lib/admin/check-sql-references.test.ts`** erhebt je Datei die CTEs mit
  ihren Ausgabespalten und prüft jede Referenz `alias.spalte`. Negativ
  kontrolliert: `b.block` wieder eingebaut → Test fällt.
* **Mit dem echten PostgreSQL-Parser** über den Syntaxbaum (`CommonTableExpr`
  gegen `ColumnRef`) wurden alle Prüfdateien und die eingebetteten
  CTE-Abfragen beider Migrationen durchgesehen. Befund: 0.

Ein lokales PostgreSQL gibt es auf dieser Maschine nicht (kein `psql`, kein
`initdb`, kein Container-Laufzeitsystem). Eine echte Ausführung bliebe die
stärkste Prüfung — dafür bräuchte es eine isolierte Testdatenbank mit allen
Migrationen.

## Eine Lehre, die zweimal Geld gekostet hat

**Ein Feldname im Funktionsrumpf sagt nicht, in welchem BEREICH er steht.**
`0129` hat `purchase_receipts` in den Export genommen, und ein Eigenbeleg friert
den Ankauf ein — Absender, Inserat, Kaufvereinbarung und die Kostenaufteilung
stehen dort berechtigt. Wer `position('''sender_name''' in v_code)` schreibt,
findet den Belegsnapshot und meldet ihn als Treffer im Einkaufsbereich: so
schlug `0130_preflight` auf Staging mit 5 und 4 Fehlalarmen an, und so hätte die
Nachbedingung von `0130` die Migration abgebrochen.

Deshalb schneiden alle Feldprüfungen den Bereich aus, bevor sie suchen:

```
bereich as (
  select (m.g)[1] as name, (m.g)[2] as block
    from code c,
         regexp_matches(c.d,
           $re$\n {6}'([a-z_0-9]+)', coalesce\(\((.*?)\n {6}\), '\[\]'::jsonb$re$,
           'g') as m(g)
)
```

In POSIX-Regex passt `.` auch auf einen Zeilenumbruch, solange der Flag `n`
nicht gesetzt ist; verankert wird mit `\n {6}` statt mit `^`.
`manifest-gap.test.ts` hält fest, dass keine Prüfdatei und keine Migration ein
mehrdeutiges Feld rumpfweit sucht.

## Und eine dritte Lehre: ein Prüfeintrag muss den Bereich NENNEN

Weil Feldprüfungen seit der zweiten Lehre bereichsweise arbeiten, prüfen die
Nachbedingungen von `0130` und `0131` Paare der Form `Bereich|Feldzeile`:

```
foreach v_key in array array[
  'seller|''register_court'', t.register_court', …] loop
  if not (v_key = any (v_paare)) then …
```

Beim Umbau auf diese Form bekamen in `0131` nur der **erste** und der
**letzte** der 13 Einträge das Präfix `seller|`. Die elf dazwischen waren
nackte Feldzeilen, passten auf kein Paar — und `split_part(v_key, '|', 2)`
gibt für einen Wert ohne Trenner die leere Zeichenkette zurück. Heraus kam
eine Meldung ohne Feldnamen:

```
ERROR: P0001: 0131 Abbruch:  fehlt im Bereich seller
```

Die Prüfung war nicht zu streng, sondern falsch gestellt. Sie bleibt
blockierend. Dazu kamen zwei Dinge:

* **In beiden Migrationen** steht vor der Suche eine Formprüfung. Ein Eintrag
  ohne Bereich bricht jetzt mit eigener Meldung ab, statt eine Lücke zu
  behaupten, die er nicht belegen kann.
* **`src/lib/backup/backup-sql-areas.test.ts`** verlangt für jede Schleife, die
  mit `v_key = any (v_paare)` arbeitet, dass jeder Eintrag die Form hat, dass
  sein Bereich einer der 28 ist und dass er auf ein Paar passt, **das der
  Rumpf derselben Migration wirklich hergibt**. Negativ kontrolliert: ein
  `seller|` entfernt → vier Prüfungen fallen.

Wichtig an der Abgrenzung: die **anderen** `foreach v_key`-Schleifen derselben
Dateien suchen nackte Feldnamen mit `like`-Mustern oder Verbotsmarker mit
`position(v_key in v_code)`. Deren Einträge haben zu Recht kein `|`. Ein Test,
der dort eines verlangte, würde das Falsche prüfen — er zählt sie getrennt.

## Prüfsummen

Eine Liste für beide Ordner: **`supabase/SHA256SUMS.txt`** deckt jede
Migration **und** jede Prüfdatei ab. Die Pfade sind repository-relativ,
geprüft wird also vom Repository-Wurzelverzeichnis:

```
npm run verify:sums          # vollständig: fehlend, überzählig, abweichend
shasum -a 256 -c supabase/SHA256SUMS.txt    # dasselbe ohne Node
```

Nach einer **absichtlichen** Änderung: `npm run sums:write` — der Diff zeigt
dann, was sich geändert hat. `src/lib/admin/migration-integrity.test.ts`
rechnet die Liste bei jedem Testlauf nach, ein vergessenes `sums:write` fällt
also auf, statt zu verrotten.

Vor jeder Ausführung auf Staging oder Production gegenprüfen — ein Chatblock
oder eine Kopie aus einer Antwort ist nicht maßgeblich, die Datei ist es.

Welche Fassung einer Migration **tatsächlich gelaufen** ist, steht nicht hier,
sondern in `supabase/migrations/APPLIED.md`. Die Prüfsummenliste sagt „diese
Datei hat sich geändert"; `APPLIED.md` sagt „das ist die Fassung, die auf
Staging ausgeführt wurde".

## Reihenfolge

`0125` vor `0124`. `0125_preflight` → `0125` → `0125_postflight` →
`0124_preflight` → `0124_baseline` (Ränge 1–3) → `0124` →
`0124_baseline` (Ränge 1–3) → `0124_postflight` → Browser.

Bricht `0124` ab, kommt `0124_rollback_check` dazwischen: er sagt, ob die
Vorher-Baselines weiter gelten.

`0126` steht hinter beiden und hängt an keiner von ihnen: `0126_preflight` →
`0126` → `0126_postflight` → die vier Schreibfälle von Hand (siehe
`0126_preflight.sql`, Kopf).

`0127` setzt `0126` voraus — sie ersetzt deren Funktion durch eine mit einem
sechsten Parameter: `0127_preflight` → `0127` → `0127_postflight` → die
Schreibfälle von Hand. Der Preflight blockiert nicht, wenn `0127` schon
angewendet ist; Prüfung 210 sagt dann `NACH_0127` statt `VOR_0127`.

Der erste Anwendungsversuch von `0127` brach in der Nachbedingung ab
(`die Argumenttypen sind nicht die erwarteten`), weil die Prüfung den ganzen
`proargtypes`-Vektor mit einem `array[...]`-Literal verglich — nullbasiert
gegen einsbasiert. `0127_signature_diagnosis.sql` stellt das nach und sagt
zugleich, ob der Abbruch vollständig zurückgerollt wurde. Der Wächter gegen
diese Form steht in `src/lib/business/fingerprint-rights.test.ts` und gilt für
**alle** Migrationen und Prüfdateien; diese Diagnose ist die einzige
namentliche Ausnahme, weil sie den Fehlgriff absichtlich zeigt.

`0130` setzt `0129` voraus, `0131` setzt `0130` voraus — beide ersetzen
denselben Funktionsrumpf und müssen deshalb in dieser Reihenfolge laufen:
`0130_preflight` → `0130` → `0130_postflight` → `0131_preflight` → `0131` →
`0131_postflight` → Sicherung herunterladen → `npm run verify:backup`.

`0128` setzt `0122`/`0123` voraus und `0129` setzt `0128` voraus:
`0128_preflight` → `0128` → `0128_postflight` → die Schreibfälle aus
`0128_test_plan.md` → `0129_preflight` → `0129` → `0129_postflight` → der
Wiederherstellungstest aus `0129_restore_test.md`.

Der Export selbst wird nach `0129` mit `0129_export_baseline.sql` geprüft: sie
liefert die Zahlen, die in der heruntergeladenen JSON-Datei stehen müssen. Den
Vergleich macht dann ein Befehl:

```
npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
```

Er liest nur Dateien — keine Datenbank, kein Netz, kein Schlüssel —,
vergleicht alle 28 Bereichszähler, die vollständige Belegkette und seit dem
Feldabgleich **jedes Feld jedes Bereichs** gegen zwei Quellen: `manifest.ts`
und den Rumpf der letzten Migration. Drei getrennte Kategorien (fehlend,
unerwartet, ausdrücklich ausgeschlossen), leere Bereiche als `leer` statt `ok`
ausgewiesen. Er gibt **keine personenbezogenen Daten** aus. Liegt die Datei im Projektordner, bricht
er ab, statt sie zu lesen (`docs/SECURITY.md`).
**Sie ruft `seller_business_backup()` nicht auf** — die Funktion liefert
Käuferanschriften, und eine Prüfdatei schreibt keine personenbezogenen Daten in
ein Protokoll. Verglichen werden Zeilenzahlen, die Belegkette und Prüfsummen.

**Die Wiederherstellbarkeit ist beschrieben, nicht geprüft.** Es gibt keine
Importfunktion (`restore_supported` ist `false`), die Belegtabellen sind für
die Anwendung gesperrt, und ein ehrlicher Test braucht eine leere Datenbank.
`0129_restore_test.md` sagt Schritt für Schritt, was auf einer isolierten
Testdatenbank zu tun ist — einschließlich der vier Identity-Sequenzen, die
die Datei selbst nicht beschreibt. Das Ergebnisprotokoll am Ende der Datei ist
leer, solange niemand sie durchlaufen hat.

**Der Aufruf mit fünf benannten Argumenten ist der Fall, den keine lesende
Datei prüfen kann.** `0127` löscht die fünfparametrige Fassung und legt eine
sechsparametrige an; dass PostgREST einen Aufruf ohne `p_swap` weiterhin
auflöst, zeigt erst ein Speichern aus einem Client, der `p_swap` nicht
schickt. Der Postflight prüft nur die Voraussetzungen dafür: Namen, Typen,
fünf Defaults und genau eine Fassung.
