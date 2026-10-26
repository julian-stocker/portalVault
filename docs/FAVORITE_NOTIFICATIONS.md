# Benachrichtigungen zu Favoriten — technisches Konzept

> # ⚠ HISTORISCHE AKTE — nicht mehr fortgeschrieben
>
> **Überholt am 2026-10-26 durch ADR-0146 und ADR-0147.** Dieses Dokument
> beschreibt die Bauform aus `0146`–`0149`: einen **Angebotsspiegel** mit
> Verfügbarkeitsphasen je Figur, eine **30-Minuten-Karenzzeit** und
> **Favoriten als stehendes Abonnement**. Alle drei sind durch eine
> Betreiberentscheidung ersetzt:
>
> | hier beschrieben | gilt seit 2026-10-26 |
> |---|---|
> | `offer_state` samt `buyable_since` und `announced_*` | entfällt; `offer_state_live` bleibt |
> | Karenzzeit `reservation_ttl() + 10 min` = 30 min | **keine Karenzzeit** — Meldung beim ersten bestätigten kaufbaren Zustand |
> | `favorites` bestimmt die Empfänger | **`availability_alerts`** — eine Glocke je Figur, vom Herz vollständig unabhängig |
> | Meldung und Posteingang auf `/favoriten` | zentrales Center, Glocke in der Kopfzeile, `/benachrichtigungen` |
> | Preissenkungsmeldung (B) als zweite Art | gestrichen; später als eigene Alarmart denkbar |
>
> **Warum es stehen bleibt.** Es ist der Nachweis, *warum* so gebaut wurde,
> und mehrere Befunde darin gelten unverändert: die drei Preisquellen von
> `shop_price()` (Abschnitt 1.3), die Abwesenheit eines Schedulers (1.4), die
> drei Gründe gegen einen Trigger (1.6) und die Begründung, warum jeder
> Entwurf an `shop_offers()` ansetzen muss (1.7). Wer die neue Entscheidung
> verstehen will, braucht diese Abschnitte.
>
> **Was darin nicht mehr stimmt, und das ist ausdrücklich gesagt:** die
> Statustabelle gleich unten war schon am 2026-10-26 veraltet — sie führt S3
> als „nirgends angewendet" und S4 als „nicht gebaut", während `0148` und
> `0149` auf Staging liegen und die Oberfläche steht. Maßgeblich für den
> Anwendungsstand ist **`supabase/migrations/APPLIED.md`**, für die
> Entscheidungen **`docs/DECISIONS.md`** (ADR-0146, ADR-0147), für den
> aktuellen Zustand **`PROJECT_STATUS.md`**. Dieses Dokument wird **nicht**
> mehr berichtigt.

**Stand 2026-10-25, Phase 4. Nichts davon ist gebaut.** Dieses Dokument ist
die Planung, um die der Auftrag gebeten hat — keine Freigabe, keine
Migration, keine Oberfläche.

> ## Stand der Umsetzung (2026-10-25)
>
> | Schritt | Stand |
> |---|---|
> | **S1 · Der Spiegel** | **gebaut**, Migration `0146` — **auf Staging angewendet** am 2026-10-25, Nachkontrolle vollständig, 225 kaufbare SKY-IDs als Ausgangszustand |
> | **S2 · Die Verfügbarkeitskante** | **gebaut**, Migration `0147` — **auf Staging angewendet**. Erkennung und Entscheidung, **keine** Meldung |
> | **S3 · Meldungen je Leser** | **gebaut**, Migration `0148` — **nirgends angewendet**. Je Nutzer, Figur und Phase genau eine, RLS-geschützt |
> | S4 · Oberfläche, Ungelesen-Zähler, „als gelesen" | geplant, nicht gebaut — bringt `read_at` und den Aufruf mit |
> | S5–S6 · Einstellungen, Rollout | geplant, nicht gebaut |
> | Plattformsicherung | **offen**: `favorites`, `offer_state` **und** `availability_notifications` stehen mit Ablaufdatum draußen (ADR-0136, D-6) |
>
> **S2 hat eine Lücke im Datenmodell von `0146` aufgedeckt**, und sie ist mit
> **einer Spalte** behoben: `changed_at` bewegt sich auch bei einer
> Preisänderung und ist damit keine Phasengrenze; und eine kurze
> Warenkorbreservierung war hinterher nicht von einer echten Abwesenheit zu
> unterscheiden. `offer_state.buyable_since` behebt beides. Abschnitt 2.2 und
> 3.2 beschreiben jetzt den **gebauten** Stand; ADR-0142 trägt die
> Entscheidung.
>
> **Die acht Entscheidungen sind getroffen** (Betreiber, 2026-10-25) und
> stehen in Abschnitt 8.2 mit dem jeweiligen Stand. **D-4 weicht von meinem
> Vorschlag ab:** Preissenkungen sind standardmäßig **aus**.
>
> **Drei Korrekturen an dieser Fassung**, aus der Umsetzung von S1:
>
> 1. `shop_offers()` filtert seit `0139` **`is_position_sellable(i.id)`**,
>    nicht `is_shop_eligible()`. Abschnitt 1.2 nannte die alte Funktion.
> 2. Die Gegenwart wird als **Sicht** `offer_state_live` gelesen, nicht als
>    Unterabfrage in jeder Anweisung — siehe 3.2 und 4.1a.
> 3. `refresh_offer_state()` ist **nur für `authenticated`** ausführbar, nicht
>    für `anon`. Begründung in 3.4.

> **Diese Fassung ersetzt den Entwurf vom selben Tag.** Der Entwurf schlug
> vor, Benachrichtigungen **synchron in der Veröffentlichungstransaktion**
> per Trigger auf `shop_inventory` zu schreiben und dafür eine Karenzzeit zu
> fordern. Der Betreiber hat zu Recht angemerkt, dass sich das ohne spätere
> Ausführung nicht vereinbaren lässt. Die Prüfung gegen den Code hat zwei
> weitere Gründe gefunden, warum der Weg falsch war — Abschnitt 1.6.

---

## 1. Was wirklich da ist

Alles in diesem Abschnitt ist am Code gelesen, nicht aus dem Entwurf
übernommen. Dateien und Zeilen sind nachprüfbar genannt.

### 1.1 Vier Zustände, die nie dasselbe sind

Der Auftrag verlangt diese Unterscheidung ausdrücklich, und der Code macht
sie an vier verschiedenen Stellen:

| Zustand | Wo er steht | Wer ihn ändert |
|---|---|---|
| **Angebot veröffentlicht** | `shop_inventory.is_listed` | `admin_set_listing()` ← `setListing()` in `src/lib/admin/actions.ts` |
| **Verkauf freigegeben** | `shop_inventory.sale_released` (`0139`) | `admin_set_sale_release()` ← `setSaleRelease()` |
| **Bestand vorhanden** | `shop_inventory.quantity` | `system_record_inventory_movement()` — jede Buchung, jeder Wareneingang, jeder Verkauf |
| **Warenkorbreservierung** | `shop_inventory.reserved` | `reserve_order_stock()`, `release_order_reservations()`, `release_expired_reservations()`, `convert_order_reservations()` (`0010`/`0012`) |

**`available_quantity` ist eine generierte Spalte** —
`generated always as (quantity - reserved) stored`, `0003_shop_foundation.sql:113`.
Sie ist also weder Bestand noch Reservierung, sondern deren Differenz, und
sie bewegt sich bei **jedem** Warenkorb.

### 1.2 „Kaufbar" ist ein Verbund aus fünf Bedingungen

`public.shop_offers()`, zuletzt `0029_v1_loose_only_offers.sql`:

```sql
from shop_inventory i join skylanders s cross join shop_settings st
where i.is_listed
  and i.condition = public.v1_sale_condition()          -- V1 verkauft nur lose
  and public.is_position_sellable(i.id)                 -- seit 0139: Listung,
                                                        -- Freigabe, Artikeltyp,
                                                        -- Kategorie, USK
  and public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null
returns … (i.available_quantity > 0) as available
```

**Die Projektion liefert auch ausverkaufte Zeilen** (`available = false`).
„Tatsächlich kaufbar" ist deshalb nicht „kommt in `shop_offers()` vor",
sondern die Regel in `src/lib/shop/offer.ts`:

