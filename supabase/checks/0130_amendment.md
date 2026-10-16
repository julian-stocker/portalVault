# Nachtrag zu Migration `0130` — nachträgliche Änderung, aktenkundig

**`0130` wird nicht erneut angewendet.** Dieses Dokument ändert nichts an der
Datenbank. Es hält fest, was nach der Ausführung an der Datei geändert wurde,
belegt den Umfang und macht die ausgeführte Fassung nachrechenbar.

Angelegt am 2026-10-16.

---

## 1. Der Befund

`0130_business_backup_fields.sql` wurde auf Staging **ausgeführt** (bezeugt
durch den anschließenden `0131`-Preflight: 28 Bereiche, **339** Feldzeilen —
das ist der Stand nach `0130`) und **danach** verändert.

| Fassung | SHA-256 |
|---|---|
| **ausgeführt** | `37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe` |
| **heute im Repository** | `bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77` |

Die ausgeführte Prüfsumme wurde im Arbeitsverlauf zweimal unabhängig berichtet
(16:20 Uhr gefolgt von zwei Korrekturen, dann stabil um 17:08 und 17:21 Uhr);
die Änderung erfolgte um 17:45 Uhr, nach dem Abbruch von `0131`.

## 2. Der Umfang: vier Zeilen

Eingefügt wurde ausschließlich diese Formprüfung, in die Prüfschleife der
**Nachbedingung** — Anweisung 4 der Datei, der zweite `do $$`-Block:

```sql
    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then
      raise exception '%: der Pruefeintrag "%" hat keine Form Bereich|Feldzeile',
        v_wer, v_key;
    end if;
```

Anlass: `0131` brach mit `0131 Abbruch:  fehlt im Bereich seller` ab — ohne
Feldnamen, weil elf Prüfeinträge das Bereichspräfix verloren hatten und
`split_part` auf einem Wert ohne Trenner die leere Zeichenkette liefert. Die
Formprüfung bricht seitdem mit eigener Meldung ab, statt eine Lücke zu
behaupten, die sie nicht belegen kann.

## 3. Warum die Datenbank unberührt ist

Die Datei besteht aus vier Anweisungen:

| # | Anweisung | geändert? |
|---|---|---|
| 1 | `do $$` — Vorbedingungen | nein |
| 2 | `create or replace function public.seller_business_backup()` | **nein** |
| 3 | `comment on function …` | **nein** |
| 4 | `do $$` — Nachbedingungen | **ja, die vier Zeilen** |

Die vier Zeilen stehen in Anweisung 4. Funktionsrumpf und Kommentar sind
unverändert; der Zustand, den die ausgeführte Fassung auf Staging hinterlassen
hat, ist derselbe, den die heutige Fassung hinterlassen würde. Die Änderung
betrifft eine **Prüfung**, nicht das Schema und nicht die Daten.

Gegenprobe gegen die lebende Datenbank (rein lesend, jederzeit nachholbar):
`md5(prosrc)` von `public.seller_business_backup()` auf Staging muss dem Rumpf
der Repository-Datei entsprechen. Für den aktuellen Stand `0131`:
**`24c3810288bb20929fe995554a267adf`**, Rumpflänge 21 458 Zeichen.

## 4. Wie die ausgeführte Fassung nachrechenbar bleibt

**Nicht als zweite `.sql`-Datei.** Eine fast identische, ausführbare Migration
neben der echten ist eine Falle — irgendwann führt sie jemand aus.

Stattdessen als **geprüftes Rezept**: entfernt man aus der heutigen Datei genau
den Block aus Abschnitt 2 (vier Zeilen, einmaliges Vorkommen), ergibt sich
bitgenau die ausgeführte Fassung:

```bash
python3 - << 'PY'
import hashlib
s = open("supabase/migrations/0130_business_backup_fields.sql").read()
block = """    if split_part(v_key, '|', 1) = '' or split_part(v_key, '|', 2) = '' then
      raise exception '%: der Pruefeintrag "%" hat keine Form Bereich|Feldzeile',
        v_wer, v_key;
    end if;
"""
assert s.count(block) == 1
print(hashlib.sha256(s.replace(block, "").encode()).hexdigest())
# erwartet: 37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe
PY
```

Dasselbe rechnet `src/lib/backup/backup-sql-areas.test.ts` bei **jedem**
Testlauf nach. Jede weitere Änderung an `0130` lässt diesen Test fallen — die
Datei ist damit nicht nur dokumentiert, sondern bewacht.

## 5. Warum es passieren konnte

`0126` bis `0131` sind **nicht committet**; `git ls-files` endet bei `0125`.
Sechs angewendete Migrationen existieren nur als Dateien im
Arbeitsverzeichnis, ohne Baseline, gegen die eine Änderung auffällt. Die
Prüfsummen in `SHA256SUMS.txt` deckten bisher nur `supabase/checks/` ab.

Geprüft wurden die übrigen angewendeten Migrationen: `0126`, `0128`, `0129`
und `0131` sind bitgleich mit der Fassung, die zuletzt vor ihrer Ausführung
berichtet wurde. `0127` wurde vor dem erfolgreichen zweiten Versuch geändert —
der erste Versuch brach ab und rollte zurück, das ist dokumentiert und kein
Nachträglich-Fall. **`0130` ist der einzige Fall.**

## 6. Was daraus folgt

1. `0130` bleibt, wie sie ist. Nicht erneut anwenden.
2. `0126`–`0131` committen, sobald freigegeben — erst dann existiert eine
   Baseline.
3. `SHA256SUMS.txt` auf `supabase/migrations/` ausweiten.
4. **Regel für die Zukunft:** die Nachbedingung einer ausgeführten Migration
   ist eingefroren. Ein neuer Wächter gehört in die Prüfdateien
   (`supabase/checks/`) und in die Testsuite — dort wirkt er auch bei schon
   gelaufenen Migrationen; in der Migrationsdatei wirkt er nicht mehr.
