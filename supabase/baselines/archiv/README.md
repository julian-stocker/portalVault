# Archivierte Baselines

Hier liegen Baselines, die **vor** einer noch nicht angewendeten Migration
durch eine frischere Messung ersetzt wurden. Sie sind keine aktiven
Vergleichswerte mehr — sie sind Prüfbelege.

**Eine Akte wird nie gelöscht und nie überschrieben.** Soll der Stand
unmittelbar vor dem Schreiben gemessen werden, dann:

```bash
npm run db:migrate:staging -- <nummer> --refreeze
```

Der Runner legt die vorhandene Akte dann unverändert hierher — benannt nach
ihrem Erhebungszeitpunkt — und friert danach neu ein. Auf eine schon
archivierte Datei schreibt er nicht. `--refreeze` ist nur möglich, solange
die Migration **nicht** angewendet ist; zusammen mit `--resume` wird es
abgewiesen. Nach dem Schreiben neu zu messen wäre kein Nachweis.

| Datei | Was sie belegt |
|---|---|
| `baseline-0154-2026-10-28T06-55-19-681Z.json` | der **erste** Pre-Write-Stand für `0154`: Katalog **731**, Sammlung **21** (`md5 965b1492…`). Beim Neueinfrieren um 07:16 kamen **zeichengleiche** Werte heraus — zwei unabhängige Messungen desselben Zustands. Das ist zugleich der erste Lauf, der `--refreeze` benutzt hat |
| `baseline-0152-2026-10-27T20-23-19-426Z.json` | der Stand **vor dem einmaligen Katalogimport** (CAT-04E): Katalog **626** Zeilen, Sammlung **14** Zeilen (`md5 5935b937…`), Lagerzeilen 287, öffentliche Angebote 257. Kopie von `../baseline-0152.json`, das weiterhin die aktive Akte der angewendeten Migration `0152` ist. Dieser Abdruck ist der Beleg der CAT-04F-Analyse: `626 + 105 = 731`, und die Sammlung ging **nicht** durch den Import von 14 auf 21 |

## Eine Lücke, die hier benannt gehört

Für `0154` lag eine Akte vom **2026-10-27T22:51:28.783Z**. Sie wurde am
2026-10-28 von Hand gelöscht, damit der Runner frisch einfriert — der
Runner kannte `--refreeze` damals nicht und hätte sonst gegen eine über
neun Stunden alte Messung verglichen.

**Ihr Inhalt ist nicht rekonstruierbar.** Was von diesem Lauf bleibt:

- `supabase/log/staging/migrate-0154-2026-10-27T22-51-28-823Z.md` —
  das Protokoll: Preflight `ok`, `9999 = 0`, 27 Zeilen, eine offene
  (134, `catalog_editorial`), Preflight-SHA `f2f31741ffdea9c0…`.
  Das Protokoll hält die **Befunde** fest, nicht die Vertragszeilen.
- Die aktive Akte `../baseline-0154.json`, erhoben
  `2026-10-28T06:55:19.681Z`: Katalog **731**, Sammlung **21**.

Die gelöschte Messung lag zeitlich **nach** dem Import (21:46) und nach den
sieben Sammlungszeilen (20:43), ihre beiden Zahlen waren also sehr
wahrscheinlich dieselben 731 und 21. **Bewiesen ist das nicht** — die Datei
ist weg. Deshalb gibt es `--refreeze`: damit sich das nicht wiederholt.
