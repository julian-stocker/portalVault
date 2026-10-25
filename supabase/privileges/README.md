# Die gemessenen Rechte des Staging-Prüfzugangs

`staging-agent.json` ist eine **Messung**, kein Sollwert: was die Rolle
`skyisles_agent` auf Staging tatsächlich darf, erhoben mit

```bash
npm run db:privileges:staging       # rein lesend
```

**Dieses Verzeichnis ist versioniert**, und zwar aus demselben Grund wie
`supabase/baselines/`: die Probeläufe bauen ihre Welt daraus, also muss die
Messung auch nach einem frischen Clone da sein. Sie enthält Rollennamen,
Objektnamen und Wahrheitswerte — keine Zugangsdaten, keine Zählstände, keine
Namen von Personen.

## Warum es das gibt

Dreimal hintereinander ist die Nachkontrolle von `0146` an einem fehlenden
Recht gescheitert:

```
1. permission denied for view offer_state_live
2. permission denied for function offer_state_window
3. permission denied for function shop_offers
```

Die ersten beiden Male war die Umsetzung zu eng. Das dritte Mal lag der
Fehler tiefer: die Prüfungen leiteten die Rechte aus
`supabase/operations/staging-agent-setup.sql` ab — also aus der **Absicht**.

Am 2026-10-20 hat `0139` `shop_offers()` mit `drop function` neu angelegt
(der Rückgabetyp änderte sich, das kann `create or replace` nicht). **`DROP` +
`CREATE` verwirft die ACL; `CREATE OR REPLACE` behält sie.** Die Erteilung war
damit fort, die Einrichtungsdatei sagte weiter „erteilt", und jeder Probelauf
bildete eine Welt nach, die es nicht mehr gab.

Seitdem gilt: **die Datenbank ist die Quelle.** Die Einrichtungsdatei sagt nur
noch, was erwartet *war*.

## Wann die Aufnahme veraltet

Sie trägt einen `abdruck` über die Einrichtungsdatei und jede
**rechtserhebliche** Migration. Rechtserheblich ist genau zweierlei:

1. Die Migration **nennt** `skyisles_agent` — erteilt oder entzieht ihm also
   direkt.
2. Sie **verwirft** ein ihm erteiltes Objekt (`drop function|table|view`).
   Dann ist die ACL fort, ohne dass irgendwo `revoke` steht.

Ein `grant` an `anon` oder `authenticated` berührt ihn nicht, und ein
`revoke … from public` auch nicht. Eine gewöhnliche neue Migration macht die
Aufnahme deshalb **nicht** veraltet — sonst wäre der Riegel so laut, dass er
abgeschaltet würde.

Stimmt der Abdruck nicht mehr, **gilt die Aufnahme als fehlend**: Probelauf
**P54** scheitert mit dem Hinweis, neu zu erheben. Eine Messung von vor der
letzten rechtserheblichen Migration sagt nichts über heute.

## Was `abweichungen` bedeutet

Die Liste nennt jede Stelle, an der Einrichtungsdatei und Datenbank
auseinandergehen. Sie ist **nicht leer**, solange `execute` auf
`shop_offers()` fehlt — und genau dann bleiben die Baselinezeilen 811/812 der
Nachkontrolle **offen** (Zeile 9998), statt stillschweigend als bestanden zu
gelten.
