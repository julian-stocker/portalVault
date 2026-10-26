# `0149` auf Staging — die Anleitung

**Noch nicht gefahren.** Phase 4, Schritt **S4**: die Oberfläche zu den
Meldungen aus `0148` — und die eine Spalte, die sie braucht.

> **Was S4 tut:** „gelesen" von „neu" unterscheiden. Eine Spalte `read_at`,
> ein Teilindex für den Zähler, **ein** Schreibweg. **Was S4 nicht tut:**
> keine E-Mail, kein Push, kein Preisalarm, kein Scheduler, keine
> Benachrichtigungseinstellung, keine zweite Erkennung — und **kein
> `update`-Recht für Clients**.

---

## Der Weg: ein Befehl

```bash
npm run db:migrate:staging -- 0149            # prüft, friert ein, hält an
#   … supabase/operations/staging-0149.sql in den SQL-Editor einfügen …
npm run db:migrate:staging -- 0149 --resume   # Nachkontrolle
```

Voraussetzung wie bei `0146`–`0148`: CA unter `~/.skyisles/supabase-ca.crt`,
`sslmode=verify-full`, `execute` auf `shop_offers()`.
`npm run db:privileges:staging` bestätigt es in zehn Sekunden.

**Scheitert der `--resume` mit `28P01`:** die Meldung sagt jetzt selbst, ob
die **Datenbank** das Passwort verworfen hat oder der **Pooler** abgelehnt
hat, bevor sie gefragt wurde — und im zweiten Fall versucht der Runner es
genau einmal erneut. Jeder abgelehnte Versuch steht mit Zeitpunkt, Code und
Herkunft in `supabase/log/staging/anmeldeversuche.md`. **Kein Passwortwechsel
auf Verdacht**: der Test, der es entscheidet, steht in der Meldung.

---

## Die Reihenfolge von Code und Migration

**Beide Richtungen sind unbedenklich**, und das ist keine Annahme:

* **Code zuerst, Migration später.** `fetchAvailabilityNotices()` und
  `fetchUnreadNoticeCount()` nennen `read_at` ausdrücklich. Fehlt die Spalte,
  antwortet PostgREST mit einem Fehler, und beide geben ihren neutralen Wert
  (leere Liste, Zähler 0). `/favoriten` lädt dann ganz normal — nur ohne
  Abschnitt und ohne Marke.
* **Migration zuerst, Code später.** Die Spalte liegt dann ungenutzt da,
  `claim_availability_notifications()` füllt sie nicht, und niemand markiert
  etwas. Kein Zustand, der sich bemerkbar macht.

---

## Schritt 1 — Preflight

**Erwartet: Zeile 9999 = `0`**, dazu offene Zeilen (9998 > 0): der Prüfzugang
darf `availability_notifications` und `favorites` nicht lesen.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| 101–102 | die fünf Spalten · `user_id,sky_id,buyable_since` | `0148` steht **vollständig**, Primärschlüssel eingeschlossen |
| 103–106 | `true` ×4 | `claim_availability_notifications()`, RLS an mit **genau einer** Richtlinie (`true/1`), `is_collector_account()`, `offer_availability_due()` |
| **111–113** | `0` · `true` · `true` | `0149` ist **noch nicht** da: keine Spalte, keine Funktion, kein Index |
| **114** | `SELECT` | **die wichtigste Zeile dieses Blattes.** `authenticated` hat auf der Tabelle **genau** `SELECT`. Steht hier mehr, ist die Annahme falsch, auf der `0149` ihre eigene Nachprüfung aufbaut |
| **121–122** | Auskunft | wie viele Meldungen liegen und wie viele Konten betroffen sind. **Nach `0149` gelten genau so viele als ungelesen** — Nachkontrolle 105 ist derselbe Wert |
| 123 | Auskunft | Favoriten insgesamt; `0149` rührt sie nicht an |
| 301–307 | Auskunft | die sieben Geschäftszahlen |
| **900 / 901** | zwei Vertragszeilen | der Runner friert sie selbst ein |

---

## Schritt 2 — Die Migration

```
supabase/operations/staging-0149.sql
```

Eine Transaktion. Erwartet:

> *0149 ok: read_at steht (nullbar, ohne Vorgabewert, 0 Zeilen als gelesen
> geführt), Teilindex für den Zähler,
> mark_availability_notifications_read(text[]) definer+volatile als EINE
> Anweisung nur für authenticated, kein update-Recht für Clients, RLS an mit
> EINER Richtlinie aus 0148, kein Trigger. Keine E-Mail, kein Push, kein
> Preisalarm, kein Scheduler.*

Bricht sie ab, hat sie **nichts** geändert — die Vorbedingungen stehen am
Anfang derselben Transaktion (Abschnitt A der Hülle prüft `0148` zusätzlich
und bricht mit einer klaren Meldung ab, statt mitten im `alter table`).

---

## Schritt 3 — Nachkontrolle

```bash
npm run db:migrate:staging -- 0149 --resume
```

