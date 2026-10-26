# Testplan: wird SKY-0020 (Cynder, Spyro's Adventure) gemeldet?

**Zweck.** Den Fix aus `487270f` auf Staging nachweisen: dass der
Angebotsspiegel nachgezogen wird, dass daraus ein Verfügbarkeitsereignis
entsteht, und dass `apptester` die Meldung bekommt.

**Was dieser Plan NICHT tut.** Er legt keinen Einkauf an, bucht nichts ein,
listet nichts um und ändert keine Lagerzahl. Der Zustand, der gebraucht wird,
**ist schon da**: SKY-0020 ist seit dem Testeinkauf vom 2026-10-26 live
kaufbar (gemessen: 7,19 €, `available = true`), und der Spiegel kennt sie
nicht. Genau dieser Zustand ist der Prüffall.

**Vorbedingung.** `apptester` hat SKY-0020 vorgemerkt — und zwar **vor** dem
Einbuchen. Schritt 0 prüft es, statt es anzunehmen.

---

## Schritt 0 — Ausgangslage messen (lesend, nichts ändern)

Im SQL-Editor des Staging-Projekts `qqxcpesbwfxzgytkdsac`, als `postgres`:

```sql
select set_config('skyisles.sky', 'SKY-0020', false);
```

Dann `supabase/checks/offer_state_freshness.sql` vollständig einfügen und
ausführen.

**Erwartet — und jede Zeile sagt etwas anderes:**

| Zeile | Erwartet | Bedeutung |
|---:|---|---|
| 101 | ein Zeitstempel vom **2026-10-25** | der Spiegel wurde seit der Erstbefüllung nicht nachgezogen |
| 102 | **über 24 Stunden** | dito, als Dauer |
| **111** | **`false`** → `9999 = 1` | **Das ist der Befund, und er ist hier erwünscht.** Vor dem Fix muss diese Zeile rot sein; wäre sie grün, hätte schon jemand nachgezogen und der Test wäre keiner |
| 201 / 202 | `226` / `225` | Wirklichkeit gegen Spiegel |
| 211 | **`≥ 1`** | so weit liegen sie auseinander |
| 212 | **`≥ 1`** | so viele Ereignisse sind stumm |
| 213 | enthält **`SKY-0020`** | **die entscheidende Zeile von Schritt 0** |
| 301 | `0` | nichts fällig — richtig, die Phase hat nie begonnen |
| 303 | `0` | und nichts in der Karenzzeit |
| 403 | `(keine Zeile im Spiegel)` **oder** `false` | sie gilt nicht als kaufbar |
| 404 | `(keine Zeile im Spiegel)` **oder** leer | **ihre Phase hat nicht begonnen** |
| 406 | `719` | sie IST live kaufbar, zu 7,19 € |
| 407 | `1 / 0` (oder mehr vorne) | vorgemerkt ja, vor Phasenbeginn nein — weil es keinen gibt |
| 408 | `0` | keine Meldung |

> **Hält Zeile 407 vorne eine `0`**, hat `apptester` SKY-0020 nicht
> vorgemerkt. Dann zuerst im Browser als `apptester` das Herz an
> SKY-0020 setzen und Schritt 0 wiederholen — sonst prüft der Test die
> falsche Figur.

> **WICHTIG FÜR DIE DEUTUNG DES ERGEBNISSES.** Wurde SKY-0020 **nach** dem
> Einbuchen vorgemerkt, kommt die Meldung **trotzdem** — und dann beweist der
> Test weniger, als er aussieht. Grund: `buyable_since` wird beim ersten
> Nachziehen gesetzt, also *nach* dem Vormerken, und damit gilt
> `favorites.created_at < buyable_since`. Die Regel „bereits verfügbare
> Figuren erzeugen beim Vormerken keine Meldung" greift in diesem Fenster
> nicht. Siehe „Die Rest-Unschärfe" am Ende.
>
> Der Test ist nur dann ein voller Beweis, wenn das Vormerken **vor** dem
> Einbuchen lag. Schritt 0 kann das nicht unterscheiden — `favorites.created_at`
> gegen den Zeitpunkt des Einbuchens vergleicht diese Abfrage:
>
> ```sql
> select v.created_at                     as vorgemerkt,
>        m.created_at                     as eingebucht,
>        (v.created_at < m.created_at)    as reihenfolge_stimmt
>   from public.favorites v
>   left join public.purchase_items pi on pi.sky_id = v.sky_id
>   left join public.inventory_movements m on m.id = pi.movement_id
>  where v.sky_id = 'SKY-0020'
>  order by m.created_at desc nulls last;
> ```

---

## Schritt 1 — Den Spiegel nachziehen lassen

