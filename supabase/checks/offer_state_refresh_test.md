# Testplan: wird **SKY-0009 (Blue Bash)** gemeldet — und SKY-0020 zu Recht nicht?

**Zweck.** Den Fix aus `487270f`/`f9d6060` auf Staging nachweisen. Der Test
hat **zwei** Figuren, und das ist seine Stärke: eine, die melden **muss**,
und eine, die **nicht** melden darf. Beides zusammen beweist mehr als jede
der beiden allein.

| | SKY-0009 · Blue Bash | SKY-0020 · Cynder |
|---|---|---|
| Lagerposition | **neu**, angelegt 2026-10-26 11:53:24 durch das Einbuchen | besteht seit **2026-09-18**, bis zum Einbuchen **nie** geändert |
| Menge | 0 → 1 | 5 → 6 |
| Bewegungen | eine: `+1 purchase` (die erste überhaupt) | eine: `+1 purchase` (die erste überhaupt; die 5 kamen aus dem Altbestandsimport, der kein Journal schreibt) |
| vor dem Einbuchen kaufbar? | **nein** — es gab kein Angebot | **ja** — gelistet, bepreist, verfügbar, durchgehend seit 2026-09-18 |
| bei der Erstbefüllung von `0146` im Spiegel? | **nein** — kein Eintrag | **ja**, und damit `announced_*` **gesetzt** |
| neue Verfügbarkeitsphase? | **ja** | **nein** — sie war nie weg |
| Meldung erwartet? | **JA** | **NEIN, und das ist richtig** |

> **Korrektur zu meinem ersten Bericht.** Dort stand, SKY-0020 sei vor dem
> Einbuchen nicht kaufbar gewesen. Das war eine Folgerung aus „niemand
> frischt auf" und **falsch** — das Bewegungsjournal und `shop_inventory`
> waren für den Prüfzugang die ganze Zeit lesbar und sagen das Gegenteil. Ein
> Test auf SKY-0020 wäre fehlgeschlagen und hätte wie ein kaputter Fix
> ausgesehen. Die Nachfrage nach Blue Bash hat das gefunden.

---

## Die Terminalbefehle

```bash
# Rein lesend, mit dem eingeschraenkten Pruefzugang. Sagt NICHT viel:
# fuenfzehn Zeilen melden KEIN-RECHT, weil der Zugang offer_state,
# favorites und availability_notifications nicht lesen darf. Gut als
# Lebenszeichen und um zu sehen, dass die Datei fehlerfrei laeuft.
npm run db:check:staging -- offer_state_freshness

# Die Antworten gibt es nur als `postgres` im SQL-Editor des Staging-
# Projekts qqxcpesbwfxzgytkdsac. Dort die Abfragen aus diesem Plan einfuegen.

# Die Oberflaeche, lokal gegen die Staging-Datenbank:
npm run dev:staging
```

**Der Prüfzugang kann diesen Test nicht fahren, und das ist Absicht.** Er darf
den Spiegel, die Favoriten und die Meldungen nicht lesen (`0146`, `0145`,
`0148`). Alles Aussagekräftige läuft im SQL-Editor als `postgres`.

---

## Schritt 0a — DIE VORBEDINGUNG: wann wurde Blue Bash vorgemerkt?

**Das muss als Erstes geklärt sein**, denn davon hängt ab, ob der Test
überhaupt etwas beweist. Ich kann es nicht messen — `favorites` ist dem
Prüfzugang entzogen. Im SQL-Editor als `postgres`:

```sql
select
  p.username,
  v.sky_id,
  v.created_at                                   as vorgemerkt_am,
  m.created_at                                   as eingebucht_am,
  (v.created_at < m.created_at)                  as vor_der_einbuchung
from public.favorites v
join public.profiles p on p.id = v.user_id
cross join lateral (
  -- Der Zeitpunkt der Einbuchung, aus dem Bewegungsjournal.
  select max(mv.created_at) as created_at
    from public.inventory_movements mv
    join public.shop_inventory si on si.id = mv.inventory_id
   where si.sky_id = v.sky_id
) m
where v.sky_id in ('SKY-0009', 'SKY-0020')
order by v.sky_id, v.created_at;
```

**Erwartet für den vollen Beweis:**