```ts
v1BuyableOffers(offers) = offers.filter(o => o.available && o.condition === "loose")
hasV1BuyableOffer(offers) = v1BuyableOffers(offers).length > 0
```

Diese beiden Funktionen sind die **einzige** Definition von „kaufbar" in der
Anwendung — die Angebotszeile jeder Karte, die Schnellansicht und seit Phase 3
die Kennzahl „Mit Angebot" auf `/favoriten` fragen sie. **Das
Benachrichtigungssystem darf keine zweite aufstellen.**

> **Folge für A:** „wieder verfügbar" heißt `hasV1BuyableOffer()` wechselt für
> diese SKY-ID von `false` auf `true`. Orderbuch-Einkäufe, Kalkulationen,
> Wareneingänge ohne Listung und nicht freigegebene Positionen kommen in
> `shop_offers()` **gar nicht vor** — das ist strukturell und braucht keine
> zusätzliche Bedingung.

### 1.3 Der Preis hat DREI unabhängige Quellen — und das hat der Entwurf übersehen

`public.shop_price(override, market_price, percentage)`,
`0007_shop_pricing_and_images.sql`:

```sql
when p_override is not null then p_override                       -- 1
when p_market_price is null or p_percentage is null then null
else round(p_market_price * p_percentage / 100, 2)                -- 2 × 3
```

| # | Feld | Wer schreibt | Umfang einer Änderung |
|---|---|---|---|
| 1 | `shop_inventory.sale_price` | `setListing()` → `admin_set_listing()` | **eine** Position |
| 2 | `skylanders.market_price` | **die Importwerkzeuge** (`tools/import-catalog.mts`, `import-legacy-*.mts`) | **der halbe Katalog** in einem Lauf |
| 3 | `shop_settings.price_percentage` | `setShopPercentage()` → `admin_set_shop_percentage()` | **jede automatisch bepreiste Position auf einmal** |

> **Das widerlegt den Entwurf.** Ein Trigger auf `shop_inventory` hätte 2 und
> 3 **nicht gesehen** — eine Preissenkung durch einen Importlauf oder durch
> das Drehen der einen Prozentzahl wäre lautlos vorbeigegangen. Ein Trigger
> auf `skylanders` hätte das Gegenteil getan: ein Katalogimport hätte ihn für
> jede Zeile gefeuert.

### 1.4 Verzögerte Verarbeitung: es gibt keine, und das ist bereits ein bekanntes Problem

Gesucht und **nicht gefunden**: `pg_cron`, `pg_net`, `cron.schedule`, irgendein
`create extension` in `supabase/migrations/`, eine `vercel.json`, ein
Cron-Eintrag in `next.config.ts` oder `package.json`, ein Route Handler, der
etwas anstößt.

**Stärker noch:** `expire_stale_checkouts()` (`0012_payment_core.sql:851`)
trägt im eigenen Kommentar

> *„Intended to run every five minutes; no scheduler is installed by this
> migration."*

und **keine der vier Edge Functions** (`create-payment`, `stripe-webhook`,
`refund-payment`, `send-order-mail`) ruft sie. Erreicht wird sie nur
mittelbar: `release_expired_reservations(v_ids)` läuft *innerhalb* von
`reserve_order_stock()` (`0010:1087`), also beim nächsten Warenkorb.

> **Das ist das Muster dieses Projekts: lazy in der Transaktion, die ohnehin
> kommt.** Es gibt dafür einen Präzedenzfall, er ist dokumentiert, und er hat
> eine bekannte Schwäche — ohne Besucher läuft nichts. Für
> Zahlungsabläufe ist das ein Mangel. **Für In-App-Benachrichtigungen ist es
> genau richtig**, und Abschnitt 3 baut darauf.

### 1.5 Die Oberfläche hat die Mechanik schon

| Vorhanden | Datei | Was es ist |
|---|---|---|
| `AttentionBadge` | `src/components/ui/attention-badge.tsx` | die Zahl am Navigationspunkt |
| `Unread { mine, seller }`, `Attention { mine, seller }` | `src/components/layout/site-nav.tsx:253/264` | zwei Kanäle je Rolle (`0098`/`0099`) |
| **Die Berechnung auf JEDER Seite** | `src/app/(app)/layout.tsx:37–45` | `fetchMyUnread()`, `fetchMyAttentionTotal()` — beide `cache()`-gebunden |
| `order_mail (order_id, kind)` **PK** | `0019_transactional_mail.sql:157` | ein Anspruchs- und Dedup-Register |
| `order_attention_reads (order_id, reader)` | `0099_order_attention.sql:103` | ein **Wasserstand** je Seite |

**`(app)/layout.tsx` ist der Schlüssel.** Dort laufen bei jedem Seitenaufbau
im angemeldeten Bereich schon heute vier Aggregatabfragen. Eine fünfte,
`cache()`-gebunden, ist der natürliche Ort für eine fällige Prüfung — und
zwar genau dann, wenn der Empfänger hinsieht.

`order_mail`s Dedup-Muster (ein Schlüssel, der den Vorgang benennt) ist
richtig; der **Wasserstand** aus `order_attention_reads` ist hier falsch: er
kann nicht sagen „dieses eine Angebot wurde gemeldet", und der Auftrag
verlangt Einzelquittierung.

### 1.6 Drei Gründe, warum der Trigger-Weg des Entwurfs falsch war

1. **Er kann keine Karenzzeit** — die Beobachtung des Betreibers. Ein
   Trigger weiß nur, dass sich *jetzt* etwas geändert hat; „und es ist seit
   20 Minuten so" braucht eine spätere Ausführung, die es nicht gibt.
2. **Er sieht zwei der drei Preisquellen nicht** (1.3) und würde bei der
   dritten über den ganzen Katalog feuern.
3. **Er hängt im Einkauf.** Ein Trigger auf `shop_inventory` läuft in
   derselben Transaktion wie `reserve_order_stock()` und
   `system_record_inventory_movement()`. Ein Fehler darin lässt einen
   **Kauf** scheitern. Der Auftrag verbietet das ausdrücklich — und mit einem
   Trigger ist es nicht abwendbar, sondern nur unwahrscheinlich.

### 1.7 Eigener Shop und späterer Marktplatz

`shop_offers()` ist die Projektion **der Plattform**, nicht die eines
Verkäufers: die Funktion kennt kein `seller_id`, und `CLAUDE.md` verbietet
eines. Jeder Entwurf, der an `shop_offers()` ansetzt, ist damit automatisch
marktplatztauglich — käme ein zweiter Verkäufer, ändert sich die Projektion,
und die Benachrichtigungslogik bleibt unverändert richtig. Jeder Entwurf, der
an `shop_inventory` ansetzt, wäre an den einen Verkäufer gebunden.

> Das ist das stärkste Argument für die Zustandsprüfung aus Abschnitt 3 — und
> es ist kein Marktplatz-Feature, sondern dessen Abwesenheit.

---

## 2. Die Auslöseregeln, exakt

Alle Preise **in Cent als `integer`**. `shop_price()` rundet auf zwei
Dezimalstellen (`round(…, 2)`), `shop_offers().price` ist `numeric`;
umgerechnet wird mit `round(price * 100)`. Fließkommavergleiche kommen
nirgends vor.

### 2.1 Der Zustand einer Figur

Für eine SKY-ID, abgeleitet **ausschließlich** aus `shop_offers()` und
`v1BuyableOffers()`:

```
buyable        := es gibt ein Angebot mit available ∧ condition = 'loose'
cheapest_cents := min(round(price*100)) über genau diese Angebote,  NULL wenn ¬buyable
```

Mehrere Angebote derselben SKY-ID sind damit erledigt: `min` über die
kaufbaren. Ein boxed-Angebot und ein ausverkauftes loses zählen nicht — V1
verkauft sie nicht.

### 2.2 A · Wieder verfügbar

> **Meldung, wenn der zuletzt GEMELDETE Zustand `¬buyable` war und der
> aktuelle Zustand `buyable` ist und mindestens `grace` stabil ist.**

Entscheidend: verglichen wird gegen den zuletzt **gemeldeten** Zustand, nicht
gegen den zuletzt *beobachteten*. Damit sind alle vom Auftrag genannten Fälle
abgedeckt:

