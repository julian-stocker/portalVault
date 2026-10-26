# `0147` auf Staging — die Anleitung

**Noch nicht gefahren.** Phase 4, Schritt **S2**: die Verfügbarkeitskante.

> **Was S2 tut:** erkennen, dass eine zuvor nicht kaufbare Figur wieder
> kaufbar geworden ist — mindestens 30 Minuten stabil, ohne Duplikate, mit
> späteren Zyklen. **Was S2 nicht tut:** eine Benachrichtigung schreiben,
> eine Tabelle dafür anlegen, eine Oberfläche, eine Einstellung. Und sie
> **verbraucht kein Ereignis**: `offer_availability_due()` ist `stable`.

---

## Der Weg: ein Befehl

```bash
npm run db:migrate:staging -- 0147            # prüft, friert ein, hält an
#   … supabase/operations/staging-0147.sql in den SQL-Editor einfügen …
npm run db:migrate:staging -- 0147 --resume   # Nachkontrolle
```

Voraussetzung ist dieselbe wie bei `0146` (ADR-0138, ADR-0140): die CA unter
`~/.skyisles/supabase-ca.crt`, `sslmode=verify-full` in der Zugangsdatei, und
`execute` auf `shop_offers()` für den Prüfzugang. Alles drei steht seit dem
2026-10-25 — `npm run db:privileges:staging` bestätigt es in zehn Sekunden.

---

## Schritt 1 — Preflight

> **Der erste Versuch am 2026-10-26 brach hier ab**, und zwar in der
> Migration: `ERROR P0001: 0147 ABBRUCH: 6 Trigger an den Quellen oder am
> Spiegel`. Die Prüfung **zählte** Trigger und erwartete null — die Quellen
> haben aber sechs völlig legitime (Zeitstempel, Unveränderlichkeit,
> Redaktionsprotokoll, Artikeltyp). Dieselbe Sorte Fehler wie die
> Richtlinienzahl in `0142`. Die Migration lief in **einer** Transaktion und
> hat damit **nichts** hinterlassen — lesend bestätigt: `buyable_since` fort,
> beide Funktionen fort, fünf CHECKs, `refresh_offer_state()` in der Fassung
> aus `0146`. Jetzt steht eine **benannte** Erwartung, und die sechs gehen
> durch.

**Erwartet: Zeile 9999 = `0`**, und **7 offene Zeilen** (9998 = 7): der
Prüfzugang darf `offer_state` nicht lesen und `reservation_ttl()` nicht
aufrufen. Das ist kein Mangel, sondern die Lage seit ADR-0139.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| **101–103** | `true` · die acht Spalten · `5` | `0146` steht **vollständig**. `0147` ändert eine angewendete Tabelle — steht dort etwas anderes als gedacht, muss das **vorher** auffallen |
| 104–107 | `true` | Sicht, `refresh_offer_state()` (definer+volatile), `offer_state_window()`, `reservation_ttl()` |
| 108 | Auskunft | die Reservierungsdauer — daraus leitet sich die Karenzzeit ab |
| **111–114** | `0` · `true` · `true` · `true` | `0147` ist **noch nicht** da. Ein zweiter Lauf soll an seiner Vorbedingung abprallen |
| **121–126** | Auskunft | **die nützlichsten Zahlen des Blattes.** 121/122 der Spiegelstand (erwartet: **225 Zeilen, 225 kaufbar**), 123 wie viele einen gemeldeten Stand tragen (erwartet: **225**), **124** die `least()`-Fälle (Figuren mit Preisänderung seit der Erstbefüllung), **125** die kaufbaren **ohne** gemeldeten Stand — die werden nach `0147` **zu Recht** fällig |
| 131 | Auskunft | welche Trigger es gibt — erwartet die **sechs bekannten**: `shop_inventory_identity_immutable`, `shop_inventory_set_updated_at`, `skylanders_item_type_from_category`, `skylanders_log_editorial`, `skylanders_set_updated_at`, `skylanders_sky_id_immutable` |
| **132** | `0` | **kein Trigger am Spiegel** |
| **133** | `(keine)` | und an den Quellen **kein siebter**. Steht hier ein Name, ist er zu klären, bevor `0147` läuft |
| **134** | `6` | die sechs bestehenden sind da |
| 301–307 | Auskunft | die sieben Geschäftszahlen des Basis-Vertrags |
| **900 / 901** | zwei Vertragszeilen | Shop- und Sammlungs-Baseline. Der Runner friert sie selbst ein |

