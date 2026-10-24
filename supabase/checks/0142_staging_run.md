# `0142` auf Staging — die Schritte, und was danach von Hand zu prüfen ist

**Stand 2026-10-22.** Vorbereitet, lokal geprüft, **nicht angewendet**.

---

## Warum nicht ich

Dieses Repository hat **keinen schreibenden Zugang zur Staging-Datenbank.**
`tools/lib/staging-db.mts` sagt es im Kopf: *„PHASE A: AUSSCHLIESSLICH
LESEND. Dieses Modul kennt keinen schreibenden Modus, keine DDL, keinen
Production-Pfad."* Der Riegel sitzt an der **Rolle**
(`default_transaction_read_only` auf `skyisles_agent`), nicht in einem
Schalter — ein Schreibversuch endet mit `25006`, unabhängig vom Werkzeug.
In dieser Arbeitsumgebung ist die Verbindung ohnehin nicht konfiguriert
(`SKYISLES_STAGING_DB_URL` ist ein Platzhalter).

Über die Supabase-API geht DDL grundsätzlich nicht: PostgREST führt kein
`create table` aus, und eine `exec_sql`-Funktion gibt es aus guten Gründen
nicht.

**Das ist kein Hindernis, sondern die Entscheidung dieses Projekts.** Sie
abzuschwächen wäre genau das, was hier nie passieren soll. Deshalb: die
beiden schreibenden Schritte fährst du, die Prüfungen danach fahre ich.

---

## Schritt 1 — die Migration · **schreibt** (du)

```
supabase/operations/staging-0142.sql
```

Vollständig markieren, in den SQL-Editor des **Staging**-Projekts
`qqxcpesbwfxzgytkdsac`, ausführen. Eine Datei, eine Transaktion, ein
Einfügen. Sie bricht mit `ABBRUCH A1` ab, wenn das Staging-Markerpaar
(`SKY-0821` + `SKY-0822`) fehlt — also im falschen Fenster.

**Erwartet:** `Success`. Die `NOTICE`-Zeile zeigt der Editor nicht an; dass
die Datei mit `commit` durchlief, heißt aber, dass ihre Nachbedingungen
gehalten haben — eine Abweichung hätte alles zurückgerollt.

## Schritt 2 — die Nachkontrolle · **rein lesend** (du, eine Minute)

```
supabase/operations/staging-s-postflight-0142.sql
```

**Erwartet: Zeile `9999` zeigt `0`.** Die Zeilen, auf die es ankommt:

| Zeile | | Sollwert |
|---|---|---|
| 102 | zwölf Spalten in dieser Folge | `id,user_id,name,status,lines,factor_percent,total_cents,positions,units,purchase_id,created_at,updated_at` |
| 104 | die Tabelle ist **leer** | `0` |
| 111 | fünf CHECK-Bedingungen | `5` |
| 201–206 | RLS an · vier Richtlinien · je eine pro Befehl · **keine für `anon`** · `update` prüft beide Hälften · alle vier an `auth.uid() = user_id` | |
| 301 | `anon` hat **kein** Tabellenrecht | `0` |
| 302 | `authenticated` hat genau vier — **kein `truncate`** | `DELETE,INSERT,SELECT,UPDATE` |
| 402 | der **partielle** Unique-Index auf `purchase_id` | `1` |
| 403 | der `updated_at`-Trigger | `1` |
| 501–503 | keine zweite Tabelle für den Arbeitsstand · `collection_items` unberührt · Belegsperre unverändert | |

## Schritt 3 — die Richtlinien mit zwei Konten · **schreibt wenig** (ich)

```
npm run verify:calculations:staging
```

Legt zwei echte Auth-Konten an, meldet beide an und prüft mit **echten
Benutzer-JWT** — nie mit der Dienstrolle, die RLS umgeht und nichts beweisen
würde: A legt an, A sieht seine, **B sieht sie nicht** (auch nicht gezielt
über die ID), B kann sie nicht ändern und nicht löschen, B kann **keine
Zeile für A** anlegen, ein Gast sieht gar nichts, `lines` ohne Array / leerer
Name / unbekannter Status / Faktor 140 werden abgewiesen, zwei Kalkulationen
stehen unabhängig nebeneinander, und **ein Einkauf kann nicht zweimal
beansprucht werden**. Räumt beide Konten und alle Zeilen wieder weg.