| Fall | Verhalten |
|---|---|
| Neues Angebot veröffentlicht | `¬buyable → buyable` → **Meldung** |
| Bestehendes reaktiviert (`is_listed`, `sale_released`) | ebenso → **Meldung** |
| Bestand wieder aufgefüllt | ebenso → **Meldung** |
| Warenkorbreservierung des letzten Stücks | `buyable → ¬buyable`. **Keine** Meldung (A meldet nur in die andere Richtung); der gemeldete Zustand bleibt `buyable` |
| Reservierung läuft ab, Stück kommt zurück | aktuell `buyable`, gemeldet `buyable` → **nichts**. Das ist der Flattern-Schutz, und er ist **strukturell**, nicht eine Karenzzeit |
| Vorübergehend ausverkauft, später nachgeliefert | gemeldet wird `¬buyable` erst, wenn der Zustand `grace` lang stabil war; danach ist die Nachlieferung eine echte A-Meldung |
| Nicht öffentlich / gesperrt | kommt in `shop_offers()` nicht vor → `¬buyable` |

**Der gemeldete Zustand wird auch ohne Meldung fortgeschrieben**: wird eine
Figur dauerhaft unverfügbar (stabil `¬buyable`), merkt das System sich das
*ohne* jemanden zu benachrichtigen. Nur so kann die nächste echte
Verfügbarkeit wieder eine Meldung sein.

### 2.3 B · Preis gesunken

> **Meldung, wenn `buyable` ∧ der gemeldete Zustand `buyable` war ∧
> `cheapest_cents` um mindestens die Schwelle unter dem gemeldeten Preis
> liegt ∧ der Zustand mindestens `grace` stabil ist.**

