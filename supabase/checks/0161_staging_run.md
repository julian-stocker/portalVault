# 0161 auf Staging — der Laufzettel

**Die Familie entsteht von selbst.** CAT-08, Stufe 1. **Stand 2026-10-29: auf
Staging angewendet und vollständig geprüft** (Abschnitt „Der Lauf" unten); auf
Production nicht.

## Worum es geht

Beim Veröffentlichen einer Variante wählt der Bediener **nur die
Basisfigur**. Die Checkbox „Neue Familie anlegen und beiden zuordnen"
entfällt — sie war eine Frage, die er nicht beantworten kann, weil sie keine
eigene Entscheidung ist, sondern eine Folge daraus, dass er eine Basisfigur
gewählt hat.

`admin_publish_variant_auto(text, text)` regelt vier Fälle:

| Lage | Was geschieht |
|---|---|
| Basisfigur hat eine Familie | sie wird **übernommen** |
| nur die Variante hat eine | ihre bleibt, die Basisfigur **unberührt** |
| keine von beiden | die Familie mit dem **Namen der Basisfigur** wird gesucht, **bestätigt** und benutzt — oder angelegt |
| beide haben **verschiedene** | **Abbruch**, nichts wird überschrieben |

## Die Frage, an der diese Migration hängt

**Reicht Namensgleichheit als Identitätsbeweis?** Sie ist nötig: „Chop Chop"
steht **zweimal** im Katalog — SKY-0015 in `SA` und SKY-0149 in `G` Series 2
—, beide sind Basisfigur eines Entwurfs, und beide sind **derselbe
Charakter**. Ohne Wiederverwendung bräche der zweite Lauf an
`admin_create_character` ab („die Familie gibt es schon"), und der Bediener
stünde vor einem Fehler, den er nicht verursacht hat. Dasselbe bei „Stump
Smash" und „Wrecking Ball".

**Aber der Name allein beweist nichts.** ADR-0034 führt die Gegenbeispiele:
„Kaos" ist ein Trap, eine Trophy **und** ein Sensei; `Mini Drobit` ist
Drobots Mini und ein **eigener** Charakter.

**Deshalb wird die Identität bestätigt, nicht angenommen.** Bevor eine
gefundene Familie benutzt wird, prüft die Funktion **jedes ihrer
Mitglieder**: trägt eines einen Namen, der mit dem der Basisfigur nicht
vereinbar ist, bricht sie ab und **nennt es**. Vereinbar heißt an einer
**Wortgrenze**:

```
gleich                  "Chop Chop"        =  "Chop Chop"
Mitglied endet darauf   "Gold Chop Chop"  ->  " Chop Chop"
Basis endet darauf      "Chop Chop"       <-  " Chop"
```

Verglichen wird mit `right()` und **nicht** mit `like`: ein Name darf `%`
oder `_` enthalten, und ein Muster, das an einem Namen zerbricht, wäre ein
stiller Fehler.

> **Das ist ein VETO, keine Suche.** Gefunden wird eine Familie
> ausschließlich über **Gleichheit** des Namens; die Wortgrenzenregel darf
> nur **widersprechen**. Damit bleibt **ADR-0034 unberührt**: keine Zuordnung
> entsteht aus einer Namensähnlichkeit. Die serienübergreifende Suche
> (CAT-08 Stufe 2) ist **nicht** Teil dieser Migration.

**Gemessen am echten Bestand** (`cat08_name_equality.sql`, 2026-10-28): 470
Charakterzeilen, 24 mehrfach vorkommende Namen, und **kein einziger** trägt
zwei verschiedene `character_id`. Wächter **A5** der Hülle bricht ab, falls
sich das je ändert.

## Nebenläufigkeit

Zwei Bediener veröffentlichen gleichzeitig zwei Varianten **derselben**
Basisfigur. Beide sehen „keine Familie", beide legen an, einer läuft in
`23505` am Eindeutigkeitsindex. Zwei Riegel:

* **`pg_advisory_xact_lock`** auf dem kleingeschriebenen Familiennamen. Der
  zweite Aufruf wartet, sieht danach die Familie und **benutzt** sie. Der
  Schlüssel ist der Name, nicht die Zeile — zwei verschiedene Familien
  behindern sich nicht.
* **Beide Katalogzeilen werden in EINER Anweisung in `sky_id`-Ordnung
  gesperrt.** `0159` sperrt Variante-dann-Basis; bei zwei Aufrufen, deren
  Variante die Basis des anderen ist, wäre das ein Deadlock. Eine feste
  Ordnung kann keinen bauen.

## Was sich nicht ändert

* **Keine der Funktionen aus `0158`/`0159`.** Sie werden **aufgerufen**:
  `admin_set_character` schreibt die Familie, `admin_set_variant_base` die
  Basisfigur, `admin_set_catalog_status` veröffentlicht. Es gibt weiterhin
  **einen** Schreibweg je Spalte. Wächter A3 prüft die **Abdrücke** der drei
  vor dem Lauf, die Nachkontrolle die aller fünf danach.
* **Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine Richtlinie,
  kein Index, keine Constraint.**
* **Keine Massenzuordnung.** Die Funktion schreibt die Familie von **genau
  zwei** Zeilen, und nur dort, wo sie `NULL` war.
* Kein Name, kein Slug, keine SKY-ID, kein Preis, kein Bild, keine Serie,
  keine Kategorie — und damit kein Angebot, kein Lager, keine Sammlung, keine
  Bestellung.
* **Die manuelle Familienverwaltung bleibt.** `family-select.tsx` auf der
  Detailseite ist der Korrekturweg und gehört nicht in den Importdialog.

## Die Schritte

1. **Preflight** (rein lesend):
   ```
   npm run db:migrate:staging -- 0161
   ```
   Erwartet `9999 = 0`. Zeilen 111–116 belegen, dass die sechs vorhandenen
   Funktionen die Fassungen aus `0152`/`0158`/`0159` sind; Zeile 134 belegt,
   dass kein Name zwei Familien trägt; 138 und 139 sind die Abdrücke der
   Varianten- und der Familienzuordnung, die die Nachkontrolle wieder nennt.

2. **Die eine schreibende Anweisung** — vom Bediener, im SQL-Editor von
   `qqxcpesbwfxzgytkdsac`:
   ```
   supabase/operations/staging-0161.sql
   ```
   Vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**

3. **Nachkontrolle**:
   ```
   npm run db:migrate:staging -- 0161 --resume
   ```
   Erwartet `9998 = 0` und `9999 = 0`.

## Die Wächter der Hülle

| | Was er abfängt |
|---|---|
| **A1** | falsche Umgebung |
| **A2** | eine der vier Funktionen, die `0161` aufruft, fehlt |
| **A3** | eine davon ist **nicht die Fassung** aus `0158`/`0159` — `0161` verlässt sich auf ihr Verhalten, nicht nur auf ihre Existenz |
| **A4** | der eindeutige Index auf `lower(characters.canonical_name)` fehlt |
| **A5** | im Katalog trägt ein Name **zwei** verschiedene Familien — dann wäre Namensgleichheit kein Beweis |
| **A6** | NOTICE, kein Riegel: Entwürfe, Familien, Varianten vor dem Lauf |

## Stoppbedingungen

* `ABBRUCH A1`–`A5` — die Lage ist zu klären, nicht zu überschreiben
* Preflight Zeile 121 ≠ `true` — die Funktion steht schon
* Nachkontrolle Zeile 107, 108 oder 109 ≠ `true` — **der Advisory-Lock, die
  Sperrordnung oder die Vetoprüfung fehlt im Rumpf**; das sind die drei
  Zusagen dieser Migration
* Nachkontrolle 111–116 ≠ den Zahlen des Preflights — eine fremde Fassung
  steht da, oder `0161` hat etwas ersetzt
* Nachkontrolle 138 oder 139 ≠ Preflight — eine Zuordnung hat sich bewegt,
  obwohl diese Migration keine anfasst
* eine veränderte Angebots-, Lager-, Katalog- oder Sammlungszahl (811–817,
  831–833 gegen die eingefrorene Baseline)

## Was gemessen ist, bevor jemand etwas ausführt

Probelauf **P70** (`npm run verify:check-sql`) fährt gegen echtes PostgreSQL:

* **Chop Chop, Stump Smash und Wrecking Ball**, je zweimal im Katalog, je
  zwei Entwürfe: der zweite **benutzt** die Familie des ersten. Vier
  Mitglieder, **eine** Familie, und die Basisfiguren bleiben Basisfiguren.
* **Das Veto:** eine Familie „Zook", die „Cynder" enthält, wird **nicht**
  benutzt — Abbruch mit Nennung des Mitglieds, und **nichts** geschrieben.
  Nach der Umbenennung in „Gold Zook" geht derselbe Lauf durch.
* die **Übernahme** ohne neue Familie, der **Widerspruchsabbruch** (die
  Variante behält ihre Familie und bleibt Entwurf)
* vier Abweisungen mit eigener Meldung: fremde Serie, Kette, kein Entwurf,
  Selbstbezug — und `42501` ohne Adminrecht
* **keine Massenzuordnung:** genau zwei Zeilen bekommen die Familie, eine
  gleichnamige dritte Figur bleibt unberührt
* das **Journal**: `character_id` zweimal, `base_sky_id` einmal
* der **verlorene Wettlauf**: steht die Familie schon da, wird sie benutzt —
  keine zweite, kein `23505`
* `admin_publish_with_base` aus `0159` läuft **unverändert** weiter
* **ohne den Eindeutigkeitsindex** bricht `0161` ab, und ein zweiter Lauf
  prallt ab
* **R0161** entfernt genau eine Funktion, lässt die aus `0158`/`0159` stehen
  und fasst **keine** Zuordnung an

## Der Lauf vom 2026-10-29

| Schritt | Ergebnis |
|---|---|
| **Preflight** (`db:migrate:staging -- 0161`) | **43 Zeilen, `9999 = 0`, keine offene Zeile** |
| **Baseline** | `supabase/baselines/baseline-0161.json`, erhoben 07:36:41, Herkunft `preflight` — danach **nie neu erhoben** |
| **Die eine schreibende Anweisung** | Betreiber, im SQL-Editor von `qqxcpesbwfxzgytkdsac`, über `supabase/operations/staging-0161.sql` |
| **Nachkontrolle** (`--resume`) | **59 Zeilen, `9999 = 0` UND `9998 = 0`** — keine offene Zeile, der lesende Prüfzugang konnte jede prüfen |

**Die Baseline weicht von der von `0160` ab, und das ist richtig:** Angebote
257 und Lagerzeilen 287 unverändert, aber shopfähig und sammelbar 535 → **552**
und Katalogzeilen 729 → **725**. Der Betreiber hat zwischen beiden Migrationen
redaktionell gearbeitet — Entwürfe veröffentlicht und verworfen. Pre- und
Postflight **dieser** Migration stimmen überein; sie selbst hat nichts
verändert.

**Zusätzlich am Rumpfabdruck nachgewiesen**, und das ist mehr, als die
Nachkontrolle leistet: die hält **Muster** im Rumpf fest (Advisory-Lock,
Sperrordnung, Veto), dieser Nachweis den **ganzen** Rumpf.
`supabase/checks/cat08_applied_fingerprint.sql`, rein lesend, 20 Zeilen,
`9999 = 0`:

| | |
|---|---|
| `md5(prosrc)` auf Staging | `adf679deb5d42fad5dff15bd1641f318` |
| Länge | **6553** Zeichen |
| Parameternamen | `p_sky_id text, p_base_sky_id text` |

Das ist Zeichen für Zeichen der Rumpf zwischen `as $$` und `$$;` in
`supabase/migrations/0161_variant_family_auto.sql`. Die Parameternamen sind
Teil des Vertrags und keine Beschriftung: PostgREST ruft **benannt**, und
`src/lib/admin/actions.ts` schickt `{ p_sky_id, p_base_sky_id }` — ein anderer
Name wäre `PGRST202`, und zwar erst im Betrieb.

**Die sechs, die unverändert bleiben mussten, sind es** — an ihren Abdrücken
gemessen und nicht an ihrer Existenz: `admin_set_variant_base` `b47289cb…`,
`admin_publish_with_base` `3df170df…`, `admin_create_character` `5f8137b4…`,
`admin_set_character` `4b02bf10…`, `admin_publish_as_variant` `99339dc5…`,
`admin_set_catalog_status` `e3c76fa5…`. Und der Exportrumpf aus `0160`
(`ff4f38e6…`) ebenfalls.

**Bestand bei der Anwendung** (`cat08_inventory_note.sql`): 81 Entwürfe, 614
öffentliche und 30 versteckte Zeilen, 725 Katalogzeilen, 109 Zeilen mit
Familie in 20 Familien, **17 Varianten mit Basisfigur** über 16 Basisfiguren.
Und weiterhin: **0** Namen mit zwei verschiedenen Familien, **0** Ketten,
**0** Zuordnungen über Seriengrenzen.

Protokolle: `supabase/log/staging/migrate-0161-2026-10-29T07-36-41-445Z.md`
(Preflight) und `…T07-37-20-954Z.md` (Nachkontrolle).

**Protokolliert in `supabase/migrations/APPLIED.md`**, Spalte `Datei heute` =
`gleich`: die Datei im Repository ist bitgenau die ausgeführte Fassung, SHA-256
`177d9ece20c64b26ad6fb51106ad2b3e6ee6e9fdc5818e7e1af4009f28446e86`, und
`src/lib/admin/migration-integrity.test.ts` rechnet das bei jedem Testlauf
nach.

## Was danach offen bleibt

**CAT-08 Stufe 2** — die serienübergreifende Suche nach einer passenden
Familie. Gemessen hätte sie heute an **34 von 34** Fällen nichts gefunden;
sie wird erst nützlich, wenn mehr Familien stehen, und sie bräuchte einen
ADR, der ADR-0034 **einschränkt statt umwirft**.

**Die 17 Entwürfe ohne Basisfigur derselben Serie** bleiben Weg A oder C, und
die **299 veröffentlichten Charakterzeilen ohne Familie** bleiben Handarbeit
auf der Detailseite. Keine Massenzuordnung.
