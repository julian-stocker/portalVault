# Laufzettel `0151` — die Live-Sicht wird eigenständig (ADR-0147, E-1/B2)

**Stand 2026-10-26. Nicht gefahren. Nirgends angewendet.**
Freigegeben war M2: schreiben, prüfen, liegen lassen.

---

## Warum es diese Migration gibt

`public.offer_state_live` ist die einzige zustandsfreie Definition von „was
ist **jetzt** kaufbar, zu welchem günstigsten Preis". `0150` liest sie — und
sonst braucht `0150` von der alten Bauform **nichts**. Angelegt wurde sie aber
von `0146`, zusammen mit dem Spiegel, der wieder verschwinden soll.

> **Ohne `0151` müsste Production erst `0146` bekommen** — also eine Tabelle
> mit ~290 Zeilen `announced_*`, zwei Funktionen und einen Spiegel ohne
> Aufrufer, die alle drei sofort wieder weg sollen. **Mit `0151` bekommt
> Production genau ein Objekt: die Sicht.**

Fachlich ist sie eine **Shop-Projektion** und keine Benachrichtigungssache:
sie liest `shop_offers()` (0029/0139) und `v1_sale_condition()` (0028) — und
nichts sonst, insbesondere **nicht** `offer_state`. Dass sie bisher in einer
Benachrichtigungsmigration stand, war ein Kategorienfehler.

## Die Reihenfolge, und sie ist ausdrücklich so gewollt

```
0151  →  0150
```

**Auf Production läuft `0151` damit vor `0150`, also eine höhere Nummer
zuerst.** Das ist nach `APPLIED.md`, Abschnitt „Die Nummer ist eine
Reihenfolge, keine Kette", erlaubt, und der dort verlangte Nachweis ist hier
trivial:

| | |
|---|---|
| **`0151` ändert** | nur `public.offer_state_live` |
| **`0150` ändert** | nur seine fünf eigenen Objekte (`availability_alerts`, vier Funktionen) |
| **Schnittmenge der geänderten Objekte** | **leer** |
| **Abhängigkeit** | genau eine: `0150` **liest** `offer_state_live` |

Nachgefahren wird das nicht nur behauptet: **Probelauf P58** installiert `0151`
und danach `0150` in genau dieser Folge an echtem PostgreSQL und prüft, dass
die Sicht vorher fehlt und nachher steht.

---

## Zwei Ausgangslagen, ein Endzustand

| Umgebung | Ausgangslage | Was `0151` tut |
|---|---|---|
| **Staging** `qqxcpesbwfxzgytkdsac` | die Sicht steht seit `0146` | **prüft sie und fasst sie nicht an** |
| **Production** `zmiwxswrpkmizvqsgype` | die Sicht fehlt | **legt sie an**, Rumpf zeichengleich aus `0146`, Kommentar zeichengleich, kein Clientrecht |

**`create or replace view` kommt in der Migration nicht vor.** Es wäre der
kurze Weg und gleichzeitig der gefährliche: auf Staging würde es einen
bestehenden Rumpf stillschweigend ersetzen.

