# Silver Boomer — Bereinigungsplan (CAT-11)

**Stand 2026-10-31 · Staging · rein lesend erhoben · NICHTS ausgeführt.**
Jeder Schritt unten braucht die ausdrückliche Freigabe des Betreibers.

## 1. Befund (Staging, Prüfzugang `skyisles_agent`)

| | `SKY-0010` Boomer | `SKY-0836` Silver Boomer | `SKY-0929` Silver Boomer |
|---|---|---|---|
| Herkunft | Import (2026-09-11) | CAT-03-Entwurf, Checkliste C40 „Chase Variants" (2026-10-27) | Dialog „Figur hinzufügen" (2026-10-31 14:22 UTC) |
| Status | `public`, sichtbar | `draft`, unsichtbar | `draft`, unsichtbar |
| Slug | `boomer` | `silver-boomer` | `silver-boomer-spyros-adventure` |
| Serie / Kategorie | SA / 10 | SA / 10 | SA / 10 |
| Kartenkunst | `standard` | `standard` | `chase` |
| Types / Banner | – / – | – / – (unentschieden) | – / – (unentschieden) |
| Basisfigur | – | **–** | **–** |
| Charakter | **–** | – | – |
| Bild | `086dd03aaac5960f.webp` (Import) | `SKY-0836/ffcfa72ef86baac1.png` (Override) | – |
| Marktwert | 9,49 | – | – |
| Varianten, die auf sie zeigen | 0 | 0 | 0 |
| Sammlung · Lager · Einkauf · Verkauf | 1 · 1 · 10 · 8 | 0 · 0 · 0 · 0 | 0 · 0 · 0 · 0 |
| Favoriten, Warenkörbe, Angebotsstatus, Benachrichtigungen, Importzuordnungen, Altbestand | **nicht lesbar** (Prüfzugang) | **nicht lesbar** | **nicht lesbar** |
| Auf Production | ja | **nein** (Entwürfe trägt der Publish nicht) | **nein** |

Gezählt in den vier für den Prüfzugang lesbaren der 14 Fremdschlüsselpfade.
Die übrigen zehn prüft `admin_discard_draft` (`0155`) beim Verwerfen selbst
über `admin_merge_references` — vollständig, aus `pg_constraint`, plus
`order_lines`. Eine Zeile mit Verweis wird **abgewiesen, nicht mitgelöscht**.

**Boomer hat keinen Charakter**, weil `data/characters/characters.json` ihn
nicht führt — korrektes Modell (ADR-0010), kein Datenfehler. Für die
Variantenbeziehung ohne Belang. Dieser Plan legt **keine** Familie an.

### Konflikte

1. **Zwei Zeilen für dieselbe Sache.** Gleicher Name, gleiche Serie, gleiche
   Kategorie. Nur eine darf bleiben — sonst erscheint die Variante zweimal
   bei Boomer.
2. **Keine von beiden ist Variante.** Darum sortieren beide unter „S" und
   tragen kein Chase-Banner.
3. **Die Merkmale sind verteilt:** das Bild hat `SKY-0836`, die
   Chase-Kartenkunst hat `SKY-0929`. Übertragen wird nichts automatisch;
   die Kartenkunst wird an `SKY-0836` einzeln gesetzt (Schritt C).

### Bildrechte — ausdrücklich

* Die Bilddatei von `SKY-0836` ist das Checklistenbild `image66.png`
  (sha256-Präfix `ffcfa72ef86baac1`, `supabase/operations/staging-cat03-import.sql`).
  Die Importnotiz sagt „externe Bildrechte ungeklaert".
* **Das Repository sagt etwas anderes:** CAT-05B (2026-10-27) hat 102 dieser
  Bilder übernommen, „freigegeben vom Betreiber, der die Rechte selbst
  geprüft hat" (`PROJECT_STATUS.md`, ADR-0154 Entscheidung 4). ADR-0154
  verweist dafür auf `docs/LEGAL.md` — **dort steht dazu nichts.**
* **Widerspruch, nicht aufgelöst:** Ob die Freigabe von CAT-05B auch für
  dieses Bild gilt, kann nur der Betreiber sagen. Deshalb ist sie unten ein
  eigener **Riegel (Schritt A)**, ohne den `SKY-0836` nicht veröffentlicht wird.
