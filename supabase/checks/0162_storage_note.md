# Was eine Löschung in Supabase Storage zurücklässt

**Stand 2026-10-29, zu Migration `0162`.** Sicherheitsregel 15 des Auftrags:
„Berücksichtige auch zugehörige Bilder in Supabase Storage. Keine verwaisten
oder versehentlich gelöschten gemeinsam verwendeten Bilder; bei Unsicherheit
Bilddateien zunächst erhalten und den Bereinigungsbedarf dokumentieren."

Das ist genau die Entscheidung, die hier getroffen wurde: **erhalten und
dokumentieren.**

## Die Messung, die sie begründet

`supabase/checks/cat09_delete_references.sql`, rein lesend, 2026-10-29:

| | |
|---|---|
| Zeilen mit `image_file` | **534** |
| verschiedene Dateinamen darunter | **475** |
| **geteilte Dateien** (mehrere Zeilen, eine Datei) | **44** |
| davon betroffene Zeilen | **103** |
| Zeilen mit `image_override_path` | 115 |
| geteilte Override-Pfade | **0** |

**44 Bilddateien gehören mehr als einer Katalogzeile.** Das ist kein Fehler,
sondern Absicht: eine Variante trägt oft dasselbe Foto wie ihre Grundfigur,
und das Legacy-Projekt hat die Dateien schon so geteilt
(`docs/SKYLANDERS_DATA.md`, ADR-0046).

## Warum `admin_delete_figure` keine Datei anfasst

Zwei Fehler sind möglich, und sie sind **nicht** gleich schwer:

* **Eine verwaiste Datei** bleibt im Bucket liegen. Sie kostet Speicher und
  niemanden sonst — der Katalog zeigt sie nicht mehr an, weil die Zeile fort
  ist.
* **Eine gelöschte geteilte Datei** nimmt einer **anderen**, weiter
  bestehenden Figur ihr Bild. Das fällt erst auf, wenn jemand sie ansieht, und
  es ist aus dem Katalog allein nicht reparierbar.

Bei 44 geteilten Dateien ist der zweite Fehler kein Randfall. Die Funktion
löscht deshalb **keine** Datei, und sie gibt den Dateinamen im Ergebnis
zurück (`image_file`), damit eine spätere Bereinigung weiß, worüber sie redet.

## Was dadurch aufzuräumen bleibt

Nach einer Löschung kann **eine** Datei verwaisen — und nur dann, wenn die
gelöschte Zeile die **letzte** war, die auf sie zeigte. Die Prüfung dafür ist
ein Einzeiler:

```sql
-- Dateien im Bucket, auf die keine Katalogzeile mehr zeigt.
-- (Rein lesend; die Liste der Objekte kommt aus storage.objects.)
select o.name
  from storage.objects o
 where o.bucket_id = 'catalog'
   and not exists (select 1 from public.skylanders s
                    where s.image_file = o.name
                       or s.image_override_path = o.name);
```

**Das ist noch nicht gebaut, und mit Absicht nicht.** Eine Bereinigung, die
Dateien löscht, ist eine eigene Aufgabe mit eigener Freigabe — und sie wäre
heute verfrüht: es gibt noch keine einzige gelöschte Zeile, also auch keine
verwaiste Datei. Wenn mehrere Löschungen gelaufen sind, lohnt die Abfrage
einmal, und dann entscheidet ein Mensch je Datei.

**Was NICHT passieren darf:** ein Trigger oder eine Funktion, die beim
Löschen einer Zeile eine Datei mit entfernt. Bei einer geteilten Datei wäre
das genau der zweite Fehler von oben, und zwar automatisch.