> **Wenn Zeile 125 nicht `0` ist**, sind seit der Erstbefüllung Figuren neu
> kaufbar geworden. Das ist kein Fehler: `0146` legt solche Zeilen
> ausdrücklich mit `announced_* = null` an, weil eine neu kaufbare Figur eine
> Neuigkeit **ist**. Sie werden nach `0147` fällig, und genau das misst Zeile
> 107 der Nachkontrolle.

---

## Schritt 2 — Die Migration

```
supabase/operations/staging-0147.sql
```

Eine Transaktion. Erwartet: die `NOTICE`-Zeile und `commit`.

> *0147 ok: offer_state hat 9 Spalten (buyable_since zuletzt), 6 CHECKs, jede
> kaufbare Zeile mit Phasengrenze, keine bereits gemeldete Zeile wieder
> fällig; offer_availability_grace() immutable und offer_availability_due()
> definer+stable, beide ohne Clientrecht; refresh_offer_state() pflegt
> buyable_since; kein Trigger, keine neue Tabelle, keine Benachrichtigung.*

Bricht sie ab, hat sie **nichts** geändert — die Vorbedingungen stehen am
Anfang derselben Transaktion.

---

## Schritt 3 — Nachkontrolle

```bash
npm run db:migrate:staging -- 0147 --resume
```

**Erwartet: Zeile 9999 = `0`** und **6 offene Zeilen** (9998 = 6). Danach die
Datei, die der Runner nennt, als `postgres` im SQL-Editor — dort **9998 = 0
und 9999 = 0**.

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| **101** | die neun Spalten, `buyable_since` als letzte | die Spalte steht, an der richtigen Stelle |
| 102 / 103 | `6` · `1` | sechs CHECKs, der neue heißt `offer_state_buyable_since_present` |
| **104** | `0` | jede kaufbare Zeile trägt eine Phasengrenze |
| **105** | **`0`** | **die wichtigste Zeile.** Keine bereits gemeldete Zeile ist durch die Nachfüllung fällig geworden |
| 106 | Auskunft | wie viele Figuren jetzt fällig sind — erwartet **`0`**, solange Zeile 125 des Preflights `0` war |
| **107** | `true` | und das sind **genau** die ohne gemeldeten Stand. Die Zusage in ihrer scharfen Form |
| 111–112 | `true` · `true` | `offer_availability_grace()` ist `immutable` und liefert `reservation_ttl() + 10 min` |
| **113** | `true` | `offer_availability_due()` ist `definer` **und `stable`** — sie *kann* kein Ereignis verbrauchen |
| 114–116 | `2` · `""` · `0` | leerer `search_path` (ausgepackt, nicht verglichen), kein Clientrecht |
| 117 / 118 | `true` · `true` | `refresh_offer_state()` pflegt `buyable_since`, rechnet gegen `reservation_ttl()`, bleibt definer+volatile |
| **121** | `0` | **kein Trigger am Spiegel** — die zentrale Zusage der Phase 4 |
| **122** | `(keine)` | und an den Quellen nur die sechs bekannten, jeder beim Namen |
| 123 | `6` | die sechs bestehenden sind noch da |
| 124 / 125 | Auskunft | Spiegelstand — muss den Zahlen 121/122 des Preflights entsprechen |
| **801–833** | unverändert | Shop, Lager und Sammlung haben sich nicht bewegt |

---

## Schritt 4 — Der eigentliche Nachweis: einmal auffrischen

```sql
select * from public.refresh_offer_state();
```

Erwartet: `ran = true`, `rows_checked = 225`, **`rows_changed = 0`** — der
Spiegel stand ja schon. Und dann:

```sql
select count(*) as faellig from public.offer_availability_due();
```

Erwartet: **`0`**. Keine der 225 Figuren ist eine Neuigkeit.

