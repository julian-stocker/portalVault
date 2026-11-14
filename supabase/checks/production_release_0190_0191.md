# Production-Release 0190 und 0191 — Ablauf, Abbruchbedingungen, Rücknahme

**Stand:** 2026-11-13 (F3, vorbereitet). **Nicht angewendet.** Jeder Schritt auf Production braucht
eine eigene Freigabe des Betreibers.
**Umfang:** genau `0190` und `0191` (ADR-0186). Nicht `0192`, nicht `0168`–`0189`.
**Projekt:** Production `zmiwxswrpkmizvqsgype`. Jede Datei hier bricht auf Staging ab.

## Die Dateien

| Schritt | Datei | Art |
|---|---|---|
| Preflight 0190 | `supabase/checks/prod_0190_preflight.sql` | rein lesend, eine Anweisung |
| Lauf 0190 | `supabase/operations/prod-0190.sql` | **schreibt**: eine Transaktion, Migration zeichengleich eingebettet |
| Nachkontrolle 0190 | `supabase/checks/prod_0190_postflight.sql` | rein lesend, braucht die Baseline |
| Preflight 0191 | `supabase/checks/prod_0191_preflight.sql` | rein lesend |
| Lauf 0191 | `supabase/operations/prod-0191.sql` | **schreibt**: eine Transaktion |
| Nachkontrolle 0191 | `supabase/checks/prod_0191_postflight.sql` | rein lesend, braucht die Baseline |
| Rücknahme | `supabase/rollback/R0191_create_order_terms_versions.sql`, dann `R0190_seller_legal_public.sql` | **schreibt**, nur im Fehlerfall |

Alle Dateien laufen im SQL-Editor des Production-Projekts als `postgres`. Nichts davon läuft über
ein Werkzeug; der Prüfzugang `skyisles_agent` gibt es nur auf Staging.

## Was die Pakete absichern

**Umgebung (A0–A3, Preflight 101–106).** Kein Staging-Stempel auf der Datenbank. Dazu positiv am
Schema, wortgleich aus `prod-0167.sql`: die 0133-Objekte (liegen nur auf Production), `sky_id_seq`
ohne Staging-Band, mindestens 100 Katalogzeilen. Ein Zeilenimport kann keinen dieser Nachweise
herstellen.

**Einmaligkeit und Reihenfolge.** `prod-0190.sql` bricht ab, wenn `seller_legal_public` schon liegt.
`prod-0191.sql` bricht ab, wenn 0190 fehlt (Rumpf-md5), wenn es `create_order` nicht genau einmal
gibt oder `legal_versions_public` schon liegt. Dazu bricht 0191 selbst ab, wenn die Sechser nicht der
Rumpf aus 0139 ist (`c233337c…`).

**Nichts anderes bewegt sich (A6/A8 → Z1).** In derselben Transaktion vorher und nachher gemessen,
jede Zeile und jede Spalte:
- Bestellungen, Rechnungen, Bestellsnapshots, Lagerpositionen, Lagerbewegungen, Verkäufer,
  Rechtsfassungen;
- Rechte, Form und Rumpf jeder Funktion in `public` außer den neuen;
- Rechte und RLS-Schalter jeder Tabelle;
- jede Policy.

Ein bewegter Wert bricht ab, und nichts ist angewendet. Die Transaktion läuft in **REPEATABLE READ**:
Z1 vergleicht genau, was diese Transaktion verändert hat. Eine Kundenbestellung während des Laufs
führt also nicht zu einem falschen Abbruch.

**Die neuen Objekte (Z2 ff.).** Wortgleich die Prüfungen der Staging-Läufe: Rumpf-md5, STABLE bzw.
SECURITY DEFINER, genau ein leerer `search_path`, Rechte (anon und authenticated ja, PUBLIC nein;
`seller_legal_public` und `legal_versions_public` auch nicht `service_role`), Spalten. Die Achter
übernimmt die Empfänger der Sechser. Am Ende stehen genau zwei Überladungen, und die Sechser ist
unverändert. Danach: die Rechtsfassungen sind weiter viermal `2026-09-17`.

**Sammlungen und Favoriten** stehen in keiner Messung und keiner Baseline, weil Kunden sie jederzeit
ändern. Ihre Rechte und Policies sind in den Abdrücken enthalten.

## Baselines — immer frisch

Zeile 900 jedes Preflights ist die Baseline seiner eigenen Nachkontrolle. Sie hat 17 Teile: Marke,
15 Felder, Schutzsumme. **Sie wird unmittelbar vor dem Lauf erhoben**, für 0191 neu und nicht aus 0190
übernommen. In keiner Datei steht eine Bestandszahl von Production.

