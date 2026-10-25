# Benachrichtigungen zu Favoriten — technischer Plan

**Stand 2026-10-25. Nichts davon ist gebaut.** Diese Datei beschreibt, *wie*
es gebaut würde, und sie ist die Vorbereitung, um die der Auftrag gebeten hat
— keine Freigabe und keine Migration. `favorites` steht (ADR-0136, `0145`);
hier geht es um das, was darauf aufsetzt.

---

## 0. Die drei Befunde, aus denen der Plan folgt

Bevor irgendein Entwurf: drei Eigenschaften dieses Systems entscheiden alles
Weitere, und zwei davon sind unbequem.

### 0.1 Es gibt keinen Scheduler

Kein `pg_cron`, kein `pg_net`, kein Realtime, keinen Hintergrundjob, keine
vierte Edge Function neben `create-payment`, `stripe-webhook`,
`refund-payment` und `send-order-mail`. Wo aufgeräumt werden muss, geschieht
es **lazy in der Transaktion**: `release_expired_reservations(v_ids)` wird
*innerhalb* der Reservierungsfunktion gerufen.

> **Folge:** Eine Benachrichtigung entsteht **synchron in der Transaktion,
> die ein Angebot veröffentlicht** — nicht in einem Sweep, der alle fünf
> Minuten nachsieht. Das ist nicht nur die einzige verfügbare Bauform, es
> ist auch die bessere: deterministisch, in derselben Transaktion
> zurückrollbar, und ohne ein zweites System, das ausfallen kann.

### 0.2 „Kaufbar" ist ein Verbund aus fünf Bedingungen, und eine davon flattert

`shop_offers()` (`0029`):

```sql
where i.is_listed
  and i.condition = public.v1_sale_condition()
  and public.is_shop_eligible(i.sky_id)      -- aktiv ∧ catalog_visible
                                             -- ∧ item_type='figure' ∧ Kategorie
  and public.shop_price(…) is not null
returns … (i.available_quantity > 0) as available
```

**`available_quantity` ist eine generierte Spalte: `quantity - reserved`.**
Ein Warenkorb reserviert. Ein Letztexemplar geht damit auf `0` und nach
Ablauf der Reservierung zurück auf `1` — **ohne dass sich am Angebot
irgendetwas geändert hat**.

> **Folge:** Ein naiver Trigger auf „wurde verfügbar" meldet dasselbe Angebot
> bei jedem Warenkorb erneut. Das ist der Kern des Problems, nicht ein
> Randfall. Abschnitt 2 löst es.

### 0.3 In-App-Benachrichtigungen haben schon eine Mechanik

| Vorhanden | Was es ist |
|---|---|
| `AttentionBadge` + `Unread {mine, seller}` in `site-nav.tsx` | Zähler am Navigationspunkt, gespeist aus `(app)/layout.tsx` und `(business)/layout.tsx` |
| `order_mail (order_id, kind)` **PK** | Ein Anspruchs- und Dedup-Register: eine Zeile je Vorgang und Art, `claimed_at`/`sent_at` |
| `order_attention_reads (order_id, reader)` | Ein **Wasserstand** je Seite |

Der Wasserstand taugt hier **nicht**: er kann nicht sagen „dieses eine
Angebot wurde gemeldet". Das Dedup-Muster von `order_mail` dagegen ist genau
die richtige Form — ein Schlüssel, der den Vorgang benennt.

**E-Mail bleibt aus.** Es gibt keine Opt-in-Infrastruktur für
nicht-transaktionale Mail; `send-order-mail` ist ausschließlich an
Bestellungen gebunden. In-App zuerst, und nur das.

---

## 1. Das Datenmodell — zwei Tabellen, nicht fünf

### 1.1 `offer_state` — der Latch, und er ist der ganze Trick

```sql
create table public.offer_state (
  sky_id          text    primary key references public.skylanders (sky_id)
                            on update cascade on delete restrict,
  -- Ist diese Figur JETZT oeffentlich kaufbar? Der Verbund aus 0.2.
  buyable         boolean not null,
  -- Der guenstigste kaufbare Preis, oder null.
  cheapest_cents  integer,
  -- Wann sich `buyable` das letzte Mal WIRKLICH geaendert hat.
  changed_at      timestamptz not null default now(),
  -- Wann zuletzt eine Benachrichtigung aus dieser Zeile entstand.
  notified_at     timestamptz
);
```

