# `0146` auf Staging — die Anleitung

**Noch nicht gefahren.** Phase 4, Schritt **S1**: der Angebotsspiegel. Diese
Datei ist die Schritt-für-Schritt-Anleitung und das Abnahmeraster.

> **Was S1 tut:** einen Spiegel der Angebotslage anlegen und ihn auffrischen
> können. **Was S1 nicht tut:** eine Benachrichtigung erzeugen. Keine
> Oberfläche, keine Einstellung, keine Zeile für einen Nutzer.

---

## Schritt 1 — Preflight (lesend)

```
supabase/operations/staging-s-preflight-0146.sql
```

Vollständig markieren, Staging-SQL-Editor (`qqxcpesbwfxzgytkdsac`),
ausführen. `begin` und `rollback` stehen darin; die Datei schreibt nichts.

**Erwartet: Zeile 9999 = `0`.** Worauf es dabei ankommt:

| Zeile | Erwartet | Warum sie zählt |
|---:|---|---|
| **102** | `sky_id,condition,price,available,delivery_scope` | die `shop_offers()`-Fassung aus `0139`. Rechnet `0146` mit einer anderen Projektion als der Shop, ist der Spiegel von Anfang an falsch |
| **103** | `true` | sie filtert `is_position_sellable(i.id)` |
| 104 / 105 | `true` / `true` | der V1-Zustand über `v1_sale_condition()` |
| 107 / 108 | `true` / `00:20:00` | `reservation_ttl()` steht — daraus leitet S2 die Karenzzeit ab |
| 109 | `ALWAYS` | `available_quantity` ist weiterhin eine **generierte** Spalte |
| **110–113** | alle `true` | nichts von `0146` ist schon da |
| 121–123 | Auskunft | welche Trigger es heute gibt. **Keine Zahl** — eine feste Trigger-Anzahl wäre dieselbe Sorte Konstante, die am 2026-10-25 ein Release angehalten hat |
| **124** | `0` | keiner davon trägt `offer_state` im Namen |
| 131–134 | Auskunft | **die nützlichsten Werte dieses Blattes**: so viele Zeilen bekommt der Spiegel beim ersten Lauf |

**Zeile 900 und Zeile 901 vollständig kopieren.**

---

## Schritt 2 — Die Migration

```
supabase/operations/staging-0146.sql
```

Eine Transaktion, nichts in Teilen. Erwartet: die `NOTICE`-Zeile der
Migration und `commit`.

Die `NOTICE` nennt: *offer_state steht (8 Spalten, PK sky_id, 5 CHECKs, RLS
an, 0 Richtlinien, 0 Clientrechte), offer_state_live steht ohne Clientrecht,
refresh_offer_state() definer+volatile nur für authenticated,
offer_state_window() ohne Clientrecht, **KEIN Trigger**, 0 Zeilen.*

---

## Schritt 3 — Postflight (lesend)

```
supabase/operations/staging-s-postflight-0146.sql
```

**Vorher zwei Stellen ersetzen:** `BASIS-HIER-EINSETZEN` ← Zeile 900,
`SAMMLUNG-HIER-EINSETZEN` ← Zeile 901. Ein stehengelassener Platzhalter
zählt als **fehlende** Baseline und blockiert — das ist Absicht.

**Erwartet: Zeile 9999 = `0`.** Besonders:

| Zeile | Erwartet |
|---:|---|
| 102 | `sky_id,buyable,cheapest_cents,changed_at,checked_at,announced_buyable,announced_cents,announced_at` |
| 105 / 106 | `5` / `1` — alle CHECKs, darunter `checked_at >= changed_at` |
| 112 / 113 / 114 | `0` / `0` / `0` — keine Richtlinie, kein Tabellen- und kein Sichtrecht |
| 122 / 123 | `true` / `true` — die Sicht liest `shop_offers()` und rechnet **keinen** Preis nach |
| 134 / 135 | `1` / `""` — genau eine, leere `search_path`-Festlegung |
| 136 / 137 | `0` / `1` — kein `anon`, aber `authenticated` |
| 138 | `true` — die Funktion nennt `favorites` nicht |
| **161** | **`0`** — die Migration hat keine Zeile angelegt |
| **181** | **`0`** — kein Trigger mit `offer_state` im Namen |
| 811–817, 831–833 | **unverändert** gegenüber den Baselines |

