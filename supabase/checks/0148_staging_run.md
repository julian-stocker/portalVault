# `0148` auf Staging — die Anleitung

**Noch nicht gefahren.** Phase 4, Schritt **S3**: aus einem erkannten
Verfügbarkeitsereignis werden persönliche Meldungen.

> **Was S3 tut:** je betroffenem Nutzer genau eine Meldung speichern, durch
> RLS geschützt. **Was S3 nicht tut:** keine E-Mail, kein Push, kein
> Preisalarm, kein Scheduler, keine Einstellung — und **keine Oberfläche**.
> Anzeige, Ungelesen-Zähler und „als gelesen markieren" sind S4, weshalb die
> Tabelle noch **keine `read_at`-Spalte** hat.

---

## Der Weg: ein Befehl

```bash
npm run db:migrate:staging -- 0148            # prüft, friert ein, hält an
#   … supabase/operations/staging-0148.sql in den SQL-Editor einfügen …
npm run db:migrate:staging -- 0148 --resume   # Nachkontrolle
```

Voraussetzung wie bei `0146`/`0147`: CA unter `~/.skyisles/supabase-ca.crt`,
`sslmode=verify-full`, `execute` auf `shop_offers()`.
`npm run db:privileges:staging` bestätigt es in zehn Sekunden.

---

## Schritt 1 — Preflight

**Erwartet: Zeile 9999 = `0`**, dazu offene Zeilen (9998 > 0): der Prüfzugang
darf `favorites`, `offer_state` und die neue Tabelle nicht lesen und
`offer_availability_due()` nicht aufrufen.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| 101–105 | `true` ×5 | `0145`, `0146` und `0147` stehen **vollständig** — Favoriten, Spiegel mit neun Spalten, `offer_availability_due()` als `definer`+**`stable`**, die Karenzzeit, `is_collector_account()` |
| **106** | `3` | `favorites` hat seine **drei** Richtlinien aus `0145`. Fehlt eine, ist das vor `0148` zu klären |
| **111–113** | `true` · `true` · `0` | `0148` ist **noch nicht** da, und kein Trigger auf `favorites` oder `offer_state` |
| **121–124** | Auskunft | **die nützlichsten Zahlen.** 122: wie viele Ereignisse fällig sind. **123: wie viele Favoriten davon betroffen wären — so viele Meldungen entstehen beim ersten Aufruf.** Erwartet nach dem 0147-Rollout: **`0` und `0`**, weil der Spiegel vollständig gemeldet ist |
| 301–307 | Auskunft | die sieben Geschäftszahlen |
| **900 / 901** | zwei Vertragszeilen | der Runner friert sie selbst ein |

---

## Schritt 2 — Die Migration

```
supabase/operations/staging-0148.sql
```

Eine Transaktion. Erwartet:

> *0148 ok: availability_notifications steht (5 Spalten, PK (user_id, sky_id,
> buyable_since) als Duplikatschutz, RLS an, EINE Richtlinie, authenticated
> nur SELECT, nichts für anon), claim_availability_notifications()
> definer+volatile als EINE Anweisung nur für authenticated, kein Trigger, 0
> Meldungen. Keine E-Mail, kein Push, kein Preisalarm, kein Scheduler, keine
> read_at-Spalte.*

Bricht sie ab, hat sie **nichts** geändert — die Vorbedingungen stehen am
Anfang derselben Transaktion.

---

## Schritt 3 — Nachkontrolle

```bash
npm run db:migrate:staging -- 0148 --resume
```