**Eine Zeile je Figur, nicht je Ereignis.** Sie ist die Antwort auf „war das
schon so?" — und ohne sie gibt es keine Kante, nur einen Zustand.

Kein `seller_id`, keine sellerbezogene Struktur: der Zustand gehört der
**Figur**, so wie `shop_offers()` ihn für die Plattform beantwortet. Käme je
ein zweiter Verkäufer, ändert sich `shop_offers()` — und diese Tabelle bleibt
unverändert richtig. Das ist „mehrere Händler berücksichtigt" in der einzigen
Form, die ADR-0021 und `CLAUDE.md` zulassen.

### 1.2 `favorite_notifications` — der Posteingang

```sql
create table public.favorite_notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid    not null references auth.users (id) on delete cascade,
  sky_id      text    not null references public.skylanders (sky_id)
                        on update cascade on delete restrict,
  kind        text    not null check (kind in ('available', 'price_drop', 'target_price')),
  -- Der Preis, der die Meldung ausgeloest hat. Historie, kein Verweis.
  price_cents integer,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index favorite_notifications_inbox_idx
  on public.favorite_notifications (user_id, read_at, created_at desc);
```

`read_at` statt einer zweiten Tabelle: eine Benachrichtigung hat genau einen
Empfänger, also ist „gelesen" eine Eigenschaft der Zeile. Der Wasserstand aus
`order_attention_reads` existiert nur, weil dort **zwei Seiten** auf
denselben Vorgang schauen.

### 1.3 Einstellungen — die kleinste Form, die trägt

```sql
alter table public.profiles
  add column notify_available   boolean not null default true,
  add column notify_price_drop  boolean not null default false;
```

**Keine eigene Tabelle.** Es sind zwei Schalter je Konto, `profiles` gehört
dem Konto, und seine RLS steht seit `0001`. Eine Tabelle
`notification_settings` wäre eine zweite Stelle mit demselben Besitzer und
derselben Richtlinie.

Vorgabe: **neue Verfügbarkeit an, Preissenkung aus.** Das Erste ist, worum
jemand ein Herz anklickt; das Zweite ist eine Zugabe, und eine Zugabe
schaltet man ein, nicht ab.

### 1.4 Wunschpreis (C) — eine Spalte auf `favorites`

```sql
alter table public.favorites
  add column target_cents integer check (target_cents is null or target_cents > 0);
```

An `favorites` und nicht in einer eigenen Tabelle: es ist eine Eigenschaft
**dieses** Favoriten. Der Primärschlüssel `(user_id, sky_id)` bindet ihn
damit automatisch an die Variante — was Abschnitt 3.1 fordert, ohne eine
Zeile Code.

> **Achtung, und das ist eine echte Änderung:** `0145` gibt `authenticated`
> **kein** `update`-Recht auf `favorites`, weil es nichts zu ändern gab. Ein
> Wunschpreis ändert das. Dann braucht es eine `update`-Richtlinie mit
> `using` **und** `with check` — beide Hälften, sonst könnte jemand seine
> Zeile einem fremden Konto zuschieben. Das ist der Grund, warum C **zuletzt**
> kommt: es ist der einzige Teil, der eine Sicherheitsgrenze anfasst.

---

## 2. Die Deduplizierung — vier Riegel, und jeder fängt etwas anderes

Das Reservierungsflattern aus 0.2 ist mit **einem** Mechanismus nicht zu
erschlagen. Vier, von grob nach fein:

| # | Riegel | Fängt |
|---|---|---|
| 1 | **Kante statt Zustand.** Der Trigger meldet nur bei `buyable: false → true`. Bleibt `true`, passiert nichts | Preisänderungen, Nachlieferungen, jeden Schreibvorgang an einer bereits kaufbaren Zeile |
| 2 | **Karenz auf `changed_at`.** Eine Kante zählt erst, wenn die letzte mindestens *N* Minuten her ist. `N` = Reservierungsdauer + Zuschlag | Genau das Flattern: Warenkorb rein (`true→false`), Reservierung ab (`false→true`) — die zweite Kante liegt innerhalb der Karenz und löst nichts aus |
| 3 | **Karenz auf `notified_at`.** Je Figur höchstens eine Meldung pro Zeitfenster (Vorschlag: 24 h) | Eine Figur, die über Tage ein- und ausgeht, weil der Betrieb einzeln einbucht |
| 4 | **Partieller Unique-Index je Empfänger.** `unique (user_id, sky_id, kind) where read_at is null` | Zwei ungelesene Meldungen derselben Art für dieselbe Figur im Posteingang. Der Riegel ist die Datenbank, nicht die Anwendung — ein `on conflict do nothing` macht den Trigger damit idempotent |