Solange `0142` nicht angewendet ist, bricht das Werkzeug mit einem Hinweis
ab und schreibt nichts.

---

## Schritt 4 — was nur im Browser geht (du, etwa zehn Minuten)

`npm run dev:staging`, mit dem **Geschäftskonto** anmelden, Kalkulator über
das Symbol im Kopf öffnen.

### 4a · Arbeitsstand nach Neuladen

| ☐ | |
|---|---|
| ☐ | Drei bis vier Figuren aufnehmen, bei einer die Menge auf 3 stellen, bei einer den Einzelwert von Hand setzen, Faktor auf 65 % |
| ☐ | **Seite neu laden** (F5), Kalkulator öffnen |
| ☐ | Dieselben Positionen, **dieselbe Reihenfolge**, dieselben Mengen, der eigene Wert noch als „eigener Wert" markiert, Faktor 65 % |
| ☐ | Im Kopf steht „Wird automatisch gemerkt. Gespeichert wird erst auf Knopfdruck" |
| ☐ | **Die Liste „Gespeichert" ist leer** — der Arbeitsstand hat nichts angelegt |

### 4b · Trennung Entwurf ↔ gespeichert

| ☐ | |
|---|---|
| ☐ | „Speichern" → Name steht als Vorschlag da → speichern |
| ☐ | Im Kopf steht jetzt „Geöffnet: ‹Name›", die Marke „ungespeicherte Änderungen" ist **fort** |
| ☐ | „Zurücksetzen" → Rückfrage erscheint **nicht** (es gibt nichts zu verlieren), Liste bleibt → **die gespeicherte Kalkulation ist noch da** |
| ☐ | Eine Figur aufnehmen, „Zurücksetzen" → **jetzt** kommt die Rückfrage |

### 4c · Wechsel mit ungespeicherten Änderungen

| ☐ | |
|---|---|
| ☐ | Zweite Kalkulation anlegen und speichern (anderer Name, andere Figuren) |
| ☐ | Erste öffnen, eine Figur hinzufügen → Marke „ungespeicherte Änderungen" |
| ☐ | „Gespeichert" → die **zweite** öffnen → Rückfrage „… verwerfen?" mit drei Wegen |
| ☐ | „Vorher speichern" wählen → Namensfeld mit **zwei** Knöpfen: „Bestehende aktualisieren" und „Als neue Kalkulation speichern" |
| ☐ | „Als neue" → es gibt jetzt **drei** Einträge, die erste ist **unverändert** |
| ☐ | Nochmal wechseln, diesmal „Verwerfen" → die zweite ist geladen, die Änderung ist fort, und **nichts wurde überschrieben** |

### 4d · Zuordnung nach Neuladen (Punkt 7 des Auftrags)

| ☐ | |
|---|---|
| ☐ | Eine gespeicherte Kalkulation öffnen, **nichts ändern**, Seite neu laden |
| ☐ | Im Kopf steht weiter „Geöffnet: ‹derselbe Name›", **keine** Marke „ungespeicherte Änderungen" |
| ☐ | „Speichern" bietet **„Bestehende aktualisieren"** an — die Zuordnung hat das Neuladen überlebt |
| ☐ | Jetzt eine Figur hinzufügen, neu laden → Positionen **und** Marke „ungespeicherte Änderungen" sind beide wieder da |

> **Was hier schiefgehen könnte:** die Zuordnung liegt im Browser
> (`loadedId`), der Abdruck daneben. Käme nach dem Neuladen „Als neue
> speichern" statt „Bestehende aktualisieren", wäre die Zuordnung verloren
> — dann bitte melden, das wäre ein echter Fehler.

### 4e · Reihenfolge

| ☐ | |
|---|---|
| ☐ | Drei Figuren aufnehmen → die zuletzt getippte steht **oben** |
| ☐ | Die **unterste** noch einmal über die Suche hinzufügen → sie springt nach oben, Menge +1, **keine zweite Zeile** |
| ☐ | Bei einer mittleren Zeile Plus/Minus drücken → sie bleibt, **wo sie ist** |

### 4f · Telefon (Punkt 8)