Die Nachkontrolle vergleicht bei Bestellungen, Rechnungen, Snapshots, Lagerpositionen und -bewegungen
nur Zeilen **bis zum größten Schlüssel der Baseline**:
- Eine neue Bestellung bricht sie nicht; 891–895 melden, was dazukam.
- Eine **veränderte bestehende** Zeile schlägt an (811–815).

Auch ein normaler Vorgang verändert bestehende Zeilen, etwa eine Zahlung, ein Versand oder eine
Lagerbuchung. Deshalb gilt: **Preflight, Lauf und Nachkontrolle in einem ruhigen Zeitfenster**, ohne
offenen Checkout und ohne Arbeit im Orderbuch.

Die Baseline kommt so in die Nachkontrolle: in **einer** Transaktion
`begin; select set_config('skyisles.p0190', '<Zeile 900>', true); <Nachkontrolle>; rollback;`.
Wie bei 0167 wird dafür nach der Meldung der Zeile eine Hülle gebaut,
`supabase/operations/prod-s-postflight-0190.sql` bzw. `-0191.sql`, mit der gemeldeten Zeile
wortgleich. Sie entsteht erst dann und enthält nie eine geschätzte Zahl.

## Ablauf

Voraussetzungen: F0–F2 bestanden, F3 (diese Pakete) abgenommen, **F4 erledigt**. F4 bedeutet:
Betriebssicherung heruntergeladen (`/business/datensicherung`), Plattform-Export (Formatversion 2,
54 Bereiche) und ein `pg_dump` der Production-Datenbank liegen vor.

**Zur Sicherung:** Ein Export ist noch keine Wiederherstellung. Eine Wiederherstellung aus
Production-Daten wurde nie erprobt (M-03, `restore_supported: false`). Die Rücknahmen unten brauchen
keine Sicherung, weil 0190 und 0191 keine Daten schreiben. Die Sicherung ist für den Fall gedacht,
der nicht vorgesehen ist.

| # | Schritt | Erwartet | Abbrechen, wenn |
|---|---|---|---|
| 1 | Ruhiges Zeitfenster beginnen | — | Bestellungen oder Orderbuch-Arbeit offen |
| 2 | `prod_0190_preflight.sql` | `9999 = 0`. Zeile 900 vollständig melden | `9999 ≠ 0`, oder `9998 ≠ 0`. 101–106: falsches Projekt, sofort stoppen. 111: 0190 liegt schon. 121–127: Verkäuferidentität passt nicht zu den Rechtstexten. 131: Fassungen nicht 2026-09-17 |
| 3 | `prod-0190.sql` (ganze Datei) | NOTICE `0190 ok`, `commit` | jede `ABBRUCH`-Meldung oder ein Fehler. Es ist nichts angewendet; Ursache klären, **nicht** in Teilen wiederholen |
| 4 | Nachkontrolle 0190 mit der Baseline aus 2 | `9999 = 0` | 801–803: Baseline fehlt oder ist beschädigt (Schritt wiederholen, nicht raten). 201–207: Funktion steht nicht wie zugesagt, dann **R0190**. 811–823: siehe „Abweichung in 811–823“ |
| 5 | `prod_0191_preflight.sql` | `9999 = 0`. Zeile 900 **neu** melden | 111: 0190 fehlt. 112/117: 0191 liegt schon. **113: die Sechser ist nicht der Rumpf aus 0139.** Dann nicht weiter; 0191 bräche ohnehin ab. 115: der laufende Checkout darf die Sechser nicht ausführen |
| 6 | `prod-0191.sql` (ganze Datei) | NOTICE `0191 ok`, `commit` | jede `ABBRUCH`-Meldung oder ein Fehler. Nichts ist angewendet |
| 7 | Nachkontrolle 0191 mit der Baseline aus 5 | `9999 = 0`. 221 = viermal 2026-09-17 | 201–215: neue Objekte nicht wie zugesagt, dann **R0191**. 207–209: die Sechser hat sich bewegt, dann **R0191** und klären |
| 8 | `supabase/migrations/APPLIED.md`, Production-Teil: 0190 und 0191 mit Datum | — | — |
| 9 | Zeitfenster beenden | — | — |
| 10 | Erst jetzt F7: Merge nach `main` und Deployment | — | — |

**Zwischen 4 und 5 und zwischen 7 und 10 darf Zeit vergehen.** Der laufende Code (`main`) kennt
weder `seller_legal_public` noch die Achter. Er läuft mit beiden Migrationen unverändert weiter,
weil er die Sechser ruft, die bis 0192 bleibt.