**Im Browser, angemeldet als `apptester`:** `/favoriten` öffnen.

Das ist der ganze Schritt. Er ruft `refreshOfferState()` auf, und das ist der
Aufrufer, der gefehlt hat.

**Erwartet auf dem Bildschirm:** die Wunschliste wie immer, **kein**
Meldungsabschnitt. Das ist richtig — die Karenzzeit beginnt jetzt erst.

**Erwartet im Serverprotokoll** (`npm run dev:staging` bzw. Vercel):
**keine** Zeile `offer state refresh: …`. Erscheint eine, ist der Aufruf
abgewiesen worden, und dann ist der Code und nicht die Karenzzeit das Thema.

### Schritt 1b — nachmessen (lesend)

`offer_state_freshness.sql` erneut:

| Zeile | Erwartet | Bedeutung |
|---:|---|---|
| 101 / 102 | **jetzt**, wenige Sekunden her | **der Beweis, dass der Fix greift** |
| **111** | **`true`** → `9999 = 0` | der Spiegel ist frisch |
| 211 / 212 | **`0`** / **`0`** | Spiegel und Wirklichkeit sind deckungsgleich |
| 213 | `(keine)` | kein stummes Ereignis mehr |
| 403 | **`true`** | sie gilt jetzt als kaufbar |
| 404 | **ein Zeitstempel von jetzt** | **ihre Phase hat begonnen** |
| 405 | `(nie)` | noch nicht gemeldet |
| 301 | `0` | **noch** nicht fällig — die Karenzzeit läuft |
| **303** | **`≥ 1`** | **sie steht in der Karenzzeit.** Diese Zeile unterscheidet „läuft" von „passiert nichts" |
| 407 | `1 / 1` | vorgemerkt, und **vor** dem Phasenbeginn |
| 408 | `0` | noch keine Meldung |

Steht in 404 ein Zeitstempel und in 303 eine `1`, **ist der Fix bewiesen.**
Alles Weitere ist nur noch Warten.

---

## Schritt 2 — Dreißig Minuten warten

`offer_availability_grace()` ist `reservation_ttl() + 10 Minuten` = **30
Minuten**. Zeile 501 nennt den geltenden Wert; verlassen Sie sich darauf und
nicht auf diesen Text.

**In der Zwischenzeit nichts tun.** Insbesondere die Lagerposition von
SKY-0020 nicht entlisten und nicht verkaufen: eine echte Abwesenheit von mehr
als 20 Minuten (`reservation_ttl()`) startet die Phase neu, und die Uhr
beginnt von vorn.

`/favoriten` zwischendurch zu öffnen ist unbedenklich — das Nachziehen ist
gedrosselt, und ohne fälliges Ereignis beansprucht der Aufruf nichts.

---

## Schritt 3 — Die Meldung abholen

**Im Browser als `apptester`:** `/favoriten` öffnen.

**Erwartet:**

1. Der Abschnitt **„Wieder verfügbar"** steht über dem Raster.
2. Darin eine Karte: Bild, **„Cynder ist wieder verfügbar!"**, „Gemeldet am
   …", **„7,19 € bei der Meldung"**, und die Wege „Zum Angebot" und
   „Gesehen".
3. Am Menüpunkt **Favoriten** eine **korallfarbene 1**.
4. **Mehrfach neu laden: die Karte bleibt ungelesen.** Wird sie von selbst
   still, ist das ein Fehler — das Anzeigen darf nichts markieren.
5. „Gesehen" drücken: die Karte wird ruhiger, bleibt stehen, und die Marke
   verschwindet.

### Schritt 3b — nachmessen (lesend)

| Zeile | Erwartet | Bedeutung |
|---:|---|---|
| 405 | **ein Zeitstempel** | das Ereignis ist beansprucht |
| 301 | `0` | und damit nicht mehr fällig — kein zweites Mal |
| **408** | **`1`** | **genau eine** Meldung, nicht zwei |
| 311 | `1` | eine Meldung insgesamt |
| 312 | `1` vor dem Klick, `0` danach | der Ungelesen-Zähler |

Die Gegenprobe gegen Duplikate, direkt:

```sql
-- Erwartet: 0. Ein zweiter Aufruf beansprucht nichts.
select public.claim_availability_notifications();

-- Erwartet: genau eine Zeile, und sie gehoert apptester.
select sky_id, buyable_since, cheapest_cents, created_at, read_at
  from public.availability_notifications
 where sky_id = 'SKY-0020';
```

---

## Wenn es schiefgeht — wo nachsehen

