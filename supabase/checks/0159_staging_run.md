# 0159 auf Staging — der Laufzettel

Die Variante kennt ihre Basisfigur (CAT-07, ADR folgt). Freigegeben am
2026-10-28.

## Worum es geht

Drei Ebenen, drei Spalten, keine Vermischung:

| Ebene | Träger | Reichweite |
|---|---|---|
| Figurenfamilie | `character_id → characters.id` | **serienübergreifend** (`0002`) |
| **Basisfigur** | **`base_sky_id → skylanders.sky_id`** | **innerhalb einer Serie** (neu) |
| Katalogeintrag | `sky_id` | die Sache selbst |

Warum beides nötig ist, zeigt Eon's Elite: `Elite Boomer` und `Boomer` stehen
in **verschiedenen** Serien. Derselbe Charakter, keine Variante voneinander.
Eine Ebene allein könnte das nicht unterscheiden — gemessen: 4 solche Fälle.

## Die Riegel, und welcher was tut

| Regel | Wer sie erzwingt | Fehlercode |
|---|---|---|
| dieselbe Serie | **zusammengesetzter Fremdschlüssel** `(base_sky_id, series_code)` | `23503` |
| Serienänderung an einer Basisfigur mit Varianten | `ON UPDATE RESTRICT` | **`23001`** |
| Löschen einer Basisfigur mit Varianten | `ON DELETE RESTRICT` | `23001` |
| kein Selbstbezug | `CHECK` | `23514` |
| keine Variante einer Variante | Trigger, **beide Richtungen** | `23514` |
| höchstens eine Basisfigur | eine Spalte | — |

`23001` statt `23503` ist nicht Zufall, sondern der Beweis: PostgreSQL meldet
`restrict_violation` nur bei einem ausdrücklichen `RESTRICT`. Ein `CASCADE`
hätte die Serie der Varianten stillschweigend mitgezogen — das war die
Entscheidung des Betreibers gegen `CASCADE`.

**Alle greifen auch außerhalb der Oberfläche.** P67 fährt einen rohen
`UPDATE`, der die RPC umgeht, und er fällt am Trigger.

## Ein Regressionsfund, der ohne den Probelauf wehgetan hätte

`admin_merge_references` aus `0154` nimmt blind die **erste** Spalte eines
Fremdschlüssels und weist einen mehrspaltigen **ausdrücklich ab**:

```
0154: % hat einen mehrspaltigen Fremdschluessel auf skylanders
      — diese Funktion kann ihn nicht zaehlen
```

`0159` legt genau so einen an. Ohne Korrektur wäre danach **jede**
Zusammenführung und **jedes** Verwerfen abgebrochen — zwei Funktionen, die
angewendet und in Gebrauch sind. Abschnitt 4b ersetzt den Rumpf: er sucht die
Spalte, die **wirklich** auf `sky_id` zeigt, über die Stelle von `sky_id` in
`confkey`. Das ist bei einem einspaltigen Schlüssel dieselbe Antwort wie
vorher und bei einem mehrspaltigen die richtige.

**Der laute Fehlschlag bleibt:** zeigt ein Schlüssel auf `skylanders`, aber
nicht auf `sky_id`, bricht sie weiter ab — zu wenig zu melden hieße, die
Löschung läuft los und scheitert mitten im Vorgang.

`0154` selbst wird **nicht** angefasst. Ersetzt wird der Funktionsrumpf, wie
`0156` es mit dem aus `0154` tat und `0157` mit dem aus `0156`.

## Die Schritte

1. **Preflight** (rein lesend):
   ```
   npm run db:migrate:staging -- 0159
   ```
   Erwartet `9999 = 0`. Zeile 122 belegt den Anlass: `admin_merge_references`
   weist einen mehrspaltigen Schlüssel heute ab. Zeile 125 belegt, dass es
   heute **keinen** mehrspaltigen gibt.

2. **Die eine schreibende Anweisung** — vom Bediener, im SQL-Editor von
   `qqxcpesbwfxzgytkdsac`:
   ```
   supabase/operations/staging-0159.sql
   ```
   Vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**