| Fall | Verhalten |
|---|---|
| Direkte Senkung eines Angebots | `min` sinkt → **Meldung**, wenn über der Schwelle |
| Neues, günstigeres Angebot | ebenso |
| Das bisher günstigste wird deaktiviert oder ausverkauft | `min` **steigt** → keine Meldung, aber der gemeldete Preis wird **stillschweigend nachgezogen**. Sonst wäre die Rückkehr des günstigen Angebots eine Falschmeldung („gesunken", obwohl es derselbe Preis wie vorher ist) |
| Günstigeres Angebot kehrt nach Reservierungsablauf zurück | gemeldeter Preis wurde beim Verschwinden nachgezogen — und die Rückkehr liegt unter ihm. Hier **würde** gemeldet. **Darum greift die Karenzzeit**: beim Nachziehen bekommt der Zustand ein neues `changed_at`, und der Rücksprung innerhalb von `grace` wird nie gemeldet |
| Mehrere Angebote | `min` über die kaufbaren, siehe 2.1 |
| Übergang `¬buyable → buyable` | **A** meldet, **B nicht** — und der gemeldete Preis wird auf den neuen gesetzt. Zwei Meldungen für ein Ereignis wären Spam |

**Die Schwelle.** Vorschlag, fachlich begründet:

```
relevant := alter_preis − neuer_preis  ≥  max(50 Cent, 5 % des alten Preises)
```

* **5 %** weil der automatische Preis `market_price × percentage / 100` ist:
  ein Importlauf verschiebt Marktwerte typischerweise um wenige Prozent, und
  das ist Rauschen, keine Nachricht.
* **50 Cent als Boden** weil 5 % einer 6-€-Figur 30 Cent wären — für diese
  Preisklasse eine Meldung ohne Anlass.
* Beide Zahlen gehören nach `shop_settings`, nicht in eine Funktion: sie sind
  eine Betriebsentscheidung, und sie zu ändern darf keine Migration kosten.

**Offene Entscheidung D-3** (Abschnitt 8): ob zusätzlich eine Sperre je Figur
gilt — „höchstens eine B-Meldung je Figur und Tag". Mein Vorschlag: **nein**
für V1. Die Schwelle plus der nachgezogene gemeldete Preis sorgen bereits
dafür, dass eine zweite Meldung einen zweiten echten Rückgang verlangt.

### 2.4 Die Karenzzeit, und woraus sie folgt

`public.reservation_ttl()` (`0010_commerce_core.sql:70`) ist **20 Minuten**,
gespiegelt als `RESERVATION_TTL_MINUTES = 20` in
`src/lib/commerce/reservation.ts:35`.

> **`grace := reservation_ttl() + 10 Minuten = 30 Minuten`**, und zwar
> **abgeleitet statt getippt**: die Funktion wird gefragt, nicht die Zahl
> kopiert. Eine Reservierung kann einen Zustand höchstens 20 Minuten
> verfälschen; nach 30 ist er echt.

---

## 3. Die Architektur — zwei Varianten, eine Empfehlung

### 3.1 Variante 1 · Ereigniserfassung im Trigger + verzögerte Verarbeitung

Trigger auf `shop_inventory` (und `skylanders`, und `shop_settings`) schreiben
Ereigniszeilen; ein Verarbeiter macht daraus später Meldungen.

| | |
|---|---|
| **Zuverlässigkeit** | hoch für `shop_inventory`, **lückenhaft** für die beiden anderen Preisquellen; ein Katalogimport feuert über den ganzen Katalog |
| **Komplexität** | drei Trigger, eine Ereignistabelle, ein Verarbeiter, eine Wiederholungslogik, eine Aufräumung |
| **Datenbanklast** | ein Insert bei **jedem** Warenkorb und jedem Verkauf, auch wenn niemand die Figur vorgemerkt hat |
| **Betriebskosten** | braucht einen Scheduler, den es nicht gibt (Abschnitt 1.4) — also entweder `pg_cron` zubuchen oder eine fünfte Edge Function samt Aufrufer |
| **Wiederherstellbarkeit** | gut: der Ereignislog ist nachvollziehbar |
| **Marktplatz** | schlecht: Trigger hängen an `shop_inventory`, also am einen Verkäufer (1.7) |
| **Tödlicher Einwand** | **ein Fehler darin lässt einen Kauf scheitern** (1.6.3) |

### 3.2 Variante 2 · Periodische Zustandsprüfung, lazy ausgelöst — **empfohlen**

**Kein Trigger. Zwei Stufen, beide lesend angestoßen.**

```
Stufe 1 — DER SPIEGEL (global, gedrosselt, idempotent)      ← S1, gebaut
  offer_state_live  =  shop_offers() + v1-Regel, als SICHT
  refresh_offer_state()  schreibt die Sicht in offer_state,
    changed_at nur bei echter Änderung, checked_at bei jedem Lauf,
    gedrosselt auf offer_state_window() und durch
    pg_try_advisory_xact_lock(146, 1) gegen parallele Läufe gesichert.
    Antwort: ran | throttled | locked — drei unterscheidbare Fälle.

Stufe 2 — DIE MELDUNG (je Leser, nur für dessen Favoriten)   ← S2, geplant
  für jede favorisierte SKY-ID mit now() - changed_at >= grace:
    **und** die Figur steht JETZT so in offer_state_live  ← Pflicht, s. u.
    vergleiche offer_state mit dem GEMELDETEN Zustand (announced_*)
    → A oder B nach Abschnitt 2, Zeile in favorite_notifications
    → announced_* := aktueller Zustand   (auch ohne Meldung)
```

> ### **S2 MUSS gegen `offer_state_live` gegenprüfen**
>
> `checked_at` ist **keine** Frischegarantie. Eine Minute Drosselung heißt
> nicht, dass der Spiegel eine Minute alt ist, sondern dass er **höchstens**
> jede Minute nachgezogen wird. Das Szenario:
>
> 1. Der Spiegel sagt: kaufbar. 2. Das Angebot wird ausverkauft.
> 3. Noch kein Abgleich. 4. Ein Sammler kommt. 5. Der Abgleich ist gesperrt
> oder scheitert.
>
> Dann steht „kaufbar" im Spiegel und ist nicht mehr wahr. **Kein
> Zeitstempel kann das verhindern.** S2 schreibt eine Meldung deshalb nur,
> wo der Spiegel (*was sich geändert hat*) und die Sicht (*was jetzt gilt*)
> übereinstimmen — in derselben Transaktion. S1 liefert dafür die drei
> Voraussetzungen: die Sicht, `checked_at` als Alter, und drei
> unterscheidbare Antworten, damit ein `locked` nie als eigener Erfolg
> gelesen wird.

| | |
|---|---|
| **Zuverlässigkeit** | **vollständig für alle drei Preisquellen**, weil der Spiegel die Projektion liest und nicht ihre Eingaben. Verloren geht nur, was zwischen zwei Prüfungen auftritt **und sich wieder aufhebt** — und genau das soll verloren gehen |
| **Komplexität** | **zwei Tabellen, zwei Funktionen, kein Trigger, kein Job** |
| **Datenbanklast** | ein Vergleich über ~290 Lagerzeilen, höchstens einmal je Drosselfenster; Stufe 2 über die Favoriten **eines** Nutzers |
| **Betriebskosten** | **null** — kein Scheduler, keine Erweiterung, keine fünfte Function |
| **Wiederherstellbarkeit** | der Spiegel ist jederzeit aus `shop_offers()` neu herstellbar; `announced_*` ist der einzige echte Zustand |
| **Marktplatz** | **gut**: setzt an `shop_offers()` an, also an der Plattformprojektion (1.7) |
| **Schwäche** | ohne Besucher läuft nichts — siehe 3.4 |

### 3.3 Warum das Flattern strukturell erledigt ist

Der Entwurf wollte vier Riegel. Die Zustandsprüfung braucht **zwei**, und der
erste ist keine Regel, sondern die Bauform:

1. **Verglichen wird mit dem GEMELDETEN Zustand, nicht mit dem vorigen.**
   Warenkorb rein (`buyable → ¬buyable`), Reservierung ab
   (`¬buyable → buyable`): der gemeldete Zustand war die ganze Zeit
   `buyable`, also entsteht nichts. **Egal wie oft das passiert.**
2. **Die Karenzzeit (30 min > `reservation_ttl()`).** Sie fängt den
   verbleibenden Fall: einen Zustand, der gerade erst gekippt ist und
   vielleicht wieder zurückkippt — vor allem den nachgezogenen Preis aus 2.3.
3. *(Zusatz, kein Riegel)* Ein **partieller Unique-Index**
   `unique (user_id, sky_id, kind, announced_at) where read_at is null`
   macht Stufe 2 bei paralleler Ausführung idempotent: zwei gleichzeitige
   Seitenaufbauten desselben Nutzers schreiben dieselbe Zeile, und die zweite
   prallt ab. **Dedup an einem Ereignis, nicht an `read_at is null`** — wie
   der Auftrag verlangt.

### 3.4 Wie eine fällige Prüfung garantiert wieder läuft

Die ehrliche Antwort zuerst: **sie läuft nicht, solange niemand hinsieht.**
Bei einer rein In-App-Benachrichtigung ist das kein Verlust — es gibt
niemanden, dem etwas entgeht. Was zählt: **wenn der Empfänger kommt, ist die
Zahl richtig.**

Das wird so garantiert:

| Auslöser | Was er anstößt | Wie oft |
|---|---|---|
| `(app)/layout.tsx` — **jeder** Seitenaufbau im angemeldeten Bereich | Stufe 1 (gedrosselt) **und** Stufe 2 für diesen Nutzer | bei jedem Klick |
| `/shop`, `/`, `/skylanders/<slug>` — jeder Aufruf, der `fetchOffers()` macht | Stufe 1 (gedrosselt) | bei jedem Besucher, auch anonym |
| `/favoriten` | beides, für diesen Nutzer | bei jedem Besuch |

**Die Drosselung** ist eine Zeile in `shop_settings` (oder eine eigene
einzeilige Tabelle) mit `mirror_ran_at`. Stufe 1 nimmt einen
`pg_try_advisory_xact_lock`, prüft `now() - mirror_ran_at >= 60 s`, läuft
oder kehrt sofort zurück. Zwei gleichzeitige Besucher kosten **einen** Lauf.

**Kein Fehler erreicht den Shop.** Beide Stufen laufen in eigenen Aufrufen,
nicht in einer Shop-Transaktion, und die Server-Seite ruft sie in einem
`try/catch`, das nichts weiterwirft — dasselbe Muster wie
`fetchFavoriteDemand()` aus Phase 3, das bei einer Abweisung eine leere Map
gibt statt zu werfen. **Mit einem Trigger wäre diese Zusage nicht machbar.**

### 3.5 Was später dazukäme, wenn ein Scheduler existiert

Käme `pg_cron` (oder ein Vercel-Cron auf einen geschützten Route Handler),
ruft er genau **dieselben zwei Funktionen** — Stufe 1 global, Stufe 2 für
alle Nutzer. Keine Umstellung, nur ein zweiter Auslöser. Und derselbe
Scheduler hätte dann auch `expire_stale_checkouts()` wieder, das seit `0012`
darauf wartet. **Das ist eine eigene Entscheidung und nicht Teil dieser
Phase.**

---

## 4. Datenmodell und Sicherheit

### 4.1a `offer_state_live` — die Gegenwart (gebaut, `0146`)

```sql
create view public.offer_state_live as
  select o.sky_id, min(round(o.price * 100))::integer as cheapest_cents
    from public.shop_offers() o
   where o.available and o.condition = public.v1_sale_condition()
   group by o.sky_id;
```

**Eine Sicht und keine zweite Rechnung.** Hier steht kein Preis, keine
Prozentzahl und keine Bestandsregel — `shop_offers()` beantwortet das. Der
Zustandsfilter steht trotzdem da, obwohl die Projektion ihn seit `0029`
selbst setzt: dieselbe Doppelung macht `v1BuyableOffers()` in
`src/lib/shop/offer.ts`, und der Spiegel soll „was V1 verkauft" bedeuten,
auch wenn die Projektion eines Tages breiter wird. **Kein Clientrecht** — die
`definer`-Funktionen lesen sie als Eigentümer.

### 4.1 `offer_state` — der Spiegel

**Gebaut in `0146`, mit drei Abweichungen vom Entwurf.** Die Spalten:

| Spalte | Typ | Aufgabe |
|---|---|---|
| `sky_id` | `text` **PK**, FK → `skylanders` RESTRICT | die Figur, exakt |
| `buyable` | `boolean not null` | gibt es jetzt ein tatsächlich kaufbares Angebot |
| `cheapest_cents` | `integer` | der günstigste kaufbare Preis in Cent, `null` wenn nicht kaufbar |
| `changed_at` | `timestamptz not null` | die letzte **echte** Änderung. Die Karenzzeit rechnet hiergegen |
| **`checked_at`** | `timestamptz not null` | die letzte **erfolgreiche Prüfung**. Neu gegenüber dem Entwurf |
| `announced_buyable`, `announced_cents`, `announced_at` | | was zuletzt **gemeldet** wurde — der einzige nicht wiederherstellbare Teil |

**Fünf CHECKs**, und zwei davon sind Entscheidungen:

* `offer_state_checked_after_changed`: `checked_at >= changed_at`. Dass eine
  Prüfung ohne Änderung `changed_at` nicht zurücksetzt, steht als **CHECK**
  da und nicht als Absicht.
* `offer_state_price_sane`: `cheapest_cents >= 0`, **nicht** `> 0`. Der
  Entwurf hatte `> 0`. `shop_price()` rundet auf zwei Dezimalstellen, und
  bei einem sehr kleinen Marktwert kann daraus `0.00` werden — ein `> 0`
  hätte den ganzen Spiegellauf an einer solchen Zeile abbrechen lassen. Ein
  Spiegel, der an echten Daten scheitert, ist schlechter als einer, der eine
  Null abbildet.

Dazu `offer_state_price_consistent` (kaufbar ⟺ es gibt einen Preis),
`offer_state_announced_consistent` und `offer_state_announced_price_sane`.

### 4.1b `refresh_offer_state()` (gebaut, `0146`)

```
returns table (ran boolean, reason text, rows_checked integer, rows_changed integer)
security definer · volatile · search_path = '' · nur für authenticated
```

| | |
|---|---|
| **Drosselung** | `max(checked_at)` gegen `offer_state_window()` (eine Minute). **Kein zusätzlicher Zeitstempel**: ein erfolgreicher Lauf setzt `checked_at` auf jeder Zeile, also ist das Maximum genau der letzte Erfolg |
| **Zweimal geprüft** | davor **und** unter dem Schloss. Zwei Aufrufe, die die erste Prüfung gleichzeitig passieren, würden sonst beide laufen |
| **Schloss** | `pg_try_advisory_xact_lock(146, 1)`. `try`, damit ein zweiter Besucher nicht hängt; `xact`, damit ein **gescheiterter** Lauf keines zurücklässt und beim nächsten Aufruf wieder möglich ist |
| **Erstbefüllung** | ist die Tabelle leer, entsteht jede Zeile **bereits gemeldet**. Ein Angebot, das seit Wochen steht, ist keine Neuigkeit. Jede **später** entstehende Zeile bekommt `announced_* = null` und ist damit zu Recht eine |
| **Keine unnötigen Schreibvorgänge** | `changed_at` nur bei echter Änderung (`is distinct from`). `checked_at` wandert bei jedem Lauf — das ist der Preis der Frischeauskunft, und er ist bewusst bezahlt |
| **Keine Zeile verschwindet** | „nicht kaufbar" ist ein Zustand, den S2 braucht; ohne ihn könnte die nächste Verfügbarkeit keine Kante sein |
| **Keine personenbezogenen Daten** | die Funktion nennt `favorites` nicht, liest es nicht und kennt keine `user_id` |

Eine Zeile je Figur, nicht je Ereignis. **Kein `seller_id`** — der Zustand
gehört der Figur, so wie `shop_offers()` ihn für die Plattform beantwortet
(1.7).

**Rechte: keine.** `revoke all … from public, anon, authenticated`, RLS an
ohne Richtlinie. Betriebszustand, den keine Oberfläche braucht — Karten lesen
`shop_offers()`.

### 4.2 `favorite_notifications` — der Posteingang

```sql
create table public.favorite_notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  sky_id      text not null references public.skylanders (sky_id)
                on update cascade on delete restrict,
  kind        text not null check (kind in ('available', 'price_drop')),
  -- Der Preis, der die Meldung ausgeloest hat. Historie, kein Verweis.
  price_cents integer,
  -- Das Ereignis, gegen das dedupliziert wird: der Zeitpunkt, zu dem der
  -- gemeldete Zustand gesetzt wurde. NICHT read_at.
  event_at    timestamptz not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint favorite_notifications_event_uniq
    unique (user_id, sky_id, kind, event_at)
);

create index favorite_notifications_inbox_idx
  on public.favorite_notifications (user_id, read_at, created_at desc);
```

**`read_at` statt einer zweiten Tabelle**: eine Meldung hat genau einen
Empfänger, „gelesen" ist also eine Eigenschaft der Zeile. Der Wasserstand aus
`order_attention_reads` existiert nur, weil dort **zwei Seiten** auf
denselben Vorgang schauen.

**Die Dedup-Grenze ist `event_at`**, nicht `read_at is null`: dasselbe
Ereignis kann nicht zweimal eingetragen werden, auch nachdem der Nutzer die
erste Meldung gelesen hat. Ein *neues* Ereignis derselben Art für dieselbe
Figur bekommt ein neues `event_at` und darf durch.

**Richtlinien** (Muster von `favorites`, `0145`):

| Befehl | Bedingung |
|---|---|
| `select` | `auth.uid() = user_id and is_collector_account()` |
| `update` | dieselbe, `using` **und** `with check` — und **nur `read_at`** darf sich ändern (Spaltenrechte: `grant update (read_at)`) |
| `insert` | **keine Richtlinie, kein Recht.** Zeilen entstehen ausschließlich in der `definer`-Funktion. Niemand soll sich selbst oder anderen eine Meldung schreiben können |
| `delete` | **keine.** Meldungen verschwinden mit dem Konto (`on delete cascade`) |

### 4.3 Einstellungen — zwei Spalten auf `profiles`

```sql
alter table public.profiles
  add column notify_available  boolean not null default true,
  add column notify_price_drop boolean not null default true;
```

**Keine eigene Tabelle:** es sind zwei Schalter je Konto, `profiles` gehört
dem Konto, und seine RLS steht seit `0001` (`profiles_update_own` mit
`using` und `with check`).

**Vorgaben: beide `true`** — und das ist eine Änderung gegenüber dem Entwurf,
der `notify_price_drop` auf `false` setzen wollte. Begründung: beide
Meldungsarten entstehen **nur für Figuren, die der Nutzer selbst vorgemerkt
hat**, und sie sind durch Schwelle und Karenzzeit gedeckelt. Wer ein Herz
anklickt, will genau das wissen. Eine Zugabe, die standardmäßig aus ist,
findet niemand.

> **Offene Entscheidung D-4:** falls der Betreiber das anders sieht, ist es
> eine Zeile in der Migration.

### 4.4 Favorit entfernt, Konto gelöscht

| Fall | Verhalten | Begründung |
|---|---|---|
| **Favorit entfernt** | bestehende Meldungen **bleiben**, neue entstehen nicht | Die Meldung ist ein Ereignis der Vergangenheit und war wahr. Sie zu löschen, weil das Herz ausgeht, nähme dem Nutzer die Begründung dafür, dass er gerade etwas gekauft hat. Der Posteingang zeigt sie weiter; `read_at` gilt wie immer |
| **Konto gelöscht** | `on delete cascade` — alles fort | DSGVO, dasselbe Muster wie `favorites` und `collection_items` |
| **Figur deaktiviert** | `on delete restrict` auf `skylanders` | Eine Katalogzeile darf nicht unter einem Posteingang wegbrechen; der Import deaktiviert über `is_active` statt zu löschen |
| **Einstellung ausgeschaltet** | neue Meldungen dieser Art entstehen nicht, `announced_*` wird **trotzdem** fortgeschrieben | Sonst käme beim Wiedereinschalten eine Flut alter Ereignisse |

### 4.5 Die beiden Funktionen

```sql
-- Stufe 1. Kein Argument, kein Rueckgabewert ausser der Anzahl Aenderungen.
public.refresh_offer_state() returns integer
  security definer, volatile, set search_path = ''
  -- Drosselung per pg_try_advisory_xact_lock + mirror_ran_at.
  -- Liest shop_offers(), schreibt offer_state. Beruehrt NICHTS sonst.
  -- Rechte: execute fuer authenticated UND anon (auch ein anonymer
  --         Shopbesucher darf den Spiegel auffrischen; er sieht nichts davon).

-- Stufe 2. Laeuft fuer den AUFRUFER, nie fuer jemand anderen.
public.sync_favorite_notifications() returns integer
  security definer, volatile, set search_path = ''
  -- auth.uid() ist der Empfaenger. Kein Parameter dafuer — eine Funktion,
  -- die einen fremden Nutzer annehmen kann, ist eine Funktion, die man
  -- missbrauchen kann.
  -- Prueft is_collector_account(); ein Betriebs- oder Adminkonto bekommt 0.
  -- Rechte: execute nur fuer authenticated.

-- Lesen und Quittieren braucht KEINE Funktion: RLS deckt es ab.
--   select  → die eigenen Zeilen
--   update  → read_at, die eigenen Zeilen
```

**Kein Dienstschlüssel, nirgends.** Beide Funktionen laufen als der
angemeldete Nutzer über den Anon-Key; `security definer` gibt ihnen den
Tabellenzugriff, den die Richtlinien verwehren. Dasselbe Muster wie
`favorite_demand()` in Phase 3.

### 4.6 Parallele Transaktionen

| Gefahr | Abwehr |
|---|---|
| Zwei Seitenaufbauten desselben Nutzers gleichzeitig | der partielle Unique-Index (3.3.3); der zweite Insert prallt mit `on conflict do nothing` ab |
| Zwei Besucher lösen Stufe 1 gleichzeitig aus | `pg_try_advisory_xact_lock` — der zweite kehrt sofort zurück, ohne zu warten |
| Stufe 1 läuft, während ein Kauf `reserved` ändert | Stufe 1 liest nur. Der Spiegel ist dann eine Sekunde alt — und die Karenzzeit von 30 Minuten macht das bedeutungslos |
| `announced_*` wird doppelt fortgeschrieben | `update … where announced_at is distinct from <neu>`, idempotent |

---

## 5. Oberfläche

### 5.1 Der Zähler in der Leiste — **gebaut** (`0149`, ADR-0144)

Eine **dritte Zahl** in `Unread`, nicht ein vierter Typ: `Unread` heißt
„ungelesen", und eine Verfügbarkeitsmeldung ist ungelesen oder nicht, genau
wie eine Nachricht. Sie gehört aber zu keinem der zwei Posteingänge, sondern
zur Wunschliste — deshalb ein eigenes Feld `notices` und nicht `mine`.

**Die Zahl sitzt am vorhandenen Navigationspunkt „Favoriten"** — nicht an
einem neuen Glockensymbol und nicht an einem neuen Ziel. Begründung: die
Meldungen betreffen ausschließlich Favoriten, und ein vierter Punkt in einer
Leiste mit drei Zielen (ADR-0036) wäre genau die Überladung, die der Auftrag
ausschließt.

**Korall und nicht Rot.** Rot heißt in dieser Leiste „etwas ist kaputt" (eine
gekennzeichnete Bestellung, ADR-0050). „Deine Figur ist wieder da" ist das
Gegenteil; `AttentionBadge` hat dafür einen zweiten Ton bekommen und behält
den bisherigen als Standard.

