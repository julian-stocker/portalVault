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

## 5. Postflight bestanden — `9999 = 0` (2026-10-25)

Der Wiederholungslauf mit den eingetragenen Baselines ist **vollständig
bestanden**. Betreiber: *„Alle Struktur-, Rechte-, RLS-, Shop- und
Sammlungsprüfungen sind erfolgreich. Die Baselines stimmen vollständig
überein."*

Damit ist belegt: die Tabelle steht mit drei Spalten und dem
zusammengesetzten Primärschlüssel, RLS ist an, die drei Richtlinien stehen
und fragen Konto **und** Rolle, `anon` hat nichts, `authenticated` hat genau
`SELECT`/`INSERT`/`DELETE`, `favorite_demand()` ist `definer`+`stable` hinter
dem Betriebstor und für `PUBLIC` nicht ausführbar, die Migration hat keine
Zeile angelegt — und **Shop und Sammlung sind unverändert**, gemessen gegen
den Stand von vor dem Lauf.

**Migration 0145 ist auf Staging strukturell abgenommen.**

---

## 6. RLS funktional geprüft — 17 von 17 (2026-10-25)

`npm run verify:rls:staging`, Abschnitt **10**, mit zwei echten Konten und
zwei echten Sitzungen. Der Abschnitt ist für diesen Lauf **neu
hinzugekommen** — der Prüfer kannte `favorites` nicht.

| Prüfung | Ergebnis |
|---|---|
| A merkt eine Figur auf der eigenen Liste vor | PASS, 1 Zeile |
| B merkt **dieselbe** Figur auf seiner vor | PASS, 1 Zeile |
| eine Variante ist ein eigener Favorit (zweite SKY-ID, dasselbe Konto) | PASS |
| derselbe Favorit zweimal | abgewiesen, `23505` |
| A sieht **nur** die eigenen | PASS, 2 Zeilen, 0 fremde |
| B sieht **nur** die eigenen | PASS, 1 Zeile, 0 fremde |
| A liest die Favoriten von B | 0 Zeilen |
| A legt einen Favoriten **für** B an | abgewiesen, `42501` |
| A löscht den Favoriten von B | 0 Zeilen gelöscht |
| die Zeile von B ist danach intakt | PASS, von B selbst gelesen |
| einen Favoriten auf ein fremdes Konto umhängen | abgewiesen, `42501` — **es gibt kein `update`** |
| A entfernt den eigenen | PASS, 1 Zeile |
| anonym lesen | abgewiesen, `42501` |
| anonym anlegen | abgewiesen, `42501` |
| ein **Sammler** ruft `favorite_demand()` | abgewiesen, *„seller operator role required"* |
| **anonym** ruft `favorite_demand()` | abgewiesen, *„permission denied for function"* |
| der **Dienstschlüssel** ruft `favorite_demand()` | abgewiesen, *„seller operator role required"* |

Die letzte Zeile war zuerst eine andere Prüfung und **schlug fehl** — sie
wollte die Antwortsignatur lesen und ging davon aus, dass der
Dienstschlüssel durchkommt. Er kommt nicht durch: er umgeht RLS, aber nicht
das Tor im Rumpf einer `definer`-Funktion, denn `auth.uid()` ist für ihn
`null`. Die Prüfung sagt jetzt, was gilt — und das ist die stärkere Aussage:
**die Zahl hängt an einer Rolle, nicht an einer Verbindung.**

> **Was dieser Lauf NICHT zeigt:** dass `favorite_demand()` ausschließlich
> `(sky_id, users)` zurückgibt. Dieser Lauf hat kein Betriebskonto, also
> antwortet die Funktion ihm nie. Belegt ist es zweifach anderswo:
> `src/lib/favorites/schema.test.ts` liest die Signatur im SQL, und Probelauf
> **P52** ruft die Funktion an echtem PostgreSQL mit gestelltem Tor auf und
> liest die Spaltennamen der Antwort.