3. **Nachkontrolle**:
   ```
   npm run db:migrate:staging -- 0159 --resume
   ```
   Erwartet `9998 = 0` und `9999 = 0`.

## Die Wächter der Hülle

| | Was er abfängt |
|---|---|
| **A1** | falsche Umgebung |
| **A2** | `admin_set_catalog_status` fehlt (`0152`) |
| **A3** | `0158` ist nicht angewendet |
| **A4** | die Journal-Constraint ist nicht die aus `0158` |
| **A5** | `admin_merge_references` ist nicht die Fassung aus `0154` — NOTICE, damit auffällt, dass ein fremder Rumpf ersetzt wird |
| **A6** | `base_sky_id` steht schon — NOTICE, die Spalte bleibt unberührt |

## Stoppbedingungen

* `9999 ≠ 0` oder `9998 ≠ 0`
* `ABBRUCH A3`/`A4` — `0158` fehlt oder eine fremde Constraint
* Zeile 103 der Nachkontrolle ≠ `true` — der Serienriegel nennt nicht beide
  Spalten oder nicht `RESTRICT`. **Das ist die Zusage dieser Migration**
* Zeile 105 ≠ 1 — die Eindeutigkeit fehlt, dann trägt der Serienriegel nicht
* Zeile 112 ≠ `true` — die Referenzzählung weist mehrspaltig noch ab, dann
  bricht jede Zusammenführung
* Zeile 134 ≠ 0 — es wäre etwas zugeordnet worden; diese Migration ordnet
  nichts zu
* eine veränderte Katalog-, Familien- oder Entwurfszahl (136–138 gegen
  131–133 des Preflights)

## Der Lauf vom 2026-10-28 — und ein Maskierungsfehler in Zeile 123

Die Migration ist am 2026-10-28 im SQL-Editor von Staging gelaufen. Die
lesende Nachkontrolle meldete danach `9999 = 1`:

| Nr | Prüfung | Befund | erwartet |
|---|---|---|---|
| 123 | beide sind `security definer` mit genau einer `search_path`-Festlegung | `0` | `2` |

**Die Ursache lag in der Prüfdatei, nicht in der Migration.** Zeile 123 suchte
in `pg_proc.proconfig` nach `c like 'search\\_path=%'` — mit **zwei**
Backslashes. SQL `LIKE` deutet das als *einen echten Backslash* im
Suchmuster; gesucht wurde also nach Einträgen, die wörtlich mit
`search\_path=` beginnen. Die gibt es nicht, `count(*)` war 0, und die Zeile
meldete 0 statt 2.

Dass es ein Tippfehler war und kein Missverständnis, zeigt dieselbe Datei:
im Vorspann `fn` steht dasselbe Muster dreimal **richtig**, mit einem
Backslash. Projektweit war dieses eine Vorkommen das einzige mit zwei; alle
anderen rund 90 in über 40 Prüfdateien tragen einen.

**Was gemessen wurde, bevor etwas geändert wurde** — rein lesend, mit
`supabase/checks/cat07_function_attributes.sql`:

| Funktion | `prosecdef` | `proconfig` | Wert | offenes EXECUTE |
|---|---|---|---|---|
| `admin_set_variant_base(text,text,boolean)` | `true` | genau 1 × `search_path=""` | `""` (leer) | 0 |
| `admin_publish_with_base(text,text,boolean)` | `true` | genau 1 × `search_path=""` | `""` (leer) | 0 |
| `admin_merge_references(text)` nach dem Rumpftausch | `true` | genau 1 × `search_path=""` | `""` | 0 |

Beide neuen Funktionen sind also richtig konfiguriert, und der Rumpftausch an
`admin_merge_references` hat weder Attribute noch Rechte verändert. Die
Zeilen 124 und 125 der Nachkontrolle haben das unabhängig bestätigt und waren
von Anfang an grün.