**Erhoben wird sie in vier Layouts**, aber nur für ein Sammlerkonto: die
Wunschliste wird nur einem Sammler angeboten (ADR-0078), also trägt nur dort
eine Marke eine Aussage. Auch im **öffentlichen** Layout — dort ist der
Sammler die meiste Zeit, und eine Marke, die nur in den geschützten
Bereichen erscheint, erreicht genau den nicht, für den sie gedacht ist. Eine
Abfrage, nur die Zahl (`head: true`), über den Teilindex aus `0149`,
`cache()`-gebunden.

**Eine Navigation Verzug, und sie ist unsichtbar.** Die Verarbeitung hängt am
Aufruf von `/favoriten`, nicht am Layout. Eine Meldung, die **genau durch**
diesen Aufruf entsteht, steht sofort auf der Seite, während die Marke sie
erst bei der nächsten Navigation zählt. Das fällt niemandem auf: auf
`/favoriten` ist dieser Menüpunkt der aktive, und die Meldungen stehen dort
groß in Sicht. Der Preis für die exakte Zahl wäre ein Schreibaufruf bei
**jedem** geschützten Seitenaufruf.

### 5.2 Der Abschnitt auf `/favoriten` — **gebaut** (ADR-0144)

Im `heading`-Slot von `CatalogView`, also **innerhalb** des Blocks, den die
Weltkulisse hinterlegt — dieselbe Stelle wie der Kopf (ADR-0038, V3.3). Als
Markup der Seite stünde er auf eigenem Grund und schnitte ein Rechteck in die
Kulisse.