---

## Schritt 4 — Der eigentliche Nachweis: einmal auffrischen

Das ist der Teil, den keine Prüfdatei ersetzt. **Eine Anweisung**, lesend bis
auf den Spiegel selbst:

```sql
select * from public.refresh_offer_state();
```

**Erwartet beim ERSTEN Aufruf:**

```
 ran  | reason | rows_checked | rows_changed
------+--------+--------------+--------------
 true | ran    |          <n> |          <n>
```

`<n>` muss **Zeile 131 des Preflights** sein — so viele Figuren haben ein
tatsächlich kaufbares Angebot. Weicht es ab, hat sich der Shop zwischen den
Blättern bewegt (oder der Spiegel rechnet anders als `shop_offers()`, und
dann melden statt weitermachen).

**Dann sofort noch einmal dieselbe Anweisung:**

```
 ran   | reason    | rows_checked | rows_changed
-------+-----------+--------------+--------------
 false | throttled |            0 |            0
```

Die Drosselung greift. **Und das ist die Stelle, an der ein `locked` statt
`throttled` ein Befund wäre** — es heißt, ein anderer Aufruf hält gerade das
Schloss, und bei einem Lauf von Hand gibt es keinen anderen.

### Der Blick in den Spiegel

```sql
select sky_id, buyable, cheapest_cents, changed_at, checked_at,
       announced_buyable, announced_cents
  from public.offer_state
 order by cheapest_cents nulls last
 limit 10;
```

**Erwartet nach der Erstbefüllung:**

| | |
|---|---|
| jede Zeile | `buyable = true`, `cheapest_cents` nicht `null` |
| **`announced_buyable = true`** auf **jeder** Zeile | die Erstbefüllung legt sie **bereits gemeldet** an — ein Angebot, das seit Wochen steht, ist keine Neuigkeit |
| `announced_cents = cheapest_cents` | ebenso |
| `changed_at = checked_at` | beim ersten Lauf dieselbe Sekunde |

### Und die Gegenprobe gegen die Gegenwart

```sql
select count(*) as abweichungen
  from public.offer_state_live l
  full join public.offer_state s on s.sky_id = l.sky_id
 where coalesce(s.buyable, false) is distinct from (l.sky_id is not null)
    or s.cheapest_cents is distinct from l.cheapest_cents;
```

**Erwartet: `0`.** Das ist die Driftprüfung, und sie sollte in der
Beobachtungswoche gelegentlich wiederholt werden.

---

## Schritt 5 — Was die Beobachtungswoche zeigen soll

S1 kommt absichtlich **ohne Wirkung**: ein Fehler darin ist eine falsche
Zeile in einer Hilfstabelle, derselbe Fehler in S2 wäre eine falsche Meldung
an einen Nutzer. Zu beobachten:

1. **Die Driftabfrage** aus Schritt 4 bleibt bei `0` — auch nach einem
   Verkauf, einem Wareneingang und einer Umpreisung.
2. **`changed_at` bewegt sich nur, wenn sich wirklich etwas geändert hat.**
   Nach einem reinen Seitenaufbau wandert `checked_at` und `changed_at`
   nicht.
3. **Ein Warenkorb und sein Ablauf** erzeugen zwei Kanten in `changed_at` und
   lassen `announced_*` unberührt — das ist der Flattern-Schutz, und S2 wird
   darauf aufbauen.
4. **`announced_*` bleibt unverändert**, denn S1 schreibt sie nach der
   Erstbefüllung nie.

---

## Was danach aussteht

| | |
|---|---|
| **Vor dem Production-Rollout** | die Folgemigration muss `favorites` **und** `offer_state` in die Plattformsicherung aufnehmen (Formatversion 3, ADR-0136, D-6). Ohne sie wäre der gemeldete Stand ungesichert — und ein Archiv ohne ihn würde nach einer Wiederherstellung jede Figur neu melden |
| **S2** | die Meldungen. **Und mit ihnen die Pflicht**, vor dem Schreiben gegen `offer_state_live` gegenzuprüfen: `checked_at` ist keine Frischegarantie |
| Nicht nötig | kein Scheduler, keine Edge Function, kein Cron. Der Spiegel wird von einem Seitenaufbau aufgefrischt — in S1 noch von niemandem, weil die Anwendung ihn noch nicht ruft |