**Erwartet: Zeile 9999 = `0`.** Danach die vom Runner genannte Datei als
`postgres` → **9998 = 0 und 9999 = 0**.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| 101–102 | `true` · die fünf Spalten | die Tabelle steht in der richtigen Form |
| **103** | `user_id,sky_id,buyable_since` | **die wichtigste Zeile.** Der Primärschlüssel **ist** der Duplikatschutz — steht hier etwas anderes, ist „genau eine Meldung je Nutzer, Figur und Phase" nur noch eine Absicht |
| 104 | `sky_fk=r,user_fk=c` | Katalogzeile RESTRICT, Konto CASCADE |
| **105** | `0` | **keine `read_at`-Spalte** — S4 bringt sie mit |
| 106 | `0` | die Migration hat keine Meldung angelegt |
| **111–116** | `true` · `1` · `SELECT` · `true` · `SELECT` · `0` | RLS an, **eine** Richtlinie, nur `select`, sie fragt `auth.uid()` **und** `is_collector_account()`, `authenticated` hat **genau** `SELECT`, `anon` **nichts** |
| **117–119** | `true` · `""` · `0` | die Funktion ist `definer`+`volatile`, leerer `search_path` (ausgepackt), kein `EXECUTE` für `anon` |
| **121** | `true` | **der Rumpf ist EINE Anweisung.** Daran hängt die Atomarität |
| 122 / 123 | `true` · `true` | sie benutzt `offer_availability_due()`, und das `insert` liest aus dem `returning` des `update` |
| **124** | `0` | kein Trigger |
| **801–833** | unverändert | Shop, Lager und Sammlung haben sich nicht bewegt |

---

## Schritt 4 — Der eigentliche Nachweis

Der erwartete Normalfall ist **nichts**, und das ist eine gute Nachricht:

```sql
select public.claim_availability_notifications();   -- erwartet: 0
select count(*) from public.availability_notifications;  -- erwartet: 0
```

Denn der Spiegel ist seit dem `0147`-Rollout vollständig gemeldet — es gibt
kein fälliges Ereignis. **Zeile 123 des Preflights hat das vorhergesagt.**

**Wenn Sie es wirklich sehen wollen** (verändert Lagerdaten, deshalb nur
bewusst): mit einem Sammlerkonto eine Figur vormerken, deren Position
entlisten, `refresh_offer_state()` aufrufen, **20+ Minuten** warten, wieder
listen, aufrufen, **30+ Minuten** warten — und dann legt
`claim_availability_notifications()` genau eine Meldung für dieses Konto an.
Ein zweiter Aufruf legt keine weitere an.

Probelauf **P56** fährt genau diese Kette an echtem PostgreSQL, deshalb ist
sie auf Staging keine Voraussetzung.

---

## Die Plattformsicherung: wieder erst vor Production

`availability_notifications` steht mit Ablaufdatum in
`PLATFORM_EXCLUDED_TABLES` — aus demselben Grund wie `favorites` und
`offer_state`, und mit demselben Preis.

**Vor Production zwingend**, und hier sogar dringlicher als bei den anderen
zwei: diese Tabelle ist der **einzige** Teil, den eine Wiederherstellung
nicht rekonstruieren kann. Was einem Nutzer gemeldet wurde, steht nur hier —
und `offer_state.announced_*` bliebe gesetzt, also entstünden die verlorenen
Meldungen auch **nicht neu**. Der Nutzer verlöre sie endgültig.

**Auf Staging nicht nötig:** zwei Testkonten, und der gemeldete Stand von
Testfiguren.

**Reihenfolge für Production, unverändert:** `0144` → Folgemigration
(Formatversion 3, nimmt `favorites`, `offer_state` **und**
`availability_notifications` auf) → `0145` → `0146` → `0147` → `0148`.

---

## Rücknahme

```
supabase/rollback/R0148_availability_notifications.sql
```

Erst die Funktion, dann die Tabelle. **Sie löscht Meldungen und sagt vorher,
wie viele.** `offer_state.announced_*` bleibt — diese Phasen gelten also
weiter als gemeldet, und nach einem erneuten `0148` entsteht für sie **keine
neue** Meldung. Das ist die richtige Richtung: lieber eine verlorene Anzeige
als eine zweite Benachrichtigung für dasselbe Ereignis.

---

## Was danach aussteht

* **S4** — Anzeige, Ungelesen-Zähler, „als gelesen markieren". Dort kommt die
  `read_at`-Spalte, ihr `update`-Weg und der Aufruf von
  `claimAvailabilityNotifications()` beim Laden von `/favoriten`
  (`src/lib/favorites/notifications.ts` ist der vorbereitete Aufrufpunkt).
* **Die Folgemigration für die Plattformsicherung**, vor jedem
  Production-Rollout.
* **Production** für `0145`–`0148`, in dieser Reihenfolge, nach der
  Folgemigration.