**Riegel 2 ist der wichtige, und er ist ohne Vorbild im Projekt.** Er heißt:
eine Angebotslage gilt erst als *neu*, wenn sie eine Weile gehalten hat. Das
ist eine fachliche Entscheidung mit einer Zahl darin, und die Zahl gehört in
`shop_settings`, nicht in den Trigger — sonst ändert man sie per Migration.

### Was die Riegel NICHT leisten

Sie verhindern keine Meldung, die kurz nach dem Absenden wieder falsch wird:
Figur wird kaufbar, Meldung geht raus, eine Minute später kauft sie jemand.
**Das ist richtig so.** Die Meldung war wahr, als sie entstand, und sie sagt
„es gab ein Angebot", nicht „es gibt eines". Die Oberfläche muss das
aushalten — der Posteingang zeigt den Zeitpunkt, und die Karte daneben zeigt
die Gegenwart.

---

## 3. Die Regeln, die nicht verhandelbar sind

### 3.1 Immer die SKY-ID, niemals die Figur „ungefähr"

Favoriten hängen an `sky_id`. Eine Legendary ist eine andere SKY-ID als ihre
Basisfigur (ADR-0002, ADR-0034), also eine andere Benachrichtigung. Der
Trigger liest `favorites.sky_id = new.sky_id` und hat damit keine
Gelegenheit, über `character_id` zu verallgemeinern. **Keine Meldung für eine
andere Variante** ist hier keine Prüfung, sondern die Abwesenheit eines
Joins.

### 3.2 Nur `shop_offers()` entscheidet, was kaufbar ist

Der Trigger rechnet den Verbund aus 0.2 **nicht nach**. Er fragt dieselbe
Projektion, die der Shop, die Karte und die Schnellansicht fragen — sonst
gibt es zwei Definitionen von „kaufbar", und eine davon ist irgendwann die
falsche. Orderbuch-Einkäufe, Kalkulationen, Wareneingänge und
unveröffentlichte Lagerzeilen kommen in `shop_offers()` gar nicht vor; das
ist strukturell und braucht keine zusätzliche Bedingung.

### 3.3 RLS: der Posteingang ist privat, und `offer_state` ist es nicht

| Tabelle | Richtlinien |
|---|---|
| `favorite_notifications` | `select` und `update` (nur `read_at`) auf `auth.uid() = user_id` **und** `is_collector_account()` — das Muster von `favorites`. **Kein `insert` für `authenticated`**: Zeilen entstehen ausschließlich im Trigger, also als `definer`. Niemand soll sich selbst oder anderen eine Benachrichtigung schreiben können |
| `offer_state` | weltlesbar wie `skylanders`? **Nein** — kein Clientrecht. Sie enthält keine Personendaten, aber sie ist ein Betriebszustand, und die Oberfläche braucht sie nicht: Karten lesen `shop_offers()` |

Ein Trigger, der in `favorite_notifications` für *fremde* `user_id` schreibt,
ist genau der Fall, für den `security definer` da ist — und genau deshalb
darf `authenticated` dort kein `insert` haben.

### 3.4 Datenschutz: eine Benachrichtigung verrät nichts über andere

Sie trägt `user_id`, `sky_id`, `kind`, `price_cents`, Zeitstempel. Kein
Hinweis darauf, wie viele andere dieselbe Figur vorgemerkt haben — diese
Zahl bleibt dem Betrieb über `favorite_demand()` vorbehalten, und auch dort
nur aggregiert.

### 3.5 Sicherung