**Erwartet: Zeile 9999 = `0`.** Danach die vom Runner genannte Datei als
`postgres` → **9998 = 0 und 9999 = 0**.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| 101–103 | sechs Spalten · `timestamp with time zone` · `true` | `read_at` steht, nullbar und **ohne Vorgabewert** — NULL heißt ungelesen |
| **104** | `0` | **die Zeile, auf die es ankommt.** **Keine** Meldung ist als gelesen geführt. Ein Vorgabewert `now()` oder ein Backfill hätte eine Lesehandlung erfunden, die nicht stattgefunden hat |
| 105 | = Preflight 121 | so viele Meldungen, alle ungelesen |
| 111–112 | `true` · `true` | die Funktion steht, `definer`+`volatile`, leerer `search_path` |
| 113–115 | `1` · `0` · `true` | `authenticated` darf ausführen, **nichts** für `anon`/`PUBLIC`, und `proacl` ist **nicht NULL** (bei einer Funktion hieße NULL: `EXECUTE` für `PUBLIC`) |
| **116** | `SELECT` | **die wichtigste Sicherheitszeile.** Weiterhin **kein** `update`-Recht für Clients |
| 117–119 | `0` · `true` · `availability_notifications_select_own:r` | `anon` hat nichts, RLS ist an, und es bleibt bei der **einen** Richtlinie aus `0148` — `0149` legt **keine** Schreibrichtlinie an |
| **120** | `true` | **die Eigentümerbedingung steht im Rumpf.** RLS gilt für eine Definer-Funktion nicht, dieses `where` **ist** die Grenze |
| **121** | `true` | der Rumpf ist **EINE** Anweisung |
| 122 | `true` | der Index ist ein **Teil**index |
| **123–124** | `true` · `true` | `claim_availability_notifications()` nennt `read_at` **nicht** und ist unverändert eine Anweisung — eine neue Meldung entsteht ungelesen |
| 125–126 | `(keine)` · `user_id,sky_id,buyable_since` | kein Trigger, Primärschlüssel unverändert |
| 131–133 | `true` · `3` · `9` | `0147`, `0145` und `0146` stehen unberührt |
| **801–833** | unverändert | Shop, Lager und Sammlung haben sich nicht bewegt |

---

## Schritt 4 — Der eigentliche Nachweis

Zwei Zeilen, und beide sollen **nichts** verändern:

```sql
-- Wie viele Meldungen liegen, und wie viele davon sind neu?
select count(*) filter (where read_at is null) as ungelesen,
       count(*)                                as alle
  from public.availability_notifications;      -- erwartet: beide gleich

-- Und das Lesen hat daran nichts geändert.
select count(*) from public.availability_notifications
 where read_at is not null;                    -- erwartet: 0
```

**Die Oberfläche prüfen** (mit einem Sammlerkonto, im Browser):

1. `/favoriten` öffnen. Liegen Meldungen, steht der Abschnitt **„Wieder
   verfügbar"** über dem Raster — Bild, „*Name* ist wieder verfügbar!",
   Datum, der gemeldete Preis.
2. **Neu laden, mehrfach.** Die Karten bleiben **ungelesen** (Korallrand).
   *Das Anzeigen markiert nichts* — wird eine Karte beim Laden still, ist das
   ein Fehler und kein Komfort.
3. „Gesehen" an einer Karte: sie wird ruhiger, bleibt aber stehen, und die
   Marke am Menüpunkt **Favoriten** zählt eins herunter.
4. Ist das Angebot inzwischen weg, sagt die Karte „**Inzwischen
   vergriffen**" und der Weg heißt „Zur Figur" statt „Zum Angebot".
5. Auf dem Telefon (360 px): Bild, Text und Handlungen brechen um, nichts
   wird abgeschnitten.

Probelauf **P57** fährt die Datenbankseite davon an echtem PostgreSQL —
dreimal lesen markiert nichts, ein zweiter Klick verschiebt den Zeitpunkt
nicht, eine leere Liste markiert nichts statt alles, fremde Zeilen bleiben
unberührt.

---

## Die Plattformsicherung: wieder erst vor Production

Unverändert gegenüber `0148`. `availability_notifications` steht mit
Ablaufdatum in `PLATFORM_EXCLUDED_TABLES`, und `read_at` macht den Fall
**dringlicher**: was jemand gelesen hat, ist nirgends sonst gespeichert und
aus keiner anderen Quelle rekonstruierbar. Eine Wiederherstellung ohne diese
Tabelle zeigte alle alten Meldungen ein zweites Mal als neu.

**Auf Staging nicht nötig:** zwei Testkonten, Testfiguren.

**Reihenfolge für Production:** `0144` → Folgemigration (Formatversion 3,
nimmt `favorites`, `offer_state` **und** `availability_notifications` auf) →
`0145` → `0146` → `0147` → `0148` → `0149`.

---

## Rücknahme

```
supabase/rollback/R0149_notification_read_state.sql
```

Erst die Funktion, dann der Index, dann die Spalte — umgekehrte Reihenfolge,
weil eine `language sql`-Funktion, die eine fehlende Spalte nennt,
stehenbliebe und erst beim nächsten Aufruf scheiterte.

**Was verloren geht:** welche Meldungen jemand gelesen hat. Die Meldungen
selbst bleiben liegen und gelten danach wieder alle als neu — nach einem
erneuten `0149` zeigt die Oberfläche sie ein zweites Mal als neu. Das ist der
Preis, und er ist der kleinere: lieber eine Meldung zweimal gesehen als eine
nie.

`0148` bleibt unberührt; das Rollback misst es (Tabelle mit fünf Spalten,
eine `select`-Richtlinie, `claim_availability_notifications()`).

---

## Was danach aussteht

* **Die Folgemigration für die Plattformsicherung**, vor jedem
  Production-Rollout (Formatversion 3, ADR-0136, D-6).
* **Production** für `0145`–`0149`, in dieser Reihenfolge, nach der
  Folgemigration. Production-Hüllen für `0147`–`0149` sind noch nicht
  geschrieben.
* **Die neun Browserpunkte** der Favoritenoberfläche aus `0145`, weiter
  unbestätigt — dazu nun die fünf oben.
