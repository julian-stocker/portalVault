# Der kürzeste Weg zu einer geprüften Betriebssicherung

**Rein lesend. Es wird nichts geschrieben, nichts freigegeben, nichts
bestellt.** Zwei Schritte, zusammen etwa fünf Minuten.

---

## Warum das noch aussteht

`0140` hat der Betriebssicherung drei Felder gegeben — `sale_released`,
`delivery_scope`, `usk_rating` — und die Nachkontrolle hat belegt, dass ihre
**Definition** sie nennt (Abdruck `a32b148cebe00ee0d0d469f96fd2028e`, 28
Bereiche, 356 Feldzeilen). Dass ein **Export** sie auch liefert, ist eine
andere Aussage, und die ist offen.

Der letzte geprüfte Lauf gegen eine Production-Datei ist vom **2026-10-17**
(`docs/history/2026-10-17-production-0126-0131.md`): strukturell grün, 28 von
28 Bereichen — aber vier Migrationen vor `0140`.

## Schritt 1 — die Sicherung ziehen

`https://skyisles.app/business/datensicherung` → herunterladen.

Die Seite ruft `seller_business_backup()` auf, und die Funktion **liest nur**
(Postflight-Zeile 131/132: kein `insert`, `update`, `delete`, `truncate`,
`nextval`, `setval` im Rumpf). Die Datei landet in `~/Downloads` und heißt
`skyisles-business-backup-<zeitstempel>.json`.

**Sie darf nicht ins Repository.** Sie trägt Käufernamen, Anschriften und
Einkaufskosten — die drei Klassen, die `docs/SECURITY.md` hier verbietet.
`.gitignore` fängt den kanonischen Namen ab, und das Werkzeug unten bricht
ab, wenn der Pfad im Arbeitsverzeichnis liegt.

## Schritt 2 — sie prüfen

```bash
npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
```

Die Baseline wählt das Werkzeug aus `source_project` **der Datei** — nicht
aus der Gewohnheit. Das ist die Lehre aus einem Fehlalarm vom 2026-10-17, als
eine Production-Sicherung gegen die Staging-Baseline lief und zwölf
Abweichungen meldete, jede richtig gerechnet und keine ein Mangel der Datei.

### Was grün sein muss — das Kriterium

| | |
|---|---|
| **28 von 28 Bereichen** | kein Bereich fehlt, keiner ist unbekannt |
| **kein fehlendes Feld** | insbesondere stehen `sale_released`, `delivery_scope` und `usk_rating` jetzt in der Datei |
| **kein unbekanntes Feld** | die Datei führt nichts, was das Manifest nicht beschreibt |
| **kein ausdrücklich ausgeschlossenes Feld** | die neun personenbezogenen Einkaufsfelder sind draußen |
| **`counts` deckungsgleich** | die Zähler stimmen mit den Listen |
| **keine Kontoidentität im Belegbereich** | |

### Was abweichen WIRD, und kein Mangel ist

Die `PRODUCTION_BASELINE` hält die **Bestände vom 2026-10-17** fest:
`purchases` 88, `purchase_items` 2 142, Gesamtsumme 6 152, 0 Eigenbelege.
Der Betrieb läuft seitdem weiter — Abweichungen in diesen Zeilen sind eine
Auskunft über den Betrieb, keine über die Datei.

> **Eine Prüfung, die man wegerklären muss, ist die schlechteste Art von
> Prüfung: eine, die man zu ignorieren lernt.** Deshalb gilt hier die Regel
> ausdrücklich: **struktureller Teil grün = bestanden.** Weicht eine
> Zeilenzahl ab, ist der richtige nächste Schritt, die neue Zahl in die
> Baseline zu übernehmen — mit Datum und Quelle, so wie es am 2026-10-17
> gemacht wurde —, nicht sie zu übersehen.

### Wenn das Werkzeug mit „nicht einig" abbricht

Dann widersprechen sich `src/lib/backup/manifest.ts` und der Rumpf der
letzten Migration, und die Datei wird **gar nicht** geprüft — richtig so: ein
Ergebnis gegen einen widersprüchlichen Plan wäre eine Aussage über die
falsche Erwartung. Nach `0140` dürfen sie sich nicht widersprechen; passiert
es doch, ist das ein Befund über das Repository, nicht über die Sicherung.

## Was dieser Nachweis NICHT zeigt

Dass sich aus der Datei eine Datenbank **wiederherstellen** lässt. Es gibt
keine Importfunktion (`restore_supported = false`); der Weg auf einer
isolierten Testdatenbank steht in `supabase/checks/0129_restore_test.md`, und
**das Ergebnisprotokoll dort ist leer.** Die Sicherung deckt Daten ab, kein
Schema — und Production hat weder natives Backup noch PITR (Supabase Free).
Der schemaseitige Nachweis bleibt offen (`backup_architecture_two_tier.md`,
Punkt 9).