Entwicklerwerkzeuge → Gerätemodus, 390 × 844 (oder ein echtes Telefon im
gleichen Netz über die Netzwerk-Adresse, die `dev:staging` ausgibt).

| ☐ | |
|---|---|
| ☐ | Die drei Knöpfe im **Kopf** brechen auf dem Telefon in eine zweite Zeile um statt zu schrumpfen, jeder 44 px hoch (V2.1) |
| ☐ | **Der maximale Einkaufspreis ist sichtbar, ohne zu scrollen** — auch mit zehn Positionen in der Liste |
| ☐ | „Gespeichert" öffnen: die Liste nimmt die Mitte, **Fuß mit der Zahl bleibt stehen**, und oben steht der Rückweg als Knopf mit Pfeil (V2.1) |
| ☐ | Auf dem Schreibtisch: **mindestens fünf Figurenzeilen** gleichzeitig sichtbar, auch während die Suche Treffer zeigt (V2.1) |
| ☐ | In der Liste sind „Öffnen", „Umbenennen", „Löschen" einzeln treffbar (40 px) |
| ☐ | Das Namensfeld beim Speichern füllt die Breite, die Tastatur verdeckt die Knöpfe nicht dauerhaft |

---

## Rücknahme, falls etwas nicht stimmt

```
supabase/rollback/R0142_drop_purchase_calculations.sql
```

Sie **bricht ab**, solange Zeilen in der Tabelle stehen, und verlangt einen
Schalter in der Datei (`v_auch_mit_daten := true`). Der Arbeitsstand im
Browser ist davon nicht betroffen: nach der Rücknahme rechnet der Kalkulator
weiter, er kann nur nicht mehr speichern.

---

## Nachtrag 2026-10-22: der Lauf, und ein Befund in meiner eigenen Prüfung

### Was gelaufen ist

`0142` ist auf Staging angewendet. Die Nachkontrolle meldete **`9999 = 1`**,
und die einzige rote Zeile war **502**: *„collection_items hat weiter genau
vier Richtlinien"* — gefunden wurden **fünf**.

### Die Erklärung, vollständig und rein lesend

Die fünfte Richtlinie heißt `agent_read_collection_items` und kommt nicht von
`0142`, sondern von `supabase/operations/staging-agent-setup.sql`. Diese Datei
legt für den **lesenden Staging-Prüfzugang** je Tabelle eine eigene
Lesepolicy an:

```sql
create policy agent_read_<tabelle> on public.<tabelle>
  for select to skyisles_agent using (true)
```

für **zwölf** Tabellen, `collection_items` darunter. `docs/SECURITY.md`,
Abschnitt 4b, nennt genau das — und auch den Grund: die Rolle hat
**kein `bypassrls`**, also sähe sie ohne eigene Policy null Zeilen.

**Sie stand lange vor `0142`.** Belege, alle im Repository:

| | |
|---|---|
| Keine Migration legt sie an | `0001` und `0042` definieren **vier** Richtlinien auf `collection_items`, `0042` ersetzt die vier aus `0001`. Keine fünfte, nirgends |
| `0142` kann sie nicht angelegt haben | die Datei enthält genau vier `create policy`, alle auf `purchase_calculations`; der Testlauf zählt sie, und die Plan­prüfung nennt sie |
| Der Prüfzugang ist älter | er trägt den Datenbankkommentar, an dem `tools/lib/staging-db.mts` die Sitzung erkennt, und seine Rechte sind in `docs/SECURITY.md` ausgezählt |

### Ist sie sicherheitstechnisch relevant?

**Sie ist bewusst, begrenzt und nur auf Staging — und sie ist kein Nichts.**
Was sie tut: sie gibt der Rolle `skyisles_agent` Leserecht auf
`collection_items`. Was sie nicht tut:

* **nicht `anon`, nicht `authenticated`** — die Rolle ist weder; Zeile 506
  prüft seitdem ausdrücklich, dass keine Richtlinie dieser Tabelle `anon`
  etwas gibt;
* **kein Schreiben** — `for select`, und die Rolle ist zusätzlich an
  `default_transaction_read_only` gebunden: ein Schreibversuch endet mit
  `25006`, unabhängig von Rechten;
