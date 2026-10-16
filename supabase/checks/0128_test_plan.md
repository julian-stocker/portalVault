# Testplan `0128` — Korrekturbelege

Was die lesenden Prüfdateien **nicht** zeigen können. `0128_preflight.sql` und
`0128_postflight.sql` prüfen den Zustand; dieser Plan prüft die Vorgänge, und
jeder Schritt hier verlangt einen Schreibvorgang.

**Nur auf Staging.** Jeder Testeinkauf wird neu angelegt, mit **fiktiven**
Absenderdaten („Henry Tester"). Belegnummern in den Ergebnissen sind
Staging-Testreferenzen.

## Vorbedingung

`0128_preflight.sql` gelaufen, `9999 = 0`, Befund `VOR_0128` · `0128`
angewendet · `0128_postflight.sql` gelaufen, `9999 = 0`.

## K1 — der Ursprungsbeleg

1. Neuen Einkauf anlegen, Kaufdatum setzen, zwei Figuren, Kosten eintragen.
2. Im (i)-Fenster „Eigenbeleg erstellen & herunterladen".

**Erwartet:** ein PDF mit Titel „Eigenbeleg über einen Privatankauf", ohne
Korrekturvermerk, ohne Revisionszeile. Belegnummer aus dem laufenden Kreis.
Keine Beleghistorie (eine Fassung wird nicht als Liste gezeigt). Der Satz zum
eingefrorenen Stand steht da.

## K2 — ohne Abweichung gibt es keine Korrektur

Direkt nach K1, ohne irgendetwas zu ändern.

**Erwartet:** die Aktion „Korrekturbeleg erstellen" **erscheint nicht**
(`correctable = false`).

**Und serverseitig:** gibt es einen Weg, sie doch aufzurufen (ein zweites
Fenster, das noch den alten Zustand zeigt), lehnt der Server mit „Seit dem
letzten Beleg hat sich an den belegrelevanten Daten nichts geändert" ab. Das
ist die verbindliche Prüfung — die fehlende Schaltfläche ist nur die
freundliche.

## K3 — eine Figur wechseln, dann korrigieren

1. Bearbeiten → eine Figur austauschen (⇄) → speichern, Rückfrage bestätigen.
2. Der Belegabschnitt zeigt „abweichend" und die Aktion erscheint.
3. „Korrekturbeleg erstellen" → die Rückfrage lesen → bestätigen.

**Erwartet:**
- Ein **neuer** Beleg mit der **nächsten** Nummer des Kreises, Revision 2.
- Die Historie zeigt zwei Fassungen: die neue als „Aktuelle Fassung", die alte
  als „Ersetzt", mit „ersetzt SI-E-… vom …" an der neuen.
- Die Abweichungsmeldung ist weg (der neue Beleg passt zum Einkauf).
- Beide Fassungen sind einzeln herunterladbar.

## K4 — die beiden PDFs

Beide Fassungen herunterladen und ansehen.

**Erwartet:**
- Der **Ursprungsbeleg** ist unverändert: alte Figur, alter Titel, kein
  Korrekturvermerk. Byte für Byte derselbe wie in K1 — prüfbar über den
  SHA-256 der Datei.
- Die **Korrektur** trägt „Eigenbeleg – Korrektur", „Ersetzt Beleg SI-E-… vom
  …", „Revision 2", die neue Figur und den Satz, dass der ersetzte Beleg
  unverändert aufbewahrt bleibt.
- Kein Wort über steuerliche Gültigkeit auf keinem der beiden.

## K5 — mehrere Korrekturen

Nach K3 eine weitere Änderung (Figur hinzufügen) → erneut korrigieren.

**Erwartet:** Revision 3, `supersedes` zeigt auf Revision 2, die Historie hat
drei Einträge, genau einer ist „Aktuelle Fassung". Die Nummern sind
fortlaufend und lückenlos.

## K6 — der Abrufnachweis bleibt

Vor einer Korrektur die aktuelle Fassung vollständig herunterladen (grüner
Haken), dann korrigieren.

**Erwartet:** der Haken bleibt **an der ersetzten Fassung** in der Historie.
Die neue Fassung hat noch keinen Abruf. Kein Nachweis verschwindet.

## K7 — Nebenläufigkeit (zwei Fenster)

Zwei Browserfenster auf demselben Einkauf, beide zeigen „abweichend". In
beiden „Korrekturbeleg erstellen" bestätigen, so dicht hintereinander wie
möglich.

**Erwartet:** **genau eine** Korrektur entsteht. Das zweite Fenster bekommt
„Seit dem letzten Beleg hat sich … nichts geändert" — denn nach dem ersten
Durchlauf ist die neue Spitze aktuell. Keine zwei Belege mit derselben
Revision, kein Constraint-Fehler nach außen.

**Das ist der Fall, den die automatisierte Suite nicht zeigen kann.** Er
braucht zwei Sitzungen; ein Test in einem Prozess beweist ihn nicht.

## K8 — während der Bearbeitung

Bearbeitungsmodus öffnen.

**Erwartet:** beide Belegknöpfe sind gesperrt, mit dem Satz „Während der
Bearbeitung wird kein Beleg ausgestellt — erst speichern oder verwerfen". Ein
Beleg während der Bearbeitung fröre einen Stand ein, den niemand bestätigt hat.

## K9 — ohne Ursprung keine Korrektur

Ein Einkauf ohne Eigenbeleg.

**Erwartet:** die Aktion erscheint nicht. Serverseitig: „Für diesen Einkauf ist
noch kein Eigenbeleg ausgestellt. Eine Korrektur setzt einen Ursprungsbeleg
voraus."

## K10 — Testvorgang und fehlendes Kaufdatum

**Erwartet:** dieselben drei Ablehnungen wie bei der Erstausstellung
(Testvorgang, fehlendes Kaufdatum, unvollständige Geschäftsdaten) — mit
denselben Sätzen.

## Nach allen Fällen

`0128_postflight.sql` erneut laufen lassen. Die 9xx-Zeilen weichen jetzt
**absichtlich** vom Preflight ab — es wurden Belege ausgestellt. Die
Invarianten 991–996 müssen weiter `0` zeigen, und 111–115 ebenso: kein
Ursprungsbeleg trägt einen Verweis, jeder Verweis nennt wirklich die Nummer
und das Datum seines Vorgängers.

## Was dieser Plan nicht abdeckt

- Die **steuerliche** Beurteilung des Dokuments. Ob ein Korrekturbeleg mit
  Verweis das richtige Instrument ist, entscheidet die Steuerberatung des
  Betreibers, nicht dieser Plan.
- Die Wiederherstellung — `0129_restore_test.md`.
