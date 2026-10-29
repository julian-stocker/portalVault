# CAT-04D — wie die Bilder später an die Entwürfe kommen

**Nichts davon ist ausgeführt.** Kein Upload, kein Schreibzugriff, keine
Veröffentlichung. Dieses Dokument ist der Entwurf des Ablaufs und benennt den
einen Grund, aus dem er heute nicht laufen darf.

---

## 1. Der Blocker, und er ist gemessen

**Der Bucket `catalog` ist öffentlich lesbar** (seit `0007`, ADR-0046,
`docs/SECURITY.md`). Am 2026-10-27 nachgemessen: ein anonymer `HEAD` auf

```
<supabase>/storage/v1/object/public/catalog/SKY-0009/c29021891080cd90.jpg
```

antwortet **200**, ohne jeden Schlüssel.

> **Ein Upload in diesen Bucket ist eine Veröffentlichung** — auch dann, wenn
> die Figur ein `draft` ist und im Katalog nicht erscheint. Die Sichtbarkeit
> der ZEILE und die Erreichbarkeit des OBJEKTS sind zwei verschiedene Dinge.

Die Bilder stammen aus einer fremden Checkliste, und ihre Nutzungsrechte sind
**ungeklärt**. Solange das so ist, darf kein einziges hochgeladen werden —
auch nicht auf Staging.

**Das ist kein technisches, sondern ein rechtliches Hindernis.** Technisch ist
alles fertig: 102 Bilder sind eindeutig zugeordnet, geprüft und lokal
ausgepackt.

---

## 2. Warum Figur und Bild nicht atomar entstehen können

Zwei unabhängige Gründe, und beide sind strukturell:

**Der Pfad braucht die SKY-ID.** Ein Bild liegt unter
`catalog/<SKY-ID>/<16 hex sha256>.<ext>` — die ID entsteht aber erst beim
Anlegen der Zeile, aus `sky_id_seq` (ADR-0070). Vorher gibt es keinen Pfad.

**Es sind zwei Systeme.** Die Zeile entsteht in PostgreSQL, das Objekt in
Supabase Storage über eine HTTP-API. Es gibt keine Transaktion, die beide
umspannt: ein `rollback` nimmt die Zeile zurück, nicht das Objekt.

Daraus folgt der zweistufige Ablauf — nicht als Notbehelf, sondern als die
einzige ehrliche Form.

---

## 3. Stufe 1 — die Zeilen

`supabase/operations/staging-cat-04a-import.sql`, wie in
`supabase/checks/cat04a_staging_run.md` beschrieben. Unverändert gültig:

* `catalog_status = 'draft'`, `catalog_visible = false`;
* **kein** `image_file`, **kein** `image_override_path` — die Spalten kommen
  im INSERT nicht vor;
* idempotent, `nextval` erst nach der Dublettenprüfung;
* die interne Notiz trägt **die Zuordnung**: `xl/media/imageNNN.png` mit
  Format, Maßen und `sha256`-Präfix.

**Die Notiz ist das Bindeglied.** Sie macht Stufe 2 später reproduzierbar,
ohne dass heute etwas veröffentlicht wird — und sie überlebt in der Datenbank,
nicht nur in einer Datei auf diesem Rechner.

---

## 4. Stufe 2 — die Bilder, wenn die Rechte geklärt sind

### Der empfohlene Weg für die fünf Testfiguren: die bestehende Adminoberfläche

`/admin/catalog/<SKY-ID>` kann ein Bild hochladen. Dieser Weg existiert, ist
getestet und tut **genau** das Richtige:

| Schritt | wer macht ihn |
|---|---|
| Admin prüfen | `isAdmin()` serverseitig |
| Größe prüfen (≤ 2 MiB) | `MAX_IMAGE_BYTES` |
| Format aus den **Bytes** bestimmen | `sniffImage()` — ein umbenanntes `.png` fällt auf |
| Pfad bilden | `imagePathFor()` → `SKY-xxxx/<16 hex sha256>.<ext>` |
| hochladen | Bucket `catalog`, inhaltsadressiert |
| `image_override_path` setzen | dieselbe Aktion |

**Fünf Figuren sind fünf Uploads.** Kein neues Werkzeug, kein neuer
Schreibzugang, kein neuer Schreibpfad in die Datenbank — und der Betreiber
sieht jedes Bild, bevor es landet. Die Dateien liegen fertig in
`resources/review/cat-04-bilder/`, benannt nach Serie und Figur.

### Für alle übrigen: ein EINMALIGER Lauf, kein System (CAT-04E)

