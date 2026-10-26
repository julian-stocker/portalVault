# Laufzettel `0150` — Verfügbarkeitsalarme (Fire and forget, ADR-0147)

**Stand 2026-10-26. Nicht gefahren. Nirgends angewendet.**
Freigegeben war M2: schreiben, prüfen, liegen lassen.

> **Dieser Lauf ist noch nicht freigegeben.** Er steht hier vollständig, damit
> die Freigabe eine Entscheidung über etwas Fertiges ist und nicht über eine
> Absicht.

---

## Was dieser Lauf tut, in einem Satz

Er legt `public.availability_alerts` an — eine Tabelle, in der **eine Zeile
Vormerkung und Meldung zugleich trägt** —, drei Teilindizes und vier
Definer-Funktionen. Danach steht der Mechanismus und ist **vollständig
stumm**: es gibt **kein Aufrufer** für `fire_availability_alerts()`. Das ist
Absicht (M4 ist eine eigene Freigabe) und die Lehre aus ADR-0145 in der
umgekehrten Richtung — dieser Schritt soll beobachtbar sein, bevor er etwas
auslöst.

## Was er ausdrücklich NICHT tut

Keine Karenzzeit · kein Spiegelzustand · kein Blick auf `favorites` · kein
Trigger · kein Scheduler · keine E-Mail · kein Push · kein Preisalarm · keine
Einstellung · keine Oberfläche. Und **er baut nichts zurück**: `0146`–`0149`
bleiben unberührt stehen; ihr Rückbau ist ein eigener Schritt mit eigener
Freigabe (ADR-0147).

## Die eine Voraussetzung

`0150` setzt von `0146` **nur die Sicht** `public.offer_state_live` voraus —
nicht die Tabelle `offer_state`, nicht `favorites`, nicht
`availability_notifications`. Die Sicht ist die einzige zustandsfreie
Definition von „jetzt kaufbar"; eine zweite aufzustellen ist ausgeschlossen
(`src/lib/shop/offer.ts`). Die Hülle prüft das selbst und bricht mit
`ABBRUCH A2` ab, bevor sie etwas ändert.

> **Für Production ist daraus eine offene Entscheidung geworden:** dort liegt
> `0146` nicht. Der Rollout verlangt also entweder `0146` vorher — dann steht
> der ungenutzte Spiegel dort vorerst mit — oder eine eigene Migration, die
> nur die Sicht anlegt. Nicht Teil dieses Laufs.

---

## Reihenfolge

