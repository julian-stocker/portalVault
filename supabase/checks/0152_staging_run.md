# Laufzettel `0152` — der redaktionelle Katalogstatus (CAT-02B, ADR-0151)

> ## GEFAHREN AM 2026-10-27 — auf Staging, nicht auf Production
>
> Preflight `9999 = 0` (34 Zeilen), die eine schreibende Anweisung vom
> Betreiber im SQL-Editor, Nachkontrolle `9999 = 0` (52 Zeilen) gegen die
> **vorher** eingefrorenen Baselines. Ergebnis: 626 Zeilen unverändert,
> **596 `public`, 30 `hidden`, 0 `draft`**. Einzelheiten in
> `supabase/migrations/APPLIED.md`.
>
> **Offen bleibt der berechtigte Lauf** `supabase/log/staging/0152-postflight-berechtigt.sql`
> als `postgres` — er schließt die eine Zeile (136, Journal), die der
> lesende Prüfzugang nicht lesen darf.
>
> **Für Production gilt dieses Dokument unverändert weiter.**

Dieses Dokument ist der Laufzettel: was vorher geprüft wird, was eingefügt
wird, was danach gelten muss, und wann angehalten wird.

| | |
|---|---|
| Migration | `supabase/migrations/0152_catalog_status.sql` |
| Preflight | `supabase/checks/0152_preflight.sql` |
| Einfüge-Hülle | `supabase/operations/staging-0152.sql` |
| Nachkontrolle | `supabase/checks/0152_postflight.sql` |
| Rücknahme | `supabase/rollback/R0152_drop_catalog_status.sql` |
| Probelauf | **P60** in `tools/validate-check-sql.mts` (17 Fälle, echtes PostgreSQL) |

---

## 1. Was sie tut, in einem Satz

Der Katalog bekommt eine dritte Antwort auf die Frage „zeigt der öffentliche
Katalog das?": **`public`**, **`hidden`** und neu **`draft`**. Die Spalte
`catalog_visible` bleibt und bleibt die Sicherheitsgrenze; der Status sagt
zusätzlich, **warum** eine Zeile nicht öffentlich ist.

**Die Sichtbarkeit ändert sich für keine einzige Zeile.** Der Backfill leitet
`case when catalog_visible then 'public' else 'hidden' end` ab — nie umgekehrt.
**Es entsteht kein einziger Entwurf.**

---

## 2. Die Reihenfolge, und sie ist kein Freibrief

`0150`, `0151`, `0152` und `0153` liegen alle **nirgends angewendet**. Die
Nummern sind eine Reihenfolge, **keine Kette** — maßgeblich ist, welche Objekte
eine Migration anfasst.

| | fasst an | liest |
|---|---|---|
| `0150` | `availability_alerts` + 4 Funktionen | die Sicht `offer_state_live` |
| `0151` | nur die Sicht `offer_state_live` | `shop_offers()`, `v1_sale_condition()` |
| `0152` | `skylanders` (eine Spalte, 2 CHECKs, 1 Trigger) + 3 Funktionsrümpfe | `catalog_visible` |
| `0153` | nur den Rumpf von `system_platform_export()` | `skylanders.catalog_status` |

**Die Schnittmengen, gemessen und nicht vermutet:**

* `0152` ∩ `0150` = **leer**. `0150` hat einen Fremdschlüssel auf `skylanders`
  (RESTRICT) — eine zusätzliche Spalte dort berührt ihn nicht.
* `0152` ∩ `0151` = **leer**. `0151` nennt `skylanders` nirgends.
* `0153` → `0152` ist eine **echte Abhängigkeit**: die Spalte muss existieren.
* `0153` → `0144` ist eine **zweite echte Abhängigkeit**: sie ist aus dem
  `0144`-Rumpf gerechnet (`4c4d2e7c…`) und ersetzt nur genau den.

**Daraus folgt die zulässige Ordnung:**

```
Staging:     0151 → 0150          (fachlich, ADR-0147: die Sicht vor dem Alarm)
             0152 → 0153          (die Spalte vor der Sicherung)
             und zwischen diesen beiden Paaren ist die Ordnung FREI
Production:  0151 → 0150
             0144 → 0152 → 0153   (0144 liegt dort NICHT; eigene Entscheidung)
```

