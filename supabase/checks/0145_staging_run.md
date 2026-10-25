# `0145` auf Staging — Lauf vom 2026-10-25

**Was gelaufen ist, was dabei auffiel, und wofür die beiden Basiszeilen gelten.**
Diese Datei ist die Akte eines einzelnen Rollouts, kein Verfahren.

---

## 1. Der Lauf

| | |
|---|---|
| Ziel | Staging `qqxcpesbwfxzgytkdsac` |
| Datei | `supabase/operations/staging-0145.sql` (bettet die Migration zeichengleich ein) |
| Migration | `0145_favorites.sql`, SHA-256 `6f9c20b0197386077a092f1e4b62e20e64488cc5a7e43bdf497e2a2c6bd7d71d` |
| Ergebnis | durchgelaufen; Tabelle, Primärschlüssel, RLS, drei Richtlinien, Rechte und `favorite_demand()` stehen |

---

## 2. Der Preflight brauchte eine Berichtigung — und es war unsere

Der erste Preflight meldete **eine** Abweichung: Zeile 121 verlangte *„genau
vier Richtlinien"* auf `collection_items`, gefunden wurden **fünf**.

Die fünfte heißt `agent_read_collection_items` — `for select to
skyisles_agent using (true)`, angelegt von
`supabase/operations/staging-agent-setup.sql` für **zwölf** Tabellen,
beschrieben in `docs/SECURITY.md` § 4b. Sie ist auf Staging beschränkt (die
Datei bricht ohne das Markerpaar `SKY-0821` + `SKY-0822` ab), auf `select`
beschränkt, und die Rolle hängt zusätzlich an
`default_transaction_read_only`. **Teil der vorgesehenen Architektur; nichts
daran wurde geändert.**

**Das Unangenehme:** `0142` hatte dieselbe Zeile, sie brach am 2026-10-22
genauso, und sie wurde dort berichtigt. `0145` hat die **alte** Formulierung
kopiert statt der neuen.

Beide Dateien prüfen seitdem Eigenschaften statt einer Zahl — die vier beim
Namen, für `authenticated`, jede mit `auth.uid()` **und**
`is_collector_account()`, RLS an, nichts für `anon`. **Und einen Schritt
weiter als `0142`:** die Agentenpolicy ist *ausdrücklich* zugelassen, aber
nur in ihrer bekannten Form (`SELECT`, permissiv, genau die Rolle
`skyisles_agent`); jede unbekannte sechste Richtlinie ist eine blockierende
Abweichung. Zeile 125 im Preflight, Zeile 145 in der Nachkontrolle.

---

## 3. Der Postflight meldete `9999 = 18` — und das war der Riegel, nicht ein Fehler

Achtzehn rote Zeilen, und zwar **genau** die achtzehn der Baseline-Übergabe:

| Zeilen | Was sie fragen | Anzahl |
|---|---|---:|
| 801–804 | ist eine Shop-Baseline da, mit Marke, neun Feldern, stimmender Summe | 4 |
| 811–817 | die sieben Geschäftszahlen gegen das Vorher | 7 |
| 821–824 | dasselbe für die Sammlungs-Baseline | 4 |
| 831–833 | die drei Sammlungswerte gegen das Vorher | 3 |

**Alles andere war grün.** Die Platzhalter `BASIS-HIER-EINSETZEN` und
`SAMMLUNG-HIER-EINSETZEN` waren nicht ersetzt — und ein nicht ersetzter
Platzhalter zählt wie eine **fehlende** Baseline. Genau das verspricht der
Riegel, und genau das hat er getan.

---

## 4. Die beiden Basiszeilen — und wofür sie **nicht** gelten

Gemessen vom bestandenen Preflight am 2026-10-25, Zeilen 900 und 901:

```text
skyisles-base-1|256|4d1d6c30fe0ae886ca2689bcb1fe9634|534|534|285|626|54fdbf243d672038128875e9a707e3dd|95ca138932c1
skyisles-coll-1|1|1|a8c965923be52b4d6fee837ae35fd22e|c8a5542794f2
```

| Feld | Shop | Sammlung |
|---|---|---|
| 2 | 256 öffentliche Angebote | 1 Sammlungszeile |
| 3 | Angebots-Abdruck | 1 Konto mit Sammlung |
| 4 | 534 shopfähige Katalogzeilen | Sammlungs-Abdruck |
| 5 | 534 sammelbare Katalogzeilen | Schutzsumme |
| 6 | 285 Lagerzeilen | — |
| 7 | 626 Katalogzeilen | — |
| 8 | Lager-Abdruck | — |
| 9 | Schutzsumme | — |

Beide Schutzsummen sind **nachgerechnet**, bevor die Werte in die Hülle
kamen — `left(md5(Felder 2–8), 12)` bzw. `left(md5(Felder 2–4), 12)`. Ein
Tippfehler auf dem Weg aus dem SQL-Editor hätte die Nachkontrolle blockiert,
nicht stillschweigend eine falsche Zahl verglichen.
`src/lib/favorites/schema.test.ts` rechnet sie bei jedem Testlauf nach.

> ### Sie gehören ausschließlich zu diesem Lauf
>
> **Kein Sollwert für irgendetwas sonst:**
>
> * **nicht für Production** — dort werden sie frisch gemessen
>   (`prod-s-preflight-0145.sql`, Zeilen 900 und 901), und
>   `prod-s-postflight-0145.sql` trägt deshalb weiter Platzhalter. Ein Test
>   hält fest, dass **kein** Staging-Wert in der Production-Hülle steht —
>   auch kein einzelnes Feld daraus;
> * **nicht für eine spätere Migration** — jede misst ihre eigene Basis vor
>   ihrem eigenen Lauf;
> * **nicht für einen zweiten Lauf zu einem anderen Zeitpunkt** — sobald der
>   Betrieb eine Figur einbucht oder ein Sammler eine hinzufügt, sind sie
>   veraltet und **müssen** blockieren.
>
> Das ist der Zweck des Vergleichs: nicht „sieht Staging aus wie am
> 25. Oktober", sondern „hat die Migration Shop und Sammlung angefasst". Die
> Begründung dieser Unterscheidung steht in
> `production_baseline_0142_finding.md` — sie entstand, weil feste
> Geschäftszahlen aus einem Preflight vier Tage später ein Production-Release
> blockiert haben.

---

## 5. Was noch aussteht

1. **Wiederholter Postflight** mit `supabase/operations/staging-s-postflight-0145.sql`
   — die Werte stehen jetzt darin, nichts ist zu ersetzen. Ziel: `9999 = 0`.
2. **`npm run verify:rls:staging`** — dass eine Richtlinie *dasteht*, prüft
   die Nachkontrolle; dass sie *greift*, nur ein Lauf mit zwei echten Konten.
3. **Browser-Durchlauf** der Favoriten gegen Staging (`npm run dev:staging`).
4. **Vor jedem Production-Rollout:** die Folgemigration muss `favorites` in
   die Plattformsicherung aufnehmen (ADR-0136,
   `supabase/checks/platform_export_gap.md`).