* **nicht auf Production** — `staging-agent-setup.sql` bricht ohne das
  Markerpaar `SKY-0821` + `SKY-0822` ab, und Production trägt es nicht;
* **keine bestehende Richtlinie geändert** — sie kommt hinzu, die vier
  eigenen gelten unverändert für `authenticated`.

Die ehrliche Einordnung: auf Staging kann ein Diagnosezugang die
Sammlungszeilen der Testkonten lesen. Das ist sein Zweck, es ist
dokumentiert, und es betrifft keine echten Kundendaten. **Auf Production
darf diese Policy nicht existieren** — dort gibt es den Zugang nicht.

### Was korrigiert wurde — und was nicht

**Keine Richtlinie angefasst.** Korrigiert wurde allein die veraltete
Erwartung:

* Zeile **502** verlangt jetzt die EIGENSCHAFT statt einer Zahl: die vier
  Richtlinien `collection_items_*_own` stehen und gelten für
  `authenticated`.
* Zeile **505** nennt neu **alle** Richtlinien der Tabelle mit Befehl und
  Rollen — damit eine künftige Abweichung eine Auskunft ist und keine Zahl.
* Zeile **506** prüft neu, dass keine davon `anon` etwas gibt.

> **Warum eine Zahl die falsche Formulierung war:** sie bricht, sobald
> jemand eine berechtigte Policy hinzufügt, und sie sagt nichts darüber, ob
> die vier, auf die es ankommt, noch da sind. Genau das ist hier passiert —
> die Prüfung hat etwas gemeldet, das richtig war.

**Beim nächsten Lauf der Nachkontrolle muss `9999 = 0` stehen**, und Zeile
505 nennt die fünf Namen. Bitte diese Zeile mitschicken: sie bestätigt die
Erklärung aus der Datenbank selbst, statt sie aus dem Repository zu
schließen — das ist der eine Teil, den ich von hier aus nicht lesen kann
(PostgREST gibt kein `pg_policies` her).

### Der RLS-Lauf mit zwei Konten

`npm run verify:calculations:staging` — **27 von 27 bestanden.** Zwei echte
Konten, zwei echte JWT, niemals die Dienstrolle für eine Behauptung:

```
A legt an · die Zeile gehört A · 2 Positionen, 3 Stück, 3580 Cent
B kann KEINE Zeile für A anlegen            42501
B sieht die von A NICHT                     0 Zeilen
auch nicht gezielt über die ID              0 Zeilen
ein Gast sieht gar nichts                   42501
B kann nicht ändern, nicht löschen          0 Zeilen getroffen
die Zeile von A ist unverändert
updated_at bewegt sich (Trigger aus 0001)
lines ohne Array / leerer Name / unbekannter Status / Faktor 140   23514
zwei Kalkulationen nebeneinander, unabhängig
ein Einkauf, höchstens eine Kalkulation     23505
aufgeräumt: 0 Probezeilen, beide Testkonten entfernt
```


---

## 0143 — die Übernahme ins Orderbuch (Calculator V3, ADR-0132)

**Vorgeprüft am 2026-10-22, rein lesend.** `0142` steht auf Staging (Tabelle
mit allen zwölf Spalten lesbar, `anon` abgewiesen mit `42501`, eine
gespeicherte Kalkulation aus der Browserprobe), `0143` ist dort **noch nicht
angewendet** (`PGRST202`), und `seller_create_purchase_with_items` steht
unberührt und für `anon` gesperrt (`42501`).

### Die Reihenfolge im SQL-Editor

| # | Datei | schreibt? | Erwartung |
|---|---|---|---|
| 1 | `supabase/operations/staging-s-postflight-0142.sql` | nein | `9999 = 0` · Zeile 104 nennt jetzt die Zahl der gespeicherten Kalkulationen (keine Erwartung mehr) · Zeile 505 nennt die fünf Richtlinien von `collection_items` |
| 2 | `supabase/operations/staging-0143.sql` | **ja** | `0143 ok: …` und `commit` |
| 3 | `supabase/operations/staging-s-postflight-0143.sql` | nein | `9999 = 0` |

Danach, von außen:

```bash
npm run verify:calculations:staging     # 27/27, unverändert
```

