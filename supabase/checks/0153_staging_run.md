# 0153 auf Staging — der Laufzettel

`catalog_status` kommt in die Plattformsicherung (CAT-02C Teil B).
Freigegeben am 2026-10-28.

## Worum es geht

Ohne diese Migration führt `database.json` nur `catalog_visible`. Ein
Entwurf und eine versteckte Zeile sind dort **beide `false`** — der Status
lässt sich daraus nicht zurückgewinnen, und **jeder Entwurf käme nach einer
Wiederherstellung als `hidden` zurück**. Seit dem einmaligen Katalogimport
stehen **103 Entwürfe** in der Datenbank.

Die Änderung ist eine Zeile im Bereich `skylanders`:

```
  'catalog_visible', t.catalog_visible,
+ 'catalog_status',  t.catalog_status,
```

Alles andere ist Zeichen für Zeichen der Rumpf aus `0144`. **31 072 Zeichen**
gehen unverändert durch.

## Was vorher gemessen wurde

| | Befund |
|---|---|
| Rumpf heute auf Staging | `4c4d2e7c81e4efa8e18cdffa06bba40a` — die Fassung aus `0144` |
| Rumpf nach `0153` | `92c48444f99b9e294f9703d0c0ddeaa8` |
| Umkehrprobe | neuer Rumpf **minus die eine Zeile** = `4c4d2e7c…`, zeichengleich |
| `catalog_status` im heutigen Rumpf | nein — das ist der Anlass |
| Preflight gegen Staging | **40 Zeilen, `9999 = 0`, keine offene Zeile** |

**Probelauf P66** ruft die Sicherung an erfundenen Zeilen wirklich auf und
fährt einen **Umlauf**: drei Zeilen mit `public`, `hidden` und `draft`,
exportieren, löschen, aus dem Archiv wieder einspielen. Ohne `0153` fehlt
der Status im Archiv und `catalog_visible` ist bei Entwurf und versteckter
Zeile beides `false`; mit `0153` kommen alle drei Werte zurück.

## Die Schritte

1. **Preflight** (gelaufen, rein lesend):
   ```
   npm run db:migrate:staging -- 0153
   ```
   Erwartet: `9999 = 0`. Die Baselines werden dabei eingefroren und danach
   nicht mehr neu erhoben (ADR-0137).

2. **Die eine schreibende Anweisung** — vom Bediener, im SQL-Editor von
   `qqxcpesbwfxzgytkdsac`:
   ```
   supabase/operations/staging-0153.sql
   ```
   Vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**
   Erwartet: die `A5`-NOTICE mit den Statuszahlen, die NOTICE der Migration
   und `commit`.

3. **Nachkontrolle**:
   ```
   npm run db:migrate:staging -- 0153 --resume
   ```
   Erwartet: `9998 = 0` und `9999 = 0`.

## Die Wächter der Hülle

| | Was er abfängt |
|---|---|
| **A1** | falsche Umgebung — die Datei läuft nur gegen den Staging-Stempel |
| **A2** | `skylanders.catalog_status` fehlt (`0152` nicht angewendet) |
| **A3** | der Abdruck ist nicht der aus `0144` — schon der neue, der aus `0105`, oder eine unbekannte Fassung. Bricht ab, **bevor** die Transaktion etwas tut |
| **A4** | die Sicherung ist nicht `security definer`/`stable` oder trägt ein offenes `EXECUTE`-Recht |
| **A5** | kein Riegel, eine NOTICE: wie viele Entwürfe, versteckte und öffentliche Zeilen heute stehen — damit im Protokoll steht, worum es ging |

## Stoppbedingungen

Bei jeder davon abbrechen und berichten, nicht weiterfahren:

* `9999 ≠ 0` oder `9998 ≠ 0`
* `ABBRUCH A3` — dann steht eine andere Fassung da, und die ist zuerst zu klären
* `ABBRUCH A4` — ein Rechteproblem an der Sicherung gehört geklärt, **bevor**
  sie ersetzt wird
* Zeile 105 der Nachkontrolle ≠ `4c4d2e7c…` — dann ist die Umkehrprobe am
  lebenden Rumpf nicht aufgegangen, und der Rumpf ist nicht der erwartete
* Zeile 107 ≠ `31072` — dann ist mehr als die eine Zeile dazugekommen
* eine veränderte Statuszahl (131–133 gegen 131–133 des Preflights)

## Was danach offen bleibt

Die vier Spalten aus `supabase/checks/platform_export_gap.md`
(`skylanders.item_type`, `skylanders.usk_rating`,
`shop_inventory.sale_released`, `shop_inventory.delivery_scope`) und die
Bereiche `favorites` und `offer_state`. Jede ist eine eigene Entscheidung
mit eigener Freigabe.

**`0153` ist auf Production nicht anwendbar**, solange dort der Rumpf aus
`0105` steht (`2e2da90e…`). Wer das auflösen will, nimmt zuerst `0144` nach
Production.