| Spalte | Wert |
|---|---|
| `username` | enthält **`apptester`** für `SKY-0009` |
| `eingebucht_am` | `2026-10-26 11:53:24` (SKY-0009) bzw. `11:53:25` (SKY-0020) |
| **`vor_der_einbuchung`** | **`true`** für `apptester` / `SKY-0009` |

* **`true`** → der Test beweist die Regel „nur wer vorher vorgemerkt hat".
  Weiter mit Schritt 0b.
* **`false`** → `apptester` hat Blue Bash erst **nach** dem Einbuchen
  vorgemerkt. Die Meldung kommt trotzdem (siehe „Die Rest-Unschärfe" unten),
  aber sie beweist dann nur, dass die Kette läuft — nicht die Regel. Das ist
  kein Fehler, nur ein schwächerer Test.
* **keine Zeile für `SKY-0009`** → niemand hat Blue Bash vorgemerkt. Dann
  zuerst im Browser als `apptester` das Herz setzen; der Test prüft dann die
  Kette, nicht die Regel.

---

## Schritt 0b — Ausgangslage, beide Figuren nebeneinander (lesend)

Im SQL-Editor des Staging-Projekts `qqxcpesbwfxzgytkdsac`, als `postgres`.
**Eine Abfrage, die alle Fragen auf einmal beantwortet:**

```sql
select
  k.sky_id,
  k.name,
  -- Lager: seit wann gibt es die Position, und wie viel liegt da?
  i.id                                              as lagerposition,
  i.created_at                                      as position_seit,
  i.quantity, i.reserved, i.is_listed,
  -- Shop: ist sie JETZT kaufbar?
  (l.sky_id is not null)                            as live_kaufbar,
  l.cheapest_cents                                  as live_cent,
  -- Spiegel: kennt er sie, seit wann läuft die Phase, ist sie gemeldet?
  (s.sky_id is not null)                            as im_spiegel,
  s.buyable, s.cheapest_cents, s.changed_at, s.checked_at,
  s.buyable_since, s.announced_buyable, s.announced_at,
  -- Favoriten: wie viele, und wie viele VOR dem Phasenbeginn?
  (select count(*) from public.favorites v where v.sky_id = k.sky_id)
                                                    as vorgemerkt,
  (select count(*) from public.favorites v
    where v.sky_id = k.sky_id
      and s.buyable_since is not null
      and v.created_at < s.buyable_since)           as davon_vor_der_phase,
  (select min(v.created_at) from public.favorites v where v.sky_id = k.sky_id)
                                                    as erster_favorit,
  -- Meldungen
  (select count(*) from public.availability_notifications n
    where n.sky_id = k.sky_id)                      as meldungen,
  -- Ist sie fällig?
  (select count(*) from public.offer_availability_due() d
    where d.sky_id = k.sky_id)                      as faellig
from public.skylanders k
left join public.shop_inventory i on i.sky_id = k.sky_id
     and i.condition = public.v1_sale_condition()
left join public.offer_state_live l on l.sky_id = k.sky_id
left join public.offer_state s on s.sky_id = k.sky_id
where k.sky_id in ('SKY-0009', 'SKY-0020')
order by k.sky_id;
```

**Erwartet — vor dem ersten Nachziehen:**

| Spalte | SKY-0009 | SKY-0020 |
|---|---|---|
| `position_seit` | **2026-10-26** | **2026-09-18** |
| `quantity` | `1` | `6` |
| `live_kaufbar` / `live_cent` | `true` / `2159` | `true` / `719` |
| **`im_spiegel`** | **`false`** | **`true`** |
| `buyable_since` | `NULL` (keine Zeile) | ein Zeitstempel vom **2026-10-25** |
| **`announced_at`** | `NULL` (keine Zeile) | ein Zeitstempel vom **2026-10-25** |
| `vorgemerkt` | `≥ 1` | `≥ 1` |
| `davon_vor_der_phase` | `0` (es gibt keine Phase) | **`0`** — die Phase begann **vor** dem Vormerken |
| `meldungen` | `0` | `0` |
| `faellig` | `0` | `0` |

**Das ist die ganze Erklärung, in zwei Zeilen Ausgabe:**

* **SKY-0020 ist im Spiegel und gemeldet.** `announced_at` liegt auf dem
  2026-10-25, `buyable_since` ebenfalls, und `buyable_since > announced_at`
  ist damit falsch — sie ist nach `offer_availability_due()` **nicht fällig**
  und wird es auch nach jedem Nachziehen nicht. Richtig so: sie war nie weg.
* **SKY-0009 steht überhaupt nicht im Spiegel.** Darum ist sie die Abweichung
  aus Zeile 212/213 der Frischeprüfung, und darum ist sie der Prüffall.

> **FALLS SCHRITT 1 SCHON PASSIERT IST.** Zeigt Schritt 0b für SKY-0009 bereits
> `im_spiegel = true` mit einem `buyable_since` von **heute**, hat jemand
> `/favoriten` mit dem korrigierten Code schon geöffnet — dann ist der Fix an
> dieser Stelle **bereits bewiesen**, und es geht direkt weiter:
>
> * `buyable_since` jünger als 30 Minuten → Schritt 2 (warten).
> * `buyable_since` älter als 30 Minuten und `faellig = 1` → **Schritt 3
>   sofort**: der nächste `/favoriten`-Aufruf legt die Meldung an.
> * `buyable_since` älter als 30 Minuten, `faellig = 0` und `announced_at`
>   gesetzt → die Meldung ist schon entstanden; `meldungen` sollte `1` sein.
>
> Schritt 1 dann **nicht** wiederholen wollen: `buyable_since` lässt sich
> nicht zurückdrehen, ohne `offer_state` von Hand zu ändern — und das soll
> nicht sein.

---

## Schritt 1 — Den Spiegel nachziehen lassen

**Im Browser, angemeldet als `apptester`:** `/favoriten` öffnen. Das ist der
ganze Schritt — er ruft `refreshOfferState()` auf, den Aufrufer, der gefehlt
hat.

**Erwartet auf dem Bildschirm:** die Wunschliste wie immer, **kein**
Meldungsabschnitt. Richtig — die Karenzzeit beginnt jetzt erst.

**Erwartet im Serverprotokoll** (`npm run dev:staging` bzw. Vercel): **keine**
Zeile `offer state refresh: …`. Erscheint eine, ist der Aufruf abgewiesen
worden, und dann ist der Code das Thema und nicht die Karenzzeit.

### Schritt 1b — nachmessen: dieselbe Abfrage aus Schritt 0b

| Spalte | SKY-0009 | SKY-0020 |
|---|---|---|
| `checked_at` | **jetzt** | **jetzt** |
| **`im_spiegel`** | **`true`** ← neu | `true` |
| **`buyable_since`** | **jetzt** ← die Phase beginnt | **unverändert 2026-10-25** ← nicht angefasst |
| `changed_at` | jetzt | **unverändert** — nichts hat sich geändert |
| `announced_at` | `NULL` | unverändert 2026-10-25 |
| `davon_vor_der_phase` | **`≥ 1`** | `0` |
| `faellig` | `0` — die Karenzzeit läuft | `0` — und bleibt `0` |

**Hier ist der Fix bewiesen:** `im_spiegel` ist für SKY-0009 von `false` auf
`true` gesprungen und `buyable_since` trägt einen Zeitstempel. Dass
SKY-0020s `buyable_since` und `changed_at` dabei **unberührt** bleiben, ist
die Gegenkontrolle: das Nachziehen erfindet keine Phase.

Zur Sicherheit auch die Frischeprüfung (`offer_state_freshness.sql`):
Zeile **111 `true`**, **211/212 `0`**, **213 `(keine)`**, **303 `≥ 1`**.

---

## Schritt 2 — Dreißig Minuten warten

`offer_availability_grace()` = `reservation_ttl() + 10 Minuten` = **30
Minuten**. Zeile 501 der Frischeprüfung nennt den geltenden Wert; verlassen
Sie sich darauf und nicht auf diesen Text.

**In der Zwischenzeit SKY-0009 nicht anfassen** — nicht entlisten, nicht
verkaufen. Eine echte Abwesenheit von mehr als 20 Minuten
(`reservation_ttl()`) startet die Phase neu, und die Uhr beginnt von vorn.

`/favoriten` zwischendurch zu öffnen ist unbedenklich: das Nachziehen ist
gedrosselt, und ohne fälliges Ereignis beansprucht der Aufruf nichts.

---

## Schritt 3 — Die Meldung abholen

**Im Browser als `apptester`:** `/favoriten` öffnen.

**Erwartet:**

1. Der Abschnitt **„Wieder verfügbar"** steht über dem Raster.
2. **Genau eine** Karte: **„Blue Bash ist wieder verfügbar!"**, „Gemeldet am
   …", **„21,59 € bei der Meldung"**, dazu „Zum Angebot" und „Gesehen".
3. **Keine Karte für Cynder.** Das ist der halbe Beweis.
4. Am Menüpunkt **Favoriten** eine **korallfarbene 1**.
5. **Mehrfach neu laden: die Karte bleibt ungelesen.** Wird sie von selbst
   still, ist das ein Fehler — das Anzeigen darf nichts markieren.
6. „Gesehen" drücken: die Karte wird ruhiger, bleibt stehen, die Marke
   verschwindet.

### Schritt 3b — nachmessen

Dieselbe Abfrage aus Schritt 0b, plus:

```sql
-- Erwartet: GENAU EINE Zeile, und zwar SKY-0009.
select n.sky_id, n.buyable_since, n.cheapest_cents, n.created_at, n.read_at
  from public.availability_notifications n
 order by n.created_at desc;

-- Erwartet: 0. Das Ereignis ist verbraucht, ein zweiter Aufruf legt nichts an.
select public.claim_availability_notifications();
```

| Spalte | SKY-0009 | SKY-0020 |
|---|---|---|
| `announced_at` | **jetzt** ← beansprucht | unverändert 2026-10-25 |
| `faellig` | `0` | `0` |
| **`meldungen`** | **`1`** | **`0`** |

---

## Schritt 4 — Zähler, Gelesen-Markierung, wiederholte Aufrufe, Duplikate

Vier Zusagen, vier Handgriffe. **Alle im Browser als `apptester`**, die
Gegenproben im SQL-Editor.

### 4.1 Der Ungelesen-Zähler

Nach Schritt 3 steht am Menüpunkt **Favoriten** eine **korallfarbene 1** —
nicht rot. Rot heißt in dieser Leiste „etwas ist kaputt"; dies ist das
Gegenteil.

**Auch im Katalog.** Auf `/` (ausgeloggt gibt es keine Marke, angemeldet als
`apptester` schon) muss dieselbe `1` stehen — dort ist ein Sammler die meiste
Zeit.

```sql
-- Erwartet: 1
select count(*) from public.availability_notifications where read_at is null;
```

### 4.2 Wiederholte Seitenaufrufe markieren nichts

`/favoriten` **fünfmal** neu laden (⌘R). Nach jedem Mal:

* Die Karte bleibt **ungelesen** — Korallrand, Knopf „Gesehen" da.
* Die Marke bleibt **1**.

```sql
-- Erwartet nach fuenf Aufrufen: weiterhin 1, und read_at weiterhin NULL.
select sky_id, read_at from public.availability_notifications;
```

> **Das ist die Zusage, deren Bruch unbemerkt bliebe.** Wird die Karte beim
> Laden von selbst still, ist sie weg, bevor jemand sie gelesen hat — und die
> Seite sieht genauso aus. Lokal halten das zwölf DOM-Prüfungen fest
> (`availability-notices.test.tsx`, darunter „DAS RENDERN MARKIERT NICHTS"
> und „der Klick auf den Weg zum Angebot markiert auch nichts"); hier wird es
> an der echten Datenbank nachgesehen.

### 4.3 Keine Duplikate

```sql
-- Erwartet: 0. Das Ereignis ist beansprucht, ein zweiter Lauf legt nichts an.
select public.claim_availability_notifications();

-- Erwartet: genau EINE Zeile. Der Primaerschluessel
-- (user_id, sky_id, buyable_since) ist der Duplikatschutz (ADR-0143).
select user_id, sky_id, buyable_since, count(*)
  from public.availability_notifications
 group by 1, 2, 3
having count(*) > 1;
-- Erwartet: keine Zeile.
```

Und `/favoriten` noch zweimal laden: es bleibt bei **einer** Karte.

### 4.4 Als gelesen markieren

An der Karte **„Gesehen"** drücken.

* Die Karte **bleibt stehen**, wird aber ruhiger: kein Korallrand, gedämpfte
  Schrift, statt des Knopfs ein Häkchen.
* Die Marke am Menüpunkt **verschwindet**.
* Der Weg „Zum Angebot" bleibt erreichbar.

```sql
-- Erwartet: ein Zeitstempel von jetzt.
select sky_id, read_at from public.availability_notifications;

-- Erwartet: 0
select count(*) from public.availability_notifications where read_at is null;
```

**Dann noch zweimal drücken ist nicht möglich** (der Knopf ist fort). Die
Gegenprobe, dass ein zweiter Lauf den Lesezeitpunkt nicht verschiebt, läuft
lokal in **P57** an echtem PostgreSQL — und `mark_availability_notifications_
read()` trägt `read_at is null` in ihrem `where`, damit genau das nicht
passieren kann.

### 4.5 Und Cynder bleibt stumm

Über alle Schritte hinweg:

```sql
-- Erwartet: keine Zeile, zu jedem Zeitpunkt.
select * from public.availability_notifications where sky_id = 'SKY-0020';
```

---

## Wenn es schiefgeht — wo nachsehen

| Beobachtung | Erste Frage |
|---|---|
| Nach Schritt 1 ist `checked_at` unverändert | Steht im Serverprotokoll `offer state refresh: 42501 …`? Dann fehlt `authenticated` das `execute`. Steht nichts, war der Aufruf gedrosselt: eine Minute warten und `/favoriten` neu laden |
| SKY-0009 bleibt `im_spiegel = false` | `live_kaufbar` ansehen. `false` heißt: `is_listed`, Preis oder `quantity - reserved > 0` stimmt nicht — dann ist das Lager das Thema, nicht die Meldung |
| `davon_vor_der_phase` ist `0` für SKY-0009 | `erster_favorit` gegen `buyable_since` vergleichen. Liegt der Favorit **danach**, hat `apptester` sie erst nach dem Nachziehen vorgemerkt — dann ist **keine** Meldung richtig |
| Nach Schritt 3 keine Karte, aber `meldungen = 1` | Die Meldung gehört einem anderen Konto. `select user_id from availability_notifications` gegen die Kennung von `apptester` halten |
| Nach Schritt 3 keine Karte und `meldungen = 0`, obwohl `faellig` vorher `≥ 1` war | Der Anspruch ist nicht gelaufen: Protokoll auf `availability claim: …` ansehen |
| Eine Karte für **Cynder** erscheint | **Das wäre ein echter Befund.** Dann hat etwas `announced_at` oder `buyable_since` von SKY-0020 verändert. Schritt 0b erneut fahren und beide Werte mit dem 2026-10-25 vergleichen |

---

## Was dieser Plan verändert — und was nicht

**Verändert:** `offer_state` (nachgezogen), `offer_state.announced_*` für
SKY-0009, eine Zeile in `availability_notifications`, deren `read_at` nach
Schritt 3.6.

**Nicht verändert:** kein Einkauf, keine Bestellung, keine Lagerzahl, kein
Preis, keine Favoritenzeile, kein Konto — und **nichts an SKY-0020**. Der
Plan fordert **keine** schreibende SQL-Anweisung; alles Schreibende löst die
Anwendung selbst aus, so wie ein Besucher es täte.

**Wiederholen** (nur falls nötig, nur auf Staging, nur diese Figur):

```sql
begin;
delete from public.availability_notifications where sky_id = 'SKY-0009';
update public.offer_state
   set announced_buyable = null, announced_cents = null, announced_at = null
 where sky_id = 'SKY-0009';
commit;
```

Danach erzeugt der nächste `/favoriten`-Aufruf die Meldung erneut — die Phase
läuft weiter, die Karenzzeit ist schon abgelaufen.

---

## Die Rest-Unschärfe — unverändert, und sie betrifft Schritt 1

`buyable_since` heißt „seit wir es bemerkt haben", nicht „seit es kaufbar
ist". Für SKY-0009 heißt das: die Phase beginnt heute beim Nachziehen,
obwohl die Figur seit dem 2026-10-26 11:53 im Shop kaufbar ist. Wer sie in
diesem Fenster vorgemerkt hat, bekommt trotzdem eine Meldung — unnötig, nicht
falsch.

Das Fenster ist so groß wie die Veraltung des Spiegels und schrumpft mit dem
Fix von „unbegrenzt" auf „bis zum nächsten `/favoriten`-Aufruf". Ganz zu
schließen bräuchte den Katalog-Aufruf (Fenster = eine Minute) oder einen
Scheduler (Fenster = null); beides ist eine Entscheidung des Betreibers
(ADR-0145).
