# Was eine Wiederherstellung mit Varianten verlangt — und wo die Reihenfolge zählt

**Stand 2026-10-28, zu Migration `0160`.** Diese Datei gehört zur Aufnahme der
Variantenbeziehung in die Plattformsicherung. Sie beschreibt **keine**
Funktion: sie beschreibt, was ein Mensch tun müsste, wo er scheitern würde,
und welche Falle dabei besonders leise ist.

Sie ist die Fortsetzung von `supabase/checks/0144_restore_limits.md`. Die
dortigen Grenzen (`auth.users`, Identity-Spalten, Sequenzen) gelten
unverändert; hier kommt **eine** neue dazu, und sie ist von anderer Art: der
Verweis zeigt auf **dieselbe Tabelle**.

---

## 0. Der Satz, der vorangeht

**Es gibt keine automatische Wiederherstellung, und `0160` baut keine.**
`restore_supported` steht im Archiv fest auf `false`, es existiert keine
Importfunktion, und für das Plattformarchiv gibt es kein Prüfwerkzeug
(`npm run verify:backup` prüft die *Betriebs*sicherung).

Eine Wiederherstellung heißt heute: aus `database.json` `INSERT`-Anweisungen
bilden und sie als Eigentümer im SQL-Editor einspielen. Alles Folgende ist
deshalb eine **Anleitung mit Fallstricken**, kein getesteter Vorgang. Was
automatisiert geprüft ist, ist der **Export** — und seit `0159`/`0160`
zusätzlich das Verhalten der Riegel beim Einspielen, gemessen in Probelauf
**P69**.

---

## 1. Der Verweis zeigt auf dieselbe Tabelle

```
skylanders.base_sky_id ─┐
skylanders.series_code ─┴─→ skylanders (sky_id, series_code)
                            on update restrict  on delete restrict
```

Das ist neu in diesem Schema. Jeder andere Fremdschlüssel der
Plattformsicherung zeigt auf eine **andere** Tabelle, und daraus folgt eine
Einspielreihenfolge zwischen Tabellen (`series` vor `skylanders`, `profiles`
vor `collection_items`). Hier liegt die Reihenfolge **innerhalb** einer
Tabelle, und das ist der Fall, den eine Tabellenreihenfolge nicht löst.

---

## 2. Was gemessen wurde, und es ist die gute Nachricht

Gegen echtes PostgreSQL, mit der Constraint, dem CHECK und dem
Kettenschutz-Trigger aus `0159` (Probelauf **P69**):

| | Vorgang | Ergebnis |
|---|---|---|
| **A** | **EINE** `insert`-Anweisung, mehrere Zeilen, Varianten **vor** der Basisfigur | **läuft durch** |
| **B** | **ZWEI** `insert`-Anweisungen, Variante zuerst | **`23503`** — Fremdschlüsselverletzung |
| **C** | Erst alle Zeilen mit `base_sky_id = NULL`, dann ein `update` | **läuft durch**, und **0** Journalzeilen |
| **D** | `set constraints all deferred`, dann Variante zuerst | **`23503`** — die Anweisung läuft durch und **tut nichts** |

**Warum A funktioniert.** Ein nicht `deferrable` Fremdschlüssel wird nicht
nach jeder Zeile geprüft, sondern **am Ende der Anweisung**. Innerhalb einer
Anweisung ist die Reihenfolge der Zeilen damit gleichgültig — die Basisfigur
steht schon da, wenn die Prüfung läuft.

**Das ist genau die Form, die eine JSON-Wiederherstellung ohnehin hat:**

```sql
insert into public.skylanders (sky_id, …, base_sky_id)
select e ->> 'sky_id', …, e ->> 'base_sky_id'
  from jsonb_array_elements(doc -> 'data' -> 'skylanders') as e;
```

**Eine** Anweisung für den ganzen Bereich. Wer so einspielt, braucht über die
Reihenfolge der Katalogzeilen im Archiv nicht nachzudenken — und das Archiv
sortiert sie nach `sky_id`, also gerade **nicht** nach Abhängigkeit.

**Der Kettenschutz-Trigger ist dabei kein Problem**, obwohl er ein
`before`-Trigger ist und deshalb **während** der Anweisung Zeile für Zeile
feuert. Er fragt in Richtung 1, ob die genannte Basisfigur selbst eine
Variante ist; existiert sie noch nicht, findet er nichts und lässt die Zeile
durch — richtig, denn eine Kette ist das nicht. Richtung 2 erreicht er bei
einer Basisfigur gar nicht: die trägt `base_sky_id is null`, und dort kehrt
er sofort zurück.

---

## 3. Die leise Falle: `SET CONSTRAINTS ALL DEFERRED` tut hier nichts

Zeile **D** der Messung ist die wichtigste dieser Datei.

```sql
begin;
set constraints all deferred;   -- läuft durch, ohne Fehler, ohne Warnung
insert into public.skylanders … ('SKY-9002', 'SA', 'SKY-9001');  -- 23503
```

`SET CONSTRAINTS` wirkt **nur auf Constraints, die `deferrable` deklariert
sind.** `skylanders_base_same_series` ist es nicht (`0159` hat sie als
gewöhnlichen Fremdschlüssel angelegt). PostgreSQL meldet das **nicht** —
die Anweisung ist gültig und bleibt ohne Wirkung.

> **Wer also glaubt, er habe die Prüfung aufgeschoben, hat sie nicht
> aufgeschoben.** Das ist die Sorte Annahme, die mitten in einer
> Wiederherstellung auffällt, und das ist der schlechteste Zeitpunkt.

