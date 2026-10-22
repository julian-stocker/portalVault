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
| ☐ | Die drei Knöpfe der Werkzeugleiste brechen um statt zu schrumpfen, jeder gut mit dem Daumen treffbar |
| ☐ | **Der maximale Einkaufspreis ist sichtbar, ohne zu scrollen** — auch mit zehn Positionen in der Liste |
| ☐ | „Gespeichert" öffnen: die Liste nimmt die Mitte, **Fuß mit der Zahl bleibt stehen** |
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