**Warum `0152` die laufenden Prüfverträge nicht verschiebt — und das ist die
Aussage, die die Freiheit begründet:** der Basis-Vertrag, den `0142`–`0151`
zeichengleich teilen, misst sieben Zahlen: öffentliche Angebote, deren
Abdruck, shopfähige Katalogzeilen, sammelbare Katalogzeilen, Lagerzeilen,
Katalogzeilen und den Lagerabdruck. **Jede einzelne hängt an `catalog_visible`
oder an gar keiner Katalogspalte**, und `0152` bewegt `catalog_visible` für
keine Zeile. Die Baselines von `0150`/`0151` bleiben also gültig, in beiden
Richtungen.

> **Trotzdem: eine Migration je Preflight/Postflight-Paar.** Die Baselines
> werden **vor** der Migration eingefroren und danach nie neu erhoben
> (ADR-0137). Zwei Migrationen in einer Klammer wären zwei Ereignisse mit
> einem Beweis.

---

## 3. Erwartete Ausgangszustände (Staging, vor dem Lauf)

Der Preflight nennt sie; diese Tabelle sagt, was dort stehen **muss**.

| Zeile | Prüfung | Erwartet |
|---|---|---|
| 101 | `skylanders` steht | `true` |
| 102 | `catalog_visible` steht | `1` |
| 103 | `is_platform_admin()` steht | `true` |
| 104 | `log_skylander_editorial_change()` steht | `true` |
| 105 | `admin_create_figure(…8 Parameter…)` steht | `true` |
| 106 | **und zwar genau EINE Fassung** | `1` |
| 107 | `admin_set_catalog_visible(text,boolean)` steht | `true` |
| 111 | `catalog_status` **fehlt** | `0` |
| 112 | kein CHECK mit dem Namen | `0` |
| 113 | kein Trigger `skylanders_sync_catalog_status` | `0` |
| 114 | `admin_set_catalog_status` gibt es nicht | `true` |
| 115 | `admin_create_figure` nennt `catalog_status` nicht | `0` |
| 121 | Info: sichtbare Katalogzeilen | **notieren** — werden `public` |
| 122 | Info: unsichtbare Katalogzeilen | **notieren** — werden `hidden` |
| 123 | Info: Summe | muss Zeile 1 treffen |
| 124 | keine Zeile mit `catalog_visible` NULL | `0` |
| 131–132 | `catalog_admin_changes` und der Journaltrigger, **benannt** | `true` / `1` |
| 133 | Info: Journalzeilen | **notieren** |
| 900/901 | die zwei Baselines | **vollständig kopieren** |
| 9999 | blockierende Abweichungen | **`0`** |

**Zeile 106 ist der Grund, warum sie dasteht:** `0033` legte
`admin_create_figure` mit sieben Parametern an, `0034` eine mit acht und löscht
die alte. Stünden beide, wäre ein Aufruf mehrdeutig (`42725`). Genau dieser
Fehler trat im Probelauf **P60** zuerst auf — weil das Stub-Schema
`drop function` ignoriert. Auf einer echten Datenbank ist es eine Prüfung, auf
der Stub-Datenbank war es ein Befund über das Werkzeug.

---

## 4. Reihenfolge des Laufs

### Auf Staging

| # | Schritt | Datei / Befehl | Erwartet |
|---|---|---|---|
| 1 | Stand prüfen, Preflight, Baselines einfrieren | `npm run db:migrate:staging -- 0152` | **Zeile 9999 = `0`**; der Runner friert die Baselines in `supabase/baselines/` ein und hält an |
| 2 | Die eine schreibende Anweisung | `supabase/operations/staging-0152.sql` | vollständig markieren, in den SQL-Editor des Staging-Projekts einfügen, ausführen |
| 3 | Nachkontrolle, mit genau diesen Baselines | `npm run db:migrate:staging -- 0152 --resume` | **`9998 = 0` und `9999 = 0`** |
| 4 | Der berechtigte Lauf | `0152_postflight.sql` als `postgres` | dieselben Zahlen; er schließt die rechtegeschützten Zeilen, falls welche offen blieben |

