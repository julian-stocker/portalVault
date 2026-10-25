# Was eine Wiederherstellung von `purchase_calculations` verlangt — und wo sie nicht kann

**Stand 2026-10-25, zu Migration `0144`.** Diese Datei gehört zur Aufnahme
der gespeicherten Kalkulationen in die Plattformsicherung. Sie beschreibt
**keine** Funktion: sie beschreibt, was ein Mensch tun müsste, und wo er
scheitern würde.

---

## 0. Der Satz, der vorangeht

**Es gibt keine automatische Wiederherstellung, und `0144` baut keine.**
`restore_supported` steht im Archiv fest auf `false`, es existiert keine
Importfunktion, und für das Plattformarchiv gibt es auch kein Prüfwerkzeug
(`npm run verify:backup` prüft die *Betriebs*sicherung).

Eine Wiederherstellung heißt heute: aus `database.json` von Hand
`INSERT`-Anweisungen bilden und sie als Eigentümer im SQL-Editor einspielen.
Alles Folgende ist deshalb eine **Anleitung mit Fallstricken**, kein
getesteter Vorgang. Was automatisiert geprüft ist, ist der **Export**.

---

## 1. Die harte Grenze: `user_id` braucht ein Konto, das dieses Archiv nicht hat

```
purchase_calculations.user_id → auth.users(id)   on delete cascade
```

Das Archiv führt `auth-users.json` — und das ist ein **Inventar**, kein
Auth-Backup. Es nennt Kennung, Adresse und Zeitstempel; es enthält kein
Passwort, kein Token, keine Identität. Aus ihm entsteht **kein Konto**.

Eine wiederhergestellte Kalkulation braucht ihren Eigentümer mit **derselben
UUID**. Die kann nur die Auth-Seite von Supabase herstellen, und die liegt
außerhalb dieses Archivs.

> **Das ist nicht neu, und es ist nicht spezifisch.** Dieselbe Grenze gilt
> seit `0105` für `collection_items` und `profiles` — für jede Tabelle, die
> einem Konto gehört. `0144` fügt eine zweite Stelle hinzu, an der sie
> zählt, nicht eine neue Grenze.

**Reihenfolge, die daraus folgt:**

```
auth.users (ausserhalb dieses Archivs)
  → profiles
  → purchases
  → purchase_calculations
```

Fehlt ein Konto, bleiben zwei Wege, und beide sind Entscheidungen, nicht
Technik: die Zeile **auslassen** (die Kalkulation ist dann fort) oder sie
einem **Ersatzkonto** zuordnen (dann gehört sie jemand anderem). Es gibt
keinen dritten.

---

## 2. Die Falle: `purchase_id` zeigt auf eine Identity

```
purchase_calculations.purchase_id → purchases(id)   on delete set null
purchases.id  ist  generated always as identity
```

Wer `purchases` ohne die ursprünglichen Kennungen einspielt, bekommt **neue**
`id`-Werte — und jede `purchase_id` zeigt dann auf einen **anderen** Einkauf.
Still, plausibel und falsch.

**Was der Restore deshalb tun muss:**

1. Die `id` aus dem Archiv **ausdrücklich setzen**
   (`insert … overriding system value`, oder die Spalte vorübergehend von der
   Identity lösen).
2. Danach die **Sequenz nachziehen**
   (`setval(pg_get_serial_sequence('public.purchases','id'), max(id))`), sonst
   kollidiert der nächste echte Einkauf.
3. Erst dann `purchase_calculations` einspielen.

> **Auch das ist nicht neu:** `purchase_items.purchase_id` hat dieselbe
> Abhängigkeit seit `0053`. Neu ist, dass eine zweite Tabelle daran hängt —
> und dass eine falsche Zuordnung hier nicht nur eine Position verschiebt,
> sondern eine Kalkulation einem fremden Einkauf zuschlägt.

---

## 3. Was von sich aus schützt