**Deshalb ist `0151` wiederholbar — anders als `0150`.** Ihr Gegenstand ist ein
*Zustand* („die Sicht steht und ist die richtige"), nicht ein *Ereignis*
(„diese fünf Objekte entstehen jetzt"). Ein zweiter Lauf prüft erneut und
lässt alles, wie es ist; `0150` dagegen prallt beim zweiten Lauf an jedem
ihrer fünf Objekte ab. P59 fährt beide Male nach.

## Was „fachlich gleichwertig" heißt — vier Stufen

Eine abweichende bestehende Sicht darf **nicht** stillschweigend durchgehen.
Geprüft wird deshalb nicht nur der Name:

| Stufe | Frage | Wogegen sie schützt |
|---|---|---|
| **1 · Bauart** | eine Sicht, genau zwei Spalten `sky_id text` und `cheapest_cents integer` | eine erweiterte oder umbenannte Fassung |
| **2 · Herkunft** | hängt an `shop_offers()` **und** `v1_sale_condition()`, und an **keiner** Relation — gelesen aus `pg_depend` über die Umschreiberegel | eine Fassung, die `offer_state` oder `shop_inventory` direkt liest. Formatunabhängig, weil aus dem Katalog gelesen |
| **3 · Wortlaut** | der normalisierte `pg_get_viewdef()` enthält `shop_offers`, `v1_sale_condition`, `min(round(`, `*100`, `available`, `group by` | **`max` statt `min`** und ein **fehlendes `available`** — beides lässt Spalten und Herkunft unverändert |
| **4 · Verhalten** | ihr Ergebnis ist zeichengleich mit dem der verbindlichen Fassung, **beide Abdrücke in EINER Anweisung** | eine Fassung, die alle sechs Wörter enthält und trotzdem etwas anderes liefert — z. B. ein zusätzlicher Filter |

Dazu die Rechte: **kein Clientrecht.** Steht dort eines, bricht sie ab.

> **Ehrliche Grenze von Stufe 4.** Zeichengleiche Ergebnisse auf den *heutigen*
> Daten beweisen keine Gleichheit für alle denkbaren Daten, und bei einem
> leeren Shop ist der Vergleich leer gegen leer. Stufe 4 ist das vierte Bein,
> nicht das einzige; die Last tragen 1 bis 3, die von Daten unabhängig sind.

**Es gibt genau eine Definition, und zwar als ein einziges Literal.** `v_rumpf`
in der Migration ist der Rumpf aus `0146`, Zeichen für Zeichen, und wird
zweimal benutzt: zum Anlegen und — als Unterabfrage — zum Vergleichen in
Stufe 4. Es gibt also keine zweite Fassung der Kaufbarkeitsregel, auch nicht
zum Prüfen. `src/lib/availability/alerts-schema.test.ts` hält das Literal
gegen `0146`.

---

## Reihenfolge des Laufs

> ### Auf Staging verweigert der Runner — und das ist richtig
>
> Die `angewendet`-Probe in `migration-plans.json` fragt den **Zustand**
> („`offer_state_live` steht") und nicht das Ereignis — eine Spur, die den
> Lauf von der Sicht unterscheidet, gibt es auf Staging nicht, weil `0151`
> dort nichts ändert. Die Probe antwortet dort also **von Anfang an JA**, und
> `npm run db:migrate:staging -- 0151` meldet „liegt auf Staging schon" und
> wendet nichts an. **Das ist die Bestätigung, dass Staging nichts braucht**,
> kein Fehler.
>
> Für die **Generalprobe** — die vier Stufen einmal gegen echte Daten laufen
> lassen, bevor dieselbe Datei auf Production eine Sicht anlegt — wird die
> Hülle direkt eingefügt. Sie ist wiederholbar und folgenlos.

### Auf Staging

| # | Schritt | Datei | Erwartet |
|---|---|---|---|
| 1 | Stand prüfen | `npm run db:migrate:staging -- 0151` | meldet **„liegt auf Staging schon"** und wendet nichts an |
| 2 | Preflight lesen | `npm run db:migrate:staging -- 0151 --resume` fährt `0151_postflight.sql` | **Zeile 9999 = `0`** |
| 3 | **Generalprobe, optional aber empfohlen** | `supabase/operations/staging-0151.sql` | vollständig markieren, in den SQL-Editor einfügen, ausführen. **Erwartet: `0151: die Sicht stand schon und ist fachlich gleichwertig … NICHTS angefasst.`** Erscheint „die Sicht fehlte und ist neu angelegt", **anhalten** — dann ist dies nicht Staging oder `0146` liegt dort nicht |
| 4 | Der berechtigte Lauf | `supabase/log/staging/0151-postflight-berechtigt.sql` | als `postgres`. **`9998 = 0` und `9999 = 0`**; Zeile 121 nennt dann den Abdruck der Sicht |

### Auf Production (eigene Freigabe, nicht Teil von M2)

| # | Schritt | Erwartet |
|---|---|---|
| 1 | Preflight `0151_preflight.sql` | Zeile **111** sagt `false` — die Sicht fehlt. Zeile 9999 = `0` |
| 2 | Die Hülle in der Production-Fassung | **`0151: die Sicht fehlte und ist neu angelegt`** |
| 3 | Nachkontrolle `0151_postflight.sql` | Zeile 9999 = `0`; 101–106 beschreiben dieselbe Sicht wie auf Staging |
| 4 | Danach `0150` | siehe `supabase/checks/0150_staging_run.md` |

Danach dieselbe Folge für `0150` (`supabase/checks/0150_staging_run.md`).

## Was die Nachkontrolle beweist

| Zeilen | Zusage |
|---|---|
| 101–106 | es ist eine Sicht · genau zwei Spalten mit Namen und Typ · sie liest **keine** Relation · sie hängt an beiden Funktionen · ihr Wortlaut enthält jedes tragende Stück · **kein Clientrecht** |
| 111–114 | `shop_offers()` und `v1_sale_condition()` unberührt · kein Trigger dazugekommen · die alte Bauform als **Auskunft ohne Erwartung** (sie darf fehlen und darf sich nicht bewegen) |
| 121 | Auskunft: der Abdruck der Sicht |
| 811–817, 821–833 | Shop, Lager und Sammlung **Ziffer für Ziffer wie vor dem Lauf** |

## Wenn etwas schiefgeht

**Eine Transaktion.** Bricht Schritt 3 ab, ist nichts entstanden. Auf Staging
ist der häufigste Abbruchgrund eine der vier Stufen — und dann ist er ein
**Befund über die bestehende Sicht**, nicht über diese Migration: sie wird
dann von Hand geklärt, nicht überschrieben.

**Rücknahme:** `supabase/rollback/R0151_drop_offer_state_live.sql`. Sie
**verweigert, solange irgendwer die Sicht liest** — PostgreSQL schützt hier
nicht, weil ein Funktionsrumpf keine Abhängigkeit auf die Objekte in ihm
hält. Die Namensliste ist gemessen: `refresh_offer_state()`,
`offer_availability_due()`, `watch_availability(text)`,
`fire_availability_alerts()`.

---

## Der spätere Rückbau (M9) — Anforderungen, noch nicht umgesetzt

**Entscheidung E-4: `R0146b` wird jetzt nicht als ausführbares SQL erstellt.**
Hier stehen die Anforderungen, damit sie beim Rückbau nicht neu erfunden
werden müssen.

> ### Die Sicht muss den Rückbau ÜBERLEBEN.
>
> `R0146_drop_offer_state.sql`, Zeile 76, enthält
> `drop view if exists public.offer_state_live;`. **Nach der Einführung von
> `0150` würde dieser Rückbau die neue Benachrichtigungsfunktion
> zerbrechen** — `watch_availability()` und `fire_availability_alerts()`
> lesen die Sicht, und PostgreSQL hält darauf keine Abhängigkeit: der `drop`
> liefe glatt durch, und der Bruch fiele erst beim nächsten Klick auf eine
> Glocke auf.

Was eine Rückbaufassung leisten muss:

1. **`R0146` bleibt unberührt.** Nach Regel 1 der Akte wird an einer
   angewendeten Migration samt Paket nichts geändert. Der Rückbau braucht
   eine **eigene, neue** Datei.
2. **Sie nimmt `refresh_offer_state()`, `offer_state_window()` und die
   Tabelle `offer_state`** — in dieser Reihenfolge, Funktionen vor Tabelle.
3. **Sie lässt `public.offer_state_live` stehen.** Das ist ihr
   Unterscheidungsmerkmal gegenüber `R0146`, und es gehört in ihre
   Nachbedingung: die Sicht steht noch, und beide Funktionen aus `0150`
   stehen noch.
4. **Sie benennt den angenommenen Verlust**: die `announced_*`-Spalten von
   ~225 Zeilen. `R0146` bricht genau daran ab, und das ist dort richtig —
   in der neuen Bauform gibt es für „gemeldet je Figur" keinen Nachfolger
   mehr, der Verlust ist also gewollt und muss ausgesprochen werden.
5. **Reihenfolge des ganzen Rückbaus:** `R0149` → `R0148` → `R0147` → die
   neue Fassung. Danach muss gelten: die Sicht steht, `shop_offers()` steht,
   und `availability_alerts` samt seinen vier Funktionen steht.
6. **Vorher die lesende Bestandsprüfung** aus ADR-0147: was an historischen
   Meldungen existiert und ob etwas übernommen werden soll (Entscheidung
   D-10, offen).

**Reihenfolge der Freigaben:** erst die neue Architektur erfolgreich
einführen, dann der Rückbau — mit gesonderter Freigabe (E-4).