| Beobachtung | Erste Frage |
|---|---|
| Nach Schritt 1 ist Zeile 101 unverändert | Steht im Serverprotokoll `offer state refresh: 42501 …`? Dann fehlt `authenticated` das `execute` — `npm run db:privileges:staging` und `0146` prüfen. Steht `throttled`, war jemand in derselben Minute schon da: eine Minute warten und wiederholen |
| 404 bleibt leer, obwohl 101 frisch ist | 406 ansehen: ist sie überhaupt live kaufbar? `is_listed`, `sale_price`, `available_quantity > 0`, `condition = 'loose'` |
| 303 ist `0`, obwohl 404 einen Zeitstempel hat | 405 ansehen: ist die Phase schon gemeldet? Dann war sie bereits kaufbar, als sie vorgemerkt wurde — dann ist **keine** Meldung richtig |
| Nach Schritt 3 keine Karte, aber 408 ist `1` | Die Meldung existiert und gehört einem anderen Konto. 407 ansehen: wer hatte **vor** dem Phasenbeginn vorgemerkt? |
| Nach Schritt 3 keine Karte, 408 ist `0`, 301 war `≥ 1` | Der Anspruch ist nicht gelaufen: Serverprotokoll auf `availability claim: …` ansehen |

---

## Was dieser Plan verändert — und was nicht

**Verändert:** `offer_state` (nachgezogen), `offer_state.announced_*` für
SKY-0020 (beansprucht), eine Zeile in `availability_notifications`, und deren
`read_at` nach Schritt 3.5. Alles davon ist Zustand, den das Feature selbst
erzeugen soll.

**Nicht verändert:** kein Einkauf, keine Bestellung, keine Lagerzahl, kein
Preis, keine Favoritenzeile, kein Nutzerkonto. Der Plan fordert **keine**
schreibende SQL-Anweisung; alles Schreibende geschieht durch die Anwendung
selbst, so wie ein Besucher es auslöst.

**Rücknahme, falls gewünscht** — nur falls der Test wiederholt werden soll:

```sql
-- Macht aus dem Test einen ungetesteten Zustand. NUR auf Staging, und nur
-- fuer diese eine Figur.
begin;
delete from public.availability_notifications where sky_id = 'SKY-0020';
update public.offer_state
   set announced_buyable = null, announced_cents = null, announced_at = null
 where sky_id = 'SKY-0020';
commit;
```

Danach erzeugt der nächste Aufruf von `/favoriten` die Meldung erneut — die
Phase läuft weiter, die Karenzzeit ist schon abgelaufen.


---

## Die Rest-Unschärfe — und sie ist keine Folge des Fixes allein

`buyable_since` heißt „seit wir es bemerkt haben", nicht „seit es kaufbar
ist". Daraus folgt ein Fenster, in dem die Regel *„bereits verfügbare Figuren
erzeugen beim erstmaligen Vormerken keine Meldung"* **nicht** greift:

```
10:00  eingebucht            → im Shop sofort kaufbar, Spiegel weiß es nicht
10:10  jemand merkt sie vor  → sie SIEHT die Figur als kaufbar
10:20  jemand öffnet /favoriten → buyable_since = 10:20  (> 10:10)
10:50  Meldung „wieder verfügbar"  ← für etwas, das beim Vormerken schon da war
```

**Die Meldung ist nicht falsch** — die Figur ist kaufbar, und der Weg führt
auf ein echtes Angebot. Sie ist nur *unnötig*: der Nutzer wusste es schon.

**Das Fenster ist so groß wie die Veraltung des Spiegels.** Mit dem Fix
schrumpft es von „unbegrenzt" auf „bis zum nächsten Aufruf von
`/favoriten`". Es ganz zu schließen bräuchte eines von zwei Dingen, und
**beides ist eine Entscheidung des Betreibers, nicht meine:**

1. **Auch der Katalog frischt auf** (eine Zeile). Dann ist der Spiegel
   frisch, sobald irgendein angemeldeter Sammler den Katalog ansieht, und das
   Fenster schrumpft auf die eine Minute der Drosselung. Preis: ein
   gedrosselter Schreibaufruf auf der häufigsten Seite.
2. **Ein Scheduler.** Dann heißt `buyable_since` wieder „seit es kaufbar
   ist", und das Fenster verschwindet. Preis: Infrastruktur, die ADR-0136
   ohne konkreten Bedarf nicht vorgesehen hat.

Variante 1 ist die kleinere und behebt zugleich das „zwei Besuche"-Verhalten
aus ADR-0145. Ich habe sie **nicht** eingebaut, weil sie eine Schreiboperation
auf eine Seite legt, die auch ausgeloggt und sehr häufig aufgerufen wird —
das gehört entschieden und nicht nebenbei gemacht.