**Die Gegenprobe, wenn Sie sie sehen wollen** (verändert Lagerdaten,
deshalb nur bewusst): eine Position entlisten, `refresh_offer_state()`
aufrufen, 20+ Minuten warten, wieder listen, aufrufen — und 30 Minuten
später steht die Figur in `offer_availability_due()`. Probelauf **P55** fährt
genau das an echtem PostgreSQL, deshalb ist es auf Staging keine
Voraussetzung.

---

## Die Plattformsicherung: erst vor Production, nicht jetzt

`favorites` (`0145`) und `offer_state` (`0146`) stehen weiter in
`PLATFORM_EXCLUDED_TABLES`. Die Frage, ob das **vor** dem Staging-Rollout
aufzuheben ist, lautet: **nein — und zwar begründet.**

**Warum es vor Production zwingend ist.** Der einzige nicht wiederherstellbare
Teil des Spiegels sind die drei `announced_*`-Spalten. Ein Archiv ohne sie
würde nach einer Wiederherstellung **jede** Figur neu melden — bei echten
Nutzern wäre das genau der Schaden, den ADR-0136 benennt. Dasselbe gilt für
`favorites`: eine Wunschliste ist persönliche Nutzerdaten, und die dürfen
nicht dauerhaft aus der Sicherung fallen (Betreiberentscheidung vom
2026-10-25).

**Warum es auf Staging nicht nötig ist.** Dort gibt es zwei Testkonten und
225 gespiegelte Shopzeilen. `buyable`, `cheapest_cents`, `changed_at` und
`buyable_since` entstehen jederzeit aus `shop_offers()` neu; was eine
Wiederherstellung dort verlieren könnte, ist der gemeldete Stand von
Testfiguren an Testkonten. Kein Verlust, der eine Entscheidung begründet.

**Und warum es den Rollout nicht blockieren soll.** Die Aufnahme ins Archiv
ist die **größere** Änderung: sie braucht eine eigene Exportmigration mit
Formatversion 3, und die müsste selbst erst auf Staging validiert werden. S2
davon abhängig zu machen hieße, eine kleine additive Änderung hinter eine
große zu stellen — wegen eines Risikos, das auf Staging nicht besteht.

**Der Preis, benannt:** ein Plattformexport, der jetzt auf Staging gezogen
wird, lässt beide Tabellen **stillschweigend** weg. Wer dort eine
Wiederherstellung prüft, bekommt ein zu gutes Ergebnis.
`supabase/checks/platform_export_gap.md` führt das als offenen Punkt, und
`platform-manifest.ts` nennt bei jedem Eintrag die Bedingung, unter der er
verfällt.

**Reihenfolge für Production, unverändert:** `0144` → Folgemigration
(Formatversion 3, nimmt `favorites` **und** `offer_state` auf) → `0145` →
`0146` → `0147`.

---

## Rücknahme

```
supabase/rollback/R0147_offer_availability.sql
```

Nimmt in umgekehrter Reihenfolge zurück: Entscheidungsfunktion,
`refresh_offer_state()` auf die Fassung aus `0146`, die Spalte, die
Karenzzeit. **`announced_*` bleibt unberührt** — der gemeldete Stand gehört
`0146`.

**Was verloren geht:** die Phasengrenzen. Danach weiß niemand mehr, seit wann
eine Figur ununterbrochen kaufbar ist; nach einem erneuten `0147` beginnt die
Karenzzeit von vorn. Für die gemeldeten Zeilen ist das folgenlos. Es entsteht
**keine falsche Meldung**, nur eine spätere.

---

## Was danach aussteht

* **S3** — die dauerhaften, nutzerbezogenen Meldungen. Der Vertrag dafür steht
  im Kopf von `0147`: ein `update`, das die Fälligkeitsbedingung als `where`
  mitträgt, in derselben Transaktion wie die Meldungen. Kommt keine Zeile
  zurück, war ein anderer Aufruf schneller.
* **Die Folgemigration für die Plattformsicherung**, vor jedem
  Production-Rollout.
* **Production** für `0145`, `0146`, `0147` — in dieser Reihenfolge, und erst
  nach der Folgemigration.