```
♥ Wieder verfügbar                      [Alle als gesehen markieren]
2 vorgemerkte Figuren sind wieder zu haben.

 [Bild]  Trigger Happy ist wieder verfügbar!
         Gemeldet am 26.10.2026 · 14,99 € bei der Meldung
         Zum Angebot        Gesehen

 [Bild]  Blue Bash ist wieder verfügbar!
         Gemeldet am 24.10.2026 · 9,90 € bei der Meldung · Inzwischen vergriffen
         Zur Figur          ✓ Gesehen
```

| Entscheidung | Begründung |
|---|---|
| Kein eigener Pfad `/benachrichtigungen` | Die Meldungen sind Favoriten-Ereignisse, und die Liste der betroffenen Figuren steht direkt darunter. Eine eigene Seite wäre ein zweiter Ort für dieselbe Sache |
| Jede Karte führt auf **die Figur** (`/skylanders/<slug>`) | dort steht das Angebot mitsamt Preis und Zustand; ein Direktlink in den Warenkorb wäre eine Kaufentscheidung, die niemand getroffen hat. Nicht vorgeladen — bis zu 24 Karten |
| **Eine Karte anzutippen quittiert sie NICHT** | *Hier weicht die Umsetzung vom Entwurf ab, und zwar bewusst.* „Wer das Angebot ansieht, hat die Meldung gesehen" ist verlockend und trotzdem eine Markierung ohne Handlung — und keine rückholbare. Der Auftrag nennt genau das als Prüfpunkt. Stattdessen ein eigener, leiser Textknopf „Gesehen" je Karte |
| „Alle als gesehen markieren" am Kopf | ein Aufruf von `mark_availability_notifications_read()` **ohne** Argument; erscheint nur, wenn es Ungelesenes gibt |
| **Gelesene bleiben stehen und werden nur ruhiger** | *Auch hier anders als im Entwurf („eingeklappt"):* kein Korallrand, gedämpfte Schrift, statt des Knopfs ein Häkchen. „Gesehen" heißt „ich weiß es", nicht „weg damit" — eine Karte, die beim Klick verschwindet, nimmt den Weg zum Angebot mit |
| „Wieder verfügbar", nicht „Jetzt verfügbar" | **wieder** ist die ganze Aussage: gemeldet wird nur ein echter Wechsel (`0147`). Eine Figur, die beim Vormerken schon zu haben war, erzeugt nichts |
| Der Preis heißt „… bei der Meldung" | zwischen Meldung und Ansehen können Stunden liegen. Gezeigt wird der **gespeicherte** Stand; was gilt, steht auf der Figurenseite |
| Ist das Angebot weg, sagt die Karte das | `stillBuyable` aus `hasV1BuyableOffer()` — derselben Funktion, die die Kennzahl im Kopf und die Angebotszeile jeder Karte benutzen, aus denselben Angeboten. Keine zweite Definition von „kaufbar", und keine behauptete Kaufbarkeit |
| Leerer Zustand | **keiner.** Ohne Meldungen erscheint der Abschnitt gar nicht. Ein „keine Benachrichtigungen" über einer Wunschliste ist eine Zeile, die nichts sagt |
| Auch ohne vorgemerkte Figuren | wer alles wieder entfernt, hat seine Meldungen noch — sie stehen dann über dem leeren Zustand |
| Decke bei 24 Karten | an der Abfrage, nicht erst in der Antwort |

### 5.3 Ein Hinweis an der Karte?

Der Auftrag fragt danach. **Mein Vorschlag: nein.** Die Karte trägt schon
Herz, Variantensiegel, Mengen-Chip, Angebotszeile und (angemeldet) den
Besitzrahmen. Ein sechstes Zeichen für „hierzu gibt es eine Meldung" wäre
dieselbe Auskunft doppelt — die Meldung steht zehn Zentimeter darüber und
nennt die Figur beim Namen.

**Was stattdessen genügt:** Die Angebotszeile sagt ohnehin schon „ab
14,99 €". Wer die Meldung gelesen hat, sieht an der Karte sofort, dass sie
stimmt.

> **Offene Entscheidung D-5**, falls der Betreiber es anders will. Die
> billigste Variante wäre dann, die betroffenen Karten im Raster **nach oben
> zu sortieren**, statt ein Zeichen hinzuzufügen.

### 5.4 Einstellungen — **nicht gebaut, und vorerst auch nicht vorgesehen**

Der Entwurf schlug zwei Schalter unter `/account` vor. Der Auftrag für S4 hat
sie ausdrücklich ausgeschlossen („keine zusätzlichen
Benachrichtigungseinstellungen"), und das ist auch die richtige Reihenfolge:
ein Schalter ist erst dann eine Hilfe, wenn es etwas abzuschalten gibt, das
jemanden erreicht, ohne dass er die Seite öffnet. Solange eine Meldung nur
**auf** `/favoriten` erscheint, ist das Nichtöffnen der Seite der Schalter.

Mit einer E-Mail oder einer Push-Nachricht ändert sich das sofort — dann
gehört ein Schalter dazu, und zwar **vor** dem Versandweg. Bis dahin: nichts.

## 6. Migrationen und Sicherung — die Reihenfolge

### 6.1 Der Stand heute

| | Staging | Production |
|---|---|---|
| `0144` Plattformexport + Kalkulationen | **angewendet** 2026-10-25 | **nein** |
| `0145` Favoriten | **angewendet** 2026-10-25 | **nein** |
| `favorites` im Plattformarchiv | **nein** — steht in `PLATFORM_EXCLUDED_TABLES` mit Ablaufdatum (ADR-0136) | — |

### 6.2 Die Reihenfolge, und warum sie zwingend ist

```
 1.  0144  →  Production
     Erst danach traegt dort der Rumpf aus 0144 (md5 4c4d2e7c…), und erst
     dann ist eine weitere Exportmigration ueberhaupt anwendbar: jede prueft
     den Abdruck ihrer Vorgaengerfassung.

 2.  0146  Exportmigration: favorites UND die beiden neuen Tabellen
     PLATFORM_FORMAT_VERSION 2 → 3, SECTIONS_BY_FORMAT_VERSION { …, 3: 57 }
     (54 + favorites + offer_state? + favorite_notifications — siehe 6.3)
     Der Eintrag in PLATFORM_EXCLUDED_TABLES faellt, und der
     Vollstaendigkeitswaechter (ADR-0134) verlangt dann einen Bereich.

 3.  0147  offer_state + favorite_notifications + die zwei profiles-Spalten
           + refresh_offer_state() + sync_favorite_notifications()

 4.  0145, 0146, 0147  →  Production, in dieser Folge
```

**Punkt 2 vor Punkt 4** ist die Zusage aus ADR-0136: neue persönliche
Nutzerdaten dürfen nicht ungesichert auf Production stehen.

> **Achtung, Henne und Ei:** `0146` muss die Tabellen aus `0147` exportieren,
> die es dann noch nicht gibt. Zwei Wege:
>
> **(a) Reihenfolge tauschen** — `0146` legt die Tabellen an, `0147` nimmt
> sie in den Export. Dann sind Tabellen kurz ungesichert, aber **nur auf
> Staging**, und auf Production geht beides zusammen.
>
> **(b) Eine Migration** — Tabellen und Export in einem Schritt. Verstößt
> gegen „eine Sache, eine Migration" (CLAUDE.md) und macht die Rücknahme
> schwerer.
>
> **Empfehlung: (a).** Sie ist die einzige, die auf Staging wie auf
> Production dieselbe Reihenfolge hat.

### 6.3 Was in die Sicherung gehört — und was nicht

| Tabelle | Betriebssicherung | Plattformsicherung | Begründung |
|---|---|---|---|
| `favorites` | **dauerhaft draußen** | **Bereich** | persönliche Nutzerdaten; fremde Wunschlisten in einem Händlerexport wären ein Leck (ADR-0136) |
| `favorite_notifications` | **dauerhaft draußen** | **Bereich** | dieselbe Klasse. Eine verlorene Meldung ist kein Weltuntergang, aber `read_at` ist eine Nutzerhandlung |
| `offer_state` | draußen | **begründet draußen** | **vollständig aus `shop_offers()` neu herstellbar** — bis auf `announced_*`. Und genau deshalb: `announced_*` ist der einzige echte Zustand, und ein Archiv ohne ihn würde nach einer Wiederherstellung **jede** Figur neu melden |

> **Daraus folgt: `offer_state` gehört DOCH ins Archiv** — nicht als
> Spiegel, sondern wegen der drei `announced_*`-Spalten. Das ist eine
> Korrektur gegenüber dem Entwurf, der sie als „ableitbar" draußen lassen
> wollte. **Entscheidung D-6:** ganze Tabelle exportieren (einfacher) oder
> nur die drei Spalten (sparsamer). Mein Vorschlag: ganze Tabelle, sie hat
> eine Zeile je Figur.

### 6.4 Prüfdateien je Migration

Für `0146` und `0147` je das volle Paket nach dem Muster von `0145`:
Preflight, Postflight, Rücknahme, `operations/`-Hüllen für Staging und
Production, Probelauf in `tools/validate-check-sql.mts`, Eintrag in
`APPLIED.md`, `npm run sums:write`. Für `0147` zusätzlich der
**Basis-Vertrag** (`skyisles-base-1` **und** `skyisles-coll-1`), weil sie
`profiles` anfasst — und ein Sammlungs-Vertrag, der `profiles` mitzählt, ist
eine eigene kleine Erweiterung.

---

## 7. Testplan und Abnahmekriterien

**Messbar heißt: eine Zahl oder ein Zustand, der vorher benannt ist.**

### 7.1 Probelauf an echtem PostgreSQL (`validate-check-sql.mts`, P53/P54)

| # | Aufbau | Abnahme |
|---|---|---|
| 1 | Figur ohne kaufbares Angebot, ein Nutzer hat sie vorgemerkt. Angebot wird gelistet, Stufe 1, 31 Minuten vorspulen, Stufe 2 | **genau 1** Zeile, `kind = 'available'`, `price_cents` = der Preis |
| 2 | Stufe 2 noch zweimal aufrufen | immer noch **genau 1** Zeile |
| 3 | Dasselbe, aber nur **29 Minuten** vorgespult | **0** Zeilen (Karenzzeit) |
| 4 | Kaufbar. `reserved` auf `quantity` setzen, Stufe 1, 1 min, `reserved` zurück, Stufe 1, 31 min, Stufe 2 | **0** Zeilen (Flattern) |
| 5 | Zwei Angebote, 20,00 € und 15,00 €. Das günstige ausverkauft, Stufe 1, 31 min, Stufe 2 | **0** Zeilen, aber `announced_cents = 2000` |
| 6 | Danach das günstige zurück, Stufe 1, 31 min, Stufe 2 | **genau 1** Zeile `price_drop`, `price_cents = 1500` |
| 7 | Preis von 15,00 auf 14,80 (20 Cent, unter der Schwelle) | **0** Zeilen |
| 8 | Preis von 15,00 auf 14,00 (1,00 €, über 50 Cent und über 5 %) | **genau 1** Zeile |
| 9 | `price_percentage` von 90 auf 80 — **alle** automatischen Preise sinken | Zeilen **nur** für vorgemerkte Figuren; Anzahl = Anzahl der Favoriten über der Schwelle, **nicht** Katalogzeilen |
| 10 | `market_price` eines Imports ändert 500 Zeilen | ebenso; Stufe 1 bleibt **ein** Statement |
| 11 | Basisfigur und Legendary beide vorgemerkt, nur die Legendary wird verfügbar | **genau 1** Zeile, und zwar auf der Legendary-SKY-ID |
| 12 | `notify_available = false` | **0** Zeilen, aber `announced_buyable` fortgeschrieben |
| 13 | Favorit entfernt, dann Figur verfügbar | **0** neue Zeilen; eine ältere Zeile bleibt |
| 14 | Stufe 1 zweimal in derselben Sekunde | der zweite Lauf meldet `0` Änderungen (Drosselung) |
| 15 | Stufe 2 als Betriebskonto | **0**, keine Ausnahme |
| 16 | Rücknahme `R0147` mit Zeilen in `favorite_notifications` | **bricht ab**, wie `R0145` |

### 7.2 Funktionale RLS-Prüfung (`verify:rls:staging`, Abschnitt 11)

Zwei echte Sammlerkonten, nach dem Muster von Abschnitt 10:

| Abnahme |
|---|
| A sieht **nur** die eigenen Meldungen; `count` = die für A erzeugten, **0** fremde |
| A liest B's Meldung über `eq("user_id", idB)` → **0 Zeilen** |
| A setzt `read_at` auf B's Meldung → **0 Zeilen geändert**, und B's Zeile ist danach **von B gelesen** unverändert |
| A ändert ein **anderes** Feld der eigenen Zeile (`kind`, `price_cents`) → **abgewiesen** (`42501`, Spaltenrecht) |
| A legt eine Meldung an (`insert`) → **abgewiesen** (`42501`), auch für sich selbst |
| A löscht eine Meldung → **abgewiesen** |
| `anon` liest / schreibt → **abgewiesen** |
| `offer_state` für `authenticated` und `anon` → **abgewiesen** |
| `sync_favorite_notifications()` als B erzeugt Zeilen **nur** für B |
| Konto A löschen → A's Meldungen **0**, B's unverändert |

### 7.3 Browser, Desktop und Telefon

| Abnahme |
|---|
| Zahl am Navigationspunkt „Favoriten" = Anzahl ungelesener Meldungen, **gezählt gegen die Datenbank** |
| Eine Zeile antippen → `read_at` gesetzt, Zahl sinkt um **genau 1**, Ziel ist die Figurenseite |
| „Alle gelesen" → Zahl **0**, Abschnitt verschwindet |
| Telefonbreite 360 px: drei Navigationspunkte, die Zahl bricht die Leiste **nicht** um |
| Posteingang mit 20 Meldungen: kein horizontales Scrollen, Zeilenhöhe ≥ 44 px |
| Einstellung ausschalten → nach einem neuen Ereignis **keine** neue Zeile |

### 7.4 Nichts anderes hat sich bewegt

| Abnahme |
|---|
| Der Basis-Vertrag der Nachkontrolle: **alle sieben** Shop-Werte unverändert |
| Der Sammlungs-Vertrag: **alle drei** unverändert |
| Ein Kauf über `/checkout` geht durch, während Stufe 1 läuft |
| **Kein Trigger** auf `shop_inventory`, `skylanders` oder `shop_settings` kommt dazu — geprüft am Schema, nicht am Vorsatz |
| `shop_offers()` ist **zeichengleich** unverändert (md5 des Rumpfs) |
| Orderbuch, Lager, Kalkulation, Nachfrageanzeige: Testsuite grün, `9999 = 0` |

---

## 8. Risiken, offene Entscheidungen, einfachere Alternativen

### 8.1 Risiken

| Risiko | Schwere | Abwehr |
|---|---|---|
| **Ohne Besucher läuft nichts** | mittel | Bei In-App-only kein Verlust (3.4). Wird es eines, ist der Weg ein Scheduler, der dieselben zwei Funktionen ruft (3.5) |
| Stufe 1 wird zur Last, wenn das Lager wächst | niedrig | Ein Statement über ~290 Zeilen, gedrosselt auf 1/min. Bei 10 000 Zeilen immer noch ein Statement |
| Die Schwelle ist falsch gewählt | mittel | Sie steht in `shop_settings`, nicht in einer Funktion — ändern kostet keine Migration |
| Ein Nutzer mit 500 Favoriten | niedrig | Stufe 2 ist ein Join über seine Favoriten; die Decke von `favorite_demand()` (2000) ist der Vergleichsmaßstab |
| `announced_*` geht bei einer Wiederherstellung verloren | **hoch** | Genau deshalb gehört `offer_state` ins Archiv (6.3). Ohne sie würde nach einem Wiederaufbau **jede** Figur neu gemeldet |
| Eine Meldung wird kurz nach dem Absenden falsch (jemand kauft) | niedrig | Sie **war** wahr. Die Oberfläche zeigt den Zeitpunkt, die Karte daneben die Gegenwart |

### 8.2 Entscheidungen, die der Betreiber treffen muss

| # | Frage | **Entscheidung des Betreibers (2026-10-25)** | Stand |
|---|---|---|---|
| **D-1** | Karenzzeit | **30 min**, abgeleitet aus `reservation_ttl()` + 10 | **gebaut** in `0147` als `offer_availability_grace()` — keine Zahl im Code, sondern `reservation_ttl() + interval '10 minutes'`. Gerechnet wird gegen `buyable_since`, nicht gegen `changed_at` |
| **D-2** | Preisschwelle | **max(0,50 €, 5 %)** gegenüber dem maßgeblichen Vergleichspreis | S2 |
| **D-3** | Tagessperre je Figur für B | **nein** in V1 | S2 |
| **D-4** | Vorgaben der zwei Schalter | neue Verfügbarkeit **an**, Preissenkung **aus** — *weicht von meinem Vorschlag ab* | S2 |
| **D-5** | Hinweis an einzelnen Favoritenkarten | **nein** | S4 |
| **D-6** | `offer_state` in der Plattformsicherung | **vollständig**, später Pflicht | vorbereitet: `0146` trägt `announced_*`, der Ausschluss nennt seinen Ablauf |
| **D-7** | Migrationsreihenfolge | nach den tatsächlich vorhandenen Tabellen und Abhängigkeiten | `0146` legt an, die Folgemigration exportiert — Variante (a) aus 6.2 |
| **D-8** | Zähler am Navigationspunkt | **„Favoriten"**, keine Glocke | S4 |

**Für S1 relevant waren D-6 und D-7.** D-6 ist der Grund, warum die drei
`announced_*`-Spalten schon jetzt in der Tabelle stehen und nicht erst mit
S2 dazukommen: eine Spalte nachzurüsten ist eine Migration, und der
Ausschluss aus dem Archiv muss bis dahin seinen Ablauf benennen. D-7 ist der
Grund für die Reihenfolge *anlegen, dann exportieren*.

### 8.3 Die einfachere Alternative, falls das zu viel ist

**„Neu seit deinem letzten Besuch", ohne Posteingang.** Ein
Zeitstempel je Nutzer (`profiles.favorites_seen_at`), und `/favoriten`
hebt die Figuren hervor, die seit dann verfügbar wurden.

| | |
|---|---|
| Kosten | **eine** Spalte, **keine** neue Tabelle, keine Meldungszeilen |
| Was fehlt | kein Verlauf, keine Einzelquittierung, keine Preissenkung (dafür bräuchte es den gemeldeten Preis — also doch `offer_state`) |
| Wann sinnvoll | wenn A allein genügt und B warten kann |

Sie ist **kein Zwischenschritt**: wer später B will, baut `offer_state`
ohnehin. Ich empfehle sie nur, wenn B gestrichen wird.

---

## 9. Implementierung in kleinen Schritten

Jeder Schritt ist für sich prüfbar und für sich zurücknehmbar.

| Schritt | Inhalt | Prüfbar durch |
|---|---|---|
| **S1** | **GEBAUT (2026-10-25).** `0146`: `offer_state`, die Sicht `offer_state_live`, `refresh_offer_state()`, `offer_state_window()` — **nur der Spiegel**, keine Meldungen, keine Oberfläche. **Nirgends angewendet.** | Probelauf **P53** (sechzehn Szenarien an echtem PostgreSQL), `src/lib/favorites/offer-state.test.ts` (48 Tests), Preflight und Postflight `0146`. **Noch offen:** eine Woche auf Staging mitlaufen lassen und die Drift gegen `offer_state_live` prüfen |
| **S2** | `0147`: `favorite_notifications`, die zwei `profiles`-Spalten, `sync_favorite_notifications()` — **ohne Oberfläche** | Probelauf P54, `verify:rls:staging` Abschnitt 11 |
| **S3** | Exportmigration: `favorites`, `favorite_notifications`, `offer_state` ins Plattformarchiv, Formatversion 3 | `verify:platform-archive`, Bereichszahl, beide Vollständigkeitswächter |
| **S4** | Oberfläche: Zahl in der Leiste, Posteingang auf `/favoriten`, Quittieren | DOM-Tests mit echten Klicks (Muster `favorite-interaction.test.tsx`), Browser-Durchlauf |
| **S5** | Die zwei Schalter unter `/account` | Tests + Browser |
| **S6** | Production-Rollout in der Reihenfolge aus 6.2 | Preflight/Postflight je Migration, `9999 = 0` |

**S1 zuerst und ohne Wirkung** ist Absicht: der Spiegel soll beobachtet
werden, bevor er etwas auslöst. Ein Fehler in S1 ist eine falsche Zeile in
einer Hilfstabelle; derselbe Fehler in S2 wäre eine falsche Meldung an einen
Nutzer.

---

## Anhang · Was dieses Konzept ausdrücklich nicht vorsieht

* **Kein Wunschpreis.** Ausdrücklich nicht Teil dieser Phase. Er bräuchte
  `favorites.target_cents` und damit ein `update`-Recht auf `favorites`, das
  `0145` bewusst nicht erteilt — die einzige Stelle, an der eine
  Sicherheitsgrenze verschoben würde.
* **Keine E-Mail, kein Push, kein externer Dienst.**
* **Kein Trigger**, nirgends. Begründung in 1.6 und 3.1.
* **Keine Marktplatzstruktur.** Kein `seller_id`, kein Fan-out je Verkäufer,
  keine Überwachung fremder Angebote. ADR-0021 bleibt unberührt.
* **Keine Realtime-Verbindung.** Der Zähler wird beim Seitenaufbau gelesen,
  wie `Unread` seit `0098`.
* **Kein Preisverlauf.** `price_history` steht in `docs/DATABASE.md`
  Abschnitt 7 und ist ein eigenes Vorhaben; `announced_cents` ist genau so
  viel Gedächtnis, wie B braucht.