### Was Schritt 3 prüft

| Zeilen | |
|---|---|
| 101–106 | die Funktion steht einmal, **vierzehn** Argumente in der richtigen Folge und mit den richtigen Typen, Rückgabe `bigint`, `security definer`, leerer `search_path` |
| **201–204** | **sie ruft `seller_create_purchase_with_items` auf** und fügt selbst nichts in `purchases` oder `purchase_items` ein, und sie bucht nichts ein |
| 301–305 | die drei Riegel: Betriebsrolle · Besitz (`c.user_id = (select auth.uid())`) · `for update`; dazu „already handed over" und „calculation not found" |
| 401–402 | aus der Kalkulation wird **nur `purchase_id`** gelesen — kein Betrag, kein Faktor, keine Positionen |
| 501–503 | ACL materialisiert · **kein** EXECUTE für PUBLIC/`anon` · `authenticated` darf |
| 601–605 | ringsherum unverändert: `seller_create_purchase_with_items` und `seller_create_purchase` je **genau einmal**, `purchase_calculations` weiter vier Richtlinien ohne `anon`, der partielle Unique-Index steht |
| **701–703** | **die Belegsperre**: keine Grants, keine API-Rolle darf ausstellen, und `0143` nennt die Belegausstellung nirgends |
| 901–902 | Infos: Einkäufe insgesamt, Kalkulationen und davon verknüpfte |

**Zeile 601/602 sind die interessantesten.** Zeigen sie mehr als `1`, ist eine
alte Signatur von `seller_create_purchase_with_items` stehengeblieben — dann
gäbe es wirklich zwei Wege, einen Einkauf anzulegen. Die Migrationen räumen
auf (`0116` droppt die Fassung mit fünf Parametern, `0120` die mit zwölf),
aber geprüft ist es erst, wenn es dort steht. **Im Probelauf sind diese zwei
Zeilen rot**, weil das Stub-Schema alle Signaturen anlegt und keine
`drop`-Anweisung ausführt — in einer echten Datenbank müssen sie grün sein.

### Danach im Browser (braucht `0143`)

| ☐ | |
|---|---|
| ☐ | Kalkulation speichern → „Einkauf erstellen" → das **normale** Formular mit den Figuren drin |
| ☐ | Kaufdaten eintippen, speichern → Einkauf entsteht, in der Liste steht jetzt **„Einkauf ansehen"** und führt auf genau diesen Einkauf |
| ☐ | Dieselbe Adresse `?kalkulation=<id>` noch einmal aufrufen und speichern → die Datenbank lehnt ab (`already handed over`), **und es entsteht kein zweiter Einkauf** |
| ☐ | Abbrechen statt speichern → **kein** Einkauf, Kalkulation zeigt weiter „Einkauf erstellen" |
| ☐ | „+ Neu" ohne Kalkulation → leeres Formular wie immer |
| ☐ | Die vier Geldfelder sind leer, auch bei einer Kalkulation über 300 € |
| ☐ | Beim Klick **schließt sich der Kalkulator** und das Formular steht frei da (siehe Nachtrag) |

### Nachtrag 2026-10-24 — hier ist der erste Durchlauf hängengeblieben

„Einkauf erstellen" trug die richtige Adresse, navigierte auch, und **es
passierte sichtbar nichts**: der Kalkulator blieb über der Zielseite stehen.

Der Grund: `CalculatorLauncher` hängt in `site-nav.tsx` und die in
`(business)/layout.tsx`. Innerhalb von `/business/*` tauscht eine Navigation
nur die Seite aus, das Layout bleibt — und `Modal` liegt als
`fixed inset-0 z-50` über allem. Die Seite wechselte unter einem deckenden
Vorhang; `body.style.overflow` blieb auf `hidden`.

Behoben (ADR-0133, V3.1): die beiden Verweise schließen das Fenster über
`onNavigate`. **An `0142`, `0143`, der Einkaufserstellung und den
Richtlinien wurde nichts geändert** — die Ursache lag nicht dort. Geprüft
wird es jetzt mit echtem Klick in `calculator-navigation.test.tsx`.

Beim Nachtesten also eine Zeile mehr: nach dem Klick muss das Formular
**frei** stehen, und die Seite muss rollen.