**Der Triggerfunktion fehlt kein Widerruf.** `skylanders_variant_base_guard()`
trägt `=X/postgres` (PUBLIC) und `anon=X/postgres`, weil `0159` dort kein
`revoke` ausspricht — anders als bei den zwei Admin-RPCs. Gemessen mit
`supabase/checks/cat07_trigger_acl.sql`: von 45 Triggerfunktionen im Schema
`public` tragen **32** dasselbe offene Recht, und **jede** andere
Triggerfunktion an `public.skylanders` trägt es Zeichen für Zeichen gleich
(`log_skylander_editorial_change`, `prevent_sky_id_change`,
`skylanders_sync_catalog_status`, `skylanders_set_item_type`). Rückgabetyp
`trigger`, 0 Argumente: PostgreSQL weist einen Aufruf als Ausdruck ab, und
PostgREST stellt solche Funktionen nicht bereit. `0159` folgt damit der
Hausnorm; eine Reparatur, die eine einzelne Funktion anders behandelt als
ihre vier Nachbarn an derselben Tabelle, macht das Bild unordentlicher statt
sicherer. Wer die 32 widerrufen will, tut das als eigene Aufgabe für alle.

**Korrigiert wurde genau ein Zeichen** in `supabase/checks/0159_postflight.sql`
Zeile 256 — kein Prüfinhalt, keine Erwartung, keine Migrationsdatei. Die
Bedingung steht wörtlich wie vorher und wird dadurch erst scharf.

**Zwei Wächter halten die Fehlerklasse ab jetzt fest:**

* `src/lib/admin/check-body-patterns.test.ts`, Abschnitt *Maskierung in
  Suchmustern*: liest alle 357 `LIKE`-Muster und 46 Ausdrücke aller
  Prüfdateien, verbietet den doppelten Backslash und verlangt für jedes
  `search_path`-Muster genau einen. Gegengeprobt: mit der alten Fassung der
  Datei fallen drei Zusagen.
* `P68` in `tools/validate-check-sql.mts`: hält die Semantik gegen echte
  `proconfig`-Einträge in PostgreSQL und fährt **den Ausdruck aus der
  Prüfdatei selbst** — an zwei richtig konfigurierten Funktionen zählt er
  zwei, nimmt man einer den Suchpfad, nur noch eine.

**Der zweite Lauf, rein lesend:** `9999 = 0`, 57 Zeilen, Baselines
unverändert aus `supabase/baselines/baseline-0159.json` übernommen.
Protokoll: `supabase/log/staging/migrate-0159-2026-10-28T18-17-52-359Z.md`.

**Offen bleibt Zeile 135** („keine Journalzeile `base_sky_id`"): sie liest
`catalog_admin_changes`, worauf der lesende Prüfzugang kein `select` hat. Sie
ist **weder bestanden noch abgewichen** und gilt erst als geprüft, wenn
`supabase/log/staging/0159-postflight-berechtigt.sql` als `postgres` im
SQL-Editor gelaufen ist — erwartet `9998 = 0` **und** `9999 = 0`. Bis dahin
wird `0159` in `APPLIED.md` nicht als abgeschlossen geführt.

## Was danach offen bleibt

* **Plattformsicherung** (`platform-manifest.ts`): **diese Folgemigration ist
  am 2026-10-28 gelaufen — `0160`, auf Staging angewendet** (Laufzettel
  `supabase/checks/0160_staging_run.md`, Reihenfolgefragen in
  `0160_restore_order.md`; auf Production nicht). Das Manifest führt
  `base_sky_id` seitdem als FELD und nicht mehr als Ausschluss, und das
  Archiv trägt die Beziehung. Begründung
  unverändert: ginge die Spalte bei einer Wiederherstellung verloren, stünde
  jede Variante wieder allein im Katalog.
* **Betriebssicherung** (`manifest.ts`): bleibt draußen, und zwar dauerhaft —
  eine Variantenbeziehung ist redaktionelle Gruppierung der Plattform, kein
  Händlerdatum. Dieselbe Begründung wie bei `catalog_visible` und
  `catalog_status`.

**Die 70 zuordenbaren Paare** aus `cat07_base_figure_survey.sql` bleiben
unzugeordnet. Jede Zuordnung ist eine einzelne Entscheidung; es gibt keine
Massenverknüpfung.