**Was in Schritt 2 auf dem Bildschirm stehen muss:**

```
NOTICE:  0152: catalog_status steht, N public, M hidden, 0 draft …
```

**`N + M` muss die Zahl der Katalogzeilen sein, und `draft` muss `0` sein.**
Steht dort ein Entwurf, hat der Backfill etwas anderes getan als
`catalog_visible` abzulesen — **anhalten**, nicht weitermachen.

### Auf Production

**Eigene Freigabe, nicht Teil dieses Laufzettels.** `0152` ist dort anwendbar,
ohne dass `0144`–`0151` liegen müssen: sie setzt `0001`, `0004`, `0026`/`0077`
und `0034` voraus, und alle vier liegen auf Production. `0153` dagegen setzt
`0144` voraus und wartet dort.

---

## 5. Was die Nachkontrolle beweist

| Zeilen | Aussage |
|---|---|
| 101–103 | die Spalte steht, als `text`, `NOT NULL`, **ohne DEFAULT** |
| 104–105 | beide CHECKs, **mit Namen** |
| 106 | der Trigger ist `BEFORE INSERT OR UPDATE … FOR EACH ROW` (`tgtype = 23`) |
| 107–110 | die neue Funktion, `security definer`, leerer `search_path`, kein Recht für `anon`/`public`, genau eines für `authenticated` |
| **111** | **jede sichtbare Zeile ist `public` — und keine andere.** Diese eine Zeile ist der Beweis für den Backfill, und sie braucht keine übergebene Zahl |
| 112–115 | kein unbekannter Wert, **kein Entwurf**, kein NULL |
| 121–124 | die drei ersetzten Rümpfe, am Inhalt erkannt; `admin_create_figure` weiter in **einer** Fassung |
| 131–135 | **was unberührt bleiben musste**: beide Lesepolitiken lesen weiter `is_active and catalog_visible` und **nicht** den Status, RLS an, der Katalogindex steht, `admin_set_catalog_visible` ist noch da |
| 136 | Info: Journalzeilen — mit Zeile 133 des Preflights vergleichen, die Zahl darf sich nicht bewegt haben |
| 801–833 | der Basis-Vertrag: Shop, Lager und Sammlung unverändert |

**Warum es keine eigene Baseline für den Status gibt.** Eine übergebene Zahl
sagt „so viele waren es vorher". Zeile 111 sagt „genau diese Zeilen sind es,
Zeile für Zeile". Die zweite Aussage ist stärker und braucht keinen Handgriff —
und Handgriffe waren bei `0145` und `0146` die Fehlerquelle (ADR-0137).

---

## 6. Rücknahme und Wiederherstellung

### Wenn Schritt 2 abbricht

**Dann ist nichts passiert.** Die Hülle ist **eine** Transaktion: `begin;`, die
sieben Wächter, die Migration, `commit;`. Ein `raise exception` an irgendeiner
Stelle nimmt alles zurück, auch das `add column`. Das ist lesend bestätigbar —
der Preflight erneut gefahren muss wieder `111 = 0` sagen.

> **Deshalb klammert die Migration sich NICHT selbst.** Eine eigene Klammer in
> `0152` wäre eine zweite: ihr inneres `commit` schlösse die äußere Transaktion
> vorzeitig ab und machte die Wächter wirkungslos. Die Klammer gehört in die
> Hülle — so wie bei `0150` und `0151`. (Diese Korrektur entstand beim
> Schreiben dieses Laufzettels; CAT-02B hatte sie selbst gesetzt.)

### Wenn Schritt 3 abweicht