Beide Tabellen sind **persönliche Nutzerdaten** bzw. Betriebszustand und
müssen in beiden Vollständigkeitswächtern entschieden werden (ADR-0134) —
`favorite_notifications` gehört in die Plattformsicherung,
`offer_state` ist ableitbar und kann begründet draußen bleiben. Und:
`favorites` selbst steht dort noch mit Ablaufdatum draußen (ADR-0136); das
muss **vor** diesem Vorhaben erledigt sein, sonst wachsen zwei offene
Sicherungspunkte übereinander.

---

## 4. Die Reihenfolge — vier Schritte, jeder für sich lieferbar

### Schritt 1 · Der Latch, still (Migration, 1 Tabelle, 1 Trigger)

`offer_state` anlegen, aus `shop_offers()` initial füllen, und einen Trigger
auf `shop_inventory` hängen, der sie **nur pflegt** — ohne irgendetwas zu
melden. Dazu `offer_state_drift.sql` als lesende Prüfdatei: stimmt der Latch
mit `shop_offers()` überein?

**Warum zuerst und ohne Wirkung:** der Trigger sitzt an der Tabelle, an der
jeder Verkauf, jeder Wareneingang und jede Umpreisung vorbeigeht. Er soll
eine Woche mitlaufen und beobachtet werden, bevor er etwas auslöst. Ein
Fehler hier ist in Schritt 1 eine falsche Zeile in einer Hilfstabelle; in
Schritt 2 wäre er eine falsche Meldung an einen Nutzer.

### Schritt 2 · Fall A, neue Verfügbarkeit (Migration + Oberfläche)

`favorite_notifications`, die beiden `profiles`-Schalter, die vier
Dedup-Riegel, und die Erweiterung des Triggers auf das Schreiben. Dazu:
`Unread` in `site-nav.tsx` um ein drittes Feld, ein Posteingang unter
`/favoriten` (ein Abschnitt, keine eigene Seite — die Meldungen gehören zu
den Favoriten) und `markFavoriteNotificationsRead()`.

**Das ist die Lieferung, die Nutzen bringt.** Alles Weitere ist Komfort.

### Schritt 3 · Fall B, Preissenkung (Migration, klein)

`cheapest_cents` im Latch vergleichen, `kind = 'price_drop'`. Eigener
Schalter, Vorgabe **aus**. Eigene Karenz, weil eine Umpreisung um einen Cent
keine Nachricht ist — Vorschlag: eine Meldung erst ab einer Senkung um
*x* Prozent **oder** *y* Cent, je nachdem was größer ist, und auch das in
`shop_settings`.

### Schritt 4 · Fall C, Wunschpreis (Migration + Oberfläche + **Sicherheitsänderung**)

`favorites.target_cents`, die neue `update`-Richtlinie samt `update`-Recht,
ein Eingabefeld an der Karte auf `/favoriten`, `kind = 'target_price'`.

**Zuletzt, weil es der einzige Schritt ist, der eine Grenze verschiebt.**
Nach `0145` gibt es auf `favorites` kein `update` — das wieder zu öffnen
verlangt dieselbe Sorgfalt wie `collection_items` sie hat: `using` und
`with check`, und ein funktionaler RLS-Lauf mit zwei Konten, der beweist,
dass niemand seine Zeile umhängen kann.

---

## 5. Was dieser Plan ausdrücklich nicht vorschlägt

* **Keine E-Mail, kein Push.** Es gibt keine Opt-in-Infrastruktur dafür, und
  der Auftrag sagt In-App zuerst.
* **Kein Sweep, kein Cron, keine fünfte Edge Function.** Es gibt keinen
  Scheduler, und synchron im Trigger ist hier die bessere Bauform.
* **Keine Marketplace-Struktur.** Kein `seller_id`, kein Fan-out je
  Verkäufer, keine Angebotsüberwachung fremder Anbieter. Der Zustand gehört
  der Figur, und ADR-0021 bleibt unberührt.
* **Keine Realtime-Verbindung.** Der Badge wird beim Seitenaufbau gelesen,
  wie `Unread` seit `0098`. Ein offener Socket je Besucher ist ein zweites
  Betriebsmodell für einen Zähler.
* **Kein Verlauf je Preis.** `price_history` steht in `docs/DATABASE.md`
  Abschnitt 7 und ist ein eigenes Vorhaben; `cheapest_cents` im Latch ist
  genau so viel Gedächtnis, wie Fall B braucht.
