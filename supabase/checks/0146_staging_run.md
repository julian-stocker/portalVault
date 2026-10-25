# `0146` auf Staging — die Anleitung

**Angewendet am 2026-10-25.** Phase 4, Schritt **S1**: der Angebotsspiegel.
Die Nachkontrolle ist **offen** — siehe „Stand" gleich unten.

> **Was S1 tut:** einen Spiegel der Angebotslage anlegen und ihn auffrischen
> können. **Was S1 nicht tut:** eine Benachrichtigung erzeugen. Keine
> Oberfläche, keine Einstellung, keine Zeile für einen Nutzer.

---

## Stand

| | |
|---|---|
| Preflight | **9999 = 0** |
| Migration | **angewendet**, eine Transaktion, `commit` |
| Nachkontrolle | **9999 = 18** — und zwar ausschließlich die achtzehn Zeilen der Baseline-Übergabe (801–804, 811–817, 821–824, 831–833) |
| Zu tun | die Nachkontrolle **einmal wiederholen**, mit den eingefrorenen Baselines |
| Fünf weitere Hürden, alle behoben | TLS (die private CA des Poolers fehlte, ADR-0138) · die Leserechte der zwei Datenzeilen · der Funktionsaufruf in Zeile 142 (beides ADR-0139) · die verlorene Erteilung auf `shop_offers()` (ADR-0140) · `information_schema` ist rechtegefiltert und meldete „(keine Tabelle)" (ADR-0141) |

### Eine Voraussetzung, einmalig

`0139` hat `shop_offers()` am 2026-10-20 mit `drop function` neu angelegt, und
**`DROP`+`CREATE` verwirft die ACL.** Die Erteilung an den Prüfzugang ist
dadurch verloren gegangen. Im Staging-SQL-Editor wiederherstellen:

```sql
grant execute on function public.shop_offers() to skyisles_agent;
```

Danach einmal messen — das aktualisiert die versionierte Aufnahme, auf der die
Probeläufe stehen:

```bash
npm run db:privileges:staging      # erwartet: keine Abweichung
```

**Ohne diesen Schritt läuft die Nachkontrolle trotzdem durch** (nichts bricht
ab), aber die Baselinezeilen 811/812 bleiben **offen** — der Vergleich „der
Shop hat sich nicht verändert" findet dann erst im berechtigten Lauf statt.

### Warum achtzehn

Nicht weil der Spiegel falsch wäre, sondern weil die Nachkontrolle **nichts
hatte, womit sie vergleichen konnte.** Sie prüft unter anderem, dass die
Migration an Shop, Lager und Sammlung nichts verändert hat; dafür braucht sie
die beiden Vertragszeilen des Preflights — den Stand **vor** der Migration.
Die Hülle brachte an deren Stelle Platzhalter mit, die ein Mensch ersetzen
muss. Dieser Schritt ist übersprungen worden, und ein stehengelassener
Platzhalter zählt als **fehlende** Baseline.

Also: **die Riegel haben funktioniert, der Ablauf war der Fehler.** Dasselbe
war bei `0145` passiert. Zweimal derselbe Handgriff, zweimal vergessen — das
ist keine Unachtsamkeit, das ist ein schlechter Ablauf.

**Behoben.** `npm run db:migrate:staging` nimmt die Übergabe jetzt selbst vor
(ADR-0137). Es gibt keinen Platzhalter mehr zu ersetzen.

---

## Der Weg jetzt: ein Befehl

```bash
npm run db:migrate:staging -- 0146            # prüft, friert ein, hält an
#   … die eine Anweisung in den SQL-Editor einfügen …
npm run db:migrate:staging -- 0146 --resume   # Nachkontrolle
```

Der Runner prüft das Zielprojekt, fährt den Preflight, friert dessen Zeilen
900 und 901 **unveränderbar** nach `supabase/baselines/baseline-0146.json`
ein, bricht bei jeder Abweichung ab — und reicht die eingefrorenen Zeilen der
Nachkontrolle in derselben Einreichung mit. Er kann die Migration selbst
**nicht** anwenden; warum nicht, steht im Kopf von
`tools/db-migrate-staging.mts`.