| | |
|---|---|
| **`id` ist eine `uuid`**, keine Identity | Ein Restore kann sie unverändert einspielen, und `on conflict (id) do nothing` macht jeden Lauf **idempotent**. Keine Duplikate, auch nach drei Versuchen |
| **Der partielle Unique-Index** `purchase_calculations_purchase_uniq where purchase_id is not null` | Zwei Kalkulationen können nicht denselben Einkauf beanspruchen. Ein Restore, der verdoppelt, **scheitert** statt stillschweigend zu verknüpfen |
| **Die fünf CHECKs aus `0142`** | Name 1–120 Zeichen, Status aus vier Werten, Faktor 0–100, höchstens 200 Positionen, plausible Zähler. Eine beschädigte Zeile aus einer bearbeiteten JSON-Datei wird abgewiesen |
| **`lines` ist selbsttragend** | Der Schnappschuss führt `sky_id`, Name, Serie, Bild, Werte, Menge und `manual`. Eine Kalkulation bleibt lesbar, auch wenn eine Figur nicht mehr im Katalog steht — der Restore braucht `skylanders` nicht |
| **`user_id` reist mit** | Die Zuordnung ist Datenlage, nicht Richtlinie. Ein Restore läuft als Eigentümer, RLS greift dort nicht — aber die Zeile trägt ihren Besitzer selbst, also vermischt sich nichts zwischen Konten |

---

## 4. Konflikte, und was sie bedeuten

| Fall | Was passiert | Was zu tun ist |
|---|---|---|
| Dieselbe `id` steht schon | `on conflict (id) do nothing` → übersprungen | nichts. Das ist der idempotente Normalfall |
| Dieselbe `id`, aber **anderer Inhalt** | ohne `on conflict` ein Fehler; mit `do nothing` bleibt die **vorhandene** Zeile | Entscheidung: welche gilt? Niemals blind überschreiben — die Datenbank ist die operative Wahrheit, das Archiv ein Stand von gestern |
| `purchase_id` zeigt auf einen Einkauf, der nicht wiederhergestellt wurde | Fremdschlüssel verweigert | `purchase_id` auf `null` setzen. Die Kalkulation bleibt, die Verknüpfung ist fort — das ist genau die Bedeutung von `on delete set null` |
| `purchase_id` ist schon von einer anderen Kalkulation belegt | Unique-Index verweigert | Befund. Zwei Kalkulationen für einen Einkauf hat es im Betrieb nie gegeben; hier wäre eine falsche Zuordnung aus Fall 2 oben |
| `user_id` kennt niemand | Fremdschlüssel verweigert | siehe Abschnitt 1 — auslassen oder umhängen, beides eine Entscheidung |

---

## 5. Was ein Archiv der Version 1 bedeutet

Ein Archiv, das `format_version: 1` nennt, trägt **53 Bereiche** und
**keine** Kalkulationen. Das ist **kein Fehler**: es ist ein vollständiges
Archiv seiner Zeit.

- Es bleibt lesbar und prüfbar. `SECTIONS_BY_FORMAT_VERSION` kennt beide
  Versionen, und `platformArchive()` rechnet gegen die Version, die das
  Dokument selbst nennt.
- Ein Archiv, das `2` nennt und 53 Bereiche trägt, ist dagegen
  **unvollständig** und wird **abgewiesen** — es entsteht nicht. Genau diese
  stille Lücke wäre der Fehler, den `0144` schließt.
- Eine Version, die diese Codebasis nicht kennt, wird ebenfalls abgewiesen:
  wer nicht weiß, wie viele Bereiche eine Version führt, kann Vollständigkeit
  nicht bescheinigen.

---

## 6. Was damit NICHT behoben ist

Die vier bekannten **Spalten**lücken bleiben: `skylanders.item_type`,
`skylanders.usk_rating`, `shop_inventory.sale_released` und
`shop_inventory.delivery_scope` fehlen weiter im Export
(`supabase/checks/platform_export_gap.md`). `0144` nimmt sie ausdrücklich
nicht mit — das ist eine eigene Entscheidung und ein eigener Schritt.

Und es bleibt dabei: **eine Wiederherstellung ist nicht getestet, weil es
keine gibt.** Was diese Datei leistet, ist, die Fallstricke aufzuschreiben,
bevor jemand im Ernstfall darüber stolpert.
