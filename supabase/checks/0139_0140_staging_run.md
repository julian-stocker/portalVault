# Laufzettel: `0139` und `0140` auf Staging

**Noch nicht ausgeführt.** Diese Datei sagt, welche Dateien in welcher
Reihenfolge in den SQL-Editor gehören und woran man erkennt, dass es
geklappt hat.

**Projekt:** Staging, `qqxcpesbwfxzgytkdsac`. Production wird **nicht**
angefasst.

---

## Was am Ende anders ist — und was nicht

| | |
|---|---|
| **kaufbar** | **nichts Neues.** Null Positionen sind freigegeben, null USK-Angaben erfasst, null Lieferumfänge gesetzt |
| Figurenangebote | **256, Abdruck `4d1d6c30…` unverändert** |
| shopfähige Katalogzeilen | **534 → 534** |
| die 13 gelisteten Spielezeilen | unverändert gelistet, unverändert bepreist — und unverändert **nicht** im Angebot |
| Sammlung | **534 sammelbar, unverändert** |
| neu | zwei Spalten auf `shop_inventory`, eine auf `skylanders`, vier Funktionen, `shop_offers()` mit fünf statt vier Spalten |
| Belegausstellung | **gesperrt**, und `0139` prüft das nach |

---

## Die fünf Schritte

Jeder Schritt wird **vollständig markiert** und in den SQL-Editor des
Staging-Projekts eingefügt. Schritt 2 und 4 brauchen eine
`begin`/`commit`-Klammer; die Prüfdateien laufen in `begin … rollback`.

### S1 — Eingangszustand lesen (rein lesend)

```
begin;
select set_config('skyisles.z0', 'staging', true);
```
dann den Inhalt von
```
supabase/checks/0139_preflight.sql
```
und danach
```
rollback;
```

**Erwartet:** Zeile **9999 = 0**. Besonders zu lesen:

* **302/303** — wie viele Zubehörpositionen heute `is_listed` und bepreist
  sind. Erwartet 13/13. **Das ist die Menge, die nicht veröffentlicht
  werden darf.**
* **401–403** — `256` Angebote, Abdruck `4d1d6c30fe0ae886ca2689bcb1fe9634`,
  `534` shopfähig.

> **Abweichung bei 401–403 heißt: nicht weitermachen.** Der Z0-Vertrag
> beschreibt den Stand vom 2026-10-20; hat sich etwas bewegt, ist das ein
> Befund und keine Panne.

### S1a — und die eine Zahl, die noch fehlt (rein lesend)

```
begin;
select set_config('skyisles.z0', 'staging', true);
```
dann
```
supabase/checks/accessory_offer_readonly.sql
```
```
rollback;
```

**Zu lesen: Zeile 402** — wie viele Zubehörartikel einen **Marktpreis**
tragen. Steht dort eine Zahl größer null, bekäme eine solche Position bei
der Freigabe **automatisch** einen Preis aus `market_price × Prozentsatz`
(ADR-0130). Das ist kein Hindernis, aber es muss vorher bekannt sein.

### S2 — `0139` anwenden

**Eine Datei, ein Einfügen.** Sie bringt `begin`, `commit` und den
Umgebungsstempel selbst mit:

```
supabase/operations/staging-0139.sql
```

Der Stempel steht **innerhalb** der Klammer: landet die Datei im falschen
Fenster, bricht sie mit `ABBRUCH A1` ab, bevor sie irgendetwas anfasst. Die
eingebettete Migration ist Zeichen für Zeichen die aus
`supabase/migrations/0139_accessory_sale_release.sql` —
`staging-oneshot.test.ts` vergleicht beides bei jedem Testlauf.

**Erwartet: zwei `NOTICE`-Zeilen.**

```
0139 Abdruck: 534 shopfaehig, 256 Angebote (md5 4d1d6c30…), N verkaufbare
      Positionen, 534 sammelbar
0139 ok: Freigabe und USK stehen, 0 Positionen freigegeben, 534 shopfaehig,
      256 Angebote unveraendert (md5 4d1d6c30…), kein Zubehoerangebot
```

**Jede Abweichung bricht ab** und rollt alles zurück — Spalten, Funktionen,
Rechte. Es gibt keinen halben Zustand.

### S3 — Endzustand lesen (rein lesend)

```
begin;
select set_config('skyisles.z0', 'staging', true);
```
dann
```
supabase/checks/0139_postflight.sql
```
```
rollback;
```

**Erwartet: Zeile 9999 = 0.** Die vier Zeilen, auf die es ankommt:

| Zeile | Erwartung |
|---|---|
| **201** | freigegebene Positionen = **0** |
| **203** | Zubehörangebote = **0** |
| **302** | Angebotsabdruck **unverändert** |
| **304** | Positionen, die am neuen Tor anders antworten als am alten = **0** |

### S4 — `0140` anwenden (Betriebssicherung)

Ebenso eine Datei:

```
supabase/operations/staging-0140.sql
```

**Erwartet:**
```
0140 Abdruck: 28 Bereiche, 353 Feldzeilen, davon N ausserhalb der zwei
0140 ok: 28 Bereiche, 356 Feldzeilen, die 26 uebrigen unveraendert
```

**Eigene Transaktion, nach `0139`.** Nicht zusammen: der Beweis von `0139`
(„nichts hat sich geändert") soll lesbar bleiben.

### S5 — der Durchstich, von Hand (schreibt eine Zeile)

Erst nach S1–S4, und nur wenn alles oben stimmt. **Ein Portal**, kein Spiel
— Spiele brauchen erst die USK-Erfassung.

```sql
-- 1. Lieferumfang angeben
select public.seller_set_delivery_scope('SKY-0615', 'loose', 'portal_cable');
-- 2. Preis setzen (falls noch keiner steht)
select public.set_shop_listing('SKY-0615', 'loose', 19.90, true, null);
-- 3. freigeben
select public.seller_set_sale_release('SKY-0615', 'loose', true);
-- 4. nachsehen
select * from public.shop_offers() where sky_id = 'SKY-0615';
```

**Diese drei Aufrufe brauchen ein angemeldetes Betriebskonto** —
`can_operate_active_seller()` liest `auth.uid()`, und im SQL-Editor ist das
NULL. Sie gehören deshalb in die **Oberfläche**, nicht in den Editor. Bis
die gebaut ist (Phase C), bleibt S5 offen.

> **Zurücknehmen geht immer:**
> `select public.seller_set_sale_release('SKY-0615', 'loose', false);`

---

## Rücknahme

In dieser Reihenfolge, **`R0140` zuerst**:

```
supabase/rollback/R0140_back_to_0136.sql     -- die Sicherung zurück auf 0136
supabase/rollback/R0139_drop_sale_release.sql -- Spalten, Tor, Funktionen fort
```

`R0139` **bricht ab**, wenn eine Position freigegeben ist, ein Lieferumfang
gesetzt ist oder eine USK-Angabe erfasst wurde — die drei gingen mit den
Spalten verloren. Erst zurücknehmen, dann rollen.

---

## Was der Probelauf schon zeigt

`npm run verify:check-sql`, **38 von 38 Durchgängen** gegen echtes
PostgreSQL (PGlite 18.6):

| | |
|---|---|
| **P34** | `0139` veröffentlicht nichts — auch nicht die gelistete, bepreiste Altlast. Und nimmt sich zurück |
| **P35** | eine freigegebene Portalposition wird zum Angebot; **nur sichtbar** reicht nicht, **nur freigegeben** reicht nicht, **ohne Lieferumfang** reicht nicht |
| **P36** | ein Spiel ohne USK bleibt draußen; mit USK 6 erscheint es; **mit Originalhülle ist es verkäuflich** |
| **P37** | die Freigabe lehnt Figur, Spiel ohne USK, USK 18, fehlenden Lieferumfang, fehlenden Preis und unbekannte Position ab — **Abschalten geht immer** |
| **P38** | `0140` braucht `0139`, nimmt dann genau drei Felder auf, und nimmt sie zurück |
| **P39** | **die zwei Einzelläufe oben** gehen nacheinander durch — und brechen auf einer Datenbank **ohne** den Staging-Stempel ab, ohne eine Spalte zurückzulassen |

**Das ist kein Lauf gegen Staging** (`open_verifications.md`, Abschnitt 3a).
Nachweis bleibt allein das Ergebnisblatt aus dem SQL-Editor.

---

## Prüfsummen

| Datei | SHA-256 |
|---|---|
| `supabase/migrations/0139_accessory_sale_release.sql` | siehe `supabase/migrations/APPLIED.md` |
| `supabase/migrations/0140_business_backup_sale_release.sql` | siehe `supabase/migrations/APPLIED.md` |
| `supabase/operations/staging-0139.sql` | `2c23a7f26ff56ec0ae981228bf11755d8d8b0ab812f27b4818a754203dc54345` |
| `supabase/operations/staging-0140.sql` | `5e578594fcc776d2962b053e712c38bba2e5221df7532f3f64d52d753727502d` |

`npm run verify:sums` vergleicht sie mit `supabase/SHA256SUMS.txt`.