| Befund | Bedeutung | Was tun |
|---|---|---|
| `111 ≠ 0` | Status und Sichtbarkeit laufen auseinander | **anhalten.** Das darf der CHECK nicht zugelassen haben — es wäre ein Befund über die Migration, nicht über die Daten |
| `113 ≠ 0` | ein Entwurf ist entstanden | **anhalten.** Der Backfill hat etwas anderes getan als abzulesen |
| `131` oder `132` `≠ 1` | eine Lesepolitik wurde angefasst | **sofort anhalten.** Das ist eine Sichtbarkeitsänderung, und `0152` darf keine machen |
| eine Zahl aus 811–817 weicht ab | Shop, Lager oder Sammlung hat sich bewegt | prüfen, ob der Betrieb parallel gearbeitet hat (das war bei `0147`–`0149` der Fall und war **nicht** die Migration); sonst anhalten |
| `9998 ≠ 0` | Zeilen, die der Prüfzugang nicht lesen durfte | kein Mangel — den berechtigten Lauf als `postgres` fahren (ADR-0139/0141) |

### Die Rücknahme

`supabase/rollback/R0152_drop_catalog_status.sql` nimmt Trigger, CHECKs,
Funktion und Spalte zurück und stellt die zwei Rümpfe auf ihre Vorfassungen.

**Sie ist kein Datenverlust, aber ein Verlust von Absicht:** jede Zeile, die
als Entwurf geführt wurde, ist danach nur noch „versteckt". Deshalb **zählt
sie die Entwürfe und benennt sie**, bevor sie etwas tut — wer sie fährt, soll
wissen, was er verliert.

**Sie ist nicht die erste Wahl.** `0152` ist additiv: die Spalte stehen zu
lassen kostet nichts, und ein Problem in der Oberfläche ist kein Grund für eine
Migration. Die Rücknahme ist für den Fall, dass der **Trigger** sich an echten
Daten anders verhält als in P60.

---

## 7. Abbruchbedingungen — die Liste, bei der nicht weitergemacht wird

1. **Preflight `9999 ≠ 0`.** Keine Ausnahme, keine Einzelfallwürdigung.
2. **Zeile 111 des Preflights ist nicht `0`** — `catalog_status` steht schon.
   Dann ist `0152` hier angewendet; Akte prüfen, nicht noch einmal fahren.
3. **Zeile 106 des Preflights ist nicht `1`** — `admin_create_figure` steht in
   mehreren Fassungen. Ein Aufruf wäre mehrdeutig.
4. **Zeile 124 des Preflights ist nicht `0`** — eine Zeile hat
   `catalog_visible` NULL. Der Backfill würde sie still verstecken.
5. **Die NOTICE in Schritt 2 nennt einen Entwurf.**
6. **`N + M` aus der NOTICE trifft die Katalogzeilen nicht.**
7. **Nachkontrolle 111, 113, 131 oder 132 weicht ab.**
8. **Der Lauf dauert ungewöhnlich lange.** `0152` schreibt jede Katalogzeile
   einmal (rund 820) und ist in Sekunden durch. Minuten heißen: etwas wartet
   auf ein Schloss — dann nicht abbrechen, sondern nachsehen, wer schreibt.

**Und eine Bedingung, die vor allem anderen gilt:** läuft `npm run check`
nicht durch, wird gar nicht angefangen.

---

## 8. Was dieser Lauf NICHT beweist

P60 fährt siebzehn Fälle an echtem PostgreSQL — aber an **erfundenen Zeilen**
in einem Stub-Schema. Über die echten Bestände, über Laufzeitfehler an echten
Daten und über die fachliche Richtigkeit einer Prüfung sagt er nichts. Und das
Stub-Schema hat **drei nachgewiesene Grenzen**, die in P60 je einen Fehlalarm
erzeugt haben:

| Grenze | Fehlalarm, den sie erzeugte |
|---|---|
| es ignoriert `drop function` | die Siebenparameterfassung von `admin_create_figure` stand noch → `42725` |
| es trägt **keine Trigger** | das Journal blieb leer, obwohl der Rumpf richtig war |
| es setzt **keine Schlüssel** | `on conflict (sky_id)` des Katalogimports scheiterte mit `42P10` |

Alle drei sind Befunde über das **Werkzeug**, keiner über `0152`. Sie stehen
hier, weil ein Laufzettel, der nur die Erfolge nennt, kein Laufzettel ist.

**Nachweis bleibt allein das Ergebnisblatt aus dem SQL-Editor.**