---

## 4. Die Option, die NICHT Teil von `0160` ist

Man könnte die Constraint nachträglich aufschiebbar machen:

```sql
alter table public.skylanders
  alter constraint skylanders_base_same_series deferrable initially immediate;
```

`initially immediate` heißt: am Verhalten ändert sich **nichts**, solange
niemand `set constraints` ruft. Erst dann wird die Prüfung ans
Transaktionsende verschoben, und ein zeilenweises Einspielen in beliebiger
Reihenfolge würde funktionieren.

**Das ist bewusst nicht in `0160`.** Drei Gründe:

1. **`0160` ersetzt einen Funktionsrumpf und sonst nichts.** Ihre Stärke ist
   die Umkehrprobe: neuer Rumpf minus eine Zeile ist zeichengleich der alte.
   Ein `alter table` daneben nimmt dieser Zusage nichts, aber es macht aus
   einer Migration mit einer Aussage eine mit zwei.
2. **Es ändert eine Constraint aus einer angewendeten Migration.** Nach
   CLAUDE.md ist das eine Frage mit eigener Freigabe, nicht eine Beigabe.
3. **Es wird nicht gebraucht.** Variante A löst das Problem vollständig, und
   sie ist die Form, die eine JSON-Wiederherstellung von sich aus hat.

Wer sie dennoch will: eigene Migration, eigener Preflight, eigene
Nachkontrolle. Der Preis ist gering, der Nutzen aber auch — und eine
`deferrable` Constraint, die niemand aufschiebt, ist eine Zeile Dokumentation
mehr ohne eine Zeile mehr Sicherheit.

---

## 5. Die Anleitung, wenn es einmal zählt

**Reihenfolge, die daraus folgt:**

```
series
  → categories
    → characters                  (Familien, 0002/0158)
      → skylanders               ← EINE Anweisung für alle Zeilen,
                                    base_sky_id inklusive
        → catalog_editorial, shop_inventory, collection_items, …
```

**Und wenn es doch zeilenweise sein muss** — etwa weil ein Werkzeug Zeile für
Zeile einspielt —, dann in **zwei Durchgängen**:

```sql
-- 1. Alle Katalogzeilen OHNE die Beziehung.
insert into public.skylanders (…, base_sky_id) select …, null from …;

-- 2. Die Beziehung nachziehen, in einer Anweisung.
update public.skylanders s
   set base_sky_id = a.base
  from (select …) a
 where a.sky_id = s.sky_id and a.base is not null;
```

**Das schreibt keine Journalzeile.** `log_skylander_editorial_change`
(`0004`, ersetzt in `0152`) journalisiert fünf redaktionelle Felder —
`catalog_status`, `catalog_visible`, `display_name_override`,
`image_override_path`, `card_type` — und `base_sky_id` ist **keines davon**.
Die Beziehung wird von den RPCs aus `0159` ausdrücklich journalisiert, nicht
vom Trigger. Gemessen: Durchgang C, **0** Journalzeilen. Eine
Wiederherstellung erzeugt also keine erfundene Änderungsgeschichte — was
richtig ist, denn niemand hat etwas geändert.

**Was in beiden Varianten gilt:**

* **Die Serie muss stimmen, und zwar vorher.** `base_sky_id` allein genügt
  dem Fremdschlüssel nicht — er prüft das Paar. Spielt man eine Figur mit
  einer anderen `series_code` ein als im Archiv, scheitert die Zuordnung, und
  zwar zu Recht.
* **Eine Basisfigur lässt sich danach nicht einfach umziehen.** `on update
  restrict` weist jede Serienänderung ab (`23001`), solange Varianten auf sie
  zeigen. Erst lösen, dann umziehen, dann wieder zuordnen.
* **Eine Basisfigur lässt sich nicht löschen**, solange Varianten auf sie
  zeigen — ebenfalls `23001`. Beim Verwerfen eines Entwurfs zählt
  `admin_merge_references()` das mit (`0159`, Abschnitt 4b), und der
  Fremdschlüssel ist die Rückversicherung dahinter.

---

## 6. Was ein Archiv ohne das Feld bedeutet

Archive, die **vor** `0160` entstanden sind, führen `base_sky_id` nicht. Sie
bleiben gültig und vollständig **im Sinne ihrer Version**: die
Vollständigkeitsprüfung in `src/lib/backup/platform-archive.ts` zählt
**Bereiche** (54 bei `format_version` 2), nicht Felder, und `base_sky_id` ist
ein Feld. Nachgerechnet in `src/lib/backup/platform-export-0160.test.ts`.

Was ein solches Archiv **nicht** hergibt: die Beziehung. Jede Variante käme
als eigenständige Figur zurück — mit ihrer SKY-ID, ihrem Namen, ihrem Preis
und ihrer Familie (`character_id`), aber ohne Mitte. Im Katalog sähe das nicht
nach einem Fehler aus, sondern nach einer falschen Sortierung. Genau diese
Leisheit ist der Grund für `0160`.

Die **logische Sicherung mit `pg_dump`** (Stufe 2 nach
`supabase/checks/backup_architecture_two_tier.md`) ist davon nicht betroffen:
sie kopiert die Spalte unabhängig von dieser Funktion — und spielt sie als
`COPY` in **einer** Anweisung je Tabelle wieder ein, also in genau der Form,
die Abschnitt 2 als unbedenklich gemessen hat.