| # | Schritt | Datei | Erwartet |
|---|---|---|---|
| 1 | Stand prüfen und Baselines einfrieren | `npm run db:migrate:staging -- 0150` | fährt `0150_preflight.sql`, friert `skyisles.base` und `skyisles.coll` ein, **hält an** |
| 2 | Preflight lesen | `supabase/checks/0150_preflight.sql` (vom Runner gefahren) | **Zeile 9999 = `0`**. Offene Zeilen sind erwartet: 121–124 lesen `offer_state_live`, `favorites`, `offer_state` und `availability_notifications`, und der Prüfzugang darf keines davon |
| 3 | **Die eine schreibende Anweisung** | `supabase/operations/staging-0150.sql` | vollständig markieren, in den SQL-Editor von `qqxcpesbwfxzgytkdsac` einfügen, ausführen. Erwartet: die `NOTICE`-Zeile `0150 ok: …` und `commit` |
| 4 | Nachkontrolle | `npm run db:migrate:staging -- 0150 --resume` | fährt `0150_postflight.sql` **mit genau den Baselines aus Schritt 1**. **Zeile 9999 = `0`** |
| 5 | Der berechtigte Lauf | `supabase/log/staging/0150-postflight-berechtigt.sql` (vom Runner erzeugt) | als `postgres` im SQL-Editor. **`9998 = 0` und `9999 = 0`** — hier wird Zeile 106 („KEIN Alarm steht") zur blockierenden Prüfung |

**Schritt 3 ist der einzige schreibende.** Der Prüfzugang darf bewusst nicht
schreiben; alles Lesende und Rechnende fährt der Runner.

## Was die Nachkontrolle beweist

| Zeilen | Zusage |
|---|---|
| 101–106 | sieben Spalten in dieser Folge, `id` als **GENERATED ALWAYS**, Primärschlüssel `(id)`, beide Fremdschlüssel mit der richtigen Richtung, drei CHECKs — und **kein einziger Alarm** |
| 111–121 | RLS an, **eine** Richtlinie (nur lesen, nur das Eigene), `authenticated` genau `SELECT`, `anon` nichts, vier Definer-Funktionen mit leerem `search_path`, kein `EXECUTE` für `anon`/`PUBLIC`, `proacl` nicht NULL, Identitätssequenz ohne Clientrecht |
| **131** | `availability_alerts_open_uniq` ist **eindeutig UND partiell** — er **ist** die Regel „ein offener Alarm je Konto und Figur". Ohne das Prädikat wäre er eine andere Regel: dann verhinderte ein abgeschlossener Alarm für immer einen neuen |
| **134** | `fire_availability_alerts()` nennt `auth.uid()` **genau einmal** — in der Zählung, nie im `update`. Das ist die Zusage an den späteren Scheduler: ohne Nutzerkontext löst er **vollständig** aus und gibt `0` zurück |
| **137** | `acknowledge_availability_alerts()` trifft die `id` und trägt `read_at is null` — ereignisgenau, historische Meldungen unberührt |
| 133, 138 | der Abgleich ist **eine** Anweisung; **kein** Trigger auf der Tabelle und keiner an den Shopquellen |
| 141–143 | `offer_state_live` und `shop_offers()` stehen; die alte Bauform ist **Auskunft ohne Erwartung** — sie darf fehlen und darf sich nicht bewegen |
| 811–817, 821–833 | Shop, Lager und Sammlung **Ziffer für Ziffer wie vor dem Lauf** |

## Was vorher schon bewiesen ist, ohne Datenbank

**Probelauf P58** (`npm run verify:check-sql`) fährt `0150` an echtem
PostgreSQL — und zwar in einer Welt **ohne** `favorites`, `offer_state` und
`availability_notifications`, also so, wie Production aussieht. Durchlaufen
werden: die drei Antworten beim Scharfstellen (`armed` / `already_open` /
`buyable`), der Teilindex je Konto, Auslösung ohne Karenzzeit mit dem
richtigen Preis in Cent, dreimal nachgefeuert ohne neue Meldung und ohne
verschobenes `notified_at`, der Abgleich **ohne Nutzerkontext**,
ereignisgenaues „Gesehen" samt leerer Liste und fremder `id`, erneuter Alarm
erst bei neuer Nichtverfügbarkeit, beide CHECKs, RLS mit zwei echten Konten,
und die Rücknahme in beiden Richtungen.

Dazu `src/lib/availability/alerts-schema.test.ts`: dieselben Zusagen an der
**Quelle** gelesen, damit sie nicht aus dem Text verschwinden können.

## Wenn etwas schiefgeht

**Eine Transaktion.** Bricht Schritt 3 ab, ist nichts entstanden — die Hülle
klammert in `begin` / `commit`, und jede Vorbedingung schlägt **vor** der
ersten Änderung zu. Lesend bestätigen: `to_regclass('public.availability_alerts')`
ist `null` und keine der vier Funktionen steht.

**Rücknahme:** `supabase/rollback/R0150_drop_availability_alerts.sql`. Sie
nimmt erst die vier Funktionen, dann die Tabelle, und sie **bricht ab,
solange eine Zeile steht** — jeder scharfe Alarm ist ein ausdrücklicher
Wunsch, und jede Meldung samt Lesezustand ist Historie, die nirgendwo sonst
neu entsteht. Wer trotzdem löschen will, setzt `v_auch_mit_daten` in der
Datei auf `true`. `offer_state_live`, `shop_offers()` und die alte Bauform
fasst sie nicht an.

## Offen nach diesem Lauf

1. **Kein Aufrufer.** Der Mechanismus ist stumm, bis M4 ihn ruft — in beiden
   Layouts (Netz) und nach den sieben Betriebsaktionen in
   `src/lib/admin/actions.ts` (Beschleuniger).
2. **Kein Scheduler.** Vor der produktiven Aktivierung Pflicht (ADR-0147);
   bevorzugt `pg_cron`, Verfügbarkeit und Rechte vorher prüfen.
3. **Keine Sicherung.** `availability_alerts` gehört ins Plattformarchiv
   (Formatversion 3) — das ist M6 und muss **vor** dem Production-Rollout
   geschehen (ADR-0136).
4. **Kein Rückbau.** `0146`–`0149` stehen weiter; ihr Abbau braucht die
   lesende Bestandsprüfung und eine eigene Freigabe (ADR-0147). Dabei zu
   beachten: `R0146` **bricht ab**, solange eine Zeile ein `announced_at`
   trägt — und die Erstbefüllung hat alle 225 als angekündigt angelegt.