* Solange die Figur ein Entwurf ist, ist das Bild nicht öffentlich im Katalog.
  Mit der Veröffentlichung und dem nächsten `catalog:publish` ginge es nach
  Production (Storage-Transfer, dann `image_override_path`).

## 2. Plan — `SKY-0836` bleibt, `SKY-0929` wird verworfen (Präferenz des Betreibers)

Alle Schreibschritte laufen über **vorhandene, journalisierte Schreibwege**
in der Admin-Oberfläche auf Staging. Keine SQL-Datei, keine Migration —
`0159` und `0163` stehen auf Staging. `0166` wird dafür **nicht** gebraucht.

| # | Schritt | Weg | Rücknahme |
|---|---|---|---|
| **A** | **Bildrechte für `SKY-0836/ffcfa72ef86baac1.png` bestätigen** — oder das Bild vor der Veröffentlichung entfernen (Bearbeiten → „Eigenes Bild entfernen"). Ohne Entscheidung: `SKY-0836` bleibt Entwurf. | Betreiber | — |
| **B** | Basisfigur setzen: Admin-Detailseite `SKY-0836` → „Variante von" → **Boomer `SKY-0010`**. **Kein** „Familie anlegen". | `admin_set_variant_base` (0159) | „Variante von" → keine |
| **C** | Bearbeiten `SKY-0836`: Types = **Chase**, Kartenkunst = **Chase**. Danach auf der Kachel Banner = **Chase**. | `admin_set_figure_types`, Editor (`card_type`, Trigger journalisiert), `admin_set_visible_type` | jeweils zurückstellen |
| **D** | Nachkontrolle, rein lesend (Abfrage unten): `SKY-0836` = Variante von `SKY-0010`, `types = {chase}`, Banner `chase`, entschieden, `card_type = chase`. | Prüfzugang | — |
| **E** | **Erst danach** `SKY-0929` verwerfen: Admin-Katalogliste → Papierkorb → „Endgültig löschen". | `admin_discard_draft` (0155): nur Admin-Entwürfe, nur ohne Verweise, Journalzeile `discarded` **vor** dem Löschen | **keine** — `SKY-0929` ist danach verbraucht und wird nie wieder vergeben (ADR-0001). Darum zuletzt. |
| **F** | Nachkontrolle, rein lesend: genau **eine** Zeile „Silver Boomer"; Bestand sonst unverändert. | Prüfzugang | — |
| **G** | Veröffentlichen (`draft` → `public` oder `hidden`) — **eigene Entscheidung**, erst nach A. Danach `npm run catalog:publish:plan`: erwartet `figur-anlegen SKY-0836` plus `types`, `visible_type`, `base_sky_id`, `image_override_path`; Riegel 5 ok (Boomer steht auf Production). Storage-Transfer **vor** dem Publish. | Editor, dann Publish mit eigener Freigabe | Status zurück; auf Production erst nach einem Publish |

**Warum nicht zusammenführen?** `admin_merge_draft` überträgt Felder von
einem Entwurf auf eine **bestehende** Figur und löscht den Entwurf. Beide
Zeilen sind Entwürfe, und übertragen werden müsste nur `card_type` — ein
Feld, das Schritt C direkt und sichtbar setzt.

**Warum nicht umgekehrt (`SKY-0929` behalten)?** Möglich und genauso sicher;
dann entfällt Schritt A (kein Bild), und `SKY-0836` würde in Schritt E
verworfen — mit seinem Bild im Speicher (`0155` fasst Storage nicht an und
nennt den verwaisten Pfad). Die Herkunftsnotiz aus der Checkliste ginge mit
der Zeile; das Journal bleibt.

### Abfrage für D und F (rein lesend)

```sql
select sky_id, name, slug, catalog_status, card_type, base_sky_id, types,
       visible_type, visible_type_decided, image_override_path, character_id
  from public.skylanders
 where sky_id in ('SKY-0010', 'SKY-0836', 'SKY-0929')
    or lower(name) = 'silver boomer'
 order by sky_id;
```

Erwartet nach F: `SKY-0010` unverändert; `SKY-0836` mit `base_sky_id =
SKY-0010`, `types = {chase}`, `visible_type = chase`, `visible_type_decided
= true`, `card_type = chase`, `character_id` NULL; **keine** Zeile `SKY-0929`.