### Für `0146` jetzt: nur die Nachkontrolle

Die Migration liegt schon. Der Runner erkennt das (`public.offer_state`
steht) und **weigert sich, sie erneut anzuwenden**; ohne `--resume` bricht er
mit genau diesem Hinweis ab. Die Baselines des damaligen Preflights sind in
der Akte **nachgetragen** — sie stammen aus dem Protokoll des Preflights, der
**vor** der Migration lief, nicht aus einer nachträglichen Messung. Das steht
in der Akte selbst (`herkunft: "bediener"`, Feld `bemerkung`).

```bash
npm run db:migrate:staging -- 0146 --resume
```

**Erwartet: Zeile 9999 = `0`** und **drei offene Zeilen** (124, 142, 161) —
sofern `execute` auf `shop_offers()` wiederhergestellt ist. Fehlt es, kommen
811, 812 und 312 dazu (sechs), und der Basis-Vertrag wird dann nicht
automatisch verglichen.

> **Drei Zeilen laufen nicht über diesen Zugang (ADR-0139).** 124 und 161
> lesen `offer_state_live` bzw. `offer_state`, 142 **ruft**
> `offer_state_window()` auf. Auf keines davon erteilt `0146` ein Clientrecht
> — der lesende Prüfzugang hat es auch nicht. Sie melden deshalb
> `KEIN-RECHT`, zählen in **Zeile 9998** und sind damit **offen**: nicht
> bestanden, nicht abgewichen, sondern nicht durchgeführt. Der erste Lauf
> scheiterte daran noch vollständig (`permission denied for view
> offer_state_live`), weil PostgreSQL die Rechte aller Relationen eines Plans
> beim Ausführungsstart prüft.
>
> **So schließen Sie sie ab:** der Runner schreibt
> `supabase/log/staging/0146-postflight-berechtigt.sql` — dieselbe Prüfdatei,
> Baselines schon eingesetzt, `begin … rollback`. Vollständig markieren, in
> den SQL-Editor von `qqxcpesbwfxzgytkdsac` einfügen, ausführen. Dort ist
> **9998 = 0 und 9999 = 0**.

> **Voraussetzung, einmal je Rechner (ADR-0138):** die CA des Poolers muss
> unter `~/.skyisles/supabase-ca.crt` liegen, und die Zugangsdatei muss
> `sslmode=verify-full` nennen. Fehlt eines davon, bricht der Runner **vor**
> jeder Verbindung ab und druckt die Anleitung. Der erste Lauf am 2026-10-25
> scheiterte genau daran — `self-signed certificate in certificate chain`,
> weil die private Wurzel von Supabase in keinem öffentlichen
> Vertrauensspeicher steht. Einrichtung: `staging_agent_access_plan.md`,
> Schritt 3b. Die untenstehende Tabelle zu Schritt 3 bleibt
das Abnahmeraster.

---

## Die Schritte im Einzelnen

Was folgt, ist das fachliche Raster — unverändert gültig, auch wenn der
Runner die Handgriffe jetzt übernimmt.

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

Zeile **900** und **901** sind die beiden Vertragszeilen. Über den Runner
werden sie automatisch eingefroren; von Hand vollständig kopieren.

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

Über den Runner (`--resume`) braucht es hier **keinen Handgriff**: die
beiden Vertragszeilen kommen aus der Akte und werden in derselben Einreichung
mitgereicht.

Von Hand — nur noch der Rückfallweg, und auf Production der einzige Weg —
sind vorher zwei Stellen zu ersetzen: `BASIS-HIER-EINSETZEN` ← Zeile 900,
`SAMMLUNG-HIER-EINSETZEN` ← Zeile 901. Ein stehengelassener Platzhalter
zählt als **fehlende** Baseline und blockiert; genau das ist am 2026-10-25
passiert. **Für Production frisch auf Production messen** — eine
Staging-Baseline hier einzusetzen verglich Production gegen die Zahlen einer
anderen Datenbank.

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