**Der Excel-Import ist eine einmalige Vervollständigung des Katalogs**, kein
Dauerbetrieb. Es entsteht deshalb kein Bildimportsystem — nur die
Entscheidungslogik, und die liegt als prüfbares Modul in
`src/lib/catalog/image-import.ts` (19 Prüfungen in
`image-import.test.ts`). Ein Uploader darauf wären rund vierzig Zeilen, und
die lohnen sich erst, wenn die Rechte geklärt sind.

**Die Zuordnung überlebt den Import in der Datenbank.** Jede angelegte Zeile
trägt sie in ihrer internen Notiz; eine einzige lesende Abfrage holt sie
zurück:

```sql
select s.sky_id, s.name, s.series_code, e.admin_note
  from public.skylanders s
  join public.catalog_editorial e using (sky_id)
 where e.admin_note like '%Zugeordnetes Bild:%'
 order by s.sky_id;
```

Daraus entsteht die Liste `SKY-ID → xl/media/imageNNN.png → lokale Datei`
ohne jede zusätzliche Infrastruktur.

Der Ablauf, falls der Uploader gebaut wird:

```
für jede eindeutig zugeordnete Figur:
  1. SKY-ID lesen     über (Name, Serie) — rein lesend
  2. ÜBERSPRINGEN     wenn image_override_path bereits gesetzt ist
  3. hochladen        catalog/<SKY-ID>/<sha16>.<ext>, upsert = false
  4. Spalte setzen    image_override_path = derselbe Pfad
  5. protokollieren   eine Zeile je Figur in eine Akte
```

**Warum das wiederaufnehmbar ist, ohne Zustand zu führen:** Schritt 3 ist
inhaltsadressiert — dieselben Bytes ergeben denselben Pfad, ein zweiter
Upload ist folgenlos. Schritt 2 ist der eigentliche Wiedereinstieg: was schon
ein Bild hat, wird nicht angefasst. Bricht der Lauf nach Schritt 3 und vor
Schritt 4 ab, liegt ein verwaistes Objekt im Bucket; der nächste Lauf lädt
dieselben Bytes auf denselben Pfad und setzt die Spalte nach. **Es entsteht
keine Dublette und kein falsches Bild.**

**Fehlerbehandlung, drei Fälle:**

| Fall | Verhalten |
|---|---|
| Upload schlägt fehl | Figur überspringen, protokollieren, weitermachen — eine Figur ohne Bild ist ein Zustand, kein Schaden |
| Spalte setzen schlägt fehl | ebenso; das Objekt bleibt liegen und wird beim nächsten Lauf nachgetragen |
| Figur hat schon ein Bild | **nie überschreiben** — das ist der Admin, und der hat Vorrang |

---

## 5. Was nie passieren darf

1. **Kein Standardbild für eine Sonderedition.** Drei Entwürfe teilen sich ihr
   Medium mit einem anderen Eintrag und sind deshalb als **mehrdeutig**
   geführt — sie bekommen **kein** Bild. „Mobile Hot Streak" etwa zeigt im
   geteilten Bild das gewöhnliche Fahrzeug „Hot Streak"; das wäre genau der
   Fehler, den diese Regel verhindert.
2. **Kein Überschreiben.** `image_override_path` gehört dem Admin.
3. **Keine SKY-ID im Voraus.** Sie entsteht in Stufe 1 und nirgends sonst.
4. **Keine Veröffentlichung ohne geklärte Rechte** — und ein Upload in diesen
   Bucket **ist** eine Veröffentlichung.
5. **Kein Bild nach `public/images/skylanders/`.** Das ist der Importkanal
   (`image_file`), er gehört der Legacy-Quelle, und ein Commit brächte die
   Dateien ins Repository.

---

## 6. Der sichere nächste Schritt

**Die Rechtefrage zuerst, und sie ist eine Entscheidung, keine Technik.**
Solange sie offen ist, gibt es zwei gangbare Wege:

| Weg | was er bedeutet |
|---|---|
| **A — Entwürfe jetzt, Bilder später** | Stufe 1 fahren (fünf Entwürfe, ohne Bild). Der Adminbereich zeigt einen Platzhalter, die Notiz nennt die zugeordnete Datei. Sobald die Rechte geklärt sind, fünf Uploads über die Oberfläche |
| **B — beides später** | nichts tun, bis die Rechte geklärt sind. Die Zuordnung liegt im Manifest und läuft nicht davon |

**Empfehlung: A.** Der Statustest aus `cat04a_staging_run.md` prüft den
Entwurfs-Arbeitsablauf, und dafür braucht er kein Bild. Die Zuordnung ist
gesichert und dokumentiert; sie nachzutragen kostet fünf Klicks.

**Was Weg A nicht tut:** er veröffentlicht nichts, er verbraucht fünf SKY-IDs,
und er lässt sich nicht rückgängig machen, ohne die IDs zu verlieren — das
steht so schon in `cat03_import_run.md`.