**Umgekehrt gilt das nicht.** Der neue Code auf einer Datenbank ohne 0191 kann nicht bestellen
(PGRST202), und ohne 0190 zeigen die Rechtsseiten ihren Fehlerzustand. Deshalb kommt **erst die
Datenbank, dann der Code**.

### Abweichung in 811–823

Z1 im Lauf hat schon in derselben Transaktion bewiesen, dass die Migration selbst nichts bewegt hat;
ohne `0190 ok` bzw. `0191 ok` gibt es kein `commit`. Eine Abweichung in der Nachkontrolle betrifft
deshalb die Zeit **zwischen** Preflight und Nachkontrolle. Vorgehen:
1. 891–895 und die betroffene Tabelle ansehen: Gab es eine Zahlung, einen Versand, eine Buchung?
2. 821–823 (Funktionen, Tabellenrechte, Policies) dürfen **nie** abweichen. Weicht eine davon ab,
   hat jemand anderes Schema oder Rechte geändert. Dann stoppen, nicht deployen, klären.
3. Nicht „reparieren“. Wiederholt wird nur die Nachkontrolle, und nur mit derselben Baseline.

## Rücknahme

**Die Rücknahme der Migrationen ist nur nötig, wenn eine Migration selbst falsch ist.** Für ein
fehlerhaftes Deployment reicht es, den Code zurückzunehmen. `main` (`bfbb112`) läuft mit 0190 und
0191 unverändert.

Reihenfolge, wenn alles zurück muss:

1. **Code zurück**, falls schon deployt: in Vercel das vorherige Production-Deployment (`bfbb112`)
   per Instant Rollback wieder ausliefern. **Nie** eine Staging-Vorschau befördern (ADR-0185); deren
   Bundle trägt die Staging-Werte. Grund für diesen ersten Schritt: Der neue Checkout ruft die Achter
   und `legal_versions_public()`. Ohne beide kann niemand bestellen.
2. **`R0191_create_order_terms_versions.sql`.**
   - Entfernt die Achter und `legal_versions_public()` und lädt den PostgREST-Schemacache neu
     (`notify pgrst`).
   - Bricht ab, wenn die Sechser fehlt (0192 angewendet). Dann zuerst `R0192`; das ist für diesen
     Release nicht vorgesehen.
   - Eine zweite Ausführung ist folgenlos.
3. **`R0190_seller_legal_public.sql`.**
   - Entfernt `seller_legal_public()`. Eine zweite Ausführung ist folgenlos.
   - **Sie schickt kein `notify pgrst`.** Danach im selben Editor
     `notify pgrst, 'reload schema';` ausführen, damit PostgREST die Funktion nicht weiter anbietet.
4. Nur 0190 gelaufen: nur Schritt 3.
5. `APPLIED.md`: Rücknahme mit Datum eintragen.

Beide Rücknahmen tragen **keinen Umgebungswächter**. Sie sind umgebungsneutral und gehören in den
Editor des Projekts, das zurückgenommen wird.

Belegt in `src/lib/admin/prod-0190-0191.test.ts` (PGlite, Testdaten): R0191 und dann R0190 führen
zum Stand vor 0190 zurück. Die Sechser bleibt die ganze Zeit unverändert, und der Preflight zu 0190
besteht danach wieder mit derselben Baseline.

## Was lokal geprüft ist — und was nicht

**Geprüft** (`src/lib/admin/prod-0190-0191.test.ts`, PGlite mit einer Production-ähnlichen
Testdatenbank und erfundenen Zeilen):
- Beide Migrationen zeichengleich eingebettet, eine Transaktion, Wächter vor der Migration.
- Preflight, Lauf und Nachkontrolle für 0190 und 0191 mit `9999 = 0`.
- Abbrüche, nach denen nichts angewendet ist: Staging-Stempel, Staging-Band, fehlendes 0133, zweiter
  Lauf, 0191 vor 0190, andere Rechtsfassungen, fremder Rumpf der Sechser.
- Die Nachkontrolle duldet eine neue Bestellung und eine neue Sammlungszeile. Sie meldet eine
  veränderte Bestellung, eine veränderte Rechnung und ein verschobenes Tabellenrecht. Ohne oder mit
  beschädigter Baseline schlägt sie an.
- Die Rücknahmen in dieser Reihenfolge.
- `npm run verify:check-sql` plant alle vier Prüfdateien gegen das Stub-Schema.

**Nicht geprüft:**
- Dass die Dateien auf Production laufen.
- Ob die Sechser auf Production wirklich der Rumpf aus 0139 ist. Das zeigt erst Preflight 113.
  Gemessen wurden auf Production bisher nur Signaturen.
- Ob `pg_dump` und eine Wiederherstellung funktionieren (F4, M-03).