**29 weitere Prüfungen des Laufs schlagen fehl, und keine davon betrifft die
Favoriten.** Sie liegen alle in Abschnitt 9 (Shop, Lager, Journal) und sind
veraltete Erwartungen des Prüfers: er verschafft sich `shop_admins` und will
damit buchen, aber Buchen braucht seit `0041`/`0077` einen
**Verkäuferbetrieb** (ADR-0077). Der letzte fachliche Stand von
`tools/verify-rls.mts` ist `c443f7c`, also vor dieser Umstellung. Eigene
Baustelle, eigene Freigabe.

---

## 7. Browser gegen Staging — was geprüft ist und was nicht

`npm run dev:staging` lief gegen `qqxcpesbwfxzgytkdsac`, mit
`service-role key: withheld (disabled-by-dev-staging)`.

### Geprüft, am laufenden Server

| | |
|---|---|
| `/favoriten` ausgeloggt | `307` → `/login?next=%2Ffavoriten` — **identisch zu `/collection`** |
| Katalog ausgeloggt | 74 Karten, **74 Herzen**, alle als Anmeldeverweis |
| und mit Kontext | z. B. `/login?next=%2F%3Fseries%3DSA%26figure%3DSKY-0007` (ADR-0027) |
| kein Herz im Setz-Zustand für einen Ausgeloggten | 0 von 74 |
| `favoritedSkyIds` im ausgelieferten Markup | `[]` — nichts ausgeliefert, was es nicht geben darf |
| `/shop` | 225 Karten, **0 Herzen** — eine Fläche ohne Favoritenwissen zeigt keins |
| Navigationspunkt | vorhanden, mit dem 18-px-Herz und `md:hidden` für die Telefonleiste |
| Herz-Pfad im Markup | 75 × = 1 Leiste + 74 Karten; derselbe Pfad in Leiste und Karte |
| kein Leck | `favorite_demand`, `skyisles_agent`, `service_role` kommen im Markup nicht vor |

### DABEI EIN FEHLER GEFUNDEN UND BEHOBEN

`PROTECTED_PREFIXES` in `src/lib/supabase/middleware.ts` führte
`/collection`, `/account`, `/settings`, `/onboarding` — **`/favoriten`
nicht**. Die Leiste bietet „Favoriten" einem ausgeloggten Besucher an (genau
wie „Sammlung"), der Klick lief in die Seite, dort antwortete
`isCollector()` mit `false`, und der Besucher bekam **404 auf einen Punkt,
den die Leiste ihm gerade gezeigt hatte**.

Behoben, mit Regressionstest in `src/lib/favorites/ui.test.ts` — und der
Wächter wurde gegen die alte Fassung gefahren, um zu sehen, dass er
anschlägt. Am laufenden Server bestätigt: `307` statt `404`.

### NICHT geprüft — braucht eine interaktive Anmeldung

Ich habe keine Sitzung eines Sammlerkontos und kann keine herstellen. Diese
Punkte bleiben **manuell**:

1. Herz im Katalog setzen und wieder ausmachen, **angemeldet**
2. **Daneben tippen** und prüfen, dass gesammelt wird statt vorgemerkt
   (DOM-Test deckt es ab, ein Finger auf Glas ist etwas anderes)
3. Basisfigur und Legendary getrennt vormerken, **sichtbar** am gefüllten Herz
4. `/favoriten` öffnen, Reihenfolge und Zählung
5. Dort entfernen — die Karte muss **sofort** gehen
6. Suche, Serien-Tabs und die Filter „Alle · Besitz · Fehlen" auf `/favoriten`
7. Leere Wunschliste
8. **Telefonbreite: drei Punkte in der Leiste** statt zwei — die einzige
   Stelle, an der eine Rechnung („Favoriten passt auf 360 px") einen Blick
   braucht
9. Mit einem **Betriebskonto**: `/favoriten` muss 404 sein, im Katalog kein Herz

---

## 8. Was noch aussteht

1. Die neun manuellen Browser-Punkte aus Abschnitt 7.
2. **Vor jedem Production-Rollout:** die Folgemigration muss `favorites` in
   die Plattformsicherung aufnehmen (ADR-0136,
   `supabase/checks/platform_export_gap.md`).
3. Unabhängig davon: Abschnitt 9 von `tools/verify-rls.mts` ist seit
   `0041`/`0077` veraltet (29 Prüfungen). Eigene Baustelle.
