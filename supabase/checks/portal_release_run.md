# Ablauf: die 21 Portale werden öffentlich sichtbar

**Stand: vorbereitet, NICHT ausgeführt. Braucht eine Freigabe.**

Nach dem Lauf zeigt der Zubehörkatalog `/zubehoer` **60 statt 39** Artikel.

---

## Der eine Schritt

```
supabase/operations/staging-portal-release.sql
```

Vollständig markieren, in den SQL-Editor des **Staging**-Projekts
`qqxcpesbwfxzgytkdsac` einfügen, ausführen. Die Datei bringt `begin` und
`commit` selbst mit.

**Was geschrieben wird:** `catalog_visible = true` auf **21 ausgeschriebenen
SKY-IDs**. Eine Spalte, eine Anweisung. Sonst nichts — der Test zählt die
Schreibvorgänge nach: genau ein `update` auf `public.skylanders`, jedes
`insert` in eine temporäre Tabelle, kein `delete`, kein `grant`.

## Was das bedeutet — und was nicht

| | |
|---|---|
| `/zubehoer` zeigt die Portale | **ja**, 39 → 60 |
| anonyme Besucher dürfen die Zeile lesen | **ja** — das ist die Zeilenpolicy aus `0004`, und genau das heißt „öffentlich sichtbar" |
| sie werden sammelbar | **nein** — die Kategorie `Portale` steht in `non_collectible_categories()`, 534 bleibt 534 |
| sie erscheinen in einer Sammlung | **nein** — `fetchCollection()` verwirft sie an der Quelle |
| sie werden verkäuflich | **nein** — `is_shop_eligible()` verlangt `item_type = 'figure'` |
| ein Shop-Angebot entsteht | **nein** — kein Bestand, kein Preis, keine Listung |
| eine Figur wird mit freigegeben | **nein** — die 30 ausgeblendeten Figuren bleiben ausgeblendet |

## Erwarteter Ergebnisnachweis

**Zwei `NOTICE`-Zeilen:**

```
A ok: 21 Portale, davon 0 schon sichtbar; 534 sammelbar, 256 Angebote,
      30 ausgeblendete Figuren.
C ok: 21 Portale sichtbar, Sichtbarkeit aller anderen Zeilen unveraendert,
      534 sammelbar, 534 shopfaehig, 256 Angebote — alles wie vorher.
```

**Und das Raster D:**

| gegenstand | vorher | nachher | befund |
|---|---|---|---|
| `schon_sichtbar` | 0 | **21** | erwartet 0 → 21 |
| `sammelbar` | 534 | **534** | muss gleich sein |
| `shopfaehig` | 534 | **534** | muss gleich sein |
| `angebote` | 256 | **256** | muss gleich sein |
| `katalogzeilen` | 626 | **626** | muss gleich sein |
| `sammlung` | 1 | **1** | muss gleich sein |
| `lagerzeilen` | 285 | **285** | muss gleich sein |
| `sicht_andere_md5`, `angebote_md5`, `sammelbar_je_serie` | | | Abdruck, in C verglichen |

**Jede Abweichung bricht ab** und rollt zurück. Besonders `C2`: ein Abdruck
über die Sichtbarkeit **jeder anderen** Katalogzeile — bewegt sich daran
etwas, war die Freigabe nicht gezielt.

## Danach

`/zubehoer` neu laden: **60 Artikel**, und der Filter **Art** erscheint
(vorher gab es nur eine Art, also kein Feld). Der Figurenkatalog, die
Sammlung und der Shop sind unverändert.

## Rücknahme

```
supabase/rollback/R_portal_release.sql
```

Setzt dieselben 21 wieder auf `catalog_visible = false`; trifft nur Zeilen
mit `item_type = 'portal'`, bricht ab, wenn es nicht genau 21 sind. Danach
zeigt `/zubehoer` wieder 39.

## Was der Probelauf schon zeigt

`npm run verify:check-sql`, Durchgang **P33**, gegen echtes PostgreSQL:
sichtbar **0 → 21**, sammelbar **unverändert**, Angebote **unverändert**,
shopfähige Portale **0**, und eine danebengestellte **ausgeblendete Figur
bleibt ausgeblendet** — eine pauschale Freigabe wäre damit aufgefallen. Die
Rücknahme stellt 0 wieder her.

**Das ist kein Lauf gegen Staging** (`open_verifications.md`, Abschnitt 3a).

## Prüfsummen

| Datei | SHA-256 |
|---|---|
| `supabase/operations/staging-portal-release.sql` | `b30c3fd0382ace8531e61f4cdf0268830bd272b29c0452925ccba9d10cc13512` |
| `supabase/rollback/R_portal_release.sql` | `bad0a176833b1084d827d2c540e61594ab15e96a1429e678bb4c94191c2b1365` |
